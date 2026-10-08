import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import MovieSearch from './MovieSearch.vue'

const mock = vi.hoisted(() => ({ apiSearch: vi.fn(), getMovies: vi.fn(), push: vi.fn(), route: { path: '/', params: {} } }))
vi.mock('@/api/movies', () => ({ apiSearch: mock.apiSearch, getMovies: mock.getMovies, getKpIDfromIMDB: vi.fn(), getRandomMovie: vi.fn(), getKpInfo: vi.fn() }))
vi.mock('@/api/user', () => ({ getMyLists: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => mock.route, useRouter: () => ({ push: mock.push }) }))
vi.mock('@unhead/vue', () => ({ useHead: vi.fn() }))

describe('поиск в интерфейсе', () => {
  let wrapper
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mock.route.path = '/'
    mock.getMovies.mockResolvedValue([])
    localStorage.clear()
  })
  afterEach(() => { wrapper?.unmount(); wrapper = null; window.location.hash = ''; vi.clearAllTimers(); vi.useRealTimers() })
  const createSearch = () => mount(MovieSearch, { global: { plugins: [createPinia()],
    stubs: ['MovieList', 'ErrorMessage', 'AppIcon', 'SpinnerLoading', 'RandomMovieModal'] } })
  const query = async text => {
    await wrapper.find('input').setValue(text)
    await wrapper.find('input').trigger('keydown.enter')
    await vi.advanceTimersByTimeAsync(0)
  }
  const results = () => wrapper.findComponent({ name: 'MovieList' }).props('moviesList')

  it('показывает найденный фильм с правильным ID', async () => {
    mock.apiSearch.mockResolvedValue([{ id: '687595', title: 'Кухня', raw_data: { type: 'series', rating: null } }])
    wrapper = createSearch()
    await query('Кухня')
    expect(results()).toMatchObject([{ kp_id: '687595', title: 'Кухня', type: 'series' }])
    expect(mock.apiSearch.mock.calls[0][2].signal.aborted).toBe(false)
  })

  it('старый ответ не заменяет новый поиск', async () => {
    let finish
    mock.apiSearch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce([{ id: '258687', title: 'Интерстеллар' }])
    wrapper = createSearch()
    await query('Кухня')
    const oldSignal = mock.apiSearch.mock.calls[0][2].signal
    await query('Интерстеллар')
    expect(oldSignal.aborted).toBe(true)
    finish([{ id: '687595', title: 'Кухня' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(results()[0].title).toBe('Интерстеллар')
  })

  it('при падении источников показывает ошибку, а не ничего не найдено', async () => {
    mock.apiSearch.mockRejectedValue(Object.assign(new Error('offline'), { allSourcesDown: true, details: ['offline'] }))
    wrapper = createSearch()
    await query('Кухня')
    expect(wrapper.find('error-message-stub').attributes('code')).toBe('503')
    expect(wrapper.find('.no-results').exists()).toBe(false)
  })

  it('снятие ввода отменяет запрос и убирает загрузку', async () => {
    mock.apiSearch.mockImplementation(() => new Promise(() => {}))
    wrapper = createSearch()
    await query('Кухня')
    const signal = mock.apiSearch.mock.calls[0][2].signal
    await wrapper.find('input').setValue('')
    expect(signal.aborted).toBe(true)
    expect(wrapper.text()).not.toContain('Результаты поиска')
  })

  it('при закрытии страницы запрос и отложенный поиск отменяются', async () => {
    mock.apiSearch.mockImplementation(() => new Promise(() => {}))
    wrapper = createSearch()
    await query('Кухня')
    const signal = mock.apiSearch.mock.calls[0][2].signal
    await wrapper.find('input').setValue('Интерстеллар')
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(1000)
    expect(signal.aborted).toBe(true)
    expect(mock.apiSearch).toHaveBeenCalledTimes(1)
    wrapper = null
  })

  it('поиск по ID Кинопоиска по-прежнему сразу открывает фильм', async () => {
    mock.route.path = '/id-search'
    wrapper = createSearch()
    await query('687595')
    expect(mock.push).toHaveBeenCalledWith(expect.stringContaining('687595'))
    expect(mock.apiSearch).not.toHaveBeenCalled()
  })

  it('поиск из hash не отменяет сам себя и не дублируется таймером', async () => {
    localStorage.setItem('abobatv_top_cache_v3', JSON.stringify({ data: [{ id: '301', title: 'Матрица' }], ts: Date.now() }))
    window.location.hash = '#search=' + encodeURIComponent('Кухня')
    mock.apiSearch.mockResolvedValue([{ id: '687595', title: 'Кухня' }])
    wrapper = createSearch()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mock.apiSearch).toHaveBeenCalledTimes(1)
    expect(mock.apiSearch.mock.calls[0][2].signal.aborted).toBe(false)
    expect(results()[0].kp_id).toBe('687595')
  })
})
