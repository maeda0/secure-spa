import * as cdk from 'aws-cdk-lib'
import { Aspects } from 'aws-cdk-lib'
import { AwsSolutionsChecks } from 'cdk-nag'
import { QcDashboardStack } from '../lib/qc-stack'
import { GithubOidcStack } from '../lib/github-oidc-stack'
import { CdnStack } from '../lib/cdn-stack'

const app = new cdk.App()

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
}

// CloudFront WAF は us-east-1 必須
const usEast1Env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
}

new QcDashboardStack(app, 'QcDashboardStack', { env })

// GitHub Actions が AWS にデプロイするための OIDC IAM ロール
new GithubOidcStack(app, 'GithubOidcStack', { env })

// CloudFront + WAF（us-east-1 に配置）
new CdnStack(app, 'CdnStack', { env: usEast1Env })

// cdk-nag: AWS Solutions ルールで全リソースを検証
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
