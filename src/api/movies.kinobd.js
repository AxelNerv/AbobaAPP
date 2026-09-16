import axios from 'axios'
import { resolvePosterByMovie, resolvePosterSetByMovie } from '@/utils/mediaUtils'
import { pinPlayerHost } from '@/utils/playerHost'

let apiInstance = null
let isErrorSimulationEnabled = false
const simulatedErrorCode = 500

const KINOBD_BASE_URL =
  import.meta.env.VITE_KINOBD_API_URL || import.meta.env.VITE_APP_API2_URL || 'https://kinobd.net'
const KINOBD_TOKEN = import.meta.env.VITE_KINOBD_TOKEN || ''
// Список плееров, которые запрашиваем у kinobd.
// Убраны youtube/trailer/trailer_local/netflix/nf — бесполезны (трейлер с ютуба,
// Netflix требует аккаунт). Добавлен aniboom — хороший плеер для аниме.
const DEFAULT_PLAYER_PROVIDERS = [
  'collaps',
  'vibix',
  'alloha',
  'kodik',
  'aniboom',
  'kinotochka',
  'flixcdn',
  'ashdi',
  'turbo',
  'videocdn',
  'bazon',
  'ustore',
  'pleer',
  'videospider',
  'iframe',
  'moonwalk',
  'hdvb',
  'cdnmovies',
  'lookbase',
  'kholobok',
  'videoapi',
  'voidboost',
  'videoseed',
  'ia',
  'ext',
  'torrent',
  'vk'
].join(',')

const getApi = () => {
  if (apiInstance) return apiInstance

  apiInstance = axios.create({
    baseURL: KINOBD_BASE_URL,
    timeout: 12000,
    headers: { 'Content-Type': 'application/json' }
  })

  apiInstance.interceptors.request.use(
    (config) => {
      if (KINOBD_TOKEN) {
        config.params = config.params || {}
        if (!config.params.token) {
          config.params.token = KINOBD_TOKEN
        }
      }
      return config
    },
    (err) => Promise.reject(err)
  )

  return apiInstance
}

const simulateErrorIfNeeded = async () => {
  if (isErrorSimulationEnabled && simulatedErrorCode) {
    const status = parseInt(simulatedErrorCode, 10)
    const error = new Error(`Simulated error ${status}`)
    error.response = { status }
    throw error
  }
}

const apiCall = async (callFn) => {
  await simulateErrorIfNeeded()
  const api = getApi()
  return await callFn(api)
}

const toAbsoluteUrl = (value) => {
  if (!value || typeof value !== 'string') return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('//')) return `https:${value}`
  try {
    return new URL(value, KINOBD_BASE_URL).toString()
  } catch {
    return value
  }
}

const extractIframeUrl = (value) => {
  if (!value || typeof value !== 'string') return ''

  // pinPlayerHost закрепляет поддомен балансера: он выдаёт плеер каждый раз
  // на новом случайном хосте, из-за чего плеер не может запомнить серию и
  // таймкод — его хранилище привязано к origin. См. utils/playerHost.js
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('//')) {
    return pinPlayerHost(toAbsoluteUrl(value))
  }

  const dataSrcMatch = value.match(/data-src="([^"]+)"/i)
  if (dataSrcMatch?.[1]) return pinPlayerHost(toAbsoluteUrl(dataSrcMatch[1]))

  const srcMatch = value.match(/src="([^"]+)"/i)
  if (srcMatch?.[1]) return pinPlayerHost(toAbsoluteUrl(srcMatch[1]))

  return ''
}

const parseCountries = (film) => {
  if (Array.isArray(film?.countries)) {
    return film.countries
      .map((c) => c?.name_ru || c?.country || c?.name || '')
      .filter(Boolean)
      .map((country) => ({ country }))
  }

  if (typeof film?.country_ru === 'string' && film.country_ru.trim()) {
    return film.country_ru
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((country) => ({ country }))
  }

  return []
}

const parseGenres = (film) => {
  if (Array.isArray(film?.genres)) {
    return film.genres
      .map((g) => g?.name_ru || g?.genre || g?.name || '')
      .filter(Boolean)
      .map((genre) => ({ genre }))
  }

  if (typeof film?.genre_ru === 'string' && film.genre_ru.trim()) {
    return film.genre_ru
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
      .map((genre) => ({ genre }))
  }

  return []
}

const toLegacyType = (typeValue) => {
  const type = String(typeValue || '').toLowerCase()
  // kinobd называет сериалы 'serial'; без этой строки они считались фильмами.
  if (type.includes('serial') || type.includes('series')) return 'TV_SERIES'
  if (type.includes('show')) return 'TV_SERIES'
  if (type.includes('movie')) return 'FILM'
  return 'FILM'
}

const extractKinopoiskRating = (film) => {
  const rating =
    film?.rating_kp ??
    film?.rating_kinopoisk ??
    film?.ratings?.kp ??
    film?.ratings?.kinopoisk ??
    null
  const voteCount =
    film?.rating_kp_count ??
    film?.rating_kinopoisk_count ??
    film?.ratings_count_kp ??
    film?.ratings?.kp_count ??
    film?.ratings?.kinopoisk_count ??
    0

  return { rating, voteCount }
}

const buildLegacyMovie = (film) => {
  const kpId = film?.kinopoisk_id || film?.kp_id || film?.id || null
  const year = film?.year || film?.year_start || ''
  const nameRu = film?.name_russian || ''
  const nameEn = film?.name_original || ''
  const titleBase = nameRu || nameEn || 'Без названия'
  const title = year ? `${titleBase} (${year})` : titleBase
  const { rating: ratingKp, voteCount: ratingKpCount } = extractKinopoiskRating(film)
  const normalizedRating =
    ratingKp === null || ratingKp === undefined || ratingKp === '' ? 'null' : String(ratingKp)
  const posters = resolvePosterSetByMovie({
    ...film,
    kp_id: kpId
  })

  return {
    id: kpId,
    kp_id: kpId ? String(kpId) : '',
    title,
    year: year ? String(year) : '',
    poster: posters.preview,
    average_rating:
      ratingKp === null || ratingKp === undefined || Number.isNaN(Number(ratingKp))
        ? null
        : Number(ratingKp),
    raw_data: {
      film_id: kpId,
      name_ru: nameRu,
      name_en: nameEn,
      type: toLegacyType(film?.type),
      year: year ? String(year) : null,
      description: film?.description || null,
      film_length: film?.time || null,
      countries: parseCountries(film),
      genres: parseGenres(film),
      rating: normalizedRating,
      rating_vote_count: ratingKpCount || 0,
      poster_url: posters.full,
      poster_url_preview: posters.preview
    },
    source: 'kinobd'
  }
}

const mapKpInfo = (film) => {
  const legacy = buildLegacyMovie(film)
  const countries = parseCountries(film)
  const genres = parseGenres(film)
  const { rating: ratingKp, voteCount: ratingKpCount } = extractKinopoiskRating(film)

  return {
    ...film,
    ...legacy,
    id_kp: film?.kinopoisk_id || film?.kp_id || null,
    imdb_id: film?.imdb_id || null,
    kinopoisk_id: film?.kinopoisk_id || film?.kp_id || null,
    name_ru: film?.name_russian || '',
    name_en: film?.name_original || '',
    name_original: film?.name_original || '',
    short_description: film?.description || '',
    description: film?.description || '',
    year: String(film?.year || film?.year_start || ''),
    countries,
    genres,
    film_length: film?.time_minutes || null,
    poster_url: legacy.raw_data.poster_url,
    poster_url_preview: legacy.raw_data.poster_url_preview,
    logo_url: '',
    screenshots: [legacy.raw_data.poster_url].filter(Boolean),
    videos: film?.yt_video_id
      ? [
          {
            name: 'YouTube Trailer',
            iframeUrl: `https://www.youtube.com/embed/${film.yt_video_id}`
          }
        ]
      : [],
    staff: [],
    rating: legacy.raw_data.rating,
    rating_vote_count: legacy.raw_data.rating_vote_count,
    rating_kinopoisk:
      ratingKp === null || ratingKp === undefined || ratingKp === '' ? null : Number(ratingKp),
    rating_kinopoisk_vote_count: Number(ratingKpCount) || 0
  }
}

const ensureUniqueKey = (obj, baseKey) => {
  if (!obj[baseKey]) return baseKey
  let idx = 2
  while (obj[`${baseKey} #${idx}`]) idx++
  return `${baseKey} #${idx}`
}

// Плееры, которые не показываем: трейлеры с ютуба и Netflix (нужен аккаунт).
// youtube-iframe тоже отсекаем — это всегда трейлер, а не сам фильм.
// torrent: страница kinobd.club/external_player/torrent отвечает 404 —
// в списке он только занимал место и открывался пустым.
const UNWANTED_PLAYER_RE = /trailer|netflix|youtube\.com|youtu\.be|\bnf\b|\btorrent\b/i
// Украинские озвучки: ловим по буквам і/ї/є/ґ (в русском их нет) и UA-маркерам.
const UKRAINIAN_RE = /[іїєґ]|\bUA\b|дубльован|багатоголос/i

const isUnwantedPlayer = ({ name = '', provider = '', iframe = '' } = {}) => {
  const hay = `${name} ${provider} ${iframe}`
  return UNWANTED_PLAYER_RE.test(hay) || UKRAINIAN_RE.test(`${name} ${provider}`)
}

const buildPlayersMap = (items = []) => {
  const players = {}

  for (const item of items) {
    const iframe = extractIframeUrl(item?.iframe)
    if (!iframe) continue

    const label = item?.name_russian || item?.name_original || item?.id || 'Player'
    if (isUnwantedPlayer({ name: label, iframe })) continue

    const baseKey = `KINOBD>${label}`
    const key = ensureUniqueKey(players, baseKey)

    players[key] = {
      name: key,
      translate: item?.name_russian || item?.name_original || 'KinoBD',
      iframe,
      quality: item?.time || '',
      warning: false,
      source: 'kinobd',
      raw_data: item
    }
    // YouTube-трейлер намеренно НЕ добавляем — не нужен.
  }

  return players
}

const toProviderPlayersMap = (providerMap = {}) => {
  const players = {}
  const providers = Object.entries(providerMap || {})

  for (const [provider, value] of providers) {
    const iframe = extractIframeUrl(value?.iframe)
    if (!iframe) continue

    const baseLabel = String(provider || 'player').toUpperCase()
    const translate =
      value?.translate && String(value.translate).trim()
        ? String(value.translate).trim()
        : baseLabel

    // Отсекаем трейлеры/ютуб/нетфликс
    if (isUnwantedPlayer({ name: translate, provider, iframe })) continue

    const key = ensureUniqueKey(players, baseLabel)

    players[key] = {
      name: key,
      translate,
      iframe,
      quality: value?.quality || '',
      warning: false,
      source: 'kinobd',
      raw_data: value
    }
  }

  return players
}

const searchPlayerCandidates = async (query, { type = 'title', page = 1 } = {}) => {
  const normalizedType = type === 'kp_id' ? 'kp_id' : 'title'
  const { data } = await apiCall((api) =>
    api.get('/api/player/search', {
      params: {
        q: String(query),
        type: normalizedType,
        page
      }
    })
  )

  const rows = Array.isArray(data?.data) ? data.data : []
  return rows.map((item) => ({
    id: item?.id ?? null, // inid for /playerdata
    kp_id: item?.kinopoisk_id || item?.kp_id || null,
    imdb_id: item?.imdb_id || null,
    title: item?.name_russian || item?.name_original || '',
    year: item?.year || '',
    iframe: extractIframeUrl(item?.iframe),
    raw_data: item
  }))
}

const getPlayerDataByInid = async (
  inid,
  { playerUrl = '', cacheKey = '', providers = DEFAULT_PLAYER_PROVIDERS, fast = 1 } = {}
) => {
  const resolvedPlayerUrl = toAbsoluteUrl(playerUrl)
  const playerOrigin = (() => {
    try {
      return resolvedPlayerUrl ? new URL(resolvedPlayerUrl).origin : ''
    } catch {
      return ''
    }
  })()

  const params = cacheKey ? `cache${cacheKey}` : `cache${inid}`
  const body = new URLSearchParams({
    fast: String(fast),
    inid: String(inid),
    player: providers
  })

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (resolvedPlayerUrl) headers['X-Re'] = resolvedPlayerUrl
  // Origin и Referer из браузера ставить нельзя — он их блокирует
  // («Refused to set unsafe header»). Передаём origin своим заголовком,
  // а настоящие Origin/Referer подставит прокси на бэкенде.
  if (playerOrigin) headers['X-Player-Origin'] = playerOrigin

  const { data } = await apiCall((api) =>
    api.post(`/playerdata?${params}`, body.toString(), {
      headers
    })
  )

  return toProviderPlayersMap(data)
}

// Поиск по альтернативным названиям.
//
// /api/films/search/title ищет только по ОСНОВНОМУ названию. У многих дорам
// и аниме в ходу два-три перевода: «Суперчудаки» находились, а «Суперглупцы»
// (то же самое кино, kp 6572309) — нет, хотя источник это название знает.
//
// /api/player/search ищет шире, в том числе по альтернативным названиям,
// но отдаёт по строке на каждый плеер — один фильм повторяется много раз.
// Поэтому он идёт вторым и только чтобы дополнить: схлопываем дубли по
// kinopoisk_id и добавляем то, чего не было в основной выдаче.
const searchByAlternativeTitles = async (searchTerm, page) => {
  const { data } = await apiCall((api) =>
    api.get('/api/player/search', {
      params: { q: searchTerm, type: 'title', page }
    })
  )

  const rows = Array.isArray(data?.data) ? data.data : []
  const uniqueByKpId = new Map()

  for (const row of rows) {
    const kpId = row?.kinopoisk_id
    if (!kpId || uniqueByKpId.has(kpId)) continue
    uniqueByKpId.set(kpId, row)
  }

  return Array.from(uniqueByKpId.values())
}

const apiSearch = async (searchTerm, page = 1) => {
  const { data } = await apiCall((api) =>
    api.get('/api/films/search/title', {
      params: {
        q: searchTerm,
        page
      }
    })
  )

  const rows = Array.isArray(data?.data) ? data.data : []
  const seenKpIds = new Set(rows.map((r) => r?.kinopoisk_id).filter(Boolean))

  // Широкий поиск подключаем всегда: даже когда по основному названию
  // что-то нашлось, нужного фильма среди этого может не быть.
  try {
    const extra = await searchByAlternativeTitles(searchTerm, page)
    for (const row of extra) {
      if (seenKpIds.has(row.kinopoisk_id)) continue
      seenKpIds.add(row.kinopoisk_id)
      rows.push(row)
    }
  } catch (error) {
    // Дополнительный поиск не критичен — основную выдачу не роняем
    console.warn('[kinobd] поиск по альтернативным названиям не удался:', error?.message)
  }

  return rows.map(buildLegacyMovie)
}

const getKpInfo = async (kpId) => {
  const response = await apiCall((api) =>
    api.get('/api/films/search/kp_id', {
      params: {
        q: String(kpId),
        page: 1,
        // Без images: для популярных тайтлов (десятки картинок) kinobd отдаёт
        // заголовки и зависает на теле ответа — запрос висел до таймаута,
        // страница фильма грузилась полминуты и показывала «Без названия».
        // Поле всё равно не используется: разбор ответа его не читает,
        // а сами картинки лежат на kbd.so, который отвечает 404.
        with: 'persons,genres,countries,popularity'
      }
    })
  )

  const film = Array.isArray(response?.data?.data) ? response.data.data[0] : null
  return film ? mapKpInfo(film) : null
}

const getMovieSeoByKpId = async (kpId) => {
  const { data } = await apiCall((api) =>
    api.get('/api/films/search/kp_id', {
      params: {
        q: String(kpId),
        page: 1
      }
    })
  )

  const film = Array.isArray(data?.data) ? data.data[0] : null
  return film ? buildLegacyMovie(film) : null
}

const getPlayers = async (kpId, options = {}) => {
  const {
    mode = 'kp_id',
    selectIndex = 0,
    usePlayerData = true,
    providers = DEFAULT_PLAYER_PROVIDERS,
    forceInid = null
  } = options
  const searchType = mode === 'title' ? 'title' : 'kp_id'
  const candidates = await searchPlayerCandidates(kpId, { type: searchType, page: 1 })

  if (!candidates.length && !forceInid) return {}

  if (usePlayerData) {
    let selected = null
    if (forceInid) {
      selected = candidates.find((item) => String(item.id) === String(forceInid)) || null
    }
    if (!selected && candidates.length > 0) {
      selected = candidates[Math.max(0, Math.min(selectIndex, candidates.length - 1))]
    }

    if (selected?.id || forceInid) {
      try {
        return await getPlayerDataByInid(selected?.id || forceInid, {
          playerUrl: selected?.iframe || '',
          providers
        })
      } catch (error) {
        console.warn('[movies.kinobd] /playerdata failed, fallback to iframe list', error)
      }
    }
  }

  return buildPlayersMap(candidates.map((c) => c.raw_data))
}

const getMovies = async ({ activeTime = 'all', typeFilter = 'all', limit = null, page = 1 } = {}) => {
  let endpoint = '/api/films/top'
  if (activeTime === 'updates') endpoint = '/api/films/updates'

  // На per_page=100 Kinobd периодически отвечает дольше 30 секунд, хотя
  // страницы по 50 приходят за 1-2 секунды. Берём две небольшие страницы:
  // пользователь всё так же получает 100 фильмов, но главная не зависает.
  const requestedLimit = Math.max(1, Number(limit) || 50)
  const perPage = Math.min(requestedLimit, 50)
  const pageCount = Math.ceil(requestedLimit / perPage)
  const responses = await Promise.all(
    Array.from({ length: pageCount }, (_, index) =>
      apiCall((api) => api.get(endpoint, { params: { page: page + index, per_page: perPage } }))
    )
  )
  let rows = responses.flatMap(({ data }) => (Array.isArray(data?.data) ? data.data : []))
  rows = rows.slice(0, requestedLimit)

  // Типы kinobd — 'film' и 'serial'. Фильтр искал 'movie' и 'series'/'show',
  // не совпадал ни с одним и возвращал пустоту — а выше по цепочке пустота
  // молча подменялась заготовленным каталогом, так что «Фильмы» и «Сериалы»
  // показывали один и тот же список.
  if (typeFilter === 'movie') {
    rows = rows.filter((f) => /film|movie/.test(String(f?.type || '').toLowerCase()))
  } else if (typeFilter === 'series') {
    rows = rows.filter((f) => /serial|series|show/.test(String(f?.type || '').toLowerCase()))
  }

  return rows.map(buildLegacyMovie)
}

const getKpIDfromIMDB = async (imdbId) => {
  const { data } = await apiCall((api) =>
    api.get('/api/films/search/imdb_id', {
      params: {
        q: String(imdbId),
        page: 1
      }
    })
  )
  const film = Array.isArray(data?.data) ? data.data[0] : null
  return { id_kp: film?.kinopoisk_id || null, film: film ? mapKpInfo(film) : null }
}

// Маппит фильм из kinobd-формата в "плоский" формат который ждёт RandomMovieModal.vue
// (тот же формат что отдаёт rhserv /chance — для совместимости)
const buildRandomMoviePayload = (film) => {
  if (!film) return null
  const kpId = film.kinopoisk_id || film.kp_id || film.id || null

  // Год: для фильмов поле "year", для сериалов — "year_start"
  const yearRaw = film.year || film.year_start || null
  const year = yearRaw ? Number(String(yearRaw).replace(/[^0-9]/g, '')) || null : null

  // Постер. ВНИМАНИЕ: best_poster живёт на хосте kbd.so, который отдаёт 404 —
  // из-за него в «Случайном фильме» вместо обложки была заглушка. Рабочие
  // картинки лежат на i.kbd.so, то есть в big_poster/small_poster.
  // resolvePosterByMovie добавляет ещё и фолбэки по kp_id (Кинопоиск),
  // так что постер находится даже когда kinobd не дал ничего.
  const poster =
    film.big_poster ||
    film.small_poster ||
    resolvePosterByMovie({
      kp_id: kpId,
      big_poster: film.big_poster,
      small_poster: film.small_poster
    })

  // Тип фильма в формате который ждёт RandomMovieModal
  const rawType = String(film.type || '').toLowerCase()
  let type = 'UNKNOWN'
  if (rawType === 'film') type = 'FILM'
  else if (rawType === 'serial') type = 'TV_SERIES'

  return {
    kp_id: kpId ? String(kpId) : '',
    imdb_id: film.imdb_id || '',
    title: film.name_russian || film.name_original || 'Без названия',
    name_ru: film.name_russian || '',
    name_en: film.name_original || '',
    year,
    description: film.description || '',
    short_description: film.slogan || '',
    cover: poster,
    poster,
    rating_kp: film.rating_kp ?? null,
    rating_imdb: film.rating_imdb ?? null,
    type,
    countries: film.country_ru || '',
    genres: '', // у kinobd в этом эндпоинте жанров нет, но поле должно существовать
    source: 'kinobd'
  }
}

// Проверка попадания фильма/сериала в фильтр годов.
// Фильм подходит, если его год выпуска (для фильмов — `year`, для сериалов —
// `year_start`) попадает в диапазон [yearFrom..yearTo].
// Раньше использовали "пересечение диапазонов", но это давало ложные срабатывания:
// сериал, начавшийся в 1999 и идущий до сих пор, попадал в фильтр "2020-2025".
const fitsYearFilter = (film, yearFrom, yearTo) => {
  const yStart = Number(String(film?.year || film?.year_start || '').replace(/[^0-9]/g, ''))
  if (!yStart) return false
  if (yearFrom && yStart < yearFrom) return false
  if (yearTo && yStart > yearTo) return false
  return true
}

// Кеш страниц kinobd /api/films/top на время жизни модуля (вкладки).
// Раз загруженная страница больше не запрашивается — экономим запросы и время.
const _topPagesCache = new Map() // page (number) -> array of films
let _topPagesAttempted = new Set() // страницы которые уже пробовали (включая упавшие)
// Лимиты подобраны так, чтобы не ловить бан по IP.
// Было: MAX_PAGE=100 при BATCH_SIZE=4 → до 100 запросов за один клик «Случайный
// фильм» (когда фильтр по годам ничего не находит, цикл шёл до конца). Именно
// это и клало нас в rate-limit.
// per_page=100 — столько kinobd отдаёт по умолчанию; на 50 мы делали вдвое
// больше запросов ради того же объёма данных.
const KINOBD_TOP_MAX_PAGE = 20
const KINOBD_TOP_PER_PAGE = 100

// Загружает указанные страницы параллельно, кладёт успешные в кеш.
// Возвращает массив фильмов из всех успешно загруженных (отфильтрованных) страниц.
const _loadTopPages = async (pageNumbers) => {
  const toFetch = pageNumbers.filter(
    (p) => !_topPagesCache.has(p) && !_topPagesAttempted.has(p)
  )
  if (toFetch.length) {
    await Promise.all(
      toFetch.map(async (page) => {
        _topPagesAttempted.add(page)
        try {
          const { data } = await apiCall((api) =>
            api.get('/api/films/top', {
              params: { page, per_page: KINOBD_TOP_PER_PAGE }
            })
          )
          const rows = Array.isArray(data?.data) ? data.data : []
          if (rows.length) _topPagesCache.set(page, rows)
        } catch {
          // Server Error / network — оставляем страницу как «пробовали и не получилось»
        }
      })
    )
  }
  // Возвращаем все фильмы из запрошенных страниц, что уже в кеше
  const all = []
  for (const p of pageNumbers) {
    const rows = _topPagesCache.get(p)
    if (rows) all.push(...rows)
  }
  return all
}

const getRandomMovie = async (opts = {}) => {
  const { yearFrom = null, yearTo = null } = opts
  const hasFilter = !!(yearFrom || yearTo)

  // Стратегия: тянем страницы пакетами по 2. Сначала первый пакет (страницы 1-2),
  // потом, если по фильтру никто не подошёл, следующий пакет (3-4), и так далее.
  // Все успешные страницы кешируются в _topPagesCache на время жизни вкладки —
  // повторные нажатия «Случайный фильм» работают мгновенно из памяти.
  //
  // Потолок запросов на один клик: KINOBD_TOP_MAX_PAGE (20) вместо прежних 100.
  // При per_page=100 это всё те же ~2000 фильмов для выборки, но в 5 раз меньше
  // обращений к источнику. Без фильтра хватает первого пакета — 2 запроса.
  const BATCH_SIZE = 2
  const MAX_BATCHES = Math.ceil(KINOBD_TOP_MAX_PAGE / BATCH_SIZE)

  let lastFallback = null

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const pages = []
    for (let i = 1; i <= BATCH_SIZE; i++) {
      const p = batch * BATCH_SIZE + i
      if (p <= KINOBD_TOP_MAX_PAGE) pages.push(p)
    }

    // Догружаем страницы (или берём из кеша если уже есть)
    const fresh = await _loadTopPages(pages)

    // Соберём ВСЕ фильмы из кеша которые у нас уже есть
    // (на следующих итерациях это даёт больше материала для выборки)
    let allCached = []
    for (const rows of _topPagesCache.values()) {
      allCached.push(...rows)
    }

    if (!allCached.length && !fresh.length) {
      // Эта пачка целиком не отдалась — пробуем следующую
      continue
    }

    if (!hasFilter) {
      // Без фильтра — выбираем из всех закешированных
      const pick = allCached[Math.floor(Math.random() * allCached.length)]
      return buildRandomMoviePayload(pick)
    }

    // С фильтром — ищем подходящих в полном кеше
    const matched = allCached.filter((film) => fitsYearFilter(film, yearFrom, yearTo))
    if (matched.length) {
      const pick = matched[Math.floor(Math.random() * matched.length)]
      return buildRandomMoviePayload(pick)
    }

    // Не нашли под фильтр — запомним хоть что-то на крайний случай
    if (allCached.length && !lastFallback) {
      lastFallback = buildRandomMoviePayload(allCached[0])
    }
  }

  // Совсем ничего не подошло под фильтр (или все запросы упали).
  if (!lastFallback) {
    throw new Error('kinobd: no usable response after retries')
  }
  return lastFallback
}

export {
  searchPlayerCandidates,
  getPlayerDataByInid,
  apiSearch,
  getMovieSeoByKpId,
  getKpInfo,
  getPlayers,
  getMovies,
  getKpIDfromIMDB,
  getRandomMovie
}

export const toggleErrorSimulation = (enabled) => {
  isErrorSimulationEnabled = enabled
}
