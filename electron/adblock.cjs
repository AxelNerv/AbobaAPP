/**
 * Блокировщик рекламы для окна приложения.
 *
 * В браузере рекламу в плеерах режет расширение, а у приложения расширений
 * нет — реклама крутилась перед каждой серией. Здесь те же списки фильтров,
 * что у uBlock Origin, плюс русский список AdGuard: без него отечественные
 * рекламные сети (Яндекс, adfox, mail.ru) проходят насквозь.
 *
 * Перехват идёт на уровне сессии окна, поэтому видит и запросы из плееров
 * во фреймах. Телефону, открывшему раздачу по Wi-Fi, это не помогает:
 * там браузер телефона и его собственные правила.
 *
 * Готовый движок хранится в профиле и грузится за миллисекунды. Списки
 * обновляются в фоне раз в несколько дней; не скачались — работаем
 * со старой копией, а не без защиты.
 */
const fs = require('fs')
const path = require('path')
const { ElectronBlocker, adsLists } = require('@ghostery/adblocker-electron')

const LISTS = [...adsLists, 'https://filters.adtidy.org/extension/ublock/filters/1.txt']

// Свои адреса не трогаем ни при каких списках: сломанный фильтр не должен
// отрезать приложению бэкенд, каталог или постеры.
const ALWAYS_ALLOWED = [
  '@@||127.0.0.1^',
  '@@||localhost^',
  '@@||kinobd.net^',
  '@@||kbd.so^'
].join('\n')

// Меняется при смене набора списков — старый кеш тогда просто не читается.
const LIST_SET_VERSION = 1
const REFRESH_AFTER_MS = 3 * 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 30000
const LOG_EVERY_MS = 60000

const state = { enabled: false, ready: false, source: null, updatedAt: null, blocked: 0, error: null }

let blocker = null
let targetSession = null
let refreshing = null
let logTimer = null
const blockedHosts = new Map()

const cacheFile = (userDataDir) =>
  path.join(userDataDir, 'adblock', `engine-v${LIST_SET_VERSION}.bin`)

const onBlocked = (request) => {
  state.blocked += 1
  const host = request.hostname || 'неизвестно'
  blockedHosts.set(host, (blockedHosts.get(host) || 0) + 1)
}

/** В журнал — сводка по хостам раз в минуту, без полных адресов. */
const flushLog = () => {
  if (!blockedHosts.size) return
  const top = [...blockedHosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([host, count]) => `${host}×${count}`)
    .join(', ')
  console.log(`[adblock] заблокировано за минуту: ${top}`)
  blockedHosts.clear()
}

const attach = (engine) => {
  if (blocker && targetSession && blocker.isBlockingEnabled(targetSession)) {
    blocker.disableBlockingInSession(targetSession)
  }
  blocker?.unsubscribe('request-blocked', onBlocked)

  blocker = engine
  blocker.on('request-blocked', onBlocked)
  state.ready = true
  if (state.enabled && targetSession) blocker.enableBlockingInSession(targetSession)
}

const readCache = (file) => {
  try {
    const engine = ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(file)))
    return { engine, updatedAt: fs.statSync(file).mtimeMs }
  } catch {
    // Нет файла, файл битый или от другой версии библиотеки — соберём заново.
    return null
  }
}

/**
 * Скачать списки и собрать движок.
 *
 * Качаем через сетевой стек Chromium (net.fetch), а не через fetch из Node.
 * Node-овский fetch на полутора десятках параллельных больших загрузок
 * падал внутри сокета (`assert(!this.paused)` в undici) — исключение летело
 * мимо любых try/catch и роняло всё приложение.
 *
 * Ответ проверяем сами: библиотека разобрала бы страницу ошибки как список
 * фильтров. Таймаут обязателен — на этой сети соединения к отдельным
 * хостам умеют замерзать, и без него обновление висело бы бесконечно.
 */
const DOWNLOAD_CONCURRENCY = 3

const downloadList = async (url) => {
  const { net } = require('electron')
  const response = await net.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`список не скачался (${response.status}): ${url}`)
  return response.text()
}

const downloadAll = async (urls) => {
  const results = new Array(urls.length)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const index = next++
      results[index] = await downloadList(urls[index])
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker))
  return results
}

const buildFromNetwork = async (file) => {
  const texts = await downloadAll(LISTS)

  const engine = ElectronBlocker.parse(`${texts.join('\n')}\n${ALWAYS_ALLOWED}`, {
    enableCompression: true,
    loadCosmeticFilters: true
  })

  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, engine.serialize())
  fs.renameSync(`${file}.tmp`, file)
  return engine
}

const refresh = (userDataDir) => {
  if (refreshing) return refreshing
  refreshing = buildFromNetwork(cacheFile(userDataDir))
    .then((engine) => {
      attach(engine)
      Object.assign(state, { source: 'network', updatedAt: Date.now(), error: null })
      console.log('[adblock] списки обновлены')
    })
    .catch((error) => {
      state.error = error.message
      console.log('[adblock] обновить списки не удалось:', error.message)
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * Запуск. Ждёт только чтения кеша — это миллисекунды, окно не задерживается.
 * Скачивание списков (первый запуск или устаревший кеш) идёт в фоне.
 */
const start = ({ userDataDir, session, enabled }) => {
  targetSession = session
  state.enabled = enabled !== false

  const cached = readCache(cacheFile(userDataDir))
  if (cached) {
    attach(cached.engine)
    Object.assign(state, { source: 'cache', updatedAt: cached.updatedAt })
  }

  if (!cached || Date.now() - cached.updatedAt > REFRESH_AFTER_MS) refresh(userDataDir)

  if (!logTimer) {
    logTimer = setInterval(flushLog, LOG_EVERY_MS)
    logTimer.unref?.()
  }
}

const setEnabled = (enabled) => {
  state.enabled = enabled === true
  if (!blocker || !targetSession) return
  const active = blocker.isBlockingEnabled(targetSession)
  if (state.enabled && !active) blocker.enableBlockingInSession(targetSession)
  if (!state.enabled && active) blocker.disableBlockingInSession(targetSession)
}

const status = () => ({ ...state })

module.exports = { start, setEnabled, status, ALWAYS_ALLOWED }
