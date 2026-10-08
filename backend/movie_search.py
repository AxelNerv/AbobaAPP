"""Keyless title lookup with exact Kinopoisk IDs from Wikidata (P2603)."""
import asyncio
from collections import OrderedDict
import json
import re
import time

import aiohttp

from movie_sources import SourceUnavailable

API_URL = "https://www.wikidata.org/w/api.php"
MAX_BODY = 2 * 1024 * 1024
LIMIT = 30
USER_AGENT = "AbobaTV/0.3 (movie search; https://github.com/AxelNerv/AbobaAPP)"
SERIES_CLASSES = {"Q5398426", "Q581714", "Q63952888", "Q15416", "Q7724161"}


def claim_values(entity, prop):
    claims = entity.get("claims", {}).get(prop, [])
    valid = [claim for claim in claims if isinstance(claim, dict)
             and claim.get("rank") != "deprecated"
             and claim.get("mainsnak", {}).get("snaktype") == "value"]
    preferred = [claim for claim in valid if claim.get("rank") == "preferred"]
    return [claim.get("mainsnak", {}).get("datavalue", {}).get("value")
            for claim in (preferred or valid)]


def entity_movie(entity):
    ids = {value for value in claim_values(entity, "P2603")
           if isinstance(value, str) and re.fullmatch(r"[1-9]\d{0,11}", value)}
    # Do not guess an ID from a title, or open a film with ambiguous identifiers.
    if len(ids) != 1:
        return None
    labels = entity.get("labels", {})
    title = labels.get("ru", {}).get("value") or labels.get("en", {}).get("value")
    if not isinstance(title, str) or not title.strip():
        return None
    descriptions = entity.get("descriptions", {})
    description = descriptions.get("ru", {}).get("value") or descriptions.get("en", {}).get("value", "")
    classes = {value.get("id") for value in claim_values(entity, "P31") if isinstance(value, dict)}
    series = bool(classes & SERIES_CLASSES or re.search(r"телесериал|телевизионн.*сериал|television series|tv series", str(description), re.I))
    year = ""
    for prop in ("P577", "P580"):
        dates = [value.get("time", "") for value in claim_values(entity, prop) if isinstance(value, dict)]
        years = sorted(match[1] for date in dates if (match := re.match(r"\+(\d{4})-", date)))
        if years:
            year = years[0]
            break
    return {"kp_id": next(iter(ids)), "title": title.strip()[:300],
            "name_original": labels.get("en", {}).get("value", ""), "year": year,
            "description": str(description)[:1000], "type": "series" if series else "movie"}


class MovieSearch:
    def __init__(self):
        self.cache = OrderedDict()
        self.slots = asyncio.Semaphore(3)

    async def search(self, query, page, session):
        query = " ".join(str(query).split())
        if not 2 <= len(query) <= 200 or not isinstance(page, int) or not 1 <= page <= 10:
            raise ValueError("invalid movie search")
        key = (query.casefold(), page)
        cached = self.cache.get(key)
        if cached and cached[0] > time.monotonic():
            self.cache.move_to_end(key)
            return cached[1]
        try:
            result = await asyncio.wait_for(self._load(query, page, session), timeout=10)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError, AttributeError) as error:
            raise SourceUnavailable(f"Wikidata search: {type(error).__name__}") from error
        self.cache[key] = (time.monotonic() + 300, result)
        self.cache.move_to_end(key)
        while len(self.cache) > 64:
            self.cache.popitem(last=False)
        return result

    async def _json(self, session, params):
        async with session.get(API_URL, params={"format": "json", "maxlag": 5, **params},
                               headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                               timeout=aiohttp.ClientTimeout(total=5, connect=2),
                               allow_redirects=False) as response:
            if response.status != 200:
                raise SourceUnavailable(f"Wikidata HTTP {response.status}")
            chunks, size = [], 0
            async for chunk in response.content.iter_chunked(65536):
                size += len(chunk)
                if size > MAX_BODY:
                    raise SourceUnavailable("Wikidata response too large")
                chunks.append(chunk)
            data = json.loads(b"".join(chunks))
        if not isinstance(data, dict) or data.get("error"):
            raise SourceUnavailable("Wikidata returned an error")
        return data

    async def _load(self, query, page, session):
        async with self.slots:
            data = await self._json(session, {"action": "wbsearchentities", "search": query,
                                             "language": "ru", "uselang": "ru", "type": "item",
                                             "limit": LIMIT, "continue": (page - 1) * LIMIT})
            hits = data.get("search")
            if not isinstance(hits, list) or len(hits) > LIMIT:
                raise SourceUnavailable("Invalid Wikidata search results")
            ids = []
            for hit in hits:
                if not isinstance(hit, dict) or not re.fullmatch(r"Q[1-9]\d{0,15}", str(hit.get("id", ""))):
                    raise SourceUnavailable("Invalid Wikidata entity ID")
                if hit["id"] not in ids:
                    ids.append(hit["id"])
            if not ids:
                return []
            data = await self._json(session, {"action": "wbgetentities", "ids": "|".join(ids),
                                             "props": "labels|descriptions|claims", "languages": "ru|en"})
            entities = data.get("entities")
            if not isinstance(entities, dict):
                raise SourceUnavailable("Invalid Wikidata entities")
            movies, seen = [], set()
            for entity_id in ids:
                entity = entities.get(entity_id)
                if not isinstance(entity, dict):
                    raise SourceUnavailable("Missing Wikidata entity")
                if "missing" in entity:
                    continue
                if not isinstance(entity.get("claims"), dict) or not isinstance(entity.get("labels"), dict):
                    raise SourceUnavailable("Invalid Wikidata movie metadata")
                movie = entity_movie(entity)
                if movie and movie["kp_id"] not in seen:
                    seen.add(movie["kp_id"])
                    movies.append(movie)
            return movies
