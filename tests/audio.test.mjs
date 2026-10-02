import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSequence, listeningItems, practiceItems } from '../audio.js';

class FakeClock {
  time = 0;
  serial = 0;
  tasks = new Map();
  setTimeout(callback, delay) {
    const id = ++this.serial;
    this.tasks.set(id, { callback, at: this.time + delay });
    return id;
  }
  clearTimeout(id) { this.tasks.delete(id); }
  tick(ms) {
    const target = this.time + ms;
    let safety = 10000;
    while (safety--) {
      const next = [...this.tasks.entries()].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) { this.time = target; return; }
      const [id, task] = next;
      this.tasks.delete(id);
      this.time = task.at;
      task.callback();
    }
    throw new Error('Timer loop did not settle');
  }
}

class FakeUtterance { constructor(text) { this.text = text; } }
function setup({ voices = [], unsupported = false, throwOnSpeak = false } = {}) {
  const clock = new FakeClock();
  const changes = [], errors = [], completed = [];
  const synth = {
    utterances: [], cancelled: 0,
    cancel() { this.cancelled++; },
    getVoices() { return voices; },
    speak(utterance) { if (throwOnSpeak) throw new Error('speak blocked'); this.utterances.push(utterance); },
  };
  const audio = new AudioSequence({
    synth: unsupported ? null : synth,
    Utterance: unsupported ? null : FakeUtterance,
    timer: clock, now: () => clock.time,
    onChange: value => changes.push(value), onDone: () => completed.push(clock.time), onError: message => errors.push(message),
  });
  return { audio, synth, clock, changes, errors, completed };
}
const say = (text = 'Hello.') => ({ type: 'say', text });
const gap = (ms = 500) => ({ type: 'gap', ms });

// These are deterministic API/state-machine checks, not real browser/audio-device checks.
test('stays pending until the browser actually dispatches onstart', () => {
  const { audio, synth, clock, changes, completed } = setup();
  audio.start([say()]);
  assert.equal(audio.state, 'pending');
  assert.equal(completed.length, 0);
  clock.tick(9999);
  assert.equal(audio.state, 'pending');
  synth.utterances[0].onstart();
  assert.equal(audio.state, 'speaking');
  clock.tick(2);
  assert.equal(audio.state, 'speaking', 'the pending-start timeout was cleared');
  assert.deepEqual(changes.map(x => x.state), ['pending', 'speaking']);
});

test('completion occurs only after the final utterance has ended', () => {
  const { audio, synth, completed, clock } = setup();
  audio.start([say('First'), gap(450), say('Second')]);
  const first = synth.utterances[0];
  first.onstart();
  assert.equal(completed.length, 0);
  first.onend();
  assert.equal(audio.state, 'gap');
  assert.equal(completed.length, 0);
  clock.tick(449);
  assert.equal(synth.utterances.length, 1);
  clock.tick(1);
  const last = synth.utterances[1];
  assert.equal(audio.state, 'pending');
  last.onstart();
  assert.equal(completed.length, 0);
  last.onend();
  assert.equal(audio.state, 'done');
  assert.equal(completed.length, 1);
  assert.equal(clock.tasks.size, 0);
  last.onend();
  last.onstart();
  last.onerror();
  assert.equal(audio.state, 'done', 'late events from the completed utterance are ignored');
  assert.equal(completed.length, 1, 'completion is delivered once');
});

test('events from an earlier utterance cannot skip a gap or a newer utterance', () => {
  const { audio, synth, completed, errors, clock } = setup();
  audio.start([say('First'), gap(450), say('Second')]);
  const first = synth.utterances[0];
  first.onstart(); first.onend();
  first.onend(); first.onstart(); first.onerror();
  assert.equal(audio.state, 'gap');
  assert.equal(audio.index, 1);
  assert.equal(synth.utterances.length, 1);
  assert.equal(errors.length, 0);
  clock.tick(450);
  const second = synth.utterances[1];
  first.onend(); first.onstart(); first.onerror();
  assert.equal(audio.state, 'pending');
  assert.equal(audio.index, 2);
  assert.equal(completed.length, 0);
  second.onstart(); second.onend();
  assert.equal(completed.length, 1);
});

test('pause cancels speech and resume restarts the same utterance, not the next', () => {
  const { audio, synth, clock, completed, errors } = setup();
  audio.start([say('First'), say('Second')]);
  const first = synth.utterances[0];
  first.onstart(); clock.tick(500);
  audio.pause();
  assert.equal(audio.state, 'paused');
  assert.equal(audio.index, 0);
  assert.equal(clock.tasks.size, 0);
  first.onend(); first.onerror(); first.onstart();
  clock.tick(60000);
  assert.equal(audio.state, 'paused');
  assert.equal(errors.length, 0);
  assert.equal(completed.length, 0);
  audio.resume();
  assert.equal(audio.state, 'pending');
  assert.equal(synth.utterances[1].text, 'First');
  first.onend();
  assert.equal(audio.index, 0);
  synth.utterances[1].onstart(); synth.utterances[1].onend();
  assert.equal(synth.utterances[2].text, 'Second');
});

test('pausing pending speech prevents a false error and permits a clean restart', () => {
  const { audio, synth, clock, errors } = setup();
  audio.start([say()]);
  const pending = synth.utterances[0];
  audio.pause(); clock.tick(11000);
  pending.onstart(); pending.onend(); pending.onerror();
  assert.equal(audio.state, 'paused');
  assert.equal(errors.length, 0);
  audio.resume();
  assert.equal(audio.state, 'pending');
  assert.equal(synth.utterances.length, 2);
  synth.utterances[1].onstart();
  assert.equal(audio.state, 'speaking');
});

test('gap pause preserves remaining time across multiple long pauses', () => {
  const { audio, synth, clock } = setup();
  audio.start([gap(6500), say('Model')]);
  clock.tick(2000); audio.pause();
  assert.equal(audio.remaining, 4500);
  clock.tick(20000); audio.resume();
  assert.equal(audio.state, 'gap');
  clock.tick(1000); audio.pause();
  assert.equal(audio.remaining, 3500);
  clock.tick(10000); audio.resume();
  clock.tick(3499);
  assert.equal(synth.utterances.length, 0);
  clock.tick(1);
  assert.equal(synth.utterances.length, 1);
  assert.equal(synth.utterances[0].text, 'Model');
});

test('stop prevents cancelled speech callbacks and timers from updating the screen', () => {
  const { audio, synth, clock, changes, completed, errors } = setup();
  audio.start([say(), gap()]);
  const old = synth.utterances[0]; old.onstart();
  audio.stop();
  const count = changes.length;
  old.onend(); old.onerror(); old.onstart(); clock.tick(90000);
  assert.equal(audio.state, 'idle');
  assert.equal(changes.length, count);
  assert.equal(completed.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(clock.tasks.size, 0);
});

test('new navigation or repeated start supersedes all prior utterance callbacks', () => {
  const { audio, synth, completed, errors } = setup();
  audio.start([say('Old route')]);
  const old = synth.utterances[0]; old.onstart();
  audio.start([say('New route')], { rate: 0.8 });
  const current = synth.utterances[1];
  old.onend(); old.onerror(); old.onstart();
  assert.equal(audio.state, 'pending');
  assert.equal(audio.index, 0);
  assert.equal(current.text, 'New route');
  assert.equal(current.rate, 0.8);
  assert.equal(errors.length, 0);
  assert.equal(completed.length, 0);
  current.onstart(); current.onend();
  audio.start([say('New route')]);
  current.onend(); current.onerror();
  assert.equal(audio.state, 'pending');
  assert.equal(completed.length, 1);
  synth.utterances[2].onstart(); synth.utterances[2].onend();
  assert.equal(completed.length, 2);
});

test('new start discards a paused gap remainder', () => {
  const { audio, clock } = setup();
  audio.start([gap(6500)]); clock.tick(2500); audio.pause();
  audio.start([gap(2000)]);
  clock.tick(1999); assert.equal(audio.state, 'gap');
  clock.tick(1); assert.equal(audio.state, 'done');
});

test('missing onstart errors after ten seconds and ignores subsequent events', () => {
  const { audio, synth, clock, errors, completed } = setup();
  audio.start([say()]); const old = synth.utterances[0];
  clock.tick(10000);
  assert.equal(audio.state, 'error');
  assert.match(errors[0], /始まりません/);
  old.onstart(); old.onend(); old.onerror();
  assert.equal(audio.state, 'error');
  assert.equal(errors.length, 1);
  assert.equal(completed.length, 0);
  assert.equal(clock.tasks.size, 0);
});

test('missing onend has a bounded watchdog and never marks the session complete', () => {
  const { audio, synth, clock, errors, completed } = setup();
  audio.start([say()]); synth.utterances[0].onstart();
  clock.tick(29999); assert.equal(audio.state, 'speaking');
  clock.tick(1);
  assert.equal(audio.state, 'error');
  assert.match(errors[0], /途中/);
  synth.utterances[0].onend();
  assert.equal(completed.length, 0);
});

test('browser errors and synchronous speak exceptions produce a recoverable error', () => {
  for (const throwOnSpeak of [false, true]) {
    const { audio, synth, clock, errors, completed } = setup({ throwOnSpeak });
    audio.start([say()]);
    if (!throwOnSpeak) synth.utterances[0].onerror({ error: 'audio-busy' });
    assert.equal(audio.state, 'error');
    assert.equal(errors.length, 1);
    assert.equal(completed.length, 0);
    assert.equal(clock.tasks.size, 0);
  }
});

test('unsupported speech is explicit and does not pretend the audio completed', () => {
  const { audio, errors, completed } = setup({ unsupported: true });
  audio.start([say()]);
  assert.equal(audio.supported, false);
  assert.equal(audio.state, 'error');
  assert.equal(errors.length, 1);
  assert.equal(completed.length, 0);
});

test('English local voice is preferred, with English or browser default fallback', () => {
  const remote = { lang: 'en-US', localService: false };
  const japanese = { lang: 'ja-JP', localService: true };
  const local = { lang: 'en-GB', localService: true };
  for (const [voices, expected] of [[[remote, japanese, local], local], [[japanese, remote], remote], [[japanese], null]]) {
    const { audio, synth } = setup({ voices }); audio.start([say()], { rate: 0.85 });
    assert.equal(synth.utterances[0].voice, expected);
    assert.equal(synth.utterances[0].lang, 'en-US');
    assert.equal(synth.utterances[0].rate, 0.85);
  }
});

test('resume and pause are harmless outside an active or paused session', () => {
  const { audio, synth, changes } = setup();
  audio.resume(); audio.pause();
  assert.equal(audio.state, 'idle');
  assert.equal(synth.utterances.length, 0);
  assert.equal(changes.length, 0);
});

test('empty sequences finish without speech or dangling timers', () => {
  const { audio, synth, completed, clock } = setup();
  audio.start([]);
  assert.equal(audio.state, 'done');
  assert.equal(completed.length, 1);
  assert.equal(synth.utterances.length, 0);
  assert.equal(clock.tasks.size, 0);
});

test('listening sequence preserves line IDs and has gaps only between lines', () => {
  const lesson = { lines: [{ en: 'One' }, { en: 'Two' }] };
  assert.deepEqual(listeningItems(lesson), [
    { type: 'say', text: 'One', line: 0 }, { type: 'gap', ms: 450, line: 0 }, { type: 'say', text: 'Two', line: 1 },
  ]);
  assert.deepEqual(listeningItems({ lines: [] }), []);
});

test('practice sequence includes a real answer window, model answer, and repeat window per round', () => {
  const lesson = { practice: [{ prompt: 'Ask?', answer: 'Answer.' }, { prompt: 'Again?', answer: 'Again.' }] };
  const items = practiceItems(lesson);
  assert.equal(items.length, 8);
  assert.deepEqual(items.slice(0, 4), [
    { type: 'say', text: 'Ask?', round: 0, phase: 'prompt' },
    { type: 'gap', ms: 6500, round: 0, phase: 'answer' },
    { type: 'say', text: 'Answer.', round: 0, phase: 'model' },
    { type: 'gap', ms: 3500, round: 0, phase: 'repeat' },
  ]);
  assert.ok(items.slice(4).every(item => item.round === 1));
});
