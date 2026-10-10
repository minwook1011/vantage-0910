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
  function renderChips() {
    var total = 0;
    var chips = W.terms.map(function (t) {
      var n = (ITEMS[t.slug] || []).length; total += n;
      return '<span class="chip' + (sel === t.slug ? " on" : "") + '" data-s="' + esc(t.slug) + '">' +
        '<button type="button" class="pick">' + (t.market === "blog" ? "📝 " : "") + esc(tag(t.term)) + (t.ticker ? " <small>" + esc(t.ticker) + "</small>" : "") +
        ' <em>' + n + '</em></button><button type="button" class="del" title="트래킹 삭제" data-term="' + esc(t.term) + '">×</button></span>';
    }).join("");
    $("#chips").innerHTML = '<span class="chip' + (sel === "__all" ? " on" : "") + '" data-s="__all"><button type="button" class="pick">전체 <em>' + total + "</em></button></span>" + chips;
    Array.prototype.forEach.call(document.querySelectorAll("#chips .pick"), function (b) {
      b.onclick = function () { sel = b.parentNode.getAttribute("data-s"); setLS(SEL_KEY, sel); renderChips(); renderList(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#chips .del"), function (b) {
      b.onclick = function () { var t = b.getAttribute("data-term"); if (confirm("'" + t + "' 트래킹을 그만할까요? 지난 기사는 남습니다.")) edit("del", t); };
    });
  }
  function card(it, t) {
    var paras = String(it.summary || "").split(/\n{2,}/).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
    return '<article class="item">' +
      '<div class="itop"><span class="itag">' + (t.market === "blog" ? "📝 블로그 " : "") + esc(tag(t.term)) + "</span><span class=\"itime\">" + esc(when(it.published)) + " · " + esc(it.source || "") + "</span></div>" +
      "<h3>" + esc(it.headline) + "</h3>" +
      "<ol class=\"bul\">" + (it.bullets || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ol>" +
      (paras ? '<details class="sum"><summary>내용 요약</summary>' + paras + "</details>" : "") +
      '<a class="src" href="' + esc(it.url) + '" target="_blank" rel="noopener">원문 보기 · ' + esc(it.title || it.source || "") + " ↗</a>" +
      "</article>";
  }
  function renderList() {
    var rows = [];
    W.terms.forEach(function (t) {
      if (sel !== "__all" && sel !== t.slug) return;
      (ITEMS[t.slug] || []).forEach(function (it) { rows.push({ it: it, t: t }); });
    });
    rows.sort(function (a, b) { return (b.it.published || "").localeCompare(a.it.published || ""); });
    if (!W.terms.length) { $("#list").innerHTML = '<div class="empty">트래킹 중인 단어가 없습니다. 위에서 추가해 보세요.</div>'; return; }
    if (!rows.length) { $("#list").innerHTML = '<div class="empty">아직 보낸 기사가 없습니다. 30분마다 확인합니다.</div>'; return; }
    var html = "", day = "";
    rows.slice(0, 200).forEach(function (r) {
      var d = (r.it.published || "").slice(0, 10);
      if (d !== day) { day = d; html += '<div class="day">' + esc(d) + "</div>"; }
      html += card(r.it, r.t);
    });
    $("#list").innerHTML = html;
  }
  function loadAll() {
    return json("data/tracking/watchlist.json").catch(function () { return { terms: [] }; }).then(function (w) {
      W = w && w.terms ? w : { terms: [] };
      if (sel !== "__all" && !W.terms.some(function (t) { return t.slug === sel; })) sel = "__all";
      return Promise.all(W.terms.map(function (t) {
        return json("data/tracking/items/" + t.slug + ".json").then(function (d) { ITEMS[t.slug] = d.items || []; })
          .catch(function () { ITEMS[t.slug] = []; });
      }));
    }).then(function () { renderChips(); renderList(); });
  }

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
