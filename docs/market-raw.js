/* market-raw.js — 섹터 대시보드·글로벌 메가캡에 '미국 · 한국 · 일본' 원자료 보기 붙이기 (2026-10-16 사용자 요청)
   자료: data/ta/{us,kr,jp}.json (fetch_ta_core.py — 기술적 분석과 같은 자료)
   <script src="market-raw.js" data-mode="sector|stocks"> — sector: 업종별 묶음 표(눌러서 종목 펼치기) · stocks: 전체 종목 표
   맨 위 줄에서 '글로벌(기존 화면)'을 고르면 원래 화면 그대로, 미국·한국·일본을 고르면 원래 내용을 숨기고 그 시장 표를 보여준다. */
(function () {
  "use strict";
  var me = document.currentScript, MODE = (me && me.dataset.mode) || "stocks";
  var main = document.querySelector("main") || document.querySelector("body > .container") || document.body;
  var KEY = "vantage-mraw-" + MODE, MK = [["", "글로벌 (기존 화면)"], ["us", "미국"], ["kr", "한국"], ["jp", "일본"]];
  var st = {m: "", sort: MODE === "sector" ? "w1m" : "mcap", dir: -1, sec: "", q: "", open: {}, limit: 100};
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); st.open = {}; st.limit = 100; } catch (e) {}
  var hm = /(?:^|[#&])mk=(us|kr|jp|all)/.exec(location.hash); if (hm) st.m = hm[1] === "all" ? "" : hm[1];
  var CACHE = {};
  var bar = document.createElement("nav"); bar.className = "mr-bar"; bar.setAttribute("aria-label", "시장 선택");
  var box = document.createElement("section"); box.className = "mr-box"; box.hidden = true;
  main.insertBefore(box, main.firstChild); main.insertBefore(bar, box);
  var others = function () { return Array.prototype.filter.call(main.children, function (el) { return el !== bar && el !== box; }); };
  function save() { try { localStorage.setItem(KEY, JSON.stringify({m: st.m, sort: st.sort, dir: st.dir, sec: st.sec})); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function num(v, d) { return v == null ? "—" : Number(v).toLocaleString("ko-KR", {maximumFractionDigits: d || 0, minimumFractionDigits: d || 0}); }
  function sg(v, d) { if (v == null || isNaN(v)) return '<span class="na">—</span>'; var c = v > 0 ? "up" : v < 0 ? "dn" : ""; return '<span class="' + c + '">' + (v > 0 ? "+" : "") + Number(v).toFixed(d == null ? 1 : d) + "%</span>"; }
  function heat(v) { if (v == null) return ""; var a = Math.min(1, Math.abs(v) / 12); return v >= 0 ? "background:rgba(214,51,74," + (a * 0.28).toFixed(3) + ")" : "background:rgba(47,111,228," + (a * 0.28).toFixed(3) + ")"; }
  function cap(m, v) {
    v = v || 0;
    if (m === "us") return v >= 1000 ? (v / 1000).toFixed(2) + "조$" : num(v * 10) + "억$";
    if (m === "kr") return v >= 1 ? v.toFixed(1) + "조원" : num(v * 10000) + "억원";
    return v >= 10000 ? (v / 10000).toFixed(1) + "조엔" : num(v) + "억엔";
  }
  function px(m, p) { return m === "us" ? "$" + num(p, 2) : m === "kr" ? num(p) + "원" : num(p, p < 100 ? 1 : 0) + "엔"; }
  function nm(m, s) { return esc(s.name) + (s.en && s.en !== s.name ? ' <small>' + esc(s.en) + "</small>" : ""); }
  function spark(c) { c = (c || []).slice(-60); if (c.length < 2) return ""; var lo = Math.min.apply(null, c), hi = Math.max.apply(null, c), sp = hi - lo || 1; return '<svg viewBox="0 0 60 18" preserveAspectRatio="none"><path class="' + (c[c.length - 1] >= c[0] ? "up" : "dn") + '" d="' + c.map(function (x, i) { return (i ? "L" : "M") + (i / (c.length - 1) * 60).toFixed(1) + " " + (17 - (x - lo) / sp * 16).toFixed(1); }).join(" ") + '"/></svg>'; }

  /* 업종 묶음 — 시가총액 가중 수익률 */
  function sectors(D) {
    var by = {};
    D.stocks.forEach(function (s) { (by[s.sector || "기타"] = by[s.sector || "기타"] || []).push(s); });
    return Object.keys(by).map(function (k) {
      var L = by[k], tot = L.reduce(function (a, s) { return a + (s.mcap || 0); }, 0);
      var w = function (f) { var ws = 0, sm = 0; L.forEach(function (s) { if (s[f] != null) { ws += s.mcap || 0; sm += (s.mcap || 0) * s[f]; } }); return ws ? sm / ws : null; };
      var vrs = L.map(function (s) { return s.vr; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
      var rss = L.map(function (s) { return s.rs; }).filter(function (x) { return x != null; });
      return {sector: k, n: L.length, mcap: tot, w1d: w("chg1d"), w5d: w("chg5d"), w1m: w("chg1m"), w3m: w("r3"), w6m: w("r6"), w12m: w("r12"),
              nh: L.filter(function (s) { return s.nh5; }).length, rs: rss.length ? rss.reduce(function (a, b) { return a + b; }, 0) / rss.length : null,
              vr: vrs.length ? vrs[Math.floor(vrs.length / 2)] : null, stocks: L};
    });
  }
  var SCOL = [["sector", "업종", 0], ["n", "종목", 1], ["mcap", "시가총액", 1], ["w1d", "1일", 1], ["w5d", "5일", 1], ["w1m", "1개월", 1], ["w3m", "3개월", 1], ["w6m", "6개월", 1], ["w12m", "12개월", 1], ["nh", "5일 안 신고가", 1], ["rs", "평균 RS", 1], ["vr", "거래량 배수(중앙)", 1]];
  var TCOL = [["name", "종목", 0], ["sector", "업종", 0], ["mcap", "시가총액", 1], ["price", "가격", 1], ["chg1d", "1일", 1], ["chg5d", "5일", 1], ["chg1m", "1개월", 1], ["r3", "3개월", 1], ["r6", "6개월", 1], ["r12", "12개월", 1], ["from_hi", "52주 고점 대비", 1], ["vr", "거래량 배수", 1], ["rs", "RS", 1], ["ex3", "지수 대비 3개월", 1], ["c", "6개월 추이", 2]];
  function stockRow(m, s, cols) {
    return "<tr>" + cols.map(function (c) {
      var k = c[0], v = s[k];
      if (k === "name") return '<td class="l nm">' + nm(m, s) + "<em>" + esc(s.code) + (s.sub && m === "kr" ? " · " + esc(s.sub) : "") + "</em></td>";
      if (k === "sector") return '<td class="l sec">' + esc(s.sector) + "</td>";
      if (k === "mcap") return "<td>" + cap(m, v) + "</td>";
      if (k === "price") return "<td>" + px(m, v) + "</td>";
      if (k === "vr") return '<td class="' + (v >= 2 ? "hot" : "") + '">' + (v == null ? "—" : Number(v).toFixed(1) + "배") + "</td>";
      if (k === "rs") return "<td>" + (v == null ? "—" : v) + "</td>";
      if (k === "from_hi") return "<td>" + (s.nh ? '<b class="nhb">신고가</b>' : sg(v)) + "</td>";
      if (k === "c") return '<td class="sp">' + spark(v) + "</td>";
      return '<td style="' + heat(v) + '">' + sg(v, k === "chg1d" ? 2 : 1) + "</td>";
    }).join("") + "</tr>";
  }
  function head(cols, sortable) { return "<thead><tr>" + cols.map(function (c) { var on = st.sort === c[0]; return "<th" + (c[2] === 0 ? ' class="l"' : "") + (sortable && c[2] !== 2 ? ' data-sort="' + c[0] + '"' : "") + ">" + c[1] + (on ? (st.dir < 0 ? " ▾" : " ▴") : "") + "</th>"; }).join("") + "</tr></thead>"; }
  function cmp(k) { return function (a, b) { var x = a[k], y = b[k]; if (typeof x === "string" || typeof y === "string") return st.dir * String(x || "").localeCompare(String(y || ""), "ko"); return st.dir * ((x == null ? -1e12 : x) - (y == null ? -1e12 : y)); }; }

  function render() {
    bar.innerHTML = MK.map(function (x) { return '<button type="button" data-mk="' + x[0] + '" aria-pressed="' + (st.m === x[0]) + '">' + x[1] + "</button>"; }).join("") +
      '<span class="mr-hint">' + (MODE === "sector" ? "미국·한국·일본은 상장 종목을 업종별로 묶은 원자료입니다" : "미국·한국·일본은 시장별 전체 종목 원자료입니다") + "</span>";
    bar.querySelectorAll("[data-mk]").forEach(function (b) { b.onclick = function () { st.m = b.dataset.mk; st.sec = ""; st.q = ""; st.sort = MODE === "sector" ? "w1m" : "mcap"; st.dir = -1; save(); history.replaceState(null, "", location.pathname + location.search + (st.m ? "#mk=" + st.m : "")); go(); }; });
    var showOrig = !st.m;
    others().forEach(function (el) { if (showOrig) { if (el.dataset.mrHid) { el.hidden = false; delete el.dataset.mrHid; } } else if (!el.hidden) { el.hidden = true; el.dataset.mrHid = "1"; } });
    box.hidden = showOrig;
    if (showOrig) { window.dispatchEvent(new Event("resize")); return; }
    var D = CACHE[st.m];
    if (!D) { box.innerHTML = '<div class="mr-empty">' + (D === null ? "자료를 불러오지 못했습니다." : "불러오는 중…") + "</div>"; return; }
    var title = (MK.find(function (x) { return x[0] === st.m; }) || [])[1];
    var idx = (D.index || []).map(function (i) { return "<span><b>" + esc(i.name) + "</b> " + num(i.price, 2) + " " + sg(i.chg1d, 2) + "</span>"; }).join("");
    var top = '<div class="mr-head"><h2>' + esc(title) + (MODE === "sector" ? " 업종별 흐름" : " 전체 종목") + '</h2><div class="mr-idx">' + idx + '<span class="asof">기준 ' + esc(D.as_of) + " · " + D.count + '종목 · <a href="ta.html#' + st.m + '-nh">기술적 분석에서 보기 →</a></span></div></div>';
    if (MODE === "sector") {
      var S = sectors(D).sort(cmp(st.sort));
      box.innerHTML = top + '<p class="mr-note">수익률은 업종 안 종목의 시가총액 가중 평균입니다. 줄을 누르면 그 업종 종목이 펼쳐집니다.</p><div class="mr-scroll"><table class="mr-t">' + head(SCOL, true) + "<tbody>" +
        S.map(function (g) {
          var o = st.open[g.sector];
          var row = '<tr class="grp' + (o ? " open" : "") + '" data-open="' + esc(g.sector) + '"><td class="l"><i>' + (o ? "▾" : "▸") + "</i> <b>" + esc(g.sector) + "</b></td><td>" + g.n + "</td><td>" + cap(st.m, g.mcap) + "</td>" +
            ["w1d", "w5d", "w1m", "w3m", "w6m", "w12m"].map(function (k) { return '<td style="' + heat(g[k]) + '">' + sg(g[k], k === "w1d" ? 2 : 1) + "</td>"; }).join("") +
            "<td>" + (g.nh || "") + "</td><td>" + (g.rs == null ? "—" : g.rs.toFixed(0)) + "</td><td>" + (g.vr == null ? "—" : g.vr.toFixed(2) + "배") + "</td></tr>";
          if (o) row += '<tr class="sub"><td colspan="' + SCOL.length + '"><table class="mr-t in">' + head(TCOL, false) + "<tbody>" + g.stocks.slice().sort(function (a, b) { return (b.mcap || 0) - (a.mcap || 0); }).map(function (s) { return stockRow(st.m, s, TCOL); }).join("") + "</tbody></table></td></tr>";
          return row;
        }).join("") + "</tbody></table></div>";
    } else {
      var secs = {}; D.stocks.forEach(function (s) { secs[s.sector] = (secs[s.sector] || 0) + 1; });
      var L = D.stocks.filter(function (s) { return (!st.sec || s.sector === st.sec) && (!st.q || (s.name + " " + (s.en || "") + " " + s.code).toLowerCase().indexOf(st.q.toLowerCase()) >= 0); }).sort(cmp(st.sort));
      box.innerHTML = top + '<div class="mr-ctl"><select data-sec><option value="">업종 전체 (' + D.stocks.length + ")</option>" + Object.keys(secs).sort(function (a, b) { return secs[b] - secs[a]; }).map(function (k) { return '<option value="' + esc(k) + '"' + (st.sec === k ? " selected" : "") + ">" + esc(k || "기타") + " (" + secs[k] + ")</option>"; }).join("") + '</select><input type="search" placeholder="이름·코드 검색" value="' + esc(st.q) + '" data-q><span>' + L.length + "종목 · 머리글을 누르면 정렬</span></div>" +
        '<div class="mr-scroll"><table class="mr-t">' + head(TCOL, true) + "<tbody>" + L.slice(0, st.limit).map(function (s) { return stockRow(st.m, s, TCOL); }).join("") + "</tbody></table></div>" +
        (L.length > st.limit ? '<button type="button" class="mr-more" data-more>' + (L.length - st.limit) + "종목 더 보기</button>" : "");
    }
    box.querySelectorAll("[data-sort]").forEach(function (th) { th.onclick = function () { var k = th.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = (k === "name" || k === "sector") ? 1 : -1; } save(); render(); }; });
    box.querySelectorAll("[data-open]").forEach(function (tr) { tr.onclick = function () { var k = tr.dataset.open; st.open[k] = !st.open[k]; render(); }; });
    var se = box.querySelector("[data-sec]"); if (se) se.onchange = function () { st.sec = se.value; st.limit = 100; save(); render(); };
    var q = box.querySelector("[data-q]"); if (q) q.oninput = function () { st.q = q.value; clearTimeout(q._t); q._t = setTimeout(function () { render(); var n = box.querySelector("[data-q]"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    var mo = box.querySelector("[data-more]"); if (mo) mo.onclick = function () { st.limit += 200; render(); };
  }
  function go() {
    if (!st.m || CACHE[st.m]) return render();
    render();
    var m = st.m;
    fetch("data/ta/" + m + ".json?v=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { CACHE[m] = d; render(); }).catch(function () { CACHE[m] = null; render(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
