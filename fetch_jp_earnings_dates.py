#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_jp_earnings_dates.py — 일본 소비재 스크리너 종목의 다음 실적(決算) 발표일
→ docs/data/jp/earnings_dates.json
표준 라이브러리만 사용. 매주 일요일 jp-earnings.yml이 실행.

- 종목 명단: docs/data/jp/screener-data.js 의 RAW (스크리너와 같은 명단을 그대로 쓴다)
- 확정일(est=false): 야후 파이낸스 calendarEvents(<코드>.T) 확정일 → 없으면 카부탄 결산 페이지의 「決算発表予定日」.
  일본 기업은 보통 발표 약 한 달 전에 날짜를 공시하므로, 그 전까지는 확정일이 없다.
- 예상일(est=true): 야후 추정일 → 없으면 카부탄 「発表日」 이력에서 작년 같은 분기 발표일 + 52주(같은 요일).
- 모두 없으면 이전 실행에서 얻은 미래 날짜를 유지한다(지나간 날짜는 버린다).
- 전체 70% 이상 실패하면 기존 파일을 건드리지 않고 종료한다.
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import fetch_earnings_calendar as yf  # get_crumb / fetch_one 재사용

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
SCREENER = os.path.join(BASE, "docs", "data", "jp", "screener-data.js")
OUT = os.path.join(BASE, "docs", "data", "jp", "earnings_dates.json")
JST = timezone(timedelta(hours=9))
KABU_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vantage-jp-screener/1.0"


MAJOR = os.path.join(BASE, "docs", "data", "jp", "major-data.js")
EXTRA = os.path.join(BASE, "docs", "data", "jp", "consumer-extra.js")   # 소비재 추가 종목(fetch_jp_consumer_extra.py)


def load_codes():
    """소비재(RAW + 추가 종목 RAW_EXT) + 주요 기업(RAW_MAJ, 있으면) 코드 합집합"""
    codes = []
    for path, var in ((SCREENER, "RAW"), (EXTRA, "RAW_EXT"), (MAJOR, "RAW_MAJ")):
        if not os.path.exists(path):
            continue
        txt = open(path, encoding="utf-8").read()
        m = re.search(r"const " + var + r" = (\[.*?\]);\n", txt, re.S)
        if m:
            codes += [r[0] for r in json.loads(m.group(1))]
    return list(dict.fromkeys(codes))


def kabutan(code):
    """카부탄 결산 페이지 → (공시된 다음 발표일 또는 None, 과거 발표일 목록)."""
    url = "https://kabutan.jp/stock/finance?code=" + code
    for attempt in range(3):
        time.sleep(1.0)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": KABU_UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                html = r.read().decode("utf-8", "replace")
            m = re.search(r"決算発表予定日.{0,200}?(\d{4})/(\d{2})/(\d{2})", html, re.S)
            sched = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None
            # 실적 표의 「発表日」 열에서 과거 발표일을 모은다(「修正日」 표는 제외됨)
            hist = set()
            for h in re.finditer("発表日", html):
                seg = html[h.start():html.find("</table>", h.start())]
                for y, mo, d in re.findall(r"(\d{2})/(\d{2})/(\d{2})", seg):
                    hist.add(f"20{y}-{mo}-{d}")
            return sched, sorted(hist)
        except Exception as e:
            if attempt == 2:
                print(f"  [kabutan skip] {code} -> {e}")
    return None, []


def from_history(hist, today):
    """작년 같은 분기 발표일 + 52주(같은 요일) 중 오늘 이후 가장 가까운 날. 130일 이내만."""
    t = datetime.strptime(today, "%Y-%m-%d")
    cands = []
    for s in hist:
        c = datetime.strptime(s, "%Y-%m-%d") + timedelta(weeks=52)
        if t <= c <= t + timedelta(days=130):
            cands.append(c.strftime("%Y-%m-%d"))
    return min(cands) if cands else None


def main():
    codes = load_codes()
    only = None
    if "--codes" in sys.argv:  # 이 종목만 새로 받고 나머지는 기존 파일 값 유지(소비재 추가 종목을 넣은 직후 등)
        only = [c.strip().upper() for c in sys.argv[sys.argv.index("--codes") + 1].split(",") if c.strip()]
        codes = only
    today = datetime.now(JST).strftime("%Y-%m-%d")
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8")).get("dates", {})
        except Exception:
            old = {}

    cookie, crumb = yf.get_crumb()
    if not crumb:
        print("야후 크럼 확보 실패 — 카부탄만 사용")

    dates = dict(old) if only else {}  # 지난 날짜도 그대로 둔다(실적 수집기가 최근 7일 예정 종목을 찾는 데 쓴다)
    stats = {"yahoo": 0, "kabutan": 0, "yahoo-est": 0, "prev-year": 0, "kept": 0, "none": 0}
    for i, code in enumerate(codes, 1):
        date, est, src = None, None, None
        yahoo_est = None
        if crumb:
            res = yf.fetch_one(code + ".T", cookie, crumb)
            if res and res.get("next_earnings_date") and res["next_earnings_date"] >= today:
                if res.get("is_estimate"):
                    yahoo_est = res["next_earnings_date"]
                else:
                    date, est, src = res["next_earnings_date"], False, "yahoo"
        if date is None:
            sched, hist = kabutan(code)
            if sched and sched >= today:
                date, est, src = sched, False, "kabutan"
            elif yahoo_est:
                date, est, src = yahoo_est, True, "yahoo-est"
            else:
                guess = from_history(hist, today)
                if guess:
                    date, est, src = guess, True, "prev-year"
        if date is None:
            prev = old.get(code)
            if prev and prev.get("date", "") >= today:
                date, est, src = prev["date"], prev.get("est", False), "kept"
        if date:
            dates[code] = {"date": date, "est": est, "src": src}
            stats[src] += 1
        else:
            stats["none"] += 1
        if i % 50 == 0:
            print(f"  {i}/{len(codes)} {stats}")

    found = len(codes) - stats["none"]
    print(f"완료: {found}/{len(codes)} {stats}")
    if only:
        found = len(dates)
    elif found < len(codes) * 0.3:
        print("수집 결과가 너무 적어 기존 파일을 유지합니다.")
        return 1

    upd = today
    if only:  # 일부만 받았으면 전체 갱신일은 그대로 둔다
        try:
            upd = json.load(open(OUT, encoding="utf-8")).get("updated") or today
        except Exception:
            pass
    out = {"updated": upd, "generated_at": datetime.now(JST).isoformat(timespec="minutes"),
           "count": found, "dates": dict(sorted(dates.items()))}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
