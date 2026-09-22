/* AI 인프라 지표 워크스페이스 — data/ai_indicators.json 을 읽어 #ai-workspace 에 그린다.
   수요(토큰) → 단가 → GPU·컴퓨팅 → 메모리 → 캐팩스 → 심리 순으로 AI 사이클을 한 화면에서 본다.
   지표마다 관련 종목을 겹쳐 볼 수 있고(=100 정규화, 축은 하나), 워크벤치로 보낼 수도 있다.
   파일에 "sample": true 가 있으면 SAMPLE 배지를 띄우고 수치를 판단 근거로 쓰지 않는다는 문구를 붙인다. */
(function () {
  "use strict";
  var host = document.getElementById("ai-workspace");
  if (!host) return;

  var DATA = null, group = "demand", selected = null, search = "", range = "1Y", mode = "raw", loading = false, error = "";
  var overlay = {};            // seriesId → 겹쳐 볼 티커 배열
  // 다크 표면(#111925) 기준 명도·채도·색약 분리 검증을 통과한 고정 순서 팔레트. 순서를 바꾸거나 돌려쓰지 않는다.
  var COLORS = ["#5b8cff", "#22a886", "#a070e6", "#c9801f", "#dc5573", "#3399c2"];
  var METHOD = {api: "API", scrape: "스크래핑", manual: "수동", computed: "계산", linked: "연결"};
  var METHOD_DESC = {api: "공식 API · 자동", scrape: "페이지 수집 · 구조 변경 시 점검", manual: "발표 후 손으로 입력", computed: "다른 지표로 계산", linked: "다른 워크스페이스와 같은 원본"};
  var RANGES = ["3M", "6M", "1Y", "ALL"];
  var STORE = "vantage-ai-indicators-v1";

  try { var saved = JSON.parse(localStorage.getItem(STORE) || "{}"); overlay = saved.overlay || {}; group = saved.group || group; range = saved.range || range; } catch (e) {}
  function persist() { try { localStorage.setItem(STORE, JSON.stringify({overlay: overlay, group: group, range: range})); } catch (e) {} }

  /* ── 유틸 ─────────────────────────────────────────────── */
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function finite(v) { return typeof v === "number" && isFinite(v); }
  function ts(d) { return Date.parse(d + "T00:00:00Z"); }
  function safeURL(v) { try { var u = new URL(v); return u.protocol === "https:" ? u.href : ""; } catch (e) { return ""; } }
  function fmt(v, digits) {
    if (!finite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + "B";
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: 0}).format(v);
    return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: digits == null ? 1 : digits}).format(v);
  }
  function delta(cur, prev) { return finite(cur) && finite(prev) && prev !== 0 ? (cur / prev - 1) * 100 : null; }
  function deltaTag(d, label) {
    if (d == null) return '<span class="ai-delta">—</span>';
    return '<span class="ai-delta ' + (d > 0.05 ? "up" : d < -0.05 ? "dn" : "") + '" title="' + esc(label || "직전 관측 대비") + '">' + (d > 0 ? "+" : "") + d.toFixed(1) + "%</span>";
  }
  function good(points) { return (points || []).filter(function (p) { return p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && finite(p.value); }); }
  function clip(points, r) {
    var g = good(points); if (!g.length || r === "ALL") return g;
    var last = ts(g[g.length - 1].date), months = {"3M": 3, "6M": 6, "1Y": 12}[r] || 12;
    var from = new Date(last); from.setUTCMonth(from.getUTCMonth() - months);
    return g.filter(function (p) { return ts(p.date) >= from.getTime(); });
  }
  function seriesLines(s) {
    if (s.type === "line") return [{label: s.label, points: s.points || []}];
    return (s.lines || []).map(function (l) { return {label: l.label, points: l.points || []}; });
  }
  function latestOf(s) {
    if (s.type === "line") { var g = good(s.points); return g.length ? {value: g[g.length - 1].value, prev: g.length > 1 ? g[g.length - 2].value : null, date: g[g.length - 1].date} : null; }
    if (s.type === "stack") { var ls = seriesLines(s), n = Math.min.apply(null, ls.map(function (l) { return good(l.points).length; })); if (!n) return null;
      var sum = function (k) { return ls.reduce(function (t, l) { var g = good(l.points); return t + g[g.length - k].value; }, 0); };
      return {value: sum(1), prev: n > 1 ? sum(2) : null, date: good(ls[0].points).slice(-1)[0].date}; }
    if (s.type === "rank") return s.items && s.items.length ? {value: s.items.reduce(function (t, i) { return t + (finite(i.value) ? i.value : 0); }, 0), prev: null, date: s.as_of} : null;
    if (s.type === "events") return s.events && s.events.length ? {value: null, prev: null, date: s.events[0].date, count: s.events.length} : null;
    var first = good(seriesLines(s)[0] && seriesLines(s)[0].points); return first.length ? {value: first[first.length - 1].value, prev: null, date: first[first.length - 1].date, lead: seriesLines(s)[0].label} : null;
  }
  function tickerLabel(t) { var c = DATA.companies && DATA.companies[t]; return c ? c.label : t; }
  function findCompany(q) {
    q = String(q || "").trim(); if (!q || !DATA.companies) return null;
    var keys = Object.keys(DATA.companies), lq = q.toLowerCase();
    return keys.find(function (k) { return k.toLowerCase() === lq; }) || keys.find(function (k) { return DATA.companies[k].label.toLowerCase() === lq; }) ||
      keys.find(function (k) { return k.toLowerCase().indexOf(lq) >= 0 || DATA.companies[k].label.toLowerCase().indexOf(lq) >= 0; }) || null;
  }
  function rows() {
    return (DATA.series || []).filter(function (s) { return s.group === group && (s.label + " " + (s.source || "") + " " + (s.related || []).map(tickerLabel).join(" ")).toLowerCase().indexOf(search.toLowerCase()) >= 0; });
  }

  /* ── SVG 차트 ─────────────────────────────────────────── */
  function axisTicks(first, last, n) {
    var out = [], span = last - first;
    for (var i = 0; i <= n; i++) out.push(first + span * i / n);
    return out;
  }
  function dateLabel(t) { var d = new Date(t); return String(d.getUTCFullYear()).slice(2) + "/" + ("0" + (d.getUTCMonth() + 1)).slice(-2); }
  /* 여러 줄을 한 축에 그린다. rows: [{label,color,points,dash,thick}] */
  function lineChart(opts) {
    var width = opts.width, height = 280, L = 54, R = opts.endLabels ? 74 : 18, T = 18, B = 30;
    var all = [], dates = {};
    opts.rows.forEach(function (r) { r.points.forEach(function (p) { all.push(p.value); dates[p.date] = 1; }); });
    var dl = Object.keys(dates).sort(); if (!dl.length) return null;
    var first = ts(dl[0]), last = ts(dl[dl.length - 1]);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (opts.zero) lo = Math.min(lo, 0);
    var pad = Math.max((hi - lo) * .1, Math.abs(hi) * .02, .001); lo -= pad; hi += pad;
    if (opts.zero && lo < 0 && Math.min.apply(null, all) >= 0) lo = 0;
    var x = function (d) { return first === last ? (L + width - R) / 2 : L + (ts(d) - first) / (last - first) * (width - L - R); };
    var y = function (v) { return T + (hi - v) / (hi - lo) * (height - T - B); };
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(opts.aria || "") + '">';
    for (var i = 0; i < 5; i++) { var yy = T + i / 4 * (height - T - B), val = hi - (hi - lo) * i / 4;
      svg += '<path class="ai-gridline" d="M' + L + " " + yy.toFixed(1) + "H" + (width - R) + '"/><text x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + esc(opts.fmtY ? opts.fmtY(val) : fmt(val, opts.digits)) + "</text>"; }
    axisTicks(first, last, Math.min(6, Math.max(2, Math.round((width - L - R) / 110)))).forEach(function (t, i, arr) {
      var xx = L + (t - first) / (last - first || 1) * (width - L - R);
      svg += '<text x="' + xx.toFixed(1) + '" y="' + (height - 9) + '" text-anchor="' + (i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle") + '">' + dateLabel(t) + "</text>"; });
    if (opts.baseline != null && opts.baseline >= lo && opts.baseline <= hi) svg += '<path class="ai-axis" d="M' + L + " " + y(opts.baseline).toFixed(1) + "H" + (width - R) + '" stroke-dasharray="4 4"/>';
    var ends = [];
    opts.rows.forEach(function (r, idx) {
      var path = "", pen = false;
      r.points.forEach(function (p) { path += (pen ? "L" : "M") + x(p.date).toFixed(1) + " " + y(p.value).toFixed(1) + " "; pen = true; });
      if (opts.rows.length === 1 && opts.area) svg += '<path class="ai-area" d="' + path + "L" + x(r.points[r.points.length - 1].date).toFixed(1) + " " + y(lo).toFixed(1) + "L" + x(r.points[0].date).toFixed(1) + " " + y(lo).toFixed(1) + 'Z" fill="' + r.color + '"/>';
      svg += '<path class="ai-line' + (r.thick ? "" : " thin") + '" d="' + path + '" stroke="' + r.color + '"' + (r.dash ? ' stroke-dasharray="5 4"' : "") + "/>";
      var lp = r.points[r.points.length - 1];
      svg += '<circle class="ai-dot" cx="' + x(lp.date).toFixed(1) + '" cy="' + y(lp.value).toFixed(1) + '" r="4" fill="' + r.color + '"/>';
      ends.push({y: y(lp.value), label: r.label, short: r.short, value: lp.value, color: r.color});
    });
    if (opts.endLabels && ends.length > 1) { // 끝 라벨 겹침 방지
      ends.sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
      ends.forEach(function (e) { var lab = e.short || e.label; svg += '<text class="ai-end-label" x="' + (width - R + 8) + '" y="' + (e.y + 4).toFixed(1) + '">' + esc(lab.length > 9 ? lab.slice(0, 8) + "…" : lab) + "</text>"; });
    }
    svg += '<line class="ai-crosshair" id="ai-cross" x1="0" x2="0" y1="' + T + '" y2="' + (height - B) + '" style="display:none"/>';
    svg += '<rect class="ai-hit" x="' + L + '" y="' + T + '" width="' + (width - L - R) + '" height="' + (height - T - B) + '"/></svg>';
    var maps = opts.rows.map(function (r) { var m = {}; r.points.forEach(function (p) { m[p.date] = p.value; }); return m; });
    return {svg: svg, hover: {dates: dl, xs: dl.map(x), rows: opts.rows, maps: maps, unit: opts.unit, digits: opts.digits, fmtY: opts.fmtY, top: T}};
  }
  function stackChart(s, width) {
    var lines = seriesLines(s).map(function (l) { return {label: l.label, points: good(l.points)}; });
    var dl = lines[0].points.map(function (p) { return p.date; }); if (!dl.length) return null;
    var height = 280, L = 54, R = 18, T = 18, B = 30, n = dl.length, slot = (width - L - R) / n, bw = Math.min(46, slot * .62);
    var totals = dl.map(function (d, i) { return lines.reduce(function (t, l) { return t + (l.points[i] ? l.points[i].value : 0); }, 0); });
    var hi = Math.max.apply(null, totals) * 1.08, y = function (v) { return T + (hi - v) / hi * (height - T - B); };
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(s.label) + '">';
    for (var i = 0; i < 5; i++) { var yy = T + i / 4 * (height - T - B); svg += '<path class="ai-gridline" d="M' + L + " " + yy.toFixed(1) + "H" + (width - R) + '"/><text x="' + (L - 8) + '" y="' + (yy + 4).toFixed(1) + '" text-anchor="end">' + fmt(hi - hi * i / 4, s.digits) + "</text>"; }
    var xs = [];
    dl.forEach(function (d, i) {
      var cx = L + slot * (i + .5), acc = 0; xs.push(cx);
      lines.forEach(function (l, k) { var v = l.points[i] ? l.points[i].value : 0; if (v <= 0) return;
        var top = y(acc + v), bottom = y(acc), h = Math.max(0, bottom - top - 2); // 2px 표면 간격
        svg += '<rect class="ai-bar" x="' + (cx - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + COLORS[k % COLORS.length] + '"/>'; acc += v; });
      if (n <= 12 || i === 0 || i === n - 1 || i % Math.ceil(n / 8) === 0) svg += '<text x="' + cx.toFixed(1) + '" y="' + (height - 9) + '" text-anchor="middle">' + (n <= 8 ? d.slice(0, 7).replace("-", "/") : dateLabel(ts(d))) + "</text>";
    });
    svg += '<line class="ai-crosshair" id="ai-cross" x1="0" x2="0" y1="' + T + '" y2="' + (height - B) + '" style="display:none"/>';
    svg += '<rect class="ai-hit" x="' + L + '" y="' + T + '" width="' + (width - L - R) + '" height="' + (height - T - B) + '"/></svg>';
    var rowsH = lines.map(function (l, k) { return {label: l.label, color: COLORS[k % COLORS.length]}; }).concat([{label: "합계", color: "#c9d6ea"}]);
    var maps = lines.map(function (l) { var m = {}; l.points.forEach(function (p) { m[p.date] = p.value; }); return m; }); maps.push(dl.reduce(function (m, d, i) { m[d] = totals[i]; return m; }, {}));
    return {svg: svg, hover: {dates: dl, xs: xs, rows: rowsH, maps: maps, unit: s.unit, digits: s.digits, top: T}};
  }
  function sparkline(points) {
    var g = good(points).slice(-30); if (g.length < 2) return "";
    var lo = Math.min.apply(null, g.map(function (p) { return p.value; })), hi = Math.max.apply(null, g.map(function (p) { return p.value; }));
    var d = g.map(function (p, i) { return (i ? "L" : "M") + (i / (g.length - 1) * 100).toFixed(1) + " " + (hi === lo ? 15 : 27 - (p.value - lo) / (hi - lo) * 24).toFixed(1); }).join("");
    return '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="#5b8cff" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
  }
  function attachHover(box, h) {
    var svg = box.querySelector("svg"), cross = box.querySelector("#ai-cross"), tip = document.createElement("div");
    if (!svg || !h) return; tip.className = "ai-tip"; tip.style.display = "none"; box.appendChild(tip);
    var vw = svg.viewBox.baseVal.width;
    function move(e) {
      var rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * vw / rect.width, best = 0;
      for (var i = 1; i < h.xs.length; i++) if (Math.abs(h.xs[i] - px) < Math.abs(h.xs[best] - px)) best = i;
      var d = h.dates[best]; cross.style.display = ""; cross.setAttribute("x1", h.xs[best]); cross.setAttribute("x2", h.xs[best]);
      tip.innerHTML = "<b>" + esc(d) + "</b>" + h.rows.map(function (r, k) { var v = h.maps[k][d]; return '<div><span><i style="--c:' + r.color + '"></i>' + esc(r.label) + "</span><span>" + (finite(v) ? esc((h.fmtY ? h.fmtY(v) : fmt(v, h.digits)) + (h.unit ? " " + h.unit : "")) : "—") + "</span></div>"; }).join("");
      tip.style.display = ""; var left = h.xs[best] * rect.width / vw; tip.style.left = Math.max(80, Math.min(rect.width - 80, left)) + "px"; tip.style.top = (h.top * rect.height / svg.viewBox.baseVal.height - 6) + "px";
    }
    svg.addEventListener("mousemove", move);
    svg.addEventListener("mouseleave", function () { cross.style.display = "none"; tip.style.display = "none"; });
  }

  /* ── 지표별 본문 ─────────────────────────────────────── */
  function overlayTickers(s) { var list = overlay[s.id]; return Array.isArray(list) ? list.filter(function (t) { return DATA.companies && DATA.companies[t]; }).slice(0, 4) : []; }
  function chartBody(s, width) {
    if (s.type === "rank") {
      var items = (s.items || []).filter(function (i) { return finite(i.value); }), max = Math.max.apply(null, items.map(function (i) { return i.value; }));
      return {html: '<div class="ai-rank">' + items.map(function (i) { return '<div class="ai-rank-row' + (i.label === "기타" ? " other" : "") + '"><span>' + esc(i.label) + '</span><div class="ai-rank-bar"><i style="width:' + (i.value / max * 100).toFixed(1) + '%"></i></div><span>' + fmt(i.value, s.digits) + "</span></div>"; }).join("") + "</div>" + (s.as_of ? '<p class="ai-caveat">' + esc(s.as_of) + " 주 기준 · 단위 " + esc(s.unit) + "</p>" : "")};
    }
    if (s.type === "events") {
      return {html: '<table class="ai-events"><thead><tr><th>날짜</th><th>항목</th><th>' + (s.events.some(function (e) { return e.before != null; }) ? "변경" : "내용") + '</th></tr></thead><tbody>' +
        s.events.map(function (e) { return '<tr><td class="d">' + esc(e.date) + '</td><td class="t">' + esc(e.label) + "</td>" + (e.before != null ? '<td class="n"><s>' + fmt(e.before, 2) + "</s>→ <b>" + fmt(e.after, 2) + "</b> " + esc(e.unit || "") + " (" + (e.after / e.before * 100 - 100).toFixed(0) + "%)</td>" : '<td class="t">' + esc(e.text || "") + "</td>") + "</tr>"; }).join("") + "</tbody></table>"};
    }
    var lines = seriesLines(s), tickers = overlayTickers(s);
    if (s.type === "line" && mode === "overlay" && tickers.length) {
      var base = clip(s.points, range); if (!base.length) return {html: empty(s)};
      var from = ts(base[0].date), to = ts(base[base.length - 1].date), rowsO = [], all = [];
      var indexed = function (points, label, color, thick, short) { var g = good(points).filter(function (p) { return ts(p.date) >= from && ts(p.date) <= to; }); if (!g.length) return; var f = g[0].value;
        rowsO.push({label: label, short: short, color: color, thick: thick, points: g.map(function (p) { return {date: p.date, value: p.value / f * 100}; })}); };
      indexed(base, s.label, COLORS[0], true, "지표");
      tickers.forEach(function (t, i) { indexed(DATA.companies[t].points, tickerLabel(t), COLORS[(i + 1) % COLORS.length], false, t); });
      var c = lineChart({width: width, rows: rowsO, unit: "", digits: 1, aria: s.label + " 종목 겹쳐보기", endLabels: true, baseline: 100, fmtY: function (v) { return v.toFixed(0); }});
      return {html: c.svg, hover: c.hover, legend: rowsO, note: "구간 시작 = 100 으로 맞춘 상대 추이입니다. 축이 하나라 기울기만 비교하고, 절대 수준은 원래 차트에서 봅니다."};
    }
    if (s.type === "stack") { var st = stackChart(s, width); if (!st) return {html: empty(s)}; return {html: st.svg, hover: st.hover, legend: lines.map(function (l, k) { return {label: l.label, color: COLORS[k % COLORS.length]}; })}; }
    var rowsL = lines.map(function (l, k) { var g = clip(l.points, range); return g.length ? {label: l.label, color: COLORS[k % COLORS.length], thick: lines.length === 1, points: g} : null; }).filter(Boolean);
    if (!rowsL.length) return {html: empty(s)};
    var ch = lineChart({width: width, rows: rowsL, unit: s.unit, digits: s.digits, aria: s.label, area: true, endLabels: rowsL.length > 1, zero: s.type === "share"});
    return {html: ch.svg, hover: ch.hover, legend: rowsL.length > 1 ? rowsL : null};
  }
  function empty(s) {
    return '<div class="ai-empty"><span aria-hidden="true">∿</span><b>' + (s.method === "manual" ? "발표가 나오면 손으로 입력하는 지표예요" : "아직 표시할 관측값이 없어요") + "</b><p>실제 수치가 들어오면 이곳에 시계열이 그려집니다. 빈 값을 0이나 예시 숫자로 채우지 않습니다.</p></div>";
  }
  function legendHTML(rows) { return rows && rows.length ? '<div class="ai-legend">' + rows.map(function (r) { return '<span><i style="--c:' + r.color + '"' + (r.dash ? ' class="dash"' : "") + "></i><b>" + esc(r.label) + "</b></span>"; }).join("") + "</div>" : ""; }
  function overlayPanel(s) {
    if (s.type !== "line") return "";
    var on = overlayTickers(s), pool = [];
    on.concat(s.related || []).forEach(function (t) { if (DATA.companies && DATA.companies[t] && pool.indexOf(t) < 0) pool.push(t); });
    return '<div class="ai-overlay"><div class="ai-overlay-head"><b>종목 겹쳐보기</b><span>' + (on.length ? on.length + "/4 선택 · =100 정규화" : "관련 종목을 눌러 주가와 나란히 봅니다") + '</span></div>' +
      '<div class="ai-chips">' + pool.map(function (t) { var idx = on.indexOf(t); return '<button type="button" class="ai-chip' + (idx >= 0 ? " on" : "") + '" data-ai-ticker="' + esc(t) + '" style="--c:' + COLORS[(idx + 1) % COLORS.length] + '" aria-pressed="' + (idx >= 0) + '"><i></i>' + esc(tickerLabel(t)) + "<small>" + esc(t) + "</small></button>"; }).join("") + "</div>" +
      '<div class="ai-chip-add"><input id="ai-ticker-input" list="ai-ticker-options" placeholder="티커 또는 기업명 추가 · 예: MU, 삼성전자"><datalist id="ai-ticker-options">' + Object.keys(DATA.companies || {}).map(function (k) { return '<option value="' + esc(k) + '">' + esc(DATA.companies[k].label) + "</option>"; }).join("") + '</datalist><button type="button" id="ai-ticker-add">추가</button></div>' +
      '<p>주가는 일간 종가, 지표는 각자의 주기라 날짜가 정확히 맞지 않습니다. 겹쳐보기는 같은 구간의 방향을 비교하는 용도이며 인과관계를 뜻하지 않습니다.</p></div>';
  }

  /* ── 렌더 ─────────────────────────────────────────────── */
  function render() {
    var list = rows();
    if (!list.some(function (s) { return s.id === selected; })) selected = list[0] ? list[0].id : null;
    var s = list.find(function (v) { return v.id === selected; }), latest = s ? latestOf(s) : null, isSample = !!(DATA && DATA.sample);
    var kpis = (DATA.series || []).filter(function (v) { return v.kpi; }).slice(0, 6), tg = DATA.telegram || {};
    var g = (DATA.groups || []).find(function (v) { return v.id === group; }) || {};
    host.innerHTML =
      '<div class="ai-header"><div><span class="ai-eyebrow">AI INFRA OBSERVATORY</span><h2>토큰에서 GPU까지.</h2><p>수요 → 단가 → 하드웨어 → 캐팩스 순으로 AI 사이클을 한 화면에서 봅니다.</p></div>' +
      '<div class="ai-header-tools">' + (isSample ? '<span class="ai-pill ai-sample" title="' + esc(DATA.sample_note || "") + '">SAMPLE · 디자인 미리보기</span>' : "") +
      '<span class="ai-pill ' + (tg.status === "live" ? "live" : "pending") + '"><i></i>텔레그램 ' + esc(tg.label || "주간 요약") + (tg.status === "live" ? "" : " · 연결 대기") + "</span>" +
      '<button type="button" id="ai-refresh" ' + (loading ? "disabled" : "") + ">" + (loading ? "확인 중…" : "게시 데이터 새로고침 ↻") + "</button></div></div>" +
      '<div class="ai-flow" aria-hidden="true">' + (DATA.groups || []).map(function (v, i) { return (i ? "<em>→</em>" : "") + '<span class="' + (v.id === group ? "on" : "") + '">' + esc(v.label) + "</span>"; }).join("") + "</div>" +
      (error ? '<p class="ai-warning" role="status">' + esc(error) + " 기존에 받은 자료가 있으면 유지합니다.</p>" : "") +
      '<div class="ai-kpis">' + kpis.map(function (k) { var l = latestOf(k); return '<button type="button" class="ai-kpi' + (k.id === selected ? " on" : "") + '" data-ai-jump="' + esc(k.id) + '"><b>' + esc(k.label) + "</b>" + deltaTag(l ? delta(l.value, l.prev) : null) + "<strong>" + (l ? fmt(l.value, k.digits) : "—") + (k.unit ? "<small>" + esc(k.unit) + "</small>" : "") + "</strong>" + sparkline(k.type === "line" ? k.points : []) + "</button>"; }).join("") + "</div>" +
      '<div class="ai-tabs" role="group" aria-label="AI 지표 분류">' + (DATA.groups || []).map(function (v) { return '<button type="button" data-ai-group="' + esc(v.id) + '" class="' + (v.id === group ? "on" : "") + '" aria-pressed="' + (v.id === group) + '">' + esc(v.label) + "<small>" + esc(v.desc || "") + "</small></button>"; }).join("") + "</div>" +
      '<div class="ai-grid"><div class="ai-catalog"><label class="ai-search">' + esc(g.label || "") + " 지표 검색<input id=\"ai-search\" type=\"search\" value=\"" + esc(search) + '" placeholder="지표명, 출처, 종목…"></label><div class="ai-list" role="group" aria-label="지표 목록">' +
      (list.length ? list.map(function (item, i) { var l = latestOf(item); return '<button class="ai-item' + (selected === item.id ? " on" : "") + '" type="button" data-ai-id="' + esc(item.id) + '" style="--item-delay:' + Math.min(i, 10) * 30 + 'ms" aria-pressed="' + (selected === item.id) + '"><span>' + esc(item.label) + '</span><small><span class="ai-method ' + esc(item.method) + '">' + esc(METHOD[item.method] || item.method) + " · " + esc(item.cadence.split(" · ")[0]) + "</span><i>" + (l ? (item.type === "events" ? l.count + "건" : fmt(l.value, item.digits) + (item.unit ? " " + item.unit : "")) : "대기") + "</i></small></button>"; }).join("") : '<p class="ai-caveat">일치하는 지표가 없습니다.</p>') + "</div></div>" +
      '<article class="ai-detail">' + (s ? detail(s, latest, isSample) : '<div class="ai-empty"><span>∿</span><b>지표를 선택해 주세요</b></div>') + "</article></div>" +
      '<div class="ai-footer"><p class="ai-footnote">' + (isSample ? "지금 보이는 숫자는 화면 설계용 가상 수치입니다. 실제 수집이 연결되면 같은 자리에서 교체됩니다." : "예약은 GitHub Actions 기준이며 실행·배포 지연이 생길 수 있습니다.") + ' <a href="https://github.com/minwook1011/vantage-0910/actions" target="_blank" rel="noopener">실행 이력 ↗</a></p><p class="ai-footnote">파일 생성 ' + esc(DATA.generated_at || "—") + "</p></div>";
    bind(s);
    if (s) { var box = document.getElementById("ai-chart"); if (box && s._hover) attachHover(box, s._hover); }
  }
  function detail(s, latest, isSample) {
    var width = Math.max(300, (host.querySelector(".ai-detail") ? host.querySelector(".ai-detail").clientWidth : host.clientWidth * .6) - 46);
    var body = chartBody(s, width); s._hover = body.hover;
    var tickers = overlayTickers(s), showToolbar = s.type === "line" || s.type === "share" || s.type === "share_abs";
    return '<div class="ai-detail-head"><div><span class="ai-state ' + (isSample ? "sample" : latest ? "has-data" : "") + '">' + (isSample ? "샘플 데이터" : latest ? "관측값 연결" : "연결 대기") + " · " + esc(METHOD_DESC[s.method] || "") + "</span><h3>" + esc(s.label) + "</h3><p>" + esc(s.source || "") + " · " + esc(s.cadence || "") + "</p></div>" +
      '<div class="ai-detail-num"><strong>' + (latest && finite(latest.value) ? fmt(latest.value, s.digits) + (s.unit ? "<small>" + esc(s.unit) + "</small>" : "") : latest && latest.count ? latest.count + "<small>건</small>" : "—") + "</strong>" + (latest && latest.prev != null ? deltaTag(delta(latest.value, latest.prev)) : "") + "<em>" + (latest ? (latest.lead ? esc(latest.lead) + " · " : "") + "최신 " + esc(latest.date) : "관측 없음") + "</em></div></div>" +
      (showToolbar ? '<div class="ai-toolbar"><div class="ai-seg" id="ai-range">' + RANGES.map(function (r) { return '<button type="button" data-ai-range="' + r + '" class="' + (r === range ? "on" : "") + '">' + r + "</button>"; }).join("") + "</div>" +
        (s.type === "line" ? '<div class="ai-seg" id="ai-mode"><button type="button" data-ai-mode="raw" class="' + (mode === "raw" || !tickers.length ? "on" : "") + '">지표</button><button type="button" data-ai-mode="overlay" class="' + (mode === "overlay" && tickers.length ? "on" : "") + '" ' + (tickers.length ? "" : 'disabled title="아래에서 종목을 먼저 고르세요"') + ">종목 겹쳐보기 =100</button></div>" : "") + "</div>" : "") +
      legendHTML(body.legend) + '<div id="ai-chart" class="ai-chart">' + body.html + "</div>" + (body.note ? '<p class="ai-caveat">' + esc(body.note) + "</p>" : "") +
      overlayPanel(s) +
      '<dl class="ai-source"><div><dt>출처</dt><dd>' + (safeURL(s.source_url) ? '<a href="' + esc(safeURL(s.source_url)) + '" target="_blank" rel="noopener">' + esc(s.source) + " ↗</a>" : esc(s.source || "—")) + "</dd></div><div><dt>수집 방식</dt><dd>" + esc(METHOD[s.method] || s.method) + " — " + esc(METHOD_DESC[s.method] || "") + "</dd></div><div><dt>갱신 주기</dt><dd>" + esc(s.cadence || "—") + "</dd></div><div><dt>관련 종목</dt><dd>" + (s.related || []).map(function (t) { return esc(tickerLabel(t)) + " (" + esc(t) + ")"; }).join(" · ") + "</dd></div>" + (s.linked ? "<div><dt>연결</dt><dd>" + (s.linked === "memory" ? "메모리 워크스페이스와 같은 원본" : "TRASS 순별 수출 워크스페이스와 같은 원본") + "</dd></div>" : "") + "</dl>" +
      (s.caveat ? '<p class="ai-caveat">' + esc(s.caveat) + "</p>" : "") +
      (s.type === "line" ? '<button class="ai-send" id="ai-send" type="button"' + (latest ? "" : " disabled") + ">＋ 워크벤치로 보내기 · 기업 주가·실적과 비교</button>" : "");
  }
  function bind(s) {
    host.querySelectorAll("[data-ai-group]").forEach(function (b) { b.onclick = function () { group = b.dataset.aiGroup; search = ""; selected = null; persist(); render(); }; });
    host.querySelectorAll("[data-ai-id]").forEach(function (b) { b.onclick = function () { selected = b.dataset.aiId; render(); }; });
    host.querySelectorAll("[data-ai-jump]").forEach(function (b) { b.onclick = function () { var t = (DATA.series || []).find(function (v) { return v.id === b.dataset.aiJump; }); if (!t) return; group = t.group; selected = t.id; search = ""; persist(); render(); }; });
    host.querySelectorAll("[data-ai-range]").forEach(function (b) { b.onclick = function () { range = b.dataset.aiRange; persist(); render(); }; });
    host.querySelectorAll("[data-ai-mode]").forEach(function (b) { b.onclick = function () { mode = b.dataset.aiMode; render(); }; });
    host.querySelectorAll("[data-ai-ticker]").forEach(function (b) { b.onclick = function () { toggleTicker(s, b.dataset.aiTicker); }; });
    var refresh = document.getElementById("ai-refresh"); if (refresh) refresh.onclick = function () { load(true); };
    var input = document.getElementById("ai-search");
    if (input) input.oninput = function (e) { search = e.target.value; render(); var el = document.getElementById("ai-search"); el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (x) {} };
    var add = document.getElementById("ai-ticker-add"), tin = document.getElementById("ai-ticker-input");
    if (add && tin) { var go = function () { var t = findCompany(tin.value); if (!t) { tin.value = ""; tin.placeholder = "목록에 없는 종목입니다 · 수집 목록에 추가 필요"; return; } toggleTicker(s, t, true); }; add.onclick = go; tin.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } }; }
    var send = document.getElementById("ai-send");
    if (send) send.onclick = function () {
      document.dispatchEvent(new CustomEvent("vantage-external-select", {detail: {id: s.id}}));
      var wb = document.querySelector(".workbench"); if (wb) wb.scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"});
    };
  }
  function toggleTicker(s, t, forceOn) {
    var list = overlayTickers(s), i = list.indexOf(t);
    if (i >= 0 && !forceOn) list.splice(i, 1); else if (i < 0) { if (list.length >= 4) list.shift(); list.push(t); }
    overlay[s.id] = list; mode = list.length ? "overlay" : "raw"; persist(); render();
  }

  /* ── 로드 · 이벤트 ─────────────────────────────────────── */
  function externalSeries() {
    return (DATA.series || []).filter(function (s) { return s.type === "line" && good(s.points).length; }).map(function (s, i) { return {id: s.id, label: s.label, unit: s.unit, group: "external", color: COLORS[i % COLORS.length], points: good(s.points)}; });
  }
  function load(manual) {
    if (loading) return; loading = true; error = ""; if (manual && DATA) render();
    fetch("data/ai_indicators.json?v=" + Date.now(), {cache: "no-store"}).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (json) { if (json.schema_version !== 1 || !Array.isArray(json.series)) throw new Error("schema"); DATA = json; })
      .catch(function (e) { error = "AI 지표 데이터 파일 수신 실패 (" + e.message + ")."; if (!DATA) DATA = {groups: [], series: [], companies: {}}; })
      .then(function () { loading = false; render(); document.dispatchEvent(new CustomEvent("vantage-external-data", {detail: {series: externalSeries()}})); });
  }
  document.addEventListener("vantage-ai-focus", function (e) {
    var gid = e.detail && e.detail.group; if (gid && DATA && (DATA.groups || []).some(function (v) { return v.id === gid; })) { group = gid; selected = null; search = ""; persist(); render(); }
    host.scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"});
  });
  var resizeTimer; window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (DATA) render(); }, 120); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && DATA && !DATA.sample) load(false); });
  host.innerHTML = '<div class="ai-header"><div><span class="ai-eyebrow">AI INFRA OBSERVATORY</span><h2>토큰에서 GPU까지.</h2><p>데이터 파일을 불러오는 중…</p></div></div>';
  load(false);
})();
