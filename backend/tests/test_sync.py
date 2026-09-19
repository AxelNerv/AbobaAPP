"""Синхронизация библиотеки: слияние в SQLite и обмен сервер ↔ два устройства."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

import aiohttp

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import sync  # noqa: E402

SCHEMA = """
CREATE TABLE users (tg_id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
CREATE TABLE user_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id INTEGER NOT NULL,
    list_type TEXT NOT NULL,
    kp_id TEXT NOT NULL,
    movie_json TEXT NOT NULL DEFAULT '{}',
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tg_id, list_type, kp_id)
);
"""


def memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    sync.migrate(conn)
    return conn


BASE = sync.now_ms() - 60 * 60 * 1000


def item(kind, key, updated_at, payload=None, deleted=False, added_at="2026-09-14 10:00:00"):
    # Время задаём смещением от «час назад»: слишком старые надгробия сервер вычищает.
    if isinstance(updated_at, int) and not isinstance(updated_at, bool) and updated_at > 0:
        updated_at = BASE + updated_at
    return {"kind": kind, "key": key, "updated_at": updated_at, "payload": payload or {"kp_id": key},
            "deleted": deleted, "added_at": added_at}


class MergeTests(unittest.TestCase):
    def test_newer_wins_older_is_ignored(self):
        conn = memory_db()
        sync.server_exchange(conn, 1, 0, [item("history", "10", 2000, {"title": "new"})])
        sync.server_exchange(conn, 1, 0, [item("history", "10", 1000, {"title": "old"})])
        row = conn.execute("SELECT movie_json FROM user_lists WHERE kp_id='10'").fetchone()
        self.assertEqual(json.loads(row[0])["title"], "new")

    def test_tombstone_beats_older_copy_from_other_device(self):
        conn = memory_db()
        sync.server_exchange(conn, 1, 0, [item("favorites", "7", 1000)])
        sync.server_exchange(conn, 1, 0, [item("favorites", "7", 3000, deleted=True)])
        # Второе устройство ещё не знало об удалении и шлёт старую копию.
        sync.server_exchange(conn, 1, 0, [item("favorites", "7", 2000)])
        row = conn.execute("SELECT deleted FROM user_lists WHERE kp_id='7'").fetchone()
        self.assertEqual(row[0], 1)

    def test_cursor_returns_only_new_changes_without_echo(self):
        conn = memory_db()
        first = sync.server_exchange(conn, 1, 0, [item("history", "1", 1000), item("progress", "1", 1000)])
        self.assertEqual(first["items"], [])  # только что прислано — обратно не шлём
        other = sync.server_exchange(conn, 1, 0, [])
        self.assertEqual({(i["kind"], i["key"]) for i in other["items"]}, {("history", "1"), ("progress", "1")})
        later = sync.server_exchange(conn, 1, other["cursor"], [])
        self.assertEqual(later["items"], [])

    def test_users_do_not_see_each_other(self):
        conn = memory_db()
        sync.server_exchange(conn, 1, 0, [item("history", "1", 1000)])
        self.assertEqual(sync.server_exchange(conn, 2, 0, [])["items"], [])

    def test_paging(self):
        conn = memory_db()
        for start in range(0, 1200, 500):
            batch = [item("progress", str(n), 1000 + n) for n in range(start, min(start + 500, 1200))]
            sync.server_exchange(conn, 1, 0, batch)
        page = sync.server_exchange(conn, 1, 0, [])
        self.assertEqual(len(page["items"]), sync.MAX_CHANGES_PER_RESPONSE)
        self.assertTrue(page["more"])
        rest = sync.server_exchange(conn, 1, page["cursor"], [])
        self.assertEqual(len(rest["items"]), 200)
        self.assertFalse(rest["more"])

    def test_future_clock_is_clamped(self):
        conn = memory_db()
        far = 365 * 24 * 3600 * 1000 * 2
        sync.server_exchange(conn, 1, 0, [item("history", "1", far)])
        stored = conn.execute("SELECT updated_at FROM user_lists").fetchone()[0]
        self.assertLessEqual(stored, sync.now_ms() + sync.MAX_CLOCK_SKEW_MS)

    def test_validation(self):
        conn = memory_db()
        bad = [
            [{"kind": "notes", "key": "1", "updated_at": 1}],
            [item("history", "../etc", 1000)],
            [item("history", "1", 0)],
            [item("history", "1", True)],
            [{**item("history", "1", 1000), "payload": "text"}],
            [item("progress", "1", 1000, {"blob": "x" * (sync.MAX_PAYLOAD_BYTES + 1)})],
            [item("history", str(n), 1000) for n in range(sync.MAX_ITEMS_PER_REQUEST + 1)],
        ]
        for items in bad:
            with self.assertRaises(sync.SyncError):
                sync.server_exchange(conn, 1, 0, items)
        with self.assertRaises(sync.SyncError):
            sync.server_exchange(conn, 1, -1, [])

    def test_migration_marks_old_rows_for_upload(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        conn.execute("INSERT INTO user_lists (tg_id, list_type, kp_id, added_at) VALUES (1,'history','5','2026-05-10 13:58:25')")
        sync.migrate(conn)
        sync.migrate(conn)
        row = conn.execute("SELECT updated_at, dirty, deleted FROM user_lists").fetchone()
        self.assertEqual(row["dirty"], 1)
        self.assertEqual(row["deleted"], 0)
        self.assertEqual(row["updated_at"], 1778421505000)

    def test_local_change_survives_pull_of_older_server_copy(self):
        conn = memory_db()
        sync.local_put(conn, 1, "history", "3", {"title": "local"})
        local_at = conn.execute("SELECT updated_at FROM user_lists").fetchone()[0]
        older = sync.validate_items([{**item("history", "3", 1, {"title": "server"}), "updated_at": local_at - 10}])
        sync.apply_items(conn, 1, older, server=False)
        row = conn.execute("SELECT movie_json, dirty FROM user_lists").fetchone()
        self.assertEqual(json.loads(row[0])["title"], "local")
        self.assertEqual(row[1], 1)

    def test_clear_dirty_keeps_rows_changed_during_request(self):
        conn = memory_db()
        sync.local_put(conn, 1, "history", "3", {"v": 1})
        outgoing = sync.dirty_items(conn, 1)
        time.sleep(0.002)
        sync.local_put(conn, 1, "history", "3", {"v": 2})
        sync.clear_dirty(conn, 1, outgoing)
        self.assertEqual(conn.execute("SELECT dirty FROM user_lists").fetchone()[0], 1)

    def test_list_cap_leaves_tombstones(self):
        conn = memory_db()
        batch = [item("history", str(n), 1000 + n, added_at=f"2026-01-01 00:{n // 60:02d}:{n % 60:02d}")
                 for n in range(sync.MAX_LIST_SIZE + 5)]
        sync.server_exchange(conn, 1, 0, batch[:250])
        sync.server_exchange(conn, 1, 0, batch[250:])
        live = conn.execute("SELECT COUNT(*) FROM user_lists WHERE deleted=0").fetchone()[0]
        self.assertEqual(live, sync.MAX_LIST_SIZE)
        oldest = conn.execute("SELECT deleted FROM user_lists WHERE kp_id='0'").fetchone()[0]
        self.assertEqual(oldest, 1)


class ImportTests(unittest.TestCase):
    def test_import_adds_missing_and_keeps_existing(self):
        conn = memory_db()
        sync.local_put(conn, 1, "history", "10", {"kp_id": "10", "title": "в приложении"})
        sync.local_put(conn, 1, "favorites", "20", {"kp_id": "20"})
        sync.mark_deleted(conn, 1, "favorites", "20", server=False)
        old = {"season": 1, "episode": 1, "savedAt": 100}
        new = {"season": 1, "episode": 5, "savedAt": 200}
        sync.local_put(conn, 1, "progress", "10", {"v": 1, "players": {"obrut.show": {"entries": {"a": "1"}, "summary": new}}})
        data = {
            "format": "abobatv-import",
            "lists": {
                "history": [{"kp_id": "10", "title": "из браузера"}, {"kp_id": "11"}, {"kp_id": "12"}, {"kp_id": "../x"}],
                "favorites": [{"kp_id": "20"}],
            },
            "progress": {
                "10": {"players": {"obrut.show": {"entries": {"a": "0"}, "summary": old},
                                   "kodikplayer.com": {"entries": {"b": "1"}, "summary": old}}},
                "11": {"players": {"obrut.show": {"entries": {"c": "1"}, "summary": new}}},
            },
        }
        stats = sync.import_library(conn, 1, data)
        self.assertEqual(stats, {"history": 2, "favorites": 0, "progress": 2})
        title = json.loads(conn.execute("SELECT movie_json FROM user_lists WHERE kp_id='10'").fetchone()[0])["title"]
        self.assertEqual(title, "в приложении")
        order = [r[0] for r in conn.execute(
            "SELECT kp_id FROM user_lists WHERE list_type='history' AND deleted=0 ORDER BY added_at DESC")]
        self.assertEqual(order, ["10", "11", "12"])
        self.assertEqual(conn.execute("SELECT deleted FROM user_lists WHERE kp_id='20'").fetchone()[0], 1)
        players = json.loads(conn.execute("SELECT payload FROM watch_progress WHERE kp_id='10'").fetchone()[0])["players"]
        self.assertEqual(players["obrut.show"]["summary"]["episode"], 5)
        self.assertIn("kodikplayer.com", players)
        with self.assertRaises(sync.SyncError):
            sync.import_library(conn, 1, {"format": "other"})


class TwoDevicesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aboba sync test ")
        self.processes = []
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
        self.authority = await self.start_server("authority")
        self.laptop = await self.start_server("client", self.authority)
        self.desktop = await self.start_server("client", self.authority)

    async def start_server(self, mode, remote=""):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        profile = Path(self.temp.name) / f"{mode}-{port}"
        env = dict(os.environ, AUTH_MODE=mode, AUTH_SERVER_URL=remote,
                   ADMIN_KEY="test-only-server-key", STATE_FILE=str(profile / "state.json"))
        process = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(port)],
                                   cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(process)
        url = f"http://127.0.0.1:{port}"
        for _ in range(200):
            if process.poll() is not None:
                self.fail("Test server failed to start")
            try:
                async with self.http.get(url + "/ext-health") as response:
                    if response.status == 200:
                        return url
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(.05)
        self.fail("Test server readiness timeout")

    async def asyncTearDown(self):
        await self.http.close()
        for process in self.processes:
            process.terminate()
            process.wait(timeout=5)
        self.temp.cleanup()

    async def request(self, method, url, **kwargs):
        async with self.http.request(method, url, **kwargs) as response:
            return response.status, await response.json()

    async def login(self, client, tg_id=777):
        status, init = await self.request("GET", client + "/auth/init")
        self.assertEqual(status, 200)
        remote_code = init["deep_link"].split("start=", 1)[1]
        confirm = {"code": remote_code, "tg_id": tg_id, "first_name": "Axel", "last_name": "", "username": "", "photo_url": ""}
        status, _ = await self.request("POST", self.authority + "/auth/confirm", json=confirm,
                                       headers={"X-Admin-Key": "test-only-server-key"})
        self.assertEqual(status, 200)
        status, result = await self.request("GET", client + "/auth/poll/" + init["code"])
        self.assertEqual(status, 200)
        return {"Authorization": "Bearer " + result["token"]}

    async def items(self, client, headers, list_type):
        status, data = await self.request("GET", f"{client}/list/{list_type}", headers=headers)
        self.assertEqual(status, 200)
        return [entry["kp_id"] for entry in data["items"]]

    async def sync_now(self, client, headers):
        status, state = await self.request("POST", client + "/sync/now", headers=headers)
        self.assertEqual(status, 200)
        self.assertIsNone(state["error"])
        self.assertTrue(state["enabled"])
        return state

    async def test_library_and_progress_follow_the_account(self):
        laptop = await self.login(self.laptop)
        await self.request("PUT", self.laptop + "/list/history/508161", headers=laptop,
                           json={"movie": {"kp_id": "508161", "title": "Ходячие мертвецы"}})
        await self.request("PUT", self.laptop + "/list/favorites/839458", headers=laptop,
                           json={"movie": {"kp_id": "839458", "title": "Одни из нас"}})
        progress = {"summary": {"season": 1, "episode": 5, "time": 1632}}
        status, _ = await self.request("PUT", self.laptop + "/progress/508161", headers=laptop, json={"payload": progress})
        self.assertEqual(status, 200)
        state = await self.sync_now(self.laptop, laptop)
        self.assertEqual(state["pending"], 0)

        # Второй компьютер: просто вошёл — всё на месте.
        desktop = await self.login(self.desktop)
        await self.sync_now(self.desktop, desktop)
        self.assertEqual(await self.items(self.desktop, desktop, "history"), ["508161"])
        self.assertEqual(await self.items(self.desktop, desktop, "favorites"), ["839458"])
        status, saved = await self.request("GET", self.desktop + "/progress/508161", headers=desktop)
        self.assertEqual(saved["payload"], progress)

        # Удаление на одном компьютере не возвращается с другого.
        await self.request("DELETE", self.desktop + "/list/favorites/839458", headers=desktop)
        await self.sync_now(self.desktop, desktop)
        await self.sync_now(self.laptop, laptop)
        self.assertEqual(await self.items(self.laptop, laptop, "favorites"), [])

    async def test_client_applies_complete_server_page_before_advancing_cursor(self):
        laptop = await self.login(self.laptop)
        desktop = await self.login(self.desktop)
        imported_progress = {
            str(index): {
                "players": {
                    "test.player": {
                        "entries": {"position": str(index)},
                        "summary": {"time": index, "savedAt": BASE + index},
                    }
                }
            }
            for index in range(600)
        }
        status, result = await self.request(
            "POST", self.laptop + "/import/library", headers=laptop,
            json={"format": "abobatv-import", "lists": {}, "progress": imported_progress},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["progress"], 600)
        await self.sync_now(self.laptop, laptop)
        await self.sync_now(self.desktop, desktop)

        # Запись из хвоста ответа раньше отбрасывалась, а cursor уже продвигался.
        status, latest = await self.request("GET", self.desktop + "/progress/599", headers=desktop)
        self.assertEqual(status, 200)
        self.assertEqual(latest["payload"]["summary"]["time"], 599)

    async def test_offline_changes_are_merged_on_login(self):
        # До первого входа с синхронизацией на компьютере уже была история.
        desktop = await self.login(self.desktop)
        await self.request("PUT", self.desktop + "/list/history/1", headers=desktop, json={"movie": {"kp_id": "1"}})
        await self.sync_now(self.desktop, desktop)
        laptop = await self.login(self.laptop)
        await self.request("PUT", self.laptop + "/list/history/2", headers=laptop, json={"movie": {"kp_id": "2"}})
        await self.sync_now(self.laptop, laptop)
        await self.sync_now(self.desktop, desktop)
        self.assertEqual(sorted(await self.items(self.desktop, desktop, "history")), ["1", "2"])
        self.assertEqual(sorted(await self.items(self.laptop, laptop, "history")), ["1", "2"])

    async def test_sync_endpoint_guards(self):
        status, _ = await self.request("POST", self.authority + "/sync", json={"cursor": 0, "items": []})
        self.assertEqual(status, 401)
        status, _ = await self.request("POST", self.authority + "/sync", json={"cursor": 0, "items": []},
                                       headers={"Authorization": "Bearer wrong"})
        self.assertEqual(status, 401)
        laptop = await self.login(self.laptop)
        # У приложения нет общего /sync: чужие устройства туда не ходят.
        status, _ = await self.request("POST", self.laptop + "/sync", json={"cursor": 0, "items": []}, headers=laptop)
        self.assertEqual(status, 404)
        status, _ = await self.request("PUT", self.laptop + "/list/history/..%2Fx", headers=laptop, json={"movie": {}})
        self.assertIn(status, (400, 404))


if __name__ == "__main__":
    unittest.main()
