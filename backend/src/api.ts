import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { QcReviewRecord, Verdict, ReviewCategories, ReviewIssue } from './types'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const err = (statusCode: number): APIGatewayProxyResultV2 =>
  respond(statusCode, { message: 'error' })

// ─── Stats 計算 ──────────────────────────────────────────────────

interface CategoryStats {
  PASS: number
  WARN: number
  FAIL: number
}

interface Stats {
  total: number
  verdicts: { PASS: number; WARN: number; FAIL: number }
  categories: Record<string, CategoryStats>
  passRate: number
}

const calcStats = (reviews: QcReviewRecord[]): Stats => {
  const verdicts = { PASS: 0, WARN: 0, FAIL: 0 }
  const categories: Record<string, CategoryStats> = {
    xss:        { PASS: 0, WARN: 0, FAIL: 0 },
    auth:       { PASS: 0, WARN: 0, FAIL: 0 },
    secrets:    { PASS: 0, WARN: 0, FAIL: 0 },
    typescript: { PASS: 0, WARN: 0, FAIL: 0 },
    infra:      { PASS: 0, WARN: 0, FAIL: 0 },
  }

  for (const r of reviews) {
    verdicts[r.verdict]++
    for (const [cat, v] of Object.entries(r.categories)) {
      categories[cat][v as Verdict]++
    }
  }

  const total = reviews.length
  const passRate = total === 0 ? 0 : Math.round((verdicts.PASS / total) * 100)

  return { total, verdicts, categories, passRate }
}

// ─── POST body validation ─────────────────────────────────────────

const VALID_VERDICTS: readonly Verdict[] = ['PASS', 'WARN', 'FAIL']
const VALID_CATS = ['xss', 'auth', 'secrets', 'typescript', 'infra'] as const

interface PostReviewBody {
  repo: string
  prNumber: number
  prTitle: string
  prAuthor: string
  verdict: Verdict
  categories: ReviewCategories
  issues?: ReviewIssue[]
  reviewComment?: string
}

const validatePostBody = (body: unknown): PostReviewBody | null => {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>

  if (typeof b.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(b.repo)) return null
  if (typeof b.prNumber !== 'number' || !Number.isInteger(b.prNumber) || b.prNumber < 1) return null
  if (typeof b.prTitle !== 'string' || b.prTitle.length === 0) return null
  if (typeof b.prAuthor !== 'string' || b.prAuthor.length === 0) return null
  if (!(VALID_VERDICTS as readonly unknown[]).includes(b.verdict)) return null

  const cats = b.categories as Record<string, unknown>
  if (!cats || typeof cats !== 'object') return null
  for (const cat of VALID_CATS) {
    if (!(VALID_VERDICTS as readonly unknown[]).includes(cats[cat])) return null
  }

  return {
    repo: b.repo,
    prNumber: b.prNumber,
    prTitle: b.prTitle,
    prAuthor: b.prAuthor,
    verdict: b.verdict as Verdict,
    categories: b.categories as ReviewCategories,
    issues: Array.isArray(b.issues) ? (b.issues as ReviewIssue[]) : [],
    reviewComment: typeof b.reviewComment === 'string' ? b.reviewComment : '',
  }
}

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method

  // CC 手動レビュー結果を DynamoDB に保存
  if (method === 'POST') {
    let rawBody: unknown
    try {
      rawBody = JSON.parse(event.body ?? '{}')
    } catch {
      return err(400)
    }

    const data = validatePostBody(rawBody)
    if (!data) return err(400)

    const reviewedAt = new Date().toISOString()
    const record: QcReviewRecord = {
      PK: `REPO#${data.repo}`,
      SK: `PR#${data.prNumber}#${reviewedAt}`,
      verdict: data.verdict,
      categories: data.categories,
      issues: data.issues ?? [],
      prNumber: data.prNumber,
      prTitle: data.prTitle,
      prAuthor: data.prAuthor,
      repoFullName: data.repo,
      reviewedAt,
      reviewComment: data.reviewComment ?? '',
    }

    try {
      await dynamo.send(new PutCommand({ TableName: process.env.TABLE_NAME!, Item: record }))
    } catch {
      return err(500)
    }

    return respond(201, { message: 'saved', sk: record.SK })
  }

  if (method !== 'GET') return err(405)

  const params = event.queryStringParameters ?? {}
  const repo = params['repo']
  const action = params['action']
  const limit = Math.min(Number(params['limit'] ?? '50'), 100)

  if (!repo || typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return err(400)
  }

  // DynamoDB から当該リポジトリのレビューを取得
  const result = await dynamo.send(
    new QueryCommand({
      TableName: process.env.TABLE_NAME!,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `REPO#${repo}` },
      ScanIndexForward: false, // SK 降順（最新順）
      Limit: action === 'stats' ? 500 : limit,
    })
  )

  const reviews = (result.Items ?? []) as QcReviewRecord[]

  if (action === 'stats') {
    return respond(200, calcStats(reviews))
  }

  return respond(200, {
    reviews: reviews.slice(0, limit),
    total: result.Count ?? 0,
  })
}
