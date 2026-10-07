/* jp-report.js — 일본 실적 리포트
 * jp-report.html            → 최근 발표 목록(소비재 / 주요 기업)
 * jp-report.html?id=<rid>   → 리포트 1건: ① 요약(분기 표 + 핵심 수치 + 요약 글) ② 딥리서치 분석(그래프 + 9개 항목 분석 글) ③ 원문(한글 정리 orig_md + 결산단신 PDF 등)
 * 데이터: data/jp/reports/<rid>.json (fetch_jp_earnings_results.py, 자동) + data/jp/reports/notes/<rid>.json (Claude가 쓰는 요약·분석, 선택) */
(function () {
  "use strict";
  var app = document.getElementById("app");
  /* 시장 설정 — us-report.html 은 이 파일보다 먼저 window.EARN_MARKET = "us" 를 둔다(같은 화면 코드로 일본·미국을 그린다) */
  var MK = {
    jp: { base: "data/jp/reports/", page: "jp-report.html", u: "억엔", cur: "엔", title: "일본 실적 리포트",
          px: function (c) { return "data/jp/px/" + c + ".json"; }, pxConv: function (P) { return P.b || []; },
          pxSrc: "야후 파이낸스 일봉 종가(엔) · 평일 장 마감 후 매일 갱신",
          tableUnit: "단위: 억엔 · 3개월(분기) 실적 · 분기 라벨은 달력 기준(예: 2Q26 = 2026년 4~6월) · 당기순이익 = 모회사 귀속 · YoY 음→양 전환 등은 계산하지 않음(–) · 출처: 카부탄" },
    us: { base: "data/us/reports/", page: "us-report.html", u: "억 달러", cur: "달러", title: "미국 실적 리포트",
          px: function (c) { return "data/us/" + c + ".json"; },
          pxConv: function (P) { return ((P.price || {}).points || []).slice(-520).map(function (x) { return [Math.round(Date.parse(x.date + "T00:00:00Z") / 864e5), x.value]; }); },
          pxSrc: "야후 파이낸스 일봉 종가(달러) · 데이터 허브와 같은 값(하루 3번 갱신)",
          tableUnit: "단위: 억 달러 · 3개월(분기) 실적 · 분기 라벨은 분기가 끝난 달의 달력 분기(예: 3Q26 = 2026년 7~9월 사이에 끝난 분기) · 출처: SEC 공시 재무(XBRL). 막 발표한 분기는 분기 보고서(10-Q) 전이라 실적 보도자료(8-K) 손익표에서 바로 채움(못 읽으면 야후)" }
  };
  var M = MK[window.EARN_MARKET === "us" ? "us" : "jp"], U = M.u, IS_US = M === MK.us;
  var BASE = M.base;
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  function cls(v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function pctS(v, d) { if (v == null || !isFinite(v)) return "–"; return (v > 0 ? "+" : "") + (+v).toFixed(d == null ? 1 : d) + "%"; }
  function oku(v) {   // 백만엔 → 억엔
    if (v == null || !isFinite(v)) return "–";
    var x = v / 100, a = Math.abs(x);
    return a >= 100 ? Math.round(x).toLocaleString() : a >= 10 ? x.toFixed(1) : x.toFixed(2);
  }
  function fyLabel(fy, p) {
    if (IS_US) { var mm = /^([A-Za-z]{3})\/(\d{4})$/.exec(p || ""); return mm ? mm[2] + "년 " + ("JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(mm[1]) / 3 + 1) + "월에 끝난 분기" : (p || ""); }
    if (!fy) return p || "";
    var m = fy.split("."); return m[0] + "년 " + (+m[1]) + "월기 " + (p === "FY" || p === "4Q" ? "결산(4Q)" : p);
  }
  var KIND = { tanshin: "결산단신", deck: "설명자료", en: "영문", release: "보도자료", "8k": "SEC 8-K" };
  function mainDoc(R) { return (R.docs || []).filter(function (d) { return d.kind === "tanshin" || d.kind === "release"; })[0]; }
  function mainBtn(d, cls) { return d ? '<a class="btn ' + (cls || "pri") + '" href="' + esc(d.url) + '" target="_blank" rel="noopener">' + (d.kind === "release" ? "📄 실적 보도자료 원문 <small>SEC · 영어</small>" : "📄 결산단신 원문 <small>PDF</small>") + "</a>" : ""; }
  // 원문 제목이 일본어면 한국어 이름으로 보여 준다(링크는 그대로)
  function docTitle(d, R) {
    if (!/[぀-ヿ一-鿿]/.test(d.title || "")) return d.title;
    return (KIND[d.kind] || "공시 자료") + " — " + fyLabel(R.fy, R.period) + " (원문 PDF · 일본어)";
  }
  var UL = { cons: "소비재", major: "주요 기업" };

  /* 가벼운 마크다운(제목·굵게·목록·링크·문단·표) */
  function origBtn(N) {   // 상단 버튼: 아래 '원문 정리 (한글)'을 펼치고 그 자리로 이동
    return N && N.orig_md ? '<a class="btn" href="#orig" onclick="var r=this.closest(\'.jr\')||document,d=r.querySelector(\'details.orig\')||document.querySelector(\'details.orig\');if(d){d.open=true;d.scrollIntoView({behavior:\'smooth\',block:\'start\'});}return false;">🇰🇷 원문 정리 <small>한글</small></a>' : "";
  }
  function md(t) {
    if (!t) return "";
    var out = [], list = null;
    function inl(s) {
      return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    var tb = null;   // 표: | a | b | 줄이 이어지는 동안 모았다가 한 번에 그린다
    function cells(ln) { return ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); }); }
    function flushT() {
      if (!tb) return;
      var rows = tb; tb = null;
      var sep = rows.length > 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(rows[1]) && rows[1].indexOf("-") >= 0;
      var al = sep ? cells(rows[1]).map(function (c) { return /^:-+:$/.test(c) ? "c" : /^:-/.test(c) ? "l" : /-:$/.test(c) ? "r" : ""; }) : [];
      function tr(ln, tag) {
        return "<tr>" + cells(ln).map(function (c, i) { var a = al[i] || (i === 0 ? "l" : "r"); return "<" + tag + ' class="' + a + '">' + inl(c) + "</" + tag + ">"; }).join("") + "</tr>";
      }
      var h = sep ? "<thead>" + tr(rows[0], "th") + "</thead>" : "";
      out.push('<div class="mdt"><table>' + h + "<tbody>" + rows.slice(sep ? 2 : 0).map(function (r) { return tr(r, "td"); }).join("") + "</tbody></table></div>");
    }
    function close() { flushT(); if (list) { out.push("</" + list + ">"); list = null; } }
    String(t).split(/\r?\n/).forEach(function (ln) {
      var m;
      if (/^\s*\|.*\|\s*$/.test(ln)) { if (!tb) { close(); tb = []; } tb.push(ln); return; }
      flushT();
      if (/^\s*$/.test(ln)) { close(); return; }
      if ((m = ln.match(/^(#{2,4})\s+(.*)/))) { close(); var lv = Math.min(4, m[1].length + 1); out.push("<h" + lv + ">" + inl(m[2]) + "</h" + lv + ">"); return; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inl(m[1]) + "</li>"); return; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inl(m[1]) + "</li>"); return; }
      close(); out.push("<p>" + inl(ln) + "</p>");
    });
    close();
    return out.join("");
  }

  /* ── 요약 표: 최근 5개 분기 ── */
  function table(qs) {
    var cols = qs.slice(-5), last = cols.length - 1;
    function head() {
      return "<thead><tr><th></th>" + cols.map(function (q, i) { return '<th class="' + (i === last ? "cur" : "") + '">' + esc(q.cq) + "<small>" + esc(q.label) + "</small></th>"; }).join("") + "</tr></thead>";
    }
    function row(label, fn, kind) {
      return '<tr class="' + kind + '"><td>' + label + "</td>" + cols.map(function (q, i) { var r = fn(q); return '<td class="' + (i === last ? "cur " : "") + (r[1] || "") + '">' + r[0] + "</td>"; }).join("") + "</tr>";
    }
    function g(q, a, k) { var v = q[a] && q[a][k]; return [pctS(v), cls(v)]; }
    var body =
      row("매출", function (q) { return [oku(q.rev)]; }, "main") +
      row("YoY", function (q) { return g(q, "yoy", "rev"); }, "sub") +
      row("QoQ", function (q) { return g(q, "qoq", "rev"); }, "sub") +
      row("영업이익", function (q) { return [oku(q.op), q.op < 0 ? "dn" : ""]; }, "main") +
      row("OPM", function (q) { return [q.opm == null ? "–" : q.opm.toFixed(1) + "%"]; }, "sub") +
      row("YoY", function (q) { return g(q, "yoy", "op"); }, "sub") +
      row("QoQ", function (q) { return g(q, "qoq", "op"); }, "sub") +
      row("당기순이익", function (q) { return [oku(q.ni), q.ni < 0 ? "dn" : ""]; }, "main") +
      row("YoY", function (q) { return g(q, "yoy", "ni"); }, "sub") +
      row("QoQ", function (q) { return g(q, "qoq", "ni"); }, "sub");
    return '<div class="tbl"><table class="ft">' + head() + "<tbody>" + body + "</tbody></table></div>" +
      '<div class="unit">' + esc(M.tableUnit) + "</div>";
  }

  /* ── 핵심 수치 카드 ── */
  function facts(R) {
    var r = R.rec || {}, f = [];
    function card(k, v, c, s) { f.push('<div class="fact"><div class="k">' + k + '</div><div class="v ' + (c || "") + '">' + v + "</div>" + (s ? '<div class="s">' + s + "</div>" : "") + "</div>"); }
    if (r.beat) card("회사 가이던스 대비(" + ({ op: "영업이익", ord: "경상이익", ni: "순이익" }[r.beat.basis] || r.beat.basis) + ")", pctS(r.beat.pct), cls(r.beat.pct), "직전 회사 예상 대비 실제 통기 실적" + (r.beat.rev_pct != null ? " · 매출 " + pctS(r.beat.rev_pct) : ""));
    if (r.progress) card("통기 계획 대비 진척률", r.progress.pct + "%", "", (r.progress.avg != null ? r.progress.avg_src + " " + r.progress.avg + "% → " : "") + (r.progress.diff != null ? '<span class="' + cls(r.progress.diff) + '">' + (r.progress.diff > 0 ? "+" : "") + r.progress.diff + "%p</span>" : "") + (r.progress.basis === "op" ? " (영업이익 기준)" : " (경상이익 기준)"));
    if (r.revision) card("통기 가이던스", r.revision.kept ? "유지" : pctS(r.revision.pct), r.revision.kept ? "" : cls(r.revision.pct), r.revision.kept ? "이번 발표에서 수정 없음" : "이번 발표에서 수정(" + ({ op: "영업", ord: "경상" }[r.revision.basis] || "") + ")" + (r.revision.rev_pct != null ? " · 매출 " + pctS(r.revision.rev_pct) : ""));
    if (r.next_guide) card("다음 기 회사 예상(영업이익)", pctS(r.next_guide.op_g), cls(r.next_guide.op_g), r.next_guide.fy + " · 매출 " + pctS(r.next_guide.rev_g) + " · 영업 " + oku(r.next_guide.op) + U);
    if (r.cons && r.cons.pct != null) card("EPS 컨센서스 대비", pctS(r.cons.pct), cls(r.cons.pct), "실제 " + r.cons.eps + " vs 예상 " + r.cons.est + (IS_US ? " 달러(야후)" : "(야후)"));
    if (r.px) card("발표 후 주가 반응", r.px.d1 == null ? "대기" : pctS(r.px.d1), cls(r.px.d1), r.px.d1 == null ? "반응일 장이 열리면 바로 표시" : (r.px.d1_live ? "장중 현재가 (" + esc(r.px.d1_at || "") + ")" : "발표 직전 종가 대비 첫 거래일") + " · 5거래일 " + pctS(r.px.d5));
    return f.length ? '<div class="facts">' + f.join("") + "</div>" : "";
  }

  /* ── 그래프 ── */
  function niceStep(span, n) { var r = span / (n || 5), p = Math.pow(10, Math.floor(Math.log10(r || 1))), q = r / p; return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p; }
  function barLine(qs, W) {   // 매출 막대 + 영업이익 막대 + 영업이익률 선(오른쪽 축)
    W = W || 520; var H = 250, m = { l: 48, r: 40, t: 14, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var vals = []; qs.forEach(function (q) { vals.push(q.rev || 0, q.op || 0); });
    var hi = Math.max.apply(null, vals.concat([1])) / 100, lo = Math.min(0, Math.min.apply(null, vals) / 100);
    var st = niceStep(hi - lo); hi = Math.ceil(hi / st) * st; lo = Math.floor(lo / st) * st || lo;
    var opms = qs.map(function (q) { return q.opm; }).filter(function (v) { return v != null; });
    var ph = Math.max.apply(null, opms.concat([5])), pl = Math.min.apply(null, opms.concat([0])); ph = Math.ceil(ph / 5) * 5; pl = Math.floor(pl / 5) * 5;
    function y(v) { return m.t + (hi - v) / (hi - lo) * ih; }
    function yp(v) { return m.t + (ph - v) / ((ph - pl) || 1) * ih; }
    var bw = iw / qs.length, g = "";
    for (var t = lo; t <= hi + 1e-9; t += st) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (m.l - 5) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + Math.round(t).toLocaleString() + "</text>";
    [pl, (pl + ph) / 2, ph].forEach(function (p) { g += '<text x="' + (W - m.r + 5) + '" y="' + (yp(p) + 3) + '">' + Math.round(p) + "%</text>"; });
    qs.forEach(function (q, i) {
      var x = m.l + i * bw, w = bw * .34;
      if (q.rev != null) g += '<rect x="' + (x + bw * .14) + '" y="' + y(Math.max(0, q.rev / 100)) + '" width="' + w + '" height="' + Math.abs(y(q.rev / 100) - y(0)) + '" fill="#4f7cff" opacity=".85"><title>' + q.cq + " 매출 " + oku(q.rev) + U + "</title></rect>";
      if (q.op != null) g += '<rect x="' + (x + bw * .14 + w + 2) + '" y="' + y(Math.max(0, q.op / 100)) + '" width="' + w + '" height="' + Math.abs(y(q.op / 100) - y(0)) + '" fill="' + (q.op >= 0 ? "#f0a53a" : "#3d7eff") + '"><title>' + q.cq + " 영업이익 " + oku(q.op) + U + "</title></rect>";
      g += '<text x="' + (x + bw / 2) + '" y="' + (H - 18) + '" text-anchor="middle">' + q.cq + "</text>";
    });
    var pts = qs.map(function (q, i) { return q.opm == null ? null : [m.l + i * bw + bw / 2, yp(q.opm)]; });
    var d = ""; pts.forEach(function (p) { if (p) d += (d ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); });
    g += '<path d="' + d + '" fill="none" stroke="#f0475a" stroke-width="2"/>';
    pts.forEach(function (p, i) { if (p) g += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#f0475a"><title>' + qs[i].cq + " OPM " + qs[i].opm + "%</title></circle>"; });
    g += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="분기 매출·영업이익·영업이익률">' + g + "</svg>" +
      '<div class="lg"><span><i style="background:#4f7cff"></i>매출(' + U + ')</span><span><i style="background:#f0a53a"></i>영업이익(' + U + ')</span><span><i class="ln" style="border-color:#f0475a"></i>영업이익률(오른쪽 축)</span></div>';
  }
  function yoyLines(qs, W) {
    W = W || 520; var H = 230, m = { l: 44, r: 12, t: 14, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var ser = [["rev", "매출", "#4f7cff"], ["op", "영업이익", "#f0a53a"], ["ni", "순이익", "#9b7bff"]];
    var vals = []; qs.forEach(function (q) { ser.forEach(function (s) { var v = q.yoy && q.yoy[s[0]]; if (v != null && isFinite(v)) vals.push(Math.max(-100, Math.min(200, v))); }); });
    if (!vals.length) return '<div class="empty">YoY를 계산할 전년 분기가 부족합니다.</div>';
    var hi = Math.max(10, Math.max.apply(null, vals)), lo = Math.min(-10, Math.min.apply(null, vals)), st = niceStep(hi - lo); hi = Math.ceil(hi / st) * st; lo = Math.floor(lo / st) * st;
    function x(i) { return m.l + (qs.length === 1 ? iw / 2 : i / (qs.length - 1) * iw); }
    function y(v) { return m.t + (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo) * ih; }
    var g = "";
    for (var t = lo; t <= hi + 1e-9; t += st) g += '<line class="' + (Math.abs(t) < 1e-9 ? "axis" : "grid") + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (m.l - 5) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + (t > 0 ? "+" : "") + Math.round(t) + "%</text>";
    qs.forEach(function (q, i) { g += '<text x="' + x(i) + '" y="' + (H - 18) + '" text-anchor="middle">' + q.cq + "</text>"; });
    ser.forEach(function (s) {
      var d = "", pen = false;
      qs.forEach(function (q, i) { var v = q.yoy && q.yoy[s[0]]; if (v == null || !isFinite(v)) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1); pen = true; g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="2.6" fill="' + s[2] + '"><title>' + q.cq + " " + s[1] + " YoY " + pctS(v) + "</title></circle>"; });
      g += '<path d="' + d + '" fill="none" stroke="' + s[2] + '" stroke-width="2"/>';
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="전년 동기 대비 성장률">' + g + "</svg>" +
      '<div class="lg">' + ser.map(function (s) { return '<span><i class="ln" style="border-color:' + s[2] + '"></i>' + s[1] + " YoY</span>"; }).join("") + "<span>(±200% 밖은 잘라서 표시)</span></div>";
  }
  function annual(ann, W) {
    W = W || 1040; var H = 240, m = { l: 56, r: 12, t: 14, b: 34 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    if (!ann || !ann.length) return '<div class="empty">연간 실적 없음</div>';
    var hi = Math.max.apply(null, ann.map(function (a) { return (a.rev || 0) / 100; }).concat([1])), lo = Math.min(0, Math.min.apply(null, ann.map(function (a) { return (a.op || 0) / 100; })));
    var st = niceStep(hi - lo); hi = Math.ceil(hi / st) * st;
    function y(v) { return m.t + (hi - v) / (hi - lo) * ih; }
    var bw = iw / ann.length, g = "";
    for (var t = lo; t <= hi + 1e-9; t += st) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (m.l - 5) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + Math.round(t).toLocaleString() + "</text>";
    ann.forEach(function (a, i) {
      var x = m.l + i * bw, w = Math.min(46, bw * .32), op = a.est ? ' fill-opacity=".35" stroke-dasharray="3 2"' : "";
      if (a.rev != null) g += '<rect x="' + (x + bw / 2 - w - 1) + '" y="' + y(Math.max(0, a.rev / 100)) + '" width="' + w + '" height="' + Math.abs(y(a.rev / 100) - y(0)) + '" fill="#4f7cff" stroke="#4f7cff"' + op + "><title>" + a.fy + (a.est ? " 회사 예상" : "") + " 매출 " + oku(a.rev) + U + "</title></rect>";
      if (a.op != null) g += '<rect x="' + (x + bw / 2 + 1) + '" y="' + y(Math.max(0, a.op / 100)) + '" width="' + w + '" height="' + Math.abs(y(a.op / 100) - y(0)) + '" fill="#f0a53a" stroke="#f0a53a"' + op + "><title>" + a.fy + (a.est ? " 회사 예상" : "") + " 영업이익 " + oku(a.op) + U + "</title></rect>";
      g += '<text x="' + (x + bw / 2) + '" y="' + (H - 18) + '" text-anchor="middle">' + a.fy + (a.est ? " 예" : "") + "</text>";
    });
    g += '<line class="axis" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="연간 실적과 회사 예상">' + g + "</svg>" +
      '<div class="lg"><span><i style="background:#4f7cff"></i>매출(' + U + ')</span><span><i style="background:#f0a53a"></i>영업이익(' + U + ')</span><span><i style="background:rgba(79,124,255,.35);border:1px dashed #4f7cff"></i>옅은 막대 = 회사 예상(予)</span></div>';
  }

  /* ── 주가(일봉) · 구글 트렌드: 리포트를 그린 뒤 hydrate(root, R)로 채운다 ── */
  function dayStr(d) { return new Date(d * 86400000).toISOString().slice(0, 10); }
  function toDay(s) { return Math.round(Date.parse(s + "T00:00:00Z") / 86400000); }
  function lineChart(pts, marks, opt) {   // pts: [[에폭일, 값]], marks: [{x, short, label, cur}]
    var W = 1040, H = opt.h || 240, m = { l: 56, r: 14, t: 20, b: 28 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    var ys = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
    var pad = (hi - lo) * 0.08 || 1;
    if (opt.zero) { lo = 0; hi = Math.max(hi, 1); } else { lo = Math.max(0, lo - pad); hi += pad; }
    function X(v) { return m.l + (v - x0) / ((x1 - x0) || 1) * iw; }
    function Y(v) { return m.t + (hi - v) / ((hi - lo) || 1) * ih; }
    var st = niceStep(hi - lo, 4), g = "";
    for (var t = Math.ceil(lo / st) * st; t <= hi + 1e-9; t += st) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(t) + '" y2="' + Y(t) + '"/><text x="' + (m.l - 5) + '" y="' + (Y(t) + 3) + '" text-anchor="end">' + Math.round(t).toLocaleString() + "</text>";
    var yr0 = new Date(x0 * 86400000).getUTCFullYear(), yr1 = new Date(x1 * 86400000).getUTCFullYear(), span = x1 - x0;
    for (var yr = yr0; yr <= yr1; yr++) (span > 1200 ? [0] : [0, 6]).forEach(function (mo) {
      var d = Date.UTC(yr, mo, 1) / 86400000; if (d < x0 || d > x1) return;
      g += '<text x="' + X(d) + '" y="' + (H - 8) + '" text-anchor="middle">' + (mo === 0 ? yr : yr + ".07") + "</text>";
    });
    (marks || []).forEach(function (k) {
      if (k.x < x0 || k.x > x1) return;
      g += '<line x1="' + X(k.x) + '" x2="' + X(k.x) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="' + (k.cur ? "#f0a53a" : "var(--border-strong)") + '" stroke-dasharray="3 3" stroke-width="' + (k.cur ? 1.6 : 1) + '"><title>' + esc(k.label) + "</title></line>" +
        '<text x="' + X(k.x) + '" y="' + (m.t - 6) + '" text-anchor="middle"' + (k.cur ? ' style="fill:#f0a53a;font-weight:700"' : "") + ">" + esc(k.short) + "</text>";
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1); }).join("");
    g += '<path d="' + d + '" fill="none" stroke="' + opt.color + '" stroke-width="1.8"/>';
    var lp = pts[pts.length - 1]; g += '<circle cx="' + X(lp[0]) + '" cy="' + Y(lp[1]) + '" r="3" fill="' + opt.color + '"/>';
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(opt.label) + '">' + g + "</svg>";
  }
  function markList(R) {
    return (R.qs || []).filter(function (q) { return q.date; }).map(function (q) {
      return { x: toDay(q.date), short: q.cq, label: q.cq + " 실적 발표 " + q.date, cur: q.date === R.date };
    });
  }
  function pxAt(b, day) { var v = null; for (var i = 0; i < b.length; i++) { if (b[i][0] <= day) v = b[i][1]; else break; } return v; }
  function hydrate(root, R) {
    root = root || document;
    var pe = root.querySelector(".jr-px");
    if (pe) getJSON(M.px(pe.dataset.code)).then(function (P) {
      var b = M.pxConv(P); if (b.length < 2) throw 0;
      var last = b[b.length - 1], y1 = pxAt(b, last[0] - 365), r0 = R && R.date ? pxAt(b, toDay(R.date) - 1) : null;
      var s = "현재 <b>" + last[1].toLocaleString() + " " + M.cur + "</b> (" + dayStr(last[0]) + ")" +
        (y1 ? ' · 1년 <span class="' + cls(last[1] / y1 - 1) + '">' + pctS((last[1] / y1 - 1) * 100) + "</span>" : "") +
        (r0 ? ' · 이번 발표 전날 대비 <span class="' + cls(last[1] / r0 - 1) + '">' + pctS((last[1] / r0 - 1) * 100) + "</span>" : "");
      pe.querySelector(".empty").outerHTML = '<div class="pxs">' + s + "</div>" + lineChart(b, R ? markList(R) : [], { color: "#4f7cff", label: "최근 2년 주가" }) +
        '<div class="unit">출처: ' + esc(M.pxSrc) + " · 주황 세로선 = 이번 실적 발표</div>";
    }).catch(function () { var e = pe.querySelector(".empty"); if (e) e.textContent = "주가 데이터가 아직 없습니다(평일 장 마감 후 자동 수집)."; });
    var te = root.querySelector(".jr-tr");
    if (te) getJSON("data/jp/trends/" + te.dataset.code + ".json").then(function (T) {
      var pts = (T.pts || []).map(function (p) { return [toDay(p[0]), p[1]]; });
      if (pts.length < 2) throw 0;
      te.hidden = false;
      te.querySelector(".empty").outerHTML = '<div class="pxs">검색어 <b>' + esc(te.dataset.label || T.kw.join(", ")) + "</b> · 5년 중 가장 많이 검색된 주 = 100</div>" +
        lineChart(pts, R ? markList(R) : [], { color: "#2fb37a", label: "구글 트렌드", zero: true, h: 200 }) +
        '<div class="unit">출처: <a href="' + esc(T.url) + '" target="_blank" rel="noopener">구글 트렌드</a>(일본) · 주 1회 갱신 · 마지막 주는 집계 중 · ' + esc(T.asof) + "</div>";
    }).catch(function () {});
  }

  /* ── 리포트 1건: embed=true 면 일본 스크리너 종목 창 안에 넣는 모양(기업명 머리글 없음) ── */
  function reportHTML(R, N, embed) {
    var r = R.rec || {}, qs = R.qs || [], cur = qs[qs.length - 1] || {};
    var tan = mainDoc(R);
    var ext = IS_US
      ? '<a class="btn" href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + esc(R.code) + '&type=8-K" target="_blank" rel="noopener">🏛 SEC 공시 목록</a>' +
        '<a class="btn" href="datahub.html#us=' + esc(R.code) + '">📊 데이터 허브</a>'
      : '<a class="btn" href="https://kabutan.jp/stock/finance?code=' + esc(R.code) + '" target="_blank" rel="noopener">📊 카부탄 결산 표</a>';
    var kick = IS_US
      ? '<div class="kicker"><a href="us-report.html">미국 실적 리포트</a> · ' + esc(R.cat || "") + "</div>"
      : '<div class="kicker"><a href="jp-screener.html' + ((R.u || []).indexOf("cons") < 0 ? "?u=major" : "") + '">일본 기업 스크리너</a> · <a href="jp-report.html">실적 리포트</a> · ' + (R.u || []).map(function (u) { return UL[u]; }).join("·") + "</div>";
    var tmS = r.time ? " " + esc(IS_US ? ({ pre: "장 전", after: "장 마감 후", na: "" }[r.time] || "") : r.time) : "";
    var html = embed
      ? '<div class="sub"><b>' + esc(fyLabel(R.fy, R.period)) + "</b> · " + esc(cur.cq || "") + " (" + esc(cur.label || "") + ") · 발표 <b>" + esc(R.date) + tmS + "</b></div>" +
        '<div class="acts">' + mainBtn(tan) + origBtn(N) +
        (r.url ? '<a class="btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">📰 카부탄 속보</a>' : "") +
        '<a class="btn" href="' + M.page + '?id=' + encodeURIComponent(R.rid) + '" target="_blank" rel="noopener">↗ 리포트 페이지(공유용)</a></div>'
      :
      kick +
      "<h1>" + esc(R.name || R.code) + '<span class="code">' + esc(R.code) + "</span></h1>" +
      '<div class="sub"><b>' + esc(fyLabel(R.fy, R.period)) + "</b> · " + esc(cur.cq || "") + " (" + esc(cur.label || "") + ") · 발표 <b>" + esc(R.date) + tmS + "</b>" + (R.cat ? " · " + esc(R.cat) : "") + (R.mcap ? " · 시총 " + Math.round(R.mcap).toLocaleString() + U : "") + "</div>" +
      '<div class="acts">' + mainBtn(tan) + origBtn(N) +
      (r.url ? '<a class="btn" href="' + esc(r.url) + '" target="_blank" rel="noopener">📰 카부탄 속보</a>' : "") + ext +
      '<button class="btn" id="copy">🔗 링크 복사</button></div>';
    html += body(R, N, qs, r);
    return html;
  }
  function body(R, N, qs, r) {
    var html = "";
    if (N && (N.about || (N.issues && N.issues.length))) {
      html += '<section class="brief card">' +
        (N.about ? "<h3>뭐 하는 기업인가?</h3>" + md(N.about) : "") +
        (N.issues && N.issues.length ? "<h3>최근 이슈</h3><ul>" + N.issues.map(function (t) { return "<li>" + md(t).replace(/^<p>|<\/p>$/g, "") + "</li>"; }).join("") + "</ul>" : "") + "</section>";
    }
    // ① 요약
    html += '<section data-sec="sum"><h2>① 요약 <span class="hint">표 → 핵심 수치 → 요약</span></h2>' + (qs.length ? table(qs) : '<div class="empty">분기 실적 표가 없습니다.</div>') + facts(R) +
      (N && N.summary_md ? '<div class="note card">' + (N.headline ? "<h3>" + esc(N.headline) + "</h3>" : "") + md(N.summary_md) + "</div>"
        : '<div class="pending">📝 요약 글은 아직 없습니다. ' + (IS_US ? "발표 당일 SEC에 올라온 실적 보도자료 원문을 읽고 한글 원문 정리와 딥리서치 분석을 붙입니다(시총 큰 순)." : "실적 시즌에는 발표 당일 결산단신 원문을 읽고 한글 원문 정리와 딥리서치 분석을 붙입니다(주요 기업·시총 큰 순).") + " 위 표와 수치는 발표 직후 자동으로 채워집니다.</div>") + "</section>";
    // ② 분석
    html += '<section data-sec="ana"><h2>② 딥리서치 분석 <span class="hint">그래프 → 결론 · 핵심 포인트 · 사업별 · 이익률 · 가이던스 · 업계 비교 · 주가 · 리스크 · 체크포인트</span></h2><div class="charts">' +
      '<div class="card chart"><h4>분기 매출 · 영업이익 · 영업이익률</h4>' + barLine(qs) + "</div>" +
      '<div class="card chart"><h4>전년 동기 대비 성장률(YoY)</h4>' + yoyLines(qs) + "</div>" +
      '<div class="card chart wide"><h4>연간 실적과 회사 예상</h4>' + annual(R.ann) + "</div>" +
      '<div class="card chart wide jr-px" data-code="' + esc(R.code) + '"><h4>주가 <span class="hint">최근 2년 일봉 · 세로선 = 실적 발표일</span></h4><div class="empty">주가 불러오는 중…</div></div>' +
      ((R.u || []).indexOf("cons") >= 0 ? '<div class="card chart wide jr-tr" data-code="' + esc(R.code) + '" data-label="' + esc((N && N.trend_label) || "") + '" hidden><h4>구글 트렌드 <span class="hint">일본 검색 관심도 · 최근 5년 주간</span></h4><div class="empty"></div></div>' : "") +
      "</div>" +
      (N && N.analysis_md ? '<div class="note card deep">' + md(N.analysis_md) + "</div>" : "") + "</section>";
    // ③ 원문
    var tan = mainDoc(R);
    var pdfBtn = tan ? '<a class="btn pri" href="' + esc(tan.url) + '" target="_blank" rel="noopener">📄 원문 열기 <small>' + (IS_US ? "영어" : "일본어") + "</small></a>" : "";
    html += '<section data-sec="orig"><h2>③ 원문 <span class="hint">' + (IS_US ? "한글 정리 → SEC 8-K 실적 보도자료(EX-99.1)" : "한글 정리 → TDnet 공시 PDF(카부탄 보관본)") + "</span></h2>" +
      (N && N.orig_md ? '<details class="orig card"><summary><b>원문 정리 (한글)</b><span class="hint">' + (IS_US ? "보도자료를 원문 순서대로 — 요약 수치 · 경영진 코멘트 · 사업부별 · 가이던스 · 손익·재무상태·현금흐름 표" : "결산단신을 원문 순서대로 — 표지 요약표 · 경영성적 · 세그먼트 · 재정상태 · 통기 예상 · 주석") + "</span></summary>" +
        '<div class="orig-top"><span>원문을 문장 그대로 옮긴 번역이 아니라 <b>숫자와 표는 전부, 설명 글은 줄여서 다시 쓴 정리</b>입니다. 정확한 문구는 원문에서 확인하세요.</span>' + pdfBtn + "</div>" +
        '<div class="note">' + md(N.orig_md) + "</div>" +
        (pdfBtn ? '<div class="orig-end">' + pdfBtn + "</div>" : "") + "</details>" : "") +
      ((R.docs || []).length ? '<div class="docs">' + R.docs.map(function (d) { return '<div class="doc"><span class="tag">' + (KIND[d.kind] || d.kind) + '</span><a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(docTitle(d, R)) + "</a></div>"; }).join("") + "</div>"
        : '<div class="empty">원문 링크를 아직 찾지 못했습니다 — ' + (IS_US ? '<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + esc(R.code) + '&type=8-K" target="_blank" rel="noopener">SEC 8-K 목록</a>' : '<a href="https://kabutan.jp/stock/news?code=' + esc(R.code) + '&nmode=3" target="_blank" rel="noopener">카부탄 개시 목록</a>') + "에서 확인하세요.</div>") +
      (N && N.sources && N.sources.length ? '<div class="unit">요약·분석 참고: ' + N.sources.map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.label) + "</a>"; }).join(" · ") + "</div>" : "") +
      '<div class="unit">리포트 데이터 갱신 ' + esc(R.updated || "") + (N && N.written ? " · 요약 작성 " + esc(N.written) : "") + " · 투자 권유가 아닌 공시 정리입니다.</div></section>";
    return html;
  }
  function renderReport(R, N) {
    var cur = (R.qs || [])[(R.qs || []).length - 1] || {};
    document.title = (R.name || R.code) + " " + (cur.cq || "") + " 실적 — 100억";
    app.innerHTML = reportHTML(R, N, false);
    hydrate(app, R);
    var cp = document.getElementById("copy");
    if (cp) cp.onclick = function () { try { navigator.clipboard.writeText(location.href); cp.textContent = "✓ 복사됨"; } catch (e) { cp.textContent = location.href; } };
    // 텔레그램 링크 바로가기: ?id=…#sum(요약) · #ana(분석) · #orig(원문 정리 펼침)
    var sec = location.hash.slice(1), el = sec && app.querySelector('section[data-sec="' + sec + '"]');
    if (el) {
      var d = sec === "orig" && el.querySelector("details.orig");
      if (d) d.open = true;
      setTimeout(function () { (d || el).scrollIntoView({ block: "start" }); }, 60);
    }
  }

  /* ── 목록 ── */
  var LS = IS_US ? "us-report-list" : "jp-report-list";
  function renderList(IX) {
    var st = { u: "all", q: "", note: false, n: 60 };
    try { var sv = JSON.parse(localStorage.getItem(LS) || "null"); if (sv) { st.u = sv.u || "all"; st.note = !!sv.note; } } catch (e) {}
    var qp = new URLSearchParams(location.search); if (qp.get("u")) st.u = qp.get("u");
    app.innerHTML = (IS_US
      ? '<div class="kicker"><a href="datahub.html">데이터 허브</a> · 실적 리포트</div><h1>미국 실적 리포트</h1>' +
        '<div class="sub">데이터 허브 미국·해외 기업의 실적 발표마다 <b>분기 표 · 핵심 수치 · 그래프 · SEC 보도자료 원문</b>을 한 장에 모읍니다. 발표 예정일은 나스닥 거래소 캘린더(하루 2번 갱신), 실제 발표는 SEC 8-K(실적 공시)로 확인해 바로 만들고, 요약 글은 그 뒤에 붙습니다. · 갱신 ' + esc(IX.updated || "") + "</div>" +
        '<section class="cal" id="cal"><div class="empty">발표 예정 불러오는 중…</div></section>'
      : '<div class="kicker"><a href="jp-screener.html">일본 기업 스크리너</a> · 실적 리포트</div><h1>일본 실적 리포트</h1>' +
        '<div class="sub">발표된 실적마다 <b>분기 표 · 핵심 수치 · 그래프 · 결산단신 원문</b>을 한 장에 모읍니다. 발표 예정일은 도쿄증권거래소(JPX) 공식 목록, 실적 시즌 평일에는 하루 6번 수집하고 요약 글은 그 뒤에 붙습니다. · 갱신 ' + esc(IX.updated || "") + "</div>") +
      '<div class="ctl">' + (IS_US ? "" : '<div class="seg" id="u"><button data-v="all">전체</button><button data-v="cons">소비재</button><button data-v="major">주요 기업</button></div>') +
      '<div class="seg" id="nt"><button data-v="0">전부</button><button data-v="1">요약 완료만</button></div>' +
      '<input type="search" id="q" placeholder="기업명 · 코드"><span class="sub" id="cnt"></span></div><div class="list" id="list"></div><button class="btn more" id="more" hidden>더 보기</button>';
    function draw() {
      try { localStorage.setItem(LS, JSON.stringify({ u: st.u, note: st.note })); } catch (e) {}
      document.querySelectorAll("#u button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === st.u); });
      document.querySelectorAll("#nt button").forEach(function (b) { b.classList.toggle("on", (b.dataset.v === "1") === st.note); });
      var q = st.q.toLowerCase();
      var rows = (IX.reports || []).filter(function (r) {
        return (st.u === "all" || (r.u || []).indexOf(st.u) >= 0) && (!st.note || r.note) && (!q || (r.n || "").toLowerCase().indexOf(q) >= 0 || r.c.toLowerCase().indexOf(q) >= 0);
      });
      document.getElementById("cnt").textContent = rows.length + "건";
      var head = '<div class="row head"><span>발표일</span><span>기업</span><span>분기</span><span class="num hide-m">매출 YoY</span><span class="num">영업 YoY</span><span class="num hide-m">발표 후 주가</span><span class="st">요약</span></div>';
      document.getElementById("list").innerHTML = rows.length ? head + rows.slice(0, st.n).map(function (r) {
        return '<a class="row" href="' + M.page + '?id=' + encodeURIComponent(r.rid) + '"><span class="d">' + r.d.slice(2) + '</span><span class="nm"><b>' + esc(r.n || r.c) + "</b><small>" + esc(r.c) + (r.cat ? " · " + esc(r.cat) : "") + '</small></span><span class="d">' + esc(r.cq || r.p || "") + "</span>" +
          '<span class="num hide-m ' + cls(r.rev_yoy) + '">' + pctS(r.rev_yoy) + '</span><span class="num ' + cls(r.op_yoy) + '">' + pctS(r.op_yoy) + '</span><span class="num hide-m ' + cls(r.d1) + '">' + pctS(r.d1) + '</span><span class="st">' + (r.note ? '<span class="pill ok">요약</span>' : '<span class="pill no">표·그래프</span>') + "</span></a>";
      }).join("") : '<div class="empty">조건에 맞는 리포트가 없습니다.</div>';
      document.getElementById("more").hidden = rows.length <= st.n;
    }
    if (IS_US) drawCal(IX);
    if (document.getElementById("u")) document.getElementById("u").onclick = function (e) { var b = e.target.closest("button"); if (b) { st.u = b.dataset.v; st.n = 60; draw(); } };
    document.getElementById("nt").onclick = function (e) { var b = e.target.closest("button"); if (b) { st.note = b.dataset.v === "1"; st.n = 60; draw(); } };
    var tq; document.getElementById("q").oninput = function (e) { clearTimeout(tq); tq = setTimeout(function () { st.q = e.target.value.trim(); st.n = 60; draw(); }, 150); };
    document.getElementById("more").onclick = function () { st.n += 60; draw(); };
    draw();
  }

  /* 미국: 주간 실적 발표 캘린더(일본 스크리너와 같은 모양) — 월~금 칸, ‹ 이전 주 · 다음 주 ›
     데이터: data/us/earnings_dates.json(나스닥 거래소 캘린더 + 야후 교차 확인) + 리포트 목록(발표 후 주가·컨센서스)
     카드를 누르면 관심 기업(노란색)으로 저장 — localStorage "vantage-us-earn-watch-v1"(firebase-sync.js 가 기기 간 동기화)
     정렬: 관심 기업 → 기술주(정보기술·커뮤니케이션) → 시총 큰 순 */
  /* 관심 기업은 이미 클라우드 동기화가 허용된 키(데이터 허브 관심 기업)의 us 칸에 둔다 — 새 키는 보안 규칙에 막혀 동기화 오류가 났다 */
  var WKEY = "vantage-datahub-favorite-companies-v1", TECH = { "Information Technology": 1, "Communication Services": 1 };
  function loadFav() { try { var v = JSON.parse(localStorage.getItem(WKEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }
  function loadWatch() {
    var v = loadFav(), us = Array.isArray(v.us) ? v.us : [];
    try { var old = JSON.parse(localStorage.getItem("vantage-us-earn-watch-v1") || "[]"); if (Array.isArray(old) && old.length) { us = us.concat(old.filter(function (t) { return us.indexOf(t) < 0; })); localStorage.removeItem("vantage-us-earn-watch-v1"); saveWatch(us); } } catch (e) {}
    return us;
  }
  function saveWatch(a) { try { var v = loadFav(); v.us = a; localStorage.setItem(WKEY, JSON.stringify(v)); } catch (e) {} }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function monday(dstr) { var d = new Date(dstr + "T00:00:00Z"), w = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((w + 6) % 7)); return ymd(d); }
  function addDays(dstr, n) { var d = new Date(dstr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function drawCal(IX) {
    var box = document.getElementById("cal"); if (!box) return;
    getJSON("data/us/earnings_dates.json").then(function (D) {
      var rep = {}; (IX && IX.reports || []).forEach(function (r) { if (!rep[r.c] || r.d > rep[r.c].d) rep[r.c] = r; });
      var ev = {};   // 날짜 → [{t, ...}]
      function put(date, t, x, kind) {
        if (!date) return;
        var L = ev[date] = ev[date] || [];
        if (L.some(function (y) { return y.t === t; })) return;
        var e = D.dates[t] || {}, r = rep[t] && rep[t].d === date ? rep[t] : null;
        L.push({ t: t, n: e.name || (r && r.n) || t, tm: (x || {}).time, fq: (x || {}).fq, eps: (x || {}).eps_fc, kind: kind, r: r,
                 sec: e.sector, mc: e.mcap || (r && r.mc) || 0, chk: e.check, y: e.yahoo, nx: e.next, src: (x || {}).src });
      }
      Object.keys(D.dates || {}).forEach(function (t) { var e = D.dates[t]; put((e.last || {}).date, t, e.last, "last"); put((e.next || {}).date, t, e.next, "next"); });
      (IX && IX.reports || []).forEach(function (r) { put(r.d, r.c, null, "rep"); });
      var all = Object.keys(ev).sort();
      var today = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);   // 미 동부 날짜
      var minW = all.length ? monday(all[0]) : monday(today), maxW = all.length ? monday(all[all.length - 1]) : monday(today);
      var st = { w: monday(today), open: {} };
      try { var sv = sessionStorage.getItem("us-cal-week"); if (sv && sv >= minW && sv <= maxW) st.w = sv; } catch (e) {}
      var TM = { pre: "장 전", after: "장 후" };
      function sorter(W) { return function (a, b) { var wa = W.indexOf(a.t) >= 0, wb = W.indexOf(b.t) >= 0; if (wa !== wb) return wa ? -1 : 1; var ta = !!TECH[a.sec], tb = !!TECH[b.sec]; if (ta !== tb) return ta ? -1 : 1; return (b.mc || 0) - (a.mc || 0); }; }
      function card(x, W) {
        var on = W.indexOf(x.t) >= 0, r = x.r, b = [];
        if (r) {
          b.push(r.d1 == null ? '<em class="rb px">주가 반응 대기</em>' : '<em class="rb px big ' + cls(r.d1) + '">발표 후 ' + pctS(r.d1) + "</em>");
          if (r.cons != null) b.push('<em class="rb ' + cls(r.cons) + '">컨센 ' + pctS(r.cons) + "</em>");
        }
        var flag = "";
        if (x.chk === "mismatch" && x.kind === "next" && x.y) flag = '<span class="cf warn" title="나스닥 ' + esc(x.nx && x.nx.date) + " · 야후 " + esc(x.y.date) + (x.y.confirmed ? "(확정)" : "(추정)") + ' — 더 이른 날부터 SEC 공시를 확인합니다">날짜 확인</span>';
        else if (x.src === "yahoo" && x.kind === "next") flag = '<span class="cf" title="나스닥 캘린더에 아직 없음 — 야후 ' + (x.y && x.y.confirmed ? "확정" : "추정") + ' 날짜">' + (x.y && x.y.confirmed ? "야후" : "예상") + "</span>";
        return '<div class="ce' + (on ? " on" : "") + '" data-t="' + esc(x.t) + '" title="' + esc(x.n + (x.sec ? " · " + x.sec : "") + (x.fq ? " · 분기 " + x.fq : "") + (x.eps ? " · EPS 컨센서스 " + x.eps : "") + " — 눌러서 관심 기업 표시/해제") + '">' +
          '<div class="ce-h"><span class="ce-st">' + (on ? "★" : "") + '</span><b>' + esc(x.t) + '</b><span class="ce-n">' + esc(x.n) + "</span>" + (TM[x.tm] ? '<i class="ce-tm">' + TM[x.tm] + "</i>" : "") + flag + "</div>" +
          (b.length ? '<div class="ce-b">' + b.join("") + "</div>" : "") +
          (r ? '<a class="ce-rep" href="' + M.page + "?id=" + encodeURIComponent(r.rid) + '">실적 리포트 ›</a>' : "") + "</div>";
      }
      function draw() {
        var W = loadWatch(), days = [0, 1, 2, 3, 4].map(function (k) { return addDays(st.w, k); });
        var mo = +st.w.slice(5, 7), wk = Math.ceil(+st.w.slice(8, 10) / 7);
        var cols = days.map(function (d) {
          var L = (ev[d] || []).slice().sort(sorter(W)), lim = st.open[d] ? L.length : 12;
          var wd = "일월화수목금토".charAt(new Date(d + "T00:00:00Z").getUTCDay());
          return '<div class="cd' + (d === today ? " today" : "") + '"><div class="cd-h"><b>' + d.slice(5).replace("-", ".") + "(" + wd + ")</b><span>" + (d === today ? "오늘 · " : "") + L.length + "곳</span></div>" +
            (L.length ? L.slice(0, lim).map(function (x) { return card(x, W); }).join("") : '<div class="cd-empty">발표 없음</div>') +
            (L.length > lim ? '<button class="cd-more" data-d="' + d + '">+ ' + (L.length - lim) + "곳 더 보기</button>" : "") + "</div>";
        }).join("");
        box.innerHTML = '<div class="cw-top"><button class="btn" id="cwPrev"' + (st.w <= minW ? " disabled" : "") + '>‹ 이전 주</button>' +
          '<div class="cw-t"><b>' + mo + "월 " + wk + "주차</b> <span>" + days[0].slice(5).replace("-", ".") + " – " + days[4].slice(5).replace("-", ".") + "</span>" +
          (st.w !== monday(today) ? ' <button class="btn sm" id="cwNow">이번 주</button>' : "") + "</div>" +
          '<button class="btn" id="cwNext"' + (st.w >= maxW ? " disabled" : "") + ">다음 주 ›</button></div>" +
          '<div class="cw">' + cols + "</div>" +
          '<div class="cw-note">나스닥 거래소 실적 캘린더 기준(날짜는 미 동부 — 장 전 = 한국 밤, 장 후 = 한국 새벽)을 야후 캘린더와 교차 확인합니다. <span class="cf warn">날짜 확인</span> 두 곳 날짜가 다름(더 이른 날부터 SEC 공시 확인) · <span class="cf">예상</span> 나스닥에 아직 없어 야후 날짜. ' +
          "실제 발표는 SEC 8-K(실적 공시)로 확인하고, 캘린더에 없던 발표도 SEC 전수 확인으로 잡습니다. 카드를 누르면 <b class=\"ywl\">관심 기업</b>으로 표시·저장되고(로그인한 기기끼리 동기화) 맨 위로 올라갑니다(그다음 기술주, 시총 순). · 캘린더 갱신 " + esc(D.updated || "") + "</div>";
        box.querySelector("#cwPrev").onclick = function () { st.w = addDays(st.w, -7); keep(); draw(); };
        box.querySelector("#cwNext").onclick = function () { st.w = addDays(st.w, 7); keep(); draw(); };
        var nb = box.querySelector("#cwNow"); if (nb) nb.onclick = function () { st.w = monday(today); keep(); draw(); };
        box.querySelectorAll(".cd-more").forEach(function (b) { b.onclick = function () { st.open[b.dataset.d] = 1; draw(); }; });
        box.querySelectorAll(".ce").forEach(function (c) {
          c.onclick = function (e) {
            if (e.target.closest("a")) return;
            var W2 = loadWatch(), t = c.dataset.t, k = W2.indexOf(t);
            if (k >= 0) W2.splice(k, 1); else W2.push(t);
            saveWatch(W2); draw();
          };
        });
      }
      function keep() { try { sessionStorage.setItem("us-cal-week", st.w); } catch (e) {} }
      draw();
    }).catch(function () { box.innerHTML = '<div class="empty">발표 예정 캘린더를 불러오지 못했습니다.</div>'; });
  }

  /* 다른 화면에서 쓰는 창구: JPReport.index() → 목록, JPReport.load(rid) → [리포트, 요약(없으면 null)], JPReport.html(R, N, embed) */
  var IDX = null;
  window.JPReport = {
    index: function () { return IDX || (IDX = getJSON(BASE + "index.json").catch(function () { IDX = null; return { reports: [] }; })); },
    load: function (rid) { return Promise.all([getJSON(BASE + rid + ".json"), getJSON(BASE + "notes/" + rid + ".json").catch(function () { return null; })]); },
    html: reportHTML,
    hydrate: hydrate
  };
  if (!app) return;

  var id = new URLSearchParams(location.search).get("id");
  if (id && /^[\w.-]+$/.test(id)) {
    Promise.all([getJSON(BASE + id + ".json"), getJSON(BASE + "notes/" + id + ".json").catch(function () { return null; })])
      .then(function (rs) { renderReport(rs[0], rs[1]); })
      .catch(function (e) { app.innerHTML = '<div class="empty">리포트를 찾지 못했습니다 (' + esc(id) + '). <a href="' + M.page + '">목록으로</a></div>'; });
  } else {
    getJSON(BASE + "index.json").then(renderList).catch(function () { app.innerHTML = '<div class="empty">아직 리포트가 없습니다 — ' + (IS_US ? "fetch_us_earnings_results.py" : "fetch_jp_earnings_results.py") + " 실행 후 생깁니다.</div>"; });
  }
})();
