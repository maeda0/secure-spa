import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // 対象リポジトリ（例: "owner/repo-name"）
  const selectedRepo = ref(import.meta.env.VITE_DEFAULT_REPO ?? '')

  const setRepo = (repo: string) => {
    selectedRepo.value = repo
  }

  return { selectedRepo, setRepo }
})
