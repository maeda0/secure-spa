import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import type { QcReviewRecord, Verdict, ReviewCategories, ReviewIssue, StrideRisk, StrideAssessment, HumanValidation } from './types'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// API Gateway は OPTIONS を mock で処理するため Lambda には到達しない
// GET/POST では Lambda が CORS ヘッダーを付与する必要がある
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
}

const respond = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...corsHeaders },
  body: JSON.stringify(body),
})

const err = (statusCode: number): APIGatewayProxyResult =>
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
const VALID_STRIDE_RISKS: readonly StrideRisk[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH']
const STRIDE_KEYS = ['spoofing', 'tampering', 'repudiation', 'informationDisclosure', 'denialOfService', 'elevationOfPrivilege'] as const

interface PostReviewBody {
  repo: string
  prNumber: number
  prTitle: string
  prAuthor: string
  verdict: Verdict
  categories: ReviewCategories
  issues?: ReviewIssue[]
  reviewComment?: string
  stride?: StrideAssessment
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

  let stride: StrideAssessment | undefined
  if (b.stride && typeof b.stride === 'object') {
    const s = b.stride as Record<string, unknown>
    const allValid = STRIDE_KEYS.every(k => (VALID_STRIDE_RISKS as readonly unknown[]).includes(s[k]))
    if (allValid) stride = b.stride as StrideAssessment
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
    stride,
  }
}

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const method = event.httpMethod

  // CC 手動レビュー結果を DynamoDB に保存
  if (method === 'POST') {
    let rawBody: unknown
    try {
      rawBody = JSON.parse(event.body ?? '{}')
    } catch {
      return err(400)
    }

    // ─── 精度評価アクション ─────────────────────────────────────────
    if (rawBody && typeof rawBody === 'object' && (rawBody as Record<string, unknown>).action === 'validate') {
      const b = rawBody as Record<string, unknown>
      if (
        typeof b.pk !== 'string' || typeof b.sk !== 'string' ||
        !Number.isInteger(b.truePositives)  || (b.truePositives  as number) < 0 ||
        !Number.isInteger(b.falsePositives) || (b.falsePositives as number) < 0 ||
        !Number.isInteger(b.falseNegatives) || (b.falseNegatives as number) < 0
      ) return err(400)

      const validation: HumanValidation = {
        validatedAt:    new Date().toISOString(),
        validatedBy:    typeof b.validatedBy === 'string' ? b.validatedBy : 'anonymous',
        truePositives:  b.truePositives  as number,
        falsePositives: b.falsePositives as number,
        falseNegatives: b.falseNegatives as number,
        notes:          typeof b.notes === 'string' ? b.notes : '',
      }

      try {
        await dynamo.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME!,
          Key: { PK: b.pk, SK: b.sk },
          UpdateExpression: 'SET #val = :val',
          ExpressionAttributeNames: { '#val': 'validation' },
          ExpressionAttributeValues: { ':val': validation },
        }))
      } catch {
        return err(500)
      }

      return respond(200, { message: 'validated' })
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
      ...(data.stride ? { stride: data.stride } : {}),
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
