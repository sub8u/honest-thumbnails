// Loads the page script against a stub browser to catch typos / undefined names at startup.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const listeners = [];
const store = { sync: {}, local: {} };
const chrome = {
  storage: {
    sync: { get: (d, cb) => cb({ ...d, ...store.sync }), set: (o, cb) => { Object.assign(store.sync, o); cb && cb(); } },
    local: { get: (k, cb) => cb({}), set: () => {} },
    onChanged: { addListener: (f) => listeners.push(f) }
  },
  runtime: { onMessage: { addListener: () => {} }, sendMessage: () => {}, lastError: null }
};
const documentElement = { dataset: {}, appendChild() {} };
const document = {
  documentElement, title: 'x - YouTube',
  querySelectorAll: () => [], querySelector: () => null, createElement: () => ({ style: {}, dataset: {}, appendChild() {}, classList: { add() {} } }),
  body: { appendChild() {} }
};
const win = {
  addEventListener() {}, innerHeight: 800, HonestTitles: null, HonestInfo: null
};
const ctx = {
  window: win, document, chrome, location: { pathname: '/', search: '' }, navigator: { language: 'en-US' },
  MutationObserver: class { observe() {} }, setTimeout: (f) => { f(); return 1; }, clearTimeout() {}, URLSearchParams,
  getComputedStyle: () => ({ position: 'static' }), fetch: () => Promise.reject(new Error('no net')), console, Intl
};
ctx.self = ctx.window;
vm.createContext(ctx);
// Mimic the content-script load order from the manifest.
vm.runInContext(read('src/titles.js'), ctx);
vm.runInContext(read('src/info.js'), ctx);
ctx.window.HonestTitles = ctx.HonestTitles;
ctx.window.HonestInfo = ctx.HonestInfo;
vm.runInContext(read('src/content.js'), ctx);
assert = require('assert');
assert.strictEqual(documentElement.dataset.htMode, 'frame');
console.log('smoke: content script starts and scans an empty page');
