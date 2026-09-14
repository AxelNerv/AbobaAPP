import { createRouter, createWebHistory } from 'vue-router'
import { nextTick } from 'vue'
import { routes } from './routes'
import { useMainStore } from '@/store/main'
import { useAuthStore } from '@/store/auth'
import { resolveHashNavigation } from '@/helpers/hashHandler'
import { useScrollTracking } from '@/composables/useScrollTracking'
import { buildMoviePath, getMovieSeoEntry } from '@/utils/movieSeo'

export const createRouterOptions = () => ({
  history: createWebHistory(import.meta.env.VITE_BASE_URL || '/'),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    const { userHasScrolled } = useScrollTracking()
    const mainStore = useMainStore()

    return new Promise((resolve) => {
      nextTick(() => {
        if (to.name === 'movie-info') {
          return resolve({ top: 0, behavior: 'smooth' })
        } else if (
          savedPosition &&
          mainStore.rememberScrollPosition &&
          !userHasScrolled.value &&
          to.name === 'lists'
        ) {
          setTimeout(() => resolve(savedPosition), 1000)
        } else {
          resolve({ top: 0, behavior: 'smooth' })
        }
      })
    })
  }
})

export const installRouterGuards = (router, { isClient = typeof window !== 'undefined' } = {}) => {
  const { startTracking } = useScrollTracking()

  // Возвращаем значение вместо вызова next(): next() в хуках объявлен
  // устаревшим, Vue Router предупреждал об этом в консоли на каждом переходе.
  router.beforeEach((to) => {
    if (to.meta?.requiresAuth) {
      const authStore = useAuthStore()

      if (!authStore.isAuthenticated) {
        return {
          name: 'login',
          query: {
            redirect: to.fullPath
          }
        }
      }
    }

    if (to.name === 'movie-info' && to.params?.kp_id) {
      const entry = getMovieSeoEntry(to.params.kp_id)
      const currentSlug = String(to.params.slug || '').trim()

      if (entry?.slug && currentSlug !== entry.slug) {
        return {
          path: buildMoviePath(to.params.kp_id, entry.slug),
          query: to.query,
          hash: to.hash,
          replace: true
        }
      }
    }

    if (isClient) {
      document.title = to.meta.title || 'AbobaTV'
      startTracking()
    }

    return to.hash ? resolveHashNavigation(to) : true
  })

  return router
}

export const createAppRouter = (options = {}) =>
  installRouterGuards(createRouter(createRouterOptions()), options)
