/**
 * Серия и таймкод живут не у нас, а в localStorage самого плеера (iframe
 * с чужого домена). Странице туда не дотянуться, а главному процессу можно:
 * Electron умеет выполнять код в любом фрейме окна.
 *
 * Читаем только ключи, по которым плееры запоминают позицию, и только
 * небольшие значения. Пишем обратно тоже только такие ключи: запись идёт
 * в чужую страницу, и превращать это в «положи что угодно куда угодно»
 * нельзя.
 */
const { webFrameMain } = require('electron')

// Playerjs (TURBO, Kinescope и др.): позиция и выбранная озвучка.
// Kodik: последняя серия и прогресс по сериям. Ortified: секунды по id видео.
// Ylitron и похожие: JSON с сезоном/серией под числовым ключом.
const KEY_RE = /^(pljsplayfrom_|pljstranslation_)|^serial-(progress|last-episode)$|^vp\.\d{1,12}$|^\d{1,12}$/
const MAX_VALUE_LENGTH = 4096
const MAX_KEYS = 40
const HOST_TOKEN = '{host}'
const RESTORE_TTL_MS = 60 * 1000

const isLocalUrl = (url) => {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'file:' || hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return true
  }
}

/** Ключ Playerjs содержит домен плеера, а домены у TURBO меняются. */
const toStoredKey = (key, host) => (host ? key.split(host).join(HOST_TOKEN) : key)
const toFrameKey = (key, host) => key.split(HOST_TOKEN).join(host)

/**
 * Оставляет только ключи позиции. Ключи Playerjs с путём чужого видео
 * отбрасываем: в localStorage плеера лежат позиции всех фильмов подряд,
 * а нам нужен текущий.
 */
const sanitizeEntries = (raw, { host = '', path = '' } = {}) => {
  const result = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(result).length >= MAX_KEYS) break
    if (typeof key !== 'string' || typeof value !== 'string') continue
    if (!KEY_RE.test(key) || key.length > 512 || value.length > MAX_VALUE_LENGTH) continue
    if (/^pljs(playfrom|translation)_/.test(key) && key.includes('/') && path && !key.includes(path)) continue
    result[toStoredKey(key, host)] = value
  }
  return result
}

const READ_SCRIPT = `(() => {
  const out = {}
  try {
    for (let i = 0; i < localStorage.length && i < 2000; i++) {
      const key = localStorage.key(i)
      out[key] = localStorage.getItem(key)
    }
  } catch (e) {}
  return { host: location.host, path: location.pathname, entries: out }
})()`

const writeScript = (entries) => `(() => {
  const entries = ${JSON.stringify(entries)}
  // Позиция Playerjs заканчивается временем сохранения: «…--1789395771954».
  // Старую позицию поверх более свежей, сохранённой на этом компьютере, не кладём.
  const savedAt = (value) => Number((/--([0-9]{10,})$/.exec(value || '') || [])[1] || 0)
  let written = 0
  try {
    for (const [key, value] of Object.entries(entries)) {
      const frameKey = key.split(${JSON.stringify(HOST_TOKEN)}).join(location.host)
      const current = localStorage.getItem(frameKey)
      const newer = /^pljsplayfrom_/.test(frameKey) && savedAt(value) > savedAt(current)
      if (current === null || newer) {
        localStorage.setItem(frameKey, value)
        written++
      }
    }
  } catch (e) {}
  return written
})()`

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// TURBO меняет поддомены: 2dc59dca.obrut.show и 92d73433.obrut.show — один плеер.
const familyOf = (url) => {
  try {
    const { protocol, hostname } = new URL(url)
    if (!/^https?:$/.test(protocol)) return ''
    return hostname.split('.').slice(-2).join('.')
  } catch {
    return ''
  }
}

/** Фрейм плеера: не главный и не наш. Если знаем адрес iframe — ищем по домену. */
const findPlayerFrame = (webContents, src) => {
  const frames = webContents.mainFrame.framesInSubtree.filter(
    (frame) => frame !== webContents.mainFrame && frame.url && !isLocalUrl(frame.url)
  )
  const wanted = hostOf(src)
  return frames.find((frame) => hostOf(frame.url) === wanted) ||
    frames.find((frame) => frame.parent === webContents.mainFrame) ||
    null
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

const readProgress = async (webContents, src) => {
  const frame = findPlayerFrame(webContents, src)
  if (!frame) return null
  const snapshot = await withTimeout(frame.executeJavaScript(READ_SCRIPT), 3000)
  if (!snapshot || typeof snapshot.host !== 'string') return null
  const entries = sanitizeEntries(snapshot.entries, { host: snapshot.host, path: snapshot.path })
  return { host: snapshot.host, path: String(snapshot.path || '').slice(0, 512), entries }
}

/**
 * Восстановление. Плеер читает позицию при запуске, поэтому писать нужно
 * до его скриптов: запоминаем, что положить, и кладём, как только фрейм
 * с этим доменом начал загружаться. Если фрейм уже открыт — кладём сразу;
 * позиция подхватится при следующем запуске видео.
 */
const createRestorer = (webContents) => {
  // По плееру на домен: страница готовит позиции заранее, до выбора плеера.
  const pending = new Map()

  const write = (frame, entries) => frame.executeJavaScript(writeScript(entries)).catch(() => 0)

  webContents.on('did-frame-navigate', (_event, url, _code, _text, isMainFrame, processId, routingId) => {
    // Внутри плеера бывают свои фреймы (счётчики, реклама, about:blank) —
    // позиция нужна только фрейму того плеера, который выбран.
    if (isMainFrame || isLocalUrl(url)) return
    const family = familyOf(url)
    const waiting = pending.get(family)
    if (!waiting) return
    pending.delete(family)
    if (Date.now() > waiting.expires) return
    const frame = webFrameMain.fromId(processId, routingId)
    if (frame) write(frame, waiting.entries)
  })

  return (entries, src) => {
    const clean = sanitizeEntries(entries)
    const family = familyOf(src)
    if (!Object.keys(clean).length || !family) return false
    // Ждём ближайшую загрузку плеера, а если он уже открыт — кладём и туда:
    // позиция подхватится при следующем запуске видео.
    pending.set(family, { entries: clean, expires: Date.now() + RESTORE_TTL_MS })
    const open = findPlayerFrame(webContents, src)
    if (open && familyOf(open.url) === family) write(open, clean)
    return true
  }
}

module.exports = { sanitizeEntries, toStoredKey, toFrameKey, readProgress, createRestorer, KEY_RE }
