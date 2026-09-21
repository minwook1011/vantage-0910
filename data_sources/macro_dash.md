# 매크로 대시보드 (macro.html)

수집기: `fetch_macro_dash.py` → `docs/macro_dash.json`
자동 실행: `.github/workflows/macro-dash.yml` — 미국 지표 발표 직후(평일 08:45·10:20 ET, FOMC 14:00 ET 이후) + 매일 한국 07:00

## 출처 (모두 무료·무키)

| 영역 | 지표 | 출처 |
|---|---|---|
| 물가 | CPI·Core CPI·PPI·Core PPI (YoY) | BLS Public API v2 (키 없이 하루 25회, 실행당 2회) |
| 물가 | PCE·Core PCE (YoY) | BEA NIPA 원자료 `NipaDataM.txt` (DPCERG·DPCCRG) |
| 고용 | 비농업 고용 증감·실업률·평균시급·참가율·JOLTS | BLS API |
| 고용 | 신규 실업수당 청구 | 미 노동부 ar539 — **비계절조정** 주별 합계의 4주 평균 |
| 성장·심리 | 실질 GDP (전기비 연율) | BEA `NipaDataQ.txt` (A191RL) |
| 성장·심리 | 미시간대 소비자심리 | 미시간대 `tbmics.csv` |
| 금리 | 국채 1개월~30년, 장단기 금리차 | 미 재무부 일별 수익률 CSV |
| 금리 | 실효 연방기금금리 | 뉴욕연준 EFFR API |
| 시장 | S&P500·나스닥·코스피·코스닥·VIX·달러인덱스·원/달러 | Yahoo 차트 (10년 일봉) |

FRED는 이 PC와 GitHub Actions 모두에서 응답이 끊겨 쓰지 않는다.

## 발표 일정

| 발표 | 출처 |
|---|---|
| FOMC | federalreserve.gov 회의 일정 (내년까지, 점도표 회의 표시) |
| GDP·PCE | bea.gov 발표 일정 |
| CPI·PPI·고용·JOLTS | bls.gov가 자동 요청을 403으로 막는다. 매 실행 직접 수집을 시도하고, 막히면 `data_sources/macro_calendar_seed.json`(공식 일정 옮겨 적음)을 쓴다. **2027년 BLS 일정이 공개되면(보통 가을) 이 파일에 추가해야 한다.** |
| 신규 실업수당 | 매주 목요일 08:30 ET (휴일 주에는 바뀔 수 있음) |

한국시간은 미국 서머타임(3월 둘째 일요일~11월 첫째 일요일)을 반영해 계산한다.
08:30 ET → 서머타임 21:30 KST / 표준시 22:30 KST.

## 파일 크기

일별 시계열은 최근 약 2년(520거래일)만 일별로 두고, 그 이전은 5거래일 단위로 압축한다.
지수 거래량은 압축 구간에서 5일 합계로 묶는다. 약 0.4MB.

## 실패 처리

출처마다 실패를 격리한다. 실패한 항목은 직전 JSON 값을 그대로 쓰고, 화면 하단에
출처별 상태(✓/✗)를 표시한다. 모든 출처가 실패하면 비정상 종료해 워크플로가 빨갛게 뜬다.
