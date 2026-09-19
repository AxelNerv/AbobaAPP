import { getBackendUrl } from './backendUrl'

const BASE = `${getBackendUrl()}/ext/tvmaze`
const REQUEST_TIMEOUT_MS = 7000
const CACHE_TTL_MS = 30 * 60 * 1000
const MAX_CACHE_ENTRIES = 100
const cache = new Map()

const fetchJson = async (path, params = {}) => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item))
    else if (value !== undefined && value !== null && value !== '') search.set(key, value)
  }
  const query = search.toString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE}${path}${query ? `?${query}` : ''}`, {
      signal: controller.signal
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`TVmaze HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

const isSeries = (movie) =>
  /serial|series|tv_series|show/i.test(String(movie?.type || movie?.raw_data?.type || ''))

const normalizeImdb = (value) => {
  const match = /(?:tt)?(\d{5,12})/i.exec(String(value || ''))
  return match ? `tt${match[1]}` : ''
}

const cleanTitle = (movie) =>
  String(movie?.name_original || movie?.name_en || movie?.name_ru || movie?.title || '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim()

const statusLabel = (status) => ({
  Running: 'Выходит',
  Ended: 'Завершён',
  'To Be Determined': 'Статус уточняется',
  'In Development': 'В разработке'
})[status] || status || ''

const normalizeEpisode = (episode) => {
  if (!episode) return null
  return {
    id: episode.id,
    season: episode.season,
    number: episode.number,
    name: episode.name || '',
    airdate: episode.airdate || '',
    airtime: episode.airtime || '',
    url: episode.url || ''
  }
}

export const normalizeSeriesGuide = (show) => {
  if (!show?.id) return null
  return {
    id: show.id,
    status: show.status || '',
    statusLabel: statusLabel(show.status),
    premiered: show.premiered || '',
    ended: show.ended || '',
    sourceUrl: show.url || '',
    nextEpisode: normalizeEpisode(show._embedded?.nextepisode),
    previousEpisode: normalizeEpisode(show._embedded?.previousepisode)
  }
}

const findShow = async (movie) => {
  const imdb = normalizeImdb(movie?.imdb_id)
  if (imdb) return await fetchJson('/lookup/shows', { imdb })

  const title = cleanTitle(movie)
  if (!title) return null
  const show = await fetchJson('/singlesearch/shows', { q: title })
  const expectedYear = Number.parseInt(movie?.year, 10)
  const actualYear = Number.parseInt(String(show?.premiered || '').slice(0, 4), 10)
  if (Number.isFinite(expectedYear) && Number.isFinite(actualYear) && expectedYear !== actualYear) {
    return null
  }
  return show
}

const loadSeriesGuide = async (movie) => {
  const show = await findShow(movie)
  if (!show?.id) return null
  const detailed = await fetchJson(`/shows/${show.id}`, {
    'embed[]': ['nextepisode', 'previousepisode']
  })
  return normalizeSeriesGuide(detailed || show)
}

export const getSeriesGuide = async (movie) => {
  if (!isSeries(movie)) return null
  const imdb = normalizeImdb(movie?.imdb_id)
  const title = cleanTitle(movie)
  const key = imdb || `${title}:${movie?.year || ''}`
  if (!key) return null

  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.request
  if (cached) cache.delete(key)

  const request = loadSeriesGuide(movie).catch((error) => {
    if (cache.get(key)?.request === request) cache.delete(key)
    console.warn('[tvmaze] данные о сериале недоступны:', error?.message || error)
    return null
  })
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, request })
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  return request
}
