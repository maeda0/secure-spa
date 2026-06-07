<script setup lang="ts">
import { ref, computed } from 'vue'
import { useReviews, verdictLabel } from '@/composables/useReviews'
import ReviewCard from '@/components/ReviewCard.vue'

const { reviews, total, loading, error } = useReviews(100)

type Filter = 'ALL' | 'PASS' | 'WARN' | 'FAIL'
const filter = ref<Filter>('ALL')

const filtered = computed(() =>
  filter.value === 'ALL'
    ? reviews.value
    : reviews.value.filter(r => r.verdict === filter.value)
)

const filterButtons: { label: string; value: Filter }[] = [
  { label: '全て', value: 'ALL' },
  { label: '✅ PASS', value: 'PASS' },
  { label: '⚠️ WARN', value: 'WARN' },
  { label: '❌ FAIL', value: 'FAIL' },
]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900">PR 一覧</h1>
      <span class="text-sm text-gray-500">{{ total }} 件</span>
    </div>

    <!-- フィルター -->
    <div class="flex gap-2">
      <button
        v-for="btn in filterButtons"
        :key="btn.value"
        :class="[
          'px-3 py-1.5 rounded text-xs font-medium transition-colors',
          filter === btn.value
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300',
        ]"
        @click="filter = btn.value"
      >
        {{ btn.label }}
      </button>
    </div>

    <div v-if="loading" class="text-gray-500 text-sm">読み込み中...</div>
    <div v-else-if="error" class="text-red-500 text-sm">{{ error }}</div>
    <div v-else-if="filtered.length === 0" class="text-gray-400 text-sm">
      該当する PR がありません
    </div>
    <div v-else class="space-y-3">
      <ReviewCard v-for="r in filtered" :key="r.SK" :review="r" />
    </div>
  </div>
</template>
