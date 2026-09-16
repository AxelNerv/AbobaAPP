/**
 * Обновления из выпусков GitHub (AxelNerv/AbobaAPP).
 *
 * Сами ничего не качаем и не ставим: находим новую версию, сообщаем окну,
 * а скачивание и установка — только по кнопке пользователя. Посреди серии
 * приложение не должно закрыться само.
 *
 * electron-updater берёт latest.yml из выпуска, скачивает установщик и
 * сверяет SHA-512 из этого файла. Установщик не подписан, поэтому проверки
 * подписи нет — источник доверия здесь сам репозиторий и HTTPS GitHub.
 *
 * Ставить поверх умеет только установленная версия (там есть деинсталлятор
 * NSIS). Папка сборки без установщика получает ссылку на страницу выпуска.
 */
const fs = require('fs')
const path = require('path')

const RELEASES_URL = 'https://github.com/AxelNerv/AbobaAPP/releases/latest'
const FIRST_CHECK_DELAY_MS = 15 * 1000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let autoUpdater = null
let state = { state: 'idle', version: null, notes: '', percent: 0, error: '', installable: false, releasesUrl: RELEASES_URL }
let notify = () => {}
let beforeInstall = () => {}
let timer = null

const set = (patch) => {
  state = { ...state, ...patch }
  try {
    notify(state)
  } catch {
    // окно могло закрыться
  }
}

/** Установлено ли приложение установщиком (а не распаковано в папку). */
const isInstalled = (app) => {
  if (!app.isPackaged || process.platform !== 'win32') return false
  const dir = path.dirname(process.execPath)
  return fs.readdirSync(dir).some((name) => /^Uninstall .*\.exe$/i.test(name))
}

const notesText = (info) => {
  const notes = info?.releaseNotes
  if (Array.isArray(notes)) return notes.map((n) => n.note || '').join('\n')
  // GitHub отдаёт заметки HTML-ом; окну нужен простой текст.
  return String(notes || '').replace(/<[^>]+>/g, '').trim().slice(0, 2000)
}

const init = (app, hooks = {}) => {
  notify = hooks.onStatus || notify
  beforeInstall = hooks.beforeInstall || beforeInstall
  if (!app.isPackaged) {
    set({ state: 'unsupported', error: 'Обновления работают только в собранном приложении' })
    return
  }
  ;({ autoUpdater } = require('electron-updater'))
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = { info: (m) => console.log('[update]', m), warn: (m) => console.warn('[update]', m), error: (m) => console.error('[update]', m), debug: () => {} }

  const installable = isInstalled(app)
  set({ installable })

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: '' }))
  autoUpdater.on('update-not-available', () => set({ state: 'latest', version: null }))
  autoUpdater.on('update-available', (info) =>
    set({ state: 'available', version: info.version, notes: notesText(info), percent: 0 })
  )
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version, percent: 100 }))
  autoUpdater.on('error', (err) =>
    set({ state: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 300) })
  )

  setTimeout(check, FIRST_CHECK_DELAY_MS)
  timer = setInterval(check, CHECK_INTERVAL_MS)
}

const check = async () => {
  if (!autoUpdater || ['checking', 'downloading', 'downloaded'].includes(state.state)) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 300) })
  }
  return state
}

/** Скачать (если ещё нет) и поставить поверх, перезапустив приложение. */
const install = async () => {
  if (!autoUpdater) return { ok: false, error: 'Обновления недоступны' }
  if (!state.installable) return { ok: false, error: 'Эта копия не установлена установщиком', releasesUrl: RELEASES_URL }
  if (state.state === 'available' || state.state === 'error') {
    set({ state: 'downloading', percent: 0, error: '' })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      set({ state: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 300) })
      return { ok: false, error: state.error }
    }
  }
  if (state.state !== 'downloaded') return { ok: false, error: 'Обновление ещё не скачано' }
  clearInterval(timer)
  beforeInstall()
  // Тихая установка поверх и запуск новой версии: окно установщика не нужно,
  // папка и данные остаются прежними.
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 0)
  return { ok: true }
}

const status = () => state

module.exports = { init, check, install, status, RELEASES_URL }
