// Заглушка вместо Firebase Remote Config.
// Возвращает API URL напрямую из env-переменной VITE_APP_API_URL.
// Firebase удалён т.к. не нужен.

const API_URL = import.meta.env.VITE_APP_API_URL || 'https://api4.rhserv.vu'

export const getCurrentApiUrl = () => API_URL

export const initRemoteConfig = async () => {
  return true
}

export const getConfigValue = (key, defaultValue) => {
  if (key === 'api_endpoints') {
    return JSON.stringify([{ url: API_URL, description: 'Primary' }])
  }
  return defaultValue
}

export const remoteConfig = null
export const getValue = () => null
