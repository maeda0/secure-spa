<script setup lang="ts">
import VerdictBadge from './VerdictBadge.vue'
import type { ReviewRecord, StrideRisk } from '@/composables/useReviews'

defineProps<{ review: ReviewRecord }>()

const categoryLabels: Record<string, string> = {
  xss:        'XSS',
  auth:       '認証・認可',
  secrets:    'シークレット',
  typescript: 'TypeScript',
  infra:      'インフラ',
}

const strideLabels: Record<string, string> = {
  spoofing:              'S: なりすまし',
  tampering:             'T: 改ざん',
  repudiation:           'R: 否認',
  informationDisclosure: 'I: 情報漏洩',
  denialOfService:       'D: DoS',
  elevationOfPrivilege:  'E: 権限昇格',
}

const riskColor = (risk: StrideRisk) => {
  if (risk === 'HIGH')   return 'text-red-700 bg-red-50 border-red-200'
  if (risk === 'MEDIUM') return 'text-orange-700 bg-orange-50 border-orange-200'
  if (risk === 'LOW')    return 'text-yellow-700 bg-yellow-50 border-yellow-200'
  return 'text-gray-400 bg-gray-50 border-gray-100'
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

    <!-- ASVS カテゴリ -->
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

    <!-- STRIDE 脅威モデル -->
    <div v-if="review.stride" class="mt-3 border-t border-gray-100 pt-3">
      <p class="text-xs font-medium text-gray-500 mb-1.5">STRIDE 脅威モデル</p>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="(risk, key) in review.stride"
          :key="key"
          :class="['inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border', riskColor(risk as StrideRisk)]"
        >
          {{ strideLabels[key] ?? key }}: {{ risk }}
        </span>
      </div>
    </div>

    <div v-if="review.issues.length > 0" class="mt-2 text-xs text-gray-500">
      {{ review.issues.length }} 件の指摘
    </div>
  </div>
</template>
