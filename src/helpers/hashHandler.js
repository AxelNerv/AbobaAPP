import { getMovieSeoPath } from '@/utils/movieSeo'

/**
 * Что делать с якорем в ссылке. Возвращает значение для навигационного
 * хука: объект маршрута — перенаправить, true — пропустить как есть.
 *
 * Раньше сюда передавали next() и звали его внутри — Vue Router считает
 * такой стиль устаревшим и предупреждает об этом в консоли.
 */
export const resolveHashNavigation = (to) => {
  if (to.hash.startsWith('#/')) {
    const route = to.hash.substring(2)
    const [routePath, queryString] = route.split('?')
    const queryParams = new URLSearchParams(queryString)
    const query = Object.fromEntries(queryParams)

    return { path: routePath || '/', query }
  }

  // Эти якоря разбирает сама страница — навигацию не трогаем
  if (
    to.hash.startsWith('#search=') ||
    to.hash.startsWith('#imdb=') ||
    to.hash.startsWith('#shiki')
  ) {
    return true
  }

  // Голый якорь считаем kp_id фильма: #12345 → /movie/12345/slug
  return { path: getMovieSeoPath({ kp_id: to.hash.slice(1) }) }
}
