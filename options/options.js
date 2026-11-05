const DEFAULTS = {
  aiProvider: 'off', aiEndpoint: '', aiModel: '', aiDailyCap: 100, summaryLang: 'auto', sponsorChip: false,
  mutedWords: [], exceptions: [], mode: 'frame'
};
// Model names change often; these were current in November 2026. "Save and test" catches a stale one.
const PRESETS = {
  openai: { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.4-nano', key: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash-lite', key: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.4-nano', key: 'https://openrouter.ai/keys' },
  ollama: { name: 'Ollama (local)', endpoint: 'http://localhost:11434/v1', model: 'llama3.2', local: 'https://ollama.com/download',
    hint: 'Install Ollama, run “ollama pull llama3.2”, and start it with OLLAMA_ORIGINS=chrome-extension://* so the extension may call it.' },
  lmstudio: { name: 'LM Studio (local)', endpoint: 'http://localhost:1234/v1', model: '', local: 'https://lmstudio.ai',
    hint: 'Load a model in LM Studio, turn on its local server, and enter the model’s name below.' },
  other: { name: 'Other', endpoint: '', model: '' }
};
const ONDEVICE_LANGS = ['en', 'es', 'ja', 'de', 'fr'];
const $ = (id) => document.getElementById(id);
const Titles = window.HonestTitles;

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
function say(msg, kind) { const s = $('status'); s.textContent = msg; s.className = kind || ''; }

// ============================================================
// Summaries
// Off and "On this computer" save as soon as they're picked. "My own AI service" saves with
// "Save and test", because saving asks Chrome for permission to reach that one address.
// ============================================================
let saved = { ...DEFAULTS };
let preset = 'openai';

function chosen() { return document.querySelector('input[name=aiProvider]:checked').value; }

function presetFor(endpoint) {
  const hit = Object.entries(PRESETS).find(([k, p]) => p.endpoint && endpoint && endpoint.replace(/\/+$/, '') === p.endpoint);
  return hit ? hit[0] : (endpoint ? 'other' : 'openai');
}

function renderPills() {
  const box = $('presetPills');
  box.replaceChildren();
  Object.entries(PRESETS).forEach(([k, p]) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'preset'; input.value = k; input.checked = k === preset;
    input.addEventListener('change', () => choosePreset(k, true));
    const span = document.createElement('span');
    span.textContent = p.name;
    label.append(input, span);
    box.append(label);
  });
}

function choosePreset(k, fill) {
  preset = k;
  const p = PRESETS[k];
  if (fill) { $('aiEndpoint').value = p.endpoint; $('aiModel').value = p.model; say(''); }
  $('keyStep').hidden = !!p.local;
  $('localStep').hidden = !p.local;
  if (p.local) { $('localLink').href = p.local; $('localHint').textContent = p.hint; }
  if (p.key) $('keyLink').href = p.key;
  $('keyLink').hidden = !p.key;
  $('advBox').open = k === 'other';
  $('aiModel').placeholder = k === 'lmstudio' ? 'the model loaded in LM Studio' : 'model name';
}

function syncSummaryUI() {
  const prov = chosen();
  $('offBox').hidden = prov !== 'off';
  $('deviceBox').hidden = prov !== 'chrome';
  $('apiBox').hidden = prov !== 'api';
  $('capRow').hidden = prov !== 'api';
  if (prov === 'chrome') checkDevice();
  if (prov === 'api' && saved.aiProvider !== 'api') say('Fill these in, then press Save and test to switch to your own AI service.');
  const mode = saved.mode;
  $('modeNote').textContent = mode === 'text' ? '' :
    `You’re using ${mode === 'frame' ? 'Real frame' : 'Original'} thumbnails, so switch to Title card in the toolbar popup to summarize from the feed.`;
  $('modeNote').className = mode === 'text' ? 'note' : 'note warn';
}

chrome.storage.sync.get(DEFAULTS, async (s) => {
  saved = s;
  document.querySelectorAll('input[name=aiProvider]').forEach((r) => { r.checked = r.value === s.aiProvider; });
  preset = presetFor(s.aiEndpoint);
  $('aiEndpoint').value = s.aiEndpoint || PRESETS[preset].endpoint;
  $('aiModel').value = s.aiModel || PRESETS[preset].model;
  $('aiDailyCap').value = s.aiDailyCap;
  $('summaryLang').value = s.summaryLang;
  $('sponsorChip').checked = s.sponsorChip;
  const { aiKey = '' } = await chrome.storage.local.get('aiKey');
  $('aiKey').value = aiKey;
  renderPills();
  choosePreset(preset, false);
  if (s.aiProvider === 'api') say('✓ Set up. Press Save and test any time to check it again.', 'ok');
  syncSummaryUI();
  renderUsage();
  renderMuted(s.mutedWords);
  renderChannels(s.exceptions);
});

document.querySelectorAll('input[name=aiProvider]').forEach((r) => r.addEventListener('change', () => {
  const v = r.value;
  if (v !== 'api') {
    chrome.storage.sync.set({ aiProvider: v }, () => {
      saved.aiProvider = v;
      toast(v === 'off' ? 'Summaries turned off' : 'Summaries will run on this computer');
    });
  }
  syncSummaryUI();
}));
['aiEndpoint', 'aiModel', 'aiKey'].forEach((id) => $(id).addEventListener('input', () => say('')));

// ---- "On this computer": ask Chrome whether its built-in model can run here ----
function deviceIO() {
  const lang = $('summaryLang').value === 'auto' ? (navigator.language || 'en').slice(0, 2) : $('summaryLang').value;
  const out = ONDEVICE_LANGS.includes(lang) ? lang : 'en';
  return { expectedInputs: [{ type: 'text', languages: [...new Set(['en', out])] }], expectedOutputs: [{ type: 'text', languages: [out] }] };
}

function deviceState(kind, html, canDownload) {
  $('deviceDot').className = 'dot ' + kind;
  $('deviceText').innerHTML = html; // fixed strings only, written below
  $('deviceDownload').hidden = !canDownload;
}

async function checkDevice() {
  if (!('LanguageModel' in self)) {
    if ('Summarizer' in self) {
      const a = await Summarizer.availability().catch(() => 'unavailable');
      if (a !== 'unavailable') return deviceState(a === 'available' ? 'ok' : 'wait',
        a === 'available' ? '<b>Ready.</b> Chrome’s built-in summarizer works on this computer.' :
        '<b>Almost ready.</b> Chrome will download its AI model the first time you summarize.', a !== 'available');
    }
    return deviceState('bad', '<b>Not available in this browser.</b> It needs Chrome 138 or newer on a desktop computer. Choose <b>My own AI service</b> instead, or update Chrome.');
  }
  const a = await LanguageModel.availability(deviceIO()).catch(() => 'unavailable');
  if (a === 'available') return deviceState('ok', '<b>Ready.</b> Chrome’s built-in AI works on this computer. Nothing you summarize leaves it.');
  if (a === 'downloadable') return deviceState('wait', '<b>Almost ready.</b> Chrome needs to download its AI model once (a few GB). Download it now, or it will start the first time you summarize.', true);
  if (a === 'downloading') return deviceState('wait', '<b>Downloading Chrome’s AI model…</b> You can keep browsing; summaries work when it finishes.', false);
  return deviceState('bad', '<b>This computer can’t run Chrome’s built-in AI.</b> See what it needs below, or choose <b>My own AI service</b> instead.');
}

$('deviceDownload').addEventListener('click', async () => {
  $('deviceDownload').hidden = true;
  $('deviceProgress').hidden = false;
  deviceState('wait', '<b>Downloading Chrome’s AI model…</b> This can take a while. You can close this page; it carries on.');
  try {
    const session = await LanguageModel.create({
      ...deviceIO(),
      monitor(m) { m.addEventListener('downloadprogress', (e) => { $('deviceBar').style.width = Math.round(e.loaded * 100) + '%'; }); }
    });
    session.destroy();
    $('deviceProgress').hidden = true;
    checkDevice();
  } catch (e) {
    $('deviceProgress').hidden = true;
    deviceState('bad', '<b>The download didn’t finish.</b> Check your connection and free disk space, then try again.', true);
  }
});

// ---- "My own AI service": save, ask for permission, then make one tiny test call ----
$('save').addEventListener('click', async () => {
  const endpoint = $('aiEndpoint').value.trim().replace(/\/+$/, '');
  const model = $('aiModel').value.trim();
  const key = $('aiKey').value.trim();
  let u;
  try { u = new URL(endpoint); } catch (e) { $('advBox').open = true; return say('Enter the endpoint address (under “Endpoint address”).', 'err'); }
  if (!model) return say('Enter a model name.', 'err');
  if (!key && !PRESETS[preset].local && preset !== 'other') return say('Paste your API key first.', 'err');
  const ok = await chrome.permissions.request({ origins: [`${u.protocol}//${u.hostname}/*`] });
  if (!ok) return say('Chrome’s permission wasn’t granted, so nothing was saved.', 'err');
  await chrome.storage.local.set({ aiKey: key });
  await chrome.storage.sync.set({ aiProvider: 'api', aiEndpoint: endpoint, aiModel: model });
  saved.aiProvider = 'api';
  $('save').disabled = true;
  say('Saved. Testing…');
  const t0 = performance.now();
  chrome.runtime.sendMessage({ type: 'ht-llm', test: true, system: 'Reply with the single word OK.', user: 'ping' }, (resp) => {
    $('save').disabled = false;
    if (chrome.runtime.lastError || !resp) return say('Saved, but the test couldn’t run. Reload the extension and try again.', 'err');
    if (resp.ok) return say(`✓ Working. ${PRESETS[preset].name === 'Other' ? 'Your service' : PRESETS[preset].name} answered in ${((performance.now() - t0) / 1000).toFixed(1)} s.`, 'ok');
    say('Saved, but the test failed: ' + resp.error, 'err');
  });
});

// ---- Options: language and daily limit save as you change them ----
$('summaryLang').addEventListener('change', () => {
  chrome.storage.sync.set({ summaryLang: $('summaryLang').value }, () => toast('Summary language saved'));
  if (chosen() === 'chrome') checkDevice();
});
$('aiDailyCap').addEventListener('change', () => {
  const cap = Math.max(1, Math.min(2000, Number($('aiDailyCap').value) || 100));
  $('aiDailyCap').value = cap;
  chrome.storage.sync.set({ aiDailyCap: cap }, () => { toast('Daily limit saved'); renderUsage(); });
});

function renderUsage() {
  chrome.storage.local.get('aiUsage', (r) => {
    const today = new Date().toISOString().slice(0, 10);
    const n = r && r.aiUsage && r.aiUsage.day === today ? r.aiUsage.n : 0;
    const cap = Math.max(1, Number($('aiDailyCap').value) || 100);
    $('usageText').textContent = `${n} of ${cap} used today`;
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
  if (area === 'sync' && c.mode) { saved.mode = c.mode.newValue; syncSummaryUI(); }
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
