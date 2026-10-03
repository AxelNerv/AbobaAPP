import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), interceptors: { request: { use: vi.fn() } } }))
vi.mock('axios', () => ({ default: { create: () => http } }))
vi.mock('@/utils/mediaUtils', () => ({ resolvePosterByMovie: () => '', resolvePosterSetByMovie: () => ({}) }))
vi.mock('@/utils/playerHost', () => ({ pinPlayerHost: value => value }))

describe('отмена сетевых запросов резервных источников', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('KinoBD передаёт сигнал поиску и загрузке плеера', async () => {
    const { getPlayers } = await import('./movies.kinobd')
    const controller = new AbortController()
    http.get.mockResolvedValue({ data: { data: [{ id: '123', kinopoisk_id: '687595', iframe: 'https://example.org/base' }] } })
    http.post.mockResolvedValue({ data: { turbo: { iframe: 'https://example.org/turbo' } } })
    expect(Object.values(await getPlayers('687595', { signal: controller.signal }))[0].iframe).toContain('/turbo')
    expect(http.get.mock.calls[0][1].signal).toBe(controller.signal)
    expect(http.post.mock.calls[0][2].signal).toBe(controller.signal)
  })

  it('отменённый /playerdata не возвращает старые iframe вместо отмены', async () => {
    const { getPlayers } = await import('./movies.kinobd')
    const controller = new AbortController()
    http.get.mockResolvedValue({ data: { data: [{ id: '123', iframe: 'https://example.org/base' }] } })
    http.post.mockImplementation(() => {
      controller.abort()
      return Promise.reject(controller.signal.reason)
    })
    await expect(getPlayers('687595', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('сломанный ответ поиска KinoBD остаётся ошибкой', async () => {
    const { getPlayers } = await import('./movies.kinobd')
    http.get.mockResolvedValue({ data: { error: 'service unavailable' } })
    await expect(getPlayers('687595')).rejects.toThrow('некорректный список')
  })

  it('метаданные KinoBD используют тот же сигнал отмены', async () => {
    const { getKpInfo } = await import('./movies.kinobd')
    const controller = new AbortController()
    http.get.mockResolvedValue({ data: { data: [] } })
    expect(await getKpInfo('687595', { signal: controller.signal })).toBeNull()
    expect(http.get.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('пустой /playerdata не скрывает рабочий iframe из поиска', async () => {
    const { getPlayers } = await import('./movies.kinobd')
    http.get.mockResolvedValue({ data: { data: [{ id: '123', iframe: 'https://example.org/base' }] } })
    http.post.mockResolvedValue({ data: {} })
    expect(Object.values(await getPlayers('687595'))[0].iframe).toContain('/base')
  })

  it('Kinobox передаёт сигнал и не превращает ошибку API в пустой список', async () => {
    const { getPlayers } = await import('./movies.kinobox')
    const controller = new AbortController()
    http.get.mockResolvedValue({ data: { error: 'unavailable' } })
    await expect(getPlayers('687595', { signal: controller.signal })).rejects.toThrow('некорректный список')
    expect(http.get.mock.calls[0][1].signal).toBe(controller.signal)
  })
})
