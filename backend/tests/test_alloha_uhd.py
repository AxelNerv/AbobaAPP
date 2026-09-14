"""Метка «4K» у alloha: проверка адреса и разбор страницы. Без сети."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
# База остаётся открытой до выхода — Windows не даст удалить её раньше.
_profile = tempfile.TemporaryDirectory(prefix="aboba uhd test ", ignore_cleanup_errors=True)
os.environ["STATE_FILE"] = str(Path(_profile.name) / "state.json")
import server  # noqa: E402


class UrlTests(unittest.TestCase):
    def test_accepts_player_address(self):
        url = "https://floki-as.stravers.live/?token_movie=abc&token=def"
        self.assertEqual(server.validate_player_url(url), url)

    def test_rejects_everything_that_leads_inside(self):
        for url in [
            "http://floki-as.stravers.live/",          # не https
            "https://127.0.0.1/",                       # IP вместо имени
            "https://[::1]/",
            "https://192.168.9.1/",
            "https://localhost/",
            "https://router.lan/",
            "https://printer/",                         # имя без домена
            "https://user:pass@floki-as.stravers.live/",
            "https://floki-as.stravers.live:8765/",     # чужой порт
            "file:///etc/passwd",
            "",
        ]:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    server.validate_player_url(url)

    def test_public_addresses(self):
        self.assertTrue(server.address_is_public("104.21.3.4"))
        self.assertTrue(server.address_is_public("198.18.1.21"))  # fake-IP роутера
        for address in ["127.0.0.1", "10.0.0.5", "192.168.9.1", "172.20.1.1", "169.254.1.1", "::1", "fd00::1", "0.0.0.0"]:
            with self.subTest(address=address):
                self.assertFalse(server.address_is_public(address))


class PageTests(unittest.TestCase):
    def test_flag_found(self):
        self.assertTrue(server.page_has_uhd('{"quality":"BDRip","id_quality":1,"uhd":1,"typeList":"theatrical"}'))
        self.assertTrue(server.page_has_uhd('"uhd" : 1}'))

    def test_flag_absent(self):
        self.assertFalse(server.page_has_uhd('{"quality":"WEB-DL","uhd":0}'))
        self.assertFalse(server.page_has_uhd('"uhd":10'))
        self.assertFalse(server.page_has_uhd(""))


if __name__ == "__main__":
    unittest.main()
