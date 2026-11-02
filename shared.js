/* Shared between popup.js and content.js (same global `AP`). */
globalThis.AP = globalThis.AP || (() => {
  const KEYS = {
    cfg: "ap_cfg",        // settings            (written by popup)
    ctl: "ap_ctl",        // global stop signal  (popup, only on stop-all)
    replies: "ap_replies" // captured responses  (written by content)
    // per-tab keys are derived at runtime:
    //   ap_stats_<id> / ap_log_<id> / ap_ctl_<id>   where <id> = 8-char run token
  };
  // Legacy single-tab keys (v4) are read for migration but no longer written.
  KEYS.st = "ap_stats";
  KEYS.log = "ap_log";

  const DEFAULTS = {
    mode: "generate",            // generate | list | shuffle | chain | single
    prompts: "",
    suffix: "",
    categories: ["general", "study", "creative"],
    delayMin: 5,
    delayMax: 10,
    maxPrompts: 0,
    maxMinutes: 0,
    newChatEvery: 0,
    onLimitNewChat: true,
    switchModel: true,
    limitWaitMin: 5,
    autoRetry: true,
    showPanel: true,
    /* --- v5 additions --- */
    typingHuman: false,          // type character-by-character with jitter
    typingMsMin: 8,              // per-character delay range when typingHuman
    typingMsMax: 25,
    captureReplies: false,       // store every assistant reply for export
    allTabs: false,              // start on every matching tab, not just the active one
    chainLoop: false,            // when mode=chain: restart the chain after finishing
    siteDelays: {},              // per-site delay overrides { chatgpt:{delayMin,delayMax}, ... }
    schedule: { enabled: false, time: "09:00", days: [1, 2, 3, 4, 5], maxPrompts: 0, maxMinutes: 0 }
  };

  const CATEGORIES = {
    general: "General",
    study: "Study",
    creative: "Creative",
    coding: "Coding",
    business: "Business",
    health: "Health"
  };

  const BANKS = {
    general: {
      tasks: [
        "Explain", "Give me 5 interesting facts about", "Summarize the history of",
        "Give me a beginner's guide to", "What are the pros and cons of", "Explain like I'm 10:",
        "Teach me the basics of", "List common myths about", "Explain the future of",
        "Give practical tips about", "Explain common mistakes people make with",
        "Tell me a surprising story about", "Create a checklist for", "Compare two views on"
      ],
      topics: [
        "black holes", "the ocean", "time management", "artificial intelligence", "the Roman Empire",
        "healthy sleep habits", "space travel", "the human brain", "renewable energy", "chess",
        "coffee", "learning a new language", "friendship", "the internet", "dinosaurs", "volcanoes",
        "public speaking", "budgeting", "meditation", "electric cars", "the Moon", "photography",
        "cooking at home", "climate change", "cricket", "music theory", "ancient Egypt", "robots",
        "teamwork", "memory and learning", "mountains", "desert survival", "online privacy",
        "gardening", "the printing press", "dreams", "quantum computing", "birds", "minimalism",
        "video games", "the water cycle", "street food", "ancient trade routes", "creativity",
        "traveling on a budget", "first aid basics", "the solar system", "habit building",
        "inventions that changed the world", "rain", "the history of money", "bicycles", "libraries"
      ]
    },
    study: {
      tasks: [
        "Create a 5-question quiz about", "Explain step by step:", "Make a 7-day study plan for",
        "Give me flashcards for", "Summarize the key ideas of", "Explain with a real-world analogy:",
        "Give me 3 practice problems on", "List common exam mistakes in"
      ],
      topics: [
        "photosynthesis", "Newton's laws of motion", "the French Revolution", "supply and demand",
        "probability", "DNA and genes", "the periodic table", "fractions and decimals", "World War II",
        "cell biology", "algebra basics", "the scientific method", "English grammar tenses",
        "the human digestive system", "electric circuits", "plate tectonics", "statistics basics",
        "essay writing", "the Cold War", "chemical reactions", "the respiratory system", "geometry"
      ]
    },
    creative: {
      tasks: [
        "Write a short story about", "Write a poem about", "Write a riddle about",
        "Write a funny dialogue about", "Write a catchy social media post about",
        "Write a product description inspired by", "Write a letter to a friend about",
        "Brainstorm startup ideas around", "Write a motivational speech about",
        "Describe a day in the life involving"
      ],
      topics: [
        "kindness", "a lost robot", "the ocean at night", "a haunted library", "time travel",
        "a talking cat", "a mountain village", "a space station", "rain on a tin roof",
        "an old lighthouse", "friendship", "a magical bakery", "a desert caravan",
        "the last dragon", "a city under the sea", "a forgotten train station"
      ]
    },
    coding: {
      tasks: [
        "Explain with a short code example:", "Write a JavaScript function for",
        "Write a Python script that demonstrates", "Show common mistakes and fixes for",
        "Give me best practices for", "Explain the time complexity of",
        "Compare two approaches to", "Write unit tests for code that handles"
      ],
      topics: [
        "debouncing", "binary search", "recursion", "REST API design", "async/await", "SQL joins",
        "closures", "hash maps", "Git branching", "regular expressions", "sorting algorithms",
        "error handling", "caching", "linked lists", "dependency injection", "pagination",
        "rate limiting", "memoization", "the event loop", "data validation"
      ]
    },
    business: {
      tasks: [
        "Give me a checklist for", "Write a short email about", "Create a 30-day plan for",
        "Explain the basics of", "What are the biggest risks of", "Brainstorm ideas to improve",
        "Write a short pitch for", "Give practical tips about"
      ],
      topics: [
        "launching a small online store", "customer support", "freelancing", "cold outreach",
        "pricing a product", "personal branding", "remote work", "market research",
        "writing a business plan", "negotiation", "managing a budget", "building a newsletter",
        "SEO basics", "social media marketing", "project planning", "client onboarding",
        "collecting customer feedback", "productivity systems"
      ]
    },
    health: {
      tasks: [
        "Give me a beginner's guide to", "Create a simple weekly plan for",
        "Explain the benefits of", "Give practical tips about", "List common myths about",
        "Suggest easy habits for"
      ],
      topics: [
        "healthy sleep", "stretching", "daily walking", "meal prep", "drinking enough water",
        "stress management", "posture at a desk", "home workouts", "mindful breathing",
        "healthy snacks", "a morning routine", "eye care for screen users",
        "strength training basics", "balanced breakfasts", "a digital detox"
      ]
    }
  };

  const STYLES = [
    "Keep it short.", "Use simple words.", "Use bullet points.", "Add a fun example.",
    "Make it creative.", "Keep it under 150 words.", "End with a question for me.",
    "Use a friendly tone.", "Be detailed.", "Add one practical tip.", ""
  ];

  const pick = a => a[Math.floor(Math.random() * a.length)];

  /** Build one random prompt from the selected categories (never equal to `avoid`). */
  function generate(categories, avoid) {
    const cats = (categories || []).filter(c => BANKS[c]);
    const list = cats.length ? cats : ["general"];
    let p = "";
    for (let i = 0; i < 12; i++) {
      const b = BANKS[pick(list)];
      p = `${pick(b.tasks)} ${pick(b.topics)}. ${pick(STYLES)}`.trim();
      if (p !== avoid) break;
    }
    return p;
  }

  /* ============================================================
     Site adapters — every UI selector lives here, in one place.
     content.js never hardcodes a selector; popup diagnostics can
     test each adapter directly.
     ============================================================ */
  const SITES = {
    chatgpt: {
      id: "chatgpt",
      name: "ChatGPT",
      match: h => /(^|\.)chatgpt\.com$/.test(h) || /(^|\.)chat\.openai\.com$/.test(h),
      origin: "https://chatgpt.com/",
      composer: '#prompt-textarea, div.ProseMirror[contenteditable="true"], form textarea',
      composerFirst: el => el.id === "prompt-textarea",
      sendBtn: 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label^="Send"]',
      stopBtn: 'button[data-testid="stop-button"], .result-streaming, button[aria-label*="Stop"]',
      stopLabel: /^stop( streaming| generating| response)?$/i,
      user: '[data-message-author-role="user"]',
      assistant: '[data-message-author-role="assistant"]',
      turns: '[data-testid^="conversation-turn"]',
      newChat: 'a[data-testid="create-new-chat-button"], a[href="/"], button[aria-label="New chat"]',
      isHome: p => p === "/" || p === "",
      homeUrl: () => "/",
      modelSwitcher: {
        button: 'button[data-testid="model-switcher-dropdown-button"]',
        items: '[role="menuitem"], [role="menuitemradio"], [data-testid^="model-switcher-"]'
      },
      blockScopes: '[role="dialog"], [role="alert"], main'
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      match: h => /(^|\.)gemini\.google\.com$/.test(h),
      origin: "https://gemini.google.com/app",
      composer: 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"]',
      sendBtn: 'button.send-button:not(.stop), button[aria-label="Send message"], button[aria-label^="Send"]',
      stopBtn: 'button.send-button.stop, button.stop, button[aria-label="Stop response"], button[aria-label*="Stop"], model-response .pending',
      user: "user-query",
      assistant: "model-response",
      turns: null, // counted via user queries
      newChat: '[data-test-id="new-chat-button"] a, a[data-test-id="new-chat-button"], [data-test-id="new-chat-button"], a[aria-label="New chat"], button[aria-label="New chat"], a[href$="/app"]',
      isHome: p => /\/app\/?$/.test(p),
      homeUrl: p => (p || "/app").replace(/\/app.*$/, "/app"),
      modelSwitcher: null, // Gemini has no safe model switcher to automate
      blockScopes: '[role="dialog"], [role="alert"], main, mat-snack-bar, .snackbar'
    },
    claude: {
      id: "claude",
      name: "Claude",
      match: h => /(^|\.)claude\.ai$/.test(h),
      origin: "https://claude.ai/new",
      composer: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"][role="textbox"], fieldset div[contenteditable="true"]',
      sendBtn: 'button[aria-label="Send message"], button[data-testid="send-button"], button[aria-label^="Send"]',
      stopBtn: 'button[aria-label="Stop response"], button[aria-label="Stop"], .streaming',
      stopLabel: /^stop( streaming| generating| response)?$/i,
      user: '[data-testid="user-message"], .font-user-message',
      assistant: '[data-testid="assistant-message"], .font-claude-message',
      turns: null,
      newChat: 'a[href="/new"], button[aria-label="New chat"], a[aria-label="New chat"]',
      isHome: p => p === "/" || p === "" || p === "/new" || /^\/new/.test(p),
      homeUrl: () => "/new",
      modelSwitcher: null, // Claude model switching (account-bound) is not automated
      blockScopes: '[role="dialog"], [role="alert"], main, .toast'
    }
  };

  /** Which adapter matches this hostname? Returns null for unknown sites. */
  function siteFor(hostname) {
    for (const s of Object.values(SITES)) if (s.match(hostname)) return s;
    return null;
  }

  /* ============================================================
     Prompt variables — {date} {time} {counter} {random:A-B} {uuid}
     ============================================================ */
  function applyVars(text, vars) {
    const v = vars || {};
    return (text || "")
      .replace(/\{date\}/gi, v.date || "")
      .replace(/\{time\}/gi, v.time || "")
      .replace(/\{counter\}/gi, String(v.counter != null ? v.counter : ""))
      .replace(/\{uuid\}/gi, v.uuid || "")
      .replace(/\{random\s*:\s*(\d+)\s*-\s*(\d+)\}/gi, (_, a, b) => {
        const lo = Math.min(+a, +b), hi = Math.max(+a, +b);
        return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
      });
  }

  /* ---- prompt-list helpers (used by both popup and content) ---- */
  const promptLines = t => (t || "").split("\n").map(x => x.trim()).filter(Boolean);

  /** Build the prompt to send. Returns { text, idx, chainDone } */
  function buildPrompt(cfg, st) {
    const lines = promptLines(cfg.prompts);
    let text = "", idx = st.idx || 0, chainDone = false;
    if (cfg.mode === "single" && (cfg.prompts || "").trim()) {
      text = cfg.prompts.trim();
    } else if (cfg.mode === "chain") {
      if (idx < lines.length) { text = lines[idx]; idx++; }
      else if (cfg.chainLoop) { idx = 1; text = lines[0]; }
      else chainDone = true;
    } else if (cfg.mode === "list" && lines.length) {
      text = lines[idx % lines.length];
      idx++;
    } else if (cfg.mode === "shuffle" && lines.length) {
      for (let i = 0; i < 8; i++) {
        text = lines[Math.floor(Math.random() * lines.length)];
        if (lines.length < 2 || text !== st.lastPrompt) break;
      }
    } else {
      text = generate(cfg.categories, st.lastPrompt);
    }
    if (text) {
      text = applyVars(text, {
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        counter: (st.sent || 0) + 1,
        uuid: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now())
      });
      if (cfg.suffix && cfg.suffix.trim()) text += " " + cfg.suffix.trim();
    }
    return { text, idx, chainDone };
  }

  return { KEYS, DEFAULTS, CATEGORIES, SITES, siteFor, generate, pick, buildPrompt, applyVars, promptLines };
})();
