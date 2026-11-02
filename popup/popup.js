const DEFAULTS = {
  enabled: true, mode: 'frame', frame: 2, calmTitles: false, hoverDetails: true, aiProvider: 'off',
  clickbaitFlag: true, watchPanel: true, hideShorts: false, hideMixes: false, exceptions: [],
  dimWatched: false, mutedWords: []
};
const $ = (id) => document.getElementById(id);
const TOGGLES = ['enabled', 'calmTitles', 'clickbaitFlag', 'hoverDetails', 'watchPanel', 'hideShorts', 'hideMixes', 'dimWatched'];

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function render(s) {
  TOGGLES.forEach((k) => { $(k).checked = !!s[k]; });
  document.querySelectorAll('input[name=frame]').forEach((r) => { r.checked = Number(r.value) === Number(s.frame); });
  document.querySelectorAll('input[name=mode]').forEach((r) => { r.checked = r.value === s.mode; });
  $('body').classList.toggle('off', !s.enabled);
  $('frameRow').hidden = s.mode !== 'frame';
  $('hoverRow').hidden = s.mode !== 'text';
  $('visibleBox').hidden = !(s.aiProvider !== 'off' && s.mode === 'text');

  const m = (s.mutedWords || []).length, c = (s.exceptions || []).length;
  const ft = $('filtersText');
  if (!m && !c) ft.textContent = 'Muted words & trusted channels';
  else {
    ft.replaceChildren();
    const parts = [];
    if (m) parts.push(plural(m, 'muted word', 'muted words'));
    if (c) parts.push(plural(c, 'trusted channel', 'trusted channels'));
    parts.forEach((p, i) => { if (i) ft.append(' · '); const b = document.createElement('b'); b.textContent = p; ft.append(b); });
  }
}

function save(patch) {
  chrome.storage.sync.set(patch, () => chrome.storage.sync.get(DEFAULTS, render));
}

function renderStats() {
  chrome.storage.local.get('htStats', (r) => {
    const today = new Date().toISOString().slice(0, 10);
    const st = r && r.htStats && r.htStats.day === today ? r.htStats : null;
    const p = $('stats');
    if (!st || !(st.swapped || st.flagged || st.hidden)) { p.textContent = 'Nothing swapped yet today'; return; }
    p.replaceChildren();
    p.title = 'Today, counted on this device';
    [[st.swapped, 'swapped'], [st.flagged, 'flagged'], [st.hidden, 'hidden']].filter((x) => x[0]).forEach(([n, label], i) => {
      if (i) p.append(' · ');
      const b = document.createElement('b');
      b.textContent = n.toLocaleString();
      p.append(b, ' ' + label);
    });
  });
}

function openSettings(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html' + (hash || '')) });
  window.close();
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  render(s);
  TOGGLES.forEach((k) => $(k).addEventListener('change', (e) => save({ [k]: e.target.checked })));
  document.querySelectorAll('input[name=frame]').forEach((r) => r.addEventListener('change', () => save({ frame: Number(r.value) })));
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => save({ mode: r.value })));
});
$('openOptions').addEventListener('click', (e) => { e.preventDefault(); openSettings(''); });
$('openFilters').addEventListener('click', (e) => { e.preventDefault(); openSettings('#filters'); });
renderStats();
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.htStats) renderStats(); });

// Show the real shortcut if the user changed it.
if (chrome.commands && chrome.commands.getAll) {
  chrome.commands.getAll((cmds) => {
    const c = (cmds || []).find((x) => x.name === 'toggle-enabled');
    $('shortcut').textContent = c && c.shortcut ? c.shortcut : 'not set';
  });
}

// Summarize visible: two-step confirm so nobody spends their daily limit by accident.
$('sumVisible').addEventListener('click', () => { $('sumConfirm').hidden = false; $('sumAsk').hidden = true; $('sumMsg').textContent = ''; });
$('sumCancel').addEventListener('click', () => { $('sumConfirm').hidden = true; $('sumAsk').hidden = false; });
$('sumGo').addEventListener('click', () => {
  $('sumConfirm').hidden = true; $('sumAsk').hidden = false;
  $('sumMsg').textContent = 'Working…';
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) { $('sumMsg').textContent = 'Open YouTube in this window first.'; return; }
    chrome.tabs.sendMessage(tab.id, { type: 'ht-summarize-visible', max: 10 }, (resp) => {
      if (chrome.runtime.lastError || !resp) { $('sumMsg').textContent = 'Open a YouTube page first (then reload it if you just updated).'; return; }
      $('sumMsg').textContent = resp.ok ? `Done: ${resp.count} summarized.` : resp.error;
    });
  });
});
