#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_jp_earnings_results.py — 일본 소비재 스크리너: 실적 발표가 끝난 종목의 결과·가이던스 대비·주가 반응
→ docs/data/jp/earnings_results.json  (페이지가 읽는 파일, 최근 LOOKBACK_DAYS일 발표분)
→ docs/data/jp/earnings_guidance.json (회사 통기 가이던스 스냅샷 — 다음 결산 때 "직전 가이던스 대비"에 쓴다)
표준 라이브러리만 사용. jp-earnings.yml 이 실행한다.

실행 방식
  python fetch_jp_earnings_results.py          # 증분: 최근 발표 예정이던 종목 + 주가 반응이 덜 채워진 종목만
  python fetch_jp_earnings_results.py --full   # 전체 종목 카부탄 스캔(주간 1회) — 가이던스 스냅샷도 전 종목 갱신
  python fetch_jp_earnings_results.py --codes 7532,9983

데이터 출처
- 카부탄 결산 페이지(kabutan.jp/stock/finance): 3개월 실적·통기 실적/회사 예상(予)·예상 수정 이력·누계 진척률, 각 행의 발표일.
- 카부탄 결산 속보 기사(kabutan.jp/stock/news, nmode=2): 발표 시각(장중/장 마감 후), 통기 계획 대비 진척률과 5년 평균,
  (백필용) 직전 분기 기사에 적힌 통기 계획.
- 야후 파이낸스 quoteSummary earnings: 분기 EPS 컨센서스와 실제(서프라이즈 %) — 애널리스트 커버 종목만.
- 야후 파이낸스 chart API(<코드>.T): 일봉 종가 → 발표 전 종가 대비 반응일(1D)·5거래일(5D) 등락률.

비교 기준(beat)
- 컨센서스: 야후 분기 EPS 컨센서스 대비 실제 EPS 서프라이즈 %(있을 때만).
- 결산(4Q/통기) 발표: 통기 실적 ÷ 발표 직전 회사 가이던스 − 1. 영업이익 기준, 영업 가이던스가 없으면 경상이익 기준.
  직전 가이던스는 ① 이 스크립트가 발표 전에 저장해 둔 스냅샷 → ② 카부탄 수정 이력(공개 구간) → ③ 직전 카부탄 기사의 통기 계획(경상) 순.
- 분기(1~3Q) 발표: 누계 경상이익의 통기 계획 대비 진척률 − 과거 같은 시점 평균(기사 5년 평균, 없으면 표의 과거 2~4년 평균) = %p.
  같은 날 통기 가이던스를 고쳤으면 수정 폭(영업, 없으면 경상 %)도 기록한다.
값이 없으면 null — 0이나 추정치로 채우지 않는다.

로컬 PC에서 SSL 가로채기로 막히면 JP_INSECURE_SSL=1 로만 검증을 끈다(기본은 검증).
"""
import html as htmlmod
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
SCREENER = os.path.join(BASE, "docs", "data", "jp", "screener-data.js")
DATES = os.path.join(BASE, "docs", "data", "jp", "earnings_dates.json")
OUT = os.path.join(BASE, "docs", "data", "jp", "earnings_results.json")
GUIDE = os.path.join(BASE, "docs", "data", "jp", "earnings_guidance.json")
JST = timezone(timedelta(hours=9))
KABU_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vantage-jp-screener/1.0"
LOOKBACK_DAYS = 70          # 페이지에 남겨 둘 발표 기간
SSL_CTX = None
if os.environ.get("JP_INSECURE_SSL") == "1":
    SSL_CTX = ssl.create_default_context()
    SSL_CTX.check_hostname = False
    SSL_CTX.verify_mode = ssl.CERT_NONE

_last_kabu = [0.0]


def http_get(url, headers=None, timeout=20, kabu=False):
    if kabu:  # 카부탄은 1초 간격
        wait = 1.0 - (time.time() - _last_kabu[0])
        if wait > 0:
            time.sleep(wait)
        _last_kabu[0] = time.time()
    hdr = {"User-Agent": KABU_UA}
    hdr.update(headers or {})
    req = urllib.request.Request(url, headers=hdr)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        return r.read().decode("utf-8", "replace")


def get_retry(url, tries=3, **kw):
    for a in range(tries):
        try:
            return http_get(url, **kw)
        except Exception as e:
            if a == tries - 1:
                print(f"  [skip] {url} -> {e}")
                return None
            time.sleep(1.5 * (a + 1))


# ---------------------------------------------------------------- 공통 유틸
def num(s):
    s = htmlmod.unescape(s or "").replace(",", "").replace("　", " ").strip()
    s = s.replace("－", "-").replace("▲", "-").replace("△", "-")
    if s in ("", "-", "--", "---", "…"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def ymd(s):
    """'26/08/18' → '2026-08-18'"""
    m = re.search(r"(\d{2})/(\d{2})/(\d{2})", s or "")
    return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def pct(a, b):
    if a is None or b is None or b == 0:
        return None
    if b < 0:  # 적자 가이던스 대비 %는 의미가 뒤집히므로 버린다
        return None
    return round((a / b - 1) * 100, 1)


def clean(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", htmlmod.unescape(s)).strip()


def load_codes():
    txt = open(SCREENER, encoding="utf-8").read()
    m = re.search(r"const RAW = (\[.*?\]);\n", txt, re.S)
    return [r[0] for r in json.loads(m.group(1))]


# ---------------------------------------------------------------- 카부탄 결산 페이지
def _rows(table_html):
    """<table> → [[cell text...]]. 수정 방향 화살표 표는 'ARROW:↑↑→..' 토큰으로 치환."""
    table_html = re.sub(r'<table class="arrow">(.*?)</table>',
                        lambda m: "ARROW:" + "".join(re.findall(r"[↑↓→\-]", clean(m.group(1)))),
                        table_html, flags=re.S)
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, re.S):
        cells = [clean(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
        rowspan_fy = re.search(r'class="td_hpd"[^>]*>\s*(\d{4}\.\d{2})', tr)
        out.append({"cells": cells, "fy": rowspan_fy.group(1) if rowspan_fy else None})
    return out


def _table_after(html, start):
    i = html.find("<table", start)
    if i < 0:
        return ""
    # 중첩 표(화살표)를 고려해 짝이 맞는 </table> 찾기
    depth, j = 0, i
    while True:
        o = html.find("<table", j + 1)
        c = html.find("</table>", j + 1)
        if c < 0:
            return html[i:]
        if 0 <= o < c:
            depth += 1
            j = o
        else:
            if depth == 0:
                return html[i:c + 8]
            depth -= 1
            j = c


def parse_finance(html):
    res = {"year": [], "hist": [], "quarter": [], "cum": None, "fy_month": None}
    # 통기 실적 + 予
    i = html.find('fin_year_result_d')
    if i >= 0:
        for r in _rows(_table_after(html, i)):
            c = r["cells"]
            if len(c) < 8:
                continue
            m = re.search(r"(\d{4})\.(\d{2})", c[0])
            if not m:
                continue
            res["year"].append({"fy": m.group(0), "est": "予" in c[0],
                                "rev": num(c[1]), "op": num(c[2]), "ord": num(c[3]), "ni": num(c[4]),
                                "date": ymd(c[7])})
            res["fy_month"] = int(m.group(2))
    # 예상 수정 이력
    i = html.find('fin_year_forecast_d')
    if i >= 0:
        cur = None
        for r in _rows(_table_after(html, i)):
            c = r["cells"]
            if r["fy"]:
                cur = r["fy"]
            d = next((ymd(x) for x in c if re.fullmatch(r"\d{2}/\d{2}/\d{2}", x)), None)
            kind = next((x for x in c if x in ("初", "修", "実")), None)
            if not (cur and d and kind):
                continue
            try:
                k = next(n for n, x in enumerate(c) if x.startswith("ARROW:"))
            except StopIteration:
                res["hist"].append({"fy": cur, "date": d, "kind": kind, "rev": None, "op": None, "ord": None, "ni": None, "hidden": True})
                continue
            v = c[k + 1:k + 5] + [None] * 4
            res["hist"].append({"fy": cur, "date": d, "kind": kind, "arrows": c[k][6:],
                                "rev": num(v[0]), "op": num(v[1]), "ord": num(v[2]), "ni": num(v[3])})
    # 3개월 실적
    i = html.find('fin_quarter_result_d')
    if i >= 0:
        for r in _rows(_table_after(html, i)):
            c = r["cells"]
            m = re.search(r"(\d{2})\.(\d{2})-(\d{2})", c[0]) if c else None
            if not m or len(c) < 8:
                continue
            res["quarter"].append({"label": m.group(0), "yy": int(m.group(1)), "m1": int(m.group(2)), "m2": int(m.group(3)),
                                   "rev": num(c[1]), "op": num(c[2]), "ord": num(c[3]), "ni": num(c[4]),
                                   "date": ymd(c[7])})
    # 누계(진척률) 표: 머리글에 対通期 進捗率 이 있는 표
    for h in re.finditer(r"<h3>([^<]*累計[^<]*)</h3>", html):
        t = _table_after(html, h.end())
        if "進捗率" not in t:
            continue
        rows = []
        for r in _rows(t):
            c = r["cells"]
            m = re.search(r"(\d{2})\.(\d{2})-(\d{2})", c[0]) if c else None
            if not m or len(c) < 8:
                continue
            rows.append({"label": m.group(0), "rev": num(c[1]), "op": num(c[2]), "ord": num(c[3]), "ni": num(c[4]),
                         "prog": num(c[6]), "date": ymd(c[7])})
        res["cum"] = {"title": h.group(1).strip(), "rows": rows}
        break
    return res


# ---------------------------------------------------------------- 카부탄 기사
def kabu_articles(code):
    h = get_retry(f"https://kabutan.jp/stock/news?code={code}&nmode=2", kabu=True)
    if not h:
        return []
    out = []
    for m in re.finditer(r'<a href="(/stock/news\?code=' + re.escape(code) + r'&(?:amp;)?b=(k(\d{8})\d+))"[^>]*>(.*?)</a>', h, re.S):
        d = m.group(3)
        out.append({"id": m.group(2), "date": f"{d[:4]}-{d[4:6]}-{d[6:]}", "title": clean(m.group(4))})
    return out


def kabu_body(code, aid):
    h = get_retry(f"https://kabutan.jp/stock/news?code={code}&b={aid}", kabu=True)
    if not h:
        return ""
    m = re.search(r'<div class="body">(.*?)</div>', h, re.S)
    return clean(m.group(1)) if m else ""


def _yen(v, unit):
    """기사 금액(億/万円) → 백만엔"""
    x = float(v.replace(",", ""))
    return round(x * 100 if unit == "億" else x / 100, 2)


def parse_article(body):
    out = {}
    m = re.search(r"(\d{1,2})月(\d{1,2})日(大引け後|引け後|昼|前場|後場|場中|取引時間中)?\s*[（(]?(\d{1,2}):(\d{2})", body)
    if m:
        out["time"] = f"{int(m.group(4)):02d}:{m.group(5)}"
    b = re.search(r"(連結|単独)?(経常利益|税引き前利益|最終利益|営業利益)は", body)
    out["basis"] = b.group(2) if b else None
    m = re.search(r"通期計画の([\d,\.]+)(億|万)円に対する進捗率は([\d\.]+)％", body)
    if m:
        out["plan"] = _yen(m.group(1), m.group(2))
        out["prog"] = float(m.group(3))
    m = re.search(r"(\d+)年平均の([\d\.]+)％", body)
    if m:
        out["prog_avg"] = float(m.group(2))
        out["avg_years"] = int(m.group(1))
    m = re.search(r"従来予想の([\d,\.]+)(億|万)円→([\d,\.]+)(億|万)円", body)
    if m:
        out["rev_from"] = _yen(m.group(1), m.group(2))
        out["rev_to"] = _yen(m.group(3), m.group(4))
    m = re.search(r"(\d{2})年(\d{1,2})月期", body)
    if m:
        out["fy"] = f"20{m.group(1)}.{int(m.group(2)):02d}"
    return out


# ---------------------------------------------------------------- 야후
_crumb = {}


def yahoo_crumb():
    if "v" not in _crumb:
        try:
            import fetch_earnings_calendar as yf
            _crumb["v"] = yf.get_crumb()
        except Exception as e:
            print("야후 크럼 실패", e)
            _crumb["v"] = (None, None)
    return _crumb["v"]


def yahoo_surprise(code, date):
    """발표일(±2일)에 해당하는 분기 EPS 컨센서스·실제. 없으면 None."""
    cookie, crumb = yahoo_crumb()
    if not crumb:
        return None
    url = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/" + code + ".T?modules=earnings&crumb="
           + urllib.parse.quote(crumb))
    txt = get_retry(url, headers={"Cookie": cookie, "User-Agent": "Mozilla/5.0"})
    if not txt:
        return None
    try:
        q = json.loads(txt)["quoteSummary"]["result"][0]["earnings"]["earningsChart"]["quarterly"]
    except Exception:
        return None
    d0 = datetime.strptime(date, "%Y-%m-%d")
    for x in q:
        rd = (x.get("reportedDate") or {}).get("raw")
        if not rd:
            continue
        t = datetime.fromtimestamp(rd, JST)
        if abs((t.replace(tzinfo=None) - d0).days) > 2:
            continue
        a, e = (x.get("actual") or {}).get("raw"), (x.get("estimate") or {}).get("raw")
        if a is None or e is None or e <= 0:
            return None
        tm = t.strftime("%H:%M") if (t.hour, t.minute) != (9, 0) else None  # 00:00 UTC = 시각 미상
        return {"eps": round(a, 2), "est": round(e, 2), "pct": round((a / e - 1) * 100, 1), "time": tm}
    return None


def yahoo_closes(code):
    txt = get_retry(f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.T?range=6mo&interval=1d",
                    headers={"User-Agent": "Mozilla/5.0"})
    if not txt:
        return []
    try:
        r = json.loads(txt)["chart"]["result"][0]
        ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
    except Exception:
        return []
    out = {}
    for t, c in zip(ts, cl):
        if c is not None:
            out[datetime.fromtimestamp(t, JST).strftime("%Y-%m-%d")] = round(c, 2)
    return sorted(out.items())


def reaction(closes, date, tm, now):
    """발표 전 종가 대비 반응. 15:30 이후(또는 시각 미상) 발표 → 다음 거래일이 반응일."""
    if not closes:
        return None
    after = tm is None or tm >= "15:30"
    pre = [(d, c) for d, c in closes if (d <= date if after else d < date)]
    post = [(d, c) for d, c in closes if (d > date if after else d >= date)]
    if not pre:
        return None
    today = now.strftime("%Y-%m-%d")
    if post and post[-1][0] == today and now.strftime("%H:%M") < "15:45":
        post = post[:-1]  # 장중 값은 쓰지 않는다
    bd, bc = pre[-1]
    out = {"base_d": bd, "base": bc, "timing": "after" if after else ("pre" if tm < "09:00" else "intraday"),
           "time_known": tm is not None, "d1": None, "d1_d": None, "d5": None, "d5_d": None}
    if len(post) >= 1:
        out["d1_d"], out["d1"] = post[0][0], round((post[0][1] / bc - 1) * 100, 1)
    if len(post) >= 5:
        out["d5_d"], out["d5"] = post[4][0], round((post[4][1] / bc - 1) * 100, 1)
    return out


# ---------------------------------------------------------------- 레코드 조립
def quarter_no(m2, fy_month):
    return ((m2 - fy_month - 1) % 12) // 3 + 1


def fy_of(yy, m2, fy_month):
    y = 2000 + yy
    return f"{y if m2 <= fy_month else y + 1}.{fy_month:02d}"


def pick(d, keys=("rev", "op", "ord", "ni")):
    return {k: d.get(k) for k in keys}


def build(code, fin, today, guide_snap, old_rec, now):
    dates = [q["date"] for q in fin["quarter"] if q["date"]] + [y["date"] for y in fin["year"] if y["date"] and not y["est"]]
    dates = [d for d in dates if d <= today]
    if not dates:
        return None
    D = max(dates)
    if (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(D, "%Y-%m-%d")).days > LOOKBACK_DAYS:
        return None
    fym = fin["fy_month"]
    q = next((x for x in fin["quarter"] if x["date"] == D), None)
    yr = next((x for x in fin["year"] if x["date"] == D and not x["est"]), None)
    rec = {"date": D}
    if q and fym:
        qn = quarter_no(q["m2"], fym)
        rec["period"] = f"{qn}Q"
        rec["fy"] = fy_of(q["yy"], q["m2"], fym)
        rec["q"] = {"label": q["label"], **pick(q)}
        prev = next((x for x in fin["quarter"] if x["yy"] == q["yy"] - 1 and x["m1"] == q["m1"] and x["m2"] == q["m2"]), None)
        if prev:
            rec["q_yoy"] = {k: pct(q[k], prev[k]) for k in ("rev", "op")}
    elif yr:
        rec["period"] = "FY"
        rec["fy"] = yr["fy"]
    else:
        return None
    rec["kind"] = "FY" if rec["period"] in ("4Q", "FY") else "Q"
    fy = rec["fy"]

    # 기사(시각·진척률·백필 가이던스). 같은 날짜 레코드가 있으면 재사용
    art = {}
    if old_rec and old_rec.get("date") == D and old_rec.get("_art") is not None:
        art = old_rec["_art"]
    else:
        arts = kabu_articles(code)
        same = [a for a in arts if a["date"] == D]
        for a in same[:2]:
            p = parse_article(kabu_body(code, a["id"]))
            if p.get("time") or p.get("prog") is not None:
                art.update({k: v for k, v in p.items() if v is not None})
                art["title"] = a["title"]
                art["id"] = a["id"]
                break
        if rec["kind"] == "FY":
            # 백필용: 발표 전 마지막 기사에 적힌 통기 계획(경상)
            d0 = datetime.strptime(D, "%Y-%m-%d")
            for a in [a for a in arts if a["date"] < D and (d0 - datetime.strptime(a["date"], "%Y-%m-%d")).days < 200][:3]:
                p = parse_article(kabu_body(code, a["id"]))
                if p.get("fy") and p["fy"] != fy:
                    continue
                plan = p.get("rev_to") or p.get("plan")
                if plan:
                    art["prior_plan"] = {"ord": plan, "basis": p.get("basis"), "src_date": a["date"], "id": a["id"]}
                    break
    rec["_art"] = art
    if art.get("title"):
        rec["headline"] = art["title"]
        rec["url"] = f"https://kabutan.jp/stock/news?code={code}&b={art['id']}"

    # 컨센서스(야후)
    sup = yahoo_surprise(code, D)
    if sup:
        rec["cons"] = {k: sup[k] for k in ("eps", "est", "pct")}
    tm = art.get("time") or (sup or {}).get("time")
    rec["time"] = tm

    new_guide = next((y for y in fin["year"] if y["est"]), None)
    hist_fy = [h for h in fin["hist"] if h["fy"] == fy]
    if rec["kind"] == "FY":
        actual = next((y for y in fin["year"] if y["fy"] == fy and not y["est"]), None)
        if actual:
            rec["fyres"] = pick(actual)
        g, gsrc = None, None
        snap = (guide_snap or {}).get(fy)
        if snap and snap.get("seen", "9999") < D:
            g, gsrc = pick(snap), "snapshot"
        if g is None:
            vis = [h for h in hist_fy if h["date"] < D and h["kind"] in ("初", "修") and not h.get("hidden")]
            if vis:
                g, gsrc = pick(vis[-1]), "kabutan-hist"
        if g is None and art.get("prior_plan"):
            g, gsrc = {"rev": None, "op": None, "ord": art["prior_plan"]["ord"], "ni": None}, "kabutan-article"
        if g and actual:
            rec["guide_prev"] = {**g, "src": gsrc}
            basis = "op" if g.get("op") is not None and actual.get("op") is not None else "ord"
            if gsrc == "kabutan-article" and art["prior_plan"].get("basis") not in (None, "経常利益"):
                basis = {"税引き前利益": "ord", "営業利益": "op", "最終利益": "ni"}.get(art["prior_plan"]["basis"], "ord")
                rec["guide_prev"] = {"rev": None, "op": None, "ord": None, "ni": None, basis: art["prior_plan"]["ord"], "src": gsrc}
            b = pct(actual.get(basis), rec["guide_prev"].get(basis))
            if b is not None:
                rec["beat"] = {"basis": basis, "pct": b, "rev_pct": pct(actual.get("rev"), g.get("rev"))}
        if new_guide and new_guide["fy"] != fy and new_guide.get("date") == D:
            rec["next_guide"] = {"fy": new_guide["fy"], **pick(new_guide),
                                 "op_g": pct(new_guide.get("op"), (actual or {}).get("op")),
                                 "rev_g": pct(new_guide.get("rev"), (actual or {}).get("rev"))}
    else:
        # 진척률: 누계 표(경상 기준)
        cum = fin.get("cum") or {}
        rows = cum.get("rows") or []
        cur = next((r for r in rows if r["date"] == D), None)
        prog, avg, avg_src = None, None, None
        if cur and cur.get("prog") is not None:
            prog = cur["prog"]
        if art.get("prog") is not None:
            prog = art["prog"] if prog is None else prog
        if art.get("prog_avg") is not None:
            avg, avg_src = art["prog_avg"], f"{art.get('avg_years', 5)}년 평균"
        else:
            past = [r["prog"] for r in rows if r is not cur and r.get("prog") is not None and (not cur or (r.get("date") or "") < D)]
            if past:
                avg, avg_src = round(sum(past) / len(past), 1), f"과거 {len(past)}년 평균"
        pbasis = "ord"
        if prog is None and cur and new_guide and new_guide["fy"] == fy and cur.get("op") is not None \
                and new_guide.get("op") and new_guide["op"] > 0:
            # 경상 진척률이 없는 경우(IFRS 등): 누계 영업이익 ÷ 통기 영업 가이던스. 과거 평균은 알 수 없음
            prog, pbasis, avg, avg_src = round(cur["op"] / new_guide["op"] * 100, 1), "op", None, None
        if prog is not None:
            rec["progress"] = {"basis": pbasis, "pct": prog, "avg": avg, "avg_src": avg_src,
                               "diff": round(prog - avg, 1) if avg is not None else None,
                               "stage": cum.get("title")}
            if cur:
                rec["cum"] = pick(cur)
        if new_guide and new_guide["fy"] == fy:
            rec["guide"] = pick(new_guide)
    # 같은 날 가이던스 수정 여부(공개된 수정 이력으로 판정)
    if new_guide:
        blk = [h for h in fin["hist"] if h["fy"] == new_guide["fy"]]
        chg = next((n for n, h in enumerate(blk) if h["date"] == D and h["kind"] == "修"), None)
        if chg is not None and chg > 0 and not blk[chg].get("hidden"):
            a, b = blk[chg - 1], blk[chg]
            basis = "op" if a.get("op") is not None and b.get("op") is not None else "ord"
            rec["revision"] = {"fy": new_guide["fy"], "basis": basis, "pct": pct(b.get(basis), a.get(basis)),
                               "rev_pct": pct(b.get("rev"), a.get("rev")), "arrows": b.get("arrows"),
                               "from": pick(a), "to": pick(b)}
        elif rec["kind"] == "Q" and blk and not any(h["date"] == D for h in blk):
            rec["revision"] = {"fy": new_guide["fy"], "basis": None, "pct": 0.0, "kept": True}
    return rec


def snapshot_update(snaps, code, fin, today):
    g = next((y for y in fin["year"] if y["est"]), None)
    if not g:
        return
    s = snaps.setdefault(code, {})
    s[g["fy"]] = {**pick(g), "date": g["date"], "seen": today}
    for k in sorted(s)[:-3]:  # FY 3개만 보관
        s.pop(k, None)


def refresh_px(code, rec, now):
    rx = reaction(yahoo_closes(code), rec["date"], rec.get("time"), now)
    if rx:
        rec["px"] = rx


def main():
    args = sys.argv[1:]
    full = "--full" in args
    only = None
    if "--codes" in args:
        only = args[args.index("--codes") + 1].split(",")
    now = datetime.now(JST)
    today = now.strftime("%Y-%m-%d")
    codes = load_codes()
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8")).get("results", {})
        except Exception:
            old = {}
    snaps = {}
    if os.path.exists(GUIDE):
        try:
            snaps = json.load(open(GUIDE, encoding="utf-8")).get("guidance", {})
        except Exception:
            snaps = {}
    sched = {}
    if os.path.exists(DATES):
        try:
            sched = json.load(open(DATES, encoding="utf-8")).get("dates", {})
        except Exception:
            sched = {}

    t0 = datetime.strptime(today, "%Y-%m-%d")
    if only:
        targets = only
    elif full:
        targets = codes
    else:
        # 증분: 이번 주 안에 발표 예정이던(지나간) 종목
        targets = [c for c in codes if c in sched and
                   0 <= (t0 - datetime.strptime(sched[c]["date"], "%Y-%m-%d")).days <= 7]
    targets = list(dict.fromkeys(targets))
    print(f"대상 {len(targets)}종목 ({'full' if full else 'codes' if only else 'incremental'})")

    results = {c: r for c, r in old.items()
               if (t0 - datetime.strptime(r["date"], "%Y-%m-%d")).days <= LOOKBACK_DAYS}
    fetched = 0
    for i, code in enumerate(targets, 1):
        h = get_retry("https://kabutan.jp/stock/finance?code=" + code, kabu=True)
        if not h:
            continue
        fetched += 1
        try:
            fin = parse_finance(h)
        except Exception as e:
            print(f"  [parse] {code} {e}")
            continue
        rec_old = results.get(code)
        try:
            rec = build(code, fin, today, snaps.get(code), rec_old, now)
        except Exception as e:
            print(f"  [build] {code} {e}")
            rec = None
        # 스냅샷은 레코드 계산 뒤에 갱신(발표 전 값으로 비교하기 위해)
        snapshot_update(snaps, code, fin, today)
        if rec:
            refresh_px(code, rec, now)
            results[code] = rec
            b = rec.get("beat", {}).get("pct")
            p = rec.get("progress", {}).get("diff")
            print(f"  {code} {rec['date']} {rec['period']} beat={b} prog={p} cons={rec.get('cons', {}).get('pct')} "
                  f"1D={rec.get('px', {}).get('d1')} 5D={rec.get('px', {}).get('d5')}")
        if i % 50 == 0:
            print(f"  {i}/{len(targets)} 레코드 {len(results)}")

    # 반응 5D가 아직 비어 있는 최근 레코드는 주가만 다시
    for code, rec in results.items():
        if code in targets:
            continue
        px = rec.get("px") or {}
        if px.get("d5") is None and (t0 - datetime.strptime(rec["date"], "%Y-%m-%d")).days <= 14:
            refresh_px(code, rec, now)

    if targets and fetched < len(targets) * 0.3:
        print("카부탄 수집 실패가 많아 기존 파일을 유지합니다.")
        return 1

    out = {"updated": today, "generated_at": now.isoformat(timespec="minutes"),
           "lookback_days": LOOKBACK_DAYS, "count": len(results),
           "results": dict(sorted(results.items()))}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    with open(GUIDE, "w", encoding="utf-8") as f:
        json.dump({"updated": today, "guidance": dict(sorted(snaps.items()))}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"완료: 레코드 {len(results)}개, 가이던스 스냅샷 {len(snaps)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
