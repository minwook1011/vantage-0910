# 미국 실적 리포트 — 원문 정리(한글)·딥리서치 분석 작성 절차 (Claude 예약 작업용)

이 PC의 Claude 예약 작업 `vantage-us-earnings`가 **매일 05:50 · 07:50 · 21:50 · 23:50 KST**에 이 문서대로 실행한다.
(미국 발표는 장 전 = 미 동부 06:00~08:30 → 한국 19:00~21:30, 장 마감 후 = 16:00~16:30 → 한국 05:00~05:30에 몰린다. 회사는 보도자료와 함께 SEC에 8-K를 낸다.)
일본 절차서 `data_sources/jp_earnings_notes.md`와 같은 틀이다 — 다른 점만 아래에 적는다.

## 0. 발표일 캘린더 (놓치면 안 됨)
- 발표 예정일: `docs/data/us/earnings_dates.json` — **나스닥 거래소 실적 캘린더**(`fetch_us_earnings_dates.py`, 예약 작업 `vantage-calendars`가 매일 07:40·18:40). 뉴스 검색·추정치는 쓰지 않는다.
- 실제 발표 확인: **SEC EDGAR 8-K, Item 2.02(Results of Operations)** — 공식 공시. 보도자료 원문은 8-K 첨부 EX-99.1.

## 1. 수집 (공용 폴더 git 은 건드리지 않는다 — 전용 폴더에서 푸시까지)
```bash
python C:\dev\vantage-0910\pc_job.py --name us-results -m "data: 미국 실적 리포트 갱신 {now} KST (PC)" --add docs/data/us/reports -- python fetch_us_earnings_results.py
git pull --rebase --autostash origin main     # 그다음 공용 폴더를 최신으로
```
- 예정일이 지났는데(최근 10일) 리포트가 없는 종목마다 SEC 제출 목록에서 8-K(2.02)를 찾아 `docs/data/us/reports/<티커>-<분기말YYYYMM>.json`을 만든다.
- 분기 표는 데이터 허브의 SEC XBRL 분기 실적(백만 달러). 막 발표한 분기는 분기 보고서(10-Q) 전이라 XBRL에 없을 때가 많다 → 야후 분기 손익(매출·순이익)으로 먼저 채우고 `src:"yahoo"`(영업이익은 빈칸일 수 있음).
- 새로 잡힌 게 없고 요약할 것도 없으면 **여기서 끝낸다**.

## 2. 대상 고르기
- `docs/data/us/reports/index.json`의 `reports[]` 중 `note == false`이고 발표일 `d`가 최근 10일 이내. **오늘 발표분 먼저, 시총(`mc`, 억 달러) 큰 순, 한 번에 최대 15건.**

## 3. 한 건씩 읽기
- 재료 `docs/data/us/reports/<rid>.json`: `qs`(최근 8개 분기), `ann`(연간), `rec`(발표 시각 pre/after·EPS 컨센서스 `cons`·주가 반응 `px`·`q_ready`), `docs`(보도자료 `release`·8-K `8k`).
- **보도자료(EX-99.1)를 끝까지 읽는다.** SEC는 연락처 형식 User-Agent가 필요하다:
  ```bash
  curl -s -A "VantageResearch data-bot@vantage-research.dev" "<docs[release].url>" -o /tmp/r.htm
  python -c "import re,html;t=open('/tmp/r.htm',encoding='utf-8',errors='replace').read();t=re.sub(r'<(script|style)[^>]*>.*?</\1>','',t,flags=re.S|re.I);print(html.unescape(re.sub(r'<[^>]+>',' ',t)))" | tr -s ' \n'
  ```
  요약 수치, 경영진 코멘트, 사업부·지역별 매출, 가이던스(다음 분기·연간), 손익계산서·재무상태표·현금흐름표, GAAP↔Non-GAAP 조정표까지.
- **`rec.q_ready == false`이거나 분기 표 마지막 칸이 `src:"yahoo"`이면** 보도자료의 매출·영업이익·순이익(GAAP)을 `notes`의 `q_fix`에 넣는다(아래 4) — 사이트 표가 그 값으로 바뀌지는 않지만 글에서 바른 숫자를 쓴다.
- 미국 기업은 분기 숫자가 누계가 아니라 **3개월 그대로** 나온다(일본과 달리 역산 불필요). 다만 회계연도가 달력과 다른 회사가 많다(나이키 5월 결산 등) — 분기 이름은 사이트 표기(`cq`)를 먼저, 회사 기준(2027 회계연도 1분기)은 괄호로.

## 3-1. 최근 뉴스 (뭐 하는 기업인가 · 최근 이슈)
- 공식 출처 우선: 회사 IR 보도자료(보도자료 목록·Business Wire·PR Newswire·GlobeNewswire 원문), SEC 8-K 목록(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=<티커>&type=8-K`). 그다음 주요 경제지(로이터·블룸버그·WSJ·CNBC) 기사. 출처는 `sources`에.

## 3-2. 딥리서치 — 보도자료 밖 자료로 검증 (필수, 3개 이상)
- 실적 발표 콜(어닝콜) 요지: 회사 IR 페이지의 녹취·발표 슬라이드, 또는 신뢰할 만한 콜 요약 기사.
- 같은 시기 발표한 동종 기업 2~3곳의 매출·이익 증감률, 업계 지표.
- 회사가 든 이유를 바깥 자료로 확인. 확인이 안 되면 "확인 못 함".

## 4. 쓰기 → `docs/data/us/reports/notes/<rid>.json`
일본과 같은 필드: `rid, written, by, about, issues, headline, summary_md, analysis_md, orig_md, tg, sources` (+ 필요하면 `q_fix: {"rev":…, "op":…, "ni":…, "eps":…}` 백만 달러·달러).
- `about`: 뭐 하는 기업인가 2줄 — 한국 투자자가 읽고 바로 알 수 있게.
- `issues`: 최근 이슈 4~5개, **날짜 + 한 줄 제목** — 의미 한두 문장.
- `orig_md`: 보도자료를 원문 순서대로 한국어 정리. 제목 6개 고정 —
  `### 1. 요약 수치`(매출·영업이익·순이익·EPS GAAP/Non-GAAP, 전년 대비 표) · `### 2. 경영진 코멘트 요지` · `### 3. 사업부·지역별 실적`(표) · `### 4. 가이던스` · `### 5. 재무상태·현금흐름·주주환원`(자사주·배당) · `### 6. 주석`(일회성 항목·회계 변경·GAAP 조정).
  숫자와 표는 빠짐없이, **억 달러**로(백만 달러 ÷ 100, 1,000억 달러 이상은 정수, 그 아래 소수 첫째 자리). 주당 값은 달러 그대로. 설명 글은 문장 번역 금지 — 줄여서 다시 쓰기. 직접 인용 15단어 미만, 한 건에 많아야 1개.
- `analysis_md`: 일본과 같은 9개 항목(`### 1. 한 줄 결론` … `### 9. 다음 발표 전 체크포인트`), 2,500~4,000자.
  5번은 「가이던스·컨센서스」 — 회사 가이던스(다음 분기·연간)와 컨센서스(`rec.cons`, 매출 컨센서스는 `docs/earnings_calendar.json`의 `rev_consensus_snapshots`) 대비.
- 공통: 전부 한국어(회사·제품 이름은 원문 영어 그대로 써도 된다 — 영어 표기는 허용, 문장은 한국어). 출처 없는 추측 금지. 투자 권유 표현 금지. 사이트가 분기 표·그래프를 자동으로 그리니 그 표를 다시 만들지 말 것.

## 4-0. 문체
일본 절차서 `data_sources/jp_earnings_notes.md` 의 **3-0. 문체 — 읽기 쉽게** 를 그대로 따른다(꼬리표 금지 · 결론 먼저 · 한 문장 한 가지 · 영어 약어 풀어 쓰기 · AI 말투 금지). 완성 예시: `JBL-202608`.

## 4-1. 질의응답 (`qa`) — 2026-10-07 사용자 요청: 실적 리포트에 질의응답 내용을 다 넣을 것
- 찾을 곳: 실적 컨퍼런스콜 녹취(도구 `earnings_call_transcript`·`earnings_calls`, 없으면 회사 IR 페이지·신뢰할 만한 콜 요약 기사). 콜은 보통 발표 당일이라 리포트를 쓸 때 같이 채운다. 아직 녹취가 없으면 `qa: {"items": [], "note": "컨퍼런스콜 녹취 대기(YYYY-MM-DD HH:MM 확인)"}` 로 두고, **발표 7일 안의 리포트 중 qa 가 빈 것은 실행 때마다 다시 찾는다**.
- 쓰는 법: 질의응답 순서대로 **애널리스트 질문을 빠짐없이**(보통 8~20개). 질문 1문장, 답 2~4문장을 **우리말로 줄여 다시 쓴다** — 녹취 문장 번역·통째 옮기기 금지, 직접 인용은 넣지 않는다. 숫자·기간·가이던스·제품명은 빠뜨리지 않는다. `topic`(예: "관세", "가이던스", "맥주 수요") 을 붙인다. 질문한 사람의 소속(증권사)은 topic 뒤에 괄호로 적어도 된다.
- 형식: `"qa": {"src": "실적 컨퍼런스콜 질의응답", "date": "YYYY-MM-DD", "url": "녹취·다시듣기 주소(있으면)", "items": [{"topic": "…", "q": "…", "a": "…"}], "note": "(선택)"}`.
- 콜에서 나온 새 사실은 `analysis_md` 해당 항목에도 반영한다.

## 5. 목록 갱신 → 커밋
```bash
python -c "import fetch_us_earnings_results as r; r.write_index()"
git add docs/data/us/reports
git commit -m "notes: 미국 실적 요약·분석 N건 $(date +%Y-%m-%d)"
git pull --rebase --autostash origin main && git push
```
리포트 주소: `https://minwook1011.github.io/vantage-0910/us-report.html?id=<rid>`
