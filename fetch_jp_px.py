"""일본 주가 매일 갱신 + 실적 리포트용 주가·구글 트렌드

GitHub Actions `jp-px.yml`이 평일 16:40 KST(도쿄 장 마감 후)에 돌린다. 실적 요약을 쓴 뒤 로컬에서
`python fetch_jp_px.py --codes 8227,7974` 처럼 해당 종목만 바로 만들 수도 있다.

만드는 것
1. docs/data/jp/px_recent.json — 스크리너 번들(screener-data.js · major-data.js)의 마지막 봉 이후 일봉.
   번들은 크고(8MB·2.4MB) 매일 다시 쓰면 저장소가 불어나므로, 번들은 그대로 두고 이 파일만 매일 바꾼다.
   jp-screener.js가 불러와 번들 뒤에 이어 붙인다(주봉 번들은 같은 주 봉을 덮어쓴다).
   {"asof": "YYYY-MM-DD", "bars": {code: [[에폭일, 종가×10, 거래량÷100], ...]}}
2. docs/data/jp/px/<code>.json — 실적 리포트가 있는 종목의 최근 2년 일봉(리포트 페이지 주가 차트)
   {"c", "asof", "b": [[에폭일, 종가], ...]}
3. docs/data/jp/trends/<code>.json — 소비재 리포트 중 요약(notes)에 trend_kw가 있는 종목의 구글 트렌드
   (일본, 최근 5년 주간). 7일에 한 번만 다시 받는다.
   {"c", "kw": [...], "geo": "JP", "asof", "pts": [["YYYY-MM-DD", 값], ...], "url"}

출처: 야후 파이낸스 차트 API(query1.finance.yahoo.com/v8/finance/chart/<code>.T) · 구글 트렌드(trendspy)
실패한 종목은 기존 파일을 그대로 둔다.
"""
import argparse
import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
JP = os.path.join(BASE, "docs", "data", "jp")
BUNDLES = [(os.path.join(JP, "screener-data.js"), "BUNDLE", "con"), (os.path.join(JP, "major-data.js"), "BUNDLE_MAJ", "maj")]
REPORTS = os.path.join(JP, "reports")
PX_DIR = os.path.join(JP, "px")
TR_DIR = os.path.join(JP, "trends")
RECENT = os.path.join(JP, "px_recent.json")
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
EPOCH = datetime(1970, 1, 1)


def dstr(day):
    return (EPOCH + timedelta(days=day)).strftime("%Y-%m-%d")


def load_bundle(path, var):
    try:
        s = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        return []
    m = re.search(r"(?:const|var|let)\s+" + var + r"\s*=\s*", s)
    if not m:
        return []
    return json.JSONDecoder().raw_decode(s, m.end())[0]


def last_day(b):
    if not b.get("px"):
        return None
    return b["d0"] + sum(b["dd"][1:])


def yahoo_daily(code, rng):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.T?range={rng}&interval=1d&events=split"
    for i in range(3):
        try:
            txt = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25).read()
            r = json.loads(txt)["chart"]["result"][0]
            ts, q = r["timestamp"], r["indicators"]["quote"][0]
            # 야후가 일본 종목 분할을 과거 종가에 반영하지 않는 경우가 있다(예: 시마무라 2026-02 1:3) → 분할 전 봉을 직접 나눈다
            splits = [(int(s["date"]), s["numerator"] / s["denominator"])
                      for s in ((r.get("events") or {}).get("splits") or {}).values() if s.get("denominator")]
            cl = q.get("close") or []
            def raw_jump(sd, f):
                """분할일 ±7일 안에서 종가가 분할 비율만큼 뛴 날(=반영 안 됨)을 찾아 그 봉 시각을 돌려준다. 이미 반영됐으면 None.
                야후의 분할 날짜와 실제 권리락일이 하루 이틀 어긋난다(시마무라: 이벤트 2/19, 실제 2/18)."""
                pts = [(t, c) for t, c in zip(ts, cl) if c and abs(t - sd) <= 7 * 86400]
                for (t0, c0), (t1, c1) in zip(pts, pts[1:]):
                    if abs((c0 / c1) / f - 1) < 0.35:
                        return t1
                return None
            splits = [(raw_jump(sd, f), f) for sd, f in splits if f > 0 and f != 1]
            splits = [(sd, f) for sd, f in splits if sd]
            bars = []
            for t, c, v in zip(ts, q.get("close") or [], q.get("volume") or []):
                if c is None:
                    continue
                for sd, f in splits:
                    if t < sd:
                        c, v = c / f, (v or 0) * f
                d = (t + 9 * 3600) // 86400  # JST 날짜의 에폭일
                if bars and bars[-1][0] == d:
                    bars[-1] = [d, c, v or 0]
                else:
                    bars.append([d, c, v or 0])
            return bars
        except Exception as e:
            if i == 2:
                print(f"  [yahoo] {code} 실패: {e}")
            time.sleep(2 + i * 3)
    return None


def pick_range(gap_days):
    for rng, n in (("3mo", 85), ("6mo", 175), ("1y", 355), ("2y", 720), ("5y", 1800)):
        if gap_days <= n:
            return rng
    return "10y"


def report_codes():
    try:
        ix = json.load(open(os.path.join(REPORTS, "index.json"), encoding="utf-8"))
    except FileNotFoundError:
        return {}
    out = {}
    for r in ix.get("reports", []):
        out.setdefault(r["c"], set()).update(r.get("u") or [])
    return out


def trend_targets():
    """notes/<rid>.json 의 trend_kw (소비재만). 같은 종목이면 가장 최근 notes 것"""
    rc = report_codes()
    out = {}
    for p in sorted(glob.glob(os.path.join(REPORTS, "notes", "*.json"))):
        try:
            n = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        kw = n.get("trend_kw")
        code = os.path.basename(p).split("-")[0]
        if kw and "cons" in rc.get(code, set()):
            out[code] = [kw] if isinstance(kw, str) else list(kw)[:5]
    return out


def fetch_trend(code, kws, force=False):
    path = os.path.join(TR_DIR, f"{code}.json")
    if not force and os.path.exists(path):
        try:
            old = json.load(open(path, encoding="utf-8"))
            fresh = (datetime.now(KST).date() - datetime.strptime(old["asof"], "%Y-%m-%d").date()).days < 7
            if fresh and old.get("kw") == kws:
                return "skip"
        except Exception:
            pass
    try:
        from trendspy import Trends
        df = Trends().interest_over_time(kws, geo="JP", timeframe="today 5-y")
    except Exception as e:
        print(f"  [trends] {code} {kws} 실패: {e}")
        return "fail"
    cols = [k for k in kws if k in df.columns]
    if not cols:
        return "fail"
    part = df["isPartial"] if "isPartial" in df.columns else None
    pts = []
    for ts, row in df[cols].iterrows():
        p = [ts.strftime("%Y-%m-%d")] + [int(row[k]) for k in cols]
        if part is not None and bool(part.loc[ts]):
            p.append("p")  # 이번 주(집계 중)
        pts.append(p)
    os.makedirs(TR_DIR, exist_ok=True)
    json.dump({"c": code, "kw": cols, "geo": "JP", "asof": datetime.now(KST).strftime("%Y-%m-%d"),
               "src": "Google Trends · 일본 · 최근 5년 주간 · 조회 기간 최댓값 = 100",
               "url": "https://trends.google.com/trends/explore?date=today%205-y&geo=JP&q=" + urllib.parse.quote(",".join(cols)),
               "pts": pts}, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return "ok"


def write_px(code, bars):
    os.makedirs(PX_DIR, exist_ok=True)
    cut = bars[-1][0] - 740
    b = [[d, round(c, 1) if c < 1000 else round(c)] for d, c, _ in bars if d >= cut]
    json.dump({"c": code, "asof": dstr(bars[-1][0]), "src": "Yahoo Finance 일봉 종가(엔)", "b": b},
              open(os.path.join(PX_DIR, f"{code}.json"), "w", encoding="utf-8"), separators=(",", ":"))


SPLITS = os.path.join(JP, "px_splits.json")


def load_splits(codes):
    """야후 주식 분할 이력(10년 월봉 요청에 붙는 events). 무거우니 7일에 한 번만 전 종목을 다시 받는다.
    {"asof", "s": {code: [[분할 에폭일, 비율], ...]}}"""
    try:
        old = json.load(open(SPLITS, encoding="utf-8"))
        if (datetime.now(KST).date() - datetime.strptime(old["asof"], "%Y-%m-%d").date()).days < 7 and set(codes) <= set(old.get("done") or []):
            return old["s"]
    except Exception:
        old = {"s": {}}
    s, done = {}, []
    for i, c in enumerate(codes, 1):
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{c}.T?range=10y&interval=1mo&events=split"
        try:
            r = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25).read())["chart"]["result"][0]
            ev = ((r.get("events") or {}).get("splits") or {}).values()
            sp = sorted([(int(e["date"]) + 9 * 3600) // 86400, e["numerator"] / e["denominator"]] for e in ev if e.get("denominator"))
            if sp:
                s[c] = sp
            done.append(c)
        except Exception:
            if c in old["s"]:
                s[c] = old["s"][c]
        if i % 200 == 0:
            print(f"  분할 이력 {i}/{len(codes)}")
        time.sleep(0.2)
    json.dump({"asof": datetime.now(KST).strftime("%Y-%m-%d"), "s": s, "done": done}, open(SPLITS, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"분할 이력 {len(done)}/{len(codes)} · 분할 있는 종목 {len(s)}")
    return s


def split_adjustments(bundles, recent):
    """번들(+이어 붙일 최근 봉)에서 분할일 ±12일 안에 종가가 분할 비율만큼 뛴 곳 = 반영 안 된 분할.
    그 뒤 첫 봉의 날짜를 기준일로 돌려준다(화면이 기준일 이전 봉을 비율로 나눈다)."""
    splits = load_splits(sorted({b["c"] for _, b in bundles if b.get("px")}))
    out = {"con": {}, "maj": {}}
    for tag, b in bundles:
        c = b["c"]
        if c not in splits or not b.get("px"):
            continue
        days, d = [], b["d0"]
        for k, dd in enumerate(b["dd"]):
            d = b["d0"] if k == 0 else d + dd
            days.append(d)
        seq = list(zip(days, b["px"])) + [(x[0], x[1]) for x in recent.get(c, [])]
        for sd, f in splits[c]:
            if f <= 0 or f == 1:
                continue
            near = [(i, x) for i, x in enumerate(seq) if abs(x[0] - sd) <= 12]
            for (i0, (d0, p0)), (i1, (d1, p1)) in zip(near, near[1:]):
                if p1 and abs((p0 / p1) / f - 1) < 0.35:
                    lst = out[tag].setdefault(c, [])
                    if [d1, f] not in lst:
                        lst.append([d1, f])
                    break
    print("반영 안 된 분할", {t: len(v) for t, v in out.items()})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", help="쉼표로 구분한 종목만(리포트 주가·트렌드만 만들고 px_recent는 건드리지 않음)")
    ap.add_argument("--no-trends", action="store_true")
    a = ap.parse_args()

    rc = report_codes()
    today = (datetime.now(KST).date() - EPOCH.date()).days

    if a.codes:
        codes = [c.strip() for c in a.codes.split(",") if c.strip()]
        for c in codes:
            bars = yahoo_daily(c, "2y")
            if bars:
                write_px(c, bars)
                print(f"{c} 주가 {len(bars)}봉 → px/{c}.json")
        if not a.no_trends:
            tt = trend_targets()
            for c in codes:
                if c in tt:
                    print(f"{c} 트렌드 {tt[c]} → {fetch_trend(c, tt[c], force=True)}")
        return

    # 번들의 마지막 날(종목별)
    lastd, bundles = {}, []
    for path, var, tag in BUNDLES:
        for b in load_bundle(path, var):
            bundles.append((tag, b))
            ld = last_day(b)
            if ld is not None:
                lastd[b["c"]] = min(lastd.get(b["c"], ld), ld)
    codes = sorted(set(lastd) | set(rc))
    print(f"대상 {len(codes)}종목(번들 {len(lastd)} · 리포트 {len(rc)})")

    try:
        old_recent = json.load(open(RECENT, encoding="utf-8")).get("bars", {})
    except Exception:
        old_recent = {}
    recent, n_ok, n_px, newest = {}, 0, 0, 0
    for i, c in enumerate(codes, 1):
        gap = today - lastd.get(c, today)
        rng = pick_range(gap + 10)
        if c in rc and rng in ("3mo", "6mo", "1y"):
            rng = "2y"
        bars = yahoo_daily(c, rng)
        if not bars:
            if c in old_recent:
                recent[c] = old_recent[c]
            continue
        n_ok += 1
        newest = max(newest, bars[-1][0])
        if c in lastd:
            tail = [[d, round(cl * 10), round((v or 0) / 100)] for d, cl, v in bars if d > lastd[c]]
            if tail:
                recent[c] = tail
        if c in rc:
            write_px(c, bars)
            n_px += 1
        if i % 100 == 0:
            print(f"  {i}/{len(codes)}")
        time.sleep(0.25)

    adj = split_adjustments(bundles, recent)
    if n_ok < len(codes) * 0.6:
        print(f"수집률이 너무 낮음({n_ok}/{len(codes)}) — px_recent.json 유지")
    else:
        json.dump({"asof": dstr(newest) if newest else None, "updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
                   "src": "Yahoo Finance 일봉 · 번들 마지막 봉 이후만", "bars": recent,
                   "adj": adj, "adj_note": "번들에 반영 안 된 주식 분할: {con|maj: {code: [[이 에폭일 이전 봉을, 이 비율로 나눈다]]}}"},
                  open(RECENT, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"주가 {n_ok}/{len(codes)} · 이어 붙일 종목 {len(recent)} · 리포트 주가 {n_px}")

    if not a.no_trends:
        res = {}
        for c, kws in trend_targets().items():
            r = fetch_trend(c, kws)
            res[r] = res.get(r, 0) + 1
            if r != "skip":
                time.sleep(4)
        print("트렌드", res)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
