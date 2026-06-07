<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <nav class="bg-white border-b border-gray-200 px-6 py-4">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <span class="text-lg font-semibold text-gray-900">QC Dashboard</span>
        <div class="flex gap-4 text-sm">
          <RouterLink
            to="/"
            class="text-gray-600 hover:text-gray-900"
            active-class="text-blue-600 font-medium"
          >
            ダッシュボード
          </RouterLink>
          <RouterLink
            to="/prs"
            class="text-gray-600 hover:text-gray-900"
            active-class="text-blue-600 font-medium"
          >
            PR 一覧
          </RouterLink>
        </div>
      </div>
    </nav>
    <main class="max-w-6xl mx-auto px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
