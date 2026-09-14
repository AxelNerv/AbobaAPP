/**
 * Возвращает URL бекенда.
 * Логика:
 *  - Если задана env-переменная VITE_AUTH_BACKEND_URL — берём её.
 *  - Иначе собираем URL автоматически из текущего хоста браузера + :8000.
 *    Это важно для мобильных устройств: когда сайт открыт с телефона на
 *    "192.168.1.10:5200", запросы к бекенду должны идти на "192.168.1.10:8000",
 *    а не на "localhost:8000" (где localhost — это сам телефон).
 */
export const getBackendUrl = () => {
  if (typeof window === 'undefined') {
    return '/api-backend'
  }
  const envUrl = import.meta.env.VITE_AUTH_BACKEND_URL
  if (envUrl) return envUrl

  // Используем относительный путь — Vite dev server проксирует /api-backend
  // на FastAPI backend. Так фронт+бэк ходят через один порт.
  // На мобилке это работает автоматически без открытия отдельного порта 8000.
  return '/api-backend'
}
