/* 기업별 데이터 모음 — 기업을 고르고, 주가 위에 실적·관련 지표를 직접 골라 겹쳐 본다(파인엠텍 워크벤치와 같은 틀).
   읽는 파일: data/company_links.json(기업·주요 지표), data/ai_indicators.json(주가·지표), financials.json(분기·연간 실적),
   data/kr_companies.json(한국 기업 목록·요약) + data/kr/{코드}.json(한국 기업 주가·DART/네이버 실적, 고를 때 불러옴).
   기업 고르기: 즐겨찾기(★) 칩 + 전체 기업 목록(검색·업종·정렬). 즐겨찾기는 이 브라우저(동기화 키)에 저장한다.
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
  var RANGES = ["FIN", "6M", "YTD", "1Y", "2Y", "ALL"];
  var KR_DEFAULT = ["fin:revenue", "fin:operating_income", "fin:revenue_yoy", "fin:opm"];
  var DEFAULT_FAVS = ["441270", "000660", "005930", "NVDA", "TSM", "비상장"];
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
  var state = {company: typeof saved.company === "string" ? saved.company : null, per: saved.per && typeof saved.per === "object" ? saved.per : {},
    favs: Array.isArray(saved.favs) ? saved.favs.filter(function (t) { return typeof t === "string"; }) : DEFAULT_FAVS.slice(),
    listOpen: saved.listOpen !== false, sort: saved.sort && typeof saved.sort === "object" ? saved.sort : {key: "rank", dir: 1}};
  var customs = read(CUSTOM_KEY, {}); if (!customs || typeof customs !== "object" || Array.isArray(customs)) customs = {};
  var COMPANIES = FALLBACK, AI = null, FINS = {}, FM = null, KRX = null, KR = {}, krLoading = {}, loaded = false, loadError = "", catalog = {}, renderId = 0;
  var query = "", sector = "", mkt = "";

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
      p = state.per[tk] = c.kr ? {selected: KR_DEFAULT.slice(), range: "FIN", mode: "units", period: "quarterly", pins: [], unpins: []}
        : {selected: (first ? [first] : []).concat(c.financials ? ["fin:revenue"] : []), range: "2Y", mode: "units", period: "quarterly", pins: [], unpins: []};
    }
    ["selected", "pins", "unpins"].forEach(function (k) { if (!Array.isArray(p[k])) p[k] = []; });
    if (RANGES.indexOf(p.range) < 0) p.range = "2Y";
    if (p.period !== "annual") p.period = "quarterly";
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
  function krData(c) { return c && c.kr ? KR[c.ticker] || null : null; }
  // 한국 기업 실적 단위: 분기 매출이 1조원을 넘으면 조원, 아니면 억원(원본은 억원)
  function finUnit(c) {
    var d = krData(c); if (!d) return {unit: c.fin_unit || "", div: Number(c.fin_div) || 1};
    var big = (d.financials.quarterly || []).some(function (r) { return finite(r.revenue) && Math.abs(r.revenue) >= 10000; });
    return big ? {unit: "조원", div: 10000} : {unit: "억원", div: 1};
  }
  function finRows(c, period) {
    var kd = krData(c);
    if (kd) {
      var u = finUnit(c);
      return ((kd.financials || {})[period === "annual" ? "annual" : "quarterly"] || []).filter(function (r) { return C.validDate(r.date); }).map(function (r) {
        return {date: r.date, est: !!r.est, revenue: finite(r.revenue) ? r.revenue / u.div : null, operating_income: finite(r.operating_income) ? r.operating_income / u.div : null,
          opm: finite(r.opm) ? r.opm : null, revenue_yoy: finite(r.revenue_yoy) ? r.revenue_yoy : null, operating_income_yoy: finite(r.operating_income_yoy) ? r.operating_income_yoy : null,
          op_label: r.op_label || null, source: r.source};
      });
    }
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
  function finMeta(c, key) { return {id: "fin:" + key, label: FIN[key].label, unit: FIN[key].pct ? "%" : finUnit(c).unit, group: "financial", groupLabel: "실적"}; }
  function hasFinancials(c) { return !!(krData(c) || FINS[c.financials]); }
  function meta(c, id) {
    if (id === "price") return {id: "price", label: c.name + " 주가", unit: priceUnit(c), group: "price"};
    if (id.indexOf("fin:") === 0 && FIN[id.slice(4)]) return finMeta(c, id.slice(4));
    if (id.indexOf("custom-") === 0) return (customs[c.ticker] || []).filter(function (s) { return s.id === id; })[0] || null;
    return catalog[id] || null;
  }
  function pointsOf(c, id) {
    if (id === "price") { var kd = krData(c); return good(kd ? (kd.price || {}).points : (((AI && AI.companies) || {})[c.ticker] || {}).points); }
    if (id.indexOf("fin:") === 0) { var key = id.slice(4); return finRows(c, cfg(c.ticker).period).map(function (r) { return {date: r.date, value: r[key], est: r.est, label: key === "operating_income_yoy" && !finite(r[key]) ? r.op_label : null}; }); }
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
  /* ── 기업 고르기: 즐겨찾기 칩 + 전체 기업 목록(검색·업종·정렬) ── */
  var tailCache = {};
  function priceTail(c) {
    var key = c.ticker + (krData(c) ? ":kr" : "");
    if (tailCache[key]) return tailCache[key];
    var kd = krData(c);
    return (tailCache[key] = c.module === "finemtec" ? good(FM && FM.price && FM.price.points) : kd ? good((kd.price || {}).points) : good((((AI && AI.companies) || {})[c.ticker] || {}).points));
  }
  function chgOf(c, n) {
    if (c.kr && !KR[c.ticker]) return c.kr[n === 1 ? "chg_1d" : n === 21 ? "chg_1m" : "chg_1y"];
    var pts = priceTail(c);
    return pts.length > n ? (pts[pts.length - 1].value / pts[pts.length - 1 - n].value - 1) * 100 : null;
  }
  function isFav(tk) { return state.favs.indexOf(tk) >= 0; }
  function toggleFav(tk) {
    var on = isFav(tk);
    state.favs = on ? state.favs.filter(function (t) { return t !== tk; }) : state.favs.concat([tk]);
    store();
    // 표 전체를 다시 그리지 않고 즐겨찾기 줄과 해당 ☆ 만 바꾼다
    var favBox = chipHost.querySelector(".cb-favs");
    if (favBox) { favBox.outerHTML = favsHtml(); bindFavs(); } else renderPicker();
    chipHost.querySelectorAll('[data-cb-star="' + tk + '"]').forEach(function (b) { b.classList.toggle("on", !on); b.textContent = !on ? "★" : "☆"; b.setAttribute("aria-pressed", !on); b.title = !on ? "즐겨찾기 해제" : "즐겨찾기"; });
    if (sector === "★") applyListFilter();
    var b = document.getElementById("cb-fav-hero");
    if (b && company().ticker === tk) { b.classList.toggle("on", !on); b.textContent = !on ? "★ 즐겨찾기" : "☆ 즐겨찾기"; b.setAttribute("aria-pressed", !on); }
    toast(on ? "즐겨찾기에서 뺐어요." : "즐겨찾기에 추가했어요. 위쪽 칩에서 바로 열 수 있어요.");
  }
  function eok(v) {
    if (!finite(v)) return "—";
    var a = Math.abs(v);
    return a >= 10000 ? (v / 10000).toLocaleString("ko-KR", {maximumFractionDigits: a >= 100000 ? 1 : 2}) + "조" : Math.round(v).toLocaleString("ko-KR") + "억";
  }
  function pctCell(v) { return finite(v) ? '<span class="' + (v >= 0 ? "cb-up" : "cb-down") + '">' + (v >= 0 ? "+" : "") + v.toFixed(1) + "%</span>" : '<span class="cb-muted">—</span>'; }
  function miniSpark(vals) {
    vals = (vals || []).filter(finite); if (vals.length < 2) return "";
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), up = vals[vals.length - 1] >= vals[0];
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + (i / (vals.length - 1) * 80).toFixed(1) + " " + (hi === lo ? 11 : 20 - (v - lo) / (hi - lo) * 18).toFixed(1); }).join(" ");
    return '<svg class="cb-mini" viewBox="0 0 80 22" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + (up ? "#f68a9a" : "#83aaff") + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>';
  }
  function qOf(c) { return (c.kr && c.kr.q) || {}; }
  var COLS = [
    {key: "rank", label: "#", get: function (c, i) { return c.kr && c.kr.value_rank ? (c.kr.market === "KOSDAQ" ? 500 : 0) + c.kr.value_rank : 900 + i; }},
    {key: "name", label: "기업", get: function (c) { return c.name || c.label; }},
    {key: "close", label: "종가", get: function (c) { if (c.kr && !KR[c.ticker]) return c.kr.close; var p = priceTail(c); return p.length ? p[p.length - 1].value : null; }},
    {key: "d1", label: "1일", get: function (c) { return chgOf(c, 1); }},
    {key: "m1", label: "1개월", get: function (c) { return chgOf(c, 21); }},
    {key: "y1", label: "1년", get: function (c) { return chgOf(c, 250); }},
    {key: "rev", label: "최근 분기 매출", get: function (c) { return qOf(c).revenue; }},
    {key: "ryoy", label: "매출 YoY", get: function (c) { return qOf(c).revenue_yoy; }},
    {key: "op", label: "영업이익", get: function (c) { return qOf(c).operating_income; }},
    {key: "oyoy", label: "영업익 YoY", get: function (c) { return qOf(c).operating_income_yoy; }},
    {key: "opm", label: "OPM", get: function (c) { return qOf(c).opm; }}
  ];
  function favsHtml() {
    var cur = company();
    var favs = state.favs.map(function (tk) { return COMPANIES.filter(function (c) { return c.ticker === tk; })[0]; }).filter(Boolean);
    var favHtml = '<div class="cb-favs"><span class="cb-favs-label">★ 즐겨찾기</span>' + (favs.length ? favs.map(function (c) {
      return '<button type="button" class="cb-chip' + (c.ticker === cur.ticker ? " on" : "") + '" data-cb-company="' + esc(c.ticker) + '" aria-pressed="' + (c.ticker === cur.ticker) + '"><b>' + esc(c.name || c.label) + "</b><small>" + esc(c.ticker) + "</small>" + pctBadge(chgOf(c, 1)) + "</button>";
    }).join("") : '<span class="cb-muted">아래 목록에서 ☆ 를 누르면 여기에 고정됩니다.</span>') +
      (favs.some(function (c) { return c.ticker === cur.ticker; }) ? "" : '<span class="cb-chip on cb-chip-cur"><b>' + esc(cur.name || cur.label) + "</b><small>보는 중</small></span>") + "</div>";
    return favHtml;
  }
  function bindFavs() { chipHost.querySelectorAll("[data-cb-company]").forEach(function (b) { b.onclick = function () { pick(b.dataset.cbCompany); }; }); }
  function renderPicker() {
    var cur = company(), favHtml = favsHtml();
    var sectors = COMPANIES.map(function (c) { return c.kr ? c.kr.sector : ""; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var q = query.trim().toLowerCase();
    var list = COMPANIES.map(function (c, i) { return {c: c, i: i}; });
    var col = COLS.filter(function (k) { return k.key === state.sort.key; })[0] || COLS[0], dir = state.sort.dir === -1 ? -1 : 1;
    list.forEach(function (o) { o.v = col.get(o.c, o.i); });
    list.sort(function (a, b) {
      var x = a.v, y = b.v;
      if (typeof x === "string" || typeof y === "string") return dir * String(x || "").localeCompare(String(y || ""), "ko");
      if (!finite(x) && !finite(y)) return a.i - b.i; if (!finite(x)) return 1; if (!finite(y)) return -1;
      return dir * (x - y);
    });
    var open = state.listOpen || !!q;
    var krCount = COMPANIES.filter(function (c) { return c.kr; }).length, kqCount = COMPANIES.filter(function (c) { return c.kr && c.kr.market === "KOSDAQ"; }).length;
    var head = '<tr><th class="cb-star-col"><span class="sr-only">즐겨찾기</span></th>' + COLS.map(function (k) {
      var on = k.key === col.key;
      return '<th' + (k.key === "name" ? ' class="cb-name-col"' : "") + ' aria-sort="' + (on ? (dir === 1 ? "ascending" : "descending") : "none") + '"><button type="button" data-cb-sort="' + k.key + '" class="' + (on ? "on" : "") + '">' + k.label + (on ? (dir === 1 ? " ↑" : " ↓") : "") + "</button></th>";
    }).join("") + '<th class="cb-spark-col">6개월</th></tr>';
    var body = list.map(function (o) {
      var c = o.c, k = c.kr || {}, qd = qOf(c), fav = isFav(c.ticker), on = c.ticker === cur.ticker;
      var close = COLS[2].get(c, o.i);
      var spark = c.kr && !KR[c.ticker] ? k.spark : priceTail(c).slice(-120).filter(function (x, i) { return i % 4 === 0; }).map(function (x) { return x.value; });
      var none = '<span class="cb-muted">—</span>';
      return '<tr class="' + (on ? "on" : "") + '" data-cb-row="' + esc(c.ticker) + '" data-mkt="' + esc(k.market || "") + '" data-sector="' + esc(k.sector || "") + '" data-hay="' + esc([c.name, c.label, c.ticker, c.desc, k.sector].join(" ").toLowerCase()) + '" tabindex="0">' +
        '<td class="cb-star-col"><button type="button" class="cb-star' + (fav ? " on" : "") + '" data-cb-star="' + esc(c.ticker) + '" aria-pressed="' + fav + '" aria-label="' + esc(c.name) + ' 즐겨찾기" title="' + (fav ? "즐겨찾기 해제" : "즐겨찾기") + '">' + (fav ? "★" : "☆") + "</button></td>" +
        '<td class="cb-num cb-muted">' + (k.value_rank ? '<span class="cb-mk">' + (k.market === "KOSDAQ" ? "닥" : "피") + "</span>" + k.value_rank : "") + "</td>" +
        '<td class="cb-name-col"><b>' + esc(c.name || c.label) + "</b><small>" + esc(c.ticker) + " · " + esc(k.sector || c.desc || "") + "</small></td>" +
        '<td class="cb-num">' + (finite(close) ? esc(fmt(close, c.market === "US" ? "USD" : "원")) : none) + "</td>" +
        '<td class="cb-num">' + pctCell(chgOf(c, 1)) + '</td><td class="cb-num">' + pctCell(chgOf(c, 21)) + '</td><td class="cb-num">' + pctCell(chgOf(c, 250)) + "</td>" +
        '<td class="cb-num">' + (c.kr ? eok(qd.revenue) + '<small class="cb-qd">' + esc(qd.date ? qd.date.slice(2, 7).replace("-", ".") : "") + "</small>" : none) + "</td>" +
        '<td class="cb-num">' + pctCell(qd.revenue_yoy) + '</td><td class="cb-num">' + (c.kr ? eok(qd.operating_income) : none) + "</td>" +
        '<td class="cb-num">' + (finite(qd.operating_income_yoy) ? pctCell(qd.operating_income_yoy) : qd.op_label ? '<span class="cb-tag">' + esc(qd.op_label) + "</span>" : none) + "</td>" +
        '<td class="cb-num">' + (finite(qd.opm) ? qd.opm.toFixed(1) + "%" : none) + "</td>" +
        '<td class="cb-spark-col">' + miniSpark(spark) + "</td></tr>";
    }).join("");
    chipHost.innerHTML = favHtml +
      '<div class="cb-finder"><input type="search" id="cb-q" class="cb-q" placeholder="기업명 · 종목코드 · 업종 검색" value="' + esc(query) + '" aria-label="기업 검색">' +
      '<select id="cb-mkt" aria-label="시장"><option value="">전체 시장</option><option value="KOSPI"' + (mkt === "KOSPI" ? " selected" : "") + '>코스피</option><option value="KOSDAQ"' + (mkt === "KOSDAQ" ? " selected" : "") + ">코스닥</option></select>" +
      '<select id="cb-sector" aria-label="업종"><option value="">전체 업종</option><option value="★"' + (sector === "★" ? " selected" : "") + ">★ 즐겨찾기만</option>" + sectors.map(function (x) { return "<option" + (x === sector ? " selected" : "") + ">" + esc(x) + "</option>"; }).join("") + "</select>" +
      '<button type="button" id="cb-list-toggle" class="cb-list-toggle" aria-expanded="' + open + '">전체 기업 ' + COMPANIES.length + "개 " + (open ? "접기 ▴" : "펼치기 ▾") + "</button></div>" +
      '<div class="cb-list"' + (open ? "" : " hidden") + '><div class="cb-list-meta"><b id="cb-count"></b>' + esc((KRX && KRX.criteria) || "") + (krCount ? " · 코스피 " + (krCount - kqCount) + " · 코스닥 " + kqCount + "개" : "") + " · 실적은 가장 최근 확정 분기 · 제목을 누르면 정렬 · 행을 누르면 아래에 열립니다</div>" +
      '<div class="cb-list-wrap"><table class="cb-table"><thead>' + head + "</thead><tbody>" + body + '<tr id="cb-empty" hidden><td colspan="13" class="cb-muted" style="padding:16px">검색 결과가 없습니다.</td></tr>' + "</tbody></table></div></div>";
    bindFavs();
    chipHost.querySelectorAll("[data-cb-star]").forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); toggleFav(b.dataset.cbStar); }; });
    chipHost.querySelectorAll("[data-cb-row]").forEach(function (r) {
      r.onclick = function () { pick(r.dataset.cbRow, true); };
      r.onkeydown = function (e) { if (e.key === "Enter" && e.target === r) pick(r.dataset.cbRow, true); };
    });
    chipHost.querySelectorAll("[data-cb-sort]").forEach(function (b) { b.onclick = function () {
      var k = b.dataset.cbSort; state.sort = {key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "name" || k === "rank" ? 1 : -1)}; store(); renderPicker();
    }; });
    var qi = document.getElementById("cb-q");
    qi.oninput = function () { query = qi.value; if (query.trim() && !state.listOpen) { state.listOpen = true; renderPicker(); var n = document.getElementById("cb-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); return; } applyListFilter(); };
    qi.onkeydown = function (e) { if (e.key === "Enter") { var first = chipHost.querySelector("[data-cb-row]"); if (first) pick(first.dataset.cbRow, true); } };
    document.getElementById("cb-sector").onchange = function (e) { sector = e.target.value; applyListFilter(); };
    document.getElementById("cb-mkt").onchange = function (e) { mkt = e.target.value; applyListFilter(); };
    applyListFilter();
    document.getElementById("cb-list-toggle").onclick = function () { state.listOpen = !open; if (!state.listOpen) query = ""; store(); renderPicker(); };
  }
  // 검색·시장·업종 필터는 표를 다시 그리지 않고 행을 숨겨서 처리한다(200개+ 에서도 즉시 반응)
  function applyListFilter() {
    var q = query.trim().toLowerCase(), shown = 0;
    chipHost.querySelectorAll("[data-cb-row]").forEach(function (r) {
      var ok = (!q || r.dataset.hay.indexOf(q) >= 0) && (!mkt || r.dataset.mkt === mkt) && (!sector || (sector === "★" ? isFav(r.dataset.cbRow) : r.dataset.sector === sector));
      r.hidden = !ok; if (ok) shown++;
    });
    var empty = document.getElementById("cb-empty"); if (empty) empty.hidden = shown > 0;
    var cnt = document.getElementById("cb-count"); if (cnt) cnt.textContent = shown === COMPANIES.length ? "" : shown + "개 표시 · ";
  }
  function pick(tk, scroll) {
    state.company = tk; store(); renderAll();
    if (scroll) {
      var m = company().module, el = document.getElementById(m === "finemtec" ? "finemtec-workspace" : m === "zeta" ? "zeta-workspace" : "company-bench");
      if (el) setTimeout(function () { el.scrollIntoView({behavior: "smooth", block: "start"}); }, 30);
    }
  }
  function ensureKR(c) {
    if (!c.kr || KR[c.ticker] !== undefined || krLoading[c.ticker]) return;
    krLoading[c.ticker] = fetch("data/kr/" + encodeURIComponent(c.ticker) + ".json?v=" + Date.now(), {cache: "no-store"})
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { KR[c.ticker] = d; tailCache = {}; }, function (e) { KR[c.ticker] = null; c.krError = "data/kr/" + c.ticker + ".json 수신 실패 (" + e.message + ")"; })
      .then(function () { delete krLoading[c.ticker]; if (company().ticker === c.ticker) renderAll(); });
  }
  function renderAll() {
    renderPicker();
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
    if (c.kr && KR[c.ticker] === undefined) { ensureKR(c); host.innerHTML = '<div class="fm-chart-empty">' + esc(c.name) + " 주가·실적을 불러오는 중입니다.</div>"; return; }
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
  function rangeLabel(r, period) { return r === "ALL" ? "전체" : r === "FIN" ? (period === "annual" ? "최근 5개 연도" : "최근 8개 분기") : r; }
  function render(c) {
    var p = cfg(c.ticker), kd = krData(c), u = finUnit(c);
    var opened = ["fin", "ind", "cmp"].filter(function (k) { var el = document.getElementById("cb-select-" + k); return el && el.open; });
    var filterText = (document.getElementById("cb-filter") || {}).value || "";
    var prices = pointsOf(c, "price"), last = prices[prices.length - 1], prior = prices[prices.length - 2];
    var change = last && prior ? (last.value / prior.value - 1) * 100 : null;
    var rows = finRows(c, p.period), actual = rows.filter(function (r) { return !r.est; }), fr = actual[actual.length - 1] || {};
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
    var hasFin = hasFinancials(c), fav = isFav(c.ticker);
    var finSource = kd ? "DART 공시 · 네이버 금융(FnGuide)" : "Yahoo Finance";
    var priceSource = kd ? "네이버 금융 일봉" : "Yahoo Finance";
    var eyebrow = kd ? [kd.sector || (c.kr && c.kr.sector), c.kr && c.kr.mcap_eok ? "시총 " + eok(c.kr.mcap_eok) + "원" : ""].filter(Boolean).join(" · ") : c.desc || "";

    host.innerHTML =
      '<article class="fm-hero">' +
        '<div class="fm-heading"><div><div class="fm-eyebrow">' + esc(eyebrow) + '</div><h3>' + esc(c.name || c.label) + "<small>" + esc(c.ticker) + " · " + esc(c.market === "KR" ? (kd && kd.market) || "KRX" : "US") + '</small><button type="button" id="cb-fav-hero" class="cb-fav-hero' + (fav ? " on" : "") + '" aria-pressed="' + fav + '">' + (fav ? "★ 즐겨찾기" : "☆ 즐겨찾기") + "</button></h3></div>" +
        '<div class="fm-quote"><strong>' + (last ? esc(fmt(last.value, priceUnit(c))) : "시세 대기") + "</strong><span" + (finite(change) ? ' style="color:' + (change >= 0 ? "#f68a9a" : "#83aaff") + '"' : "") + ">" + (finite(change) ? (change >= 0 ? "+" : "") + change.toFixed(2) + "% · 전 거래일 대비" : "일별 종가") + "</span></div></div>" +
        '<div class="fm-head-tools"><span class="fm-status"><i></i>' + esc(last ? last.date : "—") + " 종가 · " + esc(priceSource) + '</span><span class="fm-divider"></span><span class="fm-status' + (hasFin ? "" : " pending") + '"><i></i>' + (hasFin ? "실적 " + esc(fr.date ? finLabel(fr.date, p.period) : "—") + " 까지" : "실적 자료 없음") + '</span><button type="button" id="cb-refresh">새 데이터 확인 ↻</button></div>' +
        (kd && !keyIds(c).length ? "" : '<div class="cb-keys-head"><b>주요 지표</b><span>카드를 누르면 주가 차트에 겹쳐 봅니다 · 아래 목록의 ☆ 로 추가·고정</span></div>' +
        '<div class="cb-keys">' + keyCards(c) + "</div>") +
        '<div class="fm-selectors">' +
          '<details class="fm-selector" id="cb-select-fin"' + (opened.indexOf("fin") >= 0 ? " open" : "") + '><summary><div><b>실적 지표 추가</b><small>매출 · 영업이익 · OPM · 성장률 · 내 데이터' + (finCount ? " / " + finCount + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><span>여러 지표를 함께 선택할 수 있어요' + (c.fin_note ? " · " + esc(c.fin_note) : "") + '</span><select id="cb-period" aria-label="실적 기간"><option value="quarterly"' + (p.period === "quarterly" ? " selected" : "") + '>분기</option><option value="annual"' + (p.period === "annual" ? " selected" : "") + ">연간</option></select></div>" +
            (hasFin ? Object.keys(FIN).map(function (k) { return metricRow(c, "fin:" + k, {note: (p.period === "annual" ? "연간" : "분기") + " · " + (FIN[k].pct ? "%" : u.unit) + " · " + finSource}); }).join("") : '<div class="fm-availability"><b>실적 자료 없음</b><p>' + esc(c.krError || "이 기업의 실적 파일이 아직 없습니다.") + "</p></div>") +
            (customs[c.ticker] || []).map(function (s) { return metricRow(c, s.id, {note: "직접 추가 · 이 브라우저에 저장"}); }).join("") +
            '<button class="fm-add" id="cb-add-custom" type="button">＋ 내 데이터 직접 추가</button></div></details>' +
          '<details class="fm-selector" id="cb-select-ind"' + (opened.indexOf("ind") >= 0 ? " open" : "") + '><summary><div><b>관련 지표 추가</b><small>토큰 · GPU · 메모리 수출 · TSMC · 캐팩스 · CDS' + (indCount ? " / " + indCount + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><input id="cb-filter" class="cb-filter" type="search" placeholder="지표 검색 (예: DRAM, H100, 캐팩스)" value="' + esc(filterText) + '" aria-label="지표 검색"></div>' + indicatorList + "</div></details>" +
          '<details class="fm-selector" id="cb-select-cmp"' + (opened.indexOf("cmp") >= 0 ? " open" : "") + '><summary><div><b>다른 기업 주가 겹쳐보기</b><small>같은 기간 주가 흐름 비교' + (cmpCount ? " / " + cmpCount + "개 표시 중" : "") + "</small></div>" + chev + '</summary><div class="fm-options"><div class="fm-options-head"><span>통화가 달라 흐름 비교(0–100)로 보면 편합니다</span></div>' + otherPrices + "</div></details>" +
        "</div>" +
        '<div class="fm-toolbar"><div class="fm-segment" aria-label="차트 기간">' + RANGES.filter(function (r) { return r !== "FIN" || hasFin; }).map(function (r) { return '<button type="button" data-cb-range="' + r + '" class="' + (p.range === r ? "on" : "") + '" aria-pressed="' + (p.range === r) + '">' + rangeLabel(r, p.period) + "</button>"; }).join("") + '</div><label class="fm-view-options">비교 방식<select id="cb-mode"><option value="units"' + (p.mode === "units" ? " selected" : "") + '>실제 단위</option><option value="normalized"' + (p.mode === "normalized" ? " selected" : "") + ">흐름 비교 · 0–100</option></select></label></div>" +
        '<div class="fm-chart" id="cb-chart" aria-label="' + esc(c.name) + ' 주가와 선택 지표 비교"><div class="fm-chart-empty">차트를 불러오는 중입니다.</div></div>' +
        '<div class="fm-legend" id="cb-legend"></div><p class="fm-note" id="cb-axis-note"></p>' +
        '<p class="fm-note">실적은 회계기간 말, 월간 지표는 해당 월 첫날에 표시됩니다. 그 날짜에 이미 발표됐다는 뜻은 아닙니다. 속이 빈 점·"E" 표시는 컨센서스 추정치입니다.</p>' +
      "</article>" +
      (hasFin ? '<div class="fm-kpis">' + [["매출", fmt(fr.revenue, u.unit)], ["영업이익", fmt(fr.operating_income, u.unit)], ["OPM", fmt(fr.opm, "%")], ["매출 성장률", fmt(fr.revenue_yoy, "%")], ["영업이익 성장률", finite(fr.operating_income_yoy) ? fmt(fr.operating_income_yoy, "%") : fr.op_label || "—"]].map(function (kv) { return '<div class="fm-kpi"><span>' + kv[0] + "</span><strong>" + esc(kv[1]) + "</strong><small>" + esc(fr.date ? finLabel(fr.date, p.period) : "—") + (kv[0].indexOf("성장") >= 0 ? " · YoY" : p.period === "annual" ? " · 연간" : " · 분기") + "</small></div>"; }).join("") + "</div>" : "") +
      (hasFin && rows.length ? '<section class="cb-earn"><div class="fm-history-heading"><b>' + (p.period === "annual" ? "연간" : "분기") + ' 실적 추이</b><span>막대 = 매출·영업이익(' + esc(u.unit) + ') · 선 = OPM(%) · 아래 숫자 = 매출 YoY · 빗금 = 컨센서스 추정</span></div><div class="cb-earn-chart" id="cb-earn"></div></section>' : "") +
      (hasFin && rows.length ? '<div class="fm-history-heading"><b>' + (p.period === "annual" ? "연간" : "분기") + " 실적</b><span>" + esc(finLabel(rows[0].date, p.period) + " – " + finLabel(rows[rows.length - 1].date, p.period)) + " · 단위 " + esc(u.unit) + '</span></div><div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>회계기간</th><th>매출</th><th>영업이익</th><th>OPM</th><th>매출 YoY</th><th>영업이익 YoY</th></tr></thead><tbody>' +
        rows.slice().reverse().map(function (r) { return "<tr" + (r.est ? ' class="cb-est-row"' : "") + "><td>" + esc(finLabel(r.date, p.period)) + (r.est ? ' <em class="cb-est">E</em>' : "") + "</td><td>" + fmt(r.revenue, "") + "</td><td>" + fmt(r.operating_income, "") + "</td><td>" + fmt(r.opm, "%") + "</td><td>" + fmt(r.revenue_yoy, "%") + "</td><td>" + (finite(r.operating_income_yoy) ? fmt(r.operating_income_yoy, "%") : esc(r.op_label || "—")) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
      '<p class="fm-sources">' + (kd
        ? "주가: 네이버 금융 일봉(" + esc(String(kd.checked_at || "—").slice(0, 16).replace("T", " ")) + " 수집) · 실적: DART 정기보고서(연결, 과거 분기) + 네이버 금융/FnGuide(최근 5분기·3년, E = 컨센서스) · 금융사는 매출 대신 영업수익이 표시되어 OPM 해석에 주의 · "
        : "주가: Yahoo Finance 일간 종가(" + esc((AI && AI.generated_at) || "—").slice(0, 16) + " 수집) · 실적: Yahoo Finance 재무제표(financials.json) · ") +
      "관련 지표: 데이터 허브 AI 지표 파일(각 지표의 출처는 목록에 표시) · 즐겨찾기·주요 지표 고정·직접 추가한 자료는 이 브라우저에 저장됩니다.</p>";
    bind(c); applyFilter(); drawChart(c); drawEarnings(c);
  }
  /* ── 실적 막대 차트: 매출·영업이익 막대 + OPM 선 + 매출 YoY 라벨 ── */
  function drawEarnings(c) {
    var box = document.getElementById("cb-earn"); if (!box) return;
    var p = cfg(c.ticker), u = finUnit(c);
    var rows = finRows(c, p.period).filter(function (r) { return finite(r.revenue) || finite(r.operating_income); }).slice(p.period === "annual" ? -8 : -13);
    if (!rows.length) { box.innerHTML = ""; return; }
    var width = Math.max(box.clientWidth, 280), narrow = width < 600, height = narrow ? 250 : 290;
    var left = narrow ? 40 : 54, right = narrow ? 34 : 44, top = 24, bottom = 44, pw = width - left - right, ph = height - top - bottom;
    var vals = []; rows.forEach(function (r) { [r.revenue, r.operating_income].forEach(function (v) { if (finite(v)) vals.push(v); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals)); hi += (hi - lo) * 0.08 || 1;
    var opms = rows.map(function (r) { return r.opm; }).filter(finite);
    var olo = opms.length ? Math.min(0, Math.min.apply(null, opms)) : 0, ohi = opms.length ? Math.max.apply(null, opms) : 10; ohi += (ohi - olo) * 0.15 || 1;
    var y = function (v) { return top + (hi - v) / (hi - lo) * ph; }, yo = function (v) { return top + (ohi - v) / (ohi - olo) * ph; };
    var slot = pw / rows.length, bw = Math.min(26, slot * 0.32);
    var compact = function (v) { var a = Math.abs(v); return a >= 1000 ? Math.round(v).toLocaleString("ko-KR") : a >= 10 ? Number(v.toFixed(1)).toString() : Number(v.toFixed(2)).toString(); };
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + esc(c.name) + ' 실적 추이: 매출과 영업이익 막대, OPM 선"><defs>' +
      '<pattern id="cb-hatch-r" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#55d6bc" fill-opacity=".18"/><line x1="0" y1="0" x2="0" y2="5" stroke="#55d6bc" stroke-width="2"/></pattern>' +
      '<pattern id="cb-hatch-o" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#c7a2ff" fill-opacity=".18"/><line x1="0" y1="0" x2="0" y2="5" stroke="#c7a2ff" stroke-width="2"/></pattern></defs>';
    for (var i = 0; i <= 4; i++) {
      var gv = hi - (hi - lo) * i / 4, gy = top + i / 4 * ph;
      svg += '<path d="M' + left + " " + gy + "H" + (left + pw) + '" stroke="#718db3" stroke-opacity=".13"/><text x="' + (left - 7) + '" y="' + (gy + 4) + '" text-anchor="end">' + compact(gv) + "</text>";
      svg += '<text x="' + (left + pw + 7) + '" y="' + (gy + 4) + '" text-anchor="start" fill="#ffbd76">' + (ohi - (ohi - olo) * i / 4).toFixed(0) + "%</text>";
    }
    svg += '<text x="' + (left - 7) + '" y="12" text-anchor="end">' + esc(u.unit) + '</text><text x="' + (left + pw + 7) + '" y="12" text-anchor="start" fill="#ffbd76">OPM</text>';
    if (lo < 0) svg += '<path d="M' + left + " " + y(0) + "H" + (left + pw) + '" stroke="#a2b9db" stroke-opacity=".45"/>';
    var line = [];
    rows.forEach(function (r, idx) {
      var cx = left + slot * (idx + 0.5), label = p.period === "annual" ? r.date.slice(0, 4) : r.date.slice(2, 4) + "." + r.date.slice(5, 7);
      [["revenue", -1, "#55d6bc", "r"], ["operating_income", 1, "#c7a2ff", "o"]].forEach(function (b) {
        var v = r[b[0]]; if (!finite(v)) return;
        var x0 = cx + (b[1] < 0 ? -bw - 1 : 1), y0 = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
        svg += '<rect class="cb-bar" x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (r.est ? "url(#cb-hatch-" + b[3] + ")" : b[2]) + '"' + (r.est ? ' stroke="' + b[2] + '" stroke-width="1"' : "") + "><title>" + esc(label + (r.est ? " (E)" : "") + " " + (b[0] === "revenue" ? "매출 " : "영업이익 ") + fmt(v, u.unit)) + "</title></rect>";
      });
      if (finite(r.opm)) line.push([cx, yo(r.opm), r]);
      svg += '<text x="' + cx.toFixed(1) + '" y="' + (height - bottom + 16) + '" text-anchor="middle"' + (r.est ? ' fill="#a8b7d0"' : "") + ">" + esc(label) + (r.est ? "E" : "") + "</text>";
      if (finite(r.revenue_yoy) && (!narrow || idx % 2 === rows.length % 2 - 1 || rows.length <= 8)) svg += '<text x="' + cx.toFixed(1) + '" y="' + (height - bottom + 32) + '" text-anchor="middle" fill="' + (r.revenue_yoy >= 0 ? "#f68a9a" : "#83aaff") + '">' + (r.revenue_yoy >= 0 ? "+" : "") + r.revenue_yoy.toFixed(0) + "%</text>";
    });
    if (line.length > 1) svg += '<path d="' + line.map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" ") + '" fill="none" stroke="#ffbd76" stroke-width="2" stroke-linejoin="round"/>';
    line.forEach(function (q, i) {
      svg += '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3" fill="' + (q[2].est ? "#101623" : "#ffbd76") + '" stroke="#ffbd76" stroke-width="1.4"><title>OPM ' + q[2].opm.toFixed(1) + "%</title></circle>";
      if (!narrow || i === line.length - 1) svg += '<text class="cb-opm-label" x="' + q[0].toFixed(1) + '" y="' + (q[1] - 8).toFixed(1) + '" text-anchor="middle">' + q[2].opm.toFixed(1) + "</text>";
    });
    svg += "</svg>";
    box.innerHTML = svg + '<div class="cb-earn-legend"><span><i style="background:#55d6bc"></i>매출</span><span><i style="background:#c7a2ff"></i>영업이익</span><span><i class="line" style="background:#ffbd76"></i>OPM</span><span class="cb-muted">하단 % = 매출 YoY</span></div>';
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
    document.getElementById("cb-refresh").onclick = function () { if (c.kr) delete KR[c.ticker]; load(true); };
    document.getElementById("cb-fav-hero").onclick = function () { toggleFav(c.ticker); };
    document.getElementById("cb-add-custom").onclick = function () { showAddDialog(c); };
    document.getElementById("cb-filter").oninput = applyFilter;
  }

  /* ── 차트 (파인엠텍 워크벤치와 같은 방식: 단위별 독립 축, 단위가 많으면 0–100 흐름 비교) ── */
  function drawChart(c) {
    var box = document.getElementById("cb-chart"); if (!box || host.hidden) return;
    var p = cfg(c.ticker), prices = pointsOf(c, "price");
    if (!prices.length) { box.innerHTML = '<div class="fm-chart-empty">주가 자료가 아직 없습니다.</div>'; return; }
    var start = C.rangeStart(prices, p.range === "ALL" ? "ALL" : p.range);
    if (p.range === "FIN") {
      // 최근 8개 분기(연간이면 5개 연도): 첫 회계기간이 시작하는 달부터
      var fa = finRows(c, p.period).filter(function (r) { return !r.est && (finite(r.revenue) || finite(r.operating_income)); }), n0 = p.period === "annual" ? 5 : 8;
      if (fa.length) { var f0 = new Date(C.timestamp(fa[Math.max(0, fa.length - n0)].date)); start = Date.UTC(f0.getUTCFullYear(), p.period === "annual" ? 0 : f0.getUTCMonth() - 2, 1); }
      else start = C.rangeStart(prices, "2Y");
    }
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
      get("data/finemtec.json").catch(function () { return null; }),
      get("data/kr_companies.json").catch(function () { return null; })
    ]).then(function (res) {
      if (res[0] && Array.isArray(res[0].companies) && res[0].companies.length) COMPANIES = res[0].companies.map(function (c) { return Object.assign({name: c.name || c.label}, c); });
      KRX = res[4];
      // 한국 기업 목록을 붙인다: 이미 있는 기업(SK하이닉스 등)은 한국 실적·주가 파일을 쓰도록 표시만 하고, 없는 기업은 새로 추가
      ((KRX && KRX.companies) || []).forEach(function (row) {
        var ex = COMPANIES.filter(function (c) { return c.ticker === row.code; })[0];
        if (ex) { if (!ex.module) ex.kr = row; return; }
        COMPANIES.push({ticker: row.code, name: row.name, label: row.name, market: "KR", desc: row.sector || "", kr: row, indicators: []});
      });
      if (res[1].schema_version !== 1) throw new Error("AI 지표 파일 형식 불일치");
      AI = res[1]; FINS = (res[2] && res[2].financials) || {}; FM = res[3];
      buildCatalog(); tailCache = {}; loaded = true; loadError = "";
      if (!COMPANIES.some(function (c) { return c.ticker === state.company; })) state.company = COMPANIES[0].ticker;
      renderAll(); if (manual) toast("서버에 저장된 최신 데이터를 불러왔어요.");
    }).catch(function (e) {
      loadError = "데이터 파일 수신 실패 (" + e.message + ")";
      if (loaded) { if (manual) toast("새 데이터를 받지 못했어요. 현재 표시된 데이터를 유지합니다."); renderAll(); }
      else renderAll();
    });
  }
  window.addEventListener("resize", function () { cancelAnimationFrame(renderId); renderId = requestAnimationFrame(function () { if (loaded && !host.hidden) { drawChart(company()); drawEarnings(company()); } }); });
  document.addEventListener("vantage-view", function (e) { if (e.detail && e.detail.view === "company" && loaded) renderAll(); });
  if (!state.company) state.company = FALLBACK[0].ticker;
  renderAll();
  load(false);
})();
