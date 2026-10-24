import { SavedMetricKeys, createMetrics } from './types.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** UTC timestamp, same layout as the D version: 2026-01-02T030405Z */
export function nowIso(date = new Date()) {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function serializeRecord(rec) {
  const metrics = {};
  for (const k of SavedMetricKeys) metrics[k] = rec.metrics[k] ?? 0;
  return JSON.stringify({
    isoTime: rec.isoTime,
    templateId: rec.templateId,
    alignMode: rec.alignMode,
    commentsJa: rec.commentsJa ?? [],
    metrics,
  }, null, 2);
}

/** Throws on malformed JSON or a record missing the required fields. */
export function parseRecord(text) {
  const j = JSON.parse(text);
  for (const k of ['isoTime', 'templateId', 'alignMode']) {
    if (typeof j[k] !== 'string') throw new Error(`missing ${k}`);
  }
  if (typeof j.metrics !== 'object' || j.metrics === null) throw new Error('missing metrics');
  const metrics = createMetrics();
  for (const k of SavedMetricKeys) metrics[k] = Number.isFinite(j.metrics[k]) ? j.metrics[k] : 0;
  return {
    isoTime: j.isoTime,
    templateId: j.templateId,
    alignMode: j.alignMode,
    commentsJa: Array.isArray(j.commentsJa) ? j.commentsJa.filter((c) => typeof c === 'string') : [],
    metrics,
  };
}

export function trendFor(recs, templateId) {
  const hit = recs.filter((r) => r.templateId === templateId);
  const t = {
    n: hit.length, meanIou: 0, meanDx: 0, meanDy: 0, meanScale: 1, meanJitter: 0, lastIou: 0, prevIou: 0, habitJa: '',
  };
  if (!t.n) {
    t.habitJa = 'この題材の記録はまだありません。';
    return t;
  }
  const mean = (k) => hit.reduce((acc, r) => acc + r.metrics[k], 0) / t.n;
  t.meanIou = mean('iou');
  t.meanDx = mean('dx');
  t.meanDy = mean('dy');
  t.meanScale = mean('scaleRatio');
  t.meanJitter = mean('jitter');
  t.lastIou = hit[t.n - 1].metrics.iou;
  if (t.n >= 2) t.prevIou = hit[t.n - 2].metrics.iou;

  const habits = [];
  if (Math.abs(t.meanDx) > 14 && Math.abs(t.meanDx) >= Math.abs(t.meanDy)) habits.push(t.meanDx > 0 ? '右に寄る' : '左に寄る');
  else if (Math.abs(t.meanDy) > 14) habits.push(t.meanDy > 0 ? '下に寄る' : '上に寄る');
  if (t.meanScale < 0.88) habits.push('小さめ');
  else if (t.meanScale > 1.14) habits.push('大きめ');
  if (t.meanJitter > 2.2) habits.push('線が揺れやすい');
  t.habitJa = habits.length ? `傾向: ${habits.join('・')}` : '目立ったクセの偏りはありません。';
  return t;
}

export function formatTrend(t, templateId) {
  if (t.n === 0) return t.habitJa;
  let delta = '';
  if (t.n >= 2) {
    const d = t.lastIou - t.prevIou;
    delta = `  前回比 IoU ${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
  }
  return `${templateId}  ${t.n}回  平均IoU ${t.meanIou.toFixed(2)}${delta}\n${t.habitJa}`;
}
