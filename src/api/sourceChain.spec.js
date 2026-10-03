import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSourceChain, waitForSharedRequest } from './sourceChain'

const options = { label: 'test', isUsable: value => value === 'ready' }
const source = (name, run, timeoutMs = 100) => ({ name, run: vi.fn(run), timeoutMs })

describe('последовательная цепочка источников', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('не запрашивает резерв, когда первый источник работает', async () => {
    const first = source('first', () => 'ready')
    const backup = source('backup', () => 'ready')
    expect(await runSourceChain([first, backup], options)).toBe('ready')
    expect(backup.run).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('доходит до третьего, если первые два зависли', async () => {
    const first = source('first', () => new Promise(() => {}))
    const second = source('second', () => new Promise(() => {}))
    const third = source('third', () => 'ready')
    const result = runSourceChain([first, second, third], options)
    await vi.advanceTimersByTimeAsync(201)
    expect(await result).toBe('ready')
    expect(first.run.mock.calls[0][0].aborted).toBe(true)
    expect(second.run.mock.calls[0][0].aborted).toBe(true)
    expect(third.run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('поздний ответ отключённого источника не заменяет резерв', async () => {
    let finish
    const first = source('first', () => new Promise(resolve => { finish = resolve }))
    const backup = source('backup', () => 'ready')
    const result = runSourceChain([first, backup], options)
    await vi.advanceTimersByTimeAsync(101)
    expect(await result).toBe('ready')
    finish('stale')
    await vi.advanceTimersByTimeAsync(0)
    expect(await result).toBe('ready')
    expect(backup.run).toHaveBeenCalledTimes(1)
  })

  it('отмена страницы отменяет текущую попытку, не запускает остальные', async () => {
    const controller = new AbortController()
    const first = source('first', () => new Promise(() => {}))
    const backup = source('backup', () => 'ready')
    const result = runSourceChain([first, backup], { ...options, signal: controller.signal })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejected
    expect(first.run.mock.calls[0][0].aborted).toBe(true)
    expect(backup.run).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('уже отменённый запрос вообще не обращается к источникам', async () => {
    const controller = new AbortController()
    controller.abort()
    const first = source('first', () => 'ready')
    await expect(runSourceChain([first], { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(first.run).not.toHaveBeenCalled()
  })

  it('сохраняет ошибки всех попыток вместо пустого списка', async () => {
    const first = source('first', () => { throw new Error('HTTP 502') })
    const second = source('second', () => new Promise(() => {}))
    const third = source('third', () => ['malformed'])
    const result = runSourceChain([first, second, third], options)
    const rejected = expect(result).rejects.toMatchObject({ allSourcesDown: true, details: [
      'first: HTTP 502', 'second: second: превышено время ожидания', 'third: Некорректный ответ источника'
    ] })
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('снова проверяет оживший источник при следующем запросе', async () => {
    const first = source('old', () => { throw new Error('offline') })
    const backup = source('backup', () => 'ready')
    await runSourceChain([first, backup], options)
    first.run.mockResolvedValue('ready')
    await runSourceChain([first, backup], options)
    expect(first.run).toHaveBeenCalledTimes(2)
    expect(backup.run).toHaveBeenCalledTimes(1)
  })
})

describe('общий запрос и отмена потребителя', () => {
  it('отмена одного потребителя не ломает второго', async () => {
    let finish
    const shared = new Promise(resolve => { finish = resolve })
    const controller = new AbortController()
    const cancelled = waitForSharedRequest(shared, controller.signal)
    const other = waitForSharedRequest(shared)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    finish('ready')
    expect(await other).toBe('ready')
  })
})
