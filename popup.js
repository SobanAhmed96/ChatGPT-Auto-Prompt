const { KEYS, DEFAULTS, CATEGORIES, generate } = AP;
const $ = id => document.getElementById(id);

let cfg = { ...DEFAULTS };
let ctl = {};
let stats = {};
let logs = [];

const FIELDS = {
  text: ["mode", "prompts", "suffix"],
  num: ["delayMin", "delayMax", "maxPrompts", "maxMinutes", "newChatEvery", "limitWaitMin"],
  bool: ["onLimitNewChat", "switchModel", "autoRetry", "showPanel", "typingHuman", "captureReplies", "schedEnabled"]
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
  // per-site delay overrides
  const sd = cfg.siteDelays || {};
  $("delayChatGPT").value = sd.chatgpt ? sd.chatgpt.delayMin ?? "" : "";
  $("delayGemini").value = sd.gemini ? sd.gemini.delayMin ?? "" : "";
  $("delayClaude").value = sd.claude ? sd.claude.delayMin ?? "" : "";
  // schedule
  const sc = cfg.schedule || {};
  $("schedTime").value = sc.time || "09:00";
  $("schedMax").value = sc.maxPrompts || 0;
  document.querySelectorAll("#schedDays button").forEach(b =>
    b.classList.toggle("on", (sc.days || []).includes(+b.dataset.day)));
  renderCats();
  syncMode();
}
function readSiteDelays(c) {
  const sd = {};
  const map = { chatgpt: "delayChatGPT", gemini: "delayGemini", claude: "delayClaude" };
  for (const [site, id] of Object.entries(map)) {
    const v = $(id).value.trim();
    if (v !== "") sd[site] = { delayMin: Math.max(0, Number(v) || 0), delayMax: Math.max(0, Number(v) || 0) };
  }
  c.siteDelays = sd;
  c.schedule = {
    ...(cfg.schedule || {}),
    time: $("schedTime").value || "09:00",
    maxPrompts: Math.max(0, Number($("schedMax").value) || 0),
    enabled: $("schedEnabled").checked
  };
  return c;
}
function readForm() {
  const c = { ...cfg };
  FIELDS.text.forEach(k => { c[k] = $(k).value; });
  FIELDS.num.forEach(k => { c[k] = Math.max(0, Number($(k).value) || 0); });
  FIELDS.bool.forEach(k => { c[k] = $(k).checked; });
  c.categories = [...document.querySelectorAll(".chip.on")].map(b => b.dataset.cat);
  return readSiteDelays(c);
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
  $("textLbl").textContent = m === "single" ? "Prompt" : m === "chain" ? "Chain (one prompt per line, sent once each)" : "Prompts (one per line)";
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
  const out = {};
  const all = await chrome.storage.local.get(null);
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith("ap_ctl_") && v && v.running !== false) out[k] = { ...v, paused: !v.paused };
  }
  await chrome.storage.local.set(out);
}
async function stop() {
  const out = { [KEYS.ctl]: { ...ctl, running: false, paused: false, stopAll: true } };
  const all = await chrome.storage.local.get(null);
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith("ap_ctl_") && v && v.running !== false) out[k] = { ...v, running: false, paused: false };
  }
  await chrome.storage.local.set(out);
}
// Aggregate stats from every per-tab run; status line shows the most recent run.
async function loadRuns() {
  const all = await chrome.storage.local.get(null);
  let agg = { sent: 0, chatSent: 0, newChats: 0, startedAt: 0, status: "", phase: "idle", endedAt: 0 };
  let latest = null;
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith("ap_stats_") || !v) continue;
    agg.sent += v.sent || 0;
    agg.chatSent += v.chatSent || 0;
    agg.newChats += v.newChats || 0;
    if ((v.startedAt || 0) > agg.startedAt) latest = v;
  }
  if (latest) {
    agg.status = latest.status; agg.phase = latest.phase;
    agg.startedAt = latest.startedAt; agg.endedAt = latest.endedAt;
  }
  return agg;
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
  document.querySelectorAll("#schedDays button").forEach(b => b.onclick = () => { b.classList.toggle("on"); save(); });

  // ---- selector diagnostics ----
  $("diagnostics").onclick = async () => {
    const tab = await chatTab();
    if (!tab) { $("diagOut").textContent = "Open a ChatGPT / Gemini / Claude tab first."; return; }
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { action: "SELFCHECK" });
      const r = res && res.result;
      $("diagOut").textContent = r
        ? `site=${r.site} · composer=${r.composer ? "ok" : "MISSING"} · send=${r.send ? "ok" : "not ready"} · user msgs=${r.user} · replies=${r.assistant} · new chat=${r.newChat ? "ok" : "MISSING"}`
        : "No response from the page.";
    } catch (e) {
      $("diagOut").textContent = "Could not reach the page — refresh it and try again.";
    }
  };

  // ---- settings export / import ----
  $("exportCfg").onclick = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "auto-prompt-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("importCfg").onclick = () => $("cfgFile").click();
  $("cfgFile").onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      cfg = { ...DEFAULTS, ...data };
      await chrome.storage.local.set({ [KEYS.cfg]: cfg });
      writeForm();
      notice("Settings imported.");
    } catch (err) {
      notice("Import failed: not a valid settings file.");
    }
    e.target.value = "";
  };

  // ---- reply export as Markdown ----
  $("exportReplies").onclick = async () => {
    const o = await chrome.storage.local.get(KEYS.replies);
    const list = o[KEYS.replies] || [];
    if (!list.length) { notice("No replies captured yet — enable “Capture replies” first."); return; }
    let md = "# Auto Prompt — captured replies\n\n";
    list.forEach((e, i) => {
      md += `## ${i + 1}. ${new Date(e.t).toLocaleString()} (${e.site})\n\n`;
      md += `**Prompt:** ${e.prompt}\n\n**Reply:**\n\n${e.reply}\n\n---\n\n`;
    });
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "auto-prompt-replies.md";
    a.click();
    URL.revokeObjectURL(a.href);
    notice("");
  };

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
  let touched = Object.keys(ch).some(k => k.startsWith("ap_stats_"));
  if (touched) loadRuns().then(s => { stats = s; render(); });
  if (ch[KEYS.ctl] || touched) render();
});

init();
