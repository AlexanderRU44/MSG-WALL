// ============ i18n ============
const TRANSLATIONS = {
  en: {
    "app.title": "Msg Wall",
    "app.slogan": "write it — and it stays",
    "app.meta.total": "total messages: {n}",

    "gate.enter_code": "enter today's code",
    "gate.enter_admin_code": "enter admin code",
    "gate.admin_code_placeholder": "enter admin code",
    "gate.keypad.clear": "CLR",
    "gate.keypad.back": "←",

    "loading.loading": "loading…",
    "loading.admin_activated": "admin mode activated…",
    "status.updated": "// updated: {time}",
    "status.load_error": "// load error: {msg}",

    "messages.empty": "> no messages yet_",
    "messages.banned": "> access denied. you are banned.",

    "input.placeholder": "type a message, @nick or /command…",
    "input.send": "SEND",
    "input.prompt": ">",

    "cmd.nick.desc": "change your nick",
    "cmd.help.desc": "show available commands",
    "cmd.online.desc": "show online users",
    "cmd.lang.desc": "change language (/lang en|ru)",
    "cmd.theme.desc": "change theme (/theme auto|light|dark)",

    "status.cmd.help_header": "Commands:",
    "status.cmd.nick_usage": "/nick <name> — change nick",
    "status.cmd.online_usage": "/online — online users",
    "status.cmd.lang_usage": "/lang en|ru — change language",
    "status.cmd.theme_usage": "/theme auto|light|dark — change theme",
    "status.cmd.checking": "> checking…",
    "status.cmd.online_count": "> online: {n}",
    "status.cmd.nick_usage_error": "error: usage /nick <name>",
    "status.cmd.nick_changing": "> changing nick…",
    "status.cmd.nick_success": "> success: @{nick}",
    "status.cmd.error_prefix": "error: {reason}",
    "status.send.error_prefix": "> error: {reason}",
    "status.cmd.unknown": "error: unknown command",

    "status.lang.usage": "> usage: /lang en|ru",
    "status.lang.unknown": "> unknown language: {lang}. available: {list}",
    "status.lang.changed": "> language changed to: {lang}",

    "status.theme.usage": "> usage: /theme auto|light|dark",
    "status.theme.unknown": "> unknown theme: {theme}. available: auto, light, dark",
    "status.theme.changed": "> theme changed to: {theme}",

    "admin.menu.delete": "Delete message",
    "admin.menu.ban": "Ban user",
    "admin.menu.unban": "Unban user",

    "alert.access_denied": "Access denied",
    "alert.delete_error": "Delete error: {reason}",
    "alert.ban_error": "Error: {reason}",
    "alert.banned_ok": "User banned",
    "alert.unbanned_ok": "User unbanned",
    "alert.no_hash": "No user hash — cannot ban",
    "alert.self_ban": "You cannot ban yourself",
    "alert.fetch_failed": "Failed to fetch messages",

    "reason.banned": "you are banned",
    "reason.code": "invalid code",
    "reason.empty": "empty message",
    "reason.github": "storage error",
    "reason.denied": "denied",
    "reason.notfound": "not found",
    "reason.self": "you cannot ban yourself",
    "reason.short": "nick too short",
    "reason.long": "nick too long",
    "reason.space": "nick contains space",
    "reason.reserved": "nick is reserved",
    "reason.chars": "invalid characters in nick",
    "reason.taken": "nick already taken",
    "reason.cooldown": "nick cooldown, wait {n}s",
    "reason.http": "server error",
    "reason.parse": "parse error",

    "lang.switch": "Language",
  },

  ru: {
    "app.title": "Стена сообщений",
    "app.slogan": "напиши — и останется",
    "app.meta.total": "всего сообщений: {n}",

    "gate.enter_code": "введите код на сегодня",
    "gate.enter_admin_code": "введите код администратора",
    "gate.admin_code_placeholder": "код администратора",
    "gate.keypad.clear": "СБР",
    "gate.keypad.back": "←",

    "loading.loading": "загрузка…",
    "loading.admin_activated": "режим администратора активирован…",
    "status.updated": "// обновлено: {time}",
    "status.load_error": "// ошибка загрузки: {msg}",

    "messages.empty": "> сообщений пока нет_",
    "messages.banned": "> доступ запрещён. вы забанены.",

    "input.placeholder": "введите сообщение, @ник или /команду…",
    "input.send": "ОТПР",
    "input.prompt": ">",

    "cmd.nick.desc": "сменить ник",
    "cmd.help.desc": "показать доступные команды",
    "cmd.online.desc": "показать пользователей онлайн",
    "cmd.lang.desc": "сменить язык (/lang ru|en)",
    "cmd.theme.desc": "сменить тему (/theme auto|light|dark)",

    "status.cmd.help_header": "Команды:",
    "status.cmd.nick_usage": "/nick <имя> — сменить ник",
    "status.cmd.online_usage": "/online — пользователи онлайн",
    "status.cmd.lang_usage": "/lang ru|en — сменить язык",
    "status.cmd.theme_usage": "/theme auto|light|dark — сменить тему",
    "status.cmd.checking": "> проверка…",
    "status.cmd.online_count": "> онлайн: {n}",
    "status.cmd.nick_usage_error": "ошибка: использование /nick <имя>",
    "status.cmd.nick_changing": "> смена ника…",
    "status.cmd.nick_success": "> успех: @{nick}",
    "status.cmd.error_prefix": "ошибка: {reason}",
    "status.send.error_prefix": "> ошибка: {reason}",
    "status.cmd.unknown": "ошибка: неизвестная команда",

    "status.lang.usage": "> использование: /lang ru|en",
    "status.lang.unknown": "> неизвестный язык: {lang}. доступны: {list}",
    "status.lang.changed": "> язык изменён на: {lang}",

    "status.theme.usage": "> использование: /theme auto|light|dark",
    "status.theme.unknown": "> неизвестная тема: {theme}. доступны: auto, light, dark",
    "status.theme.changed": "> тема изменена на: {theme}",

    "admin.menu.delete": "Удалить сообщение",
    "admin.menu.ban": "Забанить пользователя",
    "admin.menu.unban": "Разбанить пользователя",

    "alert.access_denied": "Доступ запрещён",
    "alert.delete_error": "Ошибка удаления: {reason}",
    "alert.ban_error": "Ошибка: {reason}",
    "alert.banned_ok": "Пользователь забанен",
    "alert.unbanned_ok": "Пользователь разбанен",
    "alert.no_hash": "Нет hash пользователя — невозможно забанить",
    "alert.self_ban": "Нельзя забанить самого себя",
    "alert.fetch_failed": "Не удалось получить список сообщений",

    "reason.banned": "вы забанены",
    "reason.code": "неверный код",
    "reason.empty": "пустое сообщение",
    "reason.github": "ошибка хранилища",
    "reason.denied": "доступ запрещён",
    "reason.notfound": "не найдено",
    "reason.self": "нельзя забанить самого себя",
    "reason.short": "ник слишком короткий",
    "reason.long": "ник слишком длинный",
    "reason.space": "ник содержит пробел",
    "reason.reserved": "ник зарезервирован",
    "reason.chars": "недопустимые символы в нике",
    "reason.taken": "ник уже занят",
    "reason.cooldown": "задержка смены ника, подождите {n}с",
    "reason.http": "ошибка сервера",
    "reason.parse": "ошибка разбора",

    "lang.switch": "Язык",
  },
};

const SUPPORTED_LANGS = Object.keys(TRANSLATIONS);
let currentLang = detectLang();

function detectLang() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlLang = (urlParams.get("lang") || "").toLowerCase();
  if (SUPPORTED_LANGS.includes(urlLang)) return urlLang;

  try {
    const saved = (localStorage.getItem("msgwall.lang") || "").toLowerCase();
    if (SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) {}

  const browserLang = (navigator.language || "en").slice(0, 2).toLowerCase();
  if (SUPPORTED_LANGS.includes(browserLang)) return browserLang;

  return "en";
}

function t(key, vars) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  let s = dict[key];
  if (s === undefined) s = (TRANSLATIONS.en && TRANSLATIONS.en[key]);
  if (s === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split("{" + k + "}").join(String(v));
    }
  }
  return s;
}

function getLang() { return currentLang; }
function getSupportedLangs() { return SUPPORTED_LANGS.slice(); }

function setLang(lang) {
  const l = String(lang || "").toLowerCase();
  if (!SUPPORTED_LANGS.includes(l)) return false;
  currentLang = l;
  try { localStorage.setItem("msgwall.lang", l); } catch (e) {}
  applyTranslations();
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang: l } }));
  return true;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    el.setAttribute("title", t(key));
  });
  document.documentElement.lang = currentLang;
  document.title = t("app.title");
}

window.t = t;
window.getLang = getLang;
window.getSupportedLangs = getSupportedLangs;
window.setLang = setLang;
window.applyTranslations = applyTranslations;