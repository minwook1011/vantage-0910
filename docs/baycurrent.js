/* 베이커런트(6532) 워크벤치 — data/baycurrent.json 을 읽어 주가 위에 인력 지표(회사 공시 분기 인원·회사 전망·연금 피보험자·구인 공고)를 겹쳐 본다.
   기업별 데이터 모음에서 "베이커런트"를 고르면 열린다. 수집: fetch_baycurrent.py(.github/workflows/baycurrent.yml).
   컨설턴트 수가 매출로 바로 이어지는 회사라, 같은 단위(명)의 지표는 한 축을 같이 써서 크기를 바로 비교한다.
   빈 값은 0이나 예시로 채우지 않는다. 고른 지표·기간은 이 브라우저(localStorage)에 저장한다. ryohin.css 의 rk-* 스타일을 같이 쓴다. */
(function () {
  "use strict";
  var host = document.getElementById("baycurrent-workspace");
  if (!host) return;
  var KEY = "vantage-baycurrent-bench-v1", MAX = 5;
  var PRICE_COLOR = "#5b8def";
  var PALETTE = ["#e8833a", "#1f9a72", "#9b6bd6", "#d4507a", "#c9a227", "#3aa7c9"];
  var RANGES = [["1Y", 1], ["2Y", 2], ["3Y", 3], ["5Y", 5], ["ALL", 0]];
  var DEFAULT_SEL = ["co_consultants", "co_total", "nk_total", "gd_consultants"];
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]; }); };
  var safeURL = function (v) { try { var u = new URL(v); return ["https:", "http:"].indexOf(u.protocol) >= 0 ? u.href : ""; } catch (e) { return ""; } };
  var finite = function (v) { return typeof v === "number" && isFinite(v); };
  var ts = function (d) { return Date.parse(d + "T00:00:00Z"); };
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  var state = {
    selected: Array.isArray(saved.selected) ? saved.selected.filter(function (x) { return typeof x === "string"; }).slice(0, MAX) : DEFAULT_SEL.slice(),
    range: RANGES.some(function (r) { return r[0] === saved.range; }) ? saved.range : "3Y",
    mode: saved.mode === "normalized" ? "normalized" : "units",
    open: Array.isArray(saved.open) ? saved.open : ["company", "pension"]
  };
  var DATA = null, BY = {}, active = false, loading = false, error = "", renderId = 0;
  function store() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function good(pts) { return (pts || []).filter(function (p) { return p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && finite(p.value); }); }
  function colorOf(id) { var i = state.selected.indexOf(id); return i >= 0 ? PALETTE[i % PALETTE.length] : "#8a97ab"; }
  function fmt(v, unit) {
    if (!finite(v)) return "—";
    var s = v.toLocaleString("ko-KR", {minimumFractionDigits: 0, maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 1});
    return unit === "%" ? s + "%" : unit === "엔" ? s + "엔" : unit === "명" ? s + "명" : unit === "건" ? s + "건" : s;
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
  function lastOf(s) { var p = good(s.points); return p[p.length - 1]; }

  /* ── 지표 고르기 ── */
  function metricRow(s) {
    var on = state.selected.indexOf(s.id) >= 0, last = lastOf(s);
    return '<label class="fm-metric rk-metric"><input type="checkbox" data-bc-toggle="' + esc(s.id) + '"' + (on ? " checked" : "") + '><i class="fm-metric-color" style="--series-color:' + esc(on ? colorOf(s.id) : "#9aa8bd") + '"></i>' +
      '<span class="fm-metric-info">' + esc(s.label) + "<small>" + esc(s.source + (last ? " · " + last.date.slice(0, 7) : "") + (good(s.points).length === 1 ? " · 기록 1개" : "")) + '</small></span><span class="fm-metric-value">' + esc(last ? fmt(last.value, s.unit) : "—") + "</span></label>";
  }
  function selectorBlock(g) {
    var list = DATA.series.filter(function (s) { return s.group === g.id && good(s.points).length; });
    if (!list.length) return "";
    var count = list.filter(function (s) { return state.selected.indexOf(s.id) >= 0; }).length;
    var chev = '<svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    return '<details class="fm-selector" data-bc-group="' + esc(g.id) + '"' + (state.open.indexOf(g.id) >= 0 ? " open" : "") + "><summary><div><b>" + esc(g.label) + "</b><small>" + list.length + "개" + (count ? " / " + count + "개 표시 중" : "") + "</small></div>" + chev +
      '</summary><div class="fm-options">' + list.map(metricRow).join("") + "</div></details>";
  }

  /* ── 차트 ── */
  function drawChart() {
    var box = document.getElementById("bc-chart"), legend = document.getElementById("bc-legend");
    if (!box) return;
    var sel = selected(), allPrice = good((DATA.price || {}).points);
    if (allPrice.length < 2) { box.innerHTML = '<div class="fm-chart-empty">주가 데이터가 없습니다.</div>'; return; }
    var pEnd = ts(allPrice[allPrice.length - 1].date), r = RANGES.filter(function (x) { return x[0] === state.range; })[0];
    var t0 = r && r[1] ? pEnd - r[1] * 365.25 * 864e5 : ts(allPrice[0].date);
    // 전망 점이 주가 끝보다 뒤에 있으면 축을 그만큼(최대 120일) 늘린다
    var t1 = pEnd;
    sel.forEach(function (id) { good(BY[id].points).forEach(function (p) { var t = ts(p.date); if (t > t1 && t <= pEnd + 120 * 864e5) t1 = t; }); });
    if (t1 > pEnd) t1 += 10 * 864e5;
    var price = allPrice.filter(function (p) { return ts(p.date) >= t0; });
    // 단위가 같은 지표는 축 하나를 같이 쓴다
    var units = [];
    sel.forEach(function (id) { var u = BY[id].unit; if (units.indexOf(u) < 0) units.push(u); });
    var axesR = state.mode === "normalized" ? 1 : Math.min(2, units.length);
    var W = Math.max(320, box.clientWidth || 900), H = 400, padL = 58, padR = 18 + axesR * 58, padT = 16, padB = 30, iw = W - padL - padR, ih = H - padT - padB;
    var sx = function (t) { return padL + (t - t0) / (t1 - t0 || 1) * iw; };
    var pv = price.map(function (p) { return p.value; }), pmin = Math.min.apply(null, pv), pmax = Math.max.apply(null, pv), ppad = (pmax - pmin) * 0.06 || 1;
    pmin -= ppad; pmax += ppad;
    var sy = function (v) { return padT + (1 - (v - pmin) / (pmax - pmin)) * ih; };
    var inView = function (s) { return good(s.points).filter(function (p) { var t = ts(p.date); return t >= t0 - 100 * 864e5 && t <= t1 + 5 * 864e5; }); };
    var scale = {};
    units.forEach(function (u) {
      var vals = [];
      sel.forEach(function (id) { if (BY[id].unit === u) inView(BY[id]).forEach(function (p) { vals.push(p.value); if (p.range) vals.push(p.range[0], p.range[1]); }); });
      if (!vals.length) return;
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
      scale[u] = {lo: lo - pad, hi: hi + pad};
    });
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="베이커런트 주가와 인력 지표">';
    for (var i = 0; i <= 4; i++) {
      var v = pmin + (pmax - pmin) * i / 4, y = sy(v);
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="rgba(110,130,165,.18)"/><text x="' + (padL - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + Math.round(v).toLocaleString("ko-KR") + "</text>";
    }
    svg += '<text x="' + (padL - 8) + '" y="' + (padT - 4) + '" text-anchor="end">엔</text>';
    var span = (t1 - t0) / 864e5, stepM = span > 1500 ? 12 : span > 700 ? 6 : 3, d0 = new Date(t0);
    for (var m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() <= t1; m.setUTCMonth(m.getUTCMonth() + 1)) {
      if (m.getUTCMonth() % stepM) continue;
      svg += '<text x="' + sx(m.getTime()) + '" y="' + (H - 8) + '" text-anchor="middle">' + m.getUTCFullYear() + "." + String(m.getUTCMonth() + 1).padStart(2, "0") + "</text>";
    }
    // 실적 발표일(회사가 인원을 발표한 날) — 회사 공시 지표를 골랐을 때만 옅은 세로선
    if (sel.some(function (id) { return BY[id].group === "company"; })) {
      (DATA.headcount || []).forEach(function (h) { if (!h.announced) return; var t = ts(h.announced); if (t < t0 || t > t1) return; var x = sx(t).toFixed(1); svg += '<line x1="' + x + '" x2="' + x + '" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="rgba(150,160,180,.35)" stroke-dasharray="2 4"/>'; });
    }
    if (pEnd < t1) { var xe = sx(pEnd).toFixed(1); svg += '<rect x="' + xe + '" y="' + padT + '" width="' + (sx(t1) - sx(pEnd)).toFixed(1) + '" height="' + ih + '" fill="rgba(150,160,180,.07)"/>'; }
    var ppath = price.map(function (p, i) { return (i ? "L" : "M") + sx(ts(p.date)).toFixed(1) + " " + sy(p.value).toFixed(1); }).join("");
    svg += '<path d="' + ppath + "L" + sx(pEnd).toFixed(1) + " " + (padT + ih) + "L" + sx(ts(price[0].date)).toFixed(1) + " " + (padT + ih) + 'Z" fill="rgba(91,141,239,.08)"/>';
    svg += '<path class="fm-series-path fm-price-path" d="' + ppath + '" fill="none" stroke="' + PRICE_COLOR + '" stroke-width="1.6" stroke-linejoin="round"/>';
    var drawn = [];
    sel.forEach(function (id) {
      var s = BY[id], pts = inView(s), col = colorOf(id);
      if (!pts.length) { drawn.push({s: s, pts: []}); return; }
      var lo, hi;
      if (state.mode === "normalized") {
        var vals = pts.map(function (p) { return p.value; }); lo = Math.min.apply(null, vals); hi = Math.max.apply(null, vals);
        var r0 = hi - lo || 1, base = lo; pts = pts.map(function (p) { return {date: p.date, value: hi === lo ? 50 : (p.value - base) / r0 * 100, raw: p.value, announced: p.announced}; }); lo = 0; hi = 100;
      } else { lo = scale[s.unit].lo; hi = scale[s.unit].hi; }
      var yy = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * ih; };
      var isGuide = s.group === "guidance";
      if (isGuide && s.link && BY[s.link] && state.mode === "units") {
        // 전망: 연결된 실제 지표의 마지막 점에서 점선으로 잇고, 범위가 있으면 세로 막대
        var lastA = good(BY[s.link].points).slice(-1)[0];
        pts.forEach(function (p) {
          if (lastA && ts(lastA.date) < ts(p.date)) svg += '<line x1="' + sx(ts(lastA.date)).toFixed(1) + '" y1="' + yy(lastA.value).toFixed(1) + '" x2="' + sx(ts(p.date)).toFixed(1) + '" y2="' + yy(p.value).toFixed(1) + '" stroke="' + col + '" stroke-width="2" stroke-dasharray="5 4"/>';
          var src = good(s.points).filter(function (q) { return q.date === p.date; })[0];
          if (src && src.range) svg += '<line x1="' + sx(ts(p.date)).toFixed(1) + '" x2="' + sx(ts(p.date)).toFixed(1) + '" y1="' + yy(src.range[0]).toFixed(1) + '" y2="' + yy(src.range[1]).toFixed(1) + '" stroke="' + col + '" stroke-width="5" stroke-opacity=".45" stroke-linecap="round"/>';
        });
      } else if (pts.length > 1) {
        var path = pts.map(function (p, i) { return (i ? "L" : "M") + sx(ts(p.date)).toFixed(1) + " " + yy(p.value).toFixed(1); }).join("");
        svg += '<path class="fm-series-path" d="' + path + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (isGuide ? ' stroke-dasharray="5 4"' : "") + "/>";
      }
      if (pts.length <= 80) pts.forEach(function (p) { svg += '<circle cx="' + sx(ts(p.date)).toFixed(1) + '" cy="' + yy(p.value).toFixed(1) + '" r="' + (pts.length === 1 ? 4.2 : 2.8) + '" fill="' + (isGuide ? "none" : col) + '" stroke="' + col + '" stroke-width="' + (isGuide ? 2 : 0) + '"/>'; });
      drawn.push({s: s, pts: pts, yy: yy, col: col});
    });
    // 오른쪽 축: 실제 단위면 단위별(앞의 2개), 흐름 비교면 0–100 하나
    if (state.mode === "normalized") {
      var axn = W - padR + 10;
      for (var j = 0; j <= 4; j++) svg += '<text x="' + axn + '" y="' + (padT + (1 - j / 4) * ih + 3) + '" style="fill:#566987">' + (j * 25) + "</text>";
      svg += '<text x="' + axn + '" y="' + (padT - 4) + '" style="fill:#566987">0–100</text>';
    } else {
      units.slice(0, 2).forEach(function (u, k) {
        var sc = scale[u]; if (!sc) return;
        var firstId = sel.filter(function (id) { return BY[id].unit === u; })[0], col = units.length > 1 || sel.length === 1 ? colorOf(firstId) : "#566987", ax = W - padR + 10 + k * 58;
        for (var j2 = 0; j2 <= 4; j2++) { var vv = sc.lo + (sc.hi - sc.lo) * j2 / 4; svg += '<text x="' + ax + '" y="' + (padT + (1 - j2 / 4) * ih + 3) + '" style="fill:' + col + '">' + Math.round(vv).toLocaleString("ko-KR") + "</text>"; }
        svg += '<text x="' + ax + '" y="' + (padT - 4) + '" style="fill:' + col + '">' + esc(u) + "</text>";
      });
    }
    svg += '<line id="bc-cross" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + ih) + '" stroke="#6f7f99" stroke-dasharray="3 3" visibility="hidden"/></svg>';
    box.innerHTML = svg + '<div class="rk-tip" id="bc-tip" hidden></div>';
    legend.innerHTML = '<button type="button" disabled><i style="--series-color:' + PRICE_COLOR + '"></i>베이커런트 주가<small>기본</small></button>' +
      drawn.map(function (d) { return '<button type="button" data-bc-remove="' + esc(d.s.id) + '"><i style="--series-color:' + colorOf(d.s.id) + '"></i>' + esc(d.s.label) + "<small>" + (d.pts.length ? d.pts.length + "개 점" : "이 기간 자료 없음") + " · ×</small></button>"; }).join("");
    legend.querySelectorAll("[data-bc-remove]").forEach(function (b) { b.onclick = function () { toggle(b.dataset.bcRemove); }; });
    var svgEl = box.querySelector("svg"), tip = document.getElementById("bc-tip"), cross = document.getElementById("bc-cross");
    var near = function (pts, t, maxDays) { var best = null, bd = Infinity; pts.forEach(function (p) { var d = Math.abs(ts(p.date) - t); if (d < bd) { bd = d; best = p; } }); return bd <= maxDays * 864e5 ? best : null; };
    svgEl.addEventListener("mousemove", function (e) {
      var rc = svgEl.getBoundingClientRect(), x = (e.clientX - rc.left) * W / rc.width;
      if (x < padL || x > W - padR) { tip.hidden = true; cross.setAttribute("visibility", "hidden"); return; }
      var t = t0 + (x - padL) / iw * (t1 - t0), pp = near(price, t, 7);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
      var html = "<b>" + (pp ? pp.date : new Date(t).toISOString().slice(0, 10)) + "</b><span><i style=\"--series-color:" + PRICE_COLOR + "\"></i>주가 " + (pp ? fmt(pp.value, "엔") : "—") + "</span>";
      drawn.forEach(function (d) {
        var q = near(d.pts, t, d.s.quarterly ? 50 : 20); if (!q) return;
        var src = good(d.s.points).filter(function (z) { return z.date === q.date; })[0] || {};
        html += "<span><i style=\"--series-color:" + d.col + "\"></i>" + esc(d.s.label) + " " + esc(src.range ? fmt(src.range[0], "") + "~" + fmt(src.range[1], d.s.unit) : fmt(q.raw != null ? q.raw : q.value, d.s.unit)) + " <small>" + q.date + (src.announced ? " · 발표 " + src.announced : "") + "</small></span>";
      });
      tip.innerHTML = html; tip.hidden = false;
      var left = (e.clientX - rc.left) + 14; if (left > rc.width - 280) left = (e.clientX - rc.left) - 290;
      tip.style.left = left + "px"; tip.style.top = Math.max(0, e.clientY - rc.top - 20) + "px";
    });
    svgEl.addEventListener("mouseleave", function () { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  }

  /* ── 표 ── */
  function n(v) { return finite(v) ? v.toLocaleString("ko-KR") : "—"; }
  function pct(a, b) { if (!finite(a) || !finite(b) || !b) return ""; var v = (a / b - 1) * 100; return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"; }
  function headcountTable() {
    var rows = (DATA.headcount || []).slice().reverse(), byd = {};
    (DATA.headcount || []).forEach(function (r) { byd[r.date] = r; });
    var g = (DATA.series || []).filter(function (s) { return s.id === "gd_consultants"; })[0], gp = g ? good(g.points) : [], gt = (DATA.series || []).filter(function (s) { return s.id === "gd_total"; })[0];
    var gtv = gt ? good(gt.points) : [];
    var guideRows = gp.map(function (p) { var tt = gtv.filter(function (q) { return q.date === p.date; })[0]; return '<tr class="bc-guide"><td>' + esc(p.date) + ' <small>전망</small></td><td class="rk-num">' + (p.range ? n(p.range[0]) + "~" + n(p.range[1]) : n(p.value)) + '</td><td class="rk-num">' + (tt ? "약 " + n(tt.value) : "—") + '</td><td class="rk-num">—</td><td class="rk-num">—</td><td class="rk-num">—</td><td>' + esc(p.announced || "") + "</td><td>회사 전망</td></tr>"; }).join("");
    var body = rows.map(function (r) {
      var y = r.date.split("-"), ly = (+y[0] - 1) + "-" + y[1] + "-", prev = Object.keys(byd).filter(function (k) { return k.indexOf(ly) === 0; })[0];
      var non = finite(r.total) && finite(r.consultants) ? r.total - r.consultants : null;
      return "<tr><td>" + esc(r.date) + '</td><td class="rk-num">' + n(r.consultants) + '</td><td class="rk-num">' + n(r.total) + '</td><td class="rk-num">' + n(non) + '</td><td class="rk-num">' + (finite(non) && r.total ? (non / r.total * 100).toFixed(1) + "%" : "—") + '</td><td class="rk-num">' + esc(prev ? pct(r.consultants, byd[prev].consultants) : "") + "</td><td>" + esc(r.announced || "") + "</td><td>" + esc((r.basis || "") + (r.auto ? " · 자동 판독" : "")) + "</td></tr>";
    }).join("");
    return '<div class="fm-history-heading"><b>회사 공시 인원 (분기 말)</b><span>결산 보충자료 · 실적 발표 때 같이 나옴 · 새 발표는 자동 반영</span></div><div class="fm-table-wrap rk-wrap rk-scroll"><table class="fm-table rk-table"><thead><tr><th>분기 말</th><th>컨설턴트</th><th>총사원</th><th>비컨설턴트</th><th>비컨 비중</th><th>컨설턴트 YoY</th><th>발표일</th><th>기준</th></tr></thead><tbody>' + guideRows + body + "</tbody></table></div>";
  }
  function pensionTable() {
    var ent = DATA.entities || [], rows = (DATA.nenkin || []).slice().reverse();
    var head = "<tr><th>기준일</th><th>사이트 갱신</th>" + ent.map(function (e) { return "<th>" + esc(e.name.replace("株式会社", "").replace(/\s*\(.*\)/, "")) + "<br><small>" + esc(e.corp_no) + "</small></th>"; }).join("") + "<th>합계</th><th>직전 대비</th></tr>";
    var all = DATA.nenkin || [];
    var body = rows.map(function (r) {
      var tot = ent.reduce(function (a, e) { return finite(r[e.id]) ? a + r[e.id] : a; }, 0), i = all.indexOf(r), pr = i > 0 ? all[i - 1] : null;
      var ptot = pr ? ent.reduce(function (a, e) { return finite(pr[e.id]) ? a + pr[e.id] : a; }, 0) : null;
      return "<tr><td>" + esc(r.date) + "</td><td>" + esc(r.updated || "") + "</td>" + ent.map(function (e) { return '<td class="rk-num">' + n(r[e.id]) + "</td>"; }).join("") + '<td class="rk-num"><b>' + n(tot) + '</b></td><td class="rk-num">' + (ptot ? (tot - ptot >= 0 ? "+" : "") + n(tot - ptot) + "명" : "—") + "</td></tr>";
    }).join("");
    return '<div class="fm-history-heading"><b>연금 피보험자 (법인별)</b><span>일본연금기구 · 매달 기록 · 회사 공시 총사원과 기준이 달라 변화를 볼 것</span></div><div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }
  function sitesTable() {
    var latest = {"일본연금기구 適用事業所検索": (function () { var r = (DATA.nenkin || []).slice(-1)[0]; if (!r) return "—"; var t = (DATA.entities || []).reduce(function (a, e) { return finite(r[e.id]) ? a + r[e.id] : a; }, 0); return n(t) + "명 (" + r.date + ")"; })(),
      "doda (퍼솔 커리어)": (function () { var r = (DATA.doda || []).slice(-1)[0]; return r ? n(r.count) + "건 (" + r.date + ")" : "—"; })()};
    return '<div class="fm-history-heading"><b>인력 확인 사이트</b><span>둘 다 매달 손으로 기록 · data_sources/baycurrent_manual.json</span></div><div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table"><thead><tr><th>사이트</th><th>무엇</th><th>최근 값</th><th>주기</th><th>확인 방법</th><th>주의</th></tr></thead><tbody>' +
      (DATA.sites || []).map(function (s) { var u = safeURL(s.url || ""); return '<tr><td class="rk-name">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>" : esc(s.name)) + "</td><td>" + esc(s.what) + '</td><td class="rk-num">' + esc(latest[s.name] || "—") + "</td><td>" + esc(s.cadence) + "</td><td>" + esc(s.how) + "</td><td>" + esc(s.caveat) + "</td></tr>"; }).join("") +
      "</tbody></table></div>" +
      '<div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table"><thead><tr><th>법인</th><th>역할</th><th>법인번호</th><th>사회보험 적용일</th></tr></thead><tbody>' +
      (DATA.entities || []).map(function (e) { return "<tr><td>" + esc(e.name) + "</td><td>" + esc(e.role) + '</td><td class="rk-num">' + esc(e.corp_no) + '</td><td class="rk-num">' + esc(e.applied || "") + "</td></tr>"; }).join("") + "</tbody></table></div>";
  }

  function render() {
    if (!active) return;
    if (!DATA) {
      host.innerHTML = '<div class="fm-chart-empty">' + (error ? "<b>베이커런트 데이터를 불러오지 못했어요.</b><p>" + esc(error) + '</p><button class="fm-add" id="bc-retry" type="button">다시 불러오기</button>' : "베이커런트 주가·인력 지표를 불러오는 중입니다.") + "</div>";
      var rt = document.getElementById("bc-retry"); if (rt) rt.onclick = function () { load(true); };
      return;
    }
    var co = DATA.company || {}, ev = DATA.next_event || {}, px = good((DATA.price || {}).points), last = px[px.length - 1], prev = px[px.length - 2];
    var chg = last && prev ? (last.value / prev.value - 1) * 100 : null, hc = (DATA.headcount || []).slice(-1)[0] || {}, nk = (DATA.nenkin || []).slice(-1)[0];
    var nkTot = nk ? (DATA.entities || []).reduce(function (a, e) { return finite(nk[e.id]) ? a + nk[e.id] : a; }, 0) : null;
    var kpi = function (label, val, sub) { return '<div class="bc-kpi"><small>' + esc(label) + "</small><b>" + esc(val) + "</b><span>" + esc(sub || "") + "</span></div>"; };
    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">' + esc((co.brand || "BAYCURRENT") + " · " + (co.market || "") + " " + (co.code || "")) + "</div><h3>" + esc(co.name || "베이커런트") + "<small>" + esc((co.fy_end || "") + (ev.date ? " · 다음 결산 " + ev.date + (ev.est ? " (추정)" : "") : "")) + "</small></h3></div>" +
          '<div class="fm-quote"><strong>' + (last ? esc(fmt(last.value, "엔")) : "—") + "</strong><span>" + (last ? esc(last.date) + (finite(chg) ? ' · <b class="' + (chg >= 0 ? "rk-up" : "rk-down") + '">' + (chg >= 0 ? "+" : "") + chg.toFixed(1) + "%</b>" : "") : "") + "</span></div></div>" +
        '<div class="bc-kpis">' +
          kpi("컨설턴트 (회사 공시)", finite(hc.consultants) ? fmt(hc.consultants, "명") : "—", hc.date ? hc.date + " 기준" : "") +
          kpi("총사원 (회사 공시)", finite(hc.total) ? fmt(hc.total, "명") : "—", hc.announced ? "발표 " + hc.announced : "") +
          kpi("연금 피보험자 (3개 법인)", finite(nkTot) ? fmt(nkTot, "명") : "—", nk ? nk.date + " 기준 · " + (nk.updated || "") + " 갱신" : "") +
          kpi("doda 구인 공고", (DATA.doda || []).length ? fmt(DATA.doda.slice(-1)[0].count, "건") : "—", (DATA.doda || []).length ? DATA.doda.slice(-1)[0].date : "") +
        "</div>" +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(String(DATA.generated_at || "—").slice(0, 16).replace("T", " ")) + " 수집 · 주가 매일 자동, 회사 공시 인원은 실적 발표 뒤 자동, 연금·구인은 월 1회 수동</span>" +
          (DATA.errors && DATA.errors.length ? '<span class="fm-divider"></span><span class="fm-status pending"><i></i>일부 소스 지연 ' + DATA.errors.length + "건 · 마지막 값 유지</span>" : "") + '<button type="button" id="bc-refresh">새 데이터 확인 ↻</button></div>' +
        '<div class="fm-selectors rk-selectors">' + (DATA.groups || []).map(selectorBlock).join("") + "</div>" +
        '<div class="fm-toolbar"><div class="fm-segment" aria-label="차트 기간">' + RANGES.map(function (r) { return '<button type="button" data-bc-range="' + r[0] + '" class="' + (state.range === r[0] ? "on" : "") + '">' + (r[0] === "ALL" ? "전체" : r[0]) + "</button>"; }).join("") + "</div>" +
          '<label class="fm-view-options">비교 방식<select id="bc-mode"><option value="units"' + (state.mode === "units" ? " selected" : "") + '>실제 단위 · 같은 단위는 한 축</option><option value="normalized"' + (state.mode === "normalized" ? " selected" : "") + ">흐름 비교 · 0–100</option></select></label></div>" +
        '<div class="fm-chart rk-chart" id="bc-chart"></div><div class="fm-legend" id="bc-legend"></div>' +
        '<p class="fm-note">파란 선이 주가(왼쪽 축, 엔)입니다. 인원 지표는 같은 단위(명)끼리 오른쪽 축 하나를 같이 써서 크기를 바로 비교할 수 있어요. 회사 공시 인원은 분기 말에 점을 찍었고, 옅은 세로 점선은 그 숫자를 발표한 실적 발표일입니다. 회사 전망은 마지막 실적에서 점선으로 이었고 범위는 세로 막대로 표시했습니다. 회사 컨설턴트 수는 1Q·2Q에 연수 중인 신입을 빼고, 3Q·4Q에 넣어서 셉니다.</p>' +
        headcountTable() + pensionTable() + sitesTable() +
        '<p class="fm-sources">수집: fetch_baycurrent.py — 주가(Yahoo Finance 6532.T) 매일 자동. 회사 공시 인원은 일본 실적 수집기가 만든 실적 리포트의 결산 보충자료 PDF(TDnet)를 읽어 자동 추가합니다. 연금기구 피보험자 수와 doda 구인 건수는 data_sources/baycurrent_manual.json 에 매달 손으로 추가합니다(연금기구 검색은 결과 전재·2차 이용 금지).</p>' +
      "</article>";
    host.querySelectorAll("[data-bc-toggle]").forEach(function (c) { c.onchange = function () { toggle(c.dataset.bcToggle); }; });
    host.querySelectorAll("[data-bc-range]").forEach(function (b) { b.onclick = function () { state.range = b.dataset.bcRange; store(); render(); }; });
    host.querySelectorAll("details[data-bc-group]").forEach(function (d) { d.ontoggle = function () { var g = d.dataset.bcGroup, i = state.open.indexOf(g); if (d.open && i < 0) state.open.push(g); if (!d.open && i >= 0) state.open.splice(i, 1); store(); }; });
    var mode = document.getElementById("bc-mode"); if (mode) mode.onchange = function () { state.mode = mode.value; store(); render(); };
    var b = document.getElementById("bc-refresh"); if (b) b.onclick = function () { load(true); };
    drawChart();
  }
  function load(manual) {
    if (loading) return; loading = true;
    var get = window.vantageJSON ? function (p) { return window.vantageJSON(p, manual); } : function (p) { return fetch(p, {cache: "no-cache"}).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    get("data/baycurrent.json").then(function (d) {
      if (!d || !Array.isArray(d.series)) throw new Error("파일 형식 불일치");
      DATA = d; BY = {}; d.series.forEach(function (s) { BY[s.id] = s; }); error = "";
      if (manual) toast("서버에 저장된 최신 데이터를 불러왔어요.");
    }, function (e) { error = "data/baycurrent.json 수신 실패 (" + e.message + ")"; }).then(function () { loading = false; render(); });
  }
  document.addEventListener("vantage-company-change", function (e) {
    active = !!(e.detail && e.detail.company === "베이커런트"); host.hidden = !active;
    if (active) { render(); if (!DATA) load(false); }
  });
  window.addEventListener("resize", function () { cancelAnimationFrame(renderId); renderId = requestAnimationFrame(function () { if (active && DATA) drawChart(); }); });
})();
