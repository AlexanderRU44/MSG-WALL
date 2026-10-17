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
let unlocked = false;
let sessionCode = null;
let myHash = null;
let myNick = null;
let nicksMap = {};
let renderedCount = -1;
let allItems = [];
let isPrinting = false;
let currentOnline = 0;

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

function updateOnlineDisplay() {
  const el = document.getElementById("online-count");
  if (el) {
    el.textContent = `> online: ${currentOnline}`;
  }
}

// ============ Fetch ============
async function fetchMessages() {
  const res = await fetch(API + "/messages?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("messages HTTP " + res.status);
  const data = await res.json();
  
  if (data.online !== undefined) {
    currentOnline = data.online;
    updateOnlineDisplay();
  }
  
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
  setTimeout(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }, 50);
}

// ============ Рендер ============
function authorLabelFor(msg) {
  if (msg.system) return null;
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

function buildMessageHTML(m) {
  if (m.system) {
    return `
      <div class="msg system">
        <span class="when">${escapeHtml(formatLocalFromUTC(m.when || ""))}</span>
        <span class="text">${renderSystemText(m.text || "")}</span>
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

  return `
    <div class="msg" style="--accent:${c.accent};">
      <span class="when">${escapeHtml(when)}</span>
      <span class="who">${escapeHtml(a.text)}</span>
      ${replyHtml}
      <span class="text">${escapeHtml(m.text || "")}</span>
    </div>
  `;
}

async function animatePrintMessage(m) {
  isPrinting = true;
  
  const div = document.createElement("div");
  
  if (m.system) {
    div.className = "msg system";
    div.innerHTML = `<span class="when">${escapeHtml(formatLocalFromUTC(m.when || ""))}</span> <span class="text"></span>`;
    
    messagesEl.appendChild(div);
    scrollToBottom();
    
    const textEl = div.querySelector(".text");
    const fullText = m.text || "";
    
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
    div.style.setProperty("--accent", c.accent);
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
  
  messagesEl.innerHTML = items.map(m => buildMessageHTML(m)).join("");
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

// ============ Dropdown ============
const COMMANDS = [
  { cmd: "nick", desc: "change your nick (e.g. /nick Vasya)" },
  { cmd: "help", desc: "show available commands" }
];

msgInput.addEventListener("input", () => {
  const val = msgInput.value;
  const cursorPos = msgInput.selectionStart;
  const textBeforeCursor = val.slice(0, cursorPos);
  
  const lastAt = textBeforeCursor.lastIndexOf("@");
  const lastSlash = textBeforeCursor.lastIndexOf("/");

  if (lastSlash !== -1 && lastSlash > lastAt && (lastSlash === 0 || textBeforeCursor[lastSlash - 1] === " ")) {
    const query = textBeforeCursor.slice(lastSlash + 1);
    if (query.includes(" ")) { dropdownMenu.classList.remove("visible"); return; }
    
    const filtered = COMMANDS.filter(c => c.cmd.startsWith(query.toLowerCase()));
    if (filtered.length === 0) { dropdownMenu.classList.remove("visible"); return; }

    dropdownMenu.innerHTML = filtered.map(c => `
      <div class="dropdown-item" data-type="cmd" data-val="${c.cmd}">
        <span>/${c.cmd}</span>
        <span class="cmd-desc">${c.desc}</span>
      </div>
    `).join("");

    dropdownMenu.classList.add("visible");
    return;
  }

  if (lastAt !== -1 && lastAt > lastSlash) {
    const query = textBeforeCursor.slice(lastAt + 1);
    if (query.includes(" ")) { dropdownMenu.classList.remove("visible"); return; }

    const allNicks = [];
    for (const [hash, nick] of Object.entries(nicksMap)) {
      allNicks.push({ hash, nick });
    }

    const filtered = allNicks.filter(item => item.nick.toLowerCase().includes(query.toLowerCase()));
    if (filtered.length === 0) { dropdownMenu.classList.remove("visible"); return; }

    dropdownMenu.innerHTML = filtered.map(item => {
      const c = colorForHash(item.hash);
      return `<div class="dropdown-item" data-type="nick" data-val="${escapeHtml(item.nick)}">
        <span class="nick-color" style="color: ${c.accent}">@${escapeHtml(item.nick)}</span>
      </div>`;
    }).join("");

    dropdownMenu.classList.add("visible");
    return;
  }

  dropdownMenu.classList.remove("visible");
});

dropdownMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".dropdown-item");
  if (!item) return;
  
  const type = item.dataset.type;
  const val = item.dataset.val;
  const valText = msgInput.value;
  const cursorPos = msgInput.selectionStart;
  const textBeforeCursor = valText.slice(0, cursorPos);
  
  let newValue = "";
  
  if (type === "nick") {
    const lastAt = textBeforeCursor.lastIndexOf("@");
    newValue = valText.slice(0, lastAt) + "@" + val + " " + valText.slice(cursorPos);
  } else if (type === "cmd") {
    const lastSlash = textBeforeCursor.lastIndexOf("/");
    newValue = valText.slice(0, lastSlash) + "/" + val + " " + valText.slice(cursorPos);
  }
  
  msgInput.value = newValue;
  dropdownMenu.classList.remove("visible");
  msgInput.focus();
});

document.addEventListener("click", (e) => {
  if (!dropdownMenu.contains(e.target) && e.target !== msgInput) {
    dropdownMenu.classList.remove("visible");
  }
});

// ============ Bootstrap ============
let bootstrapped = false;
async function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  await typeInto(sloganEl, SLOGAN_TEXT, 30, 70);
  await sleep(300);

  try {
    allItems = await fetchMessages();
    nicksMap = await fetchNicks();
  } catch (e) {
    allItems = []; nicksMap = {};
  }

  await typeInto(metaEl, "total messages: " + allItems.length, 25, 50);

  gateEl.classList.add("visible");
  updateDigitsUI();
}

// ============ Code gate ============
function updateDigitsUI() {
  const cells = digitsEl.querySelectorAll(".digit");
  cells.forEach((cell, i) => {
    if (i < codeValue.length) {
      cell.textContent = codeValue[i];
      cell.classList.remove("active");
    } else {
      cell.textContent = "";
      cell.classList.toggle("active", i === codeValue.length);
    }
  });
}

async function submitCode() {
  if (codeValue.length < 4) return;

  const code = codeValue;
  const res = await apiPost("/verify", { code });

  if (!res.ok) {
    codeValue = "";
    updateDigitsUI();
    return;
  }

  unlocked = true;
  sessionCode = code;
  myHash = res.hash;
  myNick = res.nick;

  codeValue = "";
  updateDigitsUI();
  gateEl.classList.remove("visible");

  loadingEl.textContent = "";
  loadingEl.classList.remove("hidden");
  await typeCentered(loadingEl, "loading…", 40, 90);
  await sleep(400);
  loadingEl.classList.add("hidden");

  try {
    allItems = await fetchMessages();
    nicksMap = await fetchNicks();
  } catch (e) { /* ignore */ }

  messagesEl.innerHTML = allItems.map(m => buildMessageHTML(m)).join("");
  renderedCount = allItems.length;
  scrollToBottom();
  
  inputArea.classList.add("visible");
  msgInput.focus();
  setTimeout(adjustHeight, 100);
}

keypadEl.addEventListener("click", e => {
  const btn = e.target.closest("button[data-key]");
  if (!btn) return;
  const key = btn.dataset.key;

  if (key === "clear") { codeValue = ""; updateDigitsUI(); return; }
  if (key === "back")  { codeValue = codeValue.slice(0, -1); updateDigitsUI(); return; }

  if (codeValue.length >= 4) return;
  codeValue += key;
  updateDigitsUI();
  if (codeValue.length === 4) setTimeout(submitCode, 200);
});

document.addEventListener("keydown", e => {
  if (!gateEl.classList.contains("visible")) {
    if (e.key === "Enter" && document.activeElement === msgInput) sendMessage();
    return;
  }
  if (e.key >= "0" && e.key <= "9") {
    if (codeValue.length < 4) {
      codeValue += e.key; updateDigitsUI();
      if (codeValue.length === 4) setTimeout(submitCode, 200);
    }
  } else if (e.key === "Backspace") {
    codeValue = codeValue.slice(0, -1); updateDigitsUI();
  } else if (e.key === "Escape") {
    codeValue = ""; updateDigitsUI();
  }
});

// ============ Send ============
async function sendMessage() {
  const rawText = msgInput.value.trim();
  if (!rawText || !sessionCode) return;

  if (rawText.startsWith("/")) {
    const parts = rawText.split(" ");
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    if (cmd === "/help" || cmd === "/commands") {
      msgInput.value = "";
      printLocalStatus(["Available commands:", "/nick <name> — change your nick", "/help — show this list"]);
      return;
    }

    if (cmd === "/nick" || cmd === "/name") {
      if (!arg) {
        msgInput.value = "";
        printLocalStatus(["error: usage /nick <name>"]);
        return;
      }

      msgInput.value = "";
      printLocalStatus(["> changing nick…"]);
      
      const res = await apiPost("/nick", { code: sessionCode, nick: arg });

      if (!res.ok) {
        const reasons = {
          short: "nick must be 2–20 characters",
          long: "nick must be 2–20 characters",
          space: "no spaces allowed",
          chars: "only letters, digits, _ and -",
          reserved: "this nick is reserved",
          taken: "this nick is already taken, try another",
          cooldown: `wait ${res.wait || 0}s before changing again`,
          github: "storage error",
          code: "code expired, reload page",
          http: "server error"
        };
        printLocalStatus(["error: " + (reasons[res.reason] || res.reason)]);
        return;
      }

      myNick = res.nick;
      printLocalStatus([`> success: your nick is now @${res.nick}`]);

      try {
        nicksMap = await fetchNicks();
        allItems = await fetchMessages();
        messagesEl.innerHTML = allItems.map(m => buildMessageHTML(m)).join("");
        renderedCount = allItems.length;
        metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
        scrollToBottom();
      } catch (e) { /* ignore */ }
      
      return;
    }

    msgInput.value = "";
    printLocalStatus(["error: unknown command. type /help"]);
    return;
  }

  let replyTo = null;
  let textToSend = rawText;
  
  const match = rawText.match(/^@([a-zA-Z0-9_\-а-яА-Я]+)\s+(.+)$/);
  if (match) {
    const targetNick = match[1];
    const remainingText = match[2];
    const knownNicks = Object.values(nicksMap);
    if (knownNicks.includes(targetNick)) {
      replyTo = targetNick;
      textToSend = remainingText;
    }
  }

  sendBtn.disabled = true;
  msgInput.value = ""; 

  const payload = { code: sessionCode, text: textToSend };
  if (replyTo) payload.reply_to = replyTo;

  const res = await apiPost("/post", payload);
  sendBtn.disabled = false;

  if (!res.ok) {
    const reasons = {
      code: "code expired, reload page",
      empty: "message is empty",
      github: "storage error",
      http: "server error"
    };
    printLocalStatus(["> error: " + (reasons[res.reason] || res.reason)]);
    return;
  }

  try {
    const newItems = await fetchMessages();
    const oldCount = allItems.length;
    const newMessages = newItems.slice(oldCount);
    
    allItems = newItems;
    metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
    
    for (const m of newMessages) {
      await animatePrintMessage(m);
      await sleep(300);
    }
    renderedCount = allItems.length;
    
  } catch (e) { /* ignore */ }
}

sendBtn.addEventListener("click", sendMessage);

// ============ Periodic refresh ============
async function refresh() {
  if (!unlocked) return;
  if (isPrinting) return;
  
  try {
    const items = await fetchMessages();
    if (items.length !== renderedCount) {
      const newMessages = items.slice(renderedCount);
      allItems = items;
      
      for (const m of newMessages) {
        await animatePrintMessage(m);
        await sleep(300);
      }
      
      nicksMap = await fetchNicks();
      metaEl.innerHTML = PROMPT_HTML + "total messages: " + allItems.length;
      renderedCount = items.length;
    }
    document.getElementById("status").textContent = "// updated: " + nowLocalString();
  } catch (e) {
    document.getElementById("status").textContent = "// load error: " + e.message;
  }
}

bootstrap();
setInterval(refresh, REFRESH_MS);