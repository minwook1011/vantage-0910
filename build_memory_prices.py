#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_memory_prices.py — 데이터 허브 '메모리 가격' 탭 자료 (docs/data/memory_prices.json) 만들기 (2026-10-16 사용자 요청)

자료는 Claude 커넥터 market_series(dram · cfm · dram_contract)에서만 받을 수 있어,
예약 작업 vantage-memory-daily 가 받은 JSON 파일을 넘겨주면 기존 이력에 날짜별로 합친다(덮어쓰기 아님).
커넥터가 긴 기간은 점을 솎아서 주므로, 매일 최근 며칠을 정확히 받아 이어 붙이면 이력이 촘촘해진다.
  python build_memory_prices.py --dram a.json --cfm b.json --contract c.json   (일부만 줘도 됨)
"""
import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "memory_prices.json")
KST = timezone(timedelta(hours=9))

# DRAMeXchange 품목 이름 (키 → 화면 이름, 단위)
DX = {
    "ddr5_16g": ("DDR5 16Gb 현물", "칩"), "ddr5_16g_ett": ("DDR5 16Gb 현물 (eTT)", "칩"),
    "ddr4_16g": ("DDR4 16Gb 현물", "칩"), "ddr4_16g_ett": ("DDR4 16Gb 현물 (eTT)", "칩"),
    "ddr4_8g": ("DDR4 8Gb 현물", "칩"), "ddr4_8g_ett": ("DDR4 8Gb 현물 (eTT)", "칩"), "ddr3_4g": ("DDR3 4Gb 현물", "칩"),
    "ddr5_rdimm_32g": ("DDR5 서버 모듈 RDIMM 32GB", "모듈"), "ddr5_udimm_16g": ("DDR5 PC 모듈 UDIMM 16GB", "모듈"),
    "ddr4_udimm_16g": ("DDR4 PC 모듈 UDIMM 16GB", "모듈"),
    "gddr6_8g": ("GDDR6 8Gb", "칩"), "gddr5_8g": ("GDDR5 8Gb", "칩"),
    "nand_512g_tlc": ("낸드 웨이퍼 512Gb TLC", "웨이퍼"), "nand_256g_tlc": ("낸드 웨이퍼 256Gb TLC", "웨이퍼"),
    "nand_128g_tlc": ("낸드 웨이퍼 128Gb TLC", "웨이퍼"), "mlc_64g": ("낸드 MLC 64Gb", "칩"), "mlc_32g": ("낸드 MLC 32Gb", "칩"),
    "slc_2g": ("낸드 SLC 2Gb", "칩"), "slc_1g": ("낸드 SLC 1Gb", "칩"),
    "microsd_128g": ("마이크로SD 128GB", "카드"), "microsd_64g": ("마이크로SD 64GB", "카드"),
    "microsd_32g": ("마이크로SD 32GB", "카드"), "microsd_16g": ("마이크로SD 16GB", "카드"),
}
CT = {"ct_ddr5_16g": "DDR5 16Gb 고정거래가", "ct_ddr4_16g": "DDR4 16Gb 고정거래가", "ct_ddr4_8g": "DDR4 8Gb 고정거래가",
      "ct_ddr4_4g": "DDR4 4Gb 고정거래가", "ct_ddr3_4g": "DDR3 4Gb 고정거래가",
      "ct_ddr5_sodimm_8g": "DDR5 노트북 모듈 8GB 계약가", "ct_ddr4_sodimm_16g": "DDR4 노트북 모듈 16GB 계약가",
      "ct_ddr4_sodimm_8g": "DDR4 노트북 모듈 8GB 계약가", "ct_nand_128g_mlc": "낸드 MLC 128Gb 계약가",
      "ct_nand_64g_mlc": "낸드 MLC 64Gb 계약가", "ct_nand_32g_mlc": "낸드 MLC 32Gb 계약가"}
# CFM 분류(라벨 앞부분) → 화면 묶음 이름
CFM_CAT = {"rdimmcontract": "서버 모듈 계약가", "ddrchannel": "PC 모듈 (채널)", "ddroem": "노트북·PC 모듈 (제조사 납품)",
           "ddr": "DRAM 칩", "lpddr": "모바일 D램 (LPDDR)", "nandflash": "낸드 웨이퍼", "ssdoem": "SSD 기업용 (제조사 납품)",
           "ssdchannel": "SSD 소비자용 (채널)", "emmc": "모바일 저장 (eMMC)", "ufs": "모바일 저장 (UFS)",
           "emcp": "모바일 복합 칩 (eMCP)", "umcp": "모바일 복합 칩 (uMCP)"}
GROUPS = [
    {"id": "dx_spot", "src": "dram", "label": "DRAM 칩 현물", "desc": "DRAMeXchange · 매 영업일", "keys": ["ddr5_16g", "ddr5_16g_ett", "ddr4_16g", "ddr4_16g_ett", "ddr4_8g", "ddr4_8g_ett", "ddr3_4g"]},
    {"id": "dx_module", "src": "dram", "label": "DRAM 모듈 · 그래픽 메모리", "desc": "DRAMeXchange · 주 1회", "keys": ["ddr5_rdimm_32g", "ddr5_udimm_16g", "ddr4_udimm_16g", "gddr6_8g", "gddr5_8g"]},
    {"id": "dx_nand", "src": "dram", "label": "낸드 웨이퍼 · 칩 · 카드", "desc": "DRAMeXchange · 주 1회", "keys": ["nand_512g_tlc", "nand_256g_tlc", "nand_128g_tlc", "mlc_64g", "mlc_32g", "slc_2g", "slc_1g", "microsd_128g", "microsd_64g", "microsd_32g", "microsd_16g"]},
    {"id": "contract", "src": "contract", "label": "고정거래가 · 계약가", "desc": "TrendForce · 월 1회(한 달 늦게 공개)", "keys": list(CT)},
]


def kst_now():
    return datetime.now(KST)


def load_raw(p):
    if not p:
        return {}, {}
    d = json.load(open(p, encoding="utf-8"))
    return d.get("items", {}), d.get("labels", {})


def merge(old, new):
    by = {p[0]: p[1] for p in old or []}
    for p in new:
        if p.get("value") is not None:
            by[p["date"][:10]] = round(float(p["value"]), 4)
    return [[d, by[d]] for d in sorted(by)]


def at(pts, days):
    if not pts:
        return None
    last = date.fromisoformat(pts[-1][0])
    base = [v for d, v in pts if date.fromisoformat(d) <= last - timedelta(days=days)]
    return base[-1] if base else None


def chg(pts):
    if not pts:
        return {}
    v = pts[-1][1]
    out = {}
    for k, days in (("w1", 7), ("m1", 30), ("m3", 91), ("y1", 365)):
        b = at(pts, days)
        out[k] = round((v / b - 1) * 100, 1) if b else None
    # 전일(전 관측) 대비 — 바로 앞 점이 4일 안일 때만(솎인 구간이면 비움)
    d0, d1 = date.fromisoformat(pts[-2][0]) if len(pts) > 1 else None, date.fromisoformat(pts[-1][0])
    prev_bday = d1 - timedelta(days=3 if d1.weekday() == 0 else 1)
    if d0 and d0 >= prev_bday:   # 바로 앞 영업일 값이 있을 때만(이력이 솎인 구간이면 비움)
        out["d1"] = round((v / pts[-2][1] - 1) * 100, 2) if pts[-2][1] else None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dram")
    ap.add_argument("--cfm")
    ap.add_argument("--contract")
    a = ap.parse_args()
    try:
        doc = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        doc = {}
    store = doc.get("store") or {"dram": {}, "cfm": {}, "contract": {}}
    cfm_labels = doc.get("cfm_labels") or {}
    for src, path in (("dram", a.dram), ("cfm", a.cfm), ("contract", a.contract)):
        items, labels = load_raw(path)
        if src == "cfm":
            cfm_labels.update(labels)
        for k, pts in items.items():
            if pts:
                store.setdefault(src, {})[k] = merge(store.get(src, {}).get(k), pts)

    groups = []
    for g in GROUPS:
        rows = []
        for k in g["keys"]:
            pts = store.get(g["src"], {}).get(k)
            if not pts:
                continue
            name = DX[k][0] if g["src"] == "dram" else CT.get(k, k)
            rows.append({"key": k, "label": name, "kind": DX[k][1] if g["src"] == "dram" else "계약", "last": pts[-1][1],
                         "date": pts[-1][0], "chg": chg(pts), "src": g["src"]})
        if rows:
            groups.append({"id": g["id"], "label": g["label"], "desc": g["desc"], "source": "DRAMeXchange" if g["src"] == "dram" else "TrendForce", "rows": rows})
    # CFM — 분류별 묶음
    cat_rows = {}
    for k, pts in sorted(store.get("cfm", {}).items()):
        lab = cfm_labels.get(k, k)
        cat, _, name = lab.partition("/")
        if not pts or cat not in CFM_CAT:
            continue
        cat_rows.setdefault(cat, []).append({"key": k, "label": name or lab, "kind": CFM_CAT[cat], "last": pts[-1][1], "date": pts[-1][0],
                                             "chg": chg(pts), "src": "cfm"})
    for cat, nm in CFM_CAT.items():
        if cat in cat_rows:
            groups.append({"id": "cfm_" + cat, "label": "중국 " + nm, "desc": "CFM 중국 채널 도매 호가 · 주 1회", "source": "CFM",
                           "rows": cat_rows[cat]})

    as_of = {}
    for src in ("dram", "cfm", "contract"):
        ds = [p[-1][0] for p in store.get(src, {}).values() if p]
        as_of[src] = max(ds) if ds else None
    out = {"schema_version": 1, "generated_at": kst_now().isoformat(timespec="minutes"), "as_of": as_of, "groups": groups,
           "store": store, "cfm_labels": cfm_labels,
           "note": "DRAMeXchange 현물·모듈·웨이퍼, TrendForce 고정거래가(한 달 늦게 공개), CFM 중국 채널 도매 호가. 출처가 다른 가격끼리는 섞어 비교하지 않습니다. 단위는 모두 달러."}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("wrote", OUT, "groups", len(groups), "as_of", as_of)


if __name__ == "__main__":
    main()
