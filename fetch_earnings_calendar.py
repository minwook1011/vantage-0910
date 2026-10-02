#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_earnings_calendar.py — 메가캡 명단의 (1)다음 실적 발표일+컨센서스, (2)EPS 실제·컨센서스·서프라이즈%
→ docs/earnings_calendar.json
표준 라이브러리만 사용.

핵심 설계:
- 야후 calendarEvents 모듈: 다음 발표일(earningsDate)과 그 분기의 컨센서스(EPS/매출 평균)를 준다.
  이 컨센서스는 "발표 전" 값이므로, 분기 종료일(quarter_end)을 key로 매 실행마다 스냅샷을
  누적 저장해둔다(rev_consensus_snapshots). 발표가 나면 financials.json의 실제 매출과
  같은 quarter_end로 매칭해 프론트에서 매출 서프라이즈%를 계산한다 — 컨센서스는 지나간
  분기에 대해 소급 제공되지 않기 때문에 반드시 사전 스냅샷이 필요하다.
- 야후 earningsHistory 모듈: 최근 4개 분기의 EPS 실제·컨센서스·서프라이즈%는 즉시(과거분도) 제공됨.
  다만 EPS YoY는 최소 5개 분기가 쌓여야 계산 가능 — financials.json과 동일하게 병합 누적한다.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
UNIVERSE = os.path.join(BASE, "docs", "megacap.json")
OUT = os.path.join(BASE, "docs", "earnings_calendar.json")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) etf-flow-tracker/1.0"

_last_req = [0.0]

def _throttle():
    wait = _last_req[0] + 0.5 - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_req[0] = time.time()

def get_crumb():
    try:
        req = urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": UA})
        cookie = ""
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                cookie = r.headers.get("Set-Cookie", "")
        except urllib.error.HTTPError as e:
            cookie = e.headers.get("Set-Cookie", "")
        cookie = cookie.split(";")[0] if cookie else ""
        if not cookie:
            return None, None
        hdr = {"User-Agent": UA, "Cookie": cookie}
        req2 = urllib.request.Request("https://query1.finance.yahoo.com/v1/test/getcrumb", headers=hdr)
        with urllib.request.urlopen(req2, timeout=15) as r:
            crumb = r.read().decode("utf-8").strip()
        return (cookie, crumb) if crumb and "<" not in crumb else (None, None)
    except Exception as e:
        print(f"  [crumb-fail] {e}")
        return None, None

def fetch_one(ticker, cookie, crumb):
    url = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/"
           + urllib.parse.quote(ticker) + "?modules=calendarEvents,earningsHistory,earningsTrend&crumb="
           + urllib.parse.quote(crumb))
    hdr = {"User-Agent": UA, "Cookie": cookie}
    for attempt in range(3):
        _throttle()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=20) as r:
                raw = r.read()
            break
        except Exception as e:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
            else:
                print(f"  [skip] {ticker} -> {e}")
                return None
    try:
        res = json.loads(raw)["quoteSummary"]["result"][0]
    except Exception:
        return None

    out = {"next_earnings_date": None, "is_estimate": None,
           "consensus_eps": None, "consensus_rev": None, "consensus_quarter_end": None,
           "eps_history_new": []}

    ce = (res.get("calendarEvents") or {}).get("earnings") or {}
    dates = ce.get("earningsDate") or []
    if dates and dates[0].get("fmt"):
        out["next_earnings_date"] = dates[0]["fmt"]
    out["is_estimate"] = ce.get("isEarningsDateEstimate")
    avg_eps = ce.get("earningsAverage") or {}
    avg_rev = ce.get("revenueAverage") or {}
    out["consensus_eps"] = avg_eps.get("raw")
    out["consensus_rev"] = avg_rev.get("raw")

    # earningsTrend의 "0q"(현재 미발표 분기) endDate = 재무 데이터와 매칭시킬 분기말일
    trend = (res.get("earningsTrend") or {}).get("trend") or []
    cur_q = next((t for t in trend if t.get("period") == "0q"), trend[0] if trend else None)
    if cur_q and cur_q.get("endDate"):
        out["consensus_quarter_end"] = cur_q["endDate"]

    hist = ((res.get("earningsHistory") or {}).get("history")) or []
    for h in hist:
        q = (h.get("quarter") or {}).get("fmt")
        ea = (h.get("epsActual") or {}).get("raw")
        ee = (h.get("epsEstimate") or {}).get("raw")
        sp = (h.get("surprisePercent") or {}).get("raw")
        if q is None or ea is None:
            continue
        out["eps_history_new"].append({
            "quarter_end": q, "eps_actual": ea, "eps_estimate": ee,
            "eps_surprise_pct": round(sp * 100, 2) if sp is not None else None,
        })
    return out

def merge_eps_history(old_list, new_list):
    by_date = {row["quarter_end"]: dict(row) for row in (old_list or [])}
    for row in new_list:
        by_date[row["quarter_end"]] = row
    return [by_date[d] for d in sorted(by_date)]

def enrich_eps_yoy(rows):
    """EPS YoY = 4분기 전(작년 동분기) 대비. 적자였던 분기 대비 성장률은 의미가 없어 생략."""
    for i, row in enumerate(rows):
        prev = rows[i - 4].get("eps_actual") if i - 4 >= 0 else None
        cur = row.get("eps_actual")
        row["eps_yoy"] = round((cur / prev - 1) * 100, 1) if (prev and prev > 0 and cur is not None) else None
    return rows

def main():
    print(f"=== fetch_earnings_calendar.py 시작 ({datetime.now(KST).strftime('%Y-%m-%d %H:%M KST')}) ===")
    if not os.path.exists(UNIVERSE):
        print("[오류] megacap.json 없음 — fetch_megacap.py를 먼저 실행")
        sys.exit(1)
    stocks = json.load(open(UNIVERSE, encoding="utf-8")).get("stocks", [])
    # 데이터 허브 미국·해외 기업(data_sources/us_universe.json)도 합친다 — 미국 실적 리포트가 이 캘린더로 발표일을 잡는다(2026-10-02)
    us_path = os.path.join(BASE, "data_sources", "us_universe.json")
    if os.path.exists(us_path):
        have = {s["ticker"] for s in stocks}
        for c in json.load(open(us_path, encoding="utf-8")).get("companies", []):
            tk = c.get("yahoo") or c.get("ticker")
            if tk and tk not in have:
                stocks.append({"ticker": tk, "name": c.get("name")})
                have.add(tk)

    existing = {}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT, encoding="utf-8")).get("calendar", {})
        except Exception:
            existing = {}

    cookie, crumb = get_crumb()
    if not crumb:
        print("[경고] 크럼 확보 실패 — 종료")
        sys.exit(0)

    out = {}
    got = 0
    for i, s in enumerate(stocks, 1):
        tk = s["ticker"]
        prev = existing.get(tk, {})
        r = fetch_one(tk, cookie, crumb)
        if r is None:
            if prev:
                out[tk] = prev
            if i % 50 == 0:
                print(f"  {i}/{len(stocks)} (확보 {got})")
            continue
        eps_hist = enrich_eps_yoy(merge_eps_history(prev.get("eps_history"), r["eps_history_new"]))[-10:]
        snaps = dict(prev.get("rev_consensus_snapshots") or {})
        if r["consensus_quarter_end"] and r["consensus_rev"] is not None:
            # 분기말(quarter_end)을 key로 스냅샷 — financials.json의 실제 매출(date)과 매칭시킴.
            # 발표 전(컨센서스 시점)에만 유효한 값이라 반드시 사전에 쌓아둬야 함.
            snaps[r["consensus_quarter_end"]] = r["consensus_rev"]
        out[tk] = {
            "name": s.get("name"),
            "next_earnings_date": r["next_earnings_date"],
            "is_estimate": r["is_estimate"],
            "consensus_eps": r["consensus_eps"],
            "consensus_rev": r["consensus_rev"],
            "eps_history": eps_hist,
            "rev_consensus_snapshots": snaps,
        }
        got += 1
        if i % 50 == 0:
            print(f"  {i}/{len(stocks)} (확보 {got})")

    data = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
            "count": len(out), "calendar": out}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"=== 완료: {got}/{len(stocks)}종 실적 캘린더 확보 → {OUT} ===")

if __name__ == "__main__":
    main()
