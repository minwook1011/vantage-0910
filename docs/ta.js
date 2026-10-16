/* ta.js — 기술적 분석(2026-10-16 전면 개편): 신고가 · 거래량 · 상대강도만, 미국 · 한국 · 일본
   자료: data/ta/{us,kr,jp}.json (fetch_ta_core.py)
   맨 위: 피라미드 순위 그래프(보기마다 기준이 다름) → 아래: 해당 종목 작은 차트 카드(한 줄에 여러 개) */
(function () {
  "use strict";
  var host = document.getElementById("ta");
  var MARKETS = [["us", "미국"], ["kr", "한국"], ["jp", "일본"]];
  var VIEWS = [["nh", "신고가", "52주 종가 최고를 넘은 종목"], ["vol", "거래량", "평소(직전 50일 평균)보다 거래가 몰린 종목"], ["rs", "상대강도", "3·6·9·12개월 수익률로 시장 안 상위 종목"]];
  var KEY = "vantage-ta-v3";
  var st = {m: "us", v: "nh", sec: "", sort: "", q: "", liq: true, nhOnlyToday: false};
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  var h0 = (location.hash || "").slice(1).split("-");
  if (MARKETS.some(function (x) { return x[0] === h0[0]; })) st.m = h0[0];
  if (VIEWS.some(function (x) { return x[0] === h0[1]; })) st.v = h0[1];
  var CACHE = {};
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} history.replaceState(null, "", "#" + st.m + "-" + st.v); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function num(v, d) { return v == null ? "—" : Number(v).toLocaleString("ko-KR", {maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0}); }
  function sgn(v, d) { if (v == null) return '<span class="na">—</span>'; var c = v > 0 ? "up" : v < 0 ? "dn" : ""; return '<span class="' + c + '">' + (v > 0 ? "+" : "") + Number(v).toFixed(d == null ? 1 : d) + "%</span>"; }
  function price(s) { var p = s.price; return st.m === "us" ? "$" + num(p, p < 10 ? 2 : 2) : st.m === "kr" ? num(p) + "원" : num(p, p < 100 ? 1 : 0) + "엔"; }
  function mcap(s) {
    var v = s.mcap || 0;
    if (st.m === "us") return v >= 1000 ? (v / 1000).toFixed(2) + "조달러" : num(v * 10) + "억달러";
    if (st.m === "kr") return v >= 1 ? v.toFixed(1) + "조원" : num(v * 10000) + "억원";
    return v >= 10000 ? (v / 10000).toFixed(1) + "조엔" : num(v) + "억엔";
  }
  function nameHTML(s) { return esc(s.name) + (st.m === "jp" && s.en && s.en !== s.name ? ' <small class="en">(' + esc(s.en) + ")</small>" : st.m === "us" && s.en && s.en !== s.name ? ' <small class="en">' + esc(s.en) + "</small>" : ""); }
  function nameTxt(s) { return s.name; }

  /* ── 보기별 목록·피라미드 기준 ── */
  function liquid(list) {   // 거래가 너무 적은 종목(20일 평균 거래대금 하위 30%) 빼기 — 거래량 배수가 튀기 쉬움
    if (!st.liq) return list;
    var vals = list.map(function (s) { return s.val20 || 0; }).sort(function (a, b) { return a - b; }), cut = vals[Math.floor(vals.length * 0.3)] || 0;
    return list.filter(function (s) { return (s.val20 || 0) >= cut; });
  }
  var SPEC = {
    nh: {pick: function (L) { return L.filter(function (s) { return st.nhOnlyToday ? s.nh : s.nh5; }); }, pyr: "vr", pyrLabel: "신고가 종목 중 거래량이 평소보다 많이 터진 순서 (거래량 동반 돌파일수록 힘이 셉니다)", sort: "rs"},
    vol: {pick: function (L) { var q = liquid(L).filter(function (s) { return s.vr != null; }).sort(function (a, b) { return b.vr - a.vr; }); var hot = q.filter(function (s) { return s.vr >= 1.5; }); return hot.length >= 30 ? hot : q.slice(0, 30); },   /* 1.5배 넘는 종목, 적으면 상위 30개 */ pyr: "vr", pyrLabel: "오늘 거래량이 평소(직전 50거래일 평균)의 몇 배인지 순서", sort: "vr"},
    rs: {pick: function (L) { return L.filter(function (s) { return (s.rs || 0) >= 90; }); }, pyr: "ex3", pyrLabel: "상대강도 상위 종목 중 최근 3개월 지수 대비 초과수익 순서", sort: "rs"},
  };
  var SORTS = [["rs", "상대강도"], ["vr", "거래량 배수"], ["chg1d", "오늘 등락"], ["from_hi", "신고가 근접"], ["ex3", "3개월 지수 대비"], ["mcap", "시가총액"]];
  function sval(s, k) { return k === "from_hi" ? (s.from_hi == null ? -999 : s.from_hi) : s[k] == null ? -1e9 : s[k]; }
  function fmtMetric(k, v) { return v == null ? "—" : k === "vr" ? Number(v).toFixed(1) + "배" : k === "rs" ? "RS " + v : (v > 0 ? "+" : "") + Number(v).toFixed(1) + "%"; }

  /* ── 피라미드 ── */
  function pyramid(list, k, label) {
    var top = list.filter(function (s) { return s[k] != null; }).sort(function (a, b) { return b[k] - a[k]; }).slice(0, 20);
    if (!top.length) return "";
    var mx = top[0][k], mn = Math.min(0, top[top.length - 1][k]);
    return '<section class="ta-pyr"><div class="ta-pyr-h"><b>' + esc(label.split(" (")[0]) + "</b><span>" + esc(label.indexOf(" (") > 0 ? label.slice(label.indexOf(" (") + 2, -1) : "") + "</span></div>" +
      top.map(function (s, i) {
        var w = 22 + 78 * ((s[k] - mn) / ((mx - mn) || 1));
        return '<button type="button" class="ta-pyr-row" data-jump="' + esc(s.code) + '" style="--w:' + w.toFixed(1) + "%;--i:" + i + '"><span class="bar"><em>' + (i + 1) + "</em><b>" + esc(nameTxt(s)) + "</b><i>" + fmtMetric(k, s[k]) + "</i></span></button>";
      }).join("") + "</section>";
  }

  /* ── 작은 차트 ── */
  function mini(s) {
    var c = s.c || [], v = s.v || [], n = c.length;
    if (n < 2) return "";
    var W = 200, H = 70, VH = 16;
    var lo = Math.min.apply(null, c), hi = Math.max.apply(null, c.concat([s.hi52 || 0]));
    if (s.hi52 > hi) hi = s.hi52;
    var sp = (hi - lo) || 1, y = function (x) { return 3 + (1 - (x - lo) / sp) * (H - VH - 8); };
    var d = c.map(function (x, i) { return (i ? "L" : "M") + (i / (n - 1) * W).toFixed(1) + " " + y(x).toFixed(1); }).join(" ");
    var up = c[n - 1] >= c[0];
    var bw = W / n, bars = v.map(function (x, i) { var hgt = Math.max(0.5, x / 99 * VH); return '<rect x="' + (i * bw).toFixed(1) + '" y="' + (H - hgt).toFixed(1) + '" width="' + Math.max(0.6, bw - 0.4).toFixed(1) + '" height="' + hgt.toFixed(1) + '"' + (i === n - 1 ? ' class="last"' : "") + "/>"; }).join("");
    var hy = y(s.hi52);
    return '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true"><g class="vb">' + bars + '</g><line x1="0" x2="' + W + '" y1="' + hy.toFixed(1) + '" y2="' + hy.toFixed(1) + '" class="hi"/><path d="' + d + '" class="' + (up ? "up" : "dn") + '"/></svg>';
  }
  function card(s) {
    var tags = [];
    if (s.nh) tags.push('<em class="t-nh">신고가 오늘</em>'); else if (s.nh5) tags.push('<em class="t-nh2">' + s.nh_since + "일 전 신고가</em>"); else if (s.from_hi != null) tags.push("<em>신고가까지 " + Number(-s.from_hi).toFixed(1) + "%</em>");
    if (s.vr != null) tags.push('<em class="' + (s.vr >= 3 ? "t-v3" : s.vr >= 2 ? "t-v2" : "") + '">거래량 ' + Number(s.vr).toFixed(1) + "배</em>");
    if (s.rs != null) tags.push('<em class="' + (s.rs >= 90 ? "t-rs" : "") + '">RS ' + s.rs + "</em>");
    return '<article class="ta-card" id="c-' + esc(s.code) + '"><header><div class="nm"><b>' + nameHTML(s) + '</b><small>' + esc(s.code) + " · " + esc(s.sector) + " · " + mcap(s) + '</small></div><div class="px"><b>' + price(s) + "</b>" + sgn(s.chg1d, 2) + "</div></header>" +
      '<div class="ch">' + mini(s) + '</div><div class="tg">' + tags.join("") + '</div><div class="rt"><span>1개월 ' + sgn(s.chg1m) + "</span><span>3개월 " + sgn(s.r3) + "</span><span>지수 대비 " + sgn(s.ex3) + "</span></div></article>";
  }

  /* ── 전체 그리기 ── */
  function render() {
    var D = CACHE[st.m];
    var head = '<div class="ta-top"><div><h1>기술적 분석</h1><p class="ta-sub">신고가 · 거래량 · 상대강도만 봅니다. 장 마감 자료로 매일 갱신.</p></div>' +
      '<nav class="ta-mk" aria-label="시장">' + MARKETS.map(function (m) { return '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (st.m === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</nav></div>" +
      '<nav class="ta-views" aria-label="보기">' + VIEWS.map(function (v) { var n = D ? SPEC[v[0]].pick(D.stocks).length : ""; return '<button type="button" data-v="' + v[0] + '" aria-pressed="' + (st.v === v[0]) + '"><b>' + v[1] + (n !== "" ? "<i>" + n + "</i>" : "") + "</b><small>" + v[2] + "</small></button>"; }).join("") + "</nav>";
    if (!D) { host.innerHTML = head + '<div class="ta-empty">' + (D === null ? "자료를 불러오지 못했습니다." : "불러오는 중…") + "</div>"; bind(); return; }
    var spec = SPEC[st.v], base = spec.pick(D.stocks);
    var secs = {}; base.forEach(function (s) { secs[s.sector] = (secs[s.sector] || 0) + 1; });
    var list = base.filter(function (s) { return (!st.sec || s.sector === st.sec) && (!st.q || (s.name + " " + (s.en || "") + " " + s.code).toLowerCase().indexOf(st.q.toLowerCase()) >= 0); });
    var sk = st.sort || spec.sort;
    list.sort(function (a, b) { return sval(b, sk) - sval(a, sk); });
    var idx = (D.index || []).map(function (i) { return "<span><b>" + esc(i.name) + "</b> " + num(i.price, 2) + " " + sgn(i.chg1d, 2) + ' <small>3개월 ' + sgn(i.r3) + " · 고점 대비 " + sgn(i.from_hi) + "</small></span>"; }).join("");
    host.innerHTML = head +
      '<div class="ta-idx">' + idx + '<span class="asof">기준 ' + esc(D.as_of) + " · " + D.count + "종목</span></div>" +
      pyramid(st.v === "nh" ? base.filter(function (s) { return s.nh5; }) : base, spec.pyr, spec.pyrLabel) +
      '<div class="ta-ctl"><select data-sec><option value="">업종 전체 (' + base.length + ")</option>" + Object.keys(secs).sort(function (a, b) { return secs[b] - secs[a]; }).map(function (k) { return '<option value="' + esc(k) + '"' + (st.sec === k ? " selected" : "") + ">" + esc(k || "기타") + " (" + secs[k] + ")</option>"; }).join("") + "</select>" +
      '<select data-sort>' + SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (sk === o[0] ? " selected" : "") + ">" + o[1] + " 순</option>"; }).join("") + "</select>" +
      '<input type="search" placeholder="이름·코드 검색" value="' + esc(st.q) + '" data-q>' +
      (st.v === "nh" ? '<label><input type="checkbox" data-today ' + (st.nhOnlyToday ? "checked" : "") + "> 오늘 신고가만</label>" : "") +
      (st.v === "vol" ? '<label><input type="checkbox" data-liq ' + (st.liq ? "checked" : "") + "> 거래 적은 종목 빼기</label>" : "") +
      '<span class="cnt">' + list.length + "종목</span></div>" +
      (list.length ? '<div class="ta-grid">' + list.map(card).join("") + "</div>" : '<div class="ta-empty">조건에 맞는 종목이 없습니다.</div>') +
      '<p class="ta-foot">신고가 = 그날 종가가 직전 52주(252거래일) 종가 최고를 넘은 것 · 거래량 배수 = 그날 거래량 ÷ 직전 50거래일 평균 · RS(상대강도) = 3개월 40%·6·9·12개월 각 20% 가중 수익률을 시장 안에서 1~99로 줄 세운 값 · 차트는 최근 6개월 종가(점선 = 52주 종가 최고), 아래 막대는 거래량. 자료: 야후 일봉.</p>';
    bind();
  }
  function bind() {
    host.querySelectorAll("[data-m]").forEach(function (b) { b.onclick = function () { st.m = b.dataset.m; st.sec = ""; save(); load(); }; });
    host.querySelectorAll("[data-v]").forEach(function (b) { b.onclick = function () { st.v = b.dataset.v; st.sec = ""; st.sort = ""; save(); render(); }; });
    var sec = host.querySelector("[data-sec]"); if (sec) sec.onchange = function () { st.sec = sec.value; save(); render(); };
    var so = host.querySelector("[data-sort]"); if (so) so.onchange = function () { st.sort = so.value; save(); render(); };
    var q = host.querySelector("[data-q]"); if (q) q.oninput = function () { st.q = q.value; clearTimeout(q._t); q._t = setTimeout(function () { render(); var n = host.querySelector("[data-q]"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    var td = host.querySelector("[data-today]"); if (td) td.onchange = function () { st.nhOnlyToday = td.checked; save(); render(); };
    var lq = host.querySelector("[data-liq]"); if (lq) lq.onchange = function () { st.liq = lq.checked; save(); render(); };
    host.querySelectorAll("[data-jump]").forEach(function (b) { b.onclick = function () { var el = document.getElementById("c-" + b.dataset.jump); if (!el) { st.sec = ""; st.q = ""; render(); el = document.getElementById("c-" + b.dataset.jump); } if (el) { el.scrollIntoView({behavior: "smooth", block: "center"}); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }; });
  }
  function load() {
    if (CACHE[st.m]) return render();
    render();
    fetch("data/ta/" + st.m + ".json?v=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { CACHE[d.market] = d; render(); }).catch(function () { CACHE[st.m] = null; render(); });
  }
  save(); load();
})();
