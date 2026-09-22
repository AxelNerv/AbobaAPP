"""
AbobaTV Backend — FastAPI + SQLite
"""

import asyncio
import ipaddress
import json
import os
import re
import secrets
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse
from typing import Optional

import aiohttp
import sync
from fastapi import FastAPI, HTTPException, Header, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ──────────────────────────────────────────────
#  Конфиг
# ──────────────────────────────────────────────
ADMIN_KEY = os.environ.get("ADMIN_KEY", "").strip()
AUTH_SERVER_URL = os.environ.get("AUTH_SERVER_URL", "").strip().rstrip("/")
AUTH_MODE = os.environ.get("AUTH_MODE", "authority")
BOT_USERNAME = os.environ.get("BOT_USERNAME", "AbobaWathTV_bot").lstrip("@")
if AUTH_SERVER_URL:
    auth_url = urlparse(AUTH_SERVER_URL)
    if auth_url.scheme not in ("http", "https") or not auth_url.hostname or auth_url.username or auth_url.password:
        raise RuntimeError("Некорректный AUTH_SERVER_URL")
    if auth_url.scheme != "https" and auth_url.hostname not in ("localhost", "127.0.0.1", "::1", "host.docker.internal"):
        raise RuntimeError("Для удалённого сервера входа необходим HTTPS")
# Метку выдаёт приложение при запуске. По ней оно отличает свой бэкенд
# от чужого сервиса, случайно занявшего тот же порт.
INSTANCE_ID = os.environ.get("ABOBA_INSTANCE_ID", "")
DATA_DIR = Path(os.environ.get("STATE_FILE", str(Path(__file__).parent / "state.json"))).parent
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "abobatv.db"
STATE_FILE = DATA_DIR / "state.json"  # нужен только для миграции

app = FastAPI(title="AbobaTV API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def close_http_session():
    for session in (_http_session, _fresh_http_session):
        if session is not None and not session.closed:
            await session.close()

# ──────────────────────────────────────────────
#  SQLite
# ──────────────────────────────────────────────
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return _local.conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db():
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            tg_id        INTEGER PRIMARY KEY,
            name         TEXT    NOT NULL DEFAULT '',
            username     TEXT    NOT NULL DEFAULT '',
            photo_url    TEXT    NOT NULL DEFAULT '',
            logged_in_at TEXT
        );

        CREATE TABLE IF NOT EXISTS tokens (
            token  TEXT    PRIMARY KEY,
            tg_id  INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_lists (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id      INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
            list_type  TEXT    NOT NULL,
            kp_id      TEXT    NOT NULL,
            movie_json TEXT    NOT NULL DEFAULT '{}',
            added_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE(tg_id, list_type, kp_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_lists
            ON user_lists(tg_id, list_type, added_at DESC);

        CREATE TABLE IF NOT EXISTS reports (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_tg_id    INTEGER NOT NULL,
            reporter_name     TEXT    NOT NULL DEFAULT '',
            target_type       TEXT    NOT NULL,
            target_id         TEXT    NOT NULL,
            reason            TEXT    NOT NULL,
            details           TEXT    NOT NULL DEFAULT '',
            created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
            resolved          INTEGER NOT NULL DEFAULT 0,
            resolved_by       INTEGER,
            resolved_at       TEXT,
            resolution_action TEXT
        );

        CREATE TABLE IF NOT EXISTS broadcasts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            text         TEXT    NOT NULL,
            author_tg_id INTEGER NOT NULL,
            author_name  TEXT    NOT NULL DEFAULT '',
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        """)
    print(f"[db] SQLite ready at {DB_PATH}")


def migrate_from_json():
    """Читает state.json и переносит данные в SQLite. Запускается один раз."""
    if not STATE_FILE.exists():
        return
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count > 0:
            print(f"[migrate] DB already has {count} users — skipping")
            return
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[migrate] failed to read state.json: {e}")
        return

    users_data = data.get("users", {})
    tokens_data = data.get("tokens", {})
    reports_data = data.get("reports", [])
    broadcasts_data = data.get("broadcasts", [])

    with db() as conn:
        for tg_id_str, u in users_data.items():
            tg_id = int(tg_id_str)
            conn.execute("""
                INSERT OR IGNORE INTO users
                (tg_id, name, username, photo_url, logged_in_at)
                VALUES (?,?,?,?,?)
            """, (
                tg_id, u.get("name", ""), u.get("username", ""),
                u.get("photo_url", ""), u.get("logged_in_at"),
            ))
            for list_type, items in (u.get("lists") or {}).items():
                if list_type not in ("favorites", "history"):
                    continue
                for movie in reversed(items or []):
                    kp_id = str(movie.get("kp_id") or movie.get("id") or "")
                    if not kp_id:
                        continue
                    conn.execute("""
                        INSERT OR IGNORE INTO user_lists
                        (tg_id, list_type, kp_id, movie_json)
                        VALUES (?,?,?,?)
                    """, (tg_id, list_type, kp_id,
                          json.dumps(movie, ensure_ascii=False)))

        for token, tg_id_raw in tokens_data.items():
            tg_id = int(tg_id_raw)
            if conn.execute("SELECT 1 FROM users WHERE tg_id=?",
                            (tg_id,)).fetchone():
                conn.execute(
                    "INSERT OR IGNORE INTO tokens (token, tg_id) VALUES (?,?)",
                    (token, tg_id))

        for r in reports_data:
            conn.execute("""
                INSERT OR IGNORE INTO reports
                (id, reporter_tg_id, reporter_name, target_type, target_id,
                 reason, details, created_at, resolved,
                 resolved_by, resolved_at, resolution_action)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (r.get("id"), r.get("reporter_tg_id"), r.get("reporter_name", ""),
                  r.get("target_type"), r.get("target_id"), r.get("reason"),
                  r.get("details", ""), r.get("created_at"),
                  1 if r.get("resolved") else 0, r.get("resolved_by"),
                  r.get("resolved_at"), r.get("resolution_action")))

        for b in broadcasts_data:
            conn.execute("""
                INSERT OR IGNORE INTO broadcasts
                (id, text, author_tg_id, author_name, created_at)
                VALUES (?,?,?,?,?)
            """, (b.get("id"), b.get("text"), b.get("author_tg_id"),
                  b.get("author_name", ""), b.get("created_at")))

    print(f"[migrate] done: {len(users_data)} users, {len(tokens_data)} tokens, "
          f"{len(reports_data)} reports, {len(broadcasts_data)} broadcasts")


# ──────────────────────────────────────────────
#  Инициализация
# ──────────────────────────────────────────────
init_db()
migrate_from_json()
with db() as _conn:
    sync.migrate(_conn)

pending_codes: dict = {}
sessions: dict = {}

# ──────────────────────────────────────────────
#  Кеширующий реверс-прокси для внешних API фильмов
# ──────────────────────────────────────────────
# Зачем: rhserv/kinobd отдают CORS только на 200, а при rate-limit (403/429)
# заголовков нет → браузер показывает «CORS error» и сайт умирает.
# Если ходить к ним напрямую из браузера — мы (а) упираемся в CORS на ошибках,
# (б) задалбливаем их запросами с каждого клиента и ловим бан.
# Решение: браузер ходит на наш бэкенд (same-origin, CORS *), бэкенд тянет
# данные server-side с браузерным UA и КЕШИРУЕТ. Меньше запросов к источнику →
# нет rate-limit, и быстрее за счёт кеша.

PROXY_TARGETS = {
    "rhserv": "https://api4.rhserv.vu",
    "kinobd": "https://kinobd.net",
    "kinobox": "https://api.kinobox.tv",
    # TMDB — стабильный источник описаний/постеров, не подверженный банам,
    # которые мы ловим от rhserv. Используется как «донор» недостающих полей.
    "tmdb": "https://api.themoviedb.org",
    # TVmaze не требует ключа: статус сериала и даты выхода серий.
    "tvmaze": "https://api.tvmaze.com",
}

# Ключ TMDB живёт ТОЛЬКО на сервере. Во фронт его класть нельзя: всё, что с
# префиксом VITE_, вкомпилируется в публичный бандл и утечёт. Поэтому браузер
# ходит на /ext/tmdb/... без ключа, а прокси подставляет его сам.
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "").strip()

# Доп. заголовки, которые источник требует, а браузер запрещает ставить из JS
# (Referer/Origin — «unsafe headers»). Ставим их здесь, server-side.
PROXY_EXTRA_HEADERS = {
    "kinobox": {
        "Referer": "https://tapeop.dev/",
        "Origin": "https://tapeop.dev",
    },
    "tvmaze": {
        "User-Agent": "AbobaTV/0.3.4 (https://github.com/AxelNerv/AbobaAPP)",
    },
}


def _proxy_base_for(provider: str) -> Optional[str]:
    base = PROXY_TARGETS.get(provider)
    # api.tvmaze.com сейчас недоступен напрямую из части домашних сетей.
    # Клиентское приложение ходит через сервер входа/VPS; authority уже
    # обращается к TVmaze напрямую и держит общий кеш для всех клиентов.
    if provider == "tvmaze" and AUTH_MODE == "client" and AUTH_SERVER_URL:
        return f"{AUTH_SERVER_URL.rstrip('/')}/ext/tvmaze"
    return base

# TTL кеша по «типу» пути (сек). Топы/обсуждаемое меняются редко — кешируем дольше.
def _cache_ttl_for(path: str) -> int:
    p = path.lower()
    if p.startswith("top/") or p.startswith("api/films/top") or p.startswith("discussed/"):
        return 1800       # 30 минут. Топы за 5 минут не меняются, а короткий TTL
                          # означал повторные обращения к источнику каждые 5 мин
                          # с каждой новой страницы → лишний повод для бана.
    if ("kp_info" in p or "search" in p or "imdb" in p or "shiki" in p or
            p.startswith("3/") or p.startswith("lookup/shows") or p.startswith("shows/")):
        # p.startswith("3/") — все запросы к TMDB (у него версия в пути: /3/find,
        # /3/search). Описания и постеры там не меняются годами.
        return 3600       # 1 час — справочные данные практически статичны
    return 0              # остальное (плееры и пр.) не кешируем

_proxy_cache: dict = {}          # key -> (expiry_ts, status, content_type, body_bytes)
_proxy_cache_lock = threading.Lock()
_proxy_cache_bytes = 0
PROXY_CACHE_MAX_ENTRIES = 512
PROXY_CACHE_MAX_BYTES = 32 * 1024 * 1024
PROXY_CACHE_STALE_TTL = 24 * 60 * 60
_http_session: Optional[aiohttp.ClientSession] = None


def _proxy_cache_get(key: str, allow_stale: bool = False):
    """LRU-чтение; слишком старые записи сразу освобождают память."""
    global _proxy_cache_bytes
    now = time.time()
    with _proxy_cache_lock:
        entry = _proxy_cache.get(key)
        if not entry:
            return None
        expiry, _, _, body = entry
        if expiry + PROXY_CACHE_STALE_TTL <= now:
            _proxy_cache.pop(key, None)
            _proxy_cache_bytes -= len(body)
            return None
        if expiry <= now and not allow_stale:
            return None
        # Обычный dict сохраняет порядок: переносим использованную запись в хвост.
        _proxy_cache.pop(key)
        _proxy_cache[key] = entry
        return entry


def _proxy_cache_put(key: str, entry) -> None:
    """Кеш ограничен и числом ответов, и общим размером их тел."""
    global _proxy_cache_bytes
    body = entry[3]
    if len(body) > PROXY_CACHE_MAX_BYTES:
        return
    with _proxy_cache_lock:
        previous = _proxy_cache.pop(key, None)
        if previous:
            _proxy_cache_bytes -= len(previous[3])
        _proxy_cache[key] = entry
        _proxy_cache_bytes += len(body)
        while (_proxy_cache and
               (len(_proxy_cache) > PROXY_CACHE_MAX_ENTRIES or
                _proxy_cache_bytes > PROXY_CACHE_MAX_BYTES)):
            oldest_key = next(iter(_proxy_cache))
            oldest = _proxy_cache.pop(oldest_key)
            _proxy_cache_bytes -= len(oldest[3])

# ── Circuit breaker ──────────────────────────────────────────────────────
# Если источник банит нас (403/429) или недоступен — перестаём к нему ходить
# на COOLDOWN_SECONDS. Это критично: иначе мы долбим rhserv заблокированными
# запросами на каждый клик, и его rate-limit НИКОГДА не сбрасывается (бан вечный).
# Перестав ходить — даём бану остыть, и раз в COOLDOWN пробуем снова.
# Брейкер существует ради ОДНОГО случая: источник нас забанил (403/429).
# Тогда ходить к нему бессмысленно и вредно — бан не остынет, пока мы долбим.
#
# Сетевые сбои (таймаут, обрыв) сюда НЕ относятся: они случайны и проходят
# сами. Раньше выключали и за них — и сайт ложился целиком, хотя kinobd
# отвечал 200: брейкер держал единственный живой источник выключенным.
#
# Выключаем после нескольких отказов подряд, пауза нарастает: минута,
# 5 минут, потом полчаса. Любой успешный ответ обнуляет и счётчик, и рост.
FAILURES_BEFORE_TRIP = 3
COOLDOWN_STEPS = [60, 300, 1800]     # 1 мин -> 5 мин -> 30 мин
_provider_tripped_until: dict = {}   # provider -> ts, до которого не ходим
_provider_failures: dict = {}        # provider -> подряд идущих неудач
_provider_trips: dict = {}           # provider -> сколько раз уже отключали
_breaker_lock = threading.Lock()


def _is_tripped(provider: str) -> bool:
    with _breaker_lock:
        until = _provider_tripped_until.get(provider, 0)
    return time.time() < until


def _note_failure(provider: str) -> bool:
    """Считает неудачу. Возвращает True, если источник пришлось выключить."""
    with _breaker_lock:
        fails = _provider_failures.get(provider, 0) + 1
        _provider_failures[provider] = fails
        if fails < FAILURES_BEFORE_TRIP:
            return False
        # Порог пройден — выключаем с нарастающей паузой
        step = min(_provider_trips.get(provider, 0), len(COOLDOWN_STEPS) - 1)
        _provider_tripped_until[provider] = time.time() + COOLDOWN_STEPS[step]
        _provider_trips[provider] = _provider_trips.get(provider, 0) + 1
        _provider_failures[provider] = 0
        return True


def _reset_provider(provider: str) -> None:
    with _breaker_lock:
        _provider_tripped_until.pop(provider, None)
        _provider_failures.pop(provider, None)
        _provider_trips.pop(provider, None)

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}


async def _get_http_session() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        timeout = aiohttp.ClientTimeout(total=20)
        _http_session = aiohttp.ClientSession(timeout=timeout)
    return _http_session


# Провайдеры, к которым каждый запрос идёт новым соединением.
#
# На части сетей соединение с kinobd замерзает, когда через него суммарно
# прошло ~25 КБ — не один большой ответ, а сколько угодно мелких подряд.
# Пул соединений переиспользует их, поэтому таймауты ловили и маленькие
# запросы: они просто попадали в соединение, которое уже «выбрало лимит».
# Новое соединение — лишнее TLS-рукопожатие (десятки миллисекунд), зато
# каждый запрос начинает счёт с нуля.
FRESH_CONNECTION_PROVIDERS = {"kinobd"}
_fresh_http_session: Optional[aiohttp.ClientSession] = None


async def _get_session_for(provider: str) -> aiohttp.ClientSession:
    global _fresh_http_session
    if provider not in FRESH_CONNECTION_PROVIDERS:
        return await _get_http_session()
    if _fresh_http_session is None or _fresh_http_session.closed:
        _fresh_http_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=20),
            connector=aiohttp.TCPConnector(force_close=True),
        )
    return _fresh_http_session


# ── Постеры для устройств в сети ──
# Телевизор или старый телефон, открывший раздачу, часто не доверяет свежим
# сертификатам (kinopoiskapiunofficial — Let's Encrypt с корнем ISRG Root X2),
# и постеры у него просто не грузятся. Компьютер тянет картинку сам и отдаёт
# по обычному http из той же раздачи. Только картинки и только с известных
# хостов — иначе это превратилось бы в открытый прокси.
IMAGE_HOSTS = (
    "kinopoiskapiunofficial.tech",
    "st.kp.yandex.net",
    "avatars.mds.yandex.net",
    "image.tmdb.org",
    "m.media-amazon.com",
)
IMAGE_MAX_BYTES = 4 * 1024 * 1024
IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024
_image_cache: "dict[str, tuple[str, bytes]]" = {}
_image_cache_size = 0
_image_cache_lock = threading.Lock()


def _image_host_allowed(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return parsed.scheme in ("http", "https") and any(
        host == allowed or host.endswith("." + allowed) for allowed in IMAGE_HOSTS
    )


def _image_cache_put(url: str, ctype: str, body: bytes) -> None:
    global _image_cache_size
    with _image_cache_lock:
        if url in _image_cache:
            return
        _image_cache[url] = (ctype, body)
        _image_cache_size += len(body)
        # dict хранит порядок вставки — выкидываем самые старые
        while _image_cache_size > IMAGE_CACHE_MAX_BYTES and _image_cache:
            old = next(iter(_image_cache))
            _image_cache_size -= len(_image_cache.pop(old)[1])


@app.get("/img")
async def image_proxy(u: str):
    if not _image_host_allowed(u):
        raise HTTPException(400, "host not allowed")
    headers = {"Cache-Control": "public, max-age=604800"}
    with _image_cache_lock:
        hit = _image_cache.get(u)
    if hit:
        return Response(content=hit[1], media_type=hit[0], headers=headers)

    session = await _get_http_session()
    # Без webp/avif в Accept: старые браузеры телевизоров их не показывают
    request_headers = {**_BROWSER_HEADERS, "Accept": "image/jpeg,image/png,image/gif;q=0.9,*/*;q=0.5"}
    url = u
    try:
        # Кинопоиск отвечает редиректом на avatars.mds — каждый шаг проверяем
        for _ in range(4):
            async with session.get(
                url,
                headers=request_headers,
                allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=10, connect=4),
            ) as resp:
                if resp.status in (301, 302, 303, 307, 308):
                    location = resp.headers.get("Location", "")
                    url = str(resp.url.join(type(resp.url)(location)))
                    if not _image_host_allowed(url):
                        raise HTTPException(502, "redirect not allowed")
                    continue
                ctype = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
                if resp.status != 200 or not ctype.startswith("image/"):
                    raise HTTPException(404, "no image")
                # read(n) отдаёт то, что уже пришло, а не весь файл —
                # читаем до конца, следя за размером
                chunks, size = [], 0
                async for chunk in resp.content.iter_chunked(64 * 1024):
                    size += len(chunk)
                    if size > IMAGE_MAX_BYTES:
                        raise HTTPException(413, "image too large")
                    chunks.append(chunk)
                body = b"".join(chunks)
                _image_cache_put(u, ctype, body)
                return Response(content=body, media_type=ctype, headers=headers)
    except HTTPException:
        raise
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
        raise HTTPException(502, "image fetch failed")
    raise HTTPException(502, "too many redirects")


@app.get("/ext-health")
async def ext_health():
    """Какие источники сейчас выключены брейкером.

    Нужен фронту, чтобы не дёргать заведомо мёртвый источник: запрос всё
    равно вернётся ошибкой, но браузер запишет её в консоль как красную
    строку. Проще заранее не ходить туда, где нас не ждут.
    """
    now = time.time()
    with _breaker_lock:
        tripped = [p for p, until in _provider_tripped_until.items() if until > now]
    return {"tripped": tripped, "providers": list(PROXY_TARGETS.keys()), "instance": INSTANCE_ID}


# ──────────────────────────────────────────────
#  kinobd: сборка большой страницы из маленьких
# ──────────────────────────────────────────────
# На некоторых сетях соединение с kinobd замерзает, если ответ больше ~25 КБ
# даже после сжатия: заголовки и первые килобайты приходят, остальное — нет,
# и запрос висит до таймаута. Отдельные соединения при этом работают, так что
# большую страницу топа собираем из нескольких маленьких. Фронт этого не
# замечает: запрос и ответ те же. Порог плавает от содержимого (30 фильмов
# иногда проходят, 25 — нет), поэтому кусок с запасом.
#
# Режем только топ: он честно слушает per_page. updates и search/title
# размер страницы игнорируют, а остальные ответы после сжатия и так малы.
KINOBD_SPLIT_PATHS = {"api/films/top"}
KINOBD_CHUNK = 10
KINOBD_CHUNK_CONCURRENCY = 4
_PAGINATION_LINK_FIELDS = ("links", "first_page_url", "last_page_url", "next_page_url", "prev_page_url")


def kinobd_split_plan(provider: str, method: str, path: str, query: str):
    """Нужно ли собирать ответ из кусков. None — запрос идёт как есть."""
    if provider != "kinobd" or method != "GET" or path.strip("/") not in KINOBD_SPLIT_PATHS:
        return None
    params = dict(parse_qsl(query, keep_blank_values=True))
    try:
        page = max(1, int(params.get("page") or 1))
        per_page = int(params.get("per_page") or 0)
    except ValueError:
        return None
    # Без явного per_page не угадываем размер по умолчанию — пусть идёт как есть.
    if per_page <= KINOBD_CHUNK or per_page > 500:
        return None
    start = (page - 1) * per_page
    first_chunk = start // KINOBD_CHUNK + 1
    last_chunk = -(-(start + per_page) // KINOBD_CHUNK)
    return {
        "params": params,
        "page": page,
        "per_page": per_page,
        "offset": start - (first_chunk - 1) * KINOBD_CHUNK,
        "chunks": list(range(first_chunk, last_chunk + 1)),
    }


def kinobd_merge_chunks(plan: dict, chunk_bodies: list) -> dict:
    """Склеить куски в ответ того же вида, что вернул бы kinobd одной страницей."""
    rows = []
    for body in chunk_bodies:
        rows.extend(body.get("data") or [])
    per_page, page = plan["per_page"], plan["page"]
    merged = dict(chunk_bodies[0]) if chunk_bodies else {}
    merged["data"] = rows[plan["offset"]:plan["offset"] + per_page]
    merged["per_page"] = per_page
    merged["current_page"] = page
    start = (page - 1) * per_page
    merged["from"] = start + 1 if merged["data"] else None
    merged["to"] = start + len(merged["data"]) if merged["data"] else None
    total = merged.get("total")
    if isinstance(total, int):
        merged["last_page"] = max(1, -(-total // per_page))
    # Ссылки кусков указывают на страницы по 10 — отдавать их было бы враньём.
    for field in _PAGINATION_LINK_FIELDS:
        merged.pop(field, None)
    return merged


async def _fetch_upstream(session, method, target, headers, body_bytes, req_timeout):
    async with session.request(
        method, target, headers=headers, data=body_bytes, timeout=req_timeout
    ) as resp:
        return resp.status, resp.headers.get("Content-Type", "application/json"), await resp.read()


async def _fetch_kinobd_split(session, base, path, plan, headers, req_timeout):
    semaphore = asyncio.Semaphore(KINOBD_CHUNK_CONCURRENCY)

    async def one(chunk_page):
        params = {**plan["params"], "page": str(chunk_page), "per_page": str(KINOBD_CHUNK)}
        async with semaphore:
            return await _fetch_upstream(
                session, "GET", f"{base}/{path}?{urlencode(params)}", headers, None, req_timeout
            )

    results = await asyncio.gather(*(one(c) for c in plan["chunks"]))
    # Любой кусок не 200 — отдаём его как есть: брейкер должен увидеть 403/429.
    for status, ctype, content in results:
        if status != 200:
            return status, ctype, content
    bodies = [json.loads(content) for _, _, content in results]
    if not all(isinstance(body, dict) and isinstance(body.get("data"), list) for body in bodies):
        raise ValueError("kinobd returned an invalid page")
    merged = kinobd_merge_chunks(plan, bodies)
    return 200, "application/json", json.dumps(merged, ensure_ascii=False).encode("utf-8")


@app.api_route("/ext/{provider}/{path:path}", methods=["GET", "POST"])
async def ext_proxy(provider: str, path: str, request: Request):
    base = _proxy_base_for(provider)
    if not base:
        raise HTTPException(404, "Unknown provider")

    query = request.url.query
    # TMDB требует ключ в query. Подставляем server-side — фронт его не знает.
    if provider == "tmdb":
        if not TMDB_API_KEY:
            raise HTTPException(503, "TMDB_API_KEY не задан на сервере")
        query = f"{query}&api_key={TMDB_API_KEY}" if query else f"api_key={TMDB_API_KEY}"
    target = f"{base}/{path}"
    if query:
        target = f"{target}?{query}"

    method = request.method.upper()
    ttl = _cache_ttl_for(path) if method == "GET" else 0
    cache_key = f"{provider}:{method}:{path}?{query}"

    # 1. Отдаём из кеша, если свежий
    if ttl > 0:
        hit = _proxy_cache_get(cache_key)
        if hit and hit[0] > time.time():
            _, status, ctype, body = hit
            return Response(content=body, status_code=status, media_type=ctype)

    # 1.5 Circuit breaker: источник «выключен» после бана/недоступности — не ходим
    # к нему вовсе. Отдаём устаревший кеш если есть, иначе быстрый 503 → фронт
    # сам уйдёт на kinobd. Так rhserv не получает запросов и его бан остывает.
    if _is_tripped(provider):
        stale = _proxy_cache_get(cache_key, allow_stale=True)
        if stale:
            _, s_status, s_ctype, s_body = stale
            return Response(content=s_body, status_code=s_status, media_type=s_ctype)
        return Response(
            content=b'{"detail":"provider temporarily disabled"}',
            status_code=503,
            media_type="application/json",
        )

    # 2. Тянем с источника
    session = await _get_session_for(provider)
    headers = dict(_BROWSER_HEADERS)
    headers.update(PROXY_EXTRA_HEADERS.get(provider, {}))
    # Прокидываем кастомные заголовки плеера (kinobd /playerdata)
    for h in ("X-Re",):
        if h in request.headers:
            headers[h] = request.headers[h]

    # Origin/Referer браузер запрещает ставить из JS, поэтому фронт передаёт
    # нужный origin в X-Player-Origin, а настоящие заголовки ставим здесь.
    player_origin = request.headers.get("X-Player-Origin")
    if player_origin:
        headers["Origin"] = player_origin
        headers["Referer"] = f"{player_origin}/"
    body_bytes = await request.body() if method == "POST" else None
    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct

    # Источник может быть недоступен (kinobox часто) — короткий таймаут,
    # чтобы фронт быстро переключился на рабочий источник, а не висел.
    # connect снижен с 4с до 2с: живые источники подключаются за десятки
    # миллисекунд, а мёртвые всё равно не ответят. Эти секунды видны
    # пользователю каждый раз, когда брейкер сбрасывается и мы заново
    # проверяем мёртвый источник.
    req_timeout = aiohttp.ClientTimeout(total=6, connect=2)
    try:
        split_plan = kinobd_split_plan(provider, method, path, query)
        if split_plan:
            status, ctype, content = await _fetch_kinobd_split(
                session, base, path, split_plan, headers, req_timeout
            )
        else:
            status, ctype, content = await _fetch_upstream(
                session, method, target, headers, body_bytes, req_timeout
            )
    except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError, ValueError) as e:
        # Источник не ответил: таймаут, обрыв, моргнула сеть.
        # ВАЖНО: здесь источник НЕ выключаем. Отключать имеет смысл только
        # против бана — чтобы дать ему остыть. Сетевая заминка к бану
        # отношения не имеет, а выключение единственного живого источника
        # кладёт сайт целиком: kinobd отвечал 200, но брейкер держал его
        # выключенным, и страница фильма показывала «источники недоступны».
        # Следующий запрос просто попробует снова.
        print(f"[proxy] {provider}: сеть подвела ({type(e).__name__}), не выключаем")
        stale = _proxy_cache_get(cache_key, allow_stale=True)
        if stale:
            _, status, ctype, body = stale
            return Response(content=body, status_code=status, media_type=ctype)
        raise HTTPException(502, f"Upstream error: {e}")

    # Реакция брейкера на статус источника
    if status in (403, 429):
        # Бан/rate-limit — это уже явный отказ, а не случайность: считаем неудачу
        # сразу и выключаем, как только их наберётся достаточно.
        if _note_failure(provider):
            print(f"[proxy] {provider} выключен: источник отдаёт {status}")
    elif status == 200:
        # Источник снова жив — сбрасываем брейкер
        _reset_provider(provider)

    # 3. Кешируем только успешные ответы
    if ttl > 0 and status == 200:
        _proxy_cache_put(cache_key, (time.time() + ttl, status, ctype, content))
    # При ошибке — отдадим устаревший кеш, если он есть (чтобы пережить rate-limit)
    elif status != 200 and ttl > 0:
        stale = _proxy_cache_get(cache_key, allow_stale=True)
        if stale:
            _, s_status, s_ctype, s_body = stale
            return Response(content=s_body, status_code=s_status, media_type=s_ctype)

    return Response(content=content, status_code=status, media_type=ctype)


# ──────────────────────────────────────────────
#  Метка «4K» у плеера alloha
# ──────────────────────────────────────────────
# Из балансеров 4K честно есть только у alloha: 3840x2160 в плейлисте, и
# в данных её плеера у каждой озвучки флаг "uhd":1. Список плееров kinobd
# этого не сообщает, поэтому смотрим в страницу самого плеера. Браузер её
# не отдаст (другой домен), так что запрос идёт отсюда.
#
# Эндпоинт принимает чужой адрес, а значит мог бы стать дверью во внутреннюю
# сеть: через раздачу по Wi-Fi к бэкенду обращаются телефоны. Поэтому
# только https по имени хоста, без редиректов, адреса хоста проверяются,
# ответ читается ограниченно, а наружу уходит одно «да/нет».
_UHD_FLAG_RE = re.compile(r'"uhd"\s*:\s*1\b')
_UHD_CACHE: dict = {}
UHD_CACHE_TTL = 6 * 60 * 60
UHD_CACHE_MAX = 2000
UHD_MAX_BYTES = 2 * 1024 * 1024  # у длинных сериалов страница плеера за 1 МБ
# 198.18.0.0/15 формально «служебная» сеть, но её раздают прокси-клиенты в режиме
# fake-IP (так устроен роутер Axel): все внешние имена резолвятся туда.
_FAKE_IP_NET = ipaddress.ip_network("198.18.0.0/15")


def validate_player_url(url: str) -> str:
    """Бросает ValueError, если адрес не годится для проверки."""
    parsed = urlparse(url or "")
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Нужен https-адрес плеера")
    if parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Адрес с логином или нестандартным портом не принимаем")
    host = parsed.hostname.lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("Нужен адрес по имени хоста, а не IP")
    if "." not in host or host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
        raise ValueError("Внутренние имена не принимаем")
    return url


def address_is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if ip in _FAKE_IP_NET:
        return True
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified)


_UHD_ANY_RE = re.compile(r'"uhd"\s*:\s*\d+')
_EPISODE_RE = re.compile(r'"episode"\s*:')


def page_has_uhd(html: str) -> bool:
    """Честная ли метка «4K».

    У фильма флаг стоит у каждой озвучки: хоть одна в 4K — её можно выбрать.
    У сериала флаг у каждой пары «серия + озвучка», и 4K бывает у пары серий
    одной озвучки (Футурама: 2 из 939) — метка тогда обманывает. Для сериала
    требуем, чтобы в 4K была хотя бы половина вариантов.
    """
    html = html or ""
    uhd = len(_UHD_FLAG_RE.findall(html))
    if not uhd:
        return False
    if not _EPISODE_RE.search(html):
        return True
    return uhd * 2 >= len(_UHD_ANY_RE.findall(html))


@app.get("/player/alloha-uhd")
async def alloha_uhd(url: str):
    try:
        validate_player_url(url)
    except ValueError as error:
        raise HTTPException(400, str(error))

    now = time.time()
    hit = _UHD_CACHE.get(url)
    if hit and hit[0] > now:
        return {"uhd": hit[1]}

    host = urlparse(url).hostname
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise HTTPException(502, "Хост плеера не найден")
    if not infos or not all(address_is_public(info[4][0]) for info in infos):
        raise HTTPException(400, "Адрес ведёт во внутреннюю сеть")

    headers = dict(_BROWSER_HEADERS)
    headers["Accept"] = "text/html"
    # Без реферера плеер отвечает 404; какой именно — ему всё равно.
    headers["Referer"] = "https://kinobd.net/"
    session = await _get_http_session()
    try:
        async with session.get(url, headers=headers, allow_redirects=False,
                               timeout=aiohttp.ClientTimeout(total=8, connect=3)) as resp:
            if resp.status != 200:
                print(f"[uhd] плеер ответил {resp.status}")
                return {"uhd": False}
            # read(n) отдаёт то, что уже пришло, а не n байт — читаем по кускам
            chunks, size = [], 0
            async for chunk in resp.content.iter_chunked(64 * 1024):
                chunks.append(chunk)
                size += len(chunk)
                if size >= UHD_MAX_BYTES:
                    break
            body = b"".join(chunks)[:UHD_MAX_BYTES]
    except (aiohttp.ClientError, asyncio.TimeoutError) as error:
        # Метка — подсказка, а не условие работы плеера: не смогли узнать —
        # просто не рисуем её. В журнал пишем, чтобы это не было загадкой.
        print(f"[uhd] не удалось открыть страницу плеера: {type(error).__name__}")
        return {"uhd": False}

    uhd = page_has_uhd(body.decode("utf-8", "replace"))
    if len(_UHD_CACHE) >= UHD_CACHE_MAX:
        _UHD_CACHE.clear()
    _UHD_CACHE[url] = (now + UHD_CACHE_TTL, uhd)
    return {"uhd": uhd}


# ──────────────────────────────────────────────
#  Хелперы
# ──────────────────────────────────────────────
def db_get_user(tg_id: int) -> Optional[sqlite3.Row]:
    with db() as conn:
        return conn.execute(
            "SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()


def db_require_user(tg_id: int) -> sqlite3.Row:
    u = db_get_user(tg_id)
    if not u:
        raise HTTPException(404, "Пользователь не найден")
    return u


def get_user_public(tg_id: int) -> dict:
    with db() as conn:
        u = conn.execute(
            "SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
    if not u:
        raise HTTPException(404, "Пользователь не найден")
    return {
        "tg_id": tg_id,
        "name": u["name"],
        "username": u["username"],
        "photo_url": u["photo_url"],
    }


def auth_get_tg_id(authorization: Optional[str]) -> int:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Требуется авторизация")
    token = authorization.split(" ", 1)[1].strip()
    with db() as conn:
        row = conn.execute(
            "SELECT tg_id FROM tokens WHERE token=?", (token,)).fetchone()
    if not row:
        raise HTTPException(401, "Недействительный токен")
    return row["tg_id"]


# ──────────────────────────────────────────────
#  Модели
# ──────────────────────────────────────────────
class AuthInitResponse(BaseModel):
    code: str
    deep_link: str


class ConfirmRequest(BaseModel):
    code: str
    tg_id: int
    first_name: str
    last_name: str
    username: str
    photo_url: str


class PollResponse(BaseModel):
    ok: bool
    user: Optional[dict] = None
    token: Optional[str] = None


class CreateReportRequest(BaseModel):
    reporter_tg_id: int
    target_type: str
    target_id: str
    reason: str
    details: Optional[str] = ""


class ResolveReportRequest(BaseModel):
    report_id: int
    action: str


class CreateBroadcastRequest(BaseModel):
    text: str


class ListItemRequest(BaseModel):
    movie: dict


# ──────────────────────────────────────────────
#  AUTH
# ──────────────────────────────────────────────
def prune_auth_codes():
    now = datetime.utcnow()
    for mapping in (pending_codes, sessions):
        for code, entry in list(mapping.items()):
            if now - entry.get("created_at", now) > timedelta(minutes=5):
                mapping.pop(code, None)


async def remote_auth(path):
    if not AUTH_SERVER_URL:
        raise HTTPException(503, "Сервер входа не настроен. Укажите его адрес в настройках приложения.")
    session = await _get_http_session()
    try:
        async with session.get(
            f"{AUTH_SERVER_URL}{path}", timeout=aiohttp.ClientTimeout(total=12), allow_redirects=False
        ) as response:
            if response.status != 200:
                raise HTTPException(502, "Сервер входа временно недоступен")
            data = await response.json()
            if not isinstance(data, dict):
                raise ValueError("Expected object")
            return data
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
        raise HTTPException(502, "Нет связи с сервером входа. Попробуйте ещё раз.")


def create_user_session(user):
    tg_id = int(user["tg_id"])
    if tg_id <= 0:
        raise ValueError("Invalid Telegram ID")
    with db() as conn:
        conn.execute("""
            INSERT INTO users (tg_id, name, username, photo_url, logged_in_at)
            VALUES (?,?,?,?,?) ON CONFLICT(tg_id) DO UPDATE SET
            name=excluded.name, username=excluded.username,
            photo_url=excluded.photo_url, logged_in_at=excluded.logged_in_at
        """, (tg_id, user.get("name", ""), user.get("username", ""),
              user.get("photo_url", ""), datetime.utcnow().isoformat()))
        token = secrets.token_urlsafe(32)
        conn.execute("INSERT INTO tokens (token, tg_id) VALUES (?,?)", (token, tg_id))
    return {"user": get_user_public(tg_id), "token": token}


@app.get("/auth/status")
async def auth_status():
    return {"mode": AUTH_MODE, "configured": bool(AUTH_SERVER_URL) if AUTH_MODE == "client" else bool(ADMIN_KEY)}


@app.get("/auth/init", response_model=AuthInitResponse)
async def auth_init():
    prune_auth_codes()
    if len(pending_codes) >= 1000:
        raise HTTPException(429, "Слишком много запросов входа. Попробуйте позже.")
    if AUTH_MODE == "client":
        remote = await remote_auth("/auth/init")
        remote_code = str(remote.get("code", ""))
        link = str(remote.get("deep_link", ""))
        if not remote_code or len(remote_code) > 128 or not all(c.isalnum() or c in "_-" for c in remote_code):
            raise HTTPException(502, "Некорректный ответ сервера входа")
        if not link.startswith("https://t.me/"):
            raise HTTPException(502, "Некорректная ссылка входа")
        code = secrets.token_urlsafe(24)
        pending_codes[code] = {"created_at": datetime.utcnow(), "remote_code": remote_code}
        return {"code": code, "deep_link": link}
    if not ADMIN_KEY:
        raise HTTPException(503, "Сервис входа не настроен")
    code = secrets.token_urlsafe(12)
    pending_codes[code] = {"created_at": datetime.utcnow()}
    deep_link = f"https://t.me/{BOT_USERNAME}?start={code}"
    return {"code": code, "deep_link": deep_link}


@app.post("/auth/confirm")
async def auth_confirm(req: ConfirmRequest, x_admin_key: Optional[str] = Header(None)):
    if AUTH_MODE == "client" or not ADMIN_KEY or not secrets.compare_digest(x_admin_key or "", ADMIN_KEY):
        raise HTTPException(403, "Подтверждение разрешено только доверенному боту")
    if req.code not in pending_codes:
        raise HTTPException(400, "Код не найден или устарел")
    created = pending_codes[req.code]["created_at"]
    if datetime.utcnow() - created > timedelta(minutes=5):
        del pending_codes[req.code]
        raise HTTPException(400, "Код истёк (5 минут)")

    name = f"{req.first_name} {req.last_name}".strip()
    with db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM users WHERE tg_id=?", (req.tg_id,)).fetchone()
        if existing:
            conn.execute("""
                UPDATE users
                SET name=?, username=?, photo_url=?, logged_in_at=?
                WHERE tg_id=?
            """, (name, req.username, req.photo_url,
                  datetime.utcnow().isoformat(), req.tg_id))
        else:
            conn.execute("""
                INSERT INTO users (tg_id, name, username, photo_url, logged_in_at)
                VALUES (?,?,?,?,?)
            """, (req.tg_id, name, req.username, req.photo_url,
                  datetime.utcnow().isoformat()))

        persistent_token = secrets.token_urlsafe(32)
        conn.execute("INSERT INTO tokens (token, tg_id) VALUES (?,?)",
                     (persistent_token, req.tg_id))

    sessions[req.code] = {
        "user": get_user_public(req.tg_id),
        "token": persistent_token,
        "created_at": datetime.utcnow(),
    }
    del pending_codes[req.code]
    return {"ok": True}


@app.get("/auth/poll/{code}", response_model=PollResponse)
async def auth_poll(code: str):
    prune_auth_codes()
    if AUTH_MODE == "client":
        entry = pending_codes.get(code)
        if not entry:
            raise HTTPException(410, "Код истёк или уже использован. Начните вход заново.")
        # Не допускаем два одновременных опроса одного одноразового кода.
        if entry.get("polling"):
            return {"ok": False}
        entry["polling"] = True
        try:
            result = await remote_auth(f"/auth/poll/{entry['remote_code']}")
            if not result.get("ok"):
                return {"ok": False}
            try:
                payload = create_user_session(result["user"])
            except (ValueError, TypeError, KeyError):
                raise HTTPException(502, "Сервер входа вернул некорректный профиль")
            pending_codes.pop(code, None)
            remote_token = result.get("token")
            # Ключ сервера нужен для синхронизации библиотеки. Старый сервер
            # без синхронизации его тоже отдаёт — вреда нет, /sync ответит 404.
            if isinstance(remote_token, str) and 20 <= len(remote_token) <= 128:
                with db() as conn:
                    sync.reset_for_new_account(conn, payload["user"]["tg_id"], remote_token)
                schedule_sync(payload["user"]["tg_id"], delay=0)
            return {"ok": True, **payload}
        finally:
            entry["polling"] = False
    if code in sessions:
        payload = sessions.pop(code)
        return {"ok": True, "user": payload["user"], "token": payload["token"]}
    return {"ok": False}


# ──────────────────────────────────────────────
#  USER
# ──────────────────────────────────────────────
@app.get("/user/{tg_id}")
async def get_user(tg_id: int):
    db_require_user(tg_id)
    return get_user_public(tg_id)


# ──────────────────────────────────────────────
#  ADMIN
# ──────────────────────────────────────────────
@app.get("/admin/users")
async def admin_list_users(x_admin_key: Optional[str] = Header(None)):
    if not ADMIN_KEY or not secrets.compare_digest(x_admin_key or "", ADMIN_KEY):
        raise HTTPException(403, "Нет доступа")
    with db() as conn:
        rows = conn.execute("SELECT tg_id FROM users").fetchall()
    return {"users": [get_user_public(r["tg_id"]) for r in rows]}


# ──────────────────────────────────────────────
#  REPORTS
# ──────────────────────────────────────────────
@app.post("/reports/create")
async def create_report(req: CreateReportRequest):
    u = db_require_user(req.reporter_tg_id)
    with db() as conn:
        conn.execute("""
            INSERT INTO reports
            (reporter_tg_id, reporter_name, target_type, target_id,
             reason, details, created_at)
            VALUES (?,?,?,?,?,?,?)
        """, (req.reporter_tg_id, u["name"], req.target_type, req.target_id,
              req.reason, req.details or "", datetime.utcnow().isoformat()))
        report_id = conn.execute(
            "SELECT last_insert_rowid()").fetchone()[0]
    return {"ok": True, "report_id": report_id}


@app.get("/reports/list")
async def list_reports(resolved: bool = False,
                       x_admin_key: Optional[str] = Header(None)):
    if not ADMIN_KEY or not secrets.compare_digest(x_admin_key or "", ADMIN_KEY):
        raise HTTPException(403, "Нет доступа")
    with db() as conn:
        rows = conn.execute("""
            SELECT * FROM reports WHERE resolved=?
            ORDER BY created_at DESC
        """, (1 if resolved else 0,)).fetchall()
    return {"reports": [dict(r) for r in rows]}


@app.post("/reports/resolve")
async def resolve_report(req: ResolveReportRequest,
                         x_admin_key: Optional[str] = Header(None)):
    if not ADMIN_KEY or not secrets.compare_digest(x_admin_key or "", ADMIN_KEY):
        raise HTTPException(403, "Нет доступа")
    with db() as conn:
        updated = conn.execute("""
            UPDATE reports
            SET resolved=1, resolved_at=?, resolution_action=?
            WHERE id=?
        """, (datetime.utcnow().isoformat(),
              req.action, req.report_id)).rowcount
    if not updated:
        raise HTTPException(404, "Жалоба не найдена")
    return {"ok": True}


# ──────────────────────────────────────────────
#  BROADCASTS
# ──────────────────────────────────────────────
@app.post("/broadcasts/create")
async def create_broadcast(req: CreateBroadcastRequest,
                           x_admin_key: Optional[str] = Header(None)):
    if not ADMIN_KEY or not secrets.compare_digest(x_admin_key or "", ADMIN_KEY):
        raise HTTPException(403, "Нет доступа")
    if not req.text.strip():
        raise HTTPException(400, "Текст не может быть пустым")
    with db() as conn:
        conn.execute("""
            INSERT INTO broadcasts (text, author_tg_id, author_name, created_at)
            VALUES (?,?,?,?)
        """, (req.text.strip(), 0, "", datetime.utcnow().isoformat()))
        broadcast_id = conn.execute(
            "SELECT last_insert_rowid()").fetchone()[0]
        conn.execute("""
            DELETE FROM broadcasts WHERE id NOT IN (
                SELECT id FROM broadcasts ORDER BY id DESC LIMIT 100
            )
        """)
    return {"ok": True, "broadcast_id": broadcast_id}


@app.get("/broadcasts/list")
async def list_broadcasts(since: Optional[str] = None, limit: int = 20):
    limit = max(1, min(limit, 100))
    with db() as conn:
        if since:
            rows = conn.execute("""
                SELECT * FROM broadcasts
                WHERE created_at > ? ORDER BY created_at DESC LIMIT ?
            """, (since, limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT ?
            """, (limit,)).fetchall()
    return {"broadcasts": [dict(r) for r in rows]}


@app.delete("/broadcasts/{broadcast_id}")
async def delete_broadcast(broadcast_id: int,
                           x_admin_key: Optional[str] = Header(None)):
    if not ADMIN_KEY or not secrets.compare_digest(x_admin_key or "", ADMIN_KEY):
        raise HTTPException(403, "Нет доступа")
    with db() as conn:
        conn.execute("DELETE FROM broadcasts WHERE id=?", (broadcast_id,))
    return {"ok": True}


# ──────────────────────────────────────────────
#  USER LISTS — избранное и история
# ──────────────────────────────────────────────
ALLOWED_LIST_TYPES = sync.LIST_KINDS
_ITEM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def check_list_type(list_type: str) -> None:
    if list_type not in ALLOWED_LIST_TYPES:
        raise HTTPException(400, f"Неизвестный тип: {list_type}")


def check_item_id(item_id: str) -> None:
    if not _ITEM_ID_RE.match(item_id):
        raise HTTPException(400, "Некорректный идентификатор")


@app.get("/list/{list_type}")
async def list_get_all(list_type: str,
                       authorization: Optional[str] = Header(None)):
    check_list_type(list_type)
    tg_id = auth_get_tg_id(authorization)
    with db() as conn:
        rows = conn.execute("""
            SELECT kp_id, movie_json FROM user_lists
            WHERE tg_id=? AND list_type=? AND deleted=0
            ORDER BY added_at DESC
        """, (tg_id, list_type)).fetchall()
    items = []
    damaged = 0
    for r in rows:
        try:
            item = json.loads(r["movie_json"])
            if not isinstance(item, dict):
                raise ValueError("movie_json is not an object")
            items.append(item)
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            damaged += 1
            print(f"[library] повреждена запись {list_type}/{r['kp_id']}: {error}")
            # Не скрываем фильм целиком: пользователь хотя бы увидит запись и
            # сможет удалить/добавить её заново.
            items.append({"kp_id": r["kp_id"], "title": "Повреждённая запись"})
    return {"items": items, "damaged": damaged}


@app.put("/list/{list_type}/{item_id}")
async def list_put(list_type: str, item_id: str, req: ListItemRequest,
                   authorization: Optional[str] = Header(None)):
    check_list_type(list_type)
    check_item_id(item_id)
    tg_id = auth_get_tg_id(authorization)
    try:
        with db() as conn:
            sync.local_put(conn, tg_id, list_type, item_id, req.movie)
            sync.enforce_limits(conn, tg_id, server=False)
            size = conn.execute("""
                SELECT COUNT(*) FROM user_lists WHERE tg_id=? AND list_type=? AND deleted=0
            """, (tg_id, list_type)).fetchone()[0]
    except sync.SyncError as error:
        raise HTTPException(400, str(error))
    schedule_sync(tg_id)
    return {"ok": True, "size": size}


@app.delete("/list/{list_type}/{item_id}")
async def list_delete_one(list_type: str, item_id: str,
                          authorization: Optional[str] = Header(None)):
    check_list_type(list_type)
    check_item_id(item_id)
    tg_id = auth_get_tg_id(authorization)
    with db() as conn:
        removed = sync.mark_deleted(conn, tg_id, list_type, item_id, server=False)
    schedule_sync(tg_id)
    return {"ok": True, "removed": removed}


@app.delete("/list/{list_type}")
async def list_delete_all(list_type: str,
                          authorization: Optional[str] = Header(None)):
    check_list_type(list_type)
    tg_id = auth_get_tg_id(authorization)
    with db() as conn:
        keys = [row[0] for row in conn.execute(
            "SELECT kp_id FROM user_lists WHERE tg_id=? AND list_type=? AND deleted=0",
            (tg_id, list_type))]
        cleared = sum(sync.mark_deleted(conn, tg_id, list_type, key, server=False) for key in keys)
    schedule_sync(tg_id)
    return {"ok": True, "cleared": cleared}


# ──────────────────────────────────────────────
#  ПРОГРЕСС ПРОСМОТРА — серия и таймкод
# ──────────────────────────────────────────────
class ProgressRequest(BaseModel):
    payload: dict


@app.get("/progress/{item_id}")
async def progress_get(item_id: str, authorization: Optional[str] = Header(None)):
    check_item_id(item_id)
    tg_id = auth_get_tg_id(authorization)
    with db() as conn:
        row = conn.execute(
            "SELECT payload, updated_at FROM watch_progress WHERE tg_id=? AND kp_id=? AND deleted=0",
            (tg_id, item_id)).fetchone()
    if not row:
        return {"payload": None}
    return {"payload": json.loads(row["payload"] or "{}"), "updated_at": row["updated_at"]}


@app.put("/progress/{item_id}")
async def progress_put(item_id: str, req: ProgressRequest, authorization: Optional[str] = Header(None)):
    check_item_id(item_id)
    tg_id = auth_get_tg_id(authorization)
    try:
        with db() as conn:
            sync.local_put(conn, tg_id, "progress", item_id, req.payload)
            sync.enforce_limits(conn, tg_id, server=False)
    except sync.SyncError as error:
        raise HTTPException(400, str(error))
    schedule_sync(tg_id)
    return {"ok": True}


# ──────────────────────────────────────────────
#  СИНХРОНИЗАЦИЯ
# ──────────────────────────────────────────────
# Сервер (authority): POST /sync — принять изменения устройства и отдать чужие.
# Приложение (client): фоновая отправка на сервер входа, POST /sync/now и
# GET /sync/status для интерфейса.
class SyncRequest(BaseModel):
    cursor: int = 0
    items: list = []


_sync_rate: dict = {}
SYNC_RATE_LIMIT = 120  # обменов в минуту на пользователя; приложению хватает с запасом


@app.post("/sync")
async def sync_exchange(req: SyncRequest, authorization: Optional[str] = Header(None)):
    if AUTH_MODE == "client":
        raise HTTPException(404, "Not Found")
    tg_id = auth_get_tg_id(authorization)
    minute = int(time.time() // 60)
    bucket = _sync_rate.get(tg_id)
    if not bucket or bucket[0] != minute:
        bucket = [minute, 0]
        _sync_rate[tg_id] = bucket
    bucket[1] += 1
    if bucket[1] > SYNC_RATE_LIMIT:
        raise HTTPException(429, "Слишком частая синхронизация")
    try:
        with db() as conn:
            return sync.server_exchange(conn, tg_id, req.cursor, req.items)
    except sync.SyncError as error:
        raise HTTPException(400, str(error))


_sync_locks: dict = {}
_sync_timers: dict = {}
SYNC_INTERVAL_S = 60
SYNC_DEBOUNCE_S = 3
SYNC_MAX_ROUNDS = 20
SYNC_AUTH_LOST = "Сервер не принял ключ синхронизации — войдите заново"


class SyncAuthLost(Exception):
    pass


async def _remote_sync_call(remote_token: str, body: dict) -> dict:
    session = await _get_http_session()
    async with session.post(
        f"{AUTH_SERVER_URL}/sync", json=body,
        headers={"Authorization": f"Bearer {remote_token}"},
        timeout=aiohttp.ClientTimeout(total=30), allow_redirects=False,
    ) as response:
        if response.status == 401:
            raise SyncAuthLost()
        if response.status == 404:
            raise RuntimeError("Сервер входа не поддерживает синхронизацию — обновите его")
        if response.status != 200:
            raise RuntimeError(f"Сервер синхронизации ответил {response.status}")
        data = await response.json()
        if (not isinstance(data, dict) or not isinstance(data.get("items"), list)
                or not isinstance(data.get("cursor"), int) or data["cursor"] < 0):
            raise RuntimeError("Некорректный ответ сервера синхронизации")
        return data


async def sync_user(tg_id: int) -> dict:
    """Отправить своё и забрать чужое. Безопасно вызывать сколько угодно раз."""
    if AUTH_MODE != "client" or not AUTH_SERVER_URL:
        return sync_status(tg_id)
    lock = _sync_locks.setdefault(tg_id, asyncio.Lock())
    async with lock:
        with db() as conn:
            account = conn.execute("SELECT * FROM sync_accounts WHERE tg_id=?", (tg_id,)).fetchone()
        if not account:
            return sync_status(tg_id)
        token, cursor = account["remote_token"], account["cursor"]
        error = None
        try:
            for _ in range(SYNC_MAX_ROUNDS):
                with db() as conn:
                    outgoing = sync.dirty_items(conn, tg_id)
                data = await _remote_sync_call(token, {"cursor": cursor, "items": outgoing})
                # Сервер может вернуть больше записей, чем клиент отправляет за один
                # обмен. Проверяем весь ответ до сохранения cursor: обрезка здесь
                # навсегда пропускала хвост страницы синхронизации.
                incoming = sync.validate_items(
                    data["items"], max_items=sync.MAX_CHANGES_PER_RESPONSE)
                with db() as conn:
                    sync.clear_dirty(conn, tg_id, outgoing)
                    sync.apply_items(conn, tg_id, incoming, server=False)
                    cursor = max(cursor, data["cursor"])
                    conn.execute("UPDATE sync_accounts SET cursor=? WHERE tg_id=?", (cursor, tg_id))
                more = bool(data.get("more"))
                if not more and len(outgoing) < sync.MAX_ITEMS_PER_REQUEST:
                    break
        except SyncAuthLost:
            error = SYNC_AUTH_LOST
        except sync.SyncError as exc:
            error = f"Сервер прислал некорректные данные: {exc}"
        except (aiohttp.ClientError, asyncio.TimeoutError):
            error = "Нет связи с сервером синхронизации"
        except RuntimeError as exc:
            error = str(exc)
        with db() as conn:
            if error:
                conn.execute("UPDATE sync_accounts SET last_error=? WHERE tg_id=?", (error, tg_id))
            else:
                conn.execute("UPDATE sync_accounts SET last_error=NULL, last_sync_at=? WHERE tg_id=?",
                             (sync.now_ms(), tg_id))
        if error:
            print(f"[sync] {tg_id}: {error}")
        return sync_status(tg_id)


def sync_status(tg_id: int) -> dict:
    with db() as conn:
        account = conn.execute("SELECT last_sync_at, last_error FROM sync_accounts WHERE tg_id=?",
                               (tg_id,)).fetchone()
        pending = conn.execute(
            "SELECT (SELECT COUNT(*) FROM user_lists WHERE tg_id=? AND dirty=1)"
            " + (SELECT COUNT(*) FROM watch_progress WHERE tg_id=? AND dirty=1)",
            (tg_id, tg_id)).fetchone()[0]
    return {
        "enabled": bool(account) and AUTH_MODE == "client" and bool(AUTH_SERVER_URL),
        "last_sync_at": account["last_sync_at"] if account else None,
        "error": account["last_error"] if account else None,
        "pending": pending,
    }


def schedule_sync(tg_id: int, delay: float = SYNC_DEBOUNCE_S) -> None:
    """Несколько изменений подряд — одна отправка через пару секунд."""
    if AUTH_MODE != "client" or not AUTH_SERVER_URL:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    timer = _sync_timers.pop(tg_id, None)
    if timer:
        timer.cancel()

    def run():
        _sync_timers.pop(tg_id, None)
        loop.create_task(sync_user(tg_id))

    _sync_timers[tg_id] = loop.call_later(delay, run)


async def _sync_forever():
    while True:
        await asyncio.sleep(SYNC_INTERVAL_S)
        try:
            with db() as conn:
                users = [row[0] for row in conn.execute(
                    "SELECT tg_id FROM sync_accounts WHERE last_error IS NULL OR last_error != ?",
                    (SYNC_AUTH_LOST,))]
            for tg_id in users:
                await sync_user(tg_id)
        except Exception as exc:  # фоновая задача не должна умереть молча навсегда
            print(f"[sync] фоновая синхронизация: {exc}")


@app.on_event("startup")
async def start_background_sync():
    if AUTH_MODE == "client" and AUTH_SERVER_URL:
        asyncio.get_running_loop().create_task(_sync_forever())


@app.post("/sync/now")
async def sync_now(authorization: Optional[str] = Header(None)):
    return await sync_user(auth_get_tg_id(authorization))


@app.get("/sync/status")
async def sync_status_endpoint(authorization: Optional[str] = Header(None)):
    return sync_status(auth_get_tg_id(authorization))


@app.post("/import/library")
async def import_library(request: Request, authorization: Optional[str] = Header(None)):
    tg_id = auth_get_tg_id(authorization)
    body = await request.body()
    if len(body) > 5 * 1024 * 1024:
        raise HTTPException(413, "Файл импорта слишком большой")
    try:
        data = json.loads(body)
        with db() as conn:
            stats = sync.import_library(conn, tg_id, data)
    except (ValueError, sync.SyncError) as error:
        raise HTTPException(400, str(error))
    schedule_sync(tg_id, delay=0)
    return {"ok": True, **stats}
