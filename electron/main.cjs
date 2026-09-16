/**
 * AbobaTV — десктопное приложение.
 *
 * Приложение само себе сервер: поднимает бэкенд, показывает интерфейс
 * в окне и при желании раздаёт тот же сайт в локальную сеть. База одна,
 * поэтому история в окне и на телефоне общая — синхронизировать нечего.
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, Tray, session } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const backend = require('./backend.cjs')
const lanShare = require('./lanShare.cjs')
const appData = require('./appData.cjs')
const instance = require('./instance.cjs')
const settingsStore = require('./settings.cjs')
const adblock = require('./adblock.cjs')
const { installLogger } = require('./logger.cjs')
const backups = require('./backups.cjs')
const playerProgress = require('./playerProgress.cjs')
const updater = require('./updater.cjs')

const APP_ROOT = path.join(__dirname, '..')
const DIST_DIR = path.join(APP_ROOT, 'dist')
const isDev = !app.isPackaged && process.env.ABOBA_DEV === '1'

// Имя задаём до первого обращения к путям: от него зависит папка профиля.
// В отладке и в установленном приложении она должна быть одна и та же,
// иначе история «теряется» при переходе с одного на другое.
app.setName(instance.name)
const profileOverride = app.commandLine.getSwitchValue('user-data-dir')
if (profileOverride) {
  const profile = path.resolve(profileOverride)
  fs.mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
}

// Внутрь установленного приложения писать нельзя: после упаковки папка
// проекта лежит в архиве asar и доступна только на чтение.
const USER_DATA_DIR = app.getPath('userData')
const DATA_DIR = appData.resolveDataDir(USER_DATA_DIR)
const LEGACY_DATA_DIR = path.join(APP_ROOT, 'backend', 'data')

// Второй экземпляр поднял бы второй бэкенд и второго бота на том же
// токене — они бы дрались за порт и за обновления Telegram. Пускаем один.
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

let mainWindow = null
let localUrl = null
let tray = null
let quitting = false
let settings = { authServerUrl: '', closeToTray: false, adblock: true }
let appEnv = {}
let maintenance = false
let restorePlayerProgress = () => false
const LOG_DIR = path.join(USER_DATA_DIR, 'logs')

// Сервер входа и синхронизации по умолчанию: приложение работает сразу после
// установки, без ручной настройки. Адрес не хранится в исходниках (репозиторий
// публичный): его кладут в electron/server.local.json перед сборкой, файл
// в git не попадает. Свой адрес в настройках или .env важнее.
const DEFAULT_AUTH_SERVER_URL = (() => {
  try {
    const url = JSON.parse(fs.readFileSync(path.join(__dirname, 'server.local.json'), 'utf8')).authServerUrl
    return typeof url === 'string' ? settingsStore.validateAuthUrl(url) : ''
  } catch {
    return ''
  }
})()
// Выключенные серверы — по отпечатку SHA-256, чтобы не светить их адреса.
// Если такой адрес остался в настройках, забываем его: иначе вход перестал бы работать.
const RETIRED_AUTH_SERVER_HASHES = new Set(['1af2f1891a65a76b467952bdd0773eb1f8c5314abe366eb6ed5109484f85d7e8'])
const isRetiredAuthUrl = (url) =>
  !!url && RETIRED_AUTH_SERVER_HASHES.has(crypto.createHash('sha256').update(url.replace(/\/+$/, '')).digest('hex'))
const loadSettings = () => {
  const loaded = settingsStore.readSettings(USER_DATA_DIR)
  if (isRetiredAuthUrl(loaded.authServerUrl)) {
    loaded.authServerUrl = ''
    settingsStore.saveSettings(USER_DATA_DIR, loaded)
  }
  return loaded
}
const authServerUrl = () => {
  const own = settings.authServerUrl || (isRetiredAuthUrl(appEnv.ABOBA_AUTH_SERVER_URL) ? '' : appEnv.ABOBA_AUTH_SERVER_URL) || ''
  return own || DEFAULT_AUTH_SERVER_URL
}

const startConfiguredBackend = () => backend.startBackend(APP_ROOT, {
  // Секрет Docker-бота не передаётся клиентскому бэкенду.
  AUTH_SERVER_URL: authServerUrl(),
  TMDB_API_KEY: appEnv.TMDB_API_KEY || ''
}, DATA_DIR, { onStatus: reportBackendStatus })

const showMainWindow = () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const parseEnvFile = (filePath, target) => {
  if (!fs.existsSync(filePath)) return target

  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    let value = trimmed.slice(idx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    target[trimmed.slice(0, idx).trim()] = value
  }
  return target
}

/**
 * Читаем .env — там ключи бота и TMDB. Формата немного, парсим сами.
 *
 * Файлов два: в папке проекта (отладка) и в профиле пользователя.
 * У установленного приложения есть только второй — свои ключи внутрь
 * архива asar не положить.
 */
const readEnv = () => {
  const result = parseEnvFile(path.join(APP_ROOT, '.env'), {})
  return parseEnvFile(path.join(USER_DATA_DIR, '.env'), result)
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0e1a', // фон сайта, чтобы не мигало белым при старте
    show: false,
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, 'build', 'icon.ico'),
    // Рамку красим под сайт: стандартная светлая полоса с File/Edit/View
    // выглядела чужеродно поверх тёмного интерфейса.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0e1a',
      symbolColor: '#00e5ff',
      height: 34
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  restorePlayerProgress = playerProgress.createRestorer(mainWindow.webContents)

  // Ссылки наружу открываем в системном браузере, а не внутри приложения
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch((err) => console.warn(err.message))
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(isDev ? 'http://localhost:5173' : localUrl).origin) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch((err) => console.warn(err.message))
    }
  })

  // localUrl задаётся при старте: file:// не годится — собранный сайт
  // ищет ресурсы от корня диска и экран остаётся пустым.
  mainWindow.loadURL(isDev ? 'http://localhost:5173' : localUrl).catch((err) => {
    showStartupError(`Не удалось открыть интерфейс: ${err.message}`)
    app.quit()
  })

  mainWindow.on('close', (event) => {
    if (settings.closeToTray && tray && !quitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Состояние бэкенда — в окно.
 *
 * Раньше падение после успешного старта было видно только в консоли,
 * которой у собранного приложения нет: страница просто переставала
 * получать данные без единого слова на экране.
 */
const reportBackendStatus = ({ state, detail }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('app:backend-status', { state, detail })

  if (state === 'failed') {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'AbobaTV',
      message: 'Бэкенд перестал отвечать',
      detail: `${detail}\n\nСписки и история сейчас недоступны. Перезапустите приложение.`,
      buttons: ['Понятно']
    })
  }
}

const showStartupError = (message) => {
  dialog.showErrorBox('AbobaTV не запустился', message)
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return

  appEnv = readEnv()
  installLogger(LOG_DIR, Object.entries(appEnv).filter(([key]) => /TOKEN|KEY|SECRET|PASSWORD/.test(key)).map(([, value]) => value))
  settings = loadSettings()
  const moved = app.commandLine.hasSwitch('no-legacy-import') ? null : appData.migrateLegacyData({ dataDir: DATA_DIR, legacyDir: LEGACY_DATA_DIR })
  if (moved?.migrated) console.log('[data] база перенесена в', DATA_DIR, '| копия:', moved.backupDir)
  if (moved?.error) throw new Error(`Перенос базы не удался: ${moved.error}. Исходные данные сохранены.`)

  try {
    await startConfiguredBackend()
  } catch (err) {
    // Без бэкенда работать нечему: не будет ни списков, ни истории
    showStartupError(
      `Не удалось запустить бэкенд.\n\n${err.message}\n\n` +
        'Проверьте, что рядом с приложением есть окружение Python.'
    )
    app.quit()
    return
  }

  // Telegram-бот работает только на сервере в Docker. Клиент не запускает polling.

  try {
    localUrl = await lanShare.startLocal({
      distDir: DIST_DIR,
      backendPort: backend.BACKEND_PORT
    })
  } catch (err) {
    showStartupError(`Не удалось поднять локальный сервер.

${err.message}`)
    app.quit()
    return
  }

  // Меню File/Edit/View приложению не нужно — всё управление внутри страницы
  Menu.setApplicationMenu(null)

  // До окна: из кеша движок поднимается за миллисекунды, и реклама не успевает
  // проскочить в первом же открытом плеере.
  adblock.start({ userDataDir: USER_DATA_DIR, session: session.defaultSession, enabled: settings.adblock })

  createWindow()
  try {
    tray = new Tray(path.join(APP_ROOT, 'build', 'icon.ico'))
    tray.setToolTip(instance.name)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть AbobaTV', click: showMainWindow },
      { label: 'Открыть журнал', click: () => shell.openPath(LOG_DIR) },
      { type: 'separator' },
      { label: 'Выйти', click: () => app.quit() }
    ]))
    tray.on('double-click', showMainWindow)
  } catch (err) { console.warn('Трей недоступен:', err.message) }

  updater.init(app, {
    onStatus: (state) => mainWindow?.webContents.send('app:update-status', state),
    // Установщику нужны свободные файлы: трей не должен перехватить закрытие,
    // а Python-бэкенд — держать папку приложения.
    beforeInstall: () => {
      quitting = true
      backend.stopBackend()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => {
  console.error('Ошибка запуска:', err)
  showStartupError(err.message)
  app.quit()
})

app.on('window-all-closed', () => {
  backend.stopBackend()
  lanShare.stopSharing()
  lanShare.stopLocal()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  backend.stopBackend()
  lanShare.stopSharing()
  lanShare.stopLocal()
})

// ──────────────────────────────────────────────
//  Обмен с окном
// ──────────────────────────────────────────────
// Системные операции доступны только главному документу нашего окна.
const handle = (channel, callback) => ipcMain.handle(channel, async (event, ...args) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame ||
      new URL(event.senderFrame.url).origin !== new URL(isDev ? 'http://localhost:5173' : localUrl).origin) {
    throw new Error('Недоверенный источник запроса')
  }
  return callback(...args)
})

// Серия и таймкод из плеера: читает и возвращает главный процесс,
// хранит и синхронизирует бэкенд (страница отправляет туда сама).
handle('player:read-progress', async (src) => {
  try {
    return await playerProgress.readProgress(mainWindow.webContents, String(src || ''))
  } catch {
    return null
  }
})
handle('player:restore-progress', async (entries, src) => restorePlayerProgress(entries, String(src || '')))

handle('share:status', async () => ({
  active: lanShare.isSharing(),
  url: lanShare.isSharing() ? lanShare.buildUrl() : null,
  address: lanShare.getLanAddress(),
  port: lanShare.SHARE_PORT,
  firewallOpen: await lanShare.checkFirewall(),
  backendRunning: backend.isBackendRunning(),
  addresses: lanShare.getLanAddresses(),
  backend: backend.backendStatus(),
  // Сам адрес окну не отдаём: показывать его незачем.
  authConfigured: !!authServerUrl(),
  authCustom: !!settings.authServerUrl,
  settings,
  adblock: adblock.status()
}))

handle('share:start', async () => {
  try {
    const info = await lanShare.startSharing({
      distDir: DIST_DIR,
      backendPort: backend.BACKEND_PORT
    })
    return { ok: true, ...info, firewallOpen: await lanShare.checkFirewall() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

handle('share:stop', async () => ({ ok: await lanShare.stopSharing() }))

handle('share:open-firewall', async () => {
  const ok = await lanShare.openFirewall()
  return { ok, firewallOpen: await lanShare.checkFirewall() }
})

handle('app:version', () => app.getVersion())
handle('update:status', () => ({ ...updater.status(), current: app.getVersion() }))
handle('update:check', async () => ({ ...(await updater.check()), current: app.getVersion() }))
handle('update:install', () => updater.install())
handle('app:open-logs', () => shell.openPath(LOG_DIR))
handle('app:settings', async (next) => {
  if (maintenance) return { ok: false, error: 'Дождитесь завершения текущей операции' }
  maintenance = true
  const previous = settings
  try {
    const validated = {
      authServerUrl: settingsStore.validateAuthUrl(next.authServerUrl),
      closeToTray: next.closeToTray === true,
      adblock: next.adblock !== false
    }
    const changed = validated.authServerUrl !== settings.authServerUrl
    settings = validated
    if (changed) {
      backend.stopBackend()
      await startConfiguredBackend()
    }
    settingsStore.saveSettings(USER_DATA_DIR, settings)
    adblock.setEnabled(settings.adblock)
    return { ok: true }
  } catch (err) {
    settings = previous
    backend.stopBackend()
    try { await startConfiguredBackend() } catch (restartError) { console.error(restartError) }
    return { ok: false, error: err.message }
  } finally { maintenance = false }
})
handle('app:backup', async () => {
  if (maintenance) return { ok: false, error: 'Дождитесь завершения текущей операции' }
  maintenance = true
  try {
    const file = await backups.createBackup(APP_ROOT, USER_DATA_DIR)
    return { ok: true, file }
  } catch (err) { return { ok: false, error: err.message } }
  finally { maintenance = false }
})
// Файл импорта библиотеки (история из браузера и т.п.). Разбирает и сливает
// его бэкенд; здесь только выбор файла — у страницы нет доступа к диску.
handle('app:pick-import', async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Импорт библиотеки AbobaTV', extensions: ['json'] }]
  })
  if (selected.canceled) return { ok: false, canceled: true }
  const file = selected.filePaths[0]
  if (fs.statSync(file).size > 5 * 1024 * 1024) return { ok: false, error: 'Файл импорта слишком большой' }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (data?.format !== 'abobatv-import') return { ok: false, error: 'Это не файл импорта AbobaTV' }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Не удалось прочитать файл импорта' }
  }
})

handle('app:restore', async () => {
  if (maintenance) return { ok: false, error: 'Дождитесь завершения текущей операции' }
  maintenance = true
  let stopped = false
  try {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Копия AbobaTV', extensions: ['zip'] }] })
    if (selected.canceled) return { ok: false, canceled: true }
    const decision = await dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Заменить историю и настройки выбранной копией?', detail: 'Перед восстановлением сохраним текущие данные в отдельную копию.', buttons: ['Отмена', 'Восстановить'], defaultId: 0, cancelId: 0 })
    if (decision.response !== 1) return { ok: false, canceled: true }
    await backups.createBackup(APP_ROOT, USER_DATA_DIR)
    backend.stopBackend()
    stopped = true
    await backups.runBackup(APP_ROOT, 'restore', USER_DATA_DIR, selected.filePaths[0])
    settings = loadSettings()
    adblock.setEnabled(settings.adblock)
    await startConfiguredBackend()
    stopped = false
    mainWindow.webContents.send('app:restored')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
  finally {
    if (stopped) { try { await startConfiguredBackend() } catch (err) { console.error(err) } }
    maintenance = false
  }
})

ipcMain.on('app:open-external', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url)
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

ipcMain.on('app:toast', (_e, message) => {
  mainWindow?.webContents.send('app:toast', message)
})
