import { getBackendUrl } from './backendUrl'

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export const getLibraryToken = () => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('auth')
    if (!raw) return null
    const auth = JSON.parse(raw)
    if (!isRecord(auth) || (auth.token != null && typeof auth.token !== 'string')) {
      throw new Error('Некорректный формат данных входа')
    }
    return auth.token || null
  } catch (cause) {
    // Broken storage is not a logout: never silently switch to local-only writes.
    throw new Error('Не удалось прочитать данные входа. Войдите заново.', { cause })
  }
}

export const parseLibraryItems = (data) => {
  const items = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(items) || items.some((item) => {
    if (!isRecord(item)) return true
    const id = item.kp_id || item.id
    return !['string', 'number'].includes(typeof id) || !String(id).trim()
  })) throw new Error('Сервер вернул некорректный список библиотеки')
  return items
}

export const requireLibraryAck = (data) => {
  if (!isRecord(data) || data.ok !== true) {
    throw new Error('Сервер не подтвердил сохранение изменений')
  }
  return data
}

/** Deadline covers both headers and body. Never retry mutations automatically. */
export const libraryRequest = async (path, options = {}, timeoutMs = 15000) => {
  const token = getLibraryToken()
  const controller = new AbortController()
  let timer
  const request = async () => {
    const response = await fetch(`${getBackendUrl()}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
    if (!response.ok) {
      const error = new Error(`Сервер библиотеки ответил HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    const contentType = response.headers.get('content-type') || ''
    if (!/\bapplication\/(?:json|[\w.-]+\+json)\b/i.test(contentType)) {
      throw new Error('Сервер библиотеки вернул не JSON')
    }
    let data
    try {
      data = await response.json()
    } catch (cause) {
      throw new Error('Не удалось прочитать ответ сервера библиотеки', { cause })
    }
    if ((!isRecord(data) && !Array.isArray(data)) || data.error) {
      throw new Error('Сервер библиотеки вернул некорректный ответ')
    }
    return data
  }
  try {
    return await Promise.race([
      request(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Сервер библиотеки не ответил вовремя. Проверьте связь и повторите запрос.')
          error.code = 'LIBRARY_TIMEOUT'
          reject(error)
          controller.abort(error)
        }, timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
