#!/usr/bin/env node
/**
 * CC レビュー結果（+ STRIDE 脅威モデル）を API に記録するスクリプト
 *
 * 使い方:
 *   node scripts/post-review.mjs \
 *     --pr 42 \
 *     --title "feat: add login" \
 *     --verdict PASS \
 *     --xss PASS --auth WARN --secrets PASS --typescript PASS --infra PASS \
 *     --comment "認証のセッション管理に懸念あり" \
 *     --stride-s NONE --stride-t LOW --stride-r NONE --stride-i LOW --stride-d NONE --stride-e NONE
 *
 * 認証 (いずれかの方法で):
 *   1. --token <Cognito ID Token>
 *   2. 環境変数 COGNITO_ID_TOKEN=<token>
 *   3. --email <email> --password <password>  （Cognito USER_PASSWORD_AUTH で自動取得）
 *
 * STRIDE リスクレベル: NONE / LOW / MEDIUM / HIGH
 *   --stride-s  Spoofing        (なりすまし)
 *   --stride-t  Tampering       (改ざん)
 *   --stride-r  Repudiation     (否認)
 *   --stride-i  Information Disclosure (情報漏洩)
 *   --stride-d  Denial of Service     (サービス妨害)
 *   --stride-e  Elevation of Privilege (権限昇格)
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

// Cognito USER_PASSWORD_AUTH で ID トークンを取得
async function fetchCognitoToken(clientId, email, password, region) {
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`
  const res = await fetch(endpoint, {
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

const env = loadEnv()
const args = parseArgs(process.argv.slice(2))

const API_BASE  = env.VITE_API_BASE_URL
const CLIENT_ID = env.VITE_COGNITO_CLIENT_ID
const REGION    = (env.VITE_COGNITO_USER_POOL_ID ?? '').split('_')[0] || 'ap-northeast-1'
const REPO      = args.repo ?? env.VITE_DEFAULT_REPO
const PR_NUMBER = Number(args.pr)
const PR_TITLE  = args.title ?? `PR #${PR_NUMBER}`
const PR_AUTHOR = args.author ?? process.env.USERNAME ?? 'maeda0'
const VERDICT   = args.verdict ?? 'PASS'
const COMMENT   = args.comment ?? ''

const VERDICTS = ['PASS', 'WARN', 'FAIL']
const RISKS    = ['NONE', 'LOW', 'MEDIUM', 'HIGH']
const CATS     = ['xss', 'auth', 'secrets', 'typescript', 'infra']

if (!API_BASE) {
  console.error('Error: VITE_API_BASE_URL が設定されていません (frontend/.env.local を確認)')
  process.exit(1)
}
if (!REPO || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
  console.error('Error: --repo または VITE_DEFAULT_REPO が必要です')
  process.exit(1)
}
if (!PR_NUMBER || PR_NUMBER < 1) {
  console.error('Error: --pr <PR番号> が必要です')
  process.exit(1)
}
if (!VERDICTS.includes(VERDICT)) {
  console.error('Error: --verdict は PASS / WARN / FAIL のいずれかを指定してください')
  process.exit(1)
}

// ─── 認証トークン取得 ────────────────────────────────────────────────
let idToken = args.token ?? process.env.COGNITO_ID_TOKEN

if (!idToken) {
  const email    = args.email    ?? process.env.COGNITO_EMAIL
  const password = args.password ?? process.env.COGNITO_PASSWORD

  if (!email || !password) {
    console.error([
      'Error: 認証トークンが必要です。以下のいずれかを指定してください:',
      '  1. --token <ID Token>',
      '  2. 環境変数 COGNITO_ID_TOKEN=<token>',
      '  3. --email <email> --password <password>',
      '     または COGNITO_EMAIL / COGNITO_PASSWORD 環境変数',
    ].join('\n'))
    process.exit(1)
  }

  if (!CLIENT_ID) {
    console.error('Error: VITE_COGNITO_CLIENT_ID が設定されていません')
    process.exit(1)
  }

  try {
    console.log(`Cognito 認証中 (${email})...`)
    idToken = await fetchCognitoToken(CLIENT_ID, email, password, REGION)
    console.log('認証成功\n')
  } catch (e) {
    console.error('Error: Cognito 認証失敗:', e.message)
    process.exit(1)
  }
}

// ─── カテゴリ ────────────────────────────────────────────────────────
const categories = {}
for (const cat of CATS) {
  const v = args[cat] ?? VERDICT
  if (!VERDICTS.includes(v)) {
    console.error(`Error: --${cat} は PASS / WARN / FAIL のいずれかを指定してください`)
    process.exit(1)
  }
  categories[cat] = v
}

// ─── STRIDE ─────────────────────────────────────────────────────────
const strideKeys = {
  's': 'spoofing',
  't': 'tampering',
  'r': 'repudiation',
  'i': 'informationDisclosure',
  'd': 'denialOfService',
  'e': 'elevationOfPrivilege',
}

let stride
const strideArgs = Object.entries(strideKeys)
  .filter(([k]) => args[`stride-${k}`])

if (strideArgs.length > 0) {
  stride = {}
  for (const [k, fullKey] of Object.entries(strideKeys)) {
    const v = args[`stride-${k}`] ?? 'NONE'
    if (!RISKS.includes(v.toUpperCase())) {
      console.error(`Error: --stride-${k} は NONE / LOW / MEDIUM / HIGH のいずれかを指定してください`)
      process.exit(1)
    }
    stride[fullKey] = v.toUpperCase()
  }
}

// ─── 送信 ───────────────────────────────────────────────────────────
const body = {
  repo: REPO,
  prNumber: PR_NUMBER,
  prTitle: PR_TITLE,
  prAuthor: PR_AUTHOR,
  verdict: VERDICT,
  categories,
  issues: [],
  reviewComment: COMMENT,
  ...(stride ? { stride } : {}),
}

console.log('送信データ:')
console.log(JSON.stringify(body, null, 2))
console.log()

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
  console.log(`✅ 保存完了: ${data.sk}`)
  console.log(`ダッシュボード: http://localhost:5173/`)
} else {
  console.error(`❌ エラー (${res.status}):`, data)
  process.exit(1)
}
