#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ta_core.py — 새 '기술적 분석' 화면 자료: 신고가 · 거래량 · 상대강도 (미국 · 한국 · 일본)
2026-10-16 사용자: "기술적 분석 전면 개편 — 나머지 다 빼고 신고가·거래량·상대강도만. 미국·일본·한국 나눠서."

  python fetch_ta_core.py              # 세 시장 모두
  python fetch_ta_core.py --market us  # 하나만 (us | kr | jp)

결과: docs/data/ta/{us,kr,jp}.json
  종목마다 — 기본 정보(이름·업종·시가총액) · 52주 신고가(오늘·5일 안·신고가까지 거리) · 거래량(평소 50일 평균 대비 배수)
           · 상대강도(3·6·9·12개월 수익률 가중 → 시장 안 백분위 1~99, 지수 대비 초과수익) · 작은 차트용 최근 130일 종가·거래량
가격: 야후 일봉(2년) — 미국 ^GSPC · 한국 ^KS11/^KQ11 · 일본 ^N225 와 비교.
"""
import argparse
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import fetch_megacap as FM

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "docs", "data", "ta")
KST = timezone(timedelta(hours=9))
CHART_DAYS = 130          # 작은 차트에 싣는 최근 거래일 수(약 6개월)
VOL_BASE = 50             # 평소 거래량 = 직전 50거래일 평균

GICS_KO = {"Information Technology": "정보기술", "Health Care": "헬스케어", "Financials": "금융", "Consumer Discretionary": "경기소비재",
           "Communication Services": "커뮤니케이션", "Industrials": "산업재", "Consumer Staples": "필수소비재", "Energy": "에너지",
           "Utilities": "유틸리티", "Real Estate": "부동산", "Materials": "소재"}
INDEX = {"us": [("^GSPC", "S&P 500")], "kr": [("^KS11", "코스피"), ("^KQ11", "코스닥")], "jp": [("^N225", "닛케이 225")]}


def load_js_array(path, var):
    t = open(path, encoding="utf-8").read()
    m = re.search(r"const\s+" + var + r"\s*=\s*(\[.*?\]);?\s*(?:\n|$)", t, re.S)
    return json.loads(m.group(1)) if m else []


def universe(market):
    """[(야후 티커, 코드, 표시 이름, 영문 이름, 업종, 시가총액(표시용 숫자), 시총 단위, 세부 시장)]"""
    out = []
    if market == "us":
        ko = {s["ticker"]: s["name"] for s in json.load(open(os.path.join(BASE, "docs", "megacap_universe.json"), encoding="utf-8"))["stocks"]}
        for c in json.load(open(os.path.join(BASE, "docs", "data", "us_companies.json"), encoding="utf-8"))["companies"]:
            code = c["code"]
            mc = float(c.get("mcap") or 0) / 1e9
            name = ko.get(code) or c["name"]
            out.append((code.replace(".", "-"), code, name, c["name"], GICS_KO.get(c.get("sector"), c.get("sector") or ""), round(mc, 1), "십억달러", "미국"))
    elif market == "kr":
        for c in json.load(open(os.path.join(BASE, "docs", "data", "kr_companies.json"), encoding="utf-8"))["companies"]:
            suf = ".KQ" if c.get("market") == "KOSDAQ" else ".KS"
            mc = float(c.get("mcap_eok") or 0)
            out.append((c["code"] + suf, c["code"], c["name"], "", c.get("sector") or "", round(mc / 10000, 2), "조원", c.get("market") or ""))
    else:
        names = json.load(open(os.path.join(BASE, "data_sources", "jp_names_ko.json"), encoding="utf-8"))
        seen = {}
        for f, var in (("screener-data.js", "RAW"), ("consumer-extra.js", "RAW_EXT"), ("major-data.js", "RAW_MAJ")):
            for r in load_js_array(os.path.join(BASE, "docs", "data", "jp", f), var):
                code = str(r[0])
                if code in seen:
                    continue
                en = re.sub(r",?\s+(Co\.,?\s?Ltd\.?|Company,?\s?Limited|Corporation|Corp\.?|Holdings.*|Inc\.?|Ltd\.?|Limited)$", "", r[1] or "", flags=re.I)
                w = (names.get(code) or "").split()
                ko = w[0] if w and re.search(r"[가-힣]", w[0]) else ""
                seen[code] = (code + ".T", code, ko or en, en, r[2] or "", r[5] or 0, "억엔", "도쿄")
        out = list(seen.values())
    return out


def fetch_adj(tk, rng="2y"):
    """야후 일봉 + 분할 보정 — 일본 종목은 야후가 분할을 반영 안 한 날것을 주는 경우가 있어(예: 시마무라 1:3) 분할일 앞 가격을 나누고 거래량을 곱한다.
    이미 보정된 계열이면 분할일에 가격이 실제로 뛰지 않으므로 건드리지 않는다."""
    raw = FM.http_get(f"https://query1.finance.yahoo.com/v8/finance/chart/{FM.urllib.parse.quote(tk)}?range={rng}&interval=1d&events=split")
    if not raw:
        return None
    try:
        res = json.loads(raw)["chart"]["result"][0]
        ts = res.get("timestamp") or []
        q = res["indicators"]["quote"][0]
        out = {"dates": [], "o": [], "h": [], "l": [], "c": [], "v": []}
        tsk = []
        for i, t in enumerate(ts):
            c = q["close"][i]
            if c is None:
                continue
            tsk.append(t)
            out["dates"].append(datetime.fromtimestamp(t, tz=KST).strftime("%Y-%m-%d"))
            for k, src in (("o", "open"), ("h", "high"), ("l", "low")):
                out[k].append(float(q[src][i] or c))
            out["c"].append(float(c))
            out["v"].append(int(q["volume"][i] or 0))
        for sp in ((res.get("events") or {}).get("splits") or {}).values():
            f = (sp.get("numerator") or 0) / (sp.get("denominator") or 1)
            if f <= 0 or abs(f - 1) < 0.05:
                continue
            j = next((k for k, t in enumerate(tsk) if t >= int(sp["date"]) - 43200), None)
            if not j:
                continue
            # 분할일 앞뒤 며칠 안에서 가격이 1/f 만큼 실제로 뛴 날을 찾는다(야후 분할일이 하루쯤 어긋나기도 함). 없으면 이미 보정된 것 → 그대로
            hit = [k for k in range(max(1, j - 3), min(len(tsk), j + 3)) if out["c"][k - 1] and 0.55 / f <= out["c"][k] / out["c"][k - 1] <= 1.6 / f]
            if not hit:
                continue
            j = hit[0]
            for k in range(j):
                for key in ("o", "h", "l", "c"):
                    out[key][k] = out[key][k] / f
                out["v"][k] = int(out["v"][k] * f)
        for key in ("o", "h", "l", "c"):
            out[key] = [round(x, 4) for x in out[key]]
        return out if len(out["c"]) >= 2 else None
    except Exception:
        return None


def about_map(market):
    """종목 창(누르면 뜨는 기업 정보)에 쓸 한두 줄 소개"""
    out = {}
    try:
        if market == "us":
            pr = json.load(open(os.path.join(BASE, "docs", "megacap_profiles.json"), encoding="utf-8")).get("profiles", {})
            for tk, v in pr.items():
                if v.get("biz"):
                    out[tk] = {"about": v["biz"]}
        elif market == "jp":
            t = open(os.path.join(BASE, "docs", "data", "jp", "screener-data.js"), encoding="utf-8").read()
            m = re.search(r"const\s+BM\s*=\s*(\{.*?\});?\s*(?:\n|$)", t, re.S)
            bm = json.loads(m.group(1)) if m else {}
            try:
                for k, v in json.load(open(os.path.join(BASE, "docs", "data", "jp", "bm_extra.json"), encoding="utf-8")).items():
                    bm.setdefault(k, v)
            except Exception:
                pass
            for code, b in bm.items():
                o = {}
                if b.get("sum"):
                    o["about"] = b["sum"][:220]
                if b.get("seg"):
                    o["seg"] = [{"n": x.get("n"), "p": x.get("p")} for x in b["seg"][:5] if x.get("n")]
                if b.get("recent"):
                    o["recent"] = [str(x)[:90] for x in b["recent"][:3]]
                if o:
                    out[code] = o
    except Exception as e:
        print("  소개글 읽기 실패", e)
    return out


def kr_fin(code):
    """한국 종목 재무(억원) → 종목 창 재무표 형식(백만원 단위)"""
    try:
        f = json.load(open(os.path.join(BASE, "docs", "data", "kr", code + ".json"), encoding="utf-8")).get("financials") or {}
    except Exception:
        return None
    def rows(L, n):
        out = []
        for r in (L or [])[-n:]:
            rev, op = r.get("revenue"), r.get("operating_income")
            out.append({"date": r["date"], "ccy": "KRW", "rev": rev * 100 if rev is not None else None, "op": op * 100 if op is not None else None,   # 억원 → 백만원(공용 재무표 단위)
                        "opm": r.get("opm"), "rev_yoy": r.get("revenue_yoy"), "op_yoy": r.get("operating_income_yoy"), "rev_qoq": r.get("revenue_qoq"), "est": r.get("est")})
        return out
    q, a = rows(f.get("quarterly"), 8), rows(f.get("annual"), 5)
    return {"quarterly": q, "annual": a} if q or a else None


def ttm_ni(path):
    """최근 4분기(실적, 추정 제외) 순이익 합 — 4분기가 다 없으면 None"""
    try:
        q = [r for r in (json.load(open(path, encoding="utf-8")).get("financials") or {}).get("quarterly") or [] if not r.get("est")]
    except Exception:
        return None
    q = q[-4:]
    if len(q) < 4 or any(r.get("net_income") is None for r in q):
        return None
    return sum(r["net_income"] for r in q)


def per_map(market):
    """PER(시가총액 ÷ 최근 4분기 순이익) — {코드: (기준 주가 시점 PER, 기준 주가)}. 적자는 -1.
    화면에서는 오늘 주가에 맞춰 PER × 오늘 주가 ÷ 기준 주가로 다시 맞춘다."""
    out = {}
    try:
        if market == "us":
            for c in json.load(open(os.path.join(BASE, "docs", "data", "us_companies.json"), encoding="utf-8"))["companies"]:
                ni = ttm_ni(os.path.join(BASE, "docs", "data", "us", c["code"] + ".json"))   # 백만달러
                if ni is None or not c.get("mcap") or not c.get("close"):
                    continue
                out[c["code"]] = (c["mcap"] / 1e6 / ni if ni > 0 else -1, c["close"])
        elif market == "kr":
            for c in json.load(open(os.path.join(BASE, "docs", "data", "kr_companies.json"), encoding="utf-8"))["companies"]:
                ni = ttm_ni(os.path.join(BASE, "docs", "data", "kr", c["code"] + ".json"))   # 억원
                if ni is None or not c.get("mcap_eok") or not c.get("close"):
                    continue
                out[c["code"]] = (c["mcap_eok"] / ni if ni > 0 else -1, c["close"])
        else:   # 일본: 일본 기업 화면 표의 PER(그 표의 종가 기준)
            for f, var in (("screener-data.js", "RAW"), ("consumer-extra.js", "RAW_EXT"), ("major-data.js", "RAW_MAJ")):
                for r in load_js_array(os.path.join(BASE, "docs", "data", "jp", f), var):
                    code = str(r[0])
                    if code in out or len(r) < 10 or r[9] is None or not r[4]:
                        continue
                    out[code] = (r[9] if r[9] > 0 else -1, r[4])
    except Exception as e:
        print("  PER 읽기 실패", e)
    return out


def pct(a, b):
    return None if not b or a is None else round((a / b - 1) * 100, 2)


def metrics(px, idx):
    c, h, v, d = px["c"], px["h"], px["v"], px["dates"]
    n = len(c)
    if n < 60:
        return None
    last = c[-1]
    w = min(252, n)
    hi_close = max(c[-w:])
    hi52 = max(h[-w:])
    # 신고가: 그날 종가가 그 전 52주(252거래일) 종가 최고를 넘은 날
    nh_days = [i for i in range(max(1, n - 5), n) if c[i] >= max(c[max(0, i - 251):i])]
    since = None
    for i in range(n - 1, max(0, n - 252) - 1, -1):
        if i > 0 and c[i] >= max(c[max(0, i - 251):i]):
            since = n - 1 - i
            break
    vb = v[-1 - VOL_BASE:-1]
    vavg = sum(vb) / len(vb) if vb else 0
    r = lambda k: pct(last, c[-1 - k]) if n > k else None
    r3, r6, r9, r12 = r(63), r(126), r(189), r(252)
    parts = [(0.4, r3), (0.2, r6), (0.2, r9), (0.2, r12)]
    have = [(wt, x) for wt, x in parts if x is not None]
    rs_raw = sum(wt * x for wt, x in have) / sum(wt for wt, _ in have) if have else None
    ex3 = None
    if idx and r3 is not None:
        im = dict(zip(idx["dates"], idx["c"]))
        i0 = im.get(d[-64]) if n > 64 else None
        i1 = im.get(d[-1]) or idx["c"][-1]
        if i0:
            ex3 = round(r3 - (i1 / i0 - 1) * 100, 2)
    tail = slice(-CHART_DAYS, None)
    vt = v[tail]
    vmax = max(vt) or 1
    val20 = sum(cc * vv for cc, vv in zip(c[-20:], v[-20:])) / 20
    return {
        "date": d[-1], "price": round(last, 4), "chg1d": pct(last, c[-2]), "chg5d": r(5), "chg1m": r(21),
        "nh": bool(nh_days and nh_days[-1] == n - 1), "nh5": bool(nh_days), "nh_since": since,
        "from_hi": pct(last, hi_close), "hi52": round(hi_close, 4),
        "vr": round(v[-1] / vavg, 2) if vavg else None, "vr5": round((sum(v[-5:]) / 5) / vavg, 2) if vavg else None,
        "vol": v[-1], "val20": round(val20),
        "r3": r3, "r6": r6, "r12": r12, "rs_raw": round(rs_raw, 2) if rs_raw is not None else None, "ex3": ex3,
        "cd": d[tail][0], "c": [round(x, 4) for x in c[tail]], "v": [round(x / vmax * 99) for x in vt],
    }


CLOSE_KST = {"kr": (15, 50), "jp": (15, 50)}   # 장 마감(15:30) 뒤 여유


def drop_partial(px, market):
    """장중에 돌리면 오늘 봉은 거래 중이라 거래량이 덜 찬다 → 빼고 계산(미국은 한국 날짜로 오늘 봉이면 진행 중)"""
    if not px or not px["dates"]:
        return px
    now = datetime.now(KST)
    today = now.strftime("%Y-%m-%d")
    last = px["dates"][-1]
    partial = (market == "us" and last == today) or (market in CLOSE_KST and last == today and (now.hour, now.minute) < CLOSE_KST[market])
    if partial and len(px["c"]) > 60:
        px = {k: v[:-1] for k, v in px.items()}
    return px


def run(market):
    uni = universe(market)
    idx = {}
    for tk, label in INDEX[market]:
        idx[tk] = drop_partial(FM.fetch_chart(tk, "2y"), market)
    def one(row):
        tk = row[0]
        for a in range(3):
            px = fetch_adj(tk, "2y")
            if px:
                break
            time.sleep(1 + a)
        if not px:
            return None
        px = drop_partial(px, market)
        ix = idx.get("^KQ11" if tk.endswith(".KQ") else "^KS11") if market == "kr" else idx.get(INDEX[market][0][0])
        m = metrics(px, ix)
        if not m:
            return None
        m.update({"tk": tk, "code": row[1], "name": row[2], "en": row[3], "sector": row[4], "mcap": row[5], "sub": row[7]})
        m["_px"] = px
        return m
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = [r for r in ex.map(one, uni) if r]
    # 상대강도 점수 = 시장 안 백분위(1~99)
    ranked = sorted([r for r in res if r["rs_raw"] is not None], key=lambda r: r["rs_raw"])
    for i, r in enumerate(ranked):
        r["rs"] = max(1, min(99, round((i + 1) / len(ranked) * 99)))
    # 종목 창용 일봉 파일 — 화면 목록(5일 안 신고가 · 거래량 1.5배 이상/상위 · RS 90 이상)과 시가총액 상위 60개만(저장소 크기 때문)
    cdir = os.path.join(OUT_DIR, "c", market)
    os.makedirs(cdir, exist_ok=True)
    vq = sorted([r for r in res if r.get("vr") is not None], key=lambda r: -r["vr"])
    listed = {r["code"] for r in res if r.get("nh5") or (r.get("rs") or 0) >= 90}
    listed |= {r["code"] for r in vq if r["vr"] >= 1.5} | {r["code"] for r in vq[:40]}
    listed |= {r["code"] for r in sorted(res, key=lambda r: -(r["mcap"] or 0))[:60]}
    ab = about_map(market)
    keep = set()
    for r in res:
        a = ab.get(r["tk"]) or ab.get(r["code"])
        if a:
            r["about"] = a.get("about")
            if a.get("recent"):
                r["recent"] = a["recent"]
            if a.get("seg"):
                r["seg"] = a["seg"]
        px = r.pop("_px", None)
        if r["code"] not in listed or not px:
            continue
        n = len(px["c"])
        cs = [{"d": px["dates"][i], "o": px["o"][i], "h": px["h"][i], "l": px["l"][i], "c": px["c"][i], "v": px["v"][i]} for i in range(max(0, n - 260), n)]
        doc = {"tk": r["tk"], "candles": cs}
        if market == "kr":
            fin = kr_fin(r["code"])
            if fin:
                doc["fin"] = fin
        fn = re.sub(r"[^A-Za-z0-9._-]", "_", r["code"]) + ".json"
        json.dump(doc, open(os.path.join(cdir, fn), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        keep.add(fn)
        r["cf"] = 1   # 일봉 파일 있음
    for fn in os.listdir(cdir):
        if fn not in keep:
            os.remove(os.path.join(cdir, fn))
    pm = per_map(market)
    for r in res:
        v = pm.get(r["code"])
        if v and r.get("price"):
            r["per"] = -1 if v[0] < 0 else round(v[0] * r["price"] / v[1], 1)
    print("  PER", sum(1 for r in res if r.get("per") is not None), "/", len(res))
    as_of = max((r["date"] for r in res), default=None)
    stale = [r for r in res if r["date"] != as_of]
    for r in res:
        r.pop("rs_raw", None)
    ind = []
    for tk, label in INDEX[market]:
        p = idx.get(tk)
        if p:
            cc = p["c"]
            ind.append({"tk": tk, "name": label, "date": p["dates"][-1], "price": round(cc[-1], 2), "chg1d": pct(cc[-1], cc[-2]),
                        "r3": pct(cc[-1], cc[-64]) if len(cc) > 64 else None, "from_hi": pct(cc[-1], max(cc[-252:]))})
    doc = {"schema_version": 1, "market": market, "generated_at": datetime.now(KST).isoformat(timespec="minutes"), "as_of": as_of,
           "count": len(res), "universe": len(uni), "stale": len(stale), "index": ind, "mcap_unit": uni[0][6] if uni else "",
           "chart_days": CHART_DAYS, "vol_base": VOL_BASE, "stocks": sorted(res, key=lambda r: -(r["mcap"] or 0))}
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(doc, open(os.path.join(OUT_DIR, market + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"[{market}] {len(res)}/{len(uni)} 종목 · 기준일 {as_of} · 신고가 {sum(r['nh'] for r in res)} · 5일 안 신고가 {sum(r['nh5'] for r in res)} · 늦은 자료 {len(stale)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["us", "kr", "jp"])
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    for m in ([a.market] if a.market else ["us", "kr", "jp"]):
        t = time.time()
        run(m)
        print(f"  {time.time() - t:.0f}초")


if __name__ == "__main__":
    main()
