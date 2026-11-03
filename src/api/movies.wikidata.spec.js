import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiSearch, getKpIDfromIMDB } from './movies.wikidata'

const httpGet = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { get: httpGet } }))
vi.mock('@/api/backendUrl', () => ({ getBackendUrl: () => '/api-backend' }))
vi.mock('@/utils/mediaUtils', () => ({ resolvePosterSetByMovie: () => ({ preview: 'small.jpg', full: 'full.jpg' }) }))

describe('ответ независимого поиска', () => {
  beforeEach(() => httpGet.mockReset())

  it('передаёт сигнал и выдаёт корректный ID, постер и тип карточки', async () => {
    httpGet.mockResolvedValue({ data: { data: [{ kp_id: '687595', title: 'Кухня', year: '2012', type: 'series' }] } })
    const controller = new AbortController()
    const [movie] = await apiSearch('Кухня', 1, { signal: controller.signal })
    expect(movie).toMatchObject({ id: '687595', title: 'Кухня', poster: 'small.jpg', raw_data: { type: 'TV_SERIES', rating: null } })
    expect(httpGet.mock.calls[0]).toEqual(['/api-backend/movies/search', { params: { q: 'Кухня', page: 1 }, timeout: 11000, signal: controller.signal }])
  })

  it('не принимает ошибку API или фильм без ID за успешную выдачу', async () => {
    httpGet.mockResolvedValueOnce({ data: { error: 'offline' } })
      .mockResolvedValueOnce({ data: { data: [{ title: 'Кухня' }] } })
    await expect(apiSearch('Кухня')).rejects.toThrow('Некорректный ответ')
    await expect(apiSearch('Кухня')).rejects.toThrow('Некорректные данные')
  })
})

describe('IMDB-номер → ID Кинопоиска', () => {
  beforeEach(() => httpGet.mockReset())

  it('принимает и tt-номер, и голые цифры без ведущих нулей', async () => {
    httpGet.mockResolvedValue({ data: { data: { kp_id: '258687', title: 'Интерстеллар' } } })
    expect(await getKpIDfromIMDB('tt0816692')).toMatchObject({ id_kp: '258687' })
    expect(await getKpIDfromIMDB('816692')).toMatchObject({ id_kp: '258687' })
    expect(httpGet.mock.calls.map(([url]) => url)).toEqual(['/api-backend/movies/imdb/tt0816692', '/api-backend/movies/imdb/tt0816692'])
  })

  it('не найдено — пустой ответ, без запроса для пустого ввода', async () => {
    httpGet.mockResolvedValue({ data: { data: null } })
    expect(await getKpIDfromIMDB('tt0000001')).toEqual({ id_kp: null, film: null })
    expect(await getKpIDfromIMDB('abc')).toEqual({ id_kp: null, film: null })
    expect(httpGet).toHaveBeenCalledTimes(1)
  })
})
