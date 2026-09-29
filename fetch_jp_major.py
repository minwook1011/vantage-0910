#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_jp_major.py — 일본 기업 스크리너「주요 기업」유니버스
→ docs/data/jp/major-data.js  (RAW_MAJ · BUNDLE_MAJ · CATS_MAJ, 「주요 기업」을 고를 때만 페이지가 불러온다)
표준 라이브러리만 사용. jp-major.yml 이 매주 실행한다.

유니버스 = 시가총액 상위 250(도쿄증권거래소 전 시장, 야후 재팬 랭킹) ∪ 닛케이225 구성 종목(닛케이 인덱스 페이지).

데이터 출처
- 야후 재팬 시총 랭킹 finance.yahoo.co.jp/stocks/ranking/marketCapitalHigh (50개/쪽 × 4쪽)
- 닛케이 인덱스 indexes.nikkei.co.jp/nkave/index/component?idx=nk225
- 카부탄 종목 페이지 kabutan.jp/stock/?code=  : 東証33業種 · 예상 PER · 시가총액 · 일본어 회사명
- 카부탄 결산 페이지 kabutan.jp/stock/finance?code= : 3개월(분기) 실적 8분기 · 통기 실적 · 회사 예상(予) · ROE
- 야후 파이낸스 chart API <코드>.T (10년 주봉) : 주가·거래량 · 영문 회사명

계산
- REV   : 최근 4분기 매출 합(TTM, 억엔). 분기가 부족하면 최근 확정 연간 매출.
- REVG  : TTM 매출 ÷ 그 1년 전 TTM 매출 − 1 (8분기 필요). 없으면 최근 확정 연간 YoY.
- OPM   : TTM 영업이익 ÷ TTM 매출. 영업이익을 공시하지 않는 금융업은 null.
- PY/PYTD: 주봉 종가 기준 1년 전·전년 말 대비 등락률.
- PER   : 카부탄 예상 PER. ROE: 카부탄 수익성 표의 최근 확정 연도 ROE.
값이 없으면 null — 0이나 추정치로 채우지 않는다.

로컬 PC에서 SSL 가로채기로 막히면 JP_INSECURE_SSL=1 로만 검증을 끈다(기본은 검증).
개발 중 재실행이 잦으면 MAJ_CACHE=<폴더> 로 원문 응답을 캐시할 수 있다.
"""
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import fetch_jp_earnings_results as K  # http_get(카부탄 1초 간격·SSL 옵션) · parse_finance · num · clean 등 재사용

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "jp", "major-data.js")
JST = timezone(timedelta(hours=9))
TOP_N = 250
YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CACHE = os.environ.get("MAJ_CACHE")
_last_other = [0.0]

# 東証33業種 → 레일에 쓸 한국어 섹터(작은 업종은 묶는다)
SECTOR_MAP = [
    ("電気機器", "전기기기"),
    ("輸送用機器", "자동차·수송기기"),
    ("銀行", "은행"),
    ("保険", "보험"),
    ("証券", "증권·기타금융"),
    ("その他金融", "증권·기타금융"),
    ("情報・通信", "정보·통신"),
    ("卸売", "상사·도매"),
    ("小売", "소매"),
    ("医薬品", "의약품"),
    ("化学", "화학"),
    ("機械", "기계"),
    ("精密機器", "정밀기기"),
    ("サービス", "서비스"),
    ("不動産", "부동산"),
    ("建設", "건설"),
    ("食料品", "식품"),
    ("水産・農林", "식품"),
    ("電気・ガス", "전력·가스"),
    ("陸運", "운송·물류"),
    ("海運", "운송·물류"),
    ("空運", "운송·물류"),
    ("倉庫・運輸", "운송·물류"),
    ("鉄鋼", "철강·금속"),
    ("非鉄金属", "철강·금속"),
    ("金属製品", "철강·금속"),
    ("石油・石炭", "에너지·자원"),
    ("鉱業", "에너지·자원"),
    ("ゴム製品", "소재(유리·고무·섬유·종이)"),
    ("ガラス・土石", "소재(유리·고무·섬유·종이)"),
    ("繊維製品", "소재(유리·고무·섬유·종이)"),
    ("パルプ・紙", "소재(유리·고무·섬유·종이)"),
    ("その他製品", "기타 제품"),
]
MERGED = {"증권·기타금융", "운송·물류", "철강·금속", "에너지·자원", "소재(유리·고무·섬유·종이)", "식품"}


def sector_ko(jp):
    if not jp:
        return "기타"
    for k, v in SECTOR_MAP:
        if k in jp:
            return v
    return "기타"


# ---------------------------------------------------------------- HTTP
def _cache_path(url):
    return os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest() + ".txt") if CACHE else None


def fetch(url, kabu=False, headers=None, tries=3):
    cp = _cache_path(url)
    if cp and os.path.exists(cp):
        return open(cp, encoding="utf-8").read()
    if not kabu:  # 카부탄 외 사이트도 0.6초 이상 간격
        wait = 0.6 - (time.time() - _last_other[0])
        if wait > 0:
            time.sleep(wait)
        _last_other[0] = time.time()
    hdr = headers or ({} if kabu else {"User-Agent": YAHOO_UA})
    txt = K.get_retry(url, tries=tries, kabu=kabu, headers=hdr)
    if txt and cp:
        os.makedirs(CACHE, exist_ok=True)
        with open(cp, "w", encoding="utf-8") as f:
            f.write(txt)
    return txt


# ---------------------------------------------------------------- 유니버스
def yahoo_top(n=TOP_N):
    out = []
    for page in range(1, (n + 49) // 50 + 1):
        h = fetch(f"https://finance.yahoo.co.jp/stocks/ranking/marketCapitalHigh?market=all&page={page}")
        if not h:
            break
        m = re.search(r"window\.__PRELOADED_STATE__\s*=\s*(\{.*?\})\s*</script>", h, re.S)
        if not m:
            print("  [yahoo ranking] 구조 변경? page", page)
            break
        try:
            res = json.loads(m.group(1))["mainRankingList"]["results"]
        except Exception as e:
            print("  [yahoo ranking] 파싱 실패", e)
            break
        for x in res:
            tp = ((x.get("rankingResult") or {}).get("totalPriceObj") or {}).get("totalPrice")
            out.append({"code": x["stockCode"], "jp": re.sub(r"^\(株\)|\(株\)$", "", x.get("stockName") or "").strip(),
                        "mcap_y": (K.num(tp) / 100) if K.num(tp) else None, "rank": int(x.get("rank") or 0)})
    return out[:n]


def nikkei225():
    h = fetch("https://indexes.nikkei.co.jp/nkave/index/component?idx=nk225")
    if not h:
        return []
    out = []
    for code, jp in re.findall(r"<td[^>]*>\s*(\d{3}[0-9A-Z])\s*</td>\s*<td[^>]*>\s*<a[^>]*>[^<]*</a>\s*</td>\s*<td[^>]*>([^<]*)</td>", h):
        out.append({"code": code, "jp": jp.replace("（株）", "").replace("(株)", "").strip()})
    if not out:  # 마크업이 바뀌면 코드만이라도
        out = [{"code": c, "jp": None} for c in re.findall(r"<td[^>]*>\s*(\d{3}[0-9A-Z])\s*</td>", h)]
    seen, uniq = set(), []
    for x in out:
        if x["code"] not in seen:
            seen.add(x["code"])
            uniq.append(x)
    return uniq


# ---------------------------------------------------------------- 카부탄
def _oku(s):
    """'42兆2,598億円' / '8,123億円' → 억엔"""
    s = K.clean(s)
    m = re.search(r"(?:([\d,]+)\s*兆)?\s*(?:([\d,]+)\s*億)?", s)
    if not m or not (m.group(1) or m.group(2)):
        return None
    cho = float(m.group(1).replace(",", "")) if m.group(1) else 0
    oku = float(m.group(2).replace(",", "")) if m.group(2) else 0
    return cho * 10000 + oku


def kabu_stock(code):
    h = fetch(f"https://kabutan.jp/stock/?code={code}", kabu=True)
    if not h:
        return {}
    out = {}
    m = re.search(r'<div class="si_i1_1">\s*<h2>.*?</span>(.*?)</h2>', h, re.S)
    if m:
        out["jp"] = K.clean(m.group(1))
    m = re.search(r'<a href="/themes/\?industry=\d+[^"]*">([^<]+)</a>', h)
    if m:
        out["sector"] = m.group(1).strip()
    m = re.search(r'<span class="market">([^<]+)</span>', h)
    if m:
        out["market"] = m.group(1).strip()
    i = h.find('id="stockinfo_i3"')
    if i >= 0:
        seg = h[i:h.find("</table>", i)]
        tds = re.findall(r"<td[^>]*>(.*?)</td>", seg, re.S)
        if tds:
            per = K.num(re.sub(r"<[^>]+>.*", "", tds[0].strip(), flags=re.S))
            out["per"] = per
        z = re.search(r'class="v_zika2">(.*?)</td>', seg, re.S)
        if z:
            out["mcap"] = _oku(z.group(1))
    m = re.search(r'<span class="kabuka">([\d,\.]+)円</span>', h)
    if m:
        out["close"] = K.num(m.group(1))
    return out


def kabu_roe(html):
    i = html.find("fin_year_profit_d")
    if i < 0:
        return None
    best = None
    for r in K._rows(K._table_after(html, i)):
        c = r["cells"]
        if len(c) < 5 or not re.search(r"\d{4}\.\d{2}", c[0]) or "予" in c[0]:
            continue
        v = K.num(c[4])
        if v is not None:
            best = v  # 오래된 → 최신 순이므로 마지막 확정 연도
    return best


def kabu_fin(code):
    h = fetch(f"https://kabutan.jp/stock/finance?code={code}", kabu=True)
    if not h:
        return None, None
    try:
        return K.parse_finance(h), kabu_roe(h)
    except Exception as e:
        print(f"  [finance parse] {code} {e}")
        return None, None


# ---------------------------------------------------------------- 야후 주봉
def yahoo_weekly(code):
    txt = fetch(f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.T?range=10y&interval=1wk")
    if not txt:
        return None
    try:
        r = json.loads(txt)["chart"]["result"][0]
        ts, q = r["timestamp"], r["indicators"]["quote"][0]
    except Exception:
        return None
    bars = []
    for t, c, v in zip(ts, q.get("close") or [], q.get("volume") or []):
        if c is None:
            continue
        d = (t + 9 * 3600) // 86400  # JST 날짜의 에폭일
        if bars and d - bars[-1][0] < 7:
            # 야후는 마지막에 '현재 시각' 봉을 따로 붙인다 → 같은 주 봉에 종가·날짜만 덮어쓴다
            bars[-1] = [d, c, max(bars[-1][2], v or 0)]
            continue
        bars.append([d, c, v or 0])
    meta = r.get("meta") or {}
    return {"bars": bars, "en": meta.get("longName") or meta.get("shortName"),
            "price": meta.get("regularMarketPrice")}


# ---------------------------------------------------------------- 조립
def r1(v):
    return None if v is None else round(v, 1)


def qlabel(q, fy_month):
    fy = K.fy_of(q["yy"], q["m2"], fy_month)
    return f"{fy[2:4]}Q{K.quarter_no(q['m2'], fy_month)}"


def build_fin(fin):
    """parse_finance → (q, a, f, ttm dict, warn)"""
    if not fin:
        return None, None, None, {}
    fm = fin.get("fy_month")
    qs = [q for q in fin["quarter"] if (q["m2"] - q["m1"]) % 12 == 2]
    fin_type = all(y.get("op") is None for y in fin["year"] if not y["est"]) and bool(fin["year"])
    key_oi = "ord" if fin_type else "op"
    warn = "영업이익을 공시하지 않는 금융업이라 영업이익 칸에 경상이익을 표시합니다." if fin_type else None
    q = None
    if qs and fm:
        qs = qs[::-1]  # 최신 → 과거
        q = {"lb": [qlabel(x, fm) for x in qs],
             "rev": [r1(x["rev"] / 100) if x["rev"] is not None else None for x in qs],
             "oi": [r1(x[key_oi] / 100) if x[key_oi] is not None else None for x in qs],
             "ni": [r1(x["ni"] / 100) if x["ni"] is not None else None for x in qs]}
        if warn:
            q["warn"] = warn
    ys = [y for y in fin["year"] if not y["est"]][::-1]
    a = None
    ttm = {}
    if q and len(q["lb"]) >= 4:
        for k in ("rev", "oi", "ni"):
            v4 = q[k][:4]
            ttm[k] = r1(sum(v4)) if all(v is not None for v in v4) else None
        if len(q["lb"]) >= 8:
            p4 = q["rev"][4:8]
            ttm["rev_prev"] = sum(p4) if all(v is not None for v in p4) else None
    if ys:
        lb, rev, oi, ni = [], [], [], []
        if ttm and any(ttm.get(k) is not None for k in ("rev", "oi", "ni")):
            lb.append("TTM"); rev.append(ttm.get("rev")); oi.append(ttm.get("oi")); ni.append(ttm.get("ni"))
        for y in ys:
            lb.append(y["fy"][:4])
            rev.append(r1(y["rev"] / 100) if y["rev"] is not None else None)
            oi.append(r1(y[key_oi] / 100) if y[key_oi] is not None else None)
            ni.append(r1(y["ni"] / 100) if y["ni"] is not None else None)
        a = {"lb": lb, "rev": rev, "oi": oi, "ni": ni}
        if warn:
            a["warn"] = warn
    f = None
    est = next((y for y in fin["year"] if y["est"]), None)
    if est and any(est[k] is not None for k in ("rev", key_oi, "ni")):
        f = {"y": est["fy"][:4], "n": 0, "co": 1,
             "rev": r1(est["rev"] / 100) if est["rev"] is not None else None,
             "oi": r1(est[key_oi] / 100) if est[key_oi] is not None else None,
             "ni": r1(est["ni"] / 100) if est["ni"] is not None else None}
    ttm["fin_type"] = fin_type
    return q, a, f, ttm


def ret_since(bars, day):
    """day(에폭일) 이전 마지막 봉 대비 최신 봉 등락률"""
    base = None
    for d, c, _ in bars:
        if d <= day:
            base = c
        else:
            break
    if not base or not bars:
        return None
    return r1((bars[-1][1] / base - 1) * 100)


def main():
    t0 = time.time()
    top = yahoo_top()
    nk = nikkei225()
    print(f"시총 상위 {len(top)} · 닛케이225 {len(nk)}")
    uni = {}
    if len(top) < TOP_N * 0.9 or len(nk) < 200:
        # 랭킹·지수 페이지가 막히면 직전 파일의 종목 목록으로 주가·실적만 갱신한다
        prev = []
        try:
            m = re.search(r"const RAW_MAJ = (\[.*?\]);\n", open(OUT, encoding="utf-8").read())
            prev = json.loads(m.group(1)) if m else []
        except Exception:
            pass
        if not prev:
            print("유니버스 소스가 막혔거나 구조가 바뀜 — 기존 파일 유지")
            return 1
        print(f"유니버스 소스 실패 → 직전 목록 {len(prev)}종목 재사용")
        top, nk = [], []
        for r in prev:
            uni[r[0]] = {"code": r[0], "jp": (r[3] or "").split(" · ")[0] or None, "mcap_y": r[5], "top": None, "nk": None}
    for x in top:
        uni[x["code"]] = {"code": x["code"], "jp": x["jp"], "mcap_y": x["mcap_y"], "top": True, "nk": False}
    for x in nk:
        u = uni.setdefault(x["code"], {"code": x["code"], "jp": x["jp"], "mcap_y": None, "top": False})
        u["nk"] = True
    codes = list(uni)
    print(f"합집합 {len(codes)}")
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    if only:
        codes = [c for c in codes if c in set(only[0].split(","))]

    raw, bundle = [], []
    n_px = n_q = n_a = 0
    for i, code in enumerate(codes, 1):
        u = uni[code]
        st = kabu_stock(code)
        fin, roe = kabu_fin(code)
        wk = yahoo_weekly(code)
        q, a, f, ttm = build_fin(fin)
        jp = u["jp"] or st.get("jp") or code
        en = (wk or {}).get("en")
        name = en or jp
        sec_jp = st.get("sector")
        cat = sector_ko(sec_jp)
        ind = jp + (f" · {sec_jp}" if (sec_jp and cat in MERGED) else "")
        mcap = st.get("mcap") or u.get("mcap_y")
        mcap = round(mcap) if mcap else None
        bars = (wk or {}).get("bars") or []
        close = (wk or {}).get("price") or st.get("close") or (bars[-1][1] if bars else None)
        # 매출·성장·이익률
        rev = ttm.get("rev")
        revg = None
        if rev is not None and ttm.get("rev_prev"):
            revg = r1((rev / ttm["rev_prev"] - 1) * 100) if ttm["rev_prev"] > 0 else None
        if a:
            fy_rev = [v for lb, v in zip(a["lb"], a["rev"]) if lb != "TTM"]
            if rev is None and fy_rev and fy_rev[0] is not None:
                rev = fy_rev[0]
            if revg is None and len(fy_rev) >= 2 and fy_rev[0] is not None and fy_rev[1]:
                revg = r1((fy_rev[0] / fy_rev[1] - 1) * 100) if fy_rev[1] > 0 else None
        opm = None
        if not ttm.get("fin_type") and ttm.get("oi") is not None and ttm.get("rev"):
            opm = r1(ttm["oi"] / ttm["rev"] * 100)
        elif not ttm.get("fin_type") and a:
            fy = [(r_, o_) for lb, r_, o_ in zip(a["lb"], a["rev"], a["oi"]) if lb != "TTM"]
            if fy and fy[0][0] and fy[0][1] is not None:
                opm = r1(fy[0][1] / fy[0][0] * 100)
        py = pytd = None
        if bars:
            last = bars[-1][0]
            py = ret_since(bars, last - 365)
            y = (datetime(1970, 1, 1) + timedelta(days=last)).year
            pytd = ret_since(bars, (datetime(y - 1, 12, 31) - datetime(1970, 1, 1)).days)
        if close is not None:
            close = round(close) if close >= 1000 else round(close, 1)
        raw.append([code, name, cat, ind, close, mcap, revg, py, pytd, st.get("per"), roe, opm,
                    round(rev) if rev is not None else None])
        b = {"c": code, "n": name, "cat": cat, "ind": ind, "mcap": mcap, "iv": "w"}
        if bars:
            b["d0"] = bars[0][0]
            b["dd"] = [0] + [bars[k][0] - bars[k - 1][0] for k in range(1, len(bars))]
            b["px"] = [round(x[1] * 10) for x in bars]
            b["vo"] = [round((x[2] or 0) / 100) for x in bars]
            n_px += 1
        if q:
            b["q"] = q
            n_q += 1
        if a:
            b["a"] = a
            n_a += 1
        if f:
            b["f"] = f
        if bars or q or a:
            bundle.append(b)
        tag = ("T" if u.get("top") else "-") + ("N" if u.get("nk") else "-")
        print(f"[{i}/{len(codes)}] {code} {tag} {cat} {jp} mcap={mcap} px={len(bars)} q={len(q['lb']) if q else 0}"
              f" rev={rev} revg={revg} per={st.get('per')} roe={roe}")

    if only:
        print("--codes 모드: 파일을 쓰지 않음")
        return 0
    if n_px < len(codes) * 0.7 or n_a < len(codes) * 0.6:
        print(f"수집률이 너무 낮음(주가 {n_px}, 실적 {n_a}/{len(codes)}) — 기존 파일 유지")
        return 1
    raw.sort(key=lambda r: -(r[5] or 0))
    order = {r[0]: k for k, r in enumerate(raw)}
    bundle.sort(key=lambda b: order.get(b["c"], 9999))
    tot = {}
    for r in raw:
        tot[r[2]] = tot.get(r[2], 0) + (r[5] or 0)
    cats = sorted(tot, key=lambda c: (c == "기타", -tot[c]))
    js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8", newline="\n") as fo:
        fo.write("const RAW_MAJ = " + js(raw) + ";\n")
        fo.write("const BUNDLE_MAJ = [\n" + ",\n".join(js(b) for b in bundle) + "\n];\n")
        fo.write("const CATS_MAJ = " + js(cats) + ";\n")
    print(f"완료 {len(raw)}종목 · 주가 {n_px} · 분기 {n_q} · 연간 {n_a} · {os.path.getsize(OUT)/1e6:.2f}MB · "
          f"{(time.time()-t0)/60:.1f}분")
    print("섹터:", " / ".join(f"{c}({sum(1 for r in raw if r[2]==c)})" for c in cats))
    return 0


if __name__ == "__main__":
    sys.exit(main())
