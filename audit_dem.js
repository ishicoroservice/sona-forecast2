// MEIZAN 331座 + PRESETS のGSI DEM照合監査（フェッチャーの✓/⚠ゲートを全座に事前適用）
"use strict";
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf-8");

// MEIZAN配列を抽出してevalせずJSONで安全にパース
const mMatch = html.match(/const MEIZAN = (\[\[.*?\]\]);/s);
const MEIZAN = JSON.parse(mMatch[1].replace(/'/g, '"'));
// PRESETS抽出（オブジェクトリテラルなので個別パース）
const pBlock = html.match(/const PRESETS = \[([\s\S]*?)\];/)[1];
const PRESETS = [...pBlock.matchAll(/label:"([^"]+)",\s*lat:([\d.]+),\s*lng:([\d.]+),\s*elev:(\d+)/g)]
  .map(m => ({ name: m[1].split(" (")[0], lat: +m[2], lng: +m[3], elev: +m[4] }));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function dem(lat, lng) {
  const u = `https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lon=${lng}&lat=${lat}&outtype=JSON`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(u);
      if (!r.ok) { await sleep(300); continue; }
      const j = await r.json();
      const e = parseFloat(j.elevation);
      return isFinite(e) && e > -500 ? { e, hsrc: j.hsrc || "" } : null;
    } catch (_) { await sleep(300); }
  }
  return null;
}

(async () => {
  const warn = [], border = [], nodata = [];
  let done = 0;
  for (const m of MEIZAN) {
    const [name, lat, lng, rank, ali, elev] = m;
    const d = await dem(lat, lng);
    done++;
    if (done % 50 === 0) process.stderr.write(`  ...${done}/${MEIZAN.length}\n`);
    if (!d) { nodata.push(`${name} (${lat},${lng})`); await sleep(60); continue; }
    const diff = Math.round(Math.abs(d.e - elev));
    if (diff > 150) warn.push({ name, rank, lat, lng, reg: elev, dem: Math.round(d.e), diff, hsrc: d.hsrc });
    else if (diff > 100) border.push({ name, rank, reg: elev, dem: Math.round(d.e), diff });
    await sleep(60);
  }
  console.log(`== MEIZAN ${MEIZAN.length}座 DEM照合 ==`);
  console.log(`⚠ 150m超（フェッチャーで⚠が出る座）: ${warn.length}件`);
  warn.forEach(w => console.log(`  ⚠ ${w.name}(rank${w.rank}) 登録${w.reg}m vs DEM${w.dem}m = ${w.diff}m差  @${w.lat},${w.lng} [${w.hsrc}]`));
  console.log(`△ 100-150m（ボーダー・✓は出る）: ${border.length}件`);
  border.forEach(w => console.log(`  △ ${w.name}(rank${w.rank}) 登録${w.reg} vs DEM${w.dem} = ${w.diff}m差`));
  if (nodata.length) console.log(`— DEM取得不可: ${nodata.join(" / ")}`);

  console.log(`\n== PRESETS ${PRESETS.length}座 DEM照合 ==`);
  for (const p of PRESETS) {
    const d = await dem(p.lat, p.lng);
    if (!d) { console.log(`  ? ${p.name}: DEM取得不可`); await sleep(60); continue; }
    const diff = Math.round(Math.abs(d.e - p.elev));
    const mk = diff > 150 ? "⚠" : diff > 100 ? "△" : "✓";
    console.log(`  ${mk} ${p.name}: 登録${p.elev}m vs DEM${Math.round(d.e)}m = ${diff}m差`);
    // MEIZANに同名があれば座標差も出す
    const mm = MEIZAN.find(x => x[0] === p.name || (x[4]||[]).includes(p.name));
    if (mm) {
      const km = Math.hypot((mm[1]-p.lat)*111, (mm[2]-p.lng)*111*Math.cos(p.lat*Math.PI/180));
      if (km > 0.05) console.log(`      └ DB座標と ${Math.round(km*1000)}m 離れてる（DB: ${mm[1]},${mm[2]}）`);
    }
    await sleep(60);
  }
})();
