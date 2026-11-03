import * as catalog from '@/api/movies.catalog'

// «Случайный фильм» раньше брал топ kinobd, а kinobd с осени отвечает 523 —
// кнопка не работала. Берём популярное из каталога Кинопоиска: 10 страниц
// по 100 (дальше каталог не отдаёт) — около тысячи фильмов и сериалов разных лет.
const PAGES = 10
const PER_PAGE = 100

// Загруженные страницы живут до перезапуска: повторные нажатия мгновенные.
const pages = new Map()

const loadPage = async (page) => {
  if (!pages.has(page)) {
    const rows = await catalog.getMovies({ typeFilter: 'all', page, limit: PER_PAGE })
    if (rows.length) pages.set(page, rows)
  }
  return pages.get(page) || []
}

const fitsYears = (movie, yearFrom, yearTo) => {
  const year = Number(movie?.year) || 0
  if (!year) return false
  if (yearFrom && year < yearFrom) return false
  if (yearTo && year > yearTo) return false
  return true
}

const shuffled = (list) => {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const toPayload = (movie) => ({
  kp_id: movie.kp_id,
  imdb_id: movie.imdb_id || '',
  title: movie.title || movie.name_ru || 'Без названия',
  name_ru: movie.name_ru || movie.title || '',
  name_en: movie.name_original || '',
  year: Number(movie.year) || null,
  description: movie.description || '',
  short_description: movie.short_description || '',
  cover: movie.poster,
  poster: movie.poster,
  rating_kp: movie.rating_kinopoisk ?? null,
  rating_imdb: null,
  type: movie.type === 'TV_SERIES' ? 'TV_SERIES' : movie.type === 'FILM' ? 'FILM' : 'UNKNOWN',
  countries: (movie.countries || []).map((c) => c?.country).filter(Boolean).join(', '),
  genres: (movie.genres || []).map((g) => g?.genre).filter(Boolean).join(', '),
  source: 'kinopoisk'
})

export const getRandomMovie = async ({ yearFrom = null, yearTo = null } = {}) => {
  const hasFilter = !!(yearFrom || yearTo)
  let failures = 0

  // Без фильтра хватает одной случайной страницы. С фильтром идём по
  // страницам в случайном порядке, пока не найдётся подходящий год.
  for (const page of shuffled(Array.from({ length: PAGES }, (_, i) => i + 1))) {
    let rows
    try {
      rows = await loadPage(page)
    } catch {
      failures += 1
      continue
    }
    const matched = hasFilter ? rows.filter((m) => fitsYears(m, yearFrom, yearTo)) : rows
    if (matched.length) return toPayload(matched[Math.floor(Math.random() * matched.length)])
  }

  if (failures === PAGES) throw new Error('Каталог Кинопоиска не ответил')
  throw new Error('Под выбранные годы ничего не нашлось')
}

export const _resetRandomCacheForTests = () => pages.clear()
