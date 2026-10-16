import asyncio
import base64
import json
import os
import threading
from datetime import datetime
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

# --- Страховка для event loop (на случай Python 3.14) ---
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

# --- Конфиг из переменных окружения ---
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GITHUB_TOKEN = os.environ["GITHUB_TOKEN"]
REPO_NAME = os.environ["REPO_NAME"]
FILE_PATH = os.environ.get("FILE_PATH", "messages.jsonl")

# --- GitHub ---
g = Github(GITHUB_TOKEN)
repo = g.get_repo(REPO_NAME)

# --- Очередь ---
queue: asyncio.Queue = asyncio.Queue()


# ============ Фейковый HTTP-сервер для Render ============
class Ping(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


def run_ping_server():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(("0.0.0.0", port), Ping)
    print(f"[ping] Слушаю порт {port}")
    server.serve_forever()


# ============ Работа с GitHub ============

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
    raise RuntimeError("Не удалось записать в GitHub")


async def queue_worker():
    while True:
        line = await queue.get()
        try:
            await asyncio.to_thread(append_to_file, line)
        except Exception as e:
            print(f"[queue_worker] Ошибка записи: {e}")
        finally:
            queue.task_done()


# ============ Обработчики команд ============

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Я — стена сообщений Msg Wall.\n"
        "Напиши мне что угодно — и оно останется навсегда.\n\n"
        "Просто напиши текст и отправь."
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Как это работает:\n"
        "1. Ты пишешь сообщение.\n"
        "2. Оно сохраняется в GitHub.\n"
        "3. Оно появляется на сайте стены.\n\n"
        "Команды:\n"
        "/start — начать\n"
        "/help — эта справка"
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
        "username": username,                                     # без @
        "who": f"@{username}" if username else user.first_name,   # для отображения
        "text": text,
    }
    line = json.dumps(record, ensure_ascii=False)

    await queue.put(line)
    await update.message.reply_text(f"✅ Сохранено (в очереди: {queue.qsize()})")


# ============ Запуск и остановка ============

async def on_startup(app):
    app.bot_data["worker"] = asyncio.create_task(queue_worker())
    print("[bot] Очередь запущена")


async def on_shutdown(app):
    if "worker" in app.bot_data:
        await queue.join()
        app.bot_data["worker"].cancel()
        print("[bot] Очередь остановлена")


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
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("[bot] Запускаю polling…")
    app.run_polling()


if __name__ == "__main__":
    main()