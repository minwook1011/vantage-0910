/* trends.js — 검색 트렌드 보드 (trends.html)
   2026-10-12 사용자: 소비재 브랜드·상품 검색 관심도를 카드로 모아 트렌드를 먼저 포착.
   데이터: data/trends/board.json (fetch_trend_board.py — 구글 트렌드 최근 5년 주간, 키워드마다 최댓값 100)
   관심(하트): 기기 간 동기화되는 기존 키 "vantage-datahub-favorite-companies-v1" 의 tr 칸(새 키를 만들지 않는다). */
(function () {
  "use strict";
  var app = document.getElementById("tb");
  var FKEY = "vantage-datahub-favorite-companies-v1";
  var CATS = [["all", "전체"], ["food", "먹거리"], ["fashion", "패션·뷰티"], ["house", "생활·집"], ["hobby", "취미·콘텐츠"], ["etc", "기타"]];
  var MKS = [["all", "전체"], ["us", "미국"], ["jp", "일본"], ["kr", "한국"], ["hk", "홍콩"]];
  var SORTS = [["spk", "급등"], ["yoy", "전년 대비"], ["now", "현재 관심도"]];
  var GEO = { US: "미국", JP: "일본", KR: "한국", "": "전 세계" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function root() { try { var v = JSON.parse(localStorage.getItem(FKEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }
  function favs() { var r = root(); return Array.isArray(r.tr) ? r.tr : []; }
  function setFavs(a) { try { var r = root(); r.tr = a; localStorage.setItem(FKEY, JSON.stringify(r)); } catch (e) {} }
  var st = { cat: "all", mk: "all", sort: "spk", q: "", fav: false };
  try { var sv = JSON.parse(localStorage.getItem("trends-view") || "null"); if (sv) { st.cat = sv.cat || "all"; st.mk = sv.mk || "all"; st.sort = sv.sort || "spk"; } } catch (e) {}
  function keep() { try { localStorage.setItem("trends-view", JSON.stringify({ cat: st.cat, mk: st.mk, sort: st.sort })); } catch (e) {} }

  function pct(v) { return v == null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1) + "%"; }
  function cls(v) { return v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : ""; }
  function spark(pts, partial) {
    var n = pts.length; if (n < 2) return "";
    var W = 200, H = 54, max = Math.max.apply(null, pts.concat([1]));
    var xy = pts.map(function (v, i) { return [(i / (n - 1)) * W, H - 3 - (v / max) * (H - 8)]; });
    var full = partial ? xy.slice(0, -1) : xy;
    var d = full.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("");
    var ya = Math.round(n - 53), mark = ya > 0 ? '<line x1="' + xy[ya][0].toFixed(1) + '" x2="' + xy[ya][0].toFixed(1) + '" y1="2" y2="' + H + '" class="ya"/>' : "";
    var tail = partial ? '<path d="M' + xy[n - 2][0].toFixed(1) + " " + xy[n - 2][1].toFixed(1) + "L" + xy[n - 1][0].toFixed(1) + " " + xy[n - 1][1].toFixed(1) + '" class="pt"/>' : "";
    return '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' + mark + '<path d="' + d + '" class="ln"/>' + tail + "</svg>";
  }
  function stockLink(x) {
    if (x.mk === "jp") return "jp-screener.html?u=consumer&code=" + encodeURIComponent(x.tk);
    if (x.hub) return "datahub.html?co=" + encodeURIComponent(x.tk) + "#company";
    return "";
  }
  function gUrl(x) { return "https://trends.google.com/trends/explore?date=today%205-y" + (x.geo ? "&geo=" + x.geo : "") + "&q=" + encodeURIComponent(x.kw); }

  fetch("data/trends/board.json?t=" + Date.now(), { cache: "no-cache" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (D) {
    var all = D.items || [];
    function draw() {
      keep();
      var F = favs(), q = st.q.toLowerCase();
      var L = all.filter(function (x) {
        if (st.cat !== "all" && x.cat !== st.cat) return false;
        if (st.mk !== "all" && x.mk !== st.mk) return false;
        if (st.fav && F.indexOf(x.k) < 0) return false;
        return !q || x.kw.toLowerCase().indexOf(q) >= 0 || String(x.tk).toLowerCase().indexOf(q) >= 0;
      });
      var key = st.sort;
      L.sort(function (a, b) { var va = a[key], vb = b[key]; if (va == null) va = -1e9; if (vb == null) vb = -1e9; return vb - va; });
      var seg = function (k, arr) { return '<div class="tb-seg">' + arr.map(function (o) { return '<button data-' + k + '="' + o[0] + '"' + (st[k] === o[0] ? ' aria-pressed="true"' : "") + ">" + o[1] + "</button>"; }).join("") + "</div>"; };
      var hot = all.filter(function (x) { return x.spk != null && x.spk >= 30 && x.now >= 20; }).length;
      var h = '<div class="tb-head"><div><div class="kicker">검색 트렌드</div><h1>소비재 검색 트렌드</h1>' +
        '<div class="tb-sub">브랜드·상품 ' + all.length + "개 키워드의 구글 검색 관심도 · 최근 4주 급등 " + hot + "개 · 갱신 " + esc(D.updated || "") + "</div></div></div>" +
        '<div class="tb-bar">' + seg("cat", CATS) + seg("mk", MKS) +
        '<input type="search" id="tb-q" placeholder="키워드 · 티커 검색" value="' + esc(st.q) + '">' +
        '<button class="tb-fav' + (st.fav ? " on" : "") + '" id="tb-fav">♥ 관심 ' + F.length + "</button>" +
        '<span class="tb-sp"></span>' + seg("sort", SORTS) + "</div>" +
        '<div class="tb-grid">' + (L.length ? L.map(function (x) {
          var on = F.indexOf(x.k) >= 0, link = stockLink(x), main = x[st.sort === "now" ? "spk" : st.sort];
          return '<article class="tc">' +
            '<button class="tc-h' + (on ? " on" : "") + '" data-k="' + esc(x.k) + '" title="관심 표시">' + (on ? "♥" : "♡") + "</button>" +
            '<a class="tc-kw" href="' + gUrl(x) + '" target="_blank" rel="noopener" title="구글 트렌드에서 보기">' + esc(x.kw) + "</a>" +
            '<div class="tc-m">' + (link ? '<a class="tc-tk" href="' + link + '" target="_blank" rel="noopener" title="새 탭에서 재무제표·차트">' + esc(x.tk) + "</a>" : '<span class="tc-tk">' + esc(x.tk) + "</span>") +
            '<span class="tc-geo">' + esc(GEO[x.geo] != null ? GEO[x.geo] : x.geo) + "</span>" +
            '<b class="' + cls(x.yoy) + '" title="최근 4주 평균 ÷ 1년 전 같은 4주">전년 ' + pct(x.yoy) + "</b>" +
            '<b class="' + cls(x.spk) + '" title="최근 4주 평균 ÷ 그 앞 12주">급등 ' + pct(x.spk) + "</b></div>" +
            '<div class="tc-now">현재 ' + (x.now != null ? Math.round(x.now) : "—") + "<small>/100</small></div>" +
            '<div class="tc-sp">' + spark(x.pts || [], x.partial) + "</div></article>";
        }).join("") : '<div class="tb-empty">조건에 맞는 키워드가 없습니다.</div>') + "</div>" +
        '<div class="tb-note">구글 트렌드 · 최근 2년 주간(카드 차트), 키워드마다 최근 5년 최댓값을 100으로 둔 상대값이라 <b>키워드끼리 크기 비교는 안 되고 각자의 흐름만</b> 봅니다. ' +
        "<b>급등</b> = 최근 4주 평균 ÷ 그 앞 12주 평균, <b>전년</b> = 최근 4주 평균 ÷ 1년 전 같은 4주. 집계 중인 이번 주는 계산에서 빼고 차트에 점선으로 표시, 세로 점선은 1년 전 위치. " +
        "키워드를 누르면 구글 트렌드 원본, 티커를 누르면 재무제표·차트가 새 탭으로 열립니다. 매주 월요일 아침 갱신.</div>";
      app.innerHTML = h;
      app.querySelectorAll("[data-cat]").forEach(function (b) { b.onclick = function () { st.cat = b.dataset.cat; draw(); }; });
      app.querySelectorAll("[data-mk]").forEach(function (b) { b.onclick = function () { st.mk = b.dataset.mk; draw(); }; });
      app.querySelectorAll("[data-sort]").forEach(function (b) { b.onclick = function () { st.sort = b.dataset.sort; draw(); }; });
      app.querySelector("#tb-fav").onclick = function () { st.fav = !st.fav; draw(); };
      app.querySelectorAll(".tc-h").forEach(function (b) { b.onclick = function () { var a = favs(), i = a.indexOf(b.dataset.k); if (i >= 0) a.splice(i, 1); else a.push(b.dataset.k); setFavs(a); draw(); }; });
      var qi = app.querySelector("#tb-q"), tm;
      qi.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { st.q = qi.value.trim(); draw(); var q2 = app.querySelector("#tb-q"); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }, 200); };
    }
    draw();
  }).catch(function () { app.innerHTML = '<div class="tb-empty">검색 트렌드 자료를 불러오지 못했습니다.</div>'; });
})();
