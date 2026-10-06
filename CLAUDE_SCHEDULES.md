# 클로드에 넘길 VANTAGE 예약 작업

작성: 2026-10-06 · 시간대: Asia/Seoul(한국시간)

이 문서는 등록용 전달 자료다. 이번 작업에서는 예약 작업을 생성하거나 기존 스케줄을 변경하지 않았다.

## 요청한 스케줄

| 작업 | 주기 | 대상 |
|---|---|---|
| 매크로 첫 화면 갱신 | 매일 1시간마다, 매시 05분 | Fear & Greed, 미국 국채금리, WTI 원유 선물 |

주말에도 최신 관측치를 확인한다. 장이 닫혔거나 원천 데이터가 발표되지 않으면 숫자는 그대로일 수 있다. **수집 주기와 원천 데이터 갱신 주기는 다르다.**

## 클로드에 그대로 전달할 요청

```text
C:\dev\vantage-0910의 매크로 첫 화면 데이터를 1시간마다 갱신하는 예약 작업을 등록해줘.

이름: VANTAGE 매크로 매시간 갱신
시간대: Asia/Seoul
반복: 매일 매시 05분 (00:05부터 23:05까지, 주말 포함)

1. 이 저장소의 CLAUDE_SCHEDULES.md를 읽고 아래 실행 명령을 사용해.
2. 같은 목적의 작업이 이미 있다면 중복 생성하지 말고 기존 작업을 갱신해.
3. 전용 작업 폴더는 pc_job.py가 관리하는 macro-hourly를 사용해.
   사용자가 편집 중인 C:\dev\vantage-0910에서 reset/clean을 직접 실행하지 마.
4. 앞선 실행이 끝나지 않았으면 겹쳐 실행하지 말고 해당 회차를 건너뛰어.
5. 성공한 결과만 docs/macro.json, docs/macro_dash.json 두 파일로 커밋·푸시해.
   pc_job.py가 수집, 지정 파일 커밋, 원격 동기화와 푸시를 처리해.
6. 실패하면 기존 값을 보존하고 실패 사실과 원인을 기록해.
   원천 관측일을 실행 시각으로 덮거나 누락 값을 0으로 만들지 마.
   종료 코드가 0이어도 docs/macro_dash.json의 watch_status에서
   fail: 항목이 있으면 부분 실패로 기록하고 알려줘.
7. 완료 후 사이트 배포가 실제로 반영됐는지 확인하고,
   변화가 없거나 정상인 매회 실행에는 알림을 보내지 마.
   수집·푸시·배포 실패 또는 사용자 조치가 필요할 때만 알려줘.

등록 전에 변경된 fetch_macro.py의 --market-only와
fetch_macro_dash.py의 --watch-only 코드가 origin/main에 반영돼 있는지 확인해.
최초 1회 수동 실행으로 세 지표와 관측일, 수집 시각, 사이트 반영을 검증해.
```

## 실행 명령

PowerShell 작업 디렉터리: `C:\dev\vantage-0910`

```powershell
python pc_job.py --name macro-hourly -m "data: 매크로 핵심 지표 {now} KST" --add docs/macro.json docs/macro_dash.json -- python -c "import subprocess,sys; subprocess.run([sys.executable,'fetch_macro.py','--market-only'],check=True); subprocess.run([sys.executable,'fetch_macro_dash.py','--watch-only'],check=True)"
```

처음 확인할 때 수집만 각각 실행하는 명령:

```powershell
python fetch_macro.py --market-only
python fetch_macro_dash.py --watch-only
```

`pc_job.py`는 `C:\dev\vantage-jobs\macro-hourly` 전용 체크아웃을 원격 최신 코드로 맞춘다. 따라서 아직 커밋·푸시되지 않은 로컬 수집기 변경은 예약 작업에서 사용되지 않는다. 클로드에서 등록할 때 이 전제부터 확인한다.

## 데이터와 갱신 범위

| 항목 | 화면·저장 위치 | 수집 방식과 표시 기준 |
|---|---|---|
| Fear & Greed | `docs/macro.json` | 기존 5개 시장 지표로 산출한 자체 공포·탐욕 **프록시**. CNN 공식 지수로 표기하지 않는다. 시장 가격을 다시 읽어 계산하고 실제 일봉 기준일을 표시한다. |
| 미국 국채금리 | `docs/macro_dash.json`의 `yields`, 금리 지표 | 미 재무부의 최신 일별 관측치를 확인한다. 1시간마다 확인해도 원천 값은 일별로 발표된다. |
| 유가 | `docs/macro_dash.json`의 `indicators.wti`, `markets["CL=F"]` | Yahoo의 WTI 원유 **선물**, 달러/배럴. 현물이나 원유 ETF 가격으로 혼동하지 않게 표시한다. |

매시간 실행에서는 BLS·BEA·FRED의 전체 경제지표와 캘린더를 재수집하지 않는다. `--market-only`는 기존 월별 경제지표를 유지하고 시장 데이터와 공포·탐욕 계산을 갱신한다. `--watch-only`는 국채금리와 유가를 갱신하고 나머지 경제지표·캘린더를 유지한다.

기존 `.github/workflows/macro-dash.yml`과 `update.yml`의 예약은 이 요청에서 변경하지 않았다. 클로드가 등록할 때 기존 작업과의 중복·동시 실행을 확인하되, 전체 경제지표를 갱신하는 기존 작업까지 제거하지 않는다.

## 등록 후 확인

- 첫 화면에서 Fear & Greed → 채권금리 → 유가 순서가 보인다.
- 수집 실행 시각과 각 지표의 관측일을 구분한다.
- 휴장·일별 발표로 값이 같아도 오류로 간주하지 않는다.
- 실패한 항목을 0이나 빈 데이터로 교체하지 않는다.
- 전용 작업 실행, 커밋·푸시, 사이트 반영까지 한 번 확인한다.

이 대화에서 새로 요청한 예약 작업은 위 **매크로 1시간 갱신 한 개**다. 신호별 차트·정렬 및 섹터 탭 통합은 화면 변경 작업으로, 별도 예약이 필요하지 않다.
