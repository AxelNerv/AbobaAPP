import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { applyMovieMetadata, createMovieMetadataLoader, metadataRequest } from './movieMetadata'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))
const movie = { kp_id: '283290', title: 'Наруто', name_original: 'Naruto', year: '2002', type: 'TV_SERIES', genres: [{ genre: 'аниме' }] }
const response = { kp_id: '283290', fields: { episodes_count: 220, poster_url: 'https://s4.anilist.co/file/a.jpg' },
  sources: [{ name: 'anilist', url: 'https://anilist.co/anime/20' }], providers: { tmdb: 'unconfigured', omdb: 'unconfigured', anilist: 'ok' } }
beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('дополнительные данные в фоне', () => {
  it('определяет аниме, год и тип, не отправляет токены или историю', () => {
    expect(metadataRequest({ ...movie, token: 'secret', history: [] })).toEqual({ kp_id: '283290',
      title: 'Наруто', original_title: 'Naruto', year: 2002, imdb_id: '', kind: 'series', anime: true })
    expect(metadataRequest({ ...movie, genres: null, year: 'bad' })).toMatchObject({ anime: false, year: null })
  })
  it('добавляет серии и заменяет только сгенерированный запасной постер', () => {
    const original = { ...movie, poster_url: 'https://kinopoiskapiunofficial.tech/images/posters/kp/283290.jpg' }
    expect(applyMovieMetadata(original, response)).toMatchObject({ episodes_count: 220, poster_url: response.fields.poster_url })
    expect(original.poster_url).toContain('kinopoiskapiunofficial')
  })
  it('не перезаписывает основной постер, описание, рейтинг и название', () => {
    const original = { ...movie, description: 'Русское описание', rating_imdb: 8, poster_url: 'https://avatars.mds.yandex.net/a.jpg' }
    const data = { ...response, fields: { ...response.fields, title: 'Чужой фильм', description: 'English', rating_imdb: 5 } }
    expect(applyMovieMetadata(original, data)).toMatchObject(original)
  })
  it('отбрасывает опасные картинки и неверные числовые поля', () => {
    expect(applyMovieMetadata(movie, { ...response, fields: { poster_url: 'javascript:alert(1)', episodes_count: '220' } }))
      .not.toHaveProperty('poster_url')
  })
  it('не принимает чужой фильм или повреждённый ответ', () => {
    expect(() => applyMovieMetadata(movie, { ...response, kp_id: '1' })).toThrow('Некорректные')
    expect(() => applyMovieMetadata(movie, { ...response, fields: [] })).toThrow('Некорректные')
  })
  it('поздний ответ старой страницы не меняет новую карточку', async () => {
    let finish
    axios.post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ data: { ...response, kp_id: '1' } })
    const applied = vi.fn()
    const loader = createMovieMetadataLoader(applied)
    const old = loader.load(movie)
    const signal = axios.post.mock.calls[0][2].signal
    await loader.load({ ...movie, kp_id: '1' })
    finish({ data: response })
    await old
    expect(signal.aborted).toBe(true)
    expect(applied).toHaveBeenCalledTimes(1)
    expect(applied.mock.calls[0][0].kp_id).toBe('1')
  })
  it('закрытие страницы отменяет запрос, таймаут передан HTTP-клиенту', async () => {
    let finish
    axios.post.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const applied = vi.fn()
    const loader = createMovieMetadataLoader(applied)
    const pending = loader.load(movie)
    expect(axios.post.mock.calls[0][2].timeout).toBe(7000)
    loader.cancel()
    finish({ data: response })
    await pending
    expect(applied).not.toHaveBeenCalled()
  })
  it('отказ необязательного API не ломает карточку и не пропадает молча', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    axios.post.mockRejectedValue(new Error('HTTP 502'))
    const applied = vi.fn()
    await createMovieMetadataLoader(applied).load(movie)
    expect(applied).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})
