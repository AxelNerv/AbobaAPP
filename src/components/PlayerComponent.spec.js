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
    delete window.electronAPI
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

  it('при отказе резервов останавливает повторы и оставляет Turbo для ручного выбора', async () => {
    getPlayers.mockResolvedValueOnce({ Turbo: { iframe: 'https://example.org/first', source: 'fbp' } })
      .mockRejectedValueOnce(Object.assign(new Error('all offline'), { allSourcesDown: true }))
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(12001)
    expect(wrapper.find('error-message-stub').exists()).toBe(false)
    await wrapper.find('.player-btn').trigger('click')
    const modal = wrapper.findComponent({ name: 'PlayerModal' })
    expect(modal.props('players')).toHaveLength(1)
    modal.vm.$emit('select', modal.props('players')[0])
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('iframe').attributes('src')).toContain('/first')
    await wrapper.find('iframe').trigger('load')
    await vi.advanceTimersByTimeAsync(60000)
    expect(getPlayers).toHaveBeenCalledTimes(2)
  })

  it('Turbo не исчезает из списка после автоматического перехода на резерв', async () => {
    getPlayers.mockResolvedValueOnce({ Turbo: { iframe: 'https://x.obrut.show/serial', provider: 'Turbo', source: 'fbp' } })
      .mockResolvedValueOnce({ Collaps: { iframe: 'https://example.org/backup', provider: 'Collaps', source: 'kinobd' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(12001)
    expect(wrapper.find('iframe').attributes('src')).toContain('/backup')
    await wrapper.find('.player-btn').trigger('click')
    expect(wrapper.findComponent({ name: 'PlayerModal' }).props('players').map(p => p.provider)).toEqual(['Turbo', 'Collaps'])
  })

  it('поздний ответ резерва не отменяет ручной возврат к Turbo', async () => {
    let finish
    getPlayers.mockResolvedValueOnce({ Turbo: { iframe: 'https://x.obrut.show/serial', provider: 'Turbo', source: 'fbp' } })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(12001)
    const signal = getPlayers.mock.calls[1][1].signal
    await wrapper.find('.player-btn').trigger('click')
    const modal = wrapper.findComponent({ name: 'PlayerModal' })
    modal.vm.$emit('select', modal.props('players')[0])
    await vi.advanceTimersByTimeAsync(0)
    expect(signal.aborted).toBe(true)
    finish({ Collaps: { iframe: 'https://example.org/backup', provider: 'Collaps', source: 'kinobd' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('iframe').attributes('src')).toContain('obrut.show')
  })

  it('зависшее после просмотра видео пересоздаёт без перезапуска приложения и входа', async () => {
    const entries = { 'pljsplayfrom_player{host}/serial': '{xxx-0-3-0}51--1400--1793440000000' }
    let time = 0
    window.electronAPI = { player: {
      readPlayback: vi.fn(async () => ({ time, paused: false, ended: false, readyState: 4 })),
      readProgress: vi.fn(async () => ({ entries, frames: { 'obrut.show': entries } })),
      restoreProgress: vi.fn(async () => true)
    } }
    getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://x.obrut.show/serial', provider: 'Turbo', source: 'fbp' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.find('iframe').trigger('load')
    const original = wrapper.find('iframe').element
    await vi.advanceTimersByTimeAsync(10_000)
    time = 51
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.find('iframe').element).not.toBe(original)
    expect(window.electronAPI.player.restoreProgress).toHaveBeenCalledWith(
      { 'obrut.show': entries }, 'https://x.obrut.show/serial', { time: 51, duration: 1400 })
    expect(getPlayers).toHaveBeenCalledTimes(1)
    await wrapper.find('iframe').trigger('load')
    // A rapid second stall tries reserves instead of endlessly reloading Turbo.
    await vi.advanceTimersByTimeAsync(10_000)
    time = 61
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(window.electronAPI.player.restoreProgress).toHaveBeenCalledTimes(1)
    expect(getPlayers).toHaveBeenCalledTimes(2)
  })

  it('закрытие страницы во время чтения состояния не восстанавливает старый iframe', async () => {
    let finish
    window.electronAPI = { player: {
      readPlayback: vi.fn(() => new Promise(resolve => { finish = resolve }))
    } }
    getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://x.obrut.show/serial', provider: 'Turbo', source: 'fbp' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.find('iframe').trigger('load')
    await vi.advanceTimersByTimeAsync(10_000)
    wrapper.unmount()
    wrapper = null
    finish({ time: 10, paused: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(getPlayers).toHaveBeenCalledTimes(1)
  })

  it('при закрытии страницы убирает таймер автоматического перехода', async () => {
    getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://example.org/turbo', source: 'fbp' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(1501)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
    wrapper = null
  })

  it('новый резерв виден в выборе, но не вытесняет Turbo по умолчанию', async () => {
    getPlayers.mockResolvedValue({
      Veoveo: { iframe: 'https://kurolesya.link/film', provider: 'Veoveo', source: 'fbp' },
      Turbo: { iframe: 'https://x.obrut.show/embed/film', provider: 'Turbo', source: 'fbp' }
    })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('iframe').attributes('src')).toContain('obrut.show')
    await wrapper.find('.player-btn').trigger('click')
    const modal = wrapper.findComponent({ name: 'PlayerModal' })
    expect(modal.props('players').map(player => player.provider)).toEqual(['Turbo', 'Veoveo'])
  })

  it('сохраняет оба разных маршрута Veoveo и переходит между ними при ошибке', async () => {
    getPlayers.mockResolvedValue({
      Turbo: { iframe: 'https://x.obrut.show/serial', provider: 'Turbo', source: 'fbp' },
      'Veoveo 1': { iframe: 'https://player.shortener2.link/serial', provider: 'Veoveo', providerVariant: 'shortener2.link', source: 'fbp' },
      'Veoveo 2': { iframe: 'https://kurolesya.link/serial', provider: 'Veoveo', providerVariant: 'kurolesya.link', source: 'fbp' }
    })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    await wrapper.find('.player-btn').trigger('click')
    expect(wrapper.findComponent({ name: 'PlayerModal' }).props('players')).toHaveLength(3)
    await wrapper.find('iframe').trigger('error')
    expect(wrapper.find('iframe').attributes('src')).toContain('shortener2.link')
    await wrapper.find('iframe').trigger('error')
    expect(wrapper.find('iframe').attributes('src')).toContain('kurolesya.link')
  })

  it('открывает один список плееров вместо отдельного поиска версий KinoBD', async () => {
    getPlayers.mockResolvedValue({ Turbo: { iframe: 'https://x.obrut.show/film', provider: 'Turbo' } })
    wrapper = createPlayer()
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.source-btn').exists()).toBe(false)
    expect(wrapper.find('.player-btn').text()).toContain('Источник видео')
    await wrapper.find('.player-btn').trigger('click')
    expect(wrapper.find('.player-btn').attributes('aria-expanded')).toBe('true')
    const modal = wrapper.findComponent({ name: 'PlayerModal' })
    modal.vm.$emit('select', { key: 'VEOVEO', iframe: 'https://kurolesya.link/film', provider: 'Veoveo' })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('iframe').attributes('src')).toContain('kurolesya.link')
    expect(localStorage.getItem('abobatv_selected_player_687595')).toBe('VEOVEO')
  })
})
