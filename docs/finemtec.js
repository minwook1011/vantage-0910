(function () {
  "use strict";
  const C = window.FineMtecCore, M = C.METRICS;
  const KEY = "vantage-finemtec-workbench-v1", CUSTOM_KEY = "vantage-finemtec-custom-series-v1";
  const host = document.getElementById("finemtec-workspace");
  if (!host) return;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const safeURL = value => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch (_) { return ""; } };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  let saved = read(KEY, {});
  if (!saved || typeof saved !== "object") saved = {};
  const upgradeQuarterlyView = saved.windowVersion !== 3;
  const savedSelection = Array.isArray(saved.selected) ? saved.selected.filter(id => typeof id === "string") : ["revenue", "operating_income"];
  const state = {
    selected: upgradeQuarterlyView ? [...new Set([...savedSelection, "revenue_yoy", "opm"])] : savedSelection,
    range: !upgradeQuarterlyView && ["FINANCIAL", "6M", "YTD", "1Y", "2Y", "ALL"].includes(saved.range) ? saved.range : "FINANCIAL",
    period: !upgradeQuarterlyView && saved.period === "annual" ? "annual" : "quarterly",
    mode: saved.mode === "normalized" ? "normalized" : "units",
    windowVersion: 3
  };
  let customs = read(CUSTOM_KEY, []);
  customs = Array.isArray(customs) ? customs.filter(s => s && typeof s.id === "string" && s.id.startsWith("custom-") && typeof s.label === "string" && typeof s.unit === "string" && Array.isArray(s.points) && s.points.every(p => p && C.validDate(p.date) && C.finite(p.value))).slice(0, 20) : [];
  let data = null, active = false, renderId = 0, loading = false, external = [];
  const meta = id => M[id] || customs.find(s => s.id === id) || external.find(s => s.id === id);
  const color = id => meta(id)?.color || "#c9d7ea";
  const points = id => external.find(s => s.id === id)?.points || C.seriesFor(id, data || {}, state.period, customs);
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };
  function toast(message) {
    document.querySelector(".fm-toast")?.remove();
    const el = document.createElement("div"); el.className = "fm-toast"; el.setAttribute("role", "status"); el.textContent = message;
    document.body.appendChild(el); setTimeout(() => el.remove(), 4000);
  }
  function quarterLabel(date) { return state.period === "annual" ? date.slice(0, 4) + "년" : date.slice(0, 4) + " Q" + Math.ceil(Number(date.slice(5, 7)) / 3); }
  function metricRows(group) {
    const tradeRepresentatives = new Set(["trade_value", "trade_quantity"]);
    const ids = Object.keys(M).filter(id => M[id].group === group && (group !== "trade" || tradeRepresentatives.has(id)));
    if (group === "financial") ids.push(...customs.map(s => s.id));
    if (group === "external") ids.push(...external.map(s => s.id));
    return ids.map(id => {
      const m = meta(id), rows = points(id), good = rows.filter(p => C.finite(p.value)), latest = rows[rows.length - 1];
      const unavailable = !good.length;
      const title = unavailable ? (group === "external" ? (m.status === "permission_required" ? "이용 허용 대기" : "원본 연결 대기") : group === "trade" ? "원본 미연결" : latest?.label || "비교 자료 없음") : C.format(latest?.value, m.unit);
      const note = group === "external" ? (latest?.date || "관측값 미수신") + " · " + m.source : id.startsWith("custom-") ? "직접 추가 · 이 브라우저에 저장" : group === "trade" ? "확인된 백플레이트 · 거래별 원본 기준" : (latest ? quarterLabel(latest.date) : "확정 실적") + (id.includes("yoy") ? " · 전년 동기 비교" : " · 연결 실적");
      return `<div class="fm-metric${unavailable ? " unavailable" : ""}"><label style="display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:inherit"><input type="checkbox" data-metric="${esc(id)}" ${state.selected.includes(id) ? "checked" : ""} ${unavailable ? "disabled" : ""}><i class="fm-metric-color" style="--series-color:${esc(m.color)}"></i><span class="fm-metric-info">${esc(m.label)}<small>${esc(note)}${M[id]?.group === "financial" ? ` · ${good.length}개 ${state.period === "annual" ? "연도" : "분기"}` : ""}</small></span><span class="fm-metric-value">${esc(title)}</span></label>${id.startsWith("custom-") ? `<button class="fm-remove-custom" data-delete-custom="${esc(id)}" aria-label="${esc(m.label)} 삭제">×</button>` : ""}</div>`;
    }).join("");
  }
  function currentRows() { return C.financialWindow(data || {}, state.period); }
  function windowLabel() { return state.period === "annual" ? "최근 5년" : "최근 8개 분기"; }
  function table() {
    const rows = currentRows(), available = rows.filter(r => !r.missing).length;
    return `<div class="fm-history-heading"><b>${windowLabel()} · 연결 실적</b><span>${rows.length ? quarterLabel(rows[0].date) + " – " + quarterLabel(rows.at(-1).date) : "수신 대기"} · 실적 ${available}/${rows.length}</span></div>${state.period === "annual" ? '<p class="fm-period-note">2021년은 파인엠텍 설립 전이므로 해당 없음입니다. 2022년은 분할 설립 후 단기 실적으로, 2023년의 전년 대비 성장률은 비교하지 않습니다.</p>' : ''}<div class="fm-table-wrap"><table class="fm-table"><thead><tr><th>회계기간 · 연결</th><th>매출 (억원)</th><th>영업이익 (억원)</th><th>OPM</th><th>매출 YoY</th><th>영업이익 YoY</th></tr></thead><tbody>${rows.slice().reverse().map(r => `<tr${r.missing ? ' class="fm-missing-row"' : ''}><td>${safeURL(r.source_url) ? `<a href="${esc(safeURL(r.source_url))}" target="_blank" rel="noopener" aria-label="${quarterLabel(r.date)} 실적 출처">${quarterLabel(r.date)} ↗</a>` : quarterLabel(r.date)}${r.period_note ? `<small>${esc(r.period_note)}</small>` : ''}</td><td>${C.format(r.revenue, "").trim()}</td><td>${C.format(r.operating_income, "").trim()}</td><td>${C.format(r.opm, "%")}</td><td>${C.format(r.revenue_yoy, "%")}</td><td>${C.finite(r.operating_income_yoy) ? C.format(r.operating_income_yoy, "%") : esc(r.profit_growth_label || "—")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function render() {
    if (!active || !data) return;
    const opened = ["financial", "trade", "external"].filter(id => document.getElementById("fm-select-" + id)?.open);
    const row = currentRows().at(-1) || {}, quotes = data.price?.points || [], last = quotes.at(-1), prior = quotes.at(-2);
    const change = last && prior ? (last.value / prior.value - 1) * 100 : null;
    const financialCount = state.selected.filter(id => meta(id)?.group === "financial").length;
    const tradeCount = state.selected.filter(id => meta(id)?.group === "trade").length;
    const tradeReady = ["ready", "stale"].includes(data.trade?.status) && Object.values(data.trade?.series || {}).some(list => list.some(p => C.finite(p.value)));
    const tradeStale = data.trade?.status === "stale";
    const financialDate = row.date ? quarterLabel(row.date) : "실적 수신 대기";
    host.innerHTML = `
      <article class="fm-hero">
        <div class="fm-heading"><div><div class="fm-eyebrow">FOLDABLE SUPPLY CHAIN</div><h3>파인엠텍<small>441270 · KOSDAQ</small></h3></div><div class="fm-quote"><strong>${last ? C.format(last.value, "원", 0) : "시세 대기"}</strong><span${C.finite(change) ? ` style="color:${change >= 0 ? "#f68a9a" : "#83aaff"}"` : ""}>${C.finite(change) ? (change >= 0 ? "+" : "") + change.toFixed(2) + "% · 전 거래일 대비" : "일별 종가"}</span></div></div>
        <div class="fm-head-tools"><span class="fm-status"><i></i>${esc(data.price?.as_of || "—")} ${data.price?.is_intraday ? "일봉 · 장중 값" : "종가"}${data.price?.status === "stale" ? " · 갱신 지연" : ""}</span><span class="fm-divider"></span><span class="fm-status ${tradeReady && !tradeStale ? "" : "pending"}"><i></i>베트남 납품 ${tradeStale ? "갱신 지연 · 마지막 값 유지" : tradeReady ? "연결됨" : "자료 미확보 · 수집 미시작"}</span><button type="button" id="fm-refresh">새 데이터 확인 ↻</button></div>
        <div class="fm-toolbar"><div class="fm-segment" aria-label="차트 기간">${["FINANCIAL","6M","YTD","1Y","2Y","ALL"].map(v => `<button type="button" data-range="${v}" class="${state.range === v ? "on" : ""}" aria-pressed="${state.range === v}">${v === "FINANCIAL" ? windowLabel() : v === "ALL" ? "주가 전체" : v}</button>`).join("")}</div><label class="fm-view-options">비교 방식<select id="fm-mode"><option value="units" ${state.mode === "units" ? "selected" : ""}>실제 단위</option><option value="normalized" ${state.mode === "normalized" ? "selected" : ""}>흐름 비교 · 0–100</option></select></label></div>
        <div class="fm-chart" id="fm-chart" aria-label="파인엠텍 주가와 선택 지표 비교"><div class="fm-chart-empty">차트를 불러오는 중입니다.</div></div>
        <div class="fm-legend" id="fm-legend"></div><p class="fm-note" id="fm-axis-note"></p>
        <p class="fm-note">실적은 회계기간 말에 표시됩니다. 해당 날짜에 이미 공시됐다는 뜻은 아닙니다. 선행성은 자료의 실제 공개일을 확인한 뒤 판단하세요.</p>
      </article>
      <div class="fm-selectors">
        <details class="fm-selector" id="fm-select-financial" ${opened.includes("financial") ? "open" : ""}><summary><div><b>실적 지표 추가</b><small>매출 · 영업이익 · OPM · 성장률${financialCount ? " / " + financialCount + "개 표시 중" : ""}</small></div><svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></summary><div class="fm-options"><div class="fm-options-head"><span>여러 지표를 함께 선택할 수 있어요</span><select id="fm-period" aria-label="실적 기간"><option value="quarterly" ${state.period === "quarterly" ? "selected" : ""}>분기 · 최근 8개</option><option value="annual" ${state.period === "annual" ? "selected" : ""}>연간 · 최근 5년</option></select></div>${metricRows("financial")}<button class="fm-add" id="fm-add-custom" type="button">＋ 내 데이터 직접 추가</button></div></details>
        <details class="fm-selector" id="fm-select-trade" ${opened.includes("trade") ? "open" : ""}><summary><div><b>외부 데이터 추가</b><small>베트남 납품 대표 지표 · 메모리 · 한국 수출${tradeCount ? " / " + tradeCount + "개 표시 중" : ""}</small></div><svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></summary><div class="fm-options"><div class="fm-availability"><b>${tradeStale ? "갱신 지연 · 마지막 성공 자료" : tradeReady ? "확인된 거래를 월별로 집계" : "베트남 납품 자료 미확보 · 아직 수집되지 않았습니다"}</b><p>${tradeReady ? esc(data.trade.message || "") + " 기준 " + esc(data.trade.as_of || "—") + " · 확인 " + data.trade.records_count + "건" : "현재는 선택 화면과 집계 구조만 준비된 상태입니다. 거래별 원본 공급처가 연결되지 않아 자동 수집이 시작되지 않았습니다. 실제 거래 상대·백플레이트 품목·수록 범위를 확인한 자료가 필요하며, 빈 지표는 납품이 0이라는 뜻이 아닙니다."}</p></div>${metricRows("trade")}<p class="fm-note">대표 지표는 납품 금액과 수량입니다. 중량·ASP·성장률·거래 건수는 원자료 연결 후 필요할 때 추가할 수 있습니다. 애플향은 고객·모델 연결 근거가 있는 거래에만 붙일 수 있습니다. 삼성디스플레이 납품 전체가 애플향은 아닙니다.</p><details class="fm-method"><summary>메모리 가격 · 한국 수출 지표 ▾</summary><p class="fm-note">별도 산업 지표이며 파인엠텍 납품의 직접 근거는 아닙니다.</p>${metricRows("external")}</details></div></details>
      </div>
      <div class="fm-kpis">${[["매출",C.format(row.revenue,"억원")],["영업이익",C.format(row.operating_income,"억원")],["OPM",C.format(row.opm,"%")],["매출 성장률",C.format(row.revenue_yoy,"%")],["영업이익 성장률",C.finite(row.operating_income_yoy) ? C.format(row.operating_income_yoy,"%") : row.profit_growth_label || "—"]].map(([label,value]) => `<div class="fm-kpi"><span>${label}</span><strong>${esc(value)}</strong><small>${financialDate}${label.includes("성장") ? " · YoY" : " · 연결"}</small></div>`).join("")}</div>
      <details class="fm-insight fm-logic"><summary><span>이 데이터를 보는 이유 · 파인엠텍</span><svg class="fm-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></summary><div class="fm-logic-body"><p>파인엠텍의 베트남 생산법인에서 실제 납품한 부품을 월별로 모으면, 실적 발표 전에 출하 흐름을 관찰할 수 있습니다. 금액과 수량을 매출에, 제품 구성과 단가 변화를 영업이익·OPM에 나란히 대조합니다.</p>
        <div class="fm-flow"><span>FINE MS VINA<small>회사 IR에 백플레이트 생산 명시</small></span><i>→</i><span>삼성디스플레이 베트남<small>실제 거래 상대·품목 확인 필요</small></span><i>→</i><span>분기 실적과 비교<small>공개 시차 · 누락 · 내부거래 점검</small></span></div>
        <p id="fm-result">${row.date ? `${financialDate} 매출은 ${C.format(row.revenue,"억원")}, 영업이익은 ${C.format(row.operating_income,"억원")}, OPM은 ${C.format(row.opm,"%")}입니다. ` : ""}${tradeReady ? "납품 시계열을 선택해 실적과 비교할 수 있습니다. 같은 방향으로 움직였다는 사실만으로 인과관계가 확인되지는 않습니다." : "현재 통관 원본이 없어 납품 증가나 애플향 수혜 여부는 아직 판단할 수 없습니다."}</p>
        <details class="fm-method"><summary>계산 기준 · 해석할 때 확인할 것 ▾</summary><p>OPM = 영업이익 ÷ 매출 × 100. 성장률은 전년의 같은 분기·연간과 비교합니다. 영업손익의 부호가 바뀌거나 전년 적자인 경우에는 흑자전환·적자전환·적자축소·적자확대로 표시합니다. 최근 8개 분기 또는 5년을 표시하며, 성장률 계산에는 표시 범위 이전의 실적도 사용합니다. 과거 실적은 DART 공시로 보강했고, 최신 실적은 Naver Finance / FnGuide에서 갱신합니다. 원천 자료의 반올림 차이로 비율에 미세한 차이가 생길 수 있습니다. 4분기는 연간 누적에서 9개월 누적을 빼서 계산합니다.</p><p>수량과 금액이 함께 늘면 납품 확대를 살펴보고, 수량 대비 금액이 늘면 가격·제품 구성을 확인합니다. 영업이익과 OPM에는 가동률·수율·개발비도 영향을 줍니다. kg당 금액은 개당 판매가격이 아니며, 서로 다른 부품의 평균 단가는 제품 구성 변화만으로도 움직입니다.</p><p>통관 자료는 신고번호·품목 행 기준 중복을 제거하고, 원재료·샘플·반품·내부거래를 제외합니다. 누락된 중량·수량은 0으로 채우지 않습니다. 통관금액과 연결 매출은 인식 시점과 범위가 다르므로 과거 실적과 대조해야 합니다.</p><p>베트남 내 수출가공기업 간 거래도 통관 신고 대상이 될 수 있습니다. 실제 양사 거래가 데이터 공급자의 자료에 포함되는지, 공시 전에 제공되는지는 별도 확인이 필요합니다. <a href="https://chinhsachonline.chinhphu.vn/giao-dich-giua-hai-doanh-nghiep-che-xuat-co-phai-lam-thu-tuc-hai-quan-84938.htm" target="_blank" rel="noopener">베트남 정부 안내 ↗</a></p><p><a href="https://api.butler.works/api/ir-materials/01686755/events/2Q25_FINEMTEC_IR.pdf" target="_blank" rel="noopener">파인엠텍 2025년 IR ↗</a> · <a href="https://www.finemtec.com/product/product01" target="_blank" rel="noopener">백플레이트 제품 설명 ↗</a> · <a href="https://w3.importgenius.com/how-it-works/our-datasets/vietnam" target="_blank" rel="noopener">거래별 데이터 제공 항목 ↗</a></p></details>
      </div></details>
      ${table()}<p class="fm-sources">주가: ${esc(data.price?.source || "수신 대기")} · <a href="https://stock.naver.com/domestic/stock/441270/finance" target="_blank" rel="noopener">최신 실적: Naver Finance / FnGuide</a> · 과거: DART 공시(각 기간의 출처 링크) · 확정 실적만 표시 · 주가·실적 자동 수집: 24시간 10분 간격 예약(실행·배포 지연 가능). ${data.refresh_errors?.length ? "일부 데이터 갱신 지연 · 마지막 성공 값을 유지합니다." : ""}</p>`;
    const selectorBox = host.querySelector(".fm-selectors");
    const hero = host.querySelector(".fm-hero");
    if (selectorBox && hero) hero.insertBefore(selectorBox, hero.querySelector(".fm-toolbar"));
    const tradeSelector = host.querySelector("#fm-select-trade");
    const tradeHeading = tradeSelector?.querySelector("summary b");
    const tradeSubheading = tradeSelector?.querySelector("summary small");
    if (tradeHeading) tradeHeading.textContent = "기업 연관 데이터 추가";
    if (tradeSubheading) tradeSubheading.textContent = "베트남 납품 대표 지표" + (tradeCount ? " / " + tradeCount + "개 표시 중" : "");
    const externalSelector = tradeSelector?.querySelector(".fm-method");
    if (externalSelector && selectorBox) {
      externalSelector.id = "fm-select-external";
      externalSelector.classList.add("fm-selector");
      const summary = externalSelector.querySelector("summary");
      if (summary) summary.textContent = "참고 지표 · 메모리 가격 · 한국 수출 ▾";
      externalSelector.open = opened.includes("external");
      selectorBox.appendChild(externalSelector);
    }
    bind(); drawChart();
    const status = document.getElementById("workbench-status");
    if (status) status.textContent = "파인엠텍 · 주가 / 실적 / 납품 비교";
  }
  function bind() {
    host.querySelectorAll("[data-range]").forEach(btn => btn.onclick = () => { state.range = btn.dataset.range; store(); render(); });
    host.querySelectorAll("[data-metric]").forEach(input => input.onchange = () => {
      state.selected = state.selected.filter(id => id !== input.dataset.metric);
      if (input.checked) {
        state.selected.push(input.dataset.metric);
        if (M[input.dataset.metric]?.group === "financial") state.range = "FINANCIAL";
      }
      store(); render();
    });
    host.querySelectorAll("[data-delete-custom]").forEach(btn => btn.onclick = () => {
      const id = btn.dataset.deleteCustom, next = customs.filter(s => s.id !== id);
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (_) { toast("저장 공간을 확인해 주세요."); return; }
      customs = next; state.selected = state.selected.filter(v => v !== id); store(); render(); toast("직접 추가한 지표를 삭제했어요.");
    });
    document.getElementById("fm-mode").onchange = event => { state.mode = event.target.value; store(); drawChart(); };
    document.getElementById("fm-period").onchange = event => { state.period = event.target.value; state.range = "FINANCIAL"; store(); render(); };
    document.getElementById("fm-refresh").onclick = () => load(true);
    document.getElementById("fm-add-custom").onclick = showAddDialog;
  }
  function drawChart() {
    if (!active || !data) return;
    const box = document.getElementById("fm-chart");
    if (!box) return;
    const pricePoints = points("price");
    const allDates = pricePoints.length ? pricePoints : currentRows().map(r => ({date:r.date}));
    if (!allDates.length) { box.innerHTML = '<div class="fm-chart-empty">아직 표시할 데이터가 없습니다.</div>'; return; }
    const start = state.range === "FINANCIAL" && currentRows().length ? C.financialRangeStart(currentRows(), state.period) : C.rangeStart(allDates, state.range);
    const end = Math.max(C.timestamp(allDates.at(-1).date), C.timestamp(currentRows().at(-1)?.date || allDates.at(-1).date));
    let series = ["price", ...state.selected.filter(id => id !== "price" && meta(id))].map(id => ({id, ...meta(id), points: points(id).filter(p => C.timestamp(p.date) >= start && C.timestamp(p.date) <= end)}));
    series = series.filter(s => s.points.some(p => C.finite(p.value)));
    const rawUnits = [...new Set(series.map(s => s.unit))];
    const narrow = box.clientWidth < 600;
    const effectiveNormalized = state.mode === "normalized" || rawUnits.length > (narrow ? 2 : 3);
    const width = Math.max(box.clientWidth, 280), height = narrow ? 330 : 390;
    const units = effectiveNormalized ? ["0–100"] : rawUnits;
    const left = narrow ? 42 : 58, right = effectiveNormalized ? 14 : Math.max(14, (units.length - 1) * (narrow ? 52 : 64));
    const top = 29, bottom = 32, plotWidth = width - left - right, plotHeight = height - top - bottom;
    const plotSeries = effectiveNormalized ? series.map(s => ({...s, points: C.normalize(s.points)})) : series;
    const scales = {};
    units.forEach(unit => { scales[unit] = effectiveNormalized ? [-5,105] : C.domain(plotSeries.filter(s => s.unit === unit).flatMap(s => s.points.map(p => p.value)), unit !== "원"); });
    const x = date => left + (C.timestamp(date) - start) / Math.max(end - start, 86400000) * plotWidth;
    const y = (value, unit) => { const d = scales[effectiveNormalized ? "0–100" : unit]; return top + (d[1] - value) / (d[1] - d[0]) * plotHeight; };
    const compact = value => Math.abs(value) >= 1e6 ? (value/1e6).toFixed(1)+"M" : Math.abs(value) >= 10000 ? (value/1e4).toFixed(1)+"만" : Math.abs(value) >= 1000 ? Math.round(value).toLocaleString("ko-KR") : Number(value.toFixed(1)).toString();
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map(s => s.label).join(', '))} 비교 시계열"><defs><linearGradient id="fm-price-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#769fff" stop-opacity=".14"/><stop offset="1" stop-color="#769fff" stop-opacity="0"/></linearGradient><clipPath id="fm-clip"><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"/></clipPath></defs>`;
    for (let i=0;i<=4;i++) {
      const yy = top + i / 4 * plotHeight;
      svg += `<path d="M${left} ${yy}H${left+plotWidth}" stroke="#718db3" stroke-opacity=".13"/>`;
    }
    units.forEach((unit,index) => {
      const d = scales[unit], xx = index === 0 ? left-9 : left+plotWidth+8+(index-1)*(narrow?52:64), anchor=index===0?"end":"start";
      svg += `<text x="${xx}" y="14" text-anchor="${anchor}">${esc(unit)}</text>`;
      for (let i=0;i<=4;i++) svg += `<text x="${xx}" y="${top+i/4*plotHeight+4}" text-anchor="${anchor}">${compact(d[1] - (d[1]-d[0])*i/4)}</text>`;
    });
    for (let i=0;i<=(narrow?3:5);i++) {
      const n=narrow?3:5, time=start+(end-start)*i/n, day=new Date(time).toISOString().slice(0,7);
      svg += `<text x="${left+plotWidth*i/n}" y="${height-8}" text-anchor="${i===0?'start':i===n?'end':'middle'}">${day.replace('-','.')}</text>`;
    }
    svg += '<g clip-path="url(#fm-clip)">';
    plotSeries.forEach(s => {
      const {path, vertices:good} = C.lineGeometry(s.points, x, value => y(value, s.unit));
      if (!good.length) return;
      if (s.id === "price" && good.length > 1) svg += `<path d="${path}L${good.at(-1)[0]} ${height-bottom}L${good[0][0]} ${height-bottom}Z" fill="url(#fm-price-fill)"/>`;
      if (!effectiveNormalized && scales[s.unit][0] < 0 && scales[s.unit][1] > 0 && s.id !== "price") svg += `<path d="M${left} ${y(0,s.unit)}H${left+plotWidth}" stroke="${s.color}" stroke-opacity=".13" stroke-dasharray="3 5"/>`;
      svg += `<path data-series="${esc(s.id)}" data-point-count="${good.length}" class="fm-series-path ${s.id==='price'?'fm-price-path':''}" ${s.id==='price'?'pathLength="1"':''} d="${path}" fill="none" stroke="${s.color}" stroke-width="${M[s.id]?.group==='financial'?2.6:s.id==='price'?2:1.9}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (s.id !== "price") good.forEach(([xx,yy]) => { svg += `<circle cx="${xx}" cy="${yy}" r="2.5" fill="${s.color}" stroke="#ffffff" stroke-width="1"/>`; });
    });
    svg += `</g><line id="fm-crosshair" x1="0" y1="${top}" x2="0" y2="${height-bottom}" stroke="#a2b9db" stroke-opacity=".4" stroke-dasharray="4 4" visibility="hidden"/><rect id="fm-hit" x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}" fill="transparent" tabindex="0" role="slider" aria-label="차트 날짜 탐색, 좌우 화살표" aria-valuemin="0" aria-valuemax="${Math.max(0, pricePoints.length-1)}" aria-valuenow="0"/></svg><div class="fm-tooltip" id="fm-tooltip" hidden></div>`;
    box.innerHTML=svg;
    document.getElementById("fm-axis-note").textContent = effectiveNormalized ? "흐름 비교: 선택한 기간에서 각 지표의 최솟값을 0, 최댓값을 100으로 맞춥니다. 수익률이 아니며, 원래 값은 차트 위에 마우스를 올리면 보입니다." + (state.mode!=="normalized" ? " 단위가 많아 흐름 비교를 적용했습니다." : "") : "주가(원)와 선택 지표는 단위별 독립 축을 사용합니다. 선의 높이를 금액 크기로 직접 비교하지 마세요. 점은 실제 관측값이며 점 사이 선은 시각적 연결입니다.";
    document.getElementById("fm-legend").innerHTML=series.map(s => `<button type="button" data-remove-series="${esc(s.id)}" ${s.id==='price'?'disabled':''} title="${s.id==='price'?'기본 주가':'차트에서 빼기'}"><i style="--series-color:${esc(s.color)}"></i>${esc(s.label)}<small>${s.id==='price'?'기본':M[s.id]?.group==='financial'?s.points.filter(p=>C.finite(p.value)).length+'개 '+(state.period==='annual'?'연도':'분기')+' · ×':'×'}</small></button>`).join("");
    host.querySelectorAll("[data-remove-series]").forEach(btn => btn.onclick=()=>{state.selected=state.selected.filter(id=>id!==btn.dataset.removeSeries);store();render();});
    const hit=document.getElementById("fm-hit"), tip=document.getElementById("fm-tooltip"), cross=document.getElementById("fm-crosshair");
    function showAt(pos) {
      const xx=Math.min(left+plotWidth,Math.max(left,pos)), t=start+(xx-left)/plotWidth*(end-start);
      cross.setAttribute("x1",xx);cross.setAttribute("x2",xx);cross.setAttribute("visibility","visible");
      tip.innerHTML=`<b>${new Date(t).toISOString().slice(0,10)} · 가까운 관측값</b>`+series.map(s=>{
        const p=C.nearest(s.points,t);
        return `<div class="fm-tip-row"><i class="fm-metric-color" style="--series-color:${esc(s.color)}"></i><span>${esc(s.label)}<small>${esc(p?.date||'')}${s.group==='financial'?' 회계기간 말':''}${p?.coverage==='partial'?' · 일부 수록':p?.coverage==='unknown'?' · 수록 범위 미확인':p?.coverage==='complete'?' · 전체 수록 확인':''}</small></span><strong>${p?.label && !C.finite(p.value)?esc(p.label):C.format(p?.value,s.unit)}</strong></div>`;
      }).join("");
      tip.hidden=false;tip.style.left=Math.max(2,Math.min(xx+15,width-Math.min(290,width*.88)-4))+"px";tip.style.top="39px";
    }
    hit.onpointermove=event=>showAt(event.clientX-box.getBoundingClientRect().left);
    hit.onpointerleave=()=>{tip.hidden=true;cross.setAttribute("visibility","hidden");};
    let keyPosition=left;
    hit.onkeydown=event=>{if(!["ArrowLeft","ArrowRight","Escape"].includes(event.key))return;event.preventDefault();if(event.key==="Escape"){hit.onpointerleave();return;} keyPosition=Math.max(left,Math.min(left+plotWidth,keyPosition+(event.key==="ArrowRight"?1:-1)*plotWidth/50));hit.setAttribute("aria-valuenow",Math.round((keyPosition-left)/plotWidth*Math.max(0,pricePoints.length-1)));showAt(keyPosition);};
  }
  function showAddDialog() {
    document.getElementById("fm-add-dialog")?.remove();
    const dialog=document.createElement("dialog");dialog.className="fm-dialog";dialog.id="fm-add-dialog";
    dialog.innerHTML=`<form id="fm-custom-form"><h3>파인엠텍과 비교할 데이터 추가</h3><p>추가한 자료는 이 브라우저에 저장됩니다. 날짜와 값은 한 줄에 하나씩 입력해 주세요.</p><label>지표 이름<input name="name" required maxlength="60" placeholder="예: 내가 확인한 월별 출하량"></label><label>단위<select name="unit"><option>개</option><option>kg</option><option>USD</option><option>억원</option><option>원</option><option>%</option><option>지수</option></select></label><label>출처 링크 (선택)<input name="source" type="url" placeholder="https://..."></label><label>날짜, 값<textarea name="points" required spellcheck="false" placeholder="2026-01-31,120\n2026-02-28,135\n2026-03-31,148"></textarea></label><span class="fm-error" id="fm-form-error" role="alert"></span><div class="fm-dialog-actions"><button type="button" id="fm-cancel-add">취소</button><button type="submit">차트에 추가</button></div></form>`;
    document.body.appendChild(dialog);dialog.showModal();
    document.getElementById("fm-cancel-add").onclick=()=>dialog.close();
    document.getElementById("fm-custom-form").onsubmit=event=>{
      event.preventDefault();const form=new FormData(event.target);
      try {
        if(customs.length>=20)throw new Error("직접 추가 지표는 20개까지 저장할 수 있어요.");
        const name=String(form.get("name")).trim();if(!name)throw new Error("지표 이름을 입력해 주세요.");
        const values=C.parsePoints(String(form.get("points"))), source=safeURL(String(form.get("source")));
        if(form.get("source")&&!source)throw new Error("http 또는 https 출처 링크를 입력해 주세요.");
        const added={id:"custom-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),label:name,unit:form.get("unit"),source_url:source,points:values,group:"financial",color:["#bcd875","#dda1c7","#8ed4d0","#e5aa79"][customs.length%4]};
        const next=[...customs,added];localStorage.setItem(CUSTOM_KEY,JSON.stringify(next));customs=next;state.selected.push(added.id);store();dialog.close();render();toast("새 지표를 차트에 추가했어요. 이 브라우저에 저장됩니다.");
      } catch(error) { document.getElementById("fm-form-error").textContent=error.name==="QuotaExceededError"?"브라우저 저장 공간이 부족해요.":error.message; }
    };
    dialog.onclose=()=>dialog.remove();
  }
  async function load(manual) {
    if(loading)return;loading=true;
    const button=document.getElementById("fm-refresh");if(button){button.disabled=true;button.textContent="확인 중…";}
    try {
      const response=await fetch("data/finemtec.json",{cache:"no-cache"});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const next=await response.json();
      if(next.schema_version!==1||next.company?.ticker!=="441270")throw new Error("데이터 형식 불일치");
      data=next;render();if(manual)toast("서버에 저장된 최신 데이터를 불러왔어요. 외부 원본은 24시간 10분 간격으로 확인하도록 예약되어 있어요. 실행 지연은 발생할 수 있습니다.");
    } catch(error) {
      if(data){render();if(manual)toast("새 데이터를 받지 못했어요. 현재 표시된 데이터를 유지합니다.");}
      else if(active)host.innerHTML='<div class="fm-chart-empty"><b>파인엠텍 데이터를 불러오지 못했어요.</b><p>연결을 확인한 뒤 다시 시도해 주세요.</p><button id="fm-retry" class="fm-add" type="button">다시 불러오기</button></div>';
      const retry=document.getElementById("fm-retry");if(retry)retry.onclick=()=>load(false);
    } finally {loading=false;}
  }
  document.addEventListener("vantage-company-change",event=>{
    active=event.detail.company==="파인엠텍";host.hidden=!active;host.closest(".workbench").classList.toggle("is-finemtec",active);
    if(active){if(data)render();else{host.innerHTML='<div class="fm-chart-empty">파인엠텍 주가·실적을 불러오는 중입니다.</div>';load(false);}}
  });
  document.addEventListener("vantage-external-data",event=>{external=event.detail.series || [];if(active && data)render();});
  document.addEventListener("vantage-external-select",event=>{
    const id=event.detail.id;
    if(!external.find(s=>s.id===id)?.points.some(p=>C.finite(p.value)))return;
    if(!state.selected.includes(id))state.selected.push(id);store();render();
  });
  window.addEventListener("resize",()=>{cancelAnimationFrame(renderId);renderId=requestAnimationFrame(drawChart);});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&active)load(false);});
})();
