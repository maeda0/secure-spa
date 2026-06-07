import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as logs from 'aws-cdk-lib/aws-logs'
import { NagSuppressions } from 'cdk-nag'
import { Construct } from 'constructs'

export class QcDashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ─── DynamoDB ───────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'QcReviews', {
      tableName: 'qc-reviews',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode:  dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption:   dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // GSI: verdict別クエリ用
    table.addGlobalSecondaryIndex({
      indexName: 'verdict-index',
      partitionKey: { name: 'verdict', type: dynamodb.AttributeType.STRING },
      sortKey:      { name: 'reviewedAt', type: dynamodb.AttributeType.STRING },
    })

    // ─── Secrets Manager ────────────────────────────────────────
    // CDK が自動作成。cdk deploy 後に AWS コンソールで値を設定する
    const webhookSecret = new secretsmanager.Secret(this, 'GitHubWebhookSecret', {
      secretName: 'qc-dashboard/github-webhook-secret',
      description: 'GitHub Webhook HMAC-SHA256 署名検証用シークレット',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    NagSuppressions.addResourceSuppressions(webhookSecret, [
      {
        id: 'AwsSolutions-SMG4',
        reason: 'Webhook シークレットはローテーション不要（手動で設定する静的値）',
      },
    ])

    // ─── Lambda ─────────────────────────────────────────────────
    const webhookFn = new lambda.Function(this, 'WebhookHandler', {
      functionName: 'qc-webhook-handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'webhook.handler',
      code: lambda.Code.fromAsset('../backend/dist'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        WEBHOOK_SECRET_NAME: webhookSecret.secretName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      // 構造化ログ
      logRetention: logs.RetentionDays.ONE_MONTH,
    })

    // Lambda に必要最小限の権限のみ付与
    table.grantWriteData(webhookFn)

    webhookSecret.grantRead(webhookFn)

    // ─── Lambda Function URL ─────────────────────────────────────
    const fnUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      // Webhook は GitHub サーバーからの呼び出し（CORS 不要）
      cors: {
        allowedOrigins: ['https://github.com'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: [
          'Content-Type',
          'X-Hub-Signature-256',
          'X-GitHub-Event',
          'X-GitHub-Delivery',
        ],
      },
    })

    NagSuppressions.addResourceSuppressions(webhookFn, [
      { id: 'AwsSolutions-L1',    reason: 'Node.js 22.x is the latest runtime' },
      { id: 'AwsSolutions-IAM4',  reason: 'AWSLambdaBasicExecutionRole is required for Lambda logging' },
      { id: 'AwsSolutions-IAM5',  reason: 'DynamoDB GSI wildcard is required for index-level access' },
    ], true)
    NagSuppressions.addResourceSuppressions(fnUrl, [
      {
        id: 'AwsSolutions-FU1',
        reason: 'GitHub Webhook cannot use IAM auth; validated via HMAC-SHA256 signature',
      },
    ])

    // ─── 読み取り API Lambda ──────────────────────────────────────
    // GitHub Pages の URL（デプロイ後に実際の URL に変更する）
    // CORS origin must be scheme+host only (no path); derive it from the full Pages URL
    const githubPagesUrl: string = this.node.tryGetContext('githubPagesUrl') ?? 'https://YOUR_USERNAME.github.io'
    let allowedOrigin: string
    try {
      allowedOrigin = new URL(githubPagesUrl).origin
    } catch {
      allowedOrigin = githubPagesUrl
    }

    const apiFn = new lambda.Function(this, 'ApiHandler', {
      functionName: 'qc-api-handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'api.handler',
      code: lambda.Code.fromAsset('../backend/dist'),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: allowedOrigin,
        NODE_OPTIONS: '--enable-source-maps',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    })

    table.grantReadData(apiFn)

    const apiUrl = apiFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        // ★ GitHub Pages オリジンのみ許可（* 禁止）
        allowedOrigins: [allowedOrigin],
        allowedMethods: [lambda.HttpMethod.GET],
        allowedHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
    })

    NagSuppressions.addResourceSuppressions(apiFn, [
      { id: 'AwsSolutions-L1',   reason: 'Node.js 22.x is the latest runtime' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is required for Lambda logging' },
      { id: 'AwsSolutions-IAM5', reason: 'DynamoDB GSI wildcard is required for index-level access' },
    ], true)
    NagSuppressions.addResourceSuppressions(apiUrl, [
      {
        id: 'AwsSolutions-FU1',
        reason: 'Read-only API; CORS restricted to GitHub Pages origin only',
      },
    ])

    // CDK 内部の LogRetention Lambda（logRetention prop が自動生成）の抑制
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole on CDK-managed LogRetention Lambda is unavoidable' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard on CDK-managed LogRetention Lambda is unavoidable' },
    ])

    // ─── Outputs ─────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: fnUrl.url,
      description: 'GitHub Webhook に登録する URL',
    })

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: apiUrl.url,
      description: 'フロントエンドが呼び出す API URL（VITE_API_BASE_URL に設定）',
    })

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB テーブル名',
    })

    new cdk.CfnOutput(this, 'WebhookSecretArn', {
      value: webhookSecret.secretArn,
      description: 'cdk deploy 後にここへ GitHub Webhook シークレット値を設定する',
    })
  }
}
