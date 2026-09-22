/* AI 관련 데이터 모음 + 기업별 데이터 모음 — data/ai_indicators.json · data/company_links.json 을 읽어 그린다.
   #ai-workspace : 비슷한 지표끼리 묶은 보드(카드 4개, 없으면 2개)를 한 화면에 바로 보여준다. 카드의 "크게 보기"에서 기간·종목 겹쳐보기.
   #company-workspace : 기업마다 지정한 지표를 주가와 같은 기간으로 위아래로 나란히 본다(축 하나씩, 이중축 없음).
   파일에 "sample": true 가 있으면 SAMPLE 배지를 띄운다. 빈 값은 0이나 예시로 채우지 않는다. */
(function () {
  "use strict";
  var host = document.getElementById("ai-workspace"), companyHost = document.getElementById("company-workspace");
  if (!host && !companyHost) return;

  // 다크 표면(#111925) 기준 명도·채도·색약 분리 검증을 통과한 고정 순서 팔레트. 순서를 바꾸거나 돌려쓰지 않는다.
  var COLORS = ["#5b8cff", "#22a886", "#a070e6", "#c9801f", "#dc5573", "#3399c2"];
  var PRICE_COLOR = "#c9d6ea";
  var METHOD = {api: "API", scrape: "수집", manual: "수동", computed: "계산", linked: "연결"};
  var RANGES = ["3M", "6M", "1Y", "2Y", "ALL"];
  var TS_TYPES = {line: 1, bars: 1, stack: 1, share: 1, share_abs: 1};
  var SHORT_UNIT = {"T 토큰": "T", "$M": "M", "$B": "B", "%": "%", "억$": "억", "$/M": "", "$/GPU·h": "", "NT$ 십억": "", "개": "", "tok/s": "", "M회": "M"};
  var STORE = "vantage-ai-indicators-v2";
  var DATA = null, LINKS = null, loading = false, error = "";
  var modal = null, modalRange = "1Y", overlay = {}, company = null, companyRange = "1Y", customLinks = {}, board = "demand";

  try { var saved = JSON.parse(localStorage.getItem(STORE) || "{}"); overlay = saved.overlay || {}; company = saved.company || null; customLinks = saved.customLinks || {}; companyRange = saved.companyRange || companyRange; board = saved.board || board; } catch (e) {}
  function persist() { try { localStorage.setItem(STORE, JSON.stringify({overlay: overlay, company: company, customLinks: customLinks, companyRange: companyRange, board: board})); } catch (e) {} }

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function finite(v) { return typeof v === "number" && isFinite(v); }
  function ts(d) { return Date.parse(d.slice(0, 10) + "T00:00:00Z"); }
  function safeURL(v) { try { var u = new URL(v); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; } }
  function fmt(v, digits) {
    if (!finite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e4) return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 0}).format(v);
    return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: digits == null ? 1 : digits, minimumFractionDigits: 0}).format(v);
  }
  function pct(d, suffix) {
    if (!finite(d)) return '<span class="ai-delta">—</span>';
    return '<span class="ai-delta ' + (d > 0.05 ? "up" : d < -0.05 ? "dn" : "") + '">' + (d > 0 ? "+" : "") + d.toFixed(1) + (suffix || "%") + "</span>";
  }
  function good(points) { return (points || []).filter(function (p) { return p && /^\d{4}-\d{2}-\d{2}/.test(p.date) && finite(p.value); }); }
  function clip(points, r, to) {
    var g = good(points); if (!g.length || r === "ALL") return g;
    var last = to || ts(g[g.length - 1].date), months = {"3M": 3, "6M": 6, "1Y": 12, "2Y": 24}[r] || 12;
    var from = new Date(last); from.setUTCMonth(from.getUTCMonth() - months);
    return g.filter(function (p) { return ts(p.date) >= from.getTime() && ts(p.date) <= last; });
  }
  function lines(s) {
    if (s.type === "line" || s.type === "bars") return [{label: s.label, points: good(s.points)}];
    return (s.lines || []).map(function (l) { return {label: l.label, points: good(l.points)}; });
  }
  /* 누적 막대(stack)는 모든 구성원이 값을 낸 날짜만 쓴다 — 일부 기업만 먼저 실적을 낸 분기는 합계가 급감한 것처럼 보이므로 뺀다 */
  function completeDates(s) {
    var ls = (s.lines || []).filter(function (l) { return good(l.points).length; }), cnt = {};
    ls.forEach(function (l) { good(l.points).forEach(function (p) { cnt[p.date] = (cnt[p.date] || 0) + 1; }); });
    return Object.keys(cnt).filter(function (d) { return cnt[d] === ls.length; }).sort();
  }
  /* 누적 막대(stack)는 합계 한 줄로 바꿔 겹쳐보기·기업 탭에서 쓴다 */
  function totalLine(s) {
    if (s.type !== "stack") return good(s.points);
    var ok = completeDates(s), by = {};
    (s.lines || []).forEach(function (l) { good(l.points).forEach(function (p) { if (ok.indexOf(p.date) >= 0) by[p.date] = (by[p.date] || 0) + p.value; }); });
    return ok.map(function (d) { return {date: d, value: Math.round(by[d] * 100) / 100}; });
  }
  function seriesById(id) { return DATA && (DATA.series || []).find(function (s) { return s.id === id; }); }
  function tickerLabel(t) { var c = DATA && DATA.companies && DATA.companies[t]; return c ? c.label : t; }
  /* ── 움직임 ─────────────────────────────────────────────
     보드가 처음 화면에 들어올 때 한 번만: 카드가 순서대로 떠오르고, 선은 그려지고, 막대는 자라고, 숫자는 0부터 올라간다.
     이미 본 보드는 다시 그려도(창 크기 변경 등) 재생하지 않는다. 움직임 최소화 설정이면 전부 끈다. */
  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches, seenBoards = {}, kpiCounted = false;
  function countSpan(v, digits) { return '<span class="ai-count" data-v="' + v + '" data-d="' + (digits == null ? 1 : digits) + '">' + fmt(v, digits) + "</span>"; }
  function countUp(els) {
    if (REDUCED) return;
    Array.prototype.forEach.call(els, function (el) {
      var target = Number(el.dataset.v), digits = Number(el.dataset.d), t0 = null;
      if (!finite(target)) return;
      function step(t) {
        if (t0 === null) t0 = t;
        var k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(target * e, digits);
        if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(target, digits);
      }
      requestAnimationFrame(step);
    });
  }
  var replay = false, playTimer = null;
  function animateBoard() {
    if (REDUCED || !host.offsetParent) return; // 숨겨진 탭에서는 재생하지 않는다
    var b = host.querySelector(".ai-board");
    if (b && (replay || !seenBoards[b.id])) {
      seenBoards[b.id] = true; replay = false;
      b.classList.add("play"); countUp(b.querySelectorAll(".ai-count"));
      clearTimeout(playTimer); playTimer = setTimeout(function () { b.classList.remove("play"); }, 2200);
    }
    if (!kpiCounted) { kpiCounted = true; countUp(host.querySelectorAll(".ai-kpi .ai-count")); }
  }

  /* 수집 시각 (노란색) — "수집 2026-09-22 17:46". 실패해 이전 값을 쓰는 카드는 그 값을 받은 시각이 그대로 남는다. */
  function collected(s) {
    var t = String(s && s.updated_at || "").replace("T", " ").slice(0, 16);
    return t ? '<span class="ai-collected" title="이 카드의 값을 마지막으로 받아온 시각 (KST)">수집 ' + esc(t) + "</span>" : "";
  }
  function headline(s) {
    var g;
    if (s.stat) return {value: s.stat.value, delta: s.stat.yoy, dlabel: "YoY · " + s.stat.period, date: s.stat.period};
    if (s.type === "line" || s.type === "bars" || s.type === "stack") {
      g = s.type === "stack" ? totalLine(s) : good(s.points); if (!g.length) return null;
      var tbl = s.table && s.table.rows && s.table.rows[0];
      if (s.type === "bars" && tbl && tbl.yoy != null) return {value: g[g.length - 1].value, delta: tbl.yoy, dlabel: "YoY", date: g[g.length - 1].date};
      return {value: g[g.length - 1].value, delta: g.length > 1 ? (g[g.length - 1].value / g[g.length - 2].value - 1) * 100 : null, dlabel: "직전 대비", date: g[g.length - 1].date};
    }
    if (s.type === "stat" && s.stat) return {value: s.stat.value, delta: s.stat.yoy, dlabel: "YoY", date: s.stat.period};
    if (s.type === "rank" && s.items && s.items.length) return {value: s.items[0].value, lead: s.items[0].label, date: s.as_of};
    return null;
  }

  /* ── SVG 차트 ─────────────────────────────────────────── */
  function dateLabel(t) { var d = new Date(t); return String(d.getUTCFullYear()).slice(2) + "/" + ("0" + (d.getUTCMonth() + 1)).slice(-2); }
  function gridY(svg, L, R, T, B, width, height, lo, hi, fy) {
    for (var i = 0; i < 4; i++) {
      var yy = T + i / 3 * (height - T - B), val = hi - (hi - lo) * i / 3;
      svg.push('<path class="ai-gridline" d="M' + L + " " + yy.toFixed(1) + "H" + (width - R) + '"/><text x="' + (L - 7) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + esc(fy(val)) + "</text>");
    }
  }
  function xTicks(svg, first, last, L, R, width, height, B) {
    var n = Math.min(5, Math.max(2, Math.round((width - L - R) / 120)));
    for (var i = 0; i <= n; i++) {
      var t = first + (last - first) * i / n, xx = L + (width - L - R) * i / n;
      svg.push('<text x="' + xx.toFixed(1) + '" y="' + (height - 7) + '" text-anchor="' + (i === 0 ? "start" : i === n ? "end" : "middle") + '">' + dateLabel(t) + "</text>");
    }
  }
  function lineChart(o) {
    var width = o.width, height = o.height || 200, L = o.compact ? 44 : 54, R = o.endLabels ? 70 : 12, T = 12, B = 24;
    var all = [], dates = {};
    o.rows.forEach(function (r) { r.points.forEach(function (p) { all.push(p.value); dates[p.date] = 1; }); });
    var dl = Object.keys(dates).sort(); if (!dl.length) return null;
    var first = o.xFrom || ts(dl[0]), last = o.xTo || ts(dl[dl.length - 1]);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (o.zero) lo = Math.min(lo, 0);
    var min = lo, pad = Math.max((hi - lo) * .1, Math.abs(hi) * .02, .001); hi += pad; if (!(o.zero && lo === 0)) lo -= pad;
    if (min >= 0 && lo < 0) lo = 0; // 양수 지표는 0 아래로 축을 내리지 않는다
    var x = function (d) { return first === last ? (L + width - R) / 2 : L + (ts(d) - first) / (last - first) * (width - L - R); };
    var y = function (v) { return T + (hi - v) / (hi - lo) * (height - T - B); };
    var fy = o.fmtY || function (v) { return fmt(v, Math.abs(hi - lo) < 5 ? 2 : Math.abs(hi - lo) < 50 ? 1 : 0); };
    var svg = ['<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(o.aria || "") + '">'];
    gridY(svg, L, R, T, B, width, height, lo, hi, fy);
    xTicks(svg, first, last, L, R, width, height, B);
    if (o.baseline != null && o.baseline > lo && o.baseline < hi) svg.push('<path class="ai-axis" d="M' + L + " " + y(o.baseline).toFixed(1) + "H" + (width - R) + '" stroke-dasharray="4 4"/>');
    var ends = [], solo = o.rows.length === 1;
    var path = function (pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + x(p.date).toFixed(1) + " " + y(p.value).toFixed(1); }).join(" "); };
    o.rows.forEach(function (r) {
      if (!r.points.length) return;
      // 추정치(진행 중인 달 등)는 마지막에 점선으로 잇고 빈 점으로 그린다
      var pts = r.points, lastReal = pts.length - 1;
      while (lastReal > 0 && pts[lastReal].est) lastReal--;
      var solid = pts.slice(0, lastReal + 1), tail = pts.slice(lastReal), d = path(solid);
      if (solo && o.area && solid.length > 1) svg.push('<path class="ai-area" d="' + d + "L" + x(solid[solid.length - 1].date).toFixed(1) + " " + (height - B) + "L" + x(solid[0].date).toFixed(1) + " " + (height - B) + 'Z" fill="' + r.color + '"/>');
      svg.push('<path class="ai-line' + (r.thick === false ? " thin" : "") + '" pathLength="1" d="' + d + '" stroke="' + r.color + '"/>');
      if (tail.length > 1) svg.push('<path class="ai-line est" d="' + path(tail) + '" stroke="' + r.color + '" stroke-dasharray="5 4"/>');
      var lp = pts[pts.length - 1], lx = x(lp.date), ly = y(lp.value);
      // 최신 점 — 퍼지는 고리 + 강조 테두리 + 값 표시
      svg.push('<circle class="ai-ping" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3.5" fill="' + r.color + '"/>');
      if (solo) svg.push('<circle class="ai-last-ring" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="7.5" fill="none" stroke="' + r.color + '"/>');
      svg.push('<circle class="ai-dot" cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="' + (pts.length === 1 ? 4.5 : 3.5) + '" ' + (lp.est ? 'fill="#111925" stroke-width="2.5" stroke="' + r.color + '"' : 'fill="' + r.color + '"') + "/>");
      if (solo && o.lastLabel !== false) {
        var txt = (o.fmtLabel || fy)(lp.value) + (o.unitShort ? o.unitShort : "");
        var near = lx > width - R - 46, ty = ly - 13 < T + 10 ? ly + 20 : ly - 13;
        svg.push('<text class="ai-last-label" x="' + (near ? lx - 11 : lx).toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + (near ? "end" : "middle") + '" fill="' + r.color + '">' + esc(txt) + "</text>");
      }
      ends.push({y: ly, label: r.short || r.label});
    });
    if (o.endLabels && ends.length > 1) {
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 12) ends[k].y = ends[k - 1].y + 12;
      ends.forEach(function (e) { svg.push('<text class="ai-end-label" x="' + (width - R + 7) + '" y="' + (e.y + 4).toFixed(1) + '">' + esc(e.label.length > 9 ? e.label.slice(0, 8) + "…" : e.label) + "</text>"); });
    }
    svg.push('<line class="ai-crosshair" x1="0" x2="0" y1="' + T + '" y2="' + (height - B) + '" style="display:none"/><rect class="ai-hit" x="' + L + '" y="' + T + '" width="' + (width - L - R) + '" height="' + (height - T - B) + '"/></svg>');
    var maps = o.rows.map(function (r) { var m = {}; r.points.forEach(function (p) { m[p.date] = p.value; }); return m; }), notes = {};
    o.rows.forEach(function (r) { r.points.forEach(function (p) { if (p.est) notes[p.date] = p.note || "추정"; }); });
    return {svg: svg.join(""), hover: {dates: dl, xs: dl.map(x), rows: o.rows, maps: maps, unit: o.unit, digits: o.digits, fmtY: o.fmtTip, notes: notes}};
  }
  function barChart(o) {
    var pts = o.points, width = o.width, height = o.height || 200, L = 50, R = 10, T = 12, B = 24, n = pts.length;
    if (!n) return null;
    var hi = Math.max.apply(null, pts.map(function (p) { return p.value; })) * 1.08, slot = (width - L - R) / n, bw = Math.max(2, Math.min(28, slot * .7));
    var y = function (v) { return T + (hi - v) / hi * (height - T - B); };
    var svg = ['<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(o.aria || "") + '">'];
    // 빗금 = 추정치 (진행 중인 달을 순별 잠정치로 월 환산)
    svg.push('<defs><pattern id="ai-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="rgba(91,140,255,.18)"/><line x1="0" y1="0" x2="0" y2="5" stroke="' + COLORS[0] + '" stroke-width="2.2"/></pattern></defs>');
    gridY(svg, L, R, T, B, width, height, 0, hi, function (v) { return fmt(v, 0); });
    var xs = [], lastReal = pts.length - 1;
    while (lastReal > 0 && pts[lastReal].est) lastReal--;
    pts.forEach(function (p, i) {
      var cx = L + slot * (i + .5); xs.push(cx);
      svg.push('<rect class="ai-bar" style="--i:' + i + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + y(p.value).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, height - B - y(p.value)).toFixed(1) + '" fill="' + (p.est ? "url(#ai-hatch)" : i === lastReal ? COLORS[0] : "#3d4f70") + '"/>');
      if (i === 0 || i === n - 1 || (n > 6 && i % Math.ceil(n / 5) === 0 && n - 1 - i > n / 10)) svg.push('<text x="' + cx.toFixed(1) + '" y="' + (height - 7) + '" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '">' + dateLabel(ts(p.date)) + "</text>");
    });
    svg.push('<line class="ai-crosshair" x1="0" x2="0" y1="' + T + '" y2="' + (height - B) + '" style="display:none"/><rect class="ai-hit" x="' + L + '" y="' + T + '" width="' + (width - L - R) + '" height="' + (height - T - B) + '"/></svg>');
    var m = {}, notes = {}; pts.forEach(function (p) { m[p.date] = p.value; if (p.est) notes[p.date] = p.note || "추정"; });
    return {svg: svg.join(""), hover: {dates: pts.map(function (p) { return p.date; }), xs: xs, rows: [{label: o.label, color: COLORS[0]}], maps: [m], unit: o.unit, digits: o.digits, notes: notes}};
  }
  function stackChart(s, width, height) {
    var ls = (s.lines || []).map(function (l) { return {label: l.label, points: good(l.points)}; });
    var dl = completeDates(s); if (!dl.length) return null;
    height = height || 200;
    var L = 50, R = 10, T = 12, B = 24, n = dl.length, slot = (width - L - R) / n, bw = Math.min(44, slot * .6);
    var maps = ls.map(function (l) { var m = {}; l.points.forEach(function (p) { m[p.date] = p.value; }); return m; });
    var totals = dl.map(function (d) { return maps.reduce(function (t, m) { return t + (m[d] || 0); }, 0); });
    var hi = Math.max.apply(null, totals) * 1.08, y = function (v) { return T + (hi - v) / hi * (height - T - B); };
    var svg = ['<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(s.label) + '">'];
    gridY(svg, L, R, T, B, width, height, 0, hi, function (v) { return fmt(v, 0); });
    var xs = [];
    dl.forEach(function (d, i) {
      var cx = L + slot * (i + .5), acc = 0; xs.push(cx);
      maps.forEach(function (m, k) { var v = m[d] || 0; if (v <= 0) return;
        var top = y(acc + v), h = Math.max(0, y(acc) - top - 2); // 2px 표면 간격
        svg.push('<rect class="ai-bar" style="--i:' + i + '" x="' + (cx - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + COLORS[k % COLORS.length] + '"/>'); acc += v; });
      var dd = new Date(ts(d));
      svg.push('<text x="' + cx.toFixed(1) + '" y="' + (height - 7) + '" text-anchor="middle">' + String(dd.getUTCFullYear()).slice(2) + "Q" + (Math.floor(dd.getUTCMonth() / 3) + 1) + "</text>");
    });
    svg.push('<line class="ai-crosshair" x1="0" x2="0" y1="' + T + '" y2="' + (height - B) + '" style="display:none"/><rect class="ai-hit" x="' + L + '" y="' + T + '" width="' + (width - L - R) + '" height="' + (height - T - B) + '"/></svg>');
    var rowsH = ls.map(function (l, k) { return {label: l.label, color: COLORS[k % COLORS.length]}; }).concat([{label: "합계", color: PRICE_COLOR}]);
    maps.push(dl.reduce(function (m, d, i) { m[d] = Math.round(totals[i] * 10) / 10; return m; }, {}));
    return {svg: svg.join(""), hover: {dates: dl, xs: xs, rows: rowsH, maps: maps, unit: s.unit, digits: s.digits}};
  }
  function sparkline(points) {
    var g = good(points).slice(-40); if (g.length < 2) return "";
    var lo = Math.min.apply(null, g.map(function (p) { return p.value; })), hi = Math.max.apply(null, g.map(function (p) { return p.value; }));
    var d = g.map(function (p, i) { return (i ? "L" : "M") + (i / (g.length - 1) * 100).toFixed(1) + " " + (hi === lo ? 15 : 27 - (p.value - lo) / (hi - lo) * 24).toFixed(1); }).join("");
    return '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + COLORS[0] + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
  }
  function attachHover(box, h) {
    var svg = box.querySelector("svg"), cross = box.querySelector(".ai-crosshair");
    if (!svg || !h || !cross) return;
    var tip = document.createElement("div"); tip.className = "ai-tip"; tip.style.display = "none"; box.appendChild(tip);
    var vb = svg.viewBox.baseVal;
    svg.addEventListener("mousemove", function (e) {
      var rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * vb.width / rect.width, best = 0;
      for (var i = 1; i < h.xs.length; i++) if (Math.abs(h.xs[i] - px) < Math.abs(h.xs[best] - px)) best = i;
      var d = h.dates[best]; cross.style.display = ""; cross.setAttribute("x1", h.xs[best]); cross.setAttribute("x2", h.xs[best]);
      tip.innerHTML = "<b>" + esc(d.slice(0, 10)) + (h.notes && h.notes[d] ? " · ▨ " + esc(h.notes[d]) : "") + "</b>" + h.rows.map(function (r, k) { var v = h.maps[k][d]; return finite(v) ? '<div><span><i style="--c:' + r.color + '"></i>' + esc(r.label) + "</span><span>" + esc((h.fmtY ? h.fmtY(v, r) : fmt(v, h.digits)) + (h.unit && !h.fmtY ? " " + h.unit : "")) + "</span></div>" : ""; }).join("");
      tip.style.display = ""; var left = h.xs[best] * rect.width / vb.width;
      tip.style.left = Math.max(80, Math.min(rect.width - 80, left)) + "px"; tip.style.top = "4px";
    });
    svg.addEventListener("mouseleave", function () { cross.style.display = "none"; tip.style.display = "none"; });
  }
  function legend(rows) { return rows && rows.length > 1 ? '<div class="ai-legend">' + rows.map(function (r) { var last = r.points && r.points.length ? r.points[r.points.length - 1].value : null; return '<span><i style="--c:' + r.color + '"></i><b>' + esc(r.label) + "</b>" + (finite(last) ? "<em>" + fmt(last, 2) + "</em>" : "") + "</span>"; }).join("") + "</div>" : ""; }

  /* ── 카드 본문 (타입별) ───────────────────────────────── */
  function accumulating(s, rows) {
    var d = rows.map(function (r) { return r.points.length ? r.points[r.points.length - 1].date : null; }).filter(Boolean)[0];
    return '<div class="ai-accum"><div class="ai-accum-vals">' + rows.filter(function (r) { return r.points.length; }).map(function (r) { var p = r.points[r.points.length - 1]; return '<span><i style="--c:' + r.color + '"></i>' + esc(r.label) + "<b>" + fmt(p.value, s.digits) + "</b></span>"; }).join("") +
      '</div><p>매일 쌓이는 중 · 첫 관측 ' + esc(d || "—") + " · 과거 이력은 공개되지 않아 오늘부터 누적합니다.</p></div>";
  }
  /* plot(s, width, height, range) → {html, hover, legendRows} */
  /* 추이를 볼 수 있는 지표는 꺾은선으로 그린다. 여러 기업을 쌓아 보는 캐팩스(stack)만 막대. */
  function plot(s, width, height, range) {
    if (s.type === "stack") { var st = stackChart(s, width, height); return st ? {html: st.svg, hover: st.hover, legendRows: (s.lines || []).map(function (l, k) { return {label: l.label, color: COLORS[k % COLORS.length], points: good(l.points)}; })} : {html: empty(s)}; }
    var rows = lines(s).map(function (l, k) { return {label: l.label, color: COLORS[k % COLORS.length], thick: true, points: clip(l.points, range || "ALL")}; }).filter(function (r) { return r.points.length; });
    if (!rows.length) return {html: empty(s)};
    if (rows.every(function (r) { return r.points.length < 2; })) return {html: accumulating(s, rows)};
    var ch = lineChart({width: width, height: height, rows: rows, unit: s.unit, digits: s.digits, aria: s.label, area: rows.length === 1, zero: s.type === "share" || s.type === "bars", compact: true, unitShort: SHORT_UNIT[s.unit] || ""});
    return {html: ch.svg, hover: ch.hover, legendRows: rows.length > 1 ? rows : null};
  }
  function empty(s) {
    return '<div class="ai-empty"><span aria-hidden="true">∿</span><b>' + esc(s.status_note || (s.method === "manual" ? "발표가 나오면 입력하는 지표예요" : "아직 표시할 관측값이 없어요")) + "</b><p>빈 값을 0이나 예시 숫자로 채우지 않습니다.</p></div>";
  }
  function rankHTML(s, limit) {
    var items = (s.items || []).filter(function (i) { return finite(i.value); }).slice(0, limit || 10);
    if (!items.length) return empty(s);
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }));
    return '<div class="ai-rank">' + items.map(function (i, k) {
      var name = safeURL(i.url) ? '<a href="' + esc(safeURL(i.url)) + '" target="_blank" rel="noopener">' + esc(i.label) + "</a>" : esc(i.label);
      return '<div class="ai-rank-row' + (i.label === "기타" ? " other" : "") + '" style="--i:' + k + '"><span><em>' + (k + 1) + "</em>" + name + '</span><div class="ai-rank-bar"><i style="width:' + (i.value / max * 100).toFixed(1) + '%"></i></div><span>' + fmt(i.value, s.digits) + (s.unit === "%" ? "%" : "") +
        (i.delta != null ? " " + pct(i.delta, s.delta_unit || "%") : "") + "</span></div>"; }).join("") + "</div>";
  }
  function tableHTML(t, limit) {
    if (!t || !t.rows || !t.rows.length) return "";
    var cols = t.columns;
    return '<div class="ai-table-wrap"><table class="ai-table"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.align || "") + '">' + esc(c.label) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      t.rows.slice(0, limit || 99).map(function (r) {
        return "<tr>" + cols.map(function (c) {
          var v = r[c.key], cell;
          if (c.key === "rank") cell = esc(v) + (r.move ? ' <small class="' + (r.move > 0 ? "up" : "dn") + '">' + (r.move > 0 ? "▲" : "▼") + Math.abs(r.move) + "</small>" : "");
          else if (c.key === "yoy" || c.key === "mom") cell = finite(v) ? pct(v) : "—";
          else cell = finite(v) ? fmt(v, Math.abs(v) < 10 ? 2 : 1) : esc(v == null ? "—" : v);
          return '<td class="' + (c.align || "") + '">' + cell + "</td>";
        }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  function eventsHTML(s, limit) {
    var ev = (s.events || []).slice(0, limit || 99);
    if (!ev.length) return '<div class="ai-empty small"><span aria-hidden="true">◌</span><b>' + esc(s.empty_note || "아직 기록된 이벤트가 없어요") + "</b></div>";
    return '<ul class="ai-events">' + ev.map(function (e) {
      var head = e.before != null
        ? '<b>' + esc(e.label) + '</b><span class="n"><s>' + fmt(e.before, 2) + "</s> → " + fmt(e.after, 2) + " " + esc(e.unit || "") + " " + pct((e.after / e.before - 1) * 100) + "</span>"
        : '<b>' + esc(e.label) + (e.kind ? ' <small class="ai-kind ' + (e.kind === "전망" ? "proj" : "") + '">' + esc(e.kind) + "</small>" : "") + '</b><span class="n">' + (finite(e.amount) ? "$" + fmt(e.amount, 1) + "B" : "") + "</span>";
      var body = e.text ? (safeURL(e.url) ? '<a href="' + esc(safeURL(e.url)) + '" target="_blank" rel="noopener">' + esc(e.text) + "</a>" : esc(e.text)) : "";
      return '<li><time>' + esc(e.date) + "</time><div>" + head + (body ? "<p>" + body + (e.source ? " · <em>" + esc(e.source) + (e.sources > 1 ? " 외 " + (e.sources - 1) + "곳" : "") + "</em>" : "") + "</p>" : "") + "</div></li>";
    }).join("") + "</ul>";
  }
  function statHTML(s) {
    var st = s.stat; if (!st) return empty(s);
    return '<div class="ai-stat"><div class="ai-stat-main"><strong>' + fmt(st.value, s.digits) + "<small>" + esc(s.unit) + '</small></strong><span>' + esc(st.period) + '</span></div><div class="ai-stat-grid">' +
      '<div><em>금액 YoY</em>' + pct(st.yoy) + '</div><div><em>금액 MoM</em>' + pct(st.mom) + '</div><div><em>단가 ($/kg)</em><b>' + fmt(st.price, 0) + '</b></div><div><em>단가 YoY</em>' + pct(st.price_yoy) + "</div></div>" +
      (good(s.points).length > 1 ? '<div class="ai-stat-spark">' + sparkline(s.points) + "</div>" : '<p class="ai-mini-note">월간 확정치가 쌓이면 추이 막대가 붙습니다. 같은 구간끼리 비교합니다.</p>') + "</div>";
  }
  function capaHTML(s) {
    var rows = (s.manual || []).concat(s.rows || []);
    if (!rows.length) return '<div class="ai-empty small"><span aria-hidden="true">◌</span><b>' + esc(s.status_note || "확인 대기") + "</b><p>분기 실적 공시에서 12인치 환산 CAPA 문장을 찾으면 자동으로 채웁니다. 숫자를 임의로 채우지 않습니다.</p></div>";
    return '<ul class="ai-events">' + rows.slice(0, 6).map(function (r) { return "<li><time>" + esc(r.period || r.date) + "</time><div><b>" + esc(r.capacity ? "CAPA " + r.capacity : r.value ? r.value + " " + (r.scale || "") : "") + "</b><p>" + esc(r.text || r.note || "") + "</p></div></li>"; }).join("") + "</ul>";
  }

  /* ── AI 보드 렌더 ─────────────────────────────────────── */
  function cardHTML(s) {
    var h = headline(s), ts_ = TS_TYPES[s.type];
    var num = h ? '<div class="ai-card-num"><strong>' + (h.lead ? '<small class="lead">' + esc(h.lead) + "</small>" : "") + countSpan(h.value, s.digits) + (s.unit && s.type !== "rank" ? "<small>" + esc(s.unit) + "</small>" : s.unit === "%" ? "<small>%</small>" : "") + "</strong>" + (h.delta != null ? pct(h.delta) + '<em class="dl">' + esc(h.dlabel) + "</em>" : "") + "</div>" : "";
    var body;
    if (s.type === "rank") body = rankHTML(s, 8);
    else if (s.type === "table") body = tableHTML({columns: s.columns, rows: s.rows}, 8);
    else if (s.type === "events") body = eventsHTML(s, 5);
    else if (s.type === "stat") body = statHTML(s);
    else if (s.type === "capa") body = capaHTML(s);
    else body = '<div class="ai-plot" data-plot="' + esc(s.id) + '"></div>';
    var state = s.status === "stale" ? '<span class="ai-flag warn" title="' + esc(s.status_note || "") + '">갱신 실패 · 이전 값</span>' : s.status === "pending" ? '<span class="ai-flag">대기</span>' : "";
    return '<article class="ai-card t-' + esc(s.type) + '" data-card="' + esc(s.id) + '"><header><div><h4>' + esc(s.label) + state + "</h4><p>" + esc(s.source) + " · " + esc(s.cadence) + "</p>" + collected(s) + "</div>" + num + "</header>" +
      '<div class="ai-card-body">' + body + "</div>" +
      '<footer><p class="ai-desc" title="' + esc(s.caveat || "") + '">' + esc(s.desc || s.caveat || "") + "</p>" + '<button type="button" class="ai-more" data-open="' + esc(s.id) + '">' + (ts_ ? "크게 · 겹쳐보기" : "자세히") + " ↗</button></footer></article>";
  }
  function renderAI() {
    if (!host) return;
    if (!DATA) { host.innerHTML = '<div class="ai-header"><div><span class="ai-eyebrow">AI INFRA OBSERVATORY</span><h2>토큰에서 GPU까지.</h2><p>데이터를 불러오는 중…</p></div></div>'; return; }
    var isSample = !!DATA.sample, tg = DATA.telegram || {}, groups = DATA.groups || [], boards = DATA.boards || {};
    if (groups.length && !groups.some(function (g) { return g.id === board; })) board = groups[0].id;
    var kpis = (DATA.kpis || []).map(seriesById).filter(Boolean);
    var stale = (DATA.series || []).filter(function (s) { return s.status === "stale"; }).length;
    host.innerHTML =
      '<div class="ai-header"><div><span class="ai-eyebrow">AI INFRA OBSERVATORY</span><h2>토큰에서 GPU까지.</h2><p>수요 → 단가 → 하드웨어 → 메모리 → 캐팩스 순으로, 비슷한 지표끼리 한 판에 묶었습니다.</p></div>' +
      '<div class="ai-header-tools">' + (isSample ? '<span class="ai-pill ai-sample">SAMPLE · 디자인 미리보기</span>' : '<span class="ai-pill live"><i></i>매일 07:00 자동 수집 · 마지막 <b class="ai-gold">' + esc((DATA.generated_at || "").replace("T", " ").slice(0, 16)) + "</b></span>") +
      (stale ? '<span class="ai-pill warn" title="일부 소스 수집 실패 · 이전 값 유지">⚠ ' + stale + "개 이전 값</span>" : "") +
      '<span class="ai-pill ' + (tg.status === "live" ? "live" : "pending") + '"><i></i>텔레그램 ' + (tg.status === "live" ? "연결됨" : "연결 대기") + "</span>" +
      '<button type="button" id="ai-refresh" ' + (loading ? "disabled" : "") + ">" + (loading ? "확인 중…" : "새로고침 ↻") + "</button></div></div>" +
      (error ? '<p class="ai-warning" role="status">' + esc(error) + "</p>" : "") +
      '<div class="ai-kpis">' + kpis.map(function (k) { var h = headline(k); return '<button type="button" class="ai-kpi" data-jump="' + esc(k.group) + '"><b>' + esc(k.label) + "</b>" + (h && h.delta != null ? pct(h.delta) : "") + "<strong>" + (h ? countSpan(h.value, k.digits) : "—") + (k.unit ? "<small>" + esc(k.unit) + "</small>" : "") + "</strong>" + sparkline(k.type === "stack" ? totalLine(k) : k.points) + "</button>"; }).join("") + "</div>" +
      '<nav class="ai-boardtabs" role="tablist" aria-label="지표 묶음">' + groups.map(function (g, i) { var on = g.id === board; return '<button type="button" role="tab" aria-selected="' + on + '" class="' + (on ? "on" : "") + '" data-board="' + esc(g.id) + '"><em>0' + (i + 1) + "</em><b>" + esc(g.label) + "</b><small>" + esc(g.desc || "") + "</small></button>"; }).join("") + "</nav>" +
      (function () {
        var g = groups.find(function (x) { return x.id === board; }) || {}, list = (boards[g.id] || []).map(seriesById).filter(Boolean);
        return '<section class="ai-board" id="ai-board-' + esc(g.id) + '" role="tabpanel"><div class="ai-board-head"><h3>' + esc(g.label || "") + "</h3><span>" + esc(g.desc || "") + "</span>" + (g.id === "memory" ? '<a href="#trade" class="ai-link">수출입 탭에서 전체 표 보기 →</a>' : "") +
          '<span class="ai-board-nav"><button type="button" data-step="-1" aria-label="이전 묶음">‹</button><button type="button" data-step="1" aria-label="다음 묶음">›</button></span></div>' +
          '<div class="ai-cards n' + list.length + '">' + list.map(function (s, i) { return cardHTML(s).replace("<article ", '<article style="--d:' + i * 110 + 'ms" '); }).join("") + "</div></section>";
      })() +
      '<p class="ai-footnote">' + (isSample ? "지금 숫자는 화면 설계용 가상 수치입니다." : "매일 07:00(KST) GitHub Actions가 수집합니다. 소스가 실패한 날은 이전 값을 유지하고 카드에 표시합니다.") + ' <a href="https://github.com/minwook1011/vantage-0910/actions/workflows/ai-indicators.yml" target="_blank" rel="noopener">실행 이력 ↗</a></p>';
    host.querySelectorAll(".ai-plot").forEach(function (box) {
      var s = seriesById(box.dataset.plot); if (!s) return;
      var p = plot(s, Math.max(260, box.clientWidth), 156);
      box.innerHTML = legend(p.legendRows) + '<div class="ai-plot-svg">' + p.html + "</div>";
      if (p.hover) attachHover(box.querySelector(".ai-plot-svg"), p.hover);
    });
    host.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { openModal(b.dataset.open); }; });
    host.querySelectorAll("[data-board],[data-jump]").forEach(function (b) { b.onclick = function () { var id = b.dataset.board || b.dataset.jump; if (id === board) fitBoard(); else switchBoard(id); }; });
    host.querySelectorAll("[data-step]").forEach(function (b) { b.onclick = function () { var ids = groups.map(function (g) { return g.id; }), i = ids.indexOf(board); switchBoard(ids[(i + Number(b.dataset.step) + ids.length) % ids.length]); }; });
    var rf = document.getElementById("ai-refresh"); if (rf) rf.onclick = function () { load(true); };
    animateBoard();
  }
  /* 한 번에 한 묶음(카드 4개)만 보여준다 — 아래로 길게 내리지 않도록. 고른 묶음은 기억한다. */
  function switchBoard(id) {
    if (!id || id === board) return;
    board = id; replay = true; persist(); renderAI();
    fitBoard();
  }
  /* 카드 4개가 화면 아래로 잘리면, 묶음 탭이 상단 메뉴 바로 아래에 오도록 스크롤해 한 화면에 다 보이게 한다 */
  function fitBoard() {
    var nav = host.querySelector(".ai-boardtabs"), b = host.querySelector(".ai-board"), top = document.getElementById("topnav");
    if (!nav || !b) return;
    var offset = (top ? top.getBoundingClientRect().bottom : 0) + 8, navTop = nav.getBoundingClientRect().top;
    if (b.getBoundingClientRect().bottom > innerHeight || navTop < offset)
      window.scrollTo({top: scrollY + navTop - offset, behavior: REDUCED ? "auto" : "smooth"});
  }

  /* ── 크게 보기 모달 (기간 · 종목 겹쳐보기) ───────────── */
  function overlayTickers(s) { var l = overlay[s.id]; return Array.isArray(l) ? l.filter(function (t) { return DATA.companies && DATA.companies[t]; }).slice(0, 4) : []; }
  function openModal(id) { modal = id; renderModal(); }
  function closeModal() { modal = null; var m = document.getElementById("ai-modal"); if (m) m.remove(); document.body.classList.remove("ai-modal-open"); }
  function renderModal() {
    var s = seriesById(modal); if (!s) return closeModal();
    var m = document.getElementById("ai-modal");
    if (!m) { m = document.createElement("div"); m.id = "ai-modal"; m.className = "ai-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); document.body.appendChild(m); document.body.classList.add("ai-modal-open"); }
    var ts_ = TS_TYPES[s.type], tickers = ts_ && s.type !== "share" && s.type !== "share_abs" ? overlayTickers(s) : [];
    var pool = []; tickers.concat(s.related || []).forEach(function (t) { if (DATA.companies && DATA.companies[t] && pool.indexOf(t) < 0) pool.push(t); });
    m.innerHTML = '<div class="ai-modal-back" data-close></div><div class="ai-modal-box"><button class="ai-modal-x" type="button" data-close aria-label="닫기">×</button>' +
      '<div class="ai-detail-head"><div><span class="ai-state">' + esc(METHOD[s.method] || "") + " · " + esc(s.cadence || "") + "</span><h3>" + esc(s.label) + "</h3><p>" + esc(s.source || "") + "</p>" + collected(s) + (s.desc ? '<p class="ai-desc-lg">' + esc(s.desc) + "</p>" : "") + "</div></div>" +
      (ts_ ? '<div class="ai-toolbar"><div class="ai-seg">' + RANGES.map(function (r) { return '<button type="button" data-range="' + r + '" class="' + (r === modalRange ? "on" : "") + '">' + r + "</button>"; }).join("") + "</div>" + (tickers.length ? '<span class="ai-mini-note">지표와 종목을 구간 시작 = 100 으로 맞춘 상대 추이</span>' : "") + "</div>" : "") +
      '<div class="ai-modal-plot" id="ai-modal-plot"></div>' +
      (s.type === "rank" ? rankHTML(s, 20) : s.type === "table" ? tableHTML({columns: s.columns, rows: s.rows}) : s.type === "events" ? eventsHTML(s) : s.type === "stat" ? statHTML(s) : s.type === "capa" ? capaHTML(s) : "") +
      (s.table ? '<h5 class="ai-sub">표</h5>' + tableHTML(s.table) : "") +
      (ts_ && s.type !== "share" && s.type !== "share_abs" ? '<div class="ai-overlay"><div class="ai-overlay-head"><b>종목 겹쳐보기</b><span>' + (tickers.length ? tickers.length + "/4 선택" : "관련 종목을 눌러 주가와 나란히 봅니다") + '</span></div><div class="ai-chips">' +
        pool.map(function (t) { var i = tickers.indexOf(t); return '<button type="button" class="ai-chip' + (i >= 0 ? " on" : "") + '" data-ticker="' + esc(t) + '" style="--c:' + COLORS[(i + 1) % COLORS.length] + '"><i></i>' + esc(tickerLabel(t)) + "<small>" + esc(t) + "</small></button>"; }).join("") +
        '</div><p>주가는 일간 종가, 지표는 각자의 주기라 날짜가 정확히 맞지 않습니다. 같은 구간의 방향 비교용이며 인과관계를 뜻하지 않습니다.</p></div>' : "") +
      '<dl class="ai-source"><div><dt>출처</dt><dd>' + (safeURL(s.source_url) ? '<a href="' + esc(safeURL(s.source_url)) + '" target="_blank" rel="noopener">' + esc(s.source) + " ↗</a>" : esc(s.source || "—")) + "</dd></div><div><dt>갱신</dt><dd>" + esc(s.cadence || "—") + " · 마지막 수집 " + esc((s.updated_at || "").replace("T", " ").slice(0, 16)) + "</dd></div>" +
      "<div><dt>관련 종목</dt><dd>" + (s.related || []).map(function (t) { return esc(tickerLabel(t)); }).join(" · ") + "</dd></div></dl>" + (s.caveat ? '<p class="ai-caveat">' + esc(s.caveat) + "</p>" : "") + "</div>";
    var box = document.getElementById("ai-modal-plot");
    if (ts_) {
      var w = Math.max(300, box.clientWidth), p;
      if (tickers.length) {
        var base = clip(s.type === "stack" ? totalLine(s) : s.points, modalRange);
        var from = base.length ? ts(base[0].date) : 0, to = base.length ? ts(base[base.length - 1].date) : 0, rows = [];
        var idx = function (pts, label, color, short, thick) { var g = good(pts).filter(function (q) { return ts(q.date) >= from && ts(q.date) <= to; }); if (!g.length) return; var f = g[0].value; rows.push({label: label, short: short, color: color, thick: thick, points: g.map(function (q) { return {date: q.date, value: q.value / f * 100}; })}); };
        idx(base, s.label, COLORS[0], "지표", true);
        tickers.forEach(function (t, i) { idx(DATA.companies[t].points, tickerLabel(t), COLORS[(i + 1) % COLORS.length], t, false); });
        var ch = rows.length && lineChart({width: w, height: 300, rows: rows, digits: 1, endLabels: true, baseline: 100, fmtY: function (v) { return v.toFixed(0); }, fmtTip: function (v) { return v.toFixed(1); }});
        p = ch ? {html: ch.svg, hover: ch.hover, legendRows: rows} : {html: empty(s)};
      } else p = plot(s, w, 300, modalRange);
      box.innerHTML = legend(p.legendRows) + '<div class="ai-plot-svg">' + p.html + "</div>";
      if (p.hover) attachHover(box.querySelector(".ai-plot-svg"), p.hover);
    }
    m.querySelectorAll("[data-close]").forEach(function (b) { b.onclick = closeModal; });
    m.querySelectorAll("[data-range]").forEach(function (b) { b.onclick = function () { modalRange = b.dataset.range; renderModal(); }; });
    m.querySelectorAll("[data-ticker]").forEach(function (b) { b.onclick = function () { var l = overlayTickers(s), i = l.indexOf(b.dataset.ticker); if (i >= 0) l.splice(i, 1); else { if (l.length >= 4) l.shift(); l.push(b.dataset.ticker); } overlay[s.id] = l; persist(); renderModal(); }; });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal) closeModal(); });

  /* ── 기업별 데이터 모음 ─────────────────────────────── */
  function companyList() {
    var list = ((LINKS && LINKS.companies) || []).map(function (c) { return c.ticker; });
    Object.keys(customLinks).forEach(function (t) { if (list.indexOf(t) < 0 && DATA.companies[t]) list.push(t); });
    return list.filter(function (t) { return DATA.companies && DATA.companies[t]; });
  }
  function linksFor(t) {
    var base = (((LINKS && LINKS.companies) || []).find(function (c) { return c.ticker === t; }) || {}).indicators || [];
    var extra = customLinks[t] || {add: [], remove: []};
    return base.filter(function (id) { return (extra.remove || []).indexOf(id) < 0; }).concat((extra.add || []).filter(function (id) { return base.indexOf(id) < 0; }))
      .filter(function (id) { var s = seriesById(id); return s && TS_TYPES[s.type]; });
  }
  function renderCompany() {
    if (!companyHost) return;
    if (!DATA) { companyHost.innerHTML = '<div class="ai-header"><div><span class="ai-eyebrow">COMPANY × DATA</span><h2>기업별 데이터 모음</h2><p>불러오는 중…</p></div></div>'; return; }
    var list = companyList();
    if (!list.length) { companyHost.innerHTML = '<div class="ai-empty"><b>연결된 기업이 없습니다</b><p>data/company_links.json 에 기업과 지표를 지정하면 여기에 나타납니다.</p></div>'; return; }
    if (list.indexOf(company) < 0) company = list[0];
    var c = DATA.companies[company], links = linksFor(company);
    var price = clip(c.points, companyRange), last = price[price.length - 1], first = price[0];
    var ranged = function (arr) { return arr; };
    var options = (DATA.series || []).filter(function (s) { return TS_TYPES[s.type] && links.indexOf(s.id) < 0; });
    companyHost.innerHTML =
      '<div class="ai-header"><div><span class="ai-eyebrow">COMPANY × DATA</span><h2>기업별 데이터 모음</h2><p>기업마다 지정한 데이터를 주가와 같은 기간으로 위아래에 나란히 놓습니다.</p></div>' +
      '<div class="ai-header-tools"><div class="ai-seg">' + RANGES.map(function (r) { return '<button type="button" data-crange="' + r + '" class="' + (r === companyRange ? "on" : "") + '">' + r + "</button>"; }).join("") + "</div></div></div>" +
      '<div class="co-chips">' + list.map(function (t) { var cc = DATA.companies[t], g = good(cc.points), ch = g.length > 1 ? (g[g.length - 1].value / g[g.length - 2].value - 1) * 100 : null; return '<button type="button" class="co-chip' + (t === company ? " on" : "") + '" data-co="' + esc(t) + '"><b>' + esc(cc.label) + "</b><small>" + esc(t) + "</small>" + pct(ch) + "</button>"; }).join("") + "</div>" +
      '<div class="co-price"><div class="co-price-head"><div><h3>' + esc(c.label) + " <small>" + esc(company) + '</small></h3><p>일간 종가 · ' + esc(c.currency || "") + " · 야후 파이낸스</p></div>" +
      (last ? "<div class=\"ai-card-num\"><strong>" + fmt(last.value, c.market === "KR" ? 0 : 2) + "</strong>" + pct(first ? (last.value / first.value - 1) * 100 : null) + '<em class="dl">' + esc(companyRange) + " 수익률</em></div>" : "") +
      '</div><div class="ai-plot-svg" id="co-price-plot"></div></div>' +
      '<div class="co-grid">' + (links.length ? links.map(function (id) { var s = seriesById(id); return '<article class="ai-card co-card"><header><div><h4>' + esc(s.label) + "</h4><p>" + esc(s.source) + " · " + esc(s.cadence) + "</p>" + collected(s) + '</div><button type="button" class="co-x" data-unlink="' + esc(id) + '" aria-label="연결 해제">×</button></header>' +
        '<div class="co-pair"><div class="co-mini-label">주가</div><div class="ai-plot-svg" data-cp="' + esc(id) + '"></div><div class="co-mini-label">' + esc(s.label) + (s.unit ? " · " + esc(s.unit) : "") + '</div><div class="ai-plot-svg" data-ci="' + esc(id) + '"></div></div></article>'; }).join("") : '<div class="ai-empty small"><b>아직 연결한 데이터가 없어요</b><p>아래에서 지표를 골라 붙이세요.</p></div>') + "</div>" +
      '<div class="co-add"><label>데이터 연결 <select id="co-add-sel"><option value="">— 지표 선택 —</option>' + (DATA.groups || []).map(function (g) { var opts = options.filter(function (s) { return s.group === g.id; }); return opts.length ? '<optgroup label="' + esc(g.label) + '">' + opts.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.label) + "</option>"; }).join("") + "</optgroup>" : ""; }).join("") + '</select></label><button type="button" id="co-add-btn">연결</button>' +
      '<p>여기서 붙인 연결은 이 브라우저에만 저장됩니다. 고정하거나 새 기업(티커)을 추가하려면 알려주세요 — <code>data/company_links.json</code> 에 넣으면 다음 수집 때 주가까지 받아옵니다.</p></div>';
    var pw = document.getElementById("co-price-plot");
    if (price.length) {
      // 끝은 오늘까지 — 미국 종가는 한국 날짜로 하루 늦어, 오늘 처음 쌓인 지표가 기간 밖으로 빠지지 않게 한다
      var from = ts(price[0].date), to = Math.max(ts(price[price.length - 1].date), ts(new Date().toISOString()));
      var pc = lineChart({width: Math.max(300, pw.clientWidth), height: 220, rows: [{label: c.label, color: PRICE_COLOR, thick: true, points: price}], digits: 2, area: true, aria: c.label + " 주가", xFrom: from, xTo: to});
      pw.innerHTML = pc.svg; attachHover(pw, pc.hover);
      companyHost.querySelectorAll("[data-ci]").forEach(function (box) {
        var s = seriesById(box.dataset.ci), w = Math.max(260, box.clientWidth);
        var src = s.type === "stack" ? [{label: s.label + " 합계", points: totalLine(s)}] : lines(s);
        var rows = src.map(function (l, k) { return {label: l.label, color: COLORS[k % COLORS.length], thick: true, points: good(l.points).filter(function (p) { return ts(p.date) >= from && ts(p.date) <= to; })}; }).filter(function (r) { return r.points.length; });
        var pbox = companyHost.querySelector('[data-cp="' + s.id + '"]');
        var pp = lineChart({width: w, height: 110, rows: [{label: c.label, color: PRICE_COLOR, thick: true, points: price}], digits: 2, compact: true, xFrom: from, xTo: to});
        pbox.innerHTML = pp.svg; attachHover(pbox, pp.hover);
        if (!rows.length) { box.innerHTML = '<p class="ai-mini-note co-none">이 기간에 관측값이 없습니다' + (good(src[0] && src[0].points).length ? " · 첫 관측 " + esc(good(src[0].points)[0].date) : "") + "</p>"; return; }
        if (rows.every(function (r) { return r.points.length < 2; })) { box.innerHTML = accumulating(s, rows); return; }
        var ic = lineChart({width: w, height: 130, rows: rows, unit: s.unit, digits: s.digits, compact: true, xFrom: from, xTo: to, area: rows.length === 1});
        box.innerHTML = legend(rows.length > 1 ? rows : null) + ic.svg; attachHover(box, ic.hover);
      });
    }
    companyHost.querySelectorAll("[data-co]").forEach(function (b) { b.onclick = function () { company = b.dataset.co; persist(); renderCompany(); }; });
    companyHost.querySelectorAll("[data-crange]").forEach(function (b) { b.onclick = function () { companyRange = b.dataset.crange; persist(); renderCompany(); }; });
    companyHost.querySelectorAll("[data-unlink]").forEach(function (b) { b.onclick = function () { var x = customLinks[company] || (customLinks[company] = {add: [], remove: []}); var id = b.dataset.unlink; x.add = (x.add || []).filter(function (v) { return v !== id; }); if ((x.remove || (x.remove = [])).indexOf(id) < 0) x.remove.push(id); persist(); renderCompany(); }; });
    document.getElementById("co-add-btn").onclick = function () { var id = document.getElementById("co-add-sel").value; if (!id) return; var x = customLinks[company] || (customLinks[company] = {add: [], remove: []}); x.remove = (x.remove || []).filter(function (v) { return v !== id; }); if ((x.add || (x.add = [])).indexOf(id) < 0) x.add.push(id); persist(); renderCompany(); };
  }

  /* ── 로드 · 이벤트 ─────────────────────────────────────── */
  function externalSeries() {
    return (DATA.series || []).filter(function (s) { return (s.type === "line" || s.type === "bars") && good(s.points).length > 1; }).map(function (s, i) { return {id: s.id, label: s.label, unit: s.unit, group: "external", color: COLORS[i % COLORS.length], points: good(s.points)}; });
  }
  function renderAll() { renderAI(); renderCompany(); if (modal) renderModal(); }
  function load(manual) {
    if (loading) return; loading = true; error = ""; if (manual) renderAI();
    var get = function (p) { return fetch(p + "?v=" + Date.now(), {cache: "no-store"}).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); };
    Promise.all([get("data/ai_indicators.json"), get("data/company_links.json").catch(function () { return {companies: []}; })])
      .then(function (res) { if (res[0].schema_version !== 1 || !Array.isArray(res[0].series)) throw new Error("schema"); DATA = res[0]; LINKS = res[1]; })
      .catch(function (e) { error = "AI 지표 데이터 파일 수신 실패 (" + e.message + "). 기존에 받은 자료가 있으면 유지합니다."; if (!DATA) DATA = {groups: [], series: [], companies: {}}; })
      .then(function () { loading = false; renderAll(); document.dispatchEvent(new CustomEvent("vantage-external-data", {detail: {series: externalSeries()}})); });
  }
  // 숨겨진 탭 안에서는 폭이 0이라, 탭이 열릴 때 다시 그린다
  document.addEventListener("vantage-view", function () { if (DATA) renderAll(); });
  var resizeTimer; window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (DATA) renderAll(); }, 150); });
  renderAI(); renderCompany();
  load(false);
})();
