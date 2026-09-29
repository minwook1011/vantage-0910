/* ta-backtest.js — 기술적 분석 › 백테스트 탭 (옛 '기술점수 연구소')
 * TABacktest.mount(el): el 안에 하위 탭(국면·공식 / 실제 채점 / 걸어가며 검증 / 교체 기록 / 노트)을 만들고,
 * ta_model.json·ta_lab_notes.json은 처음 mount될 때만 받는다. 하위 탭 차트는 그 탭이 처음 보일 때 그린다.
 * 필요: stocks-common.js(escapeHtml·fetchJSON), panes.js */
(function () {
  "use strict";
  var M = null, N = null;
  var RG = ["bull", "side", "bear"];
  var RGL = { bull: "상승장", side: "횡보장", bear: "하락장" };
  var RGC = { bull: "#f0475a", side: "#8b93a7", bear: "#3d7eff" };
  var RGBAND = { bull: "rgba(240,71,90,.09)", side: "rgba(139,147,167,.05)", bear: "rgba(61,126,255,.13)" };
  var HZ = [["1", "1D"], ["5", "1W"], ["20", "1M"]];
  var TREND = { ma200: 1, ma50_200: 1, mom12_1: 1, mom6_1: 1, hi52: 1, r1m: 1, r1w: 1, gap20: 1, updays: 1 };
  var REVERT = { r1m: 1, r1w: 1, gap20: 1, updays: 1, rsi14: 1, hi52: 1 };

  function sg(v, d) { if (v == null || !isFinite(v)) return "–"; return (v > 0 ? "+" : "") + (+v).toFixed(d == null ? 2 : d); }
  function cls(v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function fm(k) { return (M.features || []).filter(function (f) { return f.key === k; })[0] || { label: k, desc: "", cap: .25 }; }
  function cur() { return M.versions[M.versions.length - 1]; }
  function isRg(w) { return w && typeof w.bull === "object"; }
  function wOf(w, rg) { return isRg(w) ? (w[rg] || w.side || {}) : (w || {}); }
  function rgPill(rg) { return rg ? '<span class="pill ' + rg + '">' + RGL[rg] + "</span>" : ""; }
  function $(root, sel) { return root.querySelector(sel); }
  function sortedKeys(w) { return Object.keys(w).sort(function (a, b) { return Math.abs(w[b]) - Math.abs(w[a]); }); }

  /* 국면 공식이 '무엇을 좋아하는지' 한 줄 해석 */
  function readFormula(w) {
    var tot = 0, tr = 0, rv = 0, vol = 0;
    Object.keys(w).forEach(function (k) {
      var x = w[k]; tot += Math.abs(x);
      if (x > 0 && TREND[k]) tr += x;
      if (x < 0 && REVERT[k]) rv += -x;
      if (x > 0 && (k === "vol20" || k === "maxret")) vol += x;
    });
    tot = tot || 1;
    var p = [];
    var t = Math.round(tr / tot * 100), r = Math.round(rv / tot * 100), v = Math.round(vol / tot * 100);
    if (t) p.push("추세·모멘텀 추종 <b>" + t + "%</b>");
    if (r) p.push("눌림목(최근 덜 오른 종목) <b>" + r + "%</b>");
    if (v) p.push("변동성 큰 종목 <b>" + v + "%</b>");
    var verdict = t >= r * 1.5 ? "오르는 종목이 계속 오른다고 보는 공식" : r >= t * 1.2 ? "추세는 살아있되 최근 쉬어간 종목을 고르는 공식" : "추세와 눌림을 섞어 보는 공식";
    return verdict + " — " + p.join(" · ");
  }

  /* ── 공용 선 그래프: pts = [{d, v:[...], rg}] ── */
  function lineChart(el, pts, series, opt) {
    opt = opt || {};
    if (!pts || pts.length < 2) { el.innerHTML = '<div class="empty">데이터 부족</div>'; return; }
    var W = Math.max(320, el.clientWidth - 28), H = opt.h || 280, m = { l: 48, r: 14, t: 12, b: 28 };
    var vals = [];
    pts.forEach(function (p) { series.forEach(function (s, j) { if (p.v[j] != null) vals.push(p.v[j]); }); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (opt.zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    var pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    function x(i) { return m.l + i / (pts.length - 1) * iw; }
    function y(v) { return m.t + (hi - v) / (hi - lo) * ih; }
    var g = "";
    if (opt.bands) {   // 국면 배경띠
      var s0 = 0;
      for (var i = 1; i <= pts.length; i++) {
        if (i === pts.length || pts[i].rg !== pts[s0].rg) {
          var x0 = s0 === 0 ? m.l : (x(s0 - 1) + x(s0)) / 2, x1 = i === pts.length ? W - m.r : (x(i - 1) + x(i)) / 2;
          if (pts[s0].rg) g += '<rect x="' + x0.toFixed(1) + '" y="' + m.t + '" width="' + Math.max(0, x1 - x0).toFixed(1) + '" height="' + ih + '" fill="' + RGBAND[pts[s0].rg] + '"/>';
          s0 = i;
        }
      }
    }
    var step = (function (s) { var r = s / 5, p = Math.pow(10, Math.floor(Math.log10(r))), q = r / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; })(hi - lo);
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (m.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + (opt.fmtY ? opt.fmtY(t) : Math.round(t)) + "</text>";
    if (opt.zero) g += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    var yrs = {}, lastX = -99;
    pts.forEach(function (p, i) { var yy = p.d.slice(0, 4); if (!(yy in yrs)) { yrs[yy] = i; if (x(i) - lastX > 34) { g += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + yy + "</text>"; lastX = x(i); } } });
    series.slice().reverse().forEach(function (s, jj) {
      var j = series.length - 1 - jj, d = "", pen = false;
      pts.forEach(function (p, i) { if (p.v[j] == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(p.v[j]).toFixed(1); pen = true; });
      g += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.w || 2) + '"' + (s.dash ? ' stroke-dasharray="4 3"' : "") + "/>";
    });
    g += '<line class="hair" x1="0" x2="0" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--text)" stroke-dasharray="3 3" opacity=".5" style="display:none"/><rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + escapeHtml(opt.label || "") + '">' + g + '</svg><div class="ctip"></div>';
    var hit = $(el, ".hit"), hair = $(el, ".hair"), tip = $(el, ".ctip"), svg = $(el, "svg");
    hit.addEventListener("mousemove", function (e) {
      var r = svg.getBoundingClientRect(), k = W / r.width, px = (e.clientX - r.left) * k, i = Math.round((px - m.l) / iw * (pts.length - 1));
      i = Math.max(0, Math.min(pts.length - 1, i)); var p = pts[i];
      hair.setAttribute("x1", x(i)); hair.setAttribute("x2", x(i)); hair.style.display = "";
      tip.innerHTML = "<b>" + p.d + "</b> " + rgPill(p.rg) + "<br>" + series.map(function (s, j) { return '<span style="color:' + s.color + '">●</span> ' + s.name + " <b>" + (p.v[j] == null ? "–" : (opt.fmtT ? opt.fmtT(p.v[j]) : p.v[j])) + "</b>"; }).join("<br>");
      tip.style.display = "block"; var lx = e.clientX - el.getBoundingClientRect().left + 14; if (lx > el.clientWidth - 200) lx -= 214;
      tip.style.left = lx + "px"; tip.style.top = "16px";
    });
    hit.addEventListener("mouseleave", function () { hair.style.display = "none"; tip.style.display = "none"; });
  }

  /* ── ① 국면·공식 ── */
  function paneRegime(el) {
    var R = M.regime || {}, v = cur(), d = M.daily[M.daily.length - 1] || {}, today = R.today;
    var ev = d.champ || {};
    var k = [];
    k.push('<div class="kpi rg-' + today + '"><div class="k">오늘 시장 국면</div><div class="v" style="color:' + RGC[today] + '">' + (RGL[today] || "–") + '</div><div class="s">40거래일 지수 ' + sg(R.r, 1) + "% · " + (R.since || "") + "부터</div></div>");
    k.push('<div class="kpi"><div class="k">지금 공식</div><div class="v">v' + v.ver + '</div><div class="s">' + v.date + " 교체 · " + (isRg(v.weights) ? "국면별 3개 공식" : "단일 공식") + "</div></div>");
    k.push('<div class="kpi"><div class="k">최근 6개월 · 상위 20% 월 환산 초과</div><div class="v ' + cls(ev.comp) + '">' + sg(ev.comp) + '%p</div><div class="s">1D ' + sg(ev.h && ev.h["1"].excess) + " · 1W " + sg(ev.h && ev.h["5"].excess) + " · 1M " + sg(ev.h && ev.h["20"].excess) + "%p</div></div>");
    k.push('<div class="kpi"><div class="k">오늘 채점 결과</div><div class="v">' + (d.decision === "promote" ? "교체" : "유지") + '</div><div class="s">' + escapeHtml(d.reason || "") + "</div></div>");
    var cards = RG.map(function (rg) {
      var w = wOf(v.weights, rg), keys = sortedKeys(w), tot = keys.reduce(function (s, kk) { return s + Math.abs(w[kk]); }, 0) || 1;
      var mx = Math.max.apply(null, keys.map(function (kk) { return Math.abs(w[kk]) / tot; }).concat([.01]));
      return '<div class="card' + (rg === today ? " now" : "") + '"><h4><i style="background:' + RGC[rg] + '"></i>' + RGL[rg] + " 공식" + (rg === today ? ' <span class="pill cur">오늘 적용</span>' : "") +
        ' <span class="muted small" style="font-weight:400">과거 ' + ((R.counts || {})[rg] || 0).toLocaleString() + "거래일</span></h4>" +
        '<p class="read">' + readFormula(w) + "</p>" +
        keys.map(function (kk) {
          var sh = Math.abs(w[kk]) / tot, wd = sh / mx * 50;
          return '<div class="wrow" title="' + escapeHtml(fm(kk).desc) + '"><span class="lb">' + escapeHtml(fm(kk).label) + (w[kk] < 0 ? ' <span class="muted small">(낮을수록 +)</span>' : "") + '</span><span class="bar"><i style="' + (w[kk] >= 0 ? "left:50%" : "left:" + (50 - wd) + "%") + ";width:" + wd + "%;background:" + (w[kk] >= 0 ? "var(--up)" : "var(--dn)") + '"></i></span><span class="n">' + (w[kk] < 0 ? "−" : "") + Math.round(sh * 100) + "%</span></div>";
        }).join("") + "</div>";
    }).join("");
    el.innerHTML =
      '<div class="sec"><div class="kpis">' + k.join("") + "</div></div>" +
      '<div class="sec"><div class="sec-h"><h3>시장 국면 — 300종목 동일가중 지수</h3><span class="hint">' + escapeHtml(R.rule || "") + '</span></div><div class="card chart" id="bt-rgchart"></div>' +
      '<div class="legend"><span><i style="border-color:#d7deea"></i>300종목 동일가중 지수(시작=100)</span><span><i class="box" style="background:rgba(240,71,90,.35)"></i>상승장</span><span><i class="box" style="background:rgba(139,147,167,.25)"></i>횡보장</span><span><i class="box" style="background:rgba(61,126,255,.4)"></i>하락장</span></div></div>' +
      '<div class="sec"><div class="sec-h"><h3>국면별 공식</h3><span class="hint">오른쪽(빨강) = 높을수록 가점 · 왼쪽(파랑) = 낮을수록 가점 · 각 지표는 그날 300종목 중 순위로 바꿔 가중합 → 점수도 순위(80점 = 상위 20%)</span></div><div class="rgc">' + cards + "</div></div>" +
      '<div class="sec"><div class="sec-h"><h3>지표별 예측력 — 국면별 · 기간별</h3><span class="hint">IC = 지표 순위와 이후 시장 대비 수익 순위의 상관(+면 높을수록 더 오름). 최근 ' + Math.round((M.rules.train_weeks_rg || 364) / 52) + '년 주간 표본</span></div><div class="tbl-wrap"><table class="lt" id="bt-ictab"></table></div></div>' +
      '<div class="sec"><div class="sec-h"><h3>오늘 점수 상위 20종목</h3><span class="hint">' + (RGL[today] || "") + ' 공식 기준 · 누르면 순위 탭에서 검색</span></div><div class="tops" id="bt-tops"></div></div>';
    var hist = (R.hist || []).map(function (h) { return { d: h[0], v: [h[1]], rg: h[2] }; });
    lineChart($(el, "#bt-rgchart"), hist, [{ name: "지수", color: "#d7deea" }], { bands: true, label: "시장 국면 지수", fmtT: function (v) { return v.toFixed(1); } });
    var st = M.ic_recent || {}, ih = M.ic_by_h || {};
    function icCell(s, hl) { if (!s || s.ic == null) return "<td>–</td>"; return '<td class="' + cls(s.ic) + (hl ? " hl" : "") + '" title="t ' + sg(s.t, 1) + (s.n ? " · " + s.n + "주" : "") + '">' + sg(s.ic, 3) + "</td>"; }
    $(el, "#bt-ictab").innerHTML = "<thead><tr><th>지표</th><th>전체</th>" + RG.map(function (rg) { return "<th>" + RGL[rg] + "</th>"; }).join("") + HZ.map(function (h) { return "<th>" + h[1] + " 뒤</th>"; }).join("") + "<th style='text-align:left'>뜻</th></tr></thead><tbody>" +
      (M.features || []).map(function (f) {
        return "<tr><td><b>" + escapeHtml(f.label) + "</b></td>" + icCell((st.all || {})[f.key]) + RG.map(function (rg) { return icCell((st[rg] || {})[f.key], rg === today); }).join("") +
          HZ.map(function (h) { var x = (ih[h[0]] || {})[f.key]; return '<td class="' + cls(x) + '">' + sg(x, 3) + "</td>"; }).join("") + '<td class="wrap">' + escapeHtml(f.desc) + "</td></tr>";
      }).join("") + "</tbody>";
    $(el, "#bt-tops").innerHTML = (M.top_today || []).map(function (t) {
      return '<div class="top"><span class="sc">' + t.s + '</span><a href="bottomup.html?q=' + encodeURIComponent(t.tk) + '#list"><b>' + escapeHtml(t.name) + '</b></a> <span class="muted small">' + escapeHtml(t.tk) + '</span><div class="cm">' +
        Object.keys(t.p).slice(0, 5).map(function (kk) { return escapeHtml(fm(kk).label) + " " + t.p[kk]; }).join(" · ") + "</div></div>";
    }).join("");
  }

  /* ── ② 실제 채점(1D·1W·1M) ── */
  function paneScore(el) {
    var rl = M.realized || { rows: [], summary: {} }, d = M.daily[M.daily.length - 1] || {};
    var k = HZ.map(function (h) {
      var s = rl.summary[h[0]] || {};
      return '<div class="kpi"><div class="k">최근 ' + (s.days || 0) + "거래일 · 상위 20%의 " + h[1] + ' 뒤 시장 대비</div><div class="v ' + cls(s.excess) + '">' + sg(s.excess) + '%p</div><div class="s">시장 이긴 날 ' + (s.beat == null ? "–" : s.beat + "%") + "</div></div>";
    });
    var c = d.champ || {}, fl = d.flat || {}, lg = d.legacy || {};
    k.push('<div class="kpi"><div class="k">최근 6개월 · 월 환산 종합</div><div class="v ' + cls(c.comp) + '">' + sg(c.comp) + '%p</div><div class="s">국면 구분 없는 공식 ' + sg(fl.comp) + " · 옛 점수 " + sg(lg.comp) + "</div></div>");
    function hzRow(name, e) { if (!e || !e.h) return ""; return "<tr><td>" + name + "</td>" + HZ.map(function (h) { var x = e.h[h[0]]; return '<td class="' + cls(x.excess) + '">' + sg(x.excess) + "%p</td><td>" + sg(x.ic, 3) + "</td><td>" + x.beat + "%</td>"; }).join("") + '<td class="' + cls(e.comp) + '"><b>' + sg(e.comp) + "</b></td></tr>"; }
    var rows = (rl.rows || []).slice().reverse();
    el.innerHTML =
      '<p class="lede">매일 백테스트를 다시 돌려 <b>"그날 공식으로 점수 상위 20%를 샀다면 1거래일(1D)·5거래일(1W)·20거래일(1M) 뒤 같은 날 300종목 평균보다 더 올랐나"</b>를 채점합니다. 이 채점 결과로 공식을 다시 학습하고, 더 나을 때만 교체합니다.</p>' +
      '<div class="sec"><div class="kpis">' + k.join("") + "</div></div>" +
      '<div class="sec"><div class="sec-h"><h3>최근 6개월(학습에 안 쓴 구간) — 기간별 성적</h3><span class="hint">매주 상위 20% · 월 환산 = 1D×20, 1W×4, 1M×1 평균</span></div><div class="tbl-wrap"><table class="lt"><thead><tr><th>공식</th>' +
      HZ.map(function (h) { return "<th>" + h[1] + " 초과</th><th>IC</th><th>이긴 주</th>"; }).join("") + "<th>월 환산</th></tr></thead><tbody>" +
      hzRow("지금 공식 v" + d.champ_ver, c) + hzRow("오늘 다시 학습(도전자)", d.chal) + hzRow("국면 구분 없는 공식", fl) + hzRow("옛 기술점수(v1)", lg) + "</tbody></table></div></div>" +
      '<div class="sec"><div class="sec-h"><h3>최근 거래일별 실제 결과</h3><span class="hint">그날 상위 20% − 300종목 평균 (%p) · 빈칸 = 아직 기간이 안 지남</span></div><div class="tbl-wrap tall"><table class="lt"><thead><tr><th>기준일</th><th>국면</th><th>1D 뒤</th><th>1W 뒤</th><th>1M 뒤</th><th>옛 점수 1M</th></tr></thead><tbody>' +
      rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + rgPill(r[1]) + "</td>" + [r[2], r[3], r[4], r[5]].map(function (x) { return '<td class="' + cls(x) + '">' + (x == null ? "" : sg(x) + "%p") + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div></div>" +
      '<div class="sec"><div class="sec-h"><h3>매일 채점 기록</h3><span class="hint">챔피언(지금 공식) vs 도전자(오늘 다시 학습) · 최근 6개월 월 환산 초과수익</span></div><div class="tbl-wrap tall"><table class="lt" id="bt-daily"></table></div></div>';
    function comp(e) { return e ? (e.comp != null ? e.comp : e.excess) : null; }
    $(el, "#bt-daily").innerHTML = "<thead><tr><th>날짜</th><th>국면</th><th>챔피언</th><th>챔피언</th><th>도전자</th><th>옛 점수</th><th>결정</th><th style='text-align:left'>이유</th></tr></thead><tbody>" +
      M.daily.slice().reverse().map(function (x) {
        return "<tr><td>" + x.date + "</td><td>" + rgPill(x.regime) + "</td><td>v" + x.champ_ver + '</td><td class="' + cls(comp(x.champ)) + '">' + sg(comp(x.champ)) + '%p</td><td class="' + cls(comp(x.chal)) + '">' + sg(comp(x.chal)) + "%p</td><td>" + sg(comp(x.legacy)) + "%p</td><td>" +
          (x.decision === "promote" ? '<span class="pill ok">교체</span>' : '<span class="pill no">유지</span>') + '</td><td class="wrap">' + escapeHtml(x.reason || "") + "</td></tr>";
      }).join("") + "</tbody>";
  }

  /* ── ③ 걸어가며 검증 ── */
  function paneWalk(el) {
    var w = M.walk || {}, s = w.summary || {}, br = w.by_regime || {};
    function row(name, key) { var x = s[key]; if (!x) return ""; return "<tr><td>" + name + '</td><td class="' + cls(x.excess1) + '">' + sg(x.excess1, 3) + '</td><td class="' + cls(x.excess5) + '">' + sg(x.excess5, 3) + '</td><td class="' + cls(x.excess20) + '">' + sg(x.excess20, 3) + "</td><td>" + x.beat + "%</td><td>" + x.weeks + "</td></tr>"; }
    el.innerHTML =
      '<p class="lede">과거 매달, <b>그 시점까지의 데이터로만</b> 공식을 학습해 다음 4주에 적용했다면 어땠을지 되짚어 봅니다(미래 정보 없음). 국면별 공식이 국면을 안 나눈 공식·옛 점수보다 나은지 확인하는 곳입니다.</p>' +
      '<div class="sec"><div class="sec-h"><h3>누적 초과수익</h3><span class="hint">매주 점수 상위 20%를 5거래일 보유 · 300종목 평균 대비 · 배경 = 그 주의 국면</span></div><div class="card chart" id="bt-walk"></div>' +
      '<div class="legend"><span><i style="border-color:#f0475a"></i>국면별 공식(학습형)</span><span><i style="border-color:#f0b429"></i>국면 구분 없는 공식</span><span><i style="border-color:#8b93a7"></i>옛 기술점수(v1)</span></div></div>' +
      '<div class="sec"><div class="sec-h"><h3>기간별 평균</h3><span class="hint">주당 평균 초과수익(%p)</span></div><div class="tbl-wrap"><table class="lt"><thead><tr><th>공식</th><th>1D</th><th>1W</th><th>1M</th><th>1M 이긴 주</th><th>표본</th></tr></thead><tbody>' +
      row("국면별 공식", "learn") + row("국면 구분 없는 공식", "flat") + row("옛 기술점수(v1)", "legacy") + "</tbody></table></div></div>" +
      '<div class="sec"><div class="sec-h"><h3>국면별로 나눠 보면</h3><span class="hint">1M 뒤 평균 초과수익(%p)</span></div><div class="tbl-wrap"><table class="lt"><thead><tr><th>국면</th><th>국면별 공식</th><th>구분 없는 공식</th><th>옛 점수</th><th>주</th></tr></thead><tbody>' +
      RG.filter(function (rg) { return br[rg]; }).map(function (rg) { var x = br[rg]; return "<tr><td>" + rgPill(rg) + '</td><td class="' + cls(x.learn) + '">' + sg(x.learn, 3) + '</td><td class="' + cls(x.flat) + '">' + sg(x.flat, 3) + '</td><td class="' + cls(x.legacy) + '">' + sg(x.legacy, 3) + "</td><td>" + x.weeks + "</td></tr>"; }).join("") + "</tbody></table></div></div>";
    var pts = (w.curve || []).map(function (p) { return { d: p[0], v: [p[1], p[3] == null ? null : p[3], p[2]], rg: p[4] }; });
    lineChart($(el, "#bt-walk"), pts, [{ name: "국면별", color: "#f0475a" }, { name: "구분 없음", color: "#f0b429", w: 1.6 }, { name: "옛 점수", color: "#8b93a7", w: 1.6 }],
      { zero: true, bands: true, label: "걸어가며 검증 누적 초과수익", fmtY: function (t) { return (t > 0 ? "+" : "") + Math.round(t) + "%"; }, fmtT: function (v) { return sg(v, 1) + "%"; } });
  }

  /* ── ④ 교체 기록 ── */
  function paneVersions(el) {
    var vs = M.versions.slice().reverse(), curV = cur().ver;
    el.innerHTML = '<div class="timeline">' + vs.map(function (v) {
      var ev = v.eval || {};
      var evt = "";
      if (ev.new) evt = ev.new.comp != null ? "평가 구간 월 환산 초과: 새 공식 " + sg(ev.new.comp) + "%p · 이전 " + sg(ev.old && ev.old.comp) + "%p" + (ev.flat ? " · 국면 구분 없음 " + sg(ev.flat.comp) + "%p" : "") + " · 옛 점수 " + sg(ev.legacy && ev.legacy.comp) + "%p"
        : "평가 구간 상위 20% 초과수익: 새 공식 " + sg(ev.new.excess) + "%p (IC " + sg(ev.new.ic, 3) + ") · 이전 공식 " + sg(ev.old.excess) + "%p · 기존 점수 " + sg(ev.legacy.excess) + "%p";
      return '<div class="ver' + (v.ver === curV ? " cur" : "") + '"><h4>v' + v.ver + (v.ver === curV ? ' <span class="pill cur">지금 사용</span>' : "") + (isRg(v.weights) ? ' <span class="pill no">국면별</span>' : "") + ' <span class="d">' + v.date + "</span></h4>" +
        (v.reason ? '<div class="reason">🏁 ' + escapeHtml(v.reason) + (v.train ? " · 학습 " + v.train[0] + " ~ " + v.train[1] + " · 평가 " + v.holdout[0] + " ~ " + v.holdout[1] : "") + "</div>" : "") +
        "<ul>" + (v.changes || []).map(function (c) { return '<li class="' + c.type + '">' + escapeHtml(c.text) + "</li>"; }).join("") + "</ul>" +
        (evt ? '<div class="note">' + evt + "</div>" : "") + (v.note ? '<div class="note">' + escapeHtml(v.note) + "</div>" : "") + "</div>";
    }).join("") + "</div>";
  }

  /* ── ⑤ 노트·원칙 ── */
  function paneNotes(el) {
    var r = M.rules, list = (N && N.notes) || [];
    el.innerHTML =
      '<div class="sec"><div class="sec-h"><h3>작업 노트</h3><span class="hint">무엇을 만들고 왜 바꿨는지 — Claude</span></div><div class="timeline">' +
      (list.length ? list.slice().reverse().map(function (n) { return '<div class="notes-c"><h4>' + escapeHtml(n.title) + "<span>" + n.date + "</span></h4><ol>" + n.items.map(function (x) { return "<li>" + escapeHtml(x) + "</li>"; }).join("") + "</ol></div>"; }).join("") : '<div class="empty">노트 없음</div>') + "</div></div>" +
      '<div class="sec"><div class="sec-h"><h3>설계 원칙</h3><a href="backtest.html">전략·차트 패턴 백테스트 상세 ›</a></div><ul class="principles">' + [
        "<b>목표:</b> 앞으로 1D·1W·1M 동안 같은 날 300종목 평균보다 더 오를 종목에 높은 점수. 절대 수익률이 아니라 '상대적으로 얼마나 나은가'를 맞힙니다.",
        "<b>국면을 나눠 본다:</b> " + escapeHtml((M.regime || {}).rule || "") + ". 국면마다 통하는 지표가 달라서(상승장은 추세 추종, 횡보·하락장은 눌림목 쪽) 공식을 따로 학습하고, 오늘 국면의 공식으로 점수를 매깁니다.",
        "<b>표본이 적은 국면은 전체 쪽으로 당긴다:</b> 국면 IC를 (n·국면 IC + " + r.shrink_k + "·전체 IC)/(n + " + r.shrink_k + ")로 줄여 씁니다. 하락장은 드물어서 학습 창을 최근 " + Math.round((r.train_weeks_rg || 364) / 52) + "년으로 잡았습니다.",
        "<b>순위로 바꿔서 합친다:</b> 지표마다 단위가 달라서, 매일 300종목 안 순위(0~100)로 바꾼 뒤 가중합합니다.",
        "<b>꾸준함이 먼저:</b> IC의 t값이 " + r.t_min + " 이상이고 앞·뒤 절반에서 방향이 같은 지표, 또는 그 국면에서만 |t|≥" + (r.t_min_rg || 1.5) + "로 뚜렷한 지표만 씁니다. 전체로는 통해도 그 국면에서 반대로 뚜렷하면 뺍니다.",
        "<b>한 지표에 몰빵 금지:</b> 지표별 비중 상한(보통 25%, 변동성·급등일은 강세장 베타가 섞여 15%).",
        "<b>미래 데이터 금지:</b> 결과가 확정될 때까지 " + r.embargo_weeks + "주 공백을 두고 학습하고, 국면도 그날까지의 지수로만 판정합니다.",
        "<b>교체는 보수적으로:</b> 학습에 안 쓴 최근 " + Math.round(r.holdout_weeks / 4.3) + "개월에서 도전자가 월 환산 종합 초과수익으로 " + r.margin + "%p 넘게 앞서고 평균 IC가 플러스일 때만, 직전 교체 후 " + r.min_gap_days + "일 이상 지나야 바꿉니다.",
        "<b>알려진 약점:</b> 종목 명단이 '지금' 상위 300이라 생존자 편향이 있고, 대형주에서 기술적 신호는 원래 약합니다(IC 0.01~0.05). 국면이 바뀐 직후에는 판정(40거래일)이 늦게 따라옵니다.",
        "투자 권유가 아닌 과거 데이터 통계입니다."
      ].map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>";
  }

  var PANES = [
    ["regime", "국면·공식", "오늘 국면 · 3개 공식", paneRegime],
    ["score", "실제 채점", "1D · 1W · 1M", paneScore],
    ["walk", "걸어가며 검증", "과거 재현", paneWalk],
    ["versions", "교체 기록", "버전별 변화", paneVersions],
    ["notes", "노트·원칙", "작업 노트 · 설계", paneNotes]
  ];

  function mount(el) {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";
    el.classList.add("btv");
    el.innerHTML = '<div class="empty">백테스트 결과 불러오는 중…</div>';
    Promise.all([fetchJSON("ta_model.json"), fetchJSON("ta_lab_notes.json").catch(function () { return null; })]).then(function (rs) {
      M = rs[0]; N = rs[1];
      el.innerHTML =
        '<p class="lede">기술점수는 사람이 정한 고정 공식이 아니라 <b>매일 10년치 300종목 백테스트로 다시 채점해서 고치는 공식</b>입니다. 시장을 <b>상승장·횡보장·하락장</b>으로 나눠 국면마다 다른 공식을 쓰고, 점수 상위 종목이 실제로 <b>1D·1W·1M 뒤</b> 시장을 이겼는지로 채점합니다. <span class="muted">마지막 채점 ' + escapeHtml(M.updated || "") + "</span></p>" +
        '<div data-panes="ta-bt" data-panes-keys="off"><div class="panes-bar"><div class="pane-tabs" aria-label="백테스트 하위 섹션">' +
        PANES.map(function (p, i) { return '<button class="pane-tab" data-pane="' + p[0] + '"><span class="pane-no">' + (i + 1) + "</span><b>" + p[1] + "</b><small>" + p[2] + "</small></button>"; }).join("") +
        "</div></div>" + PANES.map(function (p) { return '<section class="pane" data-pane="' + p[0] + '" hidden></section>'; }).join("") + "</div>";
      var root = $(el, "[data-panes]"), built = {};
      root.addEventListener("pane:show", function (e) {
        if (e.target.parentNode !== root) return;
        var p = PANES.filter(function (x) { return x[0] === e.detail.id; })[0];
        var w = e.target.clientWidth;
        if (p && (!built[p[0]] || (p[0] !== "score" && p[0] !== "versions" && p[0] !== "notes" && Math.abs(built[p[0]] - w) > 40))) { built[p[0]] = w || 1; p[3](e.target); }
      });
      window.Panes.init(root);
      var rt; window.addEventListener("resize", function () {
        clearTimeout(rt);
        rt = setTimeout(function () { var ctl = root.panes, id = ctl && ctl.current(); var pane = id && root.querySelector('.pane[data-pane="' + id + '"]');
          if (pane && window.Panes.isShown(pane) && (id === "regime" || id === "walk") && built[id] && Math.abs(built[id] - pane.clientWidth) > 40) { built[id] = pane.clientWidth; (id === "regime" ? paneRegime : paneWalk)(pane); } }, 220);
      });
    }).catch(function (e) {
      el.innerHTML = '<div class="empty">ta_model.json을 불러오지 못했습니다 — backtest_ta.py를 실행하세요. ' + escapeHtml(e.message) + "</div>";
    });
  }

  window.TABacktest = { mount: mount };
})();
