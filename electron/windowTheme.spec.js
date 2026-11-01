// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
const { setWindowTheme } = createRequire(import.meta.url)('./windowTheme.cjs')
describe('цвет системной панели', () => {
  it('переключает сезонные и классические цвета Windows', () => {
    const win = { isDestroyed: () => false, setTitleBarOverlay: vi.fn() }
    setWindowTheme(win, 'halloween', 'win32')
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: '#100c13', symbolColor: '#d6ad91' })
    setWindowTheme(win, 'classic', 'win32')
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: '#0a0e1a', symbolColor: '#00e5ff' })
  })
  it('отвергает произвольные значения и не вызывает Windows API на macOS', () => {
    const win = { isDestroyed: () => false, setTitleBarOverlay: vi.fn() }
    expect(() => setWindowTheme(win, '#fff', 'win32')).toThrow('Неизвестная')
    setWindowTheme(win, 'halloween', 'darwin')
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled()
  })
  it('меняет значок работающего окна и трея вместе с темой', () => {
    const win = { isDestroyed: () => false, setTitleBarOverlay: vi.fn(), setIcon: vi.fn() }
    const tray = { isDestroyed: () => false, setImage: vi.fn() }
    const icons = { halloween: '/app/icon-halloween.png', classic: '/app/icon.ico' }
    setWindowTheme(win, 'halloween', 'win32', { icons, tray })
    expect(win.setIcon).toHaveBeenLastCalledWith(icons.halloween)
    expect(tray.setImage).toHaveBeenLastCalledWith(icons.halloween)
    setWindowTheme(win, 'classic', 'win32', { icons, tray })
    expect(win.setIcon).toHaveBeenLastCalledWith(icons.classic)
    expect(tray.setImage).toHaveBeenLastCalledWith(icons.classic)
  })
})
