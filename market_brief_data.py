# -*- coding: utf-8 -*-
"""
시장 해석 글(market brief) 재료 모으기 — 예약 작업 vantage-market-brief-us(06:30) · -asia(16:00)가 글 쓰기 전에 돌린다.

  섹터(업종)별 흐름: docs/data/ta/{us,kr,jp}.json — 시가총액 가중 수익률(1일·5일·1개월·3개월), 오른 종목 비율,
                    5일 안 신고가 수, 평균 상대강도, 거래량 배수, 업종 안 대표 종목 움직임
  ETF 자금 흐름:    docs/data.json — 섹터·테마·국가·채권(TLT)·금(GLD) ETF 수익률·ACWI 대비·거래량 배수
  지수·금리·매크로: ta 지수, docs/macro_dash.json(미 국채 2·10·30년·장단기차·달러·원달러·WTI·VIX), 공포탐욕, 빅테크·AI CDS

  python market_brief_data.py --market us     → 미국 마감용
  python market_brief_data.py --market asia   → 한국·일본 마감용
  결과: 화면에 읽기 쉬운 표(글쓴이용) + data_sources/_brief_input_{market}.json
"""
import json
import os
import statistics
import sys

BASE = os.path.dirname(os.path.abspath(__file__))


def load(p):
    try:
        return json.load(open(os.path.join(BASE, p), encoding="utf-8"))
    except Exception:
        return None


def f(v, d=1, pct=True):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "—"
    return f"{v:+.{d}f}{'%' if pct else ''}"


def sectors(m):
    D = load(f"docs/data/ta/{m}.json") or {}
    by = {}
    for s in D.get("stocks") or []:
        by.setdefault(s.get("sector") or "기타", []).append(s)
    rows = []
    for sec, L in by.items():
        tot = sum(s.get("mcap") or 0 for s in L) or 1
        w = lambda k: sum((s.get(k) or 0) * (s.get("mcap") or 0) for s in L) / tot
        top = sorted(L, key=lambda s: -(s.get("mcap") or 0))[:4]
        rows.append({"sector": sec, "n": len(L), "mcap": round(tot, 1), "d1": round(w("chg1d"), 2), "d5": round(w("chg5d"), 2),
                     "m1": round(w("chg1m"), 2), "m3": round(w("r3"), 2), "m6": round(w("r6"), 2), "m12": round(w("r12"), 2),
                     "up_ratio": round(sum(1 for s in L if (s.get("chg1d") or 0) > 0) / len(L) * 100),
                     "nh5": sum(1 for s in L if s.get("nh5")), "rs": round(statistics.mean([s.get("rs") or 0 for s in L])),
                     "vr": round(statistics.median([s.get("vr") or 0 for s in L]), 2),
                     "leaders": [f"{s.get('name')} {f(s.get('chg1d'))}" for s in top],
                     "movers": [f"{s.get('name')} {f(s.get('chg1d'))}" for s in sorted(L, key=lambda s: -abs(s.get('chg1d') or 0))[:3]]})
    rows.sort(key=lambda r: -r["d1"])
    allst = D.get("stocks") or []
    breadth = {"up": sum(1 for s in allst if (s.get("chg1d") or 0) > 0), "n": len(allst),
               "nh5": sum(1 for s in allst if s.get("nh5")), "vr_median": round(statistics.median([s.get("vr") or 0 for s in allst]), 2) if allst else None}
    return {"as_of": D.get("as_of"), "generated_at": D.get("generated_at"), "index": D.get("index") or [], "breadth": breadth, "sectors": rows}


def etfs(groups):
    E = load("docs/data.json") or {}
    out = []
    for tk, e in (E.get("etfs") or {}).items():
        if groups and not any(g in (e.get("group") or "") for g in groups) and tk not in groups:
            continue
        out.append({"tk": tk, "name": e.get("name"), "group": e.get("group"), "d1": e.get("r1d"), "w1": e.get("r1w"), "m1": e.get("r1m"),
                    "m3": e.get("r3m"), "rel_d1": e.get("rel_r1d"), "rel_w1": e.get("rel_r1w"), "rel_m1": e.get("rel_r1m"),
                    "vol_ratio": e.get("vol_ratio"), "from_high": e.get("from_high"), "last": e.get("last_date")})
    return {"updated": E.get("updated"), "benchmark": E.get("benchmark"), "etfs": out}


def macro():
    M = (load("docs/macro_dash.json") or {}).get("indicators") or {}
    out = {}
    for k in ("y3m", "y2", "y10", "y30", "s10y2y", "s10y3m", "dxy", "usdkrw", "wti", "vix", "effr"):
        x = M.get(k) or {}
        vals, dates = x.get("values") or [], x.get("dates") or []
        if not vals:
            continue
        wk = vals[-6] if len(vals) > 5 else None
        out[k] = {"label": x.get("label"), "date": dates[-1], "v": vals[-1], "d1": round(vals[-1] - vals[-2], 3) if len(vals) > 1 else None,
                  "w1": round(vals[-1] - wk, 3) if wk is not None else None, "unit": x.get("unit")}
    fg = load("docs/data/fear_greed.json") or {}
    out["fear_greed"] = {k: fg.get(k) for k in ("score", "rating", "updated_kst", "prev_close", "prev_week", "prev_month") if k in fg}
    ai = load("docs/data/ai_indicators.json") or {}
    cds = next((s for s in ai.get("series") or [] if s.get("id") == "cds_table"), None)
    if cds:
        out["cds"] = {"as_of": cds.get("as_of"), "rows": cds.get("rows")}
    return out


def show(title, rows, cols):
    print(f"\n## {title}")
    print(" | ".join(c for c, _ in cols))
    for r in rows:
        print(" | ".join(str(fn(r)) for _, fn in cols))


def main():
    mk = sys.argv[sys.argv.index("--market") + 1] if "--market" in sys.argv else "us"
    mkts = ["us"] if mk == "us" else ["kr", "jp"]
    data = {"market": mk, "sectors": {m: sectors(m) for m in mkts}, "macro": macro(),
            "etf": etfs(None)}
    os.makedirs(os.path.join(BASE, "data_sources"), exist_ok=True)
    json.dump(data, open(os.path.join(BASE, "data_sources", f"_brief_input_{mk}.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    for m in mkts:
        S = data["sectors"][m]
        idx = " · ".join(f"{i['name']} {i['price']:,} ({f(i['chg1d'], 2)}, 3개월 {f(i.get('r3'))}, 고점 대비 {f(i.get('from_hi'))})" for i in S["index"])
        b = S["breadth"]
        print(f"\n# {m.upper()} · 기준 {S['as_of']} · 갱신 {S['generated_at']}\n지수: {idx}\n"
              f"폭: 오른 종목 {b['up']}/{b['n']} · 5일 안 신고가 {b['nh5']} · 거래량 배수 중앙값 {b['vr_median']}")
        show("업종(시총 가중, 1일 순)", S["sectors"], [("업종", lambda r: r["sector"]), ("1일", lambda r: f(r["d1"], 2)), ("5일", lambda r: f(r["d5"])),
             ("1개월", lambda r: f(r["m1"])), ("3개월", lambda r: f(r["m3"])), ("12개월", lambda r: f(r["m12"])), ("상승비율", lambda r: f"{r['up_ratio']}%"),
             ("신고가5일", lambda r: r["nh5"]), ("RS", lambda r: r["rs"]), ("거래량배수", lambda r: r["vr"]), ("대표", lambda r: ", ".join(r["leaders"][:3])),
             ("크게 움직인", lambda r: ", ".join(r["movers"]))])
    E = data["etf"]
    show(f"ETF (data.json 갱신 {E['updated']} · 벤치마크 {E['benchmark']})", E["etfs"],
         [("티커", lambda r: r["tk"]), ("이름", lambda r: r["name"]), ("1일", lambda r: f(r["d1"], 2)), ("1주", lambda r: f(r["w1"])), ("1개월", lambda r: f(r["m1"])),
          ("ACWI대비1주", lambda r: f(r["rel_w1"])), ("ACWI대비1개월", lambda r: f(r["rel_m1"])), ("거래량배수", lambda r: r["vol_ratio"]), ("최근일", lambda r: r["last"])])
    M = data["macro"]
    print("\n## 금리·달러·원자재·심리")
    for k, x in M.items():
        if k in ("fear_greed", "cds"):
            continue
        print(f"{x['label']}: {x['v']} {x.get('unit') or ''} (전일 {x['d1']:+} · 1주 {x['w1']:+}) [{x['date']}]" if x["d1"] is not None and x["w1"] is not None else f"{x['label']}: {x['v']} [{x['date']}]")
    if M.get("fear_greed"):
        print("공포탐욕:", M["fear_greed"])
    if M.get("cds"):
        print(f"CDS(5년, bp, {M['cds']['as_of']}):", " · ".join(f"{r['name']} {r['bp']}({'' if r.get('chg') is None else f'{r[chr(99)+chr(104)+chr(103)]:+}'})" for r in M["cds"]["rows"]))


if __name__ == "__main__":
    main()
