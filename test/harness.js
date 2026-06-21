// test/harness.js
// ソナ予報フェッチャー(index.html)のインラインJSを jsdom 上で「実走」させて、
// 定義された関数・定数をテストから呼べる形で取り出すハーネス。
//
// なぜこの方式か（重要・memory由来の教訓）:
//   - `node --check` は ReferenceError を見逃す（構文だけ見て実行はしない）ので不十分。
//   - index.html の script は IIFE で包まれておらず、関数はトップレベルの字句スコープに
//     閉じている＝ window には生えない。素朴に runScripts:'dangerously' で読み込んでも
//     外から関数を掴めない（vm context 問題）。
//   - そこで「script本文を関数で包み、末尾に return を足して中身を吐かせる(IIFE戻り値方式)」。
//     direct eval は包んだ関数の字句スコープを見られるので、名前を渡せば実体を回収できる。
//   - DOM はフルHTMLから作る（runScripts:'outside-only'＝ページ自身のscriptは自動実行させない）。
//     これで起動時の initPresets()/applyPreset()/イベント結線も本物のDOMに対して走り、
//     「render実走」相当の検証になる。

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX_PATH =
  process.env.SONA_INDEX || path.join(__dirname, '..', 'index.html');

function loadSona(opts = {}) {
  const html = fs.readFileSync(INDEX_PATH, 'utf8');

  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('index.html にインライン <script> が見つからない');
  const scriptBody = m[1];

  // ページ自身のscriptは自動実行させない(outside-only)。DOMだけ本物を用意する。
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://ishicoroservice.github.io/sona-forecast2/',
  });
  const { window } = dom;

  // ネットワークは無効化（うっかり fetch が走っても落とさない）。
  // 純粋ロジックのテストでは fetch を踏まないが、保険として常に塞ぐ。
  window.fetch = () =>
    Promise.reject(new Error('fetch is disabled in tests'));
  if (!window.AbortController && typeof AbortController !== 'undefined') {
    window.AbortController = AbortController;
  }

  // 取り出したいトップレベル識別子を script 本文から拾う
  // （function宣言 / async function / const|let|var の左辺）。
  const names = new Set();
  const push = (re) => {
    let mm;
    while ((mm = re.exec(scriptBody))) names.add(mm[1]);
  };
  push(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g);
  push(/\basync\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  push(/(?:^|[\n;])\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g);

  const list = [...names];

  // script本文を関数で包み、末尾に「名前→実体」を集める return を足す。
  // direct eval(__n__) は包んだ関数スコープを参照できる＝閉じた関数も回収できる。
  const wrapped =
    '(function(){\n' +
    '"use strict";\n' +
    scriptBody +
    '\n;var __out__={};\n' +
    'var __names__=' +
    JSON.stringify(list) +
    ';\n' +
    'for(var __i=0;__i<__names__.length;__i++){var __n__=__names__[__i];' +
    'try{__out__[__n__]=eval(__n__);}catch(__e__){}}\n' +
    'return __out__;\n' +
    '})()';

  let api;
  try {
    api = window.eval(wrapped);
  } catch (e) {
    // 起動時の実行で落ちた＝ReferenceError等を「実走」で検出できた、ということ。
    e.message = '[harness] index.html の実走に失敗: ' + e.message;
    throw e;
  }

  return { window, document: window.document, api, dom };
}

module.exports = { loadSona, INDEX_PATH };
