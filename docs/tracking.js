/* tracking.js — 트래킹(섹터·기업 뉴스 추적) 화면
   읽기: data/tracking/watchlist.json · data/tracking/items/<slug>.json (예약 작업 vantage-tracking 이 30분마다 갱신)
   쓰기: 기본은 깃허브 이슈(요청서) — 수집 작업(track_fetch.py site_requests)이 30분마다 반영. 블로그·유튜브는 주소 확인이 필요해 늘 이 길.
         (선택) 이 기기에 깃허브 열쇠를 저장하면 종목·섹터 단어는 watchlist.json 을 바로 고친다. 열쇠는 localStorage 에만 둔다. */
(function () {
  var REPO = "minwook1011/vantage-0910", PATH = "docs/data/tracking/watchlist.json";
  var TOKEN_KEY = "vantage-gh-token";            // 동기화 대상 아님(기기별)
  var SEL_KEY = "vantage-tracking-selected";
  var $ = function (s) { return document.querySelector(s); };
  var W = { terms: [] }, ITEMS = {}, sel = [];          // sel: 고른 칸 slug 여러 개(비면 전체)

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function getLS(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function setLS(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
  function json(p) {
    return window.vantageJSON ? window.vantageJSON(p, true) : fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw r; return r.json(); });
  }
  function tag(t) { return "#" + String(t).replace(/ /g, "_").replace(/[^\w가-힣]/g, ""); }
  function slugOf(term) {
    var a = term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (a.length >= 2 && /^[\x00-\x7f]+$/.test(term)) return a;
    var h = 2166136261;                                           // FNV-1a — 한글 단어용 고정 이름
    for (var i = 0; i < term.length; i++) { h ^= term.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return "t-" + ("0000000" + h.toString(16)).slice(-8);
  }
  function status(msg, bad) { var s = $("#status"); s.textContent = msg || ""; s.className = "status" + (bad ? " bad" : msg ? " ok" : ""); }
  function when(s) { return String(s || "").replace(/^\d{4}-/, "").replace(" KST", "").replace("-", "/"); }

  // ── 보기 ──
  var TAB_KEY = "vantage-tracking-tab";
  var tab = ["blog", "yt"].indexOf(getLS(TAB_KEY)) >= 0 ? getLS(TAB_KEY) : "news", q = "", editing = false;
  var TAB_NAME = { news: "종목·섹터", blog: "블로그", yt: "유튜브" };
  var GROUPS = [
    { key: "us", label: "해외 종목", test: function (t) { return t.market === "us"; } },
    { key: "kr", label: "한국 종목", test: function (t) { return t.market === "kr"; } },
    { key: "theme", label: "섹터·주제", test: function (t) { return t.market === "theme"; } },
    { key: "new", label: "정보 확인 중", test: function (t) { return !t.market; } }
  ];
  function isBlog(t) { return t.market === "blog"; }
  function isYT(t) { return t.market === "youtube"; }
  function tabOf(t) { return isBlog(t) ? "blog" : isYT(t) ? "yt" : "news"; }
  function inTab(t) { return tabOf(t) === tab; }
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }
  function termHit(t) {
    if (!q) return true;
    return [t.term, t.ticker, t.name].concat(t.aliases || []).some(function (x) { return norm(x).indexOf(q) >= 0; });
  }
  function itemHit(it) {
    if (!q) return true;
    return norm([it.headline, it.title, it.summary, it.source].concat(it.bullets || []).join(" ")).indexOf(q) >= 0;
  }
  function count(list) { return list.reduce(function (n, t) { return n + (ITEMS[t.slug] || []).length; }, 0); }
  function lastOf(t) { var it = (ITEMS[t.slug] || [])[0]; return it ? when(it.published) : ""; }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  function saveSel() { setLS(SEL_KEY, sel.length ? JSON.stringify(sel) : ""); }
  function isFresh(t) { var it = (ITEMS[t.slug] || [])[0]; return it && (Date.now() - Date.parse(String(it.published || "").replace(" KST", "+09:00").replace(" ", "T"))) < 24 * 3600e3; }
  // 칸 = 작은 이름표(이름 + 건수). 24시간 안에 새 글이 있으면 점. 자세한 정보는 마우스를 올리면.
  function tile(t) {
    var n = (ITEMS[t.slug] || []).length, last = lastOf(t);
    var sub = [t.ticker, t.name && t.name !== t.term ? t.name : ""].filter(Boolean).join(" · ");
    var tip = [sub, n ? n + "건 · 마지막 " + last : "아직 글 없음"].filter(Boolean).join(" · ");
    return '<button type="button" class="tile' + (sel.indexOf(t.slug) >= 0 ? " on" : "") + (n ? "" : " zero") + '" data-s="' + esc(t.slug) + '" data-term="' + esc(t.term) + '" title="' + esc(tip) + '">' +
      (isFresh(t) ? '<i class="dot"></i>' : "") + '<span class="tn">' + esc(t.term) + "</span>" +
      '<span class="tc">' + n + "</span>" +
      (editing ? '<span class="tx" title="삭제">×</span>' : "") + "</button>";
  }
  function renderTiles() {
    var all = W.terms.filter(inTab), shown = all.filter(termHit), html = "";
    ["news", "blog", "yt"].forEach(function (k) { $("#cnt-" + k).textContent = count(W.terms.filter(function (t) { return tabOf(t) === k; })); });
    each("#tabs button", function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (tab !== "news") {
      if (shown.length) html = '<div class="grp"><div class="gl">' + (tab === "yt" ? "구독 유튜브 채널" : "구독 블로그") + ' <em>' + shown.length + '</em></div><div class="grid">' + shown.map(tile).join("") + "</div></div>";
    } else {
      GROUPS.forEach(function (g) {
        var ts = shown.filter(g.test);
        if (ts.length) html += '<div class="grp"><div class="gl">' + g.label + " <em>" + ts.length + '</em></div><div class="grid">' + ts.map(tile).join("") + "</div></div>";
      });
    }
    if (!all.length) html = '<div class="empty">' + (tab === "news" ? "트래킹 중인 종목이 없습니다. ＋ 추가를 눌러 넣어 보세요." : "구독 중인 " + TAB_NAME[tab] + "가 없습니다. 주소를 Claude에게 알려 주세요.") + "</div>";
    else if (!shown.length) html = '<div class="empty small">이름이 맞는 ' + (tab === "news" ? "종목은" : TAB_NAME[tab] + "는") + " 없습니다. 아래는 글 내용으로 찾은 결과입니다.</div>";
    $("#tiles").innerHTML = html;
    $("#tiles").classList.toggle("editing", editing);
    each("#tiles .tile", function (b) {
      b.onclick = function () {
        var s = b.getAttribute("data-s"), term = b.getAttribute("data-term");
        if (editing) { if (confirm("'" + term + "' 트래킹을 그만할까요? 지난 기사는 남습니다.")) edit("del", term); return; }
        var i = sel.indexOf(s); i >= 0 ? sel.splice(i, 1) : sel.push(s);    // 여러 개 같이 고르기
        saveSel(); renderTiles(); renderList();
      };
    });
  }
  // 긴 정리본: '### 소제목' · '- 글머리' · 빈 줄 문단만 간단히
  function mdLite(md) {
    return String(md).split(/\n{2,}/).map(function (blk) {
      var lines = blk.split("\n");
      if (/^#{2,4}\s/.test(lines[0])) return "<h4>" + esc(lines[0].replace(/^#+\s*/, "")) + "</h4>" + (lines.length > 1 ? mdLite(lines.slice(1).join("\n")) : "");
      if (lines.every(function (l) { return /^\s*[-•]\s/.test(l); })) return "<ul>" + lines.map(function (l) { return "<li>" + esc(l.replace(/^\s*[-•]\s*/, "")) + "</li>"; }).join("") + "</ul>";
      return "<p>" + esc(blk).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") + "</p>";
    }).join("");
  }
  function card(it, t) {
    var paras = String(it.summary || "").split(/\n{2,}/).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    var detail = it.detail ? '<details class="sum full"><summary>▶ 영상 전체 정리 (' + Math.round(it.detail.length / 100) / 10 + "천 자)</summary>" + mdLite(it.detail) + "</details>" : "";
    return '<article class="item' + (isBlog(t) ? " blog" : isYT(t) ? " yt" : "") + '">' +
      '<div class="itop"><button type="button" class="itag" data-s="' + esc(t.slug) + '">' + (isBlog(t) ? "📝 " : isYT(t) ? "▶️ " : "") + esc(tag(t.term)) + "</button>" +
      '<span class="itime">' + esc(when(it.published)) + " · " + esc(it.source || "") + "</span></div>" +
      "<h3>" + esc(it.headline) + "</h3>" +
      '<ol class="bul">' + (it.bullets || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ol>" +
      (paras ? '<details class="sum"><summary>내용 요약</summary>' + paras + "</details>" : "") + detail +
      '<a class="src" href="' + esc(it.url) + '" target="_blank" rel="noopener">원문 ↗ ' + esc(it.title || it.source || "") + "</a>" +
      "</article>";
  }
  var ROWS = [];
  function mini(it, t, i) {
    var kind = isBlog(t) ? " blog" : isYT(t) ? " yt" : "";
    return '<div class="mini' + kind + '" tabindex="0" role="button" data-i="' + i + '">' +
      '<div class="itop"><button type="button" class="itag" data-s="' + esc(t.slug) + '">' + esc(tag(t.term)) + "</button>" +
      '<span class="itime">' + esc(when(it.published).replace(/^\d\d\/\d\d /, "")) + "</span></div>" +
      "<h3>" + esc(it.headline) + "</h3>" +
      '<p class="pv">' + esc((it.bullets || [])[0] || "") + "</p>" +
      '<div class="mfoot">' + esc(it.source || "") + "</div></div>";
  }
  function openReader(i) {
    var r = ROWS[i]; if (!r) return;
    $("#reader-body").innerHTML = card(r.it, r.t).replace("<details class=\"sum\">", "<details class=\"sum\" open>");
    $("#reader").hidden = false; document.body.classList.add("noscroll");
    $("#reader-body").scrollTop = 0;
    each("#reader-body .itag", function (b) {
      b.onclick = function () { closeReader(); sel = [b.getAttribute("data-s")]; saveSel(); renderTiles(); renderList(); };
    });
    $("#reader-prev").disabled = i <= 0; $("#reader-next").disabled = i >= ROWS.length - 1;
    $("#reader").setAttribute("data-i", i);
  }
  function closeReader() { $("#reader").hidden = true; document.body.classList.remove("noscroll"); }
  function step(d) { var i = +$("#reader").getAttribute("data-i") + d; if (ROWS[i]) openReader(i); }
  $("#reader").addEventListener("click", function (e) { if (e.target.id === "reader") closeReader(); });
  $("#reader-x").onclick = closeReader;
  $("#reader-prev").onclick = function () { step(-1); };
  $("#reader-next").onclick = function () { step(1); };
  document.addEventListener("keydown", function (e) {
    if ($("#reader").hidden) return;
    if (e.key === "Escape") closeReader(); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1);
  });
  function renderList() {
    var cur = W.terms.filter(function (t) { return sel.indexOf(t.slug) >= 0 && inTab(t); });
    if (!cur.length) cur = null;
    var rows = [];
    W.terms.forEach(function (t) {
      if (!inTab(t) || (cur && cur.indexOf(t) < 0)) return;
      var termMatch = q && termHit(t);
      (ITEMS[t.slug] || []).forEach(function (it) { if (cur || !q || termMatch || itemHit(it)) rows.push({ it: it, t: t }); });
    });
    rows.sort(function (a, b) { return (b.it.published || "").localeCompare(a.it.published || ""); });
    $("#list-title").textContent = (cur ? cur.map(function (t) { return tag(t.term); }).join(" ") : TAB_NAME[tab] + " 전체") +
      (q && !cur ? " · '" + $("#q").value.trim() + "' 검색" : "") + " · " + rows.length + "건";
    $("#btn-all").hidden = !cur;
    $("#btn-all").textContent = cur && cur.length > 1 ? "선택 " + cur.length + "개 해제 ×" : "전체 보기 ×";
    $("#btn-up").textContent = "↑ " + (tab === "news" ? "종목" : tab === "yt" ? "채널" : "블로그") + " 고르기";
    if (!rows.length) { $("#list").innerHTML = '<div class="empty">' + (q ? "검색 결과가 없습니다." : "아직 보낸 글이 없습니다. 30분마다 확인합니다.") + "</div>"; return; }
    // 기사는 작은 네모 칸(한 줄 4개)으로 — 누르면 전체 내용 창
    var html = "", day = "";
    ROWS = rows.slice(0, 200);
    ROWS.forEach(function (r, i) {
      var d = (r.it.published || "").slice(0, 10);
      if (d !== day) { html += (day ? "</div>" : "") + '<div class="day">' + esc(d) + '</div><div class="cards">'; day = d; }
      html += mini(r.it, r.t, i);
    });
    $("#list").innerHTML = html + "</div>";
    each("#list .mini", function (el) {
      el.onclick = function (e) { if (e.target.closest(".itag")) return; openReader(+el.getAttribute("data-i")); };
      el.onkeydown = function (e) { if (e.key === "Enter") openReader(+el.getAttribute("data-i")); };
    });
    each("#list .itag", function (b) {
      b.onclick = function () { sel = [b.getAttribute("data-s")]; saveSel(); renderTiles(); renderList(); $("#list-title").scrollIntoView({ behavior: "smooth", block: "start" }); };
    });
  }
  function renderChips() { renderTiles(); }      // 쓰기 쪽에서 부르는 이름 유지
  function loadAll() {
    return json("data/tracking/watchlist.json").catch(function () { return { terms: [] }; }).then(function (w) {
      W = w && w.terms ? w : { terms: [] };
      sel = sel.filter(function (s) { return W.terms.some(function (t) { return t.slug === s; }); });
      return Promise.all(W.terms.map(function (t) {
        return json("data/tracking/items/" + t.slug + ".json").then(function (d) { ITEMS[t.slug] = d.items || []; })
          .catch(function () { ITEMS[t.slug] = []; });
      }));
    }).then(function () { renderTiles(); renderList(); });
  }
  each("#tabs button", function (b) {
    b.onclick = function () { tab = b.getAttribute("data-tab"); setLS(TAB_KEY, tab); sel = []; saveSel(); renderTiles(); renderList(); if (window.__addUI) window.__addUI(); };
  });
  var qt;
  $("#q").addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { q = norm($("#q").value); renderTiles(); renderList(); }, 120); });
  // 사이트 상단 메뉴(고정)가 기사 머리줄을 가리지 않게 그 높이만큼 내려 붙인다
  function fitSticky() {
    var nav = document.getElementById("topnav"), h = nav ? nav.getBoundingClientRect().height : 0;
    var lh = document.querySelector(".list-head");
    lh.style.top = Math.round(h) + "px"; lh.style.scrollMarginTop = Math.round(h + 6) + "px";
    $("#tabs").style.scrollMarginTop = Math.round(h + 10) + "px";
  }
  window.addEventListener("resize", fitSticky); setTimeout(fitSticky, 300); setTimeout(fitSticky, 1500);
  $("#btn-up").onclick = function () { $("#tabs").scrollIntoView({ behavior: "smooth", block: "start" }); };
  $("#btn-all").onclick = function () { sel = []; saveSel(); renderTiles(); renderList(); };
  $("#btn-add").onclick = function () { var box = $("#add-box"); box.hidden = !box.hidden; if (!box.hidden) $("#add-input").focus(); };
  $("#btn-edit").onclick = function () {
    editing = !editing; this.classList.toggle("on", editing); this.textContent = editing ? "편집 끝" : "편집";
    status(editing ? "지울 칸을 누르세요." : ""); renderTiles();
  };

  // ── 쓰기(깃허브 API) ──
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function unb64(s) { return decodeURIComponent(escape(atob(String(s).replace(/\s/g, "")))); }
  function api(method, body) {
    var tok = getLS(TOKEN_KEY);
    return fetch("https://api.github.com/repos/" + REPO + "/contents/" + PATH + (method === "GET" ? "?ref=main&t=" + Date.now() : ""), {
      method: method, cache: "no-store",
      headers: { "Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("열쇠가 틀렸거나 권한이 없습니다(Contents 읽기·쓰기 필요).");
      if (r.status === 409) throw new Error("다른 곳에서 동시에 고쳤습니다. 다시 눌러 주세요.");
      if (!r.ok) throw new Error("깃허브 응답 " + r.status);
      return r.json();
    });
  }
  // '기판(티엘비, 심텍), 아마존(AMZN), 메타' → 기판·티엘비·심텍·아마존(AMZN 티커)·메타 각각 (track_fetch.py split_terms 와 같은 규칙)
  function splitTerms(s) {
    s = String(s || "").replace(/([^,(\n]*)\(([^)]*)\)/g, function (_, head, inner) {
      head = head.trim();
      var parts = inner.split(/[,/·\n]+/).map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length === 1 && /^[A-Za-z0-9.\-]{1,10}$/.test(parts[0])) return head + "\u0000" + parts[0].toUpperCase();
      return (head ? [head] : []).concat(parts).join(",");
    });
    var out = [], seen = {};
    s.split(/[,/·\n]+/).forEach(function (p) {
      p = p.trim(); if (!p) return;
      var kv = p.split("\u0000"), term = kv[0].trim();
      if (term && !seen[term]) { seen[term] = 1; out.push({ term: term, ticker: kv[1] || "" }); }
    });
    return out;
  }
  function edit(kind, raw) {
    var list = splitTerms(raw);
    if (!list.length) return;
    var term = list.map(function (x) { return x.term; }).join(", ");
    // 열쇠가 없거나 블로그·유튜브 추가면: 깃허브 이슈(요청서)로 보낸다 → 30분마다 도는 수집 작업이 주소를 확인해 넣는다(2026-10-13)
    if (!getLS(TOKEN_KEY) || (kind === "add" && tab !== "news")) { request(kind, raw); return; }
    status(kind === "add" ? "추가하는 중…" : "삭제하는 중…");
    api("GET").then(function (f) {
      var w = JSON.parse(unb64(f.content)); w.terms = w.terms || [];
      if (kind === "add") {
        var now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
        var added = list.filter(function (x) { return !w.terms.some(function (t) { return t.term === x.term; }); });
        if (!added.length) throw new Error("이미 트래킹 중: " + list.map(function (x) { return tag(x.term); }).join(" "));
        added.forEach(function (x) {
          w.terms.push({ term: x.term, slug: x.ticker ? x.ticker.toLowerCase().replace(/[^a-z0-9]+/g, "-") : slugOf(x.term), market: "",
            ticker: x.ticker, aliases: x.ticker ? [x.term, x.ticker] : [x.term], resolved: false, added: now, by: "site" });
        });
        term = added.map(function (x) { return x.term; }).join(", ");
      } else {
        var n = w.terms.length, names = list.map(function (x) { return x.term; });
        w.terms = w.terms.filter(function (t) { return names.indexOf(t.term) < 0; });
        if (w.terms.length === n) throw new Error("목록에 없는 단어: " + term);
      }
      return api("PUT", { message: "tracking: " + (kind === "add" ? "추가 " : "삭제 ") + term + " (사이트)", branch: "main",
        sha: f.sha, content: b64(JSON.stringify(w, null, 1) + "\n") }).then(function () { return w; });
    }).then(function (w) {
      W = w; if (kind === "del") { sel = []; saveSel(); }
      renderChips(); renderList();
      status(kind === "add" ? "✅ " + term.split(", ").map(tag).join(" ") + " 추가 — 다음 수집(30분 이내)부터 기사를 보냅니다. 사이트 반영은 1~2분 걸립니다." : "🗑 " + term + " 삭제했습니다.");
      $("#add-input").value = "";
    }).catch(function (e) { status(e.message || String(e), true); });
  }

  function request(kind, raw) {
    var label = kind === "add" ? (tab === "blog" ? "[트래킹·블로그] 추가: " : tab === "yt" ? "[트래킹·유튜브] 추가: " : "[트래킹] 추가: ") : "[트래킹] 삭제: ";
    var body = "트래킹 화면에서 보낸 요청입니다. 30분마다 도는 수집 작업이 확인해 반영합니다.\n\n" + raw;
    window.open("https://github.com/" + REPO + "/issues/new?title=" + encodeURIComponent(label + String(raw).trim()) + "&body=" + encodeURIComponent(body), "_blank", "noopener");
    status("깃허브 창에서 'Submit new issue'(제출)를 누르면 요청이 남고, 30분 안에 반영됩니다.");
    $("#add-input").value = "";
  }
  var ADD_UI = {
    news: ["＋ 종목·섹터 추가", "종목·섹터 이름 (쉼표로 여러 개: 네비우스, 삼성전기, 광통신)", "텔레그램 뉴스방에 <code>기판 추가</code>, <code>삼성전기 빼줘</code>, <code>목록</code>처럼 보내도 됩니다. 추가하면 다음 수집(30분 이내)부터 반영됩니다."],
    blog: ["＋ 블로그 추가", "네이버 블로그 주소나 아이디 (예: blog.naver.com/pillion21)", "블로그 주소를 넣으면 30분 안에 구독을 시작하고, 최근 글 5개도 요약해 둡니다. 새 글은 모두 요약해 텔레그램 블로그방으로 보냅니다."],
    yt: ["＋ 유튜브 추가", "유튜브 채널 주소 (예: youtube.com/@understanding.)", "채널 주소를 넣으면 30분 안에 구독을 시작하고, 최근 영상 3개도 정리해 둡니다. 새 영상은 모두 요약합니다(쇼츠 제외)."]
  };
  function addUI() {
    var u = ADD_UI[tab] || ADD_UI.news;
    $("#btn-add").textContent = u[0]; $("#add-input").placeholder = u[1]; $("#add-hint").innerHTML = u[2];
  }
  addUI(); window.__addUI = addUI;
  $("#add-form").addEventListener("submit", function (e) { e.preventDefault(); edit("add", $("#add-input").value); });
  function tokenState() { $("#token-state").textContent = getLS(TOKEN_KEY) ? "이 기기에 열쇠가 저장돼 있습니다." : "저장된 열쇠가 없습니다."; }
  $("#token-save").onclick = function () { var v = $("#token-input").value.trim(); if (!v) return; setLS(TOKEN_KEY, v); $("#token-input").value = ""; tokenState(); status("열쇠를 저장했습니다. 이제 추가·삭제할 수 있습니다."); };
  $("#token-clear").onclick = function () { setLS(TOKEN_KEY, ""); tokenState(); };
  tokenState();
  try { sel = JSON.parse(getLS(SEL_KEY) || "[]"); if (!Array.isArray(sel)) sel = []; } catch (e) { sel = []; }
  loadAll();
})();
