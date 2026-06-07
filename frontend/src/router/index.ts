import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
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
