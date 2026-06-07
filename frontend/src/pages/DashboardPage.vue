<script setup lang="ts">
import { computed } from 'vue'
import { useStats, useReviews } from '@/composables/useReviews'
import ReviewCard from '@/components/ReviewCard.vue'

const { stats, loading: statsLoading } = useStats()
const { reviews, loading: reviewsLoading } = useReviews(50)

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

const verdictBg = (v: string) => {
  if (v === 'PASS') return 'bg-green-500'
  if (v === 'WARN') return 'bg-yellow-400'
  return 'bg-red-500'
}

const sortedReviews = computed(() =>
  [...reviews.value].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
)

const recentReviews = computed(() => sortedReviews.value.slice(-5))
</script>

<template>
  <div class="space-y-8">
    <h1 class="text-2xl font-bold text-gray-900">ダッシュボード</h1>

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

      <!-- 品質推移 -->
      <div class="bg-white rounded-lg border border-gray-200 p-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-4">品質推移（直近レビュー）</h2>
        <div v-if="sortedReviews.length === 0" class="text-gray-400 text-sm">
          レビューデータがありません
        </div>
        <template v-else>
          <div class="flex gap-1.5 flex-wrap">
            <div
              v-for="r in sortedReviews"
              :key="r.SK"
              :title="`${r.prTitle} (${r.reviewedAt.slice(0, 10)})`"
              :class="['w-5 h-5 rounded-sm cursor-default transition-opacity hover:opacity-75', verdictBg(r.verdict)]"
            />
          </div>
          <div class="flex gap-4 mt-3 text-xs text-gray-500">
            <span class="flex items-center gap-1">
              <span class="w-3 h-3 rounded-sm bg-green-500 inline-block" />PASS
            </span>
            <span class="flex items-center gap-1">
              <span class="w-3 h-3 rounded-sm bg-yellow-400 inline-block" />WARN
            </span>
            <span class="flex items-center gap-1">
              <span class="w-3 h-3 rounded-sm bg-red-500 inline-block" />FAIL
            </span>
            <span class="ml-auto text-gray-400">← 古い　新しい →</span>
          </div>
        </template>
      </div>

      <!-- ASVS カテゴリ別マトリクス -->
      <div class="bg-white rounded-lg border border-gray-200 p-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-4">ASVS カテゴリ別マトリクス</h2>
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-gray-200 text-gray-500">
              <th class="text-left pb-2 font-medium">カテゴリ</th>
              <th class="text-center pb-2 font-medium text-green-600">PASS</th>
              <th class="text-center pb-2 font-medium text-yellow-600">WARN</th>
              <th class="text-center pb-2 font-medium text-red-600">FAIL</th>
              <th class="text-right pb-2 font-medium text-gray-600">PASS 率</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(catStats, cat) in stats.categories"
              :key="cat"
              class="border-b border-gray-50 hover:bg-gray-50 transition-colors"
            >
              <td class="py-2.5 text-gray-700">{{ categoryLabels[String(cat)] ?? cat }}</td>
              <td class="py-2.5 text-center font-semibold text-green-600">{{ catStats.PASS }}</td>
              <td class="py-2.5 text-center font-semibold text-yellow-600">{{ catStats.WARN }}</td>
              <td class="py-2.5 text-center font-semibold text-red-600">{{ catStats.FAIL }}</td>
              <td class="py-2.5 text-right">
                <span :class="['font-bold', passRateColor(categoryPassRate(catStats))]">
                  {{ categoryPassRate(catStats) }}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- カテゴリ別 PASS 率バー -->
      <div class="bg-white rounded-lg border border-gray-200 p-6">
        <h2 class="text-sm font-semibold text-gray-700 mb-4">カテゴリ別 PASS 率</h2>
        <div class="space-y-3">
          <div
            v-for="(catStats, cat) in stats.categories"
            :key="cat"
            class="flex items-center gap-3"
          >
            <span class="text-xs text-gray-600 w-48 shrink-0">
              {{ categoryLabels[String(cat)] ?? cat }}
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

    <!-- 最新レビュー -->
    <div>
      <h2 class="text-sm font-semibold text-gray-700 mb-3">最新レビュー</h2>
      <div v-if="reviewsLoading" class="text-gray-500 text-sm">読み込み中...</div>
      <div v-else-if="recentReviews.length === 0" class="text-gray-400 text-sm">
        まだレビュー結果がありません
      </div>
      <div v-else class="space-y-3">
        <ReviewCard v-for="r in recentReviews" :key="r.SK" :review="r" />
      </div>
    </div>
  </div>
</template>
