<script setup lang="ts">
import { computed } from 'vue'
import { verdictColor, verdictLabel } from '@/composables/useReviews'

const props = defineProps<{ verdict: string }>()
const cls = computed(() => verdictColor(props.verdict))
const label = computed(() => verdictLabel(props.verdict))
</script>

<template>
  <span :class="['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', cls]">
    {{ label }}
  </span>
</template>
