<template>
  <div class="wrapper">
    <div class="mainpage">
      <!-- Кнопки выбора типа поиска — только на странице /id-search -->
      <div v-if="isIdSearchPage" class="search-type-buttons">
        <button :class="{ active: searchType === 'kinopoisk' }" @click="setSearchType('kinopoisk')">
          ID Кинопоиск
        </button>
        <button :class="{ active: searchType === 'imdb' }" @click="setSearchType('imdb')">
          ID IMDB
        </button>
        <button class="random-button" :disabled="randomLoading" @click="openRandomMovie">
          <AppIcon name="random" :size="16" />
          {{ randomLoading ? 'Подбираем...' : 'Случайный фильм' }}
        </button>
      </div>

      <!-- Поиск -->
      <div class="search-container">
        <div class="input-wrapper">
          <input
            ref="searchInput"
            v-model="searchTerm"
            :placeholder="getPlaceholder()"
            class="search-input"
            :inputmode="searchType === 'title' ? 'text' : 'numeric'"
            @keydown.enter.prevent="search"
            @keydown.tab.prevent="handleTabKey"
            @keydown.down.prevent="focusFirstMovieCard"
            @input="handleInput"
          />
          <div class="icons">
            <button v-if="searchTerm" class="reset-button" @click="resetSearch">
              <AppIcon name="close" :size="18" />
            </button>
            <button class="search-button" @click="search">
              <AppIcon name="search" :size="18" />
            </button>
          </div>
        </div>
      </div>

      <!-- Контейнер для истории и результатов -->
      <div class="content-container">
        <!-- Популярное (история переехала в профиль) -->
        <div v-if="!searchTerm">
          <h2>
            Популярное сейчас
          </h2>

          <!-- Первоначальная загрузка -->
          <div v-if="topMoviesLoading" class="loading-container">
            <SpinnerLoading />
          </div>

          <!-- Нет фильмов и не грузим — ошибка загрузки -->
          <div v-else-if="!topMovies.length" class="empty-history">
            <AppIcon name="movie" :size="64" :stroke-width="1.5" />
            <p>Не удалось загрузить популярное</p>
          </div>

          <!-- Список фильмов -->
          <template v-else>
            <MovieList
              :movies-list="topMovies"
              :is-history="false"
              :loading="false"
            />

          </template>
        </div>
        <ErrorMessage
          v-if="!searchTerm && errorMessage"
          :message="errorMessage"
          :code="errorCode"
        />

        <!-- Результаты поиска -->
        <div v-if="searchPerformed">
          <h2>Результаты поиска</h2>
          <MovieList :movies-list="movies" :is-history="false" :loading="loading" />
          <div v-if="movies.length === 0 && !loading && !errorMessage" class="no-results">
            Ничего не найдено
          </div>
          <ErrorMessage v-if="errorMessage" :message="errorMessage" :code="errorCode" />
        </div>

        <!-- Подсказка, когда ничего не введено в поиске -->
        <div
          v-if="searchTerm && !searchPerformed && !loading && !errorMessage"
          class="search-prompt"
        >
          Нажмите кнопку "Поиск" или Enter для поиска
        </div>
      </div>
    </div>

    <RandomMovieModal
      :is-open="showRandomModal"
      :movie="randomMovie"
      :loading="randomLoading"
      :error="randomError"
      @close="closeRandomModal"
      @get-new-movie="fetchRandomMovie"
    />
  </div>
</template>

<script setup>
import {
  apiSearch,
  getKpIDfromIMDB,
  getMovies,
  getRandomMovie,
  getKpInfo
} from '@/api/movies'
import { handleApiError } from '@/constants'
import { getMyLists } from '@/api/user'
import ErrorMessage from '@/components/ErrorMessage.vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { MovieList } from '@/components/MovieList/'
import { useMainStore } from '@/store/main'
import { useAuthStore } from '@/store/auth'
import { useRandomHistoryStore } from '@/store/randomHistory'
import { USER_LIST_TYPES_ENUM } from '@/constants'
import { hasConsecutiveConsonants, suggestLayout, convertLayout } from '@/utils/keyboardLayout'
import { normalizeBasePath } from '@/utils/basePath'
import debounce from 'lodash.debounce'
import { onMounted, onServerPrefetch, ref, watch, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import SpinnerLoading from '@/components/SpinnerLoading.vue'
import RandomMovieModal from '@/components/RandomMovieModal.vue'
import { getMovieSeoPath } from '@/utils/movieSeo'

const mainStore = useMainStore()
const authStore = useAuthStore()
const randomHistoryStore = useRandomHistoryStore()
const router = useRouter()
const route = useRoute()
const isIdSearchPage = computed(() => route.path === '/id-search')

const searchType = ref(route.path === '/id-search' ? 'kinopoisk' : 'title')
const searchTerm = ref('')
const movies = ref([])
const loading = ref(false)
const historyLoading = ref(false)
const searchPerformed = ref(false)
const errorMessage = ref('')
const errorCode = ref(null)
const isMobile = computed(() => mainStore.isMobile)
const history = ref([])
// Сколько фильмов показываем на главной. Было 500 — один запрос, но тяжёлый
// ответ, а от таких источник охотнее уходит в rate-limit.
// 100 — ровно одна страница выдачи kinobd (per_page по умолчанию), то есть
// столько же данных за тот же единственный запрос. Показываем все сразу,
// без кнопки и постраничности.
const TOP_BUFFER_LIMIT = 100

// Полный буфер, загружается один раз и целиком уходит в разметку
const allTopMoviesBuffer = ref([])
const topMovies = computed(() => allTopMoviesBuffer.value)
const topMoviesLoading = ref(false)

const showLayoutWarning = ref(false)
const suggestedLayout = ref('')

const showRandomModal = ref(false)
const randomMovie = ref(null)
const randomLoading = ref(false)
const randomError = ref('')

const searchInput = ref(null)
const siteOrigin = import.meta.env.VITE_SITE_ORIGIN || ''
const basePath = normalizeBasePath(import.meta.env.VITE_BASE_URL || '/')
const canonicalUrl = `${siteOrigin}${basePath || ''}/`
const homeTitle = 'AbobaTv - поиск фильмов и сериалов онлайн бесплатно'
const homeDescription =
  'AbobaTv - онлайн-поиск фильмов и сериалов с быстрым переходом к просмотру, рейтингами, подборками и удобной навигацией.'

useHead({
  title: homeTitle,
  link: [
    { rel: 'canonical', href: canonicalUrl },
    { rel: 'alternate', hreflang: 'ru', href: canonicalUrl },
    { rel: 'alternate', hreflang: 'x-default', href: canonicalUrl }
  ],
  meta: [
    { name: 'description', content: homeDescription },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: 'AbobaTv - поиск фильмов и сериалов онлайн' },
    { property: 'og:description', content: homeDescription },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:locale', content: 'ru_RU' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: 'AbobaTv - поиск фильмов и сериалов онлайн' },
    { name: 'twitter:description', content: homeDescription }
  ],
  script: [
    {
      type: 'application/ld+json',
      textContent: JSON.stringify([
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'AbobaTv',
          url: canonicalUrl,
          logo: `${siteOrigin}${basePath || ''}/icons/icon-192x192.png`
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'AbobaTv',
          url: canonicalUrl,
          inLanguage: 'ru',
          potentialAction: {
            '@type': 'SearchAction',
            target: `${canonicalUrl}#search={search_term_string}`,
            'query-input': 'required name=search_term_string'
          }
        }
      ])
    }
  ]
})

const TOP_CACHE_KEY = 'abobatv_top_cache_v3'
const TOP_CACHE_TTL = 10 * 60 * 1000 // 10 минут

const loadTopFromCache = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TOP_CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    return { data, fresh: Date.now() - ts <= TOP_CACHE_TTL }
  } catch {
    return null
  }
}

const saveTopToCache = (data) => {
  try {
    window.localStorage.setItem(TOP_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
  } catch { /* ignore */ }
}

const loadHomeTopMovies = async () => {
  // Сначала показываем кеш (если есть) — мгновенно
  const cached = loadTopFromCache()
  if (cached?.data?.length) {
    allTopMoviesBuffer.value = cached.data
    topMoviesLoading.value = false
    // Фоном обновляем, не блокируя UI
    // Используем 'all' чтобы получить максимум фильмов (24h даёт ~30, all даёт 200+)
    getMovies({ activeTime: 'all', typeFilter: 'all', limit: TOP_BUFFER_LIMIT })
      .then((fresh) => {
        if (fresh?.length) {
          allTopMoviesBuffer.value = fresh
          saveTopToCache(fresh)
        }
      })
      .catch((e) => console.error('Background top refresh failed:', e))
    return
  }
  // Первый визит тоже не должен ждать внешний API. Сразу показываем встроенный
  // каталог, а актуальный топ тихо подменит его, когда источник ответит.
  const { default: seedMovies } = await import('@/data/movies.json')
  allTopMoviesBuffer.value = seedMovies.slice(0, TOP_BUFFER_LIMIT)
  topMoviesLoading.value = false
  getMovies({ activeTime: 'all', typeFilter: 'all', limit: TOP_BUFFER_LIMIT })
    .then((fresh) => {
      if (fresh?.length) {
        allTopMoviesBuffer.value = fresh
        saveTopToCache(fresh)
      }
    })
    .catch((error) => console.warn('Обновление топа недоступно:', error?.message))
}

onServerPrefetch(loadHomeTopMovies)

watch(
  () => authStore.token,
  async (token) => {
    if (token) {
      history.value = mainStore.history
      historyLoading.value = mainStore.history.length === 0
      try {
        const serverHistory = await getMyLists(USER_LIST_TYPES_ENUM.HISTORY)
        mainStore.setHistory(serverHistory)
        history.value = serverHistory
      } catch (error) {
        const { message, code } = handleApiError(error)
        console.error('Ошибка загрузки истории:', error)
        // 401 от чужого API — не разлогиниваем и не показываем ошибку (у нас локальная авторизация через Telegram)
        if (code === 401) {
          console.warn('401 from external API — ignoring, keeping local session')
        } else {
          errorMessage.value = message
          errorCode.value = code
        }
      } finally {
        historyLoading.value = false
      }
      return
    }

    history.value = mainStore.history
  },
  { immediate: true }
)

watch(
  () => mainStore.history,
  (newHistory) => {
    history.value = newHistory
  },
  { deep: true }
)

// Установка типа поиска
const setSearchType = (type) => {
  searchType.value = type
  resetSearch()
  showLayoutWarning.value = false
}

const handleInput = (event) => {
  errorMessage.value = ''
  errorCode.value = null

  if (searchType.value === 'title') {
    searchTerm.value = event.target.value
    if (isMobile.value) return
    showLayoutWarning.value = hasConsecutiveConsonants(searchTerm.value)
    if (showLayoutWarning.value) {
      suggestedLayout.value = suggestLayout(searchTerm.value)
    }
  } else {
    searchTerm.value = event.target.value.replace(/\D+/g, '')
  }
}

const handleTabKey = () => {
  if (showLayoutWarning.value) {
    searchTerm.value = convertLayout(searchTerm.value)
    showLayoutWarning.value = false
  }
}

// Получение placeholder для input
const getPlaceholder = () => {
  return (
    {
      title: 'Введите название фильма',
      kinopoisk: 'Пример: 301 (Матрица)',
      imdb: 'Пример: 0198781 (Корпорация монстров)'
    }[searchType.value] || 'Введите название фильма'
  )
}

// Очистка поиска
const resetSearch = () => {
  searchTerm.value = ''
  movies.value = []
  searchPerformed.value = false
  showLayoutWarning.value = false
  errorMessage.value = ''
  errorCode.value = null
  searchInput.value?.focus()
}

const search = () => {
  debouncedPerformSearch.cancel()
  if (searchTerm.value) {
    errorMessage.value = ''
    errorCode.value = null
    performSearch()
  }
}

const performSearch = async () => {
  loading.value = true
  searchPerformed.value = true
  movies.value = []

  try {
    if (searchType.value === 'kinopoisk') {
      if (!/^\d+$/.test(searchTerm.value)) {
        searchTerm.value = searchTerm.value.replace(/\D/g, '')
      }
      router.push(getMovieSeoPath({ kp_id: searchTerm.value }))
      return
    }

    if (searchType.value === 'imdb') {
      if (!/^\d+$/.test(searchTerm.value)) {
        searchTerm.value = searchTerm.value.replace(/\D/g, '')
      }
      const response = await getKpIDfromIMDB(searchTerm.value)
      if (response.id_kp) {
        router.push(getMovieSeoPath({ kp_id: `${response.id_kp}` }))
      } else {
        throw new Error('Не найдено')
      }
      return
    }

    if (searchType.value === 'title') {
      const response = await apiSearch(searchTerm.value)
      movies.value = response.map((movie) => ({
        ...movie,
        kp_id: movie.id.toString(),
        rating_kp: movie.raw_data?.rating !== 'null' ? movie.raw_data?.rating : null,
        type: movie.raw_data?.type
      }))
    }
  } catch (error) {
    const { message, code } = handleApiError(error)
    errorMessage.value = message
    errorCode.value = code
    console.error('Ошибка при поиске:', error)
  } finally {
    loading.value = false
  }
}

const debouncedPerformSearch = debounce(() => {
  if (searchTerm.value.length >= 2) {
    performSearch()
  } else if (searchTerm.value.length < 2) {
    movies.value = []
    searchPerformed.value = false
  }
}, 700)

onMounted(async () => {
  if (!topMovies.value.length) {
    await loadHomeTopMovies()
  }
  const hash = window.location.hash
  if (hash.startsWith('#search=')) {
    const searchQuery = decodeURIComponent(hash.replace('#search=', ''))
    searchTerm.value = searchQuery
    performSearch()
  } else if (hash.startsWith('#imdb=')) {
    const imdbId = decodeURIComponent(hash.replace('#imdb=', ''))
    setSearchType('imdb')
    searchTerm.value = imdbId
    performSearch()
  }
  searchInput.value?.focus()
})

// Автопоиск с задержкой (только для поиска по названию)
watch(searchTerm, () => {
  if (searchType.value !== 'title') {
    return
  }
  debouncedPerformSearch()
})

// Вниз из строки поиска — к первой карточке. Проверяли только результаты
// поиска, а на главной показан список популярного, и с пульта из поля было
// не выйти.
const focusFirstMovieCard = () => {
  document.querySelector('#main-content .movie-card')?.focus()
}

const openRandomMovie = () => {
  showRandomModal.value = true
  fetchRandomMovie()
}

const closeRandomModal = () => {
  showRandomModal.value = false
  randomMovie.value = null
  randomError.value = ''
}

const fetchRandomMovie = async (opts = {}) => {
  randomLoading.value = true
  randomError.value = ''

  try {
    const response = await getRandomMovie(opts || {})

    if (response.kp_id) {
      try {
        const kpInfo = await getKpInfo(response.kp_id)
        randomMovie.value = {
          ...response,
          description: kpInfo.description,
          budget: kpInfo.budget,
          fees_world: kpInfo.fees_world,
          fees_russia: kpInfo.fees_russia,
          premiere_ru: kpInfo.premiere_ru,
          premiere_world: kpInfo.premiere_world,
          age_rating: kpInfo.age_rating,
          duration: kpInfo.duration,
          total_rating: kpInfo.total_rating
        }
      } catch {
        randomMovie.value = response
      }
    } else {
      randomMovie.value = response
    }
    // Сохраняем в историю
    if (randomMovie.value) {
      randomHistoryStore.addMovie(randomMovie.value)
    }
  } catch (error) {
    const { message } = handleApiError(error)
    randomError.value = message
    console.error('Ошибка при получении случайного фильма:', error)
  } finally {
    randomLoading.value = false
  }
}
</script>

<style scoped>
.wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.mainpage {
  flex: 1;
  padding: 0 28px 40px;
  max-width: calc(100vw - 60px);
}

/* Topbar — строка поиска сверху */
.search-type-buttons {
  position: sticky;
  top: 0;
  z-index: 50;
  padding: 16px 0 12px;
  background: linear-gradient(to bottom, var(--bg-primary) 60%, transparent);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search-type-buttons button {
  padding: 6px 13px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid rgba(255,255,255,0.12);
  background: transparent;
  color: rgba(232,234,240,0.5);
  cursor: pointer;
  transition: all 0.16s;
  border-radius: 8px;
  position: relative;
}

.search-type-buttons button::after {
  display: none;
}

.search-type-buttons button.active,
.search-type-buttons button:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: rgba(var(--accent-rgb),0.07);
}

.random-button {
  background: rgba(var(--accent-rgb),0.08) !important;
  color: var(--accent-color) !important;
  border: 1px solid rgba(var(--accent-rgb),0.28) !important;
  border-radius: 8px;
  padding: 6px 14px !important;
  font-size: 12px !important;
  font-weight: 500;
  transition: all 0.18s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: none !important;
}

.random-button:hover:not(:disabled) {
  background: rgba(var(--accent-rgb),0.16) !important;
  transform: none;
}

.random-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.random-button::after {
  display: none;
}

.search-container {
  display: flex;
  justify-content: flex-start;
  padding: 12px 0 4px; /* верхний отступ — чтобы поиск не липнул к адресной строке */
  margin-bottom: 4px;
}

.input-wrapper {
  position: relative;
  width: 100%;
  max-width: 600px; /* было 320 — для нормальных запросов нужно шире */
}

.search-input {
  box-sizing: border-box;
  width: 100%;
  /* padding-right увеличен с 42 до 76 чтобы текст не залезал под крестик и лупу */
  padding: 10px 76px 10px 16px;
  font-size: 14px;
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  color: #fff;
  transition: border-color 0.2s, background 0.2s;
  outline: none;
}

.search-input::placeholder { color: rgba(255,255,255,0.26); }

.search-input:focus {
  border-color: rgba(var(--accent-rgb),0.4);
  background: rgba(255,255,255,0.07);
  box-shadow: none;
}

.icons {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 8px;
  align-items: center;
}

.reset-button,
.search-button {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 2px;
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.reset-button:hover,
.search-button:hover {
  opacity: 1;
}

.reset-button i,
/* Размер SVG задаётся пропом size у AppIcon, а не font-size —
   шрифтовых иконок здесь больше нет. */
.search-button .app-icon {
  display: block;
}

h2 {
  display: flex;
  font-size: 15px;
  font-weight: 600;
  margin: 22px 0 14px;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
  color: #fff;

  &::before {
    content: '';
    display: inline-block;
    width: 3px; height: 15px;
    background: linear-gradient(180deg, var(--accent-color), var(--accent2));
    border-radius: 2px;
    flex-shrink: 0;
  }
}

.no-results {
  width: 100%;
  text-align: center;
  color: rgba(255,255,255,0.3);
  font-size: 14px;
  margin-top: 20px;
  padding: 24px 0;
}

/* Подсказка для поиска */
.search-prompt {
  text-align: center;
  color: #fff;
  font-size: 18px;
  margin-top: 20px;
}


.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  width: 100%;
}

.empty-history {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  color: #888;
  gap: 15px;
}

.empty-history .app-icon {
  color: #888;
  opacity: 0.7;
}

.empty-history p {
  font-size: 18px;
  margin: 0;
  color: #888;
}

.empty-history > div {
  width: 100%;
}

@media (max-width: 600px) {
  .mainpage {
    padding-top: 0;
    height: calc(100vh - 30px - 63px);
  }

  .search-container,
  .search-type-buttons {
    padding: 0;
  }
}
</style>
