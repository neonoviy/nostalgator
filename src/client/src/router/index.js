import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/:year?/:month?/:filename?',
    name: 'photo-deeplink',
    component: () => import('../App.vue'),
  },
  {
    path: '/:year?/:month?/',
    component: () => import('../App.vue'),
  },
  {
    path: '/',
    name: 'home',
    component: () => import('../App.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('../App.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
