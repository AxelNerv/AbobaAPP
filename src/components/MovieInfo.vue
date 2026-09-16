<template>
  <div class="movie-info">
    <div class="content">
      <div v-if="(infoLoading || !movieInfo) && !errorMessage" class="content-card">
        <div class="movie-skeleton">
          <div class="movie-skeleton__header">
            <div class="movie-skeleton__title"></div>
          </div>

          <div class="movie-skeleton__ratings">
            <div class="movie-skeleton__rating-item"></div>
            <div class="movie-skeleton__rating-item"></div>
            <div class="movie-skeleton__rating-item"></div>
          </div>

          <div class="movie-skeleton__player">
            <SpinnerLoading />
          </div>

          <div class="movie-skeleton__additional-info">
            <div class="movie-skeleton__section-title"></div>
            <div class="movie-skeleton__info-list">
              <div class="movie-skeleton__info-item"></div>
              <div class="movie-skeleton__info-item"></div>
              <div class="movie-skeleton__info-item"></div>
              <div class="movie-skeleton__info-item"></div>
              <div class="movie-skeleton__info-item"></div>
            </div>
          </div>

          <div class="movie-skeleton__description">
            <div class="movie-skeleton__description-line"></div>
            <div class="movie-skeleton__description-line"></div>
            <div class="movie-skeleton__description-line"></div>
            <div class="movie-skeleton__description-line"></div>
          </div>
        </div>
      </div>

      <ErrorMessage v-if="errorMessage" :message="errorMessage" :code="errorCode" />

      <div v-if="errorMessage && clientReady" class="content-card">
        <component
          :is="moviePlayerComponent"
          v-if="clientReady && moviePlayerComponent"
          :key="kp_id"
          :kp-id="kp_id"
          :movie-info="movieInfo"
          @update:movie-info="fetchMovieInfo"
        />
      </div>

      <div v-if="movieInfo && !infoLoading" class="content-card">
        <div class="content-header">
          <div
            v-if="movieInfo.logo_url"
            class="content-logo"
            @mousemove="moveTooltip"
            @mouseleave="titleCopyTooltip = false"
            @click="copyMovieMeta"
          >
            <img :src="movieInfo.logo_url" alt="Логотип фильма" class="content-logo" />
          </div>
          <div
            v-else
            @mousemove="moveTooltip"
            @mouseleave="titleCopyTooltip = false"
            @click="copyMovieMeta"
          >
            <h1 class="content-title">
              {{ movieInfo.title }}
            </h1>
          </div>

          <div v-show="titleCopyTooltip" class="title-copy-tooltip" :style="tooltipStyle">
            Скопировать
          </div>
        </div>

        <div
          v-if="
            movieInfo.kinopoisk_id ||
            movieInfo.title ||
            movieInfo.imdb_id ||
            movieInfo.rating_imdb ||
            movieInfo.shikimori_id
          "
          class="ratings-links"
        >
          <!-- Кинопоиск -->
          <div v-if="movieInfo.kinopoisk_id">
            <a
              :href="`https://www.kinopoisk.ru/film/${movieInfo.kinopoisk_id}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rating-link"
              :title="
                movieInfo.rating_kinopoisk_vote_count
                  ? `Оценок: ${formatRatingNumber(movieInfo.rating_kinopoisk_vote_count)}`
                  : 'Нет данных о количестве голосов'
              "
            >
              <img src="/src/assets/icon-kp-logo.svg" alt="КП" class="rating-logo" />
              <span class="rating-value" :class="getRatingColor(movieInfo.rating_kinopoisk)">
                {{ movieInfo.rating_kinopoisk ? movieInfo.rating_kinopoisk : '—' }}
              </span>
              <img
                src="/src/assets/icon-external-link.png"
                alt="Внешняя ссылка"
                class="external-link-icon"
              />
            </a>
          </div>

          <!-- Поиск на Кинопоиске, если нет ID -->
          <div v-if="!movieInfo.kinopoisk_id && movieInfo.title">
            <a
              :href="`https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(movieInfo.title + (movieInfo.year ? ' ' + movieInfo.year : ''))}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rating-link"
              :title="
                movieInfo.rating_kinopoisk_vote_count
                  ? `Оценок: ${formatRatingNumber(movieInfo.rating_kinopoisk_vote_count)}`
                  : 'Нет данных о количестве голосов'
              "
            >
              <img src="/src/assets/icon-kp-logo.svg" alt="КП" class="rating-logo" />
              <span class="rating-value" :class="getRatingColor(movieInfo.rating_kinopoisk)">
                {{ movieInfo.rating_kinopoisk ? movieInfo.rating_kinopoisk : '—' }}
              </span>
              <img
                src="/src/assets/icon-external-link.png"
                alt="Внешняя ссылка"
                class="external-link-icon"
              />
            </a>
          </div>

          <!-- IMDb -->
          <div v-if="movieInfo.imdb_id">
            <a
              :href="`https://www.imdb.com/title/${movieInfo.imdb_id}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rating-link"
              :title="
                movieInfo.rating_imdb_vote_count
                  ? `Оценок: ${formatRatingNumber(movieInfo.rating_imdb_vote_count)}`
                  : 'Нет данных о количестве голосов'
              "
            >
              <img src="/src/assets/icon-imdb-logo.svg" alt="IMDb" class="rating-logo" />
              <span class="rating-value" :class="getRatingColor(movieInfo.rating_imdb)">
                {{ movieInfo.rating_imdb ? movieInfo.rating_imdb : '—' }}
              </span>
              <img
                src="/src/assets/icon-external-link.png"
                alt="Внешняя ссылка"
                class="external-link-icon"
              />
            </a>
          </div>

          <!-- Поиск на IMDb, если нет ID -->
          <div v-if="!movieInfo.imdb_id && movieInfo.title">
            <a
              :href="`https://www.imdb.com/find/?q=${encodeURIComponent(movieInfo.title + (movieInfo.year ? ' ' + movieInfo.year : ''))}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rating-link"
              :title="
                movieInfo.rating_imdb_vote_count
                  ? `Оценок: ${formatRatingNumber(movieInfo.rating_imdb_vote_count)}`
                  : 'Нет данных о количестве голосов'
              "
            >
              <img src="/src/assets/icon-imdb-logo.svg" alt="IMDb" class="rating-logo" />
              <span class="rating-value" :class="getRatingColor(movieInfo.rating_imdb)">
                {{ movieInfo.rating_imdb ? movieInfo.rating_imdb : '—' }}
              </span>
              <img
                src="/src/assets/icon-external-link.png"
                alt="Внешняя ссылка"
                class="external-link-icon"
              />
            </a>
          </div>

          <!-- Shikimori -->
          <div v-if="movieInfo.shikimori_id">
            <a
              :href="`https://shikimori.one/animes/${movieInfo.shikimori_id}`"
              target="_blank"
              rel="noopener noreferrer"
              class="rating-link"
            >
              <img src="/src/assets/icon-shikimori.svg" alt="Shiki" class="rating-logo" />
              <img
                src="/src/assets/icon-external-link.png"
                alt="Внешняя ссылка"
                class="external-link-icon"
              />
            </a>
          </div>

          <span class="action-buttons-group">
            <!-- Кнопка "В избранное" -->
            <button
              class="favorite-btn"
              :class="{ 'is-favorite': isFav }"
              :title="isFav ? 'Убрать из избранного' : 'Добавить в избранное'"
              @click="toggleFavorite"
            >
              <AppIcon name="heart" :size="16" :filled="!!isFav" />
              <span>{{ isFav ? 'В избранном' : 'В избранное' }}</span>
            </button>

          </span>
        </div>

        <!-- Навигация случайных фильмов -->
        <div v-if="randomHistoryStore.isActive" class="random-nav">
          <button
            class="random-nav-btn"
            :disabled="!randomHistoryStore.hasPrev"
            title="Предыдущий случайный"
            @click="goToPrevRandom"
          >
            <AppIcon name="back" :size="16" />
            Пред.
          </button>
          <span class="random-nav-counter">
            Случайный {{ randomHistoryStore.currentIndex + 1 }}/{{ randomHistoryStore.history.length }}
          </span>
          <button
            class="random-nav-btn"
            :disabled="randomLoadingNext"
            :title="randomHistoryStore.hasNext ? 'Следующий случайный' : 'Получить новый случайный'"
            @click="goToNextRandom"
          >
            <template v-if="randomLoadingNext">
              <AppIcon name="loading" :size="16" class="spin" />
            </template>
            <template v-else>
              След.
              <AppIcon name="forward" :size="16" />
            </template>
          </button>
        </div>

        <!-- Заглушка если не залогинен -->
        <div v-if="!authStore.token" class="auth-gate">
          <div class="auth-gate-content">
            <AppIcon name="lock" :size="16" class="auth-gate-icon" />
            <h3 class="auth-gate-title">Войдите, чтобы смотреть</h3>
            <p class="auth-gate-text">
              Просмотр фильмов и сериалов доступен только авторизованным пользователям
            </p>
            <router-link to="/login" class="auth-gate-btn">
              <AppIcon name="login" :size="16" />
              Войти через Telegram
            </router-link>
          </div>
        </div>

        <!-- Обёртка плеера -->
        <div class="player-wrapper">
          <!-- Интеграция компонента плеера -->
          <component
            :is="moviePlayerComponent"
            v-if="authStore.token && clientReady && moviePlayerComponent"
            :key="kp_id"
            :kp-id="kp_id"
            :movie-info="movieInfo"
            @update:movie-info="fetchMovieInfo"
          />
        </div>

        <div class="additional-info">
          <h2 class="additional-info-title">Подробнее</h2>
          <div class="info-content">
            <div v-if="movieInfo.poster_url" class="movie-poster-container desktop-only">
              <a :href="movieInfo.poster_url" target="_blank" rel="noopener noreferrer">
                <img :src="movieInfo.poster_url" alt="Постер фильма" class="movie-poster" />
              </a>
            </div>
            <div class="details-container">
              <ul class="info-list">
                <li v-if="movieInfo.type && TYPES_ENUM[movieInfo.type]">
                  <strong>Тип:</strong> {{ TYPES_ENUM[movieInfo.type] }}
                </li>
                <li v-if="movieInfo.year"><strong>Год выпуска:</strong> {{ movieInfo.year }}</li>
                <li v-if="movieInfo.title"><strong>Название:</strong> {{ movieInfo.title }}</li>
                <li v-if="movieInfo.name_original">
                  <strong>Оригинальное название:</strong> {{ movieInfo.name_original }}
                </li>
                <li v-if="movieInfo.slogan"><strong>Слоган:</strong> {{ movieInfo.slogan }}</li>
                <li v-if="movieInfo.production_companies">
                  <strong>Продакшн:</strong> {{ movieInfo.production_companies }}
                </li>
                <li v-if="movieInfo.countries?.length">
                  <strong>Страна производства:</strong>
                  {{ movieInfo.countries.map((item) => item.country).join(', ') }}
                </li>
                <li v-if="movieInfo.genres?.length">
                  <strong>Жанры:</strong>
                  {{ movieInfo.genres.map((item) => item.genre).join(', ') }}
                </li>
                <li v-if="movieInfo.film_length">
                  <strong>{{ isSeries ? 'Длительность серии:' : 'Продолжительность:' }}</strong>
                  {{ formatTime(movieInfo.film_length) }}
                </li>
                <li
                  v-if="movieInfo.rating_mpaa || movieInfo.rating_age_limits"
                  class="rating-boxes"
                >
                  <div v-if="movieInfo.rating_mpaa" class="rating-box mpaa">
                    <strong>MPAA</strong>
                    <span>{{ movieInfo.rating_mpaa.toUpperCase() }}</span>
                  </div>
                  <div v-if="movieInfo.rating_age_limits" class="rating-box age">
                    <strong>{{ movieInfo.rating_age_limits.replace('age', '') }}+</strong>
                  </div>
                </li>
              </ul>
              <div class="content-info">
                <p v-if="movieInfo.description" class="content-description-text">
                  {{ movieInfo.description }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="movieInfo.staff" class="staff-section">
          <div class="staff-categories">
            <div v-if="getStaffByProfession('ACTOR').length" class="staff-category">
              <h3 class="additional-info-title">Актёры</h3>
              <div class="staff-list">
                <div
                  v-for="person in getStaffByProfession('ACTOR').slice(0, 12)"
                  :key="person.staff_id"
                  class="staff-item"
                >
                  <a
                    :href="`https://www.kinopoisk.ru/name/${person.staff_id}/`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="staff-link"
                    :title="person.description || ''"
                  >
                    <img :src="person.poster_url" :alt="person.name_ru" class="staff-photo" />
                    <span class="staff-name">{{ person.name_ru || person.name_en }}</span>
                    <span v-if="person.description" class="staff-role">{{
                      person.description
                    }}</span>
                  </a>
                </div>
                <a
                  class="expand-actors-circle-button"
                  :href="`https://www.kinopoisk.ru/film/${kp_id}/cast/`"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="`Показать всех ${getStaffByProfession('ACTOR').length} актеров`"
                >
                  +{{ getStaffByProfession('ACTOR').length - 12 }}
                </a>
              </div>
            </div>

            <div v-if="getStaffByProfession('DIRECTOR').length" class="staff-category">
              <h3 class="additional-info-title">Режиссёры</h3>
              <div class="staff-names-container">
                <div class="staff-names-list">
                  <a
                    v-for="person in getStaffByProfession('DIRECTOR').slice(0, 5)"
                    :key="person.staff_id"
                    :href="`https://www.kinopoisk.ru/name/${person.staff_id}/`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="staff-name-link"
                  >
                    {{ person.name_ru || person.name_en }}
                  </a>
                  <a
                    v-if="getStaffByProfession('DIRECTOR').length > 5"
                    class="expand-actors-circle-button"
                    :href="`https://www.kinopoisk.ru/film/${kp_id}/cast/`"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="`Показать всех ${getStaffByProfession('DIRECTOR').length} режиссёров`"
                  >
                    +{{ getStaffByProfession('DIRECTOR').length - 5 }}
                  </a>
                </div>
              </div>
            </div>

            <div v-if="getStaffByProfession('PRODUCER').length" class="staff-category">
              <h3 class="additional-info-title">Продюсеры</h3>
              <div class="staff-names-container">
                <div class="staff-names-list">
                  <a
                    v-for="person in getStaffByProfession('PRODUCER').slice(0, 5)"
                    :key="person.staff_id"
                    :href="`https://www.kinopoisk.ru/name/${person.staff_id}/`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="staff-name-link"
                  >
                    {{ person.name_ru || person.name_en }}
                  </a>
                  <a
                    v-if="getStaffByProfession('PRODUCER').length > 5"
                    class="expand-actors-circle-button"
                    :href="`https://www.kinopoisk.ru/film/${kp_id}/cast/`"
                    target="_blank"
                    rel="noopener noreferrer"
                    :title="`Показать всех ${getStaffByProfession('PRODUCER').length} продюсеров`"
                  >
                    +{{ getStaffByProfession('PRODUCER').length - 5 }}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="videos.length && areTrailersActive" class="yt-video-container">
          <TrailerCarousel
            :videos="videos"
            :active-video-index="activeTrailerIndex"
            @select="playTrailer"
          />
        </div>

      </div>
    </div>
  </div>
  <Notification ref="notificationRef" />
</template>

<script setup>
import { getKpInfo } from '@/api/movies'
import AppIcon from '@/components/icons/AppIcon.vue'
import { handleApiError } from '@/constants'
import { addToList } from '@/api/user'
import ErrorMessage from '@/components/ErrorMessage.vue'
import SpinnerLoading from '@/components/SpinnerLoading.vue'
import { TYPES_ENUM, USER_LIST_TYPES_ENUM } from '@/constants'
import { useBackgroundStore } from '@/store/background'
import { useMainStore } from '@/store/main'
import { useAuthStore } from '@/store/auth'
import { useFavoritesStore } from '@/store/favorites'
import { useRandomHistoryStore } from '@/store/randomHistory'
import { useNavbarStore } from '@/store/navbar'
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import Notification from '@/components/notification/ToastMessage.vue'
import TrailerCarousel from '@/components/TrailerCarousel.vue'
import { useTrailerStore } from '@/store/trailer'
import { getRatingColor } from '@/utils/ratingUtils'
import { buildMovieSeo, getMovieSeoEntry, getMovieSeoPath, getMovieSeoSlug } from '@/utils/movieSeo'

const mainStore = useMainStore()
const authStore = useAuthStore()
const randomHistoryStore = useRandomHistoryStore()
const favoritesStore = useFavoritesStore()

const isFav = computed(() => {
  const id = movieInfo.value?.kinopoisk_id || movieInfo.value?.kp_id || kp_id.value
  if (!id) return false
  return favoritesStore.favorites.some((m) => String(m.kp_id) === String(id))
})


const toggleFavorite = () => {
  const id = movieInfo.value?.kinopoisk_id || movieInfo.value?.kp_id || kp_id.value
  if (!id) return
  favoritesStore.toggle({
    kp_id: id,
    title: movieInfo.value?.name_ru || movieInfo.value?.title || '',
    slug: movieInfo.value?.slug || '',
    year: movieInfo.value?.year || '',
    type: movieInfo.value?.type || '',
    poster: movieInfo.value?.cover || movieInfo.value?.poster || movieInfo.value?.poster_url_preview || '',
    rating_kp: movieInfo.value?.rating_kinopoisk || movieInfo.value?.rating_kp || '',
    rating_imdb: movieInfo.value?.rating_imdb || ''
  })
}

const goToPrevRandom = () => {
  randomHistoryStore._load()
  randomHistoryStore.goToPrev()
  const movie = randomHistoryStore.currentMovie
  if (movie?.kp_id) router.push(getMovieSeoPath(movie))
}

const randomLoadingNext = ref(false)

const goToNextRandom = async () => {
  randomHistoryStore._load()
  if (randomHistoryStore.hasNext) {
    // Есть следующий в истории — просто переключаем
    randomHistoryStore.goToNext()
    const movie = randomHistoryStore.currentMovie
    if (movie?.kp_id) router.push(getMovieSeoPath(movie))
  } else {
    // Истории дальше нет — берём новый случайный
    randomLoadingNext.value = true
    try {
      const { getRandomMovie } = await import('@/api/movies')
      const movie = await getRandomMovie()
      if (movie?.kp_id) {
        randomHistoryStore.addMovie(movie)
        router.push(getMovieSeoPath(movie))
      }
    } catch (e) {
      console.error('Failed to get random movie', e)
    } finally {
      randomLoadingNext.value = false
    }
  }
}
const backgroundStore = useBackgroundStore()
const route = useRoute()
const router = useRouter()
const kp_id = ref(route.params.kp_id)

const errorMessage = ref('')
const errorCode = ref(null)
const moviePlayerComponent = ref(null)
const initialSeoEntry = getMovieSeoEntry(route.params.kp_id)
const infoLoading = ref(!initialSeoEntry)
const movieInfo = ref(
  initialSeoEntry
    ? {
        kp_id: initialSeoEntry.kp_id,
        kinopoisk_id: initialSeoEntry.kp_id,
        title: initialSeoEntry.title,
        name_ru: initialSeoEntry.title,
        year: initialSeoEntry.year,
        description: initialSeoEntry.description,
        poster_url: initialSeoEntry.poster
      }
    : null
)
const navbarStore = useNavbarStore()
const trailerStore = useTrailerStore()
const notificationRef = ref(null)
const clientReady = ref(false)

const areTrailersActive = computed(() => trailerStore.areTrailersActive)
const activeTrailerIndex = ref(null)
const syncCanonicalMovieRoute = async () => {
  if (!movieInfo.value) {
    return
  }

  const canonicalPath = getMovieSeoPath(movieInfo.value, kp_id.value)
  const targetLocation = {
    path: canonicalPath,
    query: route.query,
    hash: route.hash
  }

  const resolvedTarget = router.resolve(targetLocation)

  if (typeof window !== 'undefined') {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

    if (currentUrl !== resolvedTarget.href) {
      await router.replace(targetLocation)
    }
  }
}

const seoMeta = computed(() => buildMovieSeo(movieInfo.value || {}, kp_id.value))

useHead(() => {
  const seo = seoMeta.value
  const titleBase =
    movieInfo.value?.title || movieInfo.value?.name_ru || movieInfo.value?.name_original || ''

  return {
    title: seo.title,
    link: [
      {
        rel: 'canonical',
        href: seo.canonicalUrl
      }
    ],
    meta: [
      {
        name: 'description',
        content: seo.description
      },
      {
        property: 'og:type',
        content: seo.type
      },
      {
        property: 'og:title',
        content: seo.title
      },
      {
        property: 'og:description',
        content: seo.description
      },
      {
        property: 'og:url',
        content: seo.canonicalUrl
      },
      {
        property: 'og:image',
        content: seo.poster
      },
      {
        name: 'twitter:card',
        content: seo.poster ? 'summary_large_image' : 'summary'
      },
      {
        name: 'twitter:title',
        content: seo.title
      },
      {
        name: 'twitter:description',
        content: seo.description
      },
      {
        name: 'twitter:image',
        content: seo.poster
      }
    ].filter((entry) => entry.content),
    script: titleBase
      ? [
          {
            type: 'application/ld+json',
            textContent: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Movie',
              name: titleBase,
              description: seo.description,
              image: seo.poster || undefined,
              datePublished: movieInfo.value?.year || undefined,
              url: seo.canonicalUrl
            })
          }
        ]
      : []
  }
})

const formatRatingNumber = (num) => {
  if (!num) return '0'
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

// Без нулевых частей: у сериала было «0 ч. 43 мин.», у ровного фильма — «2 ч. 0 мин.».
const formatTime = (minutes) => {
  if (typeof minutes !== 'number' || minutes <= 0) {
    return
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (!hours) return `${mins} мин.`
  if (!mins) return `${hours} ч.`
  return `${hours} ч. ${mins} мин.`
}

// У сериала kinobd отдаёт длительность одной серии, а не всего сериала.
const isSeries = computed(() =>
  /serial|series|tv_series/i.test(String(movieInfo.value?.type || movieInfo.value?.raw_data?.type || ''))
)

const titleCopyTooltip = ref(false)
const tooltipStyle = ref({ top: '0px', left: '0px' })
const moveTooltip = (event) => {
  titleCopyTooltip.value = true
  tooltipStyle.value = {
    top: `${event.pageY + 10}px`,
    left: `${event.pageX - 70}px`
  }
}

const copyMovieMeta = async () => {
  try {
    const movieMeta = [
      movieInfo.value.name_ru || movieInfo.value.name_en || movieInfo.value.name_original,
      ...(movieInfo.value.year ? [movieInfo.value.year] : []),
      ...(movieInfo.value.film_length ? [formatTime(movieInfo.value.film_length)] : [])
    ]
    await navigator.clipboard.writeText(movieMeta.join(', '))
    notificationRef.value.showNotification('Скопировано')
  } catch (err) {
    console.error('Ошибка копирования:', err)
  }
}

const fetchMovieInfo = async (updateHistory = true) => {
  try {
    const response = await getKpInfo(kp_id.value, authStore.token)

    if (Array.isArray(response) && response.length === 0) {
      throw new Error('Данные не найдены. Пожалуйста, повторите поиск.')
    }

    movieInfo.value = response

    movieInfo.value = {
      ...movieInfo.value,
      title: movieInfo.value.name_ru || movieInfo.value.name_en || movieInfo.value.name_original,
      kinopoisk_id: kp_id.value
    }

    navbarStore.setHeaderContent({
      text: movieInfo.value.title,
      imageUrl: movieInfo.value.logo_url
    })

    await syncCanonicalMovieRoute()

    const movieToSave = {
      kp_id: kp_id.value,
      title: movieInfo.value?.name_ru || movieInfo.value?.name_en || movieInfo.value?.name_original,
      slug: getMovieSeoSlug(movieInfo.value, kp_id.value),
      poster:
        movieInfo.value?.poster_url ||
        movieInfo.value?.cover_url ||
        movieInfo.value?.screenshots?.[0],
      year: movieInfo.value?.year,
      type: movieInfo.value?.type
    }

    // Устанавливаем фон фильма через новый метод
    if (movieToSave.poster) {
      backgroundStore.updateMoviePoster(movieToSave.poster)
    }

    const isHistoryAllowed = computed(() => mainStore.isHistoryAllowed)

    if (isHistoryAllowed.value && movieToSave.kp_id && movieToSave.title && updateHistory) {
      if (authStore.token) {
        mainStore.addToHistory({ ...movieToSave })
        try {
          // Передаём весь объект movieToSave чтобы на сервере сохранить
          // title, poster, year — иначе при чтении истории карточки будут пустыми ("Без названия").
          await addToList(movieToSave.kp_id, USER_LIST_TYPES_ENUM.HISTORY, movieToSave)
        } catch (error) {
          console.error('Ошибка при добавлении в историю:', error)
        }
      } else {
        mainStore.addToHistory({ ...movieToSave })
      }
    }
  } catch (error) {
    console.error('Ошибка при загрузке информации о фильмах:', error)

    // Описание и плееры грузятся разными запросами. Если описание не
    // пришло, плеер всё равно может работать — и показывать ошибку во весь
    // экран незачем: смотреть можно. Раньше баннер висел поверх рабочего
    // плеера, и помогала только перезагрузка страницы вручную.
    //
    // Собираем минимальную карточку из того, что знаем и без запроса:
    // идентификатор из адреса и заголовок из SEO-справочника.
    if (!movieInfo.value && kp_id.value) {
      const fallbackEntry = getMovieSeoEntry(kp_id.value)
      movieInfo.value = {
        kp_id: kp_id.value,
        title: fallbackEntry?.title || fallbackEntry?.name_ru || 'Без названия',
        year: fallbackEntry?.year || '',
        description: '',
        raw_data: {}
      }
      console.warn('[movie] описание не загрузилось — показываем минимум, плеер не трогаем')
      return
    }

    const { message, code } = handleApiError(error)
    errorMessage.value = message
    errorCode.value = code
  }
}

const videos = computed(() => {
  return movieInfo.value?.videos || []
})

const onKeyDown = (event) => {
  if (event.altKey && event.keyCode === 84) {
    const playerComponent = document.querySelector('.player-container')
    if (playerComponent) {
      const theaterModeBtn = document.querySelector('.theater-mode-btn')
      if (theaterModeBtn) {
        theaterModeBtn.click()
      }
    }
  }
}

onMounted(async () => {
  clientReady.value = true
  randomHistoryStore._load()
  // Если текущий фильм НЕ из random-истории — выходим из random-режима
  // (это случай когда юзер был в случайном, потом открыл обычный фильм с главной)
  syncRandomState()
  // markRaw обязателен: без него Vue делает реактивным весь объект компонента
  // и предупреждает о лишних затратах. Компонент не меняется — следить не за чем.
  moviePlayerComponent.value = markRaw((await import('@/components/PlayerComponent.vue')).default)
  await fetchMovieInfo()
  infoLoading.value = false
  document.addEventListener('keydown', onKeyDown)
})

// Сравниваем текущий фильм с тем что в random-истории.
// Если не совпадает — сбрасываем currentIndex (random-режим выключен).
const syncRandomState = () => {
  randomHistoryStore._load()
  const cur = randomHistoryStore.currentMovie
  if (!cur) return
  const curId = String(cur.kp_id || cur.kinopoisk_id || '')
  const myId = String(kp_id.value || '')
  if (curId && myId && curId !== myId) {
    // Юзер ушёл с random на обычный фильм — выходим из режима
    randomHistoryStore.currentIndex = -1
    randomHistoryStore._sync()
  }
}

onUnmounted(async () => {
  navbarStore.clearHeaderContent()
  document.removeEventListener('keydown', onKeyDown)
})

watch(
  () => route.params.kp_id,
  async (newKpId) => {
    if (newKpId && newKpId !== kp_id.value) {
      navbarStore.clearHeaderContent()
      kp_id.value = newKpId
      activeTrailerIndex.value = null
      syncRandomState()
      await fetchMovieInfo()
      infoLoading.value = false
    }
  },
  { immediate: true }
)

const getStaffByProfession = (profession) => {
  return movieInfo.value?.staff?.filter((person) => person.profession_key === profession) || []
}

</script>

<style scoped>
@import './MovieInfo.styles.css';
</style>
