#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_data.py — 섹터 ETF 시세 + 뉴스 수집 → docs/data.json
표준 라이브러리만 사용. API 키 불필요.
소스: Yahoo Finance 무인증 차트 API + Google News RSS
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data.json")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) etf-flow-tracker/1.0"
BENCHMARK = "ACWI"

# ============================================================
# [수정 지점 1] 추적 ETF 유니버스: (야후 티커, 한글명, 그룹, 뉴스 검색어)
# 티커를 추가/삭제하려면 이 리스트만 수정하면 된다.
# ============================================================
TICKERS = [
    # 미국 11개 섹터 SPDR
    ("XLK",  "미국 기술",       "미국 섹터", "미국 기술주"),
    ("XLF",  "미국 금융",       "미국 섹터", "미국 금융주"),
    ("XLE",  "미국 에너지",     "미국 섹터", "국제유가 정유"),
    ("XLV",  "미국 헬스케어",   "미국 섹터", "제약 바이오 신약"),
    ("XLI",  "미국 산업재",     "미국 섹터", "미국 산업재"),
    ("XLY",  "미국 경기소비재", "미국 섹터", "미국 소비주"),
    ("XLP",  "미국 필수소비재", "미국 섹터", "필수소비재"),
    ("XLB",  "미국 소재",       "미국 섹터", "화학업계"),
    ("XLU",  "미국 유틸리티",   "미국 섹터", "미국 유틸리티 전력주"),
    ("XLRE", "미국 리츠",       "미국 섹터", "미국 리츠 부동산"),
    ("XLC",  "미국 커뮤니케이션", "미국 섹터", "미국 커뮤니케이션 빅테크"),
    # 테마
    ("SOXX", "반도체",          "테마", "반도체 업황"),
    ("ITA",  "방산·항공우주",   "테마", "방위산업 방산 수출"),
    ("URA",  "우라늄·원자력",   "테마", "우라늄 원전 SMR"),
    ("TAN",  "태양광",          "테마", "태양광 산업"),
    ("BOTZ", "로봇·AI",         "테마", "로봇 AI 자동화"),
    # 지역
    ("EWY",  "한국",            "지역", "코스피 외국인"),
    ("EWJ",  "일본",            "지역", "일본 증시 닛케이"),
    ("EWT",  "대만",            "지역", "대만 증시 TSMC"),
    ("INDA", "인도",            "지역", "인도 증시"),
    ("FXI",  "중국 대형주",     "지역", "중국 증시"),
    ("EEM",  "신흥국",          "지역", "신흥국 증시"),
    # 채권·원자재
    ("TLT",  "미국 장기국채",   "채권·원자재", "미국 국채 금리"),
    ("GLD",  "금",              "채권·원자재", "금값 금 가격"),
    # 벤치마크
    ("ACWI", "글로벌 전체(벤치마크)", "벤치마크", "글로벌 증시"),
    # 한국 대표 ETF
    ("069500.KS", "KODEX 200",       "한국", "코스피200"),
    ("229200.KS", "KODEX 코스닥150", "한국", "코스닥"),
    ("091160.KS", "KODEX 반도체",    "한국", "한국 반도체주"),
    ("449450.KS", "PLUS K방산",      "한국", "한화에어로스페이스"),
]

# ============================================================
# [수정 지점 2] ETF별 대표 구성종목: {ETF: [(티커, 한글명), ...]}
# ============================================================
CONSTITUENTS = {
    "XLK":  [("MSFT", "마이크로소프트"), ("AAPL", "애플"), ("NVDA", "엔비디아"), ("AVGO", "브로드컴"), ("ORCL", "오라클"), ("CRM", "세일즈포스")],
    "XLF":  [("BRK-B", "버크셔해서웨이"), ("JPM", "JP모건"), ("V", "비자"), ("MA", "마스터카드"), ("BAC", "뱅크오브아메리카")],
    "XLE":  [("XOM", "엑슨모빌"), ("CVX", "셰브론"), ("COP", "코노코필립스"), ("EOG", "EOG리소시스"), ("SLB", "슐룸버거")],
    "XLV":  [("LLY", "일라이릴리"), ("UNH", "유나이티드헬스"), ("JNJ", "존슨앤드존슨"), ("ABBV", "애브비"), ("MRK", "머크")],
    "XLI":  [("GE", "GE에어로스페이스"), ("CAT", "캐터필러"), ("RTX", "RTX"), ("ETN", "이튼"), ("DE", "디어"), ("UBER", "우버")],
    "XLY":  [("AMZN", "아마존"), ("TSLA", "테슬라"), ("HD", "홈디포"), ("MCD", "맥도날드"), ("BKNG", "부킹홀딩스")],
    "XLP":  [("PG", "P&G"), ("COST", "코스트코"), ("WMT", "월마트"), ("KO", "코카콜라"), ("PM", "필립모리스")],
    "XLB":  [("LIN", "린데"), ("SHW", "셔윈윌리엄스"), ("APD", "에어프로덕츠"), ("FCX", "프리포트맥모란"), ("ECL", "에코랩")],
    "XLU":  [("NEE", "넥스트에라"), ("CEG", "컨스텔레이션에너지"), ("VST", "비스트라"), ("SO", "서던컴퍼니"), ("DUK", "듀크에너지")],
    "XLRE": [("PLD", "프로로지스"), ("AMT", "아메리칸타워"), ("EQIX", "에퀴닉스"), ("WELL", "웰타워"), ("SPG", "사이먼프로퍼티")],
    "XLC":  [("META", "메타"), ("GOOGL", "알파벳"), ("NFLX", "넷플릭스"), ("TMUS", "T모바일"), ("DIS", "디즈니")],
    "SOXX": [("NVDA", "엔비디아"), ("AVGO", "브로드컴"), ("AMD", "AMD"), ("TSM", "TSMC(ADR)"), ("MU", "마이크론"), ("QCOM", "퀄컴")],
    "ITA":  [("GE", "GE에어로스페이스"), ("RTX", "RTX"), ("BA", "보잉"), ("LMT", "록히드마틴"), ("NOC", "노스롭그루먼"), ("GD", "제너럴다이내믹스")],
    "URA":  [("CCJ", "카메코"), ("LEU", "센트러스에너지"), ("NXE", "넥스젠에너지"), ("UEC", "우라늄에너지"), ("OKLO", "오클로")],
    "TAN":  [("FSLR", "퍼스트솔라"), ("ENPH", "엔페이즈"), ("NXT", "넥스트래커"), ("RUN", "선런"), ("SEDG", "솔라엣지")],
    "BOTZ": [("NVDA", "엔비디아"), ("ISRG", "인튜이티브서지컬"), ("6861.T", "키엔스"), ("6954.T", "화낙"), ("TER", "테라다인")],
    "EWY":  [("005930.KS", "삼성전자"), ("000660.KS", "SK하이닉스"), ("373220.KS", "LG에너지솔루션"), ("005380.KS", "현대차"), ("012450.KS", "한화에어로스페이스"), ("105560.KS", "KB금융")],
    "EWJ":  [("7203.T", "도요타"), ("8306.T", "미쓰비시UFJ"), ("6758.T", "소니"), ("9984.T", "소프트뱅크그룹"), ("8035.T", "도쿄일렉트론")],
    "EWT":  [("2330.TW", "TSMC"), ("2317.TW", "혼하이정밀"), ("2454.TW", "미디어텍"), ("2308.TW", "델타전자"), ("3711.TW", "ASE")],
    "INDA": [("RELIANCE.NS", "릴라이언스"), ("HDFCBANK.NS", "HDFC은행"), ("INFY.NS", "인포시스"), ("TCS.NS", "TCS"), ("ICICIBANK.NS", "ICICI은행")],
    "FXI":  [("0700.HK", "텐센트"), ("9988.HK", "알리바바"), ("3690.HK", "메이투안"), ("1211.HK", "BYD"), ("0939.HK", "중국건설은행")],
    "EEM":  [("TSM", "TSMC(ADR)"), ("0700.HK", "텐센트"), ("005930.KS", "삼성전자"), ("9988.HK", "알리바바"), ("RELIANCE.NS", "릴라이언스")],
    "ACWI": [("AAPL", "애플"), ("MSFT", "마이크로소프트"), ("NVDA", "엔비디아"), ("AMZN", "아마존"), ("META", "메타")],
    "069500.KS": [("005930.KS", "삼성전자"), ("000660.KS", "SK하이닉스"), ("373220.KS", "LG에너지솔루션"), ("005380.KS", "현대차"), ("035420.KS", "네이버")],
    "229200.KS": [("196170.KQ", "알테오젠"), ("247540.KQ", "에코프로비엠"), ("086520.KQ", "에코프로"), ("141080.KQ", "리가켐바이오"), ("145020.KQ", "휴젤")],
    "091160.KS": [("000660.KS", "SK하이닉스"), ("005930.KS", "삼성전자"), ("042700.KS", "한미반도체"), ("403870.KQ", "HPSP"), ("058470.KQ", "리노공업")],
    "449450.KS": [("012450.KS", "한화에어로스페이스"), ("079550.KS", "LIG넥스원"), ("064350.KS", "현대로템"), ("047810.KS", "한국항공우주"), ("272210.KS", "한화시스템")],
}

_last_req = [0.0]

def _throttle():
    # 외부 요청 예의: 요청 간 0.5초 이상
    wait = _last_req[0] + 0.5 - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_req[0] = time.time()

def http_get(url, timeout=20):
    """UA 명시, 3회 재시도. 최종 실패 시 None (파이프라인은 죽지 않는다)."""
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

def fetch_chart(ticker, rng="1y"):
    """야후 차트 API → {'dates': [...], 'o':[], 'h':[], 'l':[], 'c':[], 'v':[]} (None 봉 제거)"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(ticker)}?range={rng}&interval=1d")
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
            d = datetime.fromtimestamp(t, tz=KST).strftime("%Y-%m-%d")
            out["dates"].append(d)
            out["c"].append(round(float(c), 4))
            out["o"].append(round(float(q["open"][i] or c), 4))
            out["h"].append(round(float(q["high"][i] or c), 4))
            out["l"].append(round(float(q["low"][i] or c), 4))
            out["v"].append(int(q["volume"][i] or 0))
        return out if len(out["c"]) >= 2 else None
    except Exception as e:
        print(f"  [parse-fail] {ticker}: {e}")
        return None

def pct(a, b):
    """b 대비 a의 수익률(%)"""
    if b is None or b == 0 or a is None:
        return 0.0
    return round((a / b - 1) * 100, 2)

def ret_n(closes, n):
    """n 거래일 전 대비 수익률"""
    if len(closes) <= n:
        return pct(closes[-1], closes[0])
    return pct(closes[-1], closes[-1 - n])

def ytd_ret(dates, closes):
    year = dates[-1][:4]
    base = None
    for d, c in zip(dates, closes):
        if d[:4] < year:
            base = c
    if base is None:
        base = closes[0]
    return pct(closes[-1], base)

def cum_series(closes, n):
    """최근 n일 누적수익률(%) 시리즈 (시작=0)"""
    seg = closes[-n:] if len(closes) > n else closes[:]
    if not seg or seg[0] == 0:
        return []
    return [round((c / seg[0] - 1) * 100, 2) for c in seg]

def vol_ratio(closes, vols):
    """5일 평균 거래대금 / 20일 평균 거래대금 (자금 유입 프록시)"""
    dv = [c * v for c, v in zip(closes, vols)]
    if len(dv) < 20:
        return 1.0
    a5 = sum(dv[-5:]) / 5
    a20 = sum(dv[-20:]) / 20
    return round(a5 / a20, 2) if a20 > 0 else 1.0

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

def main():
    print(f"=== fetch_data.py 시작 ({datetime.now(KST).strftime('%Y-%m-%d %H:%M KST')}) ===")

    # 1) ETF 시세
    charts = {}
    fails = []
    for tk, name, group, q in TICKERS:
        ch = fetch_chart(tk, "1y")
        if ch:
            charts[tk] = ch
            print(f"  [ok] {tk} {name} ({len(ch['c'])}봉)")
        else:
            fails.append(tk)

    # 안전장치: 80% 이상 실패 시 기존 data.json 유지
    if len(fails) >= len(TICKERS) * 0.8:
        print(f"[경고] {len(fails)}/{len(TICKERS)} 티커 실패 — 기존 data.json 유지 후 종료")
        sys.exit(0)

    bench = charts.get(BENCHMARK)
    bench_rets = {}
    if bench:
        bc = bench["c"]
        bench_rets = {"r1d": ret_n(bc, 1), "r1w": ret_n(bc, 5),
                      "r1m": ret_n(bc, 21), "r3m": ret_n(bc, 63)}

    # 2) 구성종목 시세 (중복 1회 요청)
    holding_map = {}  # 티커 -> {"price", "r1d"}
    uniq = {}
    for etf, lst in CONSTITUENTS.items():
        for t, n in lst:
            uniq[t] = n
    print(f"--- 구성종목 {len(uniq)}종 수집 ---")
    for t in uniq:
        ch = fetch_chart(t, "1mo")
        if ch and len(ch["c"]) >= 2:
            holding_map[t] = {"price": ch["c"][-1], "r1d": pct(ch["c"][-1], ch["c"][-2])}

    # 3) 뉴스
    news_map = {}
    print("--- 뉴스 수집 ---")
    for tk, name, group, q in TICKERS:
        if tk in charts:
            news_map[tk] = fetch_news(q)

    # 4) 조립
    etfs = {}
    for tk, name, group, q in TICKERS:
        ch = charts.get(tk)
        if not ch:
            continue
        c, v, dates = ch["c"], ch["v"], ch["dates"]
        rets = {"r1d": ret_n(c, 1), "r1w": ret_n(c, 5), "r1m": ret_n(c, 21), "r3m": ret_n(c, 63)}
        rel = {("rel_" + k): (round(rets[k] - bench_rets[k], 2) if bench_rets else 0.0) for k in rets}
        candles = [{"d": dates[i], "o": ch["o"][i], "h": ch["h"][i], "l": ch["l"][i],
                    "c": c[i], "v": v[i]} for i in range(max(0, len(c) - 60), len(c))]
        holdings = []
        for ht, hn in CONSTITUENTS.get(tk, []):
            hm = holding_map.get(ht)
            if hm:
                ccy = "₩" if (ht.endswith(".KS") or ht.endswith(".KQ")) else "$"
                holdings.append({"ticker": ht, "name": hn, "r1d": hm["r1d"], "price": hm["price"], "ccy": ccy})
        etfs[tk] = {
            "ticker": tk, "name": name, "group": group,
            "price": c[-1], "last_date": dates[-1],
            **rets, "ytd": ytd_ret(dates, c), **rel,
            "vol_ratio": vol_ratio(c, v),
            "from_high": pct(c[-1], max(c[-252:])),
            "spark": cum_series(c, 30),
            "hist": {"1m": cum_series(c, 21), "3m": cum_series(c, 63), "6m": cum_series(c, 126)},
            "candles": candles,
            "holdings": holdings,
            "news": news_map.get(tk, []),
        }

    data = {
        "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "benchmark": BENCHMARK,
        "dates": bench["dates"][-126:] if bench else [],
        "etfs": etfs,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"=== 완료: {len(etfs)}종 저장 → {OUT} (실패 {len(fails)}: {fails}) ===")

    # 6) 1년 일봉(종가·거래량) — dashboard.html의 섹터별 1년 차트용.
    #    data.json은 이미 무거워서 별도 파일로 분리하고, 이미 받은 1y 차트를 재사용한다(추가 요청 없음).
    write_year_file(charts)


YEAR_OUT = os.path.join(os.path.dirname(OUT), "etf_year.json")


def write_year_file(charts):
    series = {}
    for tk, ch in charts.items():
        n = min(len(ch["c"]), 260)
        series[tk] = {"d": ch["dates"][-n:], "c": ch["c"][-n:], "v": ch["v"][-n:]}
    if not series:
        return
    with open(YEAR_OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"), "series": series},
                  f, ensure_ascii=False, separators=(",", ":"))
    print(f"=== 1년 일봉 {len(series)}종 저장 → {YEAR_OUT} ===")

if __name__ == "__main__":
    main()
