#!/usr/bin/env python3
"""한국 기업 스크리너 데이터 — 일본 기업 스크리너(jp-screener)와 같은 꼴(RAW·BUNDLE)로 만든다.

  python build_kr_screener.py            # 소비재·주요 기업 묶음 전부 다시 만들기(주 1회)
  python build_kr_screener.py --recent   # 묶음 마지막 날 뒤 일봉만 모아 px_recent.json (평일 장 마감 뒤)

유니버스
  소비재(con): 네이버 업종(화장품·식품·음료·담배·소매·의류·가정용품·호텔레저·게임·엔터·교육 등) 보통주 · 시총 300억원 이상
               + 미용 의료기기·톡신 일부(클래시스·파마리서치 등)
  주요 기업(maj): 코스피 시총 상위 200 + 코스닥 시총 상위 100
자료: 네이버 금융(업종 목록·시총·일봉·실적·컨센서스), 데이터 허브 기업 파일(docs/data/kr/{코드}.json, DART 장기 분기)이 있으면 그 분기 실적을 쓴다.
출력: docs/data/kr/screener-con.js (RAW·BUNDLE·CATS), docs/data/kr/screener-maj.js (RAW_MAJ·BUNDLE_MAJ·CATS_MAJ), docs/data/kr/px_recent.json
단위: 시총·매출·이익 = 억원, 주가 = 원(묶음 px 는 ×10 정수, vo 는 ÷100), 날짜 = 1970-01-01 부터 일수
"""
import argparse
import json
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

import fetch_kr_companies as K

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs" / "data" / "kr"
F_CON, F_MAJ, F_REC = OUT / "screener-con.js", OUT / "screener-maj.js", OUT / "px_recent.json"
META = OUT / "screener-meta.json"

# 소비재 업종 → 분류
CON_IND = {
    264: "리테일·유통", 308: "리테일·유통", 302: "리테일·유통", 328: "리테일·유통",
    268: "식품·음료", 309: "식품·음료", 275: "식품·음료",
    266: "화장품·퍼스널케어",
    274: "패션·명품",
    298: "생활·홈", 297: "생활·홈", 303: "생활·홈", 271: "생활·홈", 332: "생활·홈",
    263: "게임·엔터", 285: "게임·엔터",
    317: "여행·레저",
    290: "교육",
}
CON_EXTRA = {   # 업종은 의료기기·바이오지만 소비(미용) 성격이 큰 종목
    "214450": "미용·헬스케어", "214150": "미용·헬스케어", "336570": "미용·헬스케어", "216080": "미용·헬스케어",
    "287410": "미용·헬스케어", "335890": "미용·헬스케어", "145020": "미용·헬스케어", "086900": "미용·헬스케어",
    "099430": "미용·헬스케어", "042520": "미용·헬스케어", "149980": "미용·헬스케어",
}
CON_FIX = {"475560": "외식·급식", "453340": "외식·급식", "051500": "외식·급식"}   # 더본코리아·현대그린푸드·CJ프레시웨이(업종이 흩어져 있어 직접 묶음)
CATS_CON = ["리테일·유통", "식품·음료", "외식·급식", "게임·엔터", "미용·헬스케어", "패션·명품", "생활·홈", "화장품·퍼스널케어", "여행·레저", "교육"]
CON_MIN_CAP = 300   # 억원

# 주요 기업: 네이버 업종 → 큰 섹터
MAJ_IND = {
    278: "반도체",
    269: "전자·디스플레이", 327: "전자·디스플레이", 282: "전자·디스플레이", 307: "전자·디스플레이", 292: "전자·디스플레이",
    293: "전자·디스플레이", 338: "전자·디스플레이", 294: "전자·디스플레이",
    306: "전기장비·전력", 283: "전기장비·전력",
    272: "화학·2차전지소재",
    273: "자동차", 270: "자동차",
    291: "조선", 299: "기계", 284: "방산·항공우주",
    261: "제약·바이오", 286: "제약·바이오", 262: "제약·바이오", 281: "제약·바이오", 288: "제약·바이오", 316: "제약·바이오",
    301: "은행", 321: "증권·기타금융", 277: "증권·기타금융", 319: "증권·기타금융", 337: "증권·기타금융", 330: "보험", 315: "보험",
    300: "인터넷·소프트웨어", 287: "인터넷·소프트웨어", 267: "인터넷·소프트웨어",
    263: "게임·미디어", 285: "게임·미디어", 310: "게임·미디어", 314: "게임·미디어",
    333: "통신", 336: "통신",
    313: "에너지", 295: "에너지",
    304: "철강·금속", 322: "철강·금속",
    279: "건설·건자재", 289: "건설·건자재", 320: "건설·건자재",
    326: "운송", 323: "운송", 305: "운송", 329: "운송", 296: "운송",
    325: "유틸리티", 312: "유틸리티", 331: "유틸리티",
    276: "지주회사",
    334: "상사", 265: "상사",
}
for _no in CON_IND:
    MAJ_IND.setdefault(_no, "소비재")
CATS_MAJ = ["반도체", "전자·디스플레이", "전기장비·전력", "화학·2차전지소재", "자동차", "조선", "기계", "방산·항공우주", "제약·바이오",
            "은행", "증권·기타금융", "보험", "인터넷·소프트웨어", "게임·미디어", "통신", "에너지", "철강·금속", "건설·건자재", "운송",
            "유틸리티", "지주회사", "상사", "소비재", "기타"]
MAJ_TOP = {"KOSPI": 200, "KOSDAQ": 100}

DAILY_N = 160        # 소비재 시총 상위(분류별 상위 8 포함)는 일봉, 나머지는 주봉
DAILY_YEARS = 10
EPOCH = date(1970, 1, 1)


def eday(iso):
    return (date.fromisoformat(iso) - EPOCH).days


def num(v):
    return K.number(v)


def done_rows(rows):
    """장중(15:40 전)에 돌리면 오늘 봉은 아직 안 끝난 값이라 뺀다"""
    now = datetime.now(K.KST)
    if rows and rows[-1][0] == now.date().isoformat() and (now.hour, now.minute) < (15, 40):
        return rows[:-1]
    return rows


# ── 업종 지도: 코드 → (업종 번호, 업종 이름, 이름, 시총 억원, 시장) ──
def industry_map():
    groups = K.get_json(f"{K.M_API}/stocks/industry?page=1&pageSize=100").get("groups", [])
    out = {}

    def one(g):
        rows, page = [], 1
        while True:
            d = K.get_json(f"{K.M_API}/stocks/industry/{g['no']}?page={page}&pageSize=100")
            rows += d.get("stocks", [])
            if page * 100 >= (d.get("totalCount") or 0):
                break
            page += 1
        return g, rows

    with ThreadPoolExecutor(6) as ex:
        for g, rows in ex.map(one, groups):
            for s in rows:
                if s.get("stockEndType") != "stock":
                    continue
                out[s["itemCode"]] = {"ind": g["no"], "ind_n": g["name"], "name": s["stockName"], "mcap": num(s.get("marketValue")),
                                      "mkt": "KOSDAQ" if str(s.get("sosok")) == "1" else "KOSPI"}
    return out


def common(code, name):
    """보통주만 — 우선주(끝자리 0 아님)·스팩·리츠·인프라펀드 제외"""
    return code.endswith("0") and not re.search(r"스팩|리츠|REIT|인프라|맵스리얼티|제\d+호", name)


def top_by_market(market, n):
    out, page = [], 1
    while len(out) < n and page <= 6:
        d = K.get_json(f"{K.M_API}/stocks/marketValue/{market}?page={page}&pageSize=100")
        for s in d.get("stocks", []):
            if s.get("stockEndType") == "stock" and common(s["itemCode"], s["stockName"]):
                out.append({"code": s["itemCode"], "name": s["stockName"], "mcap": num(s.get("marketValue")), "mkt": market})
        page += 1
    return out[:n]


# ── 실적 ──
def label_q(dt, fm):
    """분기 라벨(일본 화면과 같은 꼴): 회계연도 끝나는 해 2자리 + Q번호. 12월 결산이면 2026-06 → 26Q2"""
    y, m = int(dt[:4]), int(dt[5:7])
    k = (m - fm) % 12            # 결산월 뒤 몇 달째에 끝나는 분기인가(0 = 결산 분기)
    qn = 4 if k == 0 else k // 3
    fy = y if m <= fm else y + 1
    return f"{fy % 100:02d}Q{qn}"


def label_a(dt, fm):
    return dt[:4]


def naver_extra(code):
    """연간: ROE(최근 확정 연도), 컨센서스 연도 / 분기: 네이버 5분기"""
    out = {"roe": None, "est": None, "ann": [], "q": []}
    try:
        info = K.get_json(f"{K.M_API}/stock/{code}/finance/annual")["financeInfo"]
        rows = {r["title"].strip(): r["columns"] for r in info["rowList"]}
        rev_row = next((rows[l] for l in K.REV_LABELS if l in rows), {})
        for t in info["trTitleList"]:
            k = t["key"]
            if len(k) != 6 or not k.isdigit():
                continue
            rec = {"date": K.month_end(int(k[:4]), int(k[4:])), "est": t.get("isConsensus") == "Y",
                   "revenue": num(rev_row.get(k, {}).get("value")), "operating_income": num(rows.get("영업이익", {}).get(k, {}).get("value")),
                   "net_income": num(rows.get("당기순이익", {}).get(k, {}).get("value")), "roe": num(rows.get("ROE", {}).get(k, {}).get("value"))}
            out["ann"].append(rec)
        act = [r for r in out["ann"] if not r["est"]]
        if act:
            out["roe"] = act[-1]["roe"]
        est = [r for r in out["ann"] if r["est"]]
        if est:
            out["est"] = est[0]
    except Exception:
        pass
    return out


def fin_of(code):
    """분기·연간 실적(억원). 데이터 허브 파일(DART 장기)이 있으면 그것, 없으면 네이버"""
    ex = naver_extra(code)
    q, a = [], []
    p = OUT / f"{code}.json"
    if p.exists():
        try:
            f = json.load(open(p, encoding="utf-8")).get("financials") or {}
            q = [r for r in f.get("quarterly") or [] if not r.get("est")]
            a = [r for r in f.get("annual") or [] if not r.get("est")]
        except Exception:
            pass
    if not q:
        try:
            q = [r for r in K.naver_financials(code, "quarter") if not r.get("est")]
        except Exception:
            q = []
    if not a:
        a = [r for r in ex["ann"] if not r["est"]]
    return q, a, ex


def build_fin(code, q, a, ex):
    fm = int(a[-1]["date"][5:7]) if a else 12
    qa = [r for r in q if r.get("revenue") is not None or r.get("operating_income") is not None][-12:]
    qa.reverse()   # 최근이 앞
    rd = lambda v: None if v is None else round(v, 1)
    qd = {"lb": [label_q(r["date"], fm) for r in qa], "rev": [rd(r.get("revenue")) for r in qa],
          "oi": [rd(r.get("operating_income")) for r in qa], "ni": [rd(r.get("net_income")) for r in qa]} if qa else None
    aa = [r for r in a if r.get("revenue") is not None or r.get("operating_income") is not None][-6:]
    aa.reverse()
    ttm = None
    if len(qa) >= 4 and all(r.get("revenue") is not None for r in qa[:4]):
        s = lambda k: (sum(r[k] for r in qa[:4]) if all(r.get(k) is not None for r in qa[:4]) else None)
        ttm = {"rev": s("revenue"), "oi": s("operating_income"), "ni": s("net_income")}
    ad = None
    if aa or ttm:
        lb, rv, oi, ni = [], [], [], []
        if ttm and not (aa and aa[0]["date"] == qa[0]["date"]):   # 연간 마지막이 최근 분기와 같으면 TTM = 그 해
            lb.append("TTM"); rv.append(ttm["rev"]); oi.append(ttm["oi"]); ni.append(ttm["ni"])
        for r in aa:
            lb.append(label_a(r["date"], fm)); rv.append(r.get("revenue")); oi.append(r.get("operating_income")); ni.append(r.get("net_income"))
        ad = {"lb": lb, "rev": [rd(x) for x in rv], "oi": [rd(x) for x in oi], "ni": [rd(x) for x in ni]}
    est = ex.get("est")
    fd = None
    if est and aa and est["date"][:4] > aa[0]["date"][:4]:
        fd = {"y": est["date"][:4], "n": 0, "co": 0, "rev": est.get("revenue"), "oi": est.get("operating_income"), "ni": est.get("net_income")}
    # 표 지표: 매출 TTM · 매출성장(TTM 전년 대비, 8분기 없으면 최근 연도) · 영업이익률 · 순이익(PER용)
    rev_ttm = ttm["rev"] if ttm else (aa[0].get("revenue") if aa else None)
    oi_ttm = ttm["oi"] if ttm else (aa[0].get("operating_income") if aa else None)
    ni_ttm = ttm["ni"] if ttm else (aa[0].get("net_income") if aa else None)
    revg = None
    if len(qa) >= 8 and all(r.get("revenue") is not None for r in qa[:8]):
        prev = sum(r["revenue"] for r in qa[4:8])
        revg = round((sum(r["revenue"] for r in qa[:4]) / prev - 1) * 100, 1) if prev > 0 else None
    elif len(aa) >= 2 and aa[0].get("revenue") and aa[1].get("revenue") and aa[1]["revenue"] > 0:
        revg = round((aa[0]["revenue"] / aa[1]["revenue"] - 1) * 100, 1)
    opm = round(oi_ttm / rev_ttm * 100, 1) if oi_ttm is not None and rev_ttm and rev_ttm > 0 else None
    return {"q": qd, "a": ad, "f": fd, "fm": fm, "rev": rev_ttm, "revg": revg, "opm": opm, "ni": ni_ttm, "roe": ex.get("roe")}


# ── 주가 ──
def weekly(rows):
    out, key = [], None
    for d, c, v in rows:
        dd = date.fromisoformat(d)
        k = dd.isocalendar()[:2]
        if k != key:
            out.append([d, c, v]); key = k
        else:
            out[-1][0] = d; out[-1][1] = c; out[-1][2] += v
    return [tuple(x) for x in out]


def spikes(rows):
    """거래량이 직전 60거래일 중앙값의 5배 이상이면서 그날 주가가 5% 넘게 움직인 날(일본 화면과 같은 기준)"""
    out, last = [], -99
    c = [r[1] for r in rows]; v = [r[2] for r in rows]
    for i in range(60, len(rows)):
        med = statistics.median(v[i - 60:i]) or 0
        if med <= 0 or v[i] < med * 5 or not c[i - 1]:
            continue
        d1 = (c[i] / c[i - 1] - 1) * 100
        if abs(d1) < 5 or i - last < 5:
            continue
        last = i
        f = lambda n: round((c[min(i + n, len(c) - 1)] / c[i] - 1) * 100, 1) if i + n < len(c) else None
        out.append({"i": i, "dy": eday(rows[i][0]), "m": round(v[i] / med, 1), "d1": round(d1, 1), "f5": f(5), "f20": f(20)})
    return out


def pack(rows):
    d = [eday(r[0]) for r in rows]
    return {"d0": d[0], "dd": [0] + [d[i] - d[i - 1] for i in range(1, len(d))],
            "px": [int(round(r[1] * 10)) for r in rows], "vo": [int(round((r[2] or 0) / 100)) for r in rows]}


def ret_since(rows, day_iso):
    base = None
    for d, c, _ in rows:
        if d <= day_iso:
            base = c
        else:
            break
    return round((rows[-1][1] / base - 1) * 100, 1) if base else None


def one_stock(s, daily):
    code = s["code"]
    try:
        rows = done_rows(K.fetch_chart(code, 260 * DAILY_YEARS))
    except Exception:
        rows = []
    if len(rows) >= 20 and all(not v for _, _, v in rows[-20:]):   # 최근 20거래일 거래 없음 = 거래정지 → 뺀다
        return None, None, None
    q, a, ex = fin_of(code)
    fin = build_fin(code, q, a, ex)
    close = int(rows[-1][1]) if rows else None
    last = rows[-1][0] if rows else None
    py = pytd = None
    if rows:
        ld = date.fromisoformat(last)
        py = ret_since(rows, (ld.replace(year=ld.year - 1)).isoformat())
        pytd = ret_since(rows, f"{ld.year - 1}-12-31")
    mcap = s["mcap"]
    per = None
    if fin["ni"] is not None and mcap:
        per = round(mcap / fin["ni"], 1) if fin["ni"] > 0 else -1
    raw = [code, s["name"], s["cat"], s.get("ind_n") or "", close, round(mcap) if mcap else None, fin["revg"], py, pytd, per,
           fin["roe"], fin["opm"], round(fin["rev"]) if fin["rev"] is not None else None]
    b = None
    if len(rows) >= 20:
        b = {"c": code, "n": s["name"], "cat": s["cat"], "ind": s.get("ind_n") or "", "mcap": raw[5], "fm": fin["fm"]}
        if daily:
            b.update(pack(rows)); b["sp"] = spikes(rows)
        else:
            b["iv"] = "w"; b.update(pack(weekly(rows)))
        for k in ("q", "a", "f"):
            if fin[k]:
                b[k] = fin[k]
    return raw, b, last


def write_js(path, names, raw, bundle, cats, extra=""):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(f"/* 한국 기업 스크리너 데이터 — build_kr_screener.py 가 만든다({datetime.now(K.KST):%Y-%m-%d %H:%M} KST) */\n")
        f.write(f"const {names[0]} = {json.dumps(raw, ensure_ascii=False, separators=(',', ':'))};\n")
        f.write(f"const {names[1]} = {json.dumps(bundle, ensure_ascii=False, separators=(',', ':'))};\n")
        f.write(f"const {names[2]} = {json.dumps(cats, ensure_ascii=False)};\n")
        f.write(extra)


def build_all():
    imap = industry_map()
    print("업종 지도", len(imap))
    # 소비재
    con = []
    for code, v in imap.items():
        cat = CON_FIX.get(code) or CON_EXTRA.get(code) or CON_IND.get(v["ind"])
        if not cat or not common(code, v["name"]) or not v["mcap"] or v["mcap"] < CON_MIN_CAP:
            continue
        con.append({"code": code, "name": v["name"], "mcap": v["mcap"], "cat": cat, "ind_n": v["ind_n"]})
    con.sort(key=lambda s: -s["mcap"])
    daily = {s["code"] for s in con[:DAILY_N]}
    for c in CATS_CON:
        daily |= {s["code"] for s in [x for x in con if x["cat"] == c][:8]}
    # 주요 기업
    maj = []
    for m, n in MAJ_TOP.items():
        for s in top_by_market(m, n):
            v = imap.get(s["code"]) or {}
            s["cat"] = MAJ_IND.get(v.get("ind"), "기타")
            s["ind_n"] = v.get("ind_n") or ""
            maj.append(s)
    seen = set(); maj = [s for s in maj if not (s["code"] in seen or seen.add(s["code"]))]
    maj.sort(key=lambda s: -(s["mcap"] or 0))
    print("소비재", len(con), "(일봉", len(daily), ") · 주요 기업", len(maj))

    cache = {}

    def run(s, d):
        key = (s["code"], d)
        if key not in cache:
            for t in range(3):
                try:
                    cache[key] = one_stock(s, d); break
                except Exception as e:
                    if t == 2:
                        print("  실패", s["code"], s["name"], e); cache[key] = (None, None, None)
                    time.sleep(1 + t)
        return cache[key]

    def build(lst, dset):
        with ThreadPoolExecutor(8) as ex:
            res = list(ex.map(lambda s: run(s, s["code"] in dset), lst))
        raw = [r for r, _, _ in res if r]
        bun = [b for _, b, _ in res if b]
        asof = max((l for *_, l in res if l), default=None)
        return raw, bun, asof

    rc, bc, ac = build(con, daily)
    write_js(F_CON, ("RAW", "BUNDLE", "CATS"), rc, bc, CATS_CON, "const KPI = {};\nconst NEWS = {};\nconst BM = {};\n")
    rm, bm, am = build(maj, set())
    write_js(F_MAJ, ("RAW_MAJ", "BUNDLE_MAJ", "CATS_MAJ"), rm, bm, CATS_MAJ)
    meta = {"updated": datetime.now(K.KST).isoformat(timespec="minutes"), "asof_con": ac, "asof_maj": am,
            "con": len(rc), "con_daily": sum(1 for b in bc if not b.get("iv")), "maj": len(rm)}
    json.dump(meta, open(META, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump({"updated": meta["updated"], "bars": {}}, open(F_REC, "w", encoding="utf-8"))
    print(json.dumps(meta, ensure_ascii=False))
    for p in (F_CON, F_MAJ):
        print(p.name, round(p.stat().st_size / 1e6, 2), "MB")


def build_recent():
    """묶음 마지막 날 뒤 일봉 — {코드: [[에폭일, 종가×10, 거래량÷100], …]}"""
    last = {}
    for p, var in ((F_CON, "BUNDLE"), (F_MAJ, "BUNDLE_MAJ")):
        t = p.read_text(encoding="utf-8")
        m = re.search(r"const\s+" + var + r"\s*=\s*(\[.*?\]);\n", t, re.S)
        for b in json.loads(m.group(1)) if m else []:
            d = b["d0"] + sum(b["dd"][1:])
            last[b["c"]] = max(last.get(b["c"], 0), d)

    def one(code):
        try:
            rows = done_rows(K.fetch_chart(code, 30))
        except Exception:
            return code, None
        return code, [[eday(d), int(round(c * 10)), int(round((v or 0) / 100))] for d, c, v in rows if eday(d) > last[code]]

    with ThreadPoolExecutor(8) as ex:
        bars = {c: r for c, r in ex.map(one, list(last)) if r}
    json.dump({"updated": datetime.now(K.KST).isoformat(timespec="minutes"), "bars": bars}, open(F_REC, "w", encoding="utf-8"), separators=(",", ":"))
    print("최근 일봉", len(bars), "종목")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recent", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    build_recent() if a.recent else build_all()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
