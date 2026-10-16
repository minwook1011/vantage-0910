#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
memory_tg.py — 메모리 가격(현물·모듈·낸드·중국 채널가·계약가)을 매일 돈벌레 텔레그램으로 (2026-10-16 사용자 요청)

데이터는 Claude 커넥터 market_series 에서만 받을 수 있어, 예약 작업(vantage-memory-daily)이
dram · cfm · dram_contract 세 계열을 받아 JSON 파일로 두고 이 스크립트를 부른다.
  python build_memory_prices.py --dram … --cfm … --contract …  (이력 합치기)
  python memory_tg.py [--dry]   (합친 이력 docs/data/memory_prices.json 을 읽어 발송)
보낸 기록: 자료/메모리/sent.json (같은 기준일을 두 번 보내지 않음, --force 로 무시)
"""
import argparse
import json
import os
import sys
from datetime import date, timedelta

import send_telegram as T
import tg_charts as C

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "자료", "메모리", "sent.json")

# (키, 이름, 소수 자리)
DRAM = [("ddr5_16g", "DDR5 16Gb 현물", 2), ("ddr5_16g_ett", "DDR5 16Gb 현물(eTT)", 2),
        ("ddr4_16g", "DDR4 16Gb 현물", 2), ("ddr4_8g", "DDR4 8Gb 현물", 2),
        ("ddr5_rdimm_32g", "DDR5 서버 모듈 32GB", 0), ("ddr5_udimm_16g", "DDR5 PC 모듈 16GB", 0),
        ("gddr6_8g", "GDDR6 8Gb", 2),
        ("nand_512g_tlc", "낸드 웨이퍼 512Gb", 2), ("nand_256g_tlc", "낸드 웨이퍼 256Gb", 2),
        ("nand_128g_tlc", "낸드 웨이퍼 128Gb", 2)]
CFM = [("100263", "서버 모듈 계약가 DDR5 64GB", 0), ("100256", "서버 모듈 계약가 DDR4 64GB", 0),
       ("100268", "PC 모듈 DDR5 16GB", 0), ("100224", "PC 모듈 DDR4 16GB", 0),
       ("100326", "모바일 LPDDR5X 64Gb", 0), ("100229", "모바일 LPDDR4X 64Gb", 0),
       ("100252", "SSD PCIe4 1TB 기업용", 0), ("100244", "SSD PCIe4 1TB 소비자용", 0)]


def load(p):
    d = json.load(open(p, encoding="utf-8"))
    return d.get("items", {}), d.get("labels", {})


def at(pts, days):
    """마지막 점 기준 days 일 전(그날 또는 그 이전 마지막 점) 값"""
    last = date.fromisoformat(pts[-1]["date"])
    base = [p for p in pts if date.fromisoformat(p["date"]) <= last - timedelta(days=days)]
    return base[-1]["value"] if base else None


def pct(a, b):
    return None if not b or a is None else (a / b - 1) * 100


def f(x):
    return "—" if x is None else f"{x:+.1f}%"


def row(name, pts, digits, spans):
    v = pts[-1]["value"]
    ch = [pct(v, at(pts, d)) for d in spans]
    return v, ch, f"{name} <b>${v:,.{digits}f}</b> · " + " · ".join(f"{l} {f(c)}" for l, c in zip(("1주", "1개월", "3개월"), ch))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dram")       # 예전 호환용(무시) — 이제 docs/data/memory_prices.json 을 읽는다
    ap.add_argument("--cfm")
    ap.add_argument("--contract")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    # 2026-10-16: 매일 받는 자료는 최근 며칠뿐이라, 사이트용으로 합쳐 둔 이력(docs/data/memory_prices.json)을 읽는다
    store = json.load(open(os.path.join(BASE, "docs", "data", "memory_prices.json"), encoding="utf-8"))["store"]
    conv = lambda src: {k: [{"date": d, "value": v} for d, v in pts] for k, pts in (store.get(src) or {}).items()}
    dram, cfm, ct = conv("dram"), conv("cfm"), conv("contract")

    spot = dram.get("ddr5_16g") or []
    if not spot:
        sys.exit("DDR5 현물 자료 없음")
    key = spot[-1]["date"]
    st = {}
    try:
        st = json.load(open(STATE, encoding="utf-8"))
    except Exception:
        pass
    if st.get("last") == key and not a.force:
        print("이미 보낸 기준일", key)
        return

    day = (spot[-1]["value"] / spot[-2]["value"] - 1) * 100 if len(spot) > 1 else None
    fix = ct.get("ct_ddr5_16g") or []
    L = [f"💾 <b>메모리 가격</b> · DDR5 현물 {date.fromisoformat(key).strftime('%m/%d')} 마감", ""]
    L.append(f"<b>DDR5 16Gb 현물 ${spot[-1]['value']:,.2f}</b> ({f(day)} 전일)")
    if fix:
        prem = pct(spot[-1]["value"], fix[-1]["value"])
        L.append(f"고정거래가 ${fix[-1]['value']:,.2f}({fix[-1]['date'][5:7].lstrip('0')}월) · 현물이 고정가보다 {f(prem)}")
    movers = []
    L += ["", "<b>현물·모듈·낸드</b> (DRAMeXchange)"]
    for k, n, dg in DRAM:
        pts = dram.get(k) or []
        if not pts:
            continue
        v, ch, s = row(n, pts, dg, (7, 30, 91))
        L.append(f"• {s} <i>({pts[-1]['date'][5:].replace('-', '/')})</i>")
        if (ch[0] is not None and abs(ch[0]) >= 5) or (ch[1] is not None and abs(ch[1]) >= 10):
            movers.append(f"{n} 1주 {f(ch[0])}, 1개월 {f(ch[1])}")
    L += ["", "<b>중국 채널가</b> (CFM)"]
    for k, n, dg in CFM:
        pts = cfm.get(k) or []
        if not pts:
            continue
        v, ch, s = row(n, pts, dg, (7, 30, 91))
        L.append(f"• {s}")
        if ch[0] is not None and abs(ch[0]) >= 3:
            movers.append(f"중국 {n} 1주 {f(ch[0])}")
    if movers:
        L += ["", "⚡ <b>크게 움직인 것</b>"] + [f"• {m}" for m in movers]
    L += ["", "괄호 안은 품목별 기준일(모듈·낸드는 주 1회 갱신)"]
    text = "\n".join(L)

    def ser(items, k):
        return [(p["date"], p["value"]) for p in items.get(k) or []]
    charts = [
        C.line("mem_ddr5", "DDR5 16Gb 현물 vs 고정거래가", ("DRAMeXchange 현물 · TrendForce 고정거래가 · 달러 · 기준 ", key),
               [("현물", ser(dram, "ddr5_16g")), ("고정거래가", ser(ct, "ct_ddr5_16g"))], digits=2, since_days=400),
        C.line("mem_rdimm", "서버 모듈 가격", ("DRAMeXchange DDR5 32GB · 중국 계약가 DDR5 64GB · 달러 · 기준 ", key),
               [("DDR5 32GB", ser(dram, "ddr5_rdimm_32g")), ("중국 계약 64GB", ser(cfm, "100263"))], digits=0, since_days=400),
        C.line("mem_nand", "낸드 웨이퍼 (TLC)", ("DRAMeXchange · 달러 · 기준 ", (dram.get("nand_512g_tlc") or [{}])[-1].get("date", "")),
               [("512Gb", ser(dram, "nand_512g_tlc")), ("256Gb", ser(dram, "nand_256g_tlc")), ("128Gb", ser(dram, "nand_128g_tlc"))],
               digits=2, since_days=400),
    ]
    if a.dry:
        print(text)
        print(charts)
        return
    T.send_photos(charts, caption=f"💾 메모리 가격 그래프 · {key}")
    T.send(text)
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump({"last": key}, open(STATE, "w", encoding="utf-8"))
    print("보냄", key)


if __name__ == "__main__":
    main()
