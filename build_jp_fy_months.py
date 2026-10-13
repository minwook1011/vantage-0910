"""일본 기업 결산월 표 — docs/data/jp/fy_months.json  {"코드": 결산월(1~12)}

2026-10-13 사용자: 스크리너 재무표의 분기 라벨(27Q1 등)에 '몇 월부터 몇 월까지'인지 전부 표시해야 한다.
스크리너 묶음의 fm 이 비어 있는 회사가 많아(569/692), 화면이 실적 일정 파일을 늦게 받으면 기간이 안 보였다.
출처 순서: 묶음 fm → 거래소 실적 일정(earnings_dates fy_end) → 실적 결과(earnings_results fy) → 아래 수동 표.
실적 일정 갱신 작업이 돌 때 같이 다시 만든다(vantage-calendars).
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
JP = os.path.join(BASE, "docs", "data", "jp")
MANUAL = {  # 위 자료에 없는 회사(회사 공시 결산월)
    "2531": 3, "25935": 4, "2593": 4, "2811": 12, "4768": 12, "6504": 3, "6723": 12, "6727": 3, "6758": 3,
    "6971": 3, "7201": 3, "8053": 3, "9842": 2,
}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out, codes = {}, set()
    dec = json.JSONDecoder()
    for fn, var in (("screener-data.js", "BUNDLE"), ("consumer-extra.js", "BUNDLE_EXT"), ("major-data.js", "BUNDLE_MAJ")):
        try:
            s = open(os.path.join(JP, fn), encoding="utf-8").read()
            i = s.find("const " + var)
            if i < 0:
                continue
            v, _ = dec.raw_decode(s[s.index("[", i):])
        except Exception as e:
            print("묶음 읽기 실패", fn, e)
            continue
        for b in v:
            codes.add(b["c"])
            if b.get("fm"):
                out.setdefault(b["c"], int(b["fm"]))
    E = (json.load(open(os.path.join(JP, "earnings_dates.json"), encoding="utf-8")) or {}).get("dates") or {}
    for c, e in E.items():
        m = re.match(r"^\d{4}-(\d{2})", e.get("fy_end") or "")
        if m:
            out.setdefault(c, int(m.group(1)))
            codes.add(c)
    try:
        R = json.load(open(os.path.join(JP, "earnings_results.json"), encoding="utf-8")).get("results") or {}
    except Exception:
        R = {}
    for c, r in R.items():
        m = re.match(r"^\d{4}\.(\d{2})", str(r.get("fy") or ""))
        if m:
            out.setdefault(c, int(m.group(1)))
    for c, mm in MANUAL.items():
        out.setdefault(c, mm)
    miss = sorted(c for c in codes if c not in out)
    json.dump(dict(sorted(out.items())), open(os.path.join(JP, "fy_months.json"), "w", encoding="utf-8"), separators=(",", ":"))
    print(f"결산월 표: {len(out)}곳 · 스크리너 종목 중 모름 {len(miss)}곳 {' '.join(miss[:20])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
