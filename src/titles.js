// Pure title-cleaning logic. Works in the browser (global) and in Node (tests).
(function (root) {
  // Short all-caps words that are normally written in caps.
  const KEEP_CAPS = new Set([
    'NASA', 'FIFA', 'UEFA', 'NATO', 'OPEC', 'IKEA', 'LEGO', 'HTML', 'HTTP', 'HTTPS', 'JSON',
    'CSS', 'SQL', 'GPU', 'CPU', 'AMD', 'IPL', 'NBA', 'NFL', 'NHL', 'MLB', 'WWE', 'UFC',
    'USA', 'FAQ', 'DIY', 'ASMR', 'SUV', 'EV', 'AI', 'TV', 'UK', 'US', 'UN', 'EU'
  ]);
  const EMOJI = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

  function cleanTitle(input) {
    if (typeof input !== 'string') return input;
    let t = input;

    // 1. Remove emoji.
    t = t.replace(EMOJI, '');

    // 2. Collapse shouty punctuation: "!!!" -> "!", "?!?!" -> "?".
    t = t.replace(/([!?]){2,}/g, (m) => (m.includes('?') ? '?' : '!'));

    // 3. Calm down ALL CAPS words (4+ letters), keep known acronyms.
    let loweredFirst = false;
    const letters = t.replace(/[^A-Za-z]/g, '');
    const upper = letters.replace(/[^A-Z]/g, '');
    // If most of the title is shouting, also fix short words like "YOU" or "NOW".
    const shouting = letters.length >= 8 && upper.length / letters.length > 0.6;
    const minLen = shouting ? 2 : 4;
    const words = t.split(/(\s+)/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const core = w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (core.length >= minLen && core === core.toUpperCase() && /^[A-Z'’\-]+$/.test(core) && !KEEP_CAPS.has(core)) {
        words[i] = w.replace(core, core.toLowerCase());
        if (i === 0) loweredFirst = true;
      }
    }
    t = words.join('');

    // 4. Tidy spacing and stray separators left behind by removed emoji.
    t = t.replace(/\s{2,}/g, ' ').replace(/^[\s|\-–—:]+|[\s|\-–—:]+$/g, '').trim();

    // 5. Re-capitalise the first letter if we lowercased it.
    if (loweredFirst && t.length) t = t[0].toUpperCase() + t.slice(1);

    // Never return an empty title.
    return t || input.trim();
  }

  const CLICKBAIT = [
    /you won['’]?t believe/i, /gone wrong/i, /\bshocking\b/i, /what happens next/i,
    /\bnobody (tells|talks|knows|wants)/i, /\bthe truth about\b/i, /\bexposed\b/i,
    /\b(destroyed|obliterated)\b/i, /mind[- ]?blowing/i, /\bwill (blow|shock) your/i,
    /\bdon['’]?t (click|watch)\b/i, /\bwait for it\b/i, /\bnot clickbait\b/i,
    /\bunbelievable\b/i, /\b(this|these) (will|is going to) change/i, /\bwhat they don['’]?t (want|tell)/i,
    /\bhate me\b/i, /\bsecret(s)? (they|that|nobody)/i
  ];

  // Returns a short label when a title uses well-known clickbait patterns, otherwise ''.
  function clickbaitHint(input) {
    const t = String(input || '');
    if (CLICKBAIT.some((re) => re.test(t))) return 'Clickbait-style wording';
    const letters = t.replace(/[^A-Za-z]/g, '');
    const words = t.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
    if (words.length >= 3 && letters.length >= 10 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) return 'Shouty title';
    if ((t.match(/!/g) || []).length >= 3) return 'Shouty title';
    return '';
  }

  // A stable hue (0-359) for a channel, so each channel's cards get their own quiet tint.
  function channelHue(key) {
    const s = String(key || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 360;
  }

  // "crypto, Mr Beast ,  prank" -> ['crypto', 'mr beast', 'prank'] (deduped, max 50).
  function parseMutedWords(text) {
    const out = [];
    for (const raw of String(text || '').split(/[,\n]/)) {
      const w = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (w && w.length <= 40 && !out.includes(w)) out.push(w);
    }
    return out.slice(0, 50);
  }

  // Returns the muted word that matches (whole word / phrase, case-insensitive), or ''.
  function mutedMatch(text, words) {
    const t = ' ' + String(text || '').toLowerCase().replace(/[^\p{L}\p{N}#@]+/gu, ' ') + ' ';
    for (const w of words || []) {
      const p = String(w).toLowerCase().replace(/[^\p{L}\p{N}#@]+/gu, ' ').trim();
      if (p && t.includes(' ' + p + ' ')) return w;
    }
    return '';
  }

  root.HonestTitles = { cleanTitle, clickbaitHint, channelHue, parseMutedWords, mutedMatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HonestTitles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
