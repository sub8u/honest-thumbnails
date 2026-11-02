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

// ---- Keyboard shortcut and OFF badge ----
function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#777777' });
}
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd !== 'toggle-enabled') return;
  chrome.storage.sync.get({ enabled: true }, (s) => chrome.storage.sync.set({ enabled: !s.enabled }));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) updateBadge(changes.enabled.newValue !== false);
});
chrome.storage.sync.get({ enabled: true }, (s) => updateBadge(s.enabled));

async function runLlm({ system, user }) {
  const s = await chrome.storage.sync.get({ aiEndpoint: '', aiModel: '', aiDailyCap: DAILY_DEFAULT });
  const { aiKey = '' } = await chrome.storage.local.get('aiKey');
  if (!s.aiEndpoint || !s.aiModel) throw new Error('Set your endpoint and model in the extension options.');

  const today = new Date().toISOString().slice(0, 10);
  const { aiUsage = { day: today, n: 0 } } = await chrome.storage.local.get('aiUsage');
  const usage = aiUsage.day === today ? aiUsage : { day: today, n: 0 };
  if (usage.n >= s.aiDailyCap) throw new Error(`Daily limit of ${s.aiDailyCap} summaries reached.`);

  const url = s.aiEndpoint.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (aiKey) headers.Authorization = 'Bearer ' + aiKey;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: s.aiModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error.message || ''; } catch (e) { /* ignore */ }
    throw new Error(`Provider error ${res.status}${detail ? ': ' + detail.slice(0, 120) : ''}`);
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('The provider returned an empty answer.');

  usage.n += 1;
  await chrome.storage.local.set({ aiUsage: usage });
  return text.trim();
}
