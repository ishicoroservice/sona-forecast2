#!/usr/bin/env node
// scripts/check-drift.js
// 「~25km型の乖離バグ」ガード（memory由来の定常点検）。
//   = コードの実態（実際に計算・保持している値）と、画面やコピペ文面に出る
//     固定記述（モデル数・距離・しきい値）の食い違いを検出する。
//
//   実行: node scripts/check-drift.js   /   npm run check:drift
//   ground-truth は jsdom で実走した実値（MODELS.length 等）を使う＝記述と実装を突き合わせる。
//
// 方針: 機械的に断定できるものだけ HARD（exit 1）。
//       人の目で見たほうがよいものは REVIEW（行番号付きで提示・非エラー）。

const fs = require('fs');
const path = require('path');
const { loadSona, INDEX_PATH } = require('../test/harness');

const html = fs.readFileSync(INDEX_PATH, 'utf8');
const lines = html.split('\n');
const { api } = loadSona();

let hard = 0;
const reviews = [];

function ok(label) {
  console.log('  \u2713 ' + label);
}
function bad(label) {
  hard++;
  console.log('  \u2717 ' + label);
}
function review(tag, msg, hits) {
  reviews.push({ tag, msg, hits: hits || [] });
}
// 行スキャン：正規表現にマッチする行を {n, text} で返す
function scan(re, filterFn) {
  const out = [];
  lines.forEach((t, i) => {
    if (re.test(t) && (!filterFn || filterFn(t))) out.push({ n: i + 1, text: t.trim() });
  });
  return out;
}

console.log('ドリフト点検 —', INDEX_PATH, '\n');

// ───────────────────────────── HARD: 実装値と一致するか ─────────────────────────────
console.log('[HARD] 実装の事実');
A: {
  // 1) モデル数
  api.MODELS && api.MODELS.length === 5
    ? ok('MODELS = 5モデル')
    : bad('MODELS が5でない → 実値=' + (api.MODELS && api.MODELS.length));
  api.CAPE_MODELS && api.CAPE_MODELS.length === 3
    ? ok('CAPE_MODELS = 3モデル')
    : bad('CAPE_MODELS が3でない → 実値=' + (api.CAPE_MODELS && api.CAPE_MODELS.length));

  // 2) しきい値の一元化（定数が生きているか）
  api.RH_GAS_FLOOR === 80 ? ok('RH_GAS_FLOOR = 80') : bad('RH_GAS_FLOOR が80でない');
  api.SNOW_FLOOR === 0.1 ? ok('SNOW_FLOOR = 0.1') : bad('SNOW_FLOOR が0.1でない');
  api.PRECIP_RATE_FLOOR === 0.1 ? ok('PRECIP_RATE_FLOOR = 0.1') : bad('PRECIP_RATE_FLOOR が0.1でない');

  // 3) 退役した固定距離「~25km」が復活していないか（実距離表示へ移行済み）
  const tilde25 = scan(/[~～]\s*25\s*km/i);
  tilde25.length === 0
    ? ok('固定「~25km」の記述なし（実距離表示が維持されている）')
    : bad('退役した「~25km」固定記述が復活: ' + tilde25.map((h) => 'L' + h.n).join(', '));

  // 4) MEIZAN 座標の健全性（重複・粗すぎる座標）
  const seen = new Map();
  let dup = 0;
  (api.MEIZAN || []).forEach((m) => {
    const key = m[1].toFixed(5) + ',' + m[2].toFixed(5);
    if (seen.has(key)) dup++;
    else seen.set(key, m[0]);
  });
  dup === 0 ? ok('MEIZAN 座標に完全重複なし（同一地点に2座が無い）') : bad('MEIZAN に座標重複 ' + dup + '件');
}

// ───────────────────────────── REVIEW: 人の目で確認 ─────────────────────────────
// 「Nモデル」表記が実態(5 / 3)と合っているか。コピペ文面・コメントの固定記述が要注意。
review(
  'モデル数の表記',
  '"Nモデル" の記述を一覧。気温・地上風=5／800hPa面=3（ECMWF・GSM欠）を念頭に確認。',
  scan(/[0-9０-９]\s*モデル/),
);

// 湿度80%しきい値が RH_GAS_FLOOR を経ているか（直書き80の取りこぼし検出）
review(
  '湿度しきい値の直書き疑い',
  '湿度系の行に素の 80 が出ていないか（RH_GAS_FLOOR 経由が正）。',
  scan(/(湿度|相対湿度|relative_humidity|rhTop|rhMid)/i, (t) => /(^|[^_\w])80([^_\w]|$)/.test(t) && !/RH_GAS_FLOOR/.test(t)),
);

// 降雪0.1しきい値が SNOW_FLOOR を経ているか
review(
  '降雪しきい値の直書き疑い',
  '降雪系の行に素の 0.1 が出ていないか（SNOW_FLOOR 経由が正）。',
  scan(/(降雪|積雪|snow|snowfall)/i, (t) => /(^|[^.\w])0\.1([^.\w]|$)/.test(t) && !/SNOW_FLOOR/.test(t)),
);

// 一般の固定距離 "NNkm"（コメント等で残っていないか・実距離表示への移行確認）
review(
  '固定距離の記述',
  'ハードコードされた "NNkm" を一覧（実測・実距離表示が原則）。',
  scan(/[0-9０-９]+\s*km/i).filter((h) => !/[~～]\s*25\s*km/i.test(h.text)),
);

// ───────── SKILL.md があれば、コード↔ドキュメントの整合もレビュー対象に ─────────
const skillPath = path.join(path.dirname(INDEX_PATH), 'SKILL.md');
if (fs.existsSync(skillPath)) {
  const sk = fs.readFileSync(skillPath, 'utf8').split('\n');
  const hits = [];
  sk.forEach((t, i) => {
    if (/[0-9０-９]\s*モデル/.test(t)) hits.push({ n: i + 1, text: t.trim() });
  });
  review('SKILL.md のモデル数表記', 'SKILL.md 側の "Nモデル" 記述（index.html と齟齬がないか）。', hits.slice(0, 40));
}

// ───────────────────────────── 出力 ─────────────────────────────
console.log('\n[REVIEW] 目視確認（エラーではない）');
reviews.forEach((r) => {
  console.log('\n  ● ' + r.tag + ' — ' + r.msg);
  if (!r.hits.length) {
    console.log('     （該当なし）');
  } else {
    r.hits.slice(0, 12).forEach((h) => {
      const line = 'L' + h.n + ': ' + h.text;
      console.log('     ' + (line.length > 120 ? line.slice(0, 117) + '…' : line));
    });
    if (r.hits.length > 12) console.log('     … 他 ' + (r.hits.length - 12) + ' 件');
  }
});

console.log('\n' + '='.repeat(48));
if (hard) {
  console.log('HARD 不一致 ' + hard + ' 件 — 実装と固定記述が食い違っている。要修正。');
  process.exit(1);
}
console.log('HARD は全て一致。REVIEW を目視で確認してね \u26f0\ufe0f');
