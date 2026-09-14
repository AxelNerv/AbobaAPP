import { getBackendUrl } from '@/api/backendUrl'

/**
 * Есть ли у плеера alloha версия в 4K.
 *
 * Из балансеров 4K честно есть только у alloha, а список плееров kinobd
 * об этом молчит. Бэкенд смотрит в страницу самого плеера и отвечает
 * одним «да/нет». Метка — подсказка, поэтому любой сбой означает «нет»,
 * а не ошибку на экране.
 */
const cache = new Map()

export const hasAllohaUhd = async (iframeUrl) => {
  if (!iframeUrl) return false
  if (cache.has(iframeUrl)) return cache.get(iframeUrl)

  const request = fetch(
    `${getBackendUrl()}/player/alloha-uhd?url=${encodeURIComponent(iframeUrl)}`
  )
    .then((response) => (response.ok ? response.json() : { uhd: false }))
    .then((data) => data?.uhd === true)
    .catch(() => false)

  cache.set(iframeUrl, request)
  return request
}
