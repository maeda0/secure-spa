# secure-spa-template

Vue 3 / TypeScript / TailwindCSS / AWS SPA プロジェクト向けの**セキュア開発テンプレート**。

設計段階からセキュリティを組み込む（Security by Design / Shift Left）を実現するための設定ファイル一式。
新規プロジェクト作成時にコピーするだけで、全プロジェクトで一貫したセキュア開発フローを適用できる。

---

## 対象スタック

| 領域 | 技術 |
|------|------|
| Frontend | Vue 3 / TypeScript / TailwindCSS |
| Infrastructure | AWS（CloudFront + S3 + API Gateway + Lambda + Cognito） |
| IDE | VSCode + Claude Code |

---

## ディレクトリ構成

```
secure-spa/
├── CLAUDE.md                          # Claude Code メイン指示
├── .claude/
│   ├── claude-security-guidance.md   # 詳細セキュリティガイダンス
│   └── commands/
│       └── sec-check.md              # /sec-check カスタムコマンド
├── .cursor/
│   └── rules/
│       └── security.mdc              # Cursor セキュリティルール
├── .husky/
│   └── pre-commit                    # コミット前自動チェック
├── eslint.security.config.mjs        # ESLint セキュリティ設定
└── docs/security/
    ├── checklist.md                  # フェーズ別チェックリスト
    └── setup-guide.md                # 導入手順
```

---

## セキュリティの 4 層構造

```
Layer 1: AI指示層
  CLAUDE.md / .claude/ / .cursor/rules/
  → AIが生成するコードから問題パターンを排除

Layer 2: 静的解析層
  eslint-plugin-security / eslint-plugin-sonarjs / @typescript-eslint
  → IDE上でリアルタイムにセキュリティ問題を検出

Layer 3: フック層
  Husky + lint-staged + npm audit
  → コミット時に全員に強制チェック

Layer 4: フロー層
  docs/security/checklist.md
  → 設計〜デプロイまでフェーズ別の人間レビュー
```

---

## 主な禁止事項

| 禁止事項 | リスク |
|---------|--------|
| `v-html` に未サニタイズの入力を渡す | XSS |
| APIキー・シークレットをコードにハードコード | 認証情報漏洩 |
| TypeScript の `any` 型を使用 | 型安全の破壊 |
| `localStorage` に認証トークンを保存 | XSS経由のトークン窃取 |
| `VITE_` 環境変数にシークレットを入れる | クライアントへの公開 |
| S3 バケットをパブリックアクセス可能にする | データ漏洩 |
| IAM ポリシーに `"Action": "*"` を付与 | 過剰権限 |

---

## 導入手順

### 1. ファイルをコピー

```bash
cp -r secure-spa/. your-project/
```

### 2. 依存関係をインストール

```bash
npm install -D \
  eslint-plugin-security \
  eslint-plugin-sonarjs \
  typescript-eslint \
  husky \
  lint-staged \
  dompurify \
  @types/dompurify

npm install zod
```

### 3. package.json に追記

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx,vue,js}": ["eslint --fix", "prettier --write"],
    "*.{css,json,md}": ["prettier --write"]
  }
}
```

### 4. ESLint 設定にマージ

```js
// eslint.config.mjs
import securityConfig from './eslint.security.config.mjs'

export default [
  ...securityConfig,
  // プロジェクト固有の設定...
]
```

### 5. Husky のセットアップ

```bash
npx husky init
```

---

## 使い方

### PR 作成前のセキュリティレビュー

Claude Code で以下を実行:

```
/sec-check
```

変更差分に対してセキュリティチェックを自動実行し、問題をリストアップする。

### 設計フェーズのチェックリスト

`docs/security/checklist.md` を参照して、設計・開発・レビュー・デプロイの各フェーズで確認する。

---

## 参考リソース

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP LLM Top 10 (2025)](https://genai.owasp.org/llm-top-10/)
- [Vue.js Security Guide](https://vuejs.org/guide/best-practices/security)
- [Claude Code Security Guidance](https://code.claude.com/docs/en/security-guidance)
- [AWS CloudFront Authorization at Edge](https://github.com/aws-samples/cloudfront-authorization-at-edge)
