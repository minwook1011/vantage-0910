/* 공통 상단 내비게이션 + 티커 테이프 + 유틸 — 모든 페이지에서 로드 */
(function () {
  var PAGES = [
    ["index.html", "시작"],
    ["portfolio.html", "포트폴리오"],
    ["dashboard.html", "섹터 대시보드"],
    ["megacap.html", "글로벌 메가캡"],
    ["bottomup.html", "Bottom-up 발굴"],
    ["perspective.html", "핵심 테제 트래킹"],
    ["worldflow.html", "세상 흐름 파악"],
    ["news.html", "실시간 뉴스"],
    ["earnings.html", "미국 주요 실적 정리"],
    ["macro.html", "매크로 및 투자전략"],
    ["datahub.html", "데이터 허브"],
    ["coverage.html", "Coverage"],
  ];
  var here = location.pathname.split("/").pop() || "index.html";
  var nav = document.getElementById("topnav");
  if (nav) {
    var links = PAGES.map(function (p) {
      var act = p[0] === here ? " active" : "";
      var route = p[0] === "index.html" ? " data-route-home" : " data-route";
      return '<a class="navlink' + act + '"' + route + ' href="' + p[0] + '">' + p[1] + "</a>";
    }).join("");
    nav.innerHTML =
      '<div class="nav-inner"><a class="brand route-home" data-route-home href="index.html">VANTAGE<span class="dot">·</span></a>' +
      links + '<button class="gate-logout" type="button" title="이 기기에서 다시 잠그기" aria-label="다시 잠그기">🔒 잠금</button></div><div id="tape"></div>';
    if (window.VantageCloud && typeof window.VantageCloud.mount === "function") window.VantageCloud.mount(nav.querySelector(".nav-inner"));
    var logout = nav.querySelector(".gate-logout");
    if (logout) logout.addEventListener("click", function () {
      if (typeof window.vantageGateLogout === "function") window.vantageGateLogout();
    });
  }

  /* 티커 테이프: 주요 벤치마크·섹터 등락을 흐르는 띠로 표시 */
  var TAPE_TICKERS = ["ACWI", "XLK", "SOXX", "XLF", "XLE", "ITA", "EWY", "229200.KS",
    "EWJ", "FXI", "GLD", "TLT", "URA", "BOTZ"];
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  fetch("data.json?v=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    var tape = document.getElementById("tape");
    if (!tape || !d || !d.etfs) return;
    var items = TAPE_TICKERS.map(function (tk) { return d.etfs[tk]; }).filter(Boolean)
      .map(function (e) {
        var v = typeof e.r1d === "number" ? e.r1d : 0;
        var cls = v > 0 ? "up" : v < 0 ? "dn" : "flat";
        var ccy = /\.K[SQ]$/.test(e.ticker) ? "₩" : "$";
        var px = e.price >= 1000 ? Math.round(e.price).toLocaleString() : (+e.price).toFixed(2);
        return '<a class="tape-item" data-route href="dashboard.html">' +
          '<span class="t-nm">' + esc(e.name) + '</span>' +
          '<span class="t-px">' + ccy + px + '</span>' +
          '<span class="' + cls + '">' + (v > 0 ? "+" : "") + v.toFixed(2) + "%</span></a>";
      }).join("");
    if (!items) { tape.style.display = "none"; return; }
    /* 무한 스크롤: 동일 콘텐츠 2벌을 이어붙여 -50% 이동 루프 */
    tape.innerHTML = '<div class="tape-track">' + items + items + "</div>";
  }).catch(function () {
    var tape = document.getElementById("tape");
    if (tape) tape.style.display = "none";
  });
})();

/* ---------- 화면 간 진입·복귀 모션 ---------- */
(function () {
  var KEY = "vantage-route-motion";
  function readMotion() {
    try { var v = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); return v; } catch (e) { return null; }
  }
  function showEnter(backward) {
    document.documentElement.classList.remove("route-leaving", "route-leaving-back");
    document.documentElement.classList.add(backward ? "route-return" : "route-enter");
    setTimeout(function () { document.documentElement.classList.remove("route-return", "route-enter"); }, 700);
  }
  if (readMotion() === "enter") showEnter(false);
  window.addEventListener("pageshow", function (event) {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (event.persisted || (nav && nav.type === "back_forward")) showEnter(true);
  });
  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("a[data-route], a[data-route-home]");
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return;
    var href = link.getAttribute("href");
    if (!href || href.charAt(0) === "#" || /^(https?:|mailto:|tel:)/.test(href)) return;
    event.preventDefault();
    var goingHome = link.hasAttribute("data-route-home");
    try { sessionStorage.setItem(KEY, goingHome ? "back" : "enter"); } catch (e) {}
    document.documentElement.classList.add(goingHome ? "route-leaving-back" : "route-leaving");
    setTimeout(function () { location.href = link.href; }, goingHome ? 340 : 300);
  });
})();

/* 전역 헬퍼 */
function $q(sel, root) { return (root || document).querySelector(sel); }
function $qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

/* ================= 우측 목차(ToC) — 오른쪽 여백에 고정, 클릭 시 해당 섹션으로 스크롤 =================
   페이지의 .section > h2 (및 접이식 .wk-section .wk-title)를 자동 수집해 목차를 만든다.
   넓은 화면(가운데 1280px 컨테이너 바깥 여백이 충분할 때)에서만 표시. */
(function () {
  function buildTOC() {
    if (document.getElementById("page-toc")) return;
    var items = [];
    var idx = 0;
    $qa(".container .section").forEach(function (sec) {
      // 섹션의 대표 제목: 직계 h2, 없으면 내부 .wk-title(접이식)
      var h2 = sec.querySelector(":scope > h2");
      var titleEl = h2 || sec.querySelector(".wk-head .wk-title");
      if (!titleEl) return;
      // .sub(부제) 제외한 순수 제목만
      var clone = titleEl.cloneNode(true);
      $qa(".sub", clone).forEach(function (s) { s.remove(); });
      var label = (clone.textContent || "").trim();
      if (!label) return;
      if (!sec.id) sec.id = "toc-sec-" + (idx);
      items.push({ id: sec.id, label: label });
      idx++;
    });
    if (items.length < 2) return;  // 섹션 1개뿐이면 목차 불필요

    var toc = document.createElement("nav");
    toc.id = "page-toc";
    toc.setAttribute("aria-label", "페이지 목차");
    toc.innerHTML = '<div class="toc-title">목차</div>' + items.map(function (it) {
      return '<a class="toc-link" href="#' + it.id + '" data-target="' + it.id + '">' + esc2(it.label) + "</a>";
    }).join("");
    document.body.appendChild(toc);

    var links = $qa(".toc-link", toc);
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        var el = document.getElementById(a.dataset.target);
        if (el && el.offsetParent !== null) {  // 숨겨진(탭 비활성) 섹션은 무시
          var y = el.getBoundingClientRect().top + window.pageYOffset - 74;  // 상단 고정 네비 높이 보정
          window.scrollTo({ top: y, behavior: "smooth" });
        }
      });
    });

    // 스크롤스파이: 현재 화면 상단에 가장 가까운 섹션 강조
    var secEls = items.map(function (it) { return document.getElementById(it.id); });
    function spy() {
      var best = 0, bestDist = Infinity;
      for (var i = 0; i < secEls.length; i++) {
        if (!secEls[i] || secEls[i].offsetParent === null) continue;
        var top = secEls[i].getBoundingClientRect().top - 90;
        var dist = Math.abs(top);
        if (top <= 40 && dist < bestDist) { bestDist = dist; best = i; }
      }
      links.forEach(function (a, i) { a.classList.toggle("active", i === best); });
    }
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (!ticking) { window.requestAnimationFrame(function () { spy(); ticking = false; }); ticking = true; }
    }, { passive: true });
    spy();
  }
  function esc2(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(buildTOC, 300); });
  } else {
    setTimeout(buildTOC, 300);
  }
})();
