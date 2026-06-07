import { createHmac, timingSafeEqual } from 'crypto'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type {
  CcReviewData,
  GitHubIssueCommentPayload,
  QcReviewRecord,
} from './types'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const secrets = new SecretsManagerClient({})

// 起動時にシークレットをキャッシュ（コールドスタート時のみ取得）
let cachedWebhookSecret: string | null = null

const getWebhookSecret = async (): Promise<string> => {
  if (cachedWebhookSecret) return cachedWebhookSecret

  const { SecretString } = await secrets.send(
    new GetSecretValueCommand({ SecretId: process.env.WEBHOOK_SECRET_NAME! })
  )
  if (!SecretString) throw new Error('Webhook secret not found')

  cachedWebhookSecret = SecretString
  return cachedWebhookSecret
}

// GitHub Webhook の署名を検証（タイミング攻撃対策済み）
const validateSignature = (body: string, signatureHeader: string, secret: string): boolean => {
  const hmac = createHmac('sha256', secret)
  const expected = 'sha256=' + hmac.update(body).digest('hex')

  try {
    return timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signatureHeader, 'utf8')
    )
  } catch {
    return false
  }
}

// CC コメントから機械可読 JSON ブロックを抽出
const extractCcReviewData = (commentBody: string): CcReviewData | null => {
  const match = commentBody.match(/<!-- CC_REVIEW_DATA\n([\s\S]*?)\n-->/)
  if (!match?.[1]) return null

  try {
    return JSON.parse(match[1]) as CcReviewData
  } catch {
    return null
  }
}

const ok = (body: string): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  body: JSON.stringify({ message: body }),
})

// 内部情報を含まないエラーレスポンス
const err = (status: number): APIGatewayProxyResultV2 => ({
  statusCode: status,
  body: JSON.stringify({ message: 'error' }),
})

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // POST のみ受け付ける
  if (event.requestContext.http.method !== 'POST') return err(405)

  const body = event.body ?? ''
  const signature = event.headers['x-hub-signature-256'] ?? ''
  const githubEvent = event.headers['x-github-event'] ?? ''

  // 1. Webhook 署名を検証
  let webhookSecret: string
  try {
    webhookSecret = await getWebhookSecret()
  } catch {
    return err(500)
  }

  if (!validateSignature(body, signature, webhookSecret)) return err(401)

  // 2. issue_comment イベントのみ処理
  if (githubEvent !== 'issue_comment') return ok('ignored')

  let payload: GitHubIssueCommentPayload
  try {
    payload = JSON.parse(body) as GitHubIssueCommentPayload
  } catch {
    return err(400)
  }

  // 3. PR のコメントかつ github-actions[bot] からのみ処理
  const isPrComment = Boolean(payload.issue.pull_request)
  const isBot = payload.comment.user.login === 'github-actions[bot]'
  if (!isPrComment || !isBot || payload.action !== 'created') return ok('ignored')

  // 4. CC レビューデータを抽出
  const reviewData = extractCcReviewData(payload.comment.body)
  if (!reviewData) return ok('ignored: no review data')

  // 5. DynamoDB に保存
  const reviewedAt = new Date().toISOString()
  const record: QcReviewRecord = {
    PK: `REPO#${payload.repository.full_name}`,
    SK: `PR#${payload.issue.number}#${reviewedAt}`,
    verdict: reviewData.verdict,
    categories: reviewData.categories,
    issues: reviewData.issues,
    prNumber: payload.issue.number,
    prTitle: payload.issue.title,
    prAuthor: payload.issue.user.login,
    repoFullName: payload.repository.full_name,
    reviewedAt,
    reviewComment: payload.comment.body,
  }

  try {
    await dynamo.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME!,
        Item: record,
      })
    )
  } catch {
    return err(500)
  }

  return ok('saved')
}
