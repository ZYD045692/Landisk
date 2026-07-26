import { createRouter, createWebHistory } from 'vue-router'
import FileBrowser from '../views/FileBrowser.vue'

const routes = [
  {
    path: '/',
    name: 'FileBrowser',
    component: FileBrowser
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
