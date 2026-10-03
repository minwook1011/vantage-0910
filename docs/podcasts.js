/* podcasts.js — 팟캐스트 요약
 * podcasts.html            → 에피소드 목록(방송별 필터, 게스트 사진)
 * podcasts.html?id=<id>    → 에피소드 1건: 사진 + 제목 / 누구 / 어느 기업 / 무슨 이야기 / 원본 링크
 *                            → 핵심 요약 → 내용 정리 → 투자 관점 → 딥 리서치(외부 자료로 검증·확장) → 출처
 * 데이터: data/podcasts/index.json (fetch_podcasts.py + 한국어 제목·소개) + data/podcasts/ep/<id>.json (회사 PC Claude 작업)
 * 화면 글자는 사람 이름을 빼고 전부 한국어. 대본 전문은 싣지 않는다(요약·분석만). */
(function () {
  "use strict";
  var app = document.getElementById("app"), BASE = "data/podcasts/";
  var SHOWS = {
    ilb: ["인베스트 라이크 더 베스트", "#b8860b", "창업자·투자자 심층 인터뷰"],
    ca: ["캐피털 얼로케이터스", "#2f62d0", "기관투자자·헤지펀드 매니저 인터뷰"],
    bb: ["비즈니스 브레이크다운스", "#7a4bc9", "한 회사를 한 편에 걸쳐 해부"],
    dwarkesh: ["드와케시 파텔 팟캐스트", "#c93447", "AI·과학·역사 장시간 인터뷰"],
    mad: ["MAD 팟캐스트", "#2f7a55", "AI·데이터 인프라 창업자 인터뷰"],
    synopsis: ["더 시놉시스", "#c46a1c", "개별 기업 사업 구조 분석·투자자 인터뷰"]
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
    // __핵심 단어__ → 밑줄(섹션마다 몇 개만), **굵게**, [링크](url)
    function inl(s) { return esc(s).replace(/__(.+?)__/g, '<u class="kw">$1</u>').replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>'); }
    function close() { if (list) { out.push("</" + list + ">"); list = null; } }
    String(t).split(/\n/).forEach(function (ln) {
      var m;
      if (/^\s*$/.test(ln)) { close(); return; }
      // [[chart:N]] 줄 → 그 자리에 N번째(1부터) 그래프 — 내용이 나오는 곳에 그래프를 바로 붙인다
      if ((m = ln.match(/^\s*\[\[chart:(\d+)\]\]\s*$/))) { close(); var c = CUR && (CUR.charts || [])[+m[1] - 1]; if (c) out.push(fig(c)); return; }
      if ((m = ln.match(/^(#{2,4})\s+(.*)/))) { close(); var lv = Math.min(4, m[1].length + 1); out.push("<h" + lv + ">" + inl(m[2]) + "</h" + lv + ">"); return; }
      if ((m = ln.match(/^>\s?(.*)/))) { close(); out.push("<blockquote>" + inl(m[1]) + "</blockquote>"); return; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inl(m[1]) + "</li>"); return; }
      if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inl(m[1]) + "</li>"); return; }
      close(); out.push("<p>" + inl(ln) + "</p>");
    });
    close();
    return out.join("");
  }
  /* ── 그래프: ep.charts[] → 인라인 SVG ──
   * {title, sub, type:"bar"|"hbar"|"line", unit, labels:[..], series:[{name, values:[..]}], note, source, at:"tldr"|"summary"|"insights"|"deep"} */
  var PAL = ["#2f5fd0", "#e0782c", "#2f9a6a", "#9b59c6", "#c93447", "#5b6475"];
  function fmt(v) { var a = Math.abs(v); return a >= 100 ? Math.round(v).toLocaleString("ko-KR") : a >= 10 ? (Math.round(v * 10) / 10).toLocaleString("ko-KR") : (Math.round(v * 100) / 100).toLocaleString("ko-KR"); }
  function chartSvg(c) {
    var L = c.labels || [], S = (c.series || []).filter(function (s) { return s && s.values; }), W = 640, type = c.type || "bar";
    if (!L.length || !S.length) return "";
    var all = []; S.forEach(function (s) { s.values.forEach(function (v) { if (v != null && isFinite(v)) all.push(+v); }); });
    var hi = Math.max.apply(null, all.concat([0])), lo = Math.min.apply(null, all.concat([0])); if (hi === lo) hi = lo + 1;
    var g = [], u = c.unit ? " " + c.unit : "";
    if (type === "hbar") {
      var rowH = 30, lw = 170, H = L.length * rowH * Math.max(1, S.length) + 10, x0 = lw, x1 = W - 90;
      var X = function (v) { return x0 + (v - lo) / (hi - lo) * (x1 - x0); };
      L.forEach(function (lab, i) {
        S.forEach(function (s, j) {
          var v = s.values[i]; if (v == null) return;
          var y = 6 + (i * S.length + j) * rowH, xa = X(Math.min(0, v)), xb = X(Math.max(0, v));
          if (j === 0) g.push('<text x="' + (lw - 10) + '" y="' + (y + rowH / 2 + 4) + '" text-anchor="end" class="cl">' + esc(lab) + "</text>");
          g.push('<rect x="' + xa.toFixed(1) + '" y="' + (y + 5) + '" width="' + Math.max(1, xb - xa).toFixed(1) + '" height="' + (rowH - 10) + '" rx="4" fill="' + PAL[j % PAL.length] + '"/>');
          g.push('<text x="' + (xb + 6).toFixed(1) + '" y="' + (y + rowH / 2 + 4) + '" class="cv">' + fmt(v) + esc(u) + "</text>");
        });
      });
      return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(c.title) + '">' + g.join("") + "</svg>";
    }
    var H2 = 260, l = 50, r = 14, t = 18, b = 46, n = L.length;
    var Y = function (v) { return t + (hi - v) / (hi - lo) * (H2 - t - b); };
    for (var k = 0; k <= 4; k++) { var gv = lo + (hi - lo) * k / 4, gy = Y(gv); g.push('<line x1="' + l + '" x2="' + (W - r) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="cg"/><text x="' + (l - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="ca">' + fmt(gv) + "</text>"); }
    var slot = (W - l - r) / n;
    L.forEach(function (lab, i) { g.push('<text x="' + (l + slot * (i + .5)).toFixed(1) + '" y="' + (H2 - b + 18) + '" text-anchor="middle" class="ca">' + esc(lab) + "</text>"); });
    if (type === "line") {
      S.forEach(function (s, j) {
        var pts = []; s.values.forEach(function (v, i) { if (v != null) pts.push([l + slot * (i + .5), Y(v), v]); });
        g.push('<polyline fill="none" stroke="' + PAL[j % PAL.length] + '" stroke-width="2.5" points="' + pts.map(function (q) { return q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" ") + '"/>');
        pts.forEach(function (q, i) { g.push('<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3.5" fill="' + PAL[j % PAL.length] + '"/>'); if (S.length === 1 || i === pts.length - 1) g.push('<text x="' + q[0].toFixed(1) + '" y="' + (q[1] - 8).toFixed(1) + '" text-anchor="middle" class="cv">' + fmt(q[2]) + "</text>"); });
      });
    } else {
      var bw = Math.min(46, slot * .7 / S.length);
      L.forEach(function (lab, i) {
        S.forEach(function (s, j) {
          var v = s.values[i]; if (v == null) return;
          var x = l + slot * (i + .5) - bw * S.length / 2 + bw * j, ya = Y(Math.max(0, v)), yb = Y(Math.min(0, v));
          g.push('<rect x="' + x.toFixed(1) + '" y="' + ya.toFixed(1) + '" width="' + (bw - 3).toFixed(1) + '" height="' + Math.max(1, yb - ya).toFixed(1) + '" rx="3" fill="' + PAL[j % PAL.length] + '"/>');
          g.push('<text x="' + (x + (bw - 3) / 2).toFixed(1) + '" y="' + (ya - 5).toFixed(1) + '" text-anchor="middle" class="cv">' + fmt(v) + "</text>");
        });
      });
    }
    return '<svg viewBox="0 0 ' + W + " " + H2 + '" role="img" aria-label="' + esc(c.title) + '">' + g.join("") + "</svg>";
  }
  var CUR = null;   // 지금 그리는 에피소드 — md() 안의 [[chart:N]] 용
  function inlined(E) {
    var t = [E.summary_md, E.insights_md, E.deep_md].join("\n"), set = {}, m, re = /\[\[chart:(\d+)\]\]/g;
    while ((m = re.exec(t))) set[+m[1] - 1] = 1;
    return set;
  }
  function charts(E, at) {
    var inl = inlined(E);
    return (E.charts || []).filter(function (c, i) { return !inl[i] && (c.at || "tldr") === at; }).map(fig).join("");
  }
  function fig(c) {
    {
      var S = c.series || [];
      return '<figure class="chart"><figcaption><b>' + esc(c.title) + "</b>" + (c.sub ? "<span>" + esc(c.sub) + "</span>" : "") + "</figcaption>" +
        (S.length > 1 ? '<div class="leg">' + S.map(function (s, j) { return '<span><i style="background:' + PAL[j % PAL.length] + '"></i>' + esc(s.name) + "</span>"; }).join("") + "</div>" : "") +
        chartSvg(c) + ((c.note || c.source) ? '<p class="cnote">' + (c.note ? esc(c.note) : "") + (c.source ? (c.note ? " · " : "") + "출처: " + esc(c.source) : "") + "</p>" : "") + "</figure>";
    }
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
      '<p class="lede">6개 방송의 새 에피소드를 매시간 확인해 <b>누가 · 어느 회사 · 무슨 이야기</b>인지부터 정리하고, 내용 요약 뒤에 외부 자료로 검증한 딥 리서치를 붙입니다. · 갱신 ' + esc((IX.updated || "").replace(" KST", "")) + "</p>" +
      '<div class="chips" id="chips"><button data-v="all">전체 <small>' + eps.length + "</small></button>" +
      Object.keys(SHOWS).map(function (k) { return '<button data-v="' + k + '" title="' + esc(SHOWS[k][2]) + '"><i style="background:' + SHOWS[k][1] + '"></i>' + esc(SHOWS[k][0]) + " <small>" + (cnt[k] || 0) + "</small></button>"; }).join("") + "</div>" +
      '<div id="list"></div>';
    document.querySelectorAll("#chips button").forEach(function (b) { b.onclick = function () { f = b.dataset.v; draw(); }; });
    draw();
  }

  /* ── 에피소드 ── */
  function renderEp(row, E) {
    var g = (E && E.guest) || {}, c = (E && E.company) || {}, title = titleOf(row, E);
    document.title = title + " — 100억";
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
      (E && E.artifact_url ? '<a class="btn" href="' + esc(E.artifact_url) + '" target="_blank" rel="noopener">📄 요약 분석 <small>아티팩트</small></a>' : "") +
      (row.audio ? '<a class="btn" href="' + esc(row.audio) + '" target="_blank" rel="noopener">🎧 오디오 듣기</a>' : "") + "</div></div></div>";
    if (!E) {
      html += '<div class="pending">📝 아직 요약 전입니다. 예약 작업이 하루 3번 새 에피소드를 확인해 요약과 딥 리서치를 씁니다.</div>' +
        (row.desc_ko ? '<section><h2>방송 소개</h2><div class="note"><p>' + esc(row.desc_ko) + "</p></div></section>" : "");
    } else {
      CUR = E;
      if (E.tldr && E.tldr.length) html += '<section class="key"><h2>핵심 요약</h2><ul class="tldr">' + E.tldr.map(function (x) { return "<li>" + md(x).replace(/^<p>|<\/p>$/g, "") + "</li>"; }).join("") + "</ul>" + charts(E, "tldr") + "</section>";
      if (E.summary_md) html += '<section><h2>내용 정리</h2><div class="note">' + md(E.summary_md) + "</div>" + charts(E, "summary") + "</section>";
      if (E.insights_md) html += '<section><h2>투자 관점에서</h2><div class="note">' + md(E.insights_md) + "</div>" + charts(E, "insights") + "</section>";
      if (E.deep_md) html += '<section><h2>딥 리서치</h2><div class="note">' + md(E.deep_md) + "</div>" + charts(E, "deep") + "</section>";
      if (E.sources && E.sources.length) html += '<section><h2>출처</h2><ul class="tldr">' + E.sources.map(function (x) { return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.label || x.url) + "</a></li>"; }).join("") + "</ul></section>";
      if (E.no_transcript) html += '<div class="pending">대본을 구하지 못해 방송 소개글로만 요약했습니다.</div>';
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
