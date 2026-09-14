"""Consistent SQLite snapshots and validated desktop backups. No server imports."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import zipfile


def validate_database(file):
    with closing(sqlite3.connect(file.as_uri() + "?mode=ro", uri=True)) as conn:
        if conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Повреждённая база")
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"users", "tokens", "user_lists"}.issubset(tables):
            raise ValueError("Это не база AbobaTV")
        required = {
            "users": {"tg_id", "name", "username", "photo_url", "logged_in_at"},
            "tokens": {"token", "tg_id"},
            "user_lists": {"id", "tg_id", "list_type", "kp_id", "movie_json", "added_at"},
        }
        for table, columns in required.items():
            actual = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            if not columns.issubset(actual):
                raise ValueError(f"Несовместимая структура базы: {table}")


def snapshot(source, target):
    validate_database(source)
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as src:
        with closing(sqlite3.connect(target)) as dst:
            src.backup(dst)
    validate_database(target)


def create(profile, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="aboba-backup-") as temp:
        snap = Path(temp) / "abobatv.db"
        snapshot(profile / "data" / "abobatv.db", snap)
        temporary = target.with_suffix(".partial")
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                archive.write(snap, "abobatv.db")
                settings = profile / "settings.json"
                archive.writestr("settings.json", settings.read_text("utf8") if settings.exists() else "{}")
                archive.writestr("manifest.json", json.dumps({"format": "abobatv", "version": 1}))
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)


def restore(profile, source):
    # Backend must be stopped by the caller. Check everything before replacing files.
    with zipfile.ZipFile(source) as archive:
        if any(info.file_size > 256 * 1024 * 1024 for info in archive.infolist()):
            raise ValueError("Слишком большой архив")
        if json.loads(archive.read("manifest.json")) != {"format": "abobatv", "version": 1}:
            raise ValueError("Неизвестный формат копии")
        settings = json.loads(archive.read("settings.json"))
        if not isinstance(settings, dict):
            raise ValueError("Некорректные настройки")
        # Only these two preferences may be restored; no secrets or arbitrary paths.
        url = settings.get("authServerUrl", "")
        if not isinstance(url, str):
            raise ValueError("Некорректный адрес сервера")
        from urllib.parse import urlparse
        parsed = urlparse(url)
        # Accessing port rejects malformed/non-numeric/out-of-range values.
        if url:
            parsed.port
        if url and (parsed.username or parsed.password or parsed.query or parsed.fragment or
                    not parsed.hostname or (parsed.scheme != "https" and not
                    (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")))):
            raise ValueError("Недопустимый адрес сервера")
        data = profile / "data"
        data.mkdir(parents=True, exist_ok=True)
        temp = data / "restore.pending.db"
        settings_temp = profile / "settings.json.tmp"
        try:
            temp.write_bytes(archive.read("abobatv.db"))
            validate_database(temp)
            settings_temp.write_text(json.dumps({"authServerUrl": url, "closeToTray": settings.get("closeToTray") is True}), "utf8")
            # Never allow an old WAL to replay over the restored database.
            for suffix in ("-wal", "-shm"):
                (data / ("abobatv.db" + suffix)).unlink(missing_ok=True)
            os.replace(temp, data / "abobatv.db")
            os.replace(settings_temp, profile / "settings.json")
        finally:
            temp.unlink(missing_ok=True)
            settings_temp.unlink(missing_ok=True)


if __name__ == "__main__":
    command, first, second = sys.argv[1:]
    {"create": create, "restore": restore, "snapshot": snapshot}[command](Path(first).resolve(), Path(second).resolve())
