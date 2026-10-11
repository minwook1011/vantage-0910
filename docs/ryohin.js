/* 료힌케이카쿠(무지, 7453) 워크벤치 — data/ryohin.json 을 읽어 주가 위에 월차·분기 실적·점포 수·유니클로 월차·환율·도쿄 날씨·구글 트렌드를 골라 겹쳐 본다.
   기업별 데이터 모음에서 "료힌케이카쿠 (무지)"를 고르면 열린다. 수집: fetch_ryohin.py(.github/workflows/ryohin.yml).
   실제 단위 보기에서는 지표마다 오른쪽 축을 따로 두고(앞의 2개만 눈금 표시), 흐름 비교 보기에서는 모두 0–100으로 맞춘다.
   빈 값은 0이나 예시로 채우지 않는다. 고른 지표·기간은 이 브라우저(localStorage)에 저장한다. */
(function () {
  "use strict";
  var host = document.getElementById("ryohin-workspace");
  if (!host) return;
  var KEY = "vantage-ryohin-bench-v1", MAX = 4;
  var PRICE_COLOR = "#5b8def";
  var PALETTE = ["#e8833a", "#9b6bd6", "#1f9a72", "#d4507a", "#c9a227", "#3aa7c9"];
  var RANGES = [["1Y", 1], ["2Y", 2], ["3Y", 3], ["5Y", 5], ["ALL", 0]];
  var DEFAULT_SEL = ["m_jp_comp", "m_ea_comp"];
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]; }); };
  var safeURL = function (v) { try { var u = new URL(v); return ["https:", "http:"].indexOf(u.protocol) >= 0 ? u.href : ""; } catch (e) { return ""; } };
  var finite = function (v) { return typeof v === "number" && isFinite(v); };
  var ts = function (d) { return Date.parse(d + "T00:00:00Z"); };
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var state = {
    selected: Array.isArray(saved.selected) ? saved.selected.filter(function (x) { return typeof x === "string"; }).slice(0, MAX) : DEFAULT_SEL.slice(),
    range: RANGES.some(function (r) { return r[0] === saved.range; }) ? saved.range : "3Y",
    mode: saved.mode === "normalized" ? "normalized" : "units",
    open: Array.isArray(saved.open) ? saved.open : ["monthly"]
  };
  var DATA = null, BY = {}, active = false, loading = false, error = "", renderId = 0;
  function store() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function good(pts) { return (pts || []).filter(function (p) { return p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && finite(p.value); }); }
  function colorOf(id) { var i = state.selected.indexOf(id); return i >= 0 ? PALETTE[i % PALETTE.length] : "#8a97ab"; }
  function fmt(v, unit) {
    if (!finite(v)) return "—";
    var a = Math.abs(v), d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 1 : 2;
    var s = v.toLocaleString("ko-KR", {minimumFractionDigits: 0, maximumFractionDigits: d});
    return unit === "%" ? s + "%" : unit === "℃" ? s + "℃" : unit === "엔" ? s + "엔" : unit === "억 엔" ? s + "억" : unit === "점" ? s + "점" : s;
  }
  function selected() { return state.selected.filter(function (id) { return BY[id]; }); }
  function toggle(id) {
    var i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else { if (state.selected.length >= MAX) { toast("한 번에 " + MAX + "개까지 겹쳐 볼 수 있어요. 하나를 빼고 고르세요."); return; } state.selected.push(id); }
    store(); render();
  }
  function toast(msg) {
    var old = document.querySelector(".fm-toast"); if (old) old.remove();
    var el = document.createElement("div"); el.className = "fm-toast"; el.setAttribute("role", "status"); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 3500);
  }
  function startTs() {
    var r = RANGES.filter(function (x) { return x[0] === state.range; })[0], pts = good((DATA.price || {}).points);
    if (!pts.length) return 0;
    var end = ts(pts[pts.length - 1].date);
    return r && r[1] ? end - r[1] * 365.25 * 864e5 : ts(pts[0].date);
  }
  function lastOf(s) { var p = good(s.points); return p[p.length - 1]; }

  /* ── 지표 고르기 ── */
  function metricRow(s) {
    var on = state.selected.indexOf(s.id) >= 0, last = lastOf(s);
    return '<label class="fm-metric rk-metric"><input type="checkbox" data-rk-toggle="' + esc(s.id) + '"' + (on ? " checked" : "") + '><i class="fm-metric-color" style="--series-color:' + esc(on ? colorOf(s.id) : "#9aa8bd") + '"></i>' +
      '<span class="fm-metric-info">' + esc(s.label) + "<small>" + esc(s.source + (last ? " · " + last.date.slice(0, 7) : "")) + '</small></span><span class="fm-metric-value">' + esc(last ? fmt(last.value, s.unit) : "—") + "</span></label>";
  }
  function selectorBlock(g) {
    var list = DATA.series.filter(function (s) { return s.group === g.id && good(s.points).length > 1; });
    if (!list.length) return "";
    var count = list.filter(function (s) { return state.selected.indexOf(s.id) >= 0; }).length;
    var chev = '<svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    return '<details class="fm-selector" data-rk-group="' + esc(g.id) + '"' + (state.open.indexOf(g.id) >= 0 ? " open" : "") + "><summary><div><b>" + esc(g.label) + "</b><small>" + list.length + "개" + (count ? " / " + count + "개 표시 중" : "") + "</small></div>" + chev +
      '</summary><div class="fm-options">' + list.map(metricRow).join("") + "</div></details>";
  }

  /* ── 차트 ── */
  function drawChart() {
    var box = document.getElementById("rk-chart"), legend = document.getElementById("rk-legend");
    if (!box) return;
    var W = Math.max(320, box.clientWidth || 900), H = 380, sel = selected(), axesR = state.mode === "normalized" ? 1 : Math.min(2, sel.length);
    var padL = 58, padR = 18 + axesR * 54, padT = 16, padB = 30, iw = W - padL - padR, ih = H - padT - padB;
    var t0 = startTs(), price = good((DATA.price || {}).points).filter(function (p) { return ts(p.date) >= t0; });
    if (price.length < 2) { box.innerHTML = '<div class="fm-chart-empty">주가 데이터가 없습니다.</div>'; return; }
    var t1 = ts(price[price.length - 1].date);
    var sx = function (t) { return padL + (t - t0) / (t1 - t0 || 1) * iw; };
    var pv = price.map(function (p) { return p.value; }), pmin = Math.min.apply(null, pv), pmax = Math.max.apply(null, pv), ppad = (pmax - pmin) * 0.06 || 1;
    pmin -= ppad; pmax += ppad;
    var sy = function (v) { return padT + (1 - (v - pmin) / (pmax - pmin)) * ih; };
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="료힌케이카쿠 주가와 선택 지표">';
    // 격자·왼쪽 축(주가)
    for (var i = 0; i <= 4; i++) {
      var v = pmin + (pmax - pmin) * i / 4, y = sy(v);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="rgba(110,130,165,.18)"/><text x="' + (padL - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + Math.round(v).toLocaleString("ko-KR") + "</text>";
    }
    svg += '<text x="' + (padL - 8) + '" y="' + (padT - 4) + '" text-anchor="end">엔</text>';
    // x 눈금
    var span = (t1 - t0) / 864e5, stepM = span > 1500 ? 12 : span > 700 ? 6 : 3, d0 = new Date(t0);
    for (var m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() <= t1; m.setUTCMonth(m.getUTCMonth() + 1)) {
      if (m.getUTCMonth() % stepM) continue;
      var x = sx(m.getTime());
      svg += '<text x="' + x + '" y="' + (H - 8) + '" text-anchor="middle">' + m.getUTCFullYear() + "." + String(m.getUTCMonth() + 1).padStart(2, "0") + "</text>";
    }
    // 주가
    var ppath = price.map(function (p, i) { return (i ? "L" : "M") + sx(ts(p.date)).toFixed(1) + " " + sy(p.value).toFixed(1); }).join("");
    svg += '<path d="' + ppath + "L" + sx(t1).toFixed(1) + " " + (padT + ih) + "L" + padL + " " + (padT + ih) + 'Z" fill="rgba(91,141,239,.08)"/>';
    svg += '<path class="fm-series-path fm-price-path" d="' + ppath + '" fill="none" stroke="' + PRICE_COLOR + '" stroke-width="1.6" stroke-linejoin="round"/>';
    // 선택 지표
    var drawn = [];
    sel.forEach(function (id, k) {
      var s = BY[id], pts = good(s.points).filter(function (p) { var t = ts(p.date); return t >= t0 - 40 * 864e5 && t <= t1 + 40 * 864e5; });
      if (!pts.length) { drawn.push({s: s, pts: []}); return; }
      var vals = pts.map(function (p) { return p.value; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      if (state.mode === "normalized") { var r0 = hi - lo || 1; pts = pts.map(function (p) { return {date: p.date, value: (p.value - lo) / r0 * 100, raw: p.value}; }); lo = 0; hi = 100; }
      else { var pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1; lo -= pad; hi += pad; }
      var yy = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * ih; }, col = colorOf(id);
      var path = pts.map(function (p, i) { return (i ? "L" : "M") + sx(ts(p.date)).toFixed(1) + " " + yy(p.value).toFixed(1); }).join("");
      svg += '<path class="fm-series-path" d="' + path + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      if (pts.length <= 80) pts.forEach(function (p) { svg += '<circle cx="' + sx(ts(p.date)).toFixed(1) + '" cy="' + yy(p.value).toFixed(1) + '" r="2.6" fill="' + col + '"/>'; });
      if (s.unit === "전년=100" && state.mode === "units" && lo < 100 && hi > 100) svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy(100) + '" y2="' + yy(100) + '" stroke="' + col + '" stroke-opacity=".35" stroke-dasharray="3 4"/>';
      // 오른쪽 축
      if ((state.mode === "normalized" && k === 0) || (state.mode === "units" && k < 2)) {
        var ax = W - padR + 10 + (state.mode === "units" ? k * 54 : 0);
        for (var j = 0; j <= 4; j++) {
          var vv = lo + (hi - lo) * j / 4;
          svg += '<text x="' + ax + '" y="' + (yy(vv) + 3) + '" fill="' + (state.mode === "units" ? col : "#566987") + '" style="fill:' + (state.mode === "units" ? col : "#566987") + '">' + (state.mode === "normalized" ? Math.round(vv) : fmt(vv, s.unit === "전년=100" ? "" : s.unit).replace(/엔$|억$|점$/, "")) + "</text>";
        }
        svg += '<text x="' + ax + '" y="' + (padT - 4) + '" style="fill:' + (state.mode === "units" ? col : "#566987") + '">' + esc(state.mode === "normalized" ? "0–100" : s.unit === "전년=100" ? "YoY" : s.unit) + "</text>";
      }
      drawn.push({s: s, pts: pts, yy: yy, col: col});
    });
    svg += '<line id="rk-cross" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="#6f7f99" stroke-dasharray="3 3" visibility="hidden"/></svg>';
    box.innerHTML = svg + '<div class="rk-tip" id="rk-tip" hidden></div>';
    // 범례
    legend.innerHTML = '<button type="button" disabled><i style="--series-color:' + PRICE_COLOR + '"></i>료힌케이카쿠 주가<small>기본</small></button>' +
      drawn.map(function (d) { return '<button type="button" data-rk-remove="' + esc(d.s.id) + '"><i style="--series-color:' + colorOf(d.s.id) + '"></i>' + esc(d.s.label) + "<small>" + (d.pts.length ? d.pts.length + "개 점" : "이 기간 자료 없음") + " · ×</small></button>"; }).join("");
    legend.querySelectorAll("[data-rk-remove]").forEach(function (b) { b.onclick = function () { toggle(b.dataset.rkRemove); }; });
    // 마우스 올리면 값
    var svgEl = box.querySelector("svg"), tip = document.getElementById("rk-tip"), cross = document.getElementById("rk-cross");
    var near = function (pts, t, maxDays) { var best = null, bd = Infinity; pts.forEach(function (p) { var d = Math.abs(ts(p.date) - t); if (d < bd) { bd = d; best = p; } }); return bd <= maxDays * 864e5 ? best : null; };
    svgEl.addEventListener("mousemove", function (e) {
      var r = svgEl.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width;
      if (x < padL || x > W - padR) { tip.hidden = true; cross.setAttribute("visibility", "hidden"); return; }
      var t = t0 + (x - padL) / iw * (t1 - t0), pp = near(price, t, 7);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      var html = "<b>" + (pp ? pp.date : "") + "</b><span><i style=\"--series-color:" + PRICE_COLOR + "\"></i>주가 " + (pp ? fmt(pp.value, "엔") : "—") + "</span>";
      drawn.forEach(function (d) { var q = near(d.pts, t, d.s.cadence && d.s.cadence.indexOf("분기") >= 0 || d.s.group === "stores" ? 75 : 20); if (q) html += "<span><i style=\"--series-color:" + d.col + "\"></i>" + esc(d.s.label) + " " + esc(fmt(q.raw != null ? q.raw : q.value, d.s.unit)) + " <small>" + q.date.slice(0, 7) + "</small></span>"; });
      tip.innerHTML = html; tip.hidden = false;
      var left = (e.clientX - r.left) + 14; if (left > r.width - 260) left = (e.clientX - r.left) - 270;
      tip.style.left = left + "px"; tip.style.top = Math.max(0, e.clientY - r.top - 20) + "px";
    });
    svgEl.addEventListener("mouseleave", function () { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  }

  /* ── 표 ── */
  function overviewTable() {
    var gl = {}; (DATA.groups || []).forEach(function (g) { gl[g.id] = g.label; });
    var rows = DATA.series.filter(function (s) { return good(s.points).length > 1; }).map(function (s) {
      var p = good(s.points), last = p[p.length - 1], prev = p[p.length - 2], on = state.selected.indexOf(s.id) >= 0, u = safeURL(s.source_url || "");
      var chg = last && prev ? (s.unit === "전년=100" || s.unit === "%" || s.unit === "℃" ? (last.value - prev.value).toFixed(1) + (s.unit === "℃" ? "℃" : "p") : prev.value ? ((last.value / prev.value - 1) * 100).toFixed(1) + "%" : "") : "";
      if (chg && chg[0] !== "-") chg = "+" + chg;
      return "<tr><td>" + esc(gl[s.group] || s.group) + '</td><td class="rk-name"><i class="fm-metric-color" style="--series-color:' + esc(on ? colorOf(s.id) : "#b4bfcf") + '"></i> ' + esc(s.label) + '</td><td class="rk-num">' + esc(fmt(last.value, s.unit)) + '</td><td class="rk-num">' + esc(last.date.slice(0, 7)) + '</td><td class="rk-num">' + esc(chg) + "</td><td>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.source) + "</a>" : esc(s.source)) + "</td><td>" + esc(s.note || "") + '</td><td><button type="button" class="rk-pick" data-rk-toggle-btn="' + esc(s.id) + '">' + (on ? "빼기" : "겹쳐보기") + "</button></td></tr>";
    }).join("");
    return '<div class="fm-history-heading"><b>지표 한눈에 보기</b><span>' + DATA.series.length + '개 · 최신값과 직전 대비</span></div><div class="fm-table-wrap rk-wrap rk-scroll"><table class="fm-table rk-table rk-over"><thead><tr><th>분류</th><th>지표</th><th>최신값</th><th>기준월</th><th>직전 대비</th><th>출처</th><th>비고</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  function nameCell(r) { var u = safeURL(r.url || ""); return '<td class="rk-name">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(r.name) + "</a>" : esc(r.name)) + "</td>"; }
  function tierTable(t) {
    var wide = t.columns.length === 4;
    return '<div class="fm-history-heading"><b>' + esc(t.title) + "</b><span>" + t.rows.length + '개</span></div><div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table' + (wide ? " rk-4" : " rk-3") + '"><thead><tr>' +
      t.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" + t.rows.map(function (r) {
        var mark = r.ok === true ? '<i class="rk-ok">✓</i>' : r.ok === false ? '<i class="rk-no">–</i>' : "";
        return "<tr>" + nameCell(r) + "<td>" + esc(r.what) + "</td>" + (wide ? "<td>" + esc(r.lead || "") + "</td>" : "") + '<td class="rk-check">' + mark + esc(r.check) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function snapTable(list) {
    if (!list || !list.length) return "";
    return '<div class="fm-history-heading"><b>리서치 도구 월간 스냅샷</b><span>공개 화면의 값을 그대로 옮김 · 이력이 남지 않아 매달 기록</span></div><div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table rk-snap"><thead><tr><th>월</th><th>출처</th><th>지표</th><th>값</th><th>변화</th><th>메모</th></tr></thead><tbody>' +
      list.map(function (s) { var u = safeURL(s.url || ""); return "<tr><td>" + esc(s.month) + "</td><td>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.source) + "</a>" : esc(s.source)) + "</td><td>" + esc(s.metric) + '</td><td class="rk-num">' + esc(s.value) + "</td><td>" + esc(s.change || "") + "</td><td>" + esc(s.memo || "") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }

  function render() {
    if (!active) return;
    if (!DATA) {
      host.innerHTML = '<div class="fm-chart-empty">' + (error ? "<b>료힌케이카쿠 데이터를 불러오지 못했어요.</b><p>" + esc(error) + '</p><button class="fm-add" id="rk-retry" type="button">다시 불러오기</button>' : "료힌케이카쿠 주가·지표를 불러오는 중입니다.") + "</div>";
      var r = document.getElementById("rk-retry"); if (r) r.onclick = function () { load(true); };
      return;
    }
    var co = DATA.company || {}, ev = DATA.next_event || {}, px = good((DATA.price || {}).points), last = px[px.length - 1], prev = px[px.length - 2];
    var chg = last && prev ? (last.value / prev.value - 1) * 100 : null;
    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">' + esc((co.brand || "MUJI") + " · " + (co.market || "") + " " + (co.code || "")) + "</div><h3>" + esc(co.name || "료힌케이카쿠") + "<small>" + esc((co.fy_end || "") + (ev.date ? " · 다음 결산 " + ev.date + " " + (ev.time || "") : "")) + "</small></h3></div>" +
          '<div class="fm-quote"><strong>' + (last ? esc(fmt(last.value, "엔")) : "—") + "</strong><span>" + (last ? esc(last.date) + (finite(chg) ? ' · <b class="' + (chg >= 0 ? "rk-up" : "rk-down") + '">' + (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%</b>" : "") : "") + "</span></div></div>" +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(String(DATA.generated_at || "—").slice(0, 16).replace("T", " ")) + " 수집 · 주가·환율·날씨·검색 자동, 월차·실적 수동</span>" +
          (DATA.errors && DATA.errors.length ? '<span class="fm-divider"></span><span class="fm-status pending"><i></i>일부 소스 지연 ' + DATA.errors.length + "건 · 마지막 값 유지</span>" : "") + '<button type="button" id="rk-refresh">새 데이터 확인 ↻</button></div>' +
        '<div class="fm-selectors rk-selectors">' + (DATA.groups || []).map(selectorBlock).join("") + "</div>" +
        '<div class="fm-toolbar"><div class="fm-segment" aria-label="차트 기간">' + RANGES.map(function (r) { return '<button type="button" data-rk-range="' + r[0] + '" class="' + (state.range === r[0] ? "on" : "") + '">' + (r[0] === "ALL" ? "전체" : r[0]) + "</button>"; }).join("") + "</div>" +
          '<label class="fm-view-options">비교 방식<select id="rk-mode"><option value="units"' + (state.mode === "units" ? " selected" : "") + '>실제 단위</option><option value="normalized"' + (state.mode === "normalized" ? " selected" : "") + ">흐름 비교 · 0–100</option></select></label></div>" +
        '<div class="fm-chart rk-chart" id="rk-chart"></div><div class="fm-legend" id="rk-legend"></div>' +
        '<p class="fm-note">파란 선이 주가(왼쪽 축, 엔)이고, 고른 지표는 색마다 오른쪽 축을 따로 씁니다(실제 단위 보기에서 앞의 2개만 눈금 표시). 월차의 「전년=100」 지표는 100에 점선을 그었습니다. 월간 지표는 그 달 말일, 분기 실적은 분기 마지막 달 말일에 찍었습니다. 최대 ' + MAX + "개까지 겹쳐 볼 수 있어요.</p>" +
        overviewTable() +
        (DATA.tiers || []).map(tierTable).join("") + snapTable(DATA.snapshots) +
        '<p class="fm-sources">수집: fetch_ryohin.py — 주가·환율(Yahoo Finance), 도쿄 날씨(기상청), 구글 트렌드(trendspy)는 매일 자동. 무지 월차·분기 실적·점포 수(회사 월차·팩트시트·데이터북)와 유니클로 월차는 data_sources/ryohin_manual.json 에 손으로 추가합니다.</p>' +
      "</article>";
    host.querySelectorAll("[data-rk-toggle]").forEach(function (c) { c.onchange = function () { toggle(c.dataset.rkToggle); }; });
    host.querySelectorAll("[data-rk-toggle-btn]").forEach(function (b) { b.onclick = function () { toggle(b.dataset.rkToggleBtn); var ch = document.getElementById("rk-chart"); if (ch) ch.scrollIntoView({behavior: "smooth", block: "center"}); }; });
    host.querySelectorAll("[data-rk-range]").forEach(function (b) { b.onclick = function () { state.range = b.dataset.rkRange; store(); render(); }; });
    host.querySelectorAll("details[data-rk-group]").forEach(function (d) { d.ontoggle = function () { var g = d.dataset.rkGroup, i = state.open.indexOf(g); if (d.open && i < 0) state.open.push(g); if (!d.open && i >= 0) state.open.splice(i, 1); store(); }; });
    var mode = document.getElementById("rk-mode"); if (mode) mode.onchange = function () { state.mode = mode.value; store(); render(); };
    var b = document.getElementById("rk-refresh"); if (b) b.onclick = function () { load(true); };
    drawChart();
  }
  function load(manual) {
    if (loading) return; loading = true;
    var get = window.vantageJSON ? function (p) { return window.vantageJSON(p, manual); } : function (p) { return fetch(p, {cache: "no-cache"}).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    get("data/ryohin.json").then(function (d) {
      if (!d || !Array.isArray(d.series)) throw new Error("파일 형식 불일치");
      DATA = d; BY = {}; d.series.forEach(function (s) { BY[s.id] = s; }); error = "";
      if (manual) toast("서버에 저장된 최신 데이터를 불러왔어요.");
    }, function (e) { error = "data/ryohin.json 수신 실패 (" + e.message + ")"; }).then(function () { loading = false; render(); });
  }
  document.addEventListener("vantage-company-change", function (e) {
    active = !!(e.detail && e.detail.company === "료힌케이카쿠"); host.hidden = !active;
    if (active) { render(); if (!DATA) load(false); }
  });
  window.addEventListener("resize", function () { cancelAnimationFrame(renderId); renderId = requestAnimationFrame(function () { if (active && DATA) drawChart(); }); });
})();
