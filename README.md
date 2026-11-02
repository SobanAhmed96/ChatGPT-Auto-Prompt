# Auto Prompt for ChatGPT & Gemini & Claude  v5.0

Chrome/Edge/Brave extension (Manifest V3) that keeps sending prompts to ChatGPT, Google Gemini (gemini.google.com) and Claude (claude.ai) automatically.

## Install
1. Unzip the folder.
2. Open `chrome://extensions` → turn on **Developer mode**.
3. **Load unpacked** → select this folder. (If you had the old version, remove it first or press Reload.)
4. Open chatgpt.com, gemini.google.com or claude.ai, click the extension icon, set things up, press **Start** (on the chat tab).

## Features
- Prompt sources: auto-generate (6 categories), your own list in order, your list in random order, a **prompt chain** (each prompt sent once, in order), or one prompt repeated.
- **Prompt variables**: `{date}`, `{time}`, `{counter}`, `{random:1-100}`, `{uuid}` — replaced in every prompt.
- "Add to every prompt" text (e.g. "Answer in simple English.").
- Random wait between prompts (min–max seconds), with **per-site overrides** so ChatGPT, Gemini and Claude can each have their own pace.
- **Human-like typing** mode (character-by-character with random jitter).
- New chat automatically when: the usage limit is hit, the chat is full / too long, every N prompts (optional), or after repeated errors.
- On limit: tries another model, opens a new chat, and if everything is limited waits N minutes and tries again.
- Auto-retry "Something went wrong" replies.
- **Capture replies** and export every response as a Markdown file.
- **Schedule**: start a run automatically at a set time on chosen weekdays.
- **Settings import / export** as JSON — share configs between machines.
- **Selector self-test** (Run selector test) — shows instantly whether the extension's UI detection works on the current site version.
- Stop automatically after X prompts or X minutes.
- Floating on-page panel (Pause / Resume / Stop, live status, counters) + hotkeys Alt+Shift+P / Alt+Shift+X.
- Activity log in the popup. Light/dark theme follows your system.

## Supported sites
| Site | Status |
|---|---|
| chatgpt.com | Full (incl. model switching on limit) |
| gemini.google.com | Full (new chat / wait on limit) |
| claude.ai | Full (new chat / wait on limit) |

All UI selectors for every site live in one place — `shared.js` → `SITES` — so site updates can be fixed in a single file. If a site redesign breaks something, use **Run selector test** in the popup's Automation tab to see exactly which selector failed.

## If it ever stops sending
Open the popup → **Log** tab → press Copy and send me the text. It says exactly which step failed.

Note: model switching on limit works on ChatGPT only; on Gemini and Claude it opens a new chat / waits instead.
