import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { QcReviewRecord, Verdict } from './types'

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
}

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...corsHeaders },
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

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method

  if (method === 'OPTIONS') return respond(200, {})
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
