#!/usr/bin/env node
/**
 * CC レビュー結果を DynamoDB に記録するスクリプト
 *
 * 使い方:
 *   node scripts/post-review.mjs \
 *     --pr 42 \
 *     --title "feat: add login" \
 *     --verdict PASS \
 *     --xss PASS --auth WARN --secrets PASS --typescript PASS --infra PASS \
 *     --comment "認証のセッション管理に懸念あり"
 *
 * 環境変数:
 *   VITE_API_BASE_URL  (frontend/.env.local から自動読み込み)
 *   VITE_DEFAULT_REPO  (同上)
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')

// frontend/.env.local から環境変数を読み込む
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

// CLI 引数をパース
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

const env = loadEnv()
const args = parseArgs(process.argv.slice(2))

const API_BASE = env.VITE_API_BASE_URL
const REPO = args.repo ?? env.VITE_DEFAULT_REPO
const PR_NUMBER = Number(args.pr)
const PR_TITLE = args.title ?? `PR #${PR_NUMBER}`
const PR_AUTHOR = args.author ?? process.env.USERNAME ?? 'maeda0'
const VERDICT = args.verdict ?? 'PASS'
const COMMENT = args.comment ?? ''

const VERDICTS = ['PASS', 'WARN', 'FAIL']
const CATS = ['xss', 'auth', 'secrets', 'typescript', 'infra']

if (!API_BASE) {
  console.error('Error: VITE_API_BASE_URL が設定されていません (frontend/.env.local を確認)')
  process.exit(1)
}
if (!REPO || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
  console.error(`Error: --repo または VITE_DEFAULT_REPO が必要です (例: maeda0/secure-spa)`)
  process.exit(1)
}
if (!PR_NUMBER || PR_NUMBER < 1) {
  console.error('Error: --pr <PR番号> が必要です')
  process.exit(1)
}
if (!VERDICTS.includes(VERDICT)) {
  console.error(`Error: --verdict は PASS / WARN / FAIL のいずれかを指定してください`)
  process.exit(1)
}

const categories = {}
for (const cat of CATS) {
  const v = args[cat] ?? VERDICT
  if (!VERDICTS.includes(v)) {
    console.error(`Error: --${cat} は PASS / WARN / FAIL のいずれかを指定してください`)
    process.exit(1)
  }
  categories[cat] = v
}

const body = {
  repo: REPO,
  prNumber: PR_NUMBER,
  prTitle: PR_TITLE,
  prAuthor: PR_AUTHOR,
  verdict: VERDICT,
  categories,
  issues: [],
  reviewComment: COMMENT,
}

console.log('送信データ:')
console.log(JSON.stringify(body, null, 2))
console.log()

const res = await fetch(API_BASE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
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
