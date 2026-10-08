import asyncio
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from movie_catalog import MovieCatalog, normalize_movie, ENDPOINT
from movie_sources import SourceUnavailable


def movie(kp_id=687595, kind="TvSeries"):
    return {"id": kp_id, "__typename": kind, "title": {"localized": "Кухня", "original": "Kitchen"},
            "releaseYears": [{"start": 2012, "end": 2016}],
            "gallery": {"posters": {"vertical": {"avatarsUrl": "//avatars.mds.yandex.net/get-ott/1/poster"}}},
            "rating": {"kinopoisk": {"value": 8.2, "count": 500}}, "kpSynopsis": "Описание"}


class NormalizationTests(unittest.TestCase):
    def test_keeps_exact_ids_years_ratings_and_image_sizes(self):
        row = normalize_movie(movie())
        self.assertEqual((row["kp_id"], row["year"], row["type"]), ("687595", 2012, "TV_SERIES"))
        self.assertEqual(row["rating_kinopoisk"], 8.2)
        self.assertEqual(row["description"], "Описание")
        self.assertTrue(row["poster_url_preview"].endswith("/poster/300x450"))
        self.assertTrue(row["poster_url"].endswith("/poster/orig"))

    def test_bad_id_type_or_title_is_not_an_empty_success(self):
        for changes in ({"id": "../42"}, {"title": {}}, {"__typename": "Person"}):
            with self.assertRaises(SourceUnavailable):
                normalize_movie({**movie(), **changes})

    def test_inactive_rating_and_foreign_poster_are_not_used(self):
        row = normalize_movie({**movie(), "gallery": {"posters": {"vertical": {"avatarsUrl": "http://localhost/a"}}},
                               "rating": {"kinopoisk": {"isActive": False, "value": 8}}})
        self.assertIsNone(row["rating_kinopoisk"])
        self.assertEqual(row["poster_url"], "")


class CatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.status = 200
        self.error = None
        self.bad_rating = False
        self.detail = movie()
        self.items = [{"movie": movie()}, {"movie": movie()}]
        app = web.Application()

        async def handle(request):
            body = await request.json()
            self.calls.append(body)
            operation = body["operationName"]
            if self.error:
                result = self.error
            elif operation == "SearchMovies":
                result = {"data": {"search": {"movies": {"items": self.items}}}}
            elif operation == "MovieDesktopListPage":
                variables = body["variables"]
                kind = "Film" if variables["slug"] == "popular-films" else "TvSeries"
                start = (1000 if kind == "Film" else 2000) + variables["moviesOffset"]
                result = {"data": {"movieListBySlug": {"movies": {"items": [
                    {"movie": movie(start + i, kind)} for i in range(variables["moviesLimit"])]}}}}
            elif operation == "MovieDetailsMobileGeneralMeta":
                result = {"data": {"movie": self.detail}}
            else:
                result = {"errors": [{"message": "failed"}]} if self.bad_rating else {"data": {"movie": {"rating": movie()["rating"]}}}
            return web.json_response(result, status=self.status)

        app.router.add_post("/graphql", handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/graphql"
        self.http = aiohttp.ClientSession()

        class Session:
            def post(inner, target, **kwargs):
                self.assertEqual(target, ENDPOINT)
                self.assertFalse(kwargs["allow_redirects"])
                self.assertNotIn("Authorization", kwargs["headers"])
                return self.http.post(url, **kwargs)

        self.session = Session()
        self.catalog = MovieCatalog()

    async def asyncTearDown(self):
        await self.http.close()
        await self.runner.cleanup()

    async def test_search_cache_dedup_pagination_and_no_user_data(self):
        rows = await self.catalog.search(" Кухня ", 2, self.session)
        self.assertEqual(len(rows), 1)
        self.assertEqual(await self.catalog.search("Кухня", 2, self.session), rows)
        self.assertEqual(len(self.calls), 1)
        variables = self.calls[0]["variables"]
        self.assertEqual(variables["offset"], 30)
        self.assertFalse(variables["includeMovieUserFolders"])
        self.assertFalse(variables["includeMovieUserVote"])
        self.assertFalse(variables["isOnline"])

    async def test_graphql_errors_and_http_errors_are_not_cached_as_empty(self):
        self.error = {"errors": [{"message": "upstream failed"}], "data": {"search": None}}
        with self.assertRaises(SourceUnavailable):
            await self.catalog.search("Кухня", 1, self.session)
        self.error = None
        self.status = 503
        with self.assertRaises(SourceUnavailable):
            await self.catalog.search("Кухня", 1, self.session)
        self.status = 200
        self.items = []
        self.assertEqual(await self.catalog.search("Кухня", 1, self.session), [])
        self.assertEqual(len(self.calls), 3)

    async def test_popular_is_100_unique_films_and_series_without_detail_requests(self):
        rows = await self.catalog.popular("all", 1, 100, self.session)
        self.assertEqual(len(rows), 100)
        self.assertEqual(len({row["kp_id"] for row in rows}), 100)
        self.assertEqual([row["type"] for row in rows[:4]], ["FILM", "TV_SERIES"] * 2)
        self.assertEqual(len(self.calls), 2)
        self.assertFalse(self.calls[0]["variables"]["withUserData"])

    async def test_type_filter_and_next_page_have_correct_offsets(self):
        rows = await self.catalog.popular("series", 2, 100, self.session)
        self.assertTrue(all(row["type"] == "TV_SERIES" for row in rows))
        self.assertEqual([call["variables"]["moviesOffset"] for call in self.calls], [100, 150])

    async def test_invalid_input_does_not_contact_network(self):
        for args in (("x", 1), ("Кухня", 0), ("x" * 201, 1)):
            with self.assertRaises(ValueError):
                await self.catalog.search(*args, self.session)
        with self.assertRaises(ValueError):
            await self.catalog.popular("all", 1, 101, self.session)
        with self.assertRaises(ValueError):
            await self.catalog.details("1/../../", self.session)
        self.assertFalse(self.calls)

    async def test_details_and_rating_cache(self):
        row = await self.catalog.details("687595", self.session)
        self.assertEqual(row["rating_kinopoisk"], 8.2)
        self.assertEqual(await self.catalog.details("687595", self.session), row)
        self.assertEqual(len(self.calls), 2)

    async def test_missing_and_wrong_movie_are_distinct(self):
        self.detail = None
        self.assertIsNone(await self.catalog.details("111", self.session))
        self.detail = movie()
        with self.assertRaises(SourceUnavailable):
            await self.catalog.details("222", self.session)

    async def test_optional_rating_failure_is_logged_and_retried(self):
        self.bad_rating = True
        with self.assertLogs("movie_catalog", level="WARNING"):
            row = await self.catalog.details("687595", self.session)
        self.assertEqual(row["title"], "Кухня")
        self.assertTrue(row["rating_unavailable"])
        self.bad_rating = False
        row = await self.catalog.details("687595", self.session)
        self.assertNotIn("rating_unavailable", row)
        self.assertEqual(len(self.calls), 4)

    async def test_response_and_cache_size_limits(self):
        with patch("movie_catalog.MAX_BODY", 20):
            with self.assertRaises(SourceUnavailable):
                await self.catalog.search("Кухня", 1, self.session)
        with patch("movie_catalog.MAX_CACHE_BYTES", 20):
            await self.catalog.search("Кухня", 1, self.session)
            self.assertFalse(self.catalog.cache)

    async def test_cancellation_does_not_turn_into_empty_list(self):
        async def slow(*args):
            await asyncio.sleep(20)
        with patch.object(self.catalog, "_request", slow):
            task = asyncio.create_task(self.catalog.search("Кухня", 1, self.session))
            await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertFalse(self.catalog.cache)
