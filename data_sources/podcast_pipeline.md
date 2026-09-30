# 팟캐스트 자동화 — 회사 PC Claude 예약 작업 절차

**언제**: 매일 **07:00 · 13:00 · 20:00 KST** (하루 3번)
**무엇을**: 5개 방송의 새 에피소드 → 영어 대본 확보 → Claude 스킬로 한국어 번역·요약 **아티팩트** → 사이트에 요약 페이지 → **텔레그램으로 링크**

| 방송 | id | 대본 얻는 곳(자동) |
|---|---|---|
| Invest Like the Best (Colossus) | `ilb` | 유튜브 자막 → 오디오 받아쓰기 (콜로서스 페이지는 앞부분만 공개) |
| Capital Allocators (Ted Seides) | `ca` | 유튜브 자막 → 오디오 받아쓰기 |
| Business Breakdowns (Colossus) | `bb` | 유튜브 자막 → 오디오 받아쓰기 |
| Dwarkesh Podcast | `dwarkesh` | 글 본문에 전체 대본 있음(페이지) |
| The MAD Podcast (Matt Turck) | `mad` | 유튜브 자막 → 오디오 받아쓰기 |

방송 추가·삭제는 `data_sources/podcasts.json` 한 곳만 고치면 된다. `[REPLAY]` 재방송은 자동으로 건너뛴다.

---

## A. 최초 설정 (한 번만)

1. 패키지
   ```bash
   pip install yt-dlp                 # 유튜브 자막
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
3. **Claude 스킬**: 회사 PC Claude에 `translate-summary-artifact` 스킬(영상·팟캐스트 번역 요약 아티팩트)이 설치돼 있어야 한다. 이 작업에서는 아래 **B-3의 추가 규칙**을 함께 준다.

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
- **한 번에 최대 3편**, 오래된 것부터. 남으면 다음 실행에서.
- 새 편이 없으면 **B-5(미전송 재시도)만 하고 끝낸다.**

### B-2. 대본 받기 (에피소드마다)
```bash
python podcast_transcript.py <id>
```
- 마지막 줄 JSON: `{"ok": true, "path": ".../data_sources/_podcast_tmp/<id>.txt", "chars": ..., "source": "page|youtube|audio", "youtube": "..."}`
- `ok: false`면 **대본 없이** 방송 소개글(index.json의 `desc`)과 에피소드 페이지로 짧은 요약만 쓰고 `"no_transcript": true` 표시(B-4). 아티팩트는 만들지 않는다.
- `_podcast_tmp/` 는 원문 대본이라 **절대 커밋하지 않는다**(.gitignore 처리됨). 작업이 끝나면 지워도 된다.

### B-3. 아티팩트 만들기 — `translate-summary-artifact` 스킬
스킬에 대본 파일과 에피소드 정보(방송명·제목·날짜·링크·유튜브 링크)를 주고 실행한다. **추가 규칙(반드시)**:

1. **맨 처음**: 원본 에피소드 링크(▶️ 원본 듣기 · 📺 유튜브)
2. 그다음 **머리 블록 4줄**
   - **제목**: 한국어 제목 (원제 병기)
   - **누구**: 게스트 이름 — 무엇을 하는 사람인지 한 줄 (예: "노아 신 — 개인 AI 비서 Instinct 창업자, 전 ...")
   - **어느 기업**: 회사명 (세부 섹터) — 무엇을 하는 회사인지 한 줄 (예: "Instinct (AI 에이전트·소비자 비서)")
   - **무슨 이야기**: 이 편의 핵심 주제 한 줄
3. 나머지는 스킬 기존 틀(히어로·목차·요약 박스·챕터별 정리) 그대로
4. **전체 대본 한국어 번역**을 챕터별(접이식)로 포함 — 요약하지 말고 번역만
5. 아티팩트는 **비공개(기본값)로 게시**하고 URL을 받는다 → `artifact_url`
   - 전체 번역은 원문 저작권 때문에 **공개 사이트·GitHub에는 올리지 않는다.** 아티팩트(본인만 열람)에만 둔다.

### B-4. 사이트용 요약 파일 쓰기 → `docs/data/podcasts/ep/<id>.json`
```json
{
  "id": "<id>",
  "title_ko": "한국어 제목",
  "guest":   {"name": "노아 신(Noah Shinn)", "role": "개인 AI 비서 Instinct 창업자 — 한 줄"},
  "company": {"name": "Instinct", "sector": "AI 에이전트 · 소비자 비서", "what": "문자·전화·메일로 일을 시키는 개인 AI 비서(비상장)"},
  "topic": "무슨 이야기 — 한 줄",
  "headline": "목록 카드에 뜰 한 줄 요지",
  "tldr": ["핵심 3~5개, 숫자·고유명사 포함", "..."],
  "summary_md": "### 1. 챕터 제목\n- 요점...\n### 2. ...",
  "insights_md": "### 투자 관점\n- 언급된 상장사·섹터·밸류체인과 연결\n- 수치(매출·성장률·가격·점유율)\n- 반론·리스크\n- 체크포인트",
  "tg": "텔레그램에 들어갈 3~5줄 요약",
  "artifact_url": "https://claude.ai/... (B-3에서 받은 비공개 아티팩트 링크)",
  "youtube": "https://www.youtube.com/watch?v=... (있으면)",
  "transcript_source": "page | youtube | audio | none",
  "no_transcript": false,
  "written": "2026-09-30 07:25 KST"
}
```
규칙
- 사이트(공개)에는 **요약·분석만**. 원문 인용은 한 문장 15단어 미만, 전체 번역 금지.
- `summary_md`는 챕터별로 충분히 자세히(한 편당 대략 2,000~4,000자), `insights_md`는 "그래서 투자자에게 뭐가 중요한가"에 집중.
- 모르는 건 쓰지 않는다(추측 금지). 수치는 대본에 나온 것만.

### B-5. 반영 → 텔레그램
```bash
python fetch_podcasts.py --pending   # ep/<id>.json 이 생긴 편을 done 으로 바꾸고 목록 카드 요약을 채움
git add docs/data/podcasts
git commit -m "podcast: <방송> <제목 요약> 외 N편 YYYY-MM-DD"
git pull --rebase --autostash origin main && git push
# 사이트 반영(1~2분)을 기다린 뒤
python send_telegram.py --podcast-pending   # 요약은 끝났고(done) 아직 안 보낸 편을 전부 보냄 → index.json 에 sent 기록
git add docs/data/podcasts/index.json && git commit -m "podcast: 텔레그램 전송 기록" && git pull --rebase --autostash origin main && git push
```
- 텔레그램 메시지 모양:
  ```
  🎙 [Invest Like the Best] 한국어 제목
  원제
  👤 게스트 — 한 줄
  🏢 회사 (세부 섹터)

  3~5줄 요약(tg)

  📝 요약·분석: https://minwook1011.github.io/vantage-0910/podcasts.html?id=<id>
  📄 전체 번역(아티팩트): <artifact_url>
  ▶️ 원본 듣기: <에피소드 링크>
  ```
- 전송이 실패하면(인터넷·토큰 문제) 상태가 `done`으로 남아 **다음 실행의 B-5에서 자동 재시도**된다. 이미 보낸 편(`sent`)은 다시 안 보낸다(`--force`로만 재전송).

---

## C. 점검

| 증상 | 확인 |
|---|---|
| 텔레그램이 안 옴 | `python send_telegram.py --test` / `telegram_bot.json` 의 token·chat_id |
| 유튜브 자막 429(Too Many Requests) | 잠시 뒤 다음 실행에서 재시도됨. 계속되면 Deno 설치 확인, `pip install -U yt-dlp`, 또는 faster-whisper 설치 |
| 사이트에 "요약 준비 중"만 뜸 | `docs/data/podcasts/ep/<id>.json` 이 커밋·푸시됐는지 |
| 같은 편이 두 번 옴 | index.json 의 `status: sent` 가 푸시됐는지(B-5 마지막 커밋) |

사이트: https://minwook1011.github.io/vantage-0910/podcasts.html
