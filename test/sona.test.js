// test/sona.test.js
// ソナ予報フェッチャー(index.html)の純粋ロジック回帰テスト。
// 依存は jsdom のみ。テストフレームワーク不使用（node 標準 assert）。
//   実行: node test/sona.test.js   /   npm test
//
// ここで守っているのは SKILL.md の判定ロジック（§0.5 気圧面・§0.6 集計・湿度ガス補正など）。
// 新しいロジックを足したら、必ずここに対応テストを追加する（memory: 全関数を実走で検証する方針）。

const assert = require('assert');
const { loadSona, INDEX_PATH } = require('./harness');

const { api } = loadSona();
const A = api; // 短縮

let pass = 0,
  fail = 0;
const fails = [];
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    fail++;
    fails.push({ name, msg: e.message });
    console.log('  \u2717 ' + name + '  \u2014 ' + e.message);
  }
}
function approx(a, b, eps = 1e-9, msg) {
  assert(Math.abs(a - b) <= eps, (msg || '') + ` 期待${b} 実際${a}`);
}

console.log('index.html:', INDEX_PATH);
console.log('\n[0] ハーネス／起動時実走');
test('主要関数が回収できている', () => {
  [
    'median', 'pct', 'agg', 'codeToRank', 'rankToCode', 'precipType',
    'seaOfClouds', 'pickLevels', 'midLevelFor', 'avgDir', 'dirName',
    'dirArrow', 'searchMeizan', 'normMt', 'meizanRank', 'worstWeatherCode',
  ].forEach((k) => assert(typeof A[k] === 'function', k + ' が関数でない'));
});

console.log('\n[1] 定数（しきい値の一元化が崩れていないか）');
test('RH_GAS_FLOOR = 80', () => assert.strictEqual(A.RH_GAS_FLOOR, 80));
test('SNOW_FLOOR = 0.1', () => assert.strictEqual(A.SNOW_FLOOR, 0.1));
test('PRECIP_RATE_FLOOR = 0.1', () => assert.strictEqual(A.PRECIP_RATE_FLOOR, 0.1));
test('MODELS は5モデル', () => assert.strictEqual(A.MODELS.length, 5));
test('CAPE_MODELS は3モデル(GFS/ECMWF/ICON)', () => assert.strictEqual(A.CAPE_MODELS.length, 3));
test('MEIZAN は331座', () => assert.strictEqual(A.MEIZAN.length, 331));

console.log('\n[2] 集計ユーティリティ');
test('median 奇数', () => assert.strictEqual(A.median([3, 1, 2]), 2));
test('median 偶数は平均', () => assert.strictEqual(A.median([1, 2, 3, 4]), 2.5));
test('median 空はnull', () => assert.strictEqual(A.median([]), null));
test('pct 90パーセンタイル', () => approx(A.pct([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1, 1e-9));
test('agg は既定で中央値', () => assert.strictEqual(A.agg([1, 2, 3]), 2));
test('withMode("max") で最大に倒れる', () =>
  assert.strictEqual(A.withMode('max', () => A.agg([1, 2, 3])), 3));

console.log('\n[3] 風向（循環平均と矢印の向き）');
test('dirName 北/東/南/西', () => {
  assert.strictEqual(A.dirName(0), '北');
  assert.strictEqual(A.dirName(90), '東');
  assert.strictEqual(A.dirName(180), '南');
  assert.strictEqual(A.dirName(270), '西');
});
test('dirArrow は風が向かう先（北風→↓）', () => {
  assert.strictEqual(A.dirArrow(0), '\u2193'); // 北から吹く＝南へ向かう
  assert.strictEqual(A.dirArrow(90), '\u2190'); // 東から吹く＝西へ
});
test('avgDir 350°と10°の中央は≈0°（180°事故を起こさない）', () => {
  const v = A.avgDir([350, 10]);
  assert(v > 359 || v < 1, '実際=' + v);
});
test('avgDir 同方向はその値', () => approx(A.avgDir([90, 90]), 90, 1e-6));
test('avgDir 空はnull', () => assert.strictEqual(A.avgDir([]), null));

console.log('\n[4] 降水種別（PRECIP_RATE_FLOOR / SNOW_FLOOR）');
test('しっかりした雨→「雨」', () => assert.strictEqual(A.precipType(5, 0, 63, 1), '雨'));
test('微弱な霧雨(<0.1mm/h)→「なし」（梅雨ノイズ除去）', () =>
  assert.strictEqual(A.precipType(0.05, 0, 3, 1), 'なし'));
test('雪量>SNOW_FLOOR→「雪」', () => assert.strictEqual(A.precipType(0, 1, 73, 1), '雪'));
test('雨+雪→「霙」', () => assert.strictEqual(A.precipType(5, 1, 71, 1), '霙'));
test('code95+ で「雷雨」', () => assert.strictEqual(A.precipType(2, 0, 95, 1), '雷雨'));
test('降水バンド長で強度正規化（同じ総量でも時刻数で薄まる）', () => {
  // 0.4mm を4時刻に割ると 0.1mm/h ちょうど→FLOOR以上で雨、7時刻なら<0.1で「なし」
  assert.strictEqual(A.precipType(0.4, 0, 61, 4), '雨');
  assert.strictEqual(A.precipType(0.4, 0, 61, 7), 'なし');
});

console.log('\n[5] weather_code ↔ 深刻度ランク');
test('codeToRank マップ', () => {
  const map = { 0: 0, 1: 1, 2: 2, 3: 3, 45: 4, 48: 4, 53: 5, 61: 6, 71: 6, 63: 7, 95: 8, 96: 8, 99: 8 };
  Object.entries(map).forEach(([c, r]) =>
    assert.strictEqual(A.codeToRank(+c), r, `code${c}→rank期待${r}`));
  assert.strictEqual(A.codeToRank(null), null);
});
test('rankToCode 雨/雪の出し分け', () => {
  assert.strictEqual(A.rankToCode(4), 45); // 霧
  assert.strictEqual(A.rankToCode(6, false), 61); // 弱い雨
  assert.strictEqual(A.rankToCode(6, true), 71); // 弱い雪
  assert.strictEqual(A.rankToCode(7, false), 63);
  assert.strictEqual(A.rankToCode(7, true), 73);
  assert.strictEqual(A.rankToCode(8), 95);
});
test('ランク往復が保たれる(0-8)', () => {
  [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((r) =>
    assert.strictEqual(A.codeToRank(A.rankToCode(r, false)), r, 'rank' + r + 'の往復'));
});

console.log('\n[6] 標高→気圧面（SKILL.md §0.5 の主役面切替）');
test('里山(<1250)→主役925・補助850', () => {
  const L = A.pickLevels(800);
  assert.strictEqual(L.main, '925');
  assert.strictEqual(L.sub, '850');
});
test('1500m級→主役850・補助は登路925', () => assert.strictEqual(A.pickLevels(1500).main, '850'));
test('飯縄(1917)→主役800・補助850', () => {
  const L = A.pickLevels(1917);
  assert.strictEqual(L.main, '800');
  assert.strictEqual(L.sub, '850');
});
test('燕(2763)→800と700で挟む(bracket)', () => {
  const L = A.pickLevels(2763);
  assert.strictEqual(L.main, '800');
  assert.strictEqual(L.sub, '700');
  assert.strictEqual(L.bracket, true);
});
test('槍(3180)→主役700・補助800', () => assert.strictEqual(A.pickLevels(3180).main, '700'));
test('標高不明→700・unknownフラグ', () => {
  const L = A.pickLevels(null);
  assert.strictEqual(L.main, '700');
  assert.strictEqual(L.unknown, true);
});
test('midLevelFor 盆地面の対応', () => {
  assert.strictEqual(A.midLevelFor('925'), '1000'); // 里山は最下層を盆地面に
  assert.strictEqual(A.midLevelFor('800'), '850');
  assert.strictEqual(A.midLevelFor('700'), '850');
});

console.log('\n[7] 雲海/ガス判定（Type B＝湿度でガスを拾う）');
test('低層雲少なくても山頂RH≥80→ガス（飯縄2026/6の実証）', () => {
  const r = A.seaOfClouds(10, 86, 50, '1900m', '1500m');
  assert(/ガス/.test(r.label), 'label=' + r.label);
});
test('中腹湿り×山頂乾き→雲海◎', () => {
  const r = A.seaOfClouds(20, 60, 70, '3000m', '1500m');
  assert(/雲海/.test(r.label), 'label=' + r.label);
});
test('低層雲少×山頂乾き→展望良好(低い)', () => {
  const r = A.seaOfClouds(10, 50, 40, '1900m', '1500m');
  assert.strictEqual(r.label, '低い');
});

console.log('\n[8] バックデータ検索（同名・別名・正規化）');
test('「飯縄」で飯縄山がヒット', () => {
  const r = A.searchMeizan('飯縄');
  assert(r.some((m) => m[0] === '飯縄山'), 'ヒット=' + r.map((m) => m[0]));
});
test('別名「甲斐駒ヶ岳」→駒ヶ岳(rank1・標高2967)に解決', () => {
  const r = A.searchMeizan('甲斐駒ヶ岳');
  const hit = r.find((m) => (m[4] || []).includes('甲斐駒ヶ岳'));
  assert(hit, '別名解決できず');
  assert.strictEqual(hit[3], 1); // 百名山
  assert.strictEqual(hit[5], 2967); // 標高
});
test('normMt：ヶ/ケ/嶽・空白を吸収', () => {
  assert.strictEqual(A.normMt('鷲羽嶽'), A.normMt('鷲羽岳'));
  assert.strictEqual(A.normMt('甲斐駒ヶ岳'), A.normMt('甲斐駒ケ岳'));
  assert.strictEqual(A.normMt(' 槍 ヶ 岳 '), '槍ケ岳');
});
test('meizanRank ラベル', () => {
  assert.strictEqual(A.meizanRank({ rank: 1 }).label, '百名山');
  assert.strictEqual(A.meizanRank({ rank: 4 }).label, '里山');
});

// ---- まとめ ----
console.log('\n' + '='.repeat(48));
console.log(`結果: ${pass} pass / ${fail} fail  (計 ${pass + fail})`);
if (fail) {
  console.log('\n失敗:');
  fails.forEach((f) => console.log('  - ' + f.name + ': ' + f.msg));
  process.exit(1);
}
console.log('全部グリーン \u26f0\ufe0f');
