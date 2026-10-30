// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
const { createThemeRestart } = createRequire(import.meta.url)('./themeRestart.cjs')
describe('перезапуск оформления', () => {
  it('планирует только один обычный relaunch без пользовательских аргументов', () => {
    const app = { relaunch: vi.fn(), quit: vi.fn() }, beforeQuit = vi.fn()
    let finish
    const restart = createThemeRestart({ app, beforeQuit, isBusy: () => false, schedule: fn => { finish = fn } })
    expect(restart()).toEqual({ ok: true })
    restart()
    expect(app.relaunch).toHaveBeenCalledExactlyOnceWith()
    expect(app.quit).not.toHaveBeenCalled()
    finish()
    expect(beforeQuit).toHaveBeenCalledOnce()
    expect(app.quit).toHaveBeenCalledOnce()
  })
  it('не прерывает резервное копирование или восстановление', () => {
    const app = { relaunch: vi.fn(), quit: vi.fn() }
    expect(createThemeRestart({ app, isBusy: () => true })().ok).toBe(false)
    expect(app.relaunch).not.toHaveBeenCalled()
  })
})
