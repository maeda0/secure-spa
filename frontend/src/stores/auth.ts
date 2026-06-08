import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js'

// In-memory storage: localStorage は XSS でトークン窃取されるため禁止（CLAUDE.md）
// ページリロードでログアウトされる設計（研究用途では許容）
const memoryStorage: Record<string, string> = {}
const inMemoryStorage = {
  setItem:    (k: string, v: string) => { memoryStorage[k] = v },
  getItem:    (k: string) => memoryStorage[k] ?? null,
  removeItem: (k: string) => { delete memoryStorage[k] },
  clear:      () => { Object.keys(memoryStorage).forEach(k => delete memoryStorage[k]) },
}

const pool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID as string,
  ClientId:   import.meta.env.VITE_COGNITO_CLIENT_ID as string,
  Storage:    inMemoryStorage,
})

export const useAuthStore = defineStore('auth', () => {
  const idToken  = ref<string | null>(null)
  const loading  = ref(false)
  const error    = ref<string | null>(null)

  const isAuthenticated = computed(() => idToken.value !== null)

  const login = (email: string, password: string): Promise<void> =>
    new Promise((resolve, reject) => {
      loading.value = true
      error.value   = null

      const user = new CognitoUser({ Username: email, Pool: pool, Storage: inMemoryStorage })
      const auth = new AuthenticationDetails({ Username: email, Password: password })

      user.authenticateUser(auth, {
        onSuccess: (session: CognitoUserSession) => {
          idToken.value = session.getIdToken().getJwtToken()
          loading.value = false
          resolve()
        },
        onFailure: (err: Error) => {
          error.value   = err.message
          loading.value = false
          reject(err)
        },
        newPasswordRequired: () => {
          error.value   = 'パスワードの変更が必要です。管理者に連絡してください。'
          loading.value = false
          reject(new Error('NEW_PASSWORD_REQUIRED'))
        },
      })
    })

  const logout = () => {
    pool.getCurrentUser()?.signOut()
    idToken.value = null
  }

  return { idToken, loading, error, isAuthenticated, login, logout }
})
