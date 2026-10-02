import { lessons } from './lessons.js';
import { AudioSequence, listeningItems, practiceItems } from './audio.js';
import { loadProgress, saveProgress, scheduleReview, dueLessons, nextReviewLabel } from './progress.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${name === 'play' ? '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>' : name === 'pause' ? '<path d="M8 5v14M16 5v14" stroke-width="4"/>' : name === 'repeat' ? '<path d="M19 7a8 8 0 1 0 1 8M19 2v6h-6"/>' : '<path d="m5 12 4 4L19 6"/>'}</svg>`;
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const loaded = loadProgress(storage, lessons.map(lesson => lesson.id));
let records = loaded.records;
let state = { lesson: lessons[0], mode:'listen', phase:'intro', rate:1, filter:'all', answer:null, transferAnswer:null, audioError:'', heard:false, saved:false, reviewSaved:false, segment:null };
let audioPurpose = null;
let transition = null;
let surfaceVersion = 0;
const audio = new AudioSequence({
  synth: window.speechSynthesis,
  Utterance: window.SpeechSynthesisUtterance,
  onChange: updateAudio,
  onDone: () => {
    if (audioPurpose === 'listen' && state.phase === 'listen') { state.heard = true; setPhase('question'); }
    else if (audioPurpose === 'practice' && state.phase === 'practice') { setPhase('practice-done'); }
    else if (audioPurpose === 'segment') { state.segment = null; updateSegmentControls(); }
  },
  onError: message => {
    state.audioError = message;
    if (audioPurpose === 'segment') { state.segment = null; updateSegmentControls(); }
    else renderContent();
    announce(message);
  },
});

function announce(text) { $('#live-status').textContent = text; }
function cancelAudio() { audioPurpose = null; audio.stop(true); state.segment = null; }
function changeSurface(update) {
  const version = ++surfaceVersion;
  transition?.skipTransition?.();
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const current = document.startViewTransition(() => { if (version === surfaceVersion) update(); });
    transition = current;
    current.finished.catch(() => {}).finally(() => { if (transition === current) transition = null; });
  } else update();
}
function setPhase(phase) {
  cancelAudio();
  state.phase = phase; state.audioError = '';
  if (['question','transcript','transfer','complete'].includes(phase)) state.mode = 'listen';
  changeSurface(() => { renderHeader(); renderContent(); });
  const titles = { intro:'レッスンを選びました', question:'聞いた内容を確かめましょう', transcript:'英文と音のつながりを確認しましょう', transfer:'違う場面でも使ってみましょう', complete:'レッスンを学び終えました。復習の間隔を選んでください', 'practice-done':'3つの練習が終わりました。復習の間隔を選んでください' };
  if (titles[phase]) announce(titles[phase]);
}
function selectLesson(id, mode = state.mode, updateHash = true) {
  const lesson = lessons.find(item => item.id === id) || lessons[0];
  cancelAudio();
  state = { ...state, lesson, mode, phase:'intro', answer:null, transferAnswer:null, audioError:'', heard:false, saved:false, reviewSaved:false };
  if (updateHash) {
    const hash = `#${lesson.id}/${mode}`;
    if (location.hash !== hash) location.hash = hash;
  }
  changeSurface(() => { renderHeader(); renderContent(); renderLibrary(); renderModes(); });
}
function readRoute() {
  const [id, mode] = location.hash.slice(1).split('/');
  selectLesson(id, mode === 'speak' ? 'speak' : 'listen', false);
}
window.addEventListener('hashchange', () => {
  const [id, rawMode] = location.hash.slice(1).split('/');
  const lesson = lessons.find(item => item.id === id) || lessons[0];
  const mode = rawMode === 'speak' ? 'speak' : 'listen';
  if (lesson.id === state.lesson.id && mode === state.mode) return;
  readRoute();
});
window.addEventListener('pagehide', cancelAudio);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['speaking','gap','pending'].includes(audio.state)) {
    audio.pause();
    announce('画面が非表示になったため、一時停止しました。戻ったら再開してください');
  }
});

function renderModes() {
  document.querySelectorAll('[data-mode]').forEach(button => {
    const selected = button.dataset.mode === state.mode;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
  });
  $('#duration-label').textContent = `約 ${state.mode === 'speak' ? 2 : state.lesson.minutes} 分`;
}
function renderLibrary() {
  const due = dueLessons(lessons, records);
  const visible = state.filter === 'review' ? due : lessons;
  $('#due-count').textContent = due.length;
  $('#completed-count').textContent = Object.keys(records).length;
  $('#lesson-total').textContent = visible.length;
  document.querySelectorAll('[data-filter]').forEach(button => {
    const selected = button.dataset.filter === state.filter;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected);
  });
  $('#lesson-list').innerHTML = visible.length ? visible.map(lesson => {
    const index = lessons.indexOf(lesson), record = records[lesson.id];
    return `<button class="lesson-row ${lesson.id === state.lesson.id ? 'selected' : ''}" data-lesson="${lesson.id}" aria-pressed="${lesson.id === state.lesson.id}"><span class="lesson-number">${String(index + 1).padStart(2,'0')}</span><span class="row-body"><span class="row-title">${escape(lesson.title)}</span><span class="row-meta">${lesson.level} · ${lesson.category === 'STORY' ? 'MINI STORY' : 'EXPLAINER'} · ${lesson.minutes} MIN${record ? ` · 復習 ${nextReviewLabel(record)}` : ''}</span></span>${record ? '<span class="lesson-check" aria-label="学習済み">✓</span>' : ''}</button>`;
  }).join('') : '<p class="empty-state">今日の復習はまだありません。<br>学び終えたら、次の復習日をここに記録します。</p>';
}
function renderHeader() {
  const lesson = state.lesson;
  $('#lesson-category').textContent = lesson.category === 'STORY' ? 'ORIGINAL MINI STORY' : 'EVERYDAY EXPLAINER';
  $('#lesson-level').textContent = `${lesson.level} · ${lesson.level === 'B1' ? '中級' : '初級'}`;
  $('#lesson-title').textContent = lesson.title;
  $('#lesson-subtitle').textContent = lesson.subtitle;
  $('#learning-surface').dataset.phase = state.phase;
  const stages = state.mode === 'speak' ? ['intro','practice','practice-done'] : ['intro','listen','question','transcript','transfer','complete'];
  const current = Math.max(0, stages.indexOf(state.phase));
  $('#journey').innerHTML = stages.map((stage, index) => `<span class="journey-step ${index === current ? 'current' : index < current ? 'past' : ''}" aria-hidden="true"></span>`).join('');
  $('#journey').setAttribute('aria-label', `${stages.length}ステップ中 ${current + 1}`);
  const labels = { intro:'READY WHEN YOU ARE', listen:'LISTEN FIRST', question:'FIND THE MEANING', transcript:'NOTICE THE SOUND', transfer:'MAKE IT YOURS', complete:'A LITTLE MORE YOURS', practice:'YOUR TURN TO SPEAK', 'practice-done':'PRACTICE, NOT PERFECTION' };
  $('#surface-state').textContent = labels[state.phase];
  $('#restart').hidden = state.phase === 'intro';
  renderModes();
}
function errorMarkup() { return state.audioError ? `<p class="audio-error" role="alert">${escape(state.audioError)}</p>` : ''; }
function introMarkup() {
  const review = records[state.lesson.id];
  return `${review ? `<div class="review-banner">前回の続きを。次の復習は${nextReviewLabel(review)}です。</div>` : ''}<p class="scene">${escape(state.lesson.scene)}</p><div class="learning-goal"><small>TODAY’S PHRASE</small><p>${escape(state.lesson.outcome)}</p></div>${state.mode === 'listen' ? `<button class="primary" data-action="start-listen">${icon('play')}字幕なしで聴く</button><p class="help-text">まずは音だけで。聴いたあとに、意味・英文・音のつながりを確かめます。</p>${!audio.supported ? '<p class="audio-error">このブラウザは読み上げに対応していません。英文から始められます。</p>' : ''}<button class="text-button" data-action="transcript">音声なしで英文から学ぶ</button>` : `<button class="primary" data-action="start-practice">${icon('play')}3つの問いで、声に出す</button><p class="help-text">英語の問い → 6.5秒で答える → お手本 → 3.5秒でまねする。開始後は自動で進みます。</p><p class="help-text">画面を開いたまま使ってください。離れると一時停止します。声は録音されません。</p>`}`;
}
function listenMarkup() {
  return `${errorMarkup()}<p class="phase-label">01 / LISTEN</p><div class="audio-stage"><div class="audio-number"><span id="line-number">0</span><small> / ${state.lesson.lines.length}</small></div><p id="audio-status">音声を準備しています</p></div><div class="audio-track" role="progressbar" aria-label="再生した文" aria-valuemin="0" aria-valuemax="${state.lesson.lines.length}" aria-valuenow="0" id="audio-progress"><div class="audio-track-fill" id="audio-fill"></div></div><div class="button-row"><button class="primary" data-action="toggle-audio" id="toggle-audio">${icon('pause')}一時停止</button><button class="secondary" data-action="start-listen">${icon('repeat')}もう一度</button></div><p class="help-text">一時停止からの再開は、その文の先頭から。字幕を見ずに、場面を思い浮かべて。</p><button class="text-button" data-action="question">${state.audioError ? '音声を使わず、' : '途中でも'}意味を確かめる</button> <button class="text-button" data-action="transcript">英文を見る</button>`;
}
function questionMarkup(transfer = false) {
  const question = transfer ? state.lesson.transfer : state.lesson.question;
  const answer = transfer ? state.transferAnswer : state.answer;
  return `<p class="phase-label">${transfer ? '04 / A NEW SITUATION' : '02 / WHAT HAPPENED?'}</p><h3 class="phase-heading">${escape(question.prompt)}</h3><div class="choices">${question.options.map((option, index) => `<button class="choice ${answer !== null ? index === question.correct ? 'correct' : answer === index ? 'incorrect' : '' : ''}" data-answer="${index}" ${answer !== null ? 'disabled' : ''}><span class="choice-letter">${String.fromCharCode(65 + index)}</span><span>${escape(option)}</span>${answer !== null && index === question.correct ? '<span aria-label="正解">✓</span>' : ''}</button>`).join('')}</div>${answer !== null ? `<div class="feedback ${answer === question.correct ? '' : 'feedback-error'}" role="status"><strong>${answer === question.correct ? transfer ? '別の場面でも使えました。' : '意味をつかめました。' : '答えを確認して、もう一歩。'}</strong>${escape(question.explanation)}</div><button class="primary return-button" data-action="${transfer ? 'complete' : 'transcript'}">${transfer ? '今日の学びを記録する' : '英文と音のつながりへ'}</button>` : `${!transfer ? '<button class="text-button return-button" data-action="start-listen">もう一度、音だけで聴く</button>' : ''}`}`;
}
function transcriptMarkup() {
  return `<p class="phase-label">03 / WORDS & SOUNDS</p><p class="help-text" style="margin:0 0 20px">読み上げ音声では、自然な会話の音の変化を完全には再現できません。下のポイントは実際の会話を聴くときの手がかりです。</p><div class="transcript">${state.lesson.lines.map((line, index) => `<div class="transcript-line"><div class="line-top"><span class="speaker">${escape(line.speaker)}</span><button class="replay" data-segment="${index}" aria-label="${index + 1}文目を再生">${icon('play')}この一文</button></div><p class="en-line" lang="en">${escape(line.en)}</p><p class="ja-line">${escape(line.ja)}</p><p class="sound-note"><span>LISTEN FOR</span>${escape(line.note)}</p></div>`).join('')}</div><p id="segment-status" class="voice-status" aria-live="polite"></p><button class="mini-button" data-action="stop-segment" id="stop-segment" hidden>音声を止める</button>${errorMarkup()}<button class="primary return-button" data-action="transfer">違う場面で使ってみる</button>`;
}
function practiceMarkup() {
  return `${errorMarkup()}<p class="round-counter" id="round-counter">ROUND 01 / 03</p><p class="practice-phase" id="practice-phase">問いの音声を準備しています</p><p class="practice-caption" id="practice-caption" lang="en">${escape(state.lesson.practice[0].prompt)}</p><p class="help-text" id="practice-ja">聞こえた問いに、英語で答えてみましょう。</p><div class="answer-ring" aria-hidden="true"><div class="answer-ring-fill" id="answer-fill"></div></div><div class="button-row"><button class="primary" data-action="toggle-audio" id="toggle-audio">${icon('pause')}一時停止</button><button class="secondary" data-action="start-practice">${icon('repeat')}やり直す</button></div><p class="help-text">答えは一例です。自分のことばでも大丈夫。声の録音・認識・採点はしていません。</p>${state.audioError ? '<button class="text-button" data-action="transcript">英文を見ながら練習する</button>' : ''}`;
}
function completionMarkup() {
  const practice = state.phase === 'practice-done';
  return `<div class="completion-mark" aria-hidden="true">✓</div><p class="phase-label">${practice ? 'THREE LITTLE CONVERSATIONS' : 'ONE LESSON, A LITTLE CLOSER'}</p><h3 class="phase-heading">${practice ? '声にすると、少し自分のもの。' : '今日のひと言を、毎日の中へ。'}</h3><p class="completion-copy">${escape(state.lesson.outcome)}<br>${practice ? '発音の評価ではありません。自分で言えた感覚を、次の練習につなげましょう。' : state.heard ? '聞いたことばを、違う場面でも確かめました。忘れる前に、もう一度。' : '英文の意味を、違う場面でも確かめました。音声を聴いた記録はありません。'}</p>${state.saved ? `<p class="save-confirmation" role="status">${state.reviewSaved ? 'このブラウザに保存しました。' : 'この画面には記録しましたが、端末に保存できませんでした。'}<br>次の復習：${nextReviewLabel(records[state.lesson.id])}</p><button class="primary" data-action="next-lesson">次のエピソードへ</button><button class="text-button return-button" data-action="switch-${practice ? 'listen' : 'speak'}">${practice ? '音と意味も確かめる' : 'この表現を声に出す'}</button>` : `<div class="review-choice"><p>次は、いつ思い出したい？</p><div class="button-row"><button class="secondary" data-review="again">明日もう一度</button><button class="primary" data-review="remembered">${records[state.lesson.id] ? '間隔を広げる' : '3日後に復習'}</button></div><p class="help-text">「間隔を広げる」は 3 → 7 → 14 → 30日。難しいときは、いつでも翌日に戻せます。</p></div>`}`;
}
function renderContent() {
  const markup = { intro:introMarkup, listen:listenMarkup, question:() => questionMarkup(false), transcript:transcriptMarkup, transfer:() => questionMarkup(true), complete:completionMarkup, practice:practiceMarkup, 'practice-done':completionMarkup };
  $('#lesson-content').innerHTML = markup[state.phase]();
  if (['listen','practice'].includes(state.phase)) updateAudio({ state:audio.state, index:audio.index, total:audio.items.length, item:audio.items[audio.index] });
}
function updateAudio(event) {
  const active = ['pending','speaking','gap'].includes(event.state);
  const toggle = $('#toggle-audio');
  if (toggle) {
    toggle.innerHTML = `${icon(event.state === 'paused' || event.state === 'error' ? 'play' : 'pause')}${event.state === 'paused' ? '再開する' : event.state === 'error' ? 'もう一度' : '一時停止'}`;
    toggle.disabled = !active && !['paused','error'].includes(event.state);
  }
  if (audioPurpose === 'segment') { updateSegmentControls(); return; }
  if (state.phase === 'listen') {
    const line = event.item?.line ?? 0;
    if ($('#line-number')) $('#line-number').textContent = event.state === 'pending' && event.index === 0 ? '0' : String(line + 1);
    if ($('#audio-status')) $('#audio-status').textContent = { pending:'音声を準備しています', speaking:'英語だけに、耳を澄ませて。', gap:'次のひと言へ。', paused:'一時停止中。あなたのペースで。', error:'音声を再生できませんでした', idle:'再生を開始します' }[event.state] || '聴き終わりました';
    const completed = event.state === 'gap' ? line + 1 : line;
    if ($('#audio-fill')) $('#audio-fill').style.width = `${completed / state.lesson.lines.length * 100}%`;
    $('#audio-progress')?.setAttribute('aria-valuenow', completed);
  }
  if (state.phase === 'practice' && audioPurpose === 'practice' && Number.isInteger(event.item?.round) && state.lesson.practice[event.item.round]) {
    const round = state.lesson.practice[event.item.round];
    $('#round-counter').textContent = `ROUND ${String(event.item.round + 1).padStart(2,'0')} / 03`;
    const phaseText = { prompt:'問いを聴く', answer:'あなたの番。英語で答えてみよう', model:'お手本を聴く', repeat:'続けて、自分でもう一度' };
    $('#practice-phase').textContent = event.state === 'paused' ? '一時停止中。再開は、今の文の先頭から。' : event.state === 'pending' ? '音声を準備しています' : phaseText[event.item.phase];
    $('#practice-caption').textContent = ['model','repeat'].includes(event.item.phase) ? round.answer : round.prompt;
    $('#practice-ja').textContent = ['model','repeat'].includes(event.item.phase) ? round.ja : event.item.phase === 'answer' ? '6.5秒の応答時間です。声は録音されません。' : '聞こえた問いに、英語で答えてみましょう。';
    const fill = $('#answer-fill');
    fill.classList.remove('countdown');
    if (event.state === 'gap') { fill.style.setProperty('--gap-duration', `${event.duration || event.item.ms}ms`); void fill.offsetWidth; fill.classList.add('countdown'); }
  }
  if (event.state === 'paused') announce('一時停止しました');
}
function updateSegmentControls() {
  const status = $('#segment-status'), stop = $('#stop-segment');
  if (!status) return;
  status.textContent = state.audioError || (state.segment === null ? '' : `${state.segment + 1}文目：${audio.state === 'pending' ? '音声を準備中' : '読み上げ中'}`);
  stop.hidden = state.segment === null;
  document.querySelectorAll('[data-segment]').forEach(button => {
    const playing = Number(button.dataset.segment) === state.segment;
    button.innerHTML = `${icon(playing ? 'pause' : 'play')}${playing ? '停止' : 'この一文'}`;
    button.setAttribute('aria-label', `${Number(button.dataset.segment) + 1}文目を${playing ? '停止' : '再生'}`);
  });
}
function startAudio(purpose) {
  ++surfaceVersion; transition?.skipTransition?.();
  cancelAudio(); state.audioError = ''; state.mode = purpose === 'listen' ? 'listen' : 'speak'; state.phase = purpose === 'listen' ? 'listen' : 'practice';
  renderHeader(); renderContent();
  audioPurpose = purpose;
  audio.start(purpose === 'listen' ? listeningItems(state.lesson) : practiceItems(state.lesson), { rate:state.rate });
}
function handleAction(action) {
  if (action === 'start-listen') return startAudio('listen');
  if (action === 'start-practice') return startAudio('practice');
  if (action === 'toggle-audio') {
    if (audio.state === 'paused') audio.resume();
    else if (audio.state === 'error') startAudio(state.phase === 'practice' ? 'practice' : 'listen');
    else audio.pause();
    return;
  }
  if (action === 'stop-segment') { cancelAudio(); updateSegmentControls(); return; }
  if (action === 'next-lesson') {
    const next = lessons[(lessons.indexOf(state.lesson) + 1) % lessons.length];
    selectLesson(next.id); $('#workspace').scrollIntoView({ block:'start', behavior:'instant' }); return;
  }
  if (action.startsWith('switch-')) { selectLesson(state.lesson.id, action.slice(7)); return; }
  if (['question','transcript','transfer','complete'].includes(action)) {
    if (action === 'complete' && state.transferAnswer === null) return;
    setPhase(action);
  }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.lesson) {
    selectLesson(button.dataset.lesson);
    if (window.matchMedia('(max-width:720px)').matches) $('.lesson-disclosure').open = false;
  } else if (button.dataset.mode) selectLesson(state.lesson.id, button.dataset.mode);
  else if (button.dataset.filter) { state.filter = button.dataset.filter; renderLibrary(); $('.lesson-disclosure').open = true; }
  else if (button.dataset.action) handleAction(button.dataset.action);
  else if (button.dataset.answer !== undefined) {
    if (state.phase === 'transfer') { if (state.transferAnswer !== null) return; state.transferAnswer = Number(button.dataset.answer); }
    else if (state.phase === 'question') { if (state.answer !== null) return; state.answer = Number(button.dataset.answer); }
    else return;
    renderContent();
    $('.return-button')?.focus({ preventScroll:true });
  } else if (button.dataset.segment !== undefined && state.phase === 'transcript') {
    const index = Number(button.dataset.segment);
    if (state.segment === index) { cancelAudio(); updateSegmentControls(); return; }
    cancelAudio(); state.audioError = ''; state.segment = index; audioPurpose = 'segment';
    audio.start([{ type:'say', text:state.lesson.lines[index].en }], { rate:state.rate });
  } else if (button.dataset.review && !state.saved && ['complete','practice-done'].includes(state.phase)) {
    records[state.lesson.id] = scheduleReview(records[state.lesson.id], button.dataset.review === 'remembered');
    state.reviewSaved = saveProgress(storage, records); state.saved = true;
    $('#storage-warning').hidden = state.reviewSaved;
    renderContent(); renderLibrary();
  }
});
$('#restart').addEventListener('click', () => selectLesson(state.lesson.id));
$('#speed').addEventListener('change', event => {
  state.rate = Number(event.target.value);
  if (['speaking','pending','gap','paused'].includes(audio.state)) {
    if (audioPurpose === 'segment') { cancelAudio(); updateSegmentControls(); announce('速度を変えました。もう一度この文を再生してください'); }
    else { audio.pause(); audio.rate = state.rate; announce('速度を変えて一時停止しました。再開すると新しい速度になります'); }
  }
});
$('#storage-warning').hidden = loaded.available;
if (window.matchMedia('(max-width:720px)').matches) $('.lesson-disclosure').open = false;
readRoute();
