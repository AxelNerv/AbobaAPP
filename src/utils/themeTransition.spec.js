import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useThemeStore } from '@/store/theme'
import { applyThemeAndRestart } from './themeTransition'
describe('подтверждённая смена темы', () => {
  beforeEach(() => { localStorage.clear(); setActivePinia(createPinia()) })
  it('сохраняет настройки до вызова нативного перезапуска', async () => {
    const theme = useThemeStore()
    const restartForTheme = vi.fn(() => {
      expect(JSON.parse(localStorage.getItem('aboba-theme')).theme).toBe('halloween')
      return { ok: true }
    })
    await applyThemeAndRestart(theme, 'halloween', { restartForTheme }, vi.fn())
    expect(restartForTheme).toHaveBeenCalledOnce()
  })
  it('в браузере перезагружает только страницу', async () => {
    const reload = vi.fn()
    await applyThemeAndRestart(useThemeStore(), 'halloween', null, reload)
    expect(reload).toHaveBeenCalledOnce()
  })
  it('при отказе перезапуска откатывает тему и сообщает ошибку', async () => {
    const theme = useThemeStore()
    await expect(applyThemeAndRestart(theme, 'halloween', { restartForTheme: () => ({ ok: false, error: 'Занято' }) }, vi.fn())).rejects.toThrow('Занято')
    expect(theme.theme).toBe('classic')
    expect(JSON.parse(localStorage.getItem('aboba-theme')).theme).toBe('classic')
  })
  it('не выдаёт отсутствие нового IPC за успешный перезапуск', async () => {
    await expect(applyThemeAndRestart(useThemeStore(), 'halloween', {}, vi.fn())).rejects.toThrow('новая сборка')
  })
})
