import axios from 'axios'
import { getBackendUrl } from '@/api/backendUrl'
import { toPlayersMap } from '@/api/movies.kinobox'
import { getMovieSeoEntry } from '@/utils/movieSeo'
import { resolvePosterSetByMovie } from '@/utils/mediaUtils'
import { waitForSharedRequest } from '@/api/sourceChain'

const requests = new Map()
const CACHE_MS = 120_000

// Both consumers share one lookup, including concurrent metadata/player requests.
const getSources = (kpId) => {
  const id = String(kpId || '')
  if (!/^[1-9]\d{0,11}$/.test(id)) return Promise.reject(new Error('Некорректный ID Кинопоиска'))
  const hit = requests.get(id)
  if (hit && hit.expires > Date.now()) return hit.promise
  const entry = { expires: Date.now() + CACHE_MS, promise: null }
  entry.promise = axios.get(`${getBackendUrl()}/player/sources/${id}`, { timeout: 12000 })
    .then(({ data }) => {
      if (String(data?.kp_id) !== id || !Array.isArray(data?.providers)) {
        throw new Error('Источник вернул некорректные данные фильма')
      }
      return data
    })
    .catch((error) => {
      if (requests.get(id) === entry) requests.delete(id)
      throw error
    })
  requests.delete(id)
  requests.set(id, entry)
  if (requests.size > 128) requests.delete(requests.keys().next().value)
  return entry.promise
}

export const getPlayers = async (kpId, options = {}) => {
  if (options.signal?.aborted) throw options.signal.reason
  const { providers } = await waitForSharedRequest(getSources(kpId), options.signal)
  // Turbo and Collaps passed real playback in Electron. The aggregator's Alloha
  // renders a player but its video stalls, so old preferences must not select it.
  const playable = providers.filter((provider) => /^(turbo|collaps)$/i.test(String(provider.type)))
  // Foreign-language translations do not replace the Russian player selection.
  const russian = playable.map((provider) => ({
    ...provider,
    translations: (provider.translations || []).filter((translation) =>
      !/украин|укр\.|\bUA\b|[іїєґ]|english|английск|субтитр|subtitles|^оригинальный$/i.test(translation?.name || '')
    )
  }))
  return toPlayersMap(russian, { ...options, source: 'fbp' })
}

export const getKpInfo = async (kpId, { signal } = {}) => {
  if (signal?.aborted) throw signal.reason
  const data = await waitForSharedRequest(getSources(kpId), signal)
  const known = getMovieSeoEntry(kpId)
  const title = data.title || known?.name_ru || known?.title
  if (!title) return null
  const posters = resolvePosterSetByMovie({ kp_id: kpId, poster: known?.poster })
  return {
    kp_id: String(kpId),
    kinopoisk_id: String(kpId),
    title,
    name_ru: title,
    name_original: known?.name_original || '',
    year: data.year || known?.year || '',
    type: data.type,
    description: known?.description || '',
    poster_url: posters.full,
    poster_url_preview: posters.preview,
    source: 'fbp'
  }
}
