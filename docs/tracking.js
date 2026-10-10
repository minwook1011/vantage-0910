/* tracking.js — 트래킹(섹터·기업 뉴스 추적) 화면
   읽기: data/tracking/watchlist.json · data/tracking/items/<slug>.json (예약 작업 vantage-tracking 이 30분마다 갱신)
   쓰기: 이 기기에 저장한 깃허브 열쇠로 watchlist.json 을 직접 고친다(깃허브 API). 열쇠는 localStorage 에만 둔다. */
(function () {
  var REPO = "minwook1011/vantage-0910", PATH = "docs/data/tracking/watchlist.json";
  var TOKEN_KEY = "vantage-gh-token";            // 동기화 대상 아님(기기별)
  var SEL_KEY = "vantage-tracking-selected";
  var $ = function (s) { return document.querySelector(s); };
  var W = { terms: [] }, ITEMS = {}, sel = "__all";

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
  var tab = getLS(TAB_KEY) === "blog" ? "blog" : "news", q = "", editing = false;
  var GROUPS = [
    { key: "us", label: "해외 종목", test: function (t) { return t.market === "us"; } },
    { key: "kr", label: "한국 종목", test: function (t) { return t.market === "kr"; } },
    { key: "theme", label: "섹터·주제", test: function (t) { return t.market === "theme"; } },
    { key: "new", label: "정보 확인 중", test: function (t) { return !t.market; } }
  ];
  function isBlog(t) { return t.market === "blog"; }
  function inTab(t) { return tab === "blog" ? isBlog(t) : !isBlog(t); }
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

  function tile(t) {
    var n = (ITEMS[t.slug] || []).length, last = lastOf(t);
    var sub = isBlog(t) ? (t.name || "") : [t.ticker, t.name && t.name !== t.term ? t.name : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="tile' + (sel === t.slug ? " on" : "") + (n ? "" : " zero") + '" data-s="' + esc(t.slug) + '" data-term="' + esc(t.term) + '">' +
      '<span class="tn">' + esc(t.term) + "</span>" +
      (sub ? '<span class="ts">' + esc(sub) + "</span>" : "") +
      '<span class="tf"><b>' + n + "건</b>" + (last ? " · " + esc(last) : n ? "" : " · 아직 없음") + "</span>" +
      (editing ? '<span class="tx" title="삭제">×</span>' : "") + "</button>";
  }
  function renderTiles() {
    var all = W.terms.filter(inTab), shown = all.filter(termHit), html = "";
    $("#cnt-news").textContent = count(W.terms.filter(function (t) { return !isBlog(t); }));
    $("#cnt-blog").textContent = count(W.terms.filter(isBlog));
    each("#tabs button", function (b) {
      var on = b.getAttribute("data-tab") === tab;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (tab === "blog") {
      if (shown.length) html = '<div class="grp"><div class="gl">구독 블로그 <em>' + shown.length + '</em></div><div class="grid">' + shown.map(tile).join("") + "</div></div>";
    } else {
      GROUPS.forEach(function (g) {
        var ts = shown.filter(g.test);
        if (ts.length) html += '<div class="grp"><div class="gl">' + g.label + " <em>" + ts.length + '</em></div><div class="grid">' + ts.map(tile).join("") + "</div></div>";
      });
    }
    if (!all.length) html = '<div class="empty">' + (tab === "blog" ? "구독 중인 블로그가 없습니다. 블로그 주소를 Claude에게 알려 주세요." : "트래킹 중인 종목이 없습니다. ＋ 추가를 눌러 넣어 보세요.") + "</div>";
    else if (!shown.length) html = '<div class="empty small">이름이 맞는 ' + (tab === "blog" ? "블로그는" : "종목은") + " 없습니다. 아래는 글 내용으로 찾은 결과입니다.</div>";
    $("#tiles").innerHTML = html;
    $("#tiles").classList.toggle("editing", editing);
    each("#tiles .tile", function (b) {
      b.onclick = function () {
        var s = b.getAttribute("data-s"), term = b.getAttribute("data-term");
        if (editing) { if (confirm("'" + term + "' 트래킹을 그만할까요? 지난 기사는 남습니다.")) edit("del", term); return; }
        sel = sel === s ? "__all" : s; setLS(SEL_KEY, sel); renderTiles(); renderList();
        if (sel !== "__all") $("#list-title").scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });
  }
  function card(it, t) {
    var paras = String(it.summary || "").split(/\n{2,}/).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    return '<article class="item' + (isBlog(t) ? " blog" : "") + '">' +
      '<div class="itop"><button type="button" class="itag" data-s="' + esc(t.slug) + '">' + (isBlog(t) ? "📝 " : "") + esc(tag(t.term)) + "</button>" +
      '<span class="itime">' + esc(when(it.published)) + " · " + esc(it.source || "") + "</span></div>" +
      "<h3>" + esc(it.headline) + "</h3>" +
      '<ol class="bul">' + (it.bullets || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ol>" +
      (paras ? '<details class="sum"><summary>내용 요약</summary>' + paras + "</details>" : "") +
      '<a class="src" href="' + esc(it.url) + '" target="_blank" rel="noopener">원문 ↗ ' + esc(it.title || it.source || "") + "</a>" +
      "</article>";
  }
  function renderList() {
    var cur = W.terms.filter(function (t) { return t.slug === sel; })[0];
    if (cur && !inTab(cur)) { sel = "__all"; cur = null; }
    var rows = [];
    W.terms.forEach(function (t) {
      if (!inTab(t) || (cur && t !== cur)) return;
      var termMatch = q && termHit(t);
      (ITEMS[t.slug] || []).forEach(function (it) { if (cur || !q || termMatch || itemHit(it)) rows.push({ it: it, t: t }); });
    });
    rows.sort(function (a, b) { return (b.it.published || "").localeCompare(a.it.published || ""); });
    $("#list-title").textContent = (cur ? tag(cur.term) : tab === "blog" ? "블로그 전체" : "종목·섹터 전체") +
      (q && !cur ? " · '" + $("#q").value.trim() + "' 검색" : "") + " · " + rows.length + "건";
    $("#btn-all").hidden = !cur;
    $("#btn-up").textContent = tab === "blog" ? "↑ 블로그 고르기" : "↑ 종목 고르기";
    if (!rows.length) { $("#list").innerHTML = '<div class="empty">' + (q ? "검색 결과가 없습니다." : "아직 보낸 글이 없습니다. 30분마다 확인합니다.") + "</div>"; return; }
    var html = "", day = "";
    rows.slice(0, 150).forEach(function (r) {
      var d = (r.it.published || "").slice(0, 10);
      if (d !== day) { day = d; html += '<div class="day">' + esc(d) + "</div>"; }
      html += card(r.it, r.t);
    });
    $("#list").innerHTML = html;
    each("#list .itag", function (b) {
      b.onclick = function () { sel = b.getAttribute("data-s"); setLS(SEL_KEY, sel); renderTiles(); renderList(); $("#list-title").scrollIntoView({ behavior: "smooth", block: "start" }); };
    });
  }
  function renderChips() { renderTiles(); }      // 쓰기 쪽에서 부르는 이름 유지
  function loadAll() {
    return json("data/tracking/watchlist.json").catch(function () { return { terms: [] }; }).then(function (w) {
      W = w && w.terms ? w : { terms: [] };
      if (sel !== "__all" && !W.terms.some(function (t) { return t.slug === sel; })) sel = "__all";
      return Promise.all(W.terms.map(function (t) {
        return json("data/tracking/items/" + t.slug + ".json").then(function (d) { ITEMS[t.slug] = d.items || []; })
          .catch(function () { ITEMS[t.slug] = []; });
      }));
    }).then(function () { renderTiles(); renderList(); });
  }
  each("#tabs button", function (b) {
    b.onclick = function () { tab = b.getAttribute("data-tab"); setLS(TAB_KEY, tab); sel = "__all"; setLS(SEL_KEY, sel); renderTiles(); renderList(); };
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
  $("#btn-all").onclick = function () { sel = "__all"; setLS(SEL_KEY, sel); renderTiles(); renderList(); };
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
    if (!getLS(TOKEN_KEY)) { $("#token-box").open = true; status("이 기기에 깃허브 열쇠를 먼저 저장해 주세요(아래 안내). 또는 텔레그램 봇에 /" + (kind === "add" ? "추가 " : "삭제 ") + term, true); return; }
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
      W = w; if (kind === "del" && sel !== "__all") sel = "__all";
      renderChips(); renderList();
      status(kind === "add" ? "✅ " + term.split(", ").map(tag).join(" ") + " 추가 — 다음 수집(30분 이내)부터 기사를 보냅니다. 사이트 반영은 1~2분 걸립니다." : "🗑 " + term + " 삭제했습니다.");
      $("#add-input").value = "";
    }).catch(function (e) { status(e.message || String(e), true); });
  }

  $("#add-form").addEventListener("submit", function (e) { e.preventDefault(); edit("add", $("#add-input").value); });
  function tokenState() { $("#token-state").textContent = getLS(TOKEN_KEY) ? "이 기기에 열쇠가 저장돼 있습니다." : "저장된 열쇠가 없습니다."; }
  $("#token-save").onclick = function () { var v = $("#token-input").value.trim(); if (!v) return; setLS(TOKEN_KEY, v); $("#token-input").value = ""; tokenState(); status("열쇠를 저장했습니다. 이제 추가·삭제할 수 있습니다."); };
  $("#token-clear").onclick = function () { setLS(TOKEN_KEY, ""); tokenState(); };
  tokenState();
  sel = getLS(SEL_KEY) || "__all";
  loadAll();
})();
