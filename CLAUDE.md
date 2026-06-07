# セキュア開発ガイドライン（Vue 3 / TypeScript / AWS SPA）

## 技術スタック
- Frontend: Vue 3 / TypeScript / TailwindCSS
- Hosting: GitHub Pages（静的ファイル配信）
- Backend: AWS Lambda Function URL（BFF）
- Auth: AWS Cognito
- DB: AWS DynamoDB
- IaC: AWS CDK（TypeScript）
- IDE: VSCode + Claude Code

## セキュリティ方針
設計段階からセキュリティを組み込む（Security by Design）原則に従う。
コードを生成・修正するときは、以下のルールを必ず守ること。
詳細は `.claude/claude-security-guidance.md` を参照。

---

## 絶対禁止

| # | 禁止事項 | リスク |
|---|---------|--------|
| 1 | `v-html` に未サニタイズのユーザー入力を渡す | XSS |
| 2 | APIキー・シークレット・パスワードをコードにハードコード | 認証情報漏洩 |
| 3 | TypeScript の `any` 型を使用する | 型安全の破壊 |
| 4 | `localStorage` / `sessionStorage` に認証トークンを保存 | XSS経由のトークン窃取 |
| 5 | Lambda Function URL の CORS に `*`（全オリジン）を許可する | 不正サイトからのAPI呼び出し |
| 6 | IAMポリシーに `"Action": "*"` または `"Resource": "*"` を付与 | 過剰権限 |
| 7 | `console.log` に個人情報・認証情報を出力する | ログ経由の情報漏洩 |
| 8 | `VITE_` 環境変数にシークレットを入れる | クライアントへの公開 |

---

## 必須事項

### フロントエンド
- 入力バリデーションはクライアント＋サーバー両方で実施（片方だけは不可）
- `v-html` を使う場合は `DOMPurify.sanitize()` を必ず通す
- 外部 API レスポンスは `zod` などで型バリデーションしてから使う
- TypeScript `strict: true` を維持する

### 認証・認可
- Cognito JWT の検証は Lambda（サーバーサイド）で行う
- 全 API エンドポイントに認可チェックを実装する
- 認証不要なエンドポイントは `// PUBLIC: <理由>` コメントを必ず付ける
- 認証トークンは httpOnly Cookie に保存する（localStorage 禁止）

### シークレット管理
- フロントエンドにシークレットを持たせない（BFF パターン使用）
- 本番環境は AWS Secrets Manager / Parameter Store を使用する
- `.env` ファイルは必ず `.gitignore` に含める

### インフラ（AWS + GitHub Pages）
- Lambda Function URL の **CORS は GitHub Pages のオリジンのみ**許可する（`*` 禁止）
- Lambda Function URL は **HTTPS 自動**（変更不可）
- Cognito JWT の検証は **Lambda 内**で実施する（フロントエンドで検証しない）
- Lambda の **予約済み同時実行数（Reserved Concurrency）** を設定してレートを制限する
- Lambda からの AWS サービスアクセスは **Secrets Manager / Parameter Store** 経由とし、コードにシークレットを持たせない
- CSP は `index.html` の **`<meta>` タグ**で設定する（GitHub Pages はHTTPヘッダーを設定できないため）
- IaC（CDK）でインフラを管理し、コンソールからの手動変更は禁止
- GitHub Actions でビルド・デプロイを自動化し、シークレットは **GitHub Secrets** で管理する

### 依存関係
- パッケージ追加時は `npm audit` で脆弱性を確認する
- high / critical レベルの脆弱性がある状態でマージしない

---

## コード生成時の必須パターン

### v-html（XSS防止）
```vue
<!-- NG -->
<div v-html="userContent"></div>

<!-- OK -->
<div v-html="DOMPurify.sanitize(userContent)"></div>
```

### 外部データの型検証
```typescript
// NG
const data: any = apiResponse

// OK
import { z } from 'zod'
const Schema = z.object({ id: z.string(), name: z.string() })
const data = Schema.parse(apiResponse)
```

### 認証トークンの保存
```typescript
// NG: localStorage はXSSで窃取される
localStorage.setItem('token', accessToken)

// OK: httpOnly Cookie（サーバーサイドでセット）
// Set-Cookie: access_token=xxx; HttpOnly; Secure; SameSite=Strict
```

### Secrets Manager からのシークレット取得
```typescript
// NG
const apiKey = process.env.THIRD_PARTY_SECRET

// OK
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
const { SecretString } = await client.send(
  new GetSecretValueCommand({ SecretId: 'prod/app/api-key' })
)
```

### IAM ポリシー（最小権限）
```json
// NG
{ "Action": "*", "Resource": "*" }

// OK
{ "Action": ["s3:GetObject"], "Resource": "arn:aws:s3:::bucket/prefix/*" }
```

---

## PR 作成前のチェック

```
/sec-check          # 変更差分のセキュリティレビューを実行
```

## 詳細ガイダンス
- セキュリティチェックリスト詳細 → `.claude/claude-security-guidance.md`
- チーム向けポリシー → `docs/security/policy.md`
- レビューチェックリスト → `docs/security/checklist.md`

---

## 組織コンテキスト（自動ロード）

@.company/research/topics/asvs-l2-tool-selection.md
@.company/research/topics/github-actions-oidc-aws.md
