# 일본 실적 리포트 — 요약·분석 작성 절차 (Claude 예약 작업용)

회사 PC의 Claude 예약 작업이 **실적 시즌(1·2·4·5·7·8·10·11월) 평일 12:10 · 13:40 · 16:10 · 17:30 · 19:30 KST**에 이 문서대로 실행한다.
(GitHub Actions `jp-earnings.yml`이 11:45 · 13:15 · 15:45 · 16:20 · 17:00 · 19:00에 그날 결산단신을 낸 종목의 표·그래프 재료와 원문 링크를 먼저 만든다.
 발표 → 사이트 표·그래프까지 약 15~40분, 요약·분석 글까지 약 30~60분.)

## 0. 준비
```bash
git pull --rebase --autostash origin main
```

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
- 완성 예시: `docs/data/jp/reports/notes/7974-202703-1Q.json` (닌텐도)

## 3. 쓰기 → `docs/data/jp/reports/notes/<rid>.json`
```json
{
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
- 사이트가 **표(요약 첫머리)와 그래프(분석 첫머리)를 자동으로 그린다** — 글에서 표를 다시 만들지 말고 해석에 집중.
- 금액은 **억엔**(백만엔 ÷ 100). 분기 표기는 `qs[].cq`(예: 2Q26 = 2026년 4~6월)와 회사 기준(2027년 3월기 1Q)을 함께.
- 원문에 없는 추측 금지. 원인을 모르면 "단신에 설명 없음"이라고 쓴다. 직접 인용은 15단어 미만.
- 한국어로, 투자 권유 표현 없이.

## 4. 목록 갱신 → 커밋
```bash
python -c "import fetch_jp_earnings_results as r; r.write_index()"
git add docs/data/jp/reports
git commit -m "notes: 일본 실적 요약·분석 N건 $(date +%Y-%m-%d)"
git pull --rebase --autostash origin main && git push
```
리포트 주소: `https://<사이트>/jp-report.html?id=<rid>` (텔레그램 링크로 쓸 예정)
