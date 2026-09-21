/* 매크로 대시보드 — docs/macro_dash.json (fetch_macro_dash.py가 자동 갱신) */
(function () {
  "use strict";
  var D = null;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* ───────── 설정 ───────── */
  var KPI_ORDER = ["cpi", "core_cpi", "pce", "core_pce", "ppi", "core_ppi", "nfp", "unrate", "claims", "ahe", "jolts", "lfpr",
    "gdp", "umich", "effr", "y2", "y10", "y30", "s10y2y", "s10y3m", "y3m", "vix", "dxy", "usdkrw"];
  var KPI_TABS = [["all", "전체"], ["inflation", "물가"], ["labor", "고용"], ["growth", "성장·심리"], ["rates", "금리"], ["markets", "시장"]];
  var EV_OF = { cpi: "cpi", core_cpi: "cpi", ppi: "ppi", core_ppi: "ppi", pce: "pce", core_pce: "pce", nfp: "nfp", unrate: "nfp", ahe: "nfp",
    lfpr: "nfp", jolts: "jolts", gdp: "gdp", claims: "claims", effr: "fomc", y2: "fomc" };
  var IND_OF_EV = { cpi: "cpi", ppi: "ppi", pce: "pce", nfp: "nfp", jolts: "jolts", gdp: "gdp", claims: "claims", fomc: "effr" };
  var CAL_TABS = [["all", "전체"], ["core", "★★★ 핵심"], ["infl", "물가"], ["labor", "고용"], ["growth", "성장"], ["fed", "연준"]];
  var CAL_FILTER = {
    all: function () { return true; }, core: function (e) { return e.importance >= 3; },
    infl: function (e) { return /^(cpi|ppi|pce)$/.test(e.key); }, labor: function (e) { return /^(nfp|jolts|claims)$/.test(e.key); },
    growth: function (e) { return e.key === "gdp"; }, fed: function (e) { return e.key === "fomc"; }
  };
  var IDX = [["^GSPC", "S&P 500", "#6f9bff"], ["^IXIC", "나스닥", "#b48cff"], ["^KS11", "코스피", "#ff7a8c"], ["^KQ11", "코스닥", "#3ecf9a"],
    ["^VIX", "VIX", "#ff5ca8"], ["DX-Y.NYB", "달러인덱스", "#9aa5bd"], ["KRW=X", "원/달러", "#ff9f5a"]];
  var OVERLAYS = ["none", "y10", "y2", "s10y2y", "effr", "cpi", "core_cpi", "pce", "core_pce", "unrate", "nfp", "claims", "ahe", "umich", "vix", "dxy", "usdkrw"];
  var RANGES = [["3M", 92], ["6M", 183], ["1Y", 365], ["3Y", 1096], ["5Y", 1827], ["10Y", 3653]];
  var OV_COLOR = "#f0b429";
  var st = { kpiTab: "all", calTab: "all", idx: ["^GSPC", "^IXIC", "^KS11", "^KQ11"], mode: "pct", range: "1Y", overlay: "y10", events: true, spread: "10Y2Y" };
  try { var saved = JSON.parse(localStorage.getItem("mx-view-v1") || "null"); if (saved) Object.keys(st).forEach(function (k) { if (saved[k] != null) st[k] = saved[k]; }); } catch (e) {}
  function persist() { try { localStorage.setItem("mx-view-v1", JSON.stringify(st)); } catch (e) {} }

  /* ───────── 공통 ───────── */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toT(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    if (/^\d{4}-\d{2}$/.test(s)) return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, 15);
    var q = /^(\d{4})-Q(\d)$/.exec(s); if (q) return Date.UTC(+q[1], (+q[2] - 1) * 3 + 1, 15);
    return NaN;
  }
  function fmt(v, dg) { if (v == null || !isFinite(v)) return "–"; return (+v).toLocaleString("en-US", { minimumFractionDigits: dg, maximumFractionDigits: dg }); }
  function sign(v, dg) { return v == null ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), dg); }
  function cls(v) { return v == null || v === 0 ? "flat" : v > 0 ? "up" : "dn"; }
  function unitStr(u) { return u === "%" || u === "%p" ? "" : u; }
  function unitSuffix(u) { return !u ? "" : u === "%p" ? "%p" : u.charAt(0) === "%" ? "%" : u === "pt" ? "" : " " + u; }
  function valStr(ind, v) { return fmt(v, ind.digits == null ? 2 : ind.digits) + unitSuffix(ind.unit); }
  function evRefLabel(e) { return e.key === "fomc" && /^\d{4}-\d{2}$/.test(e.ref) ? (+e.ref.slice(5)) + "월 회의" : refLabel(e.ref); }
  function refLabel(ref) {
    if (!ref) return "";
    var q = /^(\d{4})-Q(\d)$/.exec(ref); if (q) return q[1] + "년 " + q[2] + "분기";
    var m = /^(\d{4})-(\d{2})$/.exec(ref); return m ? (+m[2]) + "월분" : ref;
  }
  function kstDate(ev) { var p = ev.kst.split(/[- :]/); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], +p[3] - 9, +p[4])); }
  function nowKstDay() { var n = new Date(Date.now() + 9 * 3600e3); return n.toISOString().slice(0, 10); }
  function dday(ev) {
    var a = Date.UTC(+ev.kst.slice(0, 4), +ev.kst.slice(5, 7) - 1, +ev.kst.slice(8, 10)), t = nowKstDay();
    var b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    return Math.round((a - b) / 864e5);
  }
  function wd(s) { return "일월화수목금토"[new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))).getUTCDay()]; }
  function niceStep(span, n) { var raw = span / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function stepDigits(step) { return step >= 1 ? 0 : step >= 0.1 ? 1 : 2; }
  function valueAt(ind, ref) { var i = ind.dates.indexOf(ref); return i < 0 ? null : { v: ind.values[i], prev: i > 0 ? ind.values[i - 1] : null }; }
  function nextEvent(key) {
    var now = Date.now();
    return (D.calendar || []).filter(function (e) { return e.key === key && kstDate(e).getTime() > now - 3600e3; })[0] || null;
  }
  function lastN(ind) { var n = { M: 36, W: 104, D: 260, Q: 20 }[ind.freq] || 36; return { d: ind.dates.slice(-n), v: ind.values.slice(-n) }; }
  function spark(vals, w, h, col) {
    var v = vals.filter(function (x) { return x != null; }); if (v.length < 2) return "";
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), r = hi - lo || 1, n = vals.length;
    var pts = [], i; for (i = 0; i < n; i++) if (vals[i] != null) pts.push((i / (n - 1) * w).toFixed(1) + "," + (h - 3 - (vals[i] - lo) / r * (h - 6)).toFixed(1));
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none"><polyline fill="none" stroke="' + col + '" stroke-width="1.6" points="' + pts.join(" ") + '"/></svg>';
  }

  /* ───────── 다음 발표 ───────── */
  var cdTimer = null;
  function renderNext() {
    var now = Date.now(), up = (D.calendar || []).filter(function (e) { return kstDate(e).getTime() > now; });
    var hero = up.filter(function (e) { return e.importance >= 3; })[0] || up[0];
    if (!hero) { $("#mx-next").innerHTML = ""; return; }
    var others = up.filter(function (e) { return e !== hero && e.importance >= 2 && e.key !== hero.key; });
    var seen = {}, minis = [];
    others.forEach(function (e) { if (!seen[e.key] && minis.length < 2) { seen[e.key] = 1; minis.push(e); } });
    var ind = D.indicators[IND_OF_EV[hero.key]];
    var prevTxt = ind && ind.latest ? "직전 " + esc(ind.label) + " <b>" + valStr(ind, ind.latest.value) + "</b> (" + esc(refLabel(ind.latest.date) || ind.latest.date) + ")" : "";
    $("#mx-next").innerHTML =
      '<div class="mx-hero"><div class="k">NEXT · 다음 핵심 발표</div><h3>' + esc(hero.title) + (hero.ref ? ' <span class="mx-sub">' + esc(refLabel(hero.ref)) + "</span>" : "") + "</h3>" +
      '<div class="when">' + hero.kst.slice(5, 10).replace("-", "/") + "(" + wd(hero.kst) + ") " + hero.kst.slice(11) + " KST · 미국 동부 " + hero.time_et + "</div>" +
      '<div class="cd" id="mx-cd"></div><div class="prev">' + prevTxt + "</div></div>" +
      minis.map(function (e) {
        var d = dday(e);
        return '<div class="mx-mini"><div class="k">' + (e.key === "fomc" ? "연준" : "예정") + "</div><b>" + esc(e.title) + "</b>" +
          '<div class="when">' + e.kst.slice(5, 10).replace("-", "/") + "(" + wd(e.kst) + ") " + e.kst.slice(11) + " · " + esc(evRefLabel(e)) + "</div>" +
          '<span class="dday">' + (d === 0 ? "오늘" : "D-" + d) + "</span></div>";
      }).join("");
    clearInterval(cdTimer);
    var tick = function () {
      var ms = kstDate(hero).getTime() - Date.now(), el = $("#mx-cd"); if (!el) return;
      if (ms <= 0) { el.innerHTML = "발표됨 <small>곧 반영됩니다</small>"; return; }
      var dd = Math.floor(ms / 864e5), hh = Math.floor(ms % 864e5 / 36e5), mm = Math.floor(ms % 36e5 / 6e4), ss = Math.floor(ms % 6e4 / 1e3);
      el.innerHTML = (dd > 0 ? dd + "일 " : "") + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0") + "<small>남음</small>";
    };
    tick(); cdTimer = setInterval(tick, 1000);
  }

  /* ───────── 핵심 지표 ───────── */
  function renderKpiTabs() {
    $("#mx-kpi-tabs").innerHTML = KPI_TABS.map(function (t) { return '<button data-k="' + t[0] + '" class="' + (t[0] === st.kpiTab ? "on" : "") + '">' + t[1] + "</button>"; }).join("");
    $$("#mx-kpi-tabs button").forEach(function (b) { b.onclick = function () { st.kpiTab = b.dataset.k; persist(); renderKpiTabs(); renderKpis(); }; });
  }
  function kpiChange(ind) {
    var l = ind.latest; if (!l) return "";
    if (ind.key === "nfp") return '<span class="flat">전월 ' + sign(l.prev, 0) + "천</span>";
    var dg = ind.digits == null ? 2 : ind.digits, suffix = ind.unit === "%" || ind.unit === "%p" ? "%p" : "";
    return '<span class="' + cls(l.chg) + '">' + (l.chg > 0 ? "▲ " : l.chg < 0 ? "▼ " : "") + sign(l.chg, dg) + suffix + "</span> <span class=\"flat\">직전 " + fmt(l.prev, dg) + "</span>";
  }
  function renderKpis() {
    var keys = KPI_ORDER.filter(function (k) {
      var ind = D.indicators[k]; if (!ind || !ind.latest) return false;
      if (st.kpiTab === "all") return true;
      if (st.kpiTab === "growth") return ind.group === "growth" || ind.group === "sentiment";
      return ind.group === st.kpiTab;
    });
    $("#mx-kpis").innerHTML = keys.map(function (k, i) {
      var ind = D.indicators[k], l = ind.latest, s = lastN(ind), ev = EV_OF[k] && nextEvent(EV_OF[k]);
      var dd = ev ? dday(ev) : null, col = l.chg > 0 ? "#ff7a8c" : l.chg < 0 ? "#76a4ff" : "#8b93a7";
      var dateTxt = ind.freq === "M" || ind.freq === "Q" ? refLabel(l.date) : l.date.slice(5).replace("-", "/");
      return '<div class="mx-kpi" data-k="' + k + '" style="--d:' + Math.min(i, 16) * 25 + 'ms">' +
        (ev && dd <= 14 ? '<span class="nx" title="다음 발표 ' + esc(ev.kst) + ' KST">' + (dd === 0 ? "오늘" : "D-" + dd) + "</span>" : "") +
        '<div class="lab"><span' + (ev && dd <= 14 ? ' class="nxpad"' : "") + ">" + esc(ind.label) + "</span></div>" +
        '<div class="lab"><i>' + esc(dateTxt) + " · " + esc(ind.source) + "</i></div>" +
        '<div class="val">' + fmt(l.value, ind.digits == null ? 2 : ind.digits) + "<small>" + (ind.unit === "%" ? "%" : ind.unit === "%p" ? "%p" : esc(ind.unit)) + "</small></div>" +
        '<div class="chg">' + kpiChange(ind) + "</div>" + spark(s.v, 200, 38, col) + "</div>";
    }).join("") || '<div class="spin">표시할 지표가 없습니다</div>';
    $$(".mx-kpi").forEach(function (c) { c.onclick = function () { openDetail(c.dataset.k); }; });
  }

  /* ───────── 캘린더 ───────── */
  function renderCalTabs() {
    $("#mx-cal-tabs").innerHTML = CAL_TABS.map(function (t) { return '<button data-k="' + t[0] + '" class="' + (t[0] === st.calTab ? "on" : "") + '">' + t[1] + "</button>"; }).join("");
    $$("#mx-cal-tabs button").forEach(function (b) { b.onclick = function () { st.calTab = b.dataset.k; persist(); renderCalTabs(); renderCal(); }; });
  }
  function evValue(e) {
    var ind = D.indicators[IND_OF_EV[e.key]]; if (!ind) return null;
    if (e.key === "claims" || e.key === "fomc") return { ind: ind, v: ind.latest && ind.latest.value, prev: ind.latest && ind.latest.prev, isLatest: true };
    var r = valueAt(ind, e.ref); return r ? { ind: ind, v: r.v, prev: r.prev } : { ind: ind, v: null };
  }
  function weekKey(s) {
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))), mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
    return (mon.getUTCMonth() + 1) + "/" + mon.getUTCDate() + " 주";
  }
  function evRow(e, past) {
    var d = dday(e), val = evValue(e), right = "";
    var imp = "★".repeat(e.importance) ;
    if (past) {
      if (val && val.v != null && !val.isLatest) right = '<b class="' + cls(val.prev == null ? null : val.v - val.prev) + '">' + valStr(val.ind, val.v) + "</b><small>이전 " + (val.prev == null ? "–" : valStr(val.ind, val.prev)) + "</small>";
      else right = '<small>' + (val && val.v != null ? "최신 " + valStr(val.ind, val.v) : "집계 대기") + "</small>";
    } else {
      right = '<span class="dd' + (d <= 2 ? " soon" : "") + '">' + (d === 0 ? "오늘" : "D-" + d) + "</span>";
      if (val && val.ind && val.ind.latest) right += "<small>직전 " + valStr(val.ind, val.ind.latest.value) + "</small>";
    }
    return '<div class="mx-ev' + (d === 0 ? " today" : "") + '" data-k="' + (IND_OF_EV[e.key] || "") + '">' +
      '<div class="dt">' + e.kst.slice(5, 10).replace("-", "/") + "<small>" + wd(e.kst) + " " + e.kst.slice(11) + "</small></div>" +
      '<div class="ti"><b>' + esc(e.title) + '</b><span class="imp">' + imp + "</span><small>" + esc(evRefLabel(e)) + (e.estimated ? " · 정례 일정(휴일 시 변경)" : "") + (e.sep ? " · 점도표 공개" : "") + "</small></div>" +
      '<div class="rt">' + right + "</div></div>";
  }
  function renderCal() {
    var f = CAL_FILTER[st.calTab], now = Date.now(), today = nowKstDay();
    var list = (D.calendar || []).filter(f);
    var up = list.filter(function (e) { return e.kst.slice(0, 10) >= today; }).slice(0, 40);
    /* 최근 발표 결과에서는 매주 반복되는 실업수당 청구를 빼서 굵직한 발표만 보이게 한다 */
    var past = list.filter(function (e) { return e.kst.slice(0, 10) < today && e.key !== "claims"; }).reverse().slice(0, 14);
    var html = "", wk = "";
    up.forEach(function (e) { var k = weekKey(e.kst); if (k !== wk) { html += '<div class="mx-wk">' + k + "</div>"; wk = k; } html += evRow(e, false); });
    $("#mx-cal").innerHTML =
      '<div class="mx-cal-col"><h4>다가오는 발표</h4>' + (html || '<div class="mx-wk">예정된 일정 없음</div>') + "</div>" +
      '<div class="mx-cal-col"><h4>최근 발표 결과</h4>' + (past.map(function (e) { return evRow(e, true); }).join("") || '<div class="mx-wk">최근 발표 없음</div>') + "</div>";
    $$(".mx-ev").forEach(function (r) { if (r.dataset.k && D.indicators[r.dataset.k]) { r.style.cursor = "pointer"; r.onclick = function () { openDetail(r.dataset.k); }; } });
    void now;
  }

  /* ───────── 차트 탐색기 ───────── */
  function renderExplorerControls() {
    $("#mx-idx").innerHTML = IDX.filter(function (x) { return D.markets[x[0]]; }).map(function (x) {
      return '<button data-t="' + x[0] + '" style="--c:' + x[2] + '" class="' + (st.idx.indexOf(x[0]) >= 0 ? "on" : "") + '"><i></i>' + x[1] + "</button>";
    }).join("");
    $$("#mx-idx button").forEach(function (b) {
      b.onclick = function () {
        var t = b.dataset.t, i = st.idx.indexOf(t);
        if (i >= 0) { if (st.idx.length > 1) st.idx.splice(i, 1); } else st.idx.push(t);
        persist(); renderExplorerControls(); renderExplorer();
      };
    });
    $("#mx-overlay").innerHTML = OVERLAYS.filter(function (k) { return k === "none" || D.indicators[k]; }).map(function (k) {
      return '<option value="' + k + '"' + (k === st.overlay ? " selected" : "") + ">" + (k === "none" ? "없음" : esc(D.indicators[k].label)) + "</option>";
    }).join("");
    $("#mx-overlay").onchange = function () { st.overlay = this.value; persist(); renderExplorer(); };
    $("#mx-mode").innerHTML = [["pct", "수익률 비교(%)"], ["price", "가격"]].map(function (m) { return '<button data-m="' + m[0] + '" class="' + (m[0] === st.mode ? "on" : "") + '">' + m[1] + "</button>"; }).join("");
    $$("#mx-mode button").forEach(function (b) { b.onclick = function () { st.mode = b.dataset.m; persist(); renderExplorerControls(); renderExplorer(); }; });
    $("#mx-range").innerHTML = RANGES.map(function (r) { return '<button data-r="' + r[0] + '" class="' + (r[0] === st.range ? "on" : "") + '">' + r[0] + "</button>"; }).join("");
    $$("#mx-range button").forEach(function (b) { b.onclick = function () { st.range = b.dataset.r; persist(); renderExplorerControls(); renderExplorer(); }; });
    $("#mx-events").checked = !!st.events;
    $("#mx-events").onchange = function () { st.events = this.checked; persist(); renderExplorer(); };
  }
  function idxMeta(t) { return IDX.filter(function (x) { return x[0] === t; })[0]; }

  function renderExplorer() {
    var box = $("#mx-chart"), W = Math.max(320, box.clientWidth || 900), small = W < 640;
    var H = small ? 380 : 470, L = small ? 40 : 54, R = small ? 40 : 58, T = 18, volH = small ? 50 : 70, gap = 10, B = 24;
    var mainH = H - T - B - volH - gap, iw = W - L - R;
    var days = RANGES.filter(function (r) { return r[0] === st.range; })[0][1];
    var sel = st.idx.filter(function (t) { return D.markets[t]; }); if (!sel.length) return;
    if (st.mode === "price") sel = sel.slice(0, 1);
    var primary = D.markets[sel[0]];
    var endT = toT(primary.d[primary.d.length - 1]), startT = endT - days * 864e5;
    /* 지수 시리즈 */
    var series = sel.map(function (t) {
      var m = D.markets[t], pts = [];
      for (var i = 0; i < m.d.length; i++) { var tt = toT(m.d[i]); if (tt >= startT) pts.push([tt, m.c[i], m.v[i], m.d[i]]); }
      var base = pts.length ? pts[0][1] : 1;
      pts.forEach(function (p) { p.push(st.mode === "pct" ? (p[1] / base - 1) * 100 : p[1]); });
      return { t: t, meta: idxMeta(t), pts: pts };
    }).filter(function (s) { return s.pts.length > 1; });
    if (!series.length) { box.innerHTML = ""; return; }
    /* 오버레이 */
    var ov = st.overlay !== "none" && D.indicators[st.overlay], ovPts = [];
    if (ov) {
      var before = null;
      for (var j = 0; j < ov.dates.length; j++) {
        var ot = toT(ov.dates[j]); if (ov.values[j] == null) continue;
        if (ot < startT) before = [startT, ov.values[j], ov.dates[j]]; else if (ot <= endT + 45 * 864e5) ovPts.push([Math.min(ot, endT), ov.values[j], ov.dates[j]]);
      }
      if (before) ovPts.unshift(before);
    }
    var X = function (t) { return L + (t - startT) / (endT - startT) * iw; };
    var ys = []; series.forEach(function (s) { s.pts.forEach(function (p) { ys.push(p[4]); }); });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * mainH; };
    var svg = "", step = niceStep(hi - lo, small ? 4 : 5), dg = stepDigits(step);
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) {
      svg += '<line class="gl" x1="' + L + '" x2="' + (L + iw) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"/>' +
        '<text class="ax" x="' + (L - 6) + '" y="' + (Y(g) + 3.5).toFixed(1) + '" text-anchor="end">' + (st.mode === "pct" ? (g > 0 ? "+" : "") + fmt(g, dg) + "%" : fmt(g, dg)) + "</text>";
    }
    if (st.mode === "pct" && lo < 0 && hi > 0) svg += '<line x1="' + L + '" x2="' + (L + iw) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#5b6479" stroke-dasharray="3 3"/>';
    /* 오른쪽 축 + 오버레이 */
    var ovY = null;
    if (ov && ovPts.length > 1) {
      var ov_v = ovPts.map(function (p) { return p[1]; }), olo = Math.min.apply(null, ov_v), ohi = Math.max.apply(null, ov_v), op = (ohi - olo) * 0.1 || Math.abs(ohi) * 0.05 || 1;
      olo -= op; ohi += op;
      ovY = function (v) { return T + (1 - (v - olo) / (ohi - olo)) * mainH; };
      var os = niceStep(ohi - olo, small ? 4 : 5), od = stepDigits(os);
      for (var k = Math.ceil(olo / os) * os; k <= ohi; k += os) svg += '<text class="ax" x="' + (L + iw + 6) + '" y="' + (ovY(k) + 3.5).toFixed(1) + '" style="fill:' + OV_COLOR + ';opacity:.8">' + fmt(k, od) + "</text>";
      var stepLine = ov.freq !== "D", path = "";
      ovPts.forEach(function (p, i) {
        var x = X(p[0]).toFixed(1), y = ovY(p[1]).toFixed(1);
        if (!i) path += "M" + x + "," + y; else if (stepLine) path += "H" + x + "V" + y; else path += "L" + x + "," + y;
      });
      if (stepLine) path += "H" + (L + iw).toFixed(1);
      svg += '<path d="' + path + '" fill="none" stroke="' + OV_COLOR + '" stroke-width="1.8" stroke-dasharray="' + (stepLine ? "0" : "5 3") + '" opacity=".9"/>';
    }
    /* 발표일 표시 */
    if (st.events) {
      (D.calendar || []).filter(function (e) { return /^(cpi|fomc|nfp)$/.test(e.key); }).forEach(function (e) {
        var et = toT(e.date); if (et < startT || et > endT) return;
        var x = X(et).toFixed(1), c = e.key === "fomc" ? "#f0b429" : e.key === "cpi" ? "#ff7a8c" : "#3ecf9a";
        svg += '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (T + mainH) + '" stroke="' + c + '" stroke-dasharray="2 3" opacity=".55"/>' +
          '<text x="' + x + '" y="' + (T - 5) + '" text-anchor="middle" style="font:700 9.5px var(--mono);fill:' + c + '">' + (e.key === "fomc" ? "FOMC" : e.key === "cpi" ? "CPI" : "고용") + "</text>";
      });
    }
    /* 지수 라인 */
    series.forEach(function (s) {
      var d = s.pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[4]).toFixed(1); }).join("");
      svg += '<path d="' + d + '" fill="none" stroke="' + s.meta[2] + '" stroke-width="' + (series.length > 2 ? 1.5 : 1.9) + '"/>';
    });
    /* 거래량 (첫 번째 지수) */
    var vTop = T + mainH + gap, ps = series[0], vmax = Math.max.apply(null, ps.pts.map(function (p) { return p[2] || 0; }));
    if (vmax > 0) {
      var bw = Math.max(0.8, iw / ps.pts.length * 0.75);
      ps.pts.forEach(function (p, i) {
        var h = (p[2] || 0) / vmax * volH, upd = i === 0 || p[1] >= ps.pts[i - 1][1];
        svg += '<rect x="' + (X(p[0]) - bw / 2).toFixed(1) + '" y="' + (vTop + volH - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (upd ? "rgba(240,71,90,.5)" : "rgba(61,126,255,.5)") + '"/>';
      });
      svg += '<text class="ax" x="' + (L + 4) + '" y="' + (vTop + 10) + '">' + esc(ps.meta[1]) + " 거래량</text>";
    }
    /* x축 */
    var yrs = days > 800, prevLab = "";
    ps.pts.forEach(function (p) {
      var lab = yrs ? p[3].slice(0, 4) : p[3].slice(0, 7);
      if (lab !== prevLab) {
        if (prevLab) svg += '<text class="ax" x="' + X(p[0]).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + (yrs ? lab : (p[3].slice(5, 7) === "01" ? p[3].slice(0, 4) : (+p[3].slice(5, 7)) + "월")) + "</text>";
        prevLab = lab;
      }
    });
    svg += '<line id="mx-x" x1="0" x2="0" y1="' + T + '" y2="' + (vTop + volH) + '" stroke="#cbd5ea" opacity="0"/>' +
      '<rect id="mx-hit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + (mainH + gap + volH) + '" fill="transparent"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + svg + '</svg><div class="mx-tip" id="mx-tip"></div>';
    /* 범례 */
    $("#mx-legend").innerHTML = series.map(function (s) {
      var last = s.pts[s.pts.length - 1];
      return '<span style="--c:' + s.meta[2] + '"><i></i>' + esc(s.meta[1]) + ' <b class="' + (st.mode === "pct" ? cls(last[4]) : "") + '">' + (st.mode === "pct" ? sign(last[4], 2) + "%" : fmt(last[1], 2)) + "</b></span>";
    }).join("") + (ov ? '<span style="--c:' + OV_COLOR + '"><i></i>' + esc(ov.label) + " (오른쪽 축) <b>" + valStr(ov, ov.latest && ov.latest.value) + "</b></span>" : "") +
      (st.mode === "price" && st.idx.length > 1 ? '<span class="mx-sub">가격 모드는 첫 번째 지수만 표시</span>' : "");
    /* 크로스헤어 */
    var hit = $("#mx-hit"), cross = $("#mx-x"), tip = $("#mx-tip");
    hit.addEventListener("mousemove", function (ev) {
      var r = box.querySelector("svg").getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width * W;
      var t = startT + (fx - L) / iw * (endT - startT), a = ps.pts, lo2 = 0, hi2 = a.length - 1;
      while (hi2 - lo2 > 1) { var mid = (lo2 + hi2) >> 1; if (a[mid][0] < t) lo2 = mid; else hi2 = mid; }
      var p = Math.abs(a[lo2][0] - t) < Math.abs(a[hi2][0] - t) ? a[lo2] : a[hi2], x = X(p[0]);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("opacity", ".5");
      var rows = series.map(function (s) {
        var q = null; for (var i = s.pts.length - 1; i >= 0; i--) if (s.pts[i][0] <= p[0]) { q = s.pts[i]; break; }
        if (!q) return "";
        return '<div class="r"><span style="--c:' + s.meta[2] + '"><i></i>' + esc(s.meta[1]) + "</span><span>" + (st.mode === "pct" ? '<b class="' + cls(q[4]) + '">' + sign(q[4], 2) + "%</b> " : "") + fmt(q[1], 2) + "</span></div>";
      }).join("");
      if (ov) {
        var oq = null; for (var i2 = ovPts.length - 1; i2 >= 0; i2--) if (ovPts[i2][0] <= p[0]) { oq = ovPts[i2]; break; }
        if (oq) rows += '<div class="r"><span style="--c:' + OV_COLOR + '"><i></i>' + esc(ov.label) + "</span><span>" + valStr(ov, oq[1]) + " <small>(" + esc(oq[2]) + ")</small></span></div>";
      }
      if (p[2]) rows += '<div class="r"><span>거래량</span><span>' + (p[2] >= 1e9 ? fmt(p[2] / 1e9, 2) + "B" : fmt(p[2] / 1e6, 1) + "M") + "</span></div>";
      tip.innerHTML = "<b>" + p[3] + " (" + wd(p[3]) + ")</b>" + rows;
      var px = (ev.clientX - r.left), py = (ev.clientY - r.top);
      tip.style.left = (px + 220 > r.width ? px - 215 : px + 14) + "px"; tip.style.top = Math.max(4, py - 60) + "px";
      tip.classList.add("show");
    });
    hit.addEventListener("mouseleave", function () { cross.setAttribute("opacity", "0"); tip.classList.remove("show"); });
  }

  /* ───────── 금리 ───────── */
  function renderRates() {
    var y = D.yields; if (!y || !y.curve) return;
    $("#mx-rates-sub").textContent = "기준 " + y.curve.now.date + " · 미 재무부";
    var TEN = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
    var box = $("#mx-curve"), W = Math.max(300, box.clientWidth || 480), H = 240, L = 36, R = 12, T = 12, B = 24, iw = W - L - R, ih = H - T - B;
    var sets = [["now", "지금", "#6f9bff", ""], ["m1", "1개월 전", "#9aa5bd", "4 3"], ["y1", "1년 전", "#5b6479", "2 3"]].filter(function (s) { return y.curve[s[0]]; });
    var all = []; sets.forEach(function (s) { TEN.forEach(function (t) { var v = y.curve[s[0]].curve[t]; if (v != null) all.push(v); }); });
    var lo = Math.min.apply(null, all) - 0.15, hi = Math.max.apply(null, all) + 0.15;
    var X = function (i) { return L + i / (TEN.length - 1) * iw; }, Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * ih; };
    var svg = "", step = niceStep(hi - lo, 4);
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) svg += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g) + '" y2="' + Y(g) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(g) + 3.5) + '" text-anchor="end">' + fmt(g, stepDigits(step)) + "</text>";
    TEN.forEach(function (t, i) { svg += '<text class="ax" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + t + "</text>"; });
    sets.slice().reverse().forEach(function (s) {
      var d = "", c = y.curve[s[0]].curve;
      TEN.forEach(function (t, i) { if (c[t] != null) d += (d ? "L" : "M") + X(i).toFixed(1) + "," + Y(c[t]).toFixed(1); });
      svg += '<path d="' + d + '" fill="none" stroke="' + s[2] + '" stroke-width="' + (s[0] === "now" ? 2.2 : 1.5) + '" stroke-dasharray="' + s[3] + '"/>';
      if (s[0] === "now") TEN.forEach(function (t, i) { if (c[t] != null) svg += '<circle cx="' + X(i) + '" cy="' + Y(c[t]) + '" r="2.6" fill="' + s[2] + '"><title>' + t + " " + c[t] + "%</title></circle>"; });
    });
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + svg + "</svg>" +
      '<div class="mx-legend">' + sets.map(function (s) { return '<span style="--c:' + s[2] + '"><i></i>' + s[1] + " <small class=\"mx-sub\">" + y.curve[s[0]].date + "</small></span>"; }).join("") + "</div>";
    /* 금리차 */
    $("#mx-spread-t").innerHTML = [["10Y2Y", "10Y−2Y"], ["10Y3M", "10Y−3M"]].map(function (s) { return '<button data-s="' + s[0] + '" class="' + (s[0] === st.spread ? "on" : "") + '">' + s[1] + "</button>"; }).join("");
    $$("#mx-spread-t button").forEach(function (b) { b.onclick = function () { st.spread = b.dataset.s; persist(); renderRates(); }; });
    var sb = $("#mx-spread"), SW = Math.max(300, sb.clientWidth || 480), SH = 240, sL = 36, sR = 12, sT = 12, sB = 24, siw = SW - sL - sR, sih = SH - sT - sB;
    var endT = toT(y.dates[y.dates.length - 1]), startT = endT - 3653 * 864e5, pts = [];
    y.dates.forEach(function (d, i) { var t = toT(d), v = y[st.spread][i]; if (t >= startT && v != null) pts.push([t, v, d]); });
    if (pts.length < 2) { sb.innerHTML = ""; return; }
    var vs = pts.map(function (p) { return p[1]; }), slo = Math.min(Math.min.apply(null, vs), 0) - 0.2, shi = Math.max(Math.max.apply(null, vs), 0) + 0.2;
    var SX = function (t) { return sL + (t - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0]) * siw; }, SY = function (v) { return sT + (1 - (v - slo) / (shi - slo)) * sih; };
    var s2 = "", st2 = niceStep(shi - slo, 4);
    for (var g2 = Math.ceil(slo / st2) * st2; g2 <= shi; g2 += st2) s2 += '<line class="gl" x1="' + sL + '" x2="' + (SW - sR) + '" y1="' + SY(g2) + '" y2="' + SY(g2) + '"/><text class="ax" x="' + (sL - 5) + '" y="' + (SY(g2) + 3.5) + '" text-anchor="end">' + fmt(g2, stepDigits(st2)) + "</text>";
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + SX(p[0]).toFixed(1) + "," + SY(p[1]).toFixed(1); }).join("");
    var zero = SY(0).toFixed(1);
    s2 += '<defs><clipPath id="mx-neg"><rect x="' + sL + '" y="' + zero + '" width="' + siw + '" height="' + (SH - zero) + '"/></clipPath><clipPath id="mx-pos"><rect x="' + sL + '" y="0" width="' + siw + '" height="' + zero + '"/></clipPath></defs>' +
      '<path d="' + line + "L" + SX(pts[pts.length - 1][0]).toFixed(1) + "," + zero + "L" + SX(pts[0][0]).toFixed(1) + "," + zero + 'Z" fill="rgba(240,71,90,.35)" clip-path="url(#mx-neg)"/>' +
      '<path d="' + line + "L" + SX(pts[pts.length - 1][0]).toFixed(1) + "," + zero + "L" + SX(pts[0][0]).toFixed(1) + "," + zero + 'Z" fill="rgba(111,155,255,.18)" clip-path="url(#mx-pos)"/>' +
      '<line x1="' + sL + '" x2="' + (SW - sR) + '" y1="' + zero + '" y2="' + zero + '" stroke="#8b93a7" stroke-dasharray="3 3"/>' +
      '<path d="' + line + '" fill="none" stroke="#6f9bff" stroke-width="1.5"/>';
    var yr = "";
    pts.forEach(function (p) { var yy = p[2].slice(0, 4); if (yy !== yr) { if (yr) s2 += '<text class="ax" x="' + SX(p[0]).toFixed(1) + '" y="' + (SH - 6) + '" text-anchor="middle">' + yy + "</text>"; yr = yy; } });
    var lastS = pts[pts.length - 1][1];
    sb.innerHTML = '<svg viewBox="0 0 ' + SW + " " + SH + '" width="' + SW + '" height="' + SH + '">' + s2 + "</svg>" +
      '<div class="mx-legend"><span>현재 <b class="' + (lastS < 0 ? "up" : "") + '">' + sign(lastS, 2) + "%p</b></span><span class=\"mx-sub\">빨간 영역 = 장단기 역전 (과거 경기침체 선행 신호)</span></div>";
  }

  /* ───────── 상세 모달 ───────── */
  function openDetail(k) {
    var ind = D.indicators[k]; if (!ind) return;
    var ev = EV_OF[k] && nextEvent(EV_OF[k]), n = ind.dates.length;
    var rows = [];
    for (var i = n - 1; i >= Math.max(0, n - 12); i--) rows.push("<tr><td>" + esc(ind.freq === "D" ? ind.dates[i] : refLabel(ind.dates[i]) || ind.dates[i]) + "</td><td>" + valStr(ind, ind.values[i]) + '</td><td class="' + cls(i ? ind.values[i] - ind.values[i - 1] : null) + '">' + (i ? sign(ind.values[i] - ind.values[i - 1], ind.digits == null ? 2 : ind.digits) : "–") + "</td></tr>");
    var W = Math.min(940, window.innerWidth - 70), H = 260, L = 42, R = 12, T = 10, B = 22, iw = W - L - R, ih = H - T - B;
    var pts = ind.dates.map(function (d, i) { return [toT(d), ind.values[i], d]; }).filter(function (p) { return p[1] != null && isFinite(p[0]); });
    var vs = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var X = function (t) { return L + (t - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0]) * iw; }, Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * ih; };
    var svg = "", step = niceStep(hi - lo, 4);
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) svg += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g) + '" y2="' + Y(g) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(g) + 3.5) + '" text-anchor="end">' + fmt(g, stepDigits(step)) + "</text>";
    if (lo < 0 && hi > 0) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#5b6479" stroke-dasharray="3 3"/>';
    var path = pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join("");
    svg += '<path d="' + path + "L" + X(pts[pts.length - 1][0]).toFixed(1) + "," + (T + ih) + "L" + X(pts[0][0]).toFixed(1) + "," + (T + ih) + 'Z" fill="rgba(111,155,255,.12)"/><path d="' + path + '" fill="none" stroke="#6f9bff" stroke-width="1.8"/>';
    var yr = ""; pts.forEach(function (p) { var yy = p[2].slice(0, 4); if (yy !== yr) { if (yr) svg += '<text class="ax" x="' + X(p[0]).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle">' + yy + "</text>"; yr = yy; } });
    $("#mx-modal-body").innerHTML =
      '<div class="mx-m-top"><div><div class="kicker">' + esc(ind.source) + "</div><h3>" + esc(ind.label) + "</h3><p>" + esc(ind.note || "") + (ev ? " · 다음 발표 <b>" + ev.kst.slice(5).replace("-", "/") + " KST</b> (" + (dday(ev) === 0 ? "오늘" : "D-" + dday(ev)) + ")" : "") + "</p></div>" +
      '<div class="mx-m-val">' + valStr(ind, ind.latest.value) + '<div class="chg" style="font-size:13px">' + kpiChange(ind) + "</div></div></div>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" style="margin-top:12px;display:block">' + svg + "</svg>" +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap"><b>최근 관측값</b><button class="toggle" id="mx-to-ov" style="padding:6px 12px;cursor:pointer;color:var(--text)">차트 탐색기에 겹쳐보기 →</button></div>' +
      '<table class="mx-m-tbl"><thead><tr><th>기간</th><th>값</th><th>변화</th></tr></thead><tbody>' + rows.join("") + "</tbody></table>";
    $("#mx-modal").hidden = false;
    $("#mx-to-ov").onclick = function () {
      st.overlay = OVERLAYS.indexOf(k) >= 0 ? k : st.overlay; persist(); closeModal(); renderExplorerControls(); renderExplorer();
      document.querySelector(".mx-explorer").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
  function closeModal() { $("#mx-modal").hidden = true; }

  /* ───────── 시작 ───────── */
  function renderAll() { renderNext(); renderKpiTabs(); renderKpis(); renderCalTabs(); renderCal(); renderExplorerControls(); renderExplorer(); renderRates(); }
  $("#mx-close").onclick = closeModal;
  $("#mx-modal").addEventListener("click", function (e) { if (e.target.id === "mx-modal") closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  var rs = null; window.addEventListener("resize", function () { clearTimeout(rs); rs = setTimeout(function () { if (D) { renderExplorer(); renderRates(); } }, 180); });

  fetch("macro_dash.json?t=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    D = d;
    $("#mx-updated").textContent = "갱신 " + (d.updated || "-");
    var st2 = d.status || {}, names = { bls: "BLS", bea: "BEA", effr: "뉴욕연준", claims: "노동부", umich: "미시간대", treasury: "재무부", calendar_bls: "BLS 일정", calendar_fomc: "FOMC 일정", calendar_bea: "BEA 일정" };
    $("#mx-foot").innerHTML = "출처 상태: " + Object.keys(names).filter(function (k) { return st2[k]; }).map(function (k) {
      var ok = st2[k] === "ok" || st2[k] === "seed" || st2[k] === "bls.gov";
      return '<span class="' + (ok ? "" : "up") + '">' + names[k] + (st2[k] === "seed" ? "(공식 일정표)" : ok ? " ✓" : " ✗") + "</span>";
    }).join(" · ") + "<br>실업수당 청구는 비계절조정 주별 합계의 4주 평균입니다. CPI·PPI·PCE·시급은 전년 동월 대비(%)입니다. 발표일 표시는 캘린더에 있는 최근·예정 일정만 그립니다.";
    renderAll();
  }).catch(function (e) {
    $("#mx-kpis").innerHTML = '<div class="spin">macro_dash.json을 불러오지 못했습니다 (' + esc(e.message) + ") — fetch_macro_dash.py 실행 필요</div>";
  });
})();
