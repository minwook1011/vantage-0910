/* panes.js — 가로 탭 페이저 공용 컴포넌트 (스타일: panes.css)
 *
 * 마크업
 *   <div data-panes="dash" data-panes-hash>              ← 루트. 값 = localStorage 키 접미사("panes:dash")
 *     <div class="panes-bar">
 *       <button class="pane-step" data-pane-step="-1">‹</button>   (선택) 이전
 *       <div class="pane-tabs" role="tablist">
 *         <button class="pane-tab" data-pane="flow">…</button>     탭 = data-pane 값으로 패널과 짝
 *       </div>
 *       <button class="pane-step" data-pane-step="1">›</button>    (선택) 다음
 *     </div>
 *     <section class="pane" data-pane="flow" hidden>…</section>   패널(한 번에 하나만 보임)
 *   </div>
 *
 * 속성
 *   data-panes="키"        마지막으로 연 탭을 localStorage["panes:키"]에 기억(try/catch). 값이 비면 기억 안 함.
 *   data-panes-hash        주소 #<pane id> 와 동기화(해시가 패널 id와 일치할 때만 반응, replaceState 사용).
 *   data-panes-default="id" 처음 열 탭(없으면 첫 탭). 우선순위: 해시 > localStorage > default > 첫 탭.
 *   data-panes-keys="off"  ←/→ 키보드 이동 끔(기본 켜짐; 입력창·모달(#modal-back)·수정키 조합은 무시).
 *
 * 이벤트
 *   "pane:show" — 패널이 보이게 될 때마다 그 패널 요소에서 발생(bubbles). detail = {id, first, index}.
 *                 first=true 는 그 패널이 처음 열릴 때. 이 시점엔 패널이 이미 보이는 상태라 폭 계산이 정상이다
 *                 → 여기서 차트를 그리면 된다(지연 렌더). 이어서 window "resize" 도 한 번 쏜다.
 *   "pane:hide" — 숨겨질 때 그 패널에서 발생. detail = {id}.
 *   자동 초기화는 DOMContentLoaded 뒤에 일어나므로, 본문 끝의 일반 <script>에서 붙인 리스너는 첫 pane:show도 받는다.
 *
 * JS
 *   Panes.init(root)      수동 초기화(이미 됐으면 기존 컨트롤러 반환). 자동 초기화는 [data-panes] 전부.
 *   root.panes / Panes.get(root|selector) → { show(id|index), next(), prev(), current(), ids, root }
 *   Panes.isShown(paneEl) → 지금 보이는지. Panes.wasShown(paneEl) → 한 번이라도 열렸는지.
 */
(function () {
  "use strict";
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function direct(root, sel) {
    /* 중첩된 다른 [data-panes] 안의 요소는 제외 */
    return Array.prototype.filter.call(root.querySelectorAll(sel), function (el) { return el.closest("[data-panes]") === root; });
  }

  function init(root) {
    if (!root || root.panes) return root && root.panes;
    var tabs = direct(root, ".pane-tab[data-pane]");
    var panes = direct(root, ".pane[data-pane]");
    var ids = panes.map(function (p) { return p.dataset.pane; });
    var steps = direct(root, "[data-pane-step]");
    var tabBox = tabs.length ? tabs[0].parentElement : null;
    var key = root.getAttribute("data-panes") ? "panes:" + root.getAttribute("data-panes") : "";
    var useHash = root.hasAttribute("data-panes-hash");
    var cur = null;

    if (tabBox && !tabBox.getAttribute("role")) tabBox.setAttribute("role", "tablist");
    tabs.forEach(function (t) {
      t.type = "button";
      t.setAttribute("role", "tab");
      t.addEventListener("click", function () { show(t.dataset.pane, true); });
    });
    panes.forEach(function (p) { p.setAttribute("role", "tabpanel"); p.hidden = true; });
    steps.forEach(function (b) {
      b.type = "button";
      b.addEventListener("click", function () { step(+b.dataset.paneStep || 1); });
    });

    function scrollTabIntoView(t) {
      if (!tabBox || !t) return;
      var l = t.offsetLeft - tabBox.offsetLeft, r = l + t.offsetWidth;
      if (l < tabBox.scrollLeft) tabBox.scrollLeft = l - 8;
      else if (r > tabBox.scrollLeft + tabBox.clientWidth) tabBox.scrollLeft = r - tabBox.clientWidth + 8;
    }

    function show(id, user) {
      if (typeof id === "number") id = ids[id];
      var i = ids.indexOf(id);
      if (i < 0) return;
      if (id === cur) return;
      var prev = cur;
      cur = id;
      tabs.forEach(function (t) {
        var on = t.dataset.pane === id;
        t.classList.toggle("on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        if (on) scrollTabIntoView(t);
      });
      steps.forEach(function (b) {
        var d = +b.dataset.paneStep || 1;
        b.disabled = (i + d < 0 || i + d >= ids.length);
      });
      panes.forEach(function (p) {
        var on = p.dataset.pane === id;
        if (!on && p.dataset.pane === prev) {
          p.hidden = true;
          p.dispatchEvent(new CustomEvent("pane:hide", { bubbles: true, detail: { id: prev } }));
        } else p.hidden = !on;
      });
      if (key) lsSet(key, id);
      if (useHash && user && location.hash !== "#" + id) {
        try { history.replaceState(null, "", "#" + id); } catch (e) { location.hash = id; }
      }
      var pane = panes[i], first = pane.dataset.paneShown !== "1";
      pane.dataset.paneShown = "1";
      pane.dispatchEvent(new CustomEvent("pane:show", { bubbles: true, detail: { id: id, first: first, index: i } }));
      window.dispatchEvent(new Event("resize"));
      if (user) {
        var top = root.getBoundingClientRect().top;
        if (top < 0) window.scrollTo({ top: window.pageYOffset + top - 70, behavior: "auto" });
      }
    }
    function step(d) {
      var i = ids.indexOf(cur) + d;
      if (i >= 0 && i < ids.length) show(ids[i], true);
    }

    if (useHash) {
      window.addEventListener("hashchange", function () {
        var h = decodeURIComponent(location.hash.slice(1));
        if (ids.indexOf(h) >= 0) show(h, false);
      });
    }
    if (root.getAttribute("data-panes-keys") !== "off") {
      document.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
        var t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.getElementById("modal-back") || document.querySelector("[aria-modal='true']")) return;
        if (!root.offsetParent && root !== document.body) return; /* 루트가 안 보이면 무시 */
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
        var on = tabs.filter(function (x) { return x.dataset.pane === cur; })[0];
        if (on && tabBox && tabBox.contains(document.activeElement)) on.focus();
      });
    }

    var ctl = {
      root: root, ids: ids,
      show: function (id) { show(id, true); },
      next: function () { step(1); },
      prev: function () { step(-1); },
      current: function () { return cur; }
    };
    root.panes = ctl;

    var h = useHash ? decodeURIComponent(location.hash.slice(1)) : "";
    var saved = key ? lsGet(key) : null;
    var def = root.getAttribute("data-panes-default");
    var start = [h, saved, def, ids[0]].filter(function (x) { return x && ids.indexOf(x) >= 0; })[0];
    if (start) show(start, false);
    return ctl;
  }

  function initAll() { document.querySelectorAll("[data-panes]").forEach(init); }
  window.Panes = {
    init: init,
    get: function (r) { if (typeof r === "string") r = document.querySelector(r); return r ? (r.panes || init(r)) : null; },
    isShown: function (p) { return !!p && !p.hidden; },
    wasShown: function (p) { return !!p && p.dataset.paneShown === "1"; }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initAll);
  else setTimeout(initAll, 0);
})();
