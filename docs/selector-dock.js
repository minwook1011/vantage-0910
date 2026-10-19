/* 기업별 데이터 모음 공통 — 각 기업 화면(파인엠텍·제타·료힌케이카쿠·일반 기업 등)의 지표 고르기 칸(.fm-selectors)을
   차트 범례(.fm-legend) 바로 아래로 옮기고, 접고 펼 수 있는 칸(<details class="sel-dock">)으로 감싼다.
   각 화면 코드는 그대로 두고, 다시 그려질 때마다(MutationObserver) 새 칸을 찾아 옮긴다. 노드를 옮기기만 하므로 체크박스 이벤트는 그대로 동작한다.
   열림 상태는 화면(section id)마다 이 브라우저(localStorage)에 저장한다. 기본은 접힘. 베이커런트는 자체 접는 칸(.bc-picker)을 쓴다. */
(function () {
  "use strict";
  var KEY = "vantage-seldock-v1";
  var openMap = {}; try { openMap = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(openMap)); } catch (e) {} }
  var chev = '<svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  function countText(sel) {
    var all = sel.querySelectorAll('input[type="checkbox"]'), on = 0;
    all.forEach(function (c) { if (c.checked) on++; });
    return all.length ? all.length + "개 중 " + on + "개 표시 중" : "지표 목록";
  }
  // 같은 글이면 건드리지 않는다(글을 바꾸면 다시 MutationObserver 가 불려 끝없이 도는 것을 막음)
  function label(d) { var sm = d.querySelector(":scope > summary small"), sel = d.querySelector(".fm-selectors"); if (!sm || !sel) return; var txt = countText(sel) + " · 눌러서 " + (d.open ? "접기" : "펼치기"); if (sm.textContent !== txt) sm.textContent = txt; }
  function dock(sel) {
    if (sel.closest(".sel-dock, .bc-picker")) return;
    var ws = sel.closest(".fm-workspace"); if (!ws) return;
    var anchor = ws.querySelector(".fm-legend") || ws.querySelector(".fm-chart");
    if (!anchor || !anchor.parentNode) return;
    var id = ws.id || "ws";
    // 화면 코드가 지표 칸만 다시 그린 경우: 예전 접는 칸은 지우고 새 칸으로 바꾼다(중복 방지)
    ws.querySelectorAll(".sel-dock").forEach(function (old) { old.remove(); });
    var d = document.createElement("details");
    d.className = "sel-dock";
    if (openMap[id]) d.open = true;
    d.innerHTML = "<summary><b>지표 고르기</b><small></small>" + chev + "</summary>";
    anchor.parentNode.insertBefore(d, anchor.nextSibling);
    d.appendChild(sel);
    label(d);
    d.addEventListener("toggle", function () { openMap[id] = d.open; save(); label(d); });
    d.addEventListener("change", function () { setTimeout(function () { label(d); }, 0); });
  }
  var pending = false;
  function scan() { pending = false; document.querySelectorAll(".fm-workspace .fm-selectors").forEach(dock); document.querySelectorAll(".sel-dock").forEach(label); }
  new MutationObserver(function () { if (!pending) { pending = true; setTimeout(scan, 0); } }).observe(document.body, {childList: true, subtree: true});
  scan();
})();
