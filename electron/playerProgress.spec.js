import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sanitizeEntries, toFrameKey } = require('./playerProgress.cjs')

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

  it('терпит мусор вместо объекта', () => {
    expect(sanitizeEntries(null)).toEqual({})
    expect(sanitizeEntries({ 'vp.1': 42 })).toEqual({})
  })
})
