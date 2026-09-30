/* podcasts.js — 팟캐스트 요약
 * podcasts.html            → 에피소드 목록(방송별 필터, 게스트 사진)
 * podcasts.html?id=<id>    → 에피소드 1건: 사진 + 제목 / 누구 / 어느 기업 / 무슨 이야기 / 원본 링크
 *                            → 핵심 요약 → 내용 정리 → 투자 관점 → 전문 번역(아티팩트)
 * 데이터: data/podcasts/index.json (fetch_podcasts.py + 한국어 제목·소개) + data/podcasts/ep/<id>.json (회사 PC Claude 작업)
 * 화면 글자는 사람 이름을 빼고 전부 한국어. 전문 번역은 비공개 클로드 아티팩트(artifact_url)로 연결한다. */
(function () {
  "use strict";
  var app = document.getElementById("app"), BASE = "data/podcasts/";
  var SHOWS = {
    ilb: ["인베스트 라이크 더 베스트", "#b8860b", "창업자·투자자 심층 인터뷰"],
    ca: ["캐피털 얼로케이터스", "#2f62d0", "기관투자자·헤지펀드 매니저 인터뷰"],
    bb: ["비즈니스 브레이크다운스", "#7a4bc9", "한 회사를 한 편에 걸쳐 해부"],
    dwarkesh: ["드와케시 파텔 팟캐스트", "#c93447", "AI·과학·역사 장시간 인터뷰"],
    mad: ["MAD 팟캐스트", "#2f7a55", "AI·데이터 인프라 창업자 인터뷰"]
  };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  function showName(k) { return (SHOWS[k] || [k])[0]; }
  function badge(show) { var s = SHOWS[show] || [show, "#5b6275"]; return '<span class="show" style="background:' + s[1] + '">' + esc(s[0]) + "</span>"; }
  function dur(d) {   // 1:26:13 → 1시간 26분, 49:54 → 50분
    if (!d) return "";
    var p = String(d).split(":").map(Number); if (p.some(isNaN)) return "";
    var sec = p.reduce(function (a, b) { return a * 60 + b; }, 0), h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
    return h ? h + "시간 " + m + "분" : m + "분";
  }
  function face(url, show, cls) {
    var s = SHOWS[show] || ["", "#5b6275"];
    return url ? '<img class="' + cls + '" src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'' + cls + ' ph\',textContent:\'🎙\'}))">'
      : '<span class="' + cls + ' ph" style="background:' + s[1] + '">🎙</span>';
  }
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
  function titleOf(row, E) { return (E && E.title_ko) || row.title_ko || (row.summary && row.summary.title_ko) || row.title; }

  /* ── 목록 ── */
  function renderList(IX) {
    var f = "all"; try { f = localStorage.getItem("vantage-pc-show") || "all"; } catch (e) {}
    var eps = (IX.episodes || []).filter(function (e) { return e.status !== "skip"; });
    function draw() {
      try { localStorage.setItem("vantage-pc-show", f); } catch (e) {}
      var list = eps.filter(function (e) { return f === "all" || e.show === f; }), html = "", day = "";
      list.forEach(function (e) {
        if (e.date !== day) { day = e.date; html += '<div class="day">' + esc(day.replace(/^(\d+)-(\d+)-(\d+)$/, "$1년 $2월 $3일")) + "</div>"; }
        var s = e.summary || {}, ready = e.status === "done" || e.status === "sent";
        html += '<a class="ep' + (ready ? "" : " wait") + '" href="podcasts.html?id=' + encodeURIComponent(e.id) + '">' + face(s.image || e.image, e.show, "face") +
          '<div class="body"><div class="top">' + badge(e.show) + '<span class="st">' + (ready ? '<span class="pill ok">요약 완료</span>' : '<span class="pill no">요약 준비 중</span>') + (e.duration ? " · " + dur(e.duration) : "") + "</span></div>" +
          '<b class="t">' + esc(titleOf(e)) + "</b>" +
          (s.guest ? '<span class="who">👤 ' + esc(s.guest) + (s.company ? " · 🏢 " + esc(s.company) : "") + "</span>" : "") +
          '<span class="hl">' + esc(s.headline || (e.desc_ko ? e.desc_ko.slice(0, 110) + (e.desc_ko.length > 110 ? "…" : "") : "")) + "</span></div></a>";
      });
      document.getElementById("list").innerHTML = html || '<div class="empty">아직 에피소드가 없습니다.</div>';
      document.querySelectorAll("#chips button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === f); });
    }
    var cnt = {}; eps.forEach(function (e) { cnt[e.show] = (cnt[e.show] || 0) + 1; });
    app.innerHTML = '<div class="kicker">팟캐스트 · 투자·AI 인터뷰 요약</div><h1>팟캐스트</h1>' +
      '<p class="lede">5개 방송의 새 에피소드를 하루 3번(오전 7시·오후 1시·저녁 8시) 확인해 <b>누가 · 어느 회사 · 무슨 이야기</b>인지부터 정리합니다. 전문 한국어 번역은 아티팩트로 연결되고, 새 요약은 텔레그램으로 링크가 옵니다. · 갱신 ' + esc((IX.updated || "").replace(" KST", "")) + "</p>" +
      '<div class="chips" id="chips"><button data-v="all">전체 <small>' + eps.length + "</small></button>" +
      Object.keys(SHOWS).map(function (k) { return '<button data-v="' + k + '" title="' + esc(SHOWS[k][2]) + '"><i style="background:' + SHOWS[k][1] + '"></i>' + esc(SHOWS[k][0]) + " <small>" + (cnt[k] || 0) + "</small></button>"; }).join("") + "</div>" +
      '<div id="list"></div>';
    document.querySelectorAll("#chips button").forEach(function (b) { b.onclick = function () { f = b.dataset.v; draw(); }; });
    draw();
  }

  /* ── 에피소드 ── */
  function renderEp(row, E) {
    var g = (E && E.guest) || {}, c = (E && E.company) || {}, title = titleOf(row, E);
    document.title = title + " — VANTAGE";
    var yt = (E && E.youtube) || row.youtube;
    var html = '<div class="kicker"><a href="podcasts.html">팟캐스트</a> · ' + esc(showName(row.show)) + "</div>" +
      '<div class="head">' + face((E && E.image) || row.image, row.show, "hface") + '<div class="hbody"><div class="showline">' + badge(row.show) + "<span>" + esc(row.date.replace(/^(\d+)-(\d+)-(\d+)$/, "$1년 $2월 $3일")) + (row.duration ? " · " + dur(row.duration) : "") + "</span></div>" +
      "<h1>" + esc(title) + "</h1>" +
      '<dl class="meta"><dt>제목</dt><dd><b>' + esc(title) + "</b></dd>" +
      "<dt>누구</dt><dd>" + (g.name ? "<b>" + esc(g.name) + "</b> — " + esc(g.role || "") : '<span class="dim">요약 후 채워짐</span>') + "</dd>" +
      "<dt>어느 기업</dt><dd>" + (c.name ? "<b>" + esc(c.name) + "</b>" + (c.sector ? " (" + esc(c.sector) + ")" : "") + (c.what ? " — " + esc(c.what) : "") : '<span class="dim">요약 후 채워짐</span>') + "</dd>" +
      "<dt>무슨 이야기</dt><dd>" + esc((E && E.topic) || "") + (E && E.topic ? "" : '<span class="dim">요약 후 채워짐</span>') + "</dd></dl>" +
      '<div class="acts">' + (row.link ? '<a class="btn pri" href="' + esc(row.link) + '" target="_blank" rel="noopener">▶️ 원본 에피소드</a>' : "") +
      (yt ? '<a class="btn" href="' + esc(yt) + '" target="_blank" rel="noopener">📺 유튜브로 보기</a>' : "") +
      (E && E.artifact_url ? '<a class="btn" href="' + esc(E.artifact_url) + '" target="_blank" rel="noopener">📄 전문 번역 · 요약 분석 <small>아티팩트</small></a>' : "") +
      (row.audio ? '<a class="btn" href="' + esc(row.audio) + '" target="_blank" rel="noopener">🎧 오디오 듣기</a>' : "") + "</div></div></div>";
    if (!E) {
      html += '<div class="pending">📝 아직 요약 전입니다. 회사 PC의 Claude 예약 작업이 하루 3번 새 에피소드를 인터뷰 요약 분석 아티팩트(전문 번역 포함)로 만들고, 텔레그램으로 링크를 보냅니다.</div>' +
        (row.desc_ko ? '<section><h2>방송 소개</h2><div class="note"><p>' + esc(row.desc_ko) + "</p></div></section>" : "");
    } else {
      if (E.tldr && E.tldr.length) html += '<section><h2>핵심 요약</h2><ul class="tldr">' + E.tldr.map(function (x) { return "<li>" + md(x).replace(/^<p>|<\/p>$/g, "") + "</li>"; }).join("") + "</ul></section>";
      if (E.summary_md) html += '<section><h2>내용 정리</h2><div class="note">' + md(E.summary_md) + "</div></section>";
      if (E.insights_md) html += '<section><h2>투자 관점에서</h2><div class="note">' + md(E.insights_md) + "</div></section>";
      html += '<section><h2>전문 번역</h2><div class="fullcta">' + (E.artifact_url
        ? '<div><b>인터뷰 전문 한국어 번역</b><span>처음부터 끝까지 대화 전체를 한국어로 옮긴 번역과 요약 분석을 아티팩트로 봅니다.</span></div><a class="btn pri" href="' + esc(E.artifact_url) + '" target="_blank" rel="noopener">📄 전문 번역 열기</a>'
        : '<div><b>전문 번역 없음</b><span>' + (E.no_transcript ? "대본을 구하지 못해 방송 소개글로만 요약했습니다." : "아티팩트 링크가 아직 없습니다.") + "</span></div>") + "</div></section>";
      html += '<div class="foot">요약 작성 ' + esc(E.written || "") + (E.transcript_source ? " · 대본 출처: " + esc({ page: "에피소드 페이지", youtube: "유튜브 자막", audio: "오디오 받아쓰기", none: "없음" }[E.transcript_source] || E.transcript_source) : "") + "</div>";
    }
    app.innerHTML = html;
  }

  var id = new URLSearchParams(location.search).get("id");
  getJSON(BASE + "index.json").then(function (IX) {
    if (!id) return renderList(IX);
    var row = (IX.episodes || []).filter(function (e) { return e.id === id; })[0];
    if (!row) { app.innerHTML = '<div class="empty">에피소드를 찾지 못했습니다. <a href="podcasts.html">목록으로</a></div>'; return; }
    getJSON(BASE + "ep/" + encodeURIComponent(id) + ".json").then(function (E) { renderEp(row, E); }, function () { renderEp(row, null); });
  }).catch(function () { app.innerHTML = '<div class="empty">아직 에피소드 목록이 없습니다.</div>'; });
})();
