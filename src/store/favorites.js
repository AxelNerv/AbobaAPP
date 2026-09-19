import { defineStore } from 'pinia'

const STORAGE_KEY = 'abobatv_favorites_v1'
const favoriteMutations = new Map()

const loadFromStorage = () => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const saveToStorage = (favs) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
    // Sync across dual Pinia instances via window global
    window.__favorites = favs
  } catch {
    /* ignore */
  }
}

// Достаём авторизационный токен пользователя из persisted-стора Pinia.
// Если юзер залогинен — токен есть, и мы можем синхронизировать избранное на сервере.
// Если не залогинен — работаем только с localStorage (поведение как раньше).
const getAuthToken = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('auth')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.token || null
  } catch {
    return null
  }
}

const getBackendUrl = () => {
  if (typeof window === 'undefined') return '/api-backend'
  // Используем относительный путь — nginx проксирует /api-backend/* на FastAPI.
  return '/api-backend'
}

const syncToServer = async (method, kpId, body = null) => {
  const token = getAuthToken()
  if (!token) return true // без входа избранное остаётся локальным

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)

  const url = kpId
    ? `${getBackendUrl()}/list/favorites/${kpId}`
    : `${getBackendUrl()}/list/favorites`

  const response = await fetch(url, opts)
  if (!response.ok) throw new Error(`Сервер избранного ответил HTTP ${response.status}`)
  return true
}

export const useFavoritesStore = defineStore('favorites', {
  state: () => ({
    favorites: typeof window !== 'undefined' && window.__favorites ? window.__favorites : loadFromStorage(),
    lastError: ''
  }),
  getters: {
    isFavorite: (state) => (kpId) => state.favorites.some((m) => String(m.kp_id) === String(kpId))
  },
  actions: {
    _load() {
      // Reload from storage (for dual Pinia sync)
      if (typeof window !== 'undefined') {
        const fresh = window.__favorites || loadFromStorage()
        this.favorites = fresh
      }
    },
    // Загружает избранное С СЕРВЕРА и кладёт в локальный стор.
    // Вызывается при логине / переключении устройства.
    async loadFromServer() {
      const token = getAuthToken()
      if (!token) return false
      try {
        const response = await fetch(`${getBackendUrl()}/list/favorites`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!response.ok) throw new Error(`Сервер избранного ответил HTTP ${response.status}`)
        const data = await response.json()
        const items = Array.isArray(data?.items) ? data.items : []
        // Нормализуем формат, чтобы UI его понял
        this.favorites = items.map((m) => ({
          kp_id: m.kp_id || m.id || '',
          title: m.title || m.name_ru || '',
          slug: m.slug || '',
          year: m.year || '',
          type: m.type || '',
          poster: m.poster || m.cover || '',
          rating_kp: m.rating_kp || (m.ratings && m.ratings.kp) || '',
          rating_imdb: m.rating_imdb || (m.ratings && m.ratings.imdb) || '',
          addedAt: m.addedAt || Date.now()
        }))
        saveToStorage(this.favorites)
        this.lastError = ''
        return true
      } catch (e) {
        this.lastError = e?.message || 'Не удалось загрузить избранное'
        console.warn('[favorites] loadFromServer failed:', e?.message || e)
        throw e
      }
    },
    async add(movie) {
      this._load()
      if (!movie?.kp_id) return false
      if (this.favorites.some((m) => String(m.kp_id) === String(movie.kp_id))) return false
      const entry = {
        kp_id: movie.kp_id,
        title: movie.title || movie.name_ru || '',
        slug: movie.slug || '',
        year: movie.year || '',
        type: movie.type || '',
        poster: movie.poster || movie.cover || '',
        rating_kp: movie.rating_kp || '',
        rating_imdb: movie.rating_imdb || '',
        addedAt: Date.now()
      }
      // Для вошедшего пользователя сначала подтверждаем запись в локальном
      // бэкенде. Иначе HTTP 500 выглядел как успех, а после перезапуска фильм исчезал.
      await syncToServer('PUT', entry.kp_id, { movie: entry })
      this.favorites = [entry, ...this.favorites]
      saveToStorage(this.favorites)
      return true
    },
    async remove(kpId) {
      this._load()
      if (!this.favorites.some((m) => String(m.kp_id) === String(kpId))) return false
      await syncToServer('DELETE', kpId)
      this.favorites = this.favorites.filter((m) => String(m.kp_id) !== String(kpId))
      saveToStorage(this.favorites)
      return true
    },
    async toggle(movie) {
      const key = String(movie?.kp_id || '')
      if (!key) return false
      const previous = favoriteMutations.get(key) || Promise.resolve()
      const operation = previous.catch((error) => {
        console.warn('[favorites] предыдущая операция не удалась:', error?.message || error)
      }).then(async () => {
        this._load()
        if (this.isFavorite(key)) return await this.remove(key)
        return await this.add(movie)
      })
      favoriteMutations.set(key, operation)
      try {
        return await operation
      } finally {
        if (favoriteMutations.get(key) === operation) favoriteMutations.delete(key)
      }
    },
    async clear() {
      await syncToServer('DELETE', null)
      this.favorites = []
      saveToStorage(this.favorites)
      return true
    }
  }
})
