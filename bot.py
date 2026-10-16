import asyncio
import base64
import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
)
from github import Github, GithubException

# --- Event loop guard ---
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

# --- Config ---
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
GITHUB_TOKEN   = os.environ["GITHUB_TOKEN"]
REPO_NAME      = os.environ["REPO_NAME"]
MESSAGES_PATH  = os.environ.get("FILE_PATH", "messages.jsonl")
NICKS_PATH     = "nicks.jsonl"
SECRET_SALT    = os.environ.get("SECRET_SALT", "change-me-please")

# --- GitHub ---
g = Github(GITHUB_TOKEN)
repo = g.get_repo(REPO_NAME)

# --- Nick change rate limit (in-memory) ---
nick_last_change = {}  # ip_hash -> timestamp
NICK_COOLDOWN = 600    # 10 минут

# --- Reserved nicks ---
RESERVED = {"admin", "unknown", "anon", "system", "root", "me", "null"}


# ============ Helpers ============

def daily_code() -> str:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    h = hashlib.sha256((SECRET_SALT + day).encode()).hexdigest()
    num = int(h[:8], 16) % 10000
    return f"{num:04d}"


def ip_hash(ip: str) -> str:
    h = hashlib.sha256((SECRET_SALT + ip).encode()).hexdigest()
    return h[:8]


def valid_nick(nick: str) -> tuple[bool, str]:
    if not isinstance(nick, str):
        return False, "invalid"
    nick = nick.strip()
    if len(nick) < 2:
        return False, "short"
    if len(nick) > 20:
        return False, "long"
    if " " in nick:
        return False, "space"
    if nick.lower() in RESERVED:
        return False, "reserved"
    for ch in nick:
        if not (ch.isalnum() or ch in "_-"):
            return False, "chars"
    return True, nick


def get_contents(path: str) -> tuple[str, str | None]:
    """Возвращает (содержимое, sha) или ('', None), если файла нет."""
    try:
        f = repo.get_contents(path)
        return base64.b64decode(f.content).decode("utf-8"), f.sha
    except GithubException as e:
        if e.status == 404:
            return "", None
        raise


def write_contents(path: str, content: str, sha: str | None, message: str):
    if sha is None:
        repo.create_file(path, message, content)
    else:
        repo.update_file(path, message, content, sha=sha)


def append_to_file(path: str, line: str):
    """Дописать строку в файл на GitHub (с ретраями)."""
    for attempt in range(3):
        try:
            current, sha = get_contents(path)
            new_content = current + line + "\n"
            write_contents(
                path, new_content, sha,
                f"append {datetime.utcnow().isoformat()}"
            )
            return
        except GithubException:
            if attempt == 2:
                raise
            time.sleep(0.5 + attempt)


def find_nick_for_hash(h: str) -> str | None:
    """Возвращает ник для хэша или None."""
    content, _ = get_contents(NICKS_PATH)
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("hash") == h:
            return rec.get("nick")
    return None


def is_nick_taken(nick: str, exclude_hash: str) -> bool:
    """Занят ли ник кем-то другим."""
    content, _ = get_contents(NICKS_PATH)
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("nick") == nick and rec.get("hash") != exclude_hash:
            return True
    return False


def set_nick(h: str, nick: str):
    """Установить/обновить ник для хэша. Старая запись заменяется."""
    content, sha = get_contents(NICKS_PATH)
    lines = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("hash") == h:
            continue  # удаляем старую запись этого хэша
        lines.append(json.dumps(rec, ensure_ascii=False))
    # добавляем новую
    lines.append(json.dumps({
        "hash": h,
        "nick": nick,
        "since": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    }, ensure_ascii=False))
    new_content = "\n".join(lines) + "\n"
    write_contents(NICKS_PATH, new_content, sha, f"nick {h} -> {nick}")


# ============ HTTP server ============

def get_client_ip(handler) -> str:
    """Достаём реальный IP клиента, учитывая прокси Render."""
    xff = handler.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return handler.client_address[0]


class Handler(BaseHTTPRequestHandler):

    # ---- helpers ----
    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return {}

    # ---- routes ----
    def do_GET(self):
        # пинг для Render
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        ip = get_client_ip(self)
        h = ip_hash(ip)
        data = self._read_json()
        code = str(data.get("code", "")).strip()

        # все три эндпоинта требуют верный код
        if code != daily_code():
            return self._send_json({"ok": False, "reason": "code"})

        if self.path == "/verify":
            return self._send_json({
                "ok": True,
                "hash": h,
                "nick": find_nick_for_hash(h)
            })

        if self.path == "/post":
            text = str(data.get("text", "")).strip()
            if not text:
                return self._send_json({"ok": False, "reason": "empty"})
            if len(text) > 500:
                text = text[:500]
            record = {
                "when": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "ip_hash": h,
                "text": text,
            }
            try:
                append_to_file(MESSAGES_PATH, json.dumps(record, ensure_ascii=False))
            except Exception as e:
                print(f"[post] error: {e}")
                return self._send_json({"ok": False, "reason": "github"})
            return self._send_json({"ok": True, "hash": h})

        if self.path == "/nick":
            nick_raw = data.get("nick", "")
            ok_valid, result = valid_nick(nick_raw)
            if not ok_valid:
                return self._send_json({"ok": False, "reason": result})
            nick = result

            # cooldown
            now = time.time()
            last = nick_last_change.get(h, 0)
            if now - last < NICK_COOLDOWN:
                return self._send_json({
                    "ok": False,
                    "reason": "cooldown",
                    "wait": int(NICK_COOLDOWN - (now - last))
                })

            # занято?
            if is_nick_taken(nick, h):
                return self._send_json({"ok": False, "reason": "taken"})

            try:
                set_nick(h, nick)
                nick_last_change[h] = now
            except Exception as e:
                print(f"[nick] error: {e}")
                return self._send_json({"ok": False, "reason": "github"})

            return self._send_json({"ok": True, "nick": nick, "hash": h})

        return self._send_json({"ok": False, "reason": "notfound"}, 404)

    def log_message(self, *args):
        pass


def run_http_server():
    port = int(os.environ.get("PORT", 10000))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"[http] listening on {port}")
    server.serve_forever()


# ============ Telegram bot ============

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "I am Msg Wall.\n\n"
        "Use /code to get today's access code,\n"
        "then enter it on the wall website to read and write messages."
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "How it works:\n"
        "1. Get today's code with /code.\n"
        "2. Open the wall website.\n"
        "3. Enter the code.\n"
        "4. Read and write messages right there.\n\n"
        "Commands:\n"
        "/start — begin\n"
        "/code — today's access code\n"
        "/help — this help"
    )


async def cmd_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    code = daily_code()
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await update.message.reply_text(
        f"Today's code ({day} UTC):\n\n    {code}\n\n"
        "Enter it on the wall website."
    )


def main():
    threading.Thread(target=run_http_server, daemon=True).start()

    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("code", cmd_code))

    print(f"[bot] starting. code for today: {daily_code()}")
    app.run_polling()


if __name__ == "__main__":
    main()