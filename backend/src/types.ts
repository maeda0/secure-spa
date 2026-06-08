export type Verdict = 'PASS' | 'WARN' | 'FAIL'

export type StrideRisk = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'

export interface StrideAssessment {
  spoofing:             StrideRisk  // S: なりすまし
  tampering:            StrideRisk  // T: 改ざん
  repudiation:          StrideRisk  // R: 否認
  informationDisclosure: StrideRisk // I: 情報漏洩
  denialOfService:      StrideRisk  // D: サービス妨害
  elevationOfPrivilege: StrideRisk  // E: 権限昇格
}

export interface ReviewCategories {
  xss: Verdict
  auth: Verdict
  secrets: Verdict
  typescript: Verdict
  infra: Verdict
}

export interface ReviewIssue {
  file: string
  line: number
  message: string
  category: keyof ReviewCategories
}

// CC が PR コメントに埋め込む機械可読データ
export interface CcReviewData {
  verdict: Verdict
  categories: ReviewCategories
  issues: ReviewIssue[]
}

export interface HumanValidation {
  validatedAt: string    // ISO 8601
  validatedBy: string    // 評価者名
  truePositives: number  // CC が正しく指摘した問題数
  falsePositives: number // CC が誤って指摘した問題数
  falseNegatives: number // CC が見落とした問題数（人間が発見）
  notes: string
}

// DynamoDB に保存するレビュー記録
export interface QcReviewRecord {
  PK: string          // REPO#owner/repo-name
  SK: string          // PR#<prNumber>#<reviewedAt>
  verdict: Verdict
  categories: ReviewCategories
  issues: ReviewIssue[]
  prNumber: number
  prTitle: string
  prAuthor: string
  repoFullName: string
  reviewedAt: string  // ISO 8601
  reviewComment: string
  stride?: StrideAssessment      // 脅威モデル（任意）
  validation?: HumanValidation  // 人間による精度評価（任意）
}

// GitHub の issue_comment webhook ペイロード（必要フィールドのみ）
export interface GitHubIssueCommentPayload {
  action: string
  comment: {
    body: string
    user: { login: string }
  }
  issue: {
    number: number
    title: string
    pull_request?: { url: string }
    user: { login: string }
  }
  repository: {
    full_name: string
  }
}
