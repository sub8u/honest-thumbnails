const assert = require('assert');
const I = require('../src/info.js');

const player = {
  videoDetails: {
    title: 'How bridges work', author: 'Eng Channel', viewCount: '1234567', lengthSeconds: '600',
    keywords: ['bridges', 'engineering', 'physics', 'extra'], isLive: false,
    shortDescription: 'In this video we explain how suspension bridges carry load.\nMore text about {braces} and "quotes".\n0:00 Intro\n1:10 Cables\n3:00 Towers\n5:00 Wrap up\nhttps://example.com/shop\n#bridges #engineering\nSubscribe for more!'
  },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x', languageCode: 'en' }] } }
};
const html = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var meta = {};</script>` +
  `<script>var ytInitialData = {"label":"12,345 likes","x":"along with 12,345 other people"}</script></html>`;
const info = I.parseWatchHtml(html);
assert.strictEqual(info.author, 'Eng Channel');
assert.strictEqual(info.views, 1234567);
assert.strictEqual(info.likes, 12345);
assert.strictEqual(info.chapters, 4);
assert.strictEqual(info.hasCaptions, true);
assert.deepStrictEqual(info.keywords, ['bridges', 'engineering', 'physics']);
assert.ok(info.snippet.startsWith('In this video we explain how suspension bridges carry load.'), info.snippet);
assert.ok(!/example\.com|#bridges|Subscribe|Intro/.test(info.snippet), info.snippet);
assert.strictEqual(I.parseWatchHtml('<html>nothing</html>'), null);
assert.strictEqual(I.formatCount(12345), '12.3K');
assert.strictEqual(I.formatCount(1234567), '1.2M');
assert.strictEqual(I.titleFromAria('Cool video by Some Chan 1.2M views 3 days ago 10 minutes'), 'Cool video');
assert.strictEqual(I.clip('a'.repeat(100), 50).length > 50, true);
assert.strictEqual(I.clip('short', 50), 'short');
assert.strictEqual(I.oneSentence('✨ First one. Second sentence here.'), 'First one.');
assert.ok(I.oneSentence('word '.repeat(60)).length <= 150);
assert.strictEqual(I.tidySummary('**One.** Two. Three. Four.'), 'One. Two.');
assert.strictEqual(I.tidySummary('Short summary text.'), 'Short summary text.');
assert.ok(I.tidySummary('word '.repeat(100)).length <= 320);
assert.strictEqual(I.listicleCount('5 Tips to Sleep Better'), 5);
assert.strictEqual(I.listicleCount('Top 10 Free VS Code Extensions'), 10);
assert.strictEqual(I.listicleCount('Three simple ways to learn faster'), 3);
assert.strictEqual(I.listicleCount('7 Python mistakes beginners make'), 7);
assert.strictEqual(I.listicleCount('iPhone 15 review'), 0);
assert.strictEqual(I.listicleCount('How bridges work'), 0);
assert.strictEqual(I.listicleCount('2025 election results'), 0);
assert.strictEqual(I.listicleCount("This Indian Museum Beat Louvre & Met To Rank Among World’s Top 10 | The Palki …"), 0);
assert.strictEqual(I.listicleCount('Bihar enters the top 10'), 0);
assert.strictEqual(I.listicleCount('Top 10 in the world'), 0);
assert.strictEqual(I.listicleCount('My top 5 laptops of 2026'), 5);
assert.strictEqual(I.listicleCount('Best 3 budget phones'), 3);
assert.strictEqual(I.listicleCount('Top 7 Places to Visit in Japan'), 7);
const ps = I.parseSummary('A talk about sleep.\n- Keep a schedule\n* Avoid caffeine\n3. Dark room\n');
assert.strictEqual(ps.gist, 'A talk about sleep.');
assert.deepStrictEqual(ps.bullets, ['Keep a schedule', 'Avoid caffeine', 'Dark room']);
assert.deepStrictEqual(I.parseSummary('Just a sentence.').bullets, []);
const ch = I.chapterTitles('x\n0:00 Intro\n1:10 1. Cables\n3:00 2) Towers\n5:00 Wrap up\n', '');
assert.deepStrictEqual(ch, ['Intro', '1. Cables', '2) Towers', 'Wrap up']);
const fromData = I.chapterTitles('', '"chapterRenderer":{"title":{"simpleText":"A \\"q\\""}}"chapterRenderer":{"title":{"simpleText":"B"}}"chapterRenderer":{"title":{"simpleText":"C"}}');
assert.deepStrictEqual(fromData, ['A "q"', 'B', 'C']);
assert.deepStrictEqual(I.chapterItems(['Intro', '1. Cables', '2) Towers', 'Outro'], 2), ['Cables', 'Towers']);
assert.strictEqual(I.chapterItems(['Intro', 'A', 'B', 'C'], 5), null);
assert.strictEqual(I.chapterItems([], 3), null);
assert.strictEqual(I.langName('es'), 'Spanish');
assert.strictEqual(I.summaryText('T', { gist: 'G', bullets: ['a', 'b'] }, 'abc'), 'T\nG\n- a\n- b\nhttps://youtu.be/abc');
assert.deepStrictEqual(info.chapterTitles, ['Intro', 'Cables', 'Towers', 'Wrap up']);
console.log('info: all tests passed');
