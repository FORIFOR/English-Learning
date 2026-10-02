export const STORAGE_KEY = 'tone.progress.v1';
const DAY = 86400000;
const intervals = [1, 3, 7, 14, 30];

export function sanitizeProgress(value, knownIds) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const id of knownIds) {
    const record = value[id];
    if (!record || !Number.isFinite(record.due) || !Number.isFinite(record.updated) || !Number.isInteger(record.level) || record.level < 0 || record.level > 4) continue;
    result[id] = { due: record.due, updated: record.updated, level: record.level, count: Math.max(1, Math.min(9999, Math.floor(Number(record.count) || 1))) };
  }
  return result;
}

export function loadProgress(storage, knownIds) {
  try { return { records: sanitizeProgress(JSON.parse(storage.getItem(STORAGE_KEY) || '{}'), knownIds), available: true }; }
  catch { return { records: {}, available: false }; }
}

export function scheduleReview(previous, remembered, now = Date.now()) {
  // A remembered first lesson starts at the three-day level, so its next
  // successful review advances to seven days rather than repeating three.
  const level = remembered ? Math.min((previous?.level ?? 0) + 1, 4) : 0;
  const days = intervals[level];
  return { due: now + days * DAY, updated: now, level, count: (previous?.count || 0) + 1 };
}

export function saveProgress(storage, records) {
  try {
    const serialized = JSON.stringify(records);
    storage.setItem(STORAGE_KEY, serialized);
    return storage.getItem(STORAGE_KEY) === serialized;
  } catch { return false; }
}

export function dueLessons(lessons, records, now = Date.now()) {
  return lessons.filter(lesson => records[lesson.id] && records[lesson.id].due <= now);
}

export function nextReviewLabel(record, now = Date.now()) {
  const days = Math.max(0, Math.ceil((record.due - now) / DAY));
  return days === 0 ? '今日' : days === 1 ? '明日' : `${days}日後`;
}
