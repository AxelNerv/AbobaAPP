import { describe, expect, it } from 'vitest'
import { formatProgress, playerFamily, summarizeProgress } from './watchProgress'

describe('summarizeProgress', () => {
  it('reads TURBO series position (zero-based playlist)', () => {
    const summary = summarizeProgress({
      'pljsplayfrom_player{host}/embed/kDO/content/AM2cTM': '{xxx-0-4-0}1632.729165--2714.731--1789395771954'
    })
    expect(summary).toMatchObject({ season: 1, episode: 5, duration: 2714.731 })
    expect(formatProgress(summary)).toBe('1 сезон · 5 серия · 27:12')
  })

  it('picks the most recently saved Playerjs entry', () => {
    const summary = summarizeProgress({
      'pljsplayfrom_a': '{xxx-0-3-0}818--2694--1789381089120',
      'pljsplayfrom_b': '{xxx-0-4-0}1632--2714--1789395771954'
    })
    expect(summary.episode).toBe(5)
  })

  it('films have time but no season', () => {
    const summary = summarizeProgress({ 'pljsplayfrom_x': '{x-1}4619.8--7473.1--1788437146877' })
    expect(summary).toMatchObject({ season: null, episode: null })
    expect(formatProgress(summary)).toBe('1:16:59')
  })

  it('reads Alloha save record', () => {
    const summary = summarizeProgress({
      'save-1efc2a67899bd83bd7dd6c44c3ae99': '{"translation":"LostFilm","serial":{"season":1,"episode":6},"time":609.246455}'
    })
    expect(formatProgress(summary)).toBe('1 сезон · 6 серия · 10:09')
  })

  it('reads Collaps season:episode', () => {
    expect(formatProgress(summarizeProgress({ vp1285: '1:6', 'player.totalTime': '42' }))).toBe('1 сезон · 6 серия')
  })

  it('reads Kodik serial progress', () => {
    const summary = summarizeProgress({ 'serial-progress': '{"52142":{"s":1,"e":15,"p":641,"t":609}}' })
    expect(formatProgress(summary)).toBe('1 сезон · 15 серия · 10:41')
  })

  it('reads Kodik last episode', () => {
    const summary = summarizeProgress({ 'serial-last-episode': '{"55172":{"s":2,"e":1}}' })
    expect(formatProgress(summary)).toBe('2 сезон · 1 серия')
  })

  it('reads season/episode JSON players', () => {
    const summary = summarizeProgress({ 1467: '{"playBack":589.8,"season":4,"episode":10}' })
    expect(formatProgress(summary)).toBe('4 сезон · 10 серия · 9:49')
  })

  it('ignores garbage and near-zero positions', () => {
    expect(summarizeProgress({ 'pljsplayfrom_x': 'junk', 'serial-last-episode': '{bad' })).toBeNull()
    expect(formatProgress(summarizeProgress({ 'pljsplayfrom_x': '{x-0}3--5982--1' }))).toBe('')
  })
})

describe('playerFamily', () => {
  it('groups rotating player subdomains', () => {
    expect(playerFamily('https://2dc59dca.obrut.show/embed/kDO/content/AM2cTM')).toBe('obrut.show')
    expect(playerFamily('not a url')).toBe('')
  })
})
