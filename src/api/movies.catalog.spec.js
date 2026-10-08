import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { apiSearch, getMovies, getKpInfo } from './movies.catalog'

vi.mock('axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/api/backendUrl', () => ({ getBackendUrl: () => '/api-backend' }))
const row = { kp_id: '687595', title: 'Кухня', type: 'TV_SERIES', year: 2012, rating_kinopoisk: 8.2,
  poster_url: 'https://avatars.mds.yandex.net/get-ott/1/image/orig',
  poster_url_preview: 'https://avatars.mds.yandex.net/get-ott/1/image/300x450' }

describe('каталог без ключа', () => {
  beforeEach(() => vi.resetAllMocks())

  it('сохраняет тип сериала, рейтинг, ID и передаёт отмену поиска', async () => {
    axios.get.mockResolvedValue({ data: { data: [row] } })
    const controller = new AbortController()
    const [result] = await apiSearch('Кухня', 2, { signal: controller.signal })
    expect(result).toMatchObject({ kp_id: '687595', average_rating: 8.2, raw_data: { type: 'TV_SERIES' } })
    expect(axios.get).toHaveBeenCalledWith('/api-backend/catalog/search', expect.objectContaining({
      params: { q: 'Кухня', page: 2 }, signal: controller.signal, timeout: 11000
    }))
  })

  it('загружает 100 карточек одним локальным запросом', async () => {
    axios.get.mockResolvedValue({ data: { data: [row] } })
    await getMovies()
    expect(axios.get).toHaveBeenCalledWith('/api-backend/catalog/popular', expect.objectContaining({
      params: { type_filter: 'all', page: 1, limit: 100 }
    }))
  })

  it('отличает отсутствие фильма от ошибки и чужой карточки', async () => {
    axios.get.mockResolvedValueOnce({ data: { data: null } })
    expect(await getKpInfo('111')).toBeNull()
    axios.get.mockResolvedValueOnce({ data: { data: row } })
    await expect(getKpInfo('111')).rejects.toThrow('другой фильм')
    axios.get.mockResolvedValueOnce({ data: { error: 'failed' } })
    await expect(apiSearch('Кухня')).rejects.toThrow('ответ каталога')
  })

  it('не маскирует испорченный список пустой выдачей', async () => {
    for (const data of [{}, [null], [{ ...row, kp_id: '../1' }]]) {
      axios.get.mockResolvedValueOnce({ data: { data } })
      await expect(apiSearch('Кухня')).rejects.toThrow()
    }
  })
})
