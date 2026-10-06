/* portfolio-perf.js — 포트폴리오 › 계좌별 「매매내역」「수익률 평가」
 * PortfolioPerf.trades(el, state, accountId, onChange, onEdit)  전체 매매내역(월별 묶음·실현손익·필터·삭제·칸 클릭 수정)
 * PortfolioPerf.perf(el, state, accountId)              계좌 수익률 vs 지수 그래프 + 기간별 매매 변동
 *   └ 총자산 | 국내 | 해외 탭(2026-10-02): 국내 = 한국 종목만(처음 산 날부터 코스피·코스닥과), 해외 = 미국 종목만(달러 기준으로 S&P500·나스닥과, 원화 환산도 표시)
 *     봉차트(일·주·월) ↔ 선 그래프, 월별 ↔ 일별 표
 *
 * 수익률 계산(총자산 기준 시간가중수익률): 주식 평가액(보유 수량 × 그날 종가, 미국은 그날 환율) + 예수금(매매로 역산)을 총자산으로 보고,
 * 입금·출금만 외부 자금 흐름으로 뺀다(자세한 가정은 compute 위 주석).
 * → 돈을 더 넣거나 뺀 효과는 빼고 '종목 선택과 매매 타이밍'만 남기므로 지수와 바로 비교할 수 있다.
 * 과거 주가·지수·환율은 야후 파이낸스 일봉(브라우저에서 직접, 막히면 읽기 전용 중계). 이 브라우저에 하루 동안 캐시. */
(function () {
  "use strict";
  var S = window.PortfolioStore;
  var BENCH = [["^KS11", "코스피", "#f0b429"], ["^KQ11", "코스닥", "#9b7bff"], ["^GSPC", "S&P500", "#34d399"], ["^IXIC", "나스닥", "#5bc0eb"]];
  var CACHE = "vantage-px-hist-v1", BSEL = "vantage-perf-bench", RSEL = "vantage-perf-range", VSEL = "vantage-perf-view";
  var SEGS = [["all", "총자산"], ["KR", "국내"], ["US", "해외"]];
  var SEG_BENCH = { KR: ["^KS11", "^KQ11", "^IXIC"], US: ["^GSPC", "^IXIC"] };
  var SEG_NAME = { all: "내 계좌", KR: "국내 종목", US: "해외 종목" };
  var RANGES = [["1M", 1], ["3M", 3], ["6M", 6], ["YTD", "ytd"], ["1Y", 12], ["전체", 0]];
  var ACC = "#f0475a";

  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function num(v, d) { return Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: d == null ? 0 : d }); }
  function krw(v) { return v == null || !isFinite(v) ? "—" : (v < 0 ? "−₩" : "₩") + num(Math.abs(v)); }
  function pct(v, d) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(d == null ? 2 : d) + "%"; }
  function cls(v) { return v == null || !isFinite(v) ? "" : v > 0 ? "pos" : v < 0 ? "neg" : ""; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function today() { return new Date().toISOString().slice(0, 10); }
  function txsOf(state, id) {
    return state.transactions.filter(function (t) { return t.accountId === id; }).slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  }
  function keyOf(t) { var m = t.market === "KR" ? "KR" : "US"; return m + ":" + S.tickerFor(t.ticker, m); }
  function amtKrw(t, state) { var fx = t.market === "US" ? (Number(t.fx) || Number(state.fx && state.fx.price) || 1350) : 1; return (Number(t.qty) || 0) * (Number(t.price) || 0) * fx; }

  /* 매도마다 평균단가 기준 실현손익(원화) */
  function withRealized(state, txs) {
    var pos = {};
    return txs.map(function (t) {
      var k = keyOf(t), p = pos[k] || (pos[k] = { qty: 0, cost: 0 }), q = Number(t.qty) || 0, a = amtKrw(t, state), r = null, short = 0;
      if (t.side === "sell") {
        var sold = Math.min(q, p.qty), avg = p.qty ? p.cost / p.qty : 0;
        if (q > p.qty + 1e-9) short = q - p.qty;   // 가진 것보다 많이 판 기록 — 앞쪽 매수가 빠졌다는 뜻
        r = sold * (a / (q || 1)) - sold * avg; p.qty -= sold; p.cost -= sold * avg;
      } else { p.qty += q; p.cost += a; }
      return { t: t, amt: a, realized: r, left: Math.max(0, p.qty), short: short };
    });
  }

  /* ───────────── 매매내역 ───────────── */
  var tf = { side: "all", tk: "", };
  function trades(el, state, id, onChange, onEdit) {
    var rows = withRealized(state, txsOf(state, id));
    var tickers = {}; rows.forEach(function (r) { tickers[keyOf(r.t)] = S.displayTicker(r.t.ticker); });
    if (tf.tk && !tickers[tf.tk]) tf.tk = "";
    var list = rows.filter(function (r) { return (tf.side === "all" || r.t.side === tf.side) && (!tf.tk || keyOf(r.t) === tf.tk); }).reverse();
    var buy = 0, sell = 0, real = 0;
    list.forEach(function (r) { if (r.t.side === "sell") { sell += r.amt; real += r.realized || 0; } else buy += r.amt; });
    var months = {}, order = [];
    list.forEach(function (r) { var m = String(r.t.date).slice(0, 7); if (!months[m]) { months[m] = []; order.push(m); } months[m].push(r); });
    el.innerHTML =
      '<div class="pf-bar"><div class="pf-seg" id="tr-side">' + [["all", "전체"], ["buy", "매수"], ["sell", "매도"]].map(function (x) { return '<button data-v="' + x[0] + '" class="' + (tf.side === x[0] ? "on" : "") + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      '<select id="tr-tk"><option value="">전체 종목</option>' + Object.keys(tickers).sort(function (a, b) { return tickers[a].localeCompare(tickers[b]); }).map(function (k) { return '<option value="' + esc(k) + '"' + (k === tf.tk ? " selected" : "") + ">" + esc(tickers[k]) + "</option>"; }).join("") + "</select>" +
      '<span class="pf-sum">' + list.length + "건 · 매수 " + krw(buy) + " · 매도 " + krw(sell) + ' · 실현손익 <b class="' + cls(real) + '">' + krw(real) + "</b></span></div>" +
      (list.length ? order.map(function (m) {
        var g = months[m], mb = 0, ms = 0, mr = 0;
        g.forEach(function (r) { if (r.t.side === "sell") { ms += r.amt; mr += r.realized || 0; } else mb += r.amt; });
        return '<div class="pf-month"><div class="pf-mh"><b>' + m.replace("-", "년 ") + '월</b><span>매수 ' + krw(mb) + " · 매도 " + krw(ms) + (ms ? ' · 실현 <b class="' + cls(mr) + '">' + krw(mr) + "</b>" : "") + " · 순매수 " + krw(mb - ms) + "</span></div>" +
          '<div class="pf-tbl"><table><thead><tr><th>날짜</th><th>종목</th><th>구분</th><th>수량</th><th>잔여</th><th>체결가</th><th>금액(원화)</th><th>실현손익</th><th></th></tr></thead><tbody>' +
          g.map(function (r) {
            var t = r.t, us = t.market === "US";
            /* 날짜·구분·수량·체결가·환율 칸은 누르면 그 자리에서 고친다 */
            var ed = function (f, v, html) { return '<span class="pf-ed" tabindex="0" title="눌러서 수정" data-ed="' + f + '" data-id="' + esc(t.id) + '" data-v="' + esc(v) + '">' + html + "</span>"; };
            return "<tr><td>" + ed("date", t.date, esc(t.date)) + '</td><td class="tk">' + esc(S.displayTicker(t.ticker)) + '<small>' + (us ? "미국" : "한국") + '</small></td><td><span class="pf-ed ' + (t.side === "buy" ? "buy" : "sell") + '" tabindex="0" title="눌러서 매수↔매도 바꾸기" data-ed="side" data-id="' + esc(t.id) + '">' + (t.side === "buy" ? "매수" : "매도") + "</span></td><td>" + ed("qty", t.qty, num(t.qty, 4)) + '</td><td class="pf-left' + (r.short ? " short" : "") + '"' + (r.short ? ' title="이 매도 전 보유가 ' + num(t.qty - r.short, 4) + '주뿐 — 앞쪽 매수 기록이 ' + num(r.short, 4) + '주 빠졌습니다"' : "") + ">" + num(r.left, 4) + "주" + (r.short ? "<small>" + num(r.short, 4) + "주 부족</small>" : "") + "</td><td>" + ed("price", t.price, us ? "$" + num(t.price, 2) : "₩" + num(t.price)) + (us ? "<small>" + ed("fx", Number(t.fx) || "", "@" + num(t.fx, 1)) + "</small>" : "") + "</td><td>" + krw(r.amt) + '</td><td class="' + cls(r.realized) + '">' + (r.realized == null ? "" : krw(r.realized)) + '</td><td><button class="icon-btn" data-del="' + esc(t.id) + '" aria-label="기록 삭제">×</button></td></tr>';
          }).join("") + "</tbody></table></div></div>";
      }).join("") : '<div class="empty-row">매매 기록이 없습니다.</div>');
    el.querySelectorAll("#tr-side button").forEach(function (b) { b.onclick = function () { tf.side = b.dataset.v; trades(el, state, id, onChange, onEdit); }; });
    el.querySelector("#tr-tk").onchange = function (e) { tf.tk = e.target.value; trades(el, state, id, onChange, onEdit); };
    el.querySelectorAll("[data-del]").forEach(function (b) { b.onclick = function () { if (!confirm("이 매매 기록을 삭제할까요?")) return; onChange(b.dataset.del); }; });
    if (!onEdit) return;
    el.querySelectorAll("[data-ed]").forEach(function (sp) {
      var f = sp.dataset.ed, open = function () {
        if (f === "side") { onEdit(sp.dataset.id, "side"); return; }
        if (sp.querySelector("input")) return;
        var old = sp.innerHTML, inp = document.createElement("input"), done = false;
        inp.className = "pf-ed-in"; inp.type = f === "date" ? "date" : "number"; inp.value = sp.dataset.v;
        if (f !== "date") { inp.step = "any"; inp.min = "0"; }
        sp.innerHTML = ""; sp.appendChild(inp); inp.focus(); if (inp.select && f !== "date") inp.select();
        var finish = function (save) {
          if (done) return; done = true;
          var v = f === "date" ? inp.value : Number(inp.value);
          var ok = f === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(v) : isFinite(v) && v > 0;
          if (save && ok && String(v) !== String(sp.dataset.v)) onEdit(sp.dataset.id, f, v);   /* 저장되면 표 전체를 다시 그린다 */
          else sp.innerHTML = old;
        };
        inp.onkeydown = function (e) { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); e.stopPropagation(); };
        inp.onblur = function () { finish(true); };
        inp.onclick = function (e) { e.stopPropagation(); };
      };
      sp.onclick = open;
      sp.onkeydown = function (e) { if (e.key === "Enter" && e.target === sp) { e.preventDefault(); open(); } };
    });
  }

  /* ───────────── 과거 시세 ───────────── */
  function parseChart(text) {
    var s = text.indexOf('{"chart"'); if (s < 0) throw new Error("no chart");
    var j = JSON.parse(text.slice(s)), r = j.chart && j.chart.result && j.chart.result[0];
    if (!r || !r.timestamp) throw new Error("empty");
    var off = (r.meta && r.meta.gmtoffset) || 0, c = r.indicators.quote[0].close, adj = r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose;
    var d = [], v = [];
    r.timestamp.forEach(function (ts, i) {
      var x = c[i]; if (x == null || !(x > 0)) return;
      d.push(new Date((ts + off) * 1000).toISOString().slice(0, 10)); v.push(+x);
    });
    return { d: d, c: v };
  }
  /* 과거 시세 출처 순서
     ① 우리 사이트에 있는 일봉(데이터 허브: data/kr/<코드>.json 코스피·코스닥 시총 3,000억+, data/us/<티커>.json S&P500 상위) — 즉시, 제한 없음
     ② 야후(읽기 전용 중계) — 한 번에 하나씩, 실패하면 2초·5초 쉬고 다시
     ③ 그래도 없으면 '근사': 매매 체결가와 현재가를 이은 계단식 가격(표시해 줌). 절대 계산에서 빼지 않는다. */
  async function siteHist(key) {
    var m = key.split(":")[0], sym = key.split(":")[1], path;
    if (m === "KR") { var code = sym.replace(/\.(KS|KQ)$/, ""); if (!/^\d{6}$/.test(code)) return null; path = "data/kr/" + code + ".json"; }
    else path = "data/us/" + sym.replace(/[^A-Z0-9.\-]/g, "") + ".json";
    try {
      var r = await fetch(path, { cache: "no-cache" }); if (!r.ok) return null;
      var j = await r.json(), pts = j && j.price && j.price.points;
      if (!pts || pts.length < 5) return null;
      return { d: pts.map(function (p) { return p.date; }), c: pts.map(function (p) { return +p.value; }), src: "site" };
    } catch (e) { return null; }
  }
  var Q = Promise.resolve();   // 중계 요청은 한 줄로 세운다(동시에 몰리면 막힘)
  function relay(sym, from) {
    var job = Q.then(async function () {
      var p1 = Math.floor(new Date(from + "T00:00:00Z").getTime() / 1000) - 86400 * 10, p2 = Math.floor(Date.now() / 1000) + 86400;
      var url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?period1=" + p1 + "&period2=" + p2 + "&interval=1d";
      var waits = [0, 2000, 5000];
      for (var i = 0; i < waits.length; i++) {
        if (waits[i]) await new Promise(function (r) { setTimeout(r, waits[i]); });
        try {
          var r = await fetch("https://r.jina.ai/" + url.replace(/&/g, "%26"), { cache: "no-store" });
          if (r.ok) { var h = parseChart(await r.text()); if (h.d.length) { await new Promise(function (ok) { setTimeout(ok, 700); }); return h; } }
        } catch (e) {}
      }
      throw new Error("hist");
    });
    Q = job.catch(function () {});
    return job;
  }
  async function stockHist(key, from, force) {
    var sym = key.split(":")[1], cache = lsGet(CACHE, {}), c = cache[sym];
    if (!force && c && c.at === today() && c.from <= from) return c;
    var h = await siteHist(key);
    if (!h || h.d[0] > from) {
      var y = null;
      try {
        if (/\.(KS|KQ)$/.test(sym)) {   // 접미사가 틀리면 옛날 가격이 오기도 해서 둘 다 보고 더 최근 것
          var alt = sym.replace(/\.(KS|KQ)$/, function (m) { return m === ".KS" ? ".KQ" : ".KS"; });
          var a = await relay(sym, from).catch(function () { return null; }), b = await relay(alt, from).catch(function () { return null; });
          y = [a, b].filter(function (x) { return x && x.d.length; }).sort(function (p, q) { return String(q.d[q.d.length - 1]).localeCompare(String(p.d[p.d.length - 1])); })[0] || null;
        } else y = await relay(sym, from);
      } catch (e) { y = null; }
      if (y) { y.src = "yahoo"; h = y; }
    }
    if (!h) throw new Error("hist");
    h.at = today(); h.from = from;
    cache = lsGet(CACHE, {}); cache[sym] = h;
    var keys = Object.keys(cache); if (keys.length > 80) keys.slice(0, keys.length - 80).forEach(function (k) { delete cache[k]; });
    lsSet(CACHE, cache);
    return h;
  }
  var BH = null;
  async function benchHist() {
    if (BH) return BH;
    try { var r = await fetch("data/bench_hist.json", { cache: "no-cache" }); if (r.ok) BH = (await r.json()).series || {}; } catch (e) {}
    return BH || {};
  }
  function ffill(h, dates) {   // 날짜 달력에 맞춰 직전 종가로 채움
    var out = new Array(dates.length), j = 0, last = null;
    for (var i = 0; i < dates.length; i++) { while (j < h.d.length && h.d[j] <= dates[i]) { last = h.c[j]; j++; } out[i] = last; }
    return out;
  }
  /* 시세를 끝내 못 받은 종목: 체결가(그 날짜)와 현재가(오늘)를 이은 계단식 가격 */
  function approxHist(key, txs, state) {
    var pts = {};
    txs.forEach(function (t) { if (keyOf(t) === key) pts[t.date] = Number(t.price); });
    var q = state.prices && state.prices[key]; if (q && q.price > 0) pts[today()] = Number(q.price);
    var d = Object.keys(pts).sort();
    return { d: d, c: d.map(function (x) { return pts[x]; }), src: "approx" };
  }
  /* 오늘 시세(포트폴리오 새로고침으로 받은 값)를 마지막 점으로 붙여 그래프 끝을 현황과 맞춘다 */
  function withToday(h, key, state) {
    var q = state.prices && state.prices[key], t = today();
    if (!h || !q || !(q.price > 0) || !h.d.length || h.d[h.d.length - 1] >= t) return h;
    return { d: h.d.concat([t]), c: h.c.concat([Number(q.price)]), src: h.src };
  }

  /* ───────────── 수익률 계산(총자산 기준) ─────────────
     총자산 = 주식 평가액 + 예수금. 과거 예수금은 모르므로 매매로 거꾸로 만든다:
     - 매수는 예수금 → 주식, 매도는 주식 → 예수금(계좌 안 이동이라 수익률에 영향 없음)
     - 예수금이 모자라는 날은 그만큼 '입금'이 있었다고 본다(외부 자금 유입)
     - 지금 예수금이 매매만으로 계산한 값보다 많으면 그 차이는 처음부터 계좌에 있던 돈으로 본다(현금 비중만큼 수익률이 희석)
     - 적으면 그만큼 마지막에 '출금'이 있었다고 본다
     일간 수익률 = (총자산 오늘 − 입출금 오늘) / 총자산 어제 − 1 (시간가중) */
  function compute(state, acct, txs, H, fxH, dates) {
    var fxNow = Number(state.fx && state.fx.price) || 1350, fx = ffill(fxH, dates), px = {};
    Object.keys(H).forEach(function (k) { px[k] = H[k] ? ffill(H[k], dates) : null; });
    var cashNow = (Number(acct.cashKrw) || 0) + (Number(acct.cashUsd) || 0) * fxNow;
    var net = 0; txs.forEach(function (t) { net += (t.side === "sell" ? 1 : -1) * amtKrw(t, state); });
    var seed = Number(acct.seed) || 0, c0 = seed > 0 ? seed : Math.max(0, cashNow - net);   // 시작 시드를 적어 두면 그 돈으로 시작
    var qty = {}, ti = 0, cash = c0, prevT = 0, idx = 1, series = [], deposits = c0, withdrawn = 0;
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i], nb = 0, dayT = [], ext = i === 0 ? c0 : 0;
      while (ti < txs.length && txs[ti].date <= d) {
        var t = txs[ti++], k = keyOf(t), q = Number(t.qty) || 0, a = amtKrw(t, state);
        if (t.side === "sell") { var s = Math.min(q, qty[k] || 0); qty[k] = (qty[k] || 0) - s; var got = a * (q ? s / q : 0); cash += got; nb -= got; }
        else { qty[k] = (qty[k] || 0) + q; cash -= a; nb += a; }
        dayT.push(t);
      }
      if (cash < 0) { ext += -cash; deposits += -cash; cash = 0; }
      if (i === dates.length - 1 && cash > cashNow + 1 && !(seed > 0 && !cashNow)) { /* 시드만 적고 예수금을 비워 두면 출금으로 보지 않음 */ ext -= cash - cashNow; withdrawn += cash - cashNow; cash = cashNow; }
      var V = 0;
      Object.keys(qty).forEach(function (k) {
        if (!(qty[k] > 1e-9)) return;
        var p = px[k] && px[k][i]; if (p == null) return;
        V += qty[k] * p * (k.indexOf("US:") === 0 ? (fx[i] || fxNow) : 1);
      });
      var T = V + cash, r = 0;
      if (prevT > 0) r = (T - ext) / prevT - 1; else if (ext > 0) r = T / ext - 1;
      if (!isFinite(r) || Math.abs(r) > 0.6) r = 0;   // 액면분할·데이터 오류 방어
      idx *= 1 + r;
      series.push({ d: d, idx: idx, v: V, cash: cash, tot: T, ext: ext, nb: nb, t: dayT });
      prevT = T;
    }
    return { series: series, principal: deposits - withdrawn, deposits: deposits, withdrawn: withdrawn, c0: c0 };
  }

  /* ───────────── 국내·해외 따로(주식만, 시간가중) ─────────────
     그 시장 종목만 본다. 하루 수익률 = (오늘 평가액 − 오늘 순매수) / 어제 평가액 − 1.
     처음 산 날은 (그날 종가 평가액 / 매수액 − 1) — 체결가에서 종가까지의 손익부터 들어간다.
     해외는 달러 기준(지수와 같은 통화)으로 계산하고, 환율까지 넣은 원화 기준(idxK)도 따로 쌓는다. */
  function segCompute(state, txs, H, fxH, dates, mkt) {
    var T = txs.filter(function (t) { return (t.market === "KR" ? "KR" : "US") === mkt; });
    if (!T.length) return null;
    var fxNow = Number(state.fx && state.fx.price) || 1350, fx = ffill(fxH, dates), px = {};
    T.forEach(function (t) { var k = keyOf(t); if (!(k in px)) px[k] = H[k] ? ffill(H[k], dates) : null; });
    var qty = {}, ti = 0, pv = 0, pvk = 0, idx = 1, idxK = 1, out = [], start = -1, inv = 0, invK = 0;
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i], nb = 0, nbK = 0, dayT = [];
      while (ti < T.length && T[ti].date <= d) {
        var t = T[ti++], k = keyOf(t), q = Number(t.qty) || 0, a = q * (Number(t.price) || 0), aK = amtKrw(t, state);
        if (t.side === "sell") { var sq = Math.min(q, qty[k] || 0), fr = q ? sq / q : 0; qty[k] = (qty[k] || 0) - sq; nb -= a * fr; nbK -= aK * fr; }
        else { qty[k] = (qty[k] || 0) + q; nb += a; nbK += aK; }
        dayT.push(t);
      }
      var V = 0, VK = 0, f = mkt === "US" ? (fx[i] || fxNow) : 1;
      Object.keys(qty).forEach(function (k) { if (!(qty[k] > 1e-9)) return; var p = px[k] && px[k][i]; if (p == null) return; V += qty[k] * p; VK += qty[k] * p * f; });
      var r = pv > 0 ? (V - nb) / pv - 1 : nb > 0 ? V / nb - 1 : 0;
      var rk = pvk > 0 ? (VK - nbK) / pvk - 1 : nbK > 0 ? VK / nbK - 1 : 0;
      if (!isFinite(r) || Math.abs(r) > 0.6) r = 0;
      if (!isFinite(rk) || Math.abs(rk) > 0.6) rk = 0;
      if (start < 0 && nb > 0) start = i;
      idx *= 1 + r; idxK *= 1 + rk; inv += nb; invK += nbK;
      out.push({ d: d, idx: idx, idxK: idxK, v: V, vk: VK, tot: VK, cash: 0, nb: nbK, nbL: nb, t: dayT, inv: inv, invK: invK });
      pv = V; pvk = VK;
    }
    return { series: out, start: Math.max(0, start), mkt: mkt };
  }

  /* ───────────── 수익률 평가 ───────────── */
  var P = { el: null, data: null, sel: null, benches: null, range: null, run: 0, seg: "all", view: null };
  async function perf(el, state, id, opt) {
    opt = opt || {};
    P.el = el;
    var run = ++P.run, acct = state.accounts.filter(function (a) { return a.id === id; })[0] || {};
    var txs = txsOf(state, id);
    if (!txs.length) { el.innerHTML = '<div class="empty-row">매매 기록이 있어야 수익률을 계산할 수 있습니다.</div>'; return; }
    P.benches = lsGet(BSEL, ["^KS11", "^KQ11", "^IXIC"]); P.range = lsGet(RSEL, "전체");
    P.view = lsGet(VSEL, { seg: "all", chart: "asset", tf: "D", tbl: "M", v2: 1 }); P.seg = P.view.seg || "all";
    if (!P.view.v2) { P.view.chart = "asset"; P.view.v2 = 1; lsSet(VSEL, P.view); P.benches = ["^KS11", "^KQ11", "^IXIC"]; lsSet(BSEL, P.benches); }
    var from = txs[0].date, keys = {};
    if (acct.seed > 0 && acct.seedDate && acct.seedDate < from) from = acct.seedDate;
    txs.forEach(function (t) { keys[keyOf(t)] = 1; });
    var K = Object.keys(keys), H = {}, status = {};
    K.forEach(function (k) { H[k] = null; status[k] = "wait"; });
    if (!P.data) el.innerHTML = '<div class="empty-row">지수·환율 불러오는 중…</div>';
    var B = await benchHist();
    if (run !== P.run) return;
    function rebuild() {
      if (run !== P.run) return;
      var HH = {};
      // 받는 중·실패여도 근사 가격으로 넣는다(빼면 수익률이 틀어짐)
      K.forEach(function (k) { HH[k] = withToday(H[k] || approxHist(k, txs, state), k, state); });
      var fxH = B["KRW=X"] || { d: [from], c: [Number(state.fx && state.fx.price) || 1350] };
      var set = {};
      K.forEach(function (k) { if (HH[k]) HH[k].d.forEach(function (d) { if (d >= from) set[d] = 1; }); });
      ["^KS11", "^GSPC"].forEach(function (b) { if (B[b]) B[b].d.forEach(function (d) { if (d >= from) set[d] = 1; }); });
      var dates = Object.keys(set).sort();
      if (!dates.length || dates[0] > from) dates.unshift(from);
      var res = compute(state, acct, txs, HH, fxH, dates);
      var bs = {}; BENCH.forEach(function (b) { bs[b[0]] = B[b[0]] ? ffill(B[b[0]], dates) : null; });
      var keep = P.data && P.data.dates && P.sel ? [P.data.dates[P.sel[0]], P.data.dates[P.sel[1]]] : null;
      P.data = { state: state, acct: acct, txs: txs, dates: dates, s: res.series, bs: bs, res: res, status: status, K: K, fx: ffill(fxH, dates),
                 segs: { KR: segCompute(state, txs, HH, fxH, dates, "KR"), US: segCompute(state, txs, HH, fxH, dates, "US") } };
      P.sel = keep ? [Math.max(0, dates.indexOf(keep[0])), Math.max(0, dates.indexOf(keep[1]))] : null;
      if (P.sel && (P.sel[1] <= P.sel[0])) P.sel = null;
      draw();
    }
    var pend = K.length, tmr = null;
    function soon() { clearTimeout(tmr); tmr = setTimeout(rebuild, 350); }
    await Promise.all(K.map(async function (k) {
      try { H[k] = await stockHist(k, from, opt.force); status[k] = H[k].src || "ok"; }
      catch (e) { status[k] = "fail"; }
      pend--; soon();
    }));
    clearTimeout(tmr); rebuild();
  }
  function reload() { if (P.data) perf(P.el, P.data.state, P.data.acct.id, { force: true }); }

  function rangeStart(dates) {
    var r = RANGES.filter(function (x) { return x[0] === P.range; })[0] || RANGES[5], end = dates[dates.length - 1];
    if (!r[1]) return 0;
    var e = new Date(end + "T00:00:00Z"), s;
    if (r[1] === "ytd") s = end.slice(0, 4) + "-01-01";
    else { e.setUTCMonth(e.getUTCMonth() - r[1]); s = e.toISOString().slice(0, 10); }
    for (var i = 0; i < dates.length; i++) if (dates[i] >= s) return Math.max(0, i - 1);
    return 0;
  }
  function retBetween(arr, a, b) { var x = arr[a], y = arr[b]; return x && y ? (y / x - 1) * 100 : null; }
  function accRet(s, a, b) { return (s[b].idx / s[a].idx - 1) * 100; }
  function mdd(s, a, b) { var pk = -1, m = 0; for (var i = a; i <= b; i++) { pk = Math.max(pk, s[i].idx); m = Math.min(m, s[i].idx / pk - 1); } return m * 100; }

  function draw() {
    var D = P.data, el = P.el;
    var seg = P.seg = (P.seg === "all" || (D.segs[P.seg])) ? P.seg : "all", SG = seg === "all" ? null : D.segs[seg];
    D.cs = SG ? SG.series : D.s; D.seg = seg;
    var s = D.cs, dates = D.dates, n = dates.length;
    var a = Math.max(rangeStart(dates), SG ? SG.start : 0), b = n - 1;
    if (a >= b) a = Math.max(0, b - 1);
    var sel = P.sel || [a, b];
    var bsel = BENCH.filter(function (x) { return (SG ? SEG_BENCH[seg] : P.benches).indexOf(x[0]) >= 0 && D.bs[x[0]]; });
    var main = bsel[0];
    var acc = accRet(s, a, b), bm = main ? retBetween(D.bs[main[0]], a, b) : null, R = D.res, last = s[b];
    var pnl = last.tot - R.principal, pnlPct = R.principal > 0 ? pnl / R.principal * 100 : null;
    var cards = SG ? segCards(SG, s, a, b, acc, main, bm) : [
      ["총자산 수익률 (" + P.range + ")", pct(acc), cls(acc), "주식+예수금 · 입출금 효과 제외(시간가중)"],
      [main ? main[1] + " 대비 초과" : "벤치마크", bm == null ? "—" : pct(acc - bm), cls(bm == null ? null : acc - bm), main ? main[1] + " " + pct(bm) : ""],
      ["원금 대비 손익 (전체)", krw(pnl) + (pnlPct == null ? "" : " · " + pct(pnlPct)), cls(pnl), "추정 원금 " + krw(R.principal) + (R.withdrawn > 1 ? " (출금 " + krw(R.withdrawn) + " 반영)" : "")],
      ["현재 총자산", krw(last.tot), "", "주식 " + krw(last.v) + " · 예수금 " + krw(last.cash)],
      ["최대 낙폭(MDD)", pct(mdd(s, a, b)), "neg", dates[a] + " ~ " + dates[b]]
    ];
    var st = D.status, loading = D.K.filter(function (k) { return st[k] === "wait"; }), fail = D.K.filter(function (k) { return st[k] === "fail"; });
    function nm(k) { return S.displayTicker(k.split(":")[1]); }
    var warn = (loading.length ? "⏳ 시세 받는 중 " + (D.K.length - loading.length) + "/" + D.K.length + " — 끝날 때까지 그래프가 계속 바뀝니다(받는 동안은 체결가·현재가로 근사). " : "") +
      (fail.length ? "⚠️ 과거 시세를 못 받은 종목(체결가와 현재가를 이은 근사 가격으로 계산): " + esc(fail.map(nm).join(", ")) + " " : "");
    var V = P.view;
    el.innerHTML =
      '<div class="pf-bar pf-segbar"><div class="pf-seg" id="pf-segs">' + SEGS.map(function (x) { var ok = x[0] === "all" || D.segs[x[0]]; return '<button data-v="' + x[0] + '" class="' + (seg === x[0] ? "on" : "") + '"' + (ok ? "" : " disabled title=\"이 계좌에는 해당 종목이 없습니다\"") + ">" + x[1] + "</button>"; }).join("") + "</div>" +
      '<span class="pf-hint">' + (seg === "KR" ? "한국 종목만 · 처음 산 날(" + dates[SG.start] + ")부터 · 코스피·코스닥과 비교" : seg === "US" ? "미국 종목만 · 처음 산 날(" + dates[SG.start] + ")부터 · 달러 기준으로 S&P500·나스닥과 비교(원화 환산은 카드에)" : "주식 + 예수금 전체") + "</span>" +
      '<div class="pf-seg" id="pf-view">' + [["asset", "자산"], ["candle", "봉차트"], ["line", "수익률 선"]].map(function (x) { return '<button data-v="' + x[0] + '" class="' + ((V.chart || "asset") === x[0] ? "on" : "") + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      (V.chart === "candle" ? '<div class="pf-seg" id="pf-tf">' + [["D", "일봉"], ["W", "주봉"], ["M", "월봉"]].map(function (x) { return '<button data-v="' + x[0] + '" class="' + ((V.tf || "D") === x[0] ? "on" : "") + '">' + x[1] + "</button>"; }).join("") + "</div>" : "") + "</div>" +
      seedBar(D.acct) +
      '<div class="pf-cards">' + cards.map(function (c) { return '<div class="metric"><span>' + c[0] + '</span><b class="' + c[2] + '">' + c[1] + "</b><small>" + esc(c[3]) + "</small></div>"; }).join("") + "</div>" +
      '<div class="pf-bar"><div class="pf-seg" id="pf-range">' + RANGES.map(function (r) { return '<button data-v="' + r[0] + '" class="' + (P.range === r[0] ? "on" : "") + '">' + r[0] + "</button>"; }).join("") + "</div>" +
      (SG ? "" : '<div class="pf-chips" id="pf-bench">' + BENCH.map(function (x) { var on = P.benches.indexOf(x[0]) >= 0; return '<button data-v="' + x[0] + '" class="' + (on ? "on" : "") + '"' + (D.bs[x[0]] ? "" : " disabled") + '><i style="background:' + x[2] + '"></i>' + x[1] + "</button>"; }).join("") + "</div>") +
      '<span class="pf-hint">그래프를 끌어서 기간 선택 · 월을 누르면 그 달</span></div>' +
      '<div class="pf-chart" id="pf-chart"></div>' +
      '<div class="pf-legend">' + (V.chart === "asset" ? '<span><i style="background:' + ACC + '"></i>' + (SG ? SEG_NAME[seg] + " 평가액" : "내 계좌 총자산") + '</span><span><i style="background:#94a3b8"></i>넣은 돈(원금)</span><span class="muted">지수 선 = 같은 날 같은 돈을 그 지수에 넣었다면(해외 지수는 원화 환산)</span>' : V.chart !== "line" ? '<span><i style="background:#f0475a"></i><i style="background:#3d7eff;margin-left:-3px"></i> ' + SEG_NAME[seg] + " 봉(빨강 상승 · 파랑 하락)</span>" : '<span><i style="background:' + ACC + '"></i>' + SEG_NAME[seg] + "</span>") + bsel.map(function (x) { return '<span><i style="background:' + x[2] + '"></i>' + x[1] + "</span>"; }).join("") + '<span><b style="color:#f0475a">▲</b> 매수</span><span><b style="color:#3d7eff">▼</b> 매도</span><span class="muted">아래 막대 = 그날 순매수(빨강)·순매도(파랑) 금액</span></div>' +
      (warn ? '<div class="pf-warn">' + warn + (loading.length ? "" : '<button class="quiet-btn" id="pf-retry">다시 받기</button>') + "</div>" : "") +
      '<div id="pf-period"></div><div id="pf-months"></div>';
    var cbox = document.getElementById("pf-chart");
    if ((V.chart || "asset") === "asset") assetChart(cbox, a, b, bsel, sel); else if (V.chart !== "line") candles(cbox, a, b, bsel, sel, V.tf || "D"); else chart(cbox, a, b, bsel, sel);
    var sf = document.getElementById("pf-seed");
    if (sf) sf.onsubmit = function (e) {
      e.preventDefault();
      var amt = Number(String(sf.querySelector("[name=seed]").value).replace(/[^0-9.]/g, "")) * 10000, dt = sf.querySelector("[name=seedDate]").value;
      var st = P.data.state, ac = st.accounts.filter(function (x) { return x.id === P.data.acct.id; })[0];
      if (!ac) return;
      if (amt > 0) { ac.seed = amt; ac.seedDate = dt || P.data.txs[0].date; } else { delete ac.seed; delete ac.seedDate; }
      S.save(st); perf(P.el, st, ac.id);
    };
    period(sel[0], sel[1], bsel);
    if ((V.tbl || "M") === "D") dailyTbl(a, b, bsel); else months(a, b, bsel);
    var rb = document.getElementById("pf-retry"); if (rb) rb.onclick = reload;
    function setV(k, v) { P.view[k] = v; lsSet(VSEL, P.view); }
    el.querySelectorAll("#pf-segs button").forEach(function (x) { x.onclick = function () { if (x.disabled) return; P.seg = x.dataset.v; setV("seg", P.seg); P.sel = null; draw(); }; });
    el.querySelectorAll("#pf-view button").forEach(function (x) { x.onclick = function () { setV("chart", x.dataset.v); draw(); }; });
    el.querySelectorAll("#pf-tf button").forEach(function (x) { x.onclick = function () { setV("tf", x.dataset.v); draw(); }; });
    el.querySelectorAll("[data-tbl]").forEach(function (x) { x.onclick = function () { setV("tbl", x.dataset.tbl); draw(); }; });
    el.querySelectorAll("#pf-range button").forEach(function (x) { x.onclick = function () { P.range = x.dataset.v; lsSet(RSEL, P.range); P.sel = null; draw(); }; });
    el.querySelectorAll("#pf-bench button").forEach(function (x) { x.onclick = function () {
      var i = P.benches.indexOf(x.dataset.v); if (i >= 0) P.benches.splice(i, 1); else P.benches.push(x.dataset.v);
      P.benches.sort(function (p, q) { return BENCH.findIndex(function (z) { return z[0] === p; }) - BENCH.findIndex(function (z) { return z[0] === q; }); });
      lsSet(BSEL, P.benches); draw(); }; });
  }

  /* 시작 시드 입력줄 — 만원 단위 */
  function seedBar(acct) {
    var v = Number(acct.seed) || 0;
    return '<form class="pf-seedbar" id="pf-seed"><span>시작 시드</span><label><input name="seed" inputmode="numeric" value="' + (v ? Math.round(v / 10000) : "") + '" placeholder="5000"> 만원</label>' +
      '<label>시작일 <input type="date" name="seedDate" value="' + esc(acct.seedDate || "") + '"></label><button class="quiet-btn" type="submit">저장</button>' +
      '<small>' + (v ? "이 돈으로 시작했다고 보고 예수금 흐름을 계산합니다" : "적어 두면 그날 그 돈으로 시작한 것으로 계산(비우면 현재 예수금으로 거꾸로 추정)") + "</small></form>";
  }
  function won(v) { var a = Math.abs(v); return (v < 0 ? "−" : "") + (a >= 1e8 ? (a / 1e8).toFixed(a >= 1e9 ? 1 : 2) + "억" : Math.round(a / 1e4).toLocaleString("ko-KR") + "만"); }
  /* 자산 곡선: 계좌(총자산 또는 국내·해외 평가액)를 원화 금액으로. 지수 선은 '같은 날 같은 돈을 그 지수에 넣고 뺐다면'의 금액 —
     시작일 금액으로 지수를 사고, 이후 입금·순매수는 그날 지수로 더 사고, 출금·순매도는 그날 지수로 판다. 해외 지수는 그날 환율로 원화 환산. */
  function assetChart(box, a, b, bsel, sel) {
    var D = P.data, s = D.cs, dates = D.dates, SG = D.seg !== "all";
    function val(i) { return SG ? s[i].vk : s[i].tot; }
    function flow(i) { return SG ? s[i].nb : s[i].ext; }
    var W = Math.max(320, box.clientWidth - 2), H = 360, m = { l: 62, r: 14, t: 14, b: 64 }, iw = W - m.l - m.r, ih = H - m.t - m.b - 36, len = b - a;
    function x(i) { return m.l + (len ? (i - a) / len * iw : iw / 2); }
    var me = [], inv = [], cum = val(a);
    for (var i = a; i <= b; i++) { if (i > a) cum += flow(i); me.push(val(i)); inv.push(Math.max(0, cum)); }
    var lines = [{ c: ACC, v: me, w: 2.6, n: SG ? SEG_NAME[D.seg] : "내 계좌" }, { c: "#94a3b8", v: inv, w: 1.4, dash: "5 4", n: "넣은 돈" }];
    bsel.forEach(function (bb) {
      var arr = D.bs[bb[0]], us = bb[0] === "^GSPC" || bb[0] === "^IXIC", v = [], units = null;
      for (var i = a; i <= b; i++) {
        var px = arr[i] ? arr[i] * (us ? (D.fx[i] || 1350) : 1) : null;
        if (px == null) { v.push(null); continue; }
        if (units == null) units = val(a) / px; else units = Math.max(0, units + flow(i) / px);
        v.push(units * px);
      }
      lines.push({ c: bb[2], v: v, w: 1.6, n: bb[1] });
    });
    var all = []; lines.forEach(function (l) { l.v.forEach(function (v) { if (v != null) all.push(v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * .1 || hi * .05 || 1; lo = Math.max(0, lo - pad); hi += pad;
    function y(v) { return m.t + (hi - v) / (hi - lo) * ih; }
    var step = (function (sp) { var r = sp / 5, p = Math.pow(10, Math.floor(Math.log10(r))), q = r / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; })(hi - lo), g = "";
    if (sel && (sel[0] !== a || sel[1] !== b)) g += '<rect x="' + x(Math.max(a, sel[0])) + '" y="' + m.t + '" width="' + Math.max(2, x(Math.min(b, sel[1])) - x(Math.max(a, sel[0]))) + '" height="' + (ih + 36) + '" fill="rgba(91,140,255,.13)"/>';
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (m.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + won(t) + "</text>";
    var lastLx = -99, prevM = "";
    for (var k = a; k <= b; k++) { var mo = dates[k].slice(0, 7); if (mo !== prevM) { prevM = mo; if (x(k) - lastLx > 52) { g += '<text x="' + x(k) + '" y="' + (H - 8) + '" text-anchor="middle">' + mo.slice(2).replace("-", ".") + "</text>"; lastLx = x(k); } } }
    // 내 계좌 아래 옅은 면
    var area = "M" + x(a) + "," + y(lo);
    me.forEach(function (v, j) { area += "L" + x(a + j).toFixed(1) + "," + y(v).toFixed(1); });
    g += '<path d="' + area + "L" + x(b) + "," + y(lo) + 'Z" fill="rgba(240,71,90,.07)"/>';
    lines.slice().reverse().forEach(function (l) {
      var d = "", pen = false;
      l.v.forEach(function (v, j) { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(a + j).toFixed(1) + "," + y(v).toFixed(1); pen = true; });
      g += '<path d="' + d + '" fill="none" stroke="' + l.c + '" stroke-width="' + l.w + '"' + (l.dash ? ' stroke-dasharray="' + l.dash + '"' : "") + "/>";
    });
    // 끝값 라벨
    lines.forEach(function (l) { var v = l.v[l.v.length - 1]; if (v != null && l.n !== "넣은 돈") g += '<circle cx="' + x(b) + '" cy="' + y(v) + '" r="3" fill="' + l.c + '"/>'; });
    var base = m.t + ih + 34, maxF = 1;
    for (var q = a; q <= b; q++) maxF = Math.max(maxF, Math.abs(s[q].nb));
    g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (base - 16) + '" y2="' + (base - 16) + '"/>';
    for (var q2 = a; q2 <= b; q2++) {
      var sd = s[q2]; if (!sd.t.length) continue;
      var buys = sd.t.some(function (t) { return t.side !== "sell"; }), sells = sd.t.some(function (t) { return t.side === "sell"; }), px2 = x(q2), py = y(me[q2 - a]);
      if (buys) g += '<path d="M' + (px2 - 4.5) + "," + (py + 11) + "L" + (px2 + 4.5) + "," + (py + 11) + "L" + px2 + "," + (py + 3.5) + 'Z" fill="#f0475a"/>';
      if (sells) g += '<path d="M' + (px2 - 4.5) + "," + (py - 11) + "L" + (px2 + 4.5) + "," + (py - 11) + "L" + px2 + "," + (py - 3.5) + 'Z" fill="#3d7eff"/>';
      var hgt = Math.max(2, Math.abs(sd.nb) / maxF * 30);
      g += '<rect x="' + (px2 - 1.5) + '" y="' + (sd.nb >= 0 ? base - 16 - hgt / 2 : base - 16) + '" width="3" height="' + (hgt / 2) + '" fill="' + (sd.nb >= 0 ? "#f0475a" : "#3d7eff") + '"/>';
    }
    g += '<text x="' + (m.l - 6) + '" y="' + (base - 12) + '" text-anchor="end">매매</text>';
    g += '<line class="hair" x1="0" x2="0" y1="' + m.t + '" y2="' + base + '" stroke="var(--text)" stroke-dasharray="3 3" opacity=".45" style="display:none"/><rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + (ih + 36) + '" fill="transparent" style="cursor:crosshair"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '">' + g + '</svg><div class="pf-tip"></div>';
    var svg = box.querySelector("svg"), hit = box.querySelector(".hit"), hair = box.querySelector(".hair"), tip = box.querySelector(".pf-tip");
    function idxAt(e) { var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width; return Math.max(a, Math.min(b, Math.round(a + (px - m.l) / iw * len))); }
    var drag = null;
    hit.addEventListener("mousedown", function (e) {
      drag = idxAt(e); e.preventDefault();
      window.addEventListener("mouseup", function up(ev) {
        window.removeEventListener("mouseup", up);
        if (drag == null) return; var j = idxAt(ev), i0 = Math.min(drag, j), i1 = Math.max(drag, j); drag = null;
        if (i1 - i0 >= 1) { P.sel = [i0, i1]; draw(); }
      });
    });
    hit.addEventListener("mousemove", function (e) {
      var i = idxAt(e), j = i - a, sd = s[i], invj = inv[j];
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.style.display = "";
      var html = "<b>" + dates[i] + "</b>";
      lines.forEach(function (l) { var v = l.v[j]; if (v == null) return; html += "<br>" + '<span style="color:' + l.c + '">●</span> ' + esc(l.n) + " <b>" + krw(v) + "</b>" + (l.n !== "넣은 돈" && invj > 0 ? ' <span class="muted">' + pct((v / invj - 1) * 100) + "</span>" : ""); });
      if (sd.t.length) html += "<br>" + sd.t.map(function (t) { return '<span class="' + (t.side === "sell" ? "sell" : "buy") + '">' + (t.side === "sell" ? "매도" : "매수") + "</span> " + esc(S.displayTicker(t.ticker)) + " " + num(t.qty, 4) + "주"; }).join("<br>");
      tip.innerHTML = html; tip.style.display = "block";
      var lx = e.clientX - box.getBoundingClientRect().left + 14; if (lx > box.clientWidth - 230) lx -= 244; tip.style.left = lx + "px"; tip.style.top = "12px";
    });
    hit.addEventListener("mouseleave", function () { hair.style.display = "none"; tip.style.display = "none"; });
  }

  function chart(box, a, b, bsel, sel) {
    var D = P.data, s = D.cs, dates = D.dates;
    var W = Math.max(320, box.clientWidth - 2), H = 330, m = { l: 50, r: 14, t: 12, b: 64 }, iw = W - m.l - m.r, ih = H - m.t - m.b - 36;
    var len = b - a;
    function x(i) { return m.l + (len ? (i - a) / len * iw : iw / 2); }
    var lines = [{ c: ACC, v: [], w: 2.4 }];
    for (var i = a; i <= b; i++) lines[0].v.push((s[i].idx / s[a].idx - 1) * 100);
    bsel.forEach(function (bb) { var arr = D.bs[bb[0]], v = []; for (var i = a; i <= b; i++) v.push(arr[a] && arr[i] ? (arr[i] / arr[a] - 1) * 100 : null); lines.push({ c: bb[2], v: v, w: 1.6 }); });
    var all = []; lines.forEach(function (l) { l.v.forEach(function (v) { if (v != null) all.push(v); }); });
    var lo = Math.min.apply(null, all.concat([0])), hi = Math.max.apply(null, all.concat([0])), pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    function y(v) { return m.t + (hi - v) / (hi - lo) * ih; }
    var g = "", step = (function (sp) { var r = sp / 5, p = Math.pow(10, Math.floor(Math.log10(r))), q = r / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; })(hi - lo);
    // 선택 구간 음영
    if (sel && (sel[0] !== a || sel[1] !== b)) g += '<rect x="' + x(Math.max(a, sel[0])) + '" y="' + m.t + '" width="' + Math.max(2, x(Math.min(b, sel[1])) - x(Math.max(a, sel[0]))) + '" height="' + (ih + 36) + '" fill="rgba(91,140,255,.13)"/>';
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (m.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + (t > 0 ? "+" : "") + (Math.abs(step) < 1 ? t.toFixed(1) : Math.round(t)) + "%</text>";
    g += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    // x축 라벨(월)
    var lastLx = -99, prevM = "";
    for (var k = a; k <= b; k++) { var mo = dates[k].slice(0, 7); if (mo !== prevM) { prevM = mo; if (x(k) - lastLx > 52) { g += '<text x="' + x(k) + '" y="' + (H - 8) + '" text-anchor="middle">' + mo.slice(2).replace("-", ".") + "</text>"; lastLx = x(k); } } }
    lines.slice().reverse().forEach(function (l) {
      var d = "", pen = false;
      l.v.forEach(function (v, j) { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(a + j).toFixed(1) + "," + y(v).toFixed(1); pen = true; });
      g += '<path d="' + d + '" fill="none" stroke="' + l.c + '" stroke-width="' + l.w + '"/>';
    });
    // 매매 표시 + 순매수 막대(아래 띠)
    var base = m.t + ih + 34, maxF = 1;
    for (var q = a; q <= b; q++) maxF = Math.max(maxF, Math.abs(s[q].nb));
    g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (base - 16) + '" y2="' + (base - 16) + '"/>';
    for (var q2 = a; q2 <= b; q2++) {
      var sd = s[q2]; if (!sd.t.length) continue;
      var buys = sd.t.some(function (t) { return t.side !== "sell"; }), sells = sd.t.some(function (t) { return t.side === "sell"; }), px = x(q2), py = y(lines[0].v[q2 - a]);
      if (buys) g += '<path d="M' + (px - 4.5) + "," + (py + 11) + "L" + (px + 4.5) + "," + (py + 11) + "L" + px + "," + (py + 3.5) + 'Z" fill="#f0475a"/>';
      if (sells) g += '<path d="M' + (px - 4.5) + "," + (py - 11) + "L" + (px + 4.5) + "," + (py - 11) + "L" + px + "," + (py - 3.5) + 'Z" fill="#3d7eff"/>';
      var hgt = Math.max(2, Math.abs(sd.nb) / maxF * 30);
      g += '<rect x="' + (px - 1.5) + '" y="' + (sd.nb >= 0 ? base - 16 - hgt / 2 : base - 16) + '" width="3" height="' + (hgt / 2) + '" fill="' + (sd.nb >= 0 ? "#f0475a" : "#3d7eff") + '"/>';
    }
    g += '<text x="' + (m.l - 6) + '" y="' + (base - 12) + '" text-anchor="end">매매</text>';
    g += '<line class="hair" x1="0" x2="0" y1="' + m.t + '" y2="' + (base) + '" stroke="var(--text)" stroke-dasharray="3 3" opacity=".45" style="display:none"/><rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + (ih + 36) + '" fill="transparent" style="cursor:crosshair"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '">' + g + '</svg><div class="pf-tip"></div>';
    var svg = box.querySelector("svg"), hit = box.querySelector(".hit"), hair = box.querySelector(".hair"), tip = box.querySelector(".pf-tip");
    function idxAt(e) { var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width; return Math.max(a, Math.min(b, Math.round(a + (px - m.l) / iw * len))); }
    var drag = null;
    hit.addEventListener("mousedown", function (e) {
      drag = idxAt(e); e.preventDefault();
      window.addEventListener("mouseup", function up(ev) {
        window.removeEventListener("mouseup", up);
        if (drag == null) return; var j = idxAt(ev), i0 = Math.min(drag, j), i1 = Math.max(drag, j); drag = null;
        if (i1 - i0 >= 1) { P.sel = [i0, i1]; draw(); }
      });
    });
    hit.addEventListener("mousemove", function (e) {
      var i = idxAt(e), sd = s[i];
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.style.display = "";
      var html = "<b>" + dates[i] + "</b><br>" + '<span style="color:' + ACC + '">●</span> ' + SEG_NAME[D.seg] + ' <b>' + pct(lines[0].v[i - a]) + '</b> <span class="muted">총자산 ' + krw(sd.tot) + "</span>";
      bsel.forEach(function (bb, j) { html += "<br>" + '<span style="color:' + bb[2] + '">●</span> ' + bb[1] + " " + pct(lines[j + 1].v[i - a]); });
      if (drag != null && drag !== i) { var i0 = Math.min(drag, i), i1 = Math.max(drag, i); html += '<br><span class="muted">선택 ' + dates[i0] + " ~ " + dates[i1] + " · 계좌 " + pct(accRet(s, i0, i1)) + "</span>"; }
      if (sd.t.length) html += "<br>" + sd.t.map(function (t) { return '<span class="' + (t.side === "sell" ? "sell" : "buy") + '">' + (t.side === "sell" ? "매도" : "매수") + "</span> " + esc(S.displayTicker(t.ticker)) + " " + num(t.qty, 4) + "주"; }).join("<br>");
      tip.innerHTML = html; tip.style.display = "block";
      var lx = e.clientX - box.getBoundingClientRect().left + 14; if (lx > box.clientWidth - 210) lx -= 224; tip.style.left = lx + "px"; tip.style.top = "12px";
    });
    hit.addEventListener("mouseleave", function () { hair.style.display = "none"; tip.style.display = "none"; });
  }

  function tblHead(cur) {
    return '<div class="pf-th"><h3 class="pf-h3">' + (cur === "D" ? "일별" : "월별") + ' 수익률과 매매</h3><div class="pf-seg"><button data-tbl="M" class="' + (cur === "M" ? "on" : "") + '">월별</button><button data-tbl="D" class="' + (cur === "D" ? "on" : "") + '">일별</button></div></div>';
  }
  /* 국내·해외 탭의 카드 */
  function segCards(SG, s, a, b, acc, main, bm) {
    var last = s[b], us = SG.mkt === "US", fxNow = Number(P.data.state.fx && P.data.state.fx.price) || 1350;
    var accK = us ? (s[b].idxK / s[a].idxK - 1) * 100 : null, pnl = last.vk - last.invK;
    var c = [[(us ? "해외 수익률 · 달러 기준 (" : "국내 수익률 (") + P.range + ")", pct(acc), cls(acc), "주식만 · 매매로 넣고 뺀 돈의 효과 제외(시간가중)"],
      [main ? main[1] + " 대비 초과" : "지수 대비", bm == null ? "—" : pct(acc - bm), cls(bm == null ? null : acc - bm), main ? main[1] + " " + pct(bm) + " (같은 기간)" : ""]];
    if (us) c.push(["원화 환산 수익률", pct(accK), cls(accK), "환율 효과 " + pct(accK - acc) + "p"]);
    c.push(["평가액", krw(last.vk), "", (us ? "$" + num(last.v, 0) + " · " : "") + "넣은 돈(순매수) " + krw(last.invK)],
      ["원금 대비 손익", krw(pnl) + (last.invK > 0 ? " · " + pct(pnl / last.invK * 100) : ""), cls(pnl), "평가액 − 순매수 합계(원화, 실현손익 포함)"],
      ["최대 낙폭(MDD)", pct(mdd(s, a, b)), "neg", P.data.dates[a] + " ~ " + P.data.dates[b]]);
    return c;
  }
  /* 봉차트: 내 수익률 지수(시작일 = 0%)를 일·주·월 봉으로. 일봉은 시가 = 전날 종가(종목 시가 자료가 없어 몸통만), 주·월봉은 그 안 일별 종가로 고가·저가.
     지수는 같은 축에 선(같은 시작일 0%). 아래 띠 = 그 봉 기간 순매수(빨강)·순매도(파랑). */
  function candles(box, a, b, bsel, sel, tf) {
    var D = P.data, s = D.cs, dates = D.dates, base = s[a].idx;
    function key(d) {
      if (tf === "M") return d.slice(0, 7);
      if (tf === "W") { var x = new Date(d + "T00:00:00Z"), w = x.getUTCDay(); x.setUTCDate(x.getUTCDate() - ((w + 6) % 7)); return x.toISOString().slice(0, 10); }
      return d;
    }
    var G = [], g = null;
    for (var i = a + 1; i <= b; i++) {
      var k = key(dates[i]);
      if (!g || g.k !== k) { g = { k: k, i0: i - 1, i1: i, hi: -1e9, lo: 1e9, nb: 0, t: [] }; G.push(g); }
      g.i1 = i; var v = (s[i].idx / base - 1) * 100; g.hi = Math.max(g.hi, v); g.lo = Math.min(g.lo, v); g.nb += s[i].nb; g.t = g.t.concat(s[i].t);
    }
    G.forEach(function (x) { x.o = (s[x.i0].idx / base - 1) * 100; x.c = (s[x.i1].idx / base - 1) * 100; x.hi = Math.max(x.hi, x.o); x.lo = Math.min(x.lo, x.o); });
    if (!G.length) { box.innerHTML = '<div class="empty-row">봉을 그릴 기간이 부족합니다.</div>'; return; }
    var lines = bsel.map(function (bb) { var arr = D.bs[bb[0]]; return { c: bb[2], n: bb[1], v: G.map(function (x) { return arr[a] && arr[x.i1] ? (arr[x.i1] / arr[a] - 1) * 100 : null; }) }; });
    var all = [0]; G.forEach(function (x) { all.push(x.hi, x.lo); }); lines.forEach(function (l) { l.v.forEach(function (v) { if (v != null) all.push(v); }); });
    var W = Math.max(320, box.clientWidth - 2), H = 340, m = { l: 50, r: 14, t: 12, b: 64 }, iw = W - m.l - m.r, ih = H - m.t - m.b - 36;
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all), pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    var bw = iw / G.length, cw = Math.max(1.5, Math.min(14, bw * .62));
    function X(j) { return m.l + bw * (j + .5); }
    function Y(v) { return m.t + (hi - v) / (hi - lo) * ih; }
    var out = "", step = (function (sp) { var r = sp / 5, p = Math.pow(10, Math.floor(Math.log10(r))), q = r / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; })(hi - lo);
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) out += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/><text x="' + (m.l - 6) + '" y="' + (Y(t) + 4) + '" text-anchor="end">' + (t > 0 ? "+" : "") + (Math.abs(step) < 1 ? t.toFixed(1) : Math.round(t)) + "%</text>";
    out += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>';
    var lastLx = -99, prevM = "";
    G.forEach(function (x, j) { var mo = dates[x.i1].slice(0, 7); if (mo !== prevM) { prevM = mo; if (X(j) - lastLx > 52) { out += '<text x="' + X(j) + '" y="' + (H - 8) + '" text-anchor="middle">' + mo.slice(2).replace("-", ".") + "</text>"; lastLx = X(j); } } });
    if (sel && (sel[0] !== a || sel[1] !== b)) {
      var j0 = G.findIndex(function (x) { return x.i1 >= sel[0]; }), j1 = G.length - 1 - G.slice().reverse().findIndex(function (x) { return x.i0 <= sel[1]; });
      if (j0 >= 0) out += '<rect x="' + (X(j0) - bw / 2) + '" y="' + m.t + '" width="' + Math.max(2, (j1 - j0 + 1) * bw) + '" height="' + (ih + 36) + '" fill="rgba(91,140,255,.13)"/>';
    }
    lines.forEach(function (l) { var d = "", pen = false; l.v.forEach(function (v, j) { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + X(j).toFixed(1) + "," + Y(v).toFixed(1); pen = true; }); out += '<path d="' + d + '" fill="none" stroke="' + l.c + '" stroke-width="1.6" opacity=".9"/>'; });
    var maxF = 1; G.forEach(function (x) { maxF = Math.max(maxF, Math.abs(x.nb)); });
    var fb = m.t + ih + 34;
    out += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (fb - 16) + '" y2="' + (fb - 16) + '"/><text x="' + (m.l - 6) + '" y="' + (fb - 12) + '" text-anchor="end">매매</text>';
    G.forEach(function (x, j) {
      var up = x.c >= x.o, col = up ? "#f0475a" : "#3d7eff", yo = Y(x.o), yc = Y(x.c);
      out += '<line x1="' + X(j) + '" x2="' + X(j) + '" y1="' + Y(x.hi) + '" y2="' + Y(x.lo) + '" stroke="' + col + '" stroke-width="1"/>';
      out += '<rect x="' + (X(j) - cw / 2) + '" y="' + Math.min(yo, yc) + '" width="' + cw + '" height="' + Math.max(1, Math.abs(yc - yo)) + '" fill="' + col + '"' + (up ? "" : ' fill-opacity=".85"') + "/>";
      if (x.nb) { var hg = Math.max(2, Math.abs(x.nb) / maxF * 15); out += '<rect x="' + (X(j) - Math.max(1, cw / 3)) + '" y="' + (x.nb >= 0 ? fb - 16 - hg : fb - 16) + '" width="' + Math.max(2, cw * 2 / 3) + '" height="' + hg + '" fill="' + (x.nb >= 0 ? "#f0475a" : "#3d7eff") + '" opacity=".75"/>'; }
    });
    out += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + (ih + 36) + '" fill="transparent" style="cursor:crosshair"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '">' + out + '</svg><div class="pf-tip"></div>';
    var svg = box.querySelector("svg"), hit = box.querySelector(".hit"), tip = box.querySelector(".pf-tip");
    function jAt(e) { var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width; return Math.max(0, Math.min(G.length - 1, Math.floor((px - m.l) / bw))); }
    var drag = null;
    hit.addEventListener("mousedown", function (e) {
      drag = jAt(e); e.preventDefault();
      window.addEventListener("mouseup", function up(ev) { window.removeEventListener("mouseup", up); if (drag == null) return; var j = jAt(ev), p0 = Math.min(drag, j), p1 = Math.max(drag, j); drag = null; P.sel = [G[p0].i0, G[p1].i1]; draw(); });
    });
    hit.addEventListener("mousemove", function (e) {
      var j = jAt(e), x = G[j], r = (s[x.i1].idx / s[x.i0].idx - 1) * 100;
      var html = "<b>" + (tf === "D" ? dates[x.i1] : dates[x.i0 + 1] + " ~ " + dates[x.i1]) + "</b> <span class=\"muted\">" + ({ D: "일봉", W: "주봉", M: "월봉" })[tf] + "</span><br>" +
        SEG_NAME[D.seg] + ' 이 봉 <b class="' + cls(r) + '">' + pct(r) + "</b> · 누적 " + pct(x.c) + '<br><span class="muted">시 ' + pct(x.o) + " · 고 " + pct(x.hi) + " · 저 " + pct(x.lo) + " · 종 " + pct(x.c) + "</span>";
      bsel.forEach(function (bb) { var arr = D.bs[bb[0]], rv = arr[x.i0] && arr[x.i1] ? (arr[x.i1] / arr[x.i0] - 1) * 100 : null; html += '<br><span style="color:' + bb[2] + '">●</span> ' + bb[1] + " 이 봉 " + pct(rv); });
      if (x.t.length) html += "<br>" + x.t.slice(0, 6).map(function (t) { return '<span class="' + (t.side === "sell" ? "sell" : "buy") + '">' + (t.side === "sell" ? "매도" : "매수") + "</span> " + esc(S.displayTicker(t.ticker)) + " " + num(t.qty, 4) + "주"; }).join("<br>") + (x.t.length > 6 ? "<br>…외 " + (x.t.length - 6) + "건" : "");
      tip.innerHTML = html; tip.style.display = "block";
      var lx = e.clientX - box.getBoundingClientRect().left + 14; if (lx > box.clientWidth - 230) lx -= 244; tip.style.left = lx + "px"; tip.style.top = "12px";
    });
    hit.addEventListener("mouseleave", function () { tip.style.display = "none"; });
  }
  /* 일별 표: 그날 내 수익률 vs 지수(최근부터) */
  function dailyTbl(a, b, bsel) {
    var D = P.data, s = D.cs, dates = D.dates, box = document.getElementById("pf-months"), rows = [];
    for (var i = b; i > a && rows.length < 250; i--) rows.push(i);
    box.innerHTML = tblHead("D") + '<div class="pf-tbl"><table class="pf-mt"><thead><tr><th>날짜</th><th>' + SEG_NAME[D.seg] + "</th>" + bsel.map(function (x) { return "<th>" + x[1] + "</th>"; }).join("") + (bsel[0] ? "<th>초과(" + bsel[0][1] + ")</th>" : "") + "<th>누적</th><th>매매</th></tr></thead><tbody>" +
      rows.map(function (i) {
        var r = (s[i].idx / s[i - 1].idx - 1) * 100, bb = bsel.map(function (x) { return retBetween(D.bs[x[0]], i - 1, i); }), cum = (s[i].idx / s[a].idx - 1) * 100;
        var tx = s[i].t.map(function (t) { return '<span class="' + (t.side === "sell" ? "sell" : "buy") + '">' + esc(S.displayTicker(t.ticker)) + (t.side === "sell" ? " 매도" : " 매수") + "</span>"; }).join(" ");
        return '<tr data-i0="' + (i - 1) + '" data-i1="' + i + '"><td>' + dates[i] + '</td><td class="' + cls(r) + '"><b>' + pct(r) + "</b></td>" + bb.map(function (v) { return '<td class="' + cls(v) + '">' + pct(v) + "</td>"; }).join("") + (bsel[0] ? '<td class="' + cls(bb[0] == null ? null : r - bb[0]) + '">' + (bb[0] == null ? "—" : pct(r - bb[0])) + "</td>" : "") + '<td class="' + cls(cum) + '">' + pct(cum) + '</td><td class="tops">' + tx + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    box.querySelectorAll("tr[data-i0]").forEach(function (tr) { tr.onclick = function () { P.sel = [+tr.dataset.i0, +tr.dataset.i1]; draw(); }; });
  }

  /* 선택 기간의 매매 변동: 수익률 비교 + 종목별 수량 변화 + 매매 목록 */
  function period(i0, i1, bsel) {
    var D = P.data, s = D.cs, dates = D.dates, box = document.getElementById("pf-period");
    var d0 = dates[i0], d1 = dates[i1];
    var first = i0 === 0;   // 전체 기간이면 첫날 매매도 기간 안으로 본다
    var inSeg = function (t) { return D.seg === "all" || (t.market === "KR" ? "KR" : "US") === D.seg; };
    var tx = D.txs.filter(function (t) { return inSeg(t) && (first ? t.date >= d0 : t.date > d0) && t.date <= d1; });
    var before = {}, after = {}, names = {};
    D.txs.filter(inSeg).forEach(function (t) {
      var k = keyOf(t), q = (Number(t.qty) || 0) * (t.side === "sell" ? -1 : 1); names[k] = S.displayTicker(t.ticker);
      if (!first && t.date <= d0) before[k] = (before[k] || 0) + q;
      if (t.date <= d1) after[k] = (after[k] || 0) + q;
    });
    var flows = {};
    tx.forEach(function (t) { var k = keyOf(t), f = flows[k] || (flows[k] = { b: 0, s: 0 }); if (t.side === "sell") f.s += amtKrw(t, D.state); else f.b += amtKrw(t, D.state); });
    var ks = Object.keys(names).filter(function (k) { return Math.abs((after[k] || 0) - (before[k] || 0)) > 1e-9 || flows[k]; });
    function tag(k) { var b0 = before[k] || 0, a1 = after[k] || 0; return b0 <= 1e-9 && a1 > 1e-9 ? '<span class="pill new">신규</span>' : b0 > 1e-9 && a1 <= 1e-9 ? '<span class="pill out">전량 매도</span>' : a1 > b0 ? '<span class="pill up">비중↑</span>' : a1 < b0 ? '<span class="pill dn">비중↓</span>' : ""; }
    var acc = accRet(s, i0, i1);
    var bm = bsel.map(function (bb) { return bb[1] + " " + '<b class="' + cls(retBetween(D.bs[bb[0]], i0, i1)) + '">' + pct(retBetween(D.bs[bb[0]], i0, i1)) + "</b>"; }).join(" · ");
    var tb = 0, ts = 0; tx.forEach(function (t) { if (t.side === "sell") ts += amtKrw(t, D.state); else tb += amtKrw(t, D.state); });
    box.innerHTML = '<div class="pf-period"><div class="pf-ph"><div><b>' + d0 + " ~ " + d1 + '</b> 기간 매매 변동' + (P.sel ? ' <button class="quiet-btn" id="pf-clear">선택 해제</button>' : "") + '</div><div>내 계좌 <b class="' + cls(acc) + '">' + pct(acc) + "</b>" + (bm ? " · " + bm : "") + "</div></div>" +
      '<div class="pf-ps">매매 ' + tx.length + "건 · 매수 " + krw(tb) + " · 매도 " + krw(ts) + " · 순매수 " + krw(tb - ts) + "</div>" +
      (ks.length ? '<div class="pf-tbl"><table><thead><tr><th>종목</th><th>기간 초 수량</th><th>기간 말 수량</th><th>변화</th><th>매수액</th><th>매도액</th><th>종목 수익률</th></tr></thead><tbody>' +
        ks.map(function (k) {
          var f = flows[k] || { b: 0, s: 0 }, b0 = before[k] || 0, a1 = after[k] || 0;
          return '<tr><td class="tk">' + esc(names[k]) + " " + tag(k) + "</td><td>" + num(b0, 4) + "</td><td>" + num(a1, 4) + '</td><td class="' + cls(a1 - b0) + '">' + (a1 - b0 > 0 ? "+" : "") + num(a1 - b0, 4) + "</td><td>" + (f.b ? krw(f.b) : "") + "</td><td>" + (f.s ? krw(f.s) : "") + "</td><td>" + tkRet(k, i0, i1) + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<div class="empty-row">이 기간에는 매매가 없었습니다.</div>') +
      (tx.length ? '<details class="pf-det"><summary>매매 ' + tx.length + "건 자세히</summary>" + tx.slice().reverse().map(function (t) { return '<div class="tx-row"><span class="date">' + esc(t.date) + '</span><span class="market">' + (t.market === "US" ? "미국" : "한국") + "</span><b>" + esc(S.displayTicker(t.ticker)) + '</b><span class="' + (t.side === "buy" ? "buy" : "sell") + '">' + (t.side === "buy" ? "매수" : "매도") + '</span><span class="tx-price">' + num(t.qty, 4) + "주 · " + (t.market === "US" ? "$" + num(t.price, 2) : "₩" + num(t.price)) + "</span></div>"; }).join("") + "</details>" : "") + "</div>";
    var c = document.getElementById("pf-clear"); if (c) c.onclick = function () { P.sel = null; draw(); };
  }
  function tkRet(k, i0, i1) {   // 그 종목 주가(현지통화)의 기간 등락 — 매매 타이밍과 비교용
    var cache = lsGet(CACHE, {}), sym = k.split(":")[1], h = cache[sym] || cache[sym.replace(/\.(KS|KQ)$/, function (m) { return m === ".KS" ? ".KQ" : ".KS"; })];
    if (!h) return "";
    var ff = ffill(h, [P.data.dates[i0], P.data.dates[i1]]), r = ff[0] && ff[1] ? (ff[1] / ff[0] - 1) * 100 : null;
    return '<span class="' + cls(r) + '">' + pct(r, 1) + "</span>";
  }

  /* 월별 표: 계좌 vs 지수 + 그달 매매 */
  function months(a, b, bsel) {
    var D = P.data, s = D.cs, dates = D.dates, rows = [], cur = null;
    for (var i = Math.max(1, a); i <= b; i++) {
      var m = dates[i].slice(0, 7);
      if (!cur || cur.m !== m) { cur = { m: m, i0: i - 1, i1: i }; rows.push(cur); } else cur.i1 = i;
    }
    var box = document.getElementById("pf-months");
    box.innerHTML = tblHead("M") + '<div class="pf-tbl"><table class="pf-mt"><thead><tr><th>월</th><th>' + SEG_NAME[D.seg] + "</th>" + bsel.map(function (x) { return "<th>" + x[1] + "</th>"; }).join("") + (bsel[0] ? "<th>초과(" + bsel[0][1] + ")</th>" : "") + "<th>매수</th><th>매도</th><th>주요 매매</th></tr></thead><tbody>" +
      rows.slice().reverse().map(function (r) {
        var acc = accRet(s, r.i0, r.i1), bb = bsel.map(function (x) { return retBetween(D.bs[x[0]], r.i0, r.i1); });
        var tx = D.txs.filter(function (t) { return t.date.slice(0, 7) === r.m && (D.seg === "all" || (t.market === "KR" ? "KR" : "US") === D.seg); }), tb = 0, ts = 0, by = {};
        tx.forEach(function (t) { var a = amtKrw(t, D.state), k = S.displayTicker(t.ticker); if (t.side === "sell") { ts += a; by[k] = (by[k] || 0) - a; } else { tb += a; by[k] = (by[k] || 0) + a; } });
        var top = Object.keys(by).sort(function (p, q) { return Math.abs(by[q]) - Math.abs(by[p]); }).slice(0, 3).map(function (k) { return '<span class="' + (by[k] >= 0 ? "buy" : "sell") + '">' + esc(k) + (by[k] >= 0 ? " 매수" : " 매도") + "</span>"; }).join(" ");
        return '<tr data-i0="' + r.i0 + '" data-i1="' + r.i1 + '"' + (P.sel && P.sel[0] === r.i0 && P.sel[1] === r.i1 ? ' class="on"' : "") + "><td>" + r.m + '</td><td class="' + cls(acc) + '"><b>' + pct(acc) + "</b></td>" + bb.map(function (v) { return '<td class="' + cls(v) + '">' + pct(v) + "</td>"; }).join("") + (bsel[0] ? '<td class="' + cls(bb[0] == null ? null : acc - bb[0]) + '">' + (bb[0] == null ? "—" : pct(acc - bb[0])) + "</td>" : "") + "<td>" + (tb ? krw(tb) : "") + "</td><td>" + (ts ? krw(ts) : "") + '</td><td class="tops">' + top + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    box.querySelectorAll("tr[data-i0]").forEach(function (tr) { tr.onclick = function () { P.sel = [+tr.dataset.i0, +tr.dataset.i1]; draw(); var pp = document.getElementById("pf-period"); if (pp) pp.scrollIntoView({ behavior: "smooth", block: "start" }); }; });
  }

  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (P.data && P.el && P.el.offsetParent) draw(); }, 250); });
  window.PortfolioPerf = { trades: trades, perf: perf, reload: reload };
})();
