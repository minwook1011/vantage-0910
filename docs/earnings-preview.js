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
      '<div class="ep-days">' + days.map(function (d) {
        var n = W.days[d].filter(ok).length;
        return '<a href="#d-' + d + '" class="ep-dj' + (n ? "" : " none") + '"><b>' + wd(d) + "</b><span>" + md(d) + " · " + n + "곳</span></a>";
      }).join("") + "</div></div>";
    h += days.map(function (d) {
      var L = W.days[d].filter(ok);
      if (!L.length) return '<section class="ep-day" id="d-' + d + '"><h2>' + md(d) + "(" + wd(d) + ')<small>발표 없음</small></h2></section>';
      return '<section class="ep-day" id="d-' + d + '"><h2>' + md(d) + "(" + wd(d) + ")<small>" + L.length + "곳" + (d === todayK ? " · 오늘" : "") + "</small></h2>" +
        '<div class="ep-idx">' + L.map(function (x) { return '<a href="#c-' + x.mk + "-" + esc(x.c) + '" class="' + x.mk + '">' + esc(nm(x)) + "</a>"; }).join("") + "</div>" +
        '<div class="ep-grid">' + L.map(function (x) { return card(x, P[x.mk + ":" + x.c] || {}); }).join("") + "</div></section>";
    }).join("");
    h += '<div class="ep-note">발표일은 일본은 도쿄증권거래소 공식 예정일, 미국은 나스닥 거래소 캘린더(미 동부 날짜 · 장 전 = 한국 밤, 장 후 = 한국 새벽) 기준입니다. ' +
      "<i>예상</i>은 회사가 아직 날짜를 알리지 않은 추정일입니다. 기업 이름을 누르면 재무제표·주가 차트로 갑니다(일본은 스크리너, 미국은 데이터 허브). " +
      "기업 설명은 처음 한 번 쓰고 다음 분기에 다시 쓰며, 관전 포인트는 매주 새로 씁니다. 이 리포트는 " + esc(until) + "까지 매주 일요일 밤 10시에 올라옵니다.</div>";
    app.innerHTML = h;
    app.querySelectorAll("[data-mk]").forEach(function (b) { b.onclick = function () { st.mk = b.dataset.mk; try { localStorage.setItem("ep-mk", st.mk); } catch (e) {} render(IX, W, P); }; });
    if (location.hash) { var el = document.getElementById(location.hash.slice(1)); if (el) setTimeout(function () { el.scrollIntoView(); }, 50); }
  }
  function ok(x) { return st.mk === "all" || st.mk === x.mk; }
  function nm(x) { return x.mk === "jp" ? (x.ko || x.n) : x.n; }
  function card(x, p) {
    var href = link(x);
    var title = (href ? '<a class="ep-nm" href="' + href + '">' : '<span class="ep-nm">') + esc(nm(x)) + (href ? " ›</a>" : "</span>");
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
    return '<article class="ep-card ' + x.mk + '" id="c-' + x.mk + "-" + esc(x.c) + '"><div class="ep-ch">' + title + (p.one ? '<div class="ep-one">' + esc(p.one) + "</div>" : "") + '<div class="ep-meta">' + meta.join("") + "</div></div>" + desc + pts + "</article>";
  }
})();
