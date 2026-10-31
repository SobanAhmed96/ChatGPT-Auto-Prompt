const { KEYS, DEFAULTS, CATEGORIES, generate } = AP;
const $ = id => document.getElementById(id);

let cfg = { ...DEFAULTS };
let ctl = {};
let stats = {};
let logs = [];

const FIELDS = {
  text: ["mode", "prompts", "suffix"],
  num: ["delayMin", "delayMax", "maxPrompts", "maxMinutes", "newChatEvery", "limitWaitMin"],
  bool: ["onLimitNewChat", "switchModel", "autoRetry", "showPanel"]
};

const fmtClock = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
};

/* ---------- settings <-> form ---------- */
function writeForm() {
  FIELDS.text.forEach(k => { $(k).value = cfg[k] ?? ""; });
  FIELDS.num.forEach(k => { $(k).value = cfg[k] ?? 0; });
  FIELDS.bool.forEach(k => { $(k).checked = !!cfg[k]; });
  renderCats();
  syncMode();
}
function readForm() {
  const c = { ...cfg };
  FIELDS.text.forEach(k => { c[k] = $(k).value; });
  FIELDS.num.forEach(k => { c[k] = Math.max(0, Number($(k).value) || 0); });
  FIELDS.bool.forEach(k => { c[k] = $(k).checked; });
  c.categories = [...document.querySelectorAll(".chip.on")].map(b => b.dataset.cat);
  return c;
}
let saveTimer = 0;
function save() {
  cfg = readForm();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ [KEYS.cfg]: cfg }), 150);
}

function renderCats() {
  $("cats").innerHTML = "";
  Object.entries(CATEGORIES).forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + ((cfg.categories || []).includes(key) ? " on" : "");
    b.dataset.cat = key;
    b.textContent = label;
    b.onclick = () => {
      const on = document.querySelectorAll(".chip.on");
      if (b.classList.contains("on") && on.length === 1) return; // keep at least one
      b.classList.toggle("on");
      save(); newExample();
    };
    $("cats").appendChild(b);
  });
  newExample();
}
function newExample() {
  const cats = [...document.querySelectorAll(".chip.on")].map(b => b.dataset.cat);
  $("example").textContent = "“" + generate(cats) + "”";
}
function syncMode() {
  const m = $("mode").value;
  $("catBox").hidden = m !== "generate";
  $("textBox").hidden = m === "generate";
  $("textLbl").textContent = m === "single" ? "Prompt" : "Prompts (one per line)";
  $("prompts").placeholder = m === "single"
    ? "Write the prompt that will be sent again and again…"
    : "Write one prompt per line…\nExplain recursion simply\nGive me 3 healthy dinner ideas";
  updateCount();
}
function updateCount() {
  const m = $("mode").value;
  const n = $("prompts").value.split("\n").filter(l => l.trim()).length;
  $("lineCount").textContent = m === "single" ? "" : n + (n === 1 ? " prompt" : " prompts");
}

/* ---------- live status ---------- */
function render() {
  const running = ctl.running === true;
  const paused = running && ctl.paused === true;

  let phase = stats.phase || "idle";
  let label = "Idle";
  if (paused) { phase = "pause"; label = "Paused"; }
  else if (running) label = { run: "Running", wait: "Waiting", limit: "Limit", warn: "Retrying", pause: "Running" }[phase] || "Running";
  else if (phase === "done") label = "Finished";
  else if (phase === "error") label = "Stopped";
  else phase = "idle";

  $("pill").className = "pill " + phase;
  $("pillText").textContent = label;
  $("statusline").textContent = stats.status || "Ready";

  $("sSent").textContent = stats.sent || 0;
  $("sChat").textContent = stats.chatSent || 0;
  $("sChats").textContent = stats.newChats || 0;
  renderTime();

  $("start").disabled = running;
  $("pause").disabled = !running;
  $("stop").disabled = !running;
  $("pauseText").textContent = paused ? "Resume" : "Pause";
}
function renderTime() {
  if (!stats.startedAt) { $("sTime").textContent = "0:00"; return; }
  const end = ctl.running ? Date.now() : stats.endedAt || Date.now();
  $("sTime").textContent = fmtClock(end - stats.startedAt);
}
function renderLog() {
  const ul = $("logList");
  if (!logs.length) { ul.innerHTML = '<li class="empty">Nothing yet.</li>'; return; }
  ul.innerHTML = "";
  [...logs].reverse().slice(0, 80).forEach(e => {
    const li = document.createElement("li");
    const t = document.createElement("time");
    t.textContent = new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const s = document.createElement("span");
    s.className = e.l || "";
    s.textContent = e.m;
    li.append(t, s);
    ul.appendChild(li);
  });
}
function notice(msg, withOpen) {
  const n = $("notice");
  if (!msg) { n.hidden = true; return; }
  n.hidden = false;
  n.textContent = msg + " ";
  if (withOpen) {
    [["ChatGPT", "https://chatgpt.com/"], ["Gemini", "https://gemini.google.com/app"]].forEach(([name, url]) => {
      const b = document.createElement("button");
      b.textContent = "Open " + name;
      b.onclick = () => chrome.tabs.create({ url });
      n.appendChild(b);
    });
  }
}

/* ---------- actions ---------- */
async function chatTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.url && /^https:\/\/(chatgpt\.com|chat\.openai\.com|gemini\.google\.com)\//.test(tab.url) ? tab : null;
}

async function start() {
  notice("");
  const c = readForm();
  const lines = c.prompts.split("\n").filter(l => l.trim());
  if (c.mode !== "generate" && !lines.length) {
    notice("Add at least one prompt on the Prompts tab.");
    return;
  }
  if (c.delayMin < 2) c.delayMin = 2;
  if (c.delayMax < c.delayMin) c.delayMax = c.delayMin;
  cfg = c; writeForm();

  const tab = await chatTab();
  if (!tab) { notice("Open a ChatGPT or Gemini tab and press Start there.", true); return; }

  await chrome.storage.local.set({
    [KEYS.cfg]: cfg,
    [KEYS.ctl]: { running: true, paused: false, ts: Date.now() },
    [KEYS.st]: { sent: 0, chatSent: 0, newChats: 0, idx: 0, errors: 0, tried: [], startedAt: Date.now(), status: "Starting...", phase: "wait" },
    [KEYS.log]: []
  });

  const send = () => chrome.tabs.sendMessage(tab.id, { action: "START" });
  try {
    await send();
  } catch (_) {
    // content script missing (tab opened before install) → inject it, then retry
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["shared.js", "content.js"] });
      await new Promise(r => setTimeout(r, 400));
      await send();
    } catch (e) {
      await chrome.storage.local.set({ [KEYS.ctl]: { running: false, paused: false } });
      notice("Could not reach the page. Refresh it (F5) and try again.");
    }
  }
}

async function togglePause() {
  await chrome.storage.local.set({ [KEYS.ctl]: { ...ctl, paused: !ctl.paused } });
}
async function stop() {
  await chrome.storage.local.set({ [KEYS.ctl]: { ...ctl, running: false, paused: false } });
}

/* ---------- init ---------- */
async function init() {
  const d = await chrome.storage.local.get([KEYS.cfg, KEYS.ctl, KEYS.st, KEYS.log]);
  cfg = { ...DEFAULTS, ...(d[KEYS.cfg] || {}) };
  ctl = d[KEYS.ctl] || {};
  stats = d[KEYS.st] || {};
  logs = d[KEYS.log] || [];
  writeForm(); render(); renderLog(); updateCount();

  document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + t.dataset.tab));
  });

  [...FIELDS.text, ...FIELDS.num, ...FIELDS.bool].forEach(k => {
    $(k).addEventListener("input", () => { save(); if (k === "prompts") updateCount(); });
    $(k).addEventListener("change", () => { save(); if (k === "mode") syncMode(); });
  });

  $("reroll").onclick = newExample;
  $("start").onclick = start;
  $("pause").onclick = togglePause;
  $("stop").onclick = stop;
  $("clearLog").onclick = async () => { logs = []; renderLog(); await chrome.storage.local.set({ [KEYS.log]: [] }); };
  $("copyLog").onclick = async () => {
    const txt = logs.map(e => new Date(e.t).toLocaleTimeString() + "  " + e.m).join("\n");
    try { await navigator.clipboard.writeText(txt); $("copyLog").textContent = "Copied"; setTimeout(() => $("copyLog").textContent = "Copy", 1200); } catch (_) {}
  };

  setInterval(renderTime, 1000);
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch[KEYS.ctl]) ctl = ch[KEYS.ctl].newValue || {};
  if (ch[KEYS.st]) stats = ch[KEYS.st].newValue || {};
  if (ch[KEYS.log]) { logs = ch[KEYS.log].newValue || []; renderLog(); }
  if (ch[KEYS.ctl] || ch[KEYS.st]) render();
});

init();
