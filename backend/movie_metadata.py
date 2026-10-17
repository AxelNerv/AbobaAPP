"""Optional, per-card metadata. Fixed upstreams, no user lists or bulk imports."""
import asyncio
from collections import OrderedDict
import json
import logging
import re
import time
import unicodedata
from urllib.parse import urlparse

import aiohttp
from pydantic import BaseModel, ConfigDict, Field

from movie_sources import read_limited, SourceUnavailable

PROVIDER_TIMEOUT = 5
ANILIST_QUERY = """query ($search: String!) {
  Page(page: 1, perPage: 5) {
    media(search: $search, type: ANIME, isAdult: false) {
      id title { romaji english native } synonyms startDate { year } format
      coverImage { large extraLarge } bannerImage episodes duration averageScore
    }
  }
}"""


class MetadataRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kp_id: str = Field(pattern=r"^[1-9]\d{0,11}$")
    title: str = Field(min_length=1, max_length=300)
    original_title: str = Field(default="", max_length=300)
    year: int | None = Field(default=None, ge=1800, le=2200)
    imdb_id: str = Field(default="", pattern=r"^(?:tt\d{5,12})?$")
    kind: str = Field(default="movie", pattern=r"^(movie|series)$")
    anime: bool = False


def normalized_title(value):
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return "".join(c for c in value if c.isalnum())


def score(value, maximum=10):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if not isinstance(value, bool) and 0 <= number <= maximum else None


def positive_int(value):
    return value if type(value) is int and 0 < value < 10 ** 12 else None


def image_url(value, host):
    if not isinstance(value, str) or len(value) > 2000:
        return ""
    try:
        url = urlparse(value)
        return value if (url.scheme == "https" and url.hostname == host
                         and not url.username and not url.password and url.port in (None, 443)) else ""
    except ValueError:
        return ""


def matches(movie, titles, year):
    expected = {normalized_title(movie.title), normalized_title(movie.original_title)} - {""}
    return bool(expected.intersection(normalized_title(t) for t in titles if t)) and (
        movie.year is None or year == movie.year)


class MovieMetadata:
    def __init__(self, tmdb_key="", omdb_key=""):
        self.tmdb_key = tmdb_key
        self.omdb_key = omdb_key
        self.cache = OrderedDict()
        self.pending = {}
        self.slots = asyncio.Semaphore(3)
        self.retry_at = {}

    def status(self):
        return {"tmdb": "configured" if self.tmdb_key else "unconfigured",
                "omdb": "configured" if self.omdb_key else "unconfigured",
                "anilist": "enabled"}

    async def _json(self, session, method, url, **kwargs):
        async with session.request(method, url, allow_redirects=False,
                                   timeout=aiohttp.ClientTimeout(total=4, connect=2), **kwargs) as response:
            if response.status != 200:
                # Do not put credential-bearing URLs or upstream bodies in logs.
                raise SourceUnavailable(f"HTTP {response.status}")
            data = json.loads(await read_limited(response))
        if not isinstance(data, dict) or data.get("errors"):
            raise SourceUnavailable("invalid metadata response")
        return data

    async def _anilist(self, movie, session):
        data = await self._json(session, "POST", "https://graphql.anilist.co",
                                json={"query": ANILIST_QUERY,
                                      "variables": {"search": movie.original_title or movie.title}})
        rows = data["data"]["Page"]["media"]
        if not isinstance(rows, list):
            raise SourceUnavailable("invalid anime results")
        candidates = [row for row in rows if isinstance(row, dict)
                      and matches(movie, [*(row.get("title") or {}).values(), *(row.get("synonyms") or [])],
                                  (row.get("startDate") or {}).get("year"))
                      and row.get("format") in (("MOVIE",) if movie.kind == "movie" else
                                                 ("TV", "TV_SHORT", "ONA", "OVA", "SPECIAL", "TV_SPECIAL"))]
        if len(candidates) != 1:
            return None
        row = candidates[0]
        if not positive_int(row.get("id")):
            raise SourceUnavailable("invalid anime ID")
        cover = row.get("coverImage") or {}
        return {"poster_url": image_url(cover.get("extraLarge") or cover.get("large"), "s4.anilist.co"),
                "poster_url_preview": image_url(cover.get("large"), "s4.anilist.co"),
                "backdrop_url": image_url(row.get("bannerImage"), "s4.anilist.co"),
                "episodes_count": positive_int(row.get("episodes")),
                "film_length": positive_int(row.get("duration")),
                "rating_anilist": score(row.get("averageScore"), 100),
                "source_url": f"https://anilist.co/anime/{row['id']}"}

    async def _omdb(self, movie, session):
        params = {"apikey": self.omdb_key, "type": movie.kind}
        if movie.imdb_id:
            params["i"] = movie.imdb_id
        else:
            params["t"] = movie.original_title or movie.title
            if movie.year:
                params["y"] = movie.year
        data = await self._json(session, "GET", "https://www.omdbapi.com/", params=params)
        if data.get("Response") == "False":
            if data.get("Error") in ("Movie not found!", "Series not found!", "Incorrect IMDb ID."):
                return None
            raise SourceUnavailable("OMDb rejected request")
        imdb = data.get("imdbID", "")
        if data.get("Response") != "True" or not re.fullmatch(r"tt\d{5,12}", str(imdb)):
            raise SourceUnavailable("invalid OMDb response")
        year = re.match(r"\d{4}", str(data.get("Year", "")))
        if data.get("Type") != movie.kind or (movie.imdb_id and imdb != movie.imdb_id):
            return None
        if not movie.imdb_id and not matches(movie, [data.get("Title")], int(year[0]) if year else None):
            return None
        duration = re.fullmatch(r"(\d+) min", str(data.get("Runtime", "")))
        return {"imdb_id": imdb, "rating_imdb": score(data.get("imdbRating")),
                "film_length": int(duration[1]) if duration else None,
                "seasons_count": positive_int(int(data["totalSeasons"])) if str(data.get("totalSeasons", "")).isdigit() else None,
                "poster_url": image_url(data.get("Poster"), "m.media-amazon.com"),
                "source_url": f"https://www.imdb.com/title/{imdb}/"}

    async def _tmdb(self, movie, session):
        params = {"api_key": self.tmdb_key, "language": "ru-RU"}
        kind = "tv" if movie.kind == "series" else "movie"
        if movie.imdb_id:
            data = await self._json(session, "GET", f"https://api.themoviedb.org/3/find/{movie.imdb_id}",
                                    params={**params, "external_source": "imdb_id"})
            rows = data[f"{kind}_results"]
        else:
            data = await self._json(session, "GET", f"https://api.themoviedb.org/3/search/{kind}",
                                    params={**params, "query": movie.original_title or movie.title, "include_adult": "false"})
            rows = data["results"]
        if not isinstance(rows, list):
            raise SourceUnavailable("invalid TMDB results")
        def correct(row):
            if not isinstance(row, dict) or not positive_int(row.get("id")):
                return False
            date = str(row.get("release_date") or row.get("first_air_date") or "")[:4]
            year = int(date) if date.isdigit() else None
            return (not movie.year or movie.year == year) and (bool(movie.imdb_id) or matches(movie,
                [row.get("title"), row.get("original_title"), row.get("name"), row.get("original_name")], year))
        candidates = [row for row in rows if correct(row)]
        if len(candidates) != 1:
            return None
        row = await self._json(session, "GET", f"https://api.themoviedb.org/3/{kind}/{candidates[0]['id']}", params=params)
        if row.get("id") != candidates[0]["id"]:
            raise SourceUnavailable("wrong TMDB details")
        def poster(path, size):
            return f"https://image.tmdb.org/t/p/{size}{path}" if isinstance(path, str) and re.fullmatch(r"/[\w.-]+", path) else ""
        return {"description": row.get("overview") if isinstance(row.get("overview"), str) else "",
                "poster_url": poster(row.get("poster_path"), "original"),
                "poster_url_preview": poster(row.get("poster_path"), "w500"),
                "backdrop_url": poster(row.get("backdrop_path"), "w1280"),
                "film_length": positive_int(row.get("runtime")),
                "episodes_count": positive_int(row.get("number_of_episodes")),
                "seasons_count": positive_int(row.get("number_of_seasons")),
                "rating_tmdb": score(row.get("vote_average")),
                "source_url": f"https://www.themoviedb.org/{kind}/{row['id']}"}

    async def _load(self, source, movie, session):
        async def load():
            async with self.slots:
                return await getattr(self, "_" + source)(movie, session)
        try:
            result = await asyncio.wait_for(load(), PROVIDER_TIMEOUT)
        except (SourceUnavailable, aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError, KeyError, AttributeError) as error:
            detail = str(error) if isinstance(error, SourceUnavailable) else type(error).__name__
            logging.getLogger(__name__).warning("%s metadata unavailable: %s", source, detail)
            self.retry_at[source] = time.monotonic() + 15
            return "unavailable", None
        return ("ok", result) if result else ("not_found", None)

    async def _cached(self, source, movie, session):
        key = (source, movie.title, movie.original_title, movie.year, movie.imdb_id, movie.kind)
        cached = self.cache.get(key)
        if cached and cached[0] > time.monotonic():
            self.cache.move_to_end(key)
            return cached[1]
        if self.retry_at.get(source, 0) > time.monotonic():
            return "unavailable", None
        if key not in self.pending:
            task = asyncio.create_task(self._load(source, movie, session))
            self.pending[key] = task
            def finished(done):
                self.pending.pop(key, None)
                if not done.cancelled():
                    done.exception()
            task.add_done_callback(finished)
        result = await asyncio.shield(self.pending[key])
        if result[0] != "unavailable":
            self.cache[key] = (time.monotonic() + (300 if result[1] else 30), result)
            while len(self.cache) > 128:
                self.cache.popitem(last=False)
        return result

    async def get(self, movie, session):
        statuses = self.status()
        statuses["anilist"] = "enabled" if movie.anime else "not_applicable"
        active = [name for name, status in statuses.items() if status in ("configured", "enabled")]
        results = await asyncio.gather(*(self._cached(name, movie, session) for name in active))
        fields, sources = {}, []
        for source, (status, result) in zip(active, results):
            statuses[source] = status
            if not result:
                continue
            sources.append({"name": source, "url": result["source_url"]})
            for key, value in result.items():
                if key != "source_url" and value is not None and value != "" and key not in fields:
                    fields[key] = value
        return {"kp_id": movie.kp_id, "fields": fields, "sources": sources, "providers": statuses}
