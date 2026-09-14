<template>
  <transition name="modal">
    <div v-if="isOpen" class="modal-overlay" @click.self="close">
      <div class="rnd-modal">
        <button class="close-x" @click="close">
          <AppIcon name="close" :size="16" />
        </button>

        <div class="rnd-header">
          <AppIcon name="random" :size="18" class="accent-icon" />
          <span>Случайный фильм</span>
        </div>

        <div class="year-filter">
          <label class="yf-label">Год:</label>
          <input
            v-model.number="yearFrom"
            type="number"
            class="yf-input"
            placeholder="от"
            :min="1900"
            :max="currentYear"
          />
          <span class="yf-dash">—</span>
          <input
            v-model.number="yearTo"
            type="number"
            class="yf-input"
            placeholder="до"
            :min="1900"
            :max="currentYear"
          />
          <button class="yf-apply" :disabled="loading" @click="applyYearFilter">
            Применить
          </button>
          <button v-if="yearFrom || yearTo" class="yf-reset" @click="resetYearFilter">
            ✕
          </button>
        </div>

        <div class="divider"></div>

        <div v-if="loading" class="loading-container">
          <div class="spinner"></div>
          <p>Подбираем фильм...</p>
        </div>

        <div v-else-if="error" class="error-container">
          <AppIcon name="warning" :size="16" />
          <p>{{ error }}</p>
          <button class="primary-btn" @click="onGetNew">Попробовать ещё раз</button>
        </div>

        <div v-else-if="currentMovie" class="movie-body">
          <div class="top-row">
            <div class="poster-wrap">
              <img
                v-if="(currentMovie.cover || currentMovie.poster) && !posterError"
                :src="currentMovie.cover || currentMovie.poster"
                :alt="currentMovie.title"
                class="poster"
                @error="posterError = true"
              />
              <div v-else class="poster poster-fallback">
                <AppIcon name="movie" :size="16" />
              </div>
            </div>

            <div class="info">
              <h3 class="title">{{ currentMovie.title || currentMovie.name_ru || 'Фильм' }}</h3>
              <div v-if="currentMovie.year" class="year">{{ currentMovie.year }}</div>
              <div v-if="movieType" class="type-badge">{{ movieType }}</div>

              <div class="description">
                {{ currentMovie.description || currentMovie.short_description || 'Описание отсутствует' }}
              </div>
            </div>
          </div>

          <div v-if="countries" class="meta-row">
            <span class="meta-label">Страны:</span>
            <span class="meta-val">{{ countries }}</span>
          </div>

          <div v-if="genres" class="meta-row">
            <span class="meta-label">Жанры:</span>
            <span class="meta-val">{{ genres }}</span>
          </div>

          <div v-if="currentMovie.rating_kp || currentMovie.rating_imdb" class="ratings-row">
            <span v-if="currentMovie.rating_kp" class="rating-pill rating-kp">
              <img src="@/assets/icon-kp-logo.svg" alt="КП" />
              {{ currentMovie.rating_kp }}
            </span>
            <span v-if="currentMovie.rating_imdb" class="rating-pill rating-imdb">
              <img src="@/assets/icon-imdb-logo.svg" alt="IMDb" />
              {{ currentMovie.rating_imdb }}
            </span>
          </div>

          <div v-if="currentMovie.kp_id || currentMovie.imdb_id" class="external-links">
            <a
              v-if="currentMovie.kp_id"
              :href="`https://www.kinopoisk.ru/film/${currentMovie.kp_id}/`"
              target="_blank"
              class="ext-btn"
            >
              <img src="@/assets/icon-kp-logo.svg" alt="КП" />
              Кинопоиск
            </a>
            <a
              v-if="currentMovie.imdb_id"
              :href="`https://www.imdb.com/title/${currentMovie.imdb_id}/`"
              target="_blank"
              class="ext-btn"
            >
              <img src="@/assets/icon-imdb-logo.svg" alt="IMDb" />
              IMDb
            </a>
          </div>
        </div>

        <div class="footer">
          <button class="foot-btn close-btn-ft" @click="close">Закрыть</button>

          <div class="nav-arrows">
            <button
              class="arrow-btn"
              :disabled="!randomHistoryStore.hasPrev"
              @click="goPrev"
            >
              <AppIcon name="back" :size="16" />
            </button>
            <button
              class="arrow-btn"
              @click="goNext"
            >
              <AppIcon name="forward" :size="16" />
            </button>
          </div>

          <button
            class="foot-btn watch-btn"
            :disabled="!currentMovie || !currentMovie.kp_id || loading"
            @click="goToMovie"
          >
            Посмотреть
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import AppIcon from '@/components/icons/AppIcon.vue'
import { useRouter } from 'vue-router'
import { useRandomHistoryStore } from '@/store/randomHistory'
import { getMovieSeoPath } from '@/utils/movieSeo'

const props = defineProps({
  isOpen: Boolean,
  movie: Object,
  loading: Boolean,
  error: String
})
const emit = defineEmits(['close', 'getNewMovie'])

const router = useRouter()
const randomHistoryStore = useRandomHistoryStore()
const posterError = ref(false)

// Фильтр по годам
const currentYear = new Date().getFullYear()
const yearFrom = ref(null)
const yearTo = ref(null)

const applyYearFilter = () => {
  emit('getNewMovie', { yearFrom: yearFrom.value || null, yearTo: yearTo.value || null })
}
const resetYearFilter = () => {
  yearFrom.value = null
  yearTo.value = null
  emit('getNewMovie', {})
}

const currentMovie = computed(() => {
  if (props.movie) return props.movie
  return randomHistoryStore.currentMovie
})

const movieType = computed(() => {
  let t = currentMovie.value?.type
  if (!t) return ''
  // Убираем префикс "FilmType." если есть (приходит из Python enum)
  t = String(t).replace(/^FilmType\./i, '')
  const map = {
    FILM: 'ФИЛЬМ',
    TV_SERIES: 'СЕРИАЛ',
    MINI_SERIES: 'МИНИ-СЕРИАЛ',
    TV_SHOW: 'ШОУ',
    VIDEO: 'ВИДЕО',
    UNKNOWN: ''
  }
  return map[t] || t
})

const countries = computed(() => {
  const c = currentMovie.value?.countries
  if (!c) return ''
  if (Array.isArray(c)) return c.map(x => x.country || x).join(', ')
  return String(c)
})

const genres = computed(() => {
  const g = currentMovie.value?.genres
  if (!g) return ''
  if (Array.isArray(g)) return g.map(x => x.genre || x).join(', ')
  return String(g)
})

watch(() => props.movie, (m) => {
  if (m && m.kp_id) {
    const existing = randomHistoryStore.currentMovie
    if (!existing || String(existing.kp_id) !== String(m.kp_id)) {
      randomHistoryStore.addMovie(m)
    }
  }
  posterError.value = false
})

const close = () => emit('close')
const onGetNew = () => emit('getNewMovie', { yearFrom: yearFrom.value || null, yearTo: yearTo.value || null })

const goPrev = () => {
  randomHistoryStore.goToPrev()
}
const goNext = () => {
  if (randomHistoryStore.hasNext) {
    randomHistoryStore.goToNext()
  } else {
    emit('getNewMovie', { yearFrom: yearFrom.value || null, yearTo: yearTo.value || null })
  }
}

const goToMovie = () => {
  const m = currentMovie.value
  if (!m?.kp_id) return
  const path = getMovieSeoPath(m)
  close()
  router.push(path)
}
</script>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.75);
  backdrop-filter: blur(6px);
  z-index: 200;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}

.rnd-modal {
  background: #0f1420;
  border: 1px solid rgba(0,229,255,0.18);
  border-radius: 16px;
  width: 760px; max-width: 100%;
  max-height: 90vh;
  position: relative;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(0,0,0,0.6);
  overflow: hidden;
}

.close-x {
  position: absolute; top: 14px; right: 16px;
  background: none; border: none;
  color: rgba(255,255,255,0.4);
  font-size: 18px; cursor: pointer;
  transition: color 0.15s;
  z-index: 2;
  &:hover { color: #fff; }
}

.rnd-header {
  padding: 22px 26px 10px;
  font-size: 16px; font-weight: 600;
  display: flex; align-items: center; gap: 10px;
  color: #fff;
}

.accent-icon {
  color: var(--accent-color);
  font-size: 18px;
}

.divider {
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(0,229,255,0.25), transparent);
  margin: 0 20px;
}

.year-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 26px 14px;
  flex-wrap: wrap;
}
.yf-label {
  font-size: 12px;
  color: rgba(255,255,255,0.5);
  font-weight: 500;
}
.yf-input {
  width: 70px;
  padding: 6px 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.yf-input:focus {
  border-color: rgba(0,229,255,0.5);
}
.yf-input::-webkit-inner-spin-button,
.yf-input::-webkit-outer-spin-button {
  -webkit-appearance: none; margin: 0;
}
.yf-dash {
  color: rgba(255,255,255,0.3);
  font-size: 12px;
}
.yf-apply {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(0,229,255,0.4);
  background: rgba(0,229,255,0.1);
  color: var(--accent-color);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.yf-apply:hover:not(:disabled) {
  background: rgba(0,229,255,0.2);
}
.yf-apply:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.yf-reset {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255,90,90,0.3);
  background: rgba(255,90,90,0.08);
  color: rgba(255,90,90,0.85);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.yf-reset:hover {
  background: rgba(255,90,90,0.18);
}

.movie-body {
  padding: 20px 26px;
  overflow-y: auto;
  flex: 1;
}

.top-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 20px;
  margin-bottom: 16px;
}

.poster-wrap {
  width: 180px;
  aspect-ratio: 2/3;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(255,255,255,0.04);
}

.poster {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}

.poster-fallback {
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #1a0a2e, #06081e);
  color: rgba(255,255,255,0.25);
  font-size: 48px;
}

.info { min-width: 0; }

.title {
  font-size: 19px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 6px;
  line-height: 1.3;
}

.year {
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  margin-bottom: 8px;
}

.type-badge {
  display: inline-block;
  background: rgba(0,229,255,0.12);
  border: 1px solid rgba(0,229,255,0.3);
  color: var(--accent-color);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 5px;
  margin-bottom: 12px;
}

.description {
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255,255,255,0.6);
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.05);
  padding: 10px 12px;
  border-radius: 8px;
  max-height: 140px;
  overflow-y: auto;
}

.meta-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  line-height: 1.5;
  flex-wrap: wrap;
}

.meta-label { color: rgba(255,255,255,0.4); flex-shrink: 0; }
.meta-val { color: rgba(255,255,255,0.75); }

.ratings-row {
  display: flex;
  gap: 10px;
  margin: 14px 0 12px;
  justify-content: center;
}

.rating-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 700;

  img { width: 16px; height: 16px; }
  &.rating-kp { color: #f5a623; }
  &.rating-imdb { color: #f5c518; }
}

.external-links {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: 10px;
}

.ext-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.75);
  border-radius: 8px;
  font-size: 12px;
  text-decoration: none;
  transition: all 0.15s;
  cursor: pointer;

  &:hover {
    border-color: rgba(0,229,255,0.3);
    color: var(--accent-color);
  }

  img { width: 14px; height: 14px; }
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  color: rgba(255,255,255,0.5);
  font-size: 13px;
}

.spinner {
  width: 36px; height: 36px;
  border: 3px solid rgba(0,229,255,0.15);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.error-container i { font-size: 28px; color: #ff5252; }

.primary-btn {
  padding: 8px 16px;
  background: rgba(0,229,255,0.08);
  border: 1px solid rgba(0,229,255,0.3);
  color: var(--accent-color);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s;
  &:hover { background: rgba(0,229,255,0.18); }
}

.footer {
  padding: 16px 26px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-top: 1px solid rgba(255,255,255,0.05);
  background: rgba(255,255,255,0.02);
}

.foot-btn {
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.75);

  &:hover:not(:disabled) {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.watch-btn {
  background: rgba(0,229,255,0.08) !important;
  border-color: rgba(0,229,255,0.35) !important;
  color: var(--accent-color) !important;

  &:hover:not(:disabled) {
    background: rgba(0,229,255,0.18) !important;
  }
}

.nav-arrows {
  display: flex;
  gap: 6px;
}

.arrow-btn {
  width: 36px; height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.6);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }
  &:disabled { opacity: 0.3; cursor: not-allowed; }
}

@keyframes spin { to { transform: rotate(360deg); } }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

@media (max-width: 600px) {
  .top-row { grid-template-columns: 1fr; }
  .poster-wrap { width: 140px; margin: 0 auto; }
  .rnd-modal { width: 100%; max-height: 100vh; border-radius: 0; }
  .footer { flex-wrap: wrap; }
}
</style>
