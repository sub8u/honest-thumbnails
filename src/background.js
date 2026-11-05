// Calls the user's own OpenAI-compatible endpoint (OpenAI, Gemini, OpenRouter, Ollama, LM Studio, ...).
// The key is read from local storage and never leaves the device except to the endpoint the user chose.
const DAILY_DEFAULT = 100;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'ht-llm') {
    runLlm(msg).then(
      (text) => sendResponse({ ok: true, text }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true; // async response
  }
  if (msg.type === 'ht-sponsor') {
    sponsorInfo(msg.id).then(
      (r) => sendResponse({ ok: true, ...r }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true;
  }
});

// ---- Sponsor segments from the community SponsorBlock database (opt-in, see options page) ----
// Uses the privacy-preserving lookup: only the first 4 characters of a hash of the video ID are sent.
async function sponsorInfo(id) {
  if (!/^[\w-]{11}$/.test(id || '')) throw new Error('bad id');
  const ok = await chrome.permissions.contains({ origins: ['https://sponsor.ajay.app/*'] });
  if (!ok) throw new Error('no permission');
  const bytes = new TextEncoder().encode(id);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const url = `https://sponsor.ajay.app/api/skipSegments/${hex.slice(0, 4)}?categories=${encodeURIComponent('["sponsor"]')}`;
  const r = await fetch(url);
  if (r.status === 404) return { secs: 0, count: 0 };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const list = await r.json();
  const v = Array.isArray(list) ? list.find((x) => x.videoID === id) : null;
  const segs = ((v && v.segments) || []).filter((g) => g.category === 'sponsor' && g.segment && g.segment.length === 2);
  const secs = segs.reduce((sum, g) => sum + Math.max(0, g.segment[1] - g.segment[0]), 0);
  return { secs: Math.round(secs), count: segs.length };
}

// ---- On/off state: green icon when working, grey when off or paused ----
// A pause ("Pause for 1 hour" in the popup) is stored locally as a timestamp; an alarm clears it when it ends.
const ICONS_ON = { 16: '/icons/icon16.png', 32: '/icons/icon32.png', 48: '/icons/icon48.png', 128: '/icons/icon128.png' };
const ICONS_OFF = { 16: '/icons/icon16-off.png', 32: '/icons/icon32-off.png', 48: '/icons/icon48-off.png', 128: '/icons/icon128-off.png' };

async function refreshState() {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  const { pausedUntil = 0 } = await chrome.storage.local.get('pausedUntil');
  const paused = pausedUntil > Date.now();
  if (pausedUntil && !paused) await chrome.storage.local.remove('pausedUntil'); // pause already over
  const on = enabled && !paused;
  await chrome.action.setIcon({ path: on ? ICONS_ON : ICONS_OFF });
  await chrome.action.setBadgeText({ text: '' });
  const until = paused ? new Date(pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  await chrome.action.setTitle({ title: on ? 'Honest Thumbnails' : paused ? `Honest Thumbnails: paused until ${until}` : 'Honest Thumbnails: off' });
  if (paused) chrome.alarms.create('ht-resume', { when: pausedUntil });
  else chrome.alarms.clear('ht-resume');
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'ht-resume') chrome.storage.local.remove('pausedUntil');
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-enabled') return;
  const { pausedUntil = 0 } = await chrome.storage.local.get('pausedUntil');
  if (pausedUntil > Date.now()) { await chrome.storage.local.remove('pausedUntil'); return; } // shortcut ends a pause
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  await chrome.storage.sync.set({ enabled: !enabled });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' && changes.enabled) || (area === 'local' && changes.pausedUntil)) refreshState();
});
chrome.runtime.onStartup.addListener(refreshState);
chrome.runtime.onInstalled.addListener(refreshState);
refreshState();

// Turns provider errors into something a person can act on.
function friendlyError(status, detail) {
  const d = detail ? ` (${detail.slice(0, 120)})` : '';
  if (status === 401 || status === 403) return 'The API key was rejected. Check that it was copied in full and is still active.' + d;
  if (status === 404) return 'The endpoint or model name was not found. Check the model name against your provider\u2019s list.' + d;
  if (status === 429) return 'Your provider says you\u2019re out of credit or sending too many requests.' + d;
  if (status >= 500) return 'Your provider had a problem on its side. Try again in a minute.' + d;
  return `Your provider returned error ${status}.` + d;
}

async function runLlm({ system, user, test }) {
  const s = await chrome.storage.sync.get({ aiEndpoint: '', aiModel: '', aiDailyCap: DAILY_DEFAULT });
  const { aiKey = '' } = await chrome.storage.local.get('aiKey');
  if (!s.aiEndpoint || !s.aiModel) throw new Error('Set your endpoint and model in the extension options.');

  const today = new Date().toISOString().slice(0, 10);
  const { aiUsage = { day: today, n: 0 } } = await chrome.storage.local.get('aiUsage');
  const usage = aiUsage.day === today ? aiUsage : { day: today, n: 0 };
  if (!test && usage.n >= s.aiDailyCap) throw new Error(`Daily limit of ${s.aiDailyCap} summaries reached.`);

  const url = s.aiEndpoint.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (aiKey) headers.Authorization = 'Bearer ' + aiKey;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: s.aiModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    });
  } catch (e) {
    const local = /localhost|127\.0\.0\.1/.test(url);
    throw new Error(local
      ? 'Couldn\u2019t reach your local model. Make sure it\u2019s running (Ollama: start it with OLLAMA_ORIGINS=chrome-extension://*).'
      : 'Couldn\u2019t reach the endpoint. Check the address and your internet connection.');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error.message || ''; } catch (e) { /* ignore */ }
    throw new Error(friendlyError(res.status, detail));
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('The provider returned an empty answer.');

  if (!test) {
    usage.n += 1;
    await chrome.storage.local.set({ aiUsage: usage });
  }
  return text.trim();
}
