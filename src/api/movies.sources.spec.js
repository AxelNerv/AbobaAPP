import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
