const setWindowTheme = (window, theme, platform = process.platform, { icons, tray } = {}) => {
  if (!['classic', 'halloween'].includes(theme)) throw new Error('Неизвестная тема окна')
  if (!window || window.isDestroyed()) return { ok: false }
  if (platform === 'win32' || platform === 'linux') {
    window.setTitleBarOverlay(theme === 'halloween'
      ? { color: '#100c13', symbolColor: '#d6ad91' }
      : { color: '#0a0e1a', symbolColor: '#00e5ff' })
    if (icons?.[theme]) window.setIcon(icons[theme])
  }
  if (icons?.[theme] && tray && !tray.isDestroyed()) tray.setImage(icons[theme])
  return { ok: true }
}
module.exports = { setWindowTheme }
