import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlayerModal from './PlayerModal.vue'

// jsdom has no modal-dialog implementation; native focus trapping is checked
// separately in Electron. Keep the component lifecycle and events real here.
const dialogPrototype = window.HTMLDialogElement.prototype
const originalShow = Object.getOwnPropertyDescriptor(dialogPrototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(dialogPrototype, 'close')
beforeAll(() => {
  Object.defineProperty(dialogPrototype, 'showModal', {
    configurable: true,
    value: vi.fn(function () {
      this.setAttribute('open', '')
    })
  })
  Object.defineProperty(dialogPrototype, 'close', {
    configurable: true,
    value: vi.fn(function () {
      this.removeAttribute('open')
    })
  })
})
afterAll(() => {
  if (originalShow) Object.defineProperty(dialogPrototype, 'showModal', originalShow)
  else delete dialogPrototype.showModal
  if (originalClose) Object.defineProperty(dialogPrototype, 'close', originalClose)
  else delete dialogPrototype.close
})

const players = [
  { key: 'TURBO', provider: 'Turbo', translate: 'Turbo', iframe: 'https://x.obrut.show/film' },
  { key: 'COLLAPS', provider: 'Collaps', iframe: 'https://api.nextembed.ws/film' },
  { key: 'VEOVEO', provider: 'Veoveo', iframe: 'https://kurolesya.link/film' }
]
let wrapper
let opener
const create = (props = {}) =>
  mount(PlayerModal, {
    props: { players, selectedPlayer: players[0], movieTitle: 'Железное лёгкое', ...props },
    attachTo: document.body,
    global: { stubs: { Teleport: true, AppIcon: true } }
  })
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  opener?.remove()
  opener = null
  document.body.style.overflow = ''
})

describe('единый выбор источников видео', () => {
  it('сразу показывает все плееры и текущий выбор, без вложенных папок', () => {
    wrapper = create()
    expect(wrapper.findAll('.player-item')).toHaveLength(3)
    expect(wrapper.text()).toContain('Железное лёгкое')
    expect(wrapper.find('[data-player-key="TURBO"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-player-key="VEOVEO"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.find('.group-item').exists()).toBe(false)
  })

  it('выбирает Veoveo одним нажатием и закрывается', async () => {
    wrapper = create()
    await wrapper.find('[data-player-key="VEOVEO"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[players[2]]])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('Esc закрывает выбор, а размонтирование возвращает фокус и прокрутку', async () => {
    opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    document.body.style.overflow = 'auto'
    wrapper = create()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement.getAttribute('data-player-key')).toBe('TURBO')
    await wrapper.find('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    wrapper = null
    expect(document.activeElement).toBe(opener)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('не выдаёт отсутствие плееров за недоступность KinoBD', () => {
    wrapper = create({ players: [], selectedPlayer: null })
    expect(wrapper.find('[role="status"]').text()).toContain('пока нет доступных плееров')
    expect(wrapper.text()).not.toContain('KinoBD')
  })
})
