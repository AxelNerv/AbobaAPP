import { normalizeMovieListResponse } from '@/api/movieSeoNormalizer'
import { getBackendUrl } from './backendUrl'
import { libraryRequest as listFetch, parseLibraryItems, requireLibraryAck } from './libraryRequest'

// ──────────────────────────────────────────────
// Списки (избранное / история) — идут на НАШ бэкенд
// ──────────────────────────────────────────────
// Раньше функции addToList/getMyLists и т.д. шли через apiCall → getApi() → axios,
// у которого baseURL разрешался в api4.rhserv.vu (внешний агрегатор).
// На rhserv нашего токена нет → 401, избранное никуда не сохранялось.
//
// Теперь функции списков ходят на наш FastAPI-бэкенд напрямую через fetch
// с Bearer-токеном из authStore. На rhserv ничего не уходит.

const addToList = async (id, type, movie = null) => {
  // На бэк (server.py PUT /list/{type}/{id}) отправляем сам объект фильма,
  // чтобы при последующем чтении списка карточка рисовалась без дозапросов.
  // movie — это объект с полями id, kp_id, title, poster, year, type, ratings.
  // Если не передан — отправляем минимум {kp_id: id}.
  const body = { movie: movie || { kp_id: id } }
  return requireLibraryAck(await listFetch(`/list/${type}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  }))
}

const delFromList = async (id, type) => {
  return requireLibraryAck(await listFetch(`/list/${type}/${id}`, { method: 'DELETE' }))
}

const delAllFromList = async (type) => {
  return requireLibraryAck(await listFetch(`/list/${type}`, { method: 'DELETE' }))
}

const getMyLists = async (type) => {
  const data = await listFetch(`/list/${type}`)
  // Наш сервер отдаёт {items: [...]}. Нормализатор ждёт сам массив.
  const items = parseLibraryItems(data)
  return await normalizeMovieListResponse(items, { enrichMissingSeo: false })
}

const generateToken = async () => {
  const response = await fetch(`${getBackendUrl()}/auth/init`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}))
    throw new Error(problem.detail || 'Сервер входа недоступен')
  }
  const data = await response.json()
  return {
    token: data.code,
    telegram_link: data.deep_link
  }
}

const getTGAuthResult = async (token) => {
    const response = await fetch(`${getBackendUrl()}/auth/poll/${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}))
      throw new Error(problem.detail || 'Нет связи с сервером входа')
    }
    const data = await response.json()
    if (data.ok && data.user) {
      return {
        authenticated: true,
        // data.token — постоянный Bearer-токен от сервера, привязан к tg_id.
        token: data.token,
        user: data.user
      }
    }
    return { authenticated: false }
}

// Синхронизация библиотеки с сервером входа: локальный бэкенд делает обмен сам,
// интерфейс только просит «сейчас» и показывает состояние.
const readSyncStatus = (data) => {
  if (typeof data?.enabled !== 'boolean' || !Number.isInteger(data.pending) || data.pending < 0) {
    throw new Error('Сервер вернул некорректный статус синхронизации')
  }
  return data
}
const syncNow = async () => readSyncStatus(await listFetch('/sync/now', { method: 'POST' }, 45000))

const importLibrary = async (data) =>
  requireLibraryAck(await listFetch('/import/library', { method: 'POST', body: JSON.stringify(data) }))

// Серия и таймкод по фильму. payload хранится как есть, формат задаёт плеер.
const getWatchProgress = async (kpId) => {
  const data = await listFetch(`/progress/${encodeURIComponent(kpId)}`)
  if (!Object.hasOwn(data, 'payload') || (data.payload !== null &&
    (typeof data.payload !== 'object' || Array.isArray(data.payload)))) {
    throw new Error('Сервер вернул некорректную позицию просмотра')
  }
  return data
}
const saveWatchProgress = async (kpId, payload) =>
  requireLibraryAck(await listFetch(`/progress/${encodeURIComponent(kpId)}`, { method: 'PUT', body: JSON.stringify({ payload }) }))
const getSyncStatus = async () => readSyncStatus(await listFetch('/sync/status'))

export {
  addToList,
  getMyLists,
  delAllFromList,
  delFromList,
  generateToken,
  getTGAuthResult,
  getSyncStatus,
  getWatchProgress,
  importLibrary,
  saveWatchProgress,
  syncNow
}
