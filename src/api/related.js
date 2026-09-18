/**
 * «Связанное» на странице фильма: продолжения/предыстории и похожие.
 * kinobd таких списков не отдаёт, rhserv больше нет — берём у
 * kinopoiskapiunofficial тем же ключом, что и для остального.
 */
const BASE = 'https://kinopoiskapiunofficial.tech/api'
const cache = new Map()

const toCard = (movie) => ({
  kp_id: movie.filmId,
  poster: movie.posterUrlPreview || movie.posterUrl,
  title: movie.nameRu || movie.nameEn || movie.nameOriginal
})

const getJson = async (path) => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'X-API-KEY': import.meta.env.VITE_KP_UNOFFICIAL_KEY || '' }
  })
  // 404 — у фильма просто нет связанных
  if (!response.ok) return null
  return response.json()
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
  if (!cache.has(key)) {
    const request = Promise.all([
      getJson(`/v2.1/films/${key}/sequels_and_prequels`).catch(() => null),
      getJson(`/v2.2/films/${key}/similars`).catch(() => null)
    ]).then(([sequels, similars]) => normalizeRelated(sequels, similars, key))
    cache.set(key, request)
    // Сбой сети не запоминаем, чтобы при следующем открытии попробовать снова
    request.then((result) => {
      if (!result.sequels.length && !result.similars.length) cache.delete(key)
    })
  }
  return cache.get(key)
}
