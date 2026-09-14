/**
 * Закрепление поддомена плеера — чтобы он запоминал серию, сезон и таймкод.
 *
 * Проблема: балансер выдаёт плеер каждый раз на НОВОМ случайном поддомене:
 *   roejqqan3.movieks.com → lpjp.movieks.com → whbpimt.movieks.com
 * Один и тот же плеер, один и тот же фильм — а домен другой.
 *
 * Плеер сам умеет сохранять прогресс, но хранит его в localStorage своего
 * origin. Для браузера каждый поддомен — отдельный сайт, поэтому хранилище
 * при каждом заходе пустое, и просмотр всегда начинается сначала.
 *
 * Решение: один раз запоминаем выданный поддомен и дальше подставляем его
 * во все ссылки этого балансера. Origin становится стабильным → родное
 * сохранение плеера начинает работать.
 *
 * Проверено: сервер отвечает 200 на любой поддомен, включая выданный ранее.
 */

const STORAGE_KEY = 'abobatv_player_hosts'

// Балансеры с рандомным поддоменом. Ключ — базовый домен, по нему и закрепляем.
const ROTATING_DOMAINS = ['movieks.com']

const readPinned = () => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

const writePinned = (map) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // приватный режим / переполнено — не критично, просто не закрепим
  }
}

/** Базовый домен (последние две части хоста): tik.movieks.com → movieks.com */
const baseDomainOf = (host) => host.split('.').slice(-2).join('.')

/**
 * Подставляет закреплённый поддомен. Если для этого балансера его ещё нет —
 * запоминает текущий и возвращает ссылку как есть.
 */
export const pinPlayerHost = (url) => {
  if (!url || typeof window === 'undefined') return url

  let parsed
  try {
    parsed = new URL(url, window.location.origin)
  } catch {
    return url
  }

  const base = baseDomainOf(parsed.hostname)
  if (!ROTATING_DOMAINS.includes(base)) return url

  const pinned = readPinned()
  const known = pinned[base]

  if (known && known !== parsed.hostname) {
    parsed.hostname = known
    return parsed.toString()
  }

  if (!known) {
    pinned[base] = parsed.hostname
    writePinned(pinned)
  }

  return url
}

/**
 * Сбрасывает закрепление — вызывать, если плеер перестал открываться
 * (поддомен могли заблокировать). Следующая ссылка закрепит новый.
 */
export const resetPinnedHost = (url) => {
  if (!url || typeof window === 'undefined') return
  try {
    const base = baseDomainOf(new URL(url, window.location.origin).hostname)
    const pinned = readPinned()
    if (pinned[base]) {
      delete pinned[base]
      writePinned(pinned)
      console.warn(`[playerHost] сброшен закреплённый поддомен для ${base}`)
    }
  } catch {
    // некорректный URL — сбрасывать нечего
  }
}
