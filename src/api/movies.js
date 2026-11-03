import * as fbp from '@/api/movies.fbp'
import * as wikidata from '@/api/movies.wikidata'
import * as catalog from '@/api/movies.catalog'
import { getRandomMovie } from '@/api/randomMovie'
import { normalizeMovieListResponse } from '@/api/movieSeoNormalizer'
import { runSourceChain } from '@/api/sourceChain'

// KinoBD (523 с осени) и Kinobox (вместо ответа перенаправляет на гигабайтный
// файл) убраны из всех цепочек 03.11: живыми их проверки не проходят, а каждый
// заход в мёртвый источник при сбое FBP добавлял секунды ожидания.
// Новые независимые адаптеры добавляются сюда; зеркала того же API — не источники.
const MOVIE_SOURCES = [
  { id: 'fbp', name: 'FBP', timeoutMs: 11000,
    players: (id, options) => fbp.getPlayers(id, options),
    info: (id, options) => fbp.getKpInfo(id, options) }
]

const apiSearch = async (term, page = 1, { signal } = {}) => {
  const query = String(term || '').trim()
  if (query.length < 2) return []
  const data = await runSourceChain([
    { name: 'Кинопоиск', timeoutMs: 12000, run: signal => catalog.apiSearch(query, page, { signal }) },
    { name: 'Wikidata', timeoutMs: 12000, run: signal => wikidata.apiSearch(query, page, { signal }) }
  ], { label: 'apiSearch', isUsable: rows => Array.isArray(rows) && rows.length > 0,
    isEmpty: rows => Array.isArray(rows) && rows.length === 0, emptyResult: [], signal })
  return await normalizeMovieListResponse(data)
}
const hasRows = (rows) => Array.isArray(rows) && rows.length > 0

const getKpInfo = async (kpId, _token, { signal } = {}) => {
  const isGoodInfo = (d) =>
    !!(d && (d.kpId || d.kp_id || d.nameRu || d.nameOriginal || d.title))

  const data = await runSourceChain(
    [{ name: 'Кинопоиск', timeoutMs: 12000, run: signal => catalog.getKpInfo(kpId, { signal }) },
      ...MOVIE_SOURCES.filter(source => source.info).map(source => ({
      ...source, run: attemptSignal => source.info(kpId, { signal: attemptSignal })
    }))],
    { label: 'getKpInfo', isUsable: isGoodInfo, signal }
  )

  // Optional external metadata is loaded in the background by the movie page.
  return data
}
const hasPlayers = (result) =>
  result && typeof result === 'object' && !Array.isArray(result) &&
  Object.values(result).some(player => typeof player?.iframe === 'string' && /^https?:\/\//.test(player.iframe))

const getPlayers = async (kpId, options = {}) => {
  // Resume AFTER the exhausted aggregator. Earlier APIs were already tried;
  // do not revisit them until the user opens this movie again.
  const lastExcluded = MOVIE_SOURCES.reduce((last, source, index) =>
    options.excludeSources?.includes(source.id) ? index : last, -1)
  return runSourceChain(
    MOVIE_SOURCES.slice(lastExcluded + 1).map(source => ({
      ...source, run: signal => source.players(kpId, { ...options, signal })
    })),
    { label: 'getPlayers', isUsable: hasPlayers,
      isEmpty: value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0,
      emptyResult: {}, signal: options.signal }
  )
}
const getMovies = async (...args) => {
  const typeFilter = args?.[0]?.typeFilter || 'all'
  let rows
  try {
    rows = await runSourceChain([
      { name: 'Кинопоиск', timeoutMs: 12000, run: signal => catalog.getMovies({ ...args[0], signal }) }
    ], { label: 'getMovies', isUsable: hasRows, isEmpty: rows => Array.isArray(rows) && !rows.length,
      emptyResult: [], signal: args[0]?.signal })
    // С фильтром пустой список — честный ответ, а не авария: подменять его нельзя.
    if (typeFilter === 'all' && !hasRows(rows)) throw new Error('Источники вернули пустой каталог')
  } catch (error) {
    if (args[0]?.signal?.aborted) throw error
    console.warn('[movies] Не удалось обновить каталог:', error.message)
    // Главная должна открываться даже при полном падении внешних каталогов.
    // Но в заготовке нет типов: отдать её на «Фильмы» или «Сериалы» значит
    // показать чужой список без единого слова об ошибке. С фильтром — ошибка.
    if (typeFilter !== 'all') throw error
    // JSON грузится отдельным чанком только при аварии и не утяжеляет старт.
    const { default: seedMovies } = await import('@/data/movies.json')
    const limit = Math.max(1, Number(args?.[0]?.limit) || 100)
    rows = seedMovies.slice(0, limit)
  }
  return await normalizeMovieListResponse(rows, { enrichMissingSeo: false })
}
// Сохраняем общий каталог и порядок источников для постраничных потребителей.
const getMoviesPaginated = async ({ page = 2, typeFilter = 'all' } = {}) => {
  return getMovies({ typeFilter, page, limit: 100 })
}
const getKpIDfromIMDB = async (...args) => wikidata.getKpIDfromIMDB(...args)

export {
  apiSearch,
  getKpInfo,
  getPlayers,
  getMovies,
  getMoviesPaginated,
  getKpIDfromIMDB,
  getRandomMovie
}
