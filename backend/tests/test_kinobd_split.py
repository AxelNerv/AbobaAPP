"""Сборка большой страницы топа kinobd из маленьких. Без сети: поддельный kinobd."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

import aiohttp
from aiohttp import web

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
# База остаётся открытой до выхода — Windows не даст удалить её раньше.
_profile = tempfile.TemporaryDirectory(prefix="aboba split test ", ignore_cleanup_errors=True)
os.environ["STATE_FILE"] = str(Path(_profile.name) / "state.json")
import server  # noqa: E402

TOTAL = 137  # не кратно ни 10, ни 50 — ловим ошибки на хвосте


def fake_page(page, per_page):
    start = (page - 1) * per_page
    rows = [{"id": i} for i in range(start, min(start + per_page, TOTAL))]
    return {"data": rows, "current_page": page, "per_page": per_page, "total": TOTAL,
            "next_page_url": f"https://kinobd.net/api/films/top?page={page + 1}", "links": []}


class PlanTests(unittest.TestCase):
    def plan(self, query, provider="kinobd", method="GET", path="api/films/top"):
        return server.kinobd_split_plan(provider, method, path, query)

    def test_leaves_other_requests_alone(self):
        self.assertIsNone(self.plan("page=1&per_page=50", provider="rhserv"))
        self.assertIsNone(self.plan("page=1&per_page=50", method="POST"))
        self.assertIsNone(self.plan("page=1&per_page=50", path="api/films/updates"))
        self.assertIsNone(self.plan("page=1"))  # размер по умолчанию не угадываем
        self.assertIsNone(self.plan("page=1&per_page=10"))
        self.assertIsNone(self.plan("page=x&per_page=50"))

    def test_chunks_cover_requested_range(self):
        self.assertEqual(self.plan("page=1&per_page=50")["chunks"], [1, 2, 3, 4, 5])
        self.assertEqual(self.plan("page=2&per_page=50")["chunks"], [6, 7, 8, 9, 10])
        odd = self.plan("page=2&per_page=15")  # фильмы 15..29
        self.assertEqual((odd["chunks"], odd["offset"]), ([2, 3], 5))


class MergeTests(unittest.TestCase):
    def check(self, page, per_page):
        plan = server.kinobd_split_plan("kinobd", "GET", "api/films/top", f"page={page}&per_page={per_page}")
        chunks = [fake_page(c, server.KINOBD_CHUNK) for c in plan["chunks"]]
        merged = server.kinobd_merge_chunks(plan, chunks)
        self.assertEqual(merged["data"], fake_page(page, per_page)["data"])
        self.assertEqual((merged["per_page"], merged["current_page"]), (per_page, page))
        self.assertNotIn("next_page_url", merged)  # ссылки кусков не отдаём
        return merged

    def test_same_rows_as_one_big_page(self):
        for page, per_page in [(1, 50), (2, 50), (3, 50), (1, 100), (2, 15), (7, 20)]:
            with self.subTest(page=page, per_page=per_page):
                self.check(page, per_page)

    def test_tail_and_last_page(self):
        merged = self.check(3, 50)
        self.assertEqual(len(merged["data"]), TOTAL - 100)
        self.assertEqual(merged["last_page"], 3)


class ProxyCacheTests(unittest.TestCase):
    def setUp(self):
        self.max_entries = server.PROXY_CACHE_MAX_ENTRIES
        self.max_bytes = server.PROXY_CACHE_MAX_BYTES
        server.PROXY_CACHE_MAX_ENTRIES = 3
        server.PROXY_CACHE_MAX_BYTES = 10
        server._proxy_cache.clear()
        server._proxy_cache_bytes = 0

    def tearDown(self):
        server._proxy_cache.clear()
        server._proxy_cache_bytes = 0
        server.PROXY_CACHE_MAX_ENTRIES = self.max_entries
        server.PROXY_CACHE_MAX_BYTES = self.max_bytes

    def test_evicts_oldest_entries_by_count_and_size(self):
        future = server.time.time() + 60
        for index in range(4):
            server._proxy_cache_put(str(index), (future, 200, "application/json", b"xx"))
        self.assertEqual(list(server._proxy_cache), ["1", "2", "3"])

        server._proxy_cache_put("large", (future, 200, "application/json", b"123456"))
        self.assertLessEqual(server._proxy_cache_bytes, server.PROXY_CACHE_MAX_BYTES)
        self.assertNotIn("1", server._proxy_cache)

    def test_drops_stale_entry_after_grace_period(self):
        expired = server.time.time() - server.PROXY_CACHE_STALE_TTL - 1
        server._proxy_cache_put("old", (expired, 200, "application/json", b"{}"))
        self.assertIsNone(server._proxy_cache_get("old", allow_stale=True))
        self.assertEqual(server._proxy_cache_bytes, 0)

    def test_expired_entry_remains_available_as_short_term_fallback(self):
        server._proxy_cache_put(
            "stale", (server.time.time() - 1, 200, "application/json", b"{}"))
        self.assertIsNone(server._proxy_cache_get("stale"))
        self.assertIsNotNone(server._proxy_cache_get("stale", allow_stale=True))


class ProxyRouteTests(unittest.TestCase):
    def test_tvmaze_uses_authority_server_in_client_mode(self):
        mode, remote = server.AUTH_MODE, server.AUTH_SERVER_URL
        try:
            server.AUTH_MODE = "client"
            server.AUTH_SERVER_URL = "https://auth.example.com/"
            self.assertEqual(
                server._proxy_base_for("tvmaze"),
                "https://auth.example.com/ext/tvmaze",
            )
            self.assertEqual(server._proxy_base_for("kinobd"), server.PROXY_TARGETS["kinobd"])
        finally:
            server.AUTH_MODE, server.AUTH_SERVER_URL = mode, remote


class StoredLibraryTests(unittest.IsolatedAsyncioTestCase):
    async def test_corrupt_movie_json_is_visible_instead_of_disappearing(self):
        tg_id = 991122
        token = "test-corrupt-library-token"
        with server.db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO users (tg_id, name) VALUES (?, ?)",
                (tg_id, "Test"),
            )
            conn.execute("INSERT OR REPLACE INTO tokens (token, tg_id) VALUES (?, ?)", (token, tg_id))
            conn.execute("""
                INSERT INTO user_lists
                    (tg_id, list_type, kp_id, movie_json, added_at, updated_at, deleted, dirty, seq)
                VALUES (?, 'favorites', 'broken', '{bad json', datetime('now'), 1, 0, 0, 0)
                ON CONFLICT(tg_id, list_type, kp_id) DO UPDATE SET movie_json=excluded.movie_json
            """, (tg_id,))

        result = await server.list_get_all("favorites", f"Bearer {token}")

        self.assertEqual(result["damaged"], 1)
        self.assertEqual(result["items"], [{"kp_id": "broken", "title": "Повреждённая запись"}])


class UpstreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.seen = []

        async def top(request):
            page, per_page = int(request.query["page"]), int(request.query["per_page"])
            self.seen.append(per_page)
            if request.query.get("q") == "ban":
                return web.json_response({"detail": "banned"}, status=429)
            return web.json_response(fake_page(page, per_page))

        app = web.Application()
        app.router.add_get("/api/films/top", top)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        self.session = aiohttp.ClientSession()

    async def asyncTearDown(self):
        await self.session.close()
        await self.runner.cleanup()

    async def fetch(self, query):
        plan = server.kinobd_split_plan("kinobd", "GET", "api/films/top", query)
        return await server._fetch_kinobd_split(
            self.session, self.base, "api/films/top", plan, {}, aiohttp.ClientTimeout(total=5))

    async def test_upstream_only_sees_small_pages(self):
        status, _, content = await self.fetch("page=2&per_page=50")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(content)["data"], fake_page(2, 50)["data"])
        self.assertTrue(self.seen and all(size == server.KINOBD_CHUNK for size in self.seen))

    async def test_ban_status_reaches_breaker(self):
        status, _, _ = await self.fetch("page=1&per_page=50&q=ban")
        self.assertEqual(status, 429)

    async def test_invalid_upstream_shape_is_not_treated_as_a_valid_empty_page(self):
        original = server._fetch_upstream

        async def invalid(*_args, **_kwargs):
            return 200, "application/json", b'[]'

        server._fetch_upstream = invalid
        try:
            with self.assertRaisesRegex(ValueError, "invalid page"):
                await self.fetch("page=1&per_page=50")
        finally:
            server._fetch_upstream = original


if __name__ == "__main__":
    unittest.main()
