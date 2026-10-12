"""검색 트렌드 보드 — 브랜드·상품 키워드의 구글 트렌드 → docs/data/trends/board.json (trends.html)

2026-10-12 사용자: 소비재 키워드별 검색 관심도를 카드로 모아(티커·전년 대비·작은 차트) 트렌드를 먼저 포착하고 싶다.

- 키워드: data_sources/trend_board.json(미국·한국·일본 추가 키워드)
          + docs/data/jp/trends/<코드>.json(일본 소비재 리포트 키워드 — fetch_jp_px.py 가 이미 받음, 여기선 다시 받지 않음)
- 구글 트렌드(trendspy) · 최근 5년 주간 · 키워드마다 그 기간 최댓값 = 100. 키워드끼리 크기 비교는 안 되고 각자 흐름만 본다.
- 받은 지 6일이 안 된 키워드는 건너뛴다(주간 자료). 실패하면 예전 값을 그대로 둔다.
- 구글이 자주 막는다(429): 키워드 사이 15초, 막히면 90초 쉬고, 3번 연속이면 멈추고 남은 건 다음 날 실행에서 받는다.
- 지표(이번 주처럼 집계 중인 주는 뺀다):
    now  최근 4주 평균(0~100)
    yoy  최근 4주 평균 ÷ 1년 전 같은 4주 평균 − 1
    spk  급등: 최근 4주 평균 ÷ 그 앞 12주 평균 − 1
  차트용으로 최근 104주 값만 싣는다.
"""
import glob
import json
import os
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(BASE, "data_sources", "trend_board.json")
JP_TR = os.path.join(BASE, "docs", "data", "jp", "trends")
OUT = os.path.join(BASE, "docs", "data", "trends", "board.json")
CACHE = os.path.join(BASE, "docs", "data", "trends", "raw")   # 키워드별 5년 원자료(다음 실행 때 건너뛰기 판단용)
KST = timezone(timedelta(hours=9))
GEO_KO = {"US": "미국", "JP": "일본", "KR": "한국", "": "전 세계"}


def kid(geo, kw):
    return (geo or "WW") + ":" + kw


def fname(k):
    return urllib.parse.quote(k, safe="") + ".json"


def fetch(kw, geo):
    from trendspy import Trends
    T = Trends(request_delay=4.0)
    df = T.interest_over_time([kw], geo=geo, timeframe="today 5-y") if geo else T.interest_over_time([kw], timeframe="today 5-y")
    if kw not in df.columns:
        return None
    part = df["isPartial"] if "isPartial" in df.columns else None
    pts = []
    for ts, row in df.iterrows():
        p = [ts.strftime("%Y-%m-%d"), int(row[kw])]
        if part is not None and bool(part.loc[ts]):
            p.append("p")
        pts.append(p)
    return pts


def metrics(pts):
    full = [p for p in pts if len(p) < 3 or p[2] != "p"]
    v = [p[1] for p in full]
    if len(v) < 70:
        return {}
    avg = lambda a: sum(a) / len(a) if a else 0
    now, ago, prev = avg(v[-4:]), avg(v[-56:-52]), avg(v[-16:-4])
    m = {"now": round(now, 1)}
    if ago >= 1:
        m["yoy"] = round((now / ago - 1) * 100, 1)
    if prev >= 1:
        m["spk"] = round((now / prev - 1) * 100, 1)
    return m


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cfg = json.load(open(CFG, encoding="utf-8"))
    os.makedirs(CACHE, exist_ok=True)
    today = datetime.now(KST).date()
    ok = skip = fail = streak = 0
    blocked = False
    rows = []
    for it in cfg["items"]:
        k = kid(it["geo"], it["kw"])
        p = os.path.join(CACHE, fname(k))
        old = None
        try:
            old = json.load(open(p, encoding="utf-8"))
        except Exception:
            pass
        if old and (today - datetime.strptime(old["asof"], "%Y-%m-%d").date()).days < 6:
            skip += 1
        elif blocked:
            skip += 1
        else:
            try:
                pts = fetch(it["kw"], it["geo"])
                if pts:
                    old = {"asof": today.isoformat(), "pts": pts}
                    json.dump(old, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                    ok += 1
                else:
                    fail += 1
            except Exception as e:
                print(f"  {k} 실패: {str(e)[:80]}")
                fail += 1
                streak += 1
                if "429" in str(e):
                    if streak >= 3:   # 구글이 막았다 — 남은 키워드는 다음 실행(하루 뒤)으로 미룬다
                        print("  구글 요청 제한 — 남은 키워드는 다음 실행에서")
                        blocked = True
                    else:
                        time.sleep(90)
            else:
                streak = 0
            time.sleep(15)
        if not old:
            continue
        rows.append({"k": k, "kw": it["kw"], "geo": it["geo"], "tk": it["tk"], "mk": it["mk"], "cat": it["cat"],
                     "asof": old["asof"], **metrics(old["pts"]), "pts": [x[1] for x in old["pts"][-104:]],
                     "d0": old["pts"][-104:][0][0], "partial": len(old["pts"][-1]) > 2})
    # 일본 소비재 리포트 키워드(이미 받은 파일) — 업종은 스크리너 분류로 대략
    cat_of = {}
    try:
        for line in open(os.path.join(BASE, "docs", "data", "jp", "screener-data.js"), encoding="utf-8"):
            if line.startswith("const RAW = "):
                for r in json.loads(line[len("const RAW = "):].rstrip().rstrip(";")):
                    cat_of[r[0]] = r[2]
    except Exception:
        pass
    CATMAP = {"외식": "food", "라멘": "food", "식품·음료": "food", "패션·명품": "fashion", "화장품·퍼스널케어": "fashion",
              "생활·홈": "house", "리테일·유통": "house", "게임·엔터": "hobby", "여행·레저": "hobby"}
    have = {r["k"] for r in rows}
    for f in sorted(glob.glob(os.path.join(JP_TR, "*.json"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        for i, kw in enumerate(d.get("kw") or []):
            k = kid("JP", kw)
            if k in have:
                continue
            pts = [[p[0], p[1 + i]] + (["p"] if p[-1] == "p" else []) for p in d["pts"]]
            rows.append({"k": k, "kw": kw, "geo": "JP", "tk": d["c"], "mk": "jp", "cat": CATMAP.get(cat_of.get(d["c"]), "etc"),
                         "asof": d.get("asof"), **metrics(pts), "pts": [x[1] for x in pts[-104:]], "d0": pts[-104:][0][0],
                         "partial": len(pts[-1]) > 2})
            have.add(k)
    # 바로가기: 일본 → 스크리너, 미국·한국 → 데이터 허브(차트가 있는 기업만)
    hub = set()
    for fn in ("us_companies.json", "kr_companies.json"):
        try:
            hub |= {c["code"] for c in json.load(open(os.path.join(BASE, "docs", "data", fn), encoding="utf-8"))["companies"]}
        except Exception:
            pass
    for r in rows:
        r["hub"] = r["tk"] in hub
    doc = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
           "src": "구글 트렌드 · 최근 5년 주간 · 키워드마다 그 기간 최댓값 = 100",
           "geo_ko": GEO_KO, "count": len(rows), "items": rows}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"검색 트렌드 보드: {len(rows)}개 키워드 · 새로 받음 {ok} · 건너뜀 {skip} · 실패 {fail}")
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
