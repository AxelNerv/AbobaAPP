import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import persist from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { useThemeStore } from './theme'

const setup = () => {
  const pinia = createPinia().use(persist)
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useThemeStore()
}

describe('темы оформления', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })
  it('сохраняет привычный вид по умолчанию', () => {
    const theme = setup()
    theme.initTheme()
    expect(theme.theme).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(theme.accent).toBe('cyan')
  })
  it('не сбрасывает цвет и фон при переключении темы', () => {
    const theme = setup()
    theme.setCustomColor('#ff8055')
    theme.setBackground('plain')
    theme.setTheme('halloween')
    expect(document.documentElement.dataset.theme).toBe('halloween')
    // Seasonal preset is now complete; the classic preference stays stored.
    expect(document.documentElement.dataset.bg).toBe('glow')
    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe('#c48063')
    expect(theme.customColor).toBe('#ff8055')
    theme.setTheme('classic')
    expect(document.documentElement.style.getPropertyValue('--accent-color')).toBe('#ff8055')
    expect(theme.background).toBe('plain')
  })
  it('восстанавливает тему и настройки после открытия приложения', () => {
    const theme = setup()
    theme.setTheme('halloween')
    theme.setAccent('violet')
    theme.setBackground('poster')
    theme.$persist()
    const restored = setup()
    restored.initTheme()
    expect(restored.theme).toBe('halloween')
    expect(restored.accent).toBe('violet')
    expect(restored.background).toBe('poster')
  })
  it('читает старые настройки без поля темы', () => {
    localStorage.setItem('aboba-theme', JSON.stringify({ accent: 'amber', background: 'accent' }))
    const theme = setup()
    theme.initTheme()
    expect(theme.theme).toBe('classic')
    expect(theme.accent).toBe('amber')
  })
  it('не применяет неизвестную тему из хранилища', () => {
    localStorage.setItem('aboba-theme', JSON.stringify({ theme: 'unknown' }))
    const theme = setup()
    theme.initTheme()
    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(theme.theme).toBe('classic')
    theme.setTheme('invalid')
    expect(theme.theme).toBe('classic')
  })
})
