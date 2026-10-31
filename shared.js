/* Shared between popup.js and content.js (same global `AP`). */
globalThis.AP = globalThis.AP || (() => {
  const KEYS = {
    cfg: "ap_cfg",     // settings            (written by popup)
    ctl: "ap_ctl",     // running / paused    (popup + content, only on stop)
    st: "ap_stats",    // runtime counters    (written by content)
    log: "ap_log"      // activity log        (written by content)
  };

  const DEFAULTS = {
    mode: "generate",          // generate | list | shuffle | single
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
    showPanel: true
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

  return { KEYS, DEFAULTS, CATEGORIES, generate, pick };
})();
