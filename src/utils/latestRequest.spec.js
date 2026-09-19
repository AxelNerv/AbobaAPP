import { describe, expect, it } from 'vitest'
import { createLatestRequestGuard } from './latestRequest'

describe('latest request guard', () => {
  it('rejects a response after a newer request starts', () => {
    const guard = createLatestRequestGuard()
    const first = guard.begin()
    const second = guard.begin()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('invalidates an active request when its owner is destroyed', () => {
    const guard = createLatestRequestGuard()
    const request = guard.begin()

    guard.invalidate()

    expect(guard.isCurrent(request)).toBe(false)
  })
})
