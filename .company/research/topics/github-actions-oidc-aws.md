# GitHub Actions OIDC × AWS 認証設計

調査日: 2026-06-07

## 目的

GitHub Actions から AWS へアクセスする際に、長期間有効な認証情報（Access Key）を
GitHub Secrets に保存せず、OIDC（OpenID Connect）で一時的な認証情報を取得する仕組みを設計する。

---

## OIDC とは何か・なぜ使うか

### 従来方式（Access Key）の問題
```
GitHub Secrets に保存
  → AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY（無期限有効）
  → 漏洩したら即座に悪用可能
  → 定期ローテーションが必要（忘れがち）
```

### OIDC 方式
```
ワークフロー実行ごとに
  1. GitHub が JWT（JSON Web Token）を発行（有効期限あり）
  2. AWS STS に提示 → 一時的な認証情報を返す（最大1時間）
  3. ワークフロー終了後に自動失効
```

**メリット**: シークレット不要、自動失効、誰がいつアクセスしたか追跡可能

---

## 仕組み（全体フロー）

```
GitHub Actions Workflow
  1. id-token: write 権限でJWTを取得
       ↓
  2. aws-actions/configure-aws-credentials が
     sts:AssumeRoleWithWebIdentity を呼び出す
       ↓
  3. AWS IAM が Trust Policy の条件を検証
     - GitHubのOIDCプロバイダーのJWTか？
     - 許可されたリポジトリ・ブランチか？
       ↓
  4. 一時認証情報（最大1時間）を返す
       ↓
  5. cdk deploy / lambda update など実行
```

---

## AWS 側のセットアップ（CDK）

### Step 1: OIDC プロバイダーの登録

`OidcProviderNative` を使う（Lambda不要のネイティブ CloudFormation リソース）。

```typescript
// cdk/lib/github-oidc-stack.ts
import { Stack, StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

export class GitHubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // GitHub の OIDC プロバイダー（アカウント内に1つだけ作る）
    const provider = new iam.OidcProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })

    // CDK デプロイ用 IAM ロール
    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          // ★ main ブランチからのみ assume 可能（正確な一致）
          'token.actions.githubusercontent.com:sub':
            'repo:YOUR_GITHUB_USERNAME/YOUR_REPO_NAME:ref:refs/heads/main',
        },
      }),
      roleName: 'GitHubActionsDeployRole',
      maxSessionDuration: cdk.Duration.hours(1),
    })

    // CDK デプロイに必要な最小権限（実際はさらに絞る）
    deployRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('PowerUserAccess')
    )
    // IAM操作（CDKが必要）は別途付与
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['iam:*'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'iam:ResourceTag/ManagedBy': 'cdk',
        },
      },
    }))
  }
}
```

---

## IAM Trust Policy の条件設定（重要）

### NG パターン（ワイルドカード）

```json
// NG: main* はブランチ名 "main-hacked" でも通過してしまう
"token.actions.githubusercontent.com:sub": "repo:owner/repo:ref:refs/heads/main*"
```

### OK パターン（完全一致）

```json
// OK: main ブランチのみ
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub":
      "repo:YOUR_USERNAME/YOUR_REPO:ref:refs/heads/main"
  }
}
```

### 複数ブランチを許可する場合

```json
// OK: StringLike + 完全なブランチ名パターン
{
  "StringLike": {
    "token.actions.githubusercontent.com:sub": [
      "repo:YOUR_USERNAME/YOUR_REPO:ref:refs/heads/main",
      "repo:YOUR_USERNAME/YOUR_REPO:ref:refs/heads/develop"
    ]
  }
}
```

---

## GitHub Actions ワークフロー側の設定

### 必須: `permissions` ブロック

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # OIDC JWT の取得に必須
      contents: read    # コードのチェックアウトに必要
```

### AWS 認証ステップ

```yaml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/GitHubActionsDeployRole
    aws-region: ap-northeast-1
    role-session-name: GitHubActions-${{ github.run_id }}
```

**注意**: `AWS_ACCOUNT_ID` はシークレットではなく Variable（公開情報）で問題ない。
ロールARNをそのまま書いても可。

---

## このプロジェクトで必要なロール設計

| ロール | 用途 | ブランチ制限 | 権限 |
|--------|------|------------|------|
| `GitHubActionsDeployRole` | `cdk deploy`（Lambda/Cognito/DynamoDB作成・更新） | `main` のみ | PowerUser + IAM(CDKタグ付き) |
| ※フロントエンドビルド | GitHub Pagesへのデプロイ | 不要 | AWS不要（GitHub内蔵） |
| ※セキュリティスキャン | Semgrep/CodeQL/ZAP | 不要 | AWS不要 |

GitHub Pages デプロイは `actions/deploy-pages` を使うため AWS 認証不要。
CDK デプロイ時のみ AWS 認証が必要。

---

## 推奨ワークフロー構成

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  # フロントエンド: AWS認証不要
  deploy-frontend:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write   # GitHub Pages OIDCに必要（GitHub内部）
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/
      - uses: actions/deploy-pages@v4

  # バックエンド: AWS OIDC認証
  deploy-backend:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/GitHubActionsDeployRole
          aws-region: ap-northeast-1
      - name: CDK deploy
        run: npx cdk deploy --require-approval never
```

---

## セキュリティ上の注意点

| 注意点 | 内容 |
|--------|------|
| **`StringEquals` を使う** | `StringLike` でワイルドカードを使うと意図しないブランチが assume できる |
| **ロールの最小権限** | CDKデプロイに `AdministratorAccess` を付けるのは過剰。必要なサービスのみ |
| **`role-session-name` を設定** | CloudTrailで「どのワークフロー実行か」が追跡可能になる |
| **Environment Protection Rules** | GitHub の Environment 機能で本番デプロイに承認フローを追加できる |
| **AWS_ACCOUNT_ID は Variable で可** | アカウントIDは公開情報に近い。Secrets を消費しなくてよい |

---

## 参考リソース

- [AWS Security Blog: Use IAM roles to connect GitHub Actions to AWS](https://aws.amazon.com/blogs/security/use-iam-roles-to-connect-github-actions-to-actions-in-aws/)
- [GitHub Docs: Configuring OIDC in Amazon Web Services](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
- [aws-cdk-github-oidc construct](https://github.com/aripalo/aws-cdk-github-oidc)
- [Datadog: IAM role can be assumed by any GitHub Action（危険なパターン解説）](https://securitylabs.datadoghq.com/cloud-security-atlas/vulnerabilities/iam-role-can-be-assumed-by-any-github-action/)
