# 팟캐스트 자동화 — Claude 예약 작업 절차

**언제**: **매시간 :15** (새 편이 없으면 바로 끝) · GitHub `podcasts.yml`도 06:47·12:47·19:47에 새 편 감지
**무엇을**: 6개 방송의 새 에피소드 → 영어 대본 확보 → 내용 요약 → **딥 리서치**(외부 자료로 검증·확장) → 사이트에 게시

| 방송 | id | 대본 얻는 곳(자동) |
|---|---|---|
| Invest Like the Best (Colossus) | `ilb` | 유튜브 자막 → 오디오 받아쓰기 (콜로서스 페이지는 앞부분만 공개) |
| Capital Allocators (Ted Seides) | `ca` | 유튜브 자막 → 오디오 받아쓰기 |
| Business Breakdowns (Colossus) | `bb` | 유튜브 자막 → 오디오 받아쓰기 |
| Dwarkesh Podcast | `dwarkesh` | 글 본문에 전체 대본 있음(페이지) |
| The MAD Podcast (Matt Turck) | `mad` | 유튜브 자막 → 오디오 받아쓰기 |
| The Synopsis (Drew Cohen) | `synopsis` | 유튜브 자막 → 오디오 받아쓰기 |

방송 추가·삭제는 `data_sources/podcasts.json` 한 곳만 고치면 된다. `[REPLAY]` 재방송은 자동으로 건너뛴다.

---

## A. 최초 설정 (한 번만)

1. 패키지
   ```bash
   pip install -U "yt-dlp[default,curl-cffi]"   # 유튜브 자막(curl-cffi 가 있어야 429 차단을 덜 받는다)
   winget install DenoLand.Deno       # yt-dlp 가 유튜브를 제대로 읽으려면 JS 실행기 필요(권장)
   pip install faster-whisper         # (선택) 유튜브가 막힐 때 오디오를 직접 받아쓰기 — 1시간 분량에 CPU 10~30분
   ```
2. **텔레그램 봇** (`send_telegram.py` 맨 위 설명과 같음)
   1) 텔레그램 @BotFather → `/newbot` → 이름 정하기 → **토큰** 받기
   2) 만든 봇과 대화방을 열고 아무 말이나 한 번 보내기
   3) 저장소 폴더에 `telegram_bot.json` 만들기 — `.gitignore`에 있어 GitHub에 **안 올라간다**
      ```json
      {"token": "123456:ABC...", "chat_id": ""}
      ```
   4) `python send_telegram.py --chat-id` → 나온 숫자를 `chat_id`에 넣기
   5) `python send_telegram.py --test` → "✅ VANTAGE 알림 테스트"가 오면 끝
3. 별도 스킬은 필요 없다. 아래 B-3·B-4 형식대로 쓰면 된다.

---

## B. 매 실행 절차

### B-0. 최신화
```bash
git pull --rebase --autostash origin main
```

### B-1. 새 에피소드 찾기
```bash
python fetch_podcasts.py            # 새 편을 docs/data/podcasts/index.json 에 올림
python fetch_podcasts.py --pending  # 처리할(new) 에피소드 id 목록(JSON)
```
- **새로 올라온 편은 바로 한국어 제목·소개를 단다**(요약 전이라도 사이트가 한글로 보이게): `docs/data/podcasts/index.json`의 그 편에
  `"title_ko"`(예: "Noah Shinn — Instinct 만들기: 개인 에이전트 (493회)" — **사람·회사 이름은 원문 그대로**, 나머지는 한국어, 회차는 "(493회)")와
  `"desc_ko"`(원문 소개글 `desc`의 한국어 번역, 3~5문장)를 넣는다. 재방송(`status: skip`)도 제목만은 "[재방송] …"으로 단다.
- **주제 거르기(2026-10-07 사용자 지시)**: 주식·투자·기업·경제·금융시장, AI·반도체·소프트웨어 같은 기술 산업과 관련된 편만 올린다. 역사·정치 일반·건강·자기계발·스포츠처럼 관련 없는 편은 한국어 제목만 달고 `"status": "skip"`, `"reason": "주제 무관 — …"`으로 두고 요약하지 않는다(사이트 목록에 안 뜸). 애매하면(예: 신경기술 스타트업·바이오 기업 투자) 기업·산업 이야기가 중심이면 올린다.
- **한 번에 최대 3편**, 오래된 것부터. 남으면 다음 실행에서.
- 새 편이 없으면 **아무것도 하지 말고 끝낸다.**

### B-2. 대본 받기 (에피소드마다)
```bash
python podcast_transcript.py <id>
```
- 마지막 줄 JSON: `{"ok": true, "path": ".../data_sources/_podcast_tmp/<id>.txt", "chars": ..., "source": "page|youtube|audio", "youtube": "..."}`
- `ok: false`면 **대본 없이** 방송 소개글(index.json의 `desc`)과 에피소드 페이지로 짧은 요약만 쓰고 `"no_transcript": true` 표시(B-4).
- `_podcast_tmp/` 는 원문 대본이라 **절대 커밋하지 않는다**(.gitignore 처리됨). 작업이 끝나면 지워도 된다.

### B-3. 딥 리서치 (대본 + 외부 자료)
대본을 끝까지 읽은 뒤, **대본에 나온 주장·숫자를 외부 자료로 검증하고 확장**한다. 목표는 "이 편을 안 들어도 되는" 수준의 정리 + 투자자에게 필요한 맥락.

1. **사실 확인**: 게스트·회사의 기본 정보(설립·투자 유치·기업가치·매출·고객·경쟁사)를 웹 검색으로 확인한다. 대본 수치와 다르면 둘 다 적고 어느 쪽이 최신인지 밝힌다.
2. **밸류체인 연결**: 언급된 회사·기술이 어느 상장사·섹터와 이어지는지(공급사·고객·경쟁사·대체재). 한국·미국·일본 상장사를 구체적으로.
3. **수치의 맥락**: 대본에 나온 숫자(매출·성장률·가격·점유율·시장 규모)를 업계 자료와 나란히 놓는다.
4. **반론**: 게스트 주장에 대한 반대 시각·리스크를 외부 자료로 찾는다(경쟁사 입장, 회의론, 과거 비슷한 사례).
5. **체크포인트**: 앞으로 무엇을 보면 이 이야기가 맞았는지 알 수 있는가(지표·이벤트·날짜).

규칙
- 외부 출처 **최소 4개**, 전부 `sources`에 넣는다. 출처 없는 추측 금지 — 모르면 "확인 못 함"이라고 쓴다.
- **대본 전문은 옮기지 않는다.** 사이트·아티팩트 어디에도 전체 번역·긴 발췌를 싣지 않는다(저작권). 직접 인용은 편당 1개 이하, 15단어 미만. 나머지는 전부 자기 말로 요약.
- 화면 글자는 사람·회사 이름만 원문, 나머지는 한국어. 투자 권유 표현 금지.

### B-4. 사이트용 파일 쓰기 → `docs/data/podcasts/ep/<id>.json`
```json
{
  "id": "<id>",
  "title_ko": "한국어 제목",
  "guest":   {"name": "노아 신(Noah Shinn)", "role": "개인 AI 비서 Instinct 창업자 — 한 줄"},
  "company": {"name": "Instinct", "sector": "AI 에이전트 · 소비자 비서", "what": "문자·전화·메일로 일을 시키는 개인 AI 비서(비상장)"},
  "topic": "무슨 이야기 — 한 줄",
  "headline": "목록 카드에 뜰 한 줄 요지",
  "tldr": ["핵심 4~6개, 숫자·고유명사 포함"],
  "summary_md": "### 1. 챕터 제목 / - 요점...  (대화 흐름 순서, 3,000~5,000자)",
  "insights_md": "### 투자 관점 / - 언급된 상장사·섹터·밸류체인 / - 수치 / - 반론·리스크 / - 체크포인트  (1,000~2,000자)",
  "deep_md": "### 1. 회사·게스트 팩트 체크 / ... / ### 2. 밸류체인과 관련 상장사 / ... / ### 3. 숫자의 맥락 / ... / ### 4. 반론과 리스크 / ... / ### 5. 앞으로 볼 것  (B-3 결과, 2,500~4,000자)",
  "sources": [{"label": "출처 이름 — 무엇을 확인했나", "url": "https://..."}],
  "charts": [{"at": "tldr", "title": "그래프 제목", "sub": "한 줄 설명(단위·기간)", "type": "bar | hbar | line", "unit": "억 달러", "labels": ["2023", "2024", "2025"], "series": [{"name": "매출", "values": [1.2, 3.4, 5.0]}], "note": "읽는 법 한 줄", "source": "출처 이름"}],
  "tg": "3~5줄 요약(텔레그램 연동 시 사용)",
  "youtube": "https://www.youtube.com/watch?v=... (있으면)",
  "image": "게스트 얼굴 사진 URL (선택. 유튜브 링크가 있으면 https://i.ytimg.com/vi/<영상ID>/hqdefault.jpg)",
  "transcript_source": "page | youtube | audio | none",
  "no_transcript": false,
  "written": "2026-09-30 07:25 KST"
}
```
그래프 (`charts`) — **매 편 반드시 3~5개**
- `at`: 그래프를 넣을 칸. `"tldr"`(핵심 요약 바로 아래, 이 편을 한눈에 보여 주는 대표 그래프 1개) · `"summary"` · `"insights"` · `"deep"`(딥 리서치에서 외부 자료로 만든 비교 그래프 2~3개).
- `type`: `bar`(기간·항목 비교, 여러 계열 가능) · `hbar`(회사·항목끼리 크기 비교, 이름이 길 때) · `line`(시간에 따른 추이).
- 숫자는 **대본에 나온 수치 또는 `sources`에 넣은 외부 자료의 수치만.** 출처가 다른 숫자를 한 그래프에 섞지 않는다. 추정치를 쓰면 `note`에 "추정"이라고 쓴다.
- 좋은 예: 회사 매출·ARR·기업가치 추이(line/bar), 경쟁사 규모 비교(hbar), 시장 규모·점유율(hbar), 게스트가 든 핵심 수치 전후 비교(bar), 관련 상장사 실적·주가 지표(bar).
- **그래프는 그 내용이 나오는 자리에 넣는다(2026-10-03 요청, 맨 아래 몰아넣기 금지)**: `summary_md`·`insights_md`·`deep_md` 안에서 그 수치를 이야기하는 문단 바로 다음 줄에 `[[chart:N]]` 한 줄(빈 줄로 앞뒤 구분, N은 `charts` 배열 1부터 순서). 모든 그래프에 자리 표시를 단다. 표시가 없는 그래프만 예전처럼 `at` 칸 끝에 붙는다.
- 같은 내용을 글로 반복하지 말고, 그래프 아래 `note`에 "무엇을 읽어야 하는지" 한 줄.

규칙
- `summary_md`는 대화 순서대로 챕터를 나눠 자세히. `deep_md`는 대본 밖 자료로 쓴 부분임이 드러나게.
- 모르는 건 쓰지 않는다. 대본 수치와 외부 수치를 구분해 쓴다.
- **본문 핵심 단어 볼드(2026-10-03 요청)**: `summary_md`·`insights_md`·`deep_md` 본문(문단·글머리)에서 핵심 단어를 `**굵게**`. 문단·글머리 하나에 **0~2개**, 대략 300~400자에 1개 — 편 전체로 summary 12~18개, insights 4~7개, deep 8~12개. 대상은 결론을 담은 핵심 개념·숫자·회사/제품 이름처럼 2~8단어 짧은 구절. 문장 통째·제목(###) 안·"대본에서:" 같은 꼬리표만 굵게 하는 것은 금지(꼬리표 볼드는 개수에 안 셈). 밑줄(`__단어__`)은 지금처럼 섹션마다 1개 이하로 따로 유지.

### B-5. 반영
```bash
python fetch_podcasts.py --pending   # ep/<id>.json 이 생긴 편을 done 으로 바꾸고 목록 카드 요약을 채움
git add docs/data/podcasts
git commit -m "podcast: <방송> <제목 요약> 외 N편 YYYY-MM-DD"
git pull --rebase --autostash origin main && git push
```
- **텔레그램은 아직 연동하지 않는다(2026-09-30 결정).** 연동하게 되면 A-2대로 봇을 만들고 `python send_telegram.py --podcast-pending` 를 이 뒤에 붙인다.

---

## C. 점검

| 증상 | 확인 |
|---|---|
| 텔레그램이 안 옴 | `python send_telegram.py --test` / `telegram_bot.json` 의 token·chat_id |
| 유튜브 자막 429(Too Many Requests) | 잠시 뒤 다음 실행에서 재시도됨. 계속되면 Deno 설치 확인, `pip install -U yt-dlp`, 또는 faster-whisper 설치 |
| 사이트에 "요약 준비 중"만 뜸 | `docs/data/podcasts/ep/<id>.json` 이 커밋·푸시됐는지 |
| 같은 편이 두 번 옴 | index.json 의 `status: sent` 가 푸시됐는지(B-5 마지막 커밋) |

사이트: https://minwook1011.github.io/vantage-0910/podcasts.html
