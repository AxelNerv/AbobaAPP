<template>
  <div class="nav-component">
    <MobileMenu v-if="isMobile" :links="navLinks" />
    <DesktopMenu v-else :links="navLinks" />

    <transition name="fade">
      <ModalSearch v-if="navbarStore.isModalSearchVisible" />
    </transition>

    <transition name="fade">
      <IdSearchModal v-if="navbarStore.isModalIdSearchVisible" />
    </transition>

    <!-- Модалка случайного фильма -->
    <RandomMovieModal
      :is-open="showRandomModal"
      :movie="randomMovie"
      :loading="randomLoading"
      :error="randomError"
      @close="closeRandom"
      @get-new-movie="fetchRandom"
    />
  </div>
</template>

<script setup>
import { useMainStore } from '@/store/main'
import { useAuthStore } from '@/store/auth'
import { useNavbarStore } from '@/store/navbar'
import { computed, ref, onMounted } from 'vue'
import DesktopMenu from './MenuNavigation/DesktopMenu.vue'
import MobileMenu from './MenuNavigation/MobileMenu.vue'
import ModalSearch from './ModalSearch.vue'
import IdSearchModal from './IdSearchModal.vue'
import RandomMovieModal from './RandomMovieModal.vue'
import { getBaseURLSync, getBaseURL } from '@/api/axios'
import { getUser } from '@/api/user'
import { getRandomMovie } from '@/api/movies'
import { handleApiError } from '@/constants'

const store = useMainStore()
const authStore = useAuthStore()
const navbarStore = useNavbarStore()
const isMobile = computed(() => store.isMobile)
const navLinks = ref([])

// Random modal state
const showRandomModal = ref(false)
const randomMovie = ref(null)
const randomLoading = ref(false)
const randomError = ref('')

const openRandom = () => {
  showRandomModal.value = true
  fetchRandom()
}
const closeRandom = () => {
  showRandomModal.value = false
  randomMovie.value = null
  randomError.value = ''
}
const fetchRandom = async (opts = {}) => {
  randomLoading.value = true
  randomError.value = ''
  try {
    const response = await getRandomMovie(opts || {})
    randomMovie.value = response
    // Догружаем описание в фоне (не блокируя)
    const id = response?.kp_id || response?.kinopoisk_id || response?.id
    const hasDesc = response?.description || response?.short_description
    if (id && !hasDesc) {
      enrichDescription(id, response).catch(() => { /* silent */ })
    }
  } catch (error) {
    const { message } = handleApiError(error)
    randomError.value = message
  } finally {
    randomLoading.value = false
  }
}

/**
 * Пытается найти описание фильма через несколько источников.
 * Прерывается как только какой-то вернул текст.
 */
const enrichDescription = async (id, baseResponse) => {
  // Источник 1 — kinobd (getKpInfo)
  try {
    const { getKpInfo } = await import('@/api/movies')
    const kpInfo = await getKpInfo(id)
    const desc =
      kpInfo?.description ||
      kpInfo?.short_description ||
      kpInfo?.data?.description ||
      kpInfo?.kinopoisk?.description ||
      kpInfo?.raw_data?.description
    if (desc) {
      randomMovie.value = { ...baseResponse, description: desc }
      return
    }
  } catch { /* next source */ }

  // Источник 2 — прямой вызов kinopoiskapiunofficial.tech (публичный endpoint, без ключа)
  try {
    const resp = await fetch(`https://kinopoiskapiunofficial.tech/api/v2.2/films/${id}`, {
      headers: { 'X-API-KEY': import.meta.env.VITE_KP_UNOFFICIAL_KEY || '' }
    })
    if (resp.ok) {
      const data = await resp.json()
      const desc = data?.description || data?.shortDescription
      if (desc) {
        randomMovie.value = { ...baseResponse, description: desc }
      }
    }
  } catch { /* ignore */ }
}

const initializeNavLinks = (baseURL) => {
  const links = [
    // icon — смысловое имя из таблицы AppIcon. Аватар пользователя остаётся
    // ссылкой (http…), меню различает их по префиксу.
    { to: '/', exact: true, icon: 'home', text: 'Главная' },
    // Профиля больше нет: имя, аватар и выход переехали в библиотеку,
    // отдельная страница с теми же списками только дублировала её.
    {
      to: authStore.user ? '/library' : '/login',
      exact: true,
      icon: authStore.user
        ? authStore.user.photo
          ? `${baseURL}${authStore.user.photo}`
          : 'user'
        : 'user',
      text: authStore.user ? 'Моя библиотека' : 'Войти'
    },
    { icon: 'random', text: 'Случайный фильм', action: openRandom },
    { icon: 'fingerprint', text: 'Поиск по ID', action: () => navbarStore.openIdSearchModal() }
  ]

  // Настройки приложения — шестерёнка рядом с колокольчиком (FloatingBell).

  navLinks.value = links
}

const baseURL = getBaseURLSync()
initializeNavLinks(baseURL)

onMounted(async () => {
  if (authStore.token && !authStore.user) {
    try {
      let user = await getUser()
      authStore.setUser(user)
      const updatedBaseURL = await getBaseURL()
      initializeNavLinks(updatedBaseURL)
    } catch (error) {
      const { code } = handleApiError(error)
      if (code === 401) {
        console.warn('getUser() returned 401, likely local token — keeping session')
      }
    }
  }
})
</script>

<style scoped>
.nav-component {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 400;
  font-size: 13px;
}

.fade-enter-active { transition: opacity 0.3s ease; }
.fade-leave-active { transition: all 0s; }
.fade-enter-from { opacity: 0; }
.fade-enter-to { opacity: 1; }
</style>
