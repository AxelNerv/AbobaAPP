import { describe, it, expect } from 'vitest'
import { resolvePosterByMovie, resolvePosterChain, resolvePosterSetByMovie } from './mediaUtils'

// kinopoiskapiunofficial.tech с ноября не отвечает: запрос висит 12 секунд,
// и карточка стоит без постера. Запасные постеры берём с хоста Яндекса.
describe('постеры по ID Кинопоиска', () => {
  it('без своего постера берёт превью с Яндекса', () => {
    expect(resolvePosterByMovie({ kp_id: '258687' }))
      .toBe('https://st.kp.yandex.net/images/film_iphone/iphone360_258687.jpg')
  })

  it('полноразмерный постер тоже с Яндекса', () => {
    expect(resolvePosterSetByMovie({ kp_id: '258687' }).full)
      .toBe('https://st.kp.yandex.net/images/film_big/258687.jpg')
  })

  it('пропускает сохранённый адрес зависающего хоста', () => {
    const movie = { kp_id: '258687', poster: 'https://kinopoiskapiunofficial.tech/images/posters/kp_small/258687.jpg' }
    expect(resolvePosterByMovie(movie)).toContain('st.kp.yandex.net')
    expect(resolvePosterChain(movie).some((url) => url.includes('kinopoiskapiunofficial'))).toBe(false)
  })

  it('свой рабочий постер остаётся первым', () => {
    const own = 'https://avatars.mds.yandex.net/get-kinopoisk-image/1/abc/300x450'
    expect(resolvePosterChain({ kp_id: '258687', poster: own })[0]).toBe(own)
  })
})
