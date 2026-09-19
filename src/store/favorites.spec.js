import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useFavoritesStore } from './favorites'

describe('favorites store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    delete window.__favorites
    vi.restoreAllMocks()
  })

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const store = useFavoritesStore()

    await expect(store.add({ kp_id: '123', title: 'Тест' })).resolves.toBe(true)
    expect(store.isFavorite('123')).toBe(true)
  })

  it('последовательно обрабатывает быстрые повторные нажатия', async () => {
    localStorage.setItem('auth', JSON.stringify({ token: 'test-token' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
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
})
