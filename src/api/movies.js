import { useMainStore } from '@/store/main'
import * as kinobd from '@/api/movies.kinobd'
import * as kinobox from '@/api/movies.kinobox'
import * as tmdb from '@/api/movies.tmdb'
import { normalizeMovieListResponse } from '@/api/movieSeoNormalizer'

const CONTENT_PROVIDERS = {
  KINOBD: 'kinobd',
  KINOBOX: 'kinobox'
}

const KINOBD_SUPPORTED_METHODS = new Set([
  'apiSearch',
  'getKpInfo',
  'getPlayers',
  'getMovies',
  'getKpIDfromIMDB',
  'getRandomMovie'
])
const KINOBOX_SUPPORTED_METHODS = new Set(['getPlayers'])

const getCurrentProvider = () => {
  try {
    const mainStore = useMainStore()
    return mainStore.contentApiProvider || CONTENT_PROVIDERS.KINOBOX
  } catch {
    return CONTENT_PROVIDERS.KINOBOX
  }
}

const searchKinoBDPlayerCandidates = async (...args) => kinobd.searchPlayerCandidates(...args)
const getKinoBDPlayerDataByInid = async (...args) => kinobd.getPlayerDataByInid(...args)

const callWithProvider = async (methodName, ...args) => {
  const provider = getCurrentProvider()

  if (provider === CONTENT_PROVIDERS.KINOBOX && KINOBOX_SUPPORTED_METHODS.has(methodName)) {
    try {
      return await kinobox[methodName](...args)
    } catch (error) {
      console.warn(`[movies] ${methodName} failed on Kinobox, fallback to KinoBD`, error)
    }
  }

  if (KINOBD_SUPPORTED_METHODS.has(methodName)) {
    return await tryInOrder(
      methodName,
      [{ name: 'kinobd', run: () => kinobd[methodName](...args) }],
      (r) => r !== undefined && r !== null
    )
  }

  throw new Error(`Unsupported movie API method: ${methodName}`)
}

const apiSearch = async (...args) => {
  const data = await kinobd.apiSearch(...args)
  return await normalizeMovieListResponse(data)
}
/**
 * Пробует источники по порядку и возвращает первый годный ответ.
 *
 * Зачем: раньше каждый метод сам городил try/catch с rhserv первым, и на
 * каждой загрузке страницы в консоль сыпалась ошибка 403 — rhserv давно
 * забанен, но его продолжали спрашивать первым. Переключение на живой
 * источник — это не сбой, поэтому шумим только когда не ответил НИКТО.
 *
 * @param {string} label   — имя метода для сообщений
 * @param {Array}  sources — [{ name, run }] в порядке предпочтения
 * @param {Function} isGood — проверка, что ответ пригоден
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const tryInOrder = async (label, sources, isGood, { retries = 1, retryDelay = 700 } = {}) => {
  const problems = []

  // Проходим по источникам, и если не ответил никто — пробуем ещё раз.
  // Сбои чаще всего разовые: сеть моргнула, источник задумался. Без
  // повтора страница фильма показывала ошибку, хотя плееры уже грузились
  // с того же источника, и помогала только перезагрузка вручную.
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await wait(retryDelay)

    for (const { name, run } of sources) {
      try {
        const result = await run()
        if (isGood(result)) return result
        problems.push(`${name}: пусто`)
      } catch (error) {
        problems.push(`${name}: ${error?.message || 'ошибка'}`)
      }
    }
  }

  const err = new Error(`${label}: ни один источник не ответил`)
  err.allSourcesDown = true
  err.details = problems
  console.error(`[movies] ${label} — все источники недоступны:`, problems.join('; '))
  throw err
}

const hasRows = (rows) => Array.isArray(rows) && rows.length > 0

const getKpInfo = async (...args) => {
  const isGoodInfo = (d) =>
    !!(d && (d.kpId || d.kp_id || d.nameRu || d.nameOriginal || d.title))

  const data = await tryInOrder(
    'getKpInfo',
    [{ name: 'kinobd', run: () => kinobd.getKpInfo(...args) }],
    isGoodInfo
  )

  // Добираем у TMDB описание и постер, если их нет. TMDB не банит по IP,
  // поэтому закрывает дыры, которые оставляют остальные источники.
  return await tmdb.enrichMissingFields(data)
}
// getPlayers с явным fallback chain: kinobd → kinobox
//
// Порядок важен для скорости. Раньше первым шёл kinobox, но он сейчас не
// отвечает (закрывает соединение без ответа). Брейкер на бэкенде отключает
// мёртвый источник лишь на 30 минут, и после каждого сброса первый же
// посетитель ждал таймаут (connect 4с / total 8с) ПЕРЕД тем как получить
// плееры с живого kinobd. Отсюда и ощущение «сайт умер / грузится вечно»,
// повторяющееся примерно раз в полчаса.
//
// Теперь первым идёт kinobd — он живой и отвечает за ~0.5с. Kinobox оставлен
// в цепочке вторым: если оживёт, снова будет использоваться.
//
// Каждый источник проверяется на пустоту — {} или пустой объект без ключей
// считается неудачей и пробуем следующий источник.
const hasPlayers = (result) =>
  result && typeof result === 'object' && Object.keys(result).length > 0

const getPlayers = async (...args) => {
  let failedSources = 0
  let lastError = null

  // 1. KinoBD — основной рабочий источник
  try {
    const result = await kinobd.getPlayers(...args)
    if (hasPlayers(result)) return result
    console.warn('[movies] getPlayers: kinobd returned empty, trying kinobox')
  } catch (e) {
    failedSources += 1
    lastError = e
    console.warn('[movies] getPlayers: kinobd failed:', e?.message)
  }

  // 2. Kinobox
  try {
    const result = await kinobox.getPlayers(...args)
    if (hasPlayers(result)) return result
    console.warn('[movies] getPlayers: kinobox returned empty')
  } catch (e) {
    failedSources += 1
    lastError = e
    console.warn('[movies] getPlayers: kinobox failed:', e?.message)
  }

  // Раньше здесь молча возвращался {} — и когда падали ВСЕ источники, UI
  // показывал «плееров нет», как будто их нет для этого фильма. Отличить
  // «фильма нет ни у кого» от «все источники лежат» было невозможно.
  // Теперь разница явная: пусто — это пусто, а отказ источников — ошибка.
  if (failedSources === 2) {
    const err = new Error('Все источники плееров недоступны')
    err.cause = lastError
    err.allSourcesDown = true
    throw err
  }

  console.warn('[movies] getPlayers: у источников нет плееров для этого фильма')
  return {}
}
const getMovies = async (...args) => {
  const typeFilter = args?.[0]?.typeFilter || 'all'
  let rows
  try {
    rows = await kinobd.getMovies(...args)
    // С фильтром пустой список — честный ответ, а не авария: подменять его нельзя.
    if (typeFilter === 'all' && !hasRows(rows)) throw new Error('kinobd returned an empty list')
  } catch (error) {
    // Главная должна открываться даже при полном падении внешних каталогов.
    // Но в заготовке нет типов: отдать её на «Фильмы» или «Сериалы» значит
    // показать чужой список без единого слова об ошибке. С фильтром — ошибка.
    if (typeFilter !== 'all') throw error
    // JSON грузится отдельным чанком только при аварии и не утяжеляет старт.
    const { default: seedMovies } = await import('@/data/movies.json')
    const limit = Math.max(1, Number(args?.[0]?.limit) || 100)
    rows = seedMovies.slice(0, limit)
  }
  return await normalizeMovieListResponse(rows, { enrichMissingSeo: false })
}
// Пагинированный топ для бесконечного скролла главной.
// Идёт напрямую через kinobd (rhserv пагинацию не поддерживает).
// Страница 1 не используется — там работает быстрый getMovies с кешем.
const getMoviesPaginated = async ({ page = 2, typeFilter = 'all' } = {}) => {
  const rows = await kinobd.getMovies({ activeTime: '24h', typeFilter, page })
  // enrichMissingSeo отключён — он делает по запросу на каждый фильм (50 шт на страницу)
  // и убивает скорость. Для бесконечного скролла достаточно данных от kinobd.
  return await normalizeMovieListResponse(rows, { enrichMissingSeo: false })
}
const getKpIDfromIMDB = async (...args) => callWithProvider('getKpIDfromIMDB', ...args)
const getRandomMovie = async (...args) => callWithProvider('getRandomMovie', ...args)

export {
  searchKinoBDPlayerCandidates,
  getKinoBDPlayerDataByInid,
  apiSearch,
  getKpInfo,
  getPlayers,
  getMovies,
  getMoviesPaginated,
  getKpIDfromIMDB,
  getRandomMovie
}

export const toggleErrorSimulation = (enabled) => {
  if (typeof kinobd.toggleErrorSimulation === 'function') {
    kinobd.toggleErrorSimulation(enabled)
  }
  if (typeof kinobox.toggleErrorSimulation === 'function') {
    kinobox.toggleErrorSimulation(enabled)
  }
}
