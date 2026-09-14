"""Local integration tests: no Telegram, live user data or external API calls."""
import asyncio
from contextlib import closing
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zipfile

import aiohttp

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from backup import create, restore, snapshot


class AuthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aboba auth test ")
        self.processes = []
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3))
        self.authority = await self.start_server("authority")
        self.client = await self.start_server("client", self.authority)

    async def start_server(self, mode, remote=""):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        profile = Path(self.temp.name) / f"{mode}-{port}"
        env = dict(os.environ, AUTH_MODE=mode, AUTH_SERVER_URL=remote,
                   ADMIN_KEY="test-only-server-key", STATE_FILE=str(profile / "state.json"))
        process = subprocess.Popen([sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(port)],
                                   cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(process)
        url = f"http://127.0.0.1:{port}"
        for _ in range(100):
            if process.poll() is not None:
                self.fail("Test server failed to start")
            try:
                async with self.http.get(url + "/ext-health") as response:
                    if response.status == 200:
                        return url
            except aiohttp.ClientError:
                pass
            await asyncio.sleep(.05)
        self.fail("Test server readiness timeout")

    async def asyncTearDown(self):
        await self.http.close()
        for process in self.processes:
            process.terminate()
            process.wait(timeout=5)
        self.temp.cleanup()

    async def request(self, method, url, **kwargs):
        async with self.http.request(method, url, **kwargs) as response:
            return response.status, await response.json()

    async def test_remote_login_local_list_and_replay(self):
        status, init = await self.request("GET", self.client + "/auth/init")
        self.assertEqual(status, 200)
        remote_code = init["deep_link"].split("start=", 1)[1]
        self.assertNotEqual(remote_code, init["code"])
        confirm = {"code": remote_code, "tg_id": 123456, "first_name": "Test", "last_name": "", "username": "test", "photo_url": ""}
        status, _ = await self.request("POST", self.authority + "/auth/confirm", json=confirm)
        self.assertEqual(status, 403)
        status, _ = await self.request("POST", self.client + "/auth/confirm", json={**confirm, "code": init["code"]}, headers={"X-Admin-Key": "test-only-server-key"})
        self.assertEqual(status, 403)
        status, _ = await self.request("POST", self.authority + "/auth/confirm", json=confirm, headers={"X-Admin-Key": "test-only-server-key"})
        self.assertEqual(status, 200)
        status, result = await self.request("GET", self.client + "/auth/poll/" + init["code"])
        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["tg_id"], 123456)
        headers = {"Authorization": "Bearer " + result["token"]}
        status, _ = await self.request("PUT", self.client + "/list/history/687595", headers=headers, json={"movie": {"kp_id": "687595", "title": "Test"}})
        self.assertEqual(status, 200)
        status, history = await self.request("GET", self.client + "/list/history", headers=headers)
        self.assertEqual(status, 200)
        self.assertEqual(len(history["items"]), 1)
        status, _ = await self.request("GET", self.client + "/auth/poll/" + init["code"])
        self.assertEqual(status, 410)
        status, _ = await self.request("POST", self.authority + "/auth/confirm", json=confirm, headers={"X-Admin-Key": "test-only-server-key"})
        self.assertEqual(status, 400)

    async def test_missing_server_is_explicit(self):
        unconfigured = await self.start_server("client")
        status, error = await self.request("GET", unconfigured + "/auth/init")
        self.assertEqual(status, 503)
        self.assertIn("не настроен", error["detail"])

    async def test_admin_requires_valid_secret(self):
        status, _ = await self.request("GET", self.authority + "/admin/users", headers={"X-Admin-Key": ""})
        self.assertEqual(status, 403)


class ExpiryTests(unittest.TestCase):
    def test_expired_confirmation_and_poll_are_rejected(self):
        # Import in a separate process so server initialization never sees real data.
        with tempfile.TemporaryDirectory(prefix="aboba expiry test ") as temp:
            code = """
import asyncio
from datetime import datetime, timedelta
import os
import sys
sys.path.insert(0, os.getcwd())
import server
from fastapi import HTTPException
async def check():
    expired = datetime.utcnow() - timedelta(minutes=6)
    server.pending_codes['old'] = {'created_at': expired}
    req = server.ConfirmRequest(code='old', tg_id=123, first_name='Test', last_name='', username='', photo_url='')
    try:
        await server.auth_confirm(req, 'test-only-key')
        raise AssertionError('Expired confirmation accepted')
    except HTTPException as error:
        assert error.status_code == 400
    server.sessions['old-session'] = {'created_at': expired, 'user': {}, 'token': 'test'}
    assert not (await server.auth_poll('old-session'))['ok']
    server.AUTH_MODE = 'client'
    server.pending_codes['old-client'] = {'created_at': expired, 'remote_code': 'never-requested'}
    try:
        await server.auth_poll('old-client')
        raise AssertionError('Expired client code accepted')
    except HTTPException as error:
        assert error.status_code == 410
asyncio.run(check())
"""
            result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND,
                                    env=dict(os.environ, STATE_FILE=str(Path(temp) / "state.json"),
                                             AUTH_MODE="authority", AUTH_SERVER_URL="", ADMIN_KEY="test-only-key"),
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="aboba backup test ")
        self.profile = Path(self.temp.name)
        (self.profile / "data").mkdir()
        self.database = self.profile / "data" / "abobatv.db"
        self.conn = sqlite3.connect(self.database)
        self.conn.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE users(tg_id INTEGER PRIMARY KEY, name TEXT, username TEXT, photo_url TEXT, logged_in_at TEXT);
            CREATE TABLE tokens(token TEXT PRIMARY KEY, tg_id INTEGER);
            CREATE TABLE user_lists(id INTEGER PRIMARY KEY, tg_id INTEGER, list_type TEXT, kp_id TEXT, movie_json TEXT, added_at TEXT, title TEXT);
            INSERT INTO user_lists(title) VALUES('saved');
        """)
        self.conn.commit()
        (self.profile / "settings.json").write_text(json.dumps({"closeToTray": True, "authServerUrl": "https://auth.example.com"}))

    def tearDown(self):
        self.conn.close()
        self.temp.cleanup()

    def test_snapshot_reads_live_wal(self):
        self.conn.execute("INSERT INTO user_lists(title) VALUES('WAL row')")
        self.conn.commit()
        target = self.profile / "snapshot.db"
        snapshot(self.database, target)
        with closing(sqlite3.connect(target)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM user_lists").fetchone()[0], 2)

    def test_roundtrip(self):
        archive = self.profile / "copy.zip"
        create(self.profile, archive)
        self.conn.execute("DELETE FROM user_lists")
        self.conn.commit()
        self.conn.close()
        restore(self.profile, archive)
        with closing(sqlite3.connect(self.database)) as conn:
            self.assertEqual(conn.execute("SELECT title FROM user_lists").fetchone()[0], "saved")
        self.assertTrue(json.loads((self.profile / "settings.json").read_text())["closeToTray"])

    def test_corrupt_copy_keeps_working_data(self):
        archive = self.profile / "broken.zip"
        with zipfile.ZipFile(archive, "w") as file:
            file.writestr("manifest.json", json.dumps({"format": "abobatv", "version": 1}))
            file.writestr("settings.json", "{}")
            file.writestr("abobatv.db", b"not sqlite")
        with self.assertRaises(sqlite3.DatabaseError):
            restore(self.profile, archive)
        self.assertEqual(self.conn.execute("SELECT title FROM user_lists").fetchone()[0], "saved")

    def test_incompatible_schema_keeps_working_data(self):
        invalid = self.profile / "wrong.db"
        with closing(sqlite3.connect(invalid)) as conn:
            conn.executescript("CREATE TABLE users(id); CREATE TABLE tokens(id); CREATE TABLE user_lists(id);")
        archive = self.profile / "wrong-schema.zip"
        with zipfile.ZipFile(archive, "w") as file:
            file.writestr("manifest.json", json.dumps({"format": "abobatv", "version": 1}))
            file.writestr("settings.json", "{}")
            file.write(invalid, "abobatv.db")
        with self.assertRaisesRegex(ValueError, "структура"):
            restore(self.profile, archive)
        self.assertEqual(self.conn.execute("SELECT title FROM user_lists").fetchone()[0], "saved")

    def test_restores_to_clean_profile(self):
        archive = self.profile / "copy.zip"
        create(self.profile, archive)
        clean = self.profile / "new profile"
        restore(clean, archive)
        with closing(sqlite3.connect(clean / "data" / "abobatv.db")) as conn:
            self.assertEqual(conn.execute("SELECT title FROM user_lists").fetchone()[0], "saved")


if __name__ == "__main__":
    unittest.main(verbosity=2)
