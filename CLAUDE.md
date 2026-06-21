# ソナ予報 — 開発ガイド（Cowork用）

このリポジトリは、良輔さんの登山向け山岳気象予報「**ソナ予報**」の本体。
Cowork はこれを **直す工房**（実装→テスト→デプロイ）。予報を *回す* のは Claude.ai プロジェクト側。

> このファイルは Cowork のプロジェクト指示にも貼っておくと、毎セッション前提が揃う。
> （Claude Code 同様、リポジトリ直下の `CLAUDE.md` を文脈として読む運用を想定）

---

## 構成（二段アーキテクチャ）

- **`index.html`** … フェッチャー。ブラウザから Open-Meteo の5モデル（ECMWF / GFS / JMA GSM / JMA MSM / ICON）を直接叩き、**深刻度ランク化・5モデル一致度・主役面切替・CAPE/CIN集計**まで済ませてコピペ文面を吐く。GitHub Pages 配信（`ishicoroservice.github.io/sona-forecast2/`）。
- **`SKILL.md`** … 予報スキル。フェッチャーの数値を「その山頂に・その時間・どんな景色で・行動できるか」に翻訳する判定フロー。**フェッチャーが数値、ソナが判断**。
- **`sonaicon1254.png`** … ソナのアイコン。

口調・ペルソナはこのリポジトリでは **再定義しない**。Claude.ai 側の userPreferences／プロジェクト指示が正。

---

## 開発ループ（このリポジトリでの作法）

```
ロジック説明 → 良輔さんの承認 → 実装 → npm test → npm run check:drift → 出力確認 → commit & push → (CDN 10〜20分) → ライブ確認
```

- 設計の最終判断は良輔さん。**実装前に必ずロジックを説明して承認を得る**。トレードオフを示し、明確な推奨を添える。
- バグは push 前にローカルで潰す。CDN の反映待ち（10〜20分）は「デバッグ」ではなく「ライブ最終確認」に使う。

### コマンド
```bash
npm install          # 初回のみ（jsdom）
npm test             # 純粋ロジックの回帰テスト（test/sona.test.js）
npm run check:drift  # ~25km型バグの点検（scripts/check-drift.js）
npm run verify       # 上の2つを連続実行
```

---

## デプロイ（git 接続の実態・2026/6 確立）

**Cowork のサンドボックスからは、このフォルダ（Windows マウント）上で直接 git を動かせない。** `git init` が `.git/config` を全ゼロで書き、`.git` 配下は `rm` できない（`Operation not permitted`＝Windows/McAfee 側ロック）。マウント越しの git メタデータ操作に耐えないため、git は**サンドボックス内のローカル領域**で回す。

**回避手順（実証済み）:**

1. 作業ツリーをサンドボックス内 ext4 へコピー：`tar --exclude='./.git' --exclude='./node_modules' --exclude='./gh_token*'` で `/tmp/sona-deploy` へ。
2. そこで `git init -b main` → `commit`（ext4 なので安定）。
3. push はトークンを文面に出さない **credential helper 経由**：`username=ishicoroservice` ＋ `password=$(tr -d ' \t\r\n' < <マウント>/gh_token*)`。glob で名前ゆれ（メモ帳が作る `gh_token.txt.txt`）を吸収。
4. 既存リモートに履歴があれば `git merge origin/main --allow-unrelated-histories -X ours` してから push。

**前提・運用:**

- remote = `https://github.com/ishicoroservice/sona-forecast2`、Pages は **main / root**（本番 `https://ishicoroservice.github.io/sona-forecast2/`）。
- `/tmp` リポジトリはセッション間で消える → 毎回 origin から clone し直し、マウントの変更ファイルをコピーして commit → push。
- PAT は **fine-grained（Contents: Read and write）** を `gh_token.txt` に保存（`.gitignore` で `gh_token*` 除外）。**トークンの中身は AI が扱わない**（ファイル経由で git が読むだけ）。
- 404 の主因履歴：remote で `index.html` が削除されていた → 復活で解消（2026/6 初回デプロイ）。favicon 3枚は `sonaicon1254.png` から生成して同梱。

---

## 鉄則（ここを外すと予報が根本から狂う）

1. **座標は生命線。AIの記憶座標は絶対に使わない。** 記憶座標はハルシネーションで全滅した実績あり（地蔵岳を実標高より900m低い谷と誤答）。
   - 新規・非収録の座標は **yamap（第一）／ヤマレコ ptinfo（第二）→ 国土地理院5m DEM（`cyberjapandata2.gsi.go.jp`）で山頂照合**してから採用。岩稜は尖頭丸めで −50m級許容、里山は ±25m目安。
   - 三百名山301座は **cyber-ninja.jp の CSV** が決定版。稜線ピーク等の非CSV座標は yamap で確定。
   - **同名山（駒ヶ岳5座・朝日岳3座など）の座標・標高突合は最重要注意。** 突合で隣の山を拾う事故が頻発する。検索ソートは 百名山→二百名山→三百名山→主要ピーク→里山、同ランク内は標高降順。

2. **SKILL.md とコードの整合を毎回点検（~25km型バグ）。** コードの実態（実際に計算・取得している値）と、画面・コピペ文面の固定記述（モデル数・距離・しきい値）の食い違いを定期総点検する。`npm run check:drift` がHARD一致＋目視レビューを出す。

3. **集計哲学（§0.6）。** 項目ごとに統計量を変える：
   - 天気記号＝深刻度ランク（0–8）の中央値。**雷は同時刻2モデル以上の合意でランク8に上書き**（中央値に埋もれさせない）。
   - 降水＝各時刻のモデル間中央値を合計。強度（`PRECIP_RATE_FLOOR`=0.1mm/h）で霧雨ノイズ除去。
   - CAPE＝安全側で最大（3モデル）。突風＝瞬間最大。体感＝最小（最も冷えた値）。風速・気温＝min-maxレンジ。風向＝循環平均（350°と10°の中央を180°にしない）。
   - 雲海インジケータの早朝値だけは平均。
   - **コピペ文面は中央値とMAXを常に併記**（ソナの判断材料を最大化）。表はプルダウンで切替。

4. **Type B 気象（全モデルが晴れに合意しても外す型）。** 山頂面の相対湿度が `RH_GAS_FLOOR`（80%）超なら地形性ガス。格子モデル（25km解像度）は地形誘発ガスを解像できないので、**湿度補正レイヤー**で撃つ（飯縄2026/6の実証）。決定論・アンサンブルの不一致可視化（Type A）では救えない。当日朝の衛星・現地で最終補正。

5. **テスト方針。** `node --check` は ReferenceError を見逃すので不十分。**jsdom による render 実走が必須**（`test/harness.js` の IIFE戻り値方式で、トップレベル字句スコープの関数を回収）。新しいロジックを足したら **必ず `test/sona.test.js` に対応テストを追加**。

---

## SKILL.md の同期

**このリポジトリを唯一の正（source of truth）にする。** SKILL.md を改修したら、Claude.ai プロジェクトの「スキル」にも再アップして同期する（予報を回すのは Claude.ai 側で、そこは別コピーを持つため）。index.html だけ Cowork・SKILL.md は旧来、と分けると乖離点検が二か所に割れて逆に面倒。**両方このリポジトリで一緒に直す。**

---

## ネットワーク（エンジン直叩き・curl で取りに行く先）

ブラウザのフェッチャーと違い、Cowork の VM からは CORS の壁が無く curl で直接取れる。許可・利用するドメイン：

- `api.open-meteo.com` / `ensemble-api.open-meteo.com` / `archive-api.open-meteo.com` / `air-quality-api.open-meteo.com` … 5モデル＋アンサンブル＋過去実測＋AOD
- `geocoding-api.open-meteo.com` … ジオコーダ（第三フォールバック）
- `cyberjapandata2.gsi.go.jp` … 国土地理院5m DEM（座標照合の必須ツール）
- `yamap.com` … 座標取得・第一選択（JSON-LD に十進・小数7桁の山頂座標）
- `www.yamareco.com` … 座標取得・第二＋登山道/残雪/熊の裏取り（ptinfo.php / rec_rss.php / ranking_pt.php。個別記録 detail-*.html はCF壁で不可→RSS抜粋で代替）
- `www.jma.go.jp` … 公式の警報・注意報＋アメダス実況（長野=200000）
- `himawari8.nict.go.jp` … 当日朝の雲実況（可視光なので日中専用）
- `weathernews.jp` … 麓のピンポイント時間帯別

> web_search は **総観専任**（前線・気圧系・台風・梅雨を予報士記事で）。山頂ピンポイント数値はキャッシュが古いので使わない。

---

## 同梱の開発ツール

| ファイル | 役割 |
|---|---|
| `test/harness.js` | index.html のインラインJSを jsdom で実走させ、関数・定数をテストから呼べる形で回収（IIFE戻り値方式） |
| `test/sona.test.js` | 純粋ロジックの回帰テスト（§0.5 気圧面・§0.6 集計・湿度ガス・降水種別・バックデータ検索など） |
| `scripts/check-drift.js` | ~25km型バグ点検。実装値（MODELS=5 等）と固定記述の食い違いをHARD検出＋目視レビュー出力 |

別の index.html を指して走らせたいときは `SONA_INDEX=/path/to/index.html npm test` のように環境変数で上書きできる。
