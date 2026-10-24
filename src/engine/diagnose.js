import { alignedUser, compareMasks } from './compare.js';
import { strokeJitter } from './stroke.js';

export function inkCount(m) {
  let n = 0;
  for (const p of m.px) if (p) n++;
  return n;
}

export function diagnose(tpl, user, strokes, alignMode) {
  const u = alignedUser(tpl, user, alignMode);
  const metrics = compareMasks(tpl, u);
  metrics.jitter = strokeJitter(strokes);
  return { metrics, commentsJa: commentsFor(metrics, inkCount(user) === 0) };
}

const f0 = (v) => v.toFixed(0);

export function commentsFor(m, emptyUser) {
  const c = [];
  if (emptyUser) {
    c.push('まだ線がありません。お手本を見ながら、ゆっくり一画を置いてみましょう。');
    return c;
  }

  const mag = Math.hypot(m.dx, m.dy);
  if (mag > 18) {
    let dir;
    if (Math.abs(m.dx) >= Math.abs(m.dy)) dir = m.dx > 0 ? '右' : '左';
    else dir = m.dy > 0 ? '下' : '上';
    c.push(`位置が${dir}に寄っています（重心が約 ${f0(mag)} px）。見た目の位置を先に合わせましょう。`);
  } else c.push('位置（重心）はおおむね合っています。');

  if (m.scaleRatio < 0.82) c.push('全体が小さめです。お手本の外枠まで到達するつもりで大きく取りましょう。');
  else if (m.scaleRatio > 1.22) c.push('全体が大きめです。端まではみ出さないよう、先に大きさを目測してから描きましょう。');
  else c.push('大きさは近いです。');

  if (m.aspectRatio > 1.18) c.push('横に長いです。縦方向の比率を意識してください。');
  else if (m.aspectRatio < 0.85) c.push('縦に長いです。横幅が足りていません。');

  let ang = m.angleDeg;
  while (ang > 90) ang -= 180;
  while (ang < -90) ang += 180;
  if (Math.abs(ang) > 8) c.push(`傾きがあります（約 ${f0(ang)}°）。水平・垂直の基準を先に目で取りましょう。`);

  const holes = [];
  if (m.coverTL < 0.45) holes.push('左上');
  if (m.coverTR < 0.45) holes.push('右上');
  if (m.coverBL < 0.45) holes.push('左下');
  if (m.coverBR < 0.45) holes.push('右下');
  if (holes.length) c.push(`お手本の ${holes.join('・')} が抜けています。描き切る前に四隅を確認。`);
  else if (m.missRate > 0.35) c.push('線は置いていますが、お手本の線上を外れている箇所が多いです。');

  if (m.extraRate > 0.4) c.push('はみ出しが多いです。角ではスピードを落とし、オーバーシュートを止めましょう。');

  if (m.jitter > 2.4) c.push('線が揺れています。肩と肘を固定し、ストロークを短く区切ると安定します。');
  else if (m.jitter < 0.8 && m.iou > 0.2) c.push('線の安定は良好です。');

  if (m.iou > 0.55) c.push('重なりは良好です。次は位置合わせなしでも同じ重なりを目指しましょう。');
  else if (m.iou > 0.25) c.push('形の方向は出ています。重ね表示で青いお手本からずれた赤い部分だけ直してください。');
  else c.push('まずは位置と大きさだけ合わせ、細部は二周目で追い込みましょう。点数よりクセの修正が目的です。');

  return c;
}
