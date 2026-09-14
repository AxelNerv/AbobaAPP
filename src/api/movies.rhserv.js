import { getApi } from '@/api/axios'

// ===== Симуляция ошибки =====
let isErrorSimulationEnabled = false // Переменная для включения/отключения симуляции ошибки
const simulatedErrorCode = 500

const simulateErrorIfNeeded = async () => {
  if (isErrorSimulationEnabled && simulatedErrorCode) {
    const status = parseInt(simulatedErrorCode, 10)
    const error = new Error(`Симулированная ошибка ${status}`)
    error.response = { status }
    throw error
  }
}

// Универсальный вызов запроса с симуляцией ошибки
const apiCall = async (callFn) => {
  await simulateErrorIfNeeded()
  const api = await getApi()
  return await callFn(api)
}

// ===== API-функции =====
const apiSearch = async (searchTerm) => {
  const { data } = await apiCall((api) => api.get(`/search/${searchTerm}`))
  return data
}

const getShikiInfo = async (shikiId) => {
  const { data } = await apiCall((api) => api.get(`/shiki_info/${shikiId}`))
  return data
}

const getKpInfo = async (kpId) => {
  const { data } = await apiCall((api) => api.get(`/kp_info2/${kpId}`))
  return data
}

const getPlayers = async (kpId) => {
  const { data } = await apiCall((api) =>
    api.post(
      '/cache',
      new URLSearchParams({
        kinopoisk: kpId,
        type: 'movie'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
  )
  return data
}

const getShikiPlayers = async (shikiId) => {
  const { data } = await apiCall((api) =>
    api.post(
      '/cache_shiki',
      new URLSearchParams({
        shikimori: shikiId,
        type: 'anime'
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
  )
  return data
}

const getMovies = async ({ activeTime = 'all', typeFilter = 'all', limit = null } = {}) => {
  const limitParam = limit ? `&limit=${limit}` : ''
  const { data } = await apiCall((api) =>
    api.get(`/top/${activeTime}?type=${typeFilter}${limitParam}`)
  )
  return data
}

const getDons = async () => {
  const { data } = await apiCall((api) => api.get('/get_dons'))
  return data
}

const getKpIDfromIMDB = async (imdb_id) => {
  const { data } = await apiCall((api) => api.get(`/imdb_to_kp/${imdb_id}`))
  return data
}


const getKpIDfromSHIKI = async (shiki_id) => {
  const { data } = await apiCall((api) => api.get(`/shiki_to_kp/${shiki_id}`))
  return data
}

const getRating = async (kpId) => {
  const { data } = await apiCall((api) => api.get(`/rating/${kpId}`))
  return data
}

const setRating = async (kpId, rating) => {
  const { data } = await apiCall((api) => api.post(`/rating/${kpId}`, { rating }))
  return data
}

const getComments = async (movieId) => {
  const { data } = await apiCall((api) => api.get(`/comments/${movieId}`))
  return data
}

const createComment = async (movieId, content, parentId = null) => {
  const { data } = await apiCall((api) =>
    api.post(`/comments/${movieId}`, { content, parent_id: parentId })
  )
  return data
}

const updateComment = async (commentId, content) => {
  const { data } = await apiCall((api) => api.put(`/comments/${commentId}`, { content }))
  return data
}

const deleteComment = async (commentId) => {
  const { data } = await apiCall((api) => api.delete(`/comments/${commentId}`))
  return data
}

const rateComment = async (commentId, rating) => {
  const { data } = await apiCall((api) =>
    api.post(`/comments/${commentId}/rate`, { rating: rating })
  )
  return data
}







const getRandomMovie = async (opts = {}) => {
  const { yearFrom = null, yearTo = null } = opts
  const hasFilter = !!(yearFrom || yearTo)

  // Без фильтра — 1 запрос
  if (!hasFilter) {
    const { data } = await apiCall((api) => api.get('/chance'))
    return data
  }

  // С фильтром — бросаем 5 запросов параллельно, берём первый подходящий
  const batchSize = 5
  const maxBatches = 3 // итого максимум 15 запросов, ~3 сек
  let last = null

  for (let batch = 0; batch < maxBatches; batch++) {
    const promises = []
    for (let i = 0; i < batchSize; i++) {
      promises.push(apiCall((api) => api.get('/chance')).then(r => r.data).catch(() => null))
    }
    const results = await Promise.all(promises)
    for (const data of results) {
      if (!data) continue
      last = data
      const y = Number(data?.year)
      if (!y) continue
      if (yearFrom && y < yearFrom) continue
      if (yearTo && y > yearTo) continue
      return data
    }
  }
  return last
}




const getTwitchStream = async (username) => {
  const { data } = await apiCall((api) => api.get(`/twitch/${username}`))
  return data
}






export {
  apiSearch,
  getShikiInfo,
  getKpInfo,
  getPlayers,
  getShikiPlayers,
  getMovies,
  getDons,
  getKpIDfromIMDB,
  getKpIDfromSHIKI,
  getRating,
  setRating,
  getComments,
  createComment,
  updateComment,
  deleteComment,
  rateComment,
  getRandomMovie,
  getTwitchStream
}

// ===== Функция для включения/выключения симуляции =====
export const toggleErrorSimulation = (enabled) => {
  isErrorSimulationEnabled = enabled
}
