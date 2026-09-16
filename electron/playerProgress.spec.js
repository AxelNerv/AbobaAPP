import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sanitizeEntries, normalizeFrames, toFrameKey } = require('./playerProgress.cjs')

const HOST = '2dc59dca.obrut.show'
const PATH = '/embed/kDO/content/AM2cTM'

describe('позиция просмотра из плеера', () => {
  it('берёт позицию текущего видео и прячет домен плеера', () => {
    const entries = sanitizeEntries(
      {
        [`pljsplayfrom_player${HOST}${PATH}`]: '{xxx-0-4-0}1632.7--2714.7--1789395771954',
        [`pljsplayfrom_player${HOST}/embed/kDO/content/OTHER`]: '{x-0}10--20--1',
        'serial-last-episode': '{"1":{"s":2,"e":3}}'
      },
      { host: HOST, path: PATH }
    )
    expect(Object.keys(entries)).toEqual(['pljsplayfrom_player{host}/embed/kDO/content/AM2cTM', 'serial-last-episode'])
    expect(toFrameKey(Object.keys(entries)[0], '92d73433.obrut.show')).toBe(
      'pljsplayfrom_player92d73433.obrut.show/embed/kDO/content/AM2cTM'
    )
  })

  it('не пропускает посторонние ключи и большие значения', () => {
    const entries = sanitizeEntries({
      auth: 'secret',
      _ym_uid: '1',
      token: 'x',
      'vp.12': 'a'.repeat(5000),
      __proto__: 'x',
      'vp.34': '120'
    })
    expect(entries).toEqual({ 'vp.34': '120' })
  })

  it('Alloha и Collaps: только запись текущего фильма', () => {
    const alloha = sanitizeEntries(
      { 'save-1efc2a67899bd83bd7dd6c44c3ae99': '{}', 'save-850ac523fef9911889abb04442711d': '{}', allplay: '{}' },
      { host: 'floki-as.stravers.live', path: '/', search: '?token_movie=1efc2a67899bd83bd7dd6c44c3ae99&token=x' }
    )
    expect(Object.keys(alloha)).toEqual(['save-1efc2a67899bd83bd7dd6c44c3ae99'])
    const collaps = sanitizeEntries(
      { vp1285: '1:6', vp14: '2:29', 'vp.835978': '1344', 'player.totalTime': '26' },
      { host: 'api.ortified.ws', path: '/embed/movie/1285' }
    )
    expect(collaps).toEqual({ vp1285: '1:6', 'vp.835978': '1344' })
  })

  it('Kodik: из общей записи остаётся только текущий сериал', () => {
    const many = {}
    for (let id = 52000; id < 52200; id++) many[id] = { s: 1, e: 15, p: 41, t: 609 }
    const entries = sanitizeEntries({ 'serial-progress': JSON.stringify(many) }, { host: 'kodikplayer.com', path: '/serial/52142/85362d665e211a35d8fa91fbd9d1e9b6/720p' })
    expect(JSON.parse(entries['serial-progress'])).toEqual({ 52142: { s: 1, e: 15, p: 41, t: 609 } })
  })

  it('старые позиции без разбивки по окнам относятся к домену плеера', () => {
    const entries = { 'pljsplayfrom_player{host}/embed/x': '{xxx-0-4-0}1--2--3' }
    expect(normalizeFrames(entries, 'https://2dc59dca.obrut.show/embed/x')).toEqual({ 'obrut.show': entries })
    expect(normalizeFrames({ 'kinescopecdn.net': { 'pljsplayfrom_{host}313': 'v' }, 'evil/../x': { a: '1' } }, 'https://kinobd.club/')).toEqual({
      'kinescopecdn.net': { 'pljsplayfrom_{host}313': 'v' }
    })
  })

  it('терпит мусор вместо объекта', () => {
    expect(sanitizeEntries(null)).toEqual({})
    expect(sanitizeEntries({ 'vp.1': 42 })).toEqual({})
  })
})
