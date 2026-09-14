import { getApi } from '@/api/axios'
import { normalizeMovieListResponse } from '@/api/movieSeoNormalizer'
import { getBackendUrl } from './backendUrl'

// ──────────────────────────────────────────────
// Списки (избранное / история) — идут на НАШ бэкенд
// ──────────────────────────────────────────────
// Раньше функции addToList/getMyLists и т.д. шли через apiCall → getApi() → axios,
// у которого baseURL разрешался в api4.rhserv.vu (внешний агрегатор).
// На rhserv нашего токена нет → 401, избранное никуда не сохранялось.
//
// Теперь функции списков ходят на наш FastAPI-бэкенд напрямую через fetch
// с Bearer-токеном из authStore. На rhserv ничего не уходит.

// Достаём токен из persisted-стора (он сохраняется через pinia-plugin-persistedstate в localStorage)
const getAuthToken = () => {
  try {
    if (typeof window === 'undefined') return null
    // Pinia persisted store кладёт стор в localStorage под ключом имени стора
    const raw = localStorage.getItem('auth')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.token || null
  } catch {
    return null
  }
}

const listFetch = async (path, options = {}) => {
  const token = getAuthToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${getBackendUrl()}${path}`, {
    ...options,
    headers
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const err = new Error(`HTTP ${response.status}: ${text || response.statusText}`)
    err.status = response.status
    throw err
  }

  // 204 No Content или пустое тело
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('json')) return null
  return await response.json()
}

const addToList = async (id, type, movie = null) => {
  // На бэк (server.py PUT /list/{type}/{id}) отправляем сам объект фильма,
  // чтобы при последующем чтении списка карточка рисовалась без дозапросов.
  // movie — это объект с полями id, kp_id, title, poster, year, type, ratings.
  // Если не передан — отправляем минимум {kp_id: id}.
  const body = { movie: movie || { kp_id: id } }
  return await listFetch(`/list/${type}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
}

const delFromList = async (id, type) => {
  return await listFetch(`/list/${type}/${id}`, { method: 'DELETE' })
}

const delAllFromList = async (type) => {
  return await listFetch(`/list/${type}`, { method: 'DELETE' })
}

const getMyLists = async (type) => {
  const data = await listFetch(`/list/${type}`)
  // Наш сервер отдаёт {items: [...]}. Нормализатор ждёт сам массив.
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data)
      ? data
      : []
  return await normalizeMovieListResponse(items, { enrichMissingSeo: false })
}

// ──────────────────────────────────────────────
// Прочее (на rhserv через axios)
// ──────────────────────────────────────────────
const apiCall = async (callFn) => {
  const api = await getApi()
  return await callFn(api)
}

const getUserLists = async (type, userId) => {
  const { data } = await apiCall((api) => api.get(`/user-list/${userId}/${type}`))
  return await normalizeMovieListResponse(data, { enrichMissingSeo: false })
}

const getListCounters = async (userId) => {
  const { data } = await apiCall((api) => api.get(`/user-list-counters/${userId}`))
  return data
}

const getUser = async () => {
  const { data } = await apiCall((api) => api.get('/user'))
  return data
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

const updateUserName = async (name) => {
  const { data } = await apiCall((api) => api.put('/user/name', { name }))
  return data
}

export {
  addToList,
  getMyLists,
  getUser,
  delAllFromList,
  delFromList,
  generateToken,
  getTGAuthResult,
  getUserLists,
  getListCounters,
  updateUserName
}
