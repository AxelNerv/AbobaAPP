import axios from 'axios'
import { getBackendUrl } from '@/api/backendUrl'
import { resolvePosterSetByMovie } from '@/utils/mediaUtils'

const request = async (path, params, signal) => {
  const { data } = await axios.get(`${getBackendUrl()}/catalog/${path}`, { params, signal, timeout: 11000 })
  if (!data || !Object.hasOwn(data, 'data') || data.error) throw new Error('Некорректный ответ каталога')
  return data.data
}

export const normalizeCatalogMovie = movie => {
  if (!movie || !/^[1-9]\d{0,11}$/.test(String(movie.kp_id)) || typeof movie.title !== 'string' || !movie.title.trim()) {
    throw new Error('Некорректная карточка каталога')
  }
  const id = String(movie.kp_id)
  const posters = resolvePosterSetByMovie(movie)
  return {
    ...movie, id, kp_id: id, kinopoisk_id: id,
    poster: posters.preview, poster_url: posters.full, poster_url_preview: posters.preview,
    average_rating: movie.rating_kinopoisk ?? null,
    raw_data: { film_id: id, name_ru: movie.title, name_en: movie.name_original || '',
      name_original: movie.name_original || '', year: movie.year, type: movie.type,
      rating: movie.rating_kinopoisk ?? null, poster_url: posters.full, poster_url_preview: posters.preview }
  }
}

const normalizeList = rows => {
  if (!Array.isArray(rows)) throw new Error('Некорректный список каталога')
  return rows.map(normalizeCatalogMovie)
}

export const apiSearch = async (query, page = 1, { signal } = {}) =>
  normalizeList(await request('search', { q: query, page }, signal))

export const getMovies = async ({ typeFilter = 'all', page = 1, limit = 100, signal } = {}) =>
  normalizeList(await request('popular', { type_filter: typeFilter, page, limit }, signal))

export const getKpInfo = async (kpId, { signal } = {}) => {
  const id = String(kpId)
  if (!/^[1-9]\d{0,11}$/.test(id)) throw new Error('Некорректный ID фильма')
  const data = await request(`movie/${id}`, undefined, signal)
  if (data === null) return null
  if (String(data?.kp_id) !== id) throw new Error('Каталог вернул другой фильм')
  return normalizeCatalogMovie(data)
}
