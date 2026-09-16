// Регрессионный тест на источники данных.
// rhserv мёртв и из цепочек убран: методы, которые умеет kinobd, идут только
// в kinobd — с одним повтором, потому что разовые сбои сети проходят сами.
// Баг, ради которого тест появился: при contentApiProvider=kinobox (дефолт без
// стора) «Случайный фильм» уходил в недоступный источник и падал, хотя kinobd жив.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as kinobd from '@/api/movies.kinobd'
import { getRandomMovie } from '@/api/movies'

vi.mock('@/store/main', () => ({
  // Стора нет — как в реальном коде, getCurrentProvider словит ошибку
  // и возьмёт дефолт (kinobox).
  useMainStore: () => {
    throw new Error('no pinia in test')
  }
}))

vi.mock('@/api/movieSeoNormalizer', () => ({
  normalizeMovieListResponse: async (rows) => rows
}))

vi.mock('@/api/movies.kinobd', () => ({
  getRandomMovie: vi.fn()
}))

vi.mock('@/api/movies.kinobox', () => ({}))

describe('источник kinobd и повтор', () => {
  beforeEach(() => vi.clearAllMocks())

  it('берёт данные из kinobd', async () => {
    kinobd.getRandomMovie.mockResolvedValue({ kp_id: 1, title: 'из kinobd' })

    const result = await getRandomMovie({})

    expect(result.title).toBe('из kinobd')
    expect(kinobd.getRandomMovie).toHaveBeenCalledTimes(1)
  })

  it('повторяет запрос, если с первого раза kinobd не ответил', async () => {
    kinobd.getRandomMovie
      .mockRejectedValueOnce(new Error('сеть моргнула'))
      .mockResolvedValue({ kp_id: 3, title: 'со второй попытки' })

    const result = await getRandomMovie({})

    expect(result.title).toBe('со второй попытки')
    expect(kinobd.getRandomMovie).toHaveBeenCalledTimes(2)
  })

  it('после повтора сообщает, что источник недоступен', async () => {
    kinobd.getRandomMovie.mockRejectedValue(new Error('Request failed with status code 503'))

    const error = await getRandomMovie({}).catch((e) => e)

    expect(error.allSourcesDown).toBe(true)
    expect(error.details.join(' ')).toContain('503')
  })
})
