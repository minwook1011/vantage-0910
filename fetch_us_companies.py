#!/usr/bin/env python3
"""해외 기업 데이터 허브 — S&P500 시총 상위 + 개별 추가 기업의 주가·실적(매출·영업이익·OPM·성장률).

  python fetch_us_companies.py --universe --top 200   # S&P500 시총 상위 N개를 편입 목록에 추가(+ EXTRA 기업)
  python fetch_us_companies.py                        # 편입 기업 주가 갱신 + 실적(SEC) 순환 갱신
  python fetch_us_companies.py --sec-all              # 실적(SEC XBRL)을 전 종목 새로 받기

편입 목록: data_sources/us_universe.json (한 번 편입된 기업은 빠지지 않는다)
실적: SEC EDGAR companyfacts(XBRL, 10-Q/10-K) → data_sources/us_financials/{ticker}.json 에 압축 저장.
      SEC 비제출 기업(ASM 등)은 수기 백필 파일 + Yahoo 재무 시계열(최근 5분기·4년)로 채운다.
      companyfacts 는 종목당 수 MB 라 매일 전부 받지 않고, 요일별로 1/7씩(+ 새 분기 발표 시기) 갱신한다.
출력: docs/data/us_companies.json (목록·요약), docs/data/us/{ticker}.json (주가·실적 상세, 금액 단위 백만)
표준 라이브러리만 쓴다. 빈 값은 0으로 채우지 않는다.
"""
import argparse
import calendar
import gzip
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fetch_kr_companies import enrich, load_json, write_if_changed

ROOT = Path(__file__).resolve().parent
UNIVERSE = ROOT / "data_sources" / "us_universe.json"
CACHE_DIR = ROOT / "data_sources" / "us_financials"
OUT_DIR = ROOT / "docs" / "data" / "us"
INDEX = ROOT / "docs" / "data" / "us_companies.json"
SP500 = ROOT / "docs" / "sp500_constituents.json"
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; VantageFinancialData/1.0)"
SEC_UA = "VantageResearch data-bot@vantage-research.dev"  # SEC 는 연락처 형식 UA 를 요구한다
# S&P500 밖이지만 넣는 기업: 화면 키 → 야후 심볼·거래소·업종
EXTRA = {
    "ASM": {"yahoo": "ASM.AS", "name": "ASM International", "market": "Euronext", "sector": "Information Technology", "desc": "반도체 장비 · ALD · 에피"},
}
REV_TAGS = ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax",
            "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense")
OP_TAGS = ("OperatingIncomeLoss",)
NI_TAGS = ("NetIncomeLoss", "ProfitLoss")


def http(url, headers=None, retries=2, timeout=30):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip", **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as res:
                raw = res.read()
                return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
        except Exception:
            if attempt == retries:
                raise
            time.sleep(2 * (attempt + 1))


def snap(day):
    """회계기간 말 날짜를 달 말일로 맞춘다(52/53주 결산: 10월 1일 → 9월 30일)."""
    d = date.fromisoformat(day)
    if d.day <= 7:
        d = d.replace(day=1) - timedelta(days=1)
    return f"{d.year}-{d.month:02d}-{calendar.monthrange(d.year, d.month)[1]:02d}"


# ── 편입 목록 ──
def yahoo_crumb():
    req = urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            cookie = r.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as e:
        cookie = e.headers.get("Set-Cookie", "")
    cookie = cookie.split(";")[0]
    crumb = http("https://query1.finance.yahoo.com/v1/test/getcrumb", {"Cookie": cookie}).decode().strip()
    return cookie, crumb


def yahoo_quotes(symbols):
    cookie, crumb = yahoo_crumb()
    out = {}
    for i in range(0, len(symbols), 50):
        batch = symbols[i:i + 50]
        url = ("https://query1.finance.yahoo.com/v7/finance/quote?symbols=" + urllib.parse.quote(",".join(batch)) +
               "&fields=marketCap,currency,longName,shortName&crumb=" + urllib.parse.quote(crumb))
        for q in json.loads(http(url, {"Cookie": cookie}))["quoteResponse"]["result"]:
            out[q["symbol"]] = q
        time.sleep(0.5)
    return out


def update_universe(args):
    sp = load_json(SP500, {}).get("map", {})
    if not sp:
        raise SystemExit("docs/sp500_constituents.json 이 비어 있습니다 (fetch_sp500_expand.py 로 먼저 받기)")
    quotes = yahoo_quotes(list(sp) + [e["yahoo"] for e in EXTRA.values()])
    ranked = sorted((tk for tk in sp if (quotes.get(tk) or {}).get("marketCap")), key=lambda tk: -quotes[tk]["marketCap"])
    # 같은 회사의 다른 주식 종류(GOOGL/GOOG, FOXA/FOX, NWSA/NWS)는 시총 큰 쪽 하나만
    seen, uniq = set(), []
    for tk in ranked:
        cik = cik_of(tk) or tk
        if cik not in seen:
            seen.add(cik); uniq.append(tk)
    ranked = uniq
    uni = load_json(UNIVERSE, {"schema_version": 1, "companies": []})
    have = {c["ticker"]: c for c in uni["companies"]}
    now = datetime.now(KST).isoformat(timespec="seconds")
    for rank, tk in enumerate(ranked, 1):
        q = quotes[tk]
        if rank > args.top and tk not in have:
            continue
        e = have.get(tk) or {"ticker": tk, "yahoo": tk, "market": "S&P500", "added_at": now[:10], "added_by": f"S&P500 시총 상위 {args.top}"}
        e.update({"name": sp[tk]["name"], "sector": sp[tk]["sector"], "currency": q.get("currency", "USD"),
                  "mcap": q["marketCap"], "mcap_rank": rank if rank <= args.top else None})
        have[tk] = e
    for tk, x in EXTRA.items():
        q = quotes.get(x["yahoo"], {})
        e = have.get(tk) or {"ticker": tk, "added_at": now[:10], "added_by": "개별 추가"}
        e.update({k: x[k] for k in ("yahoo", "name", "market", "sector", "desc")})
        e.update({"currency": q.get("currency", "USD"), "mcap": q.get("marketCap"), "mcap_rank": None})
        have[tk] = e
    uni.update({"schema_version": 1, "updated_at": now,
                "criteria": f"S&P500 시가총액 상위 {args.top}개(편입 후 유지) + 개별 추가(ASM 등)",
                "companies": sorted(have.values(), key=lambda c: (c.get("mcap_rank") or 9999, -(c.get("mcap") or 0)))})
    write_if_changed(UNIVERSE, uni, indent=1)
    print(json.dumps({"universe": len(uni["companies"]), "top": ranked[:10]}, ensure_ascii=False))


# ── 실적: SEC XBRL ──
_CIK = None


def cik_of(ticker):
    global _CIK
    if _CIK is None:
        data = json.loads(http("https://www.sec.gov/files/company_tickers.json", {"User-Agent": SEC_UA}))
        _CIK = {v["ticker"].upper().replace(".", "-"): v["cik_str"] for v in data.values()}
    return _CIK.get(ticker.upper())


def durations(gaap, tags):
    """태그 우선순위대로 (start, end) 기간별 값을 모은다(같은 기간은 가장 최근 공시값)."""
    out = {}
    for tag in tags:
        for f in (gaap.get(tag, {}).get("units", {}).get("USD") or []):
            if not f.get("start") or f.get("form", "").split("/")[0] not in ("10-Q", "10-K", "8-K", "10-KT"):
                continue
            key = (f["start"], f["end"])
            if key in out and out[key][1] != tag:
                continue  # 더 우선하는 태그 값이 이미 있음
            if key not in out or f.get("filed", "") >= out[key][2]:
                out[key] = (f["val"], tag, f.get("filed", ""))
    return {k: v[0] for k, v in out.items()}


def split_periods(vals):
    q, a = {}, {}
    for (s, e), v in vals.items():
        days = (date.fromisoformat(e) - date.fromisoformat(s)).days
        if 80 <= days <= 100:
            q[e] = (s, v)
        elif 350 <= days <= 380:
            a[e] = (s, v)
    # 4분기 = 연간 − 앞 세 분기(10-K 에는 4분기 단독 값이 없는 경우가 많다)
    for e, (s, v) in a.items():
        if e in q:
            continue
        inside = sorted(qe for qe, (qs, _) in q.items() if qs >= s and qe < e)
        if len(inside) == 3:
            q[e] = (inside[-1], v - sum(q[x][1] for x in inside))
    return q, a


def sec_financials(ticker):
    cik = cik_of(ticker)
    if not cik:
        return None
    gaap = json.loads(http(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", {"User-Agent": SEC_UA}, timeout=60)).get("facts", {}).get("us-gaap", {})
    series = {k: split_periods(durations(gaap, tags)) for k, tags in (("revenue", REV_TAGS), ("operating_income", OP_TAGS), ("net_income", NI_TAGS))}
    out = {}
    for idx, key in ((0, "quarterly"), (1, "annual")):
        rows = {}
        for field, pair in series.items():
            for end, (_, v) in pair[idx].items():
                if end < "2018-01-01":
                    continue
                rows.setdefault(snap(end), {})[field] = round(v / 1e6, 2)
        out[key] = [{"date": d, "revenue": r.get("revenue"), "operating_income": r.get("operating_income"), "net_income": r.get("net_income")}
                    for d, r in sorted(rows.items())]
    return {"ticker": ticker, "cik": cik, "source": "SEC EDGAR XBRL(10-Q·10-K)", "unit": "USD M", **out}


def yahoo_financials(symbol):
    now = int(time.time())
    types = ",".join(p + t for p in ("quarterly", "annual") for t in ("TotalRevenue", "OperatingIncome", "NetIncome"))
    data = json.loads(http(f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{urllib.parse.quote(symbol)}?type={types}&period1=1483228800&period2={now}"))
    out = {"quarterly": {}, "annual": {}}
    names = {"TotalRevenue": "revenue", "OperatingIncome": "operating_income", "NetIncome": "net_income"}
    for s in data["timeseries"]["result"]:
        t = s["meta"]["type"][0]
        period = "quarterly" if t.startswith("quarterly") else "annual"
        field = names[t.replace(period, "")]
        for x in s.get(t) or []:
            if x and x.get("reportedValue"):
                out[period].setdefault(snap(x["asOfDate"]), {})[field] = round(x["reportedValue"]["raw"] / 1e6, 2)
    return {k: [{"date": d, **{f: v.get(f) for f in names.values()}} for d, v in sorted(rows.items())] for k, rows in out.items()}


def manual_history(ticker):
    raw = load_json(CACHE_DIR / f"{ticker}.manual.json", None) or load_json(CACHE_DIR / f"{ticker}.json", None)
    if not raw or raw.get("source", "").startswith("SEC"):
        return {"quarterly": [], "annual": []}
    return {k: [{"date": r["date"], **{f: (round(r[f] / 1e6, 2) if r.get(f) is not None else None) for f in ("revenue", "operating_income", "net_income")}}
                for r in raw.get(k, [])] for k in ("quarterly", "annual")}


def merge_rows(*sources):
    """앞 소스부터 채우고 뒤 소스가 같은 칸을 덮는다(뒤가 우선). 뒤 소스의 빈 칸은 앞 소스 값을 유지한다."""
    merged = {}
    for src in sources:
        for r in src:
            row = merged.setdefault(r["date"], {"date": r["date"], "revenue": None, "operating_income": None, "net_income": None, "est": False})
            for f in ("revenue", "operating_income", "net_income"):
                if r.get(f) is not None:
                    row[f] = r[f]
    rows = [merged[d] for d in sorted(merged)]
    # 매출이 0 이하이거나 앞뒤 분기 중앙값의 35% 미만이면(태그 누락·재작성) 비운다
    revs = [r["revenue"] for r in rows]
    for i, r in enumerate(rows):
        near = sorted(v for v in revs[max(0, i - 2):i] + revs[i + 1:i + 3] if v is not None and v > 0)
        if r["revenue"] is not None and (r["revenue"] <= 0 or (len(near) >= 2 and r["revenue"] < near[len(near) // 2] * 0.35)):
            r.update(revenue=None, operating_income=None)
    return enrich(rows)


# ── 주가 ──
def yahoo_prices(symbol):
    data = json.loads(http(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range=5y&interval=1d"))["chart"]["result"][0]
    tz = data.get("meta", {}).get("gmtoffset", 0)
    pts = []
    for ts, c in zip(data.get("timestamp") or [], data["indicators"]["quote"][0].get("close") or []):
        if c is not None and math.isfinite(c) and c > 0:
            pts.append({"date": datetime.fromtimestamp(ts + tz, timezone.utc).date().isoformat(), "value": round(c, 2)})
    dedup = {p["date"]: p for p in pts}
    return [dedup[d] for d in sorted(dedup)], data.get("meta", {}).get("currency", "USD")


def refresh_sec(c, force):
    """요일별 1/7 순환 + 캐시 없음 + 최근 분기 말 후 30~75일(발표 시즌)이면 SEC 를 다시 받는다."""
    if c["ticker"] in EXTRA:
        return False
    cache = load_json(CACHE_DIR / f"{c['ticker']}.json", None)
    if force or not cache:
        return True
    today = datetime.now(KST).date()
    last_q = (cache.get("quarterly") or [{}])[-1].get("date")
    in_season = last_q and 100 < (today - date.fromisoformat(last_q)).days < 150
    fetched = cache.get("fetched_at", "2000-01-01")
    return (sum(map(ord, c["ticker"])) % 7 == today.weekday()) or (in_season and fetched < today.isoformat())


def need_yahoo(cache, financial):
    """야후로 보완할지: SEC 캐시가 없거나 짧음 / 최근 분기 매출이 끊김(태그 변경) / 최근 분기 영업이익 태그 없음."""
    if not cache or not cache.get("source", "").startswith("SEC"):
        return True
    q = cache.get("quarterly") or []
    if len(q) < 8:
        return True
    last_rev = max((r["date"] for r in q if r.get("revenue") is not None), default="2000-01-01")
    if (datetime.now(KST).date() - date.fromisoformat(last_rev)).days > 150:
        return True
    return not financial and any(r.get("operating_income") is None for r in q[-4:])


def refresh_company(c, now, force_sec):
    tk = c["ticker"]
    errors = []
    old = load_json(OUT_DIR / f"{tk}.json", {})
    data = {"schema_version": 1, "code": tk, "name": c["name"], "market": c.get("market", "S&P500"), "sector": c.get("sector", ""), "checked_at": now}
    try:
        pts, cur = yahoo_prices(c.get("yahoo", tk))
        if len(pts) < 20:
            raise ValueError("주가 관측치 부족")
        data["price"] = {"source": "Yahoo Finance 일봉", "unit": cur, "as_of": pts[-1]["date"], "points": pts}
    except Exception as e:
        errors.append("주가: " + type(e).__name__)
        data["price"] = old.get("price", {"points": []})
    currency = c.get("currency") or data["price"].get("unit") or "USD"
    if refresh_sec(c, force_sec):
        try:
            sec = sec_financials(tk)
            if sec and sec["quarterly"]:
                sec["fetched_at"] = now[:10]
                write_if_changed(CACHE_DIR / f"{tk}.json", sec)
        except Exception as e:
            errors.append("SEC: " + type(e).__name__)
    cache = load_json(CACHE_DIR / f"{tk}.json", None)
    is_sec = bool(cache and cache.get("source", "").startswith("SEC"))
    # 금융업 판정: GICS 금융이면서 SEC 영업이익 태그를 한 번도 쓰지 않은 기업(은행·보험·운용). V·SPGI·PYPL 처럼 영업이익을 공시하는 곳은 제외
    financial = c.get("sector") == "Financials" and not any(r.get("operating_income") is not None for r in ((cache or {}).get("quarterly") or []))
    fins = {"unit": currency + " M", "currency": currency}
    yh = {"quarterly": [], "annual": []}
    if need_yahoo(cache, financial):
        try:
            yh = yahoo_financials(c.get("yahoo", tk))
        except Exception as e:
            errors.append("Yahoo 재무: " + type(e).__name__)
    if financial:
        # 은행·보험·자산운용은 영업이익 개념이 없어 야후 값으로 채우지 않는다(SEC 영업이익 태그가 있으면 그 값만 쓴다)
        yh = {k: [{**r, "operating_income": None} for r in rows] for k, rows in yh.items()}
    manual = manual_history(tk)
    for key in ("quarterly", "annual"):
        sec_rows = cache.get(key, []) if is_sec else []
        # 우선순위: SEC 공시 > 수기 백필 > 야후(빈칸, 그리고 SEC 태그가 끊긴 최근 분기만 채운다)
        fins[key] = merge_rows(yh[key], manual[key], sec_rows)
    fins["source"] = " + ".join(s for s, ok in (("SEC EDGAR XBRL", is_sec), ("IR 공시 수기 백필", manual["quarterly"]),
                                                ("Yahoo Finance(빈칸 보완)" if is_sec else "Yahoo Finance", yh["quarterly"])) if ok)
    if financial and not any(r.get("operating_income") is not None for r in fins["quarterly"][-4:]):
        fins["op_note"] = "금융업(은행·보험·자산운용)은 영업이익 대신 순이익을 봅니다"
    data["financials"] = fins
    data["refresh_errors"] = errors
    changed = write_if_changed(OUT_DIR / f"{tk}.json", data)
    return data, changed


def summary(c, d):
    pts = (d.get("price") or {}).get("points") or []
    q = [r for r in d["financials"]["quarterly"] if r.get("revenue") is not None or r.get("operating_income") is not None]
    last_q = q[-1] if q else {}
    chg = lambda n: round((pts[-1]["value"] / pts[-1 - n]["value"] - 1) * 100, 2) if len(pts) > n else None
    return {"code": c["ticker"], "name": c["name"], "market": c.get("market", "S&P500"), "sector": c.get("sector", ""), "desc": c.get("desc", ""),
            "currency": d["financials"].get("currency", "USD"), "mcap": c.get("mcap"), "value_rank": c.get("mcap_rank"),
            "close": pts[-1]["value"] if pts else None, "as_of": pts[-1]["date"] if pts else None,
            "chg_1d": chg(1), "chg_1m": chg(21), "chg_1y": chg(250), "spark": [p["value"] for p in pts[-120::4]],
            "q": {k: last_q.get(k) for k in ("date", "revenue", "operating_income", "opm", "revenue_yoy", "operating_income_yoy", "op_label")},
            "quarters": len(q), "op_note": d["financials"].get("op_note")}


def refresh_all(args):
    uni = load_json(UNIVERSE, {"companies": []})["companies"]
    todo = [c for c in uni if not args.codes or c["ticker"] in args.codes]
    now = datetime.now(KST).isoformat(timespec="seconds")
    results = {}
    # SEC 는 초당 10회 제한 → 동시 4개
    with ThreadPoolExecutor(4) as ex:
        for c, (d, changed) in zip(todo, ex.map(lambda c: refresh_company(c, now, args.sec_all), todo)):
            results[c["ticker"]] = (c, d, changed)
    index = load_json(INDEX, {"companies": []})
    rows = {r["code"]: r for r in index.get("companies", [])}
    for tk, (c, d, _) in results.items():
        rows[tk] = summary(c, d)
    order = {c["ticker"]: i for i, c in enumerate(uni)}
    write_if_changed(INDEX, {"schema_version": 1, "checked_at": now, "criteria": load_json(UNIVERSE, {}).get("criteria", ""),
                             "unit": {"financials": "백만(통화 단위)", "price": "현지 통화"},
                             "companies": sorted((r for r in rows.values() if r["code"] in order), key=lambda r: order[r["code"]])})
    errs = {tk: d["refresh_errors"] for tk, (c, d, _) in results.items() if d["refresh_errors"]}
    print(json.dumps({"companies": len(results), "changed": sum(1 for *_, ch in results.values() if ch), "errors": errs}, ensure_ascii=False))
    return 1 if len(errs) > len(results) // 2 else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--universe", action="store_true")
    ap.add_argument("--top", type=int, default=200)
    ap.add_argument("--sec-all", action="store_true", help="실적(SEC)을 전 종목 새로 받기")
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
