# Msg Wall

Стена сообщений на Telegram + GitHub Pages.
Напиши — и оно останется.

## Как это работает

Telegram-бот → GitHub (`messages.jsonl`) → GitHub Pages (`index.html`)

- **Бот** принимает сообщения и дописывает их в файл в репозитории.
- **GitHub** хранит все сообщения в открытом виде.
- **Сайт** читает файл и показывает ленту с автообновлением.

Никаких серверов, баз данных и токенов на клиенте.

## Развёртывание

1. Форкни репозиторий.
2. Создай бота у [@BotFather](https://t.me/BotFather), получи токен.
3. Создай GitHub PAT с правом `repo`.
4. Задеплой `bot.py` на Render / Railway с переменными окружения:
   - `TELEGRAM_TOKEN`
   - `GITHUB_TOKEN`
   - `REPO_NAME` (например, `user/msg-wall`)
   - `FILE_PATH` (по умолчанию `messages.jsonl`)
5. Включи GitHub Pages: Settings → Pages → Source: `main`, папка `/`.

## Файлы

- `bot.py` — Telegram-бот
- `index.html` — сайт стены
- `messages.jsonl` — хранилище сообщений
- `requirements.txt` — зависимости Python

## Формат сообщения

Каждая строка в `messages.jsonl` — отдельный JSON-объект:

```json
{"when":"2026-10-16 14:32:05","id":12345,"who":"@vasya","text":"Привет"}
