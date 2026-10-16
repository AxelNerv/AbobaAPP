"""Independent player lookup; only reachable embeds enter the result."""
import asyncio
from collections import OrderedDict
import html
import json
import re
import time
from urllib.parse import urlparse, urljoin

import aiohttp

API_BASE = "https://fbphdplay.top"
MAX_BODY = 512 * 1024
CACHE_TTL = 120
CACHE_SIZE = 128
# Fixed destinations: the upstream response must not turn this into an open proxy.
PLAYER_HOSTS = ("stravers.live", "gorodyshka.link", "obrut.show", "nextembed.ws", "kurolesya.link")
SOURCE_URLS = {"fbp": API_BASE, "reyhoho": "https://api.reyhoho.fun"}
# The reserve needs its lookup (up to 6 s) plus an embed probe (up to 4 s).
# A 4 s outer deadline discarded healthy first visits before they completed.
RESERVE_TIMEOUT = 10.5


def allowed_embed(url):
    if not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        return (parsed.scheme == "https" and not parsed.username and not parsed.password
                and parsed.port in (None, 443)
                and any(host == base or host.endswith("." + base) for base in PLAYER_HOSTS))
    except (TypeError, ValueError):
        return False


def page_metadata(page):
    # Alloha's publicly rendered mediaMetadata has the film name and year.
    match = re.search(r'"mediaMetadata"\s*:\s*(\{\s*"title"\s*:\s*"(?:\\.|[^"\\])*"\s*\})', page)
    title = ""
    if match:
        try:
            title = json.loads(match[1]).get("title", "")
        except (ValueError, AttributeError):
            pass
    if not title:
        match = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
        title = html.unescape(match[1]).strip() if match else ""
    if title.lower() in ("player", "video player", "ошибка!", "error", ""):
        return {}
    is_series = bool(re.search(r'\(\d+\s+сезон\)|"type"\s*:\s*"serial"|"episode"\s*:\s*"?\d+', page, re.I))
    title = re.sub(r"\s*\(\d+\s+сезон\).*?$", "", title, flags=re.I).strip()
    year_match = re.search(r"\s*\((19\d{2}|20\d{2})\)$", title)
    year = year_match[1] if year_match else ""
    if year_match:
        title = title[:year_match.start()].strip()
    return {"title": title[:300], "year": year, "type": "TV_SERIES" if is_series else "FILM"}


async def read_limited(response):
    chunks, size = [], 0
    async for chunk in response.content.iter_chunked(64 * 1024):
        size += len(chunk)
        if size > MAX_BODY:
            raise ValueError("player response too large")
        chunks.append(chunk)
    return b"".join(chunks)


class SourceUnavailable(Exception):
    pass


class MovieSources:
    def __init__(self, source="fbp"):
        # Only fixed public API destinations; callers cannot supply a proxy URL.
        if source not in SOURCE_URLS:
            raise ValueError("unknown player source")
        self.source = source
        self.api_base = SOURCE_URLS[source]
        self.cache = OrderedDict()
        self.pending = {}
        self.probe_slots = asyncio.Semaphore(4)

    async def get(self, kp_id, session, headers):
        if not re.fullmatch(r"[1-9]\d{0,11}", str(kp_id)):
            raise ValueError("invalid Kinopoisk ID")
        kp_id = str(kp_id)
        cached = self.cache.get(kp_id)
        if cached and cached[0] > time.monotonic():
            self.cache.move_to_end(kp_id)
            return cached[1]
        if kp_id not in self.pending:
            task = asyncio.create_task(self._load(kp_id, session, headers))
            self.pending[kp_id] = task
            task.add_done_callback(lambda finished: self._finished(kp_id, finished))
        return await asyncio.shield(self.pending[kp_id])

    def _finished(self, kp_id, task):
        if self.pending.get(kp_id) is task:
            self.pending.pop(kp_id, None)
        # A cancelled client must not leave an unobserved task exception.
        if not task.cancelled():
            task.exception()

    async def _load(self, kp_id, session, headers):
        try:
            async with session.get(
                f"{self.api_base}/api/players", params={"kinopoisk": kp_id}, headers=headers,
                timeout=aiohttp.ClientTimeout(total=6, connect=2), allow_redirects=False,
            ) as response:
                if response.status != 200:
                    raise SourceUnavailable(f"lookup HTTP {response.status}")
                data = json.loads(await read_limited(response))
            if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                raise SourceUnavailable("invalid lookup response")
            if data.get("error"):
                raise SourceUnavailable("lookup reported an error")
            providers = data["data"]
            if any(not isinstance(p, dict) for p in providers) or len(providers) > 20:
                raise SourceUnavailable("invalid provider list")
            if self.source == "reyhoho":
                # Only this new provider passed real film playback and seeking.
                # The relay's Turbo, VideoSeed and Alloha did not pass.
                providers = [p for p in providers if str(p.get("type", "")).lower() == "veoveo"]
            else:
                # FBP's Veoveo uses another endpoint (redirects/failures in live
                # checks). It must not shadow the verified independent reserve.
                providers = [p for p in providers if str(p.get("type", "")).lower() != "veoveo"]
            results = await asyncio.gather(*(self._probe(p, session, headers) for p in providers))
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as error:
            raise SourceUnavailable(type(error).__name__) from error

        live = [result for result in results if result]
        if providers and not live:
            raise SourceUnavailable("no reachable embeds")
        # Prefer the summary with year; the current series title can include episode text.
        summaries = [metadata for _, metadata in live if metadata]
        summary = next((item for item in summaries if item.get("year")), summaries[0] if summaries else {})
        if any(item.get("type") == "TV_SERIES" for item in summaries):
            summary = {**summary, "type": "TV_SERIES"}
        result = {"kp_id": kp_id, **summary, "providers": [p for p, _ in live], "source": self.source}
        self.cache[kp_id] = (time.monotonic() + CACHE_TTL, result)
        self.cache.move_to_end(kp_id)
        while len(self.cache) > CACHE_SIZE:
            self.cache.popitem(last=False)
        return result

    async def _probe(self, provider, session, headers):
        url = provider.get("iframeUrl")
        if not allowed_embed(url) or provider.get("success") is False:
            print(f"[sources] {provider.get('type', 'unknown')}: unsupported or empty embed")
            return None
        # Same referrer as the public integration. No scripts are executed server-side.
        page_headers = {**headers, "Accept": "text/html", "Referer": self.api_base + "/"}
        translations = provider.get("translations", [])
        if not isinstance(translations, list):
            translations = []
        cleaned = {**provider, "translations": [t for t in translations
                   if isinstance(t, dict) and allowed_embed(t.get("iframeUrl"))]}
        try:
            async with self.probe_slots:
                host = (urlparse(url).hostname or "").lower()
                for _ in range(3):
                    async with session.get(url, headers=page_headers, allow_redirects=False,
                                           timeout=aiohttp.ClientTimeout(total=4, connect=2)) as response:
                        # Veoveo's first visit sets a cookie and redirects on the
                        # same host. Validate every hop; never follow arbitrary URLs.
                        if response.status in (301, 302, 303, 307, 308):
                            location = response.headers.get("Location")
                            target = urljoin(url, location) if location else ""
                            if not allowed_embed(target) or urlparse(target).hostname.lower() != host:
                                raise ValueError("untrusted embed redirect")
                            url = target
                            continue
                        # Turbo's HTTP 403 probe can still play in Electron.
                        if (response.status == 403 and str(provider.get("type", "")).lower() == "turbo"
                                and (host == "obrut.show" or host.endswith(".obrut.show"))):
                            print("[sources] Turbo: HTTP 403 to probe; loading in browser")
                            return {**cleaned, "browserOnly": True}, {}
                        if response.status != 200:
                            print(f"[sources] {provider.get('type')}: embed HTTP {response.status}")
                            return None
                        if "text/html" not in response.headers.get("Content-Type", "").lower():
                            print(f"[sources] {provider.get('type')}: embed is not HTML")
                            return None
                        page = (await read_limited(response)).decode("utf-8", "replace")
                        return cleaned, page_metadata(page)
                raise ValueError("too many embed redirects")
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as error:
            print(f"[sources] {provider.get('type')}: embed {type(error).__name__}")
            return None


class PlayerSourcePool:
    """Fetch the fast sources together; an optional reserve cannot hide FBP."""
    def __init__(self):
        self.primary = MovieSources()
        self.reserve = MovieSources("reyhoho")

    async def get(self, kp_id, session, headers):
        if not re.fullmatch(r"[1-9]\d{0,11}", str(kp_id)):
            raise ValueError("invalid Kinopoisk ID")

        async def attempt(source, timeout):
            try:
                return await asyncio.wait_for(source.get(kp_id, session, headers), timeout)
            except (SourceUnavailable, asyncio.TimeoutError) as error:
                print(f"[sources] {source.source}: {type(error).__name__}: {error}")
                return error

        results = await asyncio.gather(attempt(self.primary, 10.5), attempt(self.reserve, RESERVE_TIMEOUT))
        available = [result for result in results if isinstance(result, dict)]
        if not available:
            raise SourceUnavailable("all fast player APIs unavailable")
        providers, seen = [], set()
        for result in available:
            for provider in result["providers"]:
                url = provider["iframeUrl"]
                if url not in seen:
                    providers.append(provider)
                    seen.add(url)
        # Keep the existing frontend group ID for sequential fallback to old APIs.
        return {**available[0], "kp_id": str(kp_id), "providers": providers, "source": "fbp",
                "origins": [result["source"] for result in available]}
