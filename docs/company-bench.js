/* 기업별 데이터 모음 — 기업을 고르고, 주가 위에 실적·관련 지표를 직접 골라 겹쳐 본다(파인엠텍 워크벤치와 같은 틀).
   읽는 파일: data/company_links.json(기업·주요 지표), data/ai_indicators.json(주가·지표), financials.json(분기·연간 실적).
   module 이 있는 기업(파인엠텍)은 finemtec.js 가 그리도록 vantage-company-change 이벤트만 보낸다.
   빈 값은 0이나 예시로 채우지 않는다. 사용자가 고른 지표·고정한 주요 지표·직접 넣은 자료는 이 브라우저(localStorage)에 저장한다. */
(function () {
  "use strict";
  var C = window.FineMtecCore;
  var host = document.getElementById("company-bench"), chipHost = document.getElementById("cb-chips");
  if (!host || !chipHost || !C) return;

  var KEY = "vantage-company-bench-v1", CUSTOM_KEY = "vantage-company-bench-custom-v1";
  var PRICE_COLOR = "#83aaff";
  // 다크 표면에서 서로 구분되는 고정 순서 팔레트(파인엠텍 지표 색과 같은 계열)
  var PALETTE = ["#55d6bc", "#c7a2ff", "#ffbd76", "#53c5ee", "#fa829d", "#e7d27c", "#9fd675", "#dda1c7"];
  var RANGES = ["6M", "YTD", "1Y", "2Y", "ALL"];
  var FIN = {
    revenue: {label: "매출", pct: false}, operating_income: {label: "영업이익", pct: false}, opm: {label: "OPM · 영업이익률", pct: true},
    revenue_yoy: {label: "매출 성장률 · YoY", pct: true}, operating_income_yoy: {label: "영업이익 성장률 · YoY", pct: true}
  };
  var FALLBACK = [
    {ticker: "NVDA", name: "NVIDIA", market: "US", financials: "NVDA", fin_unit: "$B", fin_div: 1000, indicators: ["hyperscaler_capex::합계", "tsmc_monthly_rev", "gpu_h100_index", "or_tokens_weekly"]},
    {ticker: "000660", name: "SK하이닉스", market: "KR", financials: "000660.KS", fin_unit: "조원", fin_div: 1e6, indicators: ["trass_dram", "trass_mcp", "trass_dram_module", "hyperscaler_capex::합계"]},
    {ticker: "005930", name: "삼성전자", market: "KR", financials: "005930.KS", fin_unit: "조원", fin_div: 1e6, indicators: ["trass_dram", "trass_flash", "trass_mcp", "hyperscaler_capex::합계"]},
    {ticker: "TSM", name: "TSMC", market: "US", financials: "TSM", fin_unit: "NT$ 십억", fin_div: 1000, indicators: ["tsmc_monthly_rev", "hyperscaler_capex::합계", "gpu_h100_index", "or_tokens_weekly"]},
    {ticker: "441270", name: "파인엠텍", market: "KR", module: "finemtec"},
    {ticker: "비상장", name: "스캐터랩 (제타)", market: "PRIVATE", module: "zeta"}
  ];

  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]; }); };
  var safeURL = function (v) { try { var u = new URL(v); return ["https:", "http:"].indexOf(u.protocol) >= 0 ? u.href : ""; } catch (e) { return ""; } };
  var read = function (k, fb) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; } catch (e) { return fb; } };
  var finite = C.finite;

  var saved = read(KEY, {}); if (!saved || typeof saved !== "object") saved = {};
  var state = {company: typeof saved.company === "string" ? saved.company : null, per: saved.per && typeof saved.per === "object" ? saved.per : {}};
  var customs = read(CUSTOM_KEY, {}); if (!customs || typeof customs !== "object" || Array.isArray(customs)) customs = {};
  var COMPANIES = FALLBACK, AI = null, FINS = {}, FM = null, loaded = false, loadError = "", catalog = {}, renderId = 0;

  function store() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function storeCustoms() { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customs)); }
  function toast(msg) {
    var old = document.querySelector(".fm-toast"); if (old) old.remove();
    var el = document.createElement("div"); el.className = "fm-toast"; el.setAttribute("role", "status"); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4000);
  }
  function company() { return COMPANIES.filter(function (c) { return c.ticker === state.company; })[0] || COMPANIES[0]; }
  function cfg(tk) {
    var c = COMPANIES.filter(function (x) { return x.ticker === tk; })[0] || {};
    var p = state.per[tk];
    if (!p || typeof p !== "object") {
      var first = (c.indicators || [])[0];
      p = state.per[tk] = {selected: (first ? [first] : []).concat(c.financials ? ["fin:revenue"] : []), range: "2Y", mode: "units", period: "quarterly", pins: [], unpins: []};
    }
    ["selected", "pins", "unpins"].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
    if (RANGES.indexOf(p.range) < 0) p.range = "2Y";
    return p;
  }
  function good(points) { return (points || []).filter(function (p) { return p && C.validDate(p.date) && finite(p.value); }); }
  function priceUnit(c) { return c.market === "KR" ? "원" : "USD"; }

  /* ── 값 표시 ── */
  function fmt(value, unit, digits) {
    if (!finite(value)) return "—";
    if (unit === "USD") return "$" + value.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (unit === "원") return Math.round(value).toLocaleString("ko-KR") + "원";
    if (unit === "%") return value.toFixed(digits == null ? 1 : digits) + "%";
    var d = digits != null ? digits : Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 1 ? 2 : 3;
    return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: d}).format(value) + (unit ? " " + unit : "");
  }
  function pctBadge(v) {
    if (!finite(v)) return "";
    return '<span class="cb-chg ' + (v >= 0 ? "up" : "down") + '">' + (v >= 0 ? "+" : "") + v.toFixed(1) + "%</span>";
  }

  /* ── 지표 목록 만들기 ── */
  function buildCatalog() {
    catalog = {};
    var groups = {};
    ((AI && AI.groups) || []).forEach(function (g) { groups[g.id] = g.label; });
    ((AI && AI.series) || []).forEach(function (s) {
      var gl = groups[s.group] || "기타 지표", base = {unit: s.unit || "", group: s.group || "etc", groupLabel: gl, cadence: s.cadence || "", source: s.source || "", source_url: s.source_url || ""};
      var pts = good(s.points);
      if ((s.type === "line" || s.type === "bars") && pts.length > 1) {
        catalog[s.id] = Object.assign({id: s.id, label: s.label, points: pts}, base);
      }
      if (Array.isArray(s.lines) && s.lines.length) {
        var usable = s.lines.filter(function (l) { return good(l.points).length > 1; });
        usable.forEach(function (l) {
          var name = l.label || l.id; if (!name) return;
          catalog[s.id + "::" + name] = Object.assign({id: s.id + "::" + name, label: s.label + " · " + name, points: good(l.points)}, base);
        });
        if (s.type === "stack" && usable.length > 1) {
          // 합계: 모든 선에 값이 있는 날짜만 더한다(일부만 있는 날짜를 합계로 보이지 않게)
          var byDate = {};
          usable.forEach(function (l) { good(l.points).forEach(function (p) { (byDate[p.date] = byDate[p.date] || []).push(p.value); }); });
          var sum = Object.keys(byDate).sort().filter(function (d) { return byDate[d].length === usable.length; }).map(function (d) { return {date: d, value: Math.round(byDate[d].reduce(function (a, b) { return a + b; }, 0) * 100) / 100}; });
          if (sum.length > 1) catalog[s.id + "::합계"] = Object.assign({id: s.id + "::합계", label: s.label.replace(/\s*\(.*\)$/, "") + " · 합계", points: sum, note: usable.length + "개 선 합계"}, base);
        }
      }
    });
    Object.keys((AI && AI.companies) || {}).forEach(function (tk) {
      var c = AI.companies[tk], pts = good(c.points);
      if (pts.length > 1) catalog["price:" + tk] = {id: "price:" + tk, label: (c.label || tk) + " 주가", unit: c.market === "KR" ? "원" : (c.currency || "USD"), group: "price", groupLabel: "다른 기업 주가", points: pts, cadence: "일간 종가", source: "Yahoo Finance"};
    });
  }
  function finRows(c, period) {
    var raw = ((FINS[c.financials] || {})[period === "annual" ? "annual" : "quarterly"] || []).filter(function (r) { return C.validDate(r.date); }).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var div = Number(c.fin_div) || 1;
    return raw.map(function (r) {
      var prior = raw.filter(function (p) { return p.date.slice(0, 4) === String(Number(r.date.slice(0, 4)) - 1) && p.date.slice(5, 7) === r.date.slice(5, 7); })[0];
      var opYoy = finite(r.op_yoy) ? r.op_yoy : null, label = null;
      if (prior && finite(prior.op) && finite(r.op) && prior.op <= 0) { opYoy = null; label = r.op > 0 ? "흑자전환" : (r.op > prior.op ? "적자축소" : "적자확대"); }
      else if (prior && finite(prior.op) && finite(r.op) && prior.op > 0 && r.op <= 0) { opYoy = null; label = "적자전환"; }
      return {date: r.date, revenue: finite(r.rev) ? r.rev / div : null, operating_income: finite(r.op) ? r.op / div : null, opm: finite(r.opm) ? r.opm : null, revenue_yoy: finite(r.rev_yoy) ? r.rev_yoy : null, operating_income_yoy: opYoy, op_label: label};
    });
  }
  function finMeta(c, key) { return {id: "fin:" + key, label: FIN[key].label, unit: FIN[key].pct ? "%" : c.fin_unit || "", group: "financial", groupLabel: "실적"}; }
  function meta(c, id) {
    if (id === "price") return {id: "price", label: c.name + " 주가", unit: priceUnit(c), group: "price"};
    if (id.indexOf("fin:") === 0 && FIN[id.slice(4)]) return finMeta(c, id.slice(4));
    if (id.indexOf("custom-") === 0) return (customs[c.ticker] || []).filter(function (s) { return s.id === id; })[0] || null;
    return catalog[id] || null;
  }
  function pointsOf(c, id) {
    if (id === "price") return good((((AI && AI.companies) || {})[c.ticker] || {}).points);
    if (id.indexOf("fin:") === 0) { var key = id.slice(4); return finRows(c, cfg(c.ticker).period).map(function (r) { return {date: r.date, value: r[key], label: key === "operating_income_yoy" && !finite(r[key]) ? r.op_label : null}; }); }
    var m = meta(c, id); return m ? m.points || [] : [];
  }
  function keyIds(c) {
    var p = cfg(c.ticker), base = (c.indicators || []).filter(function (id) { return p.unpins.indexOf(id) < 0; });
    p.pins.forEach(function (id) { if (base.indexOf(id) < 0) base.push(id); });
    return base.filter(function (id) { return meta(c, id); });
  }
  function colorOf(c, id) {
    if (id === "price") return PRICE_COLOR;
    var sel = cfg(c.ticker).selected.filter(function (x) { return x !== "price"; }), i = sel.indexOf(id);
    return i >= 0 ? PALETTE[i % PALETTE.length] : "#6f7f99";
  }

  /* ── 화면 ── */
  function chipChange(c) {
    var pts = c.module === "finemtec" ? good(FM && FM.price && FM.price.points) : good((((AI && AI.companies) || {})[c.ticker] || {}).points);
    return pts.length > 1 ? (pts[pts.length - 1].value / pts[pts.length - 2].value - 1) * 100 : null;
  }
  function renderChips() {
    var cur = company();
    chipHost.innerHTML = COMPANIES.map(function (c) {
      return '<button type="button" class="cb-chip' + (c.ticker === cur.ticker ? " on" : "") + '" data-cb-company="' + esc(c.ticker) + '" aria-pressed="' + (c.ticker === cur.ticker) + '"><b>' + esc(c.name || c.label) + "</b><small>" + esc(c.ticker) + "</small>" + pctBadge(chipChange(c)) + "</button>";
    }).join("");
    chipHost.querySelectorAll("[data-cb-company]").forEach(function (b) { b.onclick = function () { state.company = b.dataset.cbCompany; store(); renderAll(); }; });
  }
  function renderAll() {
    renderChips();
    var c = company();
    var status = document.getElementById("workbench-status");
    if (status) status.textContent = (c.name || c.label) + " · 주가 × 실적 × 관련 지표";
    if (c.module) {
      // 전용 화면이 있는 기업: finemtec.js(파인엠텍) · zeta.js(스캐터랩)가 이 이벤트를 받아 스스로 그린다
      host.hidden = true; host.innerHTML = "";
      document.dispatchEvent(new CustomEvent("vantage-company-change", {detail: {company: c.module === "zeta" ? "스캐터랩" : "파인엠텍"}}));
      return;
    }
    document.dispatchEvent(new CustomEvent("vantage-company-change", {detail: {company: c.name || c.ticker}}));
    host.hidden = false;
    if (!loaded) { host.innerHTML = '<div class="fm-chart-empty">' + (loadError ? "<b>데이터를 불러오지 못했어요.</b><p>" + esc(loadError) + '</p><button class="fm-add" type="button" id="cb-retry">다시 불러오기</button>' : "주가·실적·지표를 불러오는 중입니다.") + "</div>"; var r = document.getElementById("cb-retry"); if (r) r.onclick = function () { load(); }; return; }
    render(c);
  }
  function keyCards(c) {
    var ids = keyIds(c), p = cfg(c.ticker);
    if (!ids.length) return '<div class="cb-keys-empty">주요 지표가 없습니다. 아래 "관련 지표 추가"에서 ☆ 를 눌러 고정하세요.</div>';
    return ids.map(function (id) {
      var m = meta(c, id), pts = good(pointsOf(c, id)), last = pts[pts.length - 1], prev = pts[pts.length - 2], on = p.selected.indexOf(id) >= 0;
      var chg = last && prev && prev.value ? (last.value / prev.value - 1) * 100 : null;
      var spark = "";
      var tail = pts.slice(-26);
      if (tail.length > 1) {
        var lo = Math.min.apply(null, tail.map(function (q) { return q.value; })), hi = Math.max.apply(null, tail.map(function (q) { return q.value; }));
        var d = tail.map(function (q, i) { return (i ? "L" : "M") + (i / (tail.length - 1) * 100).toFixed(1) + " " + (hi === lo ? 14 : 26 - (q.value - lo) / (hi - lo) * 24).toFixed(1); }).join(" ");
        spark = '<svg class="cb-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (on ? colorOf(c, id) : "#7f93b6") + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
      }
      return '<div class="cb-key' + (on ? " on" : "") + '" style="--series-color:' + esc(on ? colorOf(c, id) : "#51607a") + '">' +
        '<button type="button" class="cb-key-main" data-cb-toggle="' + esc(id) + '" aria-pressed="' + on + '" title="' + (on ? "차트에서 빼기" : "차트에 겹쳐보기") + '">' +
        '<span class="cb-key-label">' + esc(m.label) + "</span>" +
        '<strong>' + esc(last ? fmt(last.value, m.unit) : "관측값 대기") + (last && last.est ? '<em class="cb-est">추정</em>' : "") + "</strong>" +
        '<small>' + esc(last ? last.date : "") + (finite(chg) ? " · 직전 대비 " : "") + "</small>" + pctBadge(chg) + spark +
        '<span class="cb-key-state">' + (on ? "● 차트 표시 중" : "＋ 차트에 겹쳐보기") + "</span></button>" +
        '<button type="button" class="cb-key-unpin" data-cb-unpin="' + esc(id) + '" aria-label="' + esc(m.label) + ' 주요 지표에서 빼기" title="주요 지표에서 빼기">×</button></div>';
    }).join("");
  }
  function metricRow(c, id, opts) {
    var m = meta(c, id); if (!m) return "";
    var p = cfg(c.ticker), rows = pointsOf(c, id), g = good(rows), last = g[g.length - 1], lastRow = rows[rows.length - 1];
    var on = p.selected.indexOf(id) >= 0, pinned = keyIds(c).indexOf(id) >= 0, unavailable = !g.length;
    var value = unavailable ? (lastRow && lastRow.label ? lastRow.label : "자료 없음") : fmt(last.value, m.unit);
    var note = opts && opts.note ? opts.note : (m.cadence ? m.cadence : "") + (m.source ? " · " + m.source : "");
    return '<div class="fm-metric' + (unavailable ? " unavailable" : "") + '" data-cb-search="' + esc((m.label + " " + (m.groupLabel || "")).toLowerCase()) + '">' +
      '<label style="display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:inherit"><input type="checkbox" data-cb-metric="' + esc(id) + '" ' + (on ? "checked" : "") + " " + (unavailable ? "disabled" : "") + '>' +
      '<i class="fm-metric-color" style="--series-color:' + esc(on ? colorOf(c, id) : "#51607a") + '"></i><span class="fm-metric-info">' + esc(m.label) + "<small>" + esc(note) + (last ? " · " + esc(last.date) : "") + '</small></span><span class="fm-metric-value">' + esc(value) + "</span></label>" +
      (opts && opts.pin ? '<button type="button" class="cb-pin' + (pinned ? " on" : "") + '" data-cb-pin="' + esc(id) + '" aria-pressed="' + pinned + '" title="' + (pinned ? "주요 지표에서 빼기" : "기업 아래 주요 지표로 고정") + '">' + (pinned ? "★" : "☆") + "</button>" : "") +
      (id.indexOf("custom-") === 0 ? '<button class="fm-remove-custom" data-cb-delete="' + esc(id) + '" aria-label="' + esc(m.label) + ' 삭제">×</button>' : "") + "</div>";
  }
  function finLabel(date, period) { return period === "annual" ? date.slice(0, 4) + "년" : date.slice(0, 4) + "." + date.slice(5, 7); }
  function render(c) {
    var p = cfg(c.ticker);
    var opened = ["fin", "ind", "cmp"].filter(function (k) { var el = document.getElementById("cb-select-" + k); return el && el.open; });
    var filterText = (document.getElementById("cb-filter") || {}).value || "";
    var prices = pointsOf(c, "price"), last = prices[prices.length - 1], prior = prices[prices.length - 2];
    var change = last && prior ? (last.value / prior.value - 1) * 100 : null;
    var rows = finRows(c, p.period), fr = rows[rows.length - 1] || {};
    var groups = {}, order = [];
    Object.keys(catalog).forEach(function (id) { var m = catalog[id]; if (m.group === "price") return; if (!groups[m.groupLabel]) { groups[m.groupLabel] = []; order.push(m.groupLabel); } groups[m.groupLabel].push(id); });
    var keys = keyIds(c);
    var indicatorList = order.map(function (g) {
      var ids = groups[g].slice().sort(function (a, b) { return (keys.indexOf(a) < 0) - (keys.indexOf(b) < 0); });
      return '<div class="cb-group" data-cb-group><div class="cb-group-head">' + esc(g) + "</div>" + ids.map(function (id) { return metricRow(c, id, {pin: true}); }).join("") + "</div>";
    }).join("");
    var otherPrices = Object.keys(catalog).filter(function (id) { return catalog[id].group === "price" && id !== "price:" + c.ticker; }).map(function (id) { return metricRow(c, id, {pin: true, note: "일간 종가 · Yahoo Finance"}); }).join("");
    var finCount = p.selected.filter(function (id) { return id.indexOf("fin:") === 0 || id.indexOf("custom-") === 0; }).length;
    var indCount = p.selected.filter(function (id) { return catalog[id] && catalog[id].group !== "price"; }).length;
    var cmpCount = p.selected.filter(function (id) { return id.indexOf("price:") === 0; }).length;
    var chev = '<svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    var hasFin = !!(FINS[c.financials]);

    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">' + esc(c.desc || "") + '</div><h3>' + esc(c.name || c.label) + "<small>" + esc(c.ticker) + " · " + esc(c.market === "KR" ? "KRX" : "US") + "</small></h3></div>" +
        '<div class="fm-quote"><strong>' + (last ? esc(fmt(last.value, priceUnit(c))) : "시세 대기") + "</strong><span" + (finite(change) ? ' style="color:' + (change >= 0 ? "#f68a9a" : "#83aaff") + '"' : "") + ">" + (finite(change) ? (change >= 0 ? "+" : "") + change.toFixed(2) + "% · 전 거래일 대비" : "일별 종가") + "</span></div></div>" +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(last ? last.date : "—") + " 종가 · Yahoo Finance</span><span class=\"fm-divider\"></span><span class=\"fm-status" + (hasFin ? "" : " pending") + '"><i></i>' + (hasFin ? "실적 " + esc(fr.date ? finLabel(fr.date, p.period) : "—") + " 까지" : "실적 자료 없음") + '</span><button type="button" id="cb-refresh">새 데이터 확인 ↻</button></div>' +
        '<div class="cb-keys-head"><b>주요 지표</b><span>카드를 누르면 주가 차트에 겹쳐 봅니다 · 아래 목록의 ☆ 로 추가·고정</span></div>' +
        '<div class="cb-keys">' + keyCards(c) + "</div>" +
        '<div class="fm-selectors">' +
          '<details class="fm-selector" id="cb-select-fin"' + (opened.indexOf("fin") >= 0 ? " open" : "") + '><summary><div><b>실적 지표 추가</b><small>매출 · 영업이익 · OPM · 성장률 · 내 데이터' + (finCount ? " / " + finCount + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><span>여러 지표를 함께 선택할 수 있어요' + (c.fin_note ? " · " + esc(c.fin_note) : "") + '</span><select id="cb-period" aria-label="실적 기간"><option value="quarterly"' + (p.period === "quarterly" ? " selected" : "") + '>분기</option><option value="annual"' + (p.period === "annual" ? " selected" : "") + ">연간</option></select></div>" +
            (hasFin ? Object.keys(FIN).map(function (k) { return metricRow(c, "fin:" + k, {note: (p.period === "annual" ? "연간" : "분기") + " · " + (FIN[k].pct ? "%" : c.fin_unit) + " · Yahoo Finance"}); }).join("") : '<div class="fm-availability"><b>실적 자료 없음</b><p>financials.json 에 이 기업이 아직 없습니다.</p></div>') +
            (customs[c.ticker] || []).map(function (s) { return metricRow(c, s.id, {note: "직접 추가 · 이 브라우저에 저장"}); }).join("") +
            '<button class="fm-add" id="cb-add-custom" type="button">＋ 내 데이터 직접 추가</button></div></details>' +
          '<details class="fm-selector" id="cb-select-ind"' + (opened.indexOf("ind") >= 0 ? " open" : "") + '><summary><div><b>관련 지표 추가</b><small>토큰 · GPU · 메모리 수출 · TSMC · 캐팩스 · CDS' + (indCount ? " / " + indCount + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><input id="cb-filter" class="cb-filter" type="search" placeholder="지표 검색 (예: DRAM, H100, 캐팩스)" value="' + esc(filterText) + '" aria-label="지표 검색"></div>' + indicatorList + "</div></details>" +
          '<details class="fm-selector" id="cb-select-cmp"' + (opened.indexOf("cmp") >= 0 ? " open" : "") + '><summary><div><b>다른 기업 주가 겹쳐보기</b><small>같은 기간 주가 흐름 비교' + (cmpCount ? " / " + cmpCount + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><span>통화가 달라 흐름 비교(0–100)로 보면 편합니다</span></div>' + otherPrices + "</div></details>" +
        "</div>" +
        '<div class="fm-toolbar"><div class="fm-segment" aria-label="차트 기간">' + RANGES.map(function (r) { return '<button type="button" data-cb-range="' + r + '" class="' + (p.range === r ? "on" : "") + '" aria-pressed="' + (p.range === r) + '">' + (r === "ALL" ? "전체" : r) + "</button>"; }).join("") + '</div><label class="fm-view-options">비교 방식<select id="cb-mode"><option value="units"' + (p.mode === "units" ? " selected" : "") + '>실제 단위</option><option value="normalized"' + (p.mode === "normalized" ? " selected" : "") + ">흐름 비교 · 0–100</option></select></label></div>" +
        '<div class="fm-chart" id="cb-chart" aria-label="' + esc(c.name) + ' 주가와 선택 지표 비교"><div class="fm-chart-empty">차트를 불러오는 중입니다.</div></div>' +
        '<div class="fm-legend" id="cb-legend"></div><p class="fm-note" id="cb-axis-note"></p>' +
        '<p class="fm-note">실적은 회계기간 말, 월간 지표는 해당 월 첫날에 표시됩니다. 그 날짜에 이미 발표됐다는 뜻은 아닙니다. 빗금·"추정" 표시는 진행 중인 기간의 잠정치입니다.</p>' +
      "</article>" +
      (hasFin ? '<div class="fm-kpis">' + [["매출", fmt(fr.revenue, c.fin_unit)], ["영업이익", fmt(fr.operating_income, c.fin_unit)], ["OPM", fmt(fr.opm, "%")], ["매출 성장률", fmt(fr.revenue_yoy, "%")], ["영업이익 성장률", finite(fr.operating_income_yoy) ? fmt(fr.operating_income_yoy, "%") : fr.op_label || "—"]].map(function (kv) { return '<div class="fm-kpi"><span>' + kv[0] + "</span><strong>" + esc(kv[1]) + "</strong><small>" + esc(fr.date ? finLabel(fr.date, p.period) : "—") + (kv[0].indexOf("성장") >= 0 ? " · YoY" : p.period === "annual" ? " · 연간" : " · 분기") + "</small></div>"; }).join("") + "</div>" : "") +
      (hasFin && rows.length ? '<div class="fm-history-heading"><b>' + (p.period === "annual" ? "연간" : "분기") + " 실적</b><span>" + esc(finLabel(rows[0].date, p.period) + " – " + finLabel(rows[rows.length - 1].date, p.period)) + " · 단위 " + esc(c.fin_unit) + '</span></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>회계기간</th><th>매출</th><th>영업이익</th><th>OPM</th><th>매출 YoY</th><th>영업이익 YoY</th></tr></thead><tbody>' +
        rows.slice().reverse().map(function (r) { return "<tr><td>" + esc(finLabel(r.date, p.period)) + "</td><td>" + fmt(r.revenue, "") + "</td><td>" + fmt(r.operating_income, "") + "</td><td>" + fmt(r.opm, "%") + "</td><td>" + fmt(r.revenue_yoy, "%") + "</td><td>" + (finite(r.operating_income_yoy) ? fmt(r.operating_income_yoy, "%") : esc(r.op_label || "—")) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
      '<p class="fm-sources">주가: Yahoo Finance 일간 종가(' + esc((AI && AI.generated_at) || "—").slice(0, 16) + " 수집) · 실적: Yahoo Finance 재무제표(financials.json) · 관련 지표: 데이터 허브 AI 지표 파일(각 지표의 출처는 목록에 표시) · 주요 지표 고정·선택·직접 추가한 자료는 이 브라우저에 저장됩니다.</p>";
    bind(c); applyFilter(); drawChart(c);
  }
  function applyFilter() {
    var input = document.getElementById("cb-filter"); if (!input) return;
    var q = input.value.trim().toLowerCase();
    host.querySelectorAll("#cb-select-ind [data-cb-search]").forEach(function (row) { row.hidden = q && row.dataset.cbSearch.indexOf(q) < 0; });
    host.querySelectorAll("#cb-select-ind [data-cb-group]").forEach(function (g) { g.hidden = !g.querySelector("[data-cb-search]:not([hidden])"); });
  }
  function toggle(c, id, force) {
    var p = cfg(c.ticker), on = p.selected.indexOf(id) >= 0, want = force == null ? !on : force;
    p.selected = p.selected.filter(function (x) { return x !== id; });
    if (want) p.selected.push(id);
    store(); render(c);
  }
  function bind(c) {
    var p = cfg(c.ticker);
    host.querySelectorAll("[data-cb-toggle]").forEach(function (b) { b.onclick = function () { toggle(c, b.dataset.cbToggle); }; });
    host.querySelectorAll("[data-cb-metric]").forEach(function (i) { i.onchange = function () { toggle(c, i.dataset.cbMetric, i.checked); }; });
    host.querySelectorAll("[data-cb-pin]").forEach(function (b) { b.onclick = function () {
      var id = b.dataset.cbPin, pinned = keyIds(c).indexOf(id) >= 0;
      if (pinned) { p.pins = p.pins.filter(function (x) { return x !== id; }); if ((c.indicators || []).indexOf(id) >= 0 && p.unpins.indexOf(id) < 0) p.unpins.push(id); }
      else { p.unpins = p.unpins.filter(function (x) { return x !== id; }); if ((c.indicators || []).indexOf(id) < 0 && p.pins.indexOf(id) < 0) p.pins.push(id); }
      store(); render(c); toast(pinned ? "주요 지표에서 뺐어요." : "기업 아래 주요 지표로 고정했어요.");
    }; });
    host.querySelectorAll("[data-cb-unpin]").forEach(function (b) { b.onclick = function () {
      var id = b.dataset.cbUnpin; p.pins = p.pins.filter(function (x) { return x !== id; }); if ((c.indicators || []).indexOf(id) >= 0 && p.unpins.indexOf(id) < 0) p.unpins.push(id);
      store(); render(c); toast("주요 지표에서 뺐어요. 관련 지표 목록의 ☆ 로 다시 고정할 수 있어요.");
    }; });
    host.querySelectorAll("[data-cb-delete]").forEach(function (b) { b.onclick = function () {
      var id = b.dataset.cbDelete, next = (customs[c.ticker] || []).filter(function (s) { return s.id !== id; }), backup = customs[c.ticker];
      customs[c.ticker] = next; try { storeCustoms(); } catch (e) { customs[c.ticker] = backup; toast("저장 공간을 확인해 주세요."); return; }
      p.selected = p.selected.filter(function (x) { return x !== id; }); store(); render(c); toast("직접 추가한 지표를 삭제했어요.");
    }; });
    host.querySelectorAll("[data-cb-range]").forEach(function (b) { b.onclick = function () { p.range = b.dataset.cbRange; store(); render(c); }; });
    document.getElementById("cb-mode").onchange = function (e) { p.mode = e.target.value; store(); drawChart(c); };
    document.getElementById("cb-period").onchange = function (e) { p.period = e.target.value; store(); render(c); };
    document.getElementById("cb-refresh").onclick = function () { load(true); };
    document.getElementById("cb-add-custom").onclick = function () { showAddDialog(c); };
    document.getElementById("cb-filter").oninput = applyFilter;
  }

  /* ── 차트 (파인엠텍 워크벤치와 같은 방식: 단위별 독립 축, 단위가 많으면 0–100 흐름 비교) ── */
  function drawChart(c) {
    var box = document.getElementById("cb-chart"); if (!box || host.hidden) return;
    var p = cfg(c.ticker), prices = pointsOf(c, "price");
    if (!prices.length) { box.innerHTML = '<div class="fm-chart-empty">주가 자료가 아직 없습니다.</div>'; return; }
    var start = C.rangeStart(prices, p.range === "ALL" ? "ALL" : p.range);
    var ids = ["price"].concat(p.selected.filter(function (id) { return id !== "price" && meta(c, id); }));
    var end = C.timestamp(prices[prices.length - 1].date);
    ids.forEach(function (id) { var g = good(pointsOf(c, id)); if (g.length) end = Math.max(end, Math.min(C.timestamp(g[g.length - 1].date), Date.now() + 40 * 86400000)); });
    var series = ids.map(function (id) { var m = meta(c, id); return {id: id, label: m.label, unit: m.unit, color: colorOf(c, id), fin: id.indexOf("fin:") === 0, points: pointsOf(c, id).filter(function (q) { var t = C.timestamp(q.date); return t >= start && t <= end; })}; })
      .filter(function (s) { return s.points.some(function (q) { return finite(q.value); }); });
    var rawUnits = series.map(function (s) { return s.unit; }).filter(function (u, i, a) { return a.indexOf(u) === i; });
    var narrow = box.clientWidth < 600, normalized = p.mode === "normalized" || rawUnits.length > (narrow ? 2 : 3);
    var width = Math.max(box.clientWidth, 280), height = narrow ? 330 : 390, units = normalized ? ["0–100"] : rawUnits;
    var left = narrow ? 44 : 60, right = normalized ? 14 : Math.max(14, (units.length - 1) * (narrow ? 54 : 66)), top = 29, bottom = 32, pw = width - left - right, ph = height - top - bottom;
    var plot = normalized ? series.map(function (s) { return Object.assign({}, s, {points: C.normalize(s.points)}); }) : series;
    var scales = {};
    units.forEach(function (u) { scales[u] = normalized ? [-5, 105] : C.domain(plot.filter(function (s) { return s.unit === u; }).reduce(function (a, s) { return a.concat(s.points.map(function (q) { return q.value; })); }, []), u !== "원" && u !== "USD"); });
    var x = function (d) { return left + (C.timestamp(d) - start) / Math.max(end - start, 86400000) * pw; };
    var y = function (v, u) { var d = scales[normalized ? "0–100" : u]; return top + (d[1] - v) / (d[1] - d[0]) * ph; };
    var compact = function (v) { return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + "M" : Math.abs(v) >= 10000 ? (v / 1e4).toFixed(1) + "만" : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("ko-KR") : Math.abs(v) >= 10 ? Number(v.toFixed(1)).toString() : Number(v.toFixed(2)).toString(); };
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(series.map(function (s) { return s.label; }).join(", ")) + ' 비교 시계열"><defs><linearGradient id="cb-price-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#769fff" stop-opacity=".14"/><stop offset="1" stop-color="#769fff" stop-opacity="0"/></linearGradient><clipPath id="cb-clip"><rect x="' + left + '" y="' + top + '" width="' + pw + '" height="' + ph + '"/></clipPath></defs>';
    for (var i = 0; i <= 4; i++) svg += '<path d="M' + left + " " + (top + i / 4 * ph) + "H" + (left + pw) + '" stroke="#718db3" stroke-opacity=".13"/>';
    units.forEach(function (u, idx) {
      var d = scales[u], xx = idx === 0 ? left - 9 : left + pw + 8 + (idx - 1) * (narrow ? 54 : 66), anchor = idx === 0 ? "end" : "start";
      svg += '<text x="' + xx + '" y="14" text-anchor="' + anchor + '">' + esc(u) + "</text>";
      for (var k = 0; k <= 4; k++) svg += '<text x="' + xx + '" y="' + (top + k / 4 * ph + 4) + '" text-anchor="' + anchor + '">' + compact(d[1] - (d[1] - d[0]) * k / 4) + "</text>";
    });
    var n = narrow ? 3 : 5;
    for (var j = 0; j <= n; j++) { var t = start + (end - start) * j / n; svg += '<text x="' + (left + pw * j / n) + '" y="' + (height - 8) + '" text-anchor="' + (j === 0 ? "start" : j === n ? "end" : "middle") + '">' + new Date(t).toISOString().slice(0, 7).replace("-", ".") + "</text>"; }
    svg += '<g clip-path="url(#cb-clip)">';
    plot.forEach(function (s) {
      var geo = C.lineGeometry(s.points, x, function (v) { return y(v, s.unit); }), gv = geo.vertices;
      if (!gv.length) return;
      if (s.id === "price" && gv.length > 1) svg += '<path d="' + geo.path + "L" + gv[gv.length - 1][0] + " " + (height - bottom) + "L" + gv[0][0] + " " + (height - bottom) + 'Z" fill="url(#cb-price-fill)"/>';
      if (!normalized && s.id !== "price" && scales[s.unit][0] < 0 && scales[s.unit][1] > 0) svg += '<path d="M' + left + " " + y(0, s.unit) + "H" + (left + pw) + '" stroke="' + s.color + '" stroke-opacity=".13" stroke-dasharray="3 5"/>';
      svg += '<path class="fm-series-path' + (s.id === "price" ? " fm-price-path" : "") + '"' + (s.id === "price" ? ' pathLength="1"' : "") + ' d="' + geo.path + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.fin ? 2.6 : s.id === "price" ? 2 : 1.9) + '" stroke-linecap="round" stroke-linejoin="round"/>';
      if (s.id !== "price" && s.points.length <= 120) {
        var gp = s.points.filter(function (q) { return finite(q.value); });
        gv.forEach(function (v, vi) { var est = gp[vi] && gp[vi].est; svg += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + (est ? 3.2 : 2.5) + '" fill="' + (est ? "#101623" : s.color) + '" stroke="' + (est ? s.color : "#101623") + '" stroke-width="' + (est ? 1.6 : 1) + '"/>'; });
      }
    });
    svg += '</g><line id="cb-crosshair" x1="0" y1="' + top + '" x2="0" y2="' + (height - bottom) + '" stroke="#a2b9db" stroke-opacity=".4" stroke-dasharray="4 4" visibility="hidden"/><rect id="cb-hit" x="' + left + '" y="' + top + '" width="' + pw + '" height="' + ph + '" fill="transparent" tabindex="0" role="slider" aria-label="차트 날짜 탐색, 좌우 화살표" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"/></svg><div class="fm-tooltip" id="cb-tooltip" hidden></div>';
    box.innerHTML = svg;
    document.getElementById("cb-axis-note").textContent = normalized
      ? "흐름 비교: 선택한 기간에서 각 지표의 최솟값을 0, 최댓값을 100으로 맞춥니다. 수익률이 아니며, 원래 값은 차트에 마우스를 올리면 보입니다." + (p.mode !== "normalized" ? " 단위가 많아 흐름 비교를 적용했습니다." : "")
      : "주가와 선택 지표는 단위별 독립 축을 사용합니다. 선의 높이를 서로의 크기로 직접 비교하지 마세요. 점은 실제 관측값이고, 속이 빈 점은 추정치입니다.";
    var legend = document.getElementById("cb-legend");
    legend.innerHTML = series.map(function (s) { return '<button type="button" data-cb-remove="' + esc(s.id) + '"' + (s.id === "price" ? " disabled" : "") + ' title="' + (s.id === "price" ? "기본 주가" : "차트에서 빼기") + '"><i style="--series-color:' + esc(s.color) + '"></i>' + esc(s.label) + "<small>" + (s.id === "price" ? "기본" : "×") + "</small></button>"; }).join("");
    legend.querySelectorAll("[data-cb-remove]").forEach(function (b) { b.onclick = function () { toggle(c, b.dataset.cbRemove, false); }; });
    var hit = document.getElementById("cb-hit"), tip = document.getElementById("cb-tooltip"), cross = document.getElementById("cb-crosshair");
    function showAt(pos) {
      var xx = Math.min(left + pw, Math.max(left, pos)), tt = start + (xx - left) / pw * (end - start);
      cross.setAttribute("x1", xx); cross.setAttribute("x2", xx); cross.setAttribute("visibility", "visible");
      tip.innerHTML = "<b>" + new Date(tt).toISOString().slice(0, 10) + " · 가까운 관측값</b>" + series.map(function (s) {
        var q = C.nearest(s.points.filter(function (r) { return finite(r.value) || r.label; }), tt);
        return '<div class="fm-tip-row"><i class="fm-metric-color" style="--series-color:' + esc(s.color) + '"></i><span>' + esc(s.label) + "<small>" + esc(q ? q.date : "") + (s.fin ? " 회계기간 말" : "") + (q && q.est ? " · 추정" : "") + "</small></span><strong>" + (q && q.label && !finite(q.value) ? esc(q.label) : esc(fmt(q && q.value, s.unit))) + "</strong></div>";
      }).join("");
      tip.hidden = false; tip.style.left = Math.max(2, Math.min(xx + 15, width - Math.min(290, width * 0.88) - 4)) + "px"; tip.style.top = "39px";
    }
    hit.onpointermove = function (e) { showAt(e.clientX - box.getBoundingClientRect().left); };
    hit.onpointerleave = function () { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
    var kp = left;
    hit.onkeydown = function (e) {
      if (["ArrowLeft", "ArrowRight", "Escape"].indexOf(e.key) < 0) return; e.preventDefault();
      if (e.key === "Escape") { hit.onpointerleave(); return; }
      kp = Math.max(left, Math.min(left + pw, kp + (e.key === "ArrowRight" ? 1 : -1) * pw / 50)); hit.setAttribute("aria-valuenow", Math.round((kp - left) / pw * 100)); showAt(kp);
    };
  }

  /* ── 내 데이터 직접 추가 ── */
  function showAddDialog(c) {
    var old = document.getElementById("cb-add-dialog"); if (old) old.remove();
    var dialog = document.createElement("dialog"); dialog.className = "fm-dialog"; dialog.id = "cb-add-dialog";
    dialog.innerHTML = '<form id="cb-custom-form"><h3>' + esc(c.name) + '과(와) 비교할 데이터 추가</h3><p>추가한 자료는 이 브라우저에 저장됩니다. 날짜와 값은 한 줄에 하나씩 입력해 주세요.</p><label>지표 이름<input name="name" required maxlength="60" placeholder="예: 내가 확인한 월별 출하량"></label><label>단위<select name="unit"><option>개</option><option>kg</option><option>USD</option><option>$B</option><option>억원</option><option>조원</option><option>원</option><option>%</option><option>지수</option></select></label><label>출처 링크 (선택)<input name="source" type="url" placeholder="https://..."></label><label>날짜, 값<textarea name="points" required spellcheck="false" placeholder="2026-01-31,120\n2026-02-28,135\n2026-03-31,148"></textarea></label><span class="fm-error" id="cb-form-error" role="alert"></span><div class="fm-dialog-actions"><button type="button" id="cb-cancel-add">취소</button><button type="submit">차트에 추가</button></div></form>';
    document.body.appendChild(dialog); dialog.showModal();
    document.getElementById("cb-cancel-add").onclick = function () { dialog.close(); };
    document.getElementById("cb-custom-form").onsubmit = function (e) {
      e.preventDefault(); var form = new FormData(e.target), list = customs[c.ticker] || [];
      try {
        if (list.length >= 20) throw new Error("기업마다 직접 추가 지표는 20개까지 저장할 수 있어요.");
        var name = String(form.get("name")).trim(); if (!name) throw new Error("지표 이름을 입력해 주세요.");
        var values = C.parsePoints(String(form.get("points"))), source = safeURL(String(form.get("source") || ""));
        if (form.get("source") && !source) throw new Error("http 또는 https 출처 링크를 입력해 주세요.");
        var added = {id: "custom-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), label: name, unit: String(form.get("unit")), source: "직접 추가", source_url: source, group: "custom", groupLabel: "직접 추가", points: values};
        customs[c.ticker] = list.concat([added]);
        try { storeCustoms(); } catch (err) { customs[c.ticker] = list; throw err; }
        cfg(c.ticker).selected.push(added.id); store(); dialog.close(); render(c); toast("새 지표를 차트에 추가했어요. 이 브라우저에 저장됩니다.");
      } catch (err) { document.getElementById("cb-form-error").textContent = err.name === "QuotaExceededError" ? "브라우저 저장 공간이 부족해요." : err.message; }
    };
    dialog.onclose = function () { dialog.remove(); };
  }

  /* ── 불러오기 ── */
  function load(manual) {
    var get = function (p) { return fetch(p + "?v=" + Date.now(), {cache: "no-store"}).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); };
    var btn = document.getElementById("cb-refresh"); if (btn) { btn.disabled = true; btn.textContent = "확인 중…"; }
    Promise.all([
      get("data/company_links.json").catch(function () { return null; }),
      get("data/ai_indicators.json"),
      get("financials.json").catch(function () { return null; }),
      get("data/finemtec.json").catch(function () { return null; })
    ]).then(function (res) {
      if (res[0] && Array.isArray(res[0].companies) && res[0].companies.length) COMPANIES = res[0].companies.map(function (c) { return Object.assign({name: c.name || c.label}, c); });
      if (res[1].schema_version !== 1) throw new Error("AI 지표 파일 형식 불일치");
      AI = res[1]; FINS = (res[2] && res[2].financials) || {}; FM = res[3];
      buildCatalog(); loaded = true; loadError = "";
      if (!COMPANIES.some(function (c) { return c.ticker === state.company; })) state.company = COMPANIES[0].ticker;
      renderAll(); if (manual) toast("서버에 저장된 최신 데이터를 불러왔어요.");
    }).catch(function (e) {
      loadError = "데이터 파일 수신 실패 (" + e.message + ")";
      if (loaded) { if (manual) toast("새 데이터를 받지 못했어요. 현재 표시된 데이터를 유지합니다."); renderAll(); }
      else renderAll();
    });
  }
  window.addEventListener("resize", function () { cancelAnimationFrame(renderId); renderId = requestAnimationFrame(function () { if (loaded && !host.hidden) drawChart(company()); }); });
  document.addEventListener("vantage-view", function (e) { if (e.detail && e.detail.view === "company" && loaded) renderAll(); });
  if (!state.company) state.company = FALLBACK[0].ticker;
  renderAll();
  load(false);
})();
