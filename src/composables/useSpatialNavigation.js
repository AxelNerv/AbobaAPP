/**
 * Навигация стрелками по любой странице — для пульта телевизора.
 *
 * Браузер телевизора превращает кнопки пульта в стрелки, но сам по себе
 * перемещает фокус только табом по порядку в разметке. На странице фильма
 * и в окнах это давало «фокус застрял» или «прыгнул неизвестно куда».
 * Здесь стрелка переводит фокус на ближайший элемент в нужную сторону.
 *
 * Свои правила уже есть у сетки фильмов (MovieList) и у боковой панели
 * (DesktopMenu) — там этот обработчик ничего не делает.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// Открытое окно перехватывает навигацию: фокус не должен уходить под затемнение.
const MODAL_SCOPES = ['.settings-modal', '.search', '.id-search-overlay', '.source-modal-backdrop', '.modal', '.bell-popup']

const DIRECTIONS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

const center = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })

// Расстояние между отрезками [a1, a2] и [b1, b2]; 0, если перекрываются.
const gap = (a1, a2, b1, b2) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2))

/**
 * Выбирает ближайший прямоугольник в сторону direction.
 * Сначала — элементы на одной линии с текущим, из них ближайший; если таких
 * нет — ближайший наискосок (смещение в сторону штрафуется втрое).
 * Возвращает индекс в candidates или -1.
 */
export const pickNext = (from, candidates, direction) => {
  const origin = center(from)
  let best = -1
  let bestScore = Infinity
  candidates.forEach((rect, index) => {
    const c = center(rect)
    let primary
    let cross
    if (direction === 'right') {
      if (c.x <= origin.x + 1) return
      primary = Math.max(0, rect.left - from.right)
      cross = gap(from.top, from.bottom, rect.top, rect.bottom)
    } else if (direction === 'left') {
      if (c.x >= origin.x - 1) return
      primary = Math.max(0, from.left - rect.right)
      cross = gap(from.top, from.bottom, rect.top, rect.bottom)
    } else if (direction === 'down') {
      if (c.y <= origin.y + 1) return
      primary = Math.max(0, rect.top - from.bottom)
      cross = gap(from.left, from.right, rect.left, rect.right)
    } else if (direction === 'up') {
      if (c.y >= origin.y - 1) return
      primary = Math.max(0, from.top - rect.bottom)
      cross = gap(from.left, from.right, rect.left, rect.right)
    } else {
      return
    }
    // Всё, что на одной линии, важнее любого элемента наискосок;
    // наискосок идём, только когда в эту сторону на линии никого нет.
    const score = (cross > 0 ? 1e6 : 0) + primary + cross * 3
    if (score < bestScore) {
      bestScore = score
      best = index
    }
  })
  return best
}

const isVisible = (el) => {
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  const style = window.getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('[inert], [aria-hidden="true"]')
}

const activeScope = () => {
  for (const selector of MODAL_SCOPES) {
    const scope = document.querySelector(selector)
    if (scope && isVisible(scope)) return scope
  }
  return document
}

/** В поле ввода стрелки влево/вправо двигают курсор, пока он не у края. */
const keepsKeyInside = (el, direction) => {
  const tag = el.tagName
  if (tag === 'SELECT') return direction === 'up' || direction === 'down'
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT' || !['text', 'search', 'url', 'email', 'number', 'password', ''].includes(el.type)) return false
  if (direction === 'left') return el.selectionStart > 0
  if (direction === 'right') return el.selectionEnd < el.value.length
  return false
}

export const handleSpatialKey = (event) => {
  const direction = DIRECTIONS[event.key]
  if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

  const active = document.activeElement
  const hasFocus = active && active !== document.body && active !== document.documentElement
  if (hasFocus) {
    // Свои обработчики у сетки фильмов и боковой панели
    if (active.classList.contains('movie-card') || active.closest('.sidebar')) return
    if (keepsKeyInside(active, direction)) return
  }

  const scope = activeScope()
  const candidates = [...scope.querySelectorAll(FOCUSABLE)].filter(
    (el) => el !== active && isVisible(el) && (scope !== document || !el.closest(MODAL_SCOPES.join(',')))
  )
  if (!candidates.length) return

  let target
  if (!hasFocus || (scope !== document && !scope.contains(active))) {
    // Фокуса ещё нет — начинаем с содержимого страницы или окна,
    // а не с крестика в углу: от него стрелки уводят слишком далеко.
    const content = candidates.filter((el) => !/close/i.test(el.className) && el.getAttribute('aria-label') !== 'Закрыть')
    target =
      content.find((el) => el.closest('#main-content') || scope !== document) ||
      content[0] ||
      candidates[0]
  } else {
    const index = pickNext(active.getBoundingClientRect(), candidates.map((el) => el.getBoundingClientRect()), direction)
    if (index === -1) return
    target = candidates[index]
  }

  event.preventDefault()
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
}

export const installSpatialNavigation = () => {
  document.addEventListener('keydown', handleSpatialKey)
  return () => document.removeEventListener('keydown', handleSpatialKey)
}
