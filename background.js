/* Background service worker (v5)
   - Runs the schedule (chrome.alarms): starts a run once a day at the chosen time. */

const ALARM = "ap_schedule_tick";

function setupAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 }).catch(e => {
    console.warn("[AutoPrompt] alarm setup failed:", e && e.message);
  });
}

chrome.runtime.onInstalled.addListener(setupAlarm);
chrome.runtime.onStartup.addListener(setupAlarm);
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.ap_cfg) setupAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;

  let cfg;
  try {
    const o = await chrome.storage.local.get("ap_cfg");
    cfg = o.ap_cfg;
  } catch (e) { return; }
  if (!cfg || !cfg.schedule || !cfg.schedule.enabled) return;

  const s = cfg.schedule;
  const now = new Date();
  if (!(s.days || []).includes(now.getDay())) return;

  const parts = (s.time || "09:00").split(":").map(Number);
  if (now.getHours() !== parts[0] || now.getMinutes() !== parts[1]) return;

  // fire once per day
  const key = "ap_last_fire";
  const today = now.toDateString();
  try {
    const prev = await chrome.storage.local.get(key);
    if (prev[key] === today) return;
    await chrome.storage.local.set({ [key]: today });
  } catch (e) { /* ignore */ }

  // open a tab and send START once the content script is up
  const target = "https://chatgpt.com/";
  try {
    await chrome.tabs.create({ url: target, active: false });
  } catch (e) {
    console.warn("[AutoPrompt] scheduled tab open failed:", e && e.message);
    return;
  }
  setTimeout(async () => {
    try {
      const tabs = await chrome.tabs.query({ url: target + "*" });
      for (const t of tabs) {
        try { await chrome.tabs.sendMessage(t.id, { action: "START" }); break; }
        catch (e) { /* not ready yet, skip */ }
      }
    } catch (e) {
      console.warn("[AutoPrompt] scheduled start failed:", e && e.message);
    }
  }, 8000);
});
