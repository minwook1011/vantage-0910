/* podcasts.js — 팟캐스트 요약
 * podcasts.html            → 에피소드 목록(방송별 필터)
 * podcasts.html?id=<id>    → 에피소드 1건: 제목 / 누구 / 어느 기업 / 원본 링크 → 핵심 요약 → 본문 정리 → 투자 관점 → 전체 번역(아티팩트)
 * 데이터: data/podcasts/index.json (fetch_podcasts.py) + data/podcasts/ep/<id>.json (회사 PC Claude 작업이 작성)
 * 전체 대본 번역은 저작권 때문에 공개 사이트에 올리지 않고 비공개 클로드 아티팩트(artifact_url)로만 연결한다. */
(function () {
  "use strict";
  var app = document.getElementById("app"), BASE = "data/podcasts/";
  var SHOWS = { ilb: ["Invest Like the Best", "#b8860b"], ca: ["Capital Allocators", "#2f62d0"], bb: ["Business Breakdowns", "#7a4bc9"],
    dwarkesh: ["Dwarkesh Podcast", "#c93447"], mad: ["The MAD Podcast", "#2f7a55"] };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  function badge(show) { var s = SHOWS[show] || [show, "#5b6275"]; return '<span class="show" style="background:' + s[1] + '">' + esc(s[0]) + "</span>"; }
  function md(t) {
    if (!t) return "";
    var out = [], list = null;
    function inl(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'); }
    function close() { if (list) { out.push("</" + list + ">"); list = null; } }
    String(t).split(/\n/).forEach(function (ln) {
      var m;
      if (/^\s*$/.test(ln)) { close(); return; }
      if ((m = ln.match(/^(#{2,4})\s+(.*)/))) { close(); var lv = Math.min(4, m[1].length + 1); out.push("<h" + lv + ">" + inl(m[2]) + "</h" + lv + ">"); return; }
      if ((m = ln.match(/^>\s?(.*)/))) { close(); out.push("<blockquote>" + inl(m[1]) + "</blockquote>"); return; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inl(m[1]) + "</li>"); return; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inl(m[1]) + "</li>"); return; }
      close(); out.push("<p>" + inl(ln) + "</p>");
    });
    close();
    return out.join("");
  }

  /* ── 목록 ── */
  function renderList(IX) {
    var f = "all"; try { f = localStorage.getItem("vantage-pc-show") || "all"; } catch (e) {}
    var eps = (IX.episodes || []).filter(function (e) { return e.status !== "skip"; });
    function draw() {
      try { localStorage.setItem("vantage-pc-show", f); } catch (e) {}
      var list = eps.filter(function (e) { return f === "all" || e.show === f; }), html = "", day = "";
      list.forEach(function (e) {
        if (e.date !== day) { day = e.date; html += '<div class="day">' + esc(day) + "</div>"; }
        var s = e.summary || {}, ready = e.status === "done" || e.status === "sent";
        html += '<a class="ep' + (ready ? "" : " wait") + '" href="podcasts.html?id=' + encodeURIComponent(e.id) + '">' + badge(e.show) +
          '<b class="t">' + esc(s.title_ko || e.title) + "</b>" +
          '<span class="st">' + (ready ? '<span class="pill ok">요약</span>' : '<span class="pill no">요약 준비 중</span>') + (e.duration ? "<br>" + esc(e.duration) : "") + "</span>" +
          (s.guest ? '<span class="who">👤 ' + esc(s.guest) + (s.company ? " · 🏢 " + esc(s.company) : "") + "</span>" : '<span class="who">' + esc(e.title) + "</span>") +
          (s.headline ? '<span class="hl">' + esc(s.headline) + "</span>" : "") + "</a>";
      });
      document.getElementById("list").innerHTML = html || '<div class="empty">아직 에피소드가 없습니다.</div>';
      document.querySelectorAll("#chips button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === f); });
    }
    var cnt = {}; eps.forEach(function (e) { cnt[e.show] = (cnt[e.show] || 0) + 1; });
    app.innerHTML = '<div class="kicker">Podcasts · 투자·AI 인터뷰 요약</div><h1>팟캐스트</h1>' +
      '<p class="lede">5개 방송의 새 에피소드를 하루 3번(07·13·20시) 확인해 <b>누가·어느 회사·무슨 이야기</b>인지부터 정리합니다. 전체 한국어 번역은 비공개 아티팩트로 연결되고, 새 요약은 텔레그램으로 링크가 옵니다. · 갱신 ' + esc(IX.updated || "") + "</p>" +
      '<div class="chips" id="chips"><button data-v="all">전체 <small>' + eps.length + "</small></button>" +
      Object.keys(SHOWS).map(function (k) { return '<button data-v="' + k + '">' + esc(SHOWS[k][0]) + " <small>" + (cnt[k] || 0) + "</small></button>"; }).join("") + "</div>" +
      '<div id="list"></div>';
    document.querySelectorAll("#chips button").forEach(function (b) { b.onclick = function () { f = b.dataset.v; draw(); }; });
    draw();
  }

  /* ── 에피소드 ── */
  function renderEp(row, E) {
    var g = (E && E.guest) || {}, c = (E && E.company) || {};
    document.title = (E && E.title_ko || row.title) + " — VANTAGE";
    var html = '<div class="kicker"><a href="podcasts.html">팟캐스트</a> · ' + esc((SHOWS[row.show] || [row.show])[0]) + "</div>" +
      '<div class="head"><div class="showline">' + badge(row.show) + "<span>" + esc(row.published || row.date) + (row.duration ? " · " + esc(row.duration) : "") + "</span></div>" +
      "<h1>" + esc(E && E.title_ko || row.title) + "</h1>" + (E && E.title_ko ? '<div class="orig">' + esc(row.title) + "</div>" : "") +
      '<dl class="meta"><dt>제목</dt><dd><b>' + esc(E && E.title_ko || row.title) + "</b></dd>" +
      "<dt>누구</dt><dd>" + (g.name ? "<b>" + esc(g.name) + "</b> — " + esc(g.role || "") : '<span class="empty">요약 후 채워짐</span>') + "</dd>" +
      "<dt>어느 기업</dt><dd>" + (c.name ? "<b>" + esc(c.name) + "</b>" + (c.sector ? " (" + esc(c.sector) + ")" : "") + (c.what ? " — " + esc(c.what) : "") : '<span class="empty">요약 후 채워짐</span>') + "</dd>" +
      (E && E.topic ? "<dt>무슨 이야기</dt><dd>" + esc(E.topic) + "</dd>" : "") + "</dl>" +
      '<div class="acts">' + (row.link ? '<a class="btn pri" href="' + esc(row.link) + '" target="_blank" rel="noopener">▶️ 원본 에피소드</a>' : "") +
      (E && E.youtube ? '<a class="btn" href="' + esc(E.youtube) + '" target="_blank" rel="noopener">📺 유튜브</a>' : "") +
      (E && E.artifact_url ? '<a class="btn" href="' + esc(E.artifact_url) + '" target="_blank" rel="noopener">📄 전체 한국어 번역 <small>아티팩트 · 비공개</small></a>' : "") +
      (row.audio ? '<a class="btn" href="' + esc(row.audio) + '" target="_blank" rel="noopener">🎧 오디오</a>' : "") + "</div></div>";
    if (!E) {
      html += '<div class="pending">📝 아직 요약 전입니다. 회사 PC의 Claude 작업이 07·13·20시에 새 에피소드를 요약하고 텔레그램으로 링크를 보냅니다.</div>' +
        (row.desc ? '<section><h2>방송 소개(원문)</h2><div class="note"><p>' + esc(row.desc) + "</p></div></section>" : "");
    } else {
      if (E.tldr && E.tldr.length) html += "<section><h2>핵심 요약</h2><ul class=\"tldr\">" + E.tldr.map(function (x) { return "<li>" + md(x).replace(/^<p>|<\/p>$/g, "") + "</li>"; }).join("") + "</ul></section>";
      if (E.summary_md) html += '<section><h2>내용 정리</h2><div class="note">' + md(E.summary_md) + "</div></section>";
      if (E.insights_md) html += '<section><h2>투자 관점에서</h2><div class="note">' + md(E.insights_md) + "</div></section>";
      html += '<div class="foot">요약 ' + esc(E.written || "") + (E.transcript_source ? " · 대본 출처: " + esc(E.transcript_source) : "") + " · 원문 인용은 짧게만, 전체 번역은 비공개 아티팩트에만 둡니다.</div>";
    }
    app.innerHTML = html;
  }

  var id = new URLSearchParams(location.search).get("id");
  getJSON(BASE + "index.json").then(function (IX) {
    if (!id) return renderList(IX);
    var row = (IX.episodes || []).filter(function (e) { return e.id === id; })[0];
    if (!row) { app.innerHTML = '<div class="empty">에피소드를 찾지 못했습니다. <a href="podcasts.html">목록으로</a></div>'; return; }
    getJSON(BASE + "ep/" + encodeURIComponent(id) + ".json").then(function (E) { renderEp(row, E); }, function () { renderEp(row, null); });
  }).catch(function () { app.innerHTML = '<div class="empty">아직 에피소드 목록이 없습니다 — fetch_podcasts.py 실행 후 생깁니다.</div>'; });
})();
