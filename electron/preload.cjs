/**
 * Мост между окном и системой.
 *
 * Наружу отдаём только конкретные действия, а не доступ к Node целиком:
 * страница грузит стороннее содержимое (плееры в iframe), и открывать ей
 * файловую систему нельзя.
 */
const { contextBridge, ipcRenderer } = require('electron')
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Раздача по Wi-Fi ──
  share: {
    status: () => ipcRenderer.invoke('share:status'),
    start: () => ipcRenderer.invoke('share:start'),
    stop: () => ipcRenderer.invoke('share:stop'),
    openFirewall: () => ipcRenderer.invoke('share:open-firewall')
  },

  // ── Окно ──
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // Уведомление в углу окна. Этот вызов уже есть в коде плеера —
  // раньше он молчал, потому что приложения не существовало.
  showToast: (message) => ipcRenderer.send('app:toast', String(message || '')),

  // Обратная сторона: без неё сообщение уходило в главный процесс и
  // возвращалось в окно, где его никто не слушал. Плеер «показывал»
  // уведомления, а на экране не появлялось ничего.
  onToast: (callback) => subscribe('app:toast', callback),

  // Состояние бэкенда: упал, перезапускается, сдался.
  onBackendStatus: (callback) => subscribe('app:backend-status', callback),
  onRestored: (callback) => subscribe('app:restored', callback),
  saveSettings: (settings) => ipcRenderer.invoke('app:settings', settings),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  createBackup: () => ipcRenderer.invoke('app:backup'),
  restoreBackup: () => ipcRenderer.invoke('app:restore'),
  pickImportFile: () => ipcRenderer.invoke('app:pick-import'),

  // Позиция просмотра внутри плеера (серия, таймкод)
  player: {
    readProgress: (src) => ipcRenderer.invoke('player:read-progress', String(src || '')),
    restoreProgress: (entries, src, resume) =>
      ipcRenderer.invoke('player:restore-progress', entries, String(src || ''), resume || null)
  },

  // Обновления из выпусков GitHub
  updates: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => subscribe('app:update-status', callback)
  },

  openExternal: (url) => ipcRenderer.send('app:open-external', String(url || '')),

  version: () => ipcRenderer.invoke('app:version')
})
