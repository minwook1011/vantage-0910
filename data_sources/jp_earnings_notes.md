# 일본 실적 리포트 — 요약·분석 작성 절차 (Claude 예약 작업용)

회사 PC의 Claude 예약 작업이 **실적 시즌(1·2·4·5·7·8·10·11월) 평일 11:45 · 13:15 · 15:45 · 16:20 · 17:00 · 19:00 KST**에 이 문서대로 실행한다.
⚠️ 2026-09-30부터 **수집도 회사 PC가 한다** — 카부탄이 GitHub 서버 요청을 막아 GitHub Actions 수집을 껐다.
(일본 발표는 11:30·13:00·15:00~15:30·16:00~17:00에 몰린다. 발표 → 표·그래프 약 15분, 요약까지 약 30~40분.)

## 0. 준비 + 수집
```bash
git pull --rebase --autostash origin main
python fetch_jp_earnings_results.py        # 오늘 결산단신을 낸 종목(카부탄 '決算' 개시 목록)만 골라 리포트 재료·원문 링크 생성
```
- 새로 잡힌 게 없고 요약할 것도 없으면 **여기서 끝낸다**(토큰 절약).
- 일요일 09:00에는 별도 작업이 `python fetch_jp_earnings_dates.py` + `python fetch_jp_earnings_results.py --full`(전 종목, 약 40~60분)을 돌린다.

## 1. 대상 고르기
- `docs/data/jp/reports/index.json`의 `reports[]` 중 `note == false` 이고 발표일 `d`가 최근 10일 이내인 것. **오늘 발표분을 가장 먼저.**
- **주요 기업(`u`에 "major") 먼저, 그다음 소비재**, 각각 시총(`mc`) 큰 순. **한 번에 최대 30건.** 남은 건 다음 실행에서.

## 2. 한 건씩 읽기
- 재료: `docs/data/jp/reports/<rid>.json`
  - `qs`: 최근 8개 분기(백만엔, `cq` = 달력 분기 라벨, `yoy`/`qoq` %) · `ann`: 연간 실적과 회사 예상(`est: true`)
  - `rec`: 가이던스 대비(`beat`)·진척률(`progress`)·가이던스 수정(`revision`)·다음 기 예상(`next_guide`)·EPS 컨센서스(`cons`)·주가 반응(`px`)
  - `docs`: 결산단신(`tanshin`)·설명자료(`deck`) PDF 링크
- **결산단신 PDF를 반드시 읽는다.** WebFetch는 일본어 PDF를 못 읽으므로 내려받아 pypdf로 텍스트를 뽑는다:
  ```bash
  pip install -q pypdf
  curl -s -A "Mozilla/5.0" -o /tmp/t.pdf "<docs[].url>"
  python -c "from pypdf import PdfReader; r=PdfReader('/tmp/t.pdf'); print('\n'.join(p.extract_text() for p in r.pages[:8]))"
  ```
  1페이지 요약표 + 「経営成績等の概況」(실적 개요) + 세그먼트 정보 + 통기 예상 수정 여부. 설명자료가 있으면 핵심 슬라이드도.
- 완성 예시: `docs/data/jp/reports/notes/8227-202702-2Q.json` (시마무라 — 누계에서 분기 역산, about·issues·trend_kw 포함), `7974-202703-1Q.json` (닌텐도)

## 2-1. 최근 뉴스 찾기 (뭐 하는 기업인가 · 최근 이슈)
- 카부탄 종목 뉴스 `https://kabutan.jp/stock/news?code=<code>` 목록에서 최근 1~2개월 기사 제목을 보고, 중요한 것(실적 반응·증권사 의견 변경·인수합병·신제품·협업·주주환원)은 기사 본문까지 읽는다:
  ```bash
  curl -s -A "Mozilla/5.0" "https://kabutan.jp/stock/news?code=<code>"                # 목록
  curl -s -A "Mozilla/5.0" "https://kabutan.jp/stock/news?code=<code>&b=<기사ID>"     # 본문(<div class="body">)
  ```
- 필요하면 웹 검색(회사명 + 「ニュース」)으로 보충. 출처는 `sources`에 넣는다.

## 3. 쓰기 → `docs/data/jp/reports/notes/<rid>.json`
```json
{
  "about": "뭐 하는 기업인가 — 2줄(줄바꿈 
). 무엇을 팔고, 어디서 돈을 버는지. 일본을 모르는 사람이 읽고 바로 알 수 있게",
  "issues": ["최근 이슈 4~5개. **날짜 + 한 줄 제목** — 무슨 일이 있었고 주가·실적에 어떤 의미인지 한두 문장"],
  "trend_kw": "구글 트렌드 검색어(소비재만). 일본 소비자가 실제로 검색하는 브랜드명 그대로(예: しまむら, Nintendo Switch 2)",
  "trend_label": "화면에 보일 한국어 이름(예: 시마무라)",
  "rid": "7974-202703-1Q",
  "written": "2026-09-29 22:10 KST",
  "by": "Claude",
  "headline": "한 줄 제목 — 무엇이 좋았고 무엇이 나빴나",
  "summary_md": "- 3~6개 불릿. 숫자(억엔, %)를 넣어서. 가이던스·컨센서스 대비, 이익률 변화, 가이던스 수정 여부, 주가 반응",
  "analysis_md": "### 세그먼트·사업별\n...\n### 이익률이 움직인 이유\n...\n### 가이던스와 남은 분기\n...\n### 체크포인트\n- ...",
  "tg": "텔레그램용 3~5줄 요약(나중에 텔레그램 발송에 씀). 마지막 줄 없이 본문만",
  "sources": [{"label": "결산단신", "url": "https://tdnet-pdf.kabutan.jp/..."}]
}
```
규칙
- **전부 한국어로 쓴다. 일본어(가나·한자) 금지** — 회사·브랜드·상품·게임 이름도 한국어 발음이나 통용되는 한국어 이름으로(しまむら→시마무라, アベイル→아베일, 『トモダチコレクション』→『토모다치 컬렉션』). 예외는 `trend_kw`(검색용) 하나뿐.
- **분석은 이번에 발표한 분기 3개월만** — 결산단신은 누계(상반기·3분기 누계)로 나오므로, 사업별 숫자도 `이번 누계 − 직전 분기 누계`로 3개월치를 계산해서 쓴다(전년 같은 분기도 같은 방법: 누계 ÷ (1+YoY)로 전년 누계를 구해 뺀다). 직전 분기 결산단신은 카부탄 개시 목록 `https://kabutan.jp/stock/news?code=<code>&nmode=3`에서 찾는다.
  「상반기」「하반기」「누계」 같은 말은 쓰지 않는다. 연간 계획 대비 진척은 "3~8월 두 분기에 331억엔 → 남은 두 분기에 337억엔 필요"처럼 분기 말로 쓴다.
- 분기 이름은 사이트 표기(`qs[].cq`, 달력 기준: 3Q26 = 2026년 6~8월 또는 7~9월)를 먼저, 회사 기준(2027년 2월기 2분기)은 괄호로.
- 사이트가 **표(요약 첫머리)와 그래프(분석 첫머리)를 자동으로 그린다** — 글에서 표를 다시 만들지 말고 해석에 집중.
- 금액은 **억엔**(백만엔 ÷ 100). 분기 표기는 `qs[].cq`(예: 2Q26 = 2026년 4~6월)와 회사 기준(2027년 3월기 1Q)을 함께.
- 원문에 없는 추측 금지. 원인을 모르면 "단신에 설명 없음"이라고 쓴다. 직접 인용은 15단어 미만.
- 한국어로, 투자 권유 표현 없이.

## 4. 목록·주가·트렌드 갱신 → 커밋
```bash
python -c "import fetch_jp_earnings_results as r; r.write_index()"
pip install -q trendspy
python fetch_jp_px.py --codes <이번에 쓴 종목 코드들, 쉼표로>   # 리포트 주가 차트(px/) + 소비재 구글 트렌드(trends/)
git add docs/data/jp/reports docs/data/jp/px docs/data/jp/trends
git commit -m "notes: 일본 실적 요약·분석 N건 $(date +%Y-%m-%d)"
git pull --rebase --autostash origin main && git push
```
리포트 주소: `https://minwook1011.github.io/vantage-0910/jp-report.html?id=<rid>`

## 5. (선택) 텔레그램
푸시하고 1~2분 뒤 `python send_telegram.py --jp-report <rid>` — notes 의 `tg` 문장 + 리포트 링크를 보낸다(주요 기업·보유 종목만 보내는 걸 권장).
