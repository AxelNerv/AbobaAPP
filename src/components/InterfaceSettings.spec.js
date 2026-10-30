import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import InterfaceSettings from './InterfaceSettings.vue'

describe('выбор темы', () => {
  let wrapper
  beforeEach(() => { localStorage.clear(); window.electronAPI = { restartForTheme: vi.fn().mockResolvedValue({ ok: true }) } })
  afterEach(() => { wrapper?.unmount(); delete window.electronAPI })
  it('применяет оформление и перезапускается только после Да, Нет ничего не меняет', async () => {
    wrapper = mount(InterfaceSettings, { global: { plugins: [createPinia()], stubs: ['ThemeConfirmation'] } })
    const buttons = wrapper.findAll('.theme-option')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].attributes('aria-pressed')).toBe('true')
    await buttons[1].trigger('click')
    expect(buttons[0].attributes('aria-pressed')).toBe('true')
    let modal = wrapper.findComponent({ name: 'ThemeConfirmation' })
    modal.vm.$emit('cancel')
    await flushPromises()
    expect(window.electronAPI.restartForTheme).not.toHaveBeenCalled()
    await buttons[1].trigger('click')
    modal = wrapper.findComponent({ name: 'ThemeConfirmation' })
    modal.vm.$emit('confirm')
    await flushPromises()
    expect(buttons[1].attributes('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.theme).toBe('halloween')
    expect(window.electronAPI.restartForTheme).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.swatch')).toHaveLength(0)
    await buttons[0].trigger('click')
    wrapper.findComponent({ name: 'ThemeConfirmation' }).vm.$emit('confirm')
    await flushPromises()
    expect(document.documentElement.dataset.theme).toBe('classic')
    expect(wrapper.findAll('.swatch')).toHaveLength(5)
    expect(wrapper.findAll('.segment')).toHaveLength(4)
  })
})
