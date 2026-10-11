/* 료힌케이카쿠(무지) 워크벤치 — data/ryohin.json 을 읽어 선행지표 목록과 리서치 도구 스냅샷을 그린다.
   기업별 데이터 모음에서 "료힌케이카쿠 (무지)"를 고르면 열린다. 숫자는 공개 화면에서 직접 확인한 값만 넣고, 빈 값은 채우지 않는다. */
(function () {
  "use strict";
  var host = document.getElementById("ryohin-workspace");
  if (!host) return;
  var DATA = null, active = false, loading = false, error = "";
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]; }); };
  var safeURL = function (v) { try { var u = new URL(v); return ["https:", "http:"].indexOf(u.protocol) >= 0 ? u.href : ""; } catch (e) { return ""; } };

  function nameCell(r) {
    var u = safeURL(r.url || "");
    return "<td class=\"rk-name\">" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(r.name) + "</a>" : esc(r.name)) + "</td>";
  }
  function checkCell(r) {
    var mark = r.ok === true ? '<i class="rk-ok" aria-label="확인됨">✓</i>' : r.ok === false ? '<i class="rk-no" aria-label="미확인">–</i>' : "";
    return '<td class="rk-check">' + mark + esc(r.check) + "</td>";
  }
  function tierTable(t) {
    var wide = t.columns.length === 4;
    var rows = t.rows.map(function (r) {
      return "<tr>" + nameCell(r) + "<td>" + esc(r.what) + "</td>" + (wide ? "<td>" + esc(r.lead || "") + "</td>" : "") + checkCell(r) + "</tr>";
    }).join("");
    return '<div class="fm-history-heading"><b>' + esc(t.title) + "</b><span>" + t.rows.length + '개</span></div><div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table' + (wide ? " rk-4" : " rk-3") + '"><thead><tr>' +
      t.columns.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }
  function snapTable(list) {
    if (!list || !list.length) return "";
    return '<div class="fm-history-heading"><b>리서치 도구 월간 스냅샷</b><span>공개 화면의 값을 그대로 옮김 · 이력이 남지 않아 매달 기록</span></div><div class="fm-table-wrap rk-wrap"><table class="fm-table rk-table rk-snap"><thead><tr><th>월</th><th>출처</th><th>지표</th><th>값</th><th>변화</th><th>메모</th></tr></thead><tbody>' +
      list.map(function (s) {
        var u = safeURL(s.url || "");
        return "<tr><td>" + esc(s.month) + "</td><td>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.source) + "</a>" : esc(s.source)) + "</td><td>" + esc(s.metric) + '</td><td class="rk-num">' + esc(s.value) + "</td><td>" + esc(s.change || "") + "</td><td>" + esc(s.memo || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function render() {
    if (!active) return;
    if (!DATA) {
      host.innerHTML = '<div class="fm-chart-empty">' + (error ? "<b>료힌케이카쿠 데이터를 불러오지 못했어요.</b><p>" + esc(error) + '</p><button class="fm-add" id="rk-retry" type="button">다시 불러오기</button>' : "료힌케이카쿠 지표를 불러오는 중입니다.") + "</div>";
      var r = document.getElementById("rk-retry"); if (r) r.onclick = function () { load(true); };
      return;
    }
    var co = DATA.company || {}, ev = DATA.next_event || {};
    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">' + esc((co.brand || "MUJI") + " · " + (co.market || "") + " " + (co.code || "")) + "</div><h3>" + esc(co.name || "료힌케이카쿠") + "<small>" + esc(co.fy_end || "") + "</small></h3></div>" +
          '<div class="fm-quote"><strong>' + esc(ev.date || "—") + "</strong><span>" + esc((ev.label || "") + (ev.time ? " · " + ev.time : "")) + "</span></div></div>" +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(DATA.updated || "—") + ' 정리 · 선행지표 후보와 확인 결과</span><span class="fm-divider"></span><span class="fm-status pending"><i></i>' + esc(DATA.monthly_release || "") + '</span><button type="button" id="rk-refresh">새 데이터 확인 ↻</button></div>' +
        (DATA.tiers || []).map(tierTable).join("") +
        snapTable(DATA.snapshots) +
        '<p class="fm-note">✓ 는 사이트에 직접 접속해 자료가 나오는 것을 확인한 지표, – 는 아직 확인하지 못한 지표입니다. 카드 결제(JCB消費NOW·Nowcast·True Data)와 매장 유동인구(Agoop·Placer.ai)는 유료라 목록에서 뺐습니다.</p>' +
      "</article>";
    var b = document.getElementById("rk-refresh"); if (b) b.onclick = function () { load(true); };
  }
  function load(manual) {
    if (loading) return; loading = true;
    var get = window.vantageJSON ? function (p) { return window.vantageJSON(p, manual); } : function (p) { return fetch(p, {cache: "no-cache"}).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
    get("data/ryohin.json").then(function (d) {
      if (!d || d.schema_version !== 1) throw new Error("파일 형식 불일치");
      DATA = d; error = "";
    }, function (e) { error = "data/ryohin.json 수신 실패 (" + e.message + ")"; }).then(function () { loading = false; render(); });
  }
  document.addEventListener("vantage-company-change", function (e) {
    active = !!(e.detail && e.detail.company === "료힌케이카쿠"); host.hidden = !active;
    if (active) { render(); if (!DATA) load(false); }
  });
})();
