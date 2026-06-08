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
  stride: StrideAssessmentSchema.optional(),
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
