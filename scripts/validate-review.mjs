#!/usr/bin/env node
/**
 * CC レビューに対して人間の精度評価を記録するスクリプト
 *
 * 使い方:
 *   node scripts/validate-review.mjs \
 *     --pk "REPO#maeda0/secure-spa" \
 *     --sk "PR#42#2026-06-07T10:00:00.000Z" \
 *     --tp 3 --fp 1 --fn 2 \
 *     --by "maeda0" \
 *     --notes "XSS指摘は正しかったが、パフォーマンス系の指摘は誤検知"
 *
 * 指標の意味:
 *   --tp  True Positive  = CC が正しく指摘した問題数
 *   --fp  False Positive = CC が指摘したが実際は問題でなかった数（誤検知）
 *   --fn  False Negative = CC が見落とした実際の問題数（見落とし）
 *
 * Precision = TP / (TP + FP)  → CC の指摘の正確さ
 * Recall    = TP / (TP + FN)  → 実際の問題を見つけた割合
 * F1        = 2 * P * R / (P + R)
 *
 * 認証: --token / --email+--password / COGNITO_ID_TOKEN 環境変数（post-review.mjs と同じ）
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')

function loadEnv() {
  const envPath = resolve(root, 'frontend', '.env.local')
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n')
    const env = {}
    for (const line of lines) {
      const [key, ...rest] = line.split('=')
      if (key?.trim()) env[key.trim()] = rest.join('=').trim()
    }
    return env
  } catch {
    return {}
  }
}

function parseArgs(args) {
  const result = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1]
      i++
    }
  }
  return result
}

async function fetchCognitoToken(clientId, email, password, region) {
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
      ClientId: clientId,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? JSON.stringify(data))
  return data.AuthenticationResult?.IdToken
}

const env  = loadEnv()
const args = parseArgs(process.argv.slice(2))

const API_BASE  = env.VITE_API_BASE_URL
const CLIENT_ID = env.VITE_COGNITO_CLIENT_ID
const REGION    = (env.VITE_COGNITO_USER_POOL_ID ?? '').split('_')[0] || 'ap-northeast-1'

if (!API_BASE) {
  console.error('Error: VITE_API_BASE_URL が設定されていません')
  process.exit(1)
}

const pk = args.pk
const sk = args.sk
if (!pk || !sk) {
  console.error('Error: --pk と --sk が必要です（DynamoDB のキー）')
  console.error('  例: --pk "REPO#maeda0/secure-spa" --sk "PR#42#2026-06-07T10:00:00.000Z"')
  process.exit(1)
}

const tp = Number(args.tp ?? 0)
const fp = Number(args.fp ?? 0)
const fn = Number(args.fn ?? 0)

if ([tp, fp, fn].some(n => !Number.isInteger(n) || n < 0)) {
  console.error('Error: --tp / --fp / --fn は 0 以上の整数で指定してください')
  process.exit(1)
}

// ─── 認証 ────────────────────────────────────────────────────────────
let idToken = args.token ?? process.env.COGNITO_ID_TOKEN

if (!idToken) {
  const email    = args.email    ?? process.env.COGNITO_EMAIL
  const password = args.password ?? process.env.COGNITO_PASSWORD

  if (!email || !password) {
    console.error([
      'Error: 認証が必要です:',
      '  1. --token <ID Token>',
      '  2. --email <email> --password <password>',
      '  3. COGNITO_ID_TOKEN 環境変数',
    ].join('\n'))
    process.exit(1)
  }

  console.log(`Cognito 認証中 (${email})...`)
  idToken = await fetchCognitoToken(CLIENT_ID, email, password, REGION)
  console.log('認証成功\n')
}

// ─── 精度計算（確認表示用）────────────────────────────────────────────
const precision = tp + fp > 0 ? Math.round(tp / (tp + fp) * 100) : null
const recall    = tp + fn > 0 ? Math.round(tp / (tp + fn) * 100) : null
const f1        = precision !== null && recall !== null && precision + recall > 0
  ? Math.round(2 * precision * recall / (precision + recall))
  : null

console.log(`評価内容:`)
console.log(`  True Positive  (正しい指摘): ${tp}`)
console.log(`  False Positive (誤検知):     ${fp}`)
console.log(`  False Negative (見落とし):   ${fn}`)
if (precision !== null) console.log(`  Precision: ${precision}%  Recall: ${recall}%  F1: ${f1}%`)
console.log()

const body = {
  action:         'validate',
  pk,
  sk,
  truePositives:  tp,
  falsePositives: fp,
  falseNegatives: fn,
  validatedBy:    args.by ?? process.env.USERNAME ?? 'anonymous',
  notes:          args.notes ?? '',
}

const res = await fetch(API_BASE, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,
  },
  body: JSON.stringify(body),
})

const data = await res.json()

if (res.ok) {
  console.log('✅ 精度評価を記録しました')
} else {
  console.error(`❌ エラー (${res.status}):`, data)
  process.exit(1)
}
