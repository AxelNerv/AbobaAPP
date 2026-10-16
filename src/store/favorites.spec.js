import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFavoritesStore } from './favorites'

const jsonResponse = (data) => ({
  ok: true, status: 200,
  headers: new window.Headers({ 'content-type': 'application/json' }),
  json: async () => data
})

describe('favorites store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    delete window.__favorites
    vi.restoreAllMocks()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('не показывает локальный успех, если сервер ответил ошибкой', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const store = useFavoritesStore()

    await expect(store.add({ kp_id: '123', title: 'Тест' })).rejects.toThrow('HTTP 500')
    expect(store.favorites).toEqual([])
    expect(localStorage.getItem('abobatv_favorites_v1')).toBeNull()
  })

  it('сохраняет избранное после подтверждения сервера', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    const store = useFavoritesStore()

    await expect(store.add({ kp_id: '123', title: 'Тест' })).resolves.toBe(true)
    expect(store.isFavorite('123')).toBe(true)
  })

  it('последовательно обрабатывает быстрые повторные нажатия', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    const store = useFavoritesStore()
    const movie = { kp_id: '123', title: 'Тест' }

    await Promise.all([store.toggle(movie), store.toggle(movie)])

    expect(store.isFavorite('123')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('не скрывает ошибку начальной загрузки и сохраняет локальные данные', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    localStorage.setItem('abobatv_favorites_v1', JSON.stringify([{ kp_id: 'local' }]))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const store = useFavoritesStore()

    await expect(store.loadFromServer()).rejects.toThrow('HTTP 503')
    expect(store.isFavorite('local')).toBe(true)
    expect(store.lastError).toContain('HTTP 503')
  })

  it.each([{}, { items: null }, { items: [null] }, { items: [{}] }])(
    'не стирает локальное избранное при повреждённом ответе %j', async (data) => {
      localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
      const cached = JSON.stringify([{ kp_id: 'local' }])
      localStorage.setItem('abobatv_favorites_v1', cached)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(data)))
      const store = useFavoritesStore()

      await expect(store.loadFromServer()).rejects.toThrow('некорректный список')
      expect(store.isFavorite('local')).toBe(true)
      expect(localStorage.getItem('abobatv_favorites_v1')).toBe(cached)
      expect(store.lastError).toContain('некорректный список')
    }
  )

  it('не меняет состояние без явного подтверждения записи', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: false })))
    const store = useFavoritesStore()
    await expect(store.add({ kp_id: '123' })).rejects.toThrow('не подтвердил')
    expect(store.favorites).toEqual([])
    expect(window.__favorites).toBeUndefined()
  })

  it('повреждённый токен не превращает добавление в локальную операцию', async () => {
    localStorage.setItem('auth', '{broken')
    vi.stubGlobal('fetch', vi.fn())
    const store = useFavoritesStore()
    await expect(store.add({ kp_id: '123' })).rejects.toThrow('данные входа')
    expect(store.favorites).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('без входа ошибка диска не выглядит успешным добавлением', async () => {
    const store = useFavoritesStore()
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await expect(store.add({ kp_id: '123' })).rejects.toThrow('сохранить избранное на устройстве')
    expect(store.favorites).toEqual([])
    expect(window.__favorites).toBeUndefined()
    expect(store.lastError).toContain('сохранить избранное')
  })

  it('ошибка кэша не отменяет запись, уже подтверждённую сервером', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    const store = useFavoritesStore()
    vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await expect(store.add({ kp_id: '123' })).resolves.toBe(true)
    expect(store.isFavorite('123')).toBe(true)
    expect(window.__favorites[0].kp_id).toBe('123')
    expect(store.lastError).toContain('сохранено на сервере')
  })
})
