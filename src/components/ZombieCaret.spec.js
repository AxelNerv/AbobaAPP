import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia } from 'pinia'
import { useThemeStore } from '@/store/theme'
import ZombieCaret from './ZombieCaret.vue'

describe('мини-зомби рядом с позицией ввода', () => {
  let input, parent, wrapper, theme
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' })
    parent = document.createElement('div')
    input = document.createElement('input')
    input.style.cssText = 'padding:10px;direction:ltr;font:14px Arial'
    input.getBoundingClientRect = () => ({ left: 0, top: 0, width: 220, height: 40 })
    parent.append(input); document.body.append(parent)
    const pinia = createPinia()
    theme = useThemeStore(pinia); theme.setTheme('halloween')
    wrapper = mount(ZombieCaret, { props: { input }, attachTo: parent, global: { plugins: [pinia] } })
    await nextTick()
  })
  afterEach(() => { wrapper?.unmount(); parent.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
  const type = async text => {
    input.value = text; input.focus(); input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new window.Event('input')); await nextTick()
  }
  it('движется при печати и не заменяет нативное выделение/IME', async () => {
    await type('Тест')
    const firstLeft = wrapper.element.style.left
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(true)
    expect(wrapper.classes()).toContain('zombie-caret--walking')
    await type('Тест текста')
    expect(parseFloat(wrapper.element.style.left)).toBeGreaterThan(parseFloat(firstLeft))
    input.setSelectionRange(0, 3); input.dispatchEvent(new window.Event('select')); await nextTick()
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(false)
    input.setSelectionRange(2, 2); input.dispatchEvent(new window.Event('compositionstart')); await nextTick()
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(false)
    input.dispatchEvent(new window.Event('compositionend')); await nextTick()
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.classes()).not.toContain('zombie-caret--walking')
  })
  it('оставляет обычный курсор для классики, RTL и длинной прокрученной строки', async () => {
    await type('Текст')
    theme.setTheme('classic'); await nextTick(); await nextTick()
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(false)
    theme.setTheme('halloween'); await type('Текст')
    input.style.direction = 'rtl'; input.dispatchEvent(new window.Event('keyup')); await nextTick()
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(false)
    input.style.direction = 'ltr'; await type('длинный текст'.repeat(20))
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(false)
  })
  it('убирает таймер и возвращает обычный курсор при закрытии поля', async () => {
    await type('Текст')
    await vi.advanceTimersByTimeAsync(0)
    wrapper.unmount(); wrapper = null
    expect(input.classList.contains('zombie-caret-native-hidden')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
