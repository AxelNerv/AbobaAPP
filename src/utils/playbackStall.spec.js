import { describe, expect, it } from 'vitest'
import { createPlaybackStallDetector } from './playbackStall'

const playing = time => ({ time, paused: false, ended: false, readyState: 4, error: 0 })

describe('длительное зависание видео Turbo', () => {
  it('после трёх серий распознаёт зависшую четвёртую даже с готовым буфером', () => {
    const detector = createPlaybackStallDetector()
    for (let tick = 0; tick < 1080; tick++) {
      expect(detector.sample(playing((tick % 360) * 10), tick * 10_000)).toBe(false)
    }
    expect(detector.sample(playing(0), 10_800_000)).toBe(false)
    expect(detector.sample(playing(0), 10_810_000)).toBe(false)
    expect(detector.sample(playing(0), 10_850_000)).toBe(false)
    expect(detector.sample(playing(0), 10_860_000)).toBe(true)
  })

  it('не перезапускает паузу, конец серии и экран до первого воспроизведения', () => {
    const detector = createPlaybackStallDetector()
    expect(detector.sample(playing(0), 0)).toBe(false)
    expect(detector.sample(playing(0), 600_000)).toBe(false)
    detector.sample(playing(10), 610_000)
    for (const state of [{ ...playing(10), paused: true }, { ...playing(10), ended: true }]) {
      expect(detector.sample(state, 620_000)).toBe(false)
      expect(detector.sample(state, 900_000)).toBe(false)
    }
  })

  it('сбрасывает ожидание при перемотке, возобновлении и смене плеера', () => {
    const detector = createPlaybackStallDetector()
    detector.sample(playing(0), 0)
    detector.sample(playing(10), 10_000)
    detector.sample(playing(10), 20_000)
    expect(detector.sample(playing(300), 60_000)).toBe(false)
    expect(detector.sample(playing(310), 80_000)).toBe(false)
    detector.reset()
    expect(detector.sample(playing(0), 200_000)).toBe(false)
    expect(detector.sample(playing(0), 900_000)).toBe(false)
  })
})
