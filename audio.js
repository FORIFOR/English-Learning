/** Speech sequence with generation tokens. Cancel/pause settles every stale callback. */
export class AudioSequence {
  constructor({ synth, Utterance, onChange = () => {}, onDone = () => {}, onError = () => {}, timer = globalThis, now = () => Date.now() }) {
    this.synth = synth; this.Utterance = Utterance; this.onChange = onChange; this.onDone = onDone; this.onError = onError;
    this.timer = timer; this.now = now; this.token = 0; this.items = []; this.index = 0; this.state = 'idle'; this.handle = null; this.remaining = 0;
  }
  get supported() { return !!(this.synth && this.Utterance); }
  emit(state, extra = {}) { this.state = state; this.onChange({ state, index: this.index, total: this.items.length, item: this.items[this.index], ...extra }); }
  clear() { if (this.handle !== null) this.timer.clearTimeout(this.handle); this.handle = null; }
  stop(silent = false) {
    this.token++; this.clear(); this.synth?.cancel(); this.remaining = 0;
    if (!silent) this.emit('idle'); else this.state = 'idle';
  }
  start(items, { rate = 1 } = {}) {
    this.stop(true); this.items = items; this.index = 0; this.rate = rate;
    if (!this.supported) { this.fail('このブラウザは読み上げに対応していません。英文を見ながら練習できます。'); return; }
    if (!items.length) { this.emit('done'); this.onDone(); return; }
    this.run();
  }
  run() {
    // Each step owns its callbacks. Finishing a step retires its utterance,
    // including delayed or duplicate browser events arriving in the next step.
    const token = ++this.token;
    const item = this.items[this.index];
    if (!item) { this.clear(); this.emit('done'); this.onDone(); return; }
    if (item.type === 'gap') {
      const delay = this.remaining || item.ms; this.remaining = 0; this.deadline = this.now() + delay;
      this.emit('gap', { duration: delay });
      this.handle = this.timer.setTimeout(() => { if (token !== this.token) return; this.handle = null; this.index++; this.run(); }, delay);
      return;
    }
    const utterance = new this.Utterance(item.text);
    utterance.lang = 'en-US'; utterance.rate = this.rate;
    const voices = this.synth.getVoices?.() || [];
    const english = voices.filter(v => /^en(?:-|_)/i.test(v.lang));
    utterance.voice = english.find(v => v.localService) || english[0] || null;
    utterance.onstart = () => {
      if (token !== this.token) return;
      this.clear();
      this.emit('speaking');
      this.handle = this.timer.setTimeout(() => { if (token === this.token) this.fail('音声が途中で止まりました。「もう一度」で再開してください。'); }, Math.max(30000, item.text.length * 180));
    };
    utterance.onend = () => { if (token !== this.token) return; this.clear(); this.index++; this.run(); };
    utterance.onerror = () => { if (token === this.token) this.fail('音声を再生できませんでした。端末の英語音声と音量を確認し、「もう一度」を押してください。'); };
    this.currentUtterance = utterance;
    this.emit('pending');
    this.handle = this.timer.setTimeout(() => { if (token === this.token) this.fail('音声が始まりませんでした。端末の英語音声を確認してください。英文でも学べます。'); }, 10000);
    try { this.synth.speak(utterance); } catch { this.fail('この環境では音声を再生できません。英文を見ながら学べます。'); }
  }
  pause() {
    if (!['speaking', 'gap', 'pending'].includes(this.state)) return;
    const wasGap = this.state === 'gap';
    this.remaining = wasGap ? Math.max(1, this.deadline - this.now()) : 0;
    this.token++; this.clear(); this.synth.cancel(); this.emit('paused');
  }
  resume() { if (this.state !== 'paused') return; this.token++; this.run(); }
  fail(message) { this.stop(true); this.emit('error'); this.onError(message); }
}

export function listeningItems(lesson) {
  return lesson.lines.flatMap((line, index) => [{ type: 'say', text: line.en, line: index }, ...(index < lesson.lines.length - 1 ? [{ type: 'gap', ms: 450, line: index }] : [])]);
}

export function practiceItems(lesson) {
  return lesson.practice.flatMap((round, index) => [
    { type: 'say', text: round.prompt, round: index, phase: 'prompt' },
    { type: 'gap', ms: 6500, round: index, phase: 'answer' },
    { type: 'say', text: round.answer, round: index, phase: 'model' },
    { type: 'gap', ms: 3500, round: index, phase: 'repeat' },
  ]);
}
