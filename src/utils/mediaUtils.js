const KP_SMALL_POSTER_BASE = 'https://kinopoiskapiunofficial.tech/images/posters/kp_small'
const KP_POSTER_BASE = 'https://kinopoiskapiunofficial.tech/images/posters/kp'

// Локальная заглушка (data URI 2:3 темно-серый прямоугольник с иконкой)
const NO_POSTER_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1a0f2e"/>
        <stop offset="1" stop-color="#0a0c18"/>
      </linearGradient>
    </defs>
    <rect width="200" height="300" fill="url(#g)"/>
    <g fill="rgba(0,229,255,0.35)" transform="translate(85,125)">
      <rect x="0" y="0" width="30" height="45" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <circle cx="15" cy="22" r="6" fill="currentColor"/>
    </g>
    <text x="100" y="210" fill="rgba(255,255,255,0.3)" font-family="sans-serif" font-size="12" text-anchor="middle">Нет постера</text>
  </svg>`)

const normalizeUrl = (value) => {
  if (!value || typeof value !== 'string') return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('//')) return `https:${value}`
  return value
}

// Хосты, которые не отвечают ошибкой, а просто висят. Это хуже 404: тег <img>
// не бросает @error, запасная цепочка не включается, и на месте постера
// остаётся пустая рамка.
// Сравнение было строгим (=== 'kbd.so') и не ловило поддомены, а картинки
// лежат как раз на i.kbd.so — из-за этого история и избранное стояли пустыми.
const isStallingPosterUrl = (value) => {
  try {
    const host = new URL(value).hostname
    return host === 'kbd.so' || host.endsWith('.kbd.so')
  } catch {
    return false
  }
}

const getKpIdFromMovie = (movie = {}) => {
  return (
    movie.kp_id ||
    movie.kinopoisk_id ||
    movie.id_kp ||
    movie.id ||
    movie.raw_data?.film_id ||
    null
  )
}

const getImdbIdFromMovie = (movie = {}) => {
  return (
    movie.imdb_id ||
    movie.imdbId ||
    movie.raw_data?.imdb_id ||
    null
  )
}

export const resolvePosterByMovie = (movie = {}) => {
  const direct = [
    movie.poster,
    movie.cover,
    movie.poster_url_preview,
    movie.poster_url,
    movie.small_poster,
    movie.big_poster,
    movie.raw_data?.poster_url_preview,
    movie.raw_data?.poster_url
  ].map(normalizeUrl).find((url) => url && !isStallingPosterUrl(url))

  if (direct) return direct

  // Фолбек 1: kinopoiskapiunofficial.tech по kp_id
  const kpId = getKpIdFromMovie(movie)
  if (kpId) return `${KP_SMALL_POSTER_BASE}/${kpId}.jpg`

  // Фолбек 2: img.kinopoisk.ru (альтернативный хост)
  if (kpId) return `https://st.kp.yandex.net/images/film_iphone/iphone360_${kpId}.jpg`

  // Последний фолбек — заглушка
  return NO_POSTER_PLACEHOLDER
}

/**
 * Возвращает цепочку URL-ов постера: [основной, фолбек1, фолбек2, ...]
 * Используется для последовательной замены при onerror.
 */
export const resolvePosterChain = (movie = {}) => {
  const chain = [
    movie.poster,
    movie.cover,
    movie.poster_url_preview,
    movie.poster_url,
    movie.small_poster,
    movie.big_poster,
    movie.raw_data?.poster_url_preview,
    movie.raw_data?.poster_url
  ].map(normalizeUrl).filter((url) => url && !isStallingPosterUrl(url))

  const kpId = getKpIdFromMovie(movie)
  if (kpId) {
    chain.push(`${KP_SMALL_POSTER_BASE}/${kpId}.jpg`)
    chain.push(`${KP_POSTER_BASE}/${kpId}.jpg`)
    chain.push(`https://st.kp.yandex.net/images/film_iphone/iphone360_${kpId}.jpg`)
    chain.push(`https://st.kp.yandex.net/images/film_big/${kpId}.jpg`)
  }

  const imdbId = getImdbIdFromMovie(movie)
  if (imdbId) {
    // IMDB через m.media-amazon (не все есть, но бывает)
    chain.push(`https://m.media-amazon.com/images/M/${imdbId}.jpg`)
  }

  chain.push(NO_POSTER_PLACEHOLDER)
  return [...new Set(chain)]
}

export const getPlaceholderPoster = () => NO_POSTER_PLACEHOLDER

export const resolvePosterSetByMovie = (movie = {}) => {
  const preview = resolvePosterByMovie(movie)

  // Тот же фильтр, что и для превью: зависающие хосты пропускаем, иначе
  // большая картинка на странице фильма грузится вечно.
  const big =
    [movie.poster_url, movie.big_poster, movie.raw_data?.poster_url]
      .map(normalizeUrl)
      .find((url) => url && !isStallingPosterUrl(url)) ||
    (() => {
      const kpId = getKpIdFromMovie(movie)
      return kpId ? `${KP_POSTER_BASE}/${kpId}.jpg` : ''
    })()

  return {
    preview,
    full: big || preview
  }
}

