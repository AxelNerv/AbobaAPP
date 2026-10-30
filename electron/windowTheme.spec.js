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
})
