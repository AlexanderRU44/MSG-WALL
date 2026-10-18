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
from cryptography.fernet import Fernet, InvalidToken

# --- Event loop guard ---
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

# --- Config ---
TELEGRAM_TOKEN  = os.environ["TELEGRAM_TOKEN"]
GITHUB_TOKEN    = os.environ["GITHUB_TOKEN"]
REPO_NAME       = os.environ["REPO_NAME"]
SECRET_SALT     = os.environ.get("SECRET_SALT", "change-me-please")
ENCRYPTION_KEY  = os.environ["ENCRYPTION_KEY"]
ADMIN_CODE      = os.environ.get("ADMIN_CODE", "admin123")

# --- Fernet ---
fernet = Fernet(ENCRYPTION_KEY.encode())

# --- GitHub ---
g = Github(GITHUB_TOKEN)
repo = g.get_repo(REPO_NAME)

# --- Branches ---
DATA_BRANCH    = "data"
MESSAGES_PATH  = os.environ.get("FILE_PATH", "messages.jsonl")
NICKS_PATH     = "nicks.jsonl"
BANS_PATH      = "bans.jsonl"

# --- In-memory cache ---
_cache = {
    "messages": [],
    "nicks": {},
    "bans": {},
    "loaded": False,
}

# --- Online tracking ---
active_users = {}
ONLINE_TIMEOUT = 60

# --- Nick change rate limit ---
nick_last_change = {}
NICK_COOLDOWN = 600

# --- Reserved nicks ---
RESERVED = {"admin", "unknown", "anon", "system", "root", "me", "null", "administrator"}


# ============ Crypto helpers ============

def encrypt_str(s: str) -> str:
    return fernet.encrypt(s.encode("utf-8")).decode("utf-8")

def decrypt_str(token: str) -> str | None:
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception):
        return None

def pack_record(record: dict) -> str:
    raw = json.dumps(record, ensure_ascii=False)
    return encrypt_str(raw)

def unpack_record(line: str) -> dict | None:
    decrypted = decrypt_str(line)
    if decrypted is not None:
        try:
            return json.loads(decrypted)
        except json.JSONDecodeError:
            return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None


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
    try:
        f = repo.get_contents(path, ref=DATA_BRANCH)
        return base64.b64decode(f.content).decode("utf-8"), f.sha
    except GithubException as e:
        if e.status == 404:
            return "", None
        raise

def write_contents(path: str, content: str, sha: str | None, message: str):
    if sha is None:
        repo.create_file(path, message, content, branch=DATA_BRANCH)
    else:
        repo.update_file(path, message, content, sha=sha, branch=DATA_BRANCH)

def append_to_file(path: str, encrypted_line: str):
    for attempt in range(3):
        try:
            current, sha = get_contents(path)
            new_content = current + encrypted_line + "\n"
            write_contents(
                path, new_content, sha,
                f"append {datetime.utcnow().isoformat()}"
            )
            return
        except GithubException:
            if attempt == 2:
                raise
            time.sleep(0.5 + attempt)

def rewrite_messages_file():
    content = "\n".join([pack_record(m) for m in _cache["messages"]]) + "\n"
    _, sha = get_contents(MESSAGES_PATH)
    write_contents(MESSAGES_PATH, content, sha, "admin delete message")

def rewrite_bans_file():
    content = "\n".join([json.dumps({"hash": h, "banned": b}) for h, b in _cache["bans"].items()]) + "\n"
    _, sha = get_contents(BANS_PATH)
    write_contents(BANS_PATH, content, sha, "admin ban update")


# ============ Cache loading ============

def load_messages_from_github() -> list:
    content, _ = get_contents(MESSAGES_PATH)
    items = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        rec = unpack_record(line)
        if rec is not None:
            items.append(rec)
    return items

def load_nicks_from_github() -> dict:
    content, _ = get_contents(NICKS_PATH)
    result = {}
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        rec = unpack_record(line)
        if not rec:
            continue
        h = rec.get("hash")
        n = rec.get("nick")
        if h and n:
            result[h] = n
    return result

def load_bans_from_github() -> dict:
    content, _ = get_contents(BANS_PATH)
    result = {}
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            h = rec.get("hash")
            banned = rec.get("banned", False)
            if h:
                result[h] = banned
        except json.JSONDecodeError:
            continue
    return result

def refresh_cache():
    try:
        _cache["messages"] = load_messages_from_github()
        _cache["nicks"] = load_nicks_from_github()
        _cache["bans"] = load_bans_from_github()
        _cache["loaded"] = True
        print(f"[cache] loaded {len(_cache['messages'])} messages, "
              f"{len(_cache['nicks'])} nicks, {len(_cache['bans'])} ban records")
    except Exception as e:
        print(f"[cache] refresh error: {e}")


# ============ Nick management ============

def set_nick(h: str, nick: str):
    content, sha = get_contents(NICKS_PATH)
    lines = []
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        rec = unpack_record(line)
        if not rec:
            lines.append(line)
            continue
        if rec.get("hash") == h:
            continue
        lines.append(pack_record(rec))
    lines.append(pack_record({
        "hash": h,
        "nick": nick,
        "since": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    }))
    new_content = "\n".join(lines) + "\n"
    write_contents(NICKS_PATH, new_content, sha, "nick update")


# ============ Online users logic ============

def update_online(h: str):
    active_users[h] = time.time()

def get_online_count() -> int:
    now = time.time()
    to_remove = [h for h, last_seen in active_users.items() if now - last_seen > ONLINE_TIMEOUT]
    for h in to_remove:
        del active_users[h]
    return len(active_users)


# ============ HTTP server ============

def get_client_ip(handler) -> str:
    xff = handler.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return handler.client_address[0]


class Handler(BaseHTTPRequestHandler):

    def _send_json(self, data, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
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

    def do_GET(self):
        ip = get_client_ip(self)
        h = ip_hash(ip)

        if self.path.startswith("/messages"):
            update_online(h)
            if not _cache["loaded"]:
                refresh_cache()
            return self._send_json({"ok": True, "messages": _cache["messages"]})

        if self.path.startswith("/nicks"):
            if not _cache["loaded"]:
                refresh_cache()
            return self._send_json({"ok": True, "nicks": _cache["nicks"]})

        if self.path.startswith("/online"):
            update_online(h)
            return self._send_json({"ok": True, "online": get_online_count()})

        if self.path.startswith("/refresh"):
            refresh_cache()
            return self._send_json({"ok": True})

        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        ip = get_client_ip(self)
        h = ip_hash(ip)
        data = self._read_json()
        code = str(data.get("code", "")).strip()

        is_admin = (code == ADMIN_CODE)
        if not is_admin and code != daily_code():
            return self._send_json({"ok": False, "reason": "code"})

        if _cache["bans"].get(h) is True and not is_admin:
            return self._send_json({"ok": False, "reason": "banned"})

        if self.path == "/verify":
            update_online(h)
            if not _cache["loaded"]:
                refresh_cache()

            if _cache["bans"].get(h) is True and not is_admin:
                return self._send_json({"ok": False, "reason": "banned"})

            return self._send_json({
                "ok": True,
                "hash": h,
                "nick": _cache["nicks"].get(h),
                "is_admin": is_admin,
                "bans": _cache["bans"]
            })

        if self.path == "/post":
            text = str(data.get("text", "")).strip()
            reply_to = str(data.get("reply_to", "")).strip()

            if not text:
                return self._send_json({"ok": False, "reason": "empty"})
            if len(text) > 500:
                text = text[:500]

            current_nick = _cache["nicks"].get(h, "")

            record = {
                "when": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "ip_hash": h,
                "nick": current_nick,
                "text": text,
            }

            if is_admin:
                record["admin"] = True

            if reply_to:
                record["reply_to"] = reply_to

            try:
                append_to_file(MESSAGES_PATH, pack_record(record))
            except Exception as e:
                print(f"[post] error: {e}")
                return self._send_json({"ok": False, "reason": "github"})
            _cache["messages"].append(record)
            return self._send_json({"ok": True, "hash": h})

        if self.path == "/nick":
            nick_raw = data.get("nick", "")
            ok_valid, result = valid_nick(nick_raw)
            if not ok_valid:
                return self._send_json({"ok": False, "reason": result})
            nick = result

            now = time.time()
            last = nick_last_change.get(h, 0)
            if now - last < NICK_COOLDOWN and not is_admin:
                return self._send_json({
                    "ok": False,
                    "reason": "cooldown",
                    "wait": int(NICK_COOLDOWN - (now - last))
                })

            for other_hash, existing_nick in _cache["nicks"].items():
                if existing_nick == nick and other_hash != h:
                    return self._send_json({"ok": False, "reason": "taken"})

            old_nick = _cache["nicks"].get(h)
            old_label = f"@{old_nick}" if old_nick else f"@{h}"

            try:
                set_nick(h, nick)
                nick_last_change[h] = now
                _cache["nicks"][h] = nick
            except Exception as e:
                print(f"[nick] error: {e}")
                return self._send_json({"ok": False, "reason": "github"})

            system_msg = f"user {old_label} changed nick to @{nick}"
            sys_record = {
                "when": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "system": True,
                "text": system_msg,
            }
            try:
                append_to_file(MESSAGES_PATH, pack_record(sys_record))
                _cache["messages"].append(sys_record)
            except Exception as e:
                print(f"[nick] system message error: {e}")

            return self._send_json({"ok": True, "nick": nick, "hash": h})

        # === АДМИНСКИЕ КОМАНДЫ ===
        if self.path == "/admin/delete":
            if not is_admin:
                return self._send_json({"ok": False, "reason": "denied"})

            when_str = data.get("when")
            index = data.get("index")

            # Приоритет — удаление по when (уникальный идентификатор)
            if when_str:
                idx = next(
                    (i for i, m in enumerate(_cache["messages"]) if m.get("when") == when_str),
                    -1
                )
                if idx == -1:
                    return self._send_json({"ok": False, "reason": "notfound"})
                del _cache["messages"][idx]
                try:
                    rewrite_messages_file()
                except Exception as e:
                    print(f"[admin] delete error: {e}")
                    return self._send_json({"ok": False, "reason": "github"})
                return self._send_json({"ok": True})

            # Фолбэк — по индексу (старый клиент)
            if index is not None and isinstance(index, int) and 0 <= index < len(_cache["messages"]):
                del _cache["messages"][index]
                try:
                    rewrite_messages_file()
                except Exception as e:
                    print(f"[admin] delete error: {e}")
                    return self._send_json({"ok": False, "reason": "github"})
                return self._send_json({"ok": True})

            return self._send_json({"ok": False, "reason": "notfound"})

        if self.path == "/admin/ban":
            if not is_admin:
                return self._send_json({"ok": False, "reason": "denied"})

            target_hash = data.get("hash")
            if not target_hash:
                return self._send_json({"ok": False, "reason": "notfound"})
            if target_hash == h:
                return self._send_json({"ok": False, "reason": "self"})

            _cache["bans"][target_hash] = True
            try:
                rewrite_bans_file()
            except Exception as e:
                print(f"[admin] ban error: {e}")
                return self._send_json({"ok": False, "reason": "github"})
            return self._send_json({"ok": True})

        if self.path == "/admin/unban":
            if not is_admin:
                return self._send_json({"ok": False, "reason": "denied"})

            target_hash = data.get("hash")
            if not target_hash:
                return self._send_json({"ok": False, "reason": "notfound"})

            if target_hash in _cache["bans"]:
                del _cache["bans"][target_hash]
            try:
                rewrite_bans_file()
            except Exception as e:
                print(f"[admin] unban error: {e}")
                return self._send_json({"ok": False, "reason": "github"})
            return self._send_json({"ok": True})

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
    print("[startup] loading cache from GitHub…")
    refresh_cache()

    threading.Thread(target=run_http_server, daemon=True).start()

    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("code", cmd_code))

    print(f"[bot] starting. code for today: {daily_code()}")
    print(f"[bot] data branch: {DATA_BRANCH}")
    app.run_polling()


if __name__ == "__main__":
    main()
