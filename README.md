# etf-flow-tracker — 글로벌 섹터 자금흐름 + 세상 흐름 트래커

정적 대시보드 4페이지 + 표준 라이브러리 전용 파이썬 파이프라인 + GitHub Actions 자동 갱신.
API 키·pip 의존성·빌드 도구 없음. GitHub Pages(`docs/`)로 서빙.

## 페이지 구성

| 페이지 | 내용 | 데이터 소스 |
|---|---|---|
| `index.html` VANTAGE 시작 화면 | 8개 분석 화면 선택, 진입·되돌아가기 모션, 투자 원칙용 빈 영역 | — |
| `dashboard.html` 섹터 대시보드 | 기간별 수익률 바차트, 누적 트렌드, 그룹 히트맵(자금유입 배지), 전 종목 테이블, 종목 모달(캔들+구성종목+뉴스) | `data.json` (자동) |
| `megacap.html` 글로벌 메가캡 | TOP100/300 토글, 13개 섹터 강세 순위(중앙값), 섹터별 종목 카드(선행PER), 종목 모달(캔들+회사개요+재무추이+뉴스) | `megacap.json`·`financials.json` (자동), `megacap_profiles.json` (반자동 — 회사 개요) |
| `bottomup.html` Bottom-up 발굴 | 섹터 무관 메가캡 전체를 기술점수순(또는 수익률순)으로 정렬. 기술점수 = 이동평균선·거래량·이평선지지·RSI·MACD·볼린저·일목균형표·삼각수렴/돌파를 0~100 가중합(stocks-common.js `computeTA`, 캔들에서 클라이언트 계산 → 자동 갱신) | `megacap.json`·`financials.json` (자동) |
| `worldflow.html` 세상 흐름 파악 | [주요 일정] 다가오는·최근 종료 행사 + 월별 캘린더(접힘) / [핵심 인물] 키워드 검색·인물 디렉토리·주차별 발언 + 인사이트 리서치(행사·발언에서 파생된 심층 분석) | `events.json`, `people.json`, `insights.json` (반자동) |
| `earnings.html` 미국 주요 실적 정리 | 최근 발표 실적(매출·EPS 컨센서스 서프라이즈, 접힘) + 예정된 실적 발표 캘린더(섹터 필터) + 섹터별 비트율 + 기업별 재무 열람(5개년/8분기 매출·YoY·영업이익·OPM, 분기는 QoQ) | `financials.json`·`earnings_calendar.json`(자동) + `earnings.json`(수동 큐레이션) + `megacap.json` |
| `macro.html` 매크로 대시보드 | 경제 캘린더(월 달력·한국시간), 물가·고용·성장·금리·시장 지표 보드(클릭 시 상세 차트), 한·미 지수 겹쳐보기 + 거래량 + 매크로 오버레이, 국채 수익률 곡선·장단기 금리차 | `macro_dash.json` (자동 — `fetch_macro_dash.py`, `data_sources/macro_dash.md`) |

## 로컬 실행법

```bash
# 1) 데이터 생성 (표준 라이브러리만 사용, 파이썬 3.10+)
python fetch_data.py        # 섹터 ETF 시세+뉴스 → docs/data.json (약 3분)
python fetch_universe.py    # 시총 TOP300 명단 → docs/megacap_universe.json (약 4분, 주 1회면 충분)
python fetch_megacap.py     # 명단 시세+PER+캔들+뉴스 갱신 → docs/megacap.json (약 10~15분, 300종 뉴스 수집 포함)
python fetch_financials.py  # 메가캡 매출·영업이익 시계열 → docs/financials.json (약 4분, 매 실행마다 기존 파일에 누적)
python fetch_earnings_calendar.py  # 실적 발표일·컨센서스·EPS 서프라이즈 → docs/earnings_calendar.json (약 4분, 매 실행마다 누적)
python fetch_macro.py       # 공포·탐욕 프록시 지수 + 매크로 지표(야후+FRED) → docs/macro.json (약 1분)
python fetch_valuation.py   # S&P500 후행P/E·CAPE(multpl) + 시총가중 포워드P/E(megacap) → docs/valuation.json (약 15초, 포워드는 누적)

# 2) 로컬 서버
python -m http.server 8000 -d docs
# → http://localhost:8000
```

## 수정 지점

- **추적 ETF 추가/삭제**: `fetch_data.py` 상단 `TICKERS` (티커, 한글명, 그룹, 뉴스검색어)
- **ETF 대표 구성종목**: `fetch_data.py`의 `CONSTITUENTS`
- **메가캡 후보군/섹터 분류**: `fetch_universe.py`의 `CANDIDATES` (13개 섹터 수동 분류)
- **행사 등록/갱신**: `docs/events.json` — `status`: `upcoming`(예정) → `previewed`(발표 내용 공개, `preview` 채움) → `done`(종료, `summary`/`full` 작성)
- **인물/발언 등록**: `docs/people.json` — `people`에 인물(`type`: tech/investor/policy/corp), `weeks[].statements`에 발언(요약+시사점, 파급 크면 `analysis` 마크다운). `added`가 4일 이내면 NEW 배지
- **인사이트 리서치 등록**: `docs/insights.json` — `insights[]`에 `{id, title, trigger(발단 발언·사건 요약), linked_event_ids[]`(events.json id 참조), `linked_statement_keys[]`("person_id::date" 형식으로 people.json 발언 참조), `linked_tickers[], summary, body(마크다운), charts[]({title,unit,categories[],series[]({name,values[]}),note}), sources[]({label,url}), tags[], added}`. **수동 큐레이션** — 세상 흐름 파악의 행사·발언 카드에 연결된 id/key가 있으면 카드에 "🔎 인사이트 리서치" 배지가 자동으로 붙는다. 차트 수치는 반드시 실제 조사한 값만(추측 금지)
- **실적 요약 등록**: `docs/earnings.json` — `earnings[]`에 `{ticker, name, quarter, report_date, summary(내용요약), qa(어닝콜 Q&A 요약), full(전문 분석 마크다운), tags, guidance(선택 — "beat"|"miss"|"inline", 다음 분기 가이던스가 컨센서스 대비 상회/하회/부합했는지)}`. **수동 큐레이션** — 재무 수치(financials.json)·컨센서스 서프라이즈(earnings_calendar.json)는 자동이지만 실적 "내용·질문·전문·가이던스 판정"은 어닝콜 전문이 유료·저작권 콘텐츠라 자동 수집 불가. 반드시 내 언어로 요약(직접 인용 15단어 미만). "최근 발표 실적" 카드·모달은 earnings.json이 비어 있어도 earnings_calendar.json+financials.json만으로 동작함(요약만 "정리되지 않음"으로 표시)
- **메가캡 회사 개요 추가/보완**: `docs/megacap_profiles.json` — `profiles.{TICKER}.biz`에 "무엇을 하는 회사인지" 한 줄. **자동 갱신 대상이 아님** — `fetch_universe.py`가 주 1회 TOP300 명단을 재산정하면서 새 종목이 편입될 수 있는데, 이 파일은 그때 자동으로 채워지지 않는다. `fetch_megacap.py` 실행 로그에 `[안내] megacap_profiles.json에 회사개요 없는 신규 종목 N개: ...`가 뜨면 해당 티커의 개요를 채워 넣을 것 (모달은 개요가 없어도 "준비되지 않았습니다" 안내만 뜨고 깨지지는 않음)

## 일일 운영법

- **자동 (건드릴 것 없음)**: 평일 한국시간 오후 8:00에 `update.yml`이 `data.json`/`megacap.json` 갱신·커밋. 일요일 밤 `universe.yml`이 TOP300 명단 재산정. 두 워크플로는 `events/people.json`을 절대 건드리지 않음
- **3일 주기 (수동, 클로드 코드)**: repo 폴더에서 `claude` 실행 후 "세상 흐름 파악 업데이트" 프롬프트로 최근 발언·행사 preview/summary 갱신 → 커밋·푸시
- 인용 규칙: 인물 발언·기사는 반드시 요약 저장, 직접 인용은 15단어 미만, 출처 링크 필수

## 데이터 계약 (필드 요약)

- `data.json` — `etfs.{TICKER}`: `r1d/r1w/r1m/r3m/ytd`(수익률), `rel_*`(ACWI 대비 초과수익), `vol_ratio`(5일/20일 평균 거래대금 = 자금유입 프록시), `from_high`(52주 고점 대비 %), `spark/hist/candles/holdings/news`
- `megacap.json` — `stocks[]`: `ticker/name/sector/rank/mcap_usd/price/r1w/r1m/r3m/ytd/from_high/vol_ratio/pe_now/pe_next/spark/candles/news`
- `megacap_profiles.json` — `profiles.{TICKER}.biz`: 회사 개요 한 줄 (반자동, 위 "수정 지점" 참조)
- `financials.json` — `financials.{TICKER}`: `annual[]`·`quarterly[]` 각 `{date, rev, op, opm, rev_yoy, op_yoy, ccy, (분기: rev_qoq, op_qoq)}`. 매출·영업이익은 백만(현지통화) 단위. 야후 무료 API는 연 4·분기 5개까지만 줘서 매 실행마다 누적 → 시간이 지날수록 연 6·분기 10개까지 쌓임
- `earnings.json` — `earnings[]`: 실적 요약·Q&A·전문·가이던스 판정 (수동 큐레이션, 위 "수정 지점" 참조)
- `earnings_calendar.json` — `calendar.{TICKER}`: `next_earnings_date`(다음 발표일)·`is_estimate`·`consensus_eps`/`consensus_rev`(다음 분기 컨센서스) · `eps_history[]`(최근 분기 `{quarter_end, eps_actual, eps_estimate, eps_surprise_pct, eps_yoy}` — 야후가 즉시 4개 분기치를 주고 이후 누적) · `rev_consensus_snapshots`(분기말→매출 컨센서스, 발표 전 시점에 매 실행마다 스냅샷 저장 — 매출 서프라이즈는 이 스냅샷이 있어야 계산되므로 수집 시작 이후 발표분부터 채워짐)
- `events.json` / `people.json` / `theses.json` / `insights.json` — 스키마는 각 파일 참조 (필드명 유지 필수)
- `macro.json` — `latest_fear_greed`(현재 공포·탐욕 프록시 0~100)·`latest_components`(5개 하위지표) · `daily`(최근 3년 일별 `dates/spx/ixic/vix/hyg/lqd/tlt/fear_greed/drawdown_pct`) · `weekly`(1996년~ 주별 다운샘플, 동일 필드) · `macro_monthly`(FRED 10종: `cpi/ppi/pce/unrate/fedfunds/payems/icsa/m2/dgs10/umcsent`, 각 `[{date,value}]`) · `drawdown_episodes.{spx,ixic}`(10%+ 조정 전부, `{peak_date,trough_date,recovery_date,pct_decline,severity,ongoing}`)

## 안전장치

- 모든 외부 요청: User-Agent 명시, 요청 간 0.5초 이상, 3회 재시도 후 스킵
- `fetch_data.py`: 티커 80% 이상 실패 시 기존 `data.json` 유지 후 종료
- `fetch_universe.py`: 크럼 확보 실패·성공 종목 과소 시 기존 명단 유지
- 프론트: JSON 로드 실패 시에도 페이지가 깨지지 않고 안내 문구 표시
