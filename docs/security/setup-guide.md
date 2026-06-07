# セキュアテンプレート 導入手順

## 1. ファイルのコピー

新規プロジェクトのルートに以下をコピーする:

```
CLAUDE.md
.claude/
.cursor/
.husky/
docs/
eslint.security.config.mjs
```

## 2. 依存関係のインストール

```bash
npm install -D \
  eslint-plugin-security \
  eslint-plugin-sonarjs \
  typescript-eslint \
  husky \
  lint-staged \
  dompurify \
  @types/dompurify

npm install \
  zod
```

## 3. package.json に追記

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,vue,js}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{css,json,md}": [
      "prettier --write"
    ]
  }
}
```

## 4. ESLint 設定にマージ

```js
// eslint.config.mjs
import securityConfig from './eslint.security.config.mjs'

export default [
  ...securityConfig,
  // プロジェクト固有の設定...
]
```

## 5. Husky のセットアップ

```bash
npx husky init
# .husky/pre-commit は上書き済みなので不要
```

## 6. tsconfig.json の確認

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

## 7. CloudFront CSP ヘッダーの設定（IaC）

CloudFormation / CDK で ResponseHeadersPolicy を設定:

```yaml
ResponseHeadersPolicy:
  ResponseHeadersPolicyConfig:
    Name: SecurityHeaders
    SecurityHeadersConfig:
      ContentSecurityPolicy:
        ContentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://cognito-idp.*.amazonaws.com; frame-src 'none'; object-src 'none';"
        Override: true
      StrictTransportSecurity:
        AccessControlMaxAgeSec: 31536000
        IncludeSubdomains: true
        Override: true
      XContentTypeOptions:
        Override: true
      XFrameOptions:
        FrameOption: DENY
        Override: true
```
