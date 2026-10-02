# 파인엠텍 데이터 연결

`fetch_finemtec.py`는 Yahoo Finance(실패 시 Naver)의 일별 주가와 Naver Finance/FnGuide의 연결 확정 실적을 수집한다. 전망치 열은 제외하며, 기존 실적을 날짜 기준 누적한다. 실적 금액 단위는 **억원**, 금융 API에서 제공한 반올림 값이다. 성장률은 정확히 전년 같은 기간을 찾아 계산한다. 2022년 분할 이후 단기 실적과 2023년 연간 성장률은 비교하지 않는다. 실제 공시일이 미확인인 값에는 공시일을 만들어 넣지 않는다. 화면의 날짜는 회계기간 말이며 과거 시점 투자 성과 검증에 바로 사용하면 안 된다.

## 자동 갱신

- `.github/workflows/finemtec.yml`: 24시간 10분 간격 예약, 수동 실행 지원. 실적의 고정 발표 일시가 확인된 것은 아니다. 예약 작업과 원출처 반영·게시에는 지연이 생길 수 있다.
- `--only-if-changed`는 값·상태가 바뀔 때만 게시 파일을 저장한다. 파일 내 수집 시각은 마지막 저장 시각이며 매 회 실행 여부는 Actions 로그에서 확인한다.
- 메모리 가격·수출의 발표 일정과 활성화 조건은 [publication-calendar.md](publication-calendar.md)에 정리했다.
- 예약 작업이 데이터를 커밋한 뒤 Pages build API를 명시적으로 호출한다. 기본 GITHUB_TOKEN으로 커밋만 하면 GitHub Pages가 자동 재빌드되지 않는 경우를 방지한다.
- 페이지 진입/재방문/새 데이터 확인 버튼: 최신 게시 JSON을 재조회한다. 방문 자체가 외부 데이터 수집기를 실행하지는 않는다.
- 데이터 소스 실패 시 기존 값을 유지하고 지연 상태를 기록한다.
- 베트남 거래는 **아직 연결되지 않았다**. 현재 무상 원본, 실제 양사 납품 내역, API 이용권, 수록 범위·공개 시차 모두 확보되지 않았다.

## 베트남 거래 연결 계약

`ingest_finemtec_trade.py`는 공급자별 원본이 아래 계약으로 변환된 **검증 가능한 피드**를 받는 집계기다. ImportGenius/TRASS API를 이미 연동했다는 뜻이 아니다. 공급자 원본의 실제 필드·조회 권한을 확인한 다음 어댑터를 연결해야 한다. 데이터 공급 계약에서 공개 집계 게시를 허용하는지도 확인한다.

입력: `python ingest_finemtec_trade.py --input /private/path/normalized.json`, 또는 GitHub Secrets의 `FINEMTEC_TRADE_FEED_URL`(HTTPS) 및 선택 `FINEMTEC_TRADE_FEED_TOKEN`(Bearer). 키·원본 거래 파일은 저장소나 `docs/`에 넣지 않는다.

필수 피드 속성:

| 속성 | 의미 |
|---|---|
| `schema_version` | `1` |
| `source` | 실제 공급자·서비스 이름 |
| `available_at` | 공급자가 제공한 시각, ISO 8601 |
| `aggregate_publication_allowed` | 계약상 공개 집계 게시가 가능하면 `true` |
| `coverage` | `YYYY-MM` → `complete` 또는 `partial`. 지정 법인·수취인·품목의 전체 수록 여부 |
| `records` | 아래 거래 행 배열 |

필수 거래 행: `transaction_id`(원본 수출·수입 중복을 합친 안정적인 식별자), `date`(YYYY-MM-DD), `exporter_id`, `buyer_id`, `product_code`, `transaction_type`(`sale`), `is_intercompany`(`false`), `currency`(`USD`), `value_usd`(비음수 숫자). 선택: `quantity`, `quantity_unit`(`PCS/PCE/NOS/EA`), `net_weight_kg`(순중량). USD가 아닌 원본은 근거 있는 원본 환율/변환 기준을 적용하는 어댑터가 필요하며 숫자만 USD로 재명명하면 안 된다.

`finemtec_trade_rules.json`에 실제 확인된 수취 법인 식별번호와 `verified_products`의 `{exporter_id,code,evidence_url}`를 추가해야 집계가 열린다. 현재 둘 다 비어 있으므로 삼성디스플레이나 백플레이트를 자동 추정하지 않는다. FINE MS VINA 식별번호는 2300851647, VINA CNS는 2301166235이며, 회사명·사업장·공시 식별번호와 원본 업체를 대조해야 한다. VINA CNS의 EV/ESS 등 기타 제품을 포함하지 않도록 품목을 검증한다.

집계 규칙:

- 동일 거래 ID가 완전히 같으면 한 번만 사용, 내용이 충돌하면 전체 갱신 거부.
- 확인한 양사·백플레이트 코드·외부 판매 거래만 집계. 샘플·반품·원재료·내부거래 제외.
- 행 하나라도 수량/순중량이 없으면 해당 월의 총수량/총순중량을 알 수 없는 값으로 유지.
- 금액은 수록된 거래의 합. 전체 수록이 확인되지 않으면 `partial` 표시.
- 개당 금액은 규칙의 `asp_product: {exporter_id,code}`로 고정한 품목만 전 기간에 걸쳐 계산한다. 해당 품목의 개 단위 수량이 모두 있어야 하며, 품목을 바꿔 하나의 단가 선으로 연결하지 않는다.
- 누락 월은 null. 명시적으로 전체 수록이 확인된 무거래 월만 0.
- YoY는 현재/전년 동일 월 모두 전체 수록 확인된 경우만 계산.
- 원본 거래는 게시하지 않고 검증 후 월별 집계와 수록 범위만 게시.
- 이 집계만으로 애플/삼성 최종 고객이나 회계상 매출을 확정하지 않는다.

거래가 처음 제공된 날짜와 신고일의 간격을 확인하고, 과거 분기 매출과 수록 범위·매출 인식 시점을 대조한 뒤에만 선행지표로 평가한다.

## 화면

`datahub.html`에서 파인엠텍(또는 441270)을 선택한다. 주가는 고정, 아래 두 펼침 메뉴에서 실적·납품 지표를 선택한다. 서로 다른 단위가 많거나 모바일 축이 혼잡하면 기간 내 최솟값 0/최댓값 100으로 비교하며 화면에 변환 방법을 알린다. 수익률이나 상관계수가 아니다. 마우스/키보드 탐색은 원래 값과 관측 날짜를 표시한다.

직접 추가 지표는 브라우저 로컬에 저장하며 자동 수집 자료와 구분한다. 국가 탭과 기존 기업 즐겨찾기는 유지한다.

지표 아래 `이 데이터를 보는 이유 ▾`를 열면 선택 이유·실적과 비교할 논리·해석 한계를 볼 수 있다. 메모리 화면은 선택한 분류(칩/모듈/NAND/계약/수출)에 따라 설명이 바뀐다. 파인엠텍은 베트남 거래를 연결 매출·영업이익·OPM과 비교할 가설과 현재 원본 미연결이라는 상태를 함께 표시한다.

## 일본 스크리너 — 소비재 종목 추가하기

`docs/data/jp/screener-data.js`(소비재, 2026-10-02 시총 300억엔 미만 403개를 지워 332개)는 생성 스크립트가 없는 고정 번들이라 직접 고치지 않는다(종목 삭제만 예외). 소비재 명단은 시총 300억엔 이상만 둔다. 빠진 소비재·소비재 인접 종목(완구·게임 도매, 캐릭터·IP, 문구, 주택설비, OTC, 학원, 관혼상제 등)은 아래 순서로 넣는다.

1. `data_sources/jp_consumer_extra.json`에 한 줄 추가: `{"code": "7552", "cat": "게임·엔터", "note": "완구·게임 도매"}`
   - `cat`은 기존 카테고리 중 하나만: 리테일·유통 / 식품·음료 / 외식 / 라멘 / 게임·엔터 / 미용·헬스케어서비스 / 패션·명품 / 생활·홈 / 화장품·퍼스널케어 / 여행·레저. 다른 이름이면 건너뛴다.
   - `note`는 화면의 업종 칸에 그대로 보이는 짧은 한국어 설명.
   - 이미 소비재 RAW에 있는 코드는 자동으로 건너뛴다(중복 없음).
2. `python fetch_jp_consumer_extra.py 7552` — 그 종목만 받아 `docs/data/jp/consumer-extra.js`(`RAW_EXT`·`BUNDLE_EXT`)에 반영. 인자 없이 돌리면 전체 갱신(종목당 약 3초, 주 1회 권장 — 주가는 `fetch_jp_px.py`가 매일 이어 붙인다).
   - 카부탄에서 종목 페이지가 확인되지 않거나(상장폐지·코드 오류) 주가를 못 받으면 기존 값을 유지하고, 기존 값도 없으면 빼고 끝에 목록으로 알려 준다.
3. 실적발표 탭에 넣기: `python fetch_jp_earnings_dates.py --codes 7552` (다음 발표일) → `python fetch_jp_earnings_results.py --codes 7552` (최근 발표·리포트 파일 `docs/data/jp/reports/`).
4. `docs/jp-screener.html`의 `consumer-extra.js?v=` 값을 올려 브라우저 캐시를 끊는다.

화면(`jp-screener.js`)은 `consumer-extra.js`를 소비재 목록 뒤에 합쳐 시총 순으로 다시 정렬한다. `fetch_jp_earnings_results.py`·`fetch_jp_earnings_dates.py`·`fetch_jp_px.py`도 이 파일을 소비재(`cons`) 유니버스로 읽으므로, 이후에는 기존 예약 작업이 그대로 챙긴다. 카부탄은 GitHub 서버를 막으므로 이 PC에서 돌린다.
