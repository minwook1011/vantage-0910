#!/usr/bin/env python3
"""이미 만든 실적 리포트(docs/data/{jp,us}/reports/*.json)의 분기 시계열 qs 를 12분기로 늘린다(2026-10-16 사용자).

  일본: 리포트에 있는 카부탄 8분기 앞에 IR BANK 장기 이력(data_sources/jp_qhist.json)을 붙인다 — fetch_jp_earnings_results.merge_hist
  미국: 데이터 허브 분기 실적(docs/data/us/<티커>.json, SEC XBRL)으로 다시 만든다 — fetch_us_earnings_results.build_qs
        (보도자료·야후로 채운 이번 분기는 그대로 살린다)
마지막 분기(이번 발표 분기)가 바뀌면 건드리지 않는다. 새로 만드는 리포트는 각 수집 스크립트가 처음부터 12분기로 만든다.
"""
import glob
import json
import os
import sys

import fetch_jp_earnings_results as J
import fetch_us_earnings_results as U

ROOT = os.path.dirname(os.path.abspath(__file__))


def save(p, R):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(R, f, ensure_ascii=False, separators=(",", ":"))


def main():
    n = {"jp": 0, "us": 0, "skip": 0}
    for p in glob.glob(os.path.join(ROOT, "docs", "data", "jp", "reports", "*.json")):
        R = json.load(open(p, encoding="utf-8"))
        qs = R.get("qs") or []
        if not qs or len(qs) >= 12:
            continue
        new = J.merge_hist([dict(q) for q in qs], R["code"])
        if len(new) > len(qs) and new[-1]["label"] == qs[-1]["label"]:
            R["qs"] = new; save(p, R); n["jp"] += 1
        else:
            n["skip"] += 1
    for p in glob.glob(os.path.join(ROOT, "docs", "data", "us", "reports", "*.json")):
        R = json.load(open(p, encoding="utf-8"))
        qs = R.get("qs") or []
        if not qs or len(qs) >= 12:
            continue
        try:
            co = json.load(open(os.path.join(ROOT, "docs", "data", "us", R["code"] + ".json"), encoding="utf-8"))
        except Exception:
            n["skip"] += 1
            continue
        fin_q = (co.get("financials") or {}).get("quarterly") or []
        last = qs[-1]
        extra = {"date": last["date"], "revenue": last.get("rev"), "operating_income": last.get("op"), "net_income": last.get("ni"), "src": last["src"]} if last.get("src") else None
        new = U.build_qs(fin_q, extra)
        if len(new) > len(qs) and new[-1]["date"][:7] == last["date"][:7]:
            R["qs"] = new; save(p, R); n["us"] += 1
        else:
            n["skip"] += 1
    print(n)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
