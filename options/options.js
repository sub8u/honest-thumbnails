const DEFAULTS = {
  aiProvider: 'off', aiEndpoint: '', aiModel: '', aiDailyCap: 100, summaryLang: 'auto', sponsorChip: false,
  mutedWords: [], exceptions: []
};
const PRESETS = {
  openai: ['https://api.openai.com/v1', 'gpt-4o-mini'],
  gemini: ['https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.0-flash'],
  openrouter: ['https://openrouter.ai/api/v1', 'openai/gpt-4o-mini'],
  ollama: ['http://localhost:11434/v1', 'llama3.2'],
  lmstudio: ['http://localhost:1234/v1', 'local-model']
};
const $ = (id) => document.getElementById(id);
const Titles = window.HonestTitles;

function say(msg, err) { const s = $('status'); s.textContent = msg; s.className = err ? 'err' : ''; }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ============================================================
// Summaries (saved with the button, because saving may ask for a permission)
// ============================================================
function provider() { return document.querySelector('input[name=aiProvider]:checked').value; }
function syncVisibility() { $('apiBox').hidden = provider() !== 'api'; }

chrome.storage.sync.get(DEFAULTS, async (s) => {
  document.querySelectorAll('input[name=aiProvider]').forEach((r) => { r.checked = r.value === s.aiProvider; });
  $('aiEndpoint').value = s.aiEndpoint;
  $('aiModel').value = s.aiModel;
  $('aiDailyCap').value = s.aiDailyCap;
  $('summaryLang').value = s.summaryLang;
  $('sponsorChip').checked = s.sponsorChip;
  const { aiKey = '' } = await chrome.storage.local.get('aiKey');
  $('aiKey').value = aiKey;
  syncVisibility();
  renderUsage();
  renderMuted(s.mutedWords);
  renderChannels(s.exceptions);
});

document.querySelectorAll('input[name=aiProvider]').forEach((r) => r.addEventListener('change', () => { syncVisibility(); say(''); }));
$('preset').addEventListener('change', (e) => {
  const p = PRESETS[e.target.value];
  if (p) { $('aiEndpoint').value = p[0]; $('aiModel').value = p[1]; }
});
['aiEndpoint', 'aiModel', 'aiKey', 'aiDailyCap', 'summaryLang'].forEach((id) => $(id).addEventListener('input', () => say('')));

$('save').addEventListener('click', async () => {
  const prov = provider();
  const endpoint = $('aiEndpoint').value.trim();
  const model = $('aiModel').value.trim();
  const cap = Math.max(1, Math.min(2000, Number($('aiDailyCap').value) || 100));
  if (prov === 'api') {
    let u;
    try { u = new URL(endpoint); } catch (e) { return say('Enter a valid endpoint URL.', true); }
    if (!model) return say('Enter a model name.', true);
    const ok = await chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] });
    if (!ok) return say('Permission was not granted, so nothing was saved.', true);
  }
  await chrome.storage.local.set({ aiKey: $('aiKey').value.trim() });
  await chrome.storage.sync.set({ aiProvider: prov, aiEndpoint: endpoint, aiModel: model, aiDailyCap: cap, summaryLang: $('summaryLang').value });
  say('Saved ✓');
});

function renderUsage() {
  chrome.storage.local.get('aiUsage', (r) => {
    const today = new Date().toISOString().slice(0, 10);
    const n = r && r.aiUsage && r.aiUsage.day === today ? r.aiUsage.n : 0;
    const cap = Math.max(1, Number($('aiDailyCap').value) || 100);
    $('usageText').textContent = `${n} of ${cap}`;
    $('usageBar').style.width = Math.min(100, (n / cap) * 100) + '%';
  });
}
$('aiDailyCap').addEventListener('input', renderUsage);

// ============================================================
// Muted words (saved instantly)
// ============================================================
let muted = [];
function renderMuted(list) {
  muted = list || [];
  const box = $('muteChips');
  box.replaceChildren();
  muted.forEach((w) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(w);
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Remove “' + w + '”';
    x.addEventListener('click', () => saveMuted(muted.filter((y) => y !== w)));
    chip.append(x);
    box.append(chip);
  });
  $('muteInput').placeholder = muted.length ? 'Add another…' : 'Add a word or phrase, then press Enter';
}
function saveMuted(list) {
  chrome.storage.sync.set({ mutedWords: list.slice(0, 50) }, () => { renderMuted(list.slice(0, 50)); toast('Muted words saved'); });
}
function addFromInput() {
  const add = Titles.parseMutedWords($('muteInput').value);
  $('muteInput').value = '';
  const next = muted.slice();
  add.forEach((w) => { if (!next.includes(w)) next.push(w); });
  if (next.length !== muted.length) saveMuted(next);
}
$('muteInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFromInput(); }
  else if (e.key === 'Backspace' && !e.target.value && muted.length) saveMuted(muted.slice(0, -1));
});
$('muteInput').addEventListener('blur', addFromInput);
$('muteBox').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('muteInput').focus(); });

// ============================================================
// Trusted channels (saved instantly)
// ============================================================
function renderChannels(list) {
  list = list || [];
  const ul = $('exList');
  ul.replaceChildren();
  $('exEmpty').hidden = list.length > 0;
  ul.hidden = !list.length;
  list.forEach((x) => {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'avatar';
    const name = x.n || x.k;
    av.textContent = (name.replace(/^@/, '')[0] || '?').toUpperCase();
    av.style.background = `hsl(${Titles.channelHue(x.k)} 45% 42%)`;
    const who = document.createElement('span');
    who.className = 'who';
    const b = document.createElement('b');
    b.textContent = name;
    const handle = document.createElement('small');
    handle.textContent = x.k.startsWith('@') ? x.k : 'youtube.com/' + x.k;
    who.append(b, handle);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ghost';
    rm.textContent = 'Remove';
    rm.addEventListener('click', () => {
      const next = list.filter((y) => y.k !== x.k);
      chrome.storage.sync.set({ exceptions: next }, () => { renderChannels(next); toast('Removed ' + name); });
    });
    li.append(av, who, rm);
    ul.append(li);
  });
}

// ============================================================
// Extras (saved instantly)
// ============================================================
$('sponsorChip').addEventListener('change', async (e) => {
  const on = e.target.checked;
  if (on) {
    const ok = await chrome.permissions.request({ origins: ['https://sponsor.ajay.app/*'] });
    if (!ok) { e.target.checked = false; toast('Permission not granted'); return; }
  }
  chrome.storage.sync.set({ sponsorChip: on }, () => toast(on ? 'Sponsor time on' : 'Sponsor time off'));
});

function renderCache() {
  chrome.storage.local.get('ht_cache', (r) => {
    const c = (r && r.ht_cache) || {};
    const ids = Object.keys(c);
    const sums = ids.filter((id) => c[id] && c[id].summary).length;
    $('cacheInfo').textContent = ids.length
      ? `${ids.length} videos cached on this device, ${sums} with a summary.`
      : 'Nothing cached yet.';
  });
}
renderCache();
$('clearCache').addEventListener('click', () => {
  chrome.storage.local.remove('ht_cache', () => { renderCache(); toast('Cache cleared. Reload YouTube tabs.'); });
});

if (chrome.commands && chrome.commands.getAll) {
  chrome.commands.getAll((cmds) => {
    const c = (cmds || []).find((x) => x.name === 'toggle-enabled');
    $('shortcut').textContent = c && c.shortcut ? c.shortcut : 'Not set';
  });
}

$('version').textContent = chrome.runtime.getManifest().version;

// Keep the page in step with changes made elsewhere (popup, YouTube tab).
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'sync' && c.exceptions) renderChannels(c.exceptions.newValue);
  if (area === 'sync' && c.mutedWords) renderMuted(c.mutedWords.newValue);
  if (area === 'local' && c.aiUsage) renderUsage();
});

// ============================================================
// Sidebar: highlight the section in view
// ============================================================
const links = [...document.querySelectorAll('.side a')];
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id));
  });
}, { rootMargin: '-20% 0px -70% 0px' });
document.querySelectorAll('.sec').forEach((s) => io.observe(s));
links[0].classList.add('on');
