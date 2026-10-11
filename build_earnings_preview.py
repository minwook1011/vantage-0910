"""다음 주 실적 발표 기업 '관전 포인트' 리포트 — docs/data/preview/<월요일>.json

2026-10-11 사용자: "매주 일요일 오후 10시에 다음 주 기업들이 어떤 기업인지 요일별로 설명.
기업 이름을 누르면 재무제표·차트로 들어가고, 8줄 정도 기업 설명 + 관전 포인트. 이번 실적 시즌(올해)까지만."

흐름(예약 작업 vantage-earnings-preview, 일요일 22:00):
  1) python build_earnings_preview.py --skeleton            → 다음 주 월~금 발표 기업 목록을 만들고(글은 비움),
                                                              글이 필요한 기업을 data_sources/_preview_work/todo.json 에 적는다
  2) Claude 가 기업마다 data_sources/_preview_work/<mk>_<code>.json 을 쓴다
       {"desc": [8줄], "pts": [관전 포인트 2~4개], "one": "한 줄 요약"}
     기업 설명(desc·one)은 profiles.json 에 남겨 다음 분기에 다시 쓰고, 관전 포인트(pts)는 그 주 파일에만 넣는다.
  3) python build_earnings_preview.py --merge               → 주 파일·profiles.json·index.json 에 합친다

데이터: 일본 docs/data/jp/earnings_dates.json(거래소 공식 예정일) + 스크리너 묶음(이름·업종·시총),
        미국 docs/data/us/earnings_dates.json(나스닥 캘린더) + data/us_companies.json(데이터 허브에 차트가 있는 기업).
"""
import argparse
import glob
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "preview")
WORK = os.path.join(BASE, "data_sources", "_preview_work")
KST = timezone(timedelta(hours=9))
UNTIL = "2026-12-31"   # 이번 실적 시즌(올해)까지만 — 이후엔 만들지 않고 사용자에게 계속할지 묻는다


def jd(p, default=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return default


def wj(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def raw_rows(fn, var):
    """스크리너 묶음 js 에서 const RAW… = [...]; 한 줄을 읽는다."""
    p = os.path.join(BASE, "docs", "data", "jp", fn)
    for line in open(p, encoding="utf-8"):
        if line.startswith("const " + var + " = "):
            return json.loads(line[len("const " + var + " = "):].rstrip().rstrip(";"))
    return []


def ko_names():
    p = os.path.join(BASE, "docs", "data", "jp", "names-ko.js")
    try:
        s = open(p, encoding="utf-8").read()
        return json.loads(re.search(r"const KO_NAMES = (\{.*?\});", s, re.S).group(1))
    except Exception:
        return {}


def next_monday(today):
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def skeleton(mon):
    days = [(mon + timedelta(days=k)).isoformat() for k in range(5)]
    d0, d4 = days[0], days[-1]
    # 일본
    jp = {}
    for fn, var, u in (("screener-data.js", "RAW", "con"), ("consumer-extra.js", "RAW_EXT", "con"), ("major-data.js", "RAW_MAJ", "maj")):
        for r in raw_rows(fn, var):
            jp.setdefault(r[0], {"n": r[1], "cat": r[2], "ind": r[3], "mc": r[5], "u": u})
    ko = ko_names()
    items = {d: [] for d in days}
    for c, e in (jd(os.path.join(BASE, "docs", "data", "jp", "earnings_dates.json"), {}).get("dates") or {}).items():
        dt = e.get("date") or ""
        if d0 <= dt <= d4 and c in jp:
            m = jp[c]
            k = (ko.get(c) or "").split()
            items[dt].append({"mk": "jp", "c": c, "n": m["n"], "ko": k[0] if k and re.search("[가-힣]", k[0]) else "",
                              "cat": m["cat"], "ind": m["ind"], "mc": m["mc"], "u": m["u"], "q": e.get("q"), "est": bool(e.get("est"))})
    # 미국
    hub = {c["code"]: c for c in (jd(os.path.join(BASE, "docs", "data", "us_companies.json"), {}).get("companies") or [])}
    for t, e in (jd(os.path.join(BASE, "docs", "data", "us", "earnings_dates.json"), {}).get("dates") or {}).items():
        nx = e.get("next") or {}
        dt = nx.get("date") or ""
        if d0 <= dt <= d4:
            h = hub.get(t) or {}
            items[dt].append({"mk": "us", "c": t, "n": e.get("name") or t, "cat": e.get("ai") or e.get("sector") or "",
                              "mc": e.get("mcap") or (round(h["mcap"] / 1e8) if h.get("mcap") else None),
                              "tm": nx.get("time"), "fq": nx.get("fq"), "eps": nx.get("eps_fc"),
                              "est": nx.get("src") == "yahoo", "hub": bool(h)})
    for d in days:   # 일본 먼저, 시장 안에서는 시총 순
        items[d].sort(key=lambda x: (x["mk"] != "jp", -(x.get("mc") or 0)))
    p = os.path.join(OUT, mon.isoformat() + ".json")
    old = jd(p, {}) or {}
    oldpts = {(x["mk"], x["c"]): x.get("pts") for d in (old.get("days") or {}).values() for x in d if x.get("pts")}
    for d in days:
        for x in items[d]:
            if oldpts.get((x["mk"], x["c"])):
                x["pts"] = oldpts[(x["mk"], x["c"])]
    doc = {"week": mon.isoformat(), "range": [d0, d4], "until": UNTIL,
           "made": old.get("made") or datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"), "days": items}
    wj(p, doc)
    prof = jd(os.path.join(OUT, "profiles.json"), {}) or {}
    todo = []
    for d in days:
        for x in items[d]:
            key = x["mk"] + ":" + x["c"]
            need = []
            if not (prof.get(key) or {}).get("desc"):
                need.append("desc")
            if not x.get("pts"):
                need.append("pts")
            if need:
                todo.append({"key": key, "date": d, "need": need, **{k: x.get(k) for k in ("mk", "c", "n", "ko", "cat", "ind", "q", "fq", "eps", "tm")}})
    wj(os.path.join(WORK, "todo.json"), {"week": mon.isoformat(), "todo": todo})
    n = sum(len(v) for v in items.values())
    print(f"{mon.isoformat()} 주: 일본 {sum(1 for v in items.values() for x in v if x['mk']=='jp')} · 미국 {sum(1 for v in items.values() for x in v if x['mk']=='us')} · 합계 {n}곳 — 글 필요 {len(todo)}곳 → {os.path.join(WORK, 'todo.json')}")


def merge(mon):
    p = os.path.join(OUT, mon.isoformat() + ".json")
    doc = jd(p)
    if not doc:
        print("주 파일 없음 — --skeleton 먼저"); return 1
    pp = os.path.join(OUT, "profiles.json")
    prof = jd(pp, {}) or {}
    today = datetime.now(KST).strftime("%Y-%m-%d")
    got = 0
    for d, L in doc["days"].items():
        for x in L:
            w = jd(os.path.join(WORK, f"{x['mk']}_{x['c']}.json"))
            if not w:
                continue
            key = x["mk"] + ":" + x["c"]
            if w.get("desc"):
                prof[key] = {"one": w.get("one") or (prof.get(key) or {}).get("one", ""), "desc": [s for s in w["desc"] if s][:10], "at": today}
            if w.get("pts"):
                x["pts"] = [s for s in w["pts"] if s][:5]
            got += 1
    doc["made"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    wj(p, doc)
    wj(pp, dict(sorted(prof.items())))
    weeks = sorted(os.path.basename(f)[:10] for f in glob.glob(os.path.join(OUT, "20??-??-??.json")))
    wj(os.path.join(OUT, "index.json"), {"until": UNTIL, "weeks": weeks, "updated": doc["made"]})
    miss = [f"{x['mk']}:{x['c']}" for L in doc["days"].values() for x in L
            if not x.get("pts") or not (prof.get(x["mk"] + ":" + x["c"]) or {}).get("desc")]
    print(f"합침: {got}곳 · 아직 비어 있음 {len(miss)}곳 {' '.join(miss[:30])}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skeleton", action="store_true")
    ap.add_argument("--merge", action="store_true")
    ap.add_argument("--week", help="월요일 날짜 YYYY-MM-DD(기본: 다음 월요일, 월~금이면 이번 주 다음 월요일)")
    a = ap.parse_args()
    today = datetime.now(KST).date()
    mon = date.fromisoformat(a.week) if a.week else next_monday(today)
    if mon.isoformat() > UNTIL and not a.week:
        print(f"이번 실적 시즌({UNTIL}까지)이 끝났습니다 — 만들지 않음. 계속할지 사용자에게 물어볼 것."); return 3
    if a.skeleton:
        skeleton(mon)
    if a.merge:
        return merge(mon)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
