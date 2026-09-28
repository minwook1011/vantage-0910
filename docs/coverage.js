(function () {
  "use strict";
  var WATCH_KEY = "vantage_coverage_watch_v1";
  var selectedType = "기업";
  var selectedFilter = "전체";
  var reports = [];
  var toastTimer;

  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function loadWatch() {
    try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; } catch (e) { return []; }
  }
  function saveWatch(items) {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(items)); } catch (e) {}
  }
  function notify(message) {
    var toast = document.getElementById("toast");
    toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 1900);
  }
  function addWatch(type, name) {
    name = String(name || "").trim();
    if (!name) { notify("추적할 이름을 입력해 주세요"); return; }
    var items = loadWatch();
    if (items.some(function (item) { return item.name.toLowerCase() === name.toLowerCase(); })) {
      notify("이미 커버리지에 있습니다"); return;
    }
    items.unshift({ type:type, name:name, added:Date.now() }); saveWatch(items);
    renderWatch(); renderReports(); notify(name + " 추적을 시작했습니다");
  }
  function removeWatch(index) {
    var items = loadWatch(), removed = items[index]; items.splice(index, 1); saveWatch(items);
    renderWatch(); renderReports(); if (removed) notify(removed.name + " 추적을 해제했습니다");
  }
  function renderWatch() {
    var items = loadWatch(), host = document.getElementById("watch-list");
    document.getElementById("watch-count").textContent = items.length;
    if (!items.length) {
      host.innerHTML = '<div class="watch-empty">아직 등록한 커버리지가 없습니다.<br>위에서 기업·섹터·주제를 추가해 보세요.</div>'; return;
    }
    host.innerHTML = items.map(function (item, index) {
      return '<div class="watch-item" style="animation-delay:' + (index * 35) + 'ms"><i></i><div class="watch-copy"><b>' + esc(item.name) +
        '</b><small>' + esc(item.type) + ' · TRACKING</small></div><button class="watch-remove" type="button" data-index="' + index + '" aria-label="' + esc(item.name) + ' 삭제">×</button></div>';
    }).join("");
    host.querySelectorAll(".watch-remove").forEach(function (button) {
      button.addEventListener("click", function () { removeWatch(+button.dataset.index); });
    });
  }
  function matchesWatch(report, watch) {
    if (!watch.length) return true;
    var hay = [report.title, report.type, report.coverage].concat(report.tags || []).join(" ").toLowerCase();
    return watch.some(function (item) {
      var needle = item.name.toLowerCase();
      return hay.indexOf(needle) >= 0 || needle.split(/[·\s]+/).some(function (part) { return part.length > 1 && hay.indexOf(part) >= 0; });
    });
  }
  function formatTime(value) {
    if (!value) return "";
    var date = new Date(value); if (isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ko-KR", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(date);
  }
  function reportHTML(report, index) {
    var lines = (report.summary || []).slice(0, 4);
    while (lines.length < 4) lines.push("추가 분석이 들어오면 이 줄에 자동 반영됩니다.");
    return '<article class="research-card" style="animation-delay:' + (index * 50) + 'ms">' +
      '<div class="report-rank' + (report.fresh ? ' new' : '') + '">' + String(index + 1).padStart(2, "0") + '</div>' +
      '<div><div class="report-tags"><span class="report-tag">' + esc(report.type) + ' / ' + esc(report.coverage) + '</span><span class="report-source">' + esc(report.source) + '</span>' + (report.fresh ? '<span class="report-new">NEW</span>' : '') + '</div>' +
      '<h3>' + esc(report.title) + '</h3><div class="four-lines">' + lines.map(function (line) { return '<p>' + esc(line) + '</p>'; }).join("") + '</div>' +
      '<div class="report-foot"><span>' + esc(formatTime(report.published)) + '</span><span>·</span><span>' + esc((report.tags || []).join(" · ")) + '</span><span>·</span><a href="' + esc(report.url) + '" target="_blank" rel="noopener noreferrer">원문 읽기 ↗</a></div></div>' +
      '<a class="report-open" href="' + esc(report.url) + '" target="_blank" rel="noopener noreferrer" aria-label="원문 열기">↗</a></article>';
  }
  function renderReports() {
    var watch = loadWatch();
    var fresh = document.getElementById("fresh-only").checked;
    var visible = reports.filter(function (report) {
      if (selectedFilter !== "전체" && report.type !== selectedFilter) return false;
      if (fresh && !report.fresh) return false;
      return matchesWatch(report, watch);
    });
    document.getElementById("result-count").textContent = visible.length + " REPORTS";
    var host = document.getElementById("research-list");
    if (!visible.length) {
      host.innerHTML = '<div class="research-empty"><div><i>⌕</i><b>조건에 맞는 새 분석이 없습니다</b><p>모든 종목을 억지로 채우지 않습니다.<br>의미 있는 이슈가 잡히면 이곳과 텔레그램에 함께 들어옵니다.</p></div></div>'; return;
    }
    host.innerHTML = visible.map(reportHTML).join("");
  }
  function wireControls() {
    document.querySelectorAll(".type-switch button").forEach(function (button) {
      button.addEventListener("click", function () {
        selectedType = button.dataset.type;
        document.querySelectorAll(".type-switch button").forEach(function (b) { b.classList.toggle("on", b === button); });
      });
    });
    document.getElementById("coverage-form").addEventListener("submit", function (event) {
      event.preventDefault(); var input = document.getElementById("coverage-input"); addWatch(selectedType, input.value); input.value = "";
    });
    document.querySelectorAll(".coverage-suggestions button").forEach(function (button) {
      button.addEventListener("click", function () { addWatch(button.dataset.type, button.dataset.name); });
    });
    document.querySelectorAll(".filter-tabs button").forEach(function (button) {
      button.addEventListener("click", function () {
        selectedFilter = button.dataset.filter;
        document.querySelectorAll(".filter-tabs button").forEach(function (b) { b.classList.toggle("on", b === button); }); renderReports();
      });
    });
    document.getElementById("fresh-only").addEventListener("change", renderReports);
  }
  function loadReports() {
    fetch("coverage-data.json", { cache:"no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("coverage data unavailable"); return response.json();
    }).then(function (data) {
      reports = data.items || [];
      document.getElementById("sync-time").textContent = "SYNC " + (data.updated || "—"); renderReports();
    }).catch(function () {
      reports = []; document.getElementById("sync-time").textContent = "SYNC 대기"; renderReports();
    });
  }
  wireControls(); renderWatch(); loadReports();
})();
