import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { useThemeStore } from '@/store/theme'
import AppIcon from './AppIcon.vue'

describe('сезонные иконки', () => {
  it('меняет рисунок без изменения размера и возвращает Lucide в классике', async () => {
    const pinia = createPinia(), theme = useThemeStore(pinia)
    const wrapper = mount(AppIcon, { props: { name: 'fingerprint', size: 17 }, global: { plugins: [pinia] } })
    const classic = wrapper.find('svg').html()
    expect(wrapper.find('.app-icon--halloween').exists()).toBe(false)
    theme.setTheme('halloween'); await wrapper.vm.$nextTick()
    expect(wrapper.find('.app-icon--halloween').exists()).toBe(true)
    expect(wrapper.find('svg').attributes('width')).toBe('17')
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
    theme.setTheme('classic'); await wrapper.vm.$nextTick()
    expect(wrapper.find('svg').html()).toBe(classic)
    wrapper.unmount()
  })
})
