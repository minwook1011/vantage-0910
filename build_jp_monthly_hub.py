"""데이터 허브 '일본 소비재 월차' 원본 모음 — docs/data/jp/monthly/<코드>.json + index.json

2026-10-12 사용자: 일본 기업 스크리너에 모아 둔 월차(月次)의 원본을 데이터 허브에 넣고, 새 월차가 나오면 텔레그램으로 알려 달라.

입력: 월차 원장 도구(jp_monthly) 응답을 저장한 파일들 — {"batch":[{code,name,name_en,sector,class,latest,columns,rows,units}...]}
      예약 작업 vantage-jp-monthly 가 data_sources/_cache/jp_monthly/b01~b17.json(최근 3개월)을 저장한다.
      처음 한 번은 24개월치(data_sources/_cache/jp_monthly_hist)로 채웠다.
처리: 회사마다 열(원문 이름 그대로)과 달별 값을 합친다. 같은 달·같은 열은 새 파일 값이 이긴다(속보 → 확정 정정).
      화면 표시는 원문 열 이름 + 한국어 풀이(docs/jp-monthly.js).
      예전에 없던 '최신 달'이 들어오면 index.json 의 events 에 남긴다 → tg_notify.py 가 텔레그램으로 보낸다.
      처음 채울 때(--init)는 events 를 만들지 않는다.

사용: python build_jp_monthly_hub.py --cache <폴더> [--cache <폴더> ...] [--init]
"""
import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs", "data", "jp", "monthly")
KST = timezone(timedelta(hours=9))
KEEP_EVENTS_DAYS = 45


def jd(p, d=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return d


def ko_names():
    try:
        s = open(os.path.join(ROOT, "docs", "data", "jp", "names-ko.js"), encoding="utf-8").read()
        return json.loads(re.search(r"const KO_NAMES = (\{.*?\});", s, re.S).group(1))
    except Exception:
        return {}


def cats():
    out = {}
    for fn, var in (("screener-data.js", "RAW"), ("consumer-extra.js", "RAW_EXT"), ("major-data.js", "RAW_MAJ")):
        try:
            for line in open(os.path.join(ROOT, "docs", "data", "jp", fn), encoding="utf-8"):
                if line.startswith("const " + var + " = "):
                    for r in json.loads(line[len("const " + var + " = "):].rstrip().rstrip(";")):
                        out.setdefault(r[0], {"cat": r[2], "en": r[1], "mc": r[5]})
        except Exception:
            pass
    return out


def headline(latest):
    """텔레그램·목록용 대표 값: 기존점 매출 → 전점 매출 → 아무 매출 전년比 → 첫 전년比"""
    ks = [k for k in latest if "전년比" in k]
    for pat in ("既存店.*売上", "全店.*売上", "売上", ""):
        for k in ks:
            if re.search(pat, k):
                return k, latest[k]
    return None, None


def price_6m(codes):
    """종목별 최근 약 6개월 일봉 종가(목록의 작은 차트용) — 스크리너 묶음 + 최근 일봉(px_recent) + 종목별 파일(data/jp/px)"""
    dec = json.JSONDecoder()
    bars = {c: {} for c in codes}
    for fn, var in (("screener-data.js", "BUNDLE"), ("consumer-extra.js", "BUNDLE_EXT"), ("major-data.js", "BUNDLE_MAJ")):
        try:
            s = open(os.path.join(ROOT, "docs", "data", "jp", fn), encoding="utf-8").read()
            i = s.find("const " + var)
            if i < 0:
                continue
            v, _ = dec.raw_decode(s[s.index("[", i):])
        except Exception:
            continue
        for b in v:
            if b["c"] in bars and b.get("px") and not b.get("iv") and not bars[b["c"]]:
                d = b["d0"]
                for k in range(len(b["px"])):
                    if k:
                        d += b["dd"][k]
                    bars[b["c"]][d] = b["px"][k] / 10
    rec = (jd(os.path.join(ROOT, "docs", "data", "jp", "px_recent.json"), {}) or {}).get("bars") or {}
    out = {}
    for c in codes:
        pf = jd(os.path.join(ROOT, "docs", "data", "jp", "px", c + ".json"), {}) or {}
        for row in pf.get("b") or []:
            if isinstance(row[0], int):
                bars[c][row[0]] = row[1]
        for row in rec.get(c) or []:
            bars[c][row[0]] = row[1] / 10
        if bars[c]:
            last = max(bars[c])
            ks = [k for k in sorted(bars[c]) if k > last - 183]
            if len(ks) >= 20:
                out[c] = [round(bars[c][k], 1) for k in ks]
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", action="append", default=[])
    ap.add_argument("--init", action="store_true")
    a = ap.parse_args()
    files = []
    for d in a.cache or [os.path.join(ROOT, "data_sources", "_cache", "jp_monthly")]:
        files += sorted(glob.glob(os.path.join(d, "*.json")))
    os.makedirs(OUT, exist_ok=True)
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    ix = jd(os.path.join(OUT, "index.json"), {}) or {}
    prev_latest = {r["c"]: r.get("m") for r in ix.get("items") or []}
    KO, CAT = ko_names(), cats()
    touched = {}
    blocked = {r["c"]: r for r in ix.get("blocked") or []}
    for f in files:
        for b in (jd(f, {}) or {}).get("batch") or []:
            c = str(b.get("code") or "")
            if c and not b.get("rows") and b.get("status"):   # 자동 수집 막힘·수집 대기 — 회사 IR 주소와 함께 따로 보여 준다
                st_ = b["status"]
                u = re.search(r"https?://\S+", st_)
                blocked[c] = {"c": c, "n": b.get("name"), "why": st_.split(",")[0].split("회사 IR")[0].strip(" ,—·"), "url": u.group(0) if u else None}
            if not c or not b.get("rows"):
                continue
            p = os.path.join(OUT, c + ".json")
            doc = touched.get(c) or jd(p) or {"c": c, "cols": [], "data": {}}
            cols = b.get("columns") or []
            for col in cols[1:]:
                if col not in doc["cols"]:
                    doc["cols"].append(col)
            for row in b["rows"]:
                m = row[0]
                cur = doc["data"].setdefault(m, {})
                for col, v in zip(cols[1:], row[1:]):
                    if v is not None:
                        cur[col] = v
            for k in ("name", "name_en", "sector", "class", "fy_end_month", "units"):
                if b.get(k) is not None:
                    doc[k] = b[k] if k != "units" else {**(doc.get("units") or {}), **b[k]}
            if b.get("latest"):
                lt = b["latest"]
                if not doc.get("latest") or lt.get("month", "") >= doc["latest"].get("month", ""):
                    doc["latest"] = lt
            touched[c] = doc
    events = [e for e in ix.get("events") or [] if e.get("found", "") >= (datetime.now(KST) - timedelta(days=KEEP_EVENTS_DAYS)).strftime("%Y-%m-%d")]
    new = 0
    for c, doc in touched.items():
        doc["data"] = dict(sorted(doc["data"].items(), reverse=True))
        doc["updated"] = now
        json.dump(doc, open(os.path.join(OUT, c + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    items = {r["c"]: r for r in ix.get("items") or []}
    for c, doc in touched.items():
        m = max(doc["data"]) if doc["data"] else None
        lt = doc.get("latest") or {}
        if m and lt.get("month") != m:   # 원장 응답에 latest 가 빠졌거나 옛것이면 표의 최신 달로 대신한다
            lt = {**{k: v for k, v in lt.items() if k in ("published", "preliminary", "pdf", "url", "source") and lt.get("month") == m}, "month": m, **doc["data"][m]}
        hk, hv = headline(lt)
        k = (KO.get(c) or "").split()
        # 대표 계열 최근 12개월(목록에 한 줄로) — 열은 hk(기존점 매출 우선)
        h12 = [[mm, (doc["data"].get(mm) or {}).get(hk)] for mm in sorted(doc["data"])[-12:]] if hk else []
        items[c] = {"c": c, "h12": h12, "n": doc.get("name"), "en": doc.get("name_en") or (CAT.get(c) or {}).get("en"),
                    "ko": k[0] if k and re.search("[가-힣]", k[0]) else "", "cat": (CAT.get(c) or {}).get("cat"),
                    "mc": (CAT.get(c) or {}).get("mc"), "m": m, "pub": lt.get("published"), "pre": bool(lt.get("preliminary")),
                    "src": lt.get("pdf") or lt.get("url"), "hk": hk, "hv": hv, "n_m": len(doc["data"]), "n_c": len(doc["cols"])}
        if not a.init and m and m != prev_latest.get(c):
            events.append({"c": c, "ko": items[c]["ko"] or doc.get("name"), "m": m, "hk": hk, "hv": hv,
                           "pub": lt.get("published"), "src": items[c]["src"], "found": now})
            new += 1
    PX = price_6m(list(items))
    for c, r in items.items():
        if PX.get(c):
            r["px"] = PX[c]
    doc = {"updated": now, "src": "일본 월차 원장(TDnet 공시 + 회사 IR) · 전년比는 전년 같은 달=100",
           "count": len(items), "items": sorted(items.values(), key=lambda r: (r.get("m") or "", r.get("pub") or ""), reverse=True),
           "events": events[-400:],
           "blocked": sorted(({**r, "ko": ((KO.get(r["c"]) or "").split() or [""])[0]} for c_, r in blocked.items() if c_ not in items), key=lambda r: r["c"])}
    json.dump(doc, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"데이터 허브 월차: 회사 {len(items)}곳 · 이번에 읽은 회사 {len(touched)} · 새 달 {new}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
