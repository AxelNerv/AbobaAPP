// «Случайный фильм» раньше брал топ kinobd; с 03.11 — популярное из каталога
// Кинопоиска (kinobd отвечает 523, кнопка не работала). Прежние тесты
// kinobd-реализации удалены вместе с ней.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as catalog from '@/api/movies.catalog'
import { getRandomMovie, _resetRandomCacheForTests } from '@/api/randomMovie'

vi.mock('@/api/movies.catalog', () => ({ getMovies: vi.fn() }))

const movie = (kp_id, year, extra = {}) => ({ kp_id: String(kp_id), title: `Фильм ${kp_id}`, year, type: 'FILM', poster: `p${kp_id}`, ...extra })

describe('случайный фильм из каталога', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    _resetRandomCacheForTests()
  })

  it('отдаёт карточку в формате окна случайного фильма', async () => {
    catalog.getMovies.mockResolvedValue([movie(7, 2014, {
      type: 'TV_SERIES', rating_kinopoisk: 8.6,
      countries: [{ country: 'США' }], genres: [{ genre: 'драма' }, { genre: 'фантастика' }]
    })])
    expect(await getRandomMovie()).toMatchObject({
      kp_id: '7', title: 'Фильм 7', year: 2014, type: 'TV_SERIES', poster: 'p7', cover: 'p7',
      rating_kp: 8.6, countries: 'США', genres: 'драма, фантастика', source: 'kinopoisk'
    })
  })

  it('с фильтром по годам ищет по страницам, пока не найдёт подходящий', async () => {
    catalog.getMovies.mockImplementation(async ({ page }) => [movie(page, page === 4 ? 1999 : 2020)])
    const result = await getRandomMovie({ yearFrom: 1990, yearTo: 2000 })
    expect(result).toMatchObject({ kp_id: '4', year: 1999 })
  })

  it('загруженные страницы не запрашивает повторно', async () => {
    catalog.getMovies.mockResolvedValue([movie(1, 2020)])
    await getRandomMovie()
    await getRandomMovie({ yearFrom: 3000 }).catch(() => {})
    const pages = catalog.getMovies.mock.calls.map(([args]) => args.page)
    expect(new Set(pages).size).toBe(pages.length)
  })

  it('отказ каталога — ошибка, а не «ничего не нашлось»', async () => {
    catalog.getMovies.mockRejectedValue(new Error('HTTP 502'))
    await expect(getRandomMovie()).rejects.toThrow('Каталог Кинопоиска не ответил')
  })

  it('пустой фильтр — понятная ошибка', async () => {
    catalog.getMovies.mockResolvedValue([movie(1, 2020)])
    await expect(getRandomMovie({ yearFrom: 1900, yearTo: 1901 })).rejects.toThrow('Под выбранные годы ничего не нашлось')
  })
})
