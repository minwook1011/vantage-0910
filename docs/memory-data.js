(function () {
  "use strict";
  const host = document.getElementById("memory-workspace"), C = window.FineMtecCore;
  if (!host || !C) return;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const safeURL = v => { try { const u = new URL(v); return u.protocol === "https:" ? u.href : ""; } catch (_) { return ""; } };
  const GROUPS = {dram_spot:"DRAM 칩 · 현물", module_spot:"DRAM 모듈 · 현물", nand_spot:"NAND · 현물", contract:"계약가격", memory_exports:"한국 수출"};
  // The export feed keeps value and weight for auditability, but the UI presents
  // one representative benchmark so this page remains a quick signal board.
  const EXPORT_REPRESENTATIVE = "kr_dram_export_value";
  const COLORS = ["#7da8ff", "#63d5bc", "#c5a2ef", "#f1b87a", "#85cbdc"];
  let datasets = [], group = "dram_spot", selected = null, search = "", loading = false, errors = [];
  const visiblePoints = s => s?.display_prices === false || s?.status === "permission_required" ? [] : (s?.points || []).filter(p => p && C.validDate(p.date) && (p.value === null || C.finite(p.value)));
  const status = s => ({permission_required:"이용 허용 확인 대기", needs_api_key:"API 연결키 대기", stale:"갱신 실패 · 이전 값", unavailable:"수신 대기", source_delayed:"원문 기준일 지연", ready:"관측값 연결", ok:"관측값 연결"}[s?.status] || "연결 대기");
  function dateTime(value) {
    if (!value) return "원출처 발표 시각 미제공";
    const date = new Date(value);
    return Number.isNaN(+date) ? "기준 시각 확인 필요" : new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(date) + " KST";
  }
  function availableSeries() { return datasets.map((s,i) => ({...s, group:"external", color:COLORS[i % COLORS.length], points:visiblePoints(s)})); }
  function rows() { return datasets.filter(s => (s.group || s.category) === group && (group !== "memory_exports" || s.id === EXPORT_REPRESENTATIVE) && (s.label + " " + (s.hs_code || "")).toLowerCase().includes(search.toLowerCase())); }
  function logic(s) {
    const explanations = {
      dram_spot: [
        ["왜 넣었나", "DRAM 칩 현물가격은 유통시장에서 당장 거래되는 물량의 수급을 살펴보는 지표입니다. 세대·용량·속도가 같은 제품끼리 가격 방향을 추적하려고 넣었습니다."],
        ["어떻게 비교하나", "현물가격 상승이 여러 규격으로 확산되는지, 이후 계약가격과 한국 DRAM 수출금액도 같은 방향인지 봅니다. 기업 매출·OPM과 비교할 때는 발표 시차와 제품 구성을 함께 확인합니다."],
        ["무엇을 뜻하지 않나", "현물가격은 계약가격도, 삼성전자·SK하이닉스의 실제 평균판매가격도 아닙니다. 일부 유통시장 가격만 올라갈 수 있고 DDR4·DDR5·HBM을 같은 시장으로 묶을 수 없습니다."]
      ],
      module_spot: [
        ["왜 넣었나", "DRAM 모듈은 칩을 기판 등에 조립한 완제품입니다. 칩 가격의 변화가 PC용 UDIMM·서버용 RDIMM 같은 완제품 가격에도 이어지는지 보려고 분리했습니다."],
        ["어떻게 비교하나", "같은 DDR 세대·용량·속도의 모듈 가격을 추적하고 해당 DRAM 칩 가격과 나란히 봅니다. 칩만 오르고 모듈 가격이 정체되면 원가 전가 지연이나 유통 재고 영향을 확인할 수 있습니다."],
        ["무엇을 뜻하지 않나", "칩 1개의 가격과 모듈 1개의 가격은 직접 비교할 수 없습니다. 칩 개수, PCB·전력관리 부품·조립비·유통 마진이 다르므로 단순 가격 차이가 기업 영업이익은 아닙니다."]
      ],
      nand_spot: [
        ["왜 넣었나", "NAND 현물가격으로 저장용 메모리의 규격별 단기 수급 변화를 관찰합니다. DRAM과 수요처·재고 흐름이 다를 수 있어 별도 항목으로 넣었습니다."],
        ["어떻게 비교하나", "같은 SLC·MLC 제품의 가격을 기간별로 비교합니다. 이후 NAND 계약가격과 플래시 수출금액을 대조하되, 수출은 NAND와 NOR가 섞인 더 넓은 범위라는 점을 유지합니다."],
        ["무엇을 뜻하지 않나", "현재 공개 목록의 SLC·MLC 가격은 최신 TLC·QLC나 SSD 전체 가격을 대표하지 않습니다. 규격이 다른 NAND 가격을 하나로 합치거나 SSD 업체 실적으로 바로 환산하지 않습니다."]
      ],
      contract: [
        ["왜 넣었나", "계약가격은 일정 기간·물량에 대해 구매자와 공급자가 합의하는 가격의 조사치입니다. 단기 현물 변화가 큰 고객의 계약 협상으로 이어지는지 보기 위해 넣었습니다."],
        ["어떻게 비교하나", "같은 규격의 현물가격과 계약가격을 나란히 놓고 방향·변화율·시차를 봅니다. 계약가격 상승이 다음 분기 매출과 OPM 개선으로 이어졌는지는 출하량과 제품 구성까지 대조합니다."],
        ["무엇을 뜻하지 않나", "공개 요약표가 최신 유료 자료보다 늦을 수 있습니다. 조사 평균이 특정 고객의 실제 계약서 가격은 아니며, 기준월과 공개일을 혼동하면 선행성을 잘못 판단할 수 있습니다."]
      ],
      memory_exports: [
        ["왜 넣었나", "한국에서 실제로 신고된 메모리 수출금액과 순중량으로 가격뿐 아니라 출하 흐름도 함께 보려는 지표입니다. 관세청 월별 통계를 이용하며 개별 기업 납품으로 추정하지 않습니다."],
        ["어떻게 비교하나", "전년 같은 달의 수출금액·순중량과 비교하고 현물·계약가격, 기업 분기 실적을 나란히 봅니다. 금액과 kg가 함께 늘었는지, 금액만 늘었는지를 나눠 제품 구성과 가격 변화를 점검합니다."],
        ["무엇을 뜻하지 않나", "물량은 칩 개수나 비트 출하량이 아닌 kg입니다. USD/kg는 패키지·고부가 제품 비중에도 영향을 받으므로 칩 판매단가가 아닙니다. 플래시 HS 8542321030은 NAND 전용이 아니라 NAND·NOR를 포함합니다."],
        ["시차와 범위", "전월 자료는 매월 15일경 반영되고 정정될 수 있습니다. 수출 신고 시점과 연결 매출 인식 시점은 다르며, 삼성전자·SK하이닉스의 해외 생산 및 국내 판매 전체를 포함하지 않습니다."]
      ]
    };
    return `<details class="md-logic" id="md-logic"><summary><span>이 데이터를 보는 이유</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 7 6 6 6-6"/></svg></summary><div>${(explanations[group] || []).map(([title,body]) => `<section><b>${title}</b><p>${body}</p></section>`).join("")}<p class="md-caveat">현재 상태: ${esc(status(s))}. ${visiblePoints(s).some(p=>C.finite(p.value)) ? "위 관측값은 비교 자료이며, 가격 상승이나 실적 개선을 보장하지 않습니다." : "실제 수치가 연결되지 않아 지금은 상승·하락이나 실적 방향을 판단하지 않습니다."}</p></div></details>`;
  }
  function calendar() {
    return `<details class="md-calendar" id="md-calendar"><summary><span>발표 일정과 자동 갱신 기준</span><span>한국 시간 KST ▾</span></summary><div class="md-calendar-body">
      <div class="md-schedule"><b>DRAM 현물</b><strong>12:00 · 15:40 · 19:10</strong><p>일반 세션 발표. 이용 허용 확인 후 각 세션부터 20분 동안 5분 간격 확인.</p></div>
      <div class="md-schedule"><b>모듈 · NAND · 계약가격</b><strong>고정 발표 일시 미확인</strong><p>같은 세션 창에 원문 변경 여부 확인. 계약가격은 월간 원칙, 공개표는 최신 유료자료보다 늦을 수 있음.</p></div>
      <div class="md-schedule"><b>한국 DRAM · 플래시 수출</b><strong>매월 15일경 · 시각 미공시</strong><p>키 연결 후 15~18일 5분 간격으로 전월 자료 확인. 매일 08:07에는 과거 정정분도 확인.</p></div>
      <div class="md-schedule"><b>파인엠텍 · 베트남 거래</b><strong>발표 시각 미확인 · 주기 조회</strong><p>파인엠텍 일별 주가·확정 실적은 24시간 10분 간격. 거래 피드는 연결 후 같은 간격으로 확인.</p></div>
      <p class="md-caveat">예약은 GitHub Actions 기준이며 실행·배포·원문 캐시 지연이 발생할 수 있습니다. 발표 즉시 반영을 보장하지 않습니다. 값이 같으면 게시 파일은 그대로 두므로 저장 시각은 마지막 조회 시각과 다릅니다. <a href="https://github.com/minwook1011/vantage-0910/actions" target="_blank" rel="noopener">실행 이력 ↗</a></p>
      <p class="md-caveat"><a href="https://www.dramexchange.com/service/faqs" target="_blank" rel="noopener">메모리 발표 기준 ↗</a> · <a href="https://www.data.go.kr/data/15101609/openapi.do" target="_blank" rel="noopener">관세청 갱신 기준 ↗</a></p>
    </div></details>`;
  }
  function render() {
    if (host.hidden) return;
    const list = rows();
    if (!list.some(s => s.id === selected)) selected = list[0]?.id || null;
    const s = list.find(v => v.id === selected), points = visiblePoints(s), latest = points.filter(p => C.finite(p.value)).at(-1);
    const calendarOpen = document.getElementById("md-calendar")?.open;
    const logicOpen = document.getElementById("md-logic")?.open;
    host.innerHTML = `<div class="md-header"><div><span class="md-eyebrow">MEMORY & TRADE OBSERVATORY</span><h2>가격에서 출하까지.</h2><p>칩과 모듈, 현물과 계약을 나누어 봅니다.</p></div><button type="button" id="md-refresh" ${loading ? "disabled" : ""}>${loading ? "확인 중…" : "게시 데이터 새로고침 ↻"}</button></div>
      <div class="md-definition"><b>Spot = 현물가격</b><span>Contract = 계약가격</span><span>한국 수출 = 대표 DRAM 수출금액 · 순중량은 원자료에 보존</span></div>
      <div class="md-tabs" role="group" aria-label="메모리 지표 분류">${Object.entries(GROUPS).map(([id,label]) => `<button type="button" data-md-group="${id}" class="${id === group ? "on" : ""}" aria-pressed="${id === group}">${label}</button>`).join("")}</div>
      ${errors.length ? `<p class="md-warning" role="status">${esc(errors.join(" · "))} 기존에 받은 자료가 있으면 유지합니다.</p>` : ""}
      <div class="md-grid"><div class="md-catalog"><label class="md-search">지표 검색<input id="md-search" type="search" value="${esc(search)}" placeholder="DDR5, UDIMM, HS 코드…"></label><div class="md-list" role="group" aria-label="지표 목록">${list.length ? list.map((item,i) => `<button class="md-item ${selected === item.id ? "on" : ""}" type="button" data-md-id="${esc(item.id)}" style="--item-delay:${Math.min(i,10)*30}ms" aria-pressed="${selected === item.id}"><span>${esc(item.item || item.label)}</span><small>${esc(item.hs_code ? "HS " + item.hs_code + " · " + item.unit : item.unit)}<i>${status(item)}</i></small></button>`).join("") : '<p class="md-caveat">일치하는 지표가 없습니다.</p>'}</div></div>
      <article class="md-detail"><div class="md-detail-head"><div><span class="md-state ${latest ? "has-data" : ""}">${status(s)}</span><h3>${esc(s?.label || "지표를 선택해 주세요")}</h3></div><strong>${latest ? C.format(latest.value, s.unit, 3) : "—"}</strong></div>
      <div id="md-chart" class="md-chart">${latest ? "" : `<div class="md-empty"><span aria-hidden="true">∿</span><b>${s?.status === "permission_required" ? "공급자 이용 허용 확인 후 연결됩니다" : s?.status === "needs_api_key" ? "관세청 API 연결키를 기다리고 있어요" : "아직 표시할 관측값이 없어요"}</b><p>${s?.status === "permission_required" ? "가격 자동수집·공개 재배포 허용이 확인되지 않아 가격 숫자는 게시하지 않았습니다. TRASS 이용권과는 별개입니다." : "실제 수치가 들어오면 이곳에 시계열이 그려집니다. 빈 값을 0이나 예시 숫자로 채우지 않습니다."}</p></div>`}</div>
      ${s ? `<dl class="md-source-info"><div><dt>${s.category === "memory_exports" ? "최신 관측월" : "원문 Last Update"}</dt><dd>${esc(s.category === "memory_exports" ? s.source_latest_period || "미수신" : dateTime(s.source_updated_at))}</dd></div><div><dt>${s.category === "memory_exports" ? "발표 시각" : s.status === "permission_required" ? "원문 확인일" : "관측 기준일"}</dt><dd>${esc(s.category === "memory_exports" ? "제공되지 않음" : s.status === "permission_required" ? (s.source_checked_on || "미확인") + " · 현재 시세 아님" : latest?.date || "미수신")}</dd></div><div><dt>출처</dt><dd><a href="${esc(safeURL(s.source_url))}" target="_blank" rel="noopener">${esc(s.source)} ↗</a></dd></div></dl><p class="md-caveat">${esc(s.coverage || (group === "nand_spot" ? "현재 공개 목록은 SLC·MLC 규격입니다. TLC·QLC SSD 시장 전체를 대표하는 가격 지수가 아닙니다." : "용량·규격별 개별 가격입니다. 서로 다른 칩과 모듈의 금액을 합산하지 않습니다."))}</p>` : ""}
      <button class="md-compare" id="md-compare" type="button" ${latest ? "" : "disabled"}>＋ 파인엠텍 주가와 비교${latest ? "" : " · 데이터 연결 후 가능"}</button><p class="md-caveat">메모리·한국 수출은 별도 산업 지표입니다. 파인엠텍의 백플레이트 납품을 직접 증명하지 않습니다.</p>${logic(s)}</article></div>
      ${calendar()}<p class="md-footnote">무료 API 키는 서버의 비밀 설정에만 보관합니다. 브라우저나 공개 저장소에는 넣지 않습니다. <a href="https://www.trendforce.com/about/terms" target="_blank" rel="noopener">메모리 가격 이용 조건 ↗</a></p>`;
    if (calendarOpen) document.getElementById("md-calendar").open = true;
    if (logicOpen) document.getElementById("md-logic").open = true;
    host.querySelectorAll("[data-md-group]").forEach(btn => btn.onclick = () => {group = btn.dataset.mdGroup; search = ""; selected = null; render();});
    host.querySelectorAll("[data-md-id]").forEach(btn => btn.onclick = () => {selected = btn.dataset.mdId; render();});
    document.getElementById("md-refresh").onclick = () => load(true);
    document.getElementById("md-search").oninput = event => {search = event.target.value; const pos = event.target.selectionStart; render(); const input = document.getElementById("md-search"); input.focus(); if (pos !== null && input.type !== "search") input.setSelectionRange(pos,pos);};
    document.getElementById("md-compare").onclick = () => {
      if (!latest) return;
      document.getElementById("company-search").value = "파인엠텍";
      document.getElementById("company-apply").click();
      document.dispatchEvent(new CustomEvent("vantage-external-select", {detail:{id:selected}}));
      document.querySelector(".workbench").scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",block:"start"});
    };
    if (latest) draw(s);
  }
  function draw(s) {
    const box = document.getElementById("md-chart"); if (!box || !s) return;
    const points = visiblePoints(s), good = points.filter(p => C.finite(p.value)); if (!good.length) return;
    const width = Math.max(280, box.clientWidth), height = 270, left = 57, right = 16, top = 25, bottom = 30;
    const [lo,hi] = C.domain(good.map(p => p.value), false), first = C.timestamp(points[0].date), last = C.timestamp(points.at(-1).date);
    const x = p => first === last ? width/2 : left+(C.timestamp(p.date)-first)/(last-first)*(width-left-right);
    const y = p => top+(hi-p.value)/(hi-lo)*(height-top-bottom);
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(s.label)} 실제 관측값 차트">`;
    for (let i=0;i<5;i++) { const yy=top+i/4*(height-top-bottom); svg += `<path d="M${left} ${yy}H${width-right}" stroke="#7796bf" stroke-opacity=".14"/><text x="${left-8}" y="${yy+4}" text-anchor="end">${new Intl.NumberFormat("ko-KR",{notation:"compact",maximumFractionDigits:1}).format(hi-(hi-lo)*i/4)}</text>`; }
    let path="", pen=false;
    points.forEach(p => {if (!C.finite(p.value)) {pen=false;return;} path+=`${pen?"L":"M"}${x(p)} ${y(p)} `; pen=true;});
    svg += `<path class="md-line" pathLength="1" d="${path}" stroke="#7da8ff" fill="none" stroke-width="2"/>`;
    good.forEach(p => {svg+=`<circle cx="${x(p)}" cy="${y(p)}" r="3" fill="#83aaff"><title>${esc(p.date)} · ${esc(C.format(p.value,s.unit,3))}</title></circle>`;});
    svg += `<text x="${left}" y="${height-8}">${esc(points[0].date)}</text><text x="${width-right}" y="${height-8}" text-anchor="end">${esc(points.at(-1).date)}</text></svg>`;
    box.innerHTML=svg+(good.length===1 ? '<p class="md-caveat">첫 관측값 1개입니다. 과거 이력을 임의로 만들지 않고 새 관측값부터 누적합니다.</p>' : "");
  }
  async function load(manual) {
    if (loading) return; loading=true; if(manual)render(); errors=[];
    const results = await Promise.allSettled(["memory", "memory_exports"].map(async name => {
      const res=await fetch("data/"+name+".json",{cache:"no-cache"});
      if(!res.ok)throw new Error(name); const json=await res.json();
      if(json.schema_version!==1 || !Array.isArray(json.series))throw new Error(name);
      return {name,series:json.series};
    }));
    results.forEach((r,i) => {const isExport=i===1; if(r.status==="fulfilled") {
      datasets=datasets.filter(s => (s.category === "memory_exports") !== isExport).concat(r.value.series);
    } else errors.push(isExport?"수출 데이터 파일 수신 실패":"메모리 데이터 파일 수신 실패");});
    loading=false;
    document.dispatchEvent(new CustomEvent("vantage-external-data",{detail:{series:availableSeries()}}));
    render();
  }
  document.addEventListener("vantage-data-category", event => {
    host.hidden=false;group=event.detail.category==="exports"?"memory_exports":"dram_spot";search="";selected=null;render();
    host.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"});
  });
  window.addEventListener("resize",()=>{if(!host.hidden)draw(rows().find(s=>s.id===selected));});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)load(false);});
  load(false);
})();
