(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true, mode: 'frame', frame: 2, calmTitles: false,
    hoverDetails: true, aiProvider: 'off', // 'off' | 'chrome' | 'api'
    clickbaitFlag: true, watchPanel: true, hideShorts: false, hideMixes: false,
    sponsorChip: false, summaryLang: 'auto', exceptions: [],
    dimWatched: false, mutedWords: []
  };
  let settings = { ...DEFAULTS };

  // Matches YouTube thumbnail URLs, e.g. https://i.ytimg.com/vi/<id>/hqdefault.jpg?sqp=...
  const IMG_RE = /^https:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\/(\w+)\.(?:jpg|webp)/;
  // Frame names this extension requests: mq1..mq3 (preferred), hq1..hq3 (fallback).
  const OURS_RE = /^(mq|hq)([123])$/;
  const CHAPTER_SEL = 'ytd-expandable-metadata-renderer, ytd-macro-markers-list-renderer, ytd-macro-markers-list-item-renderer, ' +
    'ytd-horizontal-card-list-renderer, [class*="macro-markers"]';

  const CONTAINERS = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-grid-video-renderer', 'ytd-playlist-video-renderer',
    'ytd-playlist-panel-video-renderer', 'yt-lockup-view-model'
  ].join(',');
  const THUMB_SEL = 'ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail, .yt-lockup-view-model__content-image';

  const Titles = window.HonestTitles || { cleanTitle: (s) => s, clickbaitHint: () => '' };
  const Info = window.HonestInfo;
  const cleanTitle = Titles.cleanTitle;

  // ============================================================
  // Cache (in memory + chrome.storage.local, newest 400 videos)
  // ============================================================
  const mem = new Map(); // id -> { t, title?, author?, info?, summary?, sponsor? }
  let saveTimer = null;

  function entry(id) {
    let e = mem.get(id);
    if (!e) { e = { t: Date.now() }; mem.set(id, e); }
    return e;
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const newest = [...mem.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 400);
      const obj = {};
      for (const [id, e] of newest) {
        let info;
        if (e.info) { const { tracks, ...rest } = e.info; info = rest; }
        obj[id] = { t: e.t, title: e.title, author: e.author, summary: e.summary, sponsor: e.sponsor, info };
      }
      chrome.storage.local.set({ ht_cache: obj });
    }, 1500);
  }

  // ============================================================
  // Network helpers (same-origin requests to youtube.com, no keys)
  // ============================================================
  let active = 0;
  const waiting = [];
  function limited(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          const next = waiting.shift();
          if (next) next();
        });
      };
      if (active < 2) run(); else waiting.push(run);
    });
  }

  const inflight = new Map();
  const failedAt = new Map();

  // Description, likes, chapters, captions list. One page request per video, cached.
  function loadInfo(id, { needTracks = false } = {}) {
    const e = entry(id);
    if (e.info && (!needTracks || e.info.tracks)) return Promise.resolve(e.info);
    if (failedAt.has(id) && Date.now() - failedAt.get(id) < 10 * 60 * 1000) {
      return Promise.reject(new Error('Details unavailable for this video.'));
    }
    const key = id + (needTracks ? ':t' : '');
    if (inflight.has(key)) return inflight.get(key);
    const p = limited(async () => {
      const r = await fetch(`/watch?v=${id}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const info = Info.parseWatchHtml(await r.text());
      if (!info) throw new Error('Could not read video details.');
      e.info = info;
      e.t = Date.now();
      if (!e.title && info.title) e.title = info.title;
      persist();
      return info;
    }).catch((err) => { failedAt.set(id, Date.now()); throw err; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // Tiny, official, keyless endpoint: guarantees we can always show a title and channel.
  const oembedTried = new Set();
  function loadOembed(id) {
    if (oembedTried.has(id)) return;
    oembedTried.add(id);
    const url = 'https://www.youtube.com/watch?v=' + id;
    limited(() => fetch('/oembed?format=json&url=' + encodeURIComponent(url)).then((r) => (r.ok ? r.json() : null)))
      .then((j) => {
        if (!j) return;
        const e = entry(id);
        e.title = j.title || e.title;
        e.author = j.author_name || e.author;
        persist();
        scheduleScan();
      }).catch(() => {});
  }

  // Sponsor time from the SponsorBlock community database. Opt-in; the lookup happens in the background script.
  const sponsorTried = new Set();
  function loadSponsor(id) {
    if (!settings.sponsorChip || sponsorTried.has(id) || entry(id).sponsor) return;
    sponsorTried.add(id);
    try {
      chrome.runtime.sendMessage({ type: 'ht-sponsor', id }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) return;
        entry(id).sponsor = { secs: r.secs, count: r.count };
        persist();
        scheduleScan();
      });
    } catch (e) { /* extension reloaded */ }
  }

  // ============================================================
  // Summaries (optional: Chrome built-in model, or the user's own API)
  // ============================================================
  const sumState = new Map(); // id -> { status: 'busy'|'error', error? }

  function langCode() {
    const l = settings.summaryLang === 'auto' ? (navigator.language || 'en') : settings.summaryLang;
    return String(l).split('-')[0].toLowerCase() || 'en';
  }

  async function getTranscript(tracks, lang) {
    if (!tracks || !tracks.length) return '';
    const byLang = (l, asr) => tracks.find((t) => t.languageCode && t.languageCode.toLowerCase().startsWith(l) && (asr || t.kind !== 'asr'));
    const pick = byLang(lang, false) || byLang(lang, true) || byLang('en', false) || byLang('en', true) || tracks[0];
    const url = pick.baseUrl + (pick.baseUrl.includes('?') ? '&' : '?') + 'fmt=json3';
    try {
      const r = await fetch(url);
      if (!r.ok) return '';
      const raw = await r.text();
      if (!raw) return '';
      const j = JSON.parse(raw);
      return (j.events || []).flatMap((ev) => (ev.segs || []).map((s) => s.utf8 || ''))
        .join(' ').replace(/\s+/g, ' ').trim();
    } catch (e) { return ''; }
  }

  // Summaries are written to fit a thumbnail-sized card in full: a short gist and a few short lines.
  function systemPrompt(n, lang) {
    const common =
      'You summarize YouTube videos neutrally and specifically. Never copy hype, ALL CAPS or clickbait wording. ' +
      'Be brief: this appears on a small card. ' +
      (lang && lang !== 'en' ? `Write the summary in ${Info.langName(lang)}. ` : '');
    if (n) {
      return common +
        `The title promises ${n} items. Reply in this exact format: first line = a gist of at most 10 words. ` +
        `Then exactly ${n} lines, each starting with "- ", naming the ${n} items in the order the video presents them. ` +
        'Each line is only the item\u2019s name, 2 to 5 words, no explanation. ' +
        'If the video clearly gives a different number, list what it actually gives. No other text.';
    }
    return common +
      'Reply in this exact format: first line = one sentence of at most 12 words saying what the video is about. ' +
      'Then exactly 3 lines, each starting with "- ", each a key point of at most 8 words. No other text.';
  }


  const ONDEVICE_LANGS = ['en', 'es', 'ja'];
  const PROMPT_LANGS = ['en', 'es', 'ja', 'de', 'fr']; // Chrome's Prompt API; the older Summarizer API keeps ONDEVICE_LANGS

  // Preferred on-device path: the Prompt API (follows our format). Falls back to the Summarizer API.
  // Ask for an exact shape (gist + bullets) so the model can't pad or wander; falls back to plain text.
  function summarySchema(n) {
    return {
      type: 'object',
      properties: {
        gist: { type: 'string' },
        bullets: { type: 'array', items: { type: 'string' }, minItems: n || 3, maxItems: n || 3 }
      },
      required: ['gist', 'bullets']
    };
  }

  function downloadMonitor(onProgress) {
    return (m) => m.addEventListener('downloadprogress', (e) => onProgress && onProgress(e.loaded));
  }

  async function chromePrompt(system, userText, lang, n, onProgress) {
    if (!('LanguageModel' in self)) return null;
    const out = PROMPT_LANGS.includes(lang) ? lang : 'en';
    const io = {
      expectedInputs: [{ type: 'text', languages: [...new Set(['en', out])] }],
      expectedOutputs: [{ type: 'text', languages: [out] }]
    };
    const avail = await LanguageModel.availability(io).catch(() => 'unavailable');
    if (avail === 'unavailable') return null;
    let session;
    try {
      session = await LanguageModel.create({ ...io, initialPrompts: [{ role: 'system', content: system }], monitor: downloadMonitor(onProgress) });
    } catch (e) {
      try { session = await LanguageModel.create({ initialPrompts: [{ role: 'system', content: system }], monitor: downloadMonitor(onProgress) }); }
      catch (e2) { return null; }
    }
    try {
      try {
        const j = JSON.parse(await session.prompt(userText, { responseConstraint: summarySchema(n) }));
        if (j && (j.gist || (j.bullets && j.bullets.length))) {
          const clean = (b) => String(b).replace(/^(?:(?:[-*•–]|\d{1,2}[.)])\s*)+/, '').trim();
          return [String(j.gist || '').trim(), ...(j.bullets || []).map(clean).filter(Boolean).map((b) => '- ' + b)].join('\n');
        }
      } catch (e) { /* older Chrome or invalid JSON: ask again in plain text */ }
      return (await session.prompt(userText)).trim();
    } finally { try { session.destroy(); } catch (e) { /* ignore */ } }
  }

  async function chromeSummarize(system, userText, n, lang, onProgress) {
    const viaPrompt = await chromePrompt(system, userText, lang, n, onProgress).catch(() => null);
    if (viaPrompt) return viaPrompt;
    if (!('Summarizer' in self)) throw new Error("Chrome's built-in AI isn't available here. Try 'Your own API'.");
    const avail = await Summarizer.availability();
    if (avail === 'unavailable') throw new Error("This device can't run Chrome's built-in model.");
    const s = await Summarizer.create({
      type: 'key-points', format: 'markdown', length: n > 5 ? 'long' : 'medium',
      outputLanguage: ONDEVICE_LANGS.includes(lang) ? lang : 'en',
      monitor: downloadMonitor(onProgress),
      sharedContext: n
        ? `A YouTube video whose title promises ${n} items. The key points should be those ${n} items.`
        : 'A YouTube video. Key points should be neutral and specific.'
    });
    return (await s.summarize(userText)).trim();
  }

  function apiSummarize(system, userText) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ht-llm', system, user: userText }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (resp && resp.ok) resolve(resp.text); else reject(new Error((resp && resp.error) || 'Summary failed.'));
      });
    });
  }

  function setChapterSummary(e, bullets, n) {
    e.summary = { gist: '', bullets: bullets.slice(0, 12), n: n || 0, kind: 'chapters', source: 'chapters', v: 4 };
    e.t = Date.now();
    persist();
  }

  async function summarize(id) {
    sumState.set(id, { status: 'busy' });
    scheduleScan();
    try {
      const e = entry(id);
      let info = null;
      try { info = await loadInfo(id, { needTracks: true }); } catch (err) { info = e.info || null; }
      const title = e.title || (info && info.title) || '';
      const n = Info.listicleCount(title);

      // Free and exact: when the video's chapters are the N promised items, use them.
      const items = n && info ? Info.chapterItems(info.chapterTitles, n) : null;
      if (items) {
        setChapterSummary(e, items, n);
        sumState.delete(id);
        scheduleScan();
        return;
      }

      const lang = langCode();
      const transcript = info ? await getTranscript(info.tracks, lang) : '';
      const body = transcript || (info && info.description) || '';
      if (!body) throw new Error('No captions or description to summarize.');
      const source = transcript ? 'transcript' : 'description';
      const system = systemPrompt(n, lang);
      const onDevice = settings.aiProvider === 'chrome';
      // Items in a list are spread across the video, so give the model more of it (cloud models can take lots).
      const limit = onDevice ? (n ? 14000 : 12000) : (n ? 48000 : 24000);
      const userText =
        `Title: ${title}\nChannel: ${(info && info.author) || e.author || ''}\n` +
        `${transcript ? 'Transcript' : 'Description'}:\n${Info.clip(body, limit)}`;
      let text;
      try {
        const onProgress = (f) => {
          const pct = Math.round((Number(f) || 0) * 100);
          sumState.set(id, { status: 'busy', label: pct < 100 ? `Downloading the on-device model\u2026 ${pct}%` : 'Summarizing\u2026' });
          scheduleScan();
        };
        text = onDevice ? await chromeSummarize(system, userText, n, lang, onProgress) : await apiSummarize(system, userText);
      } catch (err) {
        if (onDevice && err && (err.name === 'NotSupportedError' || /language/i.test(String(err.message)))) {
          throw new Error("Chrome's built-in model can't read this video's language. Try 'Your own API'.");
        }
        throw err;
      }
      const parsed = Info.parseSummary(text, 12);
      if (!parsed.gist && !parsed.bullets.length) throw new Error('The model returned an empty answer.');
      e.summary = { gist: parsed.gist, bullets: parsed.bullets.slice(0, n || 4), n, source, v: 4 };
      e.t = Date.now();
      persist();
      sumState.delete(id);
    } catch (err) {
      sumState.set(id, { status: 'error', error: String((err && err.message) || err) });
    }
    scheduleScan();
  }

  async function showChapters(id) {
    const e = entry(id);
    try {
      const info = await loadInfo(id);
      const list = Info.cleanChapters(info.chapterTitles);
      if (list.length < 3) throw new Error('This video has no chapters.');
      setChapterSummary(e, list, 0);
      sumState.delete(id);
    } catch (err) {
      sumState.set(id, { status: 'error', error: String((err && err.message) || err) });
    }
    scheduleScan();
  }

  // "Summarize all visible": sequential, capped, uses the same daily limit.
  async function summarizeVisible(max) {
    if (settings.aiProvider === 'off') return { ok: false, error: 'Turn on AI summaries in the settings first.' };
    if (!settings.enabled || settings.mode !== 'text') return { ok: false, error: 'Switch to the title card to see summaries.' };
    const ids = [];
    for (const c of document.querySelectorAll(CONTAINERS)) {
      if (ids.length >= max) break;
      if (c.parentElement && c.parentElement.closest(CONTAINERS)) continue;
      const img = c.querySelector('img[data-ht-id]');
      if (!img || isShort(c) || isExcepted(channelKey(c))) continue;
      const r = c.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.height < 60) continue;
      const id = img.dataset.htId;
      const st = sumState.get(id);
      if ((mem.get(id) || {}).summary || (st && st.status === 'busy') || ids.includes(id)) continue;
      ids.push(id);
    }
    for (const id of ids) await summarize(id);
    return { ok: true, count: ids.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg && msg.type === 'ht-summarize-visible') {
      summarizeVisible(Math.min(Number(msg.max) || 10, 10)).then(send, (e) => send({ ok: false, error: String(e) }));
      return true;
    }
  });

  // ============================================================
  // Reading what is already on the page (instant, free)
  // ============================================================
  function isShort(container) {
    return !!container.querySelector('a[href*="/shorts/"], ytm-shorts-lockup-view-model');
  }

  function isMix(container) {
    return !!container.querySelector('a[href*="list=RD"]');
  }

  function findTitleEl(container) {
    return (
      container.querySelector('.yt-lockup-metadata-view-model__title .yt-core-attributed-string') ||
      container.querySelector('#video-title') ||
      container.querySelector('.yt-lockup-metadata-view-model__title')
    );
  }

  function readTitle(container, img) {
    const node = findTitleEl(container);
    let t = node ? node.textContent.trim() : '';
    if (t) return t;
    const withTitle = container.querySelector('h3[title], a[title], yt-formatted-string[title]');
    if (withTitle && withTitle.getAttribute('title')) return withTitle.getAttribute('title').trim();
    const aria = container.querySelector('a[aria-label]');
    if (aria) t = Info.titleFromAria(aria.getAttribute('aria-label'));
    if (t) return t;
    return (img && img.alt) || '';
  }

  const META_SEL = [
    '.yt-content-metadata-view-model__metadata-text', '#metadata-line .inline-metadata-item',
    'ytd-channel-name #text', 'ytd-channel-name a', '#channel-name a'
  ].join(',');

  function readMeta(container) {
    const out = [];
    container.querySelectorAll(META_SEL).forEach((n) => {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (t && !out.includes(t)) out.push(t);
    });
    return out.slice(0, 3).join(' · ');
  }

  // ---- Channel exceptions ----
  function channelKey(container) {
    const a = container.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]');
    if (!a) return '';
    const m = /^\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/.exec(a.getAttribute('href') || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  function channelName(container, key) {
    const n = container.querySelector('ytd-channel-name #text, ytd-channel-name a, #channel-name a, .yt-content-metadata-view-model__metadata-text');
    const t = n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
    return t || key;
  }

  function isExcepted(key) {
    return !!key && (settings.exceptions || []).some((x) => x.k === key);
  }

  function toggleException(key, name) {
    if (!key) return;
    const list = (settings.exceptions || []).slice();
    const i = list.findIndex((x) => x.k === key);
    if (i >= 0) list.splice(i, 1); else if (list.length < 80) list.push({ k: key, n: String(name || key).slice(0, 60) });
    settings.exceptions = list;
    chrome.storage.sync.set({ exceptions: list });
    scheduleScan();
  }

  // What should this thumbnail show right now? 'frame' | 'text' | 'original'
  let peekContainer = null; // container whose original thumbnail is being peeked at (hold Alt or the 👁 button)

  function modeFor(container, img, ignorePeek) {
    if (!settings.enabled) return 'original';
    if (!ignorePeek && peekContainer && container === peekContainer) return 'original';
    if (isExcepted(channelKey(container))) return 'original';
    let mode = settings.mode;
    if (mode === 'frame' && img && img.dataset.htFailed && img.dataset.htFailed === img.dataset.htId) mode = 'text';
    return mode;
  }

  // ============================================================
  // Title card
  // ============================================================
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // The card goes inside the visible thumbnail box (the rounded frame), right after the branch that holds
  // the image, so it covers the whole thumbnail on every page layout while YouTube's own overlays
  // (duration, progress bar) stay on top of it.
  const THUMB_BOX = 'a#thumbnail, yt-thumbnail-view-model, .yt-lockup-view-model__content-image, ytd-thumbnail';
  function cardSlot(img) {
    const box = img.closest(THUMB_BOX);
    if (!box) return { parent: img.parentElement, after: img };
    let branch = img;
    while (branch.parentElement && branch.parentElement !== box) branch = branch.parentElement;
    return { parent: box, after: branch };
  }
  function findCard(img) {
    const next = cardSlot(img).after.nextElementSibling;
    return next && next.classList.contains('ht-card') ? next : null;
  }

  function removeCard(img) {
    const card = findCard(img);
    if (card) card.remove();
  }

  function getCard(img) {
    let card = findCard(img);
    if (!card) {
      card = el('div', 'ht-card');
      const slot = cardSlot(img);
      slot.after.insertAdjacentElement('afterend', card);
      // The card is absolutely positioned, so its parent must be positioned too. Checked later in one
      // batched read so we never force a layout per card.
      const p = slot.parent;
      if (p && !p.dataset.htPos) needsPosCheck.push(p);
    }
    return card;
  }

  const needsPosCheck = [];
  function fixPositions() {
    if (!needsPosCheck.length) return;
    const list = needsPosCheck.splice(0);
    const statics = list.filter((p) => p.isConnected && getComputedStyle(p).position === 'static'); // reads first
    list.forEach((p) => { p.dataset.htPos = '1'; });
    statics.forEach((p) => { p.style.position = 'relative'; }); // then writes
  }

  function summaryLabel(sm) {
    const c = sm.bullets.length;
    if (sm.n && c) return `✨ The ${c} ${c === 1 ? 'item' : 'items'}`;
    if (sm.kind === 'chapters') return '📑 Chapters';
    return '✨ What it\u2019s about';
  }

  // Shared by the title card and the watch-page panel.
  function appendSummary(parent, sm) {
    parent.appendChild(el('div', 'ht-sumlabel', summaryLabel(sm)));
    if (sm.gist) parent.appendChild(el('div', 'ht-gist', sm.gist));
    if (sm.bullets.length) {
      const ul = el('ul', 'ht-bul' + (sm.bullets.length > 5 ? ' many' : ''));
      sm.bullets.forEach((b) => ul.appendChild(el('li', null, b)));
      parent.appendChild(ul);
    }
    if (sm.source) parent.appendChild(el('div', 'ht-sumsrc', 'From the ' + sm.source));
  }

  // Fit the whole summary on the card: try two columns for short items, then step the text size down,
  // then drop the small extras (source line, gist of a list). Nothing is hidden behind a "more" note.
  const FIT_SIZES = [15, 14, 13, 12, 11, 10];
  function fitSummary(card) {
    const sm = card._htSum;
    const ul = card.querySelector('.ht-bul');
    if (!sm || card.clientHeight < 60) return;
    const bullets = sm.bullets || [];
    const avg = bullets.reduce((a, b) => a + b.length, 0) / (bullets.length || 1);
    const src = card.querySelector('.ht-sumsrc');
    const gist = card.querySelector('.ht-gist');
    if (ul) {
      ul.classList.remove('many', 'tight');
      ul.classList.toggle('cols', bullets.length >= 4 && card.clientWidth >= 280 && avg <= 32);
    }
    if (src) src.style.display = '';
    if (gist) gist.style.display = '';
    const over = () => card.scrollHeight > card.clientHeight + 1;
    for (const px of FIT_SIZES) {
      card.style.setProperty('--ht-fs', px + 'px');
      if (!over()) return;
    }
    if (src) { src.style.display = 'none'; if (!over()) return; }
    if (gist && sm.n && bullets.length) { gist.style.display = 'none'; if (!over()) return; } // a list speaks for itself
    if (ul) ul.classList.add('tight'); // last resort: one line per point
  }

  const fitObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver((entries) => entries.forEach((en) => fitSummary(en.target)))
    : { observe() {} };

  function fmtSecs(s) {
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  // Small facts about a video, from the data we already have. Used by the card and the watch panel.
  function chipsFor(e, rawTitle) {
    const chips = [];
    if (settings.clickbaitFlag) {
      const hint = Titles.clickbaitHint(rawTitle);
      if (hint) chips.push({ text: '⚠ ' + hint, cls: 'warn' });
    }
    const i = e.info;
    if (i) {
      if (i.isLive) chips.push({ text: '🔴 Live' });
      if (i.likes != null) chips.push({ text: '👍 ' + Info.formatCount(i.likes) });
      if (i.chapters) chips.push({ text: '📑 ' + i.chapters + ' chapters' });
    }
    if (e.sponsor && e.sponsor.count > 0 && e.sponsor.secs > 0) chips.push({ text: '💰 Sponsor ~' + fmtSecs(e.sponsor.secs) });
    if (i && i.hasCaptions) chips.push({ text: '💬 Captions' });
    return chips;
  }

  function renderCard(card, container, img, id) {
    const e = mem.get(id) || {};
    const rawTitle = readTitle(container, img) || e.title || '';
    let title = rawTitle;
    if (!title) loadOembed(id);
    if (settings.calmTitles && title) title = cleanTitle(title);

    let meta = readMeta(container);
    if (!meta && e.author) meta = e.author;
    if (!meta && e.info) meta = [e.info.author, Info.formatCount(e.info.views) && Info.formatCount(e.info.views) + ' views'].filter(Boolean).join(' · ');

    const chips = chipsFor(e, rawTitle);
    const st = sumState.get(id);
    const hue = String(Titles.channelHue(channelKey(container) || e.author || meta.split(' · ')[0] || id));
    if (card.style.getPropertyValue('--ht-h') !== hue) card.style.setProperty('--ht-h', hue);

    // After summarizing, the summary takes over the whole card.
    if (e.summary) {
      const sm = e.summary;
      const sig = JSON.stringify(['sum', sm.gist, sm.bullets, sm.kind]);
      if (card.dataset.htSig === sig) return;
      card.dataset.htSig = sig;
      card.className = 'ht-card ht-card-sum';
      card.replaceChildren();
      appendSummary(card, sm);
      card._htSum = sm;
      fitObserver.observe(card); // fits on the next frame, batched with other cards
      return;
    }

    let desc = '', status = '';
    if (st && st.status === 'busy') status = st.label || 'Summarizing\u2026';
    else if (st && st.status === 'error') desc = '⚠ ' + st.error;
    else if (e.info && e.info.snippet) desc = e.info.snippet;

    const sig = JSON.stringify([title, meta, chips, desc, status]);
    if (card.dataset.htSig === sig) return;
    card.dataset.htSig = sig;
    card.className = 'ht-card';
    card.style.removeProperty('--ht-fs');

    card.replaceChildren();
    if (meta) card.appendChild(el('div', 'ht-meta', meta));
    card.appendChild(el('div', 'ht-title', title));
    if (chips.length) {
      const row = el('div', 'ht-chips');
      chips.forEach((c) => row.appendChild(el('span', 'ht-chip' + (c.cls ? ' ' + c.cls : ''), c.text)));
      card.appendChild(row);
    }
    if (status) {
      const d = el('div', 'ht-busy');
      d.appendChild(el('span', 'ht-spin'));
      d.appendChild(el('span', null, status));
      card.appendChild(d);
    } else if (desc) {
      card.appendChild(el('div', 'ht-desc', desc));
    }
  }

  // ============================================================
  // Hover toolbar: Summarize / Chapters / Copy / Skip channel
  // One shared toolbar attached to <html> (outside YouTube's link, so a click can't open the video).
  // ============================================================
  let bar = null, barSig = '', barCtx = null, copiedId = '', hoverContainer = null;

  function barButtons(container, id) {
    const e = mem.get(id) || {};
    const img = container.querySelector('img[data-ht-id]');
    const btns = [];
    const mode = modeFor(container, img, true);
    if (mode === 'text') {
      const st = sumState.get(id);
      const chapters = e.info && e.info.chapterTitles && e.info.chapterTitles.length >= 3;
      if (e.summary) {
        btns.push({ act: 'copy', label: copiedId === id ? '✓ Copied' : '📋 Copy' });
      } else if (!(st && st.status === 'busy')) {
        if (settings.aiProvider !== 'off') btns.push({ act: 'sum', label: st && st.status === 'error' ? '↻ Retry summary' : '✨ Summarize' });
        if (chapters) btns.push({ act: 'chap', label: '📑 Chapters' });
      }
    }
    if (mode !== 'original') {
      btns.push({ act: 'peek', label: '👁 Peek', title: 'Hold to see the original thumbnail (or hold Alt while hovering)' });
    }
    const key = channelKey(container);
    if (key) {
      const ex = isExcepted(key);
      btns.push({
        act: 'chan', label: ex ? '↺ Use here' : '⊘ Skip channel', key, name: channelName(container, key),
        title: ex ? 'Apply Honest Thumbnails to this channel again' : 'Leave this channel\u2019s thumbnails and titles alone'
      });
    }
    return btns;
  }

  function hideBar() { if (bar) bar.style.display = 'none'; barCtx = null; }

  function placeBar(thumb, container, id) {
    const r = thumb.getBoundingClientRect();
    const btns = barButtons(container, id);
    if (!btns.length || r.height < 110) return hideBar();
    if (!bar) {
      bar = el('div', 'ht-bar');
      document.documentElement.appendChild(bar);
    }
    const sig = id + JSON.stringify(btns);
    if (sig !== barSig) {
      barSig = sig;
      bar.replaceChildren();
      btns.forEach((b) => {
        const n = el('button', 'ht-btn', b.label);
        n.type = 'button';
        n.dataset.act = b.act;
        n.dataset.htId = id;
        if (b.key) { n.dataset.key = b.key; n.dataset.name = b.name; }
        if (b.title) n.title = b.title;
        bar.appendChild(n);
      });
    }
    barCtx = { thumb, container, id };
    bar.style.display = 'flex';
    bar.style.maxWidth = Math.max(120, Math.round(r.width - 16)) + 'px';
    bar.style.left = Math.round(r.left + 8) + 'px';
    bar.style.top = Math.round(r.bottom - 8 - bar.offsetHeight) + 'px';
  }

  function updateBar() {
    if (!bar || bar.style.display === 'none' || !barCtx) return;
    if (!barCtx.container.isConnected || !settings.enabled || settings.mode === 'original') return hideBar();
    placeBar(barCtx.thumb, barCtx.container, barCtx.id);
  }

  window.addEventListener('mousemove', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('.ht-bar')) return;
    if (!settings.enabled || settings.mode === 'original') return hideBar();
    const thumb = t.closest(THUMB_SEL);
    const container = thumb && thumb.closest(CONTAINERS);
    const img = container && container.querySelector('img[data-ht-id]');
    hoverContainer = img && !isShort(container) ? container : null;
    if (!img || isShort(container)) return hideBar();
    if (barCtx && barCtx.container === container && bar && bar.style.display !== 'none') return;
    placeBar(thumb, container, img.dataset.htId);
  }, { capture: true, passive: true });
  window.addEventListener('scroll', hideBar, { capture: true, passive: true });

  async function copySummary(id, title) {
    const sm = (mem.get(id) || {}).summary;
    if (!sm) return;
    const text = Info.summaryText(title || (mem.get(id) || {}).title || '', sm, id);
    try { await navigator.clipboard.writeText(text); }
    catch (err) {
      const ta = el('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      ta.remove();
    }
    copiedId = id;
    setTimeout(() => { if (copiedId === id) { copiedId = ''; scheduleScan(); } }, 1500);
    scheduleScan();
  }

  // ---- Peek at the original thumbnail -----------------------------------------
  function startPeek(container) {
    if (!container || peekContainer === container) return;
    peekContainer = container;
    container.setAttribute('data-ht-peek', '');
    scan();
  }
  function endPeek() {
    if (!peekContainer) return;
    peekContainer.removeAttribute('data-ht-peek');
    peekContainer = null;
    scan();
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !e.repeat && hoverContainer && settings.enabled && settings.mode !== 'original') startPeek(hoverContainer);
  }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') endPeek(); }, true);
  window.addEventListener('pointerup', endPeek, true);
  window.addEventListener('blur', endPeek);

  // ---- Interaction shielding -------------------------------------------------
  // While the title card is showing, YouTube must not start its inline video preview over the card.
  ['mouseover', 'mouseenter', 'mousemove', 'pointerover', 'pointerenter', 'pointermove'].forEach((type) => {
    window.addEventListener(type, (e) => {
      if (!(e.target instanceof Element)) return;
      const container = e.target.closest(CONTAINERS);
      if (!container || !e.target.closest(THUMB_SEL)) return;
      const img = container.querySelector('img[data-ht-id]');
      if (!img || modeFor(container, img) !== 'text') return;
      if (type === 'mouseover' && settings.hoverDetails) {
        loadInfo(img.dataset.htId).then(scheduleScan, () => {});
        loadSponsor(img.dataset.htId);
      }
      e.stopImmediatePropagation();
    }, true);
  });

  // Clicks on our toolbar must never reach YouTube's handlers.
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'auxclick', 'click'].forEach((type) => {
    window.addEventListener(type, (e) => {
      const btn = e.target instanceof Element && e.target.closest('.ht-bar .ht-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (btn.dataset.act === 'peek') {
        if (type === 'pointerdown' && barCtx) startPeek(barCtx.container);
        return;
      }
      if (type !== 'click') return;
      const id = btn.dataset.htId;
      switch (btn.dataset.act) {
        case 'sum': summarize(id); break;
        case 'chap': showChapters(id); break;
        case 'copy': copySummary(id, barCtx && readTitle(barCtx.container, null)); break;
        case 'chan': toggleException(btn.dataset.key, btn.dataset.name); break;
        default: break;
      }
    }, { capture: true, passive: false });
  });

  // ============================================================
  // Thumbnail image handling
  // ============================================================
  function onImgError(e) {
    const img = e.target;
    const m = IMG_RE.exec(img.getAttribute('src') || '');
    if (!m) return;
    const [, id, name] = m;
    const o = OURS_RE.exec(name);
    if (o && o[1] === 'mq') {
      img.src = `https://i.ytimg.com/vi/${id}/hq${o[2]}.jpg`;
    } else if (o) {
      img.dataset.htFailed = id;
      scheduleScan();
    }
  }

  function onImgLoad(e) {
    const img = e.target;
    const m = IMG_RE.exec(img.getAttribute('src') || '');
    if (m && OURS_RE.test(m[2]) && img.naturalWidth <= 120) {
      img.dataset.htFailed = m[1];
      scheduleScan();
    }
  }

  function bind(img) {
    if (img.dataset.htBound) return;
    img.dataset.htBound = '1';
    img.addEventListener('error', onImgError);
    img.addEventListener('load', onImgLoad);
  }

  function processImage(img) {
    const src = img.getAttribute('src') || '';
    const m = IMG_RE.exec(src);
    if (!m) return;
    const container = img.closest(CONTAINERS);
    if (!container || isShort(container)) return;

    const [, id, name] = m;
    // Chapter previews ("hqdefault_4866.jpg") and the chapters row are not the video's thumbnail.
    if (/_\d+$/.test(name) || img.closest(CHAPTER_SEL)) return;
    const o = OURS_RE.exec(name);

    if (!o) {
      img.dataset.htOrig = src;
      img.dataset.htId = id;
      delete img.dataset.htFailed;
    }
    if (!img.dataset.htId) img.dataset.htId = id;

    const mode = modeFor(container, img);
    if (mode !== 'original') countOnce('swapped', id);

    if (mode === 'frame') {
      removeCard(img);
      bind(img);
      const n = String(settings.frame);
      if (!(o && o[2] === n)) img.src = `https://i.ytimg.com/vi/${id}/mq${n}.jpg`;
      img.style.objectFit = 'cover';
    } else if (mode === 'text') {
      renderCard(getCard(img), container, img, id);
    } else {
      removeCard(img);
      if (o && img.dataset.htOrig) img.src = img.dataset.htOrig;
      img.style.objectFit = '';
    }
  }

  // ============================================================
  // Calm titles
  // ============================================================
  function processTitle(container) {
    if (isShort(container)) return;
    const node = findTitleEl(container);
    if (!node) return;
    const cur = node.textContent.trim();
    if (settings.enabled && settings.clickbaitFlag && Titles.clickbaitHint(node.dataset.htOrigTitle || cur)) {
      countOnce('flagged', videoKey(container));
    }
    const applied = node.dataset.htApplied;
    const calmOn = settings.enabled && settings.calmTitles && !isExcepted(channelKey(container));

    if (applied !== undefined && cur === applied) {
      if (!calmOn) {
        node.textContent = node.dataset.htOrigTitle;
        delete node.dataset.htApplied;
        delete node.dataset.htOrigTitle;
      }
      return;
    }
    delete node.dataset.htApplied;
    delete node.dataset.htOrigTitle;
    if (calmOn) {
      const cleaned = cleanTitle(cur);
      if (cleaned && cleaned !== cur) {
        node.dataset.htOrigTitle = cur;
        node.dataset.htApplied = cleaned;
        node.textContent = cleaned;
      }
    }
  }

  // ============================================================
  // Hide Shorts and Mixes
  // ============================================================
  const WATCHED_SEL = 'ytd-thumbnail-overlay-resume-playback-renderer, yt-thumbnail-overlay-progress-bar-view-model, ' +
    '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment';

  function mutedFor(container) {
    const words = settings.mutedWords;
    if (!words || !words.length) return '';
    const node = findTitleEl(container);
    const title = (node && (node.dataset.htOrigTitle || node.textContent)) || readTitle(container, null);
    return Titles.mutedMatch(title, words) || Titles.mutedMatch(channelName(container, ''), words);
  }

  function applyHiding(container) {
    if (container.parentElement && container.parentElement.closest(CONTAINERS)) return; // outermost only
    const target = container.closest('ytd-rich-item-renderer') || container;
    const why = !settings.enabled ? '' :
      (settings.hideShorts && isShort(container)) ? 'shorts' :
      (settings.hideMixes && isMix(container)) ? 'mix' :
      mutedFor(container) ? 'muted' : '';
    if (why) {
      if (target.getAttribute('data-ht-hidden') !== why) target.setAttribute('data-ht-hidden', why);
      countOnce('hidden', videoKey(container));
    } else if (target.hasAttribute('data-ht-hidden')) target.removeAttribute('data-ht-hidden');

    const watched = settings.enabled && settings.dimWatched && !!container.querySelector(WATCHED_SEL);
    if (watched) { if (!target.hasAttribute('data-ht-watched')) target.setAttribute('data-ht-watched', ''); }
    else if (target.hasAttribute('data-ht-watched')) target.removeAttribute('data-ht-watched');
  }

  // ============================================================
  // Today's numbers for the popup (counts only, stored on this device)
  // ============================================================
  const counted = { swapped: new Set(), flagged: new Set(), hidden: new Set() };
  const pending = { swapped: 0, flagged: 0, hidden: 0 };
  let statsTimer = null;

  function videoKey(container) {
    const img = container.querySelector('img[data-ht-id]');
    if (img) return img.dataset.htId;
    const a = container.querySelector('a[href*="v="], a[href*="/shorts/"], a[href*="list="]');
    return a ? a.getAttribute('href') : '';
  }

  function countOnce(kind, key) {
    if (!key || counted[kind].has(key)) return;
    counted[kind].add(key);
    pending[kind]++;
    clearTimeout(statsTimer);
    statsTimer = setTimeout(flushStats, 2000);
  }

  function flushStats() {
    const today = new Date().toISOString().slice(0, 10);
    const delta = { ...pending };
    pending.swapped = pending.flagged = pending.hidden = 0;
    chrome.storage.local.get('htStats', (r) => {
      const old = r && r.htStats && r.htStats.day === today ? r.htStats : { day: today, swapped: 0, flagged: 0, hidden: 0 };
      chrome.storage.local.set({ htStats: {
        day: today, swapped: old.swapped + delta.swapped, flagged: old.flagged + delta.flagged, hidden: old.hidden + delta.hidden
      } });
    });
  }

  // ============================================================
  // Watch-page panel: summary, chapters, copy (under the player)
  // ============================================================
  let panel = null, panelSig = '';

  function currentVideoId() {
    if (location.pathname !== '/watch') return '';
    const v = new URLSearchParams(location.search).get('v') || '';
    return /^[\w-]{11}$/.test(v) ? v : '';
  }

  function removePanel() {
    if (panel) { panel.remove(); panel = null; panelSig = ''; }
  }

  function syncWatchPanel() {
    const id = currentVideoId();
    const below = id && document.querySelector('ytd-watch-flexy #below');
    if (!settings.enabled || !settings.watchPanel || !below) return removePanel();
    const e = entry(id);
    if (!e.info) loadInfo(id).then(scheduleScan, () => {});
    loadSponsor(id);

    const st = sumState.get(id);
    const chapterN = e.info && e.info.chapterTitles ? e.info.chapterTitles.length : 0;
    const canAI = settings.aiProvider !== 'off';
    const rawTitle = e.title || (e.info && e.info.title) || document.title.replace(/ - YouTube$/, '');
    const chips = chipsFor(e, rawTitle).filter((c) => c.cls === 'warn' || /Sponsor|chapters/.test(c.text));
    if (!e.summary && !canAI && chapterN < 3 && !chips.length) return removePanel();

    const sig = JSON.stringify([id, e.summary, chips, st, canAI, chapterN, copiedId === id]);
    if (panel && panel.isConnected && panel.parentElement === below && sig === panelSig) return;
    if (!panel || !panel.isConnected || panel.parentElement !== below) {
      removePanel();
      panel = el('div', 'ht-watch');
      below.insertBefore(panel, below.firstChild);
    }
    panelSig = sig;
    panel.replaceChildren();

    const head = el('div', 'ht-whead');
    head.appendChild(el('span', 'ht-mark'));
    head.appendChild(el('span', null, 'Honest Thumbnails'));
    panel.appendChild(head);
    if (chips.length) {
      const row = el('div', 'ht-chips ht-wchips');
      chips.forEach((c) => row.appendChild(el('span', 'ht-chip' + (c.cls ? ' ' + c.cls : ''), c.text)));
      panel.appendChild(row);
    }
    const button = (label, fn, disabled) => {
      const b = el('button', 'ht-wbtn', label);
      b.type = 'button';
      if (disabled) b.disabled = true;
      b.addEventListener('click', fn);
      return b;
    };
    const actions = el('div', 'ht-wactions');
    if (e.summary) {
      appendSummary(panel, e.summary);
      actions.appendChild(button(copiedId === id ? '✓ Copied' : '📋 Copy', () => copySummary(id, rawTitle)));
    } else if (st && st.status === 'busy') {
      const d = el('div', 'ht-busy');
      d.appendChild(el('span', 'ht-spin'));
      d.appendChild(el('span', null, st.label || 'Summarizing\u2026'));
      panel.appendChild(d);
    } else {
      if (canAI) actions.appendChild(button(st && st.status === 'error' ? '↻ Retry summary' : '✨ Summarize this video', () => summarize(id)));
      if (chapterN >= 3) actions.appendChild(button('📑 Show chapters', () => showChapters(id)));
      if (st && st.status === 'error') panel.appendChild(el('div', 'ht-werr', '⚠ ' + st.error));
    }
    if (actions.childNodes.length) panel.appendChild(actions);
  }

  // ============================================================
  // Scan loop and settings
  // ============================================================
  let timer = null;
  function scheduleScan() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; scan(); }, 120);
  }

  // Give the page a chance to respond between batches so long feeds never freeze.
  const yieldToMain = () => (globalThis.scheduler && scheduler.yield)
    ? scheduler.yield() : new Promise((r) => setTimeout(r, 0));
  const BATCH = 60;
  let scanning = false, scanAgain = false;

  async function scan() {
    if (scanning) { scanAgain = true; return; }
    scanning = true;
    try {
      do {
        scanAgain = false;
        const root = document.documentElement;
        root.dataset.htMode = settings.enabled ? settings.mode : 'original';
        if (settings.enabled && settings.hideShorts) root.dataset.htNoShorts = '1'; else delete root.dataset.htNoShorts;
        if (settings.enabled && settings.hideMixes) root.dataset.htNoMixes = '1'; else delete root.dataset.htNoMixes;
        const containers = [...document.querySelectorAll(CONTAINERS)];
        for (let i = 0; i < containers.length; i += BATCH) {
          containers.slice(i, i + BATCH).forEach((c) => { applyHiding(c); processTitle(c); });
          if (i + BATCH < containers.length) await yieldToMain();
        }
        const imgs = [...document.querySelectorAll('img')].filter((im) => IMG_RE.test(im.getAttribute('src') || ''));
        for (let i = 0; i < imgs.length; i += BATCH) {
          imgs.slice(i, i + BATCH).forEach(processImage);
          fixPositions();
          if (i + BATCH < imgs.length) await yieldToMain();
        }
        updateBar();
        syncWatchPanel();
      } while (scanAgain);
    } catch (err) {
      console.warn('[Honest Thumbnails]', err);
    } finally {
      scanning = false;
    }
  }

  // "Pause for 1 hour" lives in local storage (this computer only) and simply reads as "off" until it ends.
  let resumeTimer = null;
  function loadSettings() {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      chrome.storage.local.get({ pausedUntil: 0 }, (l) => {
        const left = (Number(l && l.pausedUntil) || 0) - Date.now();
        settings = { ...DEFAULTS, ...s };
        if (left > 0) settings.enabled = false;
        clearTimeout(resumeTimer);
        if (left > 0) resumeTimer = setTimeout(loadSettings, left + 500);
        scan();
      });
    });
  }

  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' || (area === 'local' && c.pausedUntil)) loadSettings();
  });

  chrome.storage.local.get('ht_cache', (r) => {
    const saved = r && r.ht_cache;
    if (saved) for (const id of Object.keys(saved)) {
      const v = saved[id];
      if (v && v.summary && v.summary.v !== 4) delete v.summary; // older summaries were longer than a card can show
      if (v && v.summary && Array.isArray(v.summary.bullets)) { // tidy points saved with a doubled "- " marker
        v.summary.bullets = v.summary.bullets.map((b) => String(b).replace(/^(?:(?:[-*•–]|\d{1,2}[.)])\s+)+/, '').trim()).filter(Boolean);
      }
      // Drop list summaries whose item count came from an older, looser "Top N" check.
      if (v && v.summary && v.summary.n && v.title && Info.listicleCount(v.title) !== v.summary.n) delete v.summary;
      mem.set(id, v);
    }
    loadSettings();
  });

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src']
  });
  window.addEventListener('yt-navigate-finish', scheduleScan);
})();
