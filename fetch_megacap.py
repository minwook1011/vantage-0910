#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_megacap.py — megacap_universe.json 명단의 시세·모멘텀 갱신 → docs/megacap.json
표준 라이브러리만 사용. 매일 실행.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
UNIVERSE = os.path.join(BASE, "docs", "megacap_universe.json")
OUT = os.path.join(BASE, "docs", "megacap.json")
PROFILES = os.path.join(BASE, "docs", "megacap_profiles.json")
# 5년 일봉 원본(압축 전) — backtest_ta.py가 다시 받지 않도록 남겨두는 캐시(깃에는 안 올림)
DAILY_CACHE = os.path.join(BASE, "data_sources", "_cache", "megacap_daily.json")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) etf-flow-tracker/1.0"

_last_req = [0.0]

def _throttle():
    wait = _last_req[0] + 0.5 - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_req[0] = time.time()

def http_get(url, timeout=20):
    for attempt in range(3):
        _throttle()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
            else:
                print(f"  [skip] {url[:80]} -> {e}")
    return None

DAILY_KEEP_DAYS = 380  # 최근 ~13개월은 일봉 그대로, 그 이전(최대 5년)은 주봉으로 압축해 용량 절감

def compress_candles(ch):
    """최근 DAILY_KEEP_DAYS는 일봉 그대로 유지하고, 그보다 오래된 구간은 주봉(월~금 묶음)으로 집계.
    1개 종목당 캔들 수를 최대 5년치 일봉(~1260개) 대신 약 550~600개로 줄인다."""
    dates, o, h, l, c, v = ch["dates"], ch["o"], ch["h"], ch["l"], ch["c"], ch["v"]
    n = len(dates)
    split = max(0, n - DAILY_KEEP_DAYS)
    old_idx = range(0, split)
    weekly = {}
    order = []
    for i in old_idx:
        wk = datetime.strptime(dates[i], "%Y-%m-%d").strftime("%G-W%V")
        if wk not in weekly:
            weekly[wk] = {"d": dates[i], "o": o[i], "h": h[i], "l": l[i], "c": c[i], "v": v[i]}
            order.append(wk)
        else:
            slot = weekly[wk]
            slot["h"] = max(slot["h"], h[i])
            slot["l"] = min(slot["l"], l[i])
            slot["c"] = c[i]
            slot["v"] += v[i]
    out = [weekly[wk] for wk in order]
    out += [{"d": dates[i], "o": o[i], "h": h[i], "l": l[i], "c": c[i], "v": v[i]} for i in range(split, n)]
    return out

def fetch_chart(ticker):
    """야후 차트 API → {'dates','o','h','l','c','v'} (None 봉 제거)"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(ticker)}?range=5y&interval=1d")
    raw = http_get(url)
    if not raw:
        return None
    try:
        res = json.loads(raw)["chart"]["result"][0]
        ts = res.get("timestamp") or []
        q = res["indicators"]["quote"][0]
        out = {"dates": [], "o": [], "h": [], "l": [], "c": [], "v": []}
        for i, t in enumerate(ts):
            c = q["close"][i]
            if c is None:
                continue
            out["dates"].append(datetime.fromtimestamp(t, tz=KST).strftime("%Y-%m-%d"))
            out["c"].append(round(float(c), 4))
            out["o"].append(round(float(q["open"][i] or c), 4))
            out["h"].append(round(float(q["high"][i] or c), 4))
            out["l"].append(round(float(q["low"][i] or c), 4))
            out["v"].append(int(q["volume"][i] or 0))
        return out if len(out["c"]) >= 2 else None
    except Exception:
        return None

def fetch_news(query, limit=5):
    """Google News RSS 최근 7일"""
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(query)
           + "&hl=ko&gl=KR&ceid=KR:ko")
    raw = http_get(url)
    if not raw:
        return []
    items = []
    try:
        root = ET.fromstring(raw)
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip()
            pub = it.findtext("pubDate") or ""
            src_el = it.find("source")
            source = src_el.text.strip() if src_el is not None and src_el.text else ""
            try:
                dt = parsedate_to_datetime(pub)
                if dt < cutoff:
                    continue
                date = dt.astimezone(KST).strftime("%Y-%m-%d")
            except Exception:
                date = ""
            if title and link:
                items.append({"title": title, "link": link, "date": date, "source": source})
            if len(items) >= limit:
                break
    except Exception as e:
        print(f"  [news-fail] {query}: {e}")
    return items

def pct(a, b):
    if not b:
        return 0.0
    return round((a / b - 1) * 100, 2)

def ret_n(closes, n):
    if len(closes) <= n:
        return pct(closes[-1], closes[0])
    return pct(closes[-1], closes[-1 - n])

def get_crumb():
    """야후 쿠키+크럼 확보 (선행PER 조회용 quote API에 필요). 실패 시 (None, None)."""
    try:
        req = urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": UA})
        cookie = ""
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                cookie = r.headers.get("Set-Cookie", "")
        except urllib.error.HTTPError as e:
            cookie = e.headers.get("Set-Cookie", "")
        cookie = cookie.split(";")[0] if cookie else ""
        if not cookie:
            return None, None
        hdr = {"User-Agent": UA, "Cookie": cookie}
        req2 = urllib.request.Request("https://query1.finance.yahoo.com/v1/test/getcrumb", headers=hdr)
        with urllib.request.urlopen(req2, timeout=15) as r:
            crumb = r.read().decode("utf-8").strip()
        return (cookie, crumb) if crumb and "<" not in crumb else (None, None)
    except Exception as e:
        print(f"  [crumb-fail] {e}")
        return None, None

def fetch_pe(symbols, cookie, crumb):
    """v7 quote API로 선행/후행 PER 배치 조회 → {symbol: {pe_now, pe_next}}"""
    out = {}
    hdr = {"User-Agent": UA, "Cookie": cookie}
    for i in range(0, len(symbols), 40):
        batch = symbols[i:i + 40]
        url = ("https://query1.finance.yahoo.com/v7/finance/quote?symbols="
               + urllib.parse.quote(",".join(batch))
               + "&fields=trailingPE,forwardPE&crumb=" + urllib.parse.quote(crumb))
        try:
            req = urllib.request.Request(url, headers=hdr)
            _throttle()
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
            for q in json.loads(raw)["quoteResponse"]["result"]:
                out[q.get("symbol")] = {
                    "pe_now": round(q["trailingPE"], 1) if q.get("trailingPE") else None,
                    "pe_next": round(q["forwardPE"], 1) if q.get("forwardPE") else None,
                }
        except Exception as e:
            print(f"  [pe-fail] batch {i}: {e}")
    return out

def main():
    print(f"=== fetch_megacap.py 시작 ({datetime.now(KST).strftime('%Y-%m-%d %H:%M KST')}) ===")
    if not os.path.exists(UNIVERSE):
        print("[오류] megacap_universe.json 없음 — fetch_universe.py를 먼저 실행")
        sys.exit(1)
    uni = json.load(open(UNIVERSE, encoding="utf-8"))
    stocks_in = uni.get("stocks", [])

    out_stocks = []
    daily_cache = {}
    fail = 0
    for i, s in enumerate(stocks_in, 1):
        tk = s["ticker"]
        ch = fetch_chart(tk)
        if not ch:
            fail += 1
            continue
        dates, closes, vols = ch["dates"], ch["c"], ch["v"]
        year = dates[-1][:4]
        base = None
        for d, c in zip(dates, closes):
            if d[:4] < year:
                base = c
        ytd = pct(closes[-1], base if base is not None else closes[0])
        dv = [c * v for c, v in zip(closes, vols)]
        vr = round((sum(dv[-5:]) / 5) / (sum(dv[-20:]) / 20), 2) if len(dv) >= 20 and sum(dv[-20:]) > 0 else 1.0
        candles = compress_candles(ch)
        daily_cache[tk] = ch
        out_stocks.append({
            "ticker": tk, "name": s["name"], "sector": s["sector"],
            "rank": len(out_stocks) + 1,
            "mcap_usd": s.get("mcap_usd", 0),
            "price": round(closes[-1], 4),
            "r1w": ret_n(closes, 5), "r1m": ret_n(closes, 21),
            "r3m": ret_n(closes, 63), "ytd": ytd,
            "from_high": pct(closes[-1], max(closes[-252:])),
            "vol_ratio": vr,
            "spark": closes[-30:],
            "candles": candles,
        })
        if i % 50 == 0:
            print(f"  {i}/{len(stocks_in)} (실패 {fail})")

    if len(out_stocks) < len(stocks_in) * 0.2:
        print("[경고] 80% 이상 실패 — 기존 megacap.json 유지 후 종료")
        sys.exit(0)

    print("--- 선행PER 수집 ---")
    cookie, crumb = get_crumb()
    if crumb:
        pe_map = fetch_pe([s["ticker"] for s in out_stocks], cookie, crumb)
        for s in out_stocks:
            pe = pe_map.get(s["ticker"])
            if pe:
                s["pe_now"] = pe["pe_now"]
                s["pe_next"] = pe["pe_next"]
        print(f"  PER 확보: {sum(1 for s in out_stocks if s.get('pe_next') or s.get('pe_now'))}/{len(out_stocks)}")
    else:
        print("  [경고] 크럼 확보 실패 — PER 정보 없이 진행")

    print("--- 종목별 뉴스 수집 ---")
    news_count = 0
    for i, s in enumerate(out_stocks, 1):
        s["news"] = fetch_news(s["name"])
        news_count += len(s["news"])
        if i % 50 == 0:
            print(f"  {i}/{len(out_stocks)} (누적 {news_count}건)")
    print(f"  뉴스 총 {news_count}건 ({sum(1 for s in out_stocks if s['news'])}/{len(out_stocks)}종목에 1건 이상)")

    # 회사 개요(megacap_profiles.json)는 수동 관리 파일 — 신규 편입 종목 중 누락된 것만 경고
    if os.path.exists(PROFILES):
        try:
            profiles = json.load(open(PROFILES, encoding="utf-8")).get("profiles", {})
            missing = [s["ticker"] for s in out_stocks if s["ticker"] not in profiles]
            if missing:
                print(f"  [안내] megacap_profiles.json에 회사개요 없는 신규 종목 {len(missing)}개: {', '.join(missing[:20])}"
                      + (" ..." if len(missing) > 20 else ""))
        except Exception as e:
            print(f"  [profiles-check-fail] {e}")

    data = {
        "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "universe_updated": uni.get("updated", ""),
        "count": len(out_stocks),
        "stocks": out_stocks,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    try:
        os.makedirs(os.path.dirname(DAILY_CACHE), exist_ok=True)
        with open(DAILY_CACHE, "w", encoding="utf-8") as f:
            json.dump({"updated": data["updated"], "charts": daily_cache}, f, separators=(",", ":"))
    except Exception as e:
        print(f"  [daily-cache-fail] {e}")
    print(f"=== 완료: {len(out_stocks)}종 저장 (실패 {fail}) ===")

if __name__ == "__main__":
    main()
