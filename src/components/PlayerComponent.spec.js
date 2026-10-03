import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import PlayerComponent from './PlayerComponent.vue'

const getPlayers = vi.hoisted(() => vi.fn())
vi.mock('@/api/movies', () => ({ getPlayers, searchKinoBDPlayerCandidates: vi.fn(), getKinoBDPlayerDataByInid: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { kp_id: '687595' } }) }))
vi.mock('@/api/playerQuality', () => ({ hasAllohaUhd: () => false }))
vi.mock('@/api/user', () => ({ getWatchProgress: vi.fn(), saveWatchProgress: vi.fn() }))

const createPlayer = () => mount(PlayerComponent, {
  props: { kpId: '687595' },
  global: {
    plugins: [createPinia()],
    stubs: ['AppIcon', 'ErrorMessage', 'SpinnerLoading', 'Notification', 'SliderRound', 'PlayerModal']
  }
})

describe('ожидание резервных источников в интерфейсе', () => {
  let wrapper
  beforeEach(() => {
    vi.useFakeTimers()
    getPlayers.mockReset()
    localStorage.clear()
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('не обрывает цепочку через 20 секунд и показывает поздний резерв', async () => {
    getPlayers.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({
      Turbo: { iframe: 'https://example.org/turbo', provider: 'Turbo', source: 'kinobox' }
    }), 21000)))
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(20001)
    expect(wrapper.find('error-message-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('Загрузка плееров')
    await vi.advanceTimersByTimeAsync(1100)
    expect(wrapper.find('iframe').attributes('src')).toContain('/turbo')
    expect(wrapper.find('error-message-stub').exists()).toBe(false)
  })

  it('при закрытии страницы отменяет запрос и игнорирует поздний ответ', async () => {
    let finish
    getPlayers.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    const signal = getPlayers.mock.calls[0][1].signal
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    finish({ Turbo: { iframe: 'https://example.org/turbo', provider: 'Turbo' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.emitted('update:selectedPlayer')).toBeUndefined()
    wrapper = null
  })

  it('после зависшего iframe запрашивает следующий агрегатор', async () => {
    getPlayers.mockResolvedValueOnce({ Turbo: { iframe: 'https://example.org/first', provider: 'Turbo', source: 'fbp' } })
      .mockResolvedValueOnce({ Turbo: { iframe: 'https://example.org/backup', provider: 'Turbo', source: 'kinobd' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('iframe').attributes('src')).toContain('/first')
    await vi.advanceTimersByTimeAsync(12001)
    expect(getPlayers.mock.calls[1][1].excludeSources).toEqual(['fbp'])
    expect(wrapper.find('iframe').attributes('src')).toContain('/backup')
  })

  it('после всех зависших iframe останавливается с ошибкой', async () => {
    getPlayers.mockResolvedValueOnce({ Turbo: { iframe: 'https://example.org/first', source: 'fbp' } })
      .mockRejectedValueOnce(Object.assign(new Error('all offline'), { allSourcesDown: true }))
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(12001)
    expect(wrapper.find('error-message-stub').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(60000)
    expect(getPlayers).toHaveBeenCalledTimes(2)
  })

  it('при закрытии страницы убирает таймер автоматического перехода', async () => {
    getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://example.org/turbo', source: 'fbp' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(1501)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
    wrapper = null
  })
})
