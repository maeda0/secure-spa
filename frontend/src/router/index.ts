import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  // GitHub Pages はサブパスなので hash モードを使用
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/pages/DashboardPage.vue'),
    },
    {
      path: '/prs',
      component: () => import('@/pages/PrListPage.vue'),
    },
  ],
})
