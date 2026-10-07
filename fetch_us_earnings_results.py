"""미국 실적 리포트 재료 — 캘린더(나스닥)로 발표일을 잡고, SEC 8-K(Item 2.02)로 실제 발표를 확인해 리포트를 만든다.

  docs/data/us/earnings_dates.json (fetch_us_earnings_dates.py, 나스닥 거래소 캘린더)
→ 발표 예정일이 지났거나 오늘인 종목 → SEC EDGAR 제출 목록에서 그 무렵 8-K Item 2.02(실적 발표) 찾기
→ docs/data/us/reports/<rid>.json  (일본 리포트 jp-report 와 같은 틀)
   qs: 최근 8개 분기(데이터 허브 docs/data/us/<티커>.json 의 SEC XBRL 분기 실적, 백만 달러)
       막 발표한 분기가 XBRL 에 아직 없으면(10-Q 전) 보도자료(EX-99.1) 손익표에서 바로 읽어 src:"release",
       그것도 못 읽으면 야후 분기 손익으로 채우고 src:"yahoo" 표시. 숫자 대기(q_ready:false) 리포트는 실행 때마다 다시 시도
   rec: 발표일·장전/장후·EPS 컨센서스 대비(docs/earnings_calendar.json, 야후)·주가 반응(발표 전 종가 대비, 장중이면 현재가)
   docs: 실적 보도자료(8-K EX-99.1 원문)·8-K 공시 페이지
→ docs/data/us/reports/index.json (목록)
요약·분석 글은 Claude 예약 작업이 data_sources/us_earnings_notes.md 절차대로 docs/data/us/reports/notes/<rid>.json 에 쓴다.

    python fetch_us_earnings_results.py            # 최근 10일 안 발표 예정 종목 중 리포트 없는 것 + 주가 반응 갱신
    python fetch_us_earnings_results.py --px-only  # 주가 반응만(장중 30분마다)
    python fetch_us_earnings_results.py --codes NKE,FDX
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
US = os.path.join(BASE, "docs", "data", "us")
DATES = os.path.join(US, "earnings_dates.json")
CAL = os.path.join(BASE, "docs", "earnings_calendar.json")
REPORTS = os.path.join(US, "reports")
SEC_UA = {"User-Agent": "VantageResearch data-bot@vantage-research.dev"}
YUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
KST = timezone(timedelta(hours=9))
ET = timezone(timedelta(hours=-4))
LOOKBACK = 10
_last = [0.0]


def sec_get(url, as_json=True):
    wait = _last[0] + 0.15 - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    for i in range(3):
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers=SEC_UA), timeout=25).read()
            return json.loads(raw) if as_json else raw.decode("utf-8", "replace")
        except Exception as e:
            if i == 2:
                print(f"  [sec] {url} {e}")
                return None
            time.sleep(1 + i * 2)


_CIK = None


def cik_of(t):
    global _CIK
    if _CIK is None:
        d = sec_get("https://www.sec.gov/files/company_tickers.json") or {}
        _CIK = {v["ticker"].upper().replace(".", "-"): int(v["cik_str"]) for v in d.values()}
    return _CIK.get(t.upper())


def find_8k(cik, since):
    """since(YYYY-MM-DD) 이후 8-K 중 Item 2.02(실적) 가장 이른 것"""
    s = sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
    if not s:
        return None
    r = s["filings"]["recent"]
    best = None
    for i, form in enumerate(r["form"]):
        if form not in ("8-K", "8-K/A") or r["filingDate"][i] < since:
            continue
        if "2.02" not in (r["items"][i] or ""):
            continue
        if best is None or r["filingDate"][i] < best["date"]:
            best = {"date": r["filingDate"][i], "acc": r["accessionNumber"][i], "accepted": r["acceptanceDateTime"][i],
                    "doc": r["primaryDocument"][i]}
    if not best:
        return None
    acc = best["acc"].replace("-", "")
    folder = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/"
    best["index"] = folder + best["acc"] + "-index.html"
    ex = None
    idx = sec_get(best["index"], as_json=False) or ""
    # 공시 목록 표: <td>EX-99.1</td> 행의 문서 링크
    for m in re.finditer(r'<tr[^>]*>(.*?)</tr>', idx, re.S):
        row = m.group(1)
        if re.search(r">\s*EX-99(\.1|\.01)?\s*<", row):
            h = re.search(r'href="([^"]+\.htm[l]?)"', row)
            if h:
                ex = urllib.parse.urljoin("https://www.sec.gov", h.group(1).replace("/ix?doc=", ""))
                break
    best["release"] = ex
    return best


def is_results(url):
    """8-K 2.02 보도자료가 '분기·연간 실적 발표'인지 — 생산·인도량, 운영 현황, 가이던스 조정만 낸 공시는 거른다(2026-10-06:
    테슬라 인도량·애브비 가이던스 조정·프리포트 생산량이 실적으로 올라갔던 문제). 판단 못 하면 True(놓치지 않게)."""
    h = sec_get(url, as_json=False) if url else None
    if not h:
        return True
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).lower()[:6000]
    res = re.search(r"(financial|quarter|quarterly|fiscal|annual|full[- ]year|q[1-4])[- ](\d{4} )?(financial )?(results|earnings)|results (for|of) (its |the )?(first|second|third|fourth|fiscal|quarter)|(reports|announces|posts|delivers) .{0,60}(results|earnings per share|revenue)", txt)
    non = re.search(r"production and deliveries|vehicle deliveries|deliveries of|operational update|operating update|production update|updates .{0,60}guidance|guidance update|acquired ipr&d", txt)
    head = txt[:500]   # 보도자료 제목 부분 — 여기서 생산·인도량·운영 현황·가이던스 조정이면 실적 아님
    if re.search(r"production, deliveries|production and deliveries|deliveries (&|and) deployments|operational update|operating update|production update|updates .{0,60}guidance|guidance update", head):
        return False
    if non and not res:
        return False
    return bool(res) or not non


def _num(c):
    c = c.replace(",", "").replace("$", "").strip()
    neg = c.startswith("(")
    c = c.strip("()").strip()
    if c in ("—", "–", "-", ""):
        return 0.0
    try:
        v = float(c)
    except ValueError:
        return None
    return -v if neg else v


def release_q(url, fq, last_rev=None):
    """실적 보도자료(8-K EX-99.1) 손익계산서 표에서 이번 분기 매출·영업이익·순이익(백만 달러)을 바로 읽는다.
    10-Q·XBRL·야후보다 먼저 나오므로 발표 당일 표를 채울 수 있다(2026-10-07: 컨스텔레이션 표가 직전 분기에 멈춰 있던 문제).
    표의 첫 숫자 열 = 이번 3개월. 못 읽거나 앞 분기와 크기가 안 맞으면 None."""
    h = sec_get(url, as_json=False) if url else None
    if not h or not fq:
        return None
    for m in re.finditer(r"<table.*?</table>", h, re.S | re.I):
        rows = []
        for r in re.findall(r"<tr.*?</tr>", m.group(0), re.S | re.I):
            cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).replace(" ", " ").strip() for c in re.findall(r"<t[dh].*?</t[dh]>", r, re.S | re.I)]
            cells = [c for c in cells if c and c not in ("$", ")", "%")]
            if cells:
                rows.append(cells)
        lab = lambda r: re.sub(r"\s+", " ", r[0]).lower()
        if not any(re.match(r"(total )?operating (income|profit)|income from operations", lab(r)) for r in rows):
            continue
        head = " ".join(" ".join(r) for r in rows[:4]).lower()
        if "three months" not in head and "quarter" not in head and "13 weeks" not in head and "thirteen weeks" not in head:
            continue

        def pick(pats, bad=None):
            for pat in pats:
                for r in rows:
                    if re.match(pat, lab(r)) and not (bad and re.search(bad, lab(r))) and len(r) >= 2:
                        v = _num(r[1])
                        if v is not None:
                            return v
            return None
        rev = pick([r"total (net )?revenues?$", r"(net )?revenues?(, net)?$", r"total net sales$", r"net sales$", r"(net )?revenues?", r"sales$"])
        op = pick([r"(total )?operating (income|profit)( \(loss\))?$", r"income \(loss\) from operations$", r"income from operations$", r"operating (income|profit)"])
        ni = pick([r"net (income|earnings)( \(loss\))? attributable to (?!non)", r"net (income|earnings)( \(loss\))?$", r"net (income|earnings)"], bad=r"per (common )?share|noncontrolling|non-controlling")
        if rev is None or rev <= 0:
            continue
        pre = re.sub(r"<[^>]+>", " ", h[max(0, m.start() - 4000):m.start()]).lower()
        if "in thousands" in pre[-1500:]:
            rev, op, ni = [None if v is None else v / 1000 for v in (rev, op, ni)]
        elif "in billions" in pre[-1500:]:
            rev, op, ni = [None if v is None else v * 1000 for v in (rev, op, ni)]
        if last_rev and not (0.33 < rev / last_rev < 3):   # 단위 오판·다른 표 — 버린다
            continue
        y, mo = int(fq[:4]), int(fq[5:7])
        end = (datetime(y + (mo == 12), mo % 12 + 1, 1) - timedelta(days=1)).strftime("%Y-%m-%d")
        rnd = lambda v: None if v is None else round(v, 1)
        return {"date": end, "revenue": rnd(rev), "operating_income": rnd(op), "net_income": rnd(ni)}
    return None


def yahoo_json(url):
    for i in range(3):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": YUA}), timeout=20).read())
        except Exception:
            time.sleep(1 + i * 2)
    return None


def closes(t):
    d = yahoo_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?range=1mo&interval=1d")
    try:
        r = d["chart"]["result"][0]
        out = {}
        for ts, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
            if c is not None:
                out[datetime.fromtimestamp(ts, ET).strftime("%Y-%m-%d")] = round(c, 2)
        return sorted(out.items())
    except Exception:
        return []


def reaction(cl, date, tm, now_et):
    """장 전(pre) 발표 → 그날이 반응일, 장 후(after)·미정 → 다음 거래일. 장중이면 현재가로 d1(d1_live)."""
    if not cl:
        return None
    after = tm != "pre"
    pre = [(d, c) for d, c in cl if (d <= date if after else d < date)]
    post = [(d, c) for d, c in cl if (d > date if after else d >= date)]
    if not pre:
        return None
    bd, bc = pre[-1]
    out = {"base_d": bd, "base": bc, "timing": "after" if after else "pre", "d1": None, "d1_d": None, "d5": None, "d5_d": None}
    today = now_et.strftime("%Y-%m-%d")
    live = bool(post) and post[-1][0] == today and (now_et.hour, now_et.minute) < (16, 5) and now_et.weekday() < 5
    if live and len(post) == 1:
        out.update(d1_d=post[0][0], d1=round((post[0][1] / bc - 1) * 100, 1), d1_live=True,
                   d1_at=datetime.now(KST).strftime("%m-%d %H:%M KST"))
        return out
    if live:
        post = post[:-1]
    if post:
        out.update(d1_d=post[0][0], d1=round((post[0][1] / bc - 1) * 100, 1))
    if len(post) >= 5:
        out.update(d5_d=post[4][0], d5=round((post[4][1] / bc - 1) * 100, 1))
    return out


def ycrumb():
    try:
        import fetch_earnings_calendar as yf
        return yf.get_crumb()
    except Exception:
        return None, None


def yahoo_last_q(t, cookie, crumb):
    if not crumb:
        return None
    url = (f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{urllib.parse.quote(t)}"
           f"?modules=incomeStatementHistoryQuarterly&crumb={urllib.parse.quote(crumb)}")
    try:
        r = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": YUA, "Cookie": cookie}), timeout=20).read())
        h = r["quoteSummary"]["result"][0]["incomeStatementHistoryQuarterly"]["incomeStatementHistory"][0]
        m = lambda k: round(h[k]["raw"] / 1e6, 1) if (h.get(k) or {}).get("raw") is not None else None
        return {"date": h["endDate"]["fmt"], "revenue": m("totalRevenue"), "operating_income": m("operatingIncome"), "net_income": m("netIncome")}
    except Exception:
        return None


def pct(a, b):
    return round((a / b - 1) * 100, 1) if (a is not None and b not in (None, 0) and b > 0) else None


def cq(date):
    y, m = int(date[:4]), int(date[5:7])
    return f"{(m + 2) // 3}Q{str(y)[2:]}"


def qlabel(date):
    y, m = int(date[:4]), int(date[5:7])
    sm = (m - 3) % 12 + 1
    sy = y if sm <= m else y - 1
    return f"{str(sy)[2:]}.{sm:02d}-{m:02d}"


def build_qs(fin_q, extra):
    rows = [q for q in fin_q if not q.get("est")]
    if extra and not any(abs((datetime.fromisoformat(q["date"]) - datetime.fromisoformat(extra["date"])).days) < 20 for q in rows):
        rows.append(dict(extra, src=extra.get("src") or "yahoo"))
    rows.sort(key=lambda q: q["date"])
    rows = rows[-12:]
    out = []
    for i, q in enumerate(rows):
        e = {"label": qlabel(q["date"]), "cq": cq(q["date"]), "date": q["date"],
             "rev": q.get("revenue"), "op": q.get("operating_income"), "ni": q.get("net_income")}
        if q.get("src"):
            e["src"] = q["src"]
        e["opm"] = round(e["op"] / e["rev"] * 100, 1) if (e["op"] is not None and e["rev"]) else None
        prev = out[-1] if out else None
        yago = next((x for x in out if abs((datetime.fromisoformat(q["date"]) - datetime.fromisoformat(x["date"])).days - 365) < 25), None)
        e["yoy"] = {k: pct(e[k], yago[k]) for k in ("rev", "op", "ni")} if yago else {}
        e["qoq"] = {k: pct(e[k], prev[k]) for k in ("rev", "op", "ni")} if prev else {}
        out.append(e)
    return out[-8:]


def cons_of(cal, fq_end):
    """docs/earnings_calendar.json 의 eps_history 에서 발표 분기(분기말이 fq_end 의 달)"""
    for h in reversed((cal or {}).get("eps_history") or []):
        if fq_end and h.get("quarter_end", "")[:7] == fq_end[:7] and h.get("eps_estimate") is not None:
            return {"eps": h["eps_actual"], "est": round(h["eps_estimate"], 2), "pct": h.get("eps_surprise_pct")}
    return None


def fq_month(fq):
    """나스닥 표기 'Aug/2026' → '2026-08'"""
    try:
        return datetime.strptime(fq, "%b/%Y").strftime("%Y-%m")
    except Exception:
        return None


def write_index():
    os.makedirs(REPORTS, exist_ok=True)
    items = []
    for fn in os.listdir(REPORTS):
        if not fn.endswith(".json") or fn == "index.json":
            continue
        try:
            r = json.load(open(os.path.join(REPORTS, fn), encoding="utf-8"))
        except Exception:
            continue
        cur = (r.get("qs") or [{}])[-1]
        items.append({"rid": r["rid"], "c": r["code"], "n": r.get("name"), "cat": r.get("cat"), "u": ["us"], "mc": r.get("mcap"),
                      "d": r["date"], "p": r.get("period"), "cq": cur.get("cq"), "note": os.path.exists(os.path.join(REPORTS, "notes", fn)),
                      "rev_yoy": (cur.get("yoy") or {}).get("rev"), "op_yoy": (cur.get("yoy") or {}).get("op"),
                      "d1": ((r.get("rec") or {}).get("px") or {}).get("d1"), "cons": ((r.get("rec") or {}).get("cons") or {}).get("pct"),
                      "pdf": bool(r.get("docs"))})
    items.sort(key=lambda x: (x["d"], x.get("mc") or 0), reverse=True)
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "count": len(items), "reports": items},
              open(os.path.join(REPORTS, "index.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return len(items)


def settled(r):
    """이번 분기 숫자가 다 찬 리포트인가 — 숫자 대기(q_ready:false)거나 야후로 채워 영업이익이 비었으면 다시 만든다"""
    q = (r.get("qs") or [{}])[-1]
    fresh = (datetime.now(ET).date() - datetime.fromisoformat(r["date"]).date()).days <= 3   # 영업이익 빈칸은 발표 3일 안에만 재시도(나이키처럼 표에 영업이익 줄이 없는 회사)
    return (r.get("rec") or {}).get("q_ready", True) and not (fresh and q.get("src") == "yahoo" and q.get("op") is None)


def main():
    args = sys.argv[1:]
    px_only = "--px-only" in args
    only = args[args.index("--codes") + 1].upper().split(",") if "--codes" in args else None
    now_et = datetime.now(ET)
    today = now_et.strftime("%Y-%m-%d")
    t0 = now_et.date()
    dates = (json.load(open(DATES, encoding="utf-8")).get("dates", {}) if os.path.exists(DATES) else {})
    cal = (json.load(open(CAL, encoding="utf-8")).get("calendar", {}) if os.path.exists(CAL) else {})
    uni = {c["ticker"].upper(): c for c in json.load(open(os.path.join(BASE, "data_sources", "us_universe.json"), encoding="utf-8")).get("companies", [])}
    os.makedirs(REPORTS, exist_ok=True)
    have = {}
    for fn in os.listdir(REPORTS):
        if fn.endswith(".json") and fn != "index.json":
            try:
                r = json.load(open(os.path.join(REPORTS, fn), encoding="utf-8"))
                have.setdefault(r["code"], []).append(r)
            except Exception:
                pass

    # 대상: 예정일이 오늘 이전·오늘이고 LOOKBACK 일 안(나스닥 캘린더 last/next), 그 발표 리포트가 아직 없는 종목
    targets = []
    if not px_only:
        for t, e in dates.items():
            if only and t not in only:
                continue
            cands = [e.get("last"), e.get("next")]
            if e.get("watch") and (e.get("next") or {}).get("date") != e["watch"]:  # 나스닥·야후 날짜가 다르면 더 이른 날도 감시
                cands.append(dict(e.get("next") or {}, date=e["watch"]))
            for x in cands:
                if not x or x["date"] > today or (t0 - datetime.fromisoformat(x["date"]).date()).days > LOOKBACK:
                    continue
                if any(r["date"] >= x["date"] and settled(r) for r in have.get(t, [])):
                    continue   # 이번 분기 숫자가 아직 비어 있는(q_ready:false) 리포트는 다시 만든다
                targets.append((t, x))
    # 안전망 — 캘린더에 없거나 날짜가 틀려도, 지난 3일 안 SEC 에 실적 8-K(2.02)를 낸 명단 종목은 전부 잡는다(2026-10-02)
    if not px_only and "--no-scan" not in args:
        since3 = (t0 - timedelta(days=3)).isoformat()
        seen = {t for t, _ in targets}
        n_scan = 0
        for t in (only or list(uni)):
            if t in seen or any(r["date"] >= since3 and settled(r) for r in have.get(t, [])):
                continue
            cik = cik_of(t)
            if not cik:
                continue
            s = sec_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
            n_scan += 1
            if not s:
                continue
            r = s["filings"]["recent"]
            hit = next((r["filingDate"][i] for i, f in enumerate(r["form"][:40])
                        if f in ("8-K", "8-K/A") and r["filingDate"][i] >= since3 and "2.02" in (r["items"][i] or "")), None)
            if hit:
                e = dates.get(t) or {}
                nx = e.get("next") or e.get("last") or {}
                targets.append((t, {"date": hit, "time": nx.get("time", "na"), "fq": nx.get("fq"), "scan": True}))
                print(f"  [SEC 안전망] {t}: 캘린더와 무관하게 8-K(2.02) {hit} 발견")
        print(f"  SEC 전수 확인 {n_scan}종목")
    print(f"대상 {len(targets)}종목 (발표 예정일 지난 {LOOKBACK}일 · 리포트 없음){' · 주가만' if px_only else ''}")

    cookie, crumb = (None, None) if px_only or not targets else ycrumb()
    made = 0
    for t, x in targets:
        cik = cik_of(t)
        if not cik:
            print(f"  {t}: CIK 없음")
            continue
        since = (datetime.fromisoformat(x["date"]) - timedelta(days=1)).strftime("%Y-%m-%d")
        k8 = find_8k(cik, since)
        if not k8:
            print(f"  {t}: {x['date']} 예정 — 아직 8-K(2.02) 없음")
            continue
        if x.get("scan") and not k8.get("release"):
            # 캘린더 밖에서 잡힌 2.02 인데 보도자료(EX-99)가 없으면 정기 실적이 아닐 수 있다(가이던스 조정·잠정치 등) — 기록만
            print(f"  {t}: 캘린더 밖 8-K(2.02) {k8['date']} — 보도자료 없음, 정기 실적 아닐 수 있어 리포트 안 만듦 ({k8['index']})")
            continue
        if k8.get("release") and not is_results(k8["release"]):
            print(f"  {t}: 8-K(2.02) {k8['date']} 는 실적이 아님(생산·인도량·운영 현황·가이던스 조정 등) — 리포트 안 만듦 ({k8['release']})")
            continue
        try:
            co = json.load(open(os.path.join(US, f"{t}.json"), encoding="utf-8"))
        except Exception:
            co = {}
        fq = fq_month(x.get("fq"))
        fin_q = ((co.get("financials") or {}).get("quarterly")) or []
        extra = None
        if not any(q["date"][:7] == fq for q in fin_q if not q.get("est")):
            # 이번 분기가 XBRL 에 아직 없으면(10-Q 전) 보도자료 손익표를 먼저, 못 읽으면 야후
            last_rev = next((q.get("revenue") for q in reversed(fin_q) if not q.get("est") and q.get("revenue")), None)
            extra = release_q(k8.get("release"), fq, last_rev)
            if extra:
                extra["src"] = "release"
            else:
                extra = yahoo_last_q(t, cookie, crumb)
                if extra and fq and extra["date"][:7] != fq:
                    extra = None  # 아직 야후에도 이번 분기가 안 들어왔다
        qs = build_qs(fin_q, extra)
        cur = qs[-1] if qs else {}
        got_q = bool(cur and fq and cur["date"][:7] == fq)
        rid = f"{t}-{(fq or k8['date'][:7]).replace('-', '')}"
        rec = {"date": k8["date"], "time": x.get("time"), "fq": x.get("fq"), "q_ready": got_q,
               "cons": cons_of(cal.get(t), cur.get("date") if got_q else (fq + "-28" if fq else None)),
               "sec": {"accepted": k8["accepted"], "index": k8["index"]}}
        docs = []
        if k8.get("release"):
            docs.append({"kind": "release", "title": f"실적 보도자료 원문 (8-K EX-99.1, {k8['date']})", "url": k8["release"]})
        docs.append({"kind": "8k", "title": f"SEC 8-K 공시 (Item 2.02, {k8['date']})", "url": k8["index"]})
        ann = [{"fy": a["date"][:7], "est": bool(a.get("est")), "rev": a.get("revenue"), "op": a.get("operating_income"),
                "ni": a.get("net_income"), "date": a["date"]} for a in (((co.get("financials") or {}).get("annual")) or [])][-6:]
        mc = (uni.get(t) or {}).get("mcap")
        doc = {"rid": rid, "code": t, "name": co.get("name") or (uni.get(t) or {}).get("name") or dates[t].get("name"),
               "cat": co.get("sector") or (uni.get(t) or {}).get("sector"), "u": ["us"],
               "mcap": round(mc / 1e8) if mc else None, "mcap_unit": "억 달러", "date": k8["date"], "period": x.get("fq"),
               "unit": "백만 달러", "rec": rec, "qs": qs, "ann": ann, "docs": docs,
               "created": datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M")}
        old = os.path.join(REPORTS, rid + ".json")
        if os.path.exists(old):
            doc["created"] = json.load(open(old, encoding="utf-8")).get("created", doc["created"])
        json.dump(doc, open(old, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        have.setdefault(t, []).append(doc)
        made += 1
        print(f"  {t} {rid}: 8-K {k8['date']} · 보도자료 {'있음' if k8.get('release') else '없음'} · 분기 {cur.get('cq')}{({'yahoo': '(야후)', 'release': '(보도자료)'}).get(cur.get('src'), '')}"
              f"{'' if got_q else ' — 이번 분기 숫자 대기'} · 컨센 {(rec['cons'] or {}).get('pct')}")

    # 주가 반응(최근 14일 안 리포트, 5D 비었으면) + 이번 분기 숫자 대기 중이면 다시 채우기
    n_px = 0
    for t, lst in have.items():
        for r in lst:
            rec = r.setdefault("rec", {})
            if (t0 - datetime.fromisoformat(r["date"]).date()).days > 14 or (rec.get("px") or {}).get("d5") is not None:
                continue
            rx = reaction(closes(t), r["date"], rec.get("time"), now_et)
            if not rec.get("cons"):  # 캘린더 컨센서스(야후 eps_history)는 발표 뒤에 채워지기도 한다
                cur = (r.get("qs") or [{}])[-1]
                rec["cons"] = cons_of(cal.get(t), cur.get("date") if rec.get("q_ready") else None)
            if rx:
                rec["px"] = rx
                r["updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
                json.dump(r, open(os.path.join(REPORTS, r["rid"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                n_px += 1
            time.sleep(0.2)
    n = write_index()
    print(f"완료: 새 리포트 {made} · 주가 반응 갱신 {n_px} · 목록 {n}건")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
