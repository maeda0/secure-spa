<script setup lang="ts">
import { useStats, useReviews } from '@/composables/useReviews'
import ReviewCard from '@/components/ReviewCard.vue'

const { stats, loading: statsLoading } = useStats()
const { reviews, loading: reviewsLoading } = useReviews(10)

const categoryLabels: Record<string, string> = {
  xss:        'XSS / テンプレートインジェクション',
  auth:       '認証・認可',
  secrets:    'シークレット管理',
  typescript: 'TypeScript 型安全',
  infra:      'インフラ（CDK / AWS）',
}

const passRateColor = (rate: number) => {
  if (rate >= 80) return 'text-green-600'
  if (rate >= 50) return 'text-yellow-600'
  return 'text-red-600'
}

const categoryPassRate = (cat: Record<string, number>) => {
  const total = cat.PASS + cat.WARN + cat.FAIL
  return total === 0 ? 0 : Math.round((cat.PASS / total) * 100)
}
</script>

<template>
  <div class="space-y-8">
    <h1 class="text-2xl font-bold text-gray-900">ダッシュボード</h1>

    <!-- ローディング -->
    <div v-if="statsLoading" class="text-gray-500 text-sm">読み込み中...</div>

    <template v-else-if="stats">
      <!-- サマリーカード -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p class="text-3xl font-bold text-gray-900">{{ stats.total }}</p>
          <p class="text-xs text-gray-500 mt-1">レビュー総数</p>
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p :class="['text-3xl font-bold', passRateColor(stats.passRate)]">
            {{ stats.passRate }}%
          </p>
          <p class="text-xs text-gray-500 mt-1">PASS 率</p>
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p class="text-3xl font-bold text-yellow-600">{{ stats.verdicts.WARN }}</p>
          <p class="text-xs text-gray-500 mt-1">⚠️ WARN</p>
        </div>
        <div class="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <p class="text-3xl font-bold text-red-600">{{ stats.verdicts.FAIL }}</p>
          <p class="text-xs text-gray-500 mt-1">❌ FAIL</p>
        </div>
      </div>

      <!-- カテゴリ別スコア -->
      <div class="bg-white rounded-lg border border-gray-200 p-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-4">カテゴリ別 PASS 率</h2>
        <div class="space-y-3">
          <div
            v-for="(catStats, cat) in stats.categories"
            :key="cat"
            class="flex items-center gap-3"
          >
            <span class="text-xs text-gray-600 w-48 shrink-0">
              {{ categoryLabels[cat] ?? cat }}
            </span>
            <div class="flex-1 bg-gray-100 rounded-full h-2">
              <div
                class="h-2 rounded-full bg-green-500 transition-all"
                :style="{ width: `${categoryPassRate(catStats)}%` }"
              />
            </div>
            <span class="text-xs font-medium text-gray-700 w-10 text-right">
              {{ categoryPassRate(catStats) }}%
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- 最新 PR -->
    <div>
      <h2 class="text-sm font-semibold text-gray-700 mb-3">最新レビュー</h2>
      <div v-if="reviewsLoading" class="text-gray-500 text-sm">読み込み中...</div>
      <div v-else-if="reviews.length === 0" class="text-gray-400 text-sm">
        まだレビュー結果がありません
      </div>
      <div v-else class="space-y-3">
        <ReviewCard v-for="r in reviews" :key="r.SK" :review="r" />
      </div>
    </div>
  </div>
</template>
