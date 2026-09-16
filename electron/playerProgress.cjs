/**
 * Серия и таймкод живут не у нас, а в localStorage самого плеера (iframe
 * с чужого домена). Странице туда не дотянуться, а главному процессу можно:
 * Electron умеет выполнять код в любом фрейме окна.
 *
 * Плеер бывает матрёшкой: VIBIX — окно kinobd.club, внутри которого окно
 * kinescope, и позицию хранит именно вложенное. Поэтому читаем и пишем
 * все окна внутри плеера, раскладывая записи по домену окна.
 *
 * Читаем только ключи, по которым плееры запоминают позицию, и только
 * небольшие значения. Пишем обратно тоже только такие ключи: запись идёт
 * в чужую страницу, и превращать это в «положи что угодно куда угодно»
 * нельзя.
 */
const { webFrameMain } = require('electron')

// Playerjs (TURBO, VIDEOSEED, Kinescope во VIBIX): позиция и озвучка.
// Alloha: save-<id фильма> — JSON с сезоном, серией, временем и озвучкой.
// Collaps: vp<id фильма> = «сезон:серия», vp.<id серии> = секунды.
// Kodik: последняя серия и прогресс по сериям. Ylitron: JSON под числовым ключом.
const KEY_RE = /^(pljsplayfrom_|pljstranslation_)|^serial-(progress|last-episode)$|^save-[0-9a-f]{8,64}$|^vp\d{1,12}$|^vp\.\d{1,12}$|^\d{1,12}$/
const MAX_VALUE_LENGTH = 4096
const MAX_KEYS = 40
const MAX_FRAMES = 6
const HOST_TOKEN = '{host}'
const RESTORE_TTL_MS = 60 * 1000

const isLocalUrl = (url) => {
  try {
    const { protocol, hostname } = new URL(url)
    return !/^https?:$/.test(protocol) || hostname === '127.0.0.1' || hostname === 'localhost'
  } catch {
    return true
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

const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** Ключ Playerjs содержит домен плеера, а домены у TURBO меняются. */
const toStoredKey = (key, host) => (host ? key.split(host).join(HOST_TOKEN) : key)
const toFrameKey = (key, host) => key.split(HOST_TOKEN).join(host)

/**
 * Kodik копит прогресс всех сериалов в одной записи, и у длинного аниме она
 * вырастает за предел размера. Оставляем только сериал из адреса плеера
 * (/serial/52142/…); без адреса — запись как есть.
 */
const trimKodikProgress = (value, path) => {
  const id = /\/(?:serial|season|video)\/(\d+)\//.exec(path || '')?.[1]
  if (!id) return value
  try {
    const data = JSON.parse(value)
    return data && typeof data === 'object' && data[id] ? JSON.stringify({ [id]: data[id] }) : value
  } catch {
    return value
  }
}

/**
 * Оставляет только ключи позиции текущего видео. В localStorage плеера лежат
 * позиции всех фильмов подряд, поэтому ключи с идентификатором чужого видео
 * (в пути или в адресе окна) отбрасываем.
 */
const sanitizeEntries = (raw, { host = '', path = '', search = '' } = {}) => {
  const result = {}
  if (!raw || typeof raw !== 'object') return result
  for (const [key, original] of Object.entries(raw)) {
    const value = key === 'serial-progress' && typeof original === 'string' ? trimKodikProgress(original, path) : original
    if (Object.keys(result).length >= MAX_KEYS) break
    if (typeof key !== 'string' || typeof value !== 'string') continue
    if (!KEY_RE.test(key) || key.length > 512 || value.length > MAX_VALUE_LENGTH) continue
    if (/^pljs(playfrom|translation)_/.test(key) && key.includes('/') && path && !key.includes(path)) continue
    if (key.startsWith('save-') && search && !search.includes(key.slice(5))) continue
    if (/^vp\d+$/.test(key) && path && !new RegExp(`/${key.slice(2)}(/|$)`).test(path)) continue
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
  return { host: location.host, path: location.pathname, search: location.search, entries: out }
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

/** Фрейм плеера: не главный и не наш. Если знаем адрес iframe — ищем по домену. */
const findPlayerFrame = (webContents, src) => {
  const frames = webContents.mainFrame.framesInSubtree.filter(
    (frame) => frame !== webContents.mainFrame && frame.url && !isLocalUrl(frame.url)
  )
  const wanted = hostOf(src)
  return frames.find((frame) => wanted && hostOf(frame.url) === wanted) ||
    frames.find((frame) => frame.parent === webContents.mainFrame) ||
    null
}

/** Окно плеера и всё, что вложено в него (без счётчиков на about:blank). */
const playerFrames = (top) =>
  [top, ...top.framesInSubtree.filter((frame) => frame !== top)]
    .filter((frame) => frame.url && !isLocalUrl(frame.url))
    .slice(0, MAX_FRAMES)

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

/**
 * Возвращает { host, path, frames: { домен: записи }, entries: все записи вместе }.
 * frames нужен для восстановления по окнам, entries — чтобы понять, где остановился.
 */
const readProgress = async (webContents, src) => {
  const top = findPlayerFrame(webContents, src)
  if (!top) return null
  const frames = {}
  const entries = {}
  for (const frame of playerFrames(top)) {
    let snapshot = null
    try {
      snapshot = await withTimeout(frame.executeJavaScript(READ_SCRIPT), 3000)
    } catch {
      continue
    }
    if (!snapshot || typeof snapshot.host !== 'string') continue
    const clean = sanitizeEntries(snapshot.entries, {
      host: snapshot.host,
      path: String(snapshot.path || ''),
      search: String(snapshot.search || '')
    })
    if (!Object.keys(clean).length) continue
    const family = familyOf(frame.url)
    frames[family] = { ...(frames[family] || {}), ...clean }
    Object.assign(entries, clean)
  }
  return { host: hostOf(top.url), path: (() => { try { return new URL(top.url).pathname.slice(0, 512) } catch { return '' } })(), frames, entries }
}

/**
 * Принимает { домен: записи } или, для позиций, сохранённых до поддержки
 * вложенных окон, просто записи — их относим к домену src.
 */
const normalizeFrames = (input, src) => {
  if (!input || typeof input !== 'object') return {}
  const looksFlat = Object.keys(input).some((key) => KEY_RE.test(key))
  const grouped = looksFlat ? { [familyOf(src)]: input } : input
  const result = {}
  for (const [family, entries] of Object.entries(grouped)) {
    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/i.test(family)) continue
    const clean = sanitizeEntries(entries)
    if (Object.keys(clean).length) result[family.toLowerCase()] = clean
    if (Object.keys(result).length >= MAX_FRAMES) break
  }
  return result
}

/**
 * Восстановление. Плеер читает позицию при запуске, поэтому писать нужно
 * до его скриптов: запоминаем, что положить, и кладём, как только окно
 * с этим доменом начало загружаться. Если окно уже открыто — кладём сразу;
 * позиция подхватится при следующем запуске видео.
 */
const createRestorer = (webContents) => {
  const pending = new Map()

  const write = (frame, entries) => frame.executeJavaScript(writeScript(entries)).catch(() => 0)

  webContents.on('did-frame-navigate', (_event, url, _code, _text, isMainFrame, processId, routingId) => {
    if (isMainFrame || isLocalUrl(url)) return
    const family = familyOf(url)
    const waiting = pending.get(family)
    if (!waiting) return
    pending.delete(family)
    if (Date.now() > waiting.expires) return
    const frame = webFrameMain.fromId(processId, routingId)
    if (frame) write(frame, waiting.entries)
  })

  return (input, src) => {
    const byFamily = normalizeFrames(input, src)
    if (!Object.keys(byFamily).length) return false
    const expires = Date.now() + RESTORE_TTL_MS
    for (const [family, entries] of Object.entries(byFamily)) pending.set(family, { entries, expires })
    const top = findPlayerFrame(webContents, src)
    if (top) {
      for (const frame of playerFrames(top)) {
        const entries = byFamily[familyOf(frame.url)]
        if (entries) write(frame, entries)
      }
    }
    return true
  }
}

module.exports = { sanitizeEntries, normalizeFrames, toStoredKey, toFrameKey, readProgress, createRestorer, familyOf, KEY_RE }
