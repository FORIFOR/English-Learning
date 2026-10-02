// Dependency-free DOM-adapter smoke tests: execute the actual app module and
// event handlers, but do not verify browser layout, focus, speech, or rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
let run = 0;
class Element {
  constructor(document, attributes = '') {
    this.document = document; this.attributes = {}; this.dataset = {}; this.listeners = {};
    this.textContent = ''; this.hidden = false; this.disabled = /(?:^|\s)disabled(?:\s|$)/.test(attributes);
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.classList = { add() {}, remove() {}, toggle() {} };
    for (const [, key, value = ''] of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      this.attributes[key] = value;
      if (key === 'id') this.id = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
    }
  }
  set innerHTML(value) {
    this.html = value;
    this.document.elements = this.document.elements.filter(element => element.owner !== this);
    this.document.parse(value, this);
  }
  get innerHTML() { return this.html || ''; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  closest(selector) { return selector === 'button' ? this : null; }
  focus() { this.document.activeElement = this; }
  scrollIntoView() {}
}
class Document {
  elements = []; listeners = {};
  parse(markup, owner) {
    for (const [, tag, attributes] of markup.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)) {
      const element = new Element(this, attributes); element.owner = owner; element.tag = tag;
      this.elements.push(element);
    }
  }
  matches(element, selector) {
    if (selector.startsWith('#')) return element.id === selector.slice(1);
    if (selector.startsWith('.')) return element.attributes.class?.split(' ').includes(selector.slice(1));
    const match = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    return !!match && Object.hasOwn(element.dataset, match[1]) && (match[2] === undefined || element.dataset[match[1]] === match[2]);
  }
  querySelector(selector) { return this.elements.find(element => this.matches(element, selector)) || null; }
  querySelectorAll(selector) { return this.elements.filter(element => this.matches(element, selector)); }
  addEventListener(type, callback) { this.listeners[type] = callback; }
}
async function setup(t, { speech = true, corruptStorage = false, failWrites = false, unavailableStorage = false, reducedMotion = false, viewTransitions = false } = {}) {
  const doc = new Document(); doc.parse(html);
  const listeners = {}, spoken = [], values = new Map();
  const storage = { getItem: key => corruptStorage && !values.has(key) ? '{broken' : values.get(key) ?? null, setItem: (key, value) => { if (!failWrites) values.set(key, value); } };
  const window = { localStorage: storage, matchMedia: query => ({ matches: query.includes('prefers-reduced-motion') && reducedMotion }), addEventListener: (type, fn) => { listeners[type] = fn; } };
  if (unavailableStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  const transitions = [];
  if (viewTransitions) doc.startViewTransition = update => {
    let resolve;
    const transition = { update, skipTransition() {}, finished: new Promise(done => { resolve = done; }) };
    transition.flush = () => { update(); resolve(); };
    transitions.push(transition);
    return transition;
  };
  if (speech) {
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    window.speechSynthesis = { cancel() {}, speak(utterance) { spoken.push(utterance); }, getVoices: () => [] };
  }
  const previous = { document: globalThis.document, window: globalThis.window, location: globalThis.location };
  Object.assign(globalThis, { document: doc, window, location: { hash: '' } });
  t.after(() => { listeners.pagehide?.(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  await import(`../app.js?smoke=${++run}`);
  transitions.splice(0).forEach(transition => transition.flush());
  return {
    doc, spoken, values, listeners, transitions,
    get: selector => doc.querySelector(selector),
    content: () => doc.querySelector('#lesson-content').innerHTML,
    click(selector) {
      const button = doc.querySelector(selector);
      assert.ok(button, `Rendered control exists: ${selector}`);
      const oldHash = globalThis.location.hash;
      doc.listeners.click({ target: button });
      if (globalThis.location.hash !== oldHash) listeners.hashchange?.();
    },
  };
}

test('app boots with eight lesson controls and no automatic speech', async t => {
  const app = await setup(t);
  assert.equal(app.doc.querySelectorAll('[data-lesson]').length, 8);
  assert.equal(app.get('#lesson-title').textContent, 'The Last Seat');
  assert.match(app.content(), /字幕なしで聴く/);
  assert.equal(app.spoken.length, 0);
  assert.equal(app.get('#storage-warning').hidden, true);
});

test('listening UI waits for onstart, pauses, restarts, and ignores a cancelled route', async t => {
  const app = await setup(t);
  app.click('[data-action="start-listen"]');
  assert.equal(app.get('#line-number').textContent, '0');
  const old = app.spoken[0]; old.onstart();
  assert.equal(app.get('#line-number').textContent, '1');
  app.click('[data-action="toggle-audio"]');
  assert.match(app.get('#toggle-audio').innerHTML, /再開する/);
  app.click('[data-action="toggle-audio"]');
  assert.equal(app.spoken[1].text, old.text);
  app.click('[data-lesson="coffee-for-two"]');
  const content = app.content();
  old.onend(); old.onerror(); old.onstart();
  assert.equal(app.content(), content);
  assert.equal(app.get('#lesson-title').textContent, 'Coffee for Two');
});

test('switching from interrupted listening to speaking starts a clean practice session', async t => {
  const app = await setup(t);
  app.click('[data-action="start-listen"]');
  app.spoken[0].onstart();
  app.click('[data-mode="speak"]');
  assert.doesNotThrow(() => app.click('[data-action="start-practice"]'));
  assert.equal(app.spoken.at(-1).text, 'Ask if you can sit here.');
  assert.match(app.content(), /声の録音・認識・採点はしていません/);
});

test('switching from a transcript segment to practice does not reuse the segment state', async t => {
  const app = await setup(t);
  app.click('[data-action="transcript"]');
  app.click('[data-segment="0"]');
  app.click('[data-mode="speak"]');
  assert.doesNotThrow(() => app.click('[data-action="start-practice"]'));
  assert.equal(app.spoken.at(-1).text, 'Ask if you can sit here.');
});

test('text fallback can complete a transfer check and save exactly one review record', async t => {
  const app = await setup(t, { speech: false });
  app.click('[data-action="transcript"]');
  app.click('[data-action="transfer"]');
  app.click('[data-answer="1"]');
  assert.match(app.content(), /別の場面でも使えました/);
  app.click('[data-action="complete"]');
  assert.match(app.content(), /音声を聴いた記録はありません/);
  assert.doesNotMatch(app.content(), /聞いたことばを、違う場面でも確かめました/);
  app.click('[data-review="remembered"]');
  assert.match(app.content(), /このブラウザに保存しました/);
  const records = JSON.parse([...app.values.values()][0]);
  assert.equal(records['last-seat'].count, 1);
  assert.equal(records['last-seat'].level, 1);
  assert.equal(records['last-seat'].due - records['last-seat'].updated, 3 * 86400000);
  assert.equal(app.get('#completed-count').textContent, 1);
  assert.equal(app.doc.querySelectorAll('[data-review]').length, 0, 'save controls disappear after saving');
});

test('failed persistence shows an honest warning while allowing text learning', async t => {
  const app = await setup(t, { corruptStorage: true, failWrites: true });
  assert.equal(app.get('#storage-warning').hidden, false);
  app.click('[data-action="transcript"]'); app.click('[data-action="transfer"]');
  app.click('[data-answer="0"]');
  assert.match(app.content(), /答えを確認して/);
  app.click('[data-action="complete"]'); app.click('[data-review="again"]');
  assert.match(app.content(), /端末に保存できませんでした/);
  assert.equal(app.get('#storage-warning').hidden, false);
  assert.equal(app.get('#completed-count').textContent, 1);
});

test('visibility loss pauses active speech and requires explicit resume', async t => {
  const app = await setup(t);
  app.click('[data-action="start-listen"]'); app.spoken[0].onstart();
  app.doc.hidden = true; app.doc.listeners.visibilitychange();
  assert.match(app.get('#toggle-audio').innerHTML, /再開する/);
  app.doc.hidden = false; app.doc.listeners.visibilitychange();
  assert.equal(app.spoken.length, 1);
  app.click('[data-action="toggle-audio"]');
  assert.equal(app.spoken.length, 2);
});

test('speech errors retain a retry and text route without recording a successful listen', async t => {
  const app = await setup(t);
  app.click('[data-action="start-listen"]');
  app.spoken[0].onerror({ error: 'voice-unavailable' });
  assert.match(app.content(), /音声を再生できませんでした/);
  assert.ok(app.get('[data-action="transcript"]'));
  assert.match(app.get('#toggle-audio').innerHTML, /もう一度/);
  assert.equal(app.get('#completed-count').textContent, 0);
  app.click('[data-action="toggle-audio"]');
  assert.equal(app.spoken.length, 2);
  assert.equal(app.get('#line-number').textContent, '0');
});

test('unsupported speech stays recoverable in both modes and never implies completion', async t => {
  const app = await setup(t, { speech: false });
  assert.match(app.content(), /読み上げに対応していません/);
  app.click('[data-action="start-listen"]');
  assert.match(app.content(), /読み上げに対応していません/);
  assert.equal(app.get('#completed-count').textContent, 0);
  app.click('[data-mode="speak"]'); app.click('[data-action="start-practice"]');
  assert.match(app.content(), /読み上げに対応していません/);
  assert.ok(app.get('[data-action="transcript"]'));
  assert.equal(app.get('#completed-count').textContent, 0);
});

test('empty device voice enumeration remains pending until real speech start', async t => {
  const app = await setup(t);
  app.click('[data-action="start-listen"]');
  assert.equal(app.spoken[0].voice, null);
  assert.match(app.get('#audio-status').textContent, /準備/);
  assert.equal(app.get('#line-number').textContent, '0');
  app.spoken[0].onstart();
  assert.match(app.get('#audio-status').textContent, /耳を澄ませて/);
});

test('localStorage access denial still boots and permits an honest in-memory review', async t => {
  const app = await setup(t, { unavailableStorage: true });
  assert.equal(app.get('#storage-warning').hidden, false);
  app.click('[data-action="transcript"]'); app.click('[data-action="transfer"]');
  app.click('[data-answer="1"]'); app.click('[data-action="complete"]');
  app.click('[data-review="again"]');
  assert.match(app.content(), /端末に保存できませんでした/);
  assert.equal(app.get('#completed-count').textContent, 1);
});

test('answer feedback sends focus to the next action', async t => {
  const app = await setup(t);
  app.click('[data-action="transcript"]'); app.click('[data-action="transfer"]');
  app.click('[data-answer="1"]');
  assert.equal(app.doc.activeElement?.dataset.action, 'complete');
  assert.ok(app.doc.querySelectorAll('[data-answer]').every(button => button.disabled));
});

test('reduced-motion preference skips view-transition APIs', async t => {
  const app = await setup(t, { reducedMotion: true, viewTransitions: true });
  app.click('[data-action="transcript"]');
  assert.equal(app.transitions.length, 0);
  assert.match(app.content(), /WORDS & SOUNDS/);
});

test('a delayed view transition cannot overwrite a newer playback action', async t => {
  const app = await setup(t, { viewTransitions: true });
  app.click('[data-action="transcript"]');
  assert.equal(app.transitions.length, 1);
  // The old screen is still visible while its update is queued.
  app.click('[data-action="start-listen"]');
  assert.match(app.content(), /01 \/ LISTEN/);
  app.transitions[0].flush();
  assert.match(app.content(), /01 \/ LISTEN/);
  assert.equal(app.spoken.length, 1);
});

test('external hash navigation cancels active speech and restores the requested mode', async t => {
  const app = await setup(t);
  app.click('[data-action="start-listen"]'); const old = app.spoken[0];
  globalThis.location.hash = '#coffee-for-two/speak'; app.listeners.hashchange();
  assert.equal(app.get('#lesson-title').textContent, 'Coffee for Two');
  assert.match(app.content(), /3つの問いで/);
  old.onstart(); old.onend(); old.onerror();
  assert.match(app.content(), /3つの問いで/);
  assert.equal(app.spoken.length, 1);
});

test('native keyboard controls, visible focus, skip link, and reduced-motion CSS are declared', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(html, /<a class="skip-link" href="#workspace">/);
  assert.match(html, /id="workspace"[^>]*tabindex="-1"/);
  assert.match(html, /<button[^>]*data-mode="listen"/);
  assert.match(html, /<select[^>]*aria-label="音声の再生速度"/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /animation:none!important/);
});
