/**
 * Какие источники сейчас выключены на бэкенде.
 *
 * Зачем: rhserv давно в бане, но часть возможностей есть только у него
 * (заметки к фильму, продолжения/похожие). Каждый заход на страницу фильма
 * давал запрос к нему и красную строку в консоли — 403 или 429.
 * Ошибку мы ловим, но браузер всё равно её печатает, и выглядит это так,
 * будто сайт сломан.
 *
 * Проще не ходить туда, где нас не ждут: бэкенд знает, какие источники
 * выключены брейкером, — спрашиваем его и пропускаем такие вызовы.
 */
import { getBackendUrl } from '@/api/backendUrl'

const CACHE_MS = 60_000

let cache = { at: 0, tripped: [] }
let inFlight = null

const load = async () => {
  const res = await fetch(`${getBackendUrl()}/ext-health`)
  if (!res.ok) throw new Error(`ext-health: ${res.status}`)
  const data = await res.json()
  cache = { at: Date.now(), tripped: Array.isArray(data?.tripped) ? data.tripped : [] }
  return cache.tripped
}

/** Список выключенных источников. Ответ кешируется на минуту. */
export const getTrippedProviders = async () => {
  if (Date.now() - cache.at < CACHE_MS) return cache.tripped
  if (!inFlight) {
    inFlight = load()
      .catch(() => cache.tripped) // бэкенд недоступен — считаем всех живыми
      .finally(() => {
        inFlight = null
      })
  }
  return await inFlight
}

/** Живой ли источник. При любой неясности отвечаем «да» — пусть попробует. */
export const isProviderUp = async (name) => {
  const tripped = await getTrippedProviders()
  return !tripped.includes(name)
}

/** Сбросить кеш — например, после успешного ответа от источника. */
export const resetHealthCache = () => {
  cache = { at: 0, tripped: [] }
}
