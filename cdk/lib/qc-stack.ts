import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
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
      billingMode:  dynamodb.BillingMode.PROVISIONED,
      readCapacity:  5,
      writeCapacity: 5,
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

    // ─── SSM Parameter Store ─────────────────────────────────────
    // SecureString は CDK では値を設定できないため、ダミー値で作成後に手動更新する
    const webhookSecretParam = new ssm.StringParameter(this, 'WebhookSecretParam', {
      parameterName: '/qc-dashboard/github-webhook-secret',
      description: 'GitHub Webhook HMAC-SHA256 署名検証用シークレット',
      stringValue: 'PLACEHOLDER_REPLACE_AFTER_DEPLOY',
    })

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
        WEBHOOK_SECRET_PATH: webhookSecretParam.parameterName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      // 構造化ログ
      logRetention: logs.RetentionDays.ONE_MONTH,
    })

    // Lambda に必要最小限の権限のみ付与
    table.grantWriteData(webhookFn)

    webhookSecretParam.grantRead(webhookFn)

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
    const githubPagesUrl: string = this.node.tryGetContext('githubPagesUrl') ?? 'http://localhost:5173'
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

    table.grantReadWriteData(apiFn)

    // ─── API Gateway REST API ─────────────────────────────────────
    const api = new apigateway.RestApi(this, 'QcApi', {
      restApiName: 'qc-dashboard-api',
      description: 'QC Dashboard read/write API',
      deployOptions: {
        stageName: 'v1',
      },
      // OPTIONS は API Gateway の mock で処理（Lambda に到達しない）
      defaultCorsPreflightOptions: {
        allowOrigins: [allowedOrigin],
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
    })

    const apiIntegration = new apigateway.LambdaIntegration(apiFn, {
      proxy: true,
    })

    // ルートリソースに GET / POST を追加（認可なし：Cognito 追加時に更新）
    api.root.addMethod('GET', apiIntegration, { authorizationType: apigateway.AuthorizationType.NONE })
    api.root.addMethod('POST', apiIntegration, { authorizationType: apigateway.AuthorizationType.NONE })

    // ─── NagSuppressions ─────────────────────────────────────────
    NagSuppressions.addResourceSuppressions(apiFn, [
      { id: 'AwsSolutions-L1',   reason: 'Node.js 22.x is the latest runtime' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is required for Lambda logging' },
      { id: 'AwsSolutions-IAM5', reason: 'DynamoDB GSI wildcard is required for index-level access' },
    ], true)

    NagSuppressions.addResourceSuppressions(api, [
      { id: 'AwsSolutions-APIG1', reason: 'Access logging not enabled to reduce cost in research environment' },
      { id: 'AwsSolutions-APIG2', reason: 'Request validation handled in Lambda; API Gateway-level validation not required' },
      { id: 'AwsSolutions-APIG3', reason: 'WAF is attached at CloudFront level (CdnStack); regional WAF on API GW not needed' },
      { id: 'AwsSolutions-APIG6', reason: 'CloudWatch execution logging not enabled to reduce cost in research environment' },
    ], true)

    NagSuppressions.addResourceSuppressions(api.root, [
      { id: 'AwsSolutions-APIG4', reason: 'Auth will be added in Cognito integration phase (Task #6)' },
      { id: 'AwsSolutions-COG4',  reason: 'Cognito authorizer will be added in Task #6' },
    ], true)

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
      value: api.url,
      description: 'API Gateway URL（VITE_API_BASE_URL / CdnStack apiGatewayUrl に設定）',
    })

    new cdk.CfnOutput(this, 'TableName', {
      value: table.tableName,
      description: 'DynamoDB テーブル名',
    })

    new cdk.CfnOutput(this, 'WebhookSecretPath', {
      value: webhookSecretParam.parameterName,
      description: 'cdk deploy 後にここへ GitHub Webhook シークレット値を設定する',
    })
  }
}
