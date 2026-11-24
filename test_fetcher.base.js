// ソナ予報フェッチャー jsdom回帰テスト（モックAPI内蔵）
// 実行: node test_fetcher.js
"use strict";
const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("./index.html", "utf-8");
let pass = 0, fail = 0;
const T = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

// ---- モックデータ生成（5モデル・24時間×日数） ----
const MODEL_IDS = ["ecmwf_ifs025","gfs_seamless","jma_gsm","jma_msm","icon_seamless"];
const VARS = "temperature_2m,apparent_temperature,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_gusts_10m,wind_speed_925hPa,wind_direction_925hPa,wind_speed_850hPa,wind_direction_850hPa,wind_speed_800hPa,wind_direction_800hPa,wind_speed_700hPa,wind_direction_700hPa,relative_humidity_1000hPa,relative_humidity_925hPa,relative_humidity_800hPa,relative_humidity_700hPa,relative_humidity_850hPa,pressure_msl,cape,weather_code,precipitation,rain,snowfall,freezing_level_height,convective_inhibition".split(",");
const DATE = "2026-07-04";

function mockForecast(elev) {
  const times = [];
  for (let h = 0; h < 24; h++) times.push(`${DATE}T${String(h).padStart(2,"0")}:00`);
  const hourly = { time: times };
  MODEL_IDS.forEach((mid, mi) => {
    VARS.forEach(v => {
      const arr = times.map((_, h) => {
        // 800hPaはECMWF(0)とGSM(2)が欠測
        if ((v.includes("800hPa")) && (mi === 0 || mi === 2)) return null;
        // CAPEはGFS(1)/ECMWF(0)/ICON(4)のみ
        if (v === "cape" && !(mi === 0 || mi === 1 || mi === 4)) return null;
        // CINはGFSのみ
        if (v === "convective_inhibition") return mi === 1 ? -80 : null;
        // 0℃高度はGFSのみ
        if (v === "freezing_level_height") return mi === 1 ? 4200 : null;
        switch (v) {
          case "temperature_2m": return 10 + h * 0.3 + mi;
          case "apparent_temperature": return 6 + h * 0.3 + mi;
          case "cloud_cover_low": return 15;           // 低雲少（Type B検証用）
          case "cloud_cover_mid": return 10;
          case "cloud_cover_high": return 5;
          case "wind_gusts_10m": return 8 + mi;
          case "pressure_msl": return 1012 - h * 0.05; // 横ばい
          case "cape": return h >= 11 && h < 15 ? 300 : 50;
          case "weather_code":
            // 13時：GFSとICONの2モデルが雷95（同時刻2モデル→⛈️成立の検証）
            if (h === 13 && (mi === 1 || mi === 4)) return 95;
            return h < 12 ? 0 : 1;                     // 快晴/晴れベース
          case "precipitation": return h === 13 ? 0.3 : 0;
          case "rain": return h === 13 ? 0.3 : 0;
          case "snowfall": return 0;
          default:
            if (v.startsWith("relative_humidity_800")) return 86; // 山頂面湿り＝Type B
            if (v.startsWith("relative_humidity_850")) return 90; // 中腹湿り
            if (v.startsWith("relative_humidity")) return 55;
            if (v.startsWith("wind_direction")) return 270 + mi * 4; // ほぼ西で揃う
            if (v.startsWith("wind_speed")) return 6 + mi;
            return 0;
        }
      });
      hourly[`${v}_${mid}`] = arr;
    });
  });
  const daily = { time: [DATE] };
  daily[`sunrise_gfs_seamless`] = [`${DATE}T04:38`];
  daily[`sunset_gfs_seamless`]  = [`${DATE}T19:05`];
  return { latitude: 36.75, longitude: 138.125, elevation: elev, generationtime_ms: 1.2, timezone: "Asia/Tokyo", hourly, daily };
}

// ---- jsdom起動＋fetchモック ----
async function boot() {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://ishicoroservice.github.io/sona-forecast/",
    beforeParse(window) {
      window.fetch = async (url) => {
        const u = String(url);
        const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });
        if (u.includes("cyberjapandata2.gsi.go.jp"))
          return ok({ elevation: "1917.2", hsrc: "5m（レーザ）" });
        if (u.includes("ensemble-api.open-meteo.com")) {
          // 湿列やMAX併記の主検証には不要なので最小構造（fail-soft経路も同時に検証）
          return ok({ hourly: { time: [] } });
        }
        if (u.includes("air-quality-api.open-meteo.com"))
          return ok({ hourly: { time: [], aerosol_optical_depth: [], dust: [] } });
        if (u.includes("api.open-meteo.com/v1/forecast"))
          return ok(mockForecast(1917));
        return { ok: false, status: 404, json: async () => ({}) };
      };
      window.navigator.clipboard = { writeText: async () => {} };
    },
  });
  await new Promise(r => setTimeout(r, 50)); // スクリプト実行待ち
  return dom.window;
}

(async () => {
  console.log("== 起動・グローバル定義 ==");
  const w = await boot();
  T("スクリプトがReferenceErrorなくロード", typeof w.fetchForecast === "function" && typeof w.pickLevels === "function");
  T("起動時デフォルトが飯縄山", w.document.querySelector("#lat").value.startsWith("36.739"));

  console.log("== pickLevels（気圧面・rhTop切替） ==");
  const pl = w.pickLevels;
  T("1,249m→925主役", pl(1249).main === "925" && pl(1249).rhTop === "925");
  T("1,250m→850主役", pl(1250).main === "850");
  T("1,917m(飯縄)→800主役・rhTop800", pl(1917).main === "800" && pl(1917).rhTop === "800");
  T("2,250m→挟み・rhTop=800", pl(2250).bracket === true && pl(2250).rhTop === "800");
  T("2,449m→挟み・rhTop=800", pl(2449).rhTop === "800");
  T("2,450m→挟み・rhTop=700", pl(2450).bracket === true && pl(2450).rhTop === "700");
  T("2,932m(白馬)→挟み・rhTop=700", pl(2932).bracket === true && pl(2932).rhTop === "700");
  T("3,000m→700主役(非挟み)", pl(3000).main === "700" && pl(3000).bracket === false);
  T("標高不明→暫定700", pl(null).unknown === true && pl(null).main === "700");

  console.log("== 風向ユーティリティ ==");
  T("循環平均 350°&10°→0°付近", Math.abs(w.avgDir([350,10])) < 1e-6 || Math.abs(w.avgDir([350,10]) - 360) < 1e-6);
  T("dirSpreadR 対向2方位→0(割れ)", w.dirSpreadR([0,180]) < 1e-9);
  T("dirSpreadR 同方位→1(一致)", Math.abs(w.dirSpreadR([90,90,90]) - 1) < 1e-9);

  console.log("== codeToRank / rankToCode / precipType ==");
  T("95→8 / 0→0 / 45→4 / 53→5 / 61→6 / 63→7", w.codeToRank(95)===8 && w.codeToRank(0)===0 && w.codeToRank(45)===4 && w.codeToRank(53)===5 && w.codeToRank(61)===6 && w.codeToRank(63)===7);
  T("rank6+雪→71 / rank7+雨→63", w.rankToCode(6,true)===71 && w.rankToCode(7,false)===63);
  T("precipType: 雪0.5cm×雨0.4mm/4h→霙", w.precipType(0.4,0.5,3,4)==="霙");
  T("precipType: 乾き×wc95→雷雨", w.precipType(0,0,95,4)==="雷雨");
  T("precipType: 0.3mm/7h(0.04mm/h)→なし", w.precipType(0.3,0,3,7)==="なし");

  console.log("== seaOfClouds（判例3のしきい値） ==");
  const sc = w.seaOfClouds;
  T("山頂RH86→ガス", sc(15,86,90,"1,900m","1,500m").label.includes("ガス"));
  T("低35×山頂60×中腹75→雲海◎", sc(35,60,75,"3,000m","1,500m").label.includes("◎"));
  T("低25×山頂60×中腹75→◎にならない(低層雲<30)", !sc(25,60,75,"3,000m","1,500m").label.includes("◎"));
  T("低35×山頂60×中腹65→◎にならない(中腹<70)", !sc(35,60,65,"3,000m","1,500m").label.includes("◎"));
  T("低20×山頂50→展望良好", sc(20,50,50,"a","b").label==="低い");

  console.log("== searchMeizan（DB検索） ==");
  const sm = w.searchMeizan;
  T("剱岳→1件", sm("剱岳").length === 1);
  T("剣岳(異体字)→剱岳がヒット(alias・宝剣岳に誤誘導しない)", sm("剣岳").length === 1 && sm("剣岳")[0][0] === "剱岳", `実際:${sm("剣岳").map(x=>x[0]).join(",")}`);
  T("駒ヶ岳→5件（同名）", sm("駒ヶ岳").length === 5);
  T("甲斐駒ヶ岳→別名1件", sm("甲斐駒ヶ岳").length === 1 && sm("甲斐駒ヶ岳")[0][5] === 2967);
  T("北アルプス(山域名)→0件", sm("北アルプス").length === 0);
  T("旭岳→大雪山", sm("旭岳")[0] && sm("旭岳")[0][0] === "大雪山");
  T("正式名『暑寒別岳』で検索→ヒット", sm("暑寒別岳").length === 1 && sm("暑寒別岳")[0][5] === 1492);
  T("正式名『伯母子岳』で検索→ヒット", sm("伯母子岳").length === 1 && sm("伯母子岳")[0][5] === 1344);
  T("正式名『脊振山』で検索→ヒット", sm("脊振山").length === 1);
  T("旧表記『背振山』でも脊振山にヒット(alias)", sm("背振山").length === 1 && sm("背振山")[0][0] === "脊振山");
  T("正式名『涌蓋山』で検索→ヒット", sm("涌蓋山").length === 1);
  T("旧表記『湧蓋山』でも涌蓋山にヒット(alias)", sm("湧蓋山").length === 1 && sm("湧蓋山")[0][0] === "涌蓋山");
  T("『三ッ峠山』(小ッ)で検索→ヒット", sm("三ッ峠山").length === 1 && sm("三ッ峠山")[0][0] === "三ツ峠山");
  T("『三つ峠山』(ひらがな)でもヒット", sm("三つ峠山").length === 1);
  T("促音正規化の副作用なし：ニセイカウシュッペ山", sm("ニセイカウシュッペ山").length === 1);
  T("旧誤字『署寒別岳』『伯母小岳』はDBから消滅", sm("署寒別岳").length === 0 && sm("伯母小岳").length === 0);

  console.log("== プリセット同期（MEIZAN座標との一致） ==");
  const sel = w.document.querySelector("#preset");
  const opts = [...sel.options];
  const pickPreset = (label) => { const i = opts.findIndex(o => o.textContent.includes(label)); sel.value = String(i); w.applyPreset(); };
  const latV = () => w.document.querySelector("#lat").value, lngV = () => w.document.querySelector("#lng").value;
  [["鹿島槍", "鹿島槍ヶ岳"], ["燕岳", "燕岳"], ["常念岳", "常念岳"], ["立山", "立山"]].forEach(([lbl, q]) => {
    pickPreset(lbl);
    const db = sm(q)[0];
    T(`プリセット${lbl}＝DB座標(${db[1]},${db[2]})`, latV() === String(db[1]) && lngV() === String(db[2]), `実際:${latV()},${lngV()}`);
  });
  pickPreset("赤岳");
  const st = w.document.querySelector("#status").textContent;
  T("赤岳プリセット：括弧注釈が外れ『📍 赤岳』表示", st.includes("📍 赤岳") && !st.includes("（八ヶ岳）"), `実際:${st}`);
  pickPreset("飯縄"); // E2Eは従来どおり飯縄山で走らせる（Type Bモック前提を維持）

  console.log("== E2E：fetchForecast→サマリー生成 ==");
  await w.fetchForecast();
  const sum = w.document.querySelector("#summary").textContent;
  T("サマリーが生成される", sum.length > 500);
  T("ヘッダ①取得時刻あり", /取得 \d+\/\d+ \d{2}:\d{2}JST/.test(sum));
  T("ヘッダ②座標照合✓（GSI1917 vs 登録1917）", sum.includes("✓ 標高照合OK"));
  T("ヘッダ③標高ソース＝国土地理院5m", sum.includes("国土地理院5m"));
  T("3時間刻みに湿列（山頂面800hPa）", sum.includes("湿=山頂面800hPa") && /湿\d+/.test(sum));
  T("湿列の値=86（山頂面RH）", /湿86/.test(sum));
  T("Type B：快晴コードでも🌫️霧に補正（RH86≥80）", /早朝.*🌫️ 霧/.test(sum) || /午前.*🌫️ 霧/.test(sum), sum.split("\n").filter(l=>l.includes("早朝")).join(" | "));
  T("午後は雷⛈️（2モデル同時刻95）", /午後\(11-15時\).*⛈️/.test(sum));
  T("800hPa=3モデル表記", sum.includes("800hPa ≒1,900m（3モデル"));
  T("補助850hPa行あり", sum.includes("補助 850hPa"));
  T("雲海行：ガス判定（山頂RH86）", /■ 雲海\(早朝4-9時\): ガス/.test(sum));
  T("CIN行あり（GFS 80）", /CIN 対流の蓋.*: 80/.test(sum));
  T("0℃高度行（GFS 9時・約4200m）", sum.includes("0℃高度(GFS 9時): 約4200m"));
  T("気圧トレンド行あり", sum.includes("■ 気圧トレンド"));
  T("日の出（dailyモデルサフィックスをpickで解決）", sum.includes("日の出 4:38"));
  T("アンサンブル欠測でも本体完走（fail-soft）", sum.includes("アンサンブル=取得なし"));

  console.log("== worstWeatherCode 追加ケース（MAX側ドライ雷保持） ==");
  // 13時単独: MAXモードでは1モデル雷でも⛈️、降水0でも丸めない
  const idx13 = [w.idxAt(DATE, 14)]; // 14時: 全モデル晴れ(1)
  const wcMed = w.withMode("median", () => w.worstWeatherCode(idx13));
  T("14時(全モデル晴れ・RH86)→中央値でも🌫️45(Type B)", wcMed === 45, `実際:${wcMed}`);
  const idxTh = [w.idxAt(DATE, 13)];
  const wcMax = w.withMode("max", () => w.worstWeatherCode(idxTh));
  T("13時MAX→⛈️95", wcMax === 95, `実際:${wcMax}`);
  const wcMed13 = w.withMode("median", () => w.worstWeatherCode(idxTh));
  T("13時中央値→⛈️95（2モデル同時刻）", wcMed13 === 95, `実際:${wcMed13}`);

  console.log(`\n結果: ${pass} passed / ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
