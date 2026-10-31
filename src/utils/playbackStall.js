// Multiple samples are necessary: normal buffering, pause, seek and a new
// episode starting at zero must not immediately recreate the iframe.
export const createPlaybackStallDetector = () => {
  let previous = null
  let stalledSince = null
  let wasPlaying = false
  return {
    reset() { previous = null; stalledSince = null; wasPlaying = false },
    sample(state, now) {
      if (!state) { this.reset(); return false }
      const advancing = previous !== null && Math.abs(state.time - previous) > 0.25
      previous = state.time
      if (advancing && !state.paused && !state.ended) wasPlaying = true
      if (advancing || state.ended || (state.paused && !state.error)) {
        stalledSince = null
        return false
      }
      // Never reload an untouched play screen or a user's paused video.
      if (!wasPlaying) return false
      stalledSince ??= now
      return now - stalledSince >= 45_000
    }
  }
}
