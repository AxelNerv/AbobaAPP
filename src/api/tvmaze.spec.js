import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSeriesGuide, normalizeSeriesGuide } from './tvmaze'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TVmaze series guide', () => {
  it('сопоставляет сериал по IMDb и читает следующую серию', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 42, status: 'Running', premiered: '2024-01-10' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 42,
          status: 'Running',
          url: 'https://www.tvmaze.com/shows/42/test',
          _embedded: {
            nextepisode: { id: 7, season: 2, number: 3, name: 'Next', airdate: '2026-10-01' }
          }
        })
      })
    vi.stubGlobal('fetch', fetchMock)

    const guide = await getSeriesGuide({ type: 'TV_SERIES', imdb_id: 'tt1234567', year: 2024 })

    expect(fetchMock.mock.calls[0][0]).toContain('/ext/tvmaze/lookup/shows?imdb=tt1234567')
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/ext/tvmaze/shows/42?embed%5B%5D=nextepisode&embed%5B%5D=previousepisode'
    )
    expect(guide.statusLabel).toBe('Выходит')
    expect(guide.nextEpisode).toMatchObject({ season: 2, number: 3, airdate: '2026-10-01' })
  })

  it('отбрасывает совпадение по названию с другим годом', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 99, premiered: '2010-01-01' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSeriesGuide({ type: 'serial', title: 'Одинаковое название', year: 2024 }))
      .resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('не запрашивает TVmaze для фильма', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(getSeriesGuide({ type: 'FILM', imdb_id: 'tt7654321' })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('нормализует завершённый сериал', () => {
    expect(normalizeSeriesGuide({ id: 1, status: 'Ended', ended: '2020-05-01' })).toMatchObject({
      statusLabel: 'Завершён',
      ended: '2020-05-01'
    })
  })
})
