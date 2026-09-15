/**
 * Позиция просмотра из хранилища плеера → «1 сезон · 5 серия · 27:12».
 *
 * Форматы у плееров разные, разбираем те, что встречаются:
 * - Playerjs (TURBO и др.): ключ pljsplayfrom_…, значение
 *   «{xxx-сезон-серия-озвучка}секунды--длительность--время сохранения».
 *   Номера в плейлисте с нуля, у фильма вместо сезона просто «{x-озвучка}».
 * - Kodik: serial-last-episode = {"id": {"s": сезон, "e": серия}}.
 * - Ylitron и похожие: под числовым ключом JSON с season, episode, playBack.
 */
const PLAYFROM_RE = /^(?:\{([^}]*)\})?([0-9.]+)--([0-9.]+)(?:--([0-9]+))?$/

const parsePlayfrom = (value) => {
  const match = PLAYFROM_RE.exec(String(value || ''))
  if (!match) return null
  const [prefix, ...rest] = (match[1] || '').split('-')
  const numbers = rest.map((part) => (/^[0-9]+$/.test(part) ? Number(part) : NaN))
  const isSeries = (prefix === 'xxx' || prefix === 'xx') && Number.isFinite(numbers[0]) && Number.isFinite(numbers[1])
  return {
    season: isSeries ? numbers[0] + 1 : null,
    episode: isSeries ? numbers[1] + 1 : null,
    time: Number(match[2]),
    duration: Number(match[3]),
    savedAt: Number(match[4] || 0)
  }
}

const parseJson = (value) => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export const summarizeProgress = (entries = {}) => {
  let best = null
  for (const [key, value] of Object.entries(entries || {})) {
    if (!key.startsWith('pljsplayfrom_')) continue
    const parsed = parsePlayfrom(value)
    if (parsed && (!best || parsed.savedAt > best.savedAt)) best = parsed
  }
  if (best) return best

  const kodik = parseJson(entries?.['serial-last-episode'])
  const last = kodik && typeof kodik === 'object' ? Object.values(kodik)[0] : null
  if (last && Number(last.s) > 0 && Number(last.e) > 0) {
    return { season: Number(last.s), episode: Number(last.e), time: null, duration: null, savedAt: 0 }
  }

  for (const [key, value] of Object.entries(entries || {})) {
    if (!/^[0-9]+$/.test(key)) continue
    const data = parseJson(value)
    if (data && Number(data.season) > 0 && Number(data.episode) > 0) {
      const time = Number(data.playBack)
      return { season: Number(data.season), episode: Number(data.episode), time: Number.isFinite(time) ? time : null, duration: null, savedAt: 0 }
    }
  }
  return null
}

const clock = (seconds) => {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Текст для строки «Остановился: …». Пустая строка — показывать нечего. */
export const formatProgress = (summary) => {
  if (!summary) return ''
  const parts = []
  if (summary.season) parts.push(`${summary.season} сезон`)
  if (summary.episode) parts.push(`${summary.episode} серия`)
  const hasTime = Number.isFinite(summary.time) && summary.time >= 30
  if (hasTime) parts.push(clock(summary.time))
  if (!summary.episode && !hasTime) return ''
  return parts.join(' · ')
}

/** Плееры меняют поддомены (2dc59dca.obrut.show → 92d73433.obrut.show). */
export const playerFamily = (url) => {
  try {
    return new URL(url).hostname.split('.').slice(-2).join('.')
  } catch {
    return ''
  }
}
