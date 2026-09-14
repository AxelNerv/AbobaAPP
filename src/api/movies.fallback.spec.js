// Регрессионный тест на fallback провайдеров.
// Баг: при contentApiProvider=kinobox (дефолт) методы, которых kinobox не умеет
// (он умеет только getPlayers), уходили в rhserv БЕЗ fallback. Когда rhserv в бане
// (403/429 → прокси отдаёт 503), «Случайный фильм» падал с «Ошибка на сервере»,
// хотя kinobd живой и getRandomMovie поддерживает.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as rhserv from '@/api/movies.rhserv'
import * as kinobd from '@/api/movies.kinobd'
import { getRandomMovie, getShikiInfo } from '@/api/movies'

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

vi.mock('@/api/movies.rhserv', () => ({
  getRandomMovie: vi.fn(),
  getShikiInfo: vi.fn()
}))

vi.mock('@/api/movies.kinobd', () => ({
  getRandomMovie: vi.fn(),
  getShikiInfo: vi.fn()
}))

vi.mock('@/api/movies.kinobox', () => ({}))

describe('порядок источников и повтор', () => {
  beforeEach(() => vi.clearAllMocks())

  it('спрашивает kinobd первым, пока тот жив', async () => {
    kinobd.getRandomMovie.mockResolvedValue({ kp_id: 1, title: 'из kinobd' })

    const result = await getRandomMovie({})

    expect(result.title).toBe('из kinobd')
    // rhserv в бане (403), поэтому его не трогаем, пока kinobd отвечает
    expect(rhserv.getRandomMovie).not.toHaveBeenCalled()
  })

  it('уходит на rhserv, когда kinobd не ответил', async () => {
    kinobd.getRandomMovie.mockRejectedValue(new Error('Request failed with status code 503'))
    rhserv.getRandomMovie.mockResolvedValue({ kp_id: 2, title: 'из rhserv' })

    const result = await getRandomMovie({})

    expect(rhserv.getRandomMovie).toHaveBeenCalled()
    expect(result.title).toBe('из rhserv')
  })

  it('повторяет обход, если с первого раза не ответил никто', async () => {
    // Разовые сбои проходят сами — ради этого в tryInOrder есть повтор
    kinobd.getRandomMovie
      .mockRejectedValueOnce(new Error('сеть моргнула'))
      .mockResolvedValue({ kp_id: 3, title: 'со второй попытки' })
    rhserv.getRandomMovie.mockRejectedValue(new Error('403'))

    const result = await getRandomMovie({})

    expect(result.title).toBe('со второй попытки')
  })

  it('пробрасывает ошибку, если метод не поддержан kinobd', async () => {
    // getShikiInfo нет в KINOBD_SUPPORTED_METHODS — подменять источник нечем
    rhserv.getShikiInfo.mockRejectedValue(new Error('503'))

    await expect(getShikiInfo(1)).rejects.toThrow('503')
    expect(kinobd.getShikiInfo).not.toHaveBeenCalled()
  })
})
