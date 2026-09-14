import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { FiltersEngine, Request } = require('@ghostery/adblocker')
const { ALWAYS_ALLOWED } = require('./adblock.cjs')

// Фильтры, которые нарочно задевают наши же адреса: так ведут себя кривые
// правила в чужих списках, и белый список должен их перебивать.
const HOSTILE = ['||an.yandex.ru^', '||kinobd.net^', '||kbd.so^', '||127.0.0.1^', '/ads/*'].join('\n')

const engine = FiltersEngine.parse(`${HOSTILE}\n${ALWAYS_ALLOWED}`)
const blocked = (url, type = 'xhr') =>
  engine.match(Request.fromRawDetails({ url, type, sourceUrl: 'https://player.example/embed' })).match

describe('блокировщик рекламы', () => {
  it('режет рекламную сеть', () => {
    expect(blocked('https://an.yandex.ru/meta/1')).toBe(true)
  })

  it('не трогает каталог и постеры, даже если список их задел', () => {
    expect(blocked('https://kinobd.net/api/films/search/kp_id?q=1')).toBe(false)
    expect(blocked('https://i.kbd.so/cdn/film/1/a.jpg', 'image')).toBe(false)
  })

  it('не трогает локальный бэкенд', () => {
    expect(blocked('http://127.0.0.1:5310/ads/list/favorites')).toBe(false)
  })
})
