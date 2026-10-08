import axios from 'axios'
import { getBackendUrl } from '@/api/backendUrl'
import { resolvePosterSetByMovie } from '@/utils/mediaUtils'

export const apiSearch = async (query, page = 1, { signal } = {}) => {
  const { data } = await axios.get(`${getBackendUrl()}/movies/search`, {
    params: { q: query, page }, timeout: 11000, signal
  })
  if (!Array.isArray(data?.data) || data.error) throw new Error('Некорректный ответ поиска Wikidata')
  return data.data.map(movie => {
    if (!/^[1-9]\d{0,11}$/.test(String(movie?.kp_id || '')) || typeof movie?.title !== 'string' || !movie.title.trim()) {
      throw new Error('Некорректные данные фильма в поиске Wikidata')
    }
    const id = String(movie.kp_id)
    const type = movie.type === 'series' ? 'TV_SERIES' : 'FILM'
    const posters = resolvePosterSetByMovie({ kp_id: id })
    return {
      id, kp_id: id, title: movie.title, name_ru: movie.title,
      name_original: movie.name_original || '', year: movie.year || '',
      description: movie.description || '', type,
      poster: posters.preview, average_rating: null, source: 'wikidata',
      raw_data: { film_id: id, name_ru: movie.title, name_original: movie.name_original || '',
        year: movie.year || null, type, rating: null,
        poster_url: posters.full, poster_url_preview: posters.preview }
    }
  })
}
