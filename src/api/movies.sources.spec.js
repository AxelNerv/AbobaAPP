import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKpInfo, getPlayers } from '@/api/movies'
import * as fbp from '@/api/movies.fbp'
import * as kinobd from '@/api/movies.kinobd'
import * as kinobox from '@/api/movies.kinobox'

vi.mock('@/api/movies.fbp', () => ({ getPlayers: vi.fn(), getKpInfo: vi.fn() }))
vi.mock('@/api/movies.kinobd', () => ({ getPlayers: vi.fn(), getKpInfo: vi.fn() }))
vi.mock('@/api/movies.kinobox', () => ({ getPlayers: vi.fn() }))
vi.mock('@/api/movieSeoNormalizer', () => ({ normalizeMovieListResponse: async (rows) => rows }))
vi.mock('@/api/movies.tmdb', () => ({ enrichMissingFields: async (movie) => movie }))

describe('независимый источник фильмов и плееров', () => {
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => vi.useRealTimers())

  it('показывает рабочий плеер без ожидания недоступного KinoBD', async () => {
    fbp.getPlayers.mockResolvedValue({ Collaps: { iframe: 'https://api.nextembed.ws/embed/movie/14' } })
    const result = await getPlayers('687595')
    expect(result.Collaps.iframe).toContain('movie/14')
    expect(kinobd.getPlayers).not.toHaveBeenCalled()
    expect(kinobox.getPlayers).not.toHaveBeenCalled()
  })

  it('при сбое нового источника продолжает проверку старого', async () => {
    fbp.getPlayers.mockRejectedValue(new Error('HTTP 502'))
    kinobd.getPlayers.mockResolvedValue({ Kodik: { iframe: 'https://example.org/serial' } })
    expect(await getPlayers('687595')).toHaveProperty('Kodik')
  })

  it('отказы всех источников остаются ошибкой', async () => {
    for (const source of [fbp, kinobd, kinobox]) source.getPlayers.mockRejectedValue(new Error('offline'))
    await expect(getPlayers('687595')).rejects.toMatchObject({ allSourcesDown: true })
  })

  it('честное отсутствие фильма отличается от падения источников', async () => {
    fbp.getPlayers.mockResolvedValue({})
    kinobd.getPlayers.mockRejectedValue(new Error('offline'))
    kinobox.getPlayers.mockRejectedValue(new Error('offline'))
    expect(await getPlayers('687595')).toEqual({})
  })

  it('название фильма не зависит от недоступного каталога', async () => {
    fbp.getKpInfo.mockResolvedValue({ kp_id: '687595', name_ru: 'Кухня' })
    expect(await getKpInfo('687595')).toMatchObject({ name_ru: 'Кухня' })
    expect(kinobd.getKpInfo).not.toHaveBeenCalled()
  })

  it('после двух таймаутов третий источник получает время на ответ', async () => {
    vi.useFakeTimers()
    fbp.getPlayers.mockImplementation(() => new Promise(() => {}))
    kinobd.getPlayers.mockImplementation(() => new Promise(() => {}))
    kinobox.getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://example.org/turbo' } })
    const result = getPlayers('687595', { forceInid: '123' })
    await vi.advanceTimersByTimeAsync(21001)
    expect(await result).toHaveProperty('Turbo')
    expect(fbp.getPlayers.mock.calls[0][1].signal.aborted).toBe(true)
    expect(kinobd.getPlayers.mock.calls[0][1]).toMatchObject({ forceInid: '123' })
    expect(kinobd.getPlayers.mock.calls[0][1].signal.aborted).toBe(true)
    expect(kinobox.getPlayers).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('не принимает некорректный список за рабочие плееры', async () => {
    fbp.getPlayers.mockResolvedValue(['unexpected'])
    kinobd.getPlayers.mockResolvedValue({ Error: { message: 'offline' } })
    kinobox.getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://example.org/turbo' } })
    expect(await getPlayers('687595')).toHaveProperty('Turbo')
  })

  it('резервная информация загружается после таймаута первого источника', async () => {
    vi.useFakeTimers()
    fbp.getKpInfo.mockImplementation(() => new Promise(() => {}))
    kinobd.getKpInfo.mockResolvedValue({ kp_id: '687595', name_ru: 'Кухня' })
    const result = getKpInfo('687595')
    await vi.advanceTimersByTimeAsync(11001)
    expect(await result).toMatchObject({ name_ru: 'Кухня' })
  })

  it('может продолжить цепочку после отказа всех iframe первого источника', async () => {
    kinobd.getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://example.org/turbo' } })
    expect(await getPlayers('687595', { excludeSources: ['fbp'] })).toHaveProperty('Turbo')
    expect(fbp.getPlayers).not.toHaveBeenCalled()
    expect(kinobd.getPlayers).toHaveBeenCalledTimes(1)
  })

  it('после исчерпания источников не начинает цепочку заново', async () => {
    await expect(getPlayers('687595', { excludeSources: ['fbp', 'kinobd', 'kinobox'] })).rejects.toMatchObject({ allSourcesDown: true })
    for (const source of [fbp, kinobd, kinobox]) expect(source.getPlayers).not.toHaveBeenCalled()
  })

  it('отказ iframe второго источника не возвращает к уже проверенному первому', async () => {
    kinobox.getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://example.org/turbo' } })
    expect(await getPlayers('687595', { excludeSources: ['kinobd'] })).toHaveProperty('Turbo')
    expect(fbp.getPlayers).not.toHaveBeenCalled()
    expect(kinobd.getPlayers).not.toHaveBeenCalled()
  })
})
