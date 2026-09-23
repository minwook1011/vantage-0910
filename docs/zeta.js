/* 스캐터랩(제타) 트래픽 워크벤치 — data/zeta.json 을 읽어 그린다. 기업별 데이터 모음에서 "스캐터랩 (제타)"를 고르면 열린다.
   비상장이라 주가 대신 공개 대리 지표(앱 순위·평점 수·웹 순위·검색량·콘텐츠·고용 등)를 국가별·월간으로 겹쳐 본다.
   순위 지표는 값이 작을수록 좋으므로 차트에서는 위로 갈수록 좋게(뒤집힌 로그 축) 그린다. 빈 값은 0으로 채우지 않는다. */
(function () {
  "use strict";
  var C = window.FineMtecCore;
  var host = document.getElementById("zeta-workspace");
  if (!host || !C) return;
  var KEY = "vantage-zeta-bench-v1";
  var PALETTE = ["#83aaff", "#55d6bc", "#c7a2ff", "#ffbd76", "#53c5ee", "#fa829d", "#e7d27c", "#9fd675"];
  var GROUPS = [
    ["download", "다운로드 추이", "앱스토어 순위 · 평점 수 · 설치 구간"],
    ["users", "유저 수 추이", "MAU · 이용자 관련 대리 지표"],
    ["content", "작품 수", "캐릭터 · 스토리 수"],
    ["ads", "광고 · 바이럴", "광고 노출 · 공식 채널 · 해시태그"],
    ["web", "웹 순방문자 · 순위", "크롬 국가별 순위 · 글로벌 순위"],
    ["search", "검색 관심도", "네이버 · 일본 언급량"],
    ["company", "회사", "직원 수 · 공식 발표"]
  ];
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]; }); };
  var safeURL = function (v) { try { var u = new URL(v); return ["https:", "http:"].indexOf(u.protocol) >= 0 ? u.href : ""; } catch (e) { return ""; } };
  var finite = C.finite;
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var state = {country: saved.country || "all", cadence: saved.cadence === "daily" ? "daily" : "monthly", range: ["1Y", "2Y", "ALL"].indexOf(saved.range) >= 0 ? saved.range : "ALL", selected: Array.isArray(saved.selected) ? saved.selected : null, mode: saved.mode === "normalized" ? "normalized" : "units"};
  var DATA = null, active = false, loading = false, error = "", renderId = 0;
  function store() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function good(pts) { return (pts || []).filter(function (p) { return p && C.validDate(p.date) && finite(p.value); }); }
  function isRank(s) { return s.kind === "rank" || s.kind === "rank_bucket"; }
  function series() { return (DATA && DATA.series) || []; }
  function byId(id) { return series().filter(function (s) { return s.id === id; })[0]; }

  /* 월간 집계: 순위는 월 평균(반올림), 누적 카운트는 월말 값, 나머지는 월 평균. 이미 월간이면 그대로. */
  function monthly(s) {
    var pts = good(s.points);
    if (/월간|monthly/.test(s.cadence || "") || s.kind === "rank_bucket") return pts.map(function (p) { return Object.assign({}, p, {date: p.date.slice(0, 7) + "-01"}); });
    var by = {};
    pts.forEach(function (p) { (by[p.date.slice(0, 7)] = by[p.date.slice(0, 7)] || []).push(p); });
    return Object.keys(by).sort().map(function (m) {
      var list = by[m], last = list[list.length - 1];
      var v = s.kind === "cumulative" ? last.value : list.reduce(function (a, p) { return a + p.value; }, 0) / list.length;
      return {date: m + "-01", value: s.kind === "rank" ? Math.round(v) : Math.round(v * 100) / 100, n: list.length, partial: m === new Date().toISOString().slice(0, 7)};
    });
  }
  function pointsOf(s) { return state.cadence === "monthly" ? monthly(s) : good(s.points); }
  function fmt(v, s) {
    if (!finite(v)) return "—";
    if (s.kind === "rank_bucket") return "상위 " + (v >= 10000 ? (v / 10000).toLocaleString("ko-KR") + "만" : v.toLocaleString("ko-KR")) + "위";
    if (isRank(s)) return v.toLocaleString("ko-KR") + "위";
    var d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 1 : 2;
    return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: d}).format(v) + (s.unit && s.unit !== "위" ? " " + s.unit : "");
  }
  function change(s, pts) {
    var g = good(pts); if (g.length < 2) return null;
    var a = g[g.length - 2].value, b = g[g.length - 1].value;
    if (!a) return null;
    var pct = (b / a - 1) * 100;
    return isRank(s) ? -pct : pct; // 순위는 숫자가 줄면 개선
  }
  function visible(s) {
    if (state.country === "all") return true;
    if (state.country === "etc") return ["kr", "jp", "us"].indexOf(s.country) < 0;
    return s.country === state.country || s.country === "global" || !s.country;
  }
  function defaultSelection() {
    var pick = ["app_rank_ios_kr_free", "app_rank_ios_jp_free", "web_crux_kr", "web_crux_jp", "web_tranco"].filter(byId);
    return pick.length ? pick.slice(0, 3) : series().filter(function (s) { return good(s.points).length > 1; }).slice(0, 2).map(function (s) { return s.id; });
  }
  function selected() { if (!state.selected) state.selected = defaultSelection(); return state.selected.filter(byId); }
  function colorOf(id) { var i = selected().indexOf(id); return i >= 0 ? PALETTE[i % PALETTE.length] : "#51607a"; }

  function card(s) {
    var pts = pointsOf(s), g = good(pts), last = g[g.length - 1], ch = change(s, pts), on = selected().indexOf(s.id) >= 0;
    var pending = !g.length;
    var spark = "";
    var tail = g.slice(-24);
    if (tail.length > 1) {
      var tv = tail.map(function (p) { return isRank(s) ? -Math.log10(p.value) : p.value; }), lo = Math.min.apply(null, tv), hi = Math.max.apply(null, tv);
      spark = '<svg class="cb-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="' + tv.map(function (v, i) { return (i ? "L" : "M") + (i / (tv.length - 1) * 100).toFixed(1) + " " + (hi === lo ? 14 : 26 - (v - lo) / (hi - lo) * 24).toFixed(1); }).join(" ") + '" fill="none" stroke="' + (on ? colorOf(s.id) : "#7f93b6") + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
    }
    var badge = finite(ch) ? '<span class="cb-chg ' + (ch >= 0 ? "up" : "down") + '">' + (ch >= 0 ? "▲" : "▼") + Math.abs(ch).toFixed(1) + "%</span>" : "";
    return '<div class="cb-key' + (on ? " on" : "") + (pending ? " zt-pending" : "") + '" style="--series-color:' + esc(on ? colorOf(s.id) : "#51607a") + '">' +
      '<button type="button" class="cb-key-main" data-zt-toggle="' + esc(s.id) + '"' + (pending ? " disabled" : "") + ' aria-pressed="' + on + '">' +
      '<span class="cb-key-label">' + esc(s.label) + "</span>" +
      "<strong>" + (pending ? '<span class="zt-wait">' + esc(s.status_note || "수집 대기") + "</span>" : esc(fmt(last.value, s))) + (last && last.partial ? '<em class="cb-est">진행 중</em>' : "") + "</strong>" +
      "<small>" + esc(last ? last.date.slice(0, state.cadence === "monthly" ? 7 : 10) : (s.cadence || "")) + (finite(ch) ? (isRank(s) ? " · 순위 개선률 " : " · 직전 대비 ") : "") + "</small>" + badge + spark +
      '<span class="cb-key-state">' + (pending ? esc(s.source || "") : on ? "● 차트 표시 중" : "＋ 차트에 겹쳐보기") + "</span></button>" +
      (s.source_url && safeURL(s.source_url) ? '<a class="zt-src" href="' + esc(safeURL(s.source_url)) + '" target="_blank" rel="noopener" title="' + esc((s.source || "") + (s.note ? " · " + s.note : "")) + '">출처 ↗</a>' : "") + "</div>";
  }

  function render() {
    if (!active) return;
    if (!DATA) { host.innerHTML = '<div class="fm-chart-empty">' + (error ? "<b>제타 데이터를 불러오지 못했어요.</b><p>" + esc(error) + '</p><button class="fm-add" id="zt-retry" type="button">다시 불러오기</button>' : "제타 트래픽 지표를 불러오는 중입니다.") + "</div>"; var r = document.getElementById("zt-retry"); if (r) r.onclick = load; return; }
    var countries = [["all", "전체"], ["kr", "한국"], ["jp", "일본"], ["us", "미국"], ["etc", "기타 국가"]];
    var sections = GROUPS.map(function (g) {
      var list = series().filter(function (s) { return s.group === g[0] && visible(s); });
      if (!list.length) return "";
      return '<section class="zt-section"><div class="cb-keys-head"><b>' + esc(g[1]) + "</b><span>" + esc(g[2]) + '</span></div><div class="cb-keys">' + list.map(card).join("") + "</div></section>";
    }).join("");
    var snaps = (DATA.snapshots || []).slice().sort(function (a, b) { return String(b.month).localeCompare(String(a.month)); });
    var miles = (DATA.milestones || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">AI 캐릭터 채팅 · 비상장</div><h3>스캐터랩 · 제타<small>' + esc((DATA.company && DATA.company.domain) || "zeta-ai.io") + '</small></h3></div><div class="fm-quote"><strong>트래픽 대리 지표</strong><span>주가 대신 공개 지표를 겹쳐 봅니다</span></div></div>' +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(String(DATA.generated_at || "—").slice(0, 16).replace("T", " ")) + " 수집</span>" + (DATA.errors && DATA.errors.length ? '<span class="fm-divider"></span><span class="fm-status pending"><i></i>일부 소스 지연 ' + DATA.errors.length + "건 · 마지막 값 유지</span>" : "") + '<button type="button" id="zt-refresh">새 데이터 확인 ↻</button></div>' +
        '<div class="zt-controls"><div class="fm-segment" aria-label="국가">' + countries.map(function (c) { return '<button type="button" data-zt-country="' + c[0] + '" class="' + (state.country === c[0] ? "on" : "") + '" aria-pressed="' + (state.country === c[0]) + '">' + c[1] + "</button>"; }).join("") + '</div><div class="fm-segment" aria-label="집계 단위">' + [["monthly", "월간"], ["daily", "일간"]].map(function (c) { return '<button type="button" data-zt-cadence="' + c[0] + '" class="' + (state.cadence === c[0] ? "on" : "") + '">' + c[1] + "</button>"; }).join("") + "</div></div>" +
        sections +
        '<div class="fm-toolbar"><div class="fm-segment" aria-label="차트 기간">' + ["1Y", "2Y", "ALL"].map(function (r) { return '<button type="button" data-zt-range="' + r + '" class="' + (state.range === r ? "on" : "") + '">' + (r === "ALL" ? "전체" : r) + "</button>"; }).join("") + '</div><label class="fm-view-options">비교 방식<select id="zt-mode"><option value="units"' + (state.mode === "units" ? " selected" : "") + '>실제 단위</option><option value="normalized"' + (state.mode === "normalized" ? " selected" : "") + ">흐름 비교 · 0–100</option></select></label></div>" +
        '<div class="fm-chart" id="zt-chart"></div><div class="fm-legend" id="zt-legend"></div><p class="fm-note" id="zt-axis-note"></p>' +
        '<p class="fm-note">모두 대리 지표입니다. 순위·평점 수·검색량은 실제 다운로드·이용자 수가 아니라 방향을 보는 용도이고, 국가별로 소스가 달라 서로의 크기를 직접 비교하면 안 됩니다. "진행 중"은 이번 달 일부 기간만 반영된 값입니다.</p>' +
      "</article>" +
      (snaps.length ? '<div class="fm-history-heading"><b>월간 스냅샷 · 수기 기록</b><span>유료 도구 공개 화면에서 매달 옮겨 적은 값</span></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>월</th><th>출처</th><th>지표</th><th>전체</th><th>한국</th><th>일본</th><th>미국</th><th>메모</th></tr></thead><tbody>' +
        snaps.map(function (r) { var cs = r.countries || {}; return "<tr><td>" + esc(r.month) + "</td><td>" + (safeURL(r.source_url) ? '<a href="' + esc(safeURL(r.source_url)) + '" target="_blank" rel="noopener">' + esc(r.source) + " ↗</a>" : esc(r.source)) + "</td><td>" + esc(r.metric) + "</td><td>" + esc(r.total != null ? Number(r.total).toLocaleString("ko-KR") : "—") + "</td><td>" + esc(cs.kr != null ? cs.kr : "—") + "</td><td>" + esc(cs.jp != null ? cs.jp : "—") + "</td><td>" + esc(cs.us != null ? cs.us : "—") + "</td><td>" + esc(r.note || "") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
      (miles.length ? '<div class="fm-history-heading"><b>공식 발표 · 보도 타임라인</b><span>회사 발표와 언론 보도 수치(날짜순)</span></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>날짜</th><th>지표</th><th>값</th><th>출처</th></tr></thead><tbody>' +
        miles.map(function (m) { return "<tr><td>" + esc(m.date) + "</td><td>" + esc(m.metric) + "</td><td>" + esc(m.value) + "</td><td>" + (safeURL(m.url) ? '<a href="' + esc(safeURL(m.url)) + '" target="_blank" rel="noopener">' + esc(m.source || "링크") + " ↗</a>" : esc(m.source || "")) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
      '<p class="fm-sources">수집: GitHub Actions(fetch_zeta.py) → data/zeta.json · 각 카드의 "출처 ↗"에서 원본과 계산 기준을 확인하세요. 키가 필요한 소스(네이버 데이터랩·유튜브·국민연금)는 키를 등록하면 자동으로 켜집니다.</p>';
    bind(); drawChart();
    var st = document.getElementById("workbench-status"); if (st) st.textContent = "스캐터랩 · 제타 트래픽 대리 지표";
  }
  function bind() {
    host.querySelectorAll("[data-zt-toggle]").forEach(function (b) { b.onclick = function () { var id = b.dataset.ztToggle, sel = selected(); state.selected = sel.indexOf(id) >= 0 ? sel.filter(function (x) { return x !== id; }) : sel.concat([id]); store(); render(); }; });
    host.querySelectorAll("[data-zt-country]").forEach(function (b) { b.onclick = function () { state.country = b.dataset.ztCountry; store(); render(); }; });
    host.querySelectorAll("[data-zt-cadence]").forEach(function (b) { b.onclick = function () { state.cadence = b.dataset.ztCadence; store(); render(); }; });
    host.querySelectorAll("[data-zt-range]").forEach(function (b) { b.onclick = function () { state.range = b.dataset.ztRange; store(); render(); }; });
    document.getElementById("zt-mode").onchange = function (e) { state.mode = e.target.value; store(); drawChart(); };
    document.getElementById("zt-refresh").onclick = load;
  }
  function drawChart() {
    var box = document.getElementById("zt-chart"); if (!box || !active) return;
    var list = selected().map(byId).filter(Boolean).map(function (s) { return {s: s, id: s.id, label: s.label, color: colorOf(s.id), points: pointsOf(s)}; }).filter(function (x) { return good(x.points).length; });
    if (!list.length) { box.innerHTML = '<div class="fm-chart-empty">위 카드를 눌러 차트에 겹쳐 볼 지표를 고르세요.</div>'; document.getElementById("zt-legend").innerHTML = ""; document.getElementById("zt-axis-note").textContent = ""; return; }
    var allPts = [].concat.apply([], list.map(function (x) { return good(x.points); }));
    var end = Math.max.apply(null, allPts.map(function (p) { return C.timestamp(p.date); }));
    var start = state.range === "ALL" ? Math.min.apply(null, allPts.map(function (p) { return C.timestamp(p.date); })) : (function () { var d = new Date(end); d.setUTCMonth(d.getUTCMonth() - (state.range === "1Y" ? 12 : 24)); return d.getTime(); })();
    list.forEach(function (x) { x.points = good(x.points).filter(function (p) { var t = C.timestamp(p.date); return t >= start && t <= end; }); });
    list = list.filter(function (x) { return x.points.length; });
    // 축 키: 순위류는 로그·뒤집힘 축, 나머지는 단위별
    var axisKey = function (x) { return isRank(x.s) ? "순위" : (x.s.unit || "값"); };
    var keys = list.map(axisKey).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var narrow = box.clientWidth < 600, normalized = state.mode === "normalized" || keys.length > (narrow ? 2 : 3);
    var tv = function (x, v) { return isRank(x.s) ? -Math.log10(v) : v; };
    var plot = list.map(function (x) {
      var pts = x.points.map(function (p) { return Object.assign({}, p, {orig: p.value, value: tv(x, p.value)}); });
      return Object.assign({}, x, {points: normalized ? C.normalize(pts) : pts});
    });
    var width = Math.max(box.clientWidth, 280), height = narrow ? 320 : 380, axes = normalized ? ["0–100"] : keys;
    var left = narrow ? 50 : 64, right = normalized ? 14 : Math.max(14, (axes.length - 1) * (narrow ? 58 : 70)), top = 29, bottom = 32, pw = width - left - right, ph = height - top - bottom;
    var scales = {};
    axes.forEach(function (k) { scales[k] = normalized ? [-5, 105] : C.domain([].concat.apply([], plot.filter(function (x) { return axisKey(x) === k; }).map(function (x) { return x.points.map(function (p) { return p.value; }); })), false); });
    var x = function (d) { return left + (C.timestamp(d) - start) / Math.max(end - start, 86400000) * pw; };
    var y = function (v, k) { var d = scales[normalized ? "0–100" : k]; return top + (d[1] - v) / (d[1] - d[0]) * ph; };
    var label = function (v, k) { if (k === "순위") { var r = Math.pow(10, -v); return r >= 10000 ? Math.round(r / 1000) / 10 + "만" : Math.round(r).toLocaleString("ko-KR"); } return Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "만" : Math.abs(v) >= 100 ? Math.round(v).toLocaleString("ko-KR") : Number(v.toFixed(1)).toString(); };
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(list.map(function (q) { return q.label; }).join(", ")) + '"><defs><clipPath id="zt-clip"><rect x="' + left + '" y="' + top + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>';
    for (var i = 0; i <= 4; i++) svg += '<path d="M' + left + " " + (top + i / 4 * ph) + "H" + (left + pw) + '" stroke="#718db3" stroke-opacity=".13"/>';
    axes.forEach(function (k, idx) {
      var d = scales[k], xx = idx === 0 ? left - 9 : left + pw + 8 + (idx - 1) * (narrow ? 58 : 70), anchor = idx === 0 ? "end" : "start";
      svg += '<text x="' + xx + '" y="14" text-anchor="' + anchor + '">' + esc(k === "순위" ? "순위 (위가 좋음)" : k) + "</text>";
      for (var j = 0; j <= 4; j++) svg += '<text x="' + xx + '" y="' + (top + j / 4 * ph + 4) + '" text-anchor="' + anchor + '">' + (normalized ? Math.round(d[1] - (d[1] - d[0]) * j / 4) : label(d[1] - (d[1] - d[0]) * j / 4, k)) + "</text>";
    });
    var n = narrow ? 3 : 5;
    for (var t = 0; t <= n; t++) svg += '<text x="' + (left + pw * t / n) + '" y="' + (height - 8) + '" text-anchor="' + (t === 0 ? "start" : t === n ? "end" : "middle") + '">' + new Date(start + (end - start) * t / n).toISOString().slice(0, 7).replace("-", ".") + "</text>";
    svg += '<g clip-path="url(#zt-clip)">';
    plot.forEach(function (q) {
      var geo = C.lineGeometry(q.points, x, function (v) { return y(v, axisKey(q)); });
      if (!geo.vertices.length) return;
      svg += '<path class="fm-series-path" d="' + geo.path + '" fill="none" stroke="' + q.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      if (q.points.length <= 60) geo.vertices.forEach(function (v, vi) { var p = q.points[vi]; svg += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + (p && p.partial ? 3.2 : 2.5) + '" fill="' + (p && p.partial ? "#101623" : q.color) + '" stroke="' + (p && p.partial ? q.color : "#101623") + '" stroke-width="' + (p && p.partial ? 1.6 : 1) + '"/>'; });
    });
    svg += '</g><line id="zt-cross" x1="0" y1="' + top + '" x2="0" y2="' + (height - bottom) + '" stroke="#a2b9db" stroke-opacity=".4" stroke-dasharray="4 4" visibility="hidden"/><rect id="zt-hit" x="' + left + '" y="' + top + '" width="' + pw + '" height="' + ph + '" fill="transparent"/></svg><div class="fm-tooltip" id="zt-tip" hidden></div>';
    box.innerHTML = svg;
    document.getElementById("zt-axis-note").textContent = normalized ? "흐름 비교: 각 지표를 기간 내 최저 0 · 최고 100으로 맞췄습니다(순위는 좋아질수록 위로)." + (state.mode !== "normalized" ? " 단위가 많아 자동 적용했습니다." : "") : "순위 지표는 로그 축을 뒤집어 위로 갈수록 순위가 좋게 그렸습니다. 다른 지표는 단위별 독립 축입니다.";
    var legend = document.getElementById("zt-legend");
    legend.innerHTML = list.map(function (q) { return '<button type="button" data-zt-remove="' + esc(q.id) + '"><i style="--series-color:' + esc(q.color) + '"></i>' + esc(q.label) + "<small>×</small></button>"; }).join("");
    legend.querySelectorAll("[data-zt-remove]").forEach(function (b) { b.onclick = function () { state.selected = selected().filter(function (v) { return v !== b.dataset.ztRemove; }); store(); render(); }; });
    var hit = document.getElementById("zt-hit"), tip = document.getElementById("zt-tip"), cross = document.getElementById("zt-cross");
    hit.onpointermove = function (e) {
      var xx = Math.min(left + pw, Math.max(left, e.clientX - box.getBoundingClientRect().left)), tt = start + (xx - left) / pw * (end - start);
      cross.setAttribute("x1", xx); cross.setAttribute("x2", xx); cross.setAttribute("visibility", "visible");
      tip.innerHTML = "<b>" + new Date(tt).toISOString().slice(0, 10) + " · 가까운 관측값</b>" + list.map(function (q) { var p = C.nearest(q.points, tt); return '<div class="fm-tip-row"><i class="fm-metric-color" style="--series-color:' + esc(q.color) + '"></i><span>' + esc(q.label) + "<small>" + esc(p ? p.date : "") + (p && p.partial ? " · 진행 중" : "") + "</small></span><strong>" + esc(p ? fmt(p.value, q.s) : "—") + "</strong></div>"; }).join("");
      tip.hidden = false; tip.style.left = Math.max(2, Math.min(xx + 15, width - Math.min(290, width * 0.88) - 4)) + "px"; tip.style.top = "39px";
    };
    hit.onpointerleave = function () { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  }
  function load() {
    if (loading) return; loading = true;
    fetch("data/zeta.json?v=" + Date.now(), {cache: "no-store"}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { if (d.schema_version !== 1) throw new Error("형식 불일치"); DATA = d; error = ""; })
      .catch(function (e) { error = e.message; })
      .then(function () { loading = false; render(); });
  }
  document.addEventListener("vantage-company-change", function (e) {
    active = e.detail && e.detail.company === "스캐터랩"; host.hidden = !active;
    if (active) { if (DATA) render(); else { render(); load(); } }
  });
  window.addEventListener("resize", function () { cancelAnimationFrame(renderId); renderId = requestAnimationFrame(function () { if (active && DATA) drawChart(); }); });
})();
