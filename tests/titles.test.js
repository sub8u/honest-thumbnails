const assert = require('assert');
const { cleanTitle } = require('../src/titles.js');
const cases = [
  ['YOU WON\'T BELIEVE THIS!!! 😱😱', "You won't believe this!"],
  ['I Built a House in 24 Hours 🏠🔥', 'I Built a House in 24 Hours'],
  ['NASA reveals NEW images', 'NASA reveals NEW images'],
  ['How CPU caches work', 'How CPU caches work'],
  ['WHAT?!?! GOING ON', 'What? going on'],
  ['NASA reveals NEW IMAGES of MARS', 'NASA reveals new images of mars'],
  ['🔥', '🔥'],
];
for (const [i, o] of cases) assert.strictEqual(cleanTitle(i), o, `${i} -> ${cleanTitle(i)}`);
const { clickbaitHint } = require('../src/titles.js');
assert.ok(clickbaitHint("You WON'T BELIEVE this"));
assert.ok(clickbaitHint('Cooking Gone Wrong'));
assert.ok(clickbaitHint('THIS IS ABSOLUTELY INSANE NOW'));
assert.strictEqual(clickbaitHint('How bridges work'), '');
assert.strictEqual(clickbaitHint('NASA reveals new images'), '');
const { channelHue, parseMutedWords, mutedMatch } = require('../src/titles.js');
assert.strictEqual(channelHue('@veritasium'), channelHue('@veritasium'));
assert.ok(channelHue('@a') >= 0 && channelHue('@a') < 360);
assert.notStrictEqual(channelHue('@a'), channelHue('@b'));
assert.deepStrictEqual(parseMutedWords(' Crypto, Mr  Beast ,\nprank, crypto,, '), ['crypto', 'mr beast', 'prank']);
assert.strictEqual(mutedMatch('My CRYPTO portfolio!', ['crypto']), 'crypto');
assert.strictEqual(mutedMatch('Cryptography explained', ['crypto']), '');
assert.strictEqual(mutedMatch('I met Mr. Beast', ['mr beast']), 'mr beast');
assert.strictEqual(mutedMatch('Anything', []), '');
console.log('titles: all', cases.length, 'tests passed');
