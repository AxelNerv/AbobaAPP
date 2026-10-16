import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { libraryRequest } from './libraryRequest'
import { addToList, delAllFromList, getMyLists, getSyncStatus, getWatchProgress, saveWatchProgress } from './user'

const jsonResponse = (data) => ({
  ok: true, status: 200,
  headers: new window.Headers({ 'content-type': 'application/json' }),
  json: async () => data
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('auth', JSON.stringify({ token: 'test-only-token' }))
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ошибки библиотеки и сохранения прогресса', () => {
  it('читает настоящий пустой список, не считая его ошибкой', async () => {
    fetch.mockResolvedValue(jsonResponse({ items: [] }))
    await expect(getMyLists('history')).resolves.toEqual([])
  })

  it.each([{}, { items: false }, { items: [null] }, { items: [{ title: 'Нет ID' }] }])(
    'некорректный ответ %j не является пустой историей', async (data) => {
      fetch.mockResolvedValue(jsonResponse(data))
      await expect(getMyLists('history')).rejects.toThrow('некорректный список')
    }
  )

  it('сохраняет совместимость с массивом записей старого сервера', async () => {
    fetch.mockResolvedValue(jsonResponse([{ kp_id: '123', title: 'Тест' }]))
    const items = await getMyLists('history')
    expect(items[0].kp_id).toBe('123')
  })

  it.each([{}, { ok: false }, { ok: 'true' }])('не принимает %j за подтверждение записи', async (data) => {
    fetch.mockResolvedValue(jsonResponse(data))
    await expect(saveWatchProgress('123', { v: 1 })).rejects.toThrow('не подтвердил')
    await expect(addToList('123', 'history')).rejects.toThrow('не подтвердил')
    await expect(delAllFromList('history')).rejects.toThrow('не подтвердил')
  })

  it('принимает только явное подтверждение и отправляет токен', async () => {
    fetch.mockResolvedValue(jsonResponse({ ok: true }))
    await expect(saveWatchProgress('123', { v: 1 })).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('/api-backend/progress/123', expect.objectContaining({
      method: 'PUT', headers: expect.objectContaining({ Authorization: 'Bearer test-only-token' })
    }))
  })

  it('HTML/204 вместо JSON не маскируется успешной записью', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, headers: new window.Headers({ 'content-type': 'text/html' }) })
    await expect(saveWatchProgress('123', {})).rejects.toThrow('не JSON')
    fetch.mockResolvedValue({ ok: true, status: 204, headers: new window.Headers() })
    await expect(delAllFromList('history')).rejects.toThrow('не JSON')
  })

  it('битый JSON и ошибка HTTP доходят до вызывающего интерфейса', async () => {
    fetch.mockResolvedValue({ ...jsonResponse({}), json: async () => { throw new SyntaxError('broken') } })
    await expect(getMyLists('history')).rejects.toThrow('прочитать ответ')
    fetch.mockResolvedValue({ ok: false, status: 401 })
    await expect(getMyLists('history')).rejects.toMatchObject({ status: 401 })
  })

  it.each([{}, { payload: [] }, { payload: 'bad' }])('ошибка прогресса %j не означает отсутствие позиции', async (data) => {
    fetch.mockResolvedValue(jsonResponse(data))
    await expect(getWatchProgress('123')).rejects.toThrow('некорректную позицию')
  })

  it('принимает отсутствие позиции и сохранённый объект', async () => {
    for (const payload of [null, { v: 1, players: {} }]) {
      fetch.mockResolvedValue(jsonResponse({ payload }))
      await expect(getWatchProgress('123')).resolves.toEqual({ payload })
    }
  })

  it('не считает повреждённый статус отключённой синхронизацией', async () => {
    fetch.mockResolvedValue(jsonResponse({}))
    await expect(getSyncStatus()).rejects.toThrow('некорректный статус')
    fetch.mockResolvedValue(jsonResponse({ enabled: false, pending: 0, error: null }))
    await expect(getSyncStatus()).resolves.toMatchObject({ enabled: false })
  })

  it.each(['fetch', 'body'])('прерывает зависший %s, освобождает таймер и не повторяет запись', async (stage) => {
    vi.useFakeTimers()
    const hanging = new Promise(() => {})
    fetch.mockImplementation(() => stage === 'fetch' ? hanging : {
      ...jsonResponse({}), json: () => hanging
    })
    const request = saveWatchProgress('123', { v: 1 })
    const rejected = expect(request).rejects.toMatchObject({ code: 'LIBRARY_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(15001)
    await rejected
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('успешный запрос не оставляет таймер и может читать следующий ответ', async () => {
    vi.useFakeTimers()
    fetch.mockResolvedValue(jsonResponse({ ok: true }))
    await libraryRequest('/test')
    expect(vi.getTimerCount()).toBe(0)
    await libraryRequest('/test')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
