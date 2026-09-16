// Фильтр «Фильмы / Сериалы» в топе.
// Баг: kinobd помечает типы как 'film' и 'serial', а фильтр искал 'movie' и
// 'series'. Результат был пустым, и getMovies молча подменял его заготовленным
// каталогом — обе вкладки показывали один и тот же список фильмов.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const axiosGet = vi.fn()
vi.mock('axios', () => ({
  default: {
    create: () => ({ get: (...args) => axiosGet(...args), interceptors: { request: { use() {} } } })
  }
}))

const TOP = [
  { kinopoisk_id: 1, name_russian: 'Фильм 1', type: 'film' },
  { kinopoisk_id: 2, name_russian: 'Сериал 1', type: 'serial' },
  { kinopoisk_id: 3, name_russian: 'Фильм 2', type: 'film' }
]

describe('фильтр типов kinobd', () => {
  beforeEach(() => {
    axiosGet.mockReset()
    axiosGet.mockResolvedValue({ data: { data: TOP } })
  })

  const ids = (rows) => rows.map((row) => row.kp_id)

  it('«Фильмы» — только film', async () => {
    const { getMovies } = await import('@/api/movies.kinobd')
    expect(ids(await getMovies({ typeFilter: 'movie', limit: 10 }))).toEqual(['1', '3'])
  })

  it('«Сериалы» — только serial, и в карточке это сериал', async () => {
    const { getMovies } = await import('@/api/movies.kinobd')
    const rows = await getMovies({ typeFilter: 'series', limit: 10 })
    expect(ids(rows)).toEqual(['2'])
    expect(rows[0].raw_data.type).toBe('TV_SERIES')
  })

  it('«Все» — без фильтра', async () => {
    const { getMovies } = await import('@/api/movies.kinobd')
    expect(ids(await getMovies({ typeFilter: 'all', limit: 10 }))).toEqual(['1', '2', '3'])
  })
})

describe('подмена заготовленным каталогом', () => {
  const kinobdGetMovies = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    kinobdGetMovies.mockReset()
    vi.doMock('@/store/main', () => ({ useMainStore: () => { throw new Error('no pinia') } }))
    vi.doMock('@/api/movieSeoNormalizer', () => ({ normalizeMovieListResponse: async (rows) => rows }))
    vi.doMock('@/api/movies.kinobox', () => ({}))
    vi.doMock('@/api/movies.kinobd', () => ({ getMovies: (...a) => kinobdGetMovies(...a) }))
    vi.doMock('@/data/movies.json', () => ({ default: [{ kp_id: 'заготовка' }] }))
  })

  it('с фильтром пустой ответ остаётся пустым, а не чужим списком', async () => {
    kinobdGetMovies.mockResolvedValue([])
    const { getMovies } = await import('@/api/movies')
    expect(await getMovies({ typeFilter: 'series', limit: 10 })).toEqual([])
  })

  it('с фильтром сбой источника — ошибка, а не подмена', async () => {
    kinobdGetMovies.mockRejectedValue(new Error('kinobd упал'))
    const { getMovies } = await import('@/api/movies')
    await expect(getMovies({ typeFilter: 'movie', limit: 10 })).rejects.toThrow('kinobd упал')
  })

  it('без фильтра при сбое главная всё равно открывается с заготовкой', async () => {
    kinobdGetMovies.mockRejectedValue(new Error('kinobd упал'))
    const { getMovies } = await import('@/api/movies')
    expect(await getMovies({ typeFilter: 'all', limit: 10 })).toEqual([{ kp_id: 'заготовка' }])
  })
})
