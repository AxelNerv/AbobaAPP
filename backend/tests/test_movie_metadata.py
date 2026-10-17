import asyncio
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from movie_metadata import MovieMetadata, MetadataRequest, image_url, matches


def movie(**kwargs):
    return MetadataRequest(kp_id="10453010", title="Железное лёгкое", original_title="Iron Lung", year=2026, **kwargs)


class MetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_deadline_also_bounds_wait_for_available_slot(self):
        service = MovieMetadata(omdb_key="test-only-key")
        service.slots = asyncio.Semaphore(0)
        with patch("movie_metadata.PROVIDER_TIMEOUT", .01), self.assertLogs("movie_metadata", "WARNING"):
            self.assertEqual((await service.get(movie(), None))["providers"]["omdb"], "unavailable")

    async def test_missing_keys_never_contact_keyed_apis(self):
        service = MovieMetadata()
        service._json = AsyncMock()
        result = await service.get(movie(), None)
        self.assertEqual(result["providers"], {"tmdb": "unconfigured", "omdb": "unconfigured", "anilist": "not_applicable"})
        self.assertEqual(result["fields"], {})
        service._json.assert_not_called()

    async def test_anime_public_lookup_and_short_cache(self):
        service = MovieMetadata()
        service._json = AsyncMock(return_value={"data": {"Page": {"media": [{
            "id": 20, "title": {"romaji": "Naruto"}, "synonyms": [], "startDate": {"year": 2002},
            "format": "TV", "episodes": 220, "averageScore": 79,
            "coverImage": {"large": "https://s4.anilist.co/file/a.jpg"}}]}}})
        anime = MetadataRequest(kp_id="283290", title="Наруто", original_title="Naruto", year=2002, kind="series", anime=True)
        one, two = await asyncio.gather(service.get(anime, None), service.get(anime, None))
        self.assertEqual(one, two)
        self.assertEqual(one["fields"]["episodes_count"], 220)
        self.assertEqual(one["fields"]["rating_anilist"], 79)
        self.assertEqual((await service.get(anime, None))["providers"]["anilist"], "ok")
        service._json.assert_awaited_once()
        self.assertNotIn("token", str(service._json.call_args))

    async def test_failed_optional_api_is_explicit_and_not_cached_as_not_found(self):
        service = MovieMetadata(omdb_key="test-only-key")
        service._omdb = AsyncMock(side_effect=ValueError("secret-bearing upstream error"))
        with self.assertLogs("movie_metadata", "WARNING") as logs:
            result = await service.get(movie(), None)
        self.assertEqual(result["providers"]["omdb"], "unavailable")
        self.assertNotIn("test-only-key", str(result) + str(logs.output))
        self.assertNotIn("secret-bearing", str(logs.output))
        self.assertFalse(service.cache)
        service._omdb.return_value = {"rating_imdb": 5.5, "source_url": "https://www.imdb.com/title/tt12708700/"}
        service._omdb.side_effect = None
        service.retry_at.clear()
        self.assertEqual((await service.get(movie(), None))["providers"]["omdb"], "ok")

    async def test_omdb_false_success_key_error_is_not_not_found(self):
        service = MovieMetadata(omdb_key="test-only-key")
        service._json = AsyncMock(return_value={"Response": "False", "Error": "Invalid API key!"})
        with self.assertLogs("movie_metadata", "WARNING"):
            self.assertEqual((await service.get(movie(), None))["providers"]["omdb"], "unavailable")

    async def test_omdb_matching_and_na_fields(self):
        service = MovieMetadata(omdb_key="test-only-key")
        service._json = AsyncMock(return_value={"Response": "True", "imdbID": "tt12708700", "Title": "Iron Lung",
            "Year": "2026", "Type": "movie", "imdbRating": "5.5", "Runtime": "125 min", "Poster": "N/A"})
        result = await service.get(movie(), None)
        self.assertEqual(result["fields"]["film_length"], 125)
        self.assertEqual(result["fields"]["rating_imdb"], 5.5)
        self.assertNotIn("poster_url", result["fields"])
        self.assertNotIn("test-only-key", json.dumps(result))

    async def test_remake_or_different_type_is_rejected(self):
        service = MovieMetadata(omdb_key="test-only-key")
        service._json = AsyncMock(return_value={"Response": "True", "imdbID": "tt12708700", "Title": "Iron Lung",
            "Year": "2000", "Type": "movie"})
        self.assertEqual((await service.get(movie(), None))["providers"]["omdb"], "not_found")
        self.assertFalse(matches(movie(), ["Iron Lung II"], 2026))

    async def test_tmdb_does_not_take_first_result_or_actor(self):
        service = MovieMetadata(tmdb_key="test-only-key")
        service._json = AsyncMock(side_effect=[{"results": [
            {"id": 1, "title": "Iron Lung", "release_date": "2000-01-01"},
            {"id": 1000001, "title": "Iron Lung", "release_date": "2026-01-30"}]},
            {"id": 1000001, "overview": "Описание", "poster_path": "/poster.jpg", "runtime": 125}])
        result = await service.get(movie(), None)
        self.assertEqual(result["fields"]["description"], "Описание")
        self.assertEqual(result["fields"]["poster_url"], "https://image.tmdb.org/t/p/original/poster.jpg")
        self.assertNotIn("test-only-key", json.dumps(result))

    async def test_ambiguous_search_does_not_overwrite_card(self):
        service = MovieMetadata(tmdb_key="test-only-key")
        service._json = AsyncMock(return_value={"results": [
            {"id": 1, "title": "Iron Lung", "release_date": "2026-01-01"},
            {"id": 2, "title": "Iron Lung", "release_date": "2026-01-02"}]})
        self.assertEqual((await service.get(movie(), None))["fields"], {})
        self.assertEqual(service._json.await_count, 1)

    async def test_malformed_response_is_not_an_empty_success(self):
        service = MovieMetadata(tmdb_key="test-only-key")
        service._json = AsyncMock(return_value={"results": None})
        with self.assertLogs("movie_metadata", "WARNING"):
            self.assertEqual((await service.get(movie(), None))["providers"]["tmdb"], "unavailable")

    def test_input_does_not_accept_urls_or_keys(self):
        for extra in ({"url": "https://127.0.0.1/"}, {"api_key": "secret"}):
            with self.assertRaises(ValueError):
                MetadataRequest(kp_id="1", title="test", **extra)

    def test_images_must_use_fixed_https_hosts(self):
        for url in ("http://s4.anilist.co/a.jpg", "https://s4.anilist.co.evil/a.jpg", "https://user@s4.anilist.co/a.jpg", "https://s4.anilist.co:8443/a.jpg"):
            self.assertFalse(image_url(url, "s4.anilist.co"))
        self.assertTrue(image_url("https://s4.anilist.co/file/a.jpg", "s4.anilist.co"))
