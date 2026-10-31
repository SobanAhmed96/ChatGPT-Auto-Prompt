# Auto Prompt for ChatGPT & Gemini  v4.1

Chrome/Edge/Brave extension (Manifest V3) that keeps sending prompts to ChatGPT and Google Gemini (gemini.google.com) automatically.

## Install
1. Unzip the folder.
2. Open `chrome://extensions` → turn on **Developer mode**.
3. **Load unpacked** → select this folder. (If you had the old version, remove it first or press Reload.)
4. Open chatgpt.com or gemini.google.com, click the extension icon, set things up, press **Start** (on the ChatGPT tab).

## Features
- Prompt sources: auto-generate (6 categories), your own list in order, your list in random order, or one prompt repeated.
- "Add to every prompt" text (e.g. "Answer in simple English.").
- Random wait between prompts (min–max seconds) so it does not look robotic.
- New chat automatically when: the usage limit is hit, the chat is full / too long, every N prompts (optional), or after repeated errors.
- On limit: tries another model, opens a new chat, and if everything is limited waits N minutes and tries again.
- Auto-retry "Something went wrong" replies.
- Stop automatically after X prompts or X minutes.
- Floating on-page panel (Pause / Resume / Stop, live status, counters) + hotkeys Alt+Shift+P / Alt+Shift+X.
- Activity log in the popup. Light/dark theme follows your system.

## If it ever stops sending
Open the popup → **Log** tab → press Copy and send me the text. It says exactly which step failed.

Note: model switching on limit works on ChatGPT only; on Gemini it opens a new chat / waits instead.
