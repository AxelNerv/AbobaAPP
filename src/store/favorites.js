import { defineStore } from 'pinia'

const STORAGE_KEY = 'abobatv_favorites_v1'

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

// Тихо отправляем запрос на сервер. Не ломаем UX если бэк недоступен —
// localStorage всё равно содержит актуальное состояние.
const syncToServer = async (method, kpId, body = null) => {
  const token = getAuthToken()
  if (!token) return // не залогинен — синк не делаем

  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
    const opts = { method, headers }
    if (body) opts.body = JSON.stringify(body)

    const url = kpId
      ? `${getBackendUrl()}/list/favorites/${kpId}`
      : `${getBackendUrl()}/list/favorites`

    await fetch(url, opts)
  } catch (e) {
    console.warn('[favorites] sync to server failed:', e?.message || e)
  }
}

export const useFavoritesStore = defineStore('favorites', {
  state: () => ({
    favorites: typeof window !== 'undefined' && window.__favorites ? window.__favorites : loadFromStorage()
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
      if (!token) return
      try {
        const response = await fetch(`${getBackendUrl()}/list/favorites`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!response.ok) return
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
      } catch (e) {
        console.warn('[favorites] loadFromServer failed:', e?.message || e)
      }
    },
    add(movie) {
      this._load()
      if (!movie?.kp_id) return
      if (this.favorites.some((m) => String(m.kp_id) === String(movie.kp_id))) return
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
      this.favorites = [entry, ...this.favorites]
      saveToStorage(this.favorites)
      // Синхронизация на сервер (тихо, не блокируя UI)
      syncToServer('PUT', entry.kp_id, { movie: entry })
    },
    remove(kpId) {
      this._load()
      this.favorites = this.favorites.filter((m) => String(m.kp_id) !== String(kpId))
      saveToStorage(this.favorites)
      syncToServer('DELETE', kpId)
    },
    toggle(movie) {
      this._load()
      if (this.isFavorite(movie.kp_id)) this.remove(movie.kp_id)
      else this.add(movie)
    },
    clear() {
      this.favorites = []
      saveToStorage(this.favorites)
      syncToServer('DELETE', null)
    }
  }
})
