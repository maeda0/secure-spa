import { ref, computed, watch } from 'vue'
import { z } from 'zod'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL as string

const authHeaders = (): HeadersInit => {
  const auth = useAuthStore()
  return auth.idToken ? { Authorization: `Bearer ${auth.idToken}` } : {}
}

// ─── zod スキーマ（外部データのバリデーション）────────────────────

const VerdictSchema    = z.enum(['PASS', 'WARN', 'FAIL'])
const StrideRiskSchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH'])

const StrideAssessmentSchema = z.object({
  spoofing:              StrideRiskSchema,
  tampering:             StrideRiskSchema,
  repudiation:           StrideRiskSchema,
  informationDisclosure: StrideRiskSchema,
  denialOfService:       StrideRiskSchema,
  elevationOfPrivilege:  StrideRiskSchema,
})

const ReviewIssueSchema = z.object({
  file: z.string(),
  line: z.number(),
  message: z.string(),
  category: z.string(),
})

const HumanValidationSchema = z.object({
  validatedAt:    z.string(),
  validatedBy:    z.string(),
  truePositives:  z.number(),
  falsePositives: z.number(),
  falseNegatives: z.number(),
  notes:          z.string(),
})

const ReviewRecordSchema = z.object({
  PK: z.string(),
  SK: z.string(),
  verdict: VerdictSchema,
  categories: z.object({
    xss:        VerdictSchema,
    auth:       VerdictSchema,
    secrets:    VerdictSchema,
    typescript: VerdictSchema,
    infra:      VerdictSchema,
  }),
  issues: z.array(ReviewIssueSchema),
  prNumber: z.number(),
  prTitle: z.string(),
  prAuthor: z.string(),
  repoFullName: z.string(),
  reviewedAt: z.string(),
  stride:        StrideAssessmentSchema.optional(),
  validation:    HumanValidationSchema.optional(),
  phase:         z.enum(['before', 'after']).optional(),
  reviewMinutes: z.number().optional(),
})

const ReviewsResponseSchema = z.object({
  reviews: z.array(ReviewRecordSchema),
  total: z.number(),
})

const CategoryStatsSchema = z.object({
  PASS: z.number(),
  WARN: z.number(),
  FAIL: z.number(),
})

const StatsResponseSchema = z.object({
  total: z.number(),
  verdicts: z.object({ PASS: z.number(), WARN: z.number(), FAIL: z.number() }),
  categories: z.record(CategoryStatsSchema),
  passRate: z.number(),
})

export type ReviewRecord      = z.infer<typeof ReviewRecordSchema>
export type StatsResponse     = z.infer<typeof StatsResponseSchema>
export type StrideAssessment  = z.infer<typeof StrideAssessmentSchema>
export type StrideRisk        = z.infer<typeof StrideRiskSchema>
export type HumanValidation   = z.infer<typeof HumanValidationSchema>

// ─── 精度集計 ─────────────────────────────────────────────────────────

export interface AccuracyMetrics {
  count: number
  totalTP: number
  totalFP: number
  totalFN: number
  precision: number  // 0–100
  recall: number     // 0–100
  f1: number         // 0–100
}

// ─── Before/After 比較 ───────────────────────────────────────────────

export interface PhaseStats {
  count: number
  passRate: number
  avgMinutes: number | null
  failCount: number
  warnCount: number
}

export interface BeforeAfterComparison {
  before: PhaseStats
  after: PhaseStats
  passRateDelta: number    // after - before（ポイント差）
  timeDelta: number | null // after - before（分差、負なら短縮）
}

const calcPhaseStats = (reviews: ReviewRecord[]): PhaseStats => {
  const n = reviews.length
  if (n === 0) return { count: 0, passRate: 0, avgMinutes: null, failCount: 0, warnCount: 0 }
  const pass = reviews.filter(r => r.verdict === 'PASS').length
  const timed = reviews.filter(r => r.reviewMinutes !== undefined)
  return {
    count: n,
    passRate: Math.round(pass / n * 100),
    avgMinutes: timed.length > 0
      ? Math.round(timed.reduce((s, r) => s + r.reviewMinutes!, 0) / timed.length)
      : null,
    failCount: reviews.filter(r => r.verdict === 'FAIL').length,
    warnCount: reviews.filter(r => r.verdict === 'WARN').length,
  }
}

export const calcBeforeAfter = (reviews: ReviewRecord[]): BeforeAfterComparison | null => {
  const before = reviews.filter(r => r.phase === 'before')
  const after  = reviews.filter(r => r.phase === 'after')
  if (before.length === 0 && after.length === 0) return null

  const bs = calcPhaseStats(before)
  const as_ = calcPhaseStats(after)
  const timeDelta = bs.avgMinutes !== null && as_.avgMinutes !== null
    ? as_.avgMinutes - bs.avgMinutes
    : null

  return {
    before: bs,
    after: as_,
    passRateDelta: as_.passRate - bs.passRate,
    timeDelta,
  }
}

export const calcAccuracy = (reviews: ReviewRecord[]): AccuracyMetrics | null => {
  const validated = reviews.filter(r => r.validation)
  if (validated.length === 0) return null

  const totalTP = validated.reduce((s, r) => s + r.validation!.truePositives, 0)
  const totalFP = validated.reduce((s, r) => s + r.validation!.falsePositives, 0)
  const totalFN = validated.reduce((s, r) => s + r.validation!.falseNegatives, 0)

  const precision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0
  const recall    = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0
  const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0

  return {
    count: validated.length,
    totalTP,
    totalFP,
    totalFN,
    precision: Math.round(precision * 100),
    recall:    Math.round(recall * 100),
    f1:        Math.round(f1 * 100),
  }
}

// ─── 最新レビュー一覧 ─────────────────────────────────────────────

export const useReviews = (limit = 20) => {
  const ui = useUiStore()
  const reviews = ref<ReviewRecord[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetch = async () => {
    if (!ui.selectedRepo) return
    loading.value = true
    error.value = null
    try {
      const res = await window.fetch(
        `${API_BASE}?repo=${encodeURIComponent(ui.selectedRepo)}&limit=${limit}`,
        { headers: authHeaders() }
      )
      if (!res.ok) throw new Error('fetch failed')
      const data = ReviewsResponseSchema.parse(await res.json())
      reviews.value = data.reviews
      total.value = data.total
    } catch {
      error.value = 'データの取得に失敗しました'
    } finally {
      loading.value = false
    }
  }

  watch(() => ui.selectedRepo, fetch, { immediate: true })

  return { reviews, total, loading, error, refresh: fetch }
}

// ─── 統計情報 ─────────────────────────────────────────────────────

export const useStats = () => {
  const ui = useUiStore()
  const stats = ref<StatsResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetch = async () => {
    if (!ui.selectedRepo) return
    loading.value = true
    error.value = null
    try {
      const res = await window.fetch(
        `${API_BASE}?repo=${encodeURIComponent(ui.selectedRepo)}&action=stats`,
        { headers: authHeaders() }
      )
      if (!res.ok) throw new Error('fetch failed')
      stats.value = StatsResponseSchema.parse(await res.json())
    } catch {
      error.value = 'データの取得に失敗しました'
    } finally {
      loading.value = false
    }
  }

  watch(() => ui.selectedRepo, fetch, { immediate: true })

  return { stats, loading, error, refresh: fetch }
}

// ─── ユーティリティ ───────────────────────────────────────────────

export const verdictColor = (v: string) => {
  if (v === 'PASS') return 'text-green-600 bg-green-50'
  if (v === 'WARN') return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

export const verdictLabel = (v: string) => {
  if (v === 'PASS') return '✅ PASS'
  if (v === 'WARN') return '⚠️ WARN'
  return '❌ FAIL'
}
