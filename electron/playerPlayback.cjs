// Read only media state from the requested iframe. No URLs or page storage
// leave the frame; no scripts supplied by the renderer are executed.
const READ_PLAYBACK = `(() => {
  const videos = [...document.querySelectorAll('video')]
  const video = videos.find(v => !v.paused && !v.ended) || videos[0]
  if (!video) return null
  return {
    time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    paused: video.paused, ended: video.ended,
    readyState: video.readyState, error: video.error ? video.error.code : 0
  }
})()`

const readPlayback = async (contents, src) => {
  let host
  try {
    const url = new URL(src)
    if (url.protocol !== 'https:' || !/(^|\.)obrut\.show$/.test(url.hostname)) return null
    host = url.host
  } catch { return null }
  const main = contents.mainFrame
  const top = main.framesInSubtree.find(frame => {
    try { return frame.parent === main && new URL(frame.url).host === host } catch { return false }
  })
  if (!top) return null
  for (const frame of [top, ...top.framesInSubtree.filter(frame => frame !== top)].slice(0, 6)) {
    let timer
    try {
      const state = await Promise.race([
        frame.executeJavaScript(READ_PLAYBACK),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('playback read timeout')), 1500) })
      ])
      if (state) return state
    } finally { clearTimeout(timer) }
  }
  return null
}

module.exports = { readPlayback }
