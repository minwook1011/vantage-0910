#!/usr/bin/env python3
"""한국 기업 데이터 허브 — 주가와 실적(매출·영업이익·OPM·성장률)을 기업별 파일로 모은다.

  python fetch_kr_companies.py --universe --top 30   # 코스피 20일 평균 거래대금 상위 N개를 편입 목록에 추가
  python fetch_kr_companies.py                       # 편입 목록 전 종목의 주가·실적 갱신

편입 목록: data_sources/kr_universe.json (한 번 편입된 기업은 빠지지 않는다. 잡주 제외 = 보통주·시총 하한)
과거 실적: data_sources/kr_financials/{code}.json (DART 공시 원 단위 백필, 네이버 5분기 창 밖의 과거 분기)
최근 실적: 네이버 금융(FnGuide) 분기 5개·연간 3개 + 컨센서스(추정치로 표시)
출력: docs/data/kr_companies.json (목록·요약), docs/data/kr/{code}.json (주가·실적 상세)
표준 라이브러리만 쓴다. 빈 값은 0으로 채우지 않는다.
"""
import argparse
import calendar
import json
import math
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UNIVERSE = ROOT / "data_sources" / "kr_universe.json"
HISTORY_DIR = ROOT / "data_sources" / "kr_financials"
OUT_DIR = ROOT / "docs" / "data" / "kr"
INDEX = ROOT / "docs" / "data" / "kr_companies.json"
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; VantageFinancialData/1.0)"
M_API = "https://m.stock.naver.com/api"
CHART = "https://fchart.stock.naver.com/sise.nhn?symbol={code}&timeframe=day&count={count}&requestType=0"
REV_LABELS = ("매출액", "영업수익", "순영업수익", "보험수익")


def read_url(url, retries=2):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://m.stock.naver.com/"})
            with urllib.request.urlopen(req, timeout=25) as res:
                return res.read()
        except Exception:
            if attempt == retries:
                raise
            time.sleep(1.5 * (attempt + 1))


def get_json(url):
    return json.loads(read_url(url))


def number(raw):
    if raw is None or isinstance(raw, bool):
        return None
    try:
        v = float(str(raw).replace(",", "").replace("%", "").strip())
        return v if math.isfinite(v) else None
    except ValueError:
        return None


def month_end(year, month):
    return f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def write_if_changed(path, data, indent=None):
    text = json.dumps(data, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"), allow_nan=False) + "\n"
    strip = lambda d: {k: v for k, v in d.items() if k != "checked_at"} if isinstance(d, dict) else d
    if path.exists() and strip(load_json(path, None)) == strip(data):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return True


# ── 주가 ──
def fetch_chart(code, count):
    root = ET.fromstring(read_url(CHART.format(code=code, count=count)).decode("euc-kr", "replace").replace('encoding="EUC-KR"', ""))
    rows = []
    for item in root.iter("item"):
        f = item.attrib.get("data", "").split("|")
        close, vol = (number(f[4]), number(f[5])) if len(f) >= 6 else (None, None)
        if close and close > 0:
            rows.append((datetime.strptime(f[0], "%Y%m%d").date().isoformat(), close, vol or 0))
    return rows


# ── 편입 목록(거래대금 상위) ──
def upjong_names():
    try:
        data = get_json(f"{M_API}/stocks/industry?page=1&pageSize=100")
        return {str(g["no"]): g["name"] for g in data.get("groups", [])}
    except Exception:
        return {}


def build_universe(top, min_cap_eok, pages):
    cands = []
    for page in range(1, pages + 1):
        data = get_json(f"{M_API}/stocks/marketValue/KOSPI?page={page}&pageSize=100")
        for s in data.get("stocks", []):
            code, name = s["itemCode"], s["stockName"]
            # 잡주·중복 제외: 보통주만(우선주 코드 끝자리 ≠ 0), ETF/ETN/리츠/스팩 제외, 시총 하한
            if s.get("stockEndType") != "stock" or not code.endswith("0") or re.search(r"스팩|리츠|REIT", name):
                continue
            cap = number(s.get("marketValue"))  # 억원
            if cap is None or cap < min_cap_eok:
                continue
            cands.append({"code": code, "name": name, "market": "KOSPI", "mcap_eok": cap})

    def avg_value(c):
        try:
            rows = fetch_chart(c["code"], 20)
            c["avg_value_eok"] = round(sum(p * v for _, p, v in rows) / len(rows) / 1e8, 1) if rows else None
        except Exception:
            c["avg_value_eok"] = None
        return c

    with ThreadPoolExecutor(8) as ex:
        cands = list(ex.map(avg_value, cands))
    cands = sorted((c for c in cands if c["avg_value_eok"]), key=lambda c: -c["avg_value_eok"])[:top]
    return cands


def update_universe(args):
    uni = load_json(UNIVERSE, {"schema_version": 1, "companies": []})
    have = {c["code"]: c for c in uni["companies"]}
    picked = build_universe(args.top, args.min_cap, args.pages)
    sectors = upjong_names()
    now = datetime.now(KST).isoformat(timespec="seconds")
    for rank, c in enumerate(picked, 1):
        entry = have.get(c["code"]) or {"code": c["code"], "name": c["name"], "market": c["market"], "added_at": now[:10], "added_by": f"코스피 20일 평균 거래대금 상위 {args.top}"}
        entry.update({"name": c["name"], "mcap_eok": c["mcap_eok"], "avg_value_eok": c["avg_value_eok"], "value_rank": rank})
        if not entry.get("sector"):
            try:
                info = get_json(f"{M_API}/stock/{c['code']}/integration")
                entry["sector_code"] = info.get("industryCode")
                entry["sector"] = sectors.get(str(info.get("industryCode")), "")
                entry["peers"] = [p["itemCode"] for p in (info.get("industryCompareInfo") or []) if p.get("itemCode") != c["code"]][:6]
            except Exception:
                pass
        have[c["code"]] = entry
    uni.update({"schema_version": 1, "updated_at": now,
                "criteria": f"코스피 보통주 · 시총 {args.min_cap:,.0f}억원 이상 · 최근 20거래일 평균 거래대금 순위(편입 후 유지)",
                "companies": sorted(have.values(), key=lambda c: (c.get("value_rank") or 999, c["code"]))})
    write_if_changed(UNIVERSE, uni, indent=2)
    print(json.dumps({"universe": len(uni["companies"]), "picked": [c["name"] for c in picked]}, ensure_ascii=False))


# ── 실적 ──
def naver_financials(code, period):
    info = get_json(f"{M_API}/stock/{code}/finance/{period}")["financeInfo"]
    rows = {r["title"].strip(): r["columns"] for r in info["rowList"]}
    rev_row = next((rows[l] for l in REV_LABELS if l in rows), {})
    out = []
    for t in info["trTitleList"]:
        key = t["key"]
        if len(key) != 6 or not key.isdigit():
            continue
        rec = {"date": month_end(int(key[:4]), int(key[4:])), "est": t.get("isConsensus") == "Y", "source": "네이버 금융(FnGuide)"}
        rec["revenue"] = number(rev_row.get(key, {}).get("value"))
        rec["operating_income"] = number(rows.get("영업이익", {}).get(key, {}).get("value"))
        rec["net_income"] = number(rows.get("당기순이익", {}).get(key, {}).get("value"))
        if any(rec[k] is not None for k in ("revenue", "operating_income")):
            out.append(rec)
    return out


def dart_history(code):
    raw = load_json(HISTORY_DIR / f"{code}.json", None)
    if not raw:
        return {"quarterly": [], "annual": []}
    out = {}
    for key in ("quarterly", "annual"):
        rows = []
        for r in raw.get(key, []):
            rec = {"date": r["date"], "est": False, "source": "DART 공시"}
            for f in ("revenue", "operating_income", "net_income"):
                v = number(r.get(f))
                rec[f] = round(v / 1e8, 2) if v is not None else None  # 원 → 억원
            if rec["revenue"] == 0:  # 매출 0 은 공시 누락(파싱 오류) — 0으로 그리지 않는다
                rec.update(revenue=None, operating_income=None, net_income=None)
            rows.append(rec)
        if key == "quarterly":
            # 재작성(중단영업 분리 등)으로 연간−누적 방식 4분기가 깨진 값: 앞뒤 분기 중앙값의 35% 미만이면 비운다
            revs = [r["revenue"] for r in rows]
            for i, r in enumerate(rows):
                near = sorted(v for v in revs[max(0, i - 2):i] + revs[i + 1:i + 3] if v is not None and v > 0)
                if r["revenue"] is not None and len(near) >= 2 and r["revenue"] < near[len(near) // 2] * 0.35:
                    r.update(revenue=None, operating_income=None, net_income=None, note="원천 값 이상치 제외")
        out[key] = rows
    return out


def growth_label(cur, prev):
    if cur is None or prev is None:
        return None, None
    if prev <= 0:
        if prev == 0:
            return None, None
        return None, "흑자전환" if cur > 0 else ("적자축소" if cur > prev else "적자확대")
    if cur <= 0:
        return None, "적자전환"
    return round((cur / prev - 1) * 100, 2), None


def enrich(rows):
    by = {r["date"][:7]: r for r in rows}
    for r in rows:
        rev, op = r.get("revenue"), r.get("operating_income")
        r["opm"] = round(op / rev * 100, 2) if rev and op is not None and rev > 0 else None
        y, m = int(r["date"][:4]), r["date"][5:7]
        prior = by.get(f"{y - 1}-{m}", {})
        pr = prior.get("revenue")
        r["revenue_yoy"] = round((rev / pr - 1) * 100, 2) if rev is not None and pr and pr > 0 else None
        r["operating_income_yoy"], r["op_label"] = growth_label(op, prior.get("operating_income"))
        # 직전 분기 대비(QoQ) — 분기 자료에서만 의미가 있다
        pm = datetime(y, int(m), 1) - timedelta(days=80)
        prev_q = by.get(f"{pm.year}-{pm.month:02d}", {})
        pq = prev_q.get("revenue")
        r["revenue_qoq"] = round((rev / pq - 1) * 100, 2) if rev is not None and pq and pq > 0 else None
    return rows


def merge(history, recent, old):
    """과거 백필 → 이전 수집분 → 최신 수집 순으로 덮는다(확정치가 추정치를 대체)."""
    merged = {}
    for src in (history, old, recent):
        for r in src:
            prev = merged.get(r["date"])
            if prev and not prev.get("est") and r.get("est"):
                continue
            # 네이버 억원 반올림 값이 DART 원 단위 값과 사실상 같으면 공시값을 유지
            if prev and prev.get("source") == "DART 공시" and not r.get("est") and all(
                    r.get(f) is None or (prev.get(f) is not None and abs(r[f] - prev[f]) <= 1) for f in ("revenue", "operating_income")):
                continue
            row = {k: r.get(k) for k in ("date", "revenue", "operating_income", "net_income", "est", "source")}
            for f in ("revenue", "operating_income", "net_income"):
                if row[f] is None and prev and prev.get(f) is not None:
                    row[f] = prev[f]
            merged[r["date"]] = row
    return enrich([merged[d] for d in sorted(merged)])


def refresh_company(c, now, price_count):
    code = c["code"]
    path = OUT_DIR / f"{code}.json"
    old = load_json(path, {})
    errors = []
    data = {"schema_version": 1, "code": code, "name": c["name"], "market": c.get("market", "KOSPI"),
            "sector": c.get("sector", ""), "checked_at": now}
    try:
        rows = fetch_chart(code, price_count)
        if len(rows) < 20:
            raise ValueError("주가 관측치 부족")
        data["price"] = {"source": "네이버 금융 일봉", "unit": "원", "as_of": rows[-1][0],
                         "points": [{"date": d, "value": p} for d, p, _ in rows]}
    except Exception as e:
        errors.append("주가: " + type(e).__name__)
        data["price"] = old.get("price", {"points": []})
    hist = dart_history(code)
    fins = {"unit": "억원"}
    for period, key in (("quarter", "quarterly"), ("annual", "annual")):
        prior = (old.get("financials") or {}).get(key, [])
        try:
            recent = naver_financials(code, period)
        except Exception as e:
            errors.append(key + ": " + type(e).__name__)
            recent = []
        fins[key] = merge(hist[key], recent, prior)
    data["financials"] = fins
    data["refresh_errors"] = errors
    changed = write_if_changed(path, data)
    return data, changed


def summary(c, d):
    pts = (d.get("price") or {}).get("points") or []
    q = [r for r in d["financials"]["quarterly"] if not r.get("est")]
    a = [r for r in d["financials"]["annual"] if not r.get("est")]
    last_q = q[-1] if q else {}
    chg = lambda n: round((pts[-1]["value"] / pts[-1 - n]["value"] - 1) * 100, 2) if len(pts) > n else None
    return {"code": c["code"], "name": c["name"], "market": c.get("market", "KOSPI"), "sector": c.get("sector", ""),
            "peers": c.get("peers", []), "mcap_eok": c.get("mcap_eok"), "avg_value_eok": c.get("avg_value_eok"), "value_rank": c.get("value_rank"),
            "close": pts[-1]["value"] if pts else None, "as_of": pts[-1]["date"] if pts else None,
            "chg_1d": chg(1), "chg_1m": chg(21), "chg_1y": chg(250),
            "spark": [p["value"] for p in pts[-120::4]],
            "q": {k: last_q.get(k) for k in ("date", "revenue", "operating_income", "opm", "revenue_yoy", "operating_income_yoy", "op_label")},
            "fy": {k: (a[-1] if a else {}).get(k) for k in ("date", "revenue", "operating_income", "opm", "revenue_yoy")},
            "quarters": len(q)}


def refresh_all(args):
    uni = load_json(UNIVERSE, {"companies": []})["companies"]
    if args.codes:
        uni = [c for c in uni if c["code"] in args.codes]
    now = datetime.now(KST).isoformat(timespec="seconds")
    results = {}
    with ThreadPoolExecutor(6) as ex:
        for c, (d, changed) in zip(uni, ex.map(lambda c: refresh_company(c, now, args.price_days), uni)):
            results[c["code"]] = (c, d, changed)
    index = load_json(INDEX, {"companies": []})
    rows = {r["code"]: r for r in index.get("companies", [])}
    for code, (c, d, _) in results.items():
        rows[code] = summary(c, d)
    all_uni = load_json(UNIVERSE, {"companies": []})["companies"]
    order = {c["code"]: i for i, c in enumerate(all_uni)}
    index = {"schema_version": 1, "checked_at": now,
             "criteria": load_json(UNIVERSE, {}).get("criteria", ""),
             "unit": {"financials": "억원", "price": "원"},
             "companies": sorted((r for r in rows.values() if r["code"] in order), key=lambda r: order[r["code"]])}
    write_if_changed(INDEX, index, indent=1)
    errs = {code: d["refresh_errors"] for code, (c, d, _) in results.items() if d["refresh_errors"]}
    print(json.dumps({"companies": len(results), "changed": sum(1 for *_, ch in results.values() if ch), "errors": errs}, ensure_ascii=False))
    return 1 if len(errs) > len(results) // 2 else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--universe", action="store_true", help="거래대금 상위 기업을 편입 목록에 추가")
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--min-cap", type=float, default=3000, help="시총 하한(억원)")
    ap.add_argument("--pages", type=int, default=3, help="시총 상위 몇 페이지(100개씩)에서 고를지")
    ap.add_argument("--price-days", type=int, default=1300)
    ap.add_argument("--codes", nargs="*")
    args = ap.parse_args()
    if args.universe:
        update_universe(args)
        return 0
    return refresh_all(args)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
