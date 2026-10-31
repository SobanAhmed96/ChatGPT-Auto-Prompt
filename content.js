(() => {
  if (window.__autoPromptLoaded) return;
  window.__autoPromptLoaded = true;

  const { KEYS, DEFAULTS, generate } = globalThis.AP;
  const GEMINI = /(^|\.)gemini\.google\.com$/.test(location.hostname);
  const OWNER = "ap_owner"; // sessionStorage token: only the tab where START was pressed runs

  let loopId = 0;
  let loopActive = false;
  let ctl = { running: false, paused: false };
  let stats = {};
  let logBuf = [];

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const fmtClock = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
  const visible = el => !!el && el.getClientRects().length > 0;

  /* ================= storage ================= */
  const store = {
    async get(k, d) {
      try { const o = await chrome.storage.local.get(k); return o[k] === undefined ? d : o[k]; }
      catch (_) { return d; }
    },
    async set(o) { try { await chrome.storage.local.set(o); } catch (_) {} }
  };
  const getCfg = async () => ({ ...DEFAULTS, ...(await store.get(KEYS.cfg, {})) });

  async function patchStats(p) {
    stats = { ...stats, ...p };
    await store.set({ [KEYS.st]: stats });
    panelRender();
  }
  async function setStatus(text, phase) {
    await patchStats({ status: text, phase: phase || stats.phase || "run" });
  }

  let logTimer = 0;
  function log(msg, level) {
    logBuf.push({ t: Date.now(), m: msg, l: level || "info" });
    if (logBuf.length > 150) logBuf.shift();
    clearTimeout(logTimer);
    logTimer = setTimeout(() => store.set({ [KEYS.log]: logBuf }), 250);
  }

  /* ================= loop helpers ================= */
  const aliveFor = id => () => loopId === id && ctl.running !== false;

  async function waitFor(fn, timeout, alive) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (alive && !alive()) return null;
      let v = null;
      try { v = fn(); } catch (_) {}
      if (v) return v;
      await sleep(200);
    }
    return null;
  }
  // Sleep that does not count time while paused. Returns false if the run was stopped.
  async function sleepA(ms, alive) {
    let left = ms;
    while (left > 0) {
      if (!alive()) return false;
      if (ctl.paused) { await sleep(300); continue; }
      const step = Math.min(250, left);
      await sleep(step);
      left -= step;
    }
    return alive();
  }
  async function gate(alive) {
    let announced = false;
    while (alive() && ctl.paused) {
      if (!announced) { announced = true; await setStatus("Paused", "pause"); log("Paused"); }
      await sleep(300);
    }
    if (announced && alive()) { log("Resumed"); await setStatus("Resumed", "run"); }
    return alive();
  }

  /* ================= DOM: ChatGPT ================= */
  function getComposer() {
    const sel = GEMINI
      ? 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"]'
      : '#prompt-textarea, div.ProseMirror[contenteditable="true"], form textarea';
    const c = [...document.querySelectorAll(sel)].filter(el => visible(el) && !el.closest("#__ap_host"));
    return c.find(el => el.id === "prompt-textarea") || c[0] || null;
  }
  function sendBtnReady() {
    const b = GEMINI
      ? document.querySelector('button.send-button:not(.stop), button[aria-label="Send message"], button[aria-label^="Send"]')
      : document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('button[aria-label^="Send"]');
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" && visible(b) ? b : null;
  }
  function isGenerating() {
    if (GEMINI) {
      return !!document.querySelector(
        'button.send-button.stop, button.stop, button[aria-label="Stop response"], button[aria-label*="Stop"], model-response .pending'
      );
    }
    if (document.querySelector('button[data-testid="stop-button"], .result-streaming')) return true;
    return [...document.querySelectorAll("button[aria-label]")].some(b =>
      /^stop( streaming| generating| response)?$/i.test(b.getAttribute("aria-label").trim()) && visible(b)
    );
  }
  const Q_USER = GEMINI ? "user-query" : '[data-message-author-role="user"]';
  const Q_ASST = GEMINI ? "model-response" : '[data-message-author-role="assistant"]';
  const countUser = () => document.querySelectorAll(Q_USER).length;
  const countAssistant = () => document.querySelectorAll(Q_ASST).length;
  const countTurns = () =>
    GEMINI ? countUser() : document.querySelectorAll('[data-testid^="conversation-turn"]').length;

  /* ---- composer text ---- */
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  function composerRead(el) {
    if (!el) return "";
    return el.tagName === "TEXTAREA" ? el.value : el.innerText || el.textContent || "";
  }
  const composerEmpty = el => !!el && norm(composerRead(el)).length === 0;

  function selectAll(el) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  async function focusEl(el) {
    try { el.focus({ preventScroll: true }); } catch (_) {}
    if (document.activeElement !== el && !el.contains(document.activeElement)) {
      try { el.click(); el.focus({ preventScroll: true }); } catch (_) {}
    }
    await sleep(60);
    return document.activeElement === el || el.contains(document.activeElement);
  }
  async function clearComposer(el) {
    if (!el) return;
    if (el.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (composerEmpty(el)) return;
    if (await focusEl(el)) {
      selectAll(el);
      try { document.execCommand("delete"); } catch (_) {}
      await sleep(120);
    }
  }

  // Types `text` into the chat box. Only ever touches the composer itself.
  async function setComposerText(el, text) {
    const want = norm(text);
    const probe = want.slice(0, 24);
    const good = () => {
      const t = norm(composerRead(el));
      return t.includes(probe) && t.length <= want.length * 1.3 + 5;
    };

    if (el.tagName === "TEXTAREA") {
      await focusEl(el);
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(150);
      return good();
    }

    for (const method of ["paste", "exec", "direct"]) {
      const focused = await focusEl(el);
      await clearComposer(el);

      if (method === "paste") {
        selectAll(el);
        try {
          const dt = new DataTransfer();
          dt.setData("text/plain", text);
          el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        } catch (_) {}
      } else if (method === "exec") {
        if (!focused) continue; // never run execCommand unless the composer really has focus
        selectAll(el);
        try { document.execCommand("insertText", false, text); } catch (_) {}
      } else {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }

      await sleep(350);
      if (good()) return true;
    }
    return false;
  }

  function pressEnter(el) {
    el.focus();
    const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", o));
    el.dispatchEvent(new KeyboardEvent("keypress", o));
    el.dispatchEvent(new KeyboardEvent("keyup", o));
  }

  /* ================= limit / full / error detection ================= */
  const FULL_PATTERNS = [
    /maximum length for this conversation/,
    /conversation is too long/,
    /(this )?(chat|conversation) (is|has become) too long/,
    /start a new (chat|conversation) to continue/
  ];
  const LIMIT_PATTERNS = [
    /(you['’]?ve|you have)\s+(reached|hit)\b[^.]{0,80}\blimit/,
    /\b(reached|hit|exceeded)\s+(the|your|our)\b[^.]{0,60}\blimit/,
    /\b(usage|message|rate|daily)\s+limit\b/,
    /limit\s+(resets|will reset|reached|exceeded)/,
    /try again (after|in|at|later)\b/,
    /too many requests/,
    /will use another model/,
    /(daily|usage|request) quota/,
    /quota (exceeded|reached)/,
    /reached your (daily )?(limit|quota)/
  ];
  // Looks only at UI outside the chat messages, the sidebar and the composer,
  // so your prompts / ChatGPT's replies can never trigger a false positive.
  function detectBlock() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === 1) {
            if (
              node.id === "__ap_host" ||
              node.matches('nav, aside, [data-message-author-role], user-query, model-response, side-nav-container, bard-sidenav, script, style, [contenteditable="true"], textarea')
            ) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_SKIP;
          }
          return node.nodeValue && node.nodeValue.trim().length > 12
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );
    let n, limit = false;
    while ((n = walker.nextNode())) {
      const p = n.parentElement;
      const raw = (p && p.textContent.length < 300 ? p.textContent : n.nodeValue) || "";
      const txt = raw.toLowerCase().replace(/[’‘]/g, "'");
      if (FULL_PATTERNS.some(r => r.test(txt))) return "full";
      if (!limit && LIMIT_PATTERNS.some(r => r.test(txt))) limit = true;
    }
    return limit ? "limit" : null;
  }

  function replyError() {
    const alerts = [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent).join(" ");
    const msgs = document.querySelectorAll(Q_ASST);
    const last = msgs[msgs.length - 1];
    const lt = last && (last.textContent || "").length < 160 ? last.textContent : "";
    return /something went wrong|couldn't (generate|complete)|network error|error in message stream|an error occurred|failed to generate/i
      .test(alerts + " " + lt);
  }
  function findRetryButton() {
    return [...document.querySelectorAll("button")].find(
      b => visible(b) && !b.closest("nav, aside, #__ap_host") &&
        /^(retry|try again|regenerate)$/i.test((b.innerText || b.getAttribute("aria-label") || "").trim())
    );
  }

  /* ================= model switching (best effort) ================= */
  function modelButton() {
    return (
      document.querySelector('button[data-testid="model-switcher-dropdown-button"]') ||
      [...document.querySelectorAll("button")].find(b => /model/i.test(b.getAttribute("aria-label") || ""))
    );
  }
  const firstLine = el => (el.innerText || el.textContent || "").trim().split("\n")[0].trim().toLowerCase();

  async function trySwitchModel() {
    if (GEMINI) return false; // Gemini has no safe model switcher to automate
    const btn = modelButton();
    if (!btn) return false;

    const tried = new Set(stats.tried || []);
    const current = firstLine(btn);
    if (current) tried.add(current);

    btn.click();
    await sleep(900);

    const items = [...document.querySelectorAll(
      '[role="menuitem"], [role="menuitemradio"], [data-testid^="model-switcher-"]'
    )].filter(el => el !== btn && visible(el));

    const choice = items.find(el => {
      const label = firstLine(el);
      if (!label || tried.has(label)) return false;
      if (/legacy|more models|configure|upgrade/.test(label)) return false;
      if (el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled")) return false;
      if (el.getAttribute("aria-checked") === "true") return false;
      return true;
    });

    if (!choice) {
      await patchStats({ tried: [...tried] });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      await sleep(300);
      return false;
    }
    const label = firstLine(choice);
    choice.click();
    tried.add(label);
    await patchStats({ tried: [...tried] });
    log(`Switched model → ${clip(label, 40)}`, "ok");
    await sleep(1200);
    return true;
  }

  /* ================= new chat ================= */
  const isHome = () => GEMINI
    ? /\/app\/?$/.test(location.pathname)
    : location.pathname === "/" || location.pathname === "";
  const homeUrl = () => GEMINI ? location.pathname.replace(/\/app.*$/, "/app") : "/";
  function findNewChatLink() {
    if (GEMINI) {
      return (
        [...document.querySelectorAll(
          '[data-test-id="new-chat-button"] a, a[data-test-id="new-chat-button"], [data-test-id="new-chat-button"], a[aria-label="New chat"], button[aria-label="New chat"], a[href$="/app"]'
        )].find(visible) || null
      );
    }
    return (
      document.querySelector('a[data-testid="create-new-chat-button"]') ||
      [...document.querySelectorAll('a[href="/"], button[aria-label="New chat"]')].find(visible) ||
      null
    );
  }
  // Returns "same" (SPA navigation, loop continues here) or "reload" (page is reloading).
  async function newChat(reason, alive) {
    await patchStats({ chatSent: 0, newChats: (stats.newChats || 0) + 1 });
    await setStatus(`Opening new chat (${reason})...`, "wait");
    log(`New chat — ${reason}`, "info");

    const link = findNewChatLink();
    if (link) {
      link.click();
      const ok = await waitFor(
        () => isHome() && countUser() === 0 && getComposer(),
        6000, alive
      );
      if (ok) { await sleep(1200); return "same"; }
    }
    if (!alive()) return "stop";
    await sleep(300);
    if (isHome()) location.reload();
    else location.assign(homeUrl());
    return "reload"; // content script restarts on the new page and resumes
  }

  async function afterNewChat(cfg, alive) {
    if (!(await waitFor(getComposer, 30000, alive))) return false;
    await sleep(800);
    if (stats.afterLimit) {
      if (cfg.switchModel) {
        await setStatus("New chat opened, switching model...", "wait");
        await trySwitchModel();
      }
      await patchStats({ afterLimit: false });
    }
    return true;
  }

  async function handleBlock(kind, cfg, alive) {
    if (kind === "full") {
      log("Chat is full", "warn");
      return newChat("chat is full", alive);
    }

    log("Usage limit detected", "warn");
    if (cfg.switchModel) {
      await setStatus("Limit detected - trying another model...", "limit");
      if (await trySwitchModel()) {
        await sleep(2500);
        if (!detectBlock()) return "same";
      }
    }
    if (cfg.onLimitNewChat && !stats.freshChat) {
      await patchStats({ afterLimit: true, freshChat: true });
      return newChat("limit reached", alive);
    }

    // Everything is limited: wait, then try again with a fresh chat
    await patchStats({ tried: [], freshChat: false, afterLimit: true });
    log(`All models limited - waiting ${cfg.limitWaitMin} min`, "warn");
    const end = Date.now() + Math.max(1, cfg.limitWaitMin) * 60000;
    while (Date.now() < end) {
      if (!alive()) return "stop";
      if (!ctl.paused) await setStatus(`Limited - retrying in ${fmtClock(end - Date.now())}`, "limit");
      await sleep(1000);
    }
    return newChat("retry after wait", alive);
  }

  /* ================= prompts ================= */
  function buildPrompt(cfg) {
    const lines = (cfg.prompts || "").split("\n").map(x => x.trim()).filter(Boolean);
    let text = "", idx = stats.idx || 0;

    if (cfg.mode === "single" && cfg.prompts.trim()) {
      text = cfg.prompts.trim();
    } else if (cfg.mode === "list" && lines.length) {
      text = lines[idx % lines.length];
      idx++;
    } else if (cfg.mode === "shuffle" && lines.length) {
      for (let i = 0; i < 8; i++) {
        text = lines[Math.floor(Math.random() * lines.length)];
        if (lines.length < 2 || text !== stats.lastPrompt) break;
      }
    } else {
      text = generate(cfg.categories, stats.lastPrompt);
    }
    if (cfg.suffix && cfg.suffix.trim()) text += " " + cfg.suffix.trim();
    return { text, idx };
  }

  /* ================= sending ================= */
  async function sendPrompt(text, alive) {
    const composer = await waitFor(getComposer, 15000, alive);
    if (!composer) return { ok: false, why: "chat box not found" };

    const bUser = countUser(), bTurns = countTurns(), bAsst = countAssistant();

    if (!(await setComposerText(composer, text))) {
      await clearComposer(composer);
      return { ok: false, why: "could not type into the chat box" };
    }

    const btn = await waitFor(sendBtnReady, 5000, alive);
    if (!alive()) return { ok: false, why: "stopped" };
    if (btn) btn.click(); else pressEnter(composer);

    const sentSignal = () =>
      isGenerating() || countUser() > bUser || countTurns() > bTurns || composerEmpty(getComposer());

    // a "limit reached" message popping up right after clicking send is not a send failure
    let blocked = false, lastCheck = 0;
    const signal = () => {
      if (sentSignal()) return true;
      if (Date.now() - lastCheck > 800) {
        lastCheck = Date.now();
        if (detectBlock()) { blocked = true; return true; }
      }
      return false;
    };
    let ok = await waitFor(signal, 8000, alive);
    if (!ok && alive()) {
      pressEnter(composer); // second chance via keyboard
      ok = await waitFor(signal, 8000, alive);
    }
    if (blocked && !isGenerating() && countUser() <= bUser) {
      await clearComposer(getComposer());
      return { ok: false, blocked: true, why: "limit message appeared" };
    }
    if (!ok) {
      await clearComposer(getComposer());
      return { ok: false, why: "ChatGPT did not accept the message" };
    }
    return { ok: true, bAsst };
  }

  async function waitResponse(bAsst, alive) {
    await waitFor(() => isGenerating() || countAssistant() > bAsst, 30000, alive);
    for (let i = 0; i < 4 && alive(); i++) {
      await waitFor(() => !isGenerating(), 15 * 60000, alive);
      if (!(await sleepA(1500, alive))) return;
      if (!isGenerating()) return;
    }
  }

  /* ================= finish ================= */
  async function finish(text, phase) {
    loopActive = false;
    ctl = { ...ctl, running: false, paused: false };
    await store.set({ [KEYS.ctl]: ctl });
    await patchStats({ status: text, phase: phase || "done", endedAt: Date.now() });
    log(text, phase === "error" ? "err" : "ok");
    clearTimeout(logTimer);
    await store.set({ [KEYS.log]: logBuf });
    setTimeout(panelHide, phase === "error" ? 20000 : 10000);
  }

  /* ================= main loop ================= */
  async function run(id) {
    const alive = aliveFor(id);
    loopActive = true;

    ctl = await store.get(KEYS.ctl, { running: true });
    stats = await store.get(KEYS.st, {});
    logBuf = await store.get(KEYS.log, []);
    let cfg = await getCfg();
    if (!stats.startedAt) await patchStats({ startedAt: Date.now() });
    if (cfg.showPanel) panelShow(); else panelHide();

    await setStatus("Waiting for ChatGPT page...", "wait");
    if (!(await afterNewChat(cfg, alive))) {
      if (alive()) await finish("Chat box not found. Refresh the page and press Start again.", "error");
      return;
    }
    log("Run started");

    let fails = 0;
    while (alive()) {
      if (!(await gate(alive))) break;
      cfg = await getCfg();

      // ---- stop conditions ----
      if (cfg.maxPrompts > 0 && (stats.sent || 0) >= cfg.maxPrompts) {
        await finish(`Done - ${stats.sent} prompts sent`, "done"); return;
      }
      if (cfg.maxMinutes > 0 && Date.now() - (stats.startedAt || Date.now()) >= cfg.maxMinutes * 60000) {
        await finish(`Done - time limit reached (${stats.sent || 0} prompts sent)`, "done"); return;
      }

      // ---- limit / full chat ----
      const block = detectBlock();
      if (block) {
        const r = await handleBlock(block, cfg, alive);
        if (r === "reload" || r === "stop" || !alive()) return;
        if (!(await afterNewChat(cfg, alive))) { if (alive()) await finish("Chat box not found after new chat.", "error"); return; }
        continue;
      }

      // ---- rotate chat every N prompts ----
      if (cfg.newChatEvery > 0 && (stats.chatSent || 0) >= cfg.newChatEvery) {
        const r = await newChat(`${stats.chatSent} prompts in this chat`, alive);
        if (r === "reload" || r === "stop" || !alive()) return;
        if (!(await afterNewChat(cfg, alive))) { if (alive()) await finish("Chat box not found after new chat.", "error"); return; }
        continue;
      }

      // ---- wait for a previous answer to end ----
      if (isGenerating()) {
        await setStatus("Waiting for response to finish...", "wait");
        await waitFor(() => !isGenerating(), 15 * 60000, alive);
        if (!(await sleepA(1000, alive))) return;
      }

      // ---- send ----
      const { text, idx } = buildPrompt(cfg);
      await setStatus(`Sending prompt #${(stats.sent || 0) + 1}...`, "run");
      const r = await sendPrompt(text, alive);
      if (!alive()) return;

      if (r.ok) {
        fails = 0;
        const sent = (stats.sent || 0) + 1;
        await patchStats({
          sent, idx, lastPrompt: text, chatSent: (stats.chatSent || 0) + 1,
          freshChat: false, recoveries: 0
        });
        log(`#${sent}  ${clip(text, 90)}`, "ok");
        await setStatus(`#${sent} sent - waiting for reply...`, "run");
        await waitResponse(r.bAsst, alive);
        if (!alive()) return;

        // reply failed ("Something went wrong")?
        if (cfg.autoRetry && replyError()) {
          const streak = (stats.errStreak || 0) + 1;
          await patchStats({ errStreak: streak, errors: (stats.errors || 0) + 1 });
          log(`ChatGPT returned an error (${streak})`, "warn");
          const retry = findRetryButton();
          if (retry && streak < 3) {
            retry.click();
            await setStatus("Retrying failed reply...", "run");
            await waitResponse(countAssistant(), alive);
          } else if (streak >= 3) {
            await patchStats({ errStreak: 0 });
            const nr = await newChat("repeated errors", alive);
            if (nr === "reload" || nr === "stop" || !alive()) return;
            if (!(await afterNewChat(cfg, alive))) return;
            continue;
          }
        } else if (stats.errStreak) {
          await patchStats({ errStreak: 0 });
        }

        // wait before the next prompt (random between min and max)
        const lo = Math.max(2, Number(cfg.delayMin) || 5);
        const hi = Math.max(lo, Number(cfg.delayMax) || lo);
        const wait = rand(lo, hi);
        const end = Date.now() + wait * 1000;
        while (alive() && Date.now() < end) {
          if (!ctl.paused) await setStatus(`#${sent} done - next in ${Math.ceil((end - Date.now()) / 1000)}s`, "wait");
          if (!(await sleepA(Math.min(1000, Math.max(0, end - Date.now())), alive))) return;
        }
      } else if (r.blocked) {
        continue; // limit / full chat message: handled at the top of the loop
      } else {
        fails++;
        log(`Send failed (${fails}/3): ${r.why}`, "err");
        if (detectBlock()) continue; // handled at the top of the loop
        if (fails >= 3) {
          if ((stats.recoveries || 0) < 3) {
            fails = 0;
            await patchStats({ recoveries: (stats.recoveries || 0) + 1 });
            const nr = await newChat("recovering after failed sends", alive);
            if (nr === "reload" || nr === "stop" || !alive()) return;
            if (!(await afterNewChat(cfg, alive))) return;
            continue;
          }
          await finish("Stopped - prompts could not be sent. Refresh ChatGPT and try again.", "error");
          return;
        }
        await setStatus(`Send failed (${r.why}) - retry ${fails}/3...`, "warn");
        if (!(await sleepA(3000, alive))) return;
      }
    }
  }

  function startLoop() {
    loopId++;
    run(loopId).catch(async e => {
      console.error("[AutoPrompt]", e);
      await finish("Error: " + ((e && e.message) || e), "error");
    });
  }

  /* ================= on-page control panel ================= */
  let panel = null, panelTick = 0;

  function panelShow() {
    if (panel) { panel.host.style.display = ""; panelRender(); return; }
    const host = document.createElement("div");
    host.id = "__ap_host";
    host.style.cssText = "all:initial;position:fixed;right:16px;bottom:92px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
        .card { width: 250px; background: #14171c; color: #e8eaed; border: 1px solid #2b3038; border-radius: 14px;
                box-shadow: 0 12px 32px rgba(0,0,0,.45); overflow: hidden; font-size: 12px; }
        .head { display: flex; align-items: center; gap: 8px; padding: 9px 10px; cursor: grab; user-select: none;
                background: #1b1f26; border-bottom: 1px solid #2b3038; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #10a37f; flex: none; }
        .dot.pause { background: #f59e0b; } .dot.limit, .dot.warn { background: #f59e0b; }
        .dot.error { background: #ef4444; } .dot.done { background: #60a5fa; } .dot.wait { background: #34d399; }
        .dot.run { animation: pulse 1.4s infinite; }
        @keyframes pulse { 50% { opacity: .35; } }
        .title { font-weight: 600; flex: 1; font-size: 12.5px; }
        .min { all: unset; cursor: pointer; width: 20px; height: 20px; text-align: center; line-height: 20px;
               border-radius: 5px; color: #9aa0aa; } .min:hover { background: #2b3038; color: #fff; }
        .body { padding: 10px; display: grid; gap: 9px; }
        .status { color: #cfd3d9; line-height: 1.35; min-height: 32px; word-break: break-word; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .tile { background: #1b1f26; border: 1px solid #2b3038; border-radius: 8px; padding: 6px 7px; }
        .tile b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
        .tile span { color: #8b929c; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
        .btns { display: flex; gap: 6px; }
        button.b { all: unset; flex: 1; text-align: center; padding: 7px 0; border-radius: 8px; cursor: pointer;
                   font-weight: 600; font-size: 12px; background: #2b3038; color: #e8eaed; }
        button.b:hover { filter: brightness(1.2); }
        button.stop { background: #b91c1c; color: #fff; }
        .collapsed .body { display: none; }
        .hint { color: #6b7280; font-size: 10px; text-align: center; }
      </style>
      <div class="card" id="card">
        <div class="head" id="drag"><span class="dot" id="dot"></span><span class="title">Auto Prompt</span>
          <button class="min" id="min" title="Minimize">–</button></div>
        <div class="body">
          <div class="status" id="status">Starting...</div>
          <div class="grid">
            <div class="tile"><b id="sent">0</b><span>Sent</span></div>
            <div class="tile"><b id="chats">0</b><span>New chats</span></div>
            <div class="tile"><b id="time">0:00</b><span>Elapsed</span></div>
          </div>
          <div class="btns"><button class="b" id="pause">Pause</button><button class="b stop" id="stop">Stop</button></div>
          <div class="hint">Alt+Shift+P pause · Alt+Shift+X stop</div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const $ = id => root.getElementById(id);
    panel = { host, root, $ };

    $("min").onclick = () => {
      const c = $("card");
      c.classList.toggle("collapsed");
      $("min").textContent = c.classList.contains("collapsed") ? "+" : "–";
    };
    $("pause").onclick = togglePause;
    $("stop").onclick = stopRun;

    // dragging
    let dx = 0, dy = 0, dragging = false;
    $("drag").addEventListener("mousedown", e => {
      if (e.target.id === "min") return;
      dragging = true;
      const r = host.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", e => {
      if (!dragging) return;
      host.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - dx)) + "px";
      host.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - dy)) + "px";
      host.style.right = "auto"; host.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => { dragging = false; });

    panelTick = setInterval(panelRender, 1000);
    panelRender();
  }
  function panelHide() {
    if (!panel) return;
    clearInterval(panelTick);
    panel.host.remove();
    panel = null;
  }
  function panelRender() {
    if (!panel) return;
    const { $ } = panel;
    $("status").textContent = stats.status || "Starting...";
    $("dot").className = "dot " + (ctl.paused ? "pause" : stats.phase || "run");
    $("sent").textContent = stats.sent || 0;
    $("chats").textContent = stats.newChats || 0;
    const end = stats.endedAt || Date.now();
    $("time").textContent = stats.startedAt ? fmtClock(end - stats.startedAt) : "0:00";
    $("pause").textContent = ctl.paused ? "Resume" : "Pause";
    $("pause").style.display = ctl.running === false ? "none" : "";
    $("stop").style.display = ctl.running === false ? "none" : "";
  }

  /* ================= controls ================= */
  async function togglePause() {
    if (!loopActive) return;
    ctl = { ...ctl, paused: !ctl.paused };
    await store.set({ [KEYS.ctl]: ctl });
    panelRender();
  }
  async function stopRun() {
    if (!loopActive) return;
    // the storage.onChanged handler below cancels the loop and updates the status
    await store.set({ [KEYS.ctl]: { ...ctl, running: false, paused: false } });
  }

  document.addEventListener("keydown", e => {
    if (!e.altKey || !e.shiftKey || !loopActive) return;
    if (e.code === "KeyP") { e.preventDefault(); togglePause(); }
    if (e.code === "KeyX") { e.preventDefault(); stopRun(); }
  }, true);

  /* ================= wiring ================= */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.action === "START") {
      (async () => {
        const token = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
        try { sessionStorage.setItem(OWNER, token); } catch (_) {}
        const cur = await store.get(KEYS.ctl, {});
        await store.set({ [KEYS.ctl]: { ...cur, running: true, paused: false, owner: token } });
        startLoop();
        sendResponse({ ok: true });
      })();
      return true;
    }
    if (msg && msg.action === "PING") { sendResponse({ ok: true }); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEYS.ctl]) return;
    const prev = ctl;
    ctl = changes[KEYS.ctl].newValue || {};
    if (ctl.running === false && prev.running !== false && loopActive) {
      // STOP pressed in popup / panel / hotkey
      loopId++;
      loopActive = false;
      (async () => {
        await patchStats({ status: "Stopped", phase: "idle", endedAt: Date.now() });
        log("Stopped by user");
        clearTimeout(logTimer);
        await store.set({ [KEYS.log]: logBuf });
        setTimeout(panelHide, 4000);
      })();
    } else {
      panelRender();
    }
  });

  // Auto-resume after a page reload / hard navigation to a new chat
  (async () => {
    let token = null;
    try { token = sessionStorage.getItem(OWNER); } catch (_) {}
    if (!token) return;
    const c = await store.get(KEYS.ctl, {});
    if (c.running && c.owner === token) startLoop();
  })();
})();
