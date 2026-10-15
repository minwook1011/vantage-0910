/* jp-macro.js — 데이터 허브 '매크로 × 섹터' (datahub.html#macro)
   2026-10-15 사용자: 매크로 변수에 따라 섹터별 대표 기업·산업·관련 지수가 어떻게 움직이는지 상관관계로 본다.
   데이터: data/jp/macro_corr.json (build_jp_macro.py, 예약 작업이 이틀에 한 번)
   상관계수는 화면에서 기간·시차를 바꿀 때마다 계열로 다시 계산한다(파일의 corr 는 참고용). */
(function () {
  "use strict";
  var host = document.getElementById("macro-workspace");
  if (!host) return;
  var D = null, st = {kind: "sales", period: "all", lagMode: "same", sel: null};
  var PERIODS = [["all", "전체"], ["2023", "2023년 이후"], ["2y", "최근 2년"]];
  var KINDS = [["sales", "매출"], ["px", "주가"]];
  var LAGS = [["same", "같은 달"], ["best", "최적 시차"]];
  var MIN_N = 10, MAX_LAG = 6;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]; }); }
  function shift(k, n) { var y = +k.slice(0, 4), m = +k.slice(5, 7) + n; while (m <= 0) { y--; m += 12; } while (m > 12) { y++; m -= 12; } return y + "-" + (m < 10 ? "0" : "") + m; }
  function fromKey() {
    if (st.period === "2023") return "2023-01";
    if (st.period === "2y") { var last = "0000-00"; D.macros.forEach(function (m) { var ks = Object.keys(D.series[m.id] || {}); ks.forEach(function (k) { if (k > last) last = k; }); }); return shift(last, -23); }
    return "0000-00";
  }
  function pairs(mid, tid, lag) {
    var M = D.series[mid] || {}, T = D.series[tid] || {}, from = fromKey(), out = [];
    Object.keys(T).sort().forEach(function (k) { if (k < from) return; var mk = shift(k, -lag); if (M[mk] != null) out.push([M[mk], T[k], k]); });
    return out;
  }
  function pearson(p) {
    var n = p.length; if (n < MIN_N) return null;
    var mx = 0, my = 0; p.forEach(function (a) { mx += a[0]; my += a[1]; }); mx /= n; my /= n;
    var sxx = 0, syy = 0, sxy = 0; p.forEach(function (a) { var dx = a[0] - mx, dy = a[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; });
    if (!sxx || !syy) return null;
    return {r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, icpt: my - sxy / sxx * mx, n: n};
  }
  function corr(mid, tid) {
    var lags = [];
    for (var k = 0; k <= MAX_LAG; k++) lags.push(pearson(pairs(mid, tid, k)));
    var best = 0;
    if (st.lagMode === "best") lags.forEach(function (c, k) { if (c && (!lags[best] || Math.abs(c.r) > Math.abs(lags[best].r))) best = k; });
    return lags[best] ? {c: lags[best], lag: best, lags: lags} : (lags.some(Boolean) && st.lagMode === "same" ? {c: null, lag: 0, lags: lags} : null);
  }
  function sig(c) { return c && Math.abs(c.r) >= 2 / Math.sqrt(c.n); }  // 대략 유의수준 5%
  function cellBg(r) {
    if (r == null) return "";
    var a = Math.min(1, Math.abs(r)) * 0.85;
    return r >= 0 ? "background:rgba(214,51,74," + a.toFixed(2) + ")" : "background:rgba(47,111,228," + a.toFixed(2) + ")";
  }

  function rowsFor() {
    var out = [];
    D.sectors.forEach(function (s) {
      out.push({head: true, label: s.label, hint: s.hint});
      s.aggregates.forEach(function (a) { if (a.kind === st.kind) out.push({id: a.id, label: a.label, cls: "agg", tag: "섹터 평균"}); });
      if (st.kind === "sales") (s.industry || []).forEach(function (i) { out.push({id: i.id, label: i.label, cls: "ind", tag: "업계 통계", src: i.src}); });
      s.companies.forEach(function (c) { var id = st.kind === "sales" ? c.sales : c.px; if (id) out.push({id: id, label: c.name, code: c.code, tag: c.code}); });
    });
    if (st.kind === "px" && D.indexes.length) {
      out.push({head: true, label: "관련 지수", hint: "시장 전체·소매업 지수의 전년비"});
      D.indexes.forEach(function (i) { out.push({id: i.id, label: i.label, cls: "idx", tag: "지수", src: i.src}); });
    }
    return out;
  }
  function labelOf(id) {
    var hit = null;
    D.sectors.forEach(function (s) {
      s.aggregates.forEach(function (a) { if (a.id === id) hit = a.label; });
      (s.industry || []).forEach(function (i) { if (i.id === id) hit = "업계 · " + i.label; });
      s.companies.forEach(function (c) { if (c.sales === id) hit = c.name + " 매출"; if (c.px === id) hit = c.name + " 주가"; });
    });
    D.indexes.forEach(function (i) { if (i.id === id) hit = i.label + " 지수"; });
    return hit || id;
  }
  function seg(name, opts, cur) {
    return '<div class="mx-seg" data-seg="' + name + '">' + opts.map(function (o) { return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (o[0] === cur) + '">' + o[1] + "</button>"; }).join("") + "</div>";
  }

  function render() {
    if (!D) return;
    var rows = rowsFor(), ms = D.macros;
    if (!st.sel || !D.series[st.sel.t] || rows.every(function (r) { return r.id !== st.sel.t; })) {
      var first = rows.filter(function (r) { return r.id && r.cls === "agg"; })[0];
      st.sel = first ? {m: (st.sel && st.sel.m) || ms[0].id, t: first.id} : null;
    }
    var h = '<div class="mx-head"><div><div class="kicker">매크로 × 섹터</div><h2>매크로 변수와 섹터·기업·지수의 상관관계</h2>' +
      '<p class="mx-sub">칸 = 피어슨 상관계수(−1~1). 빨강은 같이 오르고 파랑은 반대로 움직임. 매출은 월차 기존점 전년비, 주가·지수·매크로는 전년비(기온만 전년차 ℃). ' +
      '<b>*</b> = 표본 수 대비 우연으로 보기 어려운 크기. 칸을 누르면 아래에 겹친 그래프가 나온다.</p></div>' +
      '<span class="mx-upd">갱신 ' + esc((D.generated_at || "").slice(0, 16).replace("T", " ")) + "</span></div>";
    h += '<div class="mx-ctl">' + seg("kind", KINDS, st.kind) + seg("period", PERIODS, st.period) + seg("lagMode", LAGS, st.lagMode) +
      '<span class="mx-n">' + (st.lagMode === "best" ? "매크로가 0~6개월 먼저 움직인 경우 중 상관이 가장 큰 시차" : "같은 달끼리 비교") + "</span></div>";
    h += '<div class="mx-macros">' + ms.map(function (m) { return '<div class="mx-mc"><b>' + esc(m.label) + "</b><small>" + esc(m.hint) + "</small></div>"; }).join("") + "</div>";
    h += '<div class="mx-scroll"><table class="mx-t"><thead><tr><th class="nm">대상</th>' + ms.map(function (m) { return "<th>" + esc(m.label) + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r) {
      if (r.head) { h += '<tr class="sec"><td colspan="' + (ms.length + 1) + '"><b>' + esc(r.label) + "</b><small>" + esc(r.hint) + "</small></td></tr>"; return; }
      h += '<tr class="' + (r.cls || "") + '"><td class="nm"><span>' + esc(r.label) + "</span><small>" + esc(r.tag || "") + "</small></td>";
      ms.forEach(function (m) {
        if (m.id === "m_nikkei" && r.id === "ix_nikkei") { h += '<td class="na" title="같은 계열">같은 계열</td>'; return; }
        var x = corr(m.id, r.id), on = st.sel && st.sel.m === m.id && st.sel.t === r.id;
        if (!x || !x.c) { h += '<td class="na' + (on ? " on" : "") + '" data-m="' + m.id + '" data-t="' + r.id + '" title="겹치는 달이 ' + MIN_N + '개 미만">–</td>'; return; }
        var c = x.c, txt = (c.r >= 0 ? "+" : "") + c.r.toFixed(2);
        h += '<td class="v' + (Math.abs(c.r) >= 0.55 ? " strong" : "") + (on ? " on" : "") + '" style="' + cellBg(c.r) + '" data-m="' + m.id + '" data-t="' + r.id + '" title="표본 ' + c.n + "개월" + (x.lag ? ", 매크로가 " + x.lag + "개월 먼저" : "") + '">' +
          txt + (sig(c) ? "<sup>*</sup>" : "") + (x.lag ? "<small>" + x.lag + "개월</small>" : "") + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    h += '<div class="mx-det" id="mx-det"></div>';
    h += '<div class="mx-rr" id="mx-rr"></div>';
    h += '<details class="mx-note"><summary>읽는 법과 한계</summary><ul>' +
      "<li>상관은 인과가 아니다. 둘 다 같은 방향 추세를 타면(예: 2025년 말 이후 중국인 방일객 급감과 어떤 회사의 꾸준한 성장) 강한 음의 상관이 우연히 나온다. 그래프로 모양을 꼭 확인할 것.</li>" +
      "<li>매출(월차)은 데이터 허브에 쌓인 기간(2024년 10월 이후)만 있어 표본이 20개월대다. 주가·매크로는 2019년부터라 '전체'에는 코로나 충격이 섞인다 — '2023년 이후'와 비교해 볼 것.</li>" +
      "<li>업계 통계(외식협회)는 협회 페이지에 최근 달만 걸려 있어 2025년 7월부터 쌓아 간다. 표본 " + MIN_N + "개월이 안 되면 빈칸.</li>" +
      "<li>출처: " + D.macros.map(function (m) { return esc(m.label) + " — " + esc(m.src); }).join(" · ") + " · 기업 매출 — 각 사 월차(TDnet·회사 IR) · 주가 — 야후 파이낸스</li>" +
      (D.errors && D.errors.length ? "<li>이번 갱신 실패: " + esc(D.errors.join(" / ")) + " (직전 값 유지)</li>" : "") + "</ul></details>";
    host.innerHTML = h;
    drawDetail();
    drawRisk();
  }

  /* 악재 반영 → 해소 점검 (2026-10-15 사용자: 서늘한 여름으로 의류가 부진했다 — 그걸 악재로 치고, 주가에 이미 반영돼 해소될 때 이익이 더 오를 구간을 보자)
     민감도 = 매출 전년비를 매크로에 회귀한 기울기(같은 달, 쌓인 전 기간). 추정 영향 = 민감도 × 최근 N개월 매크로 평균.
     주가 반영 = 같은 N개월(직전 달 대비 마지막 달) 주가 등락 − 토픽스 소매 등락.
     해소 = 내년 같은 달은 이번 부진이 기저가 되어, 날씨가 평년으로 돌아오면 전년비가 추정 영향만큼 거꾸로 좋아진다. */
  var rr = {m: "m_wxfit", sec: "apparel", win: "summer"};
  function lastKey(sid) { var ks = Object.keys(D.series[sid] || {}).sort(); return ks[ks.length - 1]; }
  function winAvg(sid, end, n) { var S = D.series[sid] || {}, v = []; for (var i = 0; i < n; i++) { var k = shift(end, -i); if (S[k] != null) v.push(S[k]); } return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
  function winRet(sid, end, n) { var S = D.series[sid] || {}, a = S[shift(end, -n)], b = S[end]; return a && b ? (b / a - 1) * 100 : null; }
  function fmt(v, d, unit) { return v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(d == null ? 1 : d) + (unit || ""); }
  function drawRisk() {
    var box = document.getElementById("mx-rr");
    if (!box) return;
    var ms = D.macros, m = ms.filter(function (x) { return x.id === rr.m; })[0] || ms[0];
    rr.m = m.id;
    var sec = D.sectors.filter(function (s) { return s.id === rr.sec; })[0] || D.sectors[0];
    // 기간: 최근 N개월, 또는 가장 최근의 여름(6~8월) — 주가도 같은 달까지로 맞춘다
    var N = rr.win === "summer" ? 3 : +rr.win, last = lastKey(m.id), mEnd = last;
    if (rr.win === "summer") { mEnd = last.slice(0, 4) + "-08"; if (mEnd > last) mEnd = (+last.slice(0, 4) - 1) + "-08"; }
    var shock = winAvg(m.id, mEnd, N);
    var pxLast = lastKey("il_retail"), pxEnd = rr.win === "summer" && pxLast && pxLast > mEnd ? mEnd : pxLast;
    var retRet = pxEnd ? winRet("il_retail", pxEnd, N) : null;
    var pxNow = pxLast && pxEnd && pxLast > pxEnd ? pxLast : null;
    var unit = m.unit === "℃" ? "℃" : "%p";
    var rows = sec.companies.map(function (c) {
      var o = {name: c.name, code: c.code};
      if (c.sales) {
        var p = []; Object.keys(D.series[c.sales]).forEach(function (k) { var mv = D.series[m.id][k]; if (mv != null) p.push([mv, D.series[c.sales][k], k]); });
        o.fit = pearson(p);
        o.impact = o.fit && shock != null ? o.fit.slope * shock : null;
        var sEnd = rr.win === "summer" ? mEnd : lastKey(c.sales); o.actual = winAvg(c.sales, sEnd, N);
      }
      var pl = "pl_" + c.code;
      if (D.series[pl] && pxEnd) {
        o.ret = winRet(pl, pxEnd, N); o.rel = o.ret != null && retRet != null ? o.ret - retRet : null;
        if (pxNow) { var a = D.series[pl][pxEnd], b = D.series[pl][pxNow], ra = D.series.il_retail[pxEnd], rb = D.series.il_retail[pxNow]; o.since = a && b && ra && rb ? ((b / a) - (rb / ra)) * 100 : null; }
      }
      if (o.impact == null) o.verdict = ["na", "민감도 계산 불가"];
      else if (o.impact <= -1 && o.rel != null && o.rel <= -3) o.verdict = ["go", "악재 반영 · 해소 대기"];
      else if (o.impact <= -1) o.verdict = ["warn", "악재 덜 반영"];
      else if (o.impact >= 1) o.verdict = ["tail", "날씨 덕 · 내년 역기저"];
      else o.verdict = ["flat", "영향 작음"];
      return o;
    }).sort(function (a, b) { return (a.impact == null) - (b.impact == null) || (a.impact || 0) - (b.impact || 0); });
    var mOpts = ms.map(function (x) { return '<option value="' + x.id + '"' + (x.id === m.id ? " selected" : "") + ">" + esc(x.label) + "</option>"; }).join("");
    var sOpts = D.sectors.map(function (s) { return '<option value="' + s.id + '"' + (s.id === sec.id ? " selected" : "") + ">" + esc(s.label) + "</option>"; }).join("");
    var wOpts = [["summer", "이번 여름(6~8월)"], ["3", "최근 3개월"], ["6", "최근 6개월"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === String(rr.win) ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
    var wl = rr.win === "summer" ? mEnd.slice(2, 4) + "년 6~8월" : "최근 " + N + "개월";
    var mPath = [];
    for (var i = N - 1; i >= 0; i--) { var k = shift(mEnd, -i), v = (D.series[m.id] || {})[k]; mPath.push(k.slice(2).replace("-", ".") + " " + fmt(v, 1, m.unit === "℃" ? "℃" : "%")); }
    var h = '<div class="mx-rh"><div><div class="kicker">악재 반영 → 해소 점검</div><h3>이미 맞은 악재가 주가에 반영됐고, 풀리면 실적이 더 좋아질 곳</h3>' +
      '<p class="mx-sub">민감도 = 매출 전년비가 매크로 1' + unit + "에 얼마나 움직였나(쌓인 전 기간 회귀). 추정 영향 = 민감도 × 최근 매크로. 주가 반영 = 같은 기간 주가 등락에서 토픽스 소매 등락을 뺀 값. " +
      "<b>해소 여지</b> = 내년 같은 달은 이번 부진이 낮은 기저가 되므로, 매크로가 평년으로만 돌아와도 전년비가 그만큼 좋아진다.</p></div></div>";
    h += '<div class="mx-ctl"><label>매크로 <select data-rr="m">' + mOpts + '</select></label><label>섹터 <select data-rr="sec">' + sOpts + '</select></label><label>기간 <select data-rr="win">' + wOpts + "</select></label>" +
      '<span class="mx-n">' + esc(m.label) + " : " + esc(mPath.join(" · ")) + " → 평균 <b>" + fmt(shock, 1, m.unit === "℃" ? "℃" : "%") + "</b> · 토픽스 소매 " + fmt(retRet, 1, "%") + "</span></div>";
    h += '<div class="mx-scroll"><table class="mx-t mx-rt"><thead><tr><th class="nm">기업</th><th>민감도<br><small>매출 %p / 1' + unit + "</small></th><th>추정 매출 영향<br><small>" + wl + "</small></th><th>해소 여지<br><small>내년 같은 달</small></th><th>실제 기존점 매출<br><small>" + wl + " 평균</small></th><th>주가 등락<br><small>" + wl + "</small></th><th>소매 지수 대비<br><small>" + wl + "</small></th>" + (pxNow ? "<th>그 뒤 소매 대비<br><small>~" + pxNow.slice(2).replace("-", ".") + "</small></th>" : "") + "<th>판정</th></tr></thead><tbody>";
    rows.forEach(function (o) {
      var f = o.fit;
      h += "<tr><td class='nm'><span>" + esc(o.name) + "</span><small>" + o.code + (f ? " · 표본 " + f.n + "개월 · 상관 " + fmt(f.r, 2) : "") + "</small></td>" +
        "<td>" + (f ? fmt(f.slope, 2) : "–") + "</td>" +
        "<td class='" + (o.impact == null ? "" : o.impact < 0 ? "dn" : "up") + "'>" + fmt(o.impact, 1, "%p") + "</td>" +
        "<td class='" + (o.impact != null && o.impact < 0 ? "up" : "") + "'>" + (o.impact == null ? "–" : fmt(-o.impact, 1, "%p")) + "</td>" +
        "<td>" + fmt(o.actual, 1, "%") + "</td>" +
        "<td class='" + (o.ret == null ? "" : o.ret < 0 ? "dn" : "up") + "'>" + fmt(o.ret, 1, "%") + "</td>" +
        "<td class='" + (o.rel == null ? "" : o.rel < 0 ? "dn" : "up") + "'>" + fmt(o.rel, 1, "%p") + "</td>" +
        (pxNow ? "<td class='" + (o.since == null ? "" : o.since < 0 ? "dn" : "up") + "'>" + fmt(o.since, 1, "%p") + "</td>" : "") +
        "<td><span class='vd " + o.verdict[0] + "'>" + o.verdict[1] + "</span></td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<p class="mx-rn">판정 기준: 추정 영향 −1%p 이하이면서 주가가 소매 지수보다 3%p 넘게 빠졌으면 "악재 반영 · 해소 대기", 영향은 큰데 주가가 덜 빠졌으면 "악재 덜 반영", 매크로가 도와준 곳은 "날씨 덕 · 내년 역기저"(내년엔 높은 기저가 부담). ' +
      "민감도는 표본이 20개월대라 거칠다 — 상관이 약한(±0.3 미만) 회사는 숫자보다 방향만 볼 것.</p>";
    box.innerHTML = h;
  }

  function lineChart(mid, tid, lag) {
    var M = D.series[mid] || {}, T = D.series[tid] || {}, from = fromKey();
    var keys = Object.keys(T).filter(function (k) { return k >= from; }).sort();
    if (keys.length < 2) return "";
    var mv = keys.map(function (k) { return M[shift(k, -lag)]; }), tv = keys.map(function (k) { return T[k]; });
    var W = 640, H = 220, L = 44, R = 44, Tp = 12, B = 26;
    function rng(a) { var v = a.filter(function (x) { return x != null; }); var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v); if (lo === hi) { lo -= 1; hi += 1; } var pad = (hi - lo) * 0.08; return [lo - pad, hi + pad]; }
    var rm = rng(mv), rt = rng(tv);
    function x(i) { return L + (W - L - R) * i / (keys.length - 1); }
    function y(v, r) { return Tp + (H - Tp - B) * (1 - (v - r[0]) / (r[1] - r[0])); }
    function path(a, r) { var d = "", pen = false; a.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v, r).toFixed(1); pen = true; }); return d; }
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" class="mx-line" role="img" aria-label="매크로와 대상 겹친 그래프">';
    [0, 0.5, 1].forEach(function (f) {
      var yy = Tp + (H - Tp - B) * f;
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="grid"/>';
      s += '<text x="' + (L - 6) + '" y="' + (yy + 4) + '" class="ax tl">' + (rt[1] - (rt[1] - rt[0]) * f).toFixed(1) + "</text>";
      s += '<text x="' + (W - R + 6) + '" y="' + (yy + 4) + '" class="ax mc">' + (rm[1] - (rm[1] - rm[0]) * f).toFixed(1) + "</text>";
    });
    if (rt[0] < 0 && rt[1] > 0) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0, rt) + '" y2="' + y(0, rt) + '" class="zero"/>';
    var step = Math.max(1, Math.ceil(keys.length / 8));
    keys.forEach(function (k, i) { if (i % step === 0) s += '<text x="' + x(i) + '" y="' + (H - 6) + '" class="ax" text-anchor="middle">' + k.slice(2).replace("-", ".") + "</text>"; });
    s += '<path d="' + path(mv, rm) + '" class="lm"/><path d="' + path(tv, rt) + '" class="lt"/></svg>';
    return s;
  }
  function scatter(p, c) {
    var W = 300, H = 220, L = 40, R = 10, Tp = 10, B = 30;
    var xs = p.map(function (a) { return a[0]; }), ys = p.map(function (a) { return a[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (x0 === x1) { x0--; x1++; } if (y0 === y1) { y0--; y1++; }
    function X(v) { return L + (W - L - R) * (v - x0) / (x1 - x0); }
    function Y(v) { return Tp + (H - Tp - B) * (1 - (v - y0) / (y1 - y0)); }
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" class="mx-sc" role="img" aria-label="산점도">';
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" class="grid"/><line x1="' + L + '" x2="' + L + '" y1="' + Tp + '" y2="' + (H - B) + '" class="grid"/>';
    s += '<text x="' + L + '" y="' + (H - 8) + '" class="ax">' + x0.toFixed(1) + '</text><text x="' + (W - R) + '" y="' + (H - 8) + '" class="ax" text-anchor="end">' + x1.toFixed(1) + "</text>";
    s += '<text x="' + (L - 4) + '" y="' + (Tp + 8) + '" class="ax tl">' + y1.toFixed(1) + '</text><text x="' + (L - 4) + '" y="' + (H - B) + '" class="ax tl">' + y0.toFixed(1) + "</text>";
    var last = p.length - 1;
    p.forEach(function (a, i) { s += '<circle cx="' + X(a[0]).toFixed(1) + '" cy="' + Y(a[1]).toFixed(1) + '" r="' + (i === last ? 4.5 : 3) + '" class="' + (i === last ? "dot last" : "dot") + '"><title>' + a[2] + " · " + a[0] + " / " + a[1] + "</title></circle>"; });
    if (c) s += '<line x1="' + X(x0) + '" y1="' + Y(c.icpt + c.slope * x0) + '" x2="' + X(x1) + '" y2="' + Y(c.icpt + c.slope * x1) + '" class="fit"/>';
    return s + "</svg>";
  }
  function lagBars(lags) {
    return '<div class="mx-lags">' + lags.map(function (c, k) {
      var r = c ? c.r : null, w = r == null ? 0 : Math.abs(r) * 100;
      return '<div class="lg"><span>' + (k ? k + "개월" : "같은 달") + '</span><i><b class="' + (r >= 0 ? "p" : "n") + '" style="width:' + w.toFixed(0) + '%"></b></i><em>' + (r == null ? "–" : (r >= 0 ? "+" : "") + r.toFixed(2)) + "</em></div>";
    }).join("") + "</div>";
  }
  function drawDetail() {
    var box = document.getElementById("mx-det");
    if (!box || !st.sel) return;
    var m = D.macros.filter(function (x) { return x.id === st.sel.m; })[0], tid = st.sel.t;
    if (!m) return;
    var x = corr(m.id, tid), lag = x ? x.lag : 0, p = pairs(m.id, tid, lag), c = x && x.c;
    var tl = labelOf(tid);
    var say = "";
    if (c) {
      var strength = Math.abs(c.r) >= 0.55 ? "강한" : Math.abs(c.r) >= 0.3 ? "보통" : "약한";
      say = "<b>" + esc(m.label) + "</b>" + (lag ? "(" + lag + "개월 먼저)" : "") + " ↔ <b>" + esc(tl) + "</b> : " + strength + " " + (c.r >= 0 ? "같은 방향" : "반대 방향") + " 관계(" + (c.r >= 0 ? "+" : "") + c.r.toFixed(2) + ", " + c.n + "개월). " +
        "기울기로 보면 매크로 값이 1" + (m.unit === "℃" ? "℃" : "%포인트") + " 오를 때 대상 전년비는 평균 " + (c.slope >= 0 ? "+" : "") + c.slope.toFixed(2) + "%포인트." + (sig(c) ? "" : " 표본에 비해 크지 않은 값이라 우연일 수 있다.");
    } else say = "겹치는 달이 " + MIN_N + "개 미만이라 계산하지 않았다.";
    box.innerHTML = '<div class="mx-dh"><b>' + esc(m.label) + " × " + esc(tl) + '</b><span class="lg-m">' + esc(m.label) + (lag ? " (" + lag + "개월 앞당김)" : "") + ' · 오른쪽 축</span><span class="lg-t">' + esc(tl) + " · 왼쪽 축</span></div>" +
      '<p class="mx-say">' + say + "</p>" +
      '<div class="mx-charts"><div class="c1">' + lineChart(m.id, tid, lag) + '</div><div class="c2">' + (p.length ? scatter(p, c) : "") + '<small>가로 ' + esc(m.label) + " · 세로 " + esc(tl) + " · 큰 점 = 최근 달</small></div></div>" +
      (x ? '<div class="mx-lt">시차별 상관(매크로가 먼저 움직인 개월 수)</div>' + lagBars(x.lags) : "");
  }

  host.addEventListener("change", function (e) {
    var s = e.target.closest("select[data-rr]");
    if (s) { rr[s.dataset.rr] = s.value; drawRisk(); }
  });
  host.addEventListener("click", function (e) {
    var b = e.target.closest(".mx-seg button");
    if (b) { st[b.parentNode.dataset.seg] = b.dataset.v; render(); return; }
    var td = e.target.closest("td[data-m]");
    if (td) { st.sel = {m: td.dataset.m, t: td.dataset.t}; host.querySelectorAll("td.on").forEach(function (x) { x.classList.remove("on"); }); td.classList.add("on"); drawDetail(); document.getElementById("mx-det").scrollIntoView({block: "nearest", behavior: "smooth"}); }
  });

  host.innerHTML = '<div class="mx-empty">불러오는 중…</div>';
  var load = window.vantageJSON ? window.vantageJSON("data/jp/macro_corr.json") : fetch("data/jp/macro_corr.json", {cache: "no-cache"}).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  Promise.resolve(load).then(function (j) {
    if (!j || !j.series) throw new Error("빈 파일");
    D = j; render();
  }).catch(function () {
    host.innerHTML = '<div class="mx-empty">아직 데이터가 없습니다. 예약 작업(build_jp_macro.py)이 처음 돌면 채워집니다.</div>';
  });
})();
