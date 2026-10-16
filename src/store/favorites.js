import { defineStore } from 'pinia'
import { getLibraryToken, libraryRequest, parseLibraryItems, requireLibraryAck } from '@/api/libraryRequest'

const STORAGE_KEY = 'abobatv_favorites_v1'
const favoriteMutations = new Map()

const loadFromStorage = () => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return parseLibraryItems(parsed)
  } catch (error) {
    console.warn('[favorites] локальное избранное не прочитано:', error?.message || error)
    return []
  }
}

const saveToStorage = (favs) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
}

const syncToServer = async (method, kpId, body = null) => {
  const token = getLibraryToken()
  if (!token) return false // без входа запись должна сохраниться локально
  const opts = { method }
  if (body) opts.body = JSON.stringify(body)

  const url = kpId
    ? `/list/favorites/${kpId}`
    : '/list/favorites'
  requireLibraryAck(await libraryRequest(url, opts))
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
    _persist(next, serverSaved) {
      try {
        saveToStorage(next)
        this.lastError = ''
      } catch (cause) {
        const error = new Error(serverSaved
          ? 'Избранное сохранено на сервере, но локальный кэш записать не удалось'
          : 'Не удалось сохранить избранное на устройстве', { cause })
        this.lastError = error.message
        console.warn('[favorites]', error.message, cause?.message || cause)
        // A failed cache must not undo a confirmed server mutation. Without a
        // server, however, no durable copy exists: never report local success.
        if (!serverSaved) throw error
        window.__toast?.(error.message, 6000)
      }
      this.favorites = next
      if (typeof window !== 'undefined') window.__favorites = next
    },
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
      try {
        if (!getLibraryToken()) return false
        const items = parseLibraryItems(await libraryRequest('/list/favorites'))
        // Нормализуем формат, чтобы UI его понял
        const next = items.map((m) => ({
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
        this._persist(next, true)
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
      const serverSaved = await syncToServer('PUT', entry.kp_id, { movie: entry })
      this._persist([entry, ...this.favorites], serverSaved)
      return true
    },
    async remove(kpId) {
      this._load()
      if (!this.favorites.some((m) => String(m.kp_id) === String(kpId))) return false
      const serverSaved = await syncToServer('DELETE', kpId)
      this._persist(this.favorites.filter((m) => String(m.kp_id) !== String(kpId)), serverSaved)
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
      const serverSaved = await syncToServer('DELETE', null)
      this._persist([], serverSaved)
      return true
    }
  }
})
