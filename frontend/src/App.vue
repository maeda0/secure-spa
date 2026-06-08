<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth   = useAuthStore()

const logout = () => {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <nav v-if="auth.isAuthenticated" class="bg-white border-b border-gray-200 px-6 py-4">
      <div class="max-w-6xl mx-auto flex items-center justify-between">
        <span class="text-lg font-semibold text-gray-900">QC Dashboard</span>
        <div class="flex items-center gap-6 text-sm">
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
          <button
            @click="logout"
            class="text-gray-500 hover:text-gray-700"
          >
            ログアウト
          </button>
        </div>
      </div>
    </nav>
    <main :class="auth.isAuthenticated ? 'max-w-6xl mx-auto px-6 py-8' : ''">
      <RouterView />
    </main>
  </div>
</template>
