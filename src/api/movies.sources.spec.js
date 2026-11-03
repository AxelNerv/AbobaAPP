import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKpInfo, getPlayers } from '@/api/movies'
import * as fbp from '@/api/movies.fbp'
import * as catalog from '@/api/movies.catalog'

// 03.11 KinoBD и Kinobox убраны из цепочек: оба мертвы. Плееры теперь даёт
// один агрегатор (FBP), поэтому тесты перехода плееров между агрегаторами
// удалены вместе с самим переходом. Механику цепочки — таймауты, отмену,
// исключение источников — по-прежнему проверяет sourceChain.spec.js.
vi.mock('@/api/movies.fbp', () => ({ getPlayers: vi.fn(), getKpInfo: vi.fn() }))
vi.mock('@/api/movies.catalog', () => ({ getKpInfo: vi.fn() }))
vi.mock('@/api/movieSeoNormalizer', () => ({ normalizeMovieListResponse: async (rows) => rows }))

describe('источник фильмов и плееров', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    catalog.getKpInfo.mockRejectedValue(new Error('catalogue unavailable'))
  })
  afterEach(() => vi.useRealTimers())

  it('полная карточка берётся из каталога независимо от источника видео', async () => {
    catalog.getKpInfo.mockResolvedValue({ kp_id: '687595', name_ru: 'Кухня', description: 'Описание' })
    expect(await getKpInfo('687595')).toMatchObject({ description: 'Описание' })
    expect(fbp.getKpInfo).not.toHaveBeenCalled()
  })

  it('показывает плееры FBP', async () => {
    fbp.getPlayers.mockResolvedValue({ Collaps: { iframe: 'https://api.nextembed.ws/embed/movie/14' } })
    expect((await getPlayers('687595')).Collaps.iframe).toContain('movie/14')
  })

  it('отказ источника остаётся ошибкой', async () => {
    fbp.getPlayers.mockRejectedValue(new Error('offline'))
    await expect(getPlayers('687595')).rejects.toMatchObject({ allSourcesDown: true })
  })

  it('честное отсутствие фильма отличается от падения источника', async () => {
    fbp.getPlayers.mockResolvedValue({})
    expect(await getPlayers('687595')).toEqual({})
  })

  it('не принимает некорректный список за рабочие плееры', async () => {
    fbp.getPlayers.mockResolvedValue(['unexpected'])
    await expect(getPlayers('687595')).rejects.toMatchObject({ allSourcesDown: true })
  })

  it('название фильма не зависит от недоступного каталога', async () => {
    fbp.getKpInfo.mockResolvedValue({ kp_id: '687595', name_ru: 'Кухня' })
    expect(await getKpInfo('687595')).toMatchObject({ name_ru: 'Кухня' })
  })

  it('информация из FBP загружается после таймаута каталога', async () => {
    vi.useFakeTimers()
    catalog.getKpInfo.mockImplementation(() => new Promise(() => {}))
    fbp.getKpInfo.mockResolvedValue({ kp_id: '687595', name_ru: 'Кухня' })
    const result = getKpInfo('687595')
    await vi.advanceTimersByTimeAsync(12001)
    expect(await result).toMatchObject({ name_ru: 'Кухня' })
    expect(catalog.getKpInfo.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('после исчерпания источников не начинает цепочку заново', async () => {
    await expect(getPlayers('687595', { excludeSources: ['fbp'] })).rejects.toMatchObject({ allSourcesDown: true })
    expect(fbp.getPlayers).not.toHaveBeenCalled()
  })
})
