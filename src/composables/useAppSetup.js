import { createPinia } from 'pinia'
import VueCookies from 'vue3-cookies'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import VueLazyload from 'vue-lazyload'
import { LAZY_LOADING_CONFIG } from '@/constants'

export const useAppSetup = (app, { isClient = typeof window !== 'undefined' } = {}) => {
  const pinia = createPinia()
  if (isClient) {
    pinia.use(piniaPluginPersistedstate)
  }

  app.provide('$', null)
  app.use(VueLazyload, LAZY_LOADING_CONFIG).use(VueCookies).use(pinia)

  // Роутер здесь НЕ подключаем: ViteSSG ставит его сам, а повторный app.use
  // давал предупреждение «Plugin has already been applied to target app».

  return { pinia }
}
