"""
AbobaTV Telegram Bot
====================
Авторизация через deep link.

Установка:
    pip install python-telegram-bot aiohttp

Запуск:
    python bot.py

Команды:
    /start   — приветствие (или логин через deep link)
    /myid    — узнать свой Telegram ID
    /users   — [админ] список пользователей
"""

import logging
import os
import aiohttp
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    ContextTypes
)

# ──────────────────────────────────────────────
#  НАСТРОЙКИ
# ──────────────────────────────────────────────
# Все секреты берём из переменных окружения — НИЧЕГО не хардкодим в коде,
# чтобы не утекло в git. Значения задаются в docker-compose / .env (см. .env.example).
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:8000")
ADMIN_KEY = os.environ.get("ADMIN_KEY", "").strip()

if not BOT_TOKEN:
    raise SystemExit(
        "BOT_TOKEN не задан. Укажите переменную окружения BOT_TOKEN "
        "(в docker-compose.yml или .env)."
    )
if not ADMIN_KEY:
    raise SystemExit("ADMIN_KEY не задан. Укажите одинаковый секрет для Docker-бота и сервера входа.")

_env_admins = os.environ.get("ADMIN_IDS", "").strip()
ADMIN_IDS = set()
if _env_admins:
    for _id in _env_admins.split(","):
        _id = _id.strip()
        if _id.isdigit():
            ADMIN_IDS.add(int(_id))

# ──────────────────────────────────────────────

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger(__name__)


def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS


# ──────────────────────────────────────────────
#  /start  —  вход / авторизация
# ──────────────────────────────────────────────
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    args = ctx.args

    if args:
        auth_code = args[0]

        async with aiohttp.ClientSession() as session:
            try:
                resp = await session.post(f"{SERVER_URL}/auth/confirm", headers={"X-Admin-Key": ADMIN_KEY}, timeout=aiohttp.ClientTimeout(total=15), json={
                    "code":       auth_code,
                    "tg_id":      user.id,
                    "first_name": user.first_name,
                    "last_name":  user.last_name or "",
                    "username":   user.username or "",
                    "photo_url":  "",
                })
                data = await resp.json()
            except Exception as e:
                log.error(f"confirm error: {e}")
                data = {"ok": False}

        if data.get("ok"):
            await update.message.reply_text(
                f"✅ Привет, {user.first_name}!\n\n"
                f"Вы успешно вошли в AbobaTV.\n"
                f"Вернитесь на вкладку сайта — вход выполнен автоматически."
            )
        else:
            await update.message.reply_text(
                "❌ Код устарел или уже использован.\n"
                "Попробуйте войти заново на сайте."
            )
        return

    kb_rows = [
        [InlineKeyboardButton("👤 Мой аккаунт", callback_data="my_account")],
        [InlineKeyboardButton("❓ Помощь", callback_data="help")],
    ]
    if is_admin(user.id):
        kb_rows.append([InlineKeyboardButton("⚙️ Админ", callback_data="admin")])

    kb = InlineKeyboardMarkup(kb_rows)
    await update.message.reply_text(
        f"👋 Привет, {user.first_name}!\n\n"
        f"Это бот онлайн-кинотеатра AbobaTV.\n\n"
        f"Нажмите кнопку входа на сайте — "
        f"я пришлю подтверждение автоматически.",
        reply_markup=kb
    )


# ──────────────────────────────────────────────
#  /myid
# ──────────────────────────────────────────────
async def cmd_myid(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    await update.message.reply_text(
        f"Ваш Telegram ID: {user.id}\n"
        f"Username: @{user.username or '—'}"
    )


# ──────────────────────────────────────────────
#  /users — список пользователей
# ──────────────────────────────────────────────
async def cmd_users(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if not is_admin(user.id):
        await update.message.reply_text("❌ Только для админов.")
        return

    async with aiohttp.ClientSession() as session:
        try:
            resp = await session.get(
                f"{SERVER_URL}/admin/users",
                headers={"X-Admin-Key": ADMIN_KEY},
            )
            data = await resp.json()
        except Exception as e:
            await update.message.reply_text(f"❌ Ошибка: {e}")
            return

    users_list = data.get("users", [])
    if not users_list:
        await update.message.reply_text("Пользователей пока нет.")
        return

    lines = [f"👥 Всего: {len(users_list)}\n"]
    for u in users_list[:50]:
        name = u.get("name", "—")
        uname = u.get("username", "")
        uname_str = f" @{uname}" if uname else ""
        lines.append(f"• {name}{uname_str} (id: {u['tg_id']})")

    text = "\n".join(lines)
    if len(text) > 4000:
        text = text[:3997] + "..."
    await update.message.reply_text(text)


# ──────────────────────────────────────────────
#  Callbacks (кнопки)
# ──────────────────────────────────────────────
async def cb_account(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user = query.from_user

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("◀️ Назад", callback_data="back_main")],
    ])
    await query.edit_message_text(
        f"👤 Ваш аккаунт\n\n"
        f"Имя: {user.first_name} {user.last_name or ''}\n"
        f"Username: @{user.username or '—'}\n"
        f"Telegram ID: {user.id}",
        reply_markup=kb
    )


async def cb_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("◀️ Назад", callback_data="back_main")],
    ])
    await query.edit_message_text(
        "❓ Помощь\n\n"
        "• Для входа нажмите кнопку «Войти» на сайте\n"
        "• Бот пришлёт подтверждение — нажмите Start\n"
        "• Сайт автоматически выполнит вход\n\n"
        "Команды:\n"
        "/myid — узнать свой Telegram ID",
        reply_markup=kb
    )


async def cb_admin(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if not is_admin(query.from_user.id):
        await query.edit_message_text("❌ Нет прав админа")
        return

    kb = InlineKeyboardMarkup([
        [InlineKeyboardButton("◀️ Назад", callback_data="back_main")],
    ])
    await query.edit_message_text(
        "⚙️ Админ-панель\n\n"
        "Доступные команды:\n"
        "/users — список всех пользователей",
        reply_markup=kb
    )


async def cb_back(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    user = query.from_user
    kb_rows = [
        [InlineKeyboardButton("👤 Мой аккаунт", callback_data="my_account")],
        [InlineKeyboardButton("❓ Помощь", callback_data="help")],
    ]
    if is_admin(user.id):
        kb_rows.append([InlineKeyboardButton("⚙️ Админ", callback_data="admin")])

    kb = InlineKeyboardMarkup(kb_rows)
    await query.edit_message_text(
        "👋 Главное меню AbobaTV",
        reply_markup=kb
    )


# ──────────────────────────────────────────────
#  Запуск
# ──────────────────────────────────────────────
def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("myid",  cmd_myid))
    app.add_handler(CommandHandler("users", cmd_users))

    app.add_handler(CallbackQueryHandler(cb_account, pattern="^my_account$"))
    app.add_handler(CallbackQueryHandler(cb_help,    pattern="^help$"))
    app.add_handler(CallbackQueryHandler(cb_admin,   pattern="^admin$"))
    app.add_handler(CallbackQueryHandler(cb_back,    pattern="^back_main$"))

    log.info("✅ Бот @AbobaWathTV_bot запущен...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
