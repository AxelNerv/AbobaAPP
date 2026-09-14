/**
 * TMDB — «донор» недостающих метаданных (описание, постер).
 *
 * Зачем: rhserv периодически уходит в бан (403/429), а kinobd не для всех
 * тайтлов отдаёт описание и нормальный постер. TMDB бесплатен, стабилен и
 * не банит по IP, поэтому используется чтобы закрыть дыры в карточке фильма.
 *
 * Ключ НЕ хранится во фронте: запросы идут на наш бэкенд-прокси (/ext/tmdb/...),
 * а он подставляет TMDB_API_KEY server-side. Любая VITE_-переменная попала бы
 * в публичный бандл.
 */
import axios from 'axios'
import { getBackendUrl } from '@/api/backendUrl'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

let apiInstance = null

// Если ключ на сервере не задан, прокси отвечает 503. Нет смысла долбиться в
// него на каждом фильме без описания — после первого отказа выключаем TMDB
// до перезагрузки вкладки. Появится ключ — заработает само.
let isDisabled = false

const getApi = () => {
  if (!apiInstance) {
    apiInstance = axios.create({
      baseURL: `${getBackendUrl()}/ext/tmdb/3`,
      timeout: 10000
    })
  }
  return apiInstance
}

const posterUrl = (path, size = 'w500') => (path ? `${TMDB_IMAGE_BASE}/${size}${path}` : '')

// Из ответа TMDB достаём только то, ради чего пришли.
const pickFields = (item) => {
  if (!item) return null
  return {
    description: item.overview || '',
    poster_url: posterUrl(item.poster_path, 'original'),
    poster_url_preview: posterUrl(item.poster_path, 'w500'),
    rating_tmdb: typeof item.vote_average === 'number' ? item.vote_average : null
  }
}

/**
 * Точный поиск по IMDB-id. Самый надёжный путь: без риска поймать однофамильца.
 */
const findByImdbId = async (imdbId) => {
  if (!imdbId) return null
  const { data } = await getApi().get(`/find/${encodeURIComponent(imdbId)}`, {
    params: { external_source: 'imdb_id', language: 'ru-RU' }
  })
  const hit =
    data?.movie_results?.[0] || data?.tv_results?.[0] || null
  return pickFields(hit)
}

/**
 * Запасной путь, когда IMDB-id неизвестен — поиск по названию.
 * Год сужает выдачу, иначе легко поймать ремейк или тёзку.
 */
const searchByTitle = async (title, year = null) => {
  const query = String(title || '').trim()
  if (!query) return null

  const { data } = await getApi().get('/search/multi', {
    params: { query, language: 'ru-RU', include_adult: false }
  })

  const results = Array.isArray(data?.results) ? data.results : []
  if (!results.length) return null

  // Если знаем год — предпочитаем совпадение по нему.
  let best = results[0]
  if (year) {
    const y = String(year)
    const sameYear = results.find((r) => {
      const d = r.release_date || r.first_air_date || ''
      return d.startsWith(y)
    })
    if (sameYear) best = sameYear
  }
  return pickFields(best)
}

/**
 * Дополняет карточку фильма недостающими описанием/постером.
 * Ничего не перезаписывает: то, что источник уже дал, остаётся как есть.
 * При любой ошибке возвращает исходный объект — TMDB не должен ломать страницу.
 */
const enrichMissingFields = async (movie) => {
  if (!movie || isDisabled) return movie

  const needsDescription = !movie.description && !movie.short_description
  const needsPoster = !movie.poster_url
  if (!needsDescription && !needsPoster) return movie

  try {
    const fromTmdb =
      (await findByImdbId(movie.imdb_id)) ||
      (await searchByTitle(movie.name_ru || movie.name_en || movie.name_original, movie.year))

    if (!fromTmdb) return movie

    const patch = {}
    if (needsDescription && fromTmdb.description) {
      patch.description = fromTmdb.description
      patch.short_description = fromTmdb.description
    }
    if (needsPoster && fromTmdb.poster_url) {
      patch.poster_url = fromTmdb.poster_url
      patch.poster_url_preview = fromTmdb.poster_url_preview
    }
    if (fromTmdb.rating_tmdb !== null) patch.rating_tmdb = fromTmdb.rating_tmdb

    return Object.keys(patch).length ? { ...movie, ...patch } : movie
  } catch (error) {
    // 503 = TMDB_API_KEY не задан на бэкенде. Это не сбой сети, повторять нечего.
    if (error?.response?.status === 503) {
      isDisabled = true
      console.info('[tmdb] ключ не настроен — обогащение отключено')
    } else {
      console.warn('[tmdb] обогащение не удалось:', error?.message)
    }
    return movie
  }
}

export { findByImdbId, searchByTitle, enrichMissingFields }
