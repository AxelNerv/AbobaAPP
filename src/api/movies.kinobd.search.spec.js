import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ get: vi.fn(), interceptors: { request: { use: vi.fn() } } }))
vi.mock('axios', () => ({ default: { create: () => http } }))
vi.mock('@/utils/mediaUtils', () => ({ resolvePosterSetByMovie: () => ({ preview: '', full: '' }), resolvePosterByMovie: () => '' }))

describe('резервный поиск KinoBD', () => {
  beforeEach(() => { vi.resetModules(); http.get.mockReset() })
  const row = { kinopoisk_id: 687595, name_russian: 'Кухня', type: 'serial' }

  it('при сбое основного поиска использует альтернативный', async () => {
    const { apiSearch } = await import('./movies.kinobd')
    http.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { data: [row] } })
    expect(await apiSearch('Кухня')).toMatchObject([{ id: 687595 }])
  })

  it('при сбое альтернативного оставляет основную выдачу', async () => {
    const { apiSearch } = await import('./movies.kinobd')
    http.get.mockResolvedValueOnce({ data: { data: [row] } }).mockRejectedValueOnce(new Error('offline'))
    expect(await apiSearch('Кухня')).toHaveLength(1)
  })

  it('объединяет результаты без дублирования числовых и строковых ID', async () => {
    const { apiSearch } = await import('./movies.kinobd')
    http.get.mockResolvedValueOnce({ data: { data: [row] } })
      .mockResolvedValueOnce({ data: { data: [{ ...row, kinopoisk_id: '687595' }, { ...row, kinopoisk_id: '1291108' }] } })
    expect((await apiSearch('Кухня')).map(movie => String(movie.id))).toEqual(['687595', '1291108'])
  })

  it('не превращает два некорректных ответа в пустую выдачу', async () => {
    const { apiSearch } = await import('./movies.kinobd')
    http.get.mockResolvedValue({ data: { error: 'offline' } })
    await expect(apiSearch('Кухня')).rejects.toThrow('Некорректный ответ')
  })

  it('передаёт отмену обоим запросам и не отдаёт результат после отмены', async () => {
    const { apiSearch } = await import('./movies.kinobd')
    const controller = new AbortController()
    http.get.mockImplementation(() => {
      controller.abort()
      return Promise.resolve({ data: { data: [row] } })
    })
    await expect(apiSearch('Кухня', 1, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    for (const [, config] of http.get.mock.calls) expect(config.signal).toBe(controller.signal)
  })
})
