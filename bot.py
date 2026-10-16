import asyncio
import base64
import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    MessageHandler,
    CommandHandler,
    filters,
    ContextTypes,
)
from github import Github, GithubException

# --- Event loop guard (for Python 3.14) ---
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

# --- Config from environment ---
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GITHUB_TOKEN   = os.environ["GITHUB_TOKEN"]
REPO_NAME      = os.environ["REPO_NAME"]
FILE_PATH      = os.environ.get("FILE_PATH", "messages.jsonl")
SECRET_SALT    = os.environ.get("SECRET_SALT", "change-me-please")

# --- GitHub ---
g = Github(GITHUB_TOKEN)
repo = g.get_repo(REPO_NAME)

# --- Queue ---
queue: asyncio.Queue = asyncio.Queue()

# --- Telegram application handle (нужен внутри HTTP-сервера) ---
tg_app = None


# ============ Daily code ============

def daily_code() -> str:
    """4-значный код, зависящий от даты (UTC) и соли."""
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    h = hashlib.sha256((SECRET_SALT + day).encode()).hexdigest()
    # берём 4 цифры из хэша
    num = int(h[:8], 16) % 10000
    return f"{num:04d}"


# ============ Fake HTTP server for Render ============
class Ping(BaseHTTPRequestHandler):
    def do_GET(self):
        # Простой пинг, чтобы Render видел открытый порт
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path != "/verify":
            self.send_response(404)
            self.end_headers()
            return

        # Читаем тело
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""

        try:
            data = json.loads(body or b"{}")
        except json.JSONDecodeError:
            data = {}

        code = str(data.get("code", "")).strip()
        ok = (code == daily_code())

        resp = json.dumps({"ok": ok}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def do_OPTIONS(self):
        # CORS preflight для браузера
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, *args):
        pass


def run_ping_server():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(("0.0.0.0", port), Ping)
    print(f"[http] Listening on port {port}")
    server.serve_forever()


# ============ GitHub write ============

def append_to_file(line: str) -> None:
    import time
    for attempt in range(3):
        try:
            file = repo.get_contents(FILE_PATH)
            current = base64.b64decode(file.content).decode("utf-8")
            new_content = current + line + "\n"
            repo.update_file(
                path=FILE_PATH,
                message=f"append {datetime.utcnow().isoformat()}",
                content=new_content,
                sha=file.sha,
            )
            return
        except GithubException:
            if attempt == 2:
                raise
            time.sleep(0.5 + attempt)
    raise RuntimeError("Could not write to GitHub")


async def queue_worker():
    while True:
        line = await queue.get()
        try:
            await asyncio.to_thread(append_to_file, line)
        except Exception as e:
            print(f"[queue_worker] Write error: {e}")
        finally:
            queue.task_done()


# ============ Command handlers ============

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "I am Msg Wall — a message board.\n"
        "Send me anything and it stays forever.\n\n"
        "To read the wall, use /code to get today's access code.\n"
        "Just type a message and hit send."
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "How it works:\n"
        "1. You write a message.\n"
        "2. It is saved to GitHub.\n"
        "3. It appears on the wall website.\n\n"
        "Commands:\n"
        "/start — begin\n"
        "/code — today's access code\n"
        "/help — this help"
    )


async def cmd_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    code = daily_code()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await update.message.reply_text(
        f"Today's code ({day} UTC):\n"
        f"    {code}\n\n"
        "Enter it on the wall website to read messages."
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    if not text:
        return

    user = update.effective_user
    username = user.username or ""
    record = {
        "when": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
        "id": user.id,
        "username": username,
        "who": f"@{username}" if username else user.first_name,
        "text": text,
    }
    line = json.dumps(record, ensure_ascii=False)

    await queue.put(line)
    await update.message.reply_text(f"✅ Saved (queue: {queue.qsize()})")


# ============ Startup / shutdown ============

async def on_startup(app):
    app.bot_data["worker"] = asyncio.create_task(queue_worker())
    print(f"[bot] Queue started. Today's code: {daily_code()}")


async def on_shutdown(app):
    if "worker" in app.bot_data:
        await queue.join()
        app.bot_data["worker"].cancel()
        print("[bot] Queue stopped")


def main():
    threading.Thread(target=run_ping_server, daemon=True).start()

    app = (
        ApplicationBuilder()
        .token(TELEGRAM_TOKEN)
        .post_init(on_startup)
        .post_shutdown(on_shutdown)
        .build()
    )
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("code", cmd_code))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("[bot] Starting polling…")
    app.run_polling()


if __name__ == "__main__":
    main()