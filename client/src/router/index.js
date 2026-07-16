import { createRouter, createWebHistory } from 'vue-router'
import FileBrowser from '../views/FileBrowser.vue'

const routes = [
  {
    path: '/',
    name: 'FileBrowser',
    component: FileBrowser
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
