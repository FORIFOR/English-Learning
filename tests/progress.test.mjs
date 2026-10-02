import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, sanitizeProgress, loadProgress, scheduleReview, saveProgress, dueLessons, nextReviewLabel } from '../progress.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 2, 12);
const ids = ['first', 'second'];
const valid = { due: NOW + DAY, updated: NOW, level: 0, count: 1 };
const memoryStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

test('empty local storage loads with an available, empty progress record', () => {
  assert.deepEqual(loadProgress(memoryStorage(), ids), { records: {}, available: true });
});

test('corrupt JSON and unavailable local storage fail safely', () => {
  assert.deepEqual(loadProgress(memoryStorage({ [STORAGE_KEY]: '{ broken' }), ids), { records: {}, available: false });
  assert.deepEqual(loadProgress({ getItem() { throw new Error('SecurityError'); } }, ids), { records: {}, available: false });
  assert.deepEqual(loadProgress(null, ids), { records: {}, available: false });
});

test('invalid or unrelated records are removed and valid fields are whitelisted', () => {
  assert.deepEqual(sanitizeProgress({ first: { ...valid, extra: 'ignored' }, unknown: valid, second: { ...valid, due: 'tomorrow' } }, ids), { first: valid });
  for (const value of [null, undefined, [], 'anything', 12]) assert.deepEqual(sanitizeProgress(value, ids), {});
  for (const change of [{ due: Infinity }, { updated: NaN }, { level: -1 }, { level: 5 }, { level: 1.1 }, { level: '1' }]) {
    assert.deepEqual(sanitizeProgress({ first: { ...valid, ...change } }, ids), {});
  }
});

test('loaded review counts are normalized and bounded', () => {
  for (const [count, expected] of [[undefined, 1], [0, 1], [-4, 1], ['7', 7], [4.9, 4], [100000, 9999], ['bad', 1]]) {
    assert.equal(sanitizeProgress({ first: { ...valid, count } }, ids).first.count, expected);
  }
});

test('save verifies exact readback and correctly reloads records', () => {
  const storage = memoryStorage();
  assert.equal(saveProgress(storage, { first: valid }), true);
  assert.equal(storage.getItem(STORAGE_KEY), JSON.stringify({ first: valid }));
  assert.deepEqual(loadProgress(storage, ids), { records: { first: valid }, available: true });
});

test('silent writes, quota failures, and inaccessible readback are never reported as saved', () => {
  assert.equal(saveProgress({ setItem() {}, getItem() { return null; } }, { first: valid }), false);
  assert.equal(saveProgress({ setItem() {}, getItem() { return '{}'; } }, { first: valid }), false);
  assert.equal(saveProgress({ setItem() { throw new Error('QuotaExceededError'); } }, { first: valid }), false);
  assert.equal(saveProgress({ setItem() {}, getItem() { throw new Error('SecurityError'); } }, { first: valid }), false);
  assert.equal(saveProgress(null, { first: valid }), false);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(saveProgress(memoryStorage(), cyclic), false);
});

test('first uncertain review is due tomorrow; first remembered review starts at three days', () => {
  assert.deepEqual(scheduleReview(undefined, false, NOW), { due: NOW + DAY, updated: NOW, level: 0, count: 1 });
  assert.deepEqual(scheduleReview(undefined, true, NOW), { due: NOW + 3 * DAY, updated: NOW, level: 1, count: 1 });
});

test('successful reviews use 1/3/7/14/30-day levels and then cap at thirty days', () => {
  let record = scheduleReview(undefined, false, NOW);
  let now = NOW;
  for (const [days, level] of [[3, 1], [7, 2], [14, 3], [30, 4], [30, 4]]) {
    now = record.due;
    const previous = record;
    record = scheduleReview(previous, true, now);
    assert.equal(record.due - now, days * DAY);
    assert.equal(record.level, level);
    assert.equal(record.updated, now);
    assert.equal(record.count, previous.count + 1);
    assert.ok(record.due > previous.due, 'due times advance when reviews happen on their due date');
  }
});

test('a successful first review advances to seven days on the next success', () => {
  const first = scheduleReview(undefined, true, NOW);
  const next = scheduleReview(first, true, first.due);
  assert.equal(next.level, 2);
  assert.equal(next.due - first.due, 7 * DAY);
  assert.equal(next.count, 2);
});

test('uncertain recall resets to one day while preserving a monotonically increasing count', () => {
  const previous = { due: NOW, updated: NOW - 30 * DAY, level: 4, count: 12 };
  const result = scheduleReview(previous, false, NOW);
  assert.deepEqual(result, { due: NOW + DAY, updated: NOW, level: 0, count: 13 });
  assert.deepEqual(previous, { due: NOW, updated: NOW - 30 * DAY, level: 4, count: 12 }, 'input is not mutated');
});

test('due lesson selection includes exact deadlines and excludes unseen or future lessons', () => {
  const lessons = [{ id: 'first' }, { id: 'second' }, { id: 'third' }, { id: 'fourth' }];
  const records = { first: { ...valid, due: NOW }, second: { ...valid, due: NOW - DAY }, third: { ...valid, due: NOW + 1 } };
  assert.deepEqual(dueLessons(lessons, records, NOW), lessons.slice(0, 2));
});

test('review labels handle overdue, same-time, partial-day, tomorrow, and later deadlines', () => {
  for (const [offset, expected] of [[-DAY, '今日'], [0, '今日'], [1, '明日'], [DAY, '明日'], [DAY + 1, '2日後'], [30 * DAY, '30日後']]) {
    assert.equal(nextReviewLabel({ due: NOW + offset }, NOW), expected);
  }
});
