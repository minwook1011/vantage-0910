"""매크로 대시보드 데이터 수집 → docs/macro_dash.json (macro.html 전용)

모두 무료·무키 출처다. 출처별로 실패를 격리하고, 실패한 항목은 직전 JSON 값을 그대로 둔다.

  물가·고용   BLS Public API v2 (키 없이 하루 25회 — 실행당 2회 사용)
  PCE·GDP     BEA NIPA 원자료 파일(NipaDataM/Q.txt)
  국채 금리    미 재무부 일별 국채 수익률 CSV (1개월~30년)
  기준금리     뉴욕연준 EFFR API
  실업수당    미 노동부(DOL) ar539 주간 청구 — 주별 합계, 비계절조정
  소비자심리   미시간대 tbmics.csv
  지수·환율   Yahoo 차트 (S&P500·나스닥·코스피·코스닥·VIX·달러인덱스·원달러)
  발표 일정    연준 FOMC 일정, BEA 일정 페이지, BLS 일정(자동 요청 차단 시
              data_sources/macro_calendar_seed.json), 실업수당은 매주 목요일

FRED는 이 환경과 GitHub Actions 모두에서 응답이 끊겨 쓰지 않는다.
"""
import csv, io, json, os, re, ssl, sys, time, urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs", "macro_dash.json")
SEED = os.path.join(ROOT, "data_sources", "macro_calendar_seed.json")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
TODAY = datetime.now(KST).date()

try:  # DOL·미시간대는 중간 인증서가 빠진 체인을 보내서 certifi 번들이 있으면 그걸 쓴다
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()


def get(url, data=None, headers=None, timeout=60, tries=3):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
    if headers:
        h.update(headers)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=h)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def log(msg):
    print(msg, flush=True)


# ─────────────────────────── 변환 ───────────────────────────
def yoy(dates, vals, lag):
    out_d, out_v = [], []
    for i in range(lag, len(vals)):
        if vals[i] is not None and vals[i - lag]:
            out_d.append(dates[i]); out_v.append(round((vals[i] / vals[i - lag] - 1) * 100, 2))
    return out_d, out_v


def diff(dates, vals):
    return dates[1:], [None if (a is None or b is None) else round(b - a, 1) for a, b in zip(vals, vals[1:])]


def latest_block(dates, vals):
    pts = [(d, v) for d, v in zip(dates, vals) if v is not None]
    if not pts:
        return None
    d, v = pts[-1]
    p = pts[-2][1] if len(pts) > 1 else None
    return {"date": d, "value": v, "prev": p, "chg": None if p is None else round(v - p, 2)}


# ─────────────────────────── BLS ───────────────────────────
BLS_SERIES = {
    "CUSR0000SA0": "cpi", "CUSR0000SA0L1E": "core_cpi", "WPSFD4": "ppi", "WPSFD49116": "core_ppi",
    "WPSFD49104": "core_ppi_alt", "CES0000000001": "nfp", "LNS14000000": "unrate", "CES0500000003": "ahe",
    "LNS11300000": "lfpr", "JTS000000000000000JOL": "jolts",
}


def fetch_bls():
    ids = list(BLS_SERIES)
    end = TODAY.year
    out = {}
    for chunk in (ids[:5], ids[5:]):
        body = json.dumps({"seriesid": chunk, "startyear": str(end - 9), "endyear": str(end)}).encode()
        j = json.loads(get("https://api.bls.gov/publicAPI/v2/timeseries/data/", data=body,
                           headers={"Content-Type": "application/json"}))
        if j.get("status") != "REQUEST_SUCCEEDED":
            raise RuntimeError(f"BLS {j.get('status')} {j.get('message')}")
        for s in j["Results"]["series"]:
            pts = []
            for d in s.get("data", []):
                if not d["period"].startswith("M") or d["period"] == "M13":
                    continue
                try:
                    pts.append((f"{d['year']}-{d['period'][1:]}", float(d["value"])))
                except ValueError:
                    continue
            pts.sort()
            if pts:
                out[BLS_SERIES[s["seriesID"]]] = ([p[0] for p in pts], [p[1] for p in pts])
        time.sleep(1)
    return out


# ─────────────────────────── BEA NIPA ───────────────────────────
def fetch_nipa(url, codes):
    """36MB 파일을 줄 단위로 흘려 읽으며 필요한 코드만 남긴다."""
    found = {c: [] for c in codes}
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180, context=CTX) as f:
        for raw in f:
            line = raw.decode("utf-8", "ignore")
            code = line.split(",", 1)[0]
            if code in found:
                parts = next(csv.reader([line]))
                try:
                    found[code].append((parts[1], float(parts[2].replace(",", ""))))
                except (ValueError, IndexError):
                    pass
    return found


def nipa_month(p):  # 2026M07 → 2026-07
    return p[:4] + "-" + p[5:]


def nipa_quarter(p):  # 2026Q2 → 2026-Q2
    return p[:4] + "-" + p[4:]


# ─────────────────────────── 국채 금리 ───────────────────────────
TENORS = {"1 Mo": "1M", "3 Mo": "3M", "6 Mo": "6M", "1 Yr": "1Y", "2 Yr": "2Y", "3 Yr": "3Y", "5 Yr": "5Y",
          "7 Yr": "7Y", "10 Yr": "10Y", "20 Yr": "20Y", "30 Yr": "30Y"}


def fetch_treasury(years=10):
    rows = {}
    for yr in range(TODAY.year - years + 1, TODAY.year + 1):
        url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
               f"{yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value={yr}&page&_format=csv")
        try:
            text = get(url).decode("utf-8", "ignore")
        except Exception as e:
            log(f"  [skip] treasury {yr}: {e}")
            continue
        for r in csv.DictReader(io.StringIO(text)):
            try:
                d = datetime.strptime(r["Date"], "%m/%d/%Y").strftime("%Y-%m-%d")
            except (KeyError, ValueError):
                continue
            rows[d] = {TENORS[k]: float(v) for k, v in r.items() if k in TENORS and v not in ("", None)}
        time.sleep(0.4)
    dates = sorted(rows)
    return dates, rows


# ─────────────────────────── 기타 출처 ───────────────────────────
def fetch_effr():
    start = (TODAY - timedelta(days=365 * 10)).isoformat()
    url = f"https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate={start}&endDate={TODAY.isoformat()}"
    j = json.loads(get(url))
    pts = sorted((r["effectiveDate"], float(r["percentRate"])) for r in j.get("refRates", []))
    return [p[0] for p in pts], [p[1] for p in pts]


def fetch_claims():
    """DOL ar539: 주·주차별 행. c3 = 주정부 UI 신규청구(비계절조정). 주차별로 전 주를 합산한다."""
    text = get("https://oui.doleta.gov/unemploy/csv/ar539.csv", timeout=120).decode("utf-8", "ignore")
    tot = {}
    for r in csv.DictReader(io.StringIO(text)):
        wk = r.get("rptdate")
        try:
            v = float(r.get("c3") or 0)
        except ValueError:
            continue
        if wk and wk >= f"{TODAY.year - 10}-01-01":
            tot[wk] = tot.get(wk, 0) + v
    dates = sorted(tot)
    return dates, [tot[d] for d in dates]


def fetch_umich():
    text = get("https://www.sca.isr.umich.edu/files/tbmics.csv").decode("utf-8", "ignore")
    months = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                           "September", "October", "November", "December"], 1)}
    pts = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            pts.append((f"{int(r['YYYY'])}-{months[r['Month'].strip()]:02d}", float(r["ICS_ALL"])))
        except (KeyError, ValueError):
            continue
    pts = [p for p in sorted(pts) if p[0] >= f"{TODAY.year - 10}-01"]
    return [p[0] for p in pts], [p[1] for p in pts]


MARKETS = [("^GSPC", "S&P 500", "10y"), ("^IXIC", "나스닥", "10y"), ("^KS11", "코스피", "10y"), ("^KQ11", "코스닥", "10y"),
           ("^VIX", "VIX", "10y"), ("DX-Y.NYB", "달러인덱스", "10y"), ("KRW=X", "원/달러", "10y")]


def fetch_yahoo(tk, rng):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(tk)}?range={rng}&interval=1d"
    res = json.loads(get(url))["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    d, c, v = [], [], []
    for i, t in enumerate(res.get("timestamp") or []):
        if q["close"][i] is None:
            continue
        d.append(datetime.fromtimestamp(t, tz=KST).strftime("%Y-%m-%d"))
        c.append(round(float(q["close"][i]), 2))
        v.append(int(q["volume"][i] or 0))
    return {"d": d, "c": c, "v": v}


# ─────────────────────────── 발표 일정 ───────────────────────────
def us_dst(d):
    """미국 서머타임: 3월 둘째 일요일 ~ 11월 첫째 일요일"""
    mar = date(d.year, 3, 8); mar += timedelta(days=(6 - mar.weekday()) % 7)
    nov = date(d.year, 11, 1); nov += timedelta(days=(6 - nov.weekday()) % 7)
    return mar <= d < nov


def to_kst(d, hhmm):
    h, m = map(int, hhmm.split(":"))
    et = datetime(d.year, d.month, d.day, h, m)
    k = et + timedelta(hours=13 if us_dst(d) else 14)
    return k.strftime("%Y-%m-%d %H:%M")


def ev(d, hhmm, key, title, ref, importance, **extra):
    x = {"date": d.isoformat(), "time_et": hhmm, "kst": to_kst(d, hhmm), "key": key, "title": title,
         "ref": ref, "importance": importance}
    x.update(extra)
    return x


def calendar_bls():
    """BLS 공식 일정: 직접 수집을 한 번 시도하고, 막히면 시드 파일."""
    seed = json.load(open(SEED, encoding="utf-8"))
    meta = {"cpi": ("cpi", "CPI 소비자물가", 3), "ppi": ("ppi", "PPI 생산자물가", 2),
            "empsit": ("nfp", "고용보고서 (비농업 고용·실업률)", 3), "jolts": ("jolts", "JOLTS 구인건수", 2)}
    events, source = [], "seed"
    try:
        live = {}
        for rel in meta:
            html = get(f"https://www.bls.gov/schedule/news_release/{rel}.htm", tries=1).decode("utf-8", "ignore")
            rows = re.findall(r"<tr>\s*<td>([A-Z][a-z]+ \d{4})</td>\s*<td>([A-Z][a-z]{2})\.? (\d{2}), (\d{4})</td>\s*<td>(\d{2}:\d{2}) (AM|PM)</td>", html)
            live[rel] = [(datetime.strptime(r[0], "%B %Y").strftime("%Y-%m"),
                          datetime.strptime(f"{r[1]} {r[2]} {r[3]}", "%b %d %Y").strftime("%Y-%m-%d")) for r in rows]
            if not live[rel]:
                raise RuntimeError("parse")
        seed.update(live); source = "bls.gov"
    except Exception as e:
        log(f"  BLS 일정 직접 수집 불가({type(e).__name__}) — 시드 파일 사용")
    for rel, (key, title, imp) in meta.items():
        for ref, dstr in seed.get(rel, []):
            events.append(ev(date.fromisoformat(dstr), seed["time_et"][rel], key, title, ref, imp))
    return events, source


def calendar_fomc():
    html = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm").decode("utf-8", "ignore")
    months = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                           "September", "October", "November", "December"], 1)}
    out = []
    for yr in (TODAY.year, TODAY.year + 1):
        m = re.search(str(yr) + r" FOMC Meetings(.*?)(?:\d{4} FOMC Meetings|$)", html, re.S)
        if not m:
            continue
        blk = m.group(1)
        mons = re.findall(r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>', blk)
        days = re.findall(r'fomc-meeting__date[^>]*>([^<]+)<', blk)
        for mon, dd in zip(mons, days):
            mon = mon.strip().split("/")[-1]
            sep = "*" in dd
            last = re.findall(r"\d+", dd)
            if mon not in months or not last:
                continue
            d = date(yr, months[mon], int(last[-1]))
            out.append(ev(d, "14:00", "fomc", "FOMC 금리 결정" + (" · 경제전망(SEP)" if sep else ""), f"{yr}-{months[mon]:02d}", 3, sep=sep))
    return out


def calendar_bea():
    html = get("https://www.bea.gov/news/schedule").decode("utf-8", "ignore")
    out, yr, prev_month = [], TODAY.year, 0
    months = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                           "September", "October", "November", "December"], 1)}
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", row)).strip()
        m = re.match(r"([A-Z][a-z]+) (\d{1,2}) (\d{1,2}:\d{2}) (AM|PM)", t)
        if not m or m.group(1) not in months:
            continue
        mo = months[m.group(1)]
        if mo < prev_month:  # 12월 다음에 1월이 오면 해가 바뀐 것
            yr += 1
        prev_month = mo
        hh, mm = map(int, m.group(3).split(":"))
        if m.group(4) == "PM" and hh != 12:
            hh += 12
        d = date(yr, mo, int(m.group(2)))
        if re.search(r"GDP \((Advance|Second|Third)", t):
            kind = re.search(r"GDP \((\w+)", t).group(1)
            label = {"Advance": "속보", "Second": "잠정", "Third": "확정"}.get(kind, kind)
            ref = re.search(r"(\d)(?:st|nd|rd|th) Quarter (\d{4})", t)
            out.append(ev(d, f"{hh:02d}:{mm:02d}", "gdp", f"GDP ({label})", f"{ref.group(2)}-Q{ref.group(1)}" if ref else "", 3 if kind == "Advance" else 2))
        elif t.find("Personal Income and Outlays") >= 0:
            ref = re.search(r"Outlays, ([A-Z][a-z]+) (\d{4})", t)
            refs = f"{ref.group(2)}-{months[ref.group(1)]:02d}" if ref and ref.group(1) in months else ""
            out.append(ev(d, f"{hh:02d}:{mm:02d}", "pce", "PCE 물가 (개인소득·지출)", refs, 3))
    return out


def calendar_claims(weeks=8):
    out, d = [], TODAY - timedelta(days=21)
    while d.weekday() != 3:
        d += timedelta(days=1)
    for _ in range(weeks + 3):
        out.append(ev(d, "08:30", "claims", "신규 실업수당 청구", "", 1, estimated=True))
        d += timedelta(days=7)
    return out


# ─────────────────────────── 용량 줄이기 ───────────────────────────
RECENT = 520   # 최근 약 2년(거래일)은 일별 그대로
STEP = 5       # 그 이전은 5거래일(≈1주) 단위


def thin_idx(n):
    """앞쪽은 STEP마다, 뒤쪽 RECENT개는 전부 남길 인덱스"""
    head = max(0, n - RECENT)
    idx = list(range(STEP - 1, head, STEP))
    return idx + list(range(head, n))


def thin_series(dates, vals):
    idx = thin_idx(len(dates))
    return [dates[i] for i in idx], [vals[i] for i in idx]


def thin_market(m):
    """오래된 구간은 5일 묶음: 날짜·종가는 묶음 마지막 값, 거래량은 묶음 합계"""
    n, head = len(m["d"]), max(0, len(m["d"]) - RECENT)
    d, c, v = [], [], []
    for s in range(0, head, STEP):
        e = min(s + STEP, head)
        d.append(m["d"][e - 1]); c.append(m["c"][e - 1]); v.append(sum(m["v"][s:e]))
    return {**m, "d": d + m["d"][head:], "c": c + m["c"][head:], "v": v + m["v"][head:]}


# ─────────────────────────── 조립 ───────────────────────────
def load_prev():
    try:
        return json.load(open(OUT, encoding="utf-8"))
    except Exception:
        return {}


def main():
    log(f"=== fetch_macro_dash.py ({datetime.now(KST):%Y-%m-%d %H:%M KST}) ===")
    prev = load_prev()
    ind = dict(prev.get("indicators", {}))
    status = {}

    def put(key, label, group, unit, freq, source, dates, vals, note=None, level=None, digits=2):
        if not dates:
            return
        cut = f"{TODAY.year - 10}"
        pairs = [(d, v) for d, v in zip(dates, vals) if d >= cut]
        d2, v2 = [p[0] for p in pairs], [p[1] for p in pairs]
        ind[key] = {"key": key, "label": label, "group": group, "unit": unit, "freq": freq, "source": source,
                    "dates": d2, "values": v2, "latest": latest_block(d2, v2), "note": note, "digits": digits}
        if level:
            ind[key]["level"] = level

    # 1) BLS
    try:
        b = fetch_bls()
        for k, lab in (("cpi", "CPI"), ("core_cpi", "Core CPI"), ("ppi", "PPI"), ("core_ppi", "Core PPI")):
            src = b.get(k) or (b.get("core_ppi_alt") if k == "core_ppi" else None)
            if src:
                d, v = yoy(*src, 12)
                md, mv = yoy(*src, 1)
                put(k, lab + " (YoY)", "inflation", "%", "M", "BLS", d, v,
                    note="전년 동월 대비. 계절조정 지수 기준", level={"mom_dates": md[-36:], "mom": mv[-36:]})
        if "nfp" in b:
            d, v = diff(*b["nfp"])
            put("nfp", "비농업 고용 증감", "labor", "천 명", "M", "BLS", d, v, note="전월 대비 증감(천 명)", digits=0)
        if "unrate" in b:
            put("unrate", "실업률", "labor", "%", "M", "BLS", *b["unrate"], digits=1)
        if "ahe" in b:
            d, v = yoy(*b["ahe"], 12)
            put("ahe", "평균 시급 (YoY)", "labor", "%", "M", "BLS", d, v)
        if "lfpr" in b:
            put("lfpr", "경제활동참가율", "labor", "%", "M", "BLS", *b["lfpr"], digits=1)
        if "jolts" in b:
            d, v = b["jolts"]
            put("jolts", "JOLTS 구인건수", "labor", "백만 건", "M", "BLS", d, [round(x / 1000, 2) for x in v])
        status["bls"] = "ok"
    except Exception as e:
        status["bls"] = f"fail: {e}"; log(f"  [BLS 실패] {e}")

    # 2) BEA — PCE(월), GDP(분기)
    try:
        m = fetch_nipa("https://apps.bea.gov/national/Release/TXT/NipaDataM.txt", {"DPCERG", "DPCCRG"})
        for code, key, lab in (("DPCERG", "pce", "PCE 물가 (YoY)"), ("DPCCRG", "core_pce", "Core PCE (YoY)")):
            pts = sorted((nipa_month(p), v) for p, v in m[code])
            d, v = yoy([p[0] for p in pts], [p[1] for p in pts], 12)
            put(key, lab, "inflation", "%", "M", "BEA", d, v, note="연준이 목표(2%)로 삼는 물가 지표")
        q = fetch_nipa("https://apps.bea.gov/national/Release/TXT/NipaDataQ.txt", {"A191RL"})
        pts = sorted((nipa_quarter(p), v) for p, v in q["A191RL"])
        put("gdp", "실질 GDP 성장률", "growth", "% (연율)", "Q", "BEA", [p[0] for p in pts], [p[1] for p in pts],
            note="전기 대비 연율 환산", digits=1)
        status["bea"] = "ok"
    except Exception as e:
        status["bea"] = f"fail: {e}"; log(f"  [BEA 실패] {e}")

    # 3) EFFR
    try:
        d, v = fetch_effr()
        put("effr", "실효 연방기금금리", "rates", "%", "D", "뉴욕연준", d, v, digits=2)
        status["effr"] = "ok"
    except Exception as e:
        status["effr"] = f"fail: {e}"; log(f"  [EFFR 실패] {e}")

    # 4) 실업수당(주간, 비계절조정) — 4주 평균도 함께
    try:
        d, v = fetch_claims()
        avg = [None if i < 3 else round(sum(v[i - 3:i + 1]) / 4) for i in range(len(v))]
        put("claims", "신규 실업수당 청구 (4주 평균)", "labor", "건", "W", "미 노동부", d,
            [None if a is None else round(a / 1000, 1) for a in avg], note="비계절조정 주별 합계의 4주 평균(천 건)", digits=1)
        ind["claims"]["unit"] = "천 건"
        status["claims"] = "ok"
    except Exception as e:
        status["claims"] = f"fail: {e}"; log(f"  [실업수당 실패] {e}")

    # 5) 미시간대 소비자심리
    try:
        put("umich", "미시간대 소비자심리", "sentiment", "pt", "M", "미시간대", *fetch_umich(), digits=1)
        status["umich"] = "ok"
    except Exception as e:
        status["umich"] = f"fail: {e}"; log(f"  [미시간대 실패] {e}")

    # 6) 국채 금리
    yields = prev.get("yields")
    try:
        dates, rows = fetch_treasury()
        if dates:
            cols = ["3M", "2Y", "5Y", "10Y", "30Y"]
            yields = {"dates": dates}
            for c in cols:
                yields[c] = [rows[d].get(c) for d in dates]
            yields["10Y2Y"] = [None if (a is None or b is None) else round(a - b, 2) for a, b in zip(yields["10Y"], yields["2Y"])]
            yields["10Y3M"] = [None if (a is None or b is None) else round(a - b, 2) for a, b in zip(yields["10Y"], yields["3M"])]

            def snap(target):
                ds = [d for d in dates if d <= target]
                return {"date": ds[-1], "curve": rows[ds[-1]]} if ds else None
            last = datetime.strptime(dates[-1], "%Y-%m-%d").date()
            yields["curve"] = {"now": snap(dates[-1]), "m1": snap((last - timedelta(days=30)).isoformat()),
                               "y1": snap((last - timedelta(days=365)).isoformat())}
            for key, lab, col in (("y10", "미국 10년물", "10Y"), ("y2", "미국 2년물", "2Y"), ("y3m", "미국 3개월물", "3M"),
                                  ("y30", "미국 30년물", "30Y"), ("s10y2y", "장단기 금리차 (10Y−2Y)", "10Y2Y"),
                                  ("s10y3m", "장단기 금리차 (10Y−3M)", "10Y3M")):
                put(key, lab, "rates", "%" if not key.startswith("s") else "%p", "D", "미 재무부", dates, yields[col],
                    note="마이너스면 장단기 역전 — 과거 경기침체 선행 신호" if key.startswith("s") else None)
            status["treasury"] = "ok"
    except Exception as e:
        status["treasury"] = f"fail: {e}"; log(f"  [국채 실패] {e}")

    # 7) 지수·환율
    markets = dict(prev.get("markets", {}))
    for tk, name, rng in MARKETS:
        try:
            m = fetch_yahoo(tk, rng)
            if len(m["c"]) > 100:
                m["name"] = name
                markets[tk] = m
            time.sleep(0.5)
        except Exception as e:
            log(f"  [skip] {tk}: {e}")
    for tk, key, lab in (("^VIX", "vix", "VIX 변동성"), ("DX-Y.NYB", "dxy", "달러인덱스"), ("KRW=X", "usdkrw", "원/달러 환율")):
        if tk in markets:
            put(key, lab, "markets", "pt" if key != "usdkrw" else "원", "D", "Yahoo", markets[tk]["d"], markets[tk]["c"], digits=2)

    # 8) 발표 일정
    events = []
    try:
        e, src = calendar_bls(); events += e; status["calendar_bls"] = src
    except Exception as ex:
        status["calendar_bls"] = f"fail: {ex}"
    for name, fn in (("fomc", calendar_fomc), ("bea", calendar_bea), ("claims", calendar_claims)):
        try:
            events += fn(); status["calendar_" + name] = "ok"
        except Exception as ex:
            status["calendar_" + name] = f"fail: {ex}"; log(f"  [일정 {name} 실패] {ex}")
    if not events and prev.get("calendar"):
        events = prev["calendar"]
    lo, hi = (TODAY - timedelta(days=60)).isoformat(), (TODAY + timedelta(days=120)).isoformat()
    events = sorted({(e["date"], e["key"], e["title"]): e for e in events if lo <= e["date"] <= hi}.values(),
                    key=lambda e: (e["date"], e["time_et"]))

    # 일별 시계열은 최근 2년만 일별로, 그 이전은 주 단위로 압축한다 (파일 크기 ~1MB → ~0.4MB)
    #    수집 실패로 직전 JSON 값을 재사용한 항목은 이미 압축돼 있으므로 thinned 표시로 두 번 압축하지 않는다.
    for k, v in ind.items():
        if v.get("freq") == "D" and not v.get("thinned") and len(v["dates"]) > RECENT:
            v["dates"], v["values"] = thin_series(v["dates"], v["values"]); v["thinned"] = True
    if yields and not yields.get("thinned") and len(yields.get("dates", [])) > RECENT:
        idx = thin_idx(len(yields["dates"]))
        for col in ["dates", "3M", "2Y", "5Y", "10Y", "30Y", "10Y2Y", "10Y3M"]:
            yields[col] = [yields[col][i] for i in idx]
        yields["thinned"] = True
    markets = {tk: (dict(thin_market(m), thinned=True) if not m.get("thinned") and len(m["d"]) > RECENT else m)
               for tk, m in markets.items()}

    data = {
        "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "status": status,
        "indicators": ind,
        "yields": yields,
        "markets": markets,
        "calendar": events,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    log(f"=== 완료: 지표 {len(ind)}개, 지수 {len(markets)}개, 일정 {len(events)}건 → {OUT}")
    log("상태: " + json.dumps(status, ensure_ascii=False))
    ok = sum(1 for v in status.values() if v == "ok" or v in ("seed", "bls.gov"))
    if ok == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
