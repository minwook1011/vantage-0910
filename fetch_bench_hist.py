#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_bench_hist.py — 포트폴리오 수익률 평가용 지수·환율 일봉 → docs/data/bench_hist.json
코스피(^KS11)·코스닥(^KQ11)·S&P500(^GSPC)·나스닥(^IXIC)·원달러(KRW=X) 10년 일봉 종가.
브라우저에서 야후를 직접 못 읽어(CORS) 중계를 쓰면 요청이 몰릴 때 막히므로, 사이트에 정적 파일로 둔다.
표준 라이브러리만 사용. update.yml이 평일마다 실행. 실패한 심볼은 기존 값을 유지한다.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "bench_hist.json")
SYMS = ["^KS11", "^KQ11", "^GSPC", "^IXIC", "KRW=X"]
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vantage-bench/1.0"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def fetch(sym):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range=10y&interval=1d"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                res = json.loads(r.read().decode("utf-8"))["chart"]["result"][0]
            off = (res.get("meta") or {}).get("gmtoffset") or 0
            closes = res["indicators"]["quote"][0]["close"]
            d, c = [], []
            for ts, x in zip(res.get("timestamp") or [], closes):
                if x is None or x <= 0:
                    continue
                day = datetime.fromtimestamp(ts + off, tz=timezone.utc).strftime("%Y-%m-%d")
                if d and d[-1] == day:
                    c[-1] = round(float(x), 4)
                    continue
                d.append(day)
                c.append(round(float(x), 4))
            if len(d) > 100:
                return {"d": d, "c": c}
        except Exception as e:
            print(f"  [{sym}] {attempt + 1}회 실패: {e}")
        time.sleep(1.5)
    return None


def main():
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8")).get("series", {})
        except Exception:
            old = {}
    series = {}
    for s in SYMS:
        h = fetch(s)
        if h:
            series[s] = h
            print(f"  {s}: {len(h['d'])}일 {h['d'][0]} ~ {h['d'][-1]}")
        elif s in old:
            series[s] = old[s]
            print(f"  {s}: 실패 — 기존 값 유지")
        time.sleep(0.6)
    if not series:
        print("전부 실패 — 파일 유지")
        return 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"), "series": series}, f, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
