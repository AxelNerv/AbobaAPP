import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasAllohaUhd } from './playerQuality'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Alloha quality check', () => {
  it('повторяет запрос после временной ошибки вместо кеширования false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ uhd: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const url = 'https://example.test/player/retry-uhd'

    await expect(hasAllohaUhd(url)).resolves.toBe(false)
    await expect(hasAllohaUhd(url)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
