# セキュリティチェックリスト（Vue 3 / TypeScript / AWS SPA）

開発フローの各フェーズで確認するチェックリスト。

---

## Phase 1: 設計段階（コードを書く前）

### 脅威モデリング
- [ ] STRIDE を使って主要コンポーネントの脅威を列挙した
- [ ] 信頼境界（ブラウザ ↔ Lambda Function URL）を図に示した
- [ ] 認証が必要なエンドポイントをすべて洗い出した
- [ ] 機密データの流れを特定した（どこで作られ、どこに保存され、誰がアクセスできるか）

### アーキテクチャ
- [ ] フロントエンドにシークレットを持たせない設計になっているか（BFF パターン）
- [ ] 認証トークンの保存場所を決めた（httpOnly Cookie 推奨）
- [ ] Lambda IAM 権限設計が最小権限になっているか
- [ ] Lambda Function URL の CORS 許可オリジンを GitHub Pages に限定した

---

## Phase 2: 開発中

### フロントエンド（Vue / TypeScript）
- [ ] `v-html` を使う箇所は DOMPurify でサニタイズしている
- [ ] 外部データ（API レスポンス・URL パラメータ）は zod でバリデーション済み
- [ ] `any` 型を使っていない
- [ ] `localStorage` / `sessionStorage` に認証トークンを保存していない
- [ ] `console.log` に個人情報・認証情報を出力していない
- [ ] `VITE_` 環境変数にシークレットを入れていない
- [ ] TypeScript `strict: true` を維持している

### バックエンド（Lambda）
- [ ] JWT の署名・有効期限を検証している
- [ ] すべての API エンドポイントに認可チェックがある
- [ ] 認証不要なエンドポイントに `// PUBLIC:` コメントがある
- [ ] シークレットは Secrets Manager から取得している（ハードコード禁止）
- [ ] エラーレスポンスに内部情報が含まれていない（スタックトレース等）
- [ ] IDOR 対策: リソース所有者チェックを実施している

### インフラ（AWS + GitHub Pages / IaC）
- [ ] Lambda Function URL の CORS が GitHub Pages オリジンのみ許可している（`*` でない）
- [ ] Lambda の Reserved Concurrency（予約済み同時実行数）を設定している
- [ ] Lambda IAM ロールが最小権限
- [ ] CloudWatch でログを記録している
- [ ] CSP が `index.html` の `<meta>` タグで設定されている
- [ ] GitHub Pages で HTTPS が有効になっている（デフォルトで有効）
- [ ] GitHub Actions のシークレットは GitHub Secrets で管理している

---

## Phase 3: PR レビュー前

### 自動チェック
- [ ] `npm audit` で high / critical の脆弱性がないこと
- [ ] TypeScript コンパイルエラーがないこと（`tsc --noEmit`）
- [ ] ESLint のセキュリティルールが通っていること
- [ ] `/sec-check` を実行して問題がないこと

### コードレビュー観点
- [ ] 新しいシークレットがコードに含まれていないか（`git diff` で確認）
- [ ] 新しい依存関係のライセンスと脆弱性を確認した
- [ ] 認可ロジックに漏れがないか
- [ ] エラーハンドリングが適切か（機密情報を露出していないか）

---

## Phase 4: デプロイ前（本番）

- [ ] `.env.production` に本番シークレットが入っていないことを確認
- [ ] Secrets Manager / Parameter Store に本番シークレットが正しく設定されている
- [ ] CloudFront のキャッシュ設定で機密レスポンスがキャッシュされていないか
- [ ] Cognito の MFA が有効になっているか
- [ ] CloudWatch アラームが設定されているか（異常なリクエスト数等）
- [ ] WAF のレートリミット値が適切か
- [ ] デプロイ後に `npm audit` を再実行する

---

## インシデント発生時の初動

1. 影響範囲の特定（CloudTrail / CloudWatch ログを確認）
2. 漏洩したシークレットがある場合は即時ローテーション（Secrets Manager）
3. 必要に応じて Cognito ユーザーのセッションを無効化
4. WAF ルールで攻撃元 IP をブロック
5. 事後分析と再発防止策の策定

---

## 参考リソース
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP LLM Top 10 (2025)](https://genai.owasp.org/llm-top-10/)
- [Vue.js Security Guide](https://vuejs.org/guide/best-practices/security)
- [AWS Security Best Practices](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [CloudFront Authorization at Edge](https://github.com/aws-samples/cloudfront-authorization-at-edge)
