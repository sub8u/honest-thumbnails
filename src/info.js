// Pure helpers for reading a YouTube watch page. Works in the browser and in Node (tests).
(function (root) {
  function extractJson(html, markerRe) {
    const m = markerRe.exec(html);
    if (!m) return null;
    let i = html.indexOf('{', m.index + m[0].length - 1);
    if (i < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(i, j + 1)); } catch (e) { return null; }
      }
    }
    return null;
  }

  const num = (s) => Number(String(s).replace(/,/g, ''));

  // Best effort: YouTube's markup for like counts changes. Returns a number or null.
  function parseLikes(html) {
    let m = /"likeCount"\s*:\s*"?(\d+)"?/.exec(html);
    if (m) return num(m[1]);
    m = /along with ([\d,]+) other people/.exec(html);
    if (m) return num(m[1]);
    m = /"label"\s*:\s*"([\d,]+) likes?"/.exec(html);
    if (m) return num(m[1]);
    return null;
  }

  const TS_LINE = /^\W{0,2}(?:\d{1,2}:)?\d{1,2}:\d{2}\W?\s+\S/;

  function countChapters(description, html) {
    const fromDesc = description.split('\n').filter((l) => TS_LINE.test(l.trim())).length;
    const fromData = (html.match(/"chapterRenderer"/g) || []).length;
    const n = Math.max(fromDesc, fromData);
    return n >= 3 ? n : 0;
  }

  // First meaningful sentence(s) of a description, with links, hashtags, timestamps and promo lines removed.
  function descriptionSnippet(desc, max) {
    max = max || 200;
    const out = [];
    let len = 0;
    for (const raw of String(desc || '').split('\n')) {
      let l = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      if (!l || l.length < 12) continue;
      if (TS_LINE.test(l)) continue;
      if (/^(#\S+\s*)+$/.test(l)) continue;
      if (/^(subscribe|follow|sponsor|business|contact|music|©|copyright|like and|support|join|patreon|instagram|twitter|discord|merch)/i.test(l)) continue;
      out.push(l);
      len += l.length;
      if (len >= max) break;
    }
    let s = out.join(' ');
    if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return s;
  }

  function parseWatchHtml(html) {
    const pr = extractJson(html, /ytInitialPlayerResponse\s*=\s*\{/);
    if (!pr || !pr.videoDetails) return null;
    const vd = pr.videoDetails;
    const description = vd.shortDescription || '';
    const tracks = (pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    return {
      title: vd.title || '',
      author: vd.author || '',
      description: description.slice(0, 1500),
      snippet: descriptionSnippet(description),
      views: vd.viewCount ? Number(vd.viewCount) : null,
      lengthSeconds: vd.lengthSeconds ? Number(vd.lengthSeconds) : null,
      keywords: (vd.keywords || []).slice(0, 3),
      isLive: !!vd.isLive,
      likes: parseLikes(html),
      chapters: countChapters(description, html),
      chapterTitles: chapterTitles(description, html),
      hasCaptions: tracks.length > 0,
      tracks
    };
  }

  function formatCount(n) {
    if (n == null || isNaN(n)) return '';
    try {
      return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
    } catch (e) { return String(n); }
  }

  // Keep the head and tail of long transcripts so cost stays bounded.
  function clip(text, max) {
    max = max || 12000;
    if (text.length <= max) return text;
    const head = Math.floor(max * 0.7);
    return text.slice(0, head) + ' … ' + text.slice(text.length - (max - head));
  }

  // "Title by Channel 1.2M views 3 days ago 10 minutes" -> "Title"
  function titleFromAria(label) {
    if (!label) return '';
    const i = label.lastIndexOf(' by ');
    return (i > 0 ? label.slice(0, i) : label).trim();
  }

  // Keep summaries tight: first sentence only, capped in length.
  function oneSentence(text, max) {
    max = max || 150;
    let t = String(text || '').replace(/^[\s✨*\-•]+/, '').replace(/\s+/g, ' ').trim();
    const m = /^(.+?[.!?])(\s|$)/.exec(t);
    if (m) t = m[1];
    if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  // Up to two sentences, cleaned of bullets/markdown. Only cut (with …) past a generous limit.
  function tidySummary(text, max) {
    max = max || 320;
    let t = String(text || '').replace(/[*_#`]/g, '').replace(/^[\s✨\-•]+/, '').replace(/\s+/g, ' ').trim();
    const parts = t.match(/[^.!?]+[.!?]+(\s|$)/g);
    if (parts && parts.length > 2) t = parts.slice(0, 2).join('').trim();
    if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  // ---- Listicle detection and structured summaries ---------------------------
  const WORDNUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  const ITEM_WORDS = '(?:things|ways|tips|reasons|mistakes|tricks|facts|rules|steps|signs|habits|ideas|lessons|secrets|hacks|apps|tools|books|movies|games|foods|questions|myths|differences|features|changes|problems|lies|truths|upgrades|places|skills|principles|points|takeaways|examples|strategies|methods|types|mistakes|benefits|reasons|predictions|trends|alternatives|plugins|extensions|shows|songs|gadgets)';
  const NUMTOK = '(\\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

  const RANK_BEFORE = "(?<!\\b(?:among|into|in|world['’]?s|country['’]?s|india['’]?s|enters?|entered|makes?|made|reach(?:es|ed)?|ranks?|ranked|cracks?|joins?|joined)\\s+(?:the\\s+)?)";
  const NOT_ITEM = '(?!(?:in|of|on|at|for|by|to|and|or|list|rank|ranking|position|percent|globally|worldwide)\\b)';

  // If the title promises N things ("5 tips", "Top 7 apps"), return N; otherwise 0.
  function listicleCount(title) {
    const t = String(title || '');
    // "Top 10 apps" is a list; "ranks among the world's top 10" or "top 10 in the world" is a ranking, not a list.
    let m = new RegExp(RANK_BEFORE + '\\b(?:top|best|worst)\\s+' + NUMTOK + '\\s+' + NOT_ITEM + '[A-Za-z]', 'i').exec(t) ||
      new RegExp('\\b' + NUMTOK + '\\s+(?:[\\w\'’-]+\\s+){0,2}' + ITEM_WORDS + '\\b', 'i').exec(t);
    if (!m) return 0;
    const raw = m[1].toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : (WORDNUM[raw] || 0);
    return n >= 2 && n <= 12 ? n : 0;
  }

  // Turn model output into { gist, bullets }. Accepts "- x", "* x", "• x", "1. x" lines.
  function parseSummary(text, maxBullets) {
    maxBullets = maxBullets || 12;
    const lines = String(text || '').replace(/[*_#`]{2,}/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const bullets = [];
    const gistParts = [];
    const BUL = /^(?:[-*•–]|\d{1,2}[.)])\s+(.*)$/;
    for (const l of lines) {
      const m = BUL.exec(l);
      if (m) {
        const b = m[1].replace(/\*\*/g, '').trim();
        if (b) bullets.push(b.length > 140 ? b.slice(0, 139).replace(/\s+\S*$/, '') + '…' : b);
      } else if (!bullets.length) {
        gistParts.push(l.replace(/\*\*/g, ''));
      }
    }
    let gist = gistParts.join(' ').replace(/^[\s✨]+/, '').trim();
    if (gist.length > 200) gist = gist.slice(0, 199).replace(/\s+\S*$/, '') + '…';
    return { gist, bullets: bullets.slice(0, maxBullets) };
  }

  // Chapter titles, from YouTube's chapter data when present, else from "0:00 Intro" lines in the description.
  function chapterTitles(description, html) {
    const out = [];
    const re = /"chapterRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(html || ''))) {
      try { out.push(JSON.parse('"' + m[1] + '"')); } catch (e) { /* skip */ }
    }
    let list = out;
    if (list.length < 3) {
      list = [];
      for (const line of String(description || '').split('\n')) {
        const mm = /^\W{0,2}(?:\d{1,2}:)?\d{1,2}:\d{2}\W?\s*[-–—:|.)]*\s*(.+)$/.exec(line.trim());
        if (mm && mm[1].trim()) list.push(mm[1].trim());
      }
    }
    if (list.length < 3) return [];
    return list.slice(0, 24).map((t) => t.replace(/\s+/g, ' ').slice(0, 90));
  }

  const SKIP_CHAPTER = /^(intro(duction)?|outro|conclusion|sponsor(ed)?|recap|summary|welcome|ending|final thoughts|thanks?|bonus|overview|trailer|teaser)\b/i;

  // When a video has exactly N real chapters and the title promises N items, the chapters ARE the items.
  function chapterItems(titles, n) {
    if (!n || !titles || !titles.length) return null;
    const items = titles.map((t) => t.replace(/^\d{1,2}[.):]\s*/, '').trim()).filter((t) => t && !SKIP_CHAPTER.test(t));
    return items.length === n ? items : null;
  }

  function cleanChapters(titles) {
    return (titles || []).map((t) => t.replace(/^\d{1,2}[.):]\s*/, '').trim()).filter(Boolean);
  }

  function langName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  function summaryText(title, sm, id) {
    const lines = [title || ''];
    if (sm.gist) lines.push(sm.gist);
    (sm.bullets || []).forEach((b) => lines.push('- ' + b));
    if (id) lines.push('https://youtu.be/' + id);
    return lines.filter((l, i) => l || i > 0).join('\n');
  }

  const api = { chapterTitles, chapterItems, cleanChapters, langName, summaryText, listicleCount, parseSummary, tidySummary, oneSentence, extractJson, parseLikes, countChapters, descriptionSnippet, parseWatchHtml, formatCount, clip, titleFromAria };
  root.HonestInfo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
