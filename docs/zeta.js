/* 스캐터랩(제타) 워크벤치 — data/zeta.json 을 읽어 그린다. 기업별 데이터 모음에서 "스캐터랩 (제타)"를 고르면 열린다.
   비상장이라 주가 자리에 '애플 앱스토어 매출 순위'를 기준선으로 깔고, 파인엠텍처럼 지표를 골라 겹쳐 본다.
   원칙: 애플·구글플레이·크롬(CrUX)·트랜코·리서치 도구 등 원천 데이터만 쓴다(기사·보도 수치 없음). 빈 값은 0으로 채우지 않는다.
   순위 지표는 값이 작을수록 좋으므로 차트에서 위로 갈수록 좋게(뒤집힌 로그 축) 그린다. */
(function () {
  "use strict";
  var C = window.FineMtecCore;
  var host = document.getElementById("zeta-workspace");
  if (!host || !C) return;
  var KEY = "vantage-zeta-bench-v2";
  var PALETTE = ["#55d6bc", "#c7a2ff", "#ffbd76", "#53c5ee", "#fa829d", "#e7d27c", "#9fd675", "#dda1c7"];
  var ANCHOR_COLOR = "#83aaff";
  var GROUP_LABEL = {revenue: "매출 순위", download: "다운로드", users: "유저", content: "작품 수", ads: "광고 · 바이럴", web: "웹", search: "검색", company: "회사"};
  // 파인엠텍처럼 펼쳐서 고르는 메뉴 3개
  var SELECTORS = [
    ["app", "앱 · 매출 순위 지표 추가", "앱스토어 매출·무료 순위 · 평점 수 · 구글플레이 설치·리뷰", ["revenue", "download", "users"]],
    ["web", "웹 · 검색 지표 추가", "크롬 국가별 순위 · 트랜코 · 네이버 검색", ["web", "search"]],
    ["etc", "콘텐츠 · 광고 · 회사 지표 추가", "스토어 캐릭터 수 · 공식 유튜브 · 국민연금", ["content", "ads", "company"]]
  ];
  var ANCHORS = [["app_rank_ios_jp_grossing_all", "일본 매출 순위 · 전체"], ["app_rank_ios_jp_grossing_ent", "일본 매출 순위 · 엔터"],
    ["app_rank_ios_kr_grossing_all", "한국 매출 순위 · 전체"], ["app_rank_ios_kr_grossing_ent", "한국 매출 순위 · 엔터"], ["app_rank_ios_us_grossing_ent", "미국 매출 순위 · 엔터"]];
  var COUNTRY = {kr: "한국", jp: "일본", us: "미국", tw: "대만", vn: "베트남", ph: "필리핀", id: "인도네시아", th: "태국", global: "전 세계"};
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]; }); };
  var safeURL = function (v) { try { var u = new URL(v); return ["https:", "http:"].indexOf(u.protocol) >= 0 ? u.href : ""; } catch (e) { return ""; } };
  var finite = C.finite;
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var state = {
    country: ["all", "kr", "jp", "us", "etc"].indexOf(saved.country) >= 0 ? saved.country : "all",
    cadence: saved.cadence === "daily" ? "daily" : "monthly",
    range: ["1Y", "2Y", "ALL"].indexOf(saved.range) >= 0 ? saved.range : "ALL",
    selected: Array.isArray(saved.selected) ? saved.selected : null,
    mode: saved.mode === "normalized" ? "normalized" : "units",
    anchor: typeof saved.anchor === "string" ? saved.anchor : "app_rank_ios_jp_grossing_all"
  };
  var DATA = null, active = false, loading = false, error = "", renderId = 0;
  function store() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function good(pts) { return (pts || []).filter(function (p) { return p && C.validDate(p.date) && finite(p.value); }); }
  function isRank(s) { return s.kind === "rank" || s.kind === "rank_bucket"; }
  function series() { return (DATA && DATA.series) || []; }
  function byId(id) { return series().filter(function (s) { return s.id === id; })[0]; }
  function anchorSeries() { return state.anchor ? byId(state.anchor) : null; }

  /* 월간 집계: 순위는 월 평균, 누적값은 월말 값, 나머지는 월 평균. 이미 월간인 자료는 그대로. */
  function monthly(s) {
    var pts = good(s.points);
    if (/월간/.test(s.cadence || "") || s.kind === "rank_bucket") return pts.map(function (p) { return Object.assign({}, p, {date: p.date.slice(0, 7) + "-01"}); });
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
    if (state.country === "etc") return ["kr", "jp", "us", "global"].indexOf(s.country) < 0;
    return s.country === state.country || s.country === "global" || !s.country;
  }
  function defaultSelection() {
    return ["app_gplay_installs__mom", "app_ios_ratings_kr__mom", "web_crux_jp"].filter(byId);
  }
  function selected() { if (!state.selected) state.selected = defaultSelection(); return state.selected.filter(function (id) { return byId(id) && id !== state.anchor; }); }
  function colorOf(id) { if (id === state.anchor) return ANCHOR_COLOR; var i = selected().indexOf(id); return i >= 0 ? PALETTE[i % PALETTE.length] : "#51607a"; }
  function sparkline(s, pts, color) {
    var tail = good(pts).slice(-24);
    if (tail.length < 2) return "";
    var tv = tail.map(function (p) { return isRank(s) ? -Math.log10(p.value) : p.value; }), lo = Math.min.apply(null, tv), hi = Math.max.apply(null, tv);
    return '<svg class="zt-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="' + tv.map(function (v, i) { return (i ? "L" : "M") + (i / (tv.length - 1) * 100).toFixed(1) + " " + (hi === lo ? 12 : 22 - (v - lo) / (hi - lo) * 20).toFixed(1); }).join(" ") + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
  }
  function badge(ch, s) {
    if (!finite(ch)) return '<span class="zt-muted">—</span>';
    return '<span class="cb-chg ' + (ch >= 0 ? "up" : "down") + '" title="' + (isRank(s) ? "순위 개선률(숫자가 줄면 +)" : "직전 관측 대비") + '">' + (ch >= 0 ? "▲" : "▼") + Math.abs(ch).toFixed(1) + "%</span>";
  }

  /* 펼침 메뉴 한 줄 (파인엠텍 fm-metric 과 같은 모양) */
  function metricRow(s) {
    var pts = pointsOf(s), g = good(pts), last = g[g.length - 1], on = selected().indexOf(s.id) >= 0, isAnchor = s.id === state.anchor, unavailable = !g.length;
    var value = unavailable ? (s.status_note || "수집 대기") : fmt(last.value, s);
    return '<div class="fm-metric' + (unavailable ? " unavailable" : "") + '"><label style="display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:inherit">' +
      '<input type="checkbox" data-zt-metric="' + esc(s.id) + '"' + (on || isAnchor ? " checked" : "") + (unavailable || isAnchor ? " disabled" : "") + ">" +
      '<i class="fm-metric-color" style="--series-color:' + esc(on || isAnchor ? colorOf(s.id) : "#51607a") + '"></i>' +
      '<span class="fm-metric-info">' + esc(s.label) + "<small>" + esc((isAnchor ? "기준선 · " : "") + (s.source || "") + (last ? " · " + last.date.slice(0, state.cadence === "monthly" ? 7 : 10) : "")) + '</small></span><span class="fm-metric-value">' + esc(value) + "</span></label></div>";
  }
  function selectorBlock(sel, opened) {
    var list = series().filter(function (s) { return sel[3].indexOf(s.group) >= 0 && visible(s); });
    var count = list.filter(function (s) { return selected().indexOf(s.id) >= 0; }).length;
    var chev = '<svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    var rows = sel[3].map(function (g) {
      var items = list.filter(function (s) { return s.group === g; });
      return items.length ? '<div class="cb-group-head">' + esc(GROUP_LABEL[g] || g) + "</div>" + items.map(metricRow).join("") : "";
    }).join("");
    return '<details class="fm-selector" id="zt-select-' + sel[0] + '"' + (opened.indexOf(sel[0]) >= 0 ? " open" : "") + "><summary><div><b>" + esc(sel[1]) + "</b><small>" + esc(sel[2]) + (count ? " / " + count + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><span>여러 지표를 함께 고를 수 있어요 · 국가 선택은 차트 위에서</span></div>' + (rows || '<p class="fm-note">이 국가에 해당하는 지표가 없습니다.</p>') + "</div></details>";
  }
  /* 차트 아래 '지표 한눈에 보기' 표 */
  function overview() {
    var order = ["revenue", "download", "users", "web", "search", "content", "ads", "company"];
    var list = series().filter(visible).sort(function (a, b) { return order.indexOf(a.group) - order.indexOf(b.group) || String(a.label).localeCompare(String(b.label), "ko"); });
    if (!list.length) return "";
    var rows = list.map(function (s) {
      var pts = pointsOf(s), g = good(pts), last = g[g.length - 1], on = selected().indexOf(s.id) >= 0 || s.id === state.anchor, col = on ? colorOf(s.id) : "#7f93b6";
      var src = safeURL(s.source_url) ? '<a href="' + esc(safeURL(s.source_url)) + '" target="_blank" rel="noopener" title="' + esc(s.note || "") + '">' + esc(s.source || "출처") + " ↗</a>" : esc(s.source || "");
      return '<tr class="' + (on ? "zt-on" : "") + (g.length ? "" : " zt-wait-row") + '" style="--series-color:' + esc(col) + '">' +
        "<td><span class=\"zt-tag\">" + esc(GROUP_LABEL[s.group] || "") + "</span></td>" +
        '<td class="zt-name"><i class="fm-metric-color" style="--series-color:' + esc(col) + '"></i>' + esc(s.label) + "</td>" +
        "<td>" + esc(COUNTRY[s.country] || s.country || "—") + "</td>" +
        '<td class="zt-num">' + (g.length ? esc(fmt(last.value, s)) + (last.partial ? ' <em class="cb-est">진행 중</em>' : "") : '<span class="zt-muted">' + esc(s.status_note || "수집 대기") + "</span>") + "</td>" +
        "<td>" + esc(last ? last.date.slice(0, state.cadence === "monthly" ? 7 : 10) : "—") + "</td>" +
        "<td>" + badge(change(s, pts), s) + "</td>" +
        '<td class="zt-spark-cell">' + sparkline(s, pts, col) + "</td>" +
        '<td class="zt-src-cell">' + src + "</td>" +
        "<td>" + (g.length && s.id !== state.anchor ? '<button type="button" class="zt-toggle' + (on ? " on" : "") + '" data-zt-toggle="' + esc(s.id) + '" aria-pressed="' + on + '">' + (on ? "빼기" : "겹쳐보기") + "</button>" : s.id === state.anchor ? '<span class="zt-muted">기준선</span>' : "") + "</td></tr>";
    }).join("");
    return '<div class="fm-history-heading"><b>지표 한눈에 보기</b><span>' + list.length + "개 · " + (state.cadence === "monthly" ? "월간" : "일간") + ' 기준 · 원천 데이터만</span></div><div class="fm-table-wrap"><table class="fm-table zt-table"><thead><tr><th>분류</th><th>지표</th><th>국가</th><th>최신값</th><th>기준일</th><th>직전 대비</th><th>추이</th><th>출처</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function render() {
    if (!active) return;
    if (!DATA) { host.innerHTML = '<div class="fm-chart-empty">' + (error ? "<b>제타 데이터를 불러오지 못했어요.</b><p>" + esc(error) + '</p><button class="fm-add" id="zt-retry" type="button">다시 불러오기</button>' : "제타 지표를 불러오는 중입니다.") + "</div>"; var r = document.getElementById("zt-retry"); if (r) r.onclick = load; return; }
    var opened = ["app", "web", "etc"].filter(function (k) { var el = document.getElementById("zt-select-" + k); return el && el.open; });
    var an = anchorSeries(), ag = an ? good(an.points) : [], alast = ag[ag.length - 1], aprev = ag[ag.length - 2];
    var countries = [["all", "전체"], ["kr", "한국"], ["jp", "일본"], ["us", "미국"], ["etc", "기타 국가"]];
    var snaps = (DATA.snapshots || []).slice().sort(function (a, b) { return String(b.month).localeCompare(String(a.month)); });
    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">AI 캐릭터 채팅 · 비상장</div><h3>스캐터랩 · 제타<small>' + esc((DATA.company && DATA.company.domain) || "zeta-ai.io") + "</small></h3></div>" +
          '<div class="fm-quote"><strong>' + (alast ? esc(alast.value + "위") : "수집 대기") + "</strong><span>" + esc(an ? an.label.replace("앱스토어 ", "") : "기준선 없음") + (alast && aprev ? " · 전일 " + (aprev.value - alast.value >= 0 ? "▲" : "▼") + Math.abs(aprev.value - alast.value) + "계단" : "") + "</span></div></div>" +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(String(DATA.generated_at || "—").slice(0, 16).replace("T", " ")) + " 수집 · 애플·구글플레이·크롬·트랜코 원천</span>" + (DATA.errors && DATA.errors.length ? '<span class="fm-divider"></span><span class="fm-status pending"><i></i>일부 소스 지연 ' + DATA.errors.length + "건 · 마지막 값 유지</span>" : "") + '<button type="button" id="zt-refresh">새 데이터 확인 ↻</button></div>' +
        '<div class="fm-selectors zt-selectors">' + SELECTORS.map(function (s) { return selectorBlock(s, opened); }).join("") + "</div>" +
        '<div class="fm-toolbar"><div class="zt-tools">' +
          '<div class="fm-segment" aria-label="차트 기간">' + ["1Y", "2Y", "ALL"].map(function (r) { return '<button type="button" data-zt-range="' + r + '" class="' + (state.range === r ? "on" : "") + '">' + (r === "ALL" ? "전체" : r) + "</button>"; }).join("") + "</div>" +
          '<div class="fm-segment" aria-label="국가">' + countries.map(function (c) { return '<button type="button" data-zt-country="' + c[0] + '" class="' + (state.country === c[0] ? "on" : "") + '" aria-pressed="' + (state.country === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div>" +
          '<div class="fm-segment" aria-label="집계 단위">' + [["monthly", "월간"], ["daily", "일간"]].map(function (c) { return '<button type="button" data-zt-cadence="' + c[0] + '" class="' + (state.cadence === c[0] ? "on" : "") + '">' + c[1] + "</button>"; }).join("") + "</div></div>" +
          '<div class="zt-tools"><label class="fm-view-options">기준선<select id="zt-anchor">' + ANCHORS.filter(function (a) { return byId(a[0]); }).concat([["", "기준선 없음"]]).map(function (a) { return '<option value="' + a[0] + '"' + (state.anchor === a[0] ? " selected" : "") + ">" + a[1] + "</option>"; }).join("") + '</select></label><label class="fm-view-options">비교 방식<select id="zt-mode"><option value="units"' + (state.mode === "units" ? " selected" : "") + '>실제 단위</option><option value="normalized"' + (state.mode === "normalized" ? " selected" : "") + ">흐름 비교 · 0–100</option></select></label></div></div>" +
        '<div class="fm-chart" id="zt-chart"></div><div class="fm-legend" id="zt-legend"></div><p class="fm-note" id="zt-axis-note"></p>' +
        '<p class="fm-note">주가 대신 <b>애플 앱스토어 매출 순위</b>를 기준선(굵은 점선)으로 깔았습니다. 스캐터랩은 비상장이라 매출액의 공개 원천이 없고, 애플 공식 매출 차트가 가장 공신력 있는 매출 흐름 지표입니다(순위 → 금액 환산은 하지 않음, 100위 밖인 날은 비움). 매출 순위는 수집 시작일부터 매일 쌓입니다. 속 빈 점은 추정·진행 중인 값입니다.</p>' +
      "</article>" +
      overview() +
      (snaps.length ? '<div class="fm-history-heading"><b>리서치 도구 월간 스냅샷</b><span>Similarweb · Semrush 공개 화면의 값을 그대로 옮김 (두 도구의 추정 방식이 달라 약 2배 차이)</span></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>월</th><th>출처</th><th>지표</th><th>전체</th><th>한국</th><th>일본</th><th>미국</th><th>메모</th></tr></thead><tbody>' +
        snaps.map(function (r) { var cs = r.countries || {}; return "<tr><td>" + esc(r.month) + "</td><td>" + (safeURL(r.source_url) ? '<a href="' + esc(safeURL(r.source_url)) + '" target="_blank" rel="noopener">' + esc(r.source) + " ↗</a>" : esc(r.source)) + "</td><td>" + esc(r.metric) + "</td><td>" + esc(r.total != null ? Number(r.total).toLocaleString("ko-KR") : "—") + "</td><td>" + esc(cs.kr != null ? cs.kr : "—") + "</td><td>" + esc(cs.jp != null ? cs.jp : "—") + "</td><td>" + esc(cs.us != null ? cs.us : "—") + "</td><td>" + esc(r.note || "") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
      '<p class="fm-sources">수집: GitHub Actions(fetch_zeta.py, 매일 08:30) → data/zeta.json. 기사·보도·재무 집계 사이트 수치는 쓰지 않습니다. 구글플레이 누적 설치와 한국 앱스토어 평점 수의 과거 값은 인터넷 아카이브(웨이백 머신)에 보관된 스토어 페이지에서 읽었습니다. 키가 필요한 소스(네이버 데이터랩 · 유튜브 · 국민연금)는 키를 등록하면 자동으로 켜집니다.</p>';
    bind(); drawChart();
    var st = document.getElementById("workbench-status"); if (st) st.textContent = "스캐터랩 · 제타 · 매출 순위 × 트래픽 지표";
  }
  function toggle(id, force) {
    var sel = selected(), on = sel.indexOf(id) >= 0, want = force == null ? !on : force;
    state.selected = sel.filter(function (x) { return x !== id; });
    if (want) state.selected.push(id);
    store(); render();
  }
  function bind() {
    host.querySelectorAll("[data-zt-toggle]").forEach(function (b) { b.onclick = function () { toggle(b.dataset.ztToggle); }; });
    host.querySelectorAll("[data-zt-metric]").forEach(function (i) { i.onchange = function () { toggle(i.dataset.ztMetric, i.checked); }; });
    host.querySelectorAll("[data-zt-country]").forEach(function (b) { b.onclick = function () { state.country = b.dataset.ztCountry; store(); render(); }; });
    host.querySelectorAll("[data-zt-cadence]").forEach(function (b) { b.onclick = function () { state.cadence = b.dataset.ztCadence; store(); render(); }; });
    host.querySelectorAll("[data-zt-range]").forEach(function (b) { b.onclick = function () { state.range = b.dataset.ztRange; store(); render(); }; });
    document.getElementById("zt-mode").onchange = function (e) { state.mode = e.target.value; store(); drawChart(); };
    document.getElementById("zt-anchor").onchange = function (e) { state.anchor = e.target.value; store(); render(); };
    document.getElementById("zt-refresh").onclick = load;
  }

  function drawChart() {
    var box = document.getElementById("zt-chart"); if (!box || !active) return;
    var an = anchorSeries();
    var list = (an ? [{s: an, id: an.id, label: an.label, color: ANCHOR_COLOR, anchor: true, points: pointsOf(an)}] : [])
      .concat(selected().map(byId).filter(Boolean).map(function (s) { return {s: s, id: s.id, label: s.label, color: colorOf(s.id), points: pointsOf(s)}; }))
      .filter(function (x) { return good(x.points).length; });
    var legendEl = document.getElementById("zt-legend"), noteEl = document.getElementById("zt-axis-note");
    if (!list.length) { box.innerHTML = '<div class="fm-chart-empty">위 "지표 추가" 메뉴나 아래 표의 "겹쳐보기"로 지표를 고르세요.</div>'; legendEl.innerHTML = ""; noteEl.textContent = ""; return; }
    var allPts = [].concat.apply([], list.map(function (x) { return good(x.points); }));
    var end = Math.max.apply(null, allPts.map(function (p) { return C.timestamp(p.date); }));
    var start = state.range === "ALL" ? Math.min.apply(null, allPts.map(function (p) { return C.timestamp(p.date); })) : (function () { var d = new Date(end); d.setUTCMonth(d.getUTCMonth() - (state.range === "1Y" ? 12 : 24)); return d.getTime(); })();
    if (end - start < 30 * 86400000) start = end - 30 * 86400000;
    list.forEach(function (x) { x.points = good(x.points).filter(function (p) { var t = C.timestamp(p.date); return t >= start && t <= end; }); });
    list = list.filter(function (x) { return x.points.length; });
    var axisKey = function (x) { return isRank(x.s) ? "순위" : (x.s.unit || "값"); };
    var keys = list.map(axisKey).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var narrow = box.clientWidth < 600, normalized = state.mode === "normalized" || keys.length > (narrow ? 2 : 3);
    var tv = function (x, v) { return isRank(x.s) ? -Math.log10(v) : v; };
    var plot = list.map(function (x) { var pts = x.points.map(function (p) { return Object.assign({}, p, {value: tv(x, p.value)}); }); return Object.assign({}, x, {points: normalized ? C.normalize(pts) : pts}); });
    var width = Math.max(box.clientWidth, 280), height = narrow ? 320 : 390, axes = normalized ? ["0–100"] : keys;
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
    var n = narrow ? 3 : 5, daily = end - start < 120 * 86400000;
    for (var t = 0; t <= n; t++) svg += '<text x="' + (left + pw * t / n) + '" y="' + (height - 8) + '" text-anchor="' + (t === 0 ? "start" : t === n ? "end" : "middle") + '">' + new Date(start + (end - start) * t / n).toISOString().slice(daily ? 5 : 0, daily ? 10 : 7).replace("-", ".") + "</text>";
    svg += '<g clip-path="url(#zt-clip)">';
    plot.forEach(function (q) {
      var geo = C.lineGeometry(q.points, x, function (v) { return y(v, axisKey(q)); });
      if (!geo.vertices.length) return;
      svg += '<path class="fm-series-path' + (q.anchor ? " fm-price-path zt-anchor-path" : "") + '" d="' + geo.path + '" fill="none" stroke="' + q.color + '" stroke-width="' + (q.anchor ? 3 : 2) + '"' + (q.anchor ? ' stroke-dasharray="7 5"' : "") + ' stroke-linecap="round" stroke-linejoin="round"/>';
      if (q.points.length <= 60 || q.anchor) geo.vertices.forEach(function (v, vi) {
        var p = q.points[vi], hollow = p && (p.partial || p.wide || (p.est && q.s.kind !== "flow")), r = q.anchor ? 4 : hollow ? 3.2 : 2.5;
        svg += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + r + '" fill="' + (hollow ? "#101623" : q.color) + '" stroke="' + (hollow ? q.color : "#101623") + '" stroke-width="' + (hollow ? 1.6 : 1) + '"/>';
      });
    });
    svg += '</g><line id="zt-cross" x1="0" y1="' + top + '" x2="0" y2="' + (height - bottom) + '" stroke="#a2b9db" stroke-opacity=".4" stroke-dasharray="4 4" visibility="hidden"/><rect id="zt-hit" x="' + left + '" y="' + top + '" width="' + pw + '" height="' + ph + '" fill="transparent"/></svg><div class="fm-tooltip" id="zt-tip" hidden></div>';
    box.innerHTML = svg;
    noteEl.textContent = normalized ? "흐름 비교: 각 지표를 기간 내 최저 0 · 최고 100으로 맞췄습니다(순위는 좋아질수록 위로)." + (state.mode !== "normalized" ? " 단위가 많아 자동 적용했습니다." : "") : "순위 지표는 로그 축을 뒤집어 위로 갈수록 순위가 좋게 그렸습니다. 다른 지표는 단위별 독립 축입니다.";
    legendEl.innerHTML = list.map(function (q) { return '<button type="button" data-zt-remove="' + esc(q.id) + '"' + (q.anchor ? " disabled" : "") + ' title="' + (q.anchor ? "기준선은 위 기준선 선택에서 바꿉니다" : "차트에서 빼기") + '"><i style="--series-color:' + esc(q.color) + '"></i>' + esc(q.label) + "<small>" + (q.anchor ? "기준" : "×") + "</small></button>"; }).join("");
    legendEl.querySelectorAll("[data-zt-remove]").forEach(function (b) { b.onclick = function () { toggle(b.dataset.ztRemove, false); }; });
    var hit = document.getElementById("zt-hit"), tip = document.getElementById("zt-tip"), cross = document.getElementById("zt-cross");
    hit.onpointermove = function (e) {
      var xx = Math.min(left + pw, Math.max(left, e.clientX - box.getBoundingClientRect().left)), tt = start + (xx - left) / pw * (end - start);
      cross.setAttribute("x1", xx); cross.setAttribute("x2", xx); cross.setAttribute("visibility", "visible");
      tip.innerHTML = "<b>" + new Date(tt).toISOString().slice(0, 10) + " · 가까운 관측값</b>" + list.map(function (q) { var p = C.nearest(q.points, tt); return '<div class="fm-tip-row"><i class="fm-metric-color" style="--series-color:' + esc(q.color) + '"></i><span>' + esc(q.label) + "<small>" + esc(p ? p.date : "") + (p && p.partial ? " · 진행 중" : "") + (p && p.wide ? " · 긴 구간 평균" : "") + "</small></span><strong>" + esc(p ? fmt(p.value, q.s) : "—") + "</strong></div>"; }).join("");
      tip.hidden = false; tip.style.left = Math.max(2, Math.min(xx + 15, width - Math.min(290, width * 0.88) - 4)) + "px"; tip.style.top = "39px";
    };
    hit.onpointerleave = function () { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  }
  function load() {
    if (loading) return; loading = true;
    fetch("data/zeta.json?v=" + Date.now(), {cache: "no-store"}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) { if (d.schema_version !== 1) throw new Error("형식 불일치"); DATA = d; error = ""; if (state.anchor && !byId(state.anchor)) state.anchor = ""; })
      .catch(function (e) { error = e.message; })
      .then(function () { loading = false; render(); });
  }
  document.addEventListener("vantage-company-change", function (e) {
    active = e.detail && e.detail.company === "스캐터랩"; host.hidden = !active;
    if (active) { render(); if (!DATA) load(); }
  });
  window.addEventListener("resize", function () { cancelAnimationFrame(renderId); renderId = requestAnimationFrame(function () { if (active && DATA) drawChart(); }); });
})();
