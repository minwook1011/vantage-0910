/* earnings-preview.js — 다음 주 실적 발표 기업 관전 포인트 (earnings-preview.html?w=<월요일>)
   2026-10-11 사용자: 잘 모르는 일본·미국 기업을 요일별로, 이름(누르면 재무제표·차트) → 8줄 설명 → 관전 포인트.
   데이터: data/preview/index.json(주 목록) · <월요일>.json(요일별 기업·관전 포인트) · profiles.json(기업 설명, 분기마다 다시 씀)
   만드는 쪽: build_earnings_preview.py + 예약 작업 vantage-earnings-preview(일요일 22:00). 올해 실적 시즌(until)까지만. */
(function () {
  "use strict";
  var app = document.getElementById("ep");
  var BASE = "data/preview/";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getJSON(p) { return fetch(p + "?t=" + Date.now(), { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function addDays(iso, n) { var t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function md(iso) { return iso.slice(5).replace("-", "."); }
  var WKD = "일월화수목금토";
  function wd(iso) { return WKD.charAt(new Date(iso + "T00:00:00Z").getUTCDay()); }
  function weekLabel(w) { return +w.slice(5, 7) + "월 " + Math.ceil(+w.slice(8, 10) / 7) + "주차"; }
  var todayK = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  function monday(iso) { var d = new Date(iso + "T00:00:00Z").getUTCDay(); return addDays(iso, d === 0 ? 1 : d === 6 ? 2 : 1 - d); }
  var TM = { pre: "장 전", after: "장 후" };
  var Q = { "1Q": "1분기", "2Q": "2분기(반기)", "3Q": "3분기", "FY": "연간 결산" };
  function fq(s) { var m = /^(\w{3})\/(\d{4})$/.exec(s || ""); var mo = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 }; return m ? m[2] + "년 " + mo[m[1]] + "월 끝난 분기" : ""; }
  function link(x) {
    if (x.mk === "jp") return "jp-screener.html?u=" + (x.u === "maj" ? "major" : "consumer") + "&code=" + encodeURIComponent(x.c);
    return x.hub ? "datahub.html?co=" + encodeURIComponent(x.c) + "#company" : "";
  }

  var st = { mk: "all" };
  try { st.mk = localStorage.getItem("ep-mk") || "all"; } catch (e) {}

  getJSON(BASE + "index.json").then(function (IX) {
    var weeks = IX.weeks || [];
    if (!weeks.length) throw new Error("empty");
    var q = new URLSearchParams(location.search).get("w");
    var cur = monday(todayK);
    var w = q && weeks.indexOf(q) >= 0 ? q : weeks.indexOf(cur) >= 0 ? cur : weeks.filter(function (x) { return x >= cur; })[0] || weeks[weeks.length - 1];
    return Promise.all([getJSON(BASE + w + ".json"), getJSON(BASE + "profiles.json").catch(function () { return {}; })]).then(function (r) { render(IX, r[0], r[1]); });
  }).catch(function () {
    app.innerHTML = '<div class="kicker"><a href="jp-screener.html">일본 스크리너</a> · 관전 포인트</div><div class="ep-empty">아직 만든 관전 포인트 리포트가 없습니다. 매주 일요일 밤 10시에 다음 주 것이 올라옵니다.</div>';
  });

  function render(IX, W, P) {
    var weeks = IX.weeks, i = weeks.indexOf(W.week), until = W.until || IX.until || "";
    var days = Object.keys(W.days).sort();
    var all = []; days.forEach(function (d) { W.days[d].forEach(function (x) { all.push(x); }); });
    var nJ = all.filter(function (x) { return x.mk === "jp"; }).length, nU = all.length - nJ;
    var banner = "";
    if (until && todayK > until) banner = '<div class="ep-ban end"><b>올해 실적 시즌이 끝나 새 리포트를 만들지 않습니다.</b> 내년에도 계속 받을지, 이 화면을 없앨지 알려 주세요.</div>';
    else if (until && todayK >= addDays(until, -30)) banner = '<div class="ep-ban"><b>이 리포트는 ' + +until.slice(5, 7) + "월 " + +until.slice(8) + "일까지만 만듭니다.</b> 그 뒤에도 계속 받을지 알려 주세요.</div>";
    var seg = function (v, l) { return '<button data-mk="' + v + '"' + (st.mk === v ? ' aria-pressed="true"' : "") + ">" + l + "</button>"; };
    var h = '<div class="kicker"><a href="jp-screener.html">일본 스크리너</a> · <a href="us-report.html">미국 실적 리포트</a> · 관전 포인트</div>' +
      '<div class="ep-head"><div><h1>' + weekLabel(W.week) + ' 실적 관전 포인트</h1><div class="ep-sub">' + md(W.range[0]) + " – " + md(W.range[1]) + " · 일본 " + nJ + "곳 · 미국 " + nU + "곳 · " + esc(W.made || "") + " 작성</div></div>" +
      '<div class="ep-nav">' + (i > 0 ? '<a class="ep-btn" href="?w=' + weeks[i - 1] + '">‹ 이전 주</a>' : '<span class="ep-btn off">‹ 이전 주</span>') +
      (i < weeks.length - 1 ? '<a class="ep-btn" href="?w=' + weeks[i + 1] + '">다음 주 ›</a>' : '<span class="ep-btn off">다음 주 ›</span>') + "</div></div>" + banner +
      '<div class="ep-bar"><div class="ep-seg">' + seg("all", "전체 " + all.length) + seg("jp", "일본 " + nJ) + seg("us", "미국 " + nU) + "</div>" +
      '<button class="ep-btn sm" id="ep-foldall">' + (FOLD.length ? "모두 펼치기" : "모두 접기") + "</button>" +
      '<div class="ep-days">' + days.map(function (d) {
        var n = W.days[d].filter(ok).length;
        return '<a href="#d-' + d + '" class="ep-dj' + (n ? "" : " none") + '"><b>' + wd(d) + "</b><span>" + md(d) + " · " + n + "곳</span></a>";
      }).join("") + "</div></div>";
    h += days.map(function (d) {
      var L = W.days[d].filter(ok);
      if (!L.length) return '<section class="ep-day" id="d-' + d + '"><h2>' + md(d) + "(" + wd(d) + ')<small>발표 없음</small></h2></section>';
      var shut = FOLD.indexOf(d) >= 0;
      return '<section class="ep-day' + (shut ? " shut" : "") + '" id="d-' + d + '"><h2 class="ep-dh" data-fold="' + d + '" title="눌러서 접기·펼치기">' + md(d) + "(" + wd(d) + ")<small>" + L.length + "곳" + (d === todayK ? " · 오늘" : "") + '</small><span class="ep-fold">' + (shut ? "펼치기 ▾" : "접기 ▴") + "</span></h2>" +
        '<div class="ep-idx">' + L.map(function (x) { return '<a href="#c-' + x.mk + "-" + esc(x.c) + '" class="' + x.mk + '">' + esc(nm(x)) + "</a>"; }).join("") + "</div>" +
        '<div class="ep-grid">' + L.map(function (x) { return card(x, P[x.mk + ":" + x.c] || {}); }).join("") + "</div></section>";
    }).join("");
    h += '<div class="ep-note">발표일은 일본은 도쿄증권거래소 공식 예정일, 미국은 나스닥 거래소 캘린더(미 동부 날짜 · 장 전 = 한국 밤, 장 후 = 한국 새벽) 기준입니다. ' +
      "<i>예상</i>은 회사가 아직 날짜를 알리지 않은 추정일입니다. 기업 이름을 누르면 이 화면 위에 주가 차트·재무제표가 크게 열립니다(창 밖으로 나가지 않음). 카드의 작은 표는 최근 4분기, 단위는 일본 억 엔·미국 백만 달러. 요일 제목을 누르면 접고 펼 수 있습니다. " +
      "기업 설명은 처음 한 번 쓰고 다음 분기에 다시 쓰며, 관전 포인트는 매주 새로 씁니다. 이 리포트는 " + esc(until) + "까지 매주 일요일 밤 10시에 올라옵니다.</div>";
    app.innerHTML = h;
    app.querySelectorAll("[data-mk]").forEach(function (b) { b.onclick = function () { st.mk = b.dataset.mk; try { localStorage.setItem("ep-mk", st.mk); } catch (e) {} render(IX, W, P); }; });
    app.querySelectorAll("[data-fold]").forEach(function (h2) { h2.onclick = function () { var d = h2.dataset.fold, k = FOLD.indexOf(d); if (k >= 0) FOLD.splice(k, 1); else FOLD.push(d); saveFold(); render(IX, W, P); }; });
    app.querySelector("#ep-foldall").onclick = function () { FOLD = FOLD.length ? [] : days.slice(); saveFold(); render(IX, W, P); };
    app.querySelectorAll("[data-pop]").forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var k = a.dataset.pop.split(":"); var x = all.filter(function (y) { return y.mk === k[0] && y.c === k[1]; })[0]; if (x) pop(x, P[x.mk + ":" + x.c] || {}); }; });
    if (location.hash) { var el = document.getElementById(location.hash.slice(1)); if (el) setTimeout(function () { el.scrollIntoView(); }, 50); }
  }
  // ── 작은 차트·재무(2026-10-13 사용자) — data/preview/<주>.json 의 px(최근 약 1년 종가)·fin(분기·연간 매출·영업이익·순이익) ──
  var FOLD = [];
  function foldKey() { return "ep-fold-" + (new URLSearchParams(location.search).get("w") || "cur"); }
  try { FOLD = JSON.parse(localStorage.getItem(foldKey()) || "[]") || []; } catch (e) { FOLD = []; }
  function saveFold() { try { localStorage.setItem(foldKey(), JSON.stringify(FOLD)); } catch (e) {} }
  // 기간 등락: n = 거래일 수(일봉). 주봉 종목(pxw)은 주 수로 바꿔 계산
  function retx(x, n) { return x.px ? ret(x.px, x.pxw ? Math.max(1, Math.round(n / 5)) : n) : null; }
  function ret(px, n) { if (!px || px.length <= n) return null; var a = px[px.length - 1 - n], b = px[px.length - 1]; return a ? (b / a - 1) * 100 : null; }
  function pct(v) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%"; }
  function pcl(v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function spark(px, W, H, big) {
    if (!px || px.length < 2) return "";
    var n = px.length, lo = Math.min.apply(null, px), hi = Math.max.apply(null, px), sp = (hi - lo) || 1;
    var X = function (i) { return (i / (n - 1)) * W; }, Y = function (v) { return H - 4 - (v - lo) / sp * (H - 10); };
    var d = px.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join("");
    var up = px[n - 1] >= px[0];
    var area = big ? '<path d="' + d + "L" + W + " " + H + "L0 " + H + 'Z" class="ar ' + (up ? "up" : "dn") + '"/>' : "";
    var lab = big ? '<text x="' + (W - 2) + '" y="' + (Y(hi) - 2 < 10 ? 10 : Y(hi) - 2) + '" text-anchor="end">최고 ' + num(hi) + '</text><text x="2" y="' + (H - 2) + '">최저 ' + num(lo) + "</text>" : "";
    return '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" class="sp">' + area + '<path d="' + d + '" class="ln ' + (up ? "up" : "dn") + '"/>' + lab + "</svg>";
  }
  function num(v) { return v == null ? "—" : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toLocaleString(); }
  function opRow(f) { var q = f.q || {}; return (q.oi || []).some(function (v) { return v != null; }) ? ["oi", "영업이익"] : ["ni", "순이익"]; }
  // 분기·연도 라벨 → 실제 기간(일본: 결산월 fm 기준 '26.03~05', 미국: 분기 끝 달 '26.06' → '26.04~06')
  function period(lb, f) {
    var yy = function (n) { return String((n % 100 + 100) % 100).padStart(2, "0"); }, mm = function (n) { return String(n).padStart(2, "0"); };
    var m = /^(\d{2})Q([1-4])$/.exec(lb || "");
    if (m && f.fm) { var y = 2000 + +m[1], e = f.fm - 3 * (4 - +m[2]); while (e <= 0) { e += 12; y--; } var st = e - 2, sy = y; if (st <= 0) { st += 12; sy--; } return yy(sy) + "." + mm(st) + "~" + (sy === y ? "" : yy(y) + ".") + mm(e); }
    var u = /^(\d{2})\.(\d{2})$/.exec(lb || "");
    if (u) { var ey = +u[1], em = +u[2], sm = em - 2, sy2 = ey; if (sm <= 0) { sm += 12; sy2--; } return yy(sy2) + "." + mm(sm) + "~" + (sy2 === ey ? "" : yy(ey) + ".") + mm(em); }
    var a = /^(\d{4})년$/.exec(lb || "");
    if (a && f.fm) { var Y = +a[1], s1 = f.fm + 1, sy3 = Y - 1; if (s1 > 12) { s1 -= 12; sy3++; } return yy(sy3) + "." + mm(s1) + "~" + yy(Y) + "." + mm(f.fm); }
    return "";
  }
  function finTable(f, nq, withA) {
    if (!f || !f.q || !(f.q.lb || []).length) return '<div class="ep-nofin">재무 자료 없음</div>';
    var q = f.q, k = q.lb.length, from = Math.max(0, k - nq), cols = [], o = opRow(f);
    for (var i = from; i < k; i++) cols.push({ lb: q.lb[i], rev: q.rev[i], op: q[o[0]][i], ni: q.ni[i], py: i - 4 >= 0 ? q.rev[i - 4] : null, po: i - 4 >= 0 ? q[o[0]][i - 4] : null });
    if (withA && f.a && (f.a.lb || []).length) f.a.lb.forEach(function (l, j) { cols.push({ lb: l + "년", rev: f.a.rev[j], op: f.a[o[0]][j], ni: f.a.ni[j], an: true, py: j ? f.a.rev[j - 1] : null, po: j ? f.a[o[0]][j - 1] : null }); });
    if (withA && f.f) cols.push({ lb: f.f.lb, rev: f.f.rev, op: f.f[o[0]], ni: f.f.ni, an: true, fc: true });
    var row = function (lab, key) { return "<tr><th>" + lab + "</th>" + cols.map(function (c) { return '<td class="' + (c.an ? "an" : "") + (c.fc ? " fc" : "") + '">' + num(c[key]) + "</td>"; }).join("") + "</tr>"; };
    // 전년 대비(분기 = 4분기 전, 연간 = 전년). 직전이 적자면 흑자 전환·적자 지속으로 쓴다
    var gr = function (a, b) { if (a == null || b == null) return { t: "—", c: "" }; if (b <= 0) return a > 0 ? { t: "흑전", c: "up" } : { t: "적지", c: "dn" }; if (a < 0) return { t: "적전", c: "dn" }; var v = (a / b - 1) * 100; return { t: pct(v), c: pcl(v) }; };
    var yrow = function (lab, cur, prev) { return '<tr class="yy"><th>' + lab + "</th>" + cols.map(function (c) { var g = c.fc ? { t: "", c: "" } : gr(c[cur], c[prev]); return '<td class="' + g.c + (c.an ? " an" : "") + '">' + g.t + "</td>"; }).join("") + "</tr>"; };
    var yoy = yrow("매출 전년 대비", "rev", "py"), oyoy = yrow(o[1] + " 전년 대비", "op", "po");
    var mg = "<tr class=\"yy\"><th>" + o[1] + "률</th>" + cols.map(function (c) { var v = c.rev && c.op != null ? c.op / c.rev * 100 : null; return '<td class="' + (c.an ? "an" : "") + '">' + (v == null ? "—" : v.toFixed(1) + "%") + "</td>"; }).join("") + "</tr>";
    return '<table class="ep-fin"><thead><tr><th>' + esc(f.u) + "</th>" + cols.map(function (c) { var pd = period(c.lb, f); return '<th class="' + (c.an ? "an" : "") + (c.fc ? " fc" : "") + '">' + esc(c.lb) + (pd ? "<small>" + pd + "</small>" : "") + "</th>"; }).join("") + "</tr></thead><tbody>" +
      row("매출", "rev") + yoy + row(o[1], "op") + oyoy + (withA ? row("순이익", "ni") : "") + mg + "</tbody></table>";
  }
  function miniData(x) {
    if (!x.px && !x.fin) return "";
    var r1 = retx(x, 21), r12 = x.px ? ret(x.px, x.px.length - 1) : null;
    return '<div class="ep-mini"><div class="ep-mc">' + (x.px ? spark(x.px, 160, 48) + '<div class="ep-mr"><span>1개월 <b class="' + pcl(r1) + '">' + pct(r1) + '</b></span><span>1년 <b class="' + pcl(r12) + '">' + pct(r12) + "</b></span></div>" : '<div class="ep-nofin">주가 자료 없음</div>') +
      '</div><div class="ep-mf">' + finTable(x.fin, 4, false) + "</div></div>";
  }
  // ── 크게 보기(팝업) — 창 밖으로 나가지 않는다(2026-10-13 사용자) ──
  function pop(x, p) {
    var box = document.getElementById("ep-pop");
    if (!box) { box = document.createElement("div"); box.id = "ep-pop"; box.className = "ep-pop"; document.body.appendChild(box); }
    var href = link(x), r1 = retx(x, 21), r3 = retx(x, 63), r12 = x.px ? ret(x.px, x.px.length - 1) : null;
    box.innerHTML = '<div class="ep-pc" role="dialog" aria-modal="true"><button class="ep-x" aria-label="닫기">×</button>' +
      '<div class="ep-ph"><span class="mk ' + x.mk + '">' + (x.mk === "jp" ? "일본" : "미국") + "</span><h3>" + esc(nm(x)) + ' <small>' + esc(x.c) + (x.mk === "jp" && x.ko ? " · " + esc(x.n) : "") + "</small></h3>" + (p.one ? "<p>" + esc(p.one) + "</p>" : "") + "</div>" +
      '<div class="ep-psec"><b>주가 (최근 약 1년' + (x.pxd ? " · " + esc(x.pxd) + " 종가 " + num(x.px[x.px.length - 1]) + (x.mk === "jp" ? "엔" : "달러") : "") + ')</b><span class="ep-pr">1개월 <i class="' + pcl(r1) + '">' + pct(r1) + '</i> · 3개월 <i class="' + pcl(r3) + '">' + pct(r3) + '</i> · 1년 <i class="' + pcl(r12) + '">' + pct(r12) + "</i></span></div>" +
      (x.px ? '<div class="ep-big">' + spark(x.px, 640, 180, true) + "</div>" : '<div class="ep-nofin">주가 자료 없음</div>') +
      '<div class="ep-psec"><b>재무제표</b><span class="ep-pr">최근 8분기 · 연간 4년' + (x.fin && x.fin.f ? " · 회사 예상" : "") + "</span></div>" +
      '<div class="ep-ptbl">' + finTable(x.fin, 8, true) + "</div>" +
      ((x.pts || []).length ? '<div class="ep-pts"><b>관전 포인트</b><ul>' + x.pts.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></div>" : "") +
      (href ? '<a class="ep-more" href="' + href + '" target="_blank" rel="noopener">' + (x.mk === "jp" ? "스크리너에서 전체 보기" : "데이터 허브에서 전체 보기") + " ↗ (새 탭)</a>" : "") + "</div>";
    box.hidden = false; document.body.style.overflow = "hidden";
    var close = function () { box.hidden = true; document.body.style.overflow = ""; };
    box.querySelector(".ep-x").onclick = close;
    box.onclick = function (e) { if (e.target === box) close(); };
    document.onkeydown = function (e) { if (e.key === "Escape" && !box.hidden) close(); };
  }
  function ok(x) { return st.mk === "all" || st.mk === x.mk; }
  function nm(x) { return x.mk === "jp" ? (x.ko || x.n) : x.n; }
  function card(x, p) {
    var title = '<a class="ep-nm" href="#" data-pop="' + x.mk + ":" + esc(x.c) + '" title="주가 차트·재무제표 크게 보기">' + esc(nm(x)) + " ›</a>";
    var meta = [];
    meta.push('<span class="mk ' + x.mk + '">' + (x.mk === "jp" ? "일본" : "미국") + "</span>");
    meta.push('<span class="cd">' + esc(x.c) + "</span>");
    if (x.mk === "jp" && x.ko) meta.push('<span class="en">' + esc(x.n) + "</span>");
    if (x.cat) meta.push("<span>" + esc(x.cat) + "</span>");
    if (x.mk === "jp" && x.q) meta.push("<span>" + esc(Q[x.q] || x.q) + "</span>");
    if (x.mk === "us" && x.fq) meta.push("<span>" + esc(fq(x.fq)) + "</span>");
    if (TM[x.tm]) meta.push("<span>" + TM[x.tm] + "</span>");
    if (x.mc) meta.push("<span>시총 " + Math.round(x.mc).toLocaleString() + (x.mk === "jp" ? "억 엔" : "억 달러") + "</span>");
    if (x.eps) meta.push("<span>주당순이익 예상 " + esc(x.eps) + "</span>");
    if (x.est) meta.push('<i class="est">예상일</i>');
    var desc = (p.desc || []).length ? '<ol class="ep-desc">' + p.desc.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" : '<div class="ep-wait">기업 설명을 쓰는 중입니다.</div>';
    var pts = (x.pts || []).length ? '<div class="ep-pts"><b>관전 포인트</b><ul>' + x.pts.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul></div>" : "";
    return '<article class="ep-card ' + x.mk + '" id="c-' + x.mk + "-" + esc(x.c) + '"><div class="ep-ch">' + title + (p.one ? '<div class="ep-one">' + esc(p.one) + "</div>" : "") + '<div class="ep-meta">' + meta.join("") + "</div></div>" + miniData(x) + desc + pts + "</article>";
  }
})();
