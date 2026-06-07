# セキュリティガイダンス詳細（Vue 3 / TypeScript / AWS SPA）

このファイルは Claude Code がセキュリティレビューを行う際の詳細チェックリストと脅威モデルを定義する。

---

## 脅威モデル（STRIDE）

### 対象アーキテクチャ
```
GitHub Pages（Vue SPA ビルドファイル）
  ↓ HTTPS（GitHub 自動）
Lambda Function URL（BFF）
  ↓ IAM ロール（最小権限）
Cognito / DynamoDB / Secrets Manager
```

### 信頼境界
1. **ブラウザ ↔ Lambda Function URL**: 外部ユーザーからの入力はすべて不信頼
2. **Lambda ↔ AWS サービス**: IAM ロールで最小権限制御
3. **GitHub Pages ↔ Lambda**: CORS で GitHub Pages オリジンのみ許可

### STRIDE 分析

| 脅威 | 内容 | 対策 |
|------|------|------|
| **S**poofing（なりすまし） | Cognito トークン偽造、CSRF | JWT 検証（Lambda）、SameSite Cookie |
| **T**ampering（改ざん） | API リクエスト・レスポンス改ざん | HTTPS 強制、リクエスト署名 |
| **R**epudiation（否認） | 操作ログの欠如 | CloudTrail、Lambda ログ、監査証跡 |
| **I**nformation Disclosure（情報漏洩） | シークレット漏洩、過剰なエラー情報 | BFF パターン、エラーメッセージの抽象化 |
| **D**enial of Service（DoS） | Lambda 大量起動 | Reserved Concurrency でレートを制限 |
| **E**levation of Privilege（権限昇格） | 認可バイパス、IDOR | 全エンドポイントの認可チェック、RBAC |

---

## カテゴリ別チェックリスト

### XSS / テンプレートインジェクション

```
✅ v-html は DOMPurify.sanitize() を通してから使用している
✅ {{ }} 構文（自動エスケープ）を優先している
✅ eval() / innerHTML の直接使用がない
✅ URL に javascript: スキームが混入していない
✅ CSP が index.html の <meta> タグで設定されている
```

**安全なパターン:**
```vue
<!-- OK: Vue の自動エスケープ -->
<p>{{ userInput }}</p>

<!-- OK: サニタイズ済み -->
<div v-html="DOMPurify.sanitize(richText)"></div>

<!-- NG: 未サニタイズ -->
<div v-html="userInput"></div>
```

---

### 認証・認可

```
✅ JWT の署名検証は Lambda（サーバーサイド）で行っている
✅ JWT の有効期限（exp）を検証している
✅ 全 API エンドポイントに認可ミドルウェアがある
✅ 認証不要エンドポイントに // PUBLIC: コメントがある
✅ IDOR（直接オブジェクト参照）の防止: リソース所有者チェックを実施
✅ 認証トークンは httpOnly Cookie に保存（localStorage 禁止）
✅ Cookie に Secure / SameSite=Strict を設定している
```

**安全なパターン（Lambda 認可）:**
```typescript
// OK: Lambda オーソライザーで JWT 検証
const verifyToken = async (token: string): Promise<CognitoUser> => {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: process.env.USER_POOL_ID!,
    tokenUse: 'access',
    clientId: process.env.CLIENT_ID!,
  })
  return await verifier.verify(token)
}
```

---

### シークレット管理

```
✅ ソースコードにシークレットがハードコードされていない
✅ VITE_ 環境変数にシークレットが含まれていない
✅ .env ファイルが .gitignore に含まれている
✅ Lambda は Secrets Manager から実行時にシークレットを取得している
✅ console.log に個人情報・認証情報が出力されていない
✅ エラーメッセージに内部情報（スタックトレース・DBスキーマ等）が露出していない
```

**安全なパターン（Secrets Manager 取得）:**
```typescript
// OK: Lambda 起動時に Secrets Manager から取得
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const getSecret = async (secretName: string): Promise<string> => {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION })
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }))
  return response.SecretString!
}
```

---

### TypeScript 型安全

```
✅ any 型が使われていない
✅ as unknown as T のような強制キャストがない
✅ 外部データ（API レスポンス・URL パラメータ・LocalStorage）に型バリデーションがある
✅ null / undefined の安全なハンドリングがされている（オプショナルチェーン使用）
✅ tsconfig に strict: true が設定されている
```

**安全なパターン（zod バリデーション）:**
```typescript
import { z } from 'zod'

// OK: API レスポンスを zod でバリデーション
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
})

type User = z.infer<typeof UserSchema>

const fetchUser = async (id: string): Promise<User> => {
  const response = await api.get(`/users/${id}`)
  return UserSchema.parse(response.data)  // バリデーション失敗時は例外
}
```

---

### 依存関係

```
✅ npm audit で high / critical の脆弱性がない状態を維持
✅ package-lock.json を常にコミットしている
✅ 定期的に npm outdated を確認している
✅ 使用していないパッケージを削除している
```

---

### AWS + GitHub Pages インフラ

```
✅ Lambda Function URL の CORS が GitHub Pages オリジンのみ許可している
✅ Lambda の予約済み同時実行数（Reserved Concurrency）を設定している
✅ Lambda IAM ロールは最小権限のみ
✅ Cognito に MFA を設定している（本番環境）
✅ CloudWatch でログを記録している
✅ CSP が index.html の <meta> タグで設定されている
✅ GitHub Actions のシークレットは GitHub Secrets で管理している
✅ GitHub Pages で HTTPS が有効になっている（自動）
```

**Lambda Function URL の CORS 設定（CDK）:**
```typescript
const fnUrl = fn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['https://your-username.github.io'],  // * は絶対禁止
    allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
    allowCredentials: true,
  },
})
```

**CSP meta タグ（index.html）:**
```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self';
           script-src 'self';
           style-src 'self' 'unsafe-inline';
           img-src 'self' data:;
           connect-src 'self'
             https://*.lambda-url.*.on.aws
             https://cognito-idp.*.amazonaws.com;
           frame-src 'none';
           object-src 'none';">
```

**Lambda Reserved Concurrency（CDK）:**
```typescript
const fn = new lambda.Function(this, 'BffFunction', {
  reservedConcurrentExecutions: 10,  // 同時実行を10に制限（DoS対策）
  ...
})
```

---

## OWASP LLM Top 10（AI 駆動開発における追加リスク）

| リスク | Claude Code 使用時の注意点 |
|--------|--------------------------|
| Prompt Injection | 外部データをプロンプトに含める際はサニタイズする |
| Sensitive Info Disclosure | プロンプトに本番シークレット・個人情報を貼り付けない |
| Excessive Agency | Claude Code に本番環境への直接デプロイ権限を与えない |
| System Prompt Leakage | CLAUDE.md にシークレットを記載しない |

---

## セキュリティレビューコマンド

PR 作成前に必ず実行:
```
/sec-check
```
