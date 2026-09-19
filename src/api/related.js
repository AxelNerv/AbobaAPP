/**
 * «Связанное» на странице фильма: продолжения/предыстории и похожие.
 * kinobd таких списков не отдаёт, rhserv больше нет — берём у
 * kinopoiskapiunofficial тем же ключом, что и для остального.
 */
const BASE = 'https://kinopoiskapiunofficial.tech/api'
const cache = new Map()
const REQUEST_TIMEOUT_MS = 7000
const MAX_CACHE_ENTRIES = 128

const toCard = (movie) => ({
  kp_id: movie.filmId,
  poster: movie.posterUrlPreview || movie.posterUrl,
  title: movie.nameRu || movie.nameEn || movie.nameOriginal
})

const getJson = async (path) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { 'X-API-KEY': import.meta.env.VITE_KP_UNOFFICIAL_KEY || '' },
      signal: controller.signal
    })
    // 404 — у фильма просто нет связанных; остальные статусы являются сбоем.
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Related API HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export const normalizeRelated = (sequels, similars, kpId) => {
  const seen = new Set([String(kpId)])
  const unique = (list) =>
    (Array.isArray(list) ? list : [])
      .map(toCard)
      .filter((card) => card.kp_id && card.title && !seen.has(String(card.kp_id)) && seen.add(String(card.kp_id)))
  const sequelCards = unique(sequels)
  return { sequels: sequelCards, similars: unique(similars?.items) }
}

export const getRelated = async (kpId) => {
  const key = String(kpId)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const request = Promise.allSettled([
    getJson(`/v2.1/films/${key}/sequels_and_prequels`),
    getJson(`/v2.2/films/${key}/similars`)
  ]).then((results) => {
    const [sequels, similars] = results.map((result) =>
      result.status === 'fulfilled' ? result.value : null)
    const related = normalizeRelated(sequels, similars, key)
    // Частичный/полный сбой и пустой ответ не закрепляем навсегда.
    if (results.some((result) => result.status === 'rejected') ||
        (!related.sequels.length && !related.similars.length)) {
      if (cache.get(key) === request) cache.delete(key)
    }
    return related
  })
  cache.set(key, request)
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  return request
}
