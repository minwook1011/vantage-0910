/* 매크로 터미널 — docs/macro_dash.json (fetch_macro_dash.py가 발표 직후 자동 갱신) */
(function () {
  "use strict";
  var D = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ───────── 설정 ───────── */
  var CAT = { inflation: ["물가", "#ff6b81"], labor: ["고용", "#34d399"], growth: ["성장·심리", "#60a5fa"], rates: ["금리·연준", "#fbbf24"], markets: ["시장", "#a78bfa"] };
  var EVCAT = { cpi: "inflation", ppi: "inflation", pce: "inflation", nfp: "labor", jolts: "labor", claims: "labor", gdp: "growth", fomc: "rates" };
  var SHORT = { cpi: "CPI", ppi: "PPI", pce: "PCE", nfp: "고용보고서", jolts: "JOLTS", gdp: "GDP", fomc: "FOMC", claims: "실업청구" };
  var IND_OF_EV = { cpi: "cpi", ppi: "ppi", pce: "pce", nfp: "nfp", jolts: "jolts", gdp: "gdp", claims: "claims", fomc: "effr" };
  var EV_OF = { cpi: "cpi", core_cpi: "cpi", ppi: "ppi", core_ppi: "ppi", pce: "pce", core_pce: "pce", nfp: "nfp", unrate: "nfp", ahe: "nfp",
    lfpr: "nfp", jolts: "jolts", gdp: "gdp", claims: "claims", effr: "fomc", y2: "fomc", y3m: "fomc" };
  var BOARDS = [["inflation", ["cpi", "core_cpi", "pce", "core_pce", "ppi", "core_ppi"]], ["labor", ["nfp", "unrate", "claims", "ahe", "jolts", "lfpr"]],
    ["rates", ["effr", "y3m", "y2", "y10", "y30", "s10y2y", "s10y3m"]], ["growth", ["gdp", "umich"]], ["markets", ["vix", "dxy", "usdkrw"]]];
  var IDX = [["^GSPC", "S&P 500", "#6f9bff"], ["^IXIC", "나스닥", "#b48cff"], ["^KS11", "코스피", "#ff7a8c"], ["^KQ11", "코스닥", "#3ecf9a"],
    ["^VIX", "VIX", "#ff5ca8"], ["DX-Y.NYB", "달러인덱스", "#9aa5bd"], ["KRW=X", "원/달러", "#ff9f5a"]];
  var OVERLAYS = ["none", "y10", "y2", "s10y2y", "effr", "cpi", "core_cpi", "pce", "core_pce", "unrate", "nfp", "claims", "ahe", "umich", "vix", "dxy", "usdkrw"];
  var RANGES = [["3M", 92], ["6M", 183], ["1Y", 365], ["3Y", 1096], ["5Y", 1827], ["10Y", 3653]];
  var OV_COLOR = "#f0b429";
  var st = { idx: ["^GSPC", "^IXIC", "^KS11", "^KQ11"], mode: "pct", range: "1Y", overlay: "y10", events: true, spread: "10Y2Y" };
  try { var saved = JSON.parse(localStorage.getItem("mx-view-v2") || "null"); if (saved) Object.keys(st).forEach(function (k) { if (saved[k] != null) st[k] = saved[k]; }); } catch (e) {}
  function persist() { try { localStorage.setItem("mx-view-v2", JSON.stringify(st)); } catch (e) {} }
  var cal = { month: null, sel: null };
  var openRow = null, accRange = {};

  /* ───────── 공통 ───────── */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toT(s) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    if (/^\d{4}-\d{2}$/.test(s)) return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, 15);
    var q = /^(\d{4})-Q(\d)$/.exec(s); if (q) return Date.UTC(+q[1], (+q[2] - 1) * 3 + 1, 15);
    return NaN;
  }
  function fmt(v, dg) { if (v == null || !isFinite(v)) return "–"; return (+v).toLocaleString("en-US", { minimumFractionDigits: dg, maximumFractionDigits: dg }); }
  function sign(v, dg) { return v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), dg); }
  function cls(v) { return v == null || v === 0 || !isFinite(v) ? "flat" : v > 0 ? "up" : "dn"; }
  function dgOf(ind) { return ind.digits == null ? 2 : ind.digits; }
  function unitSuffix(u) { return !u ? "" : u === "%p" ? "%p" : u.charAt(0) === "%" ? "%" : u === "pt" ? "" : " " + u; }
  function valStr(ind, v) { return fmt(v, dgOf(ind)) + unitSuffix(ind.unit); }
  function unitSmall(ind) { var u = ind.unit || ""; return u === "%" ? "%" : u === "%p" ? "%p" : u.charAt(0) === "%" ? "%" : u === "pt" ? "" : u; }
  function refLabel(ref) {
    if (!ref) return "";
    var q = /^(\d{4})-Q(\d)$/.exec(ref); if (q) return q[1] + "년 " + q[2] + "분기";
    var m = /^(\d{4})-(\d{2})$/.exec(ref); return m ? (+m[2]) + "월분" : ref;
  }
  function evRef(e) { return e.key === "fomc" && /^\d{4}-\d{2}$/.test(e.ref) ? (+e.ref.slice(5)) + "월 회의" : refLabel(e.ref); }
  function kstDate(ev) { var p = ev.kst.split(/[- :]/); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], +p[3] - 9, +p[4])); }
  function todayKst() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((toT(a) - toT(b)) / 864e5); }
  function dday(ev) { return dayDiff(ev.kst.slice(0, 10), todayKst()); }
  function wd(s) { return "일월화수목금토"[new Date(toT(s.slice(0, 10))).getUTCDay()]; }
  function md(s) { return (+s.slice(5, 7)) + "/" + (+s.slice(8, 10)); }
  function niceStep(span, n) { var raw = span / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function stepDg(step) { return step >= 1 ? 0 : step >= 0.1 ? 1 : 2; }
  function ind(k) { return D.indicators[k]; }
  function valueAt(i, ref) { var j = i.dates.indexOf(ref); return j < 0 ? null : { v: i.values[j], prev: j > 0 ? i.values[j - 1] : null }; }
  function nextEvent(key) { var now = Date.now(); return (D.calendar || []).filter(function (e) { return e.key === key && kstDate(e).getTime() > now - 3600e3; })[0] || null; }
  function nBack(i, n) { var v = i.values.filter(function (x) { return x != null; }); return v.length > n ? v[v.length - 1 - n] : null; }
  function tailPts(i, n) { return i.values.slice(-n); }
  function spark(vals, w, h, col, delay) {
    var v = vals.filter(function (x) { return x != null; }); if (v.length < 2) return "";
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v), r = hi - lo || 1, n = vals.length, pts = [];
    for (var i = 0; i < n; i++) if (vals[i] != null) pts.push((i / (n - 1) * w).toFixed(1) + "," + (h - 3 - (vals[i] - lo) / r * (h - 6)).toFixed(1));
    return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="--d:' + (delay || 0) + 'ms"><polyline fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round" points="' + pts.join(" ") + '"/></svg>';
  }
  function countUp(el, to, dg, suffix) {
    var t0 = performance.now(), dur = 900;
    setTimeout(function () { el.textContent = fmt(to, dg) + (suffix || ""); }, dur + 80);
    if (document.hidden) { el.textContent = fmt(to, dg) + (suffix || ""); return; }
    (function f(t) { var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e, dg) + (suffix || ""); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  /* ───────── 1. 국면 리본 ───────── */
  function regime() {
    var out = [], c = ind("cpi"), cp = ind("core_pce"), u = ind("unrate"), nf = ind("nfp"), g = ind("gdp"), um = ind("umich"), y = ind("y10"), ef = ind("effr"), sp = ind("s10y2y"), vx = ind("vix"), dx = ind("dxy"), kr = ind("usdkrw");
    if (c && c.latest) {
      var d3 = c.latest.value - nBack(c, 3);
      out.push({ cat: "inflation", t: "인플레이션", st: d3 > 0.2 ? "재가속" : d3 < -0.2 ? "둔화" : "정체", v: c.latest.value, dg: 2, unit: "%", lab: "CPI YoY", k: "cpi",
        s: "3개월 " + sign(d3, 2) + "%p" + (cp && cp.latest ? " · Core PCE <b>" + fmt(cp.latest.value, 2) + "%</b>" : "") });
    }
    if (u && u.latest) {
      var du = u.latest.value - nBack(u, 3), avg3 = nf ? nf.values.slice(-3).reduce(function (a, b) { return a + (b || 0); }, 0) / 3 : null;
      out.push({ cat: "labor", t: "고용", st: du >= 0.2 ? "냉각" : du <= -0.2 ? "타이트" : "안정", v: u.latest.value, dg: 1, unit: "%", lab: "실업률", k: "unrate",
        s: "비농업 <b>" + sign(nf && nf.latest.value, 0) + "천</b> · 3개월 평균 " + sign(avg3, 0) + "천" });
    }
    if (g && g.latest) {
      var gv = g.latest.value;
      out.push({ cat: "growth", t: "성장", st: gv >= 2.5 ? "확장" : gv >= 1 ? "완만" : gv >= 0 ? "정체" : "위축", v: gv, dg: 1, unit: "%", lab: "실질 GDP (연율)", k: "gdp",
        s: refLabel(g.latest.date) + (um && um.latest ? " · 미시간 심리 <b>" + fmt(um.latest.value, 1) + "</b>" : "") });
    }
    if (y && y.latest) {
      var dy = y.latest.value - nBack(y, 21);
      out.push({ cat: "rates", t: "금리", st: dy > 0.15 ? "상승 압력" : dy < -0.15 ? "하락" : "보합", v: y.latest.value, dg: 2, unit: "%", lab: "미 10년물", k: "y10",
        s: "1개월 " + sign(dy * 100, 0) + "bp" + (ef && ef.latest ? " · 기준금리 <b>" + fmt(ef.latest.value, 2) + "%</b>" : "") + (sp && sp.latest ? " · 10−2 " + sign(sp.latest.value, 2) : "") });
    }
    if (vx && vx.latest) {
      var vv = vx.latest.value;
      out.push({ cat: "markets", t: "위험선호", st: vv < 15 ? "낙관" : vv < 20 ? "중립" : vv < 30 ? "경계" : "공포", v: vv, dg: 1, unit: "", lab: "VIX", k: "vix",
        s: (dx && dx.latest ? "달러 <b>" + fmt(dx.latest.value, 1) + "</b>" : "") + (kr && kr.latest ? " · 원/달러 <b>" + fmt(kr.latest.value, 0) + "</b>" : "") });
    }
    $("#mx-regime").innerHTML = out.map(function (r, i) {
      return '<div class="mx-reg" data-k="' + r.k + '" style="--c:' + CAT[r.cat][1] + '"><div class="t"><span>' + r.t + '</span><span class="st">' + r.st + "</span></div>" +
        '<div class="v"><span data-v="' + r.v + '" data-dg="' + r.dg + '" data-u="' + r.unit + '">0</span><small>' + r.lab + '</small></div><div class="s">' + r.s + "</div></div>";
    }).join("");
    $$("#mx-regime [data-v]").forEach(function (el) { countUp(el, +el.dataset.v, +el.dataset.dg, el.dataset.u); });
    $$("#mx-regime .mx-reg").forEach(function (el) { el.onclick = function () { focusRow(el.dataset.k); }; });
  }

  /* ───────── 2. 달력 ───────── */
  function eventsByDay() {
    var m = {}; (D.calendar || []).forEach(function (e) { var d = e.kst.slice(0, 10); (m[d] = m[d] || []).push(e); });
    Object.keys(m).forEach(function (d) { m[d].sort(function (a, b) { return b.importance - a.importance || (a.kst < b.kst ? -1 : 1); }); });
    return m;
  }
  function monthBounds() { var ds = (D.calendar || []).map(function (e) { return e.kst.slice(0, 7); }).sort(); return [ds[0], ds[ds.length - 1]]; }
  function shiftMonth(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + "-" + (m < 9 ? "0" : "") + (m + 1); }
  function renderCalendar() {
    var byDay = eventsByDay(), today = todayKst(), ym = cal.month, y = +ym.slice(0, 4), mo = +ym.slice(5, 7);
    var first = new Date(Date.UTC(y, mo - 1, 1)), off = (first.getUTCDay() + 6) % 7, start = Date.UTC(y, mo - 1, 1) - off * 864e5;
    var bounds = monthBounds();
    $("#mx-month-title").textContent = y + "년 " + mo + "월";
    $("#mx-prev").disabled = ym <= bounds[0]; $("#mx-next-m").disabled = ym >= bounds[1];
    var cells = "", weeks = 6;
    var lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); if (off + lastDay <= 35) weeks = 5;
    for (var i = 0; i < weeks * 7; i++) {
      var d = new Date(start + i * 864e5).toISOString().slice(0, 10), inM = d.slice(0, 7) === ym, evs = byDay[d] || [], dow = i % 7;
      var pills = "", major = evs.filter(function (e) { return e.key !== "claims"; }), minor = evs.filter(function (e) { return e.key === "claims"; });
      major.slice(0, 3).forEach(function (e) {
        var past = d < today, hot = !past && e.importance >= 3 && dayDiff(d, today) <= 3;
        pills += '<span class="mx-pill' + (past ? " done" : "") + (hot ? " hot" : "") + '" style="--c:' + CAT[EVCAT[e.key]][1] + '" title="' + esc(e.title + " " + e.kst.slice(11) + " KST") + '"><i></i>' + esc(SHORT[e.key] || e.title) + (e.importance >= 3 ? "" : "") + "</span>";
      });
      if (major.length > 3) pills += '<span class="mx-pill minor">+' + (major.length - 3) + "건</span>";
      if (minor.length && major.length < 3) pills += '<span class="mx-pill minor" style="--c:' + CAT.labor[1] + '">· 실업청구</span>';
      cells += '<div class="mx-day' + (inM ? "" : " out") + (dow >= 5 ? " wkend" : "") + (evs.length ? "" : " empty") + (d === today ? " today" : "") + (d === cal.sel ? " sel" : "") + '" data-d="' + d + '">' +
        '<div class="n"><b>' + (+d.slice(8, 10)) + "</b></div>" + pills + "</div>";
    }
    $("#mx-grid").innerHTML = cells;
    $$("#mx-grid .mx-day").forEach(function (c) {
      if (c.classList.contains("empty")) return;
      c.onclick = function () { selectDay(c.dataset.d === cal.sel ? null : c.dataset.d); };
    });
  }
  function selectDay(d, scroll) {
    cal.sel = d;
    if (d && d.slice(0, 7) !== cal.month) cal.month = d.slice(0, 7);
    renderCalendar(); renderDrawer();
    if (scroll && d) $("#mx-drawer").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function evValues(e) {
    var i = ind(IND_OF_EV[e.key]); if (!i) return null;
    if (e.key === "claims" || e.key === "fomc") return { i: i, v: i.latest && i.latest.value, prev: i.latest && i.latest.prev, latest: true };
    var r = valueAt(i, e.ref); return { i: i, v: r ? r.v : null, prev: r ? r.prev : null };
  }
  function renderDrawer() {
    var dr = $("#mx-drawer");
    if (!cal.sel) { dr.classList.remove("open"); return; }
    var evs = (eventsByDay()[cal.sel] || []).slice().sort(function (a, b) { return a.kst < b.kst ? -1 : 1; }), past = cal.sel < todayKst(), dd = dayDiff(cal.sel, todayKst());
    var rows = evs.map(function (e, n) {
      var c = CAT[EVCAT[e.key]][1], vv = evValues(e), valHtml = "";
      if (vv && vv.i) {
        if (past && vv.v != null && !vv.latest) valHtml = '<b class="' + cls(vv.prev == null ? null : vv.v - vv.prev) + '">' + valStr(vv.i, vv.v) + "</b><br>이전 " + (vv.prev == null ? "–" : valStr(vv.i, vv.prev));
        else if (vv.i.latest) valHtml = "직전<br><b>" + valStr(vv.i, vv.i.latest.value) + "</b> <span class=\"flat\">" + esc(vv.i.freq === "M" ? refLabel(vv.i.latest.date) : md(vv.i.latest.date)) + "</span>";
      }
      var sp = vv && vv.i ? spark(tailPts(vv.i, vv.i.freq === "D" ? 120 : vv.i.freq === "W" ? 52 : 18), 150, 40, c) : "";
      return '<div class="mx-drow" style="--c:' + c + ";--d:" + n * 60 + 'ms"><span class="bar"></span>' +
        '<div class="tm">' + e.kst.slice(11) + "<small>미 동부 " + e.time_et + "</small></div>" +
        '<div class="nm"><b>' + esc(e.title) + '</b><span class="star">' + "★".repeat(e.importance) + "</span><small>" + esc(evRef(e)) + (e.sep ? " · 점도표 공개" : "") + (e.estimated ? " · 정례 일정(휴일엔 변경)" : "") + "</small></div>" +
        '<div class="vals">' + valHtml + "</div>" + sp +
        (vv && vv.i ? '<div class="act"><button class="mx-btn" data-k="' + vv.i.key + '">지표 보기 →</button></div>' : '<div class="act"></div>') + "</div>";
    }).join("");
    $("#mx-drawer-body").innerHTML = '<div class="mx-dcard"><div class="mx-dhead"><h3>' + (+cal.sel.slice(5, 7)) + "월 " + (+cal.sel.slice(8, 10)) + "일 (" + wd(cal.sel) + ")</h3>" +
      '<span>발표 ' + evs.length + "건 · " + (dd === 0 ? '<b class="up">오늘</b>' : dd > 0 ? "D-" + dd : dd * -1 + "일 전") + " · 한국시간</span></div>" + rows + "</div>";
    requestAnimationFrame(function () { dr.classList.add("open"); });
    $$("#mx-drawer .mx-btn").forEach(function (b) { b.onclick = function () { focusRow(b.dataset.k); }; });
  }
  var cdTimer = null;
  function renderSide() {
    var now = Date.now(), up = (D.calendar || []).filter(function (e) { return kstDate(e).getTime() > now; });
    var hero = up.filter(function (e) { return e.importance >= 3; })[0] || up[0];
    var week = up.filter(function (e) { return e.key !== "claims" && dayDiff(e.kst.slice(0, 10), todayKst()) <= 14; }).slice(0, 7);
    var html = "";
    if (hero) {
      var c = CAT[EVCAT[hero.key]][1], hi = ind(IND_OF_EV[hero.key]);
      html += '<div class="mx-count" style="--c:' + c + '"><div class="k">NEXT RELEASE</div><h3>' + esc(hero.title) + "</h3>" +
        '<div class="w">' + md(hero.kst) + "(" + wd(hero.kst) + ") " + hero.kst.slice(11) + " KST · " + esc(evRef(hero)) + "</div>" +
        '<div class="cd"><div><b id="cd-d">0</b><small>일</small></div><div><b id="cd-h">00</b><small>시간</small></div><div><b id="cd-m">00</b><small>분</small></div><div><b id="cd-s">00</b><small>초</small></div></div>' +
        (hi && hi.latest ? '<div class="pv">직전 ' + esc(hi.label) + " <b>" + valStr(hi, hi.latest.value) + "</b></div>" : "") + "</div>";
    }
    html += '<div class="mx-panel mx-week"><h4>향후 2주 주요 일정</h4>' + (week.map(function (e) {
      var d = dday(e);
      return '<div class="mx-wrow" data-d="' + e.kst.slice(0, 10) + '" style="--c:' + CAT[EVCAT[e.key]][1] + '"><div class="d">' + md(e.kst) + "<small>" + wd(e.kst) + " " + e.kst.slice(11) + "</small></div>" +
        '<div class="ti"><i></i>' + esc(SHORT[e.key] || e.title) + ' <span class="flat" style="font-weight:500;font-size:11px">' + esc(evRef(e)) + "</span></div>" +
        '<div class="dd">' + (d === 0 ? "오늘" : "D-" + d) + "</div></div>";
    }).join("") || '<div class="flat" style="font-size:12px">예정된 주요 일정 없음</div>') + "</div>";
    $("#mx-side").innerHTML = html;
    $$("#mx-side .mx-wrow").forEach(function (r) { r.onclick = function () { selectDay(r.dataset.d, true); }; });
    clearInterval(cdTimer);
    if (hero) {
      var tick = function () {
        var ms = Math.max(0, kstDate(hero).getTime() - Date.now()), el = $("#cd-d"); if (!el) return;
        el.textContent = Math.floor(ms / 864e5); $("#cd-h").textContent = String(Math.floor(ms % 864e5 / 36e5)).padStart(2, "0");
        $("#cd-m").textContent = String(Math.floor(ms % 36e5 / 6e4)).padStart(2, "0"); $("#cd-s").textContent = String(Math.floor(ms % 6e4 / 1e3)).padStart(2, "0");
      };
      tick(); cdTimer = setInterval(tick, 1000);
    }
  }

  /* ───────── 3. 지표 보드 ───────── */
  function chgHtml(i) {
    var l = i.latest; if (!l) return "";
    if (i.key === "nfp") return '<span class="flat">전월 ' + sign(l.prev, 0) + "</span>";
    return '<span class="' + cls(l.chg) + '">' + (l.chg > 0 ? "▲" : l.chg < 0 ? "▼" : "") + sign(l.chg, dgOf(i)).replace(/^[+−±]/, "") + "</span>";
  }
  function renderBoards() {
    var n = 0;
    $("#mx-boards").innerHTML = BOARDS.map(function (b) {
      var c = CAT[b[0]][1], rows = b[1].filter(function (k) { return ind(k) && ind(k).latest; }).map(function (k) {
        var i = ind(k), l = i.latest, ev = EV_OF[k] && nextEvent(EV_OF[k]), dd = ev ? dday(ev) : null;
        var nx = ev ? (dd <= 14 ? (dd === 0 ? "오늘" : "D-" + dd) : md(ev.kst)) : "";
        var dateTxt = i.freq === "M" || i.freq === "Q" ? refLabel(l.date) : md(l.date);
        var col = l.chg > 0 ? "#ff7a8c" : l.chg < 0 ? "#76a4ff" : "#8b93a7";
        n++;
        return '<div class="mx-row" data-k="' + k + '" style="--c:' + c + '"><div class="nm"><b>' + esc(i.label) + "</b><small>" + esc(dateTxt) + " · " + esc(i.source) + "</small></div>" +
          '<div class="v">' + fmt(l.value, dgOf(i)) + "<small>" + esc(unitSmall(i)) + '</small></div><div class="c">' + chgHtml(i) + "</div>" +
          spark(tailPts(i, i.freq === "D" ? 130 : i.freq === "W" ? 52 : i.freq === "Q" ? 16 : 24), 96, 26, col, n * 35) +
          '<div class="nx' + (dd != null && dd <= 3 ? " hot" : "") + '">' + nx + "</div></div>" +
          '<div class="mx-acc" data-acc="' + k + '"><div><div class="mx-acc-in" id="acc-' + k + '"></div></div></div>';
      }).join("");
      return '<div class="mx-board" style="--c:' + c + '"><div class="mx-board-h"><b><i></i>' + CAT[b[0]][0] + "</b><span>" + b[1].length + "개 지표</span></div>" + rows + "</div>";
    }).join("");
    $$("#mx-boards .mx-row").forEach(function (r) { r.onclick = function () { toggleRow(r.dataset.k); }; });
  }
  function toggleRow(k, forceOpen) {
    var wasOpen = openRow === k;
    if (openRow) { var pr = $('.mx-row[data-k="' + openRow + '"]'), pa = $('.mx-acc[data-acc="' + openRow + '"]'); if (pr) pr.classList.remove("open"); if (pa) pa.classList.remove("open"); }
    if (wasOpen && !forceOpen) { openRow = null; return; }
    openRow = k;
    var row = $('.mx-row[data-k="' + k + '"]'), acc = $('.mx-acc[data-acc="' + k + '"]'); if (!row || !acc) return;
    row.classList.add("open"); renderAcc(k);
    requestAnimationFrame(function () { acc.classList.add("open"); });
  }
  function focusRow(k) {
    if (!$('.mx-row[data-k="' + k + '"]')) { if (OVERLAYS.indexOf(k) >= 0) { st.overlay = k; persist(); renderExplorerTools(); renderExplorer(); $(".mx-explorer").scrollIntoView({ behavior: "smooth", block: "center" }); } return; }
    toggleRow(k, true);
    setTimeout(function () { $('.mx-row[data-k="' + k + '"]').scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
  }
  function renderAcc(k) {
    var i = ind(k), box = $("#acc-" + k), range = accRange[k] || (i.freq === "D" ? "2Y" : "10Y");
    var yrs = { "2Y": 2, "5Y": 5, "10Y": 10 }[range], endT = toT(i.dates[i.dates.length - 1]), startT = endT - yrs * 365.25 * 864e5;
    var pts = i.dates.map(function (d, j) { return [toT(d), i.values[j], d]; }).filter(function (p) { return p[1] != null && p[0] >= startT; });
    var all5 = i.dates.map(function (d, j) { return [toT(d), i.values[j]]; }).filter(function (p) { return p[1] != null && p[0] >= endT - 5 * 365.25 * 864e5; }).map(function (p) { return p[1]; });
    var cur = i.latest.value, hi5 = Math.max.apply(null, all5), lo5 = Math.min.apply(null, all5), avg5 = all5.reduce(function (a, b) { return a + b; }, 0) / all5.length;
    var pct = all5.filter(function (v) { return v <= cur; }).length / all5.length * 100;
    var ev = EV_OF[k] && nextEvent(EV_OF[k]), c = getComputedStyle($('.mx-row[data-k="' + k + '"]')).getPropertyValue("--c").trim() || "#6f9bff";
    var W = Math.max(300, box.clientWidth || (box.parentElement.parentElement.clientWidth - 32)), H = 190, L = 40, R = 8, T = 8, B = 20, iw = W - L - R, ih = H - T - B;
    var svg = "";
    if (pts.length > 1) {
      var vs = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
      var X = function (t) { return L + (t - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0]) * iw; }, Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * ih; };
      var step = niceStep(hi - lo, 4);
      for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) svg += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(g) + 3.5).toFixed(1) + '" text-anchor="end">' + fmt(g, stepDg(step)) + "</text>";
      if (lo < 0 && hi > 0) svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#5b6479" stroke-dasharray="3 3"/>';
      var avgY = Y(avg5).toFixed(1); svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + avgY + '" y2="' + avgY + '" stroke="' + c + '" stroke-opacity=".35" stroke-dasharray="6 4"/><text class="ax" x="' + (W - R - 2) + '" y="' + (+avgY - 4) + '" text-anchor="end" style="fill:' + c + '">5년 평균</text>';
      var path = pts.map(function (p, j) { return (j ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join("");
      svg += '<path d="' + path + "L" + X(pts[pts.length - 1][0]).toFixed(1) + "," + (T + ih) + "L" + L + "," + (T + ih) + 'Z" fill="' + c + '" fill-opacity=".1"/><path d="' + path + '" fill="none" stroke="' + c + '" stroke-width="1.9"/>';
      var last = pts[pts.length - 1]; svg += '<circle cx="' + X(last[0]).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="3.5" fill="' + c + '"/>';
      var yr = ""; pts.forEach(function (p) { var y = p[2].slice(0, 4); if (y !== yr) { if (yr) svg += '<text class="ax" x="' + X(p[0]).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + y + "</text>"; yr = y; } });
    }
    box.innerHTML = '<div class="mx-acc-top"><p>' + esc(i.note || i.label) + (ev ? " · 다음 발표 <b>" + md(ev.kst) + " " + ev.kst.slice(11) + " KST</b>" : "") + "</p>" +
      '<div style="display:flex;gap:8px;align-items:center"><div class="mx-seg">' + ["2Y", "5Y", "10Y"].map(function (r) { return '<button data-r="' + r + '" class="' + (r === range ? "on" : "") + '">' + r + "</button>"; }).join("") + "</div>" +
      (OVERLAYS.indexOf(k) >= 0 ? '<button class="mx-btn" data-ov="' + k + '">지수와 겹쳐보기</button>' : "") + "</div></div>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;height:auto;display:block">' + svg + "</svg>" +
      '<div class="mx-stats"><div><small>현재</small><b>' + valStr(i, cur) + "</b></div><div><small>5년 최고</small><b>" + valStr(i, hi5) + "</b></div><div><small>5년 최저</small><b>" + valStr(i, lo5) + "</b></div>" +
      "<div><small>5년 중 위치</small><b>상위 " + fmt(100 - pct, 0) + '%</b><div class="mx-pct"><i style="left:calc(' + pct.toFixed(1) + '% - 1.5px)"></i></div></div></div>';
    $$(".mx-seg button", box).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); accRange[k] = b.dataset.r; renderAcc(k); }; });
    var ovb = $("[data-ov]", box); if (ovb) ovb.onclick = function (e) { e.stopPropagation(); st.overlay = k; persist(); renderExplorerTools(); renderExplorer(); $(".mx-explorer").scrollIntoView({ behavior: "smooth", block: "center" }); };
  }

  /* ───────── 4. 지수 타일 + 탐색기 ───────── */
  function renderTiles() {
    $("#mx-tiles").innerHTML = IDX.filter(function (x) { return D.markets[x[0]]; }).map(function (x) {
      var m = D.markets[x[0]], n = m.c.length, last = m.c[n - 1], d1 = (last / m.c[n - 2] - 1) * 100, m1 = n > 22 ? (last / m.c[n - 22] - 1) * 100 : null;
      return '<div class="mx-tile' + (st.idx.indexOf(x[0]) >= 0 ? " on" : "") + '" data-t="' + x[0] + '" style="--c:' + x[2] + '"><div class="n">' + x[1] + "<i></i></div>" +
        '<div class="p">' + fmt(last, last > 1000 ? 0 : 2) + '</div><div class="r"><span class="' + cls(d1) + '">' + sign(d1, 2) + '%</span><span class="flat">1M ' + sign(m1, 1) + "%</span></div>" + spark(m.c.slice(-66), 120, 26, x[2]) + "</div>";
    }).join("");
    $$("#mx-tiles .mx-tile").forEach(function (t) {
      t.onclick = function () {
        var k = t.dataset.t, i = st.idx.indexOf(k);
        if (i >= 0) { if (st.idx.length > 1) st.idx.splice(i, 1); } else st.idx.push(k);
        persist(); renderTiles(); renderExplorer();
      };
    });
  }
  function renderExplorerTools() {
    $("#mx-overlay").innerHTML = OVERLAYS.filter(function (k) { return k === "none" || ind(k); }).map(function (k) {
      return '<option value="' + k + '"' + (k === st.overlay ? " selected" : "") + ">" + (k === "none" ? "없음" : esc(ind(k).label)) + "</option>";
    }).join("");
    $("#mx-overlay").onchange = function () { st.overlay = this.value; persist(); renderExplorer(); };
    $("#mx-mode").innerHTML = [["pct", "수익률 %"], ["price", "가격"]].map(function (m) { return '<button data-m="' + m[0] + '" class="' + (m[0] === st.mode ? "on" : "") + '">' + m[1] + "</button>"; }).join("");
    $$("#mx-mode button").forEach(function (b) { b.onclick = function () { st.mode = b.dataset.m; persist(); renderExplorerTools(); renderExplorer(); }; });
    $("#mx-range").innerHTML = RANGES.map(function (r) { return '<button data-r="' + r[0] + '" class="' + (r[0] === st.range ? "on" : "") + '">' + r[0] + "</button>"; }).join("");
    $$("#mx-range button").forEach(function (b) { b.onclick = function () { st.range = b.dataset.r; persist(); renderExplorerTools(); renderExplorer(); }; });
    $("#mx-events").checked = !!st.events; $("#mx-events").onchange = function () { st.events = this.checked; persist(); renderExplorer(); };
  }
  function idxMeta(t) { return IDX.filter(function (x) { return x[0] === t; })[0]; }
  function renderExplorer() {
    var box = $("#mx-chart"), W = Math.max(320, box.clientWidth || 900), small = W < 640;
    var H = small ? 380 : 480, L = small ? 40 : 56, R = small ? 40 : 60, T = st.events ? 32 : 20, volH = small ? 50 : 72, gap = 10, B = 24;
    var mainH = H - T - B - volH - gap, iw = W - L - R, days = RANGES.filter(function (r) { return r[0] === st.range; })[0][1];
    var sel = st.idx.filter(function (t) { return D.markets[t]; }); if (!sel.length) return;
    if (st.mode === "price") sel = sel.slice(0, 1);
    var primary = D.markets[sel[0]], endT = toT(primary.d[primary.d.length - 1]), startT = endT - days * 864e5;
    var series = sel.map(function (t) {
      var m = D.markets[t], pts = [];
      for (var i = 0; i < m.d.length; i++) { var tt = toT(m.d[i]); if (tt >= startT) pts.push([tt, m.c[i], m.v[i], m.d[i]]); }
      var base = pts.length ? pts[0][1] : 1; pts.forEach(function (p) { p.push(st.mode === "pct" ? (p[1] / base - 1) * 100 : p[1]); });
      return { t: t, meta: idxMeta(t), pts: pts };
    }).filter(function (s) { return s.pts.length > 1; });
    if (!series.length) { box.innerHTML = ""; return; }
    var ov = st.overlay !== "none" && ind(st.overlay), ovPts = [];
    if (ov) {
      var before = null;
      for (var j = 0; j < ov.dates.length; j++) { var ot = toT(ov.dates[j]); if (ov.values[j] == null) continue; if (ot < startT) before = [startT, ov.values[j], ov.dates[j]]; else if (ot <= endT + 45 * 864e5) ovPts.push([Math.min(ot, endT), ov.values[j], ov.dates[j]]); }
      if (before) ovPts.unshift(before);
    }
    var X = function (t) { return L + (t - startT) / (endT - startT) * iw; };
    var ys = []; series.forEach(function (s) { s.pts.forEach(function (p) { ys.push(p[4]); }); });
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    var Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * mainH; };
    var svg = '<defs>' + series.map(function (s, i) { return '<linearGradient id="mxg' + i + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + s.meta[2] + '" stop-opacity=".18"/><stop offset="1" stop-color="' + s.meta[2] + '" stop-opacity="0"/></linearGradient>'; }).join("") + "</defs>";
    var step = niceStep(hi - lo, small ? 4 : 5), dg = stepDg(step);
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) svg += '<line class="gl" x1="' + L + '" x2="' + (L + iw) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(g) + 3.5).toFixed(1) + '" text-anchor="end">' + (st.mode === "pct" ? (g > 0 ? "+" : "") + fmt(g, dg) + "%" : fmt(g, dg)) + "</text>";
    if (st.mode === "pct" && lo < 0 && hi > 0) svg += '<line x1="' + L + '" x2="' + (L + iw) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#5b6479" stroke-dasharray="3 3"/>';
    if (ov && ovPts.length > 1) {
      var ovv = ovPts.map(function (p) { return p[1]; }), olo = Math.min.apply(null, ovv), ohi = Math.max.apply(null, ovv), op = (ohi - olo) * 0.1 || Math.abs(ohi) * 0.05 || 1; olo -= op; ohi += op;
      var oY = function (v) { return T + (1 - (v - olo) / (ohi - olo)) * mainH; }, os = niceStep(ohi - olo, small ? 4 : 5), od = stepDg(os);
      for (var k = Math.ceil(olo / os) * os; k <= ohi; k += os) svg += '<text class="ax" x="' + (L + iw + 6) + '" y="' + (oY(k) + 3.5).toFixed(1) + '" style="fill:' + OV_COLOR + ';opacity:.85">' + fmt(k, od) + "</text>";
      var stepLine = ov.freq !== "D", path = "";
      ovPts.forEach(function (p, i) { var x = X(p[0]).toFixed(1), y = oY(p[1]).toFixed(1); path += !i ? "M" + x + "," + y : stepLine ? "H" + x + "V" + y : "L" + x + "," + y; });
      if (stepLine) path += "H" + (L + iw).toFixed(1);
      svg += '<path d="' + path + '" fill="none" stroke="' + OV_COLOR + '" stroke-width="1.8" stroke-dasharray="' + (stepLine ? "0" : "5 3") + '" opacity=".95"/>';
    }
    /* 발표일 세로선 — 라벨이 가까이 몰리면 두 줄로 엇갈려 놓고, 두 줄 다 차면 선만 그린다 */
    var placed = [[], []];
    if (st.events) (D.calendar || []).filter(function (e) { return /^(cpi|fomc|nfp)$/.test(e.key); }).forEach(function (e) {
      var et = toT(e.date); if (et < startT || et > endT) return;
      var xn = X(et), x = xn.toFixed(1), c = CAT[EVCAT[e.key]][1];
      svg += '<line x1="' + x + '" x2="' + x + '" y1="' + T + '" y2="' + (T + mainH) + '" stroke="' + c + '" stroke-dasharray="2 3" opacity=".6"/>';
      var row = [0, 1].filter(function (r) { return !placed[r].some(function (px) { return Math.abs(px - xn) < 36; }); })[0];
      if (row == null) return;
      placed[row].push(xn);
      svg += '<text x="' + x + '" y="' + (T - 6 - row * 12) + '" text-anchor="middle" style="font:800 9.5px var(--mono);fill:' + c + '">' + SHORT[e.key].replace("고용보고서", "고용") + "</text>";
    });
    series.forEach(function (s, i) {
      var d = s.pts.map(function (p, j) { return (j ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[4]).toFixed(1); }).join("");
      if (series.length === 1) svg += '<path d="' + d + "L" + X(s.pts[s.pts.length - 1][0]).toFixed(1) + "," + (T + mainH) + "L" + X(s.pts[0][0]).toFixed(1) + "," + (T + mainH) + 'Z" fill="url(#mxg' + i + ')"/>';
      svg += '<path d="' + d + '" fill="none" stroke="' + s.meta[2] + '" stroke-width="' + (series.length > 2 ? 1.6 : 2) + '"/>';
    });
    var vTop = T + mainH + gap, ps = series[0], vmax = Math.max.apply(null, ps.pts.map(function (p) { return p[2] || 0; }));
    if (vmax > 0) {
      var bw = Math.max(0.8, iw / ps.pts.length * 0.75);
      ps.pts.forEach(function (p, i) { var h = (p[2] || 0) / vmax * volH, upd = i === 0 || p[1] >= ps.pts[i - 1][1]; svg += '<rect x="' + (X(p[0]) - bw / 2).toFixed(1) + '" y="' + (vTop + volH - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (upd ? "rgba(240,71,90,.5)" : "rgba(61,126,255,.5)") + '"/>'; });
      svg += '<text class="ax" x="' + (L + 4) + '" y="' + (vTop + 10) + '">' + esc(ps.meta[1]) + " 거래량</text>";
    }
    var yrs = days > 800, prev = "";
    ps.pts.forEach(function (p) { var lab = yrs ? p[3].slice(0, 4) : p[3].slice(0, 7); if (lab !== prev) { if (prev) svg += '<text class="ax" x="' + X(p[0]).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + (yrs ? lab : p[3].slice(5, 7) === "01" ? p[3].slice(0, 4) : (+p[3].slice(5, 7)) + "월") + "</text>"; prev = lab; } });
    svg += '<line id="mx-x" x1="0" x2="0" y1="' + T + '" y2="' + (vTop + volH) + '" stroke="#cbd5ea" opacity="0"/><rect id="mx-hit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + (mainH + gap + volH) + '" fill="transparent"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + svg + '</svg><div class="mx-tip" id="mx-tip"></div>';
    $("#mx-legend").innerHTML = series.map(function (s) { var l = s.pts[s.pts.length - 1]; return '<span style="--c:' + s.meta[2] + '"><i></i>' + esc(s.meta[1]) + ' <b class="' + (st.mode === "pct" ? cls(l[4]) : "") + '">' + (st.mode === "pct" ? sign(l[4], 2) + "%" : fmt(l[1], 2)) + "</b></span>"; }).join("") +
      (ov ? '<span style="--c:' + OV_COLOR + '"><i></i>' + esc(ov.label) + " (오른쪽 축) <b>" + valStr(ov, ov.latest && ov.latest.value) + "</b></span>" : "") +
      (st.mode === "price" && st.idx.length > 1 ? '<span class="flat">가격 모드는 첫 번째 지수만 표시</span>' : "");
    var hit = $("#mx-hit"), cross = $("#mx-x"), tip = $("#mx-tip");
    hit.addEventListener("mousemove", function (ev) {
      var r = box.querySelector("svg").getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width * W, t = startT + (fx - L) / iw * (endT - startT), a = ps.pts, l2 = 0, h2 = a.length - 1;
      while (h2 - l2 > 1) { var mid = (l2 + h2) >> 1; if (a[mid][0] < t) l2 = mid; else h2 = mid; }
      var p = Math.abs(a[l2][0] - t) < Math.abs(a[h2][0] - t) ? a[l2] : a[h2], x = X(p[0]);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("opacity", ".5");
      var rows = series.map(function (s) { var q = null; for (var i = s.pts.length - 1; i >= 0; i--) if (s.pts[i][0] <= p[0]) { q = s.pts[i]; break; } if (!q) return ""; return '<div class="r"><span style="--c:' + s.meta[2] + '"><i></i>' + esc(s.meta[1]) + "</span><span>" + (st.mode === "pct" ? '<b class="' + cls(q[4]) + '">' + sign(q[4], 2) + "%</b> " : "") + fmt(q[1], 2) + "</span></div>"; }).join("");
      if (ov) { var oq = null; for (var i2 = ovPts.length - 1; i2 >= 0; i2--) if (ovPts[i2][0] <= p[0]) { oq = ovPts[i2]; break; } if (oq) rows += '<div class="r"><span style="--c:' + OV_COLOR + '"><i></i>' + esc(ov.label) + "</span><span>" + valStr(ov, oq[1]) + "</span></div>"; }
      if (p[2]) rows += '<div class="r"><span>거래량</span><span>' + (p[2] >= 1e9 ? fmt(p[2] / 1e9, 2) + "B" : fmt(p[2] / 1e6, 1) + "M") + "</span></div>";
      tip.innerHTML = "<b>" + p[3] + " (" + wd(p[3]) + ")</b>" + rows;
      var px = ev.clientX - r.left, py = ev.clientY - r.top; tip.style.left = (px + 230 > r.width ? px - 225 : px + 14) + "px"; tip.style.top = Math.max(4, py - 60) + "px"; tip.classList.add("show");
    });
    hit.addEventListener("mouseleave", function () { cross.setAttribute("opacity", "0"); tip.classList.remove("show"); });
  }

  /* ───────── 5. 금리 ───────── */
  function renderRates() {
    var y = D.yields; if (!y || !y.curve) return;
    $("#mx-rates-sub").textContent = "기준 " + y.curve.now.date + " · 미 재무부";
    var n = y.dates.length, back = Math.max(0, n - 22);
    $("#mx-ytiles").innerHTML = [["3M", "3개월"], ["2Y", "2년"], ["5Y", "5년"], ["10Y", "10년"], ["30Y", "30년"], ["10Y2Y", "10년−2년"]].map(function (t) {
      var v = y[t[0]][n - 1], p = y[t[0]][back], ch = v != null && p != null ? (v - p) * 100 : null;
      return '<div class="mx-yt"><small>' + t[1] + "</small><b>" + fmt(v, 2) + (t[0] === "10Y2Y" ? "%p" : "%") + '</b><span class="' + cls(ch) + '">1개월 ' + sign(ch, 0) + "bp</span></div>";
    }).join("");
    var TEN = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];
    var box = $("#mx-curve"), W = Math.max(300, box.clientWidth || 480), H = 250, L = 36, R = 12, T = 12, B = 24, iw = W - L - R, ih = H - T - B;
    var sets = [["now", "지금", "#8fb2ff", ""], ["m1", "1개월 전", "#9aa5bd", "4 3"], ["y1", "1년 전", "#5b6479", "2 3"]].filter(function (s) { return y.curve[s[0]]; });
    var all = []; sets.forEach(function (s) { TEN.forEach(function (t) { var v = y.curve[s[0]].curve[t]; if (v != null) all.push(v); }); });
    var lo = Math.min.apply(null, all) - 0.15, hi = Math.max.apply(null, all) + 0.15, X = function (i) { return L + i / (TEN.length - 1) * iw; }, Y = function (v) { return T + (1 - (v - lo) / (hi - lo)) * ih; };
    var svg = '<defs><linearGradient id="mxcur" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8fb2ff" stop-opacity=".22"/><stop offset="1" stop-color="#8fb2ff" stop-opacity="0"/></linearGradient></defs>', step = niceStep(hi - lo, 4);
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) svg += '<line class="gl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g) + '" y2="' + Y(g) + '"/><text class="ax" x="' + (L - 5) + '" y="' + (Y(g) + 3.5) + '" text-anchor="end">' + fmt(g, stepDg(step)) + "</text>";
    TEN.forEach(function (t, i) { svg += '<text class="ax" x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + t + "</text>"; });
    sets.slice().reverse().forEach(function (s) {
      var d = "", c = y.curve[s[0]].curve; TEN.forEach(function (t, i) { if (c[t] != null) d += (d ? "L" : "M") + X(i).toFixed(1) + "," + Y(c[t]).toFixed(1); });
      if (s[0] === "now") svg += '<path d="' + d + "L" + X(TEN.length - 1) + "," + (T + ih) + "L" + X(0) + "," + (T + ih) + 'Z" fill="url(#mxcur)"/>';
      svg += '<path d="' + d + '" fill="none" stroke="' + s[2] + '" stroke-width="' + (s[0] === "now" ? 2.4 : 1.5) + '" stroke-dasharray="' + s[3] + '"/>';
      if (s[0] === "now") TEN.forEach(function (t, i) { if (c[t] != null) svg += '<circle cx="' + X(i) + '" cy="' + Y(c[t]) + '" r="3" fill="#0b0e14" stroke="' + s[2] + '" stroke-width="2"><title>' + t + " " + c[t] + "%</title></circle>"; });
    });
    box.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' + svg + '</svg><div class="mx-legend">' + sets.map(function (s) { return '<span style="--c:' + s[2] + '"><i></i>' + s[1] + ' <span class="flat">' + y.curve[s[0]].date + "</span></span>"; }).join("") + "</div>";
    $("#mx-spread-t").innerHTML = [["10Y2Y", "10Y−2Y"], ["10Y3M", "10Y−3M"]].map(function (s) { return '<button data-s="' + s[0] + '" class="' + (s[0] === st.spread ? "on" : "") + '">' + s[1] + "</button>"; }).join("");
    $$("#mx-spread-t button").forEach(function (b) { b.onclick = function () { st.spread = b.dataset.s; persist(); renderRates(); }; });
    var sb = $("#mx-spread"), SW = Math.max(300, sb.clientWidth || 480), SH = 250, sL = 36, sR = 12, sT = 12, sB = 24, siw = SW - sL - sR, sih = SH - sT - sB;
    var endT = toT(y.dates[n - 1]), startT = endT - 3653 * 864e5, pts = [];
    y.dates.forEach(function (d, i) { var t = toT(d), v = y[st.spread][i]; if (t >= startT && v != null) pts.push([t, v, d]); });
    if (pts.length < 2) { sb.innerHTML = ""; return; }
    var vs = pts.map(function (p) { return p[1]; }), slo = Math.min(Math.min.apply(null, vs), 0) - 0.2, shi = Math.max(Math.max.apply(null, vs), 0) + 0.2;
    var SX = function (t) { return sL + (t - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0]) * siw; }, SY = function (v) { return sT + (1 - (v - slo) / (shi - slo)) * sih; };
    var s2 = "", st2 = niceStep(shi - slo, 4);
    for (var g2 = Math.ceil(slo / st2) * st2; g2 <= shi; g2 += st2) s2 += '<line class="gl" x1="' + sL + '" x2="' + (SW - sR) + '" y1="' + SY(g2) + '" y2="' + SY(g2) + '"/><text class="ax" x="' + (sL - 5) + '" y="' + (SY(g2) + 3.5) + '" text-anchor="end">' + fmt(g2, stepDg(st2)) + "</text>";
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + SX(p[0]).toFixed(1) + "," + SY(p[1]).toFixed(1); }).join(""), zero = SY(0).toFixed(1), close = "L" + SX(pts[pts.length - 1][0]).toFixed(1) + "," + zero + "L" + SX(pts[0][0]).toFixed(1) + "," + zero + "Z";
    s2 += '<defs><clipPath id="mxneg"><rect x="' + sL + '" y="' + zero + '" width="' + siw + '" height="' + (SH - zero) + '"/></clipPath><clipPath id="mxpos"><rect x="' + sL + '" y="0" width="' + siw + '" height="' + zero + '"/></clipPath></defs>' +
      '<path d="' + line + close + '" fill="rgba(240,71,90,.38)" clip-path="url(#mxneg)"/><path d="' + line + close + '" fill="rgba(143,178,255,.16)" clip-path="url(#mxpos)"/>' +
      '<line x1="' + sL + '" x2="' + (SW - sR) + '" y1="' + zero + '" y2="' + zero + '" stroke="#8b93a7" stroke-dasharray="3 3"/><path d="' + line + '" fill="none" stroke="#8fb2ff" stroke-width="1.5"/>';
    var yr = ""; pts.forEach(function (p) { var yy = p[2].slice(0, 4); if (yy !== yr) { if (yr) s2 += '<text class="ax" x="' + SX(p[0]).toFixed(1) + '" y="' + (SH - 6) + '" text-anchor="middle">' + yy + "</text>"; yr = yy; } });
    var lastS = pts[pts.length - 1][1];
    sb.innerHTML = '<svg viewBox="0 0 ' + SW + " " + SH + '" width="' + SW + '" height="' + SH + '">' + s2 + '</svg><div class="mx-legend"><span>현재 <b class="' + (lastS < 0 ? "up" : "") + '">' + sign(lastS, 2) + '%p</b></span><span class="flat">빨간 영역 = 장단기 역전 (과거 경기침체 선행 신호)</span></div>';
  }

  /* ───────── 시작 ───────── */
  function initCalendarState() {
    var today = todayKst(), byDay = eventsByDay(), b = monthBounds();
    cal.month = today.slice(0, 7) < b[0] ? b[0] : today.slice(0, 7) > b[1] ? b[1] : today.slice(0, 7);
    var nextMajor = (D.calendar || []).filter(function (e) { return e.kst.slice(0, 10) >= today && e.importance >= 2; })[0];
    cal.sel = byDay[today] ? today : nextMajor ? nextMajor.kst.slice(0, 10) : null;
    if (cal.sel) cal.month = cal.sel.slice(0, 7);
  }
  function renderAll() {
    regime(); initCalendarState(); renderCalendar(); renderDrawer(); renderSide(); renderBoards(); renderTiles(); renderExplorerTools(); renderExplorer(); renderRates();
    $("#mx-cat-legend").innerHTML = ["inflation", "labor", "growth", "rates"].map(function (c) { return '<span style="--c:' + CAT[c][1] + '"><i></i>' + CAT[c][0] + "</span>"; }).join("");
  }
  $("#mx-prev").onclick = function () { cal.month = shiftMonth(cal.month, -1); renderCalendar(); };
  $("#mx-next-m").onclick = function () { cal.month = shiftMonth(cal.month, 1); renderCalendar(); };
  $("#mx-go-today").onclick = function () { cal.month = todayKst().slice(0, 7); renderCalendar(); };
  var rs = null;
  window.addEventListener("resize", function () { clearTimeout(rs); rs = setTimeout(function () { if (!D) return; renderExplorer(); renderRates(); if (openRow) renderAcc(openRow); }, 180); });

  fetch("macro_dash.json?t=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    D = d;
    $("#mx-updated").textContent = "UPDATED " + (d.updated || "-");
    var s = d.status || {}, names = { bls: "BLS", bea: "BEA", effr: "뉴욕연준", claims: "노동부", umich: "미시간대", treasury: "재무부", calendar_bls: "BLS 일정", calendar_fomc: "FOMC 일정", calendar_bea: "BEA 일정" };
    $("#mx-foot").innerHTML = "출처 상태 · " + Object.keys(names).filter(function (k) { return s[k]; }).map(function (k) {
      var ok = s[k] === "ok" || s[k] === "seed" || s[k] === "bls.gov"; return '<span class="' + (ok ? "" : "up") + '">' + names[k] + (s[k] === "seed" ? "(공식 일정표)" : ok ? " ✓" : " ✗") + "</span>";
    }).join(" · ") + "<br>실업수당 청구는 비계절조정 주별 합계의 4주 평균. CPI·PPI·PCE·시급은 전년 동월 대비(%). 차트의 발표일 표시는 캘린더에 있는 최근·예정 일정만 그립니다.";
    renderAll();
  }).catch(function (e) { $("#mx-boards").innerHTML = '<div class="mx-panel">macro_dash.json을 불러오지 못했습니다 (' + esc(e.message) + ")</div>"; });
})();
