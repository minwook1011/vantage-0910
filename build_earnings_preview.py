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


# ── 카드용 작은 차트·재무 (2026-10-13 사용자: 관전 포인트에 차트와 재무제표를 작게) ──
def _bundles():
    out = {}
    dec = json.JSONDecoder()
    for fn, var in (("screener-data.js", "BUNDLE"), ("consumer-extra.js", "BUNDLE_EXT"), ("major-data.js", "BUNDLE_MAJ")):
        try:
            s = open(os.path.join(BASE, "docs", "data", "jp", fn), encoding="utf-8").read()
            i = s.find("const " + var)
            if i < 0:
                continue
            v, _ = dec.raw_decode(s[s.index("[", i):])
            for b in v:
                out.setdefault(b["c"], b)
        except Exception as e:
            print("  묶음 읽기 실패", fn, e)
    return out


def _r(v, n=1):
    return None if v is None else round(v, n)


PXR = {}
FYM = {}


def attach_data(doc):
    """주 파일의 기업마다 px(최근 약 1년 일봉 종가)·pxd(마지막 날)·fin(분기 8개·연간 4개 매출·영업이익·순이익)을 붙인다"""
    B = None
    global PXR, FYM
    FYM = jd(os.path.join(BASE, "docs", "data", "jp", "fy_months.json"), {}) or {}
    PXR = (jd(os.path.join(BASE, "docs", "data", "jp", "px_recent.json"), {}) or {}).get("bars") or {}
    for L in doc["days"].values():
        for x in L:
            try:
                if x["mk"] == "jp":
                    if B is None:
                        B = _bundles()
                    b = B.get(x["c"])
                    if not b:
                        continue
                    # 주가: 스크리너 묶음(일봉, 일부는 주봉) + 최근 일봉(px_recent) + 종목별 파일(data/jp/px) 중 있는 것을 이어 붙인다
                    bars = {}
                    if b.get("px"):
                        d = b["d0"]
                        for k in range(len(b["px"])):
                            if k:
                                d += b["dd"][k]
                            bars[d] = b["px"][k] / 10
                    pf = jd(os.path.join(BASE, "docs", "data", "jp", "px", x["c"] + ".json"), {}) or {}
                    for row in pf.get("b") or []:
                        dd_ = row[0] if isinstance(row[0], int) else (date.fromisoformat(row[0]) - date(1970, 1, 1)).days
                        bars[dd_] = row[1]
                    for row in PXR.get(x["c"]) or []:
                        bars[row[0]] = row[1] / 10
                    if bars:
                        last = max(bars)
                        ks = [k for k in sorted(bars) if k > last - 366]          # 날짜 기준 최근 1년
                        if b.get("iv") == "w":                                     # 묶음이 주봉인 종목: 전부 주봉으로 맞춘다(시간축 왜곡 방지)
                            wk = {}
                            for k in ks:
                                wk[(k + 3) // 7] = k                               # 같은 주의 마지막 날
                            ks = sorted(wk.values())
                            x["pxw"] = 1
                        else:
                            x.pop("pxw", None)
                        x["px"] = [round(bars[k], 1) for k in ks]
                        x["pxd"] = (date(1970, 1, 1) + timedelta(days=ks[-1])).isoformat()
                    q, a, f = b.get("q") or {}, b.get("a") or {}, b.get("f") or {}
                    n = min(16, len(q.get("lb") or []))   # 12분기 표시 + 앞 4분기는 전년 대비 계산용(2026-10-16 사용자)
                    fin = {"u": "억엔", "q": {k: list(reversed((q.get(k) or [])[:n])) for k in ("lb", "rev", "oi", "ni")}}
                    qh_extend(fin["q"], x["c"], b.get("fm") or FYM.get(x["c"]))
                    al = [i for i, l in enumerate(a.get("lb") or []) if l != "TTM"][:4]
                    fin["a"] = {k: [((a.get(k) or [None] * 99)[i]) for i in reversed(al)] for k in ("lb", "rev", "oi", "ni")}
                    if f.get("rev") is not None or f.get("oi") is not None:
                        fin["f"] = {"lb": str(f.get("y") or "") + " 회사 예상", "rev": f.get("rev"), "oi": f.get("oi"), "ni": f.get("ni")}
                    fm = b.get("fm") or FYM.get(x["c"])
                    if fm:
                        fin["fm"] = int(fm)            # 결산월 — 화면에서 분기 라벨 아래 '몇 월~몇 월' 표시
                    x["fin"] = fin
                else:
                    p = os.path.join(BASE, "docs", "data", "us", x["c"] + ".json")
                    if not os.path.exists(p):
                        continue
                    u = jd(p, {}) or {}
                    pts = ((u.get("price") or {}).get("points") or [])[-250:]
                    if pts:
                        x["px"] = [_r(pt["value"], 2) for pt in pts]
                        x["pxd"] = pts[-1]["date"]
                    fq = ((u.get("financials") or {}).get("quarterly") or [])
                    fq = [r for r in fq if not r.get("est")][-16:]
                    fa = [r for r in ((u.get("financials") or {}).get("annual") or []) if not r.get("est")][-4:]
                    lab = lambda r: r["date"][2:4] + "." + r["date"][5:7]
                    x["fin"] = {"u": "백만 달러",
                                "q": {"lb": [lab(r) for r in fq], "rev": [_r(r.get("revenue")) for r in fq], "oi": [_r(r.get("operating_income")) for r in fq], "ni": [_r(r.get("net_income")) for r in fq]},
                                "a": {"lb": [r["date"][:4] for r in fa], "rev": [_r(r.get("revenue")) for r in fa], "oi": [_r(r.get("operating_income")) for r in fa], "ni": [_r(r.get("net_income")) for r in fa]}}
            except Exception as e:
                print("  차트·재무 붙이기 실패", x.get("c"), e)


_QH = None


def qh_extend(q, code, fym, keep=16):
    """묶음 분기(오래된 → 최근, 억엔) 앞에 IR BANK 장기 이력(data_sources/jp_qhist.json, 백만엔)의 옛 분기를 붙여 keep 개까지"""
    global _QH
    if _QH is None:
        _QH = jd(os.path.join(BASE, "data_sources", "jp_qhist.json"), {}) or {}
    H = (_QH.get(code) or {}).get("q") or []
    if not H or not fym or not q.get("lb") or len(q["lb"]) >= keep:
        return
    fym = int(fym)
    def end(lb):
        m = re.fullmatch(r"(\d{2})Q([1-4])", str(lb))
        if not m:
            return None
        y, e = 2000 + int(m.group(1)), fym - 3 * (4 - int(m.group(2)))
        while e <= 0:
            e += 12; y -= 1
        return y * 12 + e
    first = end(q["lb"][0])
    if first is None:
        return
    add = []
    for r in H:
        y, mo = int(r["end"][:4]), int(r["end"][5:7])
        if y * 12 + mo >= first:
            continue
        k = (mo - fym) % 12
        if k % 3:
            continue
        qn, fy = (4 if k == 0 else k // 3), (y if mo <= fym else y + 1)
        cv = lambda v: None if v is None else round(v / 100, 1)
        add.append((f"{fy % 100:02d}Q{qn}", cv(r.get("rev")), cv(r.get("op") if r.get("op") is not None else r.get("ord")), cv(r.get("ni"))))
    add = add[-(keep - len(q["lb"])):] if add else []
    for i, k in enumerate(("lb", "rev", "oi", "ni")):
        q[k] = [a[i] for a in add] + q[k]


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
    attach_data(doc)
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
    attach_data(doc)
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
    ap.add_argument("--data", action="store_true", help="주 파일에 차트·재무만 다시 붙인다")
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
    if a.data:
        p = os.path.join(OUT, mon.isoformat() + ".json")
        doc = jd(p)
        attach_data(doc)
        wj(p, doc)
        print("차트·재무 붙임:", sum(1 for L in doc["days"].values() for x in L if x.get("fin")), "곳")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
