"""Синхронизация истории, избранного и прогресса просмотра между устройствами.

Одна и та же схема живёт в двух местах. На сервере входа (authority) — общая
копия библиотеки каждого пользователя. В приложении (client) — локальная база,
которая работает и без сети, а изменения досылает, когда сервер доступен.

Правило слияния — «побеждает более свежая запись»: у каждой записи есть
updated_at в миллисекундах. Удаление тоже запись (deleted=1, «надгробие»),
иначе удалённое на одном компьютере вернулось бы с другого.

Сервер нумерует каждое принятое изменение (seq) внутри пользователя. Клиент
хранит номер последнего увиденного изменения (cursor) и забирает только новые.
Модуль не знает про HTTP и FastAPI: только SQLite, чтобы его можно было
проверять напрямую.
"""
import json
import re
import sqlite3
import time

LIST_KINDS = {"history", "favorites"}
KINDS = LIST_KINDS | {"progress"}

MAX_ITEMS_PER_REQUEST = 500
MAX_CHANGES_PER_RESPONSE = 1000
MAX_PAYLOAD_BYTES = 32 * 1024
MAX_LIST_SIZE = 500
MAX_PROGRESS_ITEMS = 3000
# Надгробия нужны, пока другие устройства могут не знать об удалении.
TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000
# Часы на компьютерах врут. Запись «из будущего» навсегда перебивала бы
# настоящие изменения, поэтому время дальше суток вперёд обрезаем.
MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class SyncError(ValueError):
    """Некорректные данные синхронизации — ответ 400, а не падение."""


def now_ms() -> int:
    return int(time.time() * 1000)


def _columns(conn, table):
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def migrate(conn: sqlite3.Connection) -> None:
    """Добавляет поля синхронизации в существующую базу. Повторный вызов безопасен."""
    columns = _columns(conn, "user_lists")
    added = False
    for name in ("updated_at", "deleted", "dirty", "seq"):
        if name not in columns:
            conn.execute(f"ALTER TABLE user_lists ADD COLUMN {name} INTEGER NOT NULL DEFAULT 0")
            added = True
    if added or "updated_at" not in columns:
        # Старые записи получают время из added_at и помечаются к отправке:
        # при первой синхронизации они уйдут на сервер.
        conn.execute("""
            UPDATE user_lists
            SET updated_at = COALESCE(CAST(strftime('%s', added_at) AS INTEGER), 0) * 1000,
                dirty = 1
            WHERE updated_at = 0
        """)
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_user_lists_seq ON user_lists(tg_id, seq);
        CREATE INDEX IF NOT EXISTS idx_user_lists_dirty ON user_lists(tg_id, dirty);

        CREATE TABLE IF NOT EXISTS watch_progress (
            tg_id      INTEGER NOT NULL,
            kp_id      TEXT    NOT NULL,
            payload    TEXT    NOT NULL DEFAULT '{}',
            updated_at INTEGER NOT NULL DEFAULT 0,
            deleted    INTEGER NOT NULL DEFAULT 0,
            dirty      INTEGER NOT NULL DEFAULT 0,
            seq        INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (tg_id, kp_id)
        );
        CREATE INDEX IF NOT EXISTS idx_watch_progress_seq ON watch_progress(tg_id, seq);
        CREATE INDEX IF NOT EXISTS idx_watch_progress_dirty ON watch_progress(tg_id, dirty);

        -- Сервер: счётчик изменений пользователя.
        CREATE TABLE IF NOT EXISTS sync_counters (
            tg_id INTEGER PRIMARY KEY,
            seq   INTEGER NOT NULL DEFAULT 0
        );

        -- Приложение: ключ сервера и докуда уже забрали изменения.
        CREATE TABLE IF NOT EXISTS sync_accounts (
            tg_id        INTEGER PRIMARY KEY,
            remote_token TEXT    NOT NULL,
            cursor       INTEGER NOT NULL DEFAULT 0,
            last_sync_at INTEGER,
            last_error   TEXT
        );
    """)


# ──────────────────────────────────────────────
#  Проверка входящих записей
# ──────────────────────────────────────────────
def validate_item(raw, now=None) -> dict:
    if not isinstance(raw, dict):
        raise SyncError("Запись должна быть объектом")
    kind = raw.get("kind")
    key = raw.get("key")
    if kind not in KINDS:
        raise SyncError("Неизвестный тип записи")
    if not isinstance(key, str) or not _KEY_RE.match(key):
        raise SyncError("Некорректный ключ записи")
    updated_at = raw.get("updated_at")
    if not isinstance(updated_at, int) or isinstance(updated_at, bool) or updated_at <= 0:
        raise SyncError("Некорректное время изменения")
    limit = (now if now is not None else now_ms()) + MAX_CLOCK_SKEW_MS
    updated_at = min(updated_at, limit)
    deleted = bool(raw.get("deleted"))
    payload = raw.get("payload") or {}
    if not isinstance(payload, dict):
        raise SyncError("Содержимое записи должно быть объектом")
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(payload_json.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise SyncError("Запись слишком большая")
    added_at = raw.get("added_at")
    if kind in LIST_KINDS:
        if not isinstance(added_at, str) or not re.match(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}", added_at) or len(added_at) > 40:
            added_at = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(updated_at / 1000))
    else:
        added_at = None
    return {"kind": kind, "key": key, "payload": payload_json, "deleted": deleted,
            "updated_at": updated_at, "added_at": added_at}


def validate_items(raw_items, max_items: int = MAX_ITEMS_PER_REQUEST) -> list:
    if not isinstance(raw_items, list):
        raise SyncError("Ожидался список записей")
    if len(raw_items) > max_items:
        raise SyncError("Слишком много записей за раз")
    now = now_ms()
    return [validate_item(item, now) for item in raw_items]


# ──────────────────────────────────────────────
#  Хранение
# ──────────────────────────────────────────────
def _next_seq(conn, tg_id) -> int:
    conn.execute("INSERT OR IGNORE INTO sync_counters (tg_id, seq) VALUES (?, 0)", (tg_id,))
    conn.execute("UPDATE sync_counters SET seq = seq + 1 WHERE tg_id=?", (tg_id,))
    return conn.execute("SELECT seq FROM sync_counters WHERE tg_id=?", (tg_id,)).fetchone()[0]


def _existing_updated_at(conn, tg_id, item):
    if item["kind"] == "progress":
        row = conn.execute("SELECT updated_at FROM watch_progress WHERE tg_id=? AND kp_id=?",
                           (tg_id, item["key"])).fetchone()
    else:
        row = conn.execute("SELECT updated_at FROM user_lists WHERE tg_id=? AND list_type=? AND kp_id=?",
                           (tg_id, item["kind"], item["key"])).fetchone()
    return None if row is None else row[0]


def _write(conn, tg_id, item, seq, dirty):
    deleted = 1 if item["deleted"] else 0
    if item["kind"] == "progress":
        conn.execute("""
            INSERT INTO watch_progress (tg_id, kp_id, payload, updated_at, deleted, dirty, seq)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(tg_id, kp_id) DO UPDATE SET
                payload=excluded.payload, updated_at=excluded.updated_at,
                deleted=excluded.deleted, dirty=excluded.dirty, seq=excluded.seq
        """, (tg_id, item["key"], item["payload"], item["updated_at"], deleted, dirty, seq))
    else:
        conn.execute("""
            INSERT INTO user_lists (tg_id, list_type, kp_id, movie_json, added_at, updated_at, deleted, dirty, seq)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(tg_id, list_type, kp_id) DO UPDATE SET
                movie_json=excluded.movie_json, added_at=excluded.added_at,
                updated_at=excluded.updated_at, deleted=excluded.deleted,
                dirty=excluded.dirty, seq=excluded.seq
        """, (tg_id, item["kind"], item["key"], item["payload"], item["added_at"],
              item["updated_at"], deleted, dirty, seq))


def apply_items(conn, tg_id, items, *, server: bool) -> list:
    """Принимает записи, если они свежее имеющихся. Возвращает принятые.

    server=True — мы сервер: каждой принятой записи выдаём номер изменения.
    server=False — мы приложение и применяем пришедшее с сервера: запись уже
    на сервере, отправлять её обратно не нужно (dirty=0).
    """
    accepted = []
    for item in items:
        current = _existing_updated_at(conn, tg_id, item)
        if current is not None and current >= item["updated_at"]:
            continue
        seq = _next_seq(conn, tg_id) if server else 0
        _write(conn, tg_id, item, seq, dirty=0)
        accepted.append(item)
    if server and accepted:
        enforce_limits(conn, tg_id)
    return accepted


def enforce_limits(conn, tg_id, *, server: bool = True) -> None:
    """Держит списки в пределах и выбрасывает старые надгробия."""
    now = now_ms()
    for kind, cap in (("history", MAX_LIST_SIZE), ("favorites", MAX_LIST_SIZE)):
        extra = conn.execute("""
            SELECT kp_id FROM user_lists
            WHERE tg_id=? AND list_type=? AND deleted=0
            ORDER BY added_at DESC LIMIT -1 OFFSET ?
        """, (tg_id, kind, cap)).fetchall()
        for (kp_id,) in extra:
            mark_deleted(conn, tg_id, kind, kp_id, server=server, at=now)
    extra = conn.execute("""
        SELECT kp_id FROM watch_progress WHERE tg_id=? AND deleted=0
        ORDER BY updated_at DESC LIMIT -1 OFFSET ?
    """, (tg_id, MAX_PROGRESS_ITEMS)).fetchall()
    for (kp_id,) in extra:
        mark_deleted(conn, tg_id, "progress", kp_id, server=server, at=now)
    cutoff = now - TOMBSTONE_TTL_MS
    conn.execute("DELETE FROM user_lists WHERE tg_id=? AND deleted=1 AND dirty=0 AND updated_at<?", (tg_id, cutoff))
    conn.execute("DELETE FROM watch_progress WHERE tg_id=? AND deleted=1 AND dirty=0 AND updated_at<?", (tg_id, cutoff))


def mark_deleted(conn, tg_id, kind, key, *, server: bool, at=None) -> int:
    """Удаление как запись: на сервере получает номер, в приложении ждёт отправки."""
    at = at or now_ms()
    seq = _next_seq(conn, tg_id) if server else 0
    dirty = 0 if server else 1
    if kind == "progress":
        return conn.execute("""
            UPDATE watch_progress SET deleted=1, updated_at=MAX(updated_at + 1, ?), dirty=?, seq=?
            WHERE tg_id=? AND kp_id=? AND deleted=0
        """, (at, dirty, seq, tg_id, key)).rowcount
    return conn.execute("""
        UPDATE user_lists SET deleted=1, updated_at=MAX(updated_at + 1, ?), dirty=?, seq=?
        WHERE tg_id=? AND list_type=? AND kp_id=? AND deleted=0
    """, (at, dirty, seq, tg_id, kind, key)).rowcount


def local_put(conn, tg_id, kind, key, payload: dict, *, added_at=None) -> None:
    """Изменение, сделанное в самом приложении: помечаем к отправке."""
    item = validate_item({"kind": kind, "key": key, "payload": payload, "updated_at": now_ms(),
                          "added_at": added_at or time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())})
    current = _existing_updated_at(conn, tg_id, item)
    if current is not None and current >= item["updated_at"]:
        # Запись с сервера пришла с часами чуть впереди — всё равно новее она.
        item["updated_at"] = current + 1
    _write(conn, tg_id, item, seq=0, dirty=1)


# ──────────────────────────────────────────────
#  Обмен
# ──────────────────────────────────────────────
def _row_to_item(kind, row) -> dict:
    item = {"kind": kind, "key": row["kp_id"], "payload": json.loads(row["payload"] or "{}"),
            "deleted": bool(row["deleted"]), "updated_at": row["updated_at"]}
    if kind != "progress":
        item["added_at"] = row["added_at"]
    return item


def changes_since(conn, tg_id, cursor: int, limit: int = MAX_CHANGES_PER_RESPONSE):
    """Изменения с номером больше cursor. Возвращает (записи, новый cursor, есть ли ещё)."""
    rows = conn.execute("""
        SELECT kind, kp_id, payload, deleted, updated_at, added_at, seq FROM (
            SELECT list_type AS kind, kp_id, movie_json AS payload, deleted, updated_at, added_at, seq
            FROM user_lists WHERE tg_id=? AND seq>?
            UNION ALL
            SELECT 'progress' AS kind, kp_id, payload, deleted, updated_at, NULL AS added_at, seq
            FROM watch_progress WHERE tg_id=? AND seq>?
        ) ORDER BY seq LIMIT ?
    """, (tg_id, cursor, tg_id, cursor, limit + 1)).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    items = [_row_to_item(row["kind"], row) for row in rows]
    new_cursor = rows[-1]["seq"] if rows else cursor
    return items, new_cursor, more


def dirty_items(conn, tg_id, limit: int = MAX_ITEMS_PER_REQUEST) -> list:
    lists = conn.execute("""
        SELECT list_type AS kind, kp_id, movie_json AS payload, deleted, updated_at, added_at
        FROM user_lists WHERE tg_id=? AND dirty=1 ORDER BY updated_at LIMIT ?
    """, (tg_id, limit)).fetchall()
    items = [_row_to_item(row["kind"], row) for row in lists]
    if len(items) < limit:
        progress = conn.execute("""
            SELECT kp_id, payload, deleted, updated_at FROM watch_progress
            WHERE tg_id=? AND dirty=1 ORDER BY updated_at LIMIT ?
        """, (tg_id, limit - len(items))).fetchall()
        items += [_row_to_item("progress", row) for row in progress]
    return items


def clear_dirty(conn, tg_id, items) -> None:
    """Снимаем пометку только с того, что не менялось, пока шёл запрос."""
    for item in items:
        if item["kind"] == "progress":
            conn.execute("UPDATE watch_progress SET dirty=0 WHERE tg_id=? AND kp_id=? AND updated_at=?",
                         (tg_id, item["key"], item["updated_at"]))
        else:
            conn.execute("UPDATE user_lists SET dirty=0 WHERE tg_id=? AND list_type=? AND kp_id=? AND updated_at=?",
                         (tg_id, item["kind"], item["key"], item["updated_at"]))


def server_exchange(conn, tg_id, cursor, raw_items) -> dict:
    """Один обмен на сервере: принять присланное, отдать новое с cursor."""
    if not isinstance(cursor, int) or isinstance(cursor, bool) or cursor < 0:
        raise SyncError("Некорректный cursor")
    items = validate_items(raw_items)
    accepted = apply_items(conn, tg_id, items, server=True)
    changes, new_cursor, more = changes_since(conn, tg_id, cursor)
    # Только что присланное клиент уже знает — не гоняем обратно.
    echoed = {(i["kind"], i["key"], i["updated_at"]) for i in accepted}
    changes = [c for c in changes if (c["kind"], c["key"], c["updated_at"]) not in echoed]
    return {"cursor": new_cursor, "items": changes, "more": more}


def reset_for_new_account(conn, tg_id, remote_token) -> None:
    """Новый ключ сервера: забираем всё с нуля и отправляем всё своё на слияние."""
    row = conn.execute("SELECT remote_token FROM sync_accounts WHERE tg_id=?", (tg_id,)).fetchone()
    if row and row["remote_token"] == remote_token:
        return
    conn.execute("""
        INSERT INTO sync_accounts (tg_id, remote_token, cursor, last_sync_at, last_error)
        VALUES (?,?,0,NULL,NULL)
        ON CONFLICT(tg_id) DO UPDATE SET remote_token=excluded.remote_token, cursor=0, last_error=NULL
    """, (tg_id, remote_token))
    conn.execute("UPDATE user_lists SET dirty=1 WHERE tg_id=?", (tg_id,))
    conn.execute("UPDATE watch_progress SET dirty=1 WHERE tg_id=?", (tg_id,))


# ──────────────────────────────────────────────
#  Импорт библиотеки из файла (браузер, старые копии)
# ──────────────────────────────────────────────
MAX_IMPORT_ROWS = 2000


def _summary_saved_at(player: dict) -> int:
    summary = player.get("summary") if isinstance(player, dict) else None
    value = summary.get("savedAt") if isinstance(summary, dict) else 0
    return value if isinstance(value, int) else 0


def import_library(conn, tg_id, data) -> dict:
    """Добавляет недостающее и ничего не затирает.

    Списки: фильм, который уже есть в приложении (или был удалён), не трогаем —
    удалённое не должно воскреснуть из старого файла. Новые встают в конец
    истории, сохраняя порядок файла.
    Позиции: по каждому плееру остаётся более свежая.
    """
    if not isinstance(data, dict) or data.get("format") != "abobatv-import":
        raise SyncError("Это не файл импорта AbobaTV")
    stats = {"history": 0, "favorites": 0, "progress": 0}
    lists = data.get("lists") if isinstance(data.get("lists"), dict) else {}
    for kind in ("history", "favorites"):
        rows = lists.get(kind) if isinstance(lists.get(kind), list) else []
        rows = rows[:MAX_IMPORT_ROWS]
        oldest = conn.execute("SELECT MIN(added_at) FROM user_lists WHERE tg_id=? AND list_type=?",
                              (tg_id, kind)).fetchone()[0]
        base = time.mktime(time.strptime(oldest[:19], "%Y-%m-%d %H:%M:%S")) if oldest else time.time()
        position = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            key = str(row.get("kp_id") or "")
            if not _KEY_RE.match(key):
                continue
            exists = conn.execute("SELECT 1 FROM user_lists WHERE tg_id=? AND list_type=? AND kp_id=?",
                                  (tg_id, kind, key)).fetchone()
            if exists:
                continue
            position += 1
            added_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(base - position))
            local_put(conn, tg_id, kind, key, row, added_at=added_at)
            stats[kind] += 1
    progress = data.get("progress") if isinstance(data.get("progress"), dict) else {}
    for key, payload in list(progress.items())[:MAX_IMPORT_ROWS]:
        if not _KEY_RE.match(str(key)) or not isinstance(payload, dict) or not isinstance(payload.get("players"), dict):
            continue
        row = conn.execute("SELECT payload FROM watch_progress WHERE tg_id=? AND kp_id=? AND deleted=0",
                           (tg_id, key)).fetchone()
        current = json.loads(row["payload"]) if row else {"v": 1, "players": {}}
        players = dict(current.get("players") or {})
        changed = False
        for family, player in payload["players"].items():
            if not isinstance(player, dict) or not isinstance(player.get("entries"), dict):
                continue
            if family not in players or _summary_saved_at(player) > _summary_saved_at(players[family]):
                players[family] = player
                changed = True
        if not changed:
            continue
        freshest = max(players.values(), key=_summary_saved_at)
        local_put(conn, tg_id, "progress", str(key),
                  {"v": 1, "players": players, "summary": freshest.get("summary"), "updated_player": None})
        stats["progress"] += 1
    enforce_limits(conn, tg_id, server=False)
    return stats
