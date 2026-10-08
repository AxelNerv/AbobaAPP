import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from movie_search import MovieSearch, entity_movie
from movie_sources import SourceUnavailable


def claim(value, rank="normal"):
    return {"rank": rank, "mainsnak": {"snaktype": "value", "datavalue": {"value": value}}}


def entity(kp_id="687595", title="Кухня"):
    return {"labels": {"ru": {"value": title}, "en": {"value": "Kitchen"}},
            "descriptions": {"ru": {"value": "российский телесериал"}},
            "claims": {"P2603": [claim(kp_id)], "P577": [claim({"time": "+2012-10-22T00:00:00Z"})]}}


class EntityTests(unittest.TestCase):
    def test_exact_id_and_title_year_type(self):
        self.assertEqual(entity_movie(entity()), {"kp_id": "687595", "title": "Кухня",
            "name_original": "Kitchen", "year": "2012", "type": "series", "description": "российский телесериал"})

    def test_non_movie_or_ambiguous_id_is_not_guessed(self):
        for value in ("../admin", "0", "x", 123, None):
            self.assertIsNone(entity_movie(entity(value)))
        item = entity()
        item["claims"]["P2603"].append(claim("12345"))
        self.assertIsNone(entity_movie(item))
        item["claims"] = {}
        self.assertIsNone(entity_movie(item))

    def test_deprecated_id_and_novalue_are_not_used(self):
        item = entity()
        item["claims"]["P2603"] = [claim("12", "deprecated"), {"mainsnak": {"snaktype": "novalue"}}]
        self.assertIsNone(entity_movie(item))

    def test_preferred_claim_overrides_normal(self):
        item = entity()
        item["claims"]["P2603"] = [claim("12"), claim("687595", "preferred")]
        self.assertEqual(entity_movie(item)["kp_id"], "687595")

    def test_fallback_label_and_start_date(self):
        item = entity()
        del item["labels"]["ru"]
        del item["claims"]["P577"]
        item["claims"]["P580"] = [claim({"time": "+2019-01-01T00:00:00Z"})]
        self.assertEqual(entity_movie(item)["title"], "Kitchen")
        self.assertEqual(entity_movie(item)["year"], "2019")


class SearchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.status = 200
        self.search_reply = {"search": [{"id": "Q1"}, {"id": "Q2"}, {"id": "Q3"}]}
        self.entities_reply = {"entities": {"Q1": entity(), "Q2": entity(),
                                          "Q3": {"labels": {}, "claims": {}}}}
        app = web.Application()

        async def handle(request):
            self.calls.append(dict(request.query))
            return web.json_response(self.search_reply if request.query["action"] == "wbsearchentities"
                                     else self.entities_reply, status=self.status)

        app.router.add_get("/api", handle)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        self.url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/api"
        self.http = aiohttp.ClientSession()
        self.service = MovieSearch()

        class RoutedSession:
            def get(inner_self, url, **kwargs):
                self.assertEqual(url, "https://www.wikidata.org/w/api.php")
                return self.http.get(self.url, **kwargs)

        self.session = RoutedSession()

    async def asyncTearDown(self):
        await self.http.close()
        await self.runner.cleanup()

    async def search(self, query="Кухня", page=1):
        return await self.service.search(query, page, self.session)

    async def test_cache_dedup_and_non_movie_filter(self):
        result = await self.search()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["kp_id"], "687595")
        self.assertEqual(await self.search("  кухня  "), result)
        self.assertEqual(len(self.calls), 2)

    async def test_failure_is_not_cached_as_no_results(self):
        self.search_reply = {"error": {"code": "maxlag"}}
        with self.assertRaises(SourceUnavailable):
            await self.search()
        self.search_reply = {"search": []}
        self.assertEqual(await self.search(), [])
        self.assertEqual(len(self.calls), 2)

    async def test_http_error_stays_error(self):
        self.status = 503
        with self.assertRaises(SourceUnavailable):
            await self.search()

    async def test_bad_entity_or_missing_metadata_stays_error(self):
        self.search_reply = {"search": [{"id": "../admin"}]}
        with self.assertRaises(SourceUnavailable):
            await self.search()
        self.search_reply = {"search": [{"id": "Q1"}]}
        self.entities_reply = {"entities": {}}
        with self.assertRaises(SourceUnavailable):
            await self.search()

    async def test_input_validation_never_contacts_network(self):
        for query, page in (("x", 1), ("x" * 201, 1), ("Кухня", 0), ("Кухня", 11)):
            with self.assertRaises(ValueError):
                await self.search(query, page)
        self.assertEqual(self.calls, [])

    async def test_pagination(self):
        await self.search(page=2)
        self.assertEqual(self.calls[0]["continue"], "30")

    async def test_response_size_limit(self):
        with patch("movie_search.MAX_BODY", 10):
            with self.assertRaises(SourceUnavailable):
                await self.search()

    async def test_cache_is_bounded(self):
        self.search_reply = {"search": []}
        for index in range(65):
            await self.search(f"query {index}")
        self.assertEqual(len(self.service.cache), 64)
