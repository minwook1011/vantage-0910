/* ta.js — 기술적 분석(2026-10-16 전면 개편): 신고가 · 거래량 · 상대강도만, 미국 · 한국 · 일본
   자료: data/ta/{us,kr,jp}.json (fetch_ta_core.py)
   맨 위: 피라미드 순위 그래프(보기마다 기준이 다름) → 아래: 해당 종목 작은 차트 카드(한 줄에 여러 개) */
(function () {
  "use strict";
  var host = document.getElementById("ta");
  var MARKETS = [["us", "미국"], ["kr", "한국"], ["jp", "일본"], ["fav", "★ 즐겨찾기"]];
  var VIEWS = [["nh", "신고가", "52주 종가 최고를 넘은 종목"], ["vol", "거래량", "평소(직전 50일 평균)보다 거래가 몰린 종목"], ["rs", "상대강도", "3·6·9·12개월 수익률로 시장 안 상위 종목"]];
  var KEY = "vantage-ta-v3";
  var st = {m: "us", v: "nh", sec: "", sort: "", q: "", liq: true, nhOnlyToday: false, cap: {us: "", kr: "", jp: 300}, per: {us: "", kr: "", jp: ""}};
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  if (st.jpBig === false) st.cap.jp = "";   /* 예전 '시총 300억엔 이상' 체크를 끈 사람 */
  delete st.jpBig;
  var h0 = (location.hash || "").slice(1).split("-");   /* #us-nh · #fav */
  if (MARKETS.some(function (x) { return x[0] === h0[0]; })) st.m = h0[0];
  if (VIEWS.some(function (x) { return x[0] === h0[1]; })) st.v = h0[1];
  var CACHE = {};
  var FKEY = "etf_favs_v1";
  function favs() { try { return JSON.parse(localStorage.getItem(FKEY)) || {}; } catch (e) { return {}; } }
  function favToggleTk(tk, name) { var m = favs(); if (m[tk]) delete m[tk]; else m[tk] = {name: name || tk, ts: Date.now()}; try { localStorage.setItem(FKEY, JSON.stringify(m)); } catch (e) {} }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} history.replaceState(null, "", "#" + st.m + "-" + st.v); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function num(v, d) { return v == null ? "—" : Number(v).toLocaleString("ko-KR", {maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0}); }
  function sgn(v, d) { if (v == null) return '<span class="na">—</span>'; var c = v > 0 ? "up" : v < 0 ? "dn" : ""; return '<span class="' + c + '">' + (v > 0 ? "+" : "") + Number(v).toFixed(d == null ? 1 : d) + "%</span>"; }
  function price(s) { var p = s.price, M = s._m || st.m; return M === "us" ? "$" + num(p, p < 10 ? 2 : 2) : M === "kr" ? num(p) + "원" : num(p, p < 100 ? 1 : 0) + "엔"; }
  function mcap(s) {
    var v = s.mcap || 0, M = s._m || st.m;
    if (M === "us") return v >= 1000 ? (v / 1000).toFixed(2) + "조달러" : num(v * 10) + "억달러";
    if (M === "kr") return v >= 1 ? v.toFixed(1) + "조원" : num(v * 10000) + "억원";
    return v >= 10000 ? (v / 10000).toFixed(1) + "조엔" : num(v) + "억엔";
  }
  function nameHTML(s) { var M = s._m || st.m; return esc(s.name) + (M === "jp" && s.en && s.en !== s.name ? ' <small class="en">(' + esc(s.en) + ")</small>" : M === "us" && s.en && s.en !== s.name ? ' <small class="en">' + esc(s.en) + "</small>" : ""); }
  function nameTxt(s) { return s.name; }

  /* ── 시총 하한 · PER 상한 — 시장마다 사용자가 숫자를 정함(일본 시총 기본 300억엔). 단위: 미국 억달러 · 한국 억원 · 일본 억엔 ── */
  var CAPU = {us: "억달러", kr: "억원", jp: "억엔"};
  function cap100m(s, M) { var v = s.mcap || 0; return M === "us" ? v * 10 : M === "kr" ? v * 10000 : v; }
  function filt(L) {
    var M = st.m, c = parseFloat(st.cap[M]), pe = parseFloat(st.per[M]);
    return L.filter(function (s) { return (!(c > 0) || cap100m(s, M) >= c) && (!(pe > 0) || (s.per != null && s.per > 0 && s.per < pe)); });
  }

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
  var SORTS = [["rs", "상대강도"], ["vr", "거래량 배수"], ["chg1d", "오늘 등락"], ["from_hi", "신고가 근접"], ["ex3", "3개월 지수 대비"], ["mcap", "시가총액"], ["per", "PER 낮은"]];
  function sval(s, k) { if (k === "per") return s.per > 0 ? -s.per : -1e9; return k === "from_hi" ? (s.from_hi == null ? -999 : s.from_hi) : s[k] == null ? -1e9 : s[k]; }
  function fmtMetric(k, v) { return v == null ? "—" : k === "vr" ? Number(v).toFixed(1) + "배" : k === "rs" ? "RS " + v : (v > 0 ? "+" : "") + Number(v).toFixed(1) + "%"; }

  /* ── 피라미드 ── */
  function pyramid(list, k, label) {
    var top = list.filter(function (s) { return s[k] != null; }).sort(function (a, b) { return b[k] - a[k]; }).slice(0, 20);
    if (!top.length) return "";
    var mx = top[0][k], mn = Math.min(0, top[top.length - 1][k]);
    return '<section class="ta-pyr"><div class="ta-pyr-h"><b>' + esc(label.split(" (")[0]) + "</b><span>" + esc(label.indexOf(" (") > 0 ? label.slice(label.indexOf(" (") + 2, -1) : "") + "</span></div>" +
      top.map(function (s, i) {
        var w = 22 + 78 * ((s[k] - mn) / ((mx - mn) || 1));
        var L = 84 + i * 0.6;   /* 연한 빨강 바탕 + 진한 글씨(2026-10-16 사용자: 파랑은 한눈에 안 보임) — 위로 갈수록 조금 진하게 */
        return '<button type="button" class="ta-pyr-row" data-jump="' + esc(s.code) + '" style="--w:' + w.toFixed(1) + "%;--bg:hsl(352,90%," + L.toFixed(1) + '%)"><span class="bar"><em>' + (i + 1) + "</em><b>" + esc(nameTxt(s)) + "</b><i>" + fmtMetric(k, s[k]) + "</i></span></button>";
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
  // 트레이딩뷰 차트 바로가기(2026-10-22 사용자) — 미국은 티커, 한국 KRX:코드, 일본 TSE:코드
  function tvSym(s) {
    var m = s._m || st.m;
    if (m === "kr" || /\.(KS|KQ)$/.test(s.tk || "")) return "KRX:" + s.code;
    if (m === "jp" || /\.T$/.test(s.tk || "")) return "TSE:" + s.code;
    return String(s.tk || s.code).replace("-", ".");
  }
  function tvBtn(s) {
    return '<a class="ta-tv" href="https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(tvSym(s)) + '" target="_blank" rel="noopener" title="트레이딩뷰에서 차트 열기" data-tv>T</a>';
  }
  function card(s) {
    var tags = [];
    if (s.nh) tags.push('<em class="t-nh">신고가 오늘</em>'); else if (s.nh5) tags.push('<em class="t-nh2">' + s.nh_since + "일 전 신고가</em>"); else if (s.from_hi != null) tags.push("<em>신고가까지 " + Number(-s.from_hi).toFixed(1) + "%</em>");
    if (s.vr != null) tags.push('<em class="' + (s.vr >= 3 ? "t-v3" : s.vr >= 2 ? "t-v2" : "") + '">거래량 ' + Number(s.vr).toFixed(1) + "배</em>");
    if (s.rs != null) tags.push('<em class="' + (s.rs >= 90 ? "t-rs" : "") + '">RS ' + s.rs + "</em>");
    if (s.per != null) tags.push("<em>" + (s.per < 0 ? "적자" : "PER " + Number(s.per).toFixed(1) + "배") + "</em>");
    return '<article class="ta-card" id="c-' + esc(s.code) + '" data-code="' + esc(s.code) + '" data-mk="' + esc(s._m || st.m) + '" title="눌러서 기업 정보 보기"><header><div class="nm"><b><button type="button" class="ta-star' + (favs()[s.tk] ? " on" : "") + '" data-fav="' + esc(s.tk) + '" data-fn="' + esc(s.name) + '" title="즐겨찾기">' + (favs()[s.tk] ? "★" : "☆") + "</button>" + tvBtn(s) + nameHTML(s) + '</b><small>' + esc(s.code) + " · " + esc(s.sector) + " · " + mcap(s) + '</small></div><div class="px"><b>' + price(s) + "</b>" + sgn(s.chg1d, 2) + "</div></header>" +
      '<div class="ch">' + mini(s) + '</div><div class="tg">' + tags.join("") + '</div><div class="rt"><span>1개월 ' + sgn(s.chg1m) + "</span><span>3개월 " + sgn(s.r3) + "</span><span>지수 대비 " + sgn(s.ex3) + "</span></div></article>";
  }

  /* ── 전체 그리기 ── */
  function render() {
    if (st.m === "fav") return renderFav();
    var D = CACHE[st.m];
    var head = '<div class="ta-top"><div><h1>기술적 분석</h1><p class="ta-sub">신고가 · 거래량 · 상대강도만 봅니다. 장 마감 자료로 매일 갱신.</p></div>' +
      '<nav class="ta-mk" aria-label="시장">' + MARKETS.map(function (m) { return '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (st.m === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</nav></div>" +
      '<nav class="ta-views" aria-label="보기">' + VIEWS.map(function (v) { var n = D ? SPEC[v[0]].pick(filt(D.stocks)).length : ""; return '<button type="button" data-v="' + v[0] + '" aria-pressed="' + (st.v === v[0]) + '"><b>' + v[1] + (n !== "" ? "<i>" + n + "</i>" : "") + "</b><small>" + v[2] + "</small></button>"; }).join("") + "</nav>";
    if (!D) { host.innerHTML = head + '<div class="ta-empty">' + (D === null ? "자료를 불러오지 못했습니다." : "불러오는 중…") + "</div>"; bind(); return; }
    var pool = filt(D.stocks);   /* 시총 하한 · PER 상한 먼저 거른 뒤 보기별 목록(피라미드도 같이) */
    var spec = SPEC[st.v], base = spec.pick(pool);
    var secs = {}; base.forEach(function (s) { secs[s.sector] = (secs[s.sector] || 0) + 1; });
    var list = base.filter(function (s) { return (!st.sec || s.sector === st.sec) && (!st.q || (s.name + " " + (s.en || "") + " " + s.code).toLowerCase().indexOf(st.q.toLowerCase()) >= 0); });
    var sk = st.sort || spec.sort;
    list.sort(function (a, b) { return sval(b, sk) - sval(a, sk); });
    var SCHED = {us: "매일 아침 6시 20분(미국 장 마감 뒤)", kr: "평일 오후 4시 5분(장 마감 뒤)", jp: "평일 오후 4시 5분(장 마감 뒤)"};
    var upd = (D.generated_at || "").replace("T", " ").slice(0, 16);
    var idx = (D.index || []).map(function (i) { return "<span><b>" + esc(i.name) + "</b> " + num(i.price, 2) + " " + sgn(i.chg1d, 2) + ' <small>3개월 ' + sgn(i.r3) + " · 고점 대비 " + sgn(i.from_hi) + "</small></span>"; }).join("");
    host.innerHTML = head +
      '<div class="ta-idx">' + idx + '<span class="asof">주가 기준일 ' + esc(D.as_of) + " · " + D.count + "종목 · <b>업데이트 " + esc(upd) + "</b> · 갱신 " + SCHED[st.m] + "</span></div>" +
      pyramid(st.v === "nh" ? base.filter(function (s) { return s.nh5; }) : base, spec.pyr, spec.pyrLabel) +
      '<div class="ta-ctl"><select data-sec><option value="">업종 전체 (' + base.length + ")</option>" + Object.keys(secs).sort(function (a, b) { return secs[b] - secs[a]; }).map(function (k) { return '<option value="' + esc(k) + '"' + (st.sec === k ? " selected" : "") + ">" + esc(k || "기타") + " (" + secs[k] + ")</option>"; }).join("") + "</select>" +
      '<select data-sort>' + SORTS.map(function (o) { return '<option value="' + o[0] + '"' + (sk === o[0] ? " selected" : "") + ">" + o[1] + " 순</option>"; }).join("") + "</select>" +
      '<input type="search" placeholder="이름·코드 검색" value="' + esc(st.q) + '" data-q>' +
      (st.v === "nh" ? '<label><input type="checkbox" data-today ' + (st.nhOnlyToday ? "checked" : "") + "> 오늘 신고가만</label>" : "") +
      (st.v === "vol" ? '<label><input type="checkbox" data-liq ' + (st.liq ? "checked" : "") + "> 거래 적은 종목 빼기</label>" : "") +
      '<label class="num">시총 <input type="number" min="0" step="any" inputmode="decimal" placeholder="제한 없음" value="' + esc(st.cap[st.m]) + '" data-cap> ' + CAPU[st.m] + " 이상</label>" +
      '<label class="num">PER <input type="number" min="0" step="any" inputmode="decimal" placeholder="제한 없음" value="' + esc(st.per[st.m]) + '" data-per> 배 미만</label>' +
      '<span class="cnt">' + list.length + "종목</span></div>" +
      (list.length ? '<div class="ta-grid">' + list.map(card).join("") + "</div>" : '<div class="ta-empty">조건에 맞는 종목이 없습니다.</div>') +
      '<p class="ta-foot">신고가 = 그날 종가가 직전 52주(252거래일) 종가 최고를 넘은 것 · 거래량 배수 = 그날 거래량 ÷ 직전 50거래일 평균 · RS(상대강도) = 3개월 40%·6·9·12개월 각 20% 가중 수익률을 시장 안에서 1~99로 줄 세운 값 · PER = 시가총액 ÷ 최근 4분기 순이익(일본은 일본 기업 화면의 PER을 오늘 주가로 맞춤, 적자·자료 없는 종목은 PER 조건을 넣으면 빠짐) · 차트는 최근 6개월 종가(점선 = 52주 종가 최고), 아래 막대는 거래량. 자료: 야후 일봉.</p>';
    bind();
  }
  function renderFav() {
    var top = '<div class="ta-top"><div><h1>기술적 분석</h1><p class="ta-sub">★ 즐겨찾기한 종목만 모아 봅니다(미국·한국·일본). 카드의 ☆를 누르면 넣고 뺍니다.</p></div>' +
      '<nav class="ta-mk" aria-label="시장">' + MARKETS.map(function (m) { return '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (st.m === m[0]) + '">' + m[1] + "</button>"; }).join("") + "</nav></div>";
    var ms = ["us", "kr", "jp"];
    if (ms.some(function (m) { return CACHE[m] === undefined; })) { host.innerHTML = top + '<div class="ta-empty">불러오는 중…</div>'; bind(); return; }
    var F = favs(), L = [];
    ms.forEach(function (m) { ((CACHE[m] || {}).stocks || []).forEach(function (s) { if (F[s.tk]) { s._m = m; L.push(s); } }); });
    var MK = {us: "미국", kr: "한국", jp: "일본"};
    host.innerHTML = top + (L.length ? ms.map(function (m) { var g = L.filter(function (s) { return s._m === m; }); return g.length ? '<h3 class="ta-favh">' + MK[m] + " <small>" + g.length + "종목 · 업데이트 " + esc(((CACHE[m] || {}).generated_at || "").replace("T", " ").slice(0, 16)) + '</small></h3><div class="ta-grid">' + g.map(card).join("") + "</div>" : ""; }).join("")
      : '<div class="ta-empty">아직 즐겨찾기한 종목이 없습니다. 미국·한국·일본 카드의 ☆를 눌러 보세요.</div>');
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
    [["cap", "[data-cap]"], ["per", "[data-per]"]].forEach(function (x) { var el = host.querySelector(x[1]); if (el) el.onchange = function () { var v = el.value.trim(); st[x[0]][st.m] = v === "" ? "" : Math.max(0, parseFloat(v)) || ""; save(); render(); }; });
    host.querySelectorAll(".ta-card[data-code]").forEach(function (el) { el.onclick = function () { openInfo(el.dataset.code, el.dataset.mk); }; });
    host.querySelectorAll("[data-tv]").forEach(function (a) { a.onclick = function (e) { e.stopPropagation(); }; });   // 카드 클릭(기업 정보)과 겹치지 않게
    host.querySelectorAll("[data-fav]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); favToggleTk(b.dataset.fav, b.dataset.fn); var on = !!favs()[b.dataset.fav]; b.classList.toggle("on", on); b.textContent = on ? "★" : "☆"; if (st.m === "fav") render(); }; });
    host.querySelectorAll("[data-jump]").forEach(function (b) { b.onclick = function () { var el = document.getElementById("c-" + b.dataset.jump); if (!el) { st.sec = ""; st.q = ""; render(); el = document.getElementById("c-" + b.dataset.jump); } if (el) { el.scrollIntoView({behavior: "smooth", block: "center"}); host.querySelectorAll(".ta-card.flash").forEach(function (x) { x.classList.remove("flash"); }); void el.offsetWidth; el.classList.add("flash"); } }; });
  }
  /* ── 기업 정보 창(카드를 누르면) — 미국 주식 창(stocks-common.js openStatModal)과 같은 모양 ──
     일봉: data/ta/c/{시장}/{코드}.json(화면 목록 종목) · 없으면 최근 6개월 종가로 대신 · 재무: 미국 메가캡 financials.json, 한국 종목 파일 fin
     소개: 미국 메가캡 프로필 · 일본 사업 요약·최근 근황 · 상세 화면 연결(일본 기업 화면 / 데이터 허브 기업별) */
  var MEGA = null, FIN = null;
  function loadMega() {
    if (MEGA) return Promise.resolve();
    return Promise.all([fetch("megacap_lite.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
                        fetch("financials.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })])
      .then(function (a) { MEGA = {}; (a[0].stocks || []).forEach(function (x) { MEGA[x.ticker] = x; }); FIN = a[1] || {}; });
  }
  function openInfo(code, mk) {
    var m = mk || st.m, D = CACHE[m]; if (!D || typeof openStatModal !== "function") return;
    var s = D.stocks.find(function (x) { return x.code === code; }); if (!s) return;
    var file = s.cf ? fetch("data/ta/c/" + m + "/" + String(code).replace(/[^A-Za-z0-9._-]/g, "_") + ".json?v=" + (D.generated_at || "")).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([file, m === "us" ? loadMega() : Promise.resolve()]).then(function (a) {
      var cd = a[0], candles = cd && cd.candles;
      if (!candles || !candles.length) {   // 일봉 파일이 없으면 최근 6개월 종가로 대신(시가=고가=저가=종가)
        var d0 = new Date(s.cd), k = 0;
        candles = (s.c || []).map(function (x) { var d = new Date(d0.getTime()); d.setDate(d.getDate() + Math.round(k++ * 1.4)); return {d: d.toISOString().slice(0, 10), o: x, h: x, l: x, c: x, v: 0}; });
        if (candles.length) candles[candles.length - 1].d = s.date;
      }
      var mg = m === "us" && MEGA ? MEGA[s.tk] || MEGA[s.code] : null;
      var fin = m === "us" ? (FIN && (FIN[s.tk] || FIN[s.code])) : m === "kr" ? cd && cd.fin : null;
      var chips = [
        {label: "52주 고점 대비", value: s.nh ? "오늘 신고가" : (s.from_hi == null ? "—" : (s.from_hi > 0 ? "+" : "") + s.from_hi.toFixed(1) + "%"), cls: s.nh ? "up" : ""},
        {label: "거래량", value: s.vr == null ? "—" : s.vr.toFixed(1) + "배 (평소 대비)", cls: s.vr >= 2 ? "up" : ""},
        {label: "RS", value: s.rs == null ? "—" : String(s.rs), cls: s.rs >= 90 ? "up" : ""},
        {label: "1개월", value: s.chg1m == null ? "—" : (s.chg1m > 0 ? "+" : "") + s.chg1m.toFixed(1) + "%", cls: s.chg1m > 0 ? "up" : s.chg1m < 0 ? "down" : ""},
        {label: "3개월", value: s.r3 == null ? "—" : (s.r3 > 0 ? "+" : "") + s.r3.toFixed(1) + "%", cls: s.r3 > 0 ? "up" : s.r3 < 0 ? "down" : ""},
        {label: "12개월", value: s.r12 == null ? "—" : (s.r12 > 0 ? "+" : "") + s.r12.toFixed(1) + "%", cls: s.r12 > 0 ? "up" : s.r12 < 0 ? "down" : ""},
        {label: "시총", value: mcap(s), cls: ""},
        {label: "PER(최근 4분기)", value: s.per == null ? "—" : s.per < 0 ? "적자" : Number(s.per).toFixed(1) + "배", cls: ""}
      ];
      if (mg && (mg.pe_now != null || mg.pe_next != null)) chips.push({label: "선행PER", per: true, cls: "", value: (mg.pe_now != null ? "올해 " + mg.pe_now : "") + (mg.pe_now != null && mg.pe_next != null ? " → " : "") + (mg.pe_next != null ? "내년 " + mg.pe_next : "")});
      var intro = [s.about || (mg && mg.biz) || ""].concat(s.seg ? ["사업 비중: " + s.seg.map(function (x) { return x.n + (x.p != null ? " " + x.p + "%" : ""); }).join(" · ")] : []).concat((s.recent || []).map(function (x) { return "· " + x; })).filter(Boolean).join("\n");
      openStatModal({
        name: m === "jp" && s.en && s.en !== s.name ? s.name + " (" + s.en + ")" : s.name,
        sub: s.code + " · " + (s.sector || "") + (s.sub && m === "kr" ? " · " + s.sub : ""),
        price: s.price, priceCcy: m === "us" ? "$" : m === "kr" ? "₩" : "¥", r1d: s.chg1d,
        chips: chips, candles: candles, financials: fin || undefined, news: mg && mg.news ? mg.news : undefined,
        intro: intro || undefined, tk: s.tk
      });
      var body = document.querySelector("#modal-back .m-body");
      if (body) {
        var link = m === "jp" ? '<a href="jp-screener.html?code=' + encodeURIComponent(s.code) + '">일본 기업 화면에서 재무제표·월차·실적 보기 →</a>'
          : m === "kr" ? '<a href="datahub.html?co=' + encodeURIComponent(s.code) + '#company">데이터 허브 기업별 데이터에서 보기 →</a>'
          : '<a href="https://finance.yahoo.com/quote/' + encodeURIComponent(s.tk) + '" target="_blank" rel="noopener">야후 파이낸스에서 보기 ↗</a>';
        var div = document.createElement("div"); div.className = "ta-info-link"; div.innerHTML = link + (cd ? "" : ' <small>(일봉 대신 최근 6개월 종가선)</small>');
        body.insertBefore(div, body.firstChild);
        var p = body.querySelector("p.note"); if (p) p.style.whiteSpace = "pre-line";
      }
    });
  }
  function load() {
    var need = (st.m === "fav" ? ["us", "kr", "jp"] : [st.m]).filter(function (m) { return CACHE[m] === undefined || CACHE[m] === null; });
    render();
    need.forEach(function (m) {
      delete CACHE[m];
      fetch("data/ta/" + m + ".json?v=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { CACHE[d.market] = d; render(); }).catch(function () { CACHE[m] = null; render(); });
    });
  }
  save(); load();
})();
