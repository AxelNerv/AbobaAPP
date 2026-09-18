"""Прокси постеров: пускает только на хосты картинок. Без сети."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
_profile = tempfile.TemporaryDirectory(prefix="aboba img test ", ignore_cleanup_errors=True)
os.environ["STATE_FILE"] = str(Path(_profile.name) / "state.json")
from server import _image_host_allowed  # noqa: E402


class ImageHostTest(unittest.TestCase):
    def test_poster_hosts(self):
        self.assertTrue(_image_host_allowed("https://kinopoiskapiunofficial.tech/images/posters/kp_small/1.jpg"))
        self.assertTrue(_image_host_allowed("https://avatars.mds.yandex.net/get-kinopoisk-image/1/x/360"))
        self.assertTrue(_image_host_allowed("https://st.kp.yandex.net/images/film_big/1.jpg"))

    def test_rejects_other_hosts(self):
        for url in (
            "http://127.0.0.1:8785/admin/users",
            "http://192.168.1.1/",
            "https://evil.com/kinopoiskapiunofficial.tech/x.jpg",
            "https://kinopoiskapiunofficial.tech.evil.com/x.jpg",
            "file:///C:/Windows/win.ini",
            "not a url",
        ):
            self.assertFalse(_image_host_allowed(url), url)


if __name__ == "__main__":
    unittest.main()
