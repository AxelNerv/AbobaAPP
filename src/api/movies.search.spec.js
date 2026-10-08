import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiSearch } from './movies'
import * as wikidata from './movies.wikidata'
import * as kinobd from './movies.kinobd'
import * as catalog from './movies.catalog'

vi.mock('./movies.wikidata', () => ({ apiSearch: vi.fn() }))
vi.mock('./movies.kinobd', () => ({ apiSearch: vi.fn() }))
vi.mock('./movies.catalog', () => ({ apiSearch: vi.fn() }))
vi.mock('@/api/movieSeoNormalizer', () => ({ normalizeMovieListResponse: async rows => rows }))

describe('независимая цепочка поиска', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    catalog.apiSearch.mockRejectedValue(new Error('catalogue unavailable'))
  })
  afterEach(() => vi.useRealTimers())
  const row = { id: '687595', title: 'Кухня' }

  it('основной поиск использует полный каталог', async () => {
    catalog.apiSearch.mockResolvedValue([row])
    expect(await apiSearch('Кухня')).toEqual([row])
    expect(wikidata.apiSearch).not.toHaveBeenCalled()
    expect(kinobd.apiSearch).not.toHaveBeenCalled()
  })

  it('ищет без обращения к недоступному KinoBD', async () => {
    wikidata.apiSearch.mockResolvedValue([row])
    expect(await apiSearch(' Кухня ')).toEqual([row])
    expect(kinobd.apiSearch).not.toHaveBeenCalled()
    expect(wikidata.apiSearch.mock.calls[0][0]).toBe('Кухня')
  })

  it('сохраняет старый источник при сбое нового', async () => {
    wikidata.apiSearch.mockRejectedValue(new Error('HTTP 502'))
    kinobd.apiSearch.mockResolvedValue([row])
    expect(await apiSearch('Кухня')).toEqual([row])
  })

  it('источники упали — ошибка, а не ничего не найдено', async () => {
    wikidata.apiSearch.mockRejectedValue(new Error('HTTP 502'))
    kinobd.apiSearch.mockRejectedValue(new Error('timeout'))
    await expect(apiSearch('Кухня')).rejects.toMatchObject({ allSourcesDown: true })
  })

  it('пустой результат отличается от падения источников', async () => {
    wikidata.apiSearch.mockResolvedValue([])
    kinobd.apiSearch.mockRejectedValue(new Error('timeout'))
    expect(await apiSearch('missing')).toEqual([])
  })

  it('таймаут первого источника отменяет запрос и включает резерв', async () => {
    vi.useFakeTimers()
    wikidata.apiSearch.mockImplementation(() => new Promise(() => {}))
    kinobd.apiSearch.mockResolvedValue([row])
    const result = apiSearch('Кухня')
    await vi.advanceTimersByTimeAsync(12001)
    expect(await result).toEqual([row])
    expect(wikidata.apiSearch.mock.calls[0][2].signal.aborted).toBe(true)
  })

  it('не отправляет односимвольные запросы', async () => {
    expect(await apiSearch('x')).toEqual([])
    expect(wikidata.apiSearch).not.toHaveBeenCalled()
  })
})
