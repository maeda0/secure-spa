import * as cdk from 'aws-cdk-lib'
import { Aspects } from 'aws-cdk-lib'
import { AwsSolutionsChecks } from 'cdk-nag'
import { QcDashboardStack } from '../lib/qc-stack'
import { GithubOidcStack } from '../lib/github-oidc-stack'

const app = new cdk.App()

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
}

new QcDashboardStack(app, 'QcDashboardStack', { env })

// GitHub Actions が AWS にデプロイするための OIDC IAM ロール
// 初回のみ手動で cdk deploy --app ... GithubOidcStack を実行する
new GithubOidcStack(app, 'GithubOidcStack', { env })

// cdk-nag: AWS Solutions ルールで全リソースを検証
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
