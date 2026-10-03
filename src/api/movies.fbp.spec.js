import { beforeEach, describe, expect, it, vi } from 'vitest'

const httpGet = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { get: httpGet, create: () => ({ get: httpGet }) } }))
vi.mock('@/api/backendUrl', () => ({ getBackendUrl: () => '/api-backend' }))
vi.mock('@/utils/movieSeo', () => ({ getMovieSeoEntry: () => null }))
vi.mock('@/utils/mediaUtils', () => ({ resolvePosterSetByMovie: () => ({ full: '', preview: '' }) }))

describe('общая загрузка информации и плееров', () => {
  beforeEach(() => { vi.resetModules(); httpGet.mockReset() })

  it('не дублирует запрос и сохраняет русское название и тип сериала', async () => {
    const { getKpInfo, getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '687595', title: 'Кухня', year: '2012', type: 'TV_SERIES',
      providers: [{ type: 'Collaps', iframeUrl: 'https://api.nextembed.ws/embed/movie/14', translations: [] }] } })
    const [info, players] = await Promise.all([getKpInfo('687595'), getPlayers('687595')])
    expect(info).toMatchObject({ name_ru: 'Кухня', type: 'TV_SERIES', year: '2012' })
    expect(Object.values(players)[0]).toMatchObject({ provider: 'Collaps', source: 'fbp' })
    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(httpGet.mock.calls[0][0]).toBe('/api-backend/player/sources/687595')
  })

  it('ошибка не превращается в закешированное отсутствие фильма', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockRejectedValueOnce(new Error('offline'))
    await expect(getPlayers('687595')).rejects.toThrow('offline')
    httpGet.mockResolvedValue({ data: { kp_id: '687595', providers: [] } })
    expect(await getPlayers('687595')).toEqual({})
    expect(httpGet).toHaveBeenCalledTimes(2)
  })

  it('не использует ответ с ID другого фильма', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '258687', providers: [] } })
    await expect(getPlayers('687595')).rejects.toThrow('некорректные данные')
  })

  it('убирает иностранные озвучки и субтитры из списка переводов', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '258687', providers: [{ type: 'Collaps', iframeUrl: 'https://example.org/base',
      translations: ['Дублированный', 'Украинский', 'Оригинальный', 'Субтитры'].map((name, id) =>
        ({ id, name, iframeUrl: `https://example.org/${id}` })) }] } })
    const result = Object.values(await getPlayers('258687'))
    expect(result.map((p) => p.translate)).toEqual(['Collaps', 'Дублированный'])
  })

  it('не предлагает открывающийся, но не воспроизводящий видео плеер', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '258687', providers: [
      { type: 'Alloha', iframeUrl: 'https://example.org/stalled' },
      { type: 'Collaps', iframeUrl: 'https://api.nextembed.ws/embed/movie/180' }
    ] } })
    const result = Object.values(await getPlayers('258687'))
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('Collaps')
  })

  it('сохраняет Turbo, даже если серверная проверка требует браузер', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '687595', providers: [
      { type: 'Turbo', iframeUrl: 'https://x.obrut.show/embed/serial', browserOnly: true },
      { type: 'Collaps', iframeUrl: 'https://api.nextembed.ws/embed/movie/14' }
    ] } })
    expect(Object.values(await getPlayers('687595')).map(p => p.provider)).toEqual(['Turbo', 'Collaps'])
  })

  it('отмена плеера не отменяет общий запрос названия фильма', async () => {
    const { getPlayers, getKpInfo } = await import('@/api/movies.fbp')
    let finish
    httpGet.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const controller = new AbortController()
    const players = getPlayers('687595', { signal: controller.signal })
    const info = getKpInfo('687595')
    const rejected = expect(players).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    finish({ data: { kp_id: '687595', title: 'Кухня', providers: [] } })
    expect(await info).toMatchObject({ name_ru: 'Кухня' })
    expect(httpGet).toHaveBeenCalledTimes(1)
  })
})
