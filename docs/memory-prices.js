/* memory-prices.js — 데이터 허브 '메모리 가격' 탭 (2026-10-16 사용자 요청)
   자료: data/memory_prices.json (build_memory_prices.py — DRAMeXchange 현물·모듈·웨이퍼 · TrendForce 고정거래가 · CFM 중국 채널가)
   위: 핵심 숫자 카드 · 가운데: 고른 품목 비교 그래프(행을 눌러 넣고 빼기, 최대 5개) · 아래: 묶음별 표(가격·전일·1주·1개월·3개월·1년·추이) */
(function () {
  "use strict";
  var host = document.getElementById("mem-workspace");
  if (!host) return;
  var COLORS = ["#2f6fe4", "#d6334a", "#22a886", "#c9801f", "#a070e6"];
  var KEY = "vantage-mem-prices-v1";
  var DATA = null, picked = null, range = "1Y", rel = false, openGroups = {};
  try { var sv = JSON.parse(localStorage.getItem(KEY) || "{}"); picked = sv.picked || null; range = sv.range || range; rel = !!sv.rel; openGroups = sv.open || {}; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify({picked: picked, range: range, rel: rel, open: openGroups})); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function money(v) { if (v == null) return "—"; var a = Math.abs(v); return "$" + (a >= 1000 ? v.toLocaleString("en-US", {maximumFractionDigits: 0}) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(2) : v.toFixed(3)); }
  function pct(v, d) { if (v == null) return '<span class="na">—</span>'; var c = v > 0 ? "up" : v < 0 ? "dn" : ""; return '<span class="' + c + '">' + (v > 0 ? "+" : "") + v.toFixed(d == null ? 1 : d) + "%</span>"; }
  function md(d) { return d ? d.slice(5).replace("-", "/") : ""; }
  function idOf(r) { return r.src + ":" + r.key; }
  function rowById(id) { var hit = null; (DATA.groups || []).forEach(function (g) { g.rows.forEach(function (r) { if (idOf(r) === id) hit = {row: r, group: g}; }); }); return hit; }
  function pts(r) { return ((DATA.store || {})[r.src] || {})[r.key] || []; }
  function cut(p) {
    if (range === "ALL" || !p.length) return p;
    var days = {"3M": 92, "6M": 183, "1Y": 366, "2Y": 731}[range] || 366;
    var last = new Date(p[p.length - 1][0]), from = new Date(last.getTime() - days * 864e5).toISOString().slice(0, 10);
    return p.filter(function (x) { return x[0] >= from; });
  }

  /* ── 작은 추이선(표 안) ── */
  function spark(p) {
    p = p.slice(-40);
    if (p.length < 2) return "";
    var vs = p.map(function (x) { return x[1]; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), sp = hi - lo || 1;
    var d = p.map(function (x, i) { return (i ? "L" : "M") + (i / (p.length - 1) * 100).toFixed(1) + " " + (28 - (x[1] - lo) / sp * 26).toFixed(1); }).join(" ");
    var up = vs[vs.length - 1] >= vs[0];
    return '<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" class="' + (up ? "up" : "dn") + '"/></svg>';
  }

  /* ── 비교 그래프 ── */
  function chart() {
    var lines = (picked || []).map(rowById).filter(Boolean).map(function (h, i) { return {label: h.row.label, sub: h.group.label, color: COLORS[i % COLORS.length], p: cut(pts(h.row))}; }).filter(function (l) { return l.p.length; });
    if (!lines.length) return '<div class="mp-empty">아래 표에서 품목을 눌러 그래프에 넣어 보세요.</div>';
    var useRel = rel && lines.length > 1;
    if (useRel) lines = lines.map(function (l) { var b = l.p[0][1]; return Object.assign({}, l, {p: l.p.map(function (x) { return [x[0], x[1] / b * 100]; })}); });
    var W = Math.max(320, (host.querySelector(".mp-chart") || host).clientWidth - 8), H = 300, L = 54, R = 70, T = 14, B = 26;
    var all = [].concat.apply([], lines.map(function (l) { return l.p; }));
    var t0 = Math.min.apply(null, all.map(function (x) { return +new Date(x[0]); })), t1 = Math.max.apply(null, all.map(function (x) { return +new Date(x[0]); }));
    var v0 = Math.min.apply(null, all.map(function (x) { return x[1]; })), v1 = Math.max.apply(null, all.map(function (x) { return x[1]; }));
    var pad = (v1 - v0) * 0.08 || Math.abs(v1) * 0.05 || 1; v0 -= pad; v1 += pad;
    var X = function (t) { return L + (t - t0) / ((t1 - t0) || 1) * (W - L - R); }, Y = function (v) { return T + (1 - (v - v0) / (v1 - v0)) * (H - T - B); };
    var fmt = function (v) { return useRel ? v.toFixed(0) : money(v); };
    var g = "", i, n = 5;
    for (i = 0; i <= n; i++) { var v = v0 + (v1 - v0) * i / n, y = Y(v); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" class="ax" text-anchor="end">' + fmt(v) + "</text>"; }
    var months = Math.max(1, Math.round((t1 - t0) / (30 * 864e5) / 6));
    var dt = new Date(t0); dt.setDate(1); dt.setMonth(dt.getMonth() + 1);
    while (+dt <= t1) { var x = X(+dt); g += '<text x="' + x + '" y="' + (H - 6) + '" class="ax" text-anchor="middle">' + String(dt.getFullYear()).slice(2) + "/" + String(dt.getMonth() + 1).padStart(2, "0") + "</text>"; dt.setMonth(dt.getMonth() + months); }
    if (useRel) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(100) + '" y2="' + Y(100) + '" class="base"/>';
    lines.forEach(function (l) {
      var d = l.p.map(function (x, k) { return (k ? "L" : "M") + X(+new Date(x[0])).toFixed(1) + " " + Y(x[1]).toFixed(1); }).join(" ");
      var last = l.p[l.p.length - 1];
      g += '<path d="' + d + '" stroke="' + l.color + '" class="ln"/><circle cx="' + X(+new Date(last[0])) + '" cy="' + Y(last[1]) + '" r="3.5" fill="' + l.color + '"/>' +
        '<text x="' + (X(+new Date(last[0])) + 6) + '" y="' + (Y(last[1]) + 4) + '" class="end" fill="' + l.color + '">' + fmt(last[1]) + "</text>";
    });
    g += '<line class="cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" style="display:none"/>';
    host._chart = {lines: lines, X: X, Y: Y, L: L, R: R, W: W, t0: t0, t1: t1, fmt: fmt};
    return '<svg class="mp-svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="메모리 가격 비교 그래프">' + g + '</svg><div class="mp-tip" hidden></div>';
  }
  function hover() {
    var svg = host.querySelector(".mp-svg"), tip = host.querySelector(".mp-tip"), c = host._chart;
    if (!svg || !c) return;
    var cross = svg.querySelector(".cross");
    svg.onmousemove = function (e) {
      var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (c.W / r.width);
      if (x < c.L || x > c.W - c.R) { tip.hidden = true; cross.style.display = "none"; return; }
      var t = c.t0 + (x - c.L) / (c.W - c.L - c.R) * (c.t1 - c.t0), day = new Date(t).toISOString().slice(0, 10);
      var rows = c.lines.map(function (l) { var hit = null; l.p.forEach(function (p) { if (p[0] <= day) hit = p; }); return hit ? '<div><i style="background:' + l.color + '"></i>' + esc(l.label) + "<b>" + c.fmt(hit[1]) + "</b><small>" + md(hit[0]) + "</small></div>" : ""; }).join("");
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.style.display = "";
      tip.innerHTML = "<em>" + day + "</em>" + rows; tip.hidden = false;
      tip.style.left = Math.min(r.width - 230, Math.max(0, (e.clientX - r.left) + 14)) + "px"; tip.style.top = "8px";
    };
    svg.onmouseleave = function () { tip.hidden = true; cross.style.display = "none"; };
  }

  /* ── 핵심 숫자 카드 ── */
  var HERO = [["dram:ddr5_16g", "DDR5 16Gb 현물", "칩 1개 · 매 영업일"], ["dram:ddr5_rdimm_32g", "DDR5 서버 모듈 32GB", "모듈 1개 · 주 1회"],
              ["dram:nand_256g_tlc", "낸드 웨이퍼 256Gb", "주 1회"], ["cfm:100263", "중국 서버 모듈 계약가 DDR5 64GB", "주 1회"],
              ["cfm:100244", "중국 소비자 SSD PCIe4 1TB", "주 1회"]];
  function heroHTML() {
    return '<div class="mp-hero">' + HERO.map(function (h) {
      var hit = rowById(h[0]); if (!hit) return "";
      var r = hit.row, p = pts(r), extra = "";
      if (h[0] === "dram:ddr5_16g") { var fx = rowById("contract:ct_ddr5_16g"); if (fx) extra = '<p class="mp-prem">고정거래가 ' + money(fx.row.last) + " (" + Number(fx.row.date.slice(5, 7)) + "월) 대비 현물 " + pct((r.last / fx.row.last - 1) * 100) + "</p>"; }
      return '<button type="button" class="mp-card" data-add="' + esc(h[0]) + '"><span>' + esc(h[1]) + "</span><b>" + money(r.last) + "</b><small>" + esc(h[2]) + " · " + md(r.date) + "</small>" +
        '<div class="mp-chg">' + (r.chg.d1 != null ? "<em>전일 " + pct(r.chg.d1, 2) + "</em>" : "") + "<em>1개월 " + pct(r.chg.m1) + "</em><em>3개월 " + pct(r.chg.m3) + "</em></div>" + spark(p.slice(-120)) + extra + "</button>";
    }).join("") + "</div>";
  }

  /* ── 묶음별 표 ── */
  function tableHTML(g) {
    var open = openGroups[g.id] !== false && (openGroups[g.id] || /^dx_|^contract|cfm_rdimm|cfm_ddrchannel|cfm_lpddr|cfm_ssd/.test(g.id));
    return '<section class="mp-group' + (open ? " open" : "") + '"><button type="button" class="mp-ghead" data-fold="' + esc(g.id) + '" aria-expanded="' + !!open + '"><b>' + esc(g.label) + "</b><span>" + esc(g.desc) + " · " + g.rows.length + "개</span><i>" + (open ? "접기 ▴" : "펼치기 ▾") + "</i></button>" +
      (open ? '<div class="mp-scroll"><table class="mp-t"><thead><tr><th class="l">품목</th><th>가격</th><th>기준일</th><th>전일</th><th>1주</th><th>1개월</th><th>3개월</th><th>1년</th><th class="sp">추이</th></tr></thead><tbody>' +
        g.rows.map(function (r) { var id = idOf(r), on = (picked || []).indexOf(id) >= 0, k = (picked || []).indexOf(id);
          return '<tr class="' + (on ? "on" : "") + '" data-add="' + esc(id) + '" title="눌러서 위 그래프에 넣기·빼기"><td class="l">' + (on ? '<i class="dot" style="background:' + COLORS[k % COLORS.length] + '"></i>' : '<i class="dot off"></i>') + esc(r.label) + "</td><td class=\"num\">" + money(r.last) + "</td><td class=\"dt\">" + md(r.date) + "</td><td>" + (r.chg.d1 == null ? '<span class="na">—</span>' : pct(r.chg.d1, 2)) + "</td><td>" + pct(r.chg.w1) + "</td><td>" + pct(r.chg.m1) + "</td><td>" + pct(r.chg.m3) + "</td><td>" + pct(r.chg.y1) + '</td><td class="sp">' + spark(pts(r).slice(-120)) + "</td></tr>";
        }).join("") + "</tbody></table></div>" : "") + "</section>";
  }

  function render() {
    if (!DATA) { host.innerHTML = '<div class="mp-empty">메모리 가격을 불러오는 중…</div>'; return; }
    if (!picked) picked = ["dram:ddr5_16g", "contract:ct_ddr5_16g"];
    var a = DATA.as_of || {};
    var sel = (picked || []).map(rowById).filter(Boolean);
    host.innerHTML = '<div class="mp-head"><div><h2>메모리 가격</h2><p class="mp-sub">DRAMeXchange 현물·모듈·웨이퍼 ' + md(a.dram) + " · 중국 채널가(CFM) " + md(a.cfm) + " · TrendForce 고정거래가 " + esc((a.contract || "").slice(0, 7)) + " · 달러 · 매일 아침 갱신</p></div></div>" +
      heroHTML() +
      '<div class="mp-box"><div class="mp-bar"><div class="mp-picked">' + (sel.length ? sel.map(function (h, i) { return '<button type="button" class="mp-chip" data-add="' + esc(idOf(h.row)) + '" title="눌러서 빼기"><i style="background:' + COLORS[i % COLORS.length] + '"></i>' + esc(h.row.label) + "<small>" + esc(h.group.label.replace(/^중국 /, "중국·")) + "</small><em>×</em></button>"; }).join("") : '<span class="mp-hint">아래 표의 품목을 누르면 여기에 겹쳐 그려집니다</span>') +
      '</div><div class="mp-ctl"><div class="mp-seg">' + ["3M", "6M", "1Y", "2Y", "ALL"].map(function (r) { return '<button type="button" data-range="' + r + '" aria-pressed="' + (r === range) + '">' + r + "</button>"; }).join("") + "</div>" +
      '<label class="mp-rel"><input type="checkbox" ' + (rel ? "checked" : "") + ' data-rel> 시작점=100으로 맞춰 보기</label></div></div>' +
      '<div class="mp-chart">' + chart() + "</div><p class=\"mp-note\">최대 5개까지 겹쳐 봅니다. 단위가 다른 품목(칩·모듈·SSD)을 함께 볼 땐 '시작점=100'을 켜면 오름폭을 비교하기 쉽습니다. 출처가 다른 가격(현물·고정가·중국 채널가)은 성격이 달라 수준을 직접 비교하지 마세요.</p></div>" +
      (DATA.groups || []).map(tableHTML).join("") +
      '<p class="mp-foot">' + esc(DATA.note || "") + " 고정거래가는 무료 공개분이 한 달 늦게 나옵니다. 전일 칸은 바로 앞 영업일 값이 있을 때만 표시합니다.</p>";
    hover();
    host.querySelectorAll("[data-add]").forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.add, l = (picked || []).slice(), k = l.indexOf(id);
        if (k >= 0) l.splice(k, 1); else { if (l.length >= 5) l.shift(); l.push(id); }
        picked = l; save(); render();
      };
    });
    host.querySelectorAll("[data-range]").forEach(function (b) { b.onclick = function () { range = b.dataset.range; save(); render(); }; });
    var rb = host.querySelector("[data-rel]"); if (rb) rb.onchange = function () { rel = rb.checked; save(); render(); };
    host.querySelectorAll("[data-fold]").forEach(function (b) { b.onclick = function () { var id = b.dataset.fold, open = b.getAttribute("aria-expanded") === "true"; openGroups[id] = !open; save(); render(); }; });
  }

  function load() {
    fetch("data/memory_prices.json?v=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { DATA = d; render(); })
      .catch(function () { host.innerHTML = '<div class="mp-empty">메모리 가격 자료를 불러오지 못했습니다.</div>'; });
  }
  render(); load();
  document.addEventListener("vantage-view", function (e) { if (e.detail && e.detail.view === "mem" && DATA) render(); });
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (DATA && host.offsetParent) render(); }, 200); });
})();
