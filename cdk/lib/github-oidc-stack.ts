import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { NagSuppressions } from 'cdk-nag'
import { Construct } from 'constructs'

export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const githubOwner = this.node.tryGetContext('githubOwner') ?? 'YOUR_GITHUB_USERNAME'
    const githubRepo  = this.node.tryGetContext('githubRepo')  ?? 'secure-spa'

    // GitHub Actions 用 OIDC プロバイダー（アカウントに 1 つだけ作成）
    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })

    // GitHub Actions が assume する CDK デプロイロール
    const deployRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      roleName: 'github-actions-cdk-deploy-role',
      assumedBy: new iam.WebIdentityPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${githubOwner}/${githubRepo}:*`,
          },
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
        }
      ),
      description: 'IAM Role for GitHub Actions to deploy via CDK (OIDC)',
    })

    // CDK bootstrap が作成したロール群を assume する権限のみ付与（最小権限）
    // cdk-* ワイルドカードは CDK qualifier が可変のため必要
    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AssumeBootstrapRoles',
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: [
        `arn:aws:iam::${this.account}:role/cdk-*-deploy-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-*-file-publishing-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-*-image-publishing-role-${this.account}-${this.region}`,
        `arn:aws:iam::${this.account}:role/cdk-*-lookup-role-${this.account}-${this.region}`,
      ],
    }))

    // cdk-nag: cdk-* ワイルドカードは CDK bootstrap ロールの命名規則上必要
    NagSuppressions.addResourceSuppressions(deployRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'CDK bootstrap ロールは qualifier が可変のため cdk-* パターンが必要',
      },
    ], true)

    // ─── Outputs ─────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description: 'GitHub Secrets の AWS_CDK_ROLE_ARN に設定する IAM ロール ARN',
    })
  }
}
