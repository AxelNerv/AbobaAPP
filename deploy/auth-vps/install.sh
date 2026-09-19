#!/usr/bin/env bash
# Установка сервера входа AbobaTV на чистый Ubuntu. Запускать от root
# из папки, куда залит пакет. Повторный запуск безопасен: обновит код
# и пересоберёт контейнеры, данные входа останутся в томе.
#
# HTTPS — на порту ABOBA_HTTPS_PORT из .env (по умолчанию 8443).
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n== %s\n' "$*"; }

[ -f .env ] || { echo "Нет .env рядом со скриптом"; exit 1; }
set -a; . ./.env; set +a
PORT="${ABOBA_HTTPS_PORT:-8443}"
if [ "$PORT" = "443" ]; then URL="https://${ABOBA_AUTH_DOMAIN}"; else URL="https://${ABOBA_AUTH_DOMAIN}:${PORT}"; fi

if ! command -v docker >/dev/null 2>&1; then
  say "Ставлю Docker (официальный скрипт get.docker.com)"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null

# Если включён брандмауэр ufw, открываем нужные порты. SSH он уже пропускает,
# иначе мы бы сюда не попали.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Открываю 80 и ${PORT} в ufw"
  ufw allow 80/tcp >/dev/null
  ufw allow "${PORT}/tcp" >/dev/null
fi

say "Кто уже слушает веб-порты (чужое на 443 не трогаем)"
ss -ltnp 2>/dev/null | grep -E ":(80|443|${PORT})[[:space:]]" || echo "80, 443 и ${PORT} никем не заняты"

say "Собираю и запускаю контейнеры"
# Без выхода по ошибке: если что-то не поднялось, ниже нужна диагностика,
# а не молчаливый обрыв на середине.
docker compose up -d --build || say "docker compose завершился с ошибкой — смотри состояние ниже"
# Caddy не пересоздаётся, если поменялся только Caddyfile, и держит старые
# правила. Перечитываем их явно (без остановки); не вышло — перезапуск.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile   || docker compose restart caddy || true

say "Жду, пока сервер входа ответит"
status=""
for i in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' abobatv-auth-auth-1 2>/dev/null || true)
  [ "$status" = "healthy" ] && break
  sleep 2
done
echo "сервер входа: ${status:-неизвестно}"

say "Проверяю HTTPS снаружи (сертификат может выдаваться до минуты)"
ok=""
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "${URL}/auth/status"; then echo; ok=1; break; fi
  sleep 3
done
[ -n "$ok" ] || echo "HTTPS так и не ответил"

say "Закрытые адреса должны отвечать 404"
curl -s -o /dev/null -w "/ext-health → %{http_code}\n" "${URL}/ext-health" || true

say "Синхронизация без ключа должна отвечать 401"
curl -s -o /dev/null -w "/sync → %{http_code}\n" -X POST -H 'Content-Type: application/json' \
  -d '{"cursor":0,"items":[]}' "${URL}/sync" || true

say "Статус сериалов (TVmaze) должен отвечать 200"
curl -s -o /dev/null -w "/ext/tvmaze → %{http_code}
" "${URL}/ext/tvmaze/lookup/shows?imdb=tt1520211" || true

say "Состояние"
docker compose ps -a
docker compose logs --tail 20 caddy 2>&1 || true
docker compose logs --tail 5 bot 2>&1 | sed -E 's#bot[0-9]+:[A-Za-z0-9_-]+#bot<токен>#g' || true

if [ -n "$ok" ]; then
  say "Готово. Адрес для приложения: ${URL}"
else
  say "Не готово — пришли весь этот вывод"
fi
