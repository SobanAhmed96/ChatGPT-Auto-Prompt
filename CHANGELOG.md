# Changelog

## 5.0.0
### New sites
- Claude (claude.ai) support — composer, send, stop detection, new chat, limit/full detection.
- All UI selectors centralized in `shared.js` → `SITES` adapters (chatgpt / gemini / claude); content.js no longer hardcodes selectors.

### New features
- Prompt **chain** mode: each prompt sent exactly once, in order, then stops (optional loop).
- Prompt variables: `{date}`, `{time}`, `{counter}`, `{random:A-B}`, `{uuid}`.
- **Capture replies** + export as Markdown from the popup.
- **Schedule**: automatic daily runs at a set time on chosen weekdays (chrome.alarms).
- **Settings import/export** as JSON.
- **Selector self-test** diagnostic in the popup.
- **Human-like typing** with per-character jitter.
- **Per-site delay overrides** (ChatGPT / Gemini / Claude each with own pace).

### Fixes
- Limit/full-chat detection now scans only dialogs, alerts, snackbars and `<main>` — no more false positives from sidebar or message text, and modals are covered.
- All swallowed `catch (_) {}` blocks now log their errors.
- Storage errors surface in the activity log instead of failing silently.
- Per-tab stats/logs/control keys (`ap_stats_<id>` etc.) — several sites can run in parallel tabs without clobbering each other; popup aggregates counters and Stop-All stops every run.

## 4.1.0
- Original release (ChatGPT + Gemini).
