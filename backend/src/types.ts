export type Verdict = 'PASS' | 'WARN' | 'FAIL'

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
