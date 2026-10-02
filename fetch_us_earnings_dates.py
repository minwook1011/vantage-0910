"""미국 실적 발표 예정일 — 나스닥 거래소 실적 캘린더 → docs/data/us/earnings_dates.json

출처: Nasdaq 거래소 공식 사이트의 Earnings Calendar(https://www.nasdaq.com/market-activity/earnings,
      데이터 api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD). 미국은 거래소가 내는 단일 '공식 목록'이 없어
      거래소 운영사(나스닥)가 공개하는 캘린더를 쓴다. 뉴스 검색·추정치는 쓰지 않는다(2026-10-02 사용자 지시).
      실제로 발표했는지는 발표 당일 회사의 SEC 8-K(Item 2.02, 실적 보도자료)로 확인한다 — 실적 리포트 단계.

- 오늘부터 앞으로 --days(기본 60)일 평일 + 지난 7일을 하루씩 조회한다(하루 1요청).
- 대상: 데이터 허브 미국·해외 명단(data_sources/us_universe.json) + 글로벌 메가캡(docs/megacap.json) 중 미국 티커.
  --all 이면 나스닥 캘린더에 나온 전 종목.
- 종목마다 '오늘 이후 가장 가까운 날짜'를 next 로, 지난 7일 안의 발표를 last 로 남긴다.
  time: pre(장 전) · after(장 후) · na(미정). fq(회계분기 끝 월), eps_fc(컨센서스 EPS, 나스닥 표기 그대로).
- 조회 날짜의 70% 이상 실패하면 기존 파일을 건드리지 않는다.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "us", "earnings_dates.json")
API = "https://api.nasdaq.com/api/calendar/earnings?date={}"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
KST = timezone(timedelta(hours=9))
ET = timezone(timedelta(hours=-4))  # 미 동부(서머타임 기준 근사 — 날짜 경계만 쓴다)
TIME = {"time-pre-market": "pre", "time-after-hours": "after", "time-not-supplied": "na"}


def universe():
    tk = {}
    p = os.path.join(BASE, "data_sources", "us_universe.json")
    if os.path.exists(p):
        for c in json.load(open(p, encoding="utf-8")).get("companies", []):
            t = (c.get("ticker") or "").upper()
            if t:
                tk[t.replace(".", "-")] = c.get("name")
    p = os.path.join(BASE, "docs", "megacap.json")
    if os.path.exists(p):
        for s in json.load(open(p, encoding="utf-8")).get("stocks", []):
            t = (s.get("ticker") or "").upper()
            if t and "." not in t and t.isascii():
                tk.setdefault(t, s.get("name"))
    return tk


def day_rows(d):
    for i in range(3):
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(API.format(d), headers=UA), timeout=25).read())
            return (r.get("data") or {}).get("rows") or []
        except Exception as e:
            if i == 2:
                print(f"  {d}: 실패 {e}")
                return None
            time.sleep(2 + 2 * i)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()
    uni = universe()
    today = datetime.now(ET).date()
    days = [today + timedelta(days=k) for k in range(-7, a.days + 1)]
    days = [d for d in days if d.weekday() < 5]
    hits, fail = {}, 0
    for d in days:
        rows = day_rows(d.isoformat())
        if rows is None:
            fail += 1
            continue
        for r in rows:
            t = (r.get("symbol") or "").upper().replace(".", "-").replace("/", "-")
            if not t or (not a.all and t not in uni):
                continue
            hits.setdefault(t, []).append({"date": d.isoformat(), "time": TIME.get(r.get("time"), "na"),
                                           "fq": r.get("fiscalQuarterEnding") or None, "eps_fc": r.get("epsForecast") or None,
                                           "name": r.get("name")})
        time.sleep(0.4)
    if fail > len(days) * 0.7:
        print(f"조회 실패가 너무 많음({fail}/{len(days)}일) — 기존 파일 유지")
        return 1

    try:
        old = json.load(open(OUT, encoding="utf-8")).get("dates", {})
    except Exception:
        old = {}
    t0 = today.isoformat()
    dates = {}
    for t, lst in hits.items():
        lst.sort(key=lambda x: x["date"])
        nxt = next((x for x in lst if x["date"] >= t0), None)
        last = [x for x in lst if x["date"] < t0]
        e = {"name": uni.get(t) or lst[0]["name"]}
        if nxt:
            e["next"] = {k: nxt[k] for k in ("date", "time", "fq", "eps_fc")}
        if last:
            e["last"] = {k: last[-1][k] for k in ("date", "time", "fq")}
        dates[t] = e
    for t, e in old.items():  # 이번에 안 보인 종목: 지난 발표(last)만 남긴다
        if t not in dates and e.get("last"):
            dates[t] = {"name": e.get("name"), "last": e["last"]}
    now = datetime.now(KST)
    doc = {"updated": now.strftime("%Y-%m-%d %H:%M KST"), "src": "Nasdaq Earnings Calendar (api.nasdaq.com)",
           "note": "time: pre=미 동부 장 전(한국 밤~새벽), after=장 후(한국 새벽~아침), na=미정. 날짜는 미 동부 기준.",
           "range": [days[0].isoformat(), days[-1].isoformat()], "failed_days": fail,
           "universe": len(uni), "count": len(dates), "dates": dict(sorted(dates.items()))}
    # 날짜 정보가 그대로면 파일을 쓰지 않는다(하루 여러 번 돌아도 커밋 안 생김)
    try:
        prev = json.load(open(OUT, encoding="utf-8"))
        if prev.get("dates") == doc["dates"]:
            print(f"변경 없음 — {len(dates)}종목 그대로")
            return 0
    except Exception:
        pass
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n_next = sum(1 for e in dates.values() if e.get("next"))
    print(f"미국 실적 예정일: 명단 {len(uni)}종목 중 앞으로 {a.days}일 안 발표 {n_next}종목 · 지난 7일 발표 "
          f"{sum(1 for e in dates.values() if e.get('last'))}종목 · 조회 {len(days)}일(실패 {fail})")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
