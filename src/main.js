import { ViteSSG } from 'vite-ssg'
import { useThemeStore } from './store/theme'
import { useAppSetup } from './composables/useAppSetup'
import { routes } from './router/routes'
import { installRouterGuards } from './router'
import { buildMoviePath, loadSeedMovieSeoEntries } from './utils/movieSeo'
import App from './App.vue'

export const createApp = ViteSSG(
  App,
  { routes, base: import.meta.env.VITE_BASE_URL || '/' },
  ({ app, router, isClient }) => {
    installRouterGuards(router, { isClient })
    useAppSetup(app, { isClient })

    if (isClient) {
      window.addEventListener('vite:preloadError', (event) => {
        if (import.meta.env.DEV) {
          window.__LAST_VITE_PRELOAD_ERROR__ = String(event)
        }
        window.location.reload()
      })

      const themeStore = useThemeStore()
      // Wait for persistedstate to hydrate before applying theme
      setTimeout(() => themeStore.initTheme(), 0)
    }
  }
)

// Вызывается vite-ssg на этапе сборки (Node), в браузере никогда.
// Каталог грузим динамически именно поэтому: статический импорт утаскивал
// 309 КБ JSON в стартовый чанк сайта, хотя нужен он только здесь.
export const includedRoutes = async (paths) => {
  const staticPaths = paths.filter((path) => !path.includes(':'))
  const { default: seedMovies } = await import('./data/movies.json')
  const moviePaths = loadSeedMovieSeoEntries(seedMovies).map((movie) =>
    buildMoviePath(movie.kp_id, movie.slug)
  )

  return Array.from(new Set([...staticPaths, ...moviePaths]))
}
