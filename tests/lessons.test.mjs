import test from 'node:test';
import assert from 'node:assert/strict';
import { lessons } from '../lessons.js';
import { listeningItems, practiceItems } from '../audio.js';

function nonempty(value, label) { assert.equal(typeof value, 'string', label); assert.ok(value.trim().length > 0, label); }
function questionSchema(question, label) {
  assert.ok(question && typeof question === 'object', label);
  nonempty(question.prompt, `${label} prompt`);
  nonempty(question.explanation, `${label} explanation`);
  assert.ok(Array.isArray(question.options) && question.options.length >= 2, `${label} options`);
  for (const option of question.options) nonempty(option, `${label} option`);
  assert.equal(new Set(question.options).size, question.options.length, `${label} unique options`);
  assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < question.options.length, `${label} answer index`);
}

test('lesson catalog has unique stable IDs and both story and explainer categories', () => {
  assert.ok(Array.isArray(lessons) && lessons.length >= 8);
  assert.equal(new Set(lessons.map(x => x.id)).size, lessons.length);
  assert.deepEqual([...new Set(lessons.map(x => x.category))].sort(), ['EXPLAINER', 'STORY']);
  for (const lesson of lessons) assert.match(lesson.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

for (const lesson of lessons) {
  test(`${lesson.id}: complete lesson schema and deterministic audio content`, () => {
    for (const key of ['title', 'subtitle', 'scene', 'outcome']) nonempty(lesson[key], key);
    assert.ok(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(lesson.level));
    assert.ok(['STORY', 'EXPLAINER'].includes(lesson.category));
    assert.ok(Number.isFinite(lesson.minutes) && lesson.minutes > 0 && lesson.minutes <= 15);
    assert.match(lesson.color, /^#[0-9a-f]{6}$/i);
    assert.ok(Array.isArray(lesson.lines) && lesson.lines.length >= 3);
    for (const line of lesson.lines) for (const key of ['speaker', 'en', 'ja', 'note']) nonempty(line[key], `${lesson.id} line ${key}`);
    questionSchema(lesson.question, `${lesson.id} listening question`);
    questionSchema(lesson.transfer, `${lesson.id} transfer question`);
    assert.ok(Array.isArray(lesson.practice) && lesson.practice.length >= 3);
    for (const round of lesson.practice) for (const key of ['prompt', 'answer', 'ja']) nonempty(round[key], `${lesson.id} practice ${key}`);
    const listening = listeningItems(lesson), practice = practiceItems(lesson);
    assert.equal(listening.length, lesson.lines.length * 2 - 1);
    assert.equal(listening.at(-1).type, 'say');
    assert.deepEqual(listening.filter(x => x.type === 'say').map(x => x.text), lesson.lines.map(x => x.en));
    assert.equal(practice.length, lesson.practice.length * 4);
    for (const item of [...listening, ...practice]) {
      if (item.type === 'say') nonempty(item.text, 'spoken text');
      else assert.ok(item.type === 'gap' && Number.isFinite(item.ms) && item.ms > 0);
    }
  });
}
