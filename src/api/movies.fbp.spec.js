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

  // Здесь раньше стоял Alloha. 03.11 выяснилось, что «не воспроизводящий»
  // был ошибкой теста воспроизведения, и Alloha включён. Смысл проверки
  // прежний — непроверенный плеер в выдачу не пролезает; теперь это VideoSeed.
  it('не предлагает открывающийся, но не воспроизводящий видео плеер', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '258687', providers: [
      { type: 'VideoSeed', iframeUrl: 'https://example.org/stalled' },
      { type: 'Collaps', iframeUrl: 'https://api.nextembed.ws/embed/movie/180' }
    ] } })
    const result = Object.values(await getPlayers('258687'))
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('Collaps')
  })

  it('выдаёт Alloha — единственный источник с 4K', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '258687', providers: [
      { type: 'Alloha', iframeUrl: 'https://theatre.stravers.live/?token_movie=x' },
      { type: 'Collaps', iframeUrl: 'https://api.nextembed.ws/embed/movie/180' }
    ] } })
    expect(Object.values(await getPlayers('258687')).map(p => p.provider)).toEqual(['Alloha', 'Collaps'])
  })

  it('сохраняет Turbo, даже если серверная проверка требует браузер', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '687595', providers: [
      { type: 'Turbo', iframeUrl: 'https://x.obrut.show/embed/serial', browserOnly: true },
      { type: 'Collaps', iframeUrl: 'https://api.nextembed.ws/embed/movie/14' }
    ] } })
    expect(Object.values(await getPlayers('687595')).map(p => p.provider)).toEqual(['Turbo', 'Collaps'])
  })

  it('показывает новый маршрут Veoveo для сериалов и сохраняет независимый резерв', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '1398965', type: 'TV_SERIES', providers: [
      { type: 'Veoveo', iframeUrl: 'https://player.shortener2.link/serial' },
      { type: 'Veoveo', iframeUrl: 'https://kurolesya.link/serial' }
    ] } })
    const players = Object.values(await getPlayers('1398965'))
    expect(players).toHaveLength(2)
    expect(players.map(p => p.providerVariant)).toEqual(['shortener2.link', 'kurolesya.link'])
    expect(players[0].variantLabel).toBe('Основной резерв')
  })

  // Раньше здесь проверялось обратное — что фильмам этот маршрут не выдаётся.
  // Ограничение снято осознанно: 03.11 маршрут прошёл живое воспроизведение
  // и перемотку на фильмах, сериале и аниме.
  it('выдаёт маршрут Veoveo и для фильмов, сохраняя второй резерв', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '258687', type: 'FILM', providers: [
      { type: 'Veoveo', iframeUrl: 'https://player.shortener2.link/film' },
      { type: 'Veoveo', iframeUrl: 'https://kurolesya.link/film' }
    ] } })
    expect(Object.values(await getPlayers('258687')).map(p => p.providerVariant)).toEqual(['shortener2.link', 'kurolesya.link'])
  })

  it('добавляет независимый Veoveo и сохраняет только русские переводы', async () => {
    const { getPlayers } = await import('@/api/movies.fbp')
    httpGet.mockResolvedValue({ data: { kp_id: '10453010', providers: [
      { type: 'Turbo', iframeUrl: 'https://x.obrut.show/embed/film' },
      { type: 'Veoveo', iframeUrl: 'https://kurolesya.link/balancer-api/iframe', translations: [
        { name: 'Русский. Дубляж. Ultradox', iframeUrl: 'https://kurolesya.link/russian' },
        { name: 'Английский. Оригинал', iframeUrl: 'https://kurolesya.link/english' }
      ] }
    ] } })
    const result = Object.values(await getPlayers('10453010'))
    expect(result.map(p => p.provider)).toEqual(['Turbo', 'Veoveo', 'Veoveo'])
    expect(result.find(p => p.translate.includes('Ultradox'))).toBeDefined()
    expect(result.some(p => p.iframe.includes('/english'))).toBe(false)
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
