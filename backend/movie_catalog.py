"""Public Kinopoisk catalogue. Fixed read-only operations; no account or API key.

These are the website's internal operations, not a guaranteed public API.
Keep the independent fallbacks when its schema or availability changes.
"""
import asyncio
from collections import OrderedDict
import json
import logging
from pathlib import Path
import re
import time

import aiohttp

from movie_sources import SourceUnavailable

ENDPOINT = "https://graphql.kinopoisk.ru/graphql/"
MAX_BODY = 2 * 1024 * 1024
MAX_CACHE_BYTES = 8 * 1024 * 1024
OPERATIONS = ("SearchMovies", "MovieDesktopListPage", "MovieDetailsMobileGeneralMeta", "MovieDetailsMobileRatingBase")
QUERIES = {name: (Path(__file__).parent / "catalog_queries" / f"{name}.graphql").read_text(encoding="utf-8")
           for name in OPERATIONS}
SEARCH_FLAGS = {name: False for name in re.findall(r"\$(\w+): Boolean", QUERIES["SearchMovies"].split(") {", 1)[0])}
HEADERS = {"service-id": "25", "Origin": "https://www.kinopoisk.ru",
           "Referer": "https://www.kinopoisk.ru/", "x-preferred-language": "ru"}


def text(value, limit=500):
    return value.strip()[:limit] if isinstance(value, str) else ""


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def normalize_movie(movie):
    if not isinstance(movie, dict) or not re.fullmatch(r"[1-9]\d{0,11}", str(movie.get("id", ""))):
        raise SourceUnavailable("Invalid catalogue movie ID")
    titles = movie.get("title") or {}
    title = text(titles.get("localized") or titles.get("russian") or titles.get("original"))
    kind = movie.get("__typename")
    if not title or kind not in ("Film", "Video", "TvSeries", "MiniSeries", "TvShow"):
        raise SourceUnavailable("Invalid catalogue movie metadata")
    years = movie.get("releaseYears") or []
    year = movie.get("kpYear") or movie.get("productionYear") or movie.get("fallbackYear")
    if not year and years:
        year = years[0].get("start")
    gallery = movie.get("gallery") or {}
    poster = text(((gallery.get("posters") or {}).get("vertical") or {}).get("avatarsUrl"), 2000)
    if poster.startswith("//avatars.mds.yandex.net/"):
        poster = "https:" + poster
    if not poster.startswith("https://avatars.mds.yandex.net/"):
        poster = ""
    rating = (movie.get("rating") or {}).get("kinopoisk") or {}
    score = number(rating.get("value")) if rating.get("isActive", True) else None
    if score is not None and not 0 <= score <= 10:
        raise SourceUnavailable("Invalid catalogue rating")
    duration = number(movie.get("kpDuration") or movie.get("duration"))
    return {
        "kp_id": str(movie["id"]), "title": title, "name_ru": title,
        "name_original": text(titles.get("original")), "year": year,
        "type": "TV_SERIES" if kind in ("TvSeries", "MiniSeries", "TvShow") else "FILM",
        "description": text(movie.get("kpSynopsis") or movie.get("synopsis"), 20000),
        "short_description": text(movie.get("shortDescription"), 3000),
        "poster_url": poster + "/orig" if poster else "",
        "poster_url_preview": poster + "/300x450" if poster else "",
        "rating_kinopoisk": score, "rating_kinopoisk_vote_count": number(rating.get("count")) or 0,
        "film_length": duration,
        "countries": [{"country": text(x.get("name"))} for x in movie.get("countries", []) if isinstance(x, dict)],
        "genres": [{"genre": text(x.get("name"))} for x in movie.get("genres", []) if isinstance(x, dict)],
        "source": "kinopoisk",
    }


def movie_rows(data):
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise SourceUnavailable("Invalid catalogue list")
    rows, seen = [], set()
    for item in data["items"]:
        movie = normalize_movie(item.get("movie") if isinstance(item, dict) else None)
        if movie["kp_id"] not in seen:
            rows.append(movie)
            seen.add(movie["kp_id"])
    return rows


class MovieCatalog:
    def __init__(self):
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.slots = asyncio.Semaphore(3)

    async def _cached(self, key, ttl, load):
        hit = self.cache.get(key)
        if hit and hit[0] > time.monotonic():
            self.cache.move_to_end(key)
            return hit[1]
        try:
            result = await asyncio.wait_for(load(), timeout=10)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError, AttributeError, KeyError) as error:
            raise SourceUnavailable(f"Kinopoisk catalogue: {type(error).__name__}") from error
        size = len(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        if key in self.cache:
            self.cache_bytes -= self.cache.pop(key)[2]
        if size <= MAX_CACHE_BYTES:
            self.cache[key] = (time.monotonic() + ttl, result, size)
            self.cache_bytes += size
        while len(self.cache) > 128 or self.cache_bytes > MAX_CACHE_BYTES:
            self.cache_bytes -= self.cache.popitem(last=False)[1][2]
        return result

    async def _request(self, operation, variables, session):
        async with self.slots:
            async with session.post(ENDPOINT, params={"operationName": operation},
                                    json={"operationName": operation, "query": QUERIES[operation], "variables": variables},
                                    headers=HEADERS, allow_redirects=False,
                                    timeout=aiohttp.ClientTimeout(total=8, connect=3)) as response:
                if response.status != 200:
                    raise SourceUnavailable(f"Kinopoisk HTTP {response.status}")
                chunks, size = [], 0
                async for chunk in response.content.iter_chunked(65536):
                    size += len(chunk)
                    if size > MAX_BODY:
                        raise SourceUnavailable("Catalogue response too large")
                    chunks.append(chunk)
                data = json.loads(b"".join(chunks))
        # GraphQL can report an error with HTTP 200. Never cache that as an empty list.
        if not isinstance(data, dict) or data.get("errors") or not isinstance(data.get("data"), dict):
            raise SourceUnavailable("Kinopoisk returned a GraphQL error")
        return data["data"]

    async def search(self, query, page, session):
        query = " ".join(str(query).split())
        if not 2 <= len(query) <= 200 or type(page) is not int or not 1 <= page <= 10:
            raise ValueError("Invalid catalogue search")

        async def load():
            data = await self._request("SearchMovies", {**SEARCH_FLAGS, "includeMovieRating": True,
                "keyword": query, "offset": (page - 1) * 30, "limit": 30, "purchaseOptionsContext": {}}, session)
            return movie_rows(data.get("search", {}).get("movies"))
        return await self._cached(("search", query, page), 300, load)

    async def popular(self, type_filter, page, limit, session):
        if type_filter not in ("all", "movie", "series") or type(page) is not int or not 1 <= page <= 10 or type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Invalid catalogue list parameters")

        async def batch(kind, offset, count):
            data = await self._request("MovieDesktopListPage", {
                "slug": "popular-films" if kind == "movie" else "popular-series",
                "platform": "DESKTOP", "withUserData": False, "supportedFilterTypes": [], "filters": None,
                "singleSelectFiltersLimit": 50, "singleSelectFiltersOffset": 0,
                "moviesLimit": count, "moviesOffset": offset,
            }, session)
            return movie_rows(data.get("movieListBySlug", {}).get("movies"))

        async def load():
            if type_filter == "all":
                count = (limit + 1) // 2
                films = await batch("movie", (page - 1) * count, count)
                series = await batch("series", (page - 1) * count, count)
                rows = [row for index in range(max(len(films), len(series)))
                        for group in (films, series) if index < len(group) for row in [group[index]]]
            else:
                rows = []
                for offset in range(0, limit, 50):
                    rows.extend(await batch(type_filter, (page - 1) * limit + offset, min(50, limit - offset)))
            return list({row["kp_id"]: row for row in rows}.values())[:limit]
        return await self._cached(("popular", type_filter, page, limit), 600, load)

    async def details(self, kp_id, session):
        if not re.fullmatch(r"[1-9]\d{0,11}", str(kp_id)):
            raise ValueError("Invalid Kinopoisk ID")

        async def load():
            data = await self._request("MovieDetailsMobileGeneralMeta", {"movieId": int(kp_id),
                "includeKpValues": True, "isOnlyOnlineSeasonsCount": False, "includeMovieTop250": False}, session)
            movie = data.get("movie")
            if movie is None:
                return None
            if str(movie.get("id")) != str(kp_id):
                raise SourceUnavailable("Catalogue returned a different movie")
            # Ratings are optional metadata. Report a failure and keep the valid card.
            try:
                rating = await asyncio.wait_for(self._request("MovieDetailsMobileRatingBase",
                    {"movieId": int(kp_id), "includePlannedToWatch": False}, session), timeout=2)
                movie = {**movie, "rating": (rating.get("movie") or {}).get("rating")}
            except (SourceUnavailable, aiohttp.ClientError, asyncio.TimeoutError) as error:
                logging.getLogger(__name__).warning("Catalogue rating unavailable for %s: %s", kp_id, error)
                return normalize_movie(movie), False
            return normalize_movie(movie), True

        async def complete():
            result = await load()
            if result is None:
                return None
            movie, rated = result
            if not rated:
                # The card remains usable; retry the rating on the next request.
                movie["rating_unavailable"] = True
            return movie
        result = await self._cached(("details", str(kp_id)), 3600, complete)
        if result and result.get("rating_unavailable"):
            self.cache_bytes -= self.cache.pop(("details", str(kp_id)))[2]
        return result
