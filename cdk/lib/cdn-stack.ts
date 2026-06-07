import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as wafv2 from 'aws-cdk-lib/aws-wafv2'
import { NagSuppressions } from 'cdk-nag'
import { Construct } from 'constructs'

export class CdnStack extends cdk.Stack {
  public readonly distributionUrl: string

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // context から API Gateway URL を読み込む
    const apiGatewayUrl: string =
      this.node.tryGetContext('apiGatewayUrl') ??
      'https://o792vyecg9.execute-api.ap-northeast-1.amazonaws.com/v1/'

    const parsedUrl = new URL(apiGatewayUrl)
    const apiOriginDomain = parsedUrl.host
    // API Gateway の stage path (/v1) を origin path に設定
    const apiOriginPath = parsedUrl.pathname.replace(/\/$/, '') || undefined

    // ─── WAF Web ACL ─────────────────────────────────────────────
    // CloudFront 用 WAF は us-east-1 のみ作成可能（scope: CLOUDFRONT）
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'qc-dashboard-web-acl',
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'QcDashboardWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
        {
          name: 'AWSManagedRulesAmazonIpReputationList',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'IpReputationList',
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
        },
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 3,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'KnownBadInputs',
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        },
      ],
    })

    // ─── CloudFront Distribution ─────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: 'QC Dashboard API CDN with WAF',
      defaultBehavior: {
        // API Gateway をオリジンに設定（/v1 stage を origin path で指定）
        origin: new origins.HttpOrigin(apiOriginDomain, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originPath: apiOriginPath,
        }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // API はキャッシュ不要（常に Lambda に転送）
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Origin ヘッダーを含む全ヘッダーをオリジンに転送（CORS 動作に必要）
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        // セキュリティヘッダーを付与（CORS ヘッダーは Lambda URL がセット）
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      },
      // WAF を紐付け
      webAclId: webAcl.attrArn,
      // TLS 1.2 以上を強制
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    })

    this.distributionUrl = `https://${distribution.distributionDomainName}`

    // ─── Outputs ─────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.distributionUrl,
      description: 'VITE_API_BASE_URL に設定する CloudFront URL（API Gateway へのプロキシ）',
    })

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    })

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: webAcl.attrArn,
      description: 'WAF Web ACL ARN',
    })

    // ─── NagSuppressions ─────────────────────────────────────────
    NagSuppressions.addResourceSuppressions(distribution, [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Geo restriction not required for this research project',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'Access logging disabled to avoid S3 bucket cost in research environment',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason: 'Using default CloudFront certificate (no custom domain in research environment); TLS 1.2 is set but CFR4 flags default cert regardless',
      },
    ])
  }
}
