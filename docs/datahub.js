(function () {
  "use strict";
  /* 데이터 허브 공통 — "데이터 연결 설계" 안내 토글.
     기업 선택·주가×지표 비교는 company-bench.js(기업별 데이터 모음)가, 파인엠텍 상세는 finemtec.js 가 맡는다.
     예전의 국가·섹터 카드, 기업 검색·즐겨찾기, 연관 데이터 맵은 기업 워크벤치로 대체되어 제거했다. */
  var button = document.getElementById("open-onboarding");
  if (!button) return;
  button.onclick = function () {
    var box = document.getElementById("onboarding");
    box.hidden = !box.hidden;
    if (!box.hidden) box.scrollIntoView({behavior: "smooth", block: "nearest"});
  };
})();
