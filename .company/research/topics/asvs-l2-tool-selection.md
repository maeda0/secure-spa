# ASVS Level 2 対応ツール選定

調査日: 2026-06-06

## 目的

Vue 3 / TypeScript / AWS SPA プロジェクトで OWASP ASVS Level 2 を準拠するために必要なセキュリティ分析ツールを選定する。

---

## 選定結果サマリー（9本）

| # | カテゴリ | ツール | 役割 | 費用 |
|---|---------|--------|------|------|
| 1 | A: IDE/開発 | **ESLint Security plugins** | SAST（Vue/TS特化） | 無料（既存） |
| 2 | A: IDE/開発 | **Semgrep CE** | SAST（メイン） | 無料 |
| 3 | B: CI/CD | **CodeQL** | SAST（深度分析） | 無料（public repo） |
| 4 | B: CI/CD | **TruffleHog** | シークレットスキャン（現在のコード・認証情報を実検証） | 無料 |
| 5 | B: CI/CD | **Gitleaks** | シークレットスキャン（git履歴全体） | 無料 |
| 6 | B: CI/CD | **cdk-nag** | IaC セキュリティ | 無料 |
| 7 | C: DAST | **OWASP ZAP** | 動的テスト | 無料 |
| 8 | D: 依存関係 | **Dependabot** | 自動依存更新 | 無料（GitHub内蔵） |
| 9 | D: 依存関係 | **npm audit** | 脆弱性チェック | 無料（既存） |

---

## カテゴリ別詳細

### A: IDE / 開発時（SAST）

#### Semgrep CE（推奨メイン SAST）
- **概要**: オープンソース SAST、35以上の言語対応、CIでの中央値スキャン時間10秒
- **ASVS L2 カバー領域**:
  - V1 コーディング実践（安全でないコードパターン）
  - V5 バリデーション・サニタイズ・エンコーディング（XSS等）
  - V14 設定セキュリティ
- **VSCode統合**: Semgrep VSCode拡張（`semgrep.semgrep`）
- **カスタムルール**: YAMLで独自ルール定義可能 → Vue/TS固有パターンに対応
- **導入方法**:
  ```bash
  # CI/CD（GitHub Actions）
  - uses: semgrep/semgrep-action@v1
    with:
      config: p/typescript p/vue p/owasp-top-ten
  ```

#### ESLint Security Plugins（既存・継続）
- `eslint-plugin-security` + `eslint-plugin-sonarjs` + `@typescript-eslint`
- IDEリアルタイムフィードバック（既にテンプレートに組み込み済み）

---

### B: CI/CD（SAST + シークレット + IaC）

#### CodeQL（GitHub Actions）
- **概要**: GitHubネイティブ、OWASPベンチマークで最高F1スコア
- **ASVS L2 カバー領域**:
  - V5 インジェクション防止（SQLi, XSS, Path Traversal）
  - V6 暗号化
  - V13 API セキュリティ
- **設定方法**:
  ```yaml
  # .github/workflows/codeql.yml
  - uses: github/codeql-action/init@v3
    with:
      languages: javascript, typescript
  - uses: github/codeql-action/analyze@v3
  ```
- **注意**: public リポジトリは無料、private は GitHub Advanced Security 有償

#### TruffleHog（シークレットスキャン）
- **概要**: 800以上のシークレットタイプ検出、実際に有効かどうかを自動検証
- **ASVS L2 カバー領域**:
  - V6.4 シークレット管理（ハードコードシークレット検出）
- **導入方法**:
  ```yaml
  # .github/workflows/security.yml
  - uses: trufflesecurity/trufflehog@main
    with:
      path: ./
      base: main
      head: HEAD
  ```
- **pre-commit 統合**も可能（Gitleaks と比較して検出精度が高い）
- **スコープ**: 現在のコードのみ（git履歴はスキャンしない）

#### Gitleaks（git履歴シークレットスキャン）
- **概要**: git の全コミット履歴をスキャン。過去にコミットして後から削除したシークレットも検出
- **TruffleHogとの違い**: TruffleHogは現在のコードを検証、Gitleaksはgit履歴全体が対象
- **ASVS L2 カバー領域**:
  - V6.4 シークレット管理（履歴を含む漏洩リスク）
- **導入方法**:
  ```yaml
  # .github/workflows/security.yml
  - uses: gitleaks/gitleaks-action@v2
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- **pre-commit 統合**:
  ```bash
  # .husky/pre-commit に追加
  npx gitleaks protect --staged
  ```

#### cdk-nag（IaC セキュリティ）
- **概要**: AWS CDK ネイティブ、`cdk synth` 時にルール違反を即時検出
- **ASVS L2 カバー領域**:
  - V1.9 通信セキュリティ（HTTPS強制等）
  - V2.8 認証設定
  - V9 データ保護（暗号化）
- **対応ルールセット**: AWS Solutions, NIST 800-53, PCI DSS, HIPAA
- **導入方法**:
  ```typescript
  // cdk/app.ts
  import { Aspects } from 'aws-cdk-lib'
  import { AwsSolutionsChecks } from 'cdk-nag'
  
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
  ```
  ```bash
  npm install -D cdk-nag
  ```

---

### C: DAST（動的解析）

#### OWASP ZAP
- **概要**: OWASPが公式メンテナンス、GitHub Actions公式イメージあり
- **ASVS L2 カバー領域**:
  - V4 アクセス制御（認証バイパス）
  - V5 バリデーション（実際の入力テスト）
  - V13 API セキュリティ
  - V14 設定（セキュリティヘッダー確認）
- **実行方法**:
  ```yaml
  # .github/workflows/dast.yml
  - name: ZAP Baseline Scan
    uses: zaproxy/action-baseline@v0.12.0
    with:
      target: 'https://your-username.github.io/your-app'
  ```
- **前提**: ステージング環境または GitHub Pages デプロイ後に実行
- **スキャンモード**:
  - `action-baseline`: 受動スキャン（高速、低FP）→ PR毎
  - `action-full-scan`: 積極スキャン（低速、高検出）→ リリース前

---

### D: 依存関係管理

#### Dependabot（GitHub内蔵）
- **概要**: GitHub ネイティブ、設定ファイル1つで自動的に脆弱性PRを作成
- **ASVS L2 カバー領域**:
  - V14.2 依存関係セキュリティ
- **設定方法**:
  ```yaml
  # .github/dependabot.yml
  version: 2
  updates:
    - package-ecosystem: "npm"
      directory: "/"
      schedule:
        interval: "weekly"
      open-pull-requests-limit: 5
  ```

#### npm audit（既存・継続）
- Husky pre-commit フックに組み込み済み（`npm audit --audit-level=high`）
- ローカル開発時のガード

---

## ASVS Level 2 カバレッジマッピング

| ASVS 章 | 内容 | 対応ツール |
|---------|------|-----------|
| V1 コーディング実践 | 安全なコードパターン | Semgrep, ESLint |
| V2 認証 | JWT検証, Cookie設定 | CodeQL, ESLint, ZAP |
| V3 セッション管理 | トークン管理 | ESLint, ZAP |
| V4 アクセス制御 | 認可チェック | ZAP, CodeQL |
| V5 バリデーション | XSS, インジェクション | Semgrep, ESLint, ZAP |
| V6 暗号化 | 鍵管理, 暗号化強度 | CodeQL, cdk-nag |
| V7 エラー処理・ログ | 情報漏洩防止 | Semgrep, ESLint |
| V9 データ保護 | 転送・保存中の暗号化 | cdk-nag, ZAP |
| V13 API セキュリティ | CORS, 認証 | ZAP, ESLint |
| V14 設定 | CSP, ヘッダー | ZAP, cdk-nag, Semgrep |
| V6.4 シークレット管理 | ハードコード禁止 | TruffleHog, ESLint |
| V14.2 依存関係 | 脆弱性ライブラリ | Dependabot, npm audit |

---

## 推奨 GitHub Actions ワークフロー構成

```
.github/
├── workflows/
│   ├── ci.yml             # ビルド + ESLint + TypeScript + npm audit
│   ├── security.yml       # Semgrep + TruffleHog + CodeQL（週次）
│   ├── iac-check.yml      # cdk-nag（CDK変更時）
│   └── dast.yml           # ZAP（staging/release時）
└── dependabot.yml         # 週次依存関係チェック
```

---

## 導入優先順位

| 優先度 | ツール | 理由 |
|--------|--------|------|
| ★★★ 今すぐ | Dependabot | 設定ファイル1つ、ゼロコスト、常時効果 |
| ★★★ 今すぐ | TruffleHog | シークレット漏洩リスクを即時排除 |
| ★★★ 今すぐ | cdk-nag | CDK開発時から組み込み（コード修正が必要になる前に） |
| ★★ 次フェーズ | Semgrep CI | PR毎の自動SAST |
| ★★ 次フェーズ | CodeQL | 週次ディープスキャン |
| ★ リリース前 | OWASP ZAP | ステージング環境が必要 |

---

---

## カバレッジの現実的評価

### 「全要件をカバーできる」は条件付き

ツール + CC の組み合わせで各要件に何らかのコントロールを割り当てることは可能。
ただし「ツールが自動で全部を検出できる」は誤り。

### 自動化ツールの本質的な限界

| 課題 | 理由 |
|------|------|
| **V15 ビジネスロジック** | CCは「コードに書いてある仕様」しか評価できない。ビジネスルール自体の正しさは判断不可 |
| **プロセス要件** | ASVS L2には「設計レビューを実施したか」「脅威モデリングを文書化したか」のような人間のアクションが前提の要件がある。ツールは検証できない |
| **ZAPの前提** | デプロイされた実環境が必要。GitHub Pagesが存在しない段階ではV3/V9/V16のランタイム確認は不可能 |
| **CCの見落とし** | コンテキスト外の依存関係や複雑な状態管理でのロジックバグは見逃す可能性がある |

### ASVS準拠が主張できる条件

- **自動化ツール** → コードレベルの違反を継続的に検知する体制がある
- **CC + `/sec-check`** → PRごとに人間的判断を加える
- **チェックリスト（`docs/security/checklist.md`）** → プロセス要件を人間が確認する

この3つを組み合わせると「ASVS L2準拠を主張できる根拠が揃う」。
**ツール単独では全カバーは不可能。**

---

## 参考

- [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/)
- [Semgrep Rules for Vue/TypeScript](https://semgrep.dev/r?q=vue%2Ctypescript)
- [cdk-nag ルール一覧](https://github.com/cdklabs/cdk-nag/blob/main/RULES.md)
- [OWASP ZAP GitHub Action](https://github.com/zaproxy/action-baseline)
- [TruffleHog GitHub Action](https://github.com/trufflesecurity/trufflehog)
