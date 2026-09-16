(function () {
  "use strict";
  var items = [], category = "전체", query = "";
  function esc(value) { return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function monthKey(date) { var match = String(date || "").match(/^(\d{4})-(\d{2})/); return match ? match[1] + "." + match[2] : "날짜 미상"; }
  function card(item, index) {
    var tags = (item.tags || []).slice(0, 5).map(function (tag) { return "<span>#" + esc(tag) + "</span>"; }).join("");
    return '<a class="archive-card" style="animation-delay:' + Math.min(index * 24, 240) + 'ms" href="' + esc(item.file) + '">' +
      '<time class="archive-date" datetime="' + esc(item.date) + '">' + esc(item.date) + '</time>' +
      '<span class="archive-type" data-type="' + esc(item.category) + '">' + esc(item.category) + '</span>' +
      '<div class="archive-copy"><h3>' + esc(item.title) + '</h3><p>' + esc(item.summary) + '</p>' + (tags ? '<div class="archive-tags">' + tags + '</div>' : '') + '</div>' +
      '<span class="archive-open">↗</span></a>';
  }
  function visibleItems() {
    var needle = query.trim().toLowerCase();
    return items.filter(function (item) {
      if (category !== "전체" && item.category !== category) return false;
      if (!needle) return true;
      return [item.title,item.summary,item.category].concat(item.tags || []).join(" ").toLowerCase().indexOf(needle) >= 0;
    });
  }
  function render() {
    var visible = visibleItems(), groups = {};
    visible.forEach(function (item) { var key = monthKey(item.date); (groups[key] || (groups[key] = [])).push(item); });
    document.getElementById("archive-visible-count").textContent = visible.length + "개";
    var host = document.getElementById("archive-list");
    if (!visible.length) {
      host.innerHTML = '<div class="archive-empty"><div><b>' + (items.length ? '조건에 맞는 작업물이 없습니다' : '첫 분석 아티팩트를 기다리고 있습니다') + '</b><span>' + (items.length ? '검색어나 분류를 바꿔보세요.' : '다음 분석부터 날짜·제목·핵심 아이디어와 함께 이곳에 쌓입니다.') + '</span></div></div>';
      return;
    }
    var order = Object.keys(groups).sort().reverse(), offset = 0;
    host.innerHTML = order.map(function (key) {
      var html = '<section class="archive-month"><div class="archive-month-title">' + esc(key) + '</div>' + groups[key].map(function (item) { return card(item, offset++); }).join("") + '</section>';
      return html;
    }).join("");
  }
  function setStats() {
    var categories = {};
    items.forEach(function (item) { categories[item.category] = true; });
    document.getElementById("archive-count").textContent = items.length;
    document.getElementById("archive-category-count").textContent = Object.keys(categories).length;
    document.getElementById("archive-latest").textContent = items.length ? String(items[0].date).slice(5).replace("-", ".") : "—";
  }
  document.getElementById("archive-search").addEventListener("input", function (event) { query = event.target.value || ""; render(); });
  document.querySelectorAll("#archive-filters button").forEach(function (button) {
    button.addEventListener("click", function () {
      category = button.dataset.category;
      document.querySelectorAll("#archive-filters button").forEach(function (candidate) { candidate.classList.toggle("on", candidate === button); });
      render();
    });
  });
  fetch("archive-data.json?v=" + Date.now(), { cache:"no-store" }).then(function (response) {
    if (!response.ok) throw new Error("archive unavailable"); return response.json();
  }).then(function (data) {
    items = Array.isArray(data.items) ? data.items.slice().sort(function (a,b) { return String(b.date).localeCompare(String(a.date)) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")); }) : [];
    setStats(); render();
  }).catch(function () { items = []; setStats(); render(); });
})();