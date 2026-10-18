// ==== Высота экрана ====
function adjustHeight() {
  const app = document.getElementById('app-container');
  if (!app) return;
  if (window.visualViewport) {
    app.style.height = window.visualViewport.height + 'px';
    if (document.activeElement === document.getElementById('msg-input')) {
      setTimeout(() => {
        const messagesEl = document.getElementById('messages');
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 100);
    }
  } else {
    app.style.height = window.innerHeight + 'px';
  }
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustHeight);
  window.visualViewport.addEventListener('scroll', adjustHeight);
}
window.addEventListener('resize', adjustHeight);
window.addEventListener('orientationchange', adjustHeight);
document.addEventListener('DOMContentLoaded', adjustHeight);
adjustHeight();

// ============ Логика ============
const API = "https://msg-wall.onrender.com";
const REFRESH_MS = 5000;
const SLOGAN_TEXT = "write it — and it stays";

const PALETTE = [
  { accent: "#ff6b6b" }, { accent: "#ffa94d" }, { accent: "#ffd43b" }, { accent: "#a9e34b" },
  { accent: "#51cf66" }, { accent: "#38d9a9" }, { accent: "#4dabf7" }, { accent: "#748ffc" },
  { accent: "#b197fc" }, { accent: "#da77f2" }, { accent: "#f783ac" }, { accent: "#ced4da" },
];

function hashIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}
function colorForHash(h) {
  return PALETTE[hashIndex(String(h).toLowerCase(), PALETTE.length)];
}

function findHashByNick(nick) {
  for (const [hash, n] of Object.entries(nicksMap)) {
    if (n === nick) return hash;
  }
  return nick;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function formatLocalFromUTC(whenStr) {
  if (!whenStr) return "";
  const iso = whenStr.replace(" ", "T") + "Z";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return whenStr;
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function nowLocalString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.random() * (b - a) + a;
const PROMPT_HTML = '<span class="prompt">&gt;</span> ';
const CURSOR_HTML = '<span class="cursor"></span>';

async function typeInto(el, text, charMin, charMax) {
  let typed = "";
  el.innerHTML = PROMPT_HTML + typed + CURSOR_HTML;
  for (let i = 0; i < text.length; i++) {
    typed += text[i];
    el.innerHTML = PROMPT_HTML + typed + CURSOR_HTML;
    await sleep(rand(charMin, charMax));
  }
  el.innerHTML = PROMPT_HTML + typed;
}

async function typeCentered(el, text, charMin, charMax) {
  el.innerHTML = '<span class="center-line"></span>';
  const line = el.querySelector(".center-line");
  let typed = "";
  line.innerHTML = typed + CURSOR_HTML;
  for (let i = 0; i < text.length; i++) {
    typed += text[i];
    line.innerHTML = typed + CURSOR_HTML;
    await sleep(rand(charMin, charMax));
  }
  line.innerHTML = typed;
}

// ============ State ============
let codeValue = "";
let isAdminMode = false;
let unlocked = false;
let sessionCode = null;
let myHash = null;
let myNick = null;
let nicksMap = {};
let bansMap = {}; 
let renderedCount = -1;
let allItems = [];
let isPrinting = false;

// ============ DOM ============
const sloganEl  = document.getElementById("slogan");
const metaEl    = document.getElementById("meta");
const loadingEl = document.getElementById("loading");
const gateEl    = document.getElementById("gate");
const messagesEl= document.getElementById("messages");
const digitsEl  = document.getElementById("digits");
const keypadEl  = document.getElementById("keypad");
const inputArea = document.getElementById("input-area");
const msgInput  = document.getElementById("msg-input");
const sendBtn   = document.getElementById("send-btn");
const dropdownMenu = document.getElementById("dropdown-menu");
const hiddenInput = document.getElementById("hidden-input");

// Создаем контекстное меню
const contextMenu = document.createElement("div");
contextMenu.id = "admin-context-menu";
contextMenu.style.cssText = "display: none; position: fixed; background: #141414; border: 1px solid #333; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.8); z-index: 1000; padding: 8px 0; min-width: 150px;";
document.body.appendChild(contextMenu);
document.addEventListener("click", () => { contextMenu.style.display = "none"; });

// ============ Проверка режима админа ============
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('admin')) {
  if (hiddenInput) hiddenInput.style.display = "none";
  if (digitsEl) digitsEl.style.display = "none";
  if (keypadEl) keypadEl.style.display = "none";

  const adminArea = document.getElementById("admin-input-area");
  if (adminArea) {
    adminArea.style.display = "block";
    document.getElementById("gate-hint").textContent = "enter admin code";
    const adminInput = document.getElementById("admin-code-input");
    adminInput.focus();
    adminInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const code = adminInput.value.trim();
        if (!code) return;
        adminInput.disabled = true;
        const res = await apiPost("/verify", { code });
        adminInput.disabled = false;
        if (res.ok && res.is_admin) {
          isAdminMode = true;
          sessionCode = code;
          bansMap = res.bans || {};
          myHash = res.hash;
          myNick = res.nick;
          unlocked = true;  // ← КЛЮЧЕВОЙ ФИКС: включаем refresh для админа
          gateEl.classList.remove("visible");
          loadingEl.classList.remove("hidden");
          await typeCentered(loadingEl, "admin mode activated…", 40, 90);
          await sleep(400);
          loadingEl.classList.add("hidden");
          try {
            allItems = await fetchMessages();
            nicksMap = await fetchNicks();
          } catch (err) {
            allItems = [];
            nicksMap = {};
          }
          await renderMessages(allItems);
          renderedCount = allItems.length;
          metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
          inputArea.classList.add("visible");
          msgInput.focus();
        } else {
          alert("Access denied");
          adminInput.value = "";
        }
      }
    });
  }
} else {
  // Обычный режим
  document.addEventListener("paste", (e) => {
    if (!gateEl.classList.contains("visible")) return;
    const pasted = (e.clipboardData || window.clipboardData).getData("text");
    if (pasted) {
      codeValue = pasted.trim();
      updateDigitsUI();
      if (codeValue.length > 4 || /[a-zA-Z]/.test(codeValue)) {
        submitCode();
      } else if (codeValue.length === 4) {
        setTimeout(submitCode, 200);
      }
    }
  });
}

// ============ Fetch ============
async function fetchMessages() {
  const res = await fetch(API + "/messages?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("messages HTTP " + res.status);
  const data = await res.json();
  return data.messages || [];
}

async function fetchNicks() {
  const res = await fetch(API + "/nicks?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("nicks HTTP " + res.status);
  const data = await res.json();
  return data.nicks || {};
}

async function apiPost(path, payload) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return { ok: false, reason: "http" };
  try { return await res.json(); }
  catch { return { ok: false, reason: "parse" }; }
}

function scrollToBottom() {
  setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 50);
}

// ============ Рендер ============
function authorLabelFor(msg) {
  if (msg.system) return null;
  if (msg.admin) return { text: "@Administrator", isAdmin: true };
  if (msg.nick) return { text: "@" + msg.nick };
  const n = nicksMap[msg.ip_hash];
  if (n) return { text: "@" + n };
  return { text: "@" + msg.ip_hash };
}

function renderSystemText(text) {
  if (!text) return "";
  return text.replace(/@([a-zA-Z0-9_\-а-яА-Я]+)/g, (match, nick) => {
    const hash = findHashByNick(nick);
    const color = colorForHash(hash).accent;
    return `<span class="nick-mention" style="color: ${color};">@${escapeHtml(nick)}</span>`;
  });
}

function buildMessageHTML(m, idx) {
  if (m.system || m.admin) {
    const who = m.admin ? "@Administrator " : "";
    return `
      <div class="msg system" data-when="${m.when}">
        <span class="when">${escapeHtml(formatLocalFromUTC(m.when || ""))}</span>
        <span class="text">${who}${renderSystemText(m.text || "")}</span>
      </div>
    `;
  }

  const c = colorForHash(m.ip_hash);
  const a = authorLabelFor(m);
  const when = formatLocalFromUTC(m.when || "");
  
  let replyHtml = "";
  if (m.reply_to) {
    let targetHash = m.reply_to;
    for (const [hash, nick] of Object.entries(nicksMap)) {
      if (nick === m.reply_to) { targetHash = hash; break; }
    }
    const targetColor = colorForHash(targetHash).accent;
    replyHtml = `
      <span class="reply-arrow">→</span>
      <span class="reply-target" style="color: ${targetColor};">@${escapeHtml(m.reply_to)}</span>
    `;
  }

  const whoClick = (isAdminMode && !a.isAdmin) ? `onclick="showAdminMenu(event, '${m.when}', '${m.ip_hash}')" style="cursor:pointer;"` : "";
  const whoHtml = `<span class="who" ${whoClick}>${escapeHtml(a.text)}</span>`;

  return `
    <div class="msg" data-when="${m.when}" style="--accent:${c.accent}; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px;">
      <span class="when">${escapeHtml(when)}</span>
      ${whoHtml}
      ${replyHtml}
      <span class="text">${escapeHtml(m.text || "")}</span>
    </div>
  `;
}

async function animatePrintMessage(m) {
  isPrinting = true;
  const div = document.createElement("div");
  if (m.system || m.admin) {
    const who = m.admin ? "@Administrator " : "";
    div.className = "msg system";
    div.dataset.when = m.when;
    div.innerHTML = `<span class="when">${escapeHtml(formatLocalFromUTC(m.when || ""))}</span> <span class="text"></span>`;
    messagesEl.appendChild(div);
    scrollToBottom();
    const textEl = div.querySelector(".text");
    const fullText = who + (m.text || "");
    for (let i = 0; i < fullText.length; i++) {
      textEl.textContent += fullText[i];
      scrollToBottom();
      await sleep(rand(15, 40));
    }
    textEl.innerHTML = renderSystemText(fullText);
  } else {
    const c = colorForHash(m.ip_hash);
    const a = authorLabelFor(m);
    const when = formatLocalFromUTC(m.when || "");
    let replyHtml = "";
    if (m.reply_to) {
      let targetHash = m.reply_to;
      for (const [hash, nick] of Object.entries(nicksMap)) {
        if (nick === m.reply_to) { targetHash = hash; break; }
      }
      const targetColor = colorForHash(targetHash).accent;
      replyHtml = `<span class="reply-arrow">→</span><span class="reply-target" style="color: ${targetColor};">@${escapeHtml(m.reply_to)}</span>`;
    }
    
    div.className = "msg";
    div.dataset.when = m.when;
    div.style.setProperty("--accent", c.accent);
    div.style.display = "flex";
    div.style.flexWrap = "wrap";
    div.style.alignItems = "baseline";
    div.style.gap = "4px";
    div.innerHTML = `
      <span class="when">${escapeHtml(when)}</span>
      <span class="who">${escapeHtml(a.text)}</span>
      ${replyHtml}
      <span class="text"></span>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
    const textEl = div.querySelector(".text");
    const text = m.text || "";
    for (let i = 0; i < text.length; i++) {
      textEl.textContent += text[i];
      scrollToBottom();
      await sleep(rand(15, 40));
    }
  }
  isPrinting = false;
}

async function renderMessages(items) {
  if (items.length === 0) {
    messagesEl.innerHTML = '<div class="tline"><span class="dim">&gt; no messages yet_</span></div>';
    return;
  }
  if (isPrinting) return;
  messagesEl.innerHTML = items.map((m, i) => buildMessageHTML(m, i)).join("");
  renderedCount = items.length;
  scrollToBottom();
}

async function printLocalStatus(textLines) {
  const div = document.createElement("div");
  div.className = "msg local-status";
  div.innerHTML = `<span class="text" style="color:#888888; white-space: pre-wrap;"></span>`;
  messagesEl.appendChild(div);
  scrollToBottom();
  const textEl = div.querySelector(".text");
  const fullText = textLines.join("\n");
  for (let i = 0; i < fullText.length; i++) {
    textEl.textContent += fullText[i];
    scrollToBottom();
    await sleep(rand(15, 30));
  }
  await sleep(4000);
  for (let i = fullText.length; i > 0; i--) {
    textEl.textContent = fullText.slice(0, i - 1);
    scrollToBottom();
    await sleep(rand(10, 20));
  }
  div.remove();
}

// ============ Контекстное меню админа ============
window.showAdminMenu = function(e, when, hash) {
  if (!isAdminMode) return;
  e.stopPropagation();
  
  const isBanned = bansMap[hash] === true;
  const banText = isBanned ? "Разбанить пользователя" : "Забанить пользователя";
  
  contextMenu.innerHTML = `
    <div class="menu-item" onclick="deleteMsg('${when}')" style="padding: 10px 16px; cursor: pointer; color: #ff6b6b;">Удалить сообщение</div>
    <div class="menu-item" onclick="toggleBan('${hash}')" style="padding: 10px 16px; cursor: pointer; color: #ffa94d;">${banText}</div>
  `;
  
  const rect = e.target.getBoundingClientRect();
  contextMenu.style.display = "block";
  contextMenu.style.left = Math.min(rect.left, window.innerWidth - 200) + "px";
  contextMenu.style.top = (rect.bottom + 10) + "px";
};

async function eraseElement(el) {
  const textEl = el.querySelector(".text");
  if (textEl) {
    const fullText = textEl.textContent;
    for (let i = fullText.length; i > 0; i--) {
      textEl.textContent = fullText.slice(0, i - 1);
      await sleep(10);
    }
  }
  el.style.transition = "opacity 0.3s";
  el.style.opacity = "0";
  await sleep(300);
  el.remove();
}

window.deleteMsg = async function(whenStr) {
  contextMenu.style.display = "none";
  const idx = allItems.findIndex(m => m.when === whenStr);
  if (idx === -1) return;

  const res = await apiPost("/admin/delete", { code: sessionCode, index: idx });
  if (res.ok) {
    const msgEls = messagesEl.querySelectorAll(".msg");
    for (const el of msgEls) {
      if (el.dataset.when === whenStr) {
        await eraseElement(el);
        break;
      }
    }
    try {
      allItems = await fetchMessages();
      renderedCount = allItems.length;
      metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
    } catch(e){}
  } else {
    alert("Ошибка удаления");
  }
};

window.toggleBan = async function(hash) {
  contextMenu.style.display = "none";
  const isBanned = bansMap[hash] === true;
  const endpoint = isBanned ? "/admin/unban" : "/admin/ban";
  
  const res = await apiPost(endpoint, { code: sessionCode, hash: hash });
  if (res.ok) {
    bansMap[hash] = !isBanned;
    alert(isBanned ? "Пользователь разбанен" : "Пользователь забанен");
    try {
      allItems = await fetchMessages();
      renderMessages(allItems);
      renderedCount = allItems.length;
    } catch(e){}
  } else {
    alert("Ошибка");
  }
};

// ============ Code gate ============
function updateDigitsUI() {
  const cells = digitsEl.querySelectorAll(".digit");
  if (codeValue.length > 4 || /[a-zA-Z]/.test(codeValue)) {
    cells.forEach(cell => { cell.textContent = "*"; cell.classList.remove("active"); });
    return;
  }
  cells.forEach((cell, i) => {
    if (i < codeValue.length) { cell.textContent = codeValue[i]; cell.classList.remove("active"); }
    else { cell.textContent = ""; cell.classList.toggle("active", i === codeValue.length); }
  });
}

async function submitCode() {
  if (codeValue.length < 4) return;
  const code = codeValue;
  const res = await apiPost("/verify", { code });
  if (!res.ok) {
    if (res.reason === "banned") {
      gateEl.classList.remove("visible");
      messagesEl.innerHTML = '<div class="tline"><span class="err" style="font-size: 1.2rem; display: block; margin-top: 20px;">&gt; access denied. you are banned.</span></div>';
      inputArea.classList.remove("visible");
      return;
    }
    codeValue = ""; if (hiddenInput) hiddenInput.value = ""; updateDigitsUI(); return;
  }
  unlocked = true; sessionCode = code; myHash = res.hash; myNick = res.nick; bansMap = res.bans || {};
  codeValue = ""; if (hiddenInput) hiddenInput.value = ""; updateDigitsUI();
  gateEl.classList.remove("visible");
  loadingEl.textContent = ""; loadingEl.classList.remove("hidden");
  await typeCentered(loadingEl, "loading…", 40, 90);
  await sleep(400); loadingEl.classList.add("hidden");
  try {
    allItems = await fetchMessages();
    nicksMap = await fetchNicks();
  } catch (e) {
    allItems = [];
    nicksMap = {};
  }
  await renderMessages(allItems);
  renderedCount = allItems.length;
  metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
  inputArea.classList.add("visible");
  if (msgInput) msgInput.focus();
  setTimeout(adjustHeight, 100);
}

if (keypadEl) {
  keypadEl.addEventListener("click", e => {
    const btn = e.target.closest("button[data-key]"); if (!btn) return;
    const key = btn.dataset.key;
    if (key === "clear") { codeValue = ""; if (hiddenInput) hiddenInput.value = ""; updateDigitsUI(); return; }
    if (key === "back") { codeValue = codeValue.slice(0, -1); if (hiddenInput) hiddenInput.value = codeValue; updateDigitsUI(); return; }
    if (codeValue.length >= 4 && !/[a-zA-Z]/.test(codeValue)) return;
    codeValue += key; if (hiddenInput) hiddenInput.value = codeValue; updateDigitsUI();
    if (codeValue.length === 4) setTimeout(submitCode, 200);
  });
}

// ============ Dropdown ============
const COMMANDS = [
  { cmd: "nick", desc: "change your nick" },
  { cmd: "help", desc: "show available commands" },
  { cmd: "online", desc: "show online users" }
];

if (msgInput) {
  msgInput.addEventListener("keyup", () => {
    const val = msgInput.value; const cursorPos = msgInput.selectionStart; const textBeforeCursor = val.slice(0, cursorPos);
    const lastAt = textBeforeCursor.lastIndexOf("@"); const lastSlash = textBeforeCursor.lastIndexOf("/");
    if (lastSlash !== -1 && lastSlash > lastAt && (lastSlash === 0 || textBeforeCursor[lastSlash - 1] === " ")) {
      const query = textBeforeCursor.slice(lastSlash + 1);
      if (query.includes(" ")) { dropdownMenu.classList.remove("visible"); return; }
      const filtered = COMMANDS.filter(c => c.cmd.startsWith(query.toLowerCase()));
      if (filtered.length === 0) { dropdownMenu.classList.remove("visible"); return; }
      dropdownMenu.innerHTML = filtered.map(c => `<div class="dropdown-item" data-type="cmd" data-val="${c.cmd}"><span>/${c.cmd}</span><span class="cmd-desc">${c.desc}</span></div>`).join("");
      dropdownMenu.classList.add("visible"); return;
    }
    if (lastAt !== -1 && lastAt > lastSlash) {
      const query = textBeforeCursor.slice(lastAt + 1);
      if (query.includes(" ")) { dropdownMenu.classList.remove("visible"); return; }
      const allNicks = []; for (const [hash, nick] of Object.entries(nicksMap)) allNicks.push({ hash, nick });
      const filtered = allNicks.filter(item => item.nick.toLowerCase().includes(query.toLowerCase()));
      if (filtered.length === 0) { dropdownMenu.classList.remove("visible"); return; }
      dropdownMenu.innerHTML = filtered.map(item => {
        const c = colorForHash(item.hash);
        return `<div class="dropdown-item" data-type="nick" data-val="${escapeHtml(item.nick)}"><span class="nick-color" style="color: ${c.accent}">@${escapeHtml(item.nick)}</span></div>`;
      }).join("");
      dropdownMenu.classList.add("visible"); return;
    }
    dropdownMenu.classList.remove("visible");
  });
}

if (dropdownMenu) {
  dropdownMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item"); if (!item) return;
    const type = item.dataset.type; const val = item.dataset.val;
    const valText = msgInput.value; const cursorPos = msgInput.selectionStart; const textBeforeCursor = valText.slice(0, cursorPos);
    let newValue = "";
    if (type === "nick") {
      const lastAt = textBeforeCursor.lastIndexOf("@");
      newValue = valText.slice(0, lastAt) + "@" + val + " " + valText.slice(cursorPos);
    } else if (type === "cmd") {
      const lastSlash = textBeforeCursor.lastIndexOf("/");
      newValue = valText.slice(0, lastSlash) + "/" + val + " " + valText.slice(cursorPos);
    }
    msgInput.value = newValue; dropdownMenu.classList.remove("visible"); msgInput.focus();
  });
}

document.addEventListener("click", (e) => {
  if (dropdownMenu && !dropdownMenu.contains(e.target) && e.target !== msgInput) {
    dropdownMenu.classList.remove("visible");
  }
});

// ============ Send ============
async function sendMessage() {
  const rawText = msgInput.value.trim(); if (!rawText || !sessionCode) return;
  if (rawText.startsWith("/")) {
    const parts = rawText.split(" "); const cmd = parts[0].toLowerCase(); const arg = parts.slice(1).join(" ").trim();
    if (cmd === "/help") { msgInput.value = ""; printLocalStatus(["Commands:", "/nick <name> — change nick", "/online — online users"]); return; }
    if (cmd === "/online") {
      msgInput.value = ""; printLocalStatus(["> checking…"]);
      try { const res = await fetch(API + "/online"); const data = await res.json(); printLocalStatus([`> online: ${data.online}`]); } catch (e) {}
      return;
    }
    if (cmd === "/nick") {
      if (!arg) { msgInput.value = ""; printLocalStatus(["error: usage /nick <name>"]); return; }
      msgInput.value = ""; printLocalStatus(["> changing nick…"]);
      const res = await apiPost("/nick", { code: sessionCode, nick: arg });
      if (!res.ok) { printLocalStatus(["error: " + res.reason]); return; }
      myNick = res.nick; printLocalStatus([`> success: @${res.nick}`]);
      try {
        nicksMap = await fetchNicks();
        allItems = await fetchMessages();
        renderMessages(allItems);
        renderedCount = allItems.length;
        metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
      } catch (e) {}
      return;
    }
    msgInput.value = ""; printLocalStatus(["error: unknown command"]); return;
  }
  let replyTo = null; let textToSend = rawText;
  const match = rawText.match(/^@([a-zA-Z0-9_\-а-яА-Я]+)\s+(.+)$/);
  if (match) { const targetNick = match[1]; const remainingText = match[2]; if (Object.values(nicksMap).includes(targetNick)) { replyTo = targetNick; textToSend = remainingText; } }
  sendBtn.disabled = true; msgInput.value = "";
  const payload = { code: sessionCode, text: textToSend }; if (replyTo) payload.reply_to = replyTo;
  const res = await apiPost("/post", payload); sendBtn.disabled = false;
  if (!res.ok) { printLocalStatus(["> error: " + res.reason]); return; }
  try {
    const newItems = await fetchMessages(); const oldCount = allItems.length; const newMessages = newItems.slice(oldCount);
    allItems = newItems;
    metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
    for (const m of newMessages) { await animatePrintMessage(m); await sleep(300); }
    renderedCount = allItems.length;
  } catch (e) {}
}
if (sendBtn) sendBtn.addEventListener("click", sendMessage);

// ============ Periodic refresh ============
async function refresh() {
  // Работает и для пользователя, и для админа — как только есть сессия
  if (!sessionCode) return;
  if (isPrinting) return;
  try {
    const items = await fetchMessages();
    
    if (items.length < renderedCount) {
      // Удаление (возможно, админом)
      const newWhes = new Set(items.map(m => m.when));
      const msgEls = messagesEl.querySelectorAll(".msg");
      
      for (const el of msgEls) {
        if (!newWhes.has(el.dataset.when)) {
          await eraseElement(el);
        }
      }
      allItems = items;
      renderedCount = items.length;
      metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
    } else if (items.length > renderedCount) {
      // Новые сообщения
      const newMessages = items.slice(renderedCount);
      allItems = items;
      // Обновляем ники перед печатью новых сообщений
      try { nicksMap = await fetchNicks(); } catch (e) {}
      for (const m of newMessages) { await animatePrintMessage(m); await sleep(300); }
      metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
      renderedCount = items.length;
    } else {
      // Ничего не изменилось, но ники могли обновиться
      allItems = items;
    }
    
    document.getElementById("status").textContent = "// updated: " + nowLocalString();
  } catch (e) {
    document.getElementById("status").textContent = "// load error: " + e.message;
  }
}

// ============ Запуск интервала ============
let refreshIntervalSet = false;
function startRefreshInterval() {
  if (refreshIntervalSet) return;
  refreshIntervalSet = true;
  setInterval(refresh, REFRESH_MS);
}

// ============ Bootstrap ============
let bootstrapped = false;
async function bootstrap() {
  if (bootstrapped) return; bootstrapped = true;
  await typeInto(sloganEl, SLOGAN_TEXT, 30, 70);
  await sleep(300);
  try { allItems = await fetchMessages(); nicksMap = await fetchNicks(); } catch (e) { allItems = []; nicksMap = {}; }
  await typeInto(metaEl, "total messages: " + allItems.length, 25, 50);
  gateEl.classList.add("visible");
  updateDigitsUI();
}
bootstrap();

// Запускаем интервал сразу (он сам проверит sessionCode)
startRefreshInterval();
