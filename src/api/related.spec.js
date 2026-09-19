import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRelated } from './related'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('related movies requests', () => {
  it('завершает зависшие запросы по таймауту', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted')))
    })))

    const request = getRelated('timeout-test')
    await vi.advanceTimersByTimeAsync(7000)

    await expect(request).resolves.toEqual({ sequels: [], similars: [] })
  })

  it('не кеширует ошибку API как успешный пустой ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    vi.stubGlobal('fetch', fetchMock)

    await getRelated('retry-test')
    await getRelated('retry-test')

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
