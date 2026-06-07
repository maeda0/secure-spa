<script setup lang="ts">
import VerdictBadge from './VerdictBadge.vue'
import type { ReviewRecord } from '@/composables/useReviews'

defineProps<{ review: ReviewRecord }>()

const categoryLabels: Record<string, string> = {
  xss:        'XSS',
  auth:       '認証・認可',
  secrets:    'シークレット',
  typescript: 'TypeScript',
  infra:      'インフラ',
}

const date = (iso: string) => new Date(iso).toLocaleDateString('ja-JP')
</script>

<template>
  <div class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="text-sm font-medium text-gray-900 truncate">
          #{{ review.prNumber }} {{ review.prTitle }}
        </p>
        <p class="text-xs text-gray-500 mt-0.5">
          {{ review.prAuthor }} · {{ date(review.reviewedAt) }}
        </p>
      </div>
      <VerdictBadge :verdict="review.verdict" />
    </div>

    <div class="mt-3 flex flex-wrap gap-1.5">
      <span
        v-for="(v, cat) in review.categories"
        :key="cat"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-50 border border-gray-100"
      >
        <span class="text-gray-500">{{ categoryLabels[cat] ?? cat }}</span>
        <VerdictBadge :verdict="v" />
      </span>
    </div>

    <div v-if="review.issues.length > 0" class="mt-2 text-xs text-gray-500">
      {{ review.issues.length }} 件の指摘
    </div>
  </div>
</template>
