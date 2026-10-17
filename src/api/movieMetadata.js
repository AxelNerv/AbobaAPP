import axios from 'axios'
import { getBackendUrl } from './backendUrl'

const FIELDS = ['description', 'poster_url', 'poster_url_preview', 'backdrop_url', 'imdb_id',
  'film_length', 'episodes_count', 'seasons_count', 'rating_imdb', 'rating_tmdb', 'rating_anilist']
const imageHosts = new Set(['image.tmdb.org', 'm.media-amazon.com', 's4.anilist.co'])
const safeImage = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && imageHosts.has(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443')
  } catch { return false }
}
const generatedPoster = (value) => !value || value.startsWith('data:') ||
  /^https:\/\/(kinopoiskapiunofficial\.tech\/images\/posters\/|st\.kp\.yandex\.net\/images\/film_)/.test(value)

export const metadataRequest = (movie) => {
  const year = Number.parseInt(movie.year, 10)
  const imdb = String(movie.imdb_id || movie.imdbId || '')
  const kind = String(movie.type || '')
  return {
    kp_id: String(movie.kp_id || movie.kinopoisk_id || ''),
    title: String(movie.title || movie.name_ru || '').slice(0, 300),
    original_title: String(movie.name_original || movie.name_en || '').slice(0, 300),
    year: Number.isInteger(year) && year >= 1800 && year <= 2200 ? year : null,
    imdb_id: /^tt\d{5,12}$/.test(imdb) ? imdb : '',
    kind: /series|serial|show/i.test(kind) ? 'series' : 'movie',
    anime: /anime|аниме/i.test(kind) || (Array.isArray(movie.genres) ? movie.genres : []).some(g => /^(anime|аниме)$/i.test(typeof g === 'string' ? g : g?.genre))
  }
}

export const applyMovieMetadata = (movie, data) => {
  if (String(movie.kp_id || movie.kinopoisk_id) !== String(data?.kp_id) ||
      !data?.fields || typeof data.fields !== 'object' || Array.isArray(data.fields) ||
      !Array.isArray(data.sources) || !data.providers || typeof data.providers !== 'object') {
    throw new Error('Некорректные дополнительные данные фильма')
  }
  const next = { ...movie }
  for (const field of FIELDS) {
    const value = data.fields[field]
    if (value == null || value === '') continue
    if (/^(poster_|backdrop_)/.test(field) && !safeImage(value)) continue
    if (/^(rating_|film_length|episodes_count|seasons_count)/.test(field) &&
        (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) continue
    if (['description', 'imdb_id'].includes(field) && typeof value !== 'string') continue
    const missing = next[field] == null || next[field] === ''
    if (missing || (field.startsWith('poster_') && generatedPoster(next[field]))) next[field] = value
  }
  next.metadata_sources = data.sources
  return next
}

/** Each navigation cancels the old consumer; late replies cannot change a new film. */
export const createMovieMetadataLoader = (onResult) => {
  let controller
  let sequence = 0
  const cancel = () => { sequence++; controller?.abort() }
  const load = async (movie) => {
    cancel()
    const request = sequence
    controller = new AbortController()
    const signal = controller.signal
    try {
      const payload = metadataRequest(movie)
      if (!payload.title || !/^[1-9]\d{0,11}$/.test(payload.kp_id)) return
      const { data } = await axios.post(`${getBackendUrl()}/metadata/enrich`, payload, { signal, timeout: 7000 })
      if (signal.aborted || request !== sequence) return
      const enriched = applyMovieMetadata(movie, data)
      for (const [provider, status] of Object.entries(data.providers)) {
        if (status === 'unavailable') console.warn(`[metadata] ${provider}: источник временно недоступен`)
      }
      onResult(enriched)
    } catch (error) {
      if (!signal.aborted && request === sequence) console.warn('[metadata] дополнительные данные недоступны:', error?.message || error)
    }
  }
  return { load, cancel }
}
