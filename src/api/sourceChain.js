// Deadlines belong to individual sources, not to the whole fallback chain.
const abortReason = (signal) => signal?.reason || Object.assign(new Error('Запрос отменён'), { name: 'AbortError' })

export const waitForSharedRequest = (promise, signal) => {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(abortReason(signal)) }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    // Cancelling one consumer must not cancel a shared metadata/player lookup.
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

const runWithDeadline = (source, parentSignal) => new Promise((resolve, reject) => {
  if (parentSignal?.aborted) { reject(abortReason(parentSignal)); return }
  const controller = new AbortController()
  let done = false
  let timer
  const finish = (callback, value) => {
    if (done) return
    done = true
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onAbort)
    callback(value)
  }
  const onAbort = () => {
    const error = abortReason(parentSignal)
    finish(reject, error)
    controller.abort(error)
  }
  parentSignal?.addEventListener('abort', onAbort, { once: true })
  timer = setTimeout(() => {
    const error = new Error(`${source.name}: превышено время ожидания`)
    error.code = 'SOURCE_TIMEOUT'
    finish(reject, error)
    controller.abort(error)
  }, source.timeoutMs)
  Promise.resolve().then(() => {
    if (!done) return source.run(controller.signal)
  }).then(value => finish(resolve, value), error => finish(reject, error))
})

export const runSourceChain = async (sources, {
  label, isUsable, isEmpty = value => value == null, emptyResult, signal
}) => {
  const details = []
  let hasEmpty = false
  let lastError
  for (const source of sources) {
    if (signal?.aborted) throw abortReason(signal)
    try {
      const value = await runWithDeadline(source, signal)
      if (isUsable(value)) return value
      if (!isEmpty(value)) throw new Error('Некорректный ответ источника')
      hasEmpty = true
      details.push(`${source.name}: пусто`)
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      lastError = error
      details.push(`${source.name}: ${error?.message || 'ошибка'}`)
    }
    console.warn(`[movies] ${label}: ${details[details.length - 1]}; следующий источник`)
  }
  if (hasEmpty && emptyResult !== undefined) return emptyResult
  const error = new Error(`${label}: все источники недоступны`)
  error.allSourcesDown = true
  error.details = details
  error.cause = lastError
  throw error
}
