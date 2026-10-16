"""Public-source integration against a local HTTP server, no user data."""
import asyncio
import json
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import aiohttp
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from movie_sources import MovieSources, PlayerSourcePool, SourceUnavailable, allowed_embed, page_metadata


class MetadataTests(unittest.TestCase):
    def test_serial_title_without_episode_suffix(self):
        self.assertEqual(page_metadata('<title>Кухня (6 сезон) - 101 серия</title>'),
                         {"title": "Кухня", "year": "", "type": "TV_SERIES"})

    def test_movie_with_null_episode_is_not_a_series(self):
        encoded = json.dumps({"title": "Интерстеллар (2014)"})
        page = f'<title>Player</title>"mediaMetadata":{encoded},"episode":null'
        self.assertEqual(page_metadata(page), {"title": "Интерстеллар", "year": "2014", "type": "FILM"})

    def test_generic_player_title_is_not_a_movie_name(self):
        self.assertEqual(page_metadata('<title>Video Player</title>'), {})

    def test_fixed_embed_destinations(self):
        self.assertTrue(allowed_embed("https://api.nextembed.ws/embed/movie/14"))
        self.assertTrue(allowed_embed("https://kurolesya.link/balancer-api/iframe"))
        for url in ("https://127.0.0.1/", "http://api.nextembed.ws/", "https://api.nextembed.ws.evil.com/",
                    "https://x@api.nextembed.ws/", "https://api.nextembed.ws:8000/", None, {}, 123):
            self.assertFalse(allowed_embed(url), url)

    def test_source_cannot_be_an_arbitrary_url(self):
        with self.assertRaises(ValueError):
            MovieSources("https://127.0.0.1/admin")


class LookupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.api_status = 200
        self.broken_status = 403
        self.redirect_target = "/working"
        self.api_data = {"data": [
            {"type": "Collaps", "iframeUrl": "https://api.nextembed.ws/working",
             "translations": [{"name": "Русский", "iframeUrl": "https://api.nextembed.ws/working"},
                              {"name": "bad", "iframeUrl": "http://127.0.0.1/admin"}]},
            {"type": "Veoveo", "iframeUrl": "https://gorodyshka.link/broken"},
            {"type": "unknown", "iframeUrl": "http://127.0.0.1/admin"},
        ]}
        app = web.Application()

        async def handle(request):
            self.calls.append(request.path)
            if request.path == "/api/players":
                await asyncio.sleep(.03)
                return web.json_response(self.api_data, status=self.api_status)
            if request.path == "/working":
                return web.Response(text='<title>Кухня (6 сезон) - 101 серия</title>', content_type="text/html")
            if request.path == "/redirect":
                return web.Response(status=307, headers={"Location": self.redirect_target})
            return web.Response(status=self.broken_status)

        app.router.add_get("/{path:.*}", handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.base = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"
        self.http = aiohttp.ClientSession()
        self.service = MovieSources()

        class RoutedSession:
            def get(inner_self, url, **kwargs):
                from urllib.parse import urlparse
                return self.http.get(self.base + urlparse(url).path, **kwargs)

        self.session = RoutedSession()

    async def asyncTearDown(self):
        await self.http.close()
        await self.runner.cleanup()

    async def get(self):
        return await self.service.get("687595", self.session, {})

    async def test_only_reachable_embeds_are_returned(self):
        result = await self.get()
        self.assertEqual(result["title"], "Кухня")
        self.assertEqual([p["type"] for p in result["providers"]], ["Collaps"])
        self.assertEqual(len(result["providers"][0]["translations"]), 1)
        self.assertNotIn("/admin", self.calls)

    async def test_metadata_and_player_requests_share_lookup_and_cache(self):
        one, two = await asyncio.gather(self.get(), self.get())
        self.assertEqual(one, two)
        await self.get()
        self.assertEqual(self.calls.count("/api/players"), 1)
        self.assertEqual(self.calls.count("/working"), 1)

    async def test_failed_lookup_is_not_cached_as_empty(self):
        self.api_data = {"error": {"title": "failed"}}
        with self.assertRaises(SourceUnavailable):
            await self.get()
        self.api_data = {"data": []}
        self.assertEqual((await self.get())["providers"], [])
        self.assertEqual(self.calls.count("/api/players"), 2)

    async def test_all_embeds_down_is_not_an_empty_catalogue_result(self):
        self.broken_status = 404
        self.api_data = {"data": [{"type": "Turbo", "iframeUrl": "https://x.obrut.show/broken"}]}
        with self.assertRaises(SourceUnavailable):
            await self.get()

    async def test_turbo_probe_403_does_not_remove_browser_working_player(self):
        self.api_data = {"data": [{"type": "Turbo", "iframeUrl": "https://x.obrut.show/broken"}]}
        result = await self.get()
        self.assertEqual(result["providers"][0]["type"], "Turbo")
        self.assertTrue(result["providers"][0]["browserOnly"])

    async def test_probe_exception_is_not_used_for_other_hosts(self):
        self.api_data = {"data": [{"type": "Turbo", "iframeUrl": "https://api.nextembed.ws/broken"}]}
        with self.assertRaises(SourceUnavailable):
            await self.get()

    async def test_cancelling_one_consumer_does_not_cancel_other(self):
        one = asyncio.create_task(self.get())
        two = asyncio.create_task(self.get())
        await asyncio.sleep(.01)
        one.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await one
        self.assertEqual((await two)["title"], "Кухня")
        self.assertEqual(self.calls.count("/api/players"), 1)

    async def test_invalid_id_never_contacts_source(self):
        with self.assertRaises(ValueError):
            await self.service.get("../admin", self.session, {})
        self.assertEqual(self.calls, [])

    async def test_new_source_only_returns_verified_provider(self):
        self.service = MovieSources("reyhoho")
        self.api_data = {"data": [
            {"type": "Veoveo", "iframeUrl": "https://kurolesya.link/working", "translations": []},
            {"type": "Turbo", "iframeUrl": "https://x.obrut.show/working"},
            {"type": "Videoseed", "iframeUrl": "https://unverified.example/working"},
        ]}
        result = await self.get()
        self.assertEqual(result["source"], "reyhoho")
        self.assertEqual([p["type"] for p in result["providers"]], ["Veoveo"])
        self.assertEqual(self.calls.count("/working"), 1)

    async def test_new_source_first_visit_follows_only_same_host_redirect(self):
        self.service = MovieSources("reyhoho")
        self.api_data = {"data": [{"type": "Veoveo", "iframeUrl": "https://kurolesya.link/redirect"}]}
        self.assertEqual((await self.get())["providers"][0]["type"], "Veoveo")
        self.assertEqual(self.calls[-2:], ["/redirect", "/working"])

    async def test_redirect_cannot_escape_to_another_host_or_loop_forever(self):
        self.service = MovieSources("reyhoho")
        self.api_data = {"data": [{"type": "Veoveo", "iframeUrl": "https://kurolesya.link/redirect"}]}
        for target in ("http://127.0.0.1/admin", "https://api.nextembed.ws/working", "/redirect"):
            self.redirect_target = target
            with self.assertRaises(SourceUnavailable):
                await self.get()
        self.assertNotIn("/admin", self.calls)
        self.assertNotIn("/working", self.calls)
        self.assertLessEqual(self.calls.count("/redirect"), 5)


class PoolTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.pool = PlayerSourcePool()
        self.primary = {"kp_id": "10453010", "source": "fbp", "title": "Железное лёгкое", "providers": [
            {"type": "Turbo", "iframeUrl": "https://x.obrut.show/embed/film"}]}
        self.reserve = {"kp_id": "10453010", "source": "reyhoho", "providers": [
            {"type": "Veoveo", "iframeUrl": "https://kurolesya.link/balancer-api/iframe"}]}
        self.pool.primary = SimpleNamespace(source="fbp", get=AsyncMock(return_value=self.primary))
        self.pool.reserve = SimpleNamespace(source="reyhoho", get=AsyncMock(return_value=self.reserve))

    async def get(self):
        return await self.pool.get("10453010", None, {})

    async def test_primary_turbo_and_extra_player_are_available_together(self):
        result = await self.get()
        self.assertEqual([p["type"] for p in result["providers"]], ["Turbo", "Veoveo"])
        self.assertEqual(result["origins"], ["fbp", "reyhoho"])
        self.assertEqual(result["source"], "fbp")

    async def test_duplicate_urls_are_not_extra_sources(self):
        self.reserve["providers"].append(self.primary["providers"][0])
        self.assertEqual(len((await self.get())["providers"]), 2)

    async def test_primary_can_fail_while_reserve_is_usable(self):
        self.pool.primary.get.side_effect = SourceUnavailable("HTTP 502")
        result = await self.get()
        self.assertEqual(result["providers"][0]["type"], "Veoveo")
        self.assertEqual(result["source"], "fbp")

    async def test_failed_reserve_does_not_hide_primary(self):
        self.pool.reserve.get.side_effect = SourceUnavailable("HTTP 503")
        result = await self.get()
        self.assertEqual(result["providers"], self.primary["providers"])

    async def test_hung_reserve_has_a_separate_bounded_deadline(self):
        async def hanging(*args):
            await asyncio.sleep(20)
        self.pool.reserve.get.side_effect = hanging
        with patch("movie_sources.RESERVE_TIMEOUT", .01):
            self.assertEqual((await self.get())["providers"], self.primary["providers"])

    async def test_total_failure_is_not_an_empty_success(self):
        self.pool.primary.get.side_effect = SourceUnavailable("offline")
        self.pool.reserve.get.side_effect = SourceUnavailable("offline")
        with self.assertRaises(SourceUnavailable):
            await self.get()

    async def test_bad_id_does_not_call_either_api(self):
        with self.assertRaises(ValueError):
            await self.pool.get("../admin", None, {})
        self.pool.primary.get.assert_not_called()
        self.pool.reserve.get.assert_not_called()
