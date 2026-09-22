(function () {
  "use strict";
  var DATA = {
    korea: { label: "한국", code: "KOR", series: [
      ["파인엠텍 · 폴더블 납품", "주가 · 실적 · 베트남 거래 비교", ["파인엠텍"], "파인엠텍"],
      ["메모리 수출", "DRAM · 플래시 / 금액 · 순중량", ["삼성전자", "SK하이닉스"], null, "exports"],
      ["메모리 가격", "DRAM 칩 · 모듈 · NAND 현물", ["삼성전자", "SK하이닉스"], null, "memory"],
      ["전력 수요", "산업용 전력 · 데이터센터", ["삼성전자", "한전"]],
      ["외국인 수급", "코스피 · 업종별 순매수", ["삼성전자", "SK하이닉스"]],
      ["제조업 가동률", "생산 · 재고 · 출하", ["삼성전자", "현대차"]]
    ] },
    ai: { label: "AI 인프라", code: "AI", series: [
      ["토큰 수요", "OpenRouter 토큰량 · 랩별 점유율 · 앱 · AI 트래픽", ["NVIDIA", "Microsoft", "Google"], null, null, "demand"],
      ["토큰 가격", "실효 단가 · 프론티어 가격 지수 · 인하 이벤트", ["Microsoft", "Google"], null, null, "price"],
      ["GPU · 컴퓨팅", "H100/B200 임대가 · 중고가 · TSMC · ODM 월매출", ["NVIDIA", "TSMC", "CoreWeave"], null, null, "compute"],
      ["메모리 · HBM", "현물 · 계약가 · 반도체 수출 · HBM 발표", ["삼성전자", "SK하이닉스", "Micron"], null, null, "memory"],
      ["캐팩스 · 투자", "하이퍼스케일러 캐팩스 · DC 건설 · 수주잔고 · ARR", ["Microsoft", "Amazon", "Meta"], null, null, "capex"],
      ["심리 · 주가", "SOX/SPX · AI 바스켓 · 검색 트렌드", ["NVIDIA", "TSMC", "SK하이닉스"], null, null, "sentiment"]
    ] },
    usa: { label: "미국", code: "USA", series: [
      ["AI 데이터센터 CAPEX", "하이퍼스케일러 투자 · 가이던스", ["NVIDIA", "Amazon", "Microsoft"], null, null, "capex"],
      ["GPU 임대료", "GPU별 일간 임대 지수", ["NVIDIA", "CoreWeave"], null, null, "compute"],
      ["클라우드 사용량", "AWS · Azure · GCP 수요", ["Amazon", "Microsoft"]],
      ["AI 서비스 이용자", "MAU · 트래픽 · 구독", ["Microsoft", "NVIDIA"], null, null, "demand"],
      ["기업 IT 지출", "소프트웨어 · 인프라 지출", ["Microsoft", "Amazon"]]
    ] },
    japan: { label: "일본", code: "JPN", series: [
      ["반도체 장비 수주", "장비 주문 · 출하 · 가동률", ["TSMC", "삼성전자", "NVIDIA"]],
      ["로봇·자동화", "산업용 로봇 · 공장 자동화", ["삼성전자", "현대차"]],
      ["일본 수출", "기계 · 전자부품 · 소재", ["TSMC", "삼성전자"]],
      ["엔화·금리", "USD/JPY · 국채금리 · 정책", ["삼성전자", "TSMC"]],
      ["전력·소재", "전력 인프라 · 핵심 소재", ["TSMC", "NVIDIA"]]
    ] },
    macro: { label: "매크로", code: "MAC", series: [
      ["달러·환율", "DXY · 원/달러 · 엔/달러", ["삼성전자", "TSMC", "Amazon"]],
      ["금리·유동성", "국채금리 · 실질금리 · 유동성", ["NVIDIA", "Microsoft", "Amazon"]],
      ["신용 스프레드", "회사채 · 하이일드 · 금융여건", ["삼성전자", "NVIDIA"]],
      ["원자재", "구리 · 유가 · 희토류", ["TSMC", "삼성전자"]],
      ["글로벌 교역", "운임 · PMI · 수출입", ["삼성전자", "TSMC"]]
    ] },
    industry: { label: "섹터", code: "SEC", series: [
      ["TSMC 월매출", "월매출 · YoY · 공정 믹스", ["TSMC", "삼성전자", "NVIDIA"], null, null, "compute"],
      ["첨단 패키징", "패키징 · 기판 · 테스트", ["TSMC", "삼성전자", "SK하이닉스"]],
      ["AI 데이터센터", "CAPEX · 서버 출하 · 전력", ["NVIDIA", "Amazon", "Microsoft"], null, null, "capex"],
      ["GPU 임대료", "GPU별 일간 임대 지수", ["NVIDIA", "CoreWeave"], null, null, "compute"],
      ["DRAM · NAND 가격", "현물 · 모듈 · 계약가격 분리", ["삼성전자", "SK하이닉스"], null, "memory"]
    ] }
  };
  var COMPANIES = {
    "파인엠텍": ["베트남 백플레이트 납품", "매출 · 영업이익", "OPM · 성장률"],
    "삼성전자": ["한국 반도체 수출", "메모리 가격", "TSMC 월매출", "DRAM · NAND 가격", "달러·환율"],
    "SK하이닉스": ["한국 반도체 수출", "메모리 가격", "TSMC 월매출", "DRAM · NAND 가격", "첨단 패키징"],
    "TSMC": ["TSMC 월매출", "반도체 장비 수주", "첨단 패키징", "일본 수출", "전력·소재"],
    "NVIDIA": ["AI 데이터센터 CAPEX", "GPU 임대료", "TSMC 월매출", "AI 데이터센터", "금리·유동성"],
    "Amazon": ["AI 데이터센터 CAPEX", "클라우드 사용량", "기업 IT 지출", "달러·환율", "금리·유동성"],
    "Microsoft": ["AI 데이터센터 CAPEX", "AI 서비스 이용자", "클라우드 사용량", "기업 IT 지출", "금리·유동성"]
  };
  var FAVORITE_KEY = "vantage-datahub-favorite-companies-v1";
  var activeCountry = "korea", activeCompany = "파인엠텍", activeSeries = null, favorites = loadFavorites();
  var countryHost = document.getElementById("country-tabs"), seriesHost = document.getElementById("series-grid");
  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function loadFavorites() { try { var saved = JSON.parse(localStorage.getItem(FAVORITE_KEY) || "[]"); return Array.isArray(saved) ? saved.filter(function (name) { return typeof name === "string" && name.trim(); }).slice(0, 30) : []; } catch (e) { return []; } }
  function saveFavorites() { try { localStorage.setItem(FAVORITE_KEY, JSON.stringify(favorites)); } catch (e) {} }
  function renderCountries() {
    countryHost.innerHTML = Object.keys(DATA).map(function (key) { return '<button class="country-tab' + (key === activeCountry ? ' on' : '') + '" type="button" data-country="' + key + '">' + DATA[key].label + '</button>'; }).join("");
    countryHost.querySelectorAll("button").forEach(function (button) { button.onclick = function () { activeCountry = button.dataset.country; activeSeries = null; renderCountries(); renderSeries(); renderWorkbench(); }; });
  }
  function renderSeries() {
    var group = DATA[activeCountry];
    seriesHost.innerHTML = group.series.map(function (item, index) {
      var selected = activeSeries && activeSeries.name === item[0];
      return '<button class="series-card' + (selected ? ' selected' : '') + '" type="button" style="animation-delay:' + (index * 65) + 'ms" data-index="' + index + '"><span class="country-code">' + group.code + ' · SERIES 0' + (index + 1) + '</span><b>' + item[0] + '</b><p>' + item[1] + '</p><span class="series-state"><i></i>' + (item[3] ? '주가·실적 연결 · 베트남 자료 미확보' : item[5] ? 'AI 지표 워크스페이스 열기' : item[4] ? '지표 목록 · 발표 일정 보기' : selected ? '지표 선택됨 · 연결 대기' : '출처 연결 대기') + '</span></button>';
    }).join("");
    seriesHost.querySelectorAll("button").forEach(function (button) { button.onclick = function () {
      var item = group.series[Number(button.dataset.index)]; activeSeries = { name: item[0], desc: item[1] };
      if (item[3]) { activeCompany = item[3]; document.getElementById("company-search").value = activeCompany; }
      renderSeries(); renderWorkbench();
      if (item[4]) document.dispatchEvent(new CustomEvent("vantage-data-category", {detail:{category:item[4]}}));
      else document.getElementById("memory-workspace").hidden = true;
      if (item[5]) document.dispatchEvent(new CustomEvent("vantage-ai-focus", {detail:{group:item[5]}}));
      if (item[3]) document.querySelector('.workbench').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
    }; });
  }
  function renderCompanyOptions() {
    var names = {};
    Object.keys(COMPANIES).forEach(function (name) { names[name] = true; });
    Object.keys(DATA).forEach(function (key) {
      DATA[key].series.forEach(function (series) { (series[2] || []).forEach(function (name) { names[name] = true; }); });
    });
    document.getElementById("company-options").innerHTML = Object.keys(names).sort().map(function (name) { return '<option value="' + esc(name) + '"></option>'; }).join("");
  }
  function selectCompany() {
    var input = document.getElementById("company-search"), name = input.value.trim();
    if (/^(441270(?:\.KQ)?|fine\s*m[- ]?tec)$/i.test(name)) name = "파인엠텍";
    if (!name) return;
    activeCompany = name; input.value = name; renderWorkbench();
  }
  function renderFavorites() {
    var host = document.getElementById("company-favorite-list");
    host.innerHTML = favorites.length ? favorites.map(function (name) { return '<span class="favorite-company"><button class="favorite-name" type="button" data-favorite-company="' + esc(name) + '"><i>★</i>' + esc(name) + '</button><button class="favorite-remove" type="button" data-favorite-remove="' + esc(name) + '" aria-label="즐겨찾기 삭제">×</button></span>'; }).join("") : '<span class="favorite-empty">아직 고정한 기업이 없습니다</span>';
    host.querySelectorAll("[data-favorite-company]").forEach(function (button) { button.onclick = function () { activeCompany = button.dataset.favoriteCompany; document.getElementById("company-search").value = activeCompany; renderWorkbench(); }; });
    host.querySelectorAll("[data-favorite-remove]").forEach(function (button) { button.onclick = function (event) { event.stopPropagation(); favorites = favorites.filter(function (name) { return name !== button.dataset.favoriteRemove; }); saveFavorites(); renderFavorites(); renderWorkbench(); }; });
  }
  function toggleFavorite() {
    var index = favorites.indexOf(activeCompany);
    if (index >= 0) favorites.splice(index, 1); else favorites.unshift(activeCompany);
    favorites = favorites.slice(0, 30); saveFavorites(); renderFavorites(); renderWorkbench();
  }
  function renderWorkbench() {
    var links = COMPANIES[activeCompany] || ["연관 지표 등록 대기", "기업 실적 데이터 연결 대기", "주가와 함께 볼 외부 지표 추가 가능"];
    document.getElementById("chart-company").textContent = activeCompany;
    document.getElementById("relation-core").textContent = activeCompany;
    document.getElementById("relation-links").innerHTML = links.map(function (text) { return '<div class="relation-chip">' + text + '</div>'; }).join("");
    document.getElementById("chart-subtitle").textContent = activeSeries ? activeSeries.name + ' · 실제 시계열 연결 대기' : '연결할 지표를 선택하면 주가와 함께 표시됩니다';
    document.getElementById("workbench-status").textContent = activeSeries ? activeSeries.name + ' 선택됨' : '지표를 선택해 주세요';
    var legend = document.getElementById("chart-legend");
    legend.style.opacity = activeSeries ? "1" : ".5";
    var favoriteButton = document.getElementById("company-favorite-toggle"), isFavorite = favorites.indexOf(activeCompany) >= 0;
    favoriteButton.textContent = isFavorite ? "★ 즐겨찾기" : "☆ 즐겨찾기";
    favoriteButton.classList.toggle("on", isFavorite);
    document.dispatchEvent(new CustomEvent("vantage-company-change", {detail:{company:activeCompany}}));
  }
  document.getElementById("open-onboarding").onclick = function () { var box = document.getElementById("onboarding"); box.hidden = !box.hidden; if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
  document.getElementById("company-apply").onclick = selectCompany;
  document.getElementById("company-search").addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); selectCompany(); } });
  document.getElementById("company-favorite-toggle").onclick = toggleFavorite;
  renderCountries(); renderSeries(); renderCompanyOptions(); renderFavorites(); renderWorkbench();
})();
