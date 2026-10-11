"""료힌케이카쿠(무지, 7453) 워크벤치 데이터 → docs/data/ryohin.json

자동 수집(매일): 주가(야후 7453.T 일간), 환율(CNY·USD/JPY 월평균, 진행 중인 달 제외), 도쿄 날씨(기상청 월평균 기온·강수량, 전년 같은 달 대비),
                 구글 트렌드(MUJI, 전 세계·일본·미국·대만 월간, trendspy 가 있을 때만).
수동 자료: data_sources/ryohin_manual.json (회사 월차·팩트시트·데이터북·유니클로 월차) — 새 월차가 나오면 그 파일 끝에 한 줄 추가.
화면 설명용 표(선행지표 1·2순위, 리서치 도구 스냅샷)는 data_sources/ryohin_catalog.json.
빈 값은 0으로 채우지 않는다. 한 소스가 실패하면 직전 파일의 같은 series 를 그대로 둔다.

사용: python fetch_ryohin.py [--only price,fx,weather,trends]
"""
import argparse
import calendar
import datetime as dt
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs" / "data" / "ryohin.json"
MANUAL = ROOT / "data_sources" / "ryohin_manual.json"
CATALOG = ROOT / "data_sources" / "ryohin_catalog.json"
UA = {"User-Agent": "Mozilla/5.0 (vantage ryohin collector)"}
KST = dt.timezone(dt.timedelta(hours=9))


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


def month_end(y, m):
    return f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"


def series(id, group, label, unit, points, source, url="", cadence="", note=""):
    return {"id": id, "group": group, "label": label, "unit": unit, "cadence": cadence, "source": source, "source_url": url, "note": note,
            "points": sorted(points, key=lambda p: p["date"])}


def fetch_price():
    j = json.loads(get("https://query1.finance.yahoo.com/v8/finance/chart/7453.T?range=10y&interval=1d"))
    r = j["chart"]["result"][0]
    ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
    pts = [{"date": dt.datetime.fromtimestamp(t, dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d"), "value": round(c, 1)} for t, c in zip(ts, cl) if c is not None]
    return {"label": "료힌케이카쿠 주가", "unit": "엔", "source": "Yahoo Finance (7453.T)", "points": pts}


def fetch_fx():
    out = []
    for sym, label in [("CNYJPY", "위안/엔"), ("USDJPY", "달러/엔")]:
        j = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}=X?range=10y&interval=1d"))
        r = j["chart"]["result"][0]
        acc = {}
        for t, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
            if c is None:
                continue
            d = dt.datetime.fromtimestamp(t, dt.timezone.utc)
            acc.setdefault((d.year, d.month), []).append(c)
        now = dt.datetime.now(KST)
        pts = [{"date": month_end(y, m), "value": round(sum(v) / len(v), 3 if sym == "CNYJPY" else 2)} for (y, m), v in acc.items() if (y, m) != (now.year, now.month)]
        out.append(series(f"fx_{sym.lower()}", "fx", f"{label} 월평균", "엔", pts, "Yahoo Finance", f"https://finance.yahoo.com/quote/{sym}=X", "월간 · 일간 종가 평균"))
        byk = {p["date"]: p["value"] for p in pts}
        yoy = []
        for p in pts:
            y, m = int(p["date"][:4]), int(p["date"][5:7])
            prev = byk.get(month_end(y - 1, m))
            if prev:
                yoy.append({"date": p["date"], "value": round((p["value"] / prev - 1) * 100, 1)})
        out.append(series(f"fx_{sym.lower()}_yoy", "fx", f"{label} 전년비", "%", yoy, "Yahoo Finance", "", "월간", "+ 면 엔저(해외 매출 엔 환산에 유리)"))
    return out


def fetch_weather(start_year=2017):
    temp, prec = {}, {}
    this = dt.datetime.now(KST)
    for y in range(start_year, this.year + 1):
        html = get(f"https://www.data.jma.go.jp/stats/etrn/view/monthly_s1.php?prec_no=44&block_no=47662&year={y}&month=&day=&view=").decode("utf-8", "replace")
        for row in re.findall(r'<tr class="mtx"[^>]*>(.*?)</tr>', html, re.S):
            cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
            if not cells or not cells[0].isdigit():
                continue
            m = int(cells[0])
            if (y, m) >= (this.year, this.month):
                continue  # 진행 중인 달은 빼고 끝난 달만
            num = lambda s: float(re.sub(r"[^\d.\-]", "", s)) if re.sub(r"[^\d.\-]", "", s) not in ("", "-", ".") else None
            if len(cells) > 7:
                t, p = num(cells[7]), num(cells[3])
                if t is not None:
                    temp[(y, m)] = t
                if p is not None:
                    prec[(y, m)] = p
        time.sleep(1)
    url = "https://www.data.jma.go.jp/stats/etrn/"
    out = [series("wx_tokyo_temp", "weather", "도쿄 월평균 기온", "℃", [{"date": month_end(y, m), "value": v} for (y, m), v in temp.items()], "기상청(도쿄)", url, "월간"),
           series("wx_tokyo_temp_yoy", "weather", "도쿄 월평균 기온 전년차", "℃", [{"date": month_end(y, m), "value": round(v - temp[(y - 1, m)], 1)} for (y, m), v in temp.items() if (y - 1, m) in temp], "기상청(도쿄)", url, "월간", "+ 면 작년보다 따뜻함"),
           series("wx_tokyo_prec", "weather", "도쿄 월 강수량", "mm", [{"date": month_end(y, m), "value": v} for (y, m), v in prec.items()], "기상청(도쿄)", url, "월간"),
           series("wx_tokyo_prec_yoy", "weather", "도쿄 월 강수량 전년비", "%", [{"date": month_end(y, m), "value": round((v / prec[(y - 1, m)] - 1) * 100)} for (y, m), v in prec.items() if prec.get((y - 1, m))], "기상청(도쿄)", url, "월간")]
    return out


def fetch_trends():
    from trendspy import Trends  # pip install trendspy
    tr = Trends()
    out = []
    for geo, gl in [("", "전 세계"), ("JP", "일본"), ("US", "미국"), ("TW", "대만")]:
        df = tr.interest_over_time(["MUJI"], geo=geo, timeframe="today 5-y")
        acc = {}
        for idx, row in df.iterrows():
            d = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
            acc.setdefault((d.year, d.month), []).append(float(row["MUJI"]))
        now = dt.datetime.now(KST)
        pts = [{"date": month_end(y, m), "value": round(sum(v) / len(v), 1)} for (y, m), v in acc.items() if (y, m) != (now.year, now.month)]
        out.append(series(f"gt_muji_{geo.lower() or 'world'}", "search", f"구글 트렌드 MUJI · {gl}", "0–100", pts, "Google Trends",
                          "https://trends.google.com/trends/explore?date=today%205-y&q=MUJI" + (f"&geo={geo}" if geo else ""), "월간 · 주간 값 평균", "상대지수(기간 최고=100). 영문 'MUJI' 검색어만"))
        time.sleep(5)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    prev = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    prev_auto = {s["id"]: s for s in prev.get("series", []) if s.get("auto")}
    manual = json.loads(MANUAL.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else {}
    errors = []
    price = prev.get("price")
    auto = dict(prev_auto)
    jobs = {"price": fetch_price, "fx": fetch_fx, "weather": fetch_weather, "trends": fetch_trends}
    for name, fn in jobs.items():
        if only and name not in only:
            continue
        try:
            res = fn()
            if name == "price":
                price = res
            else:
                for s in res:
                    if len(s["points"]) > 1:
                        s["auto"] = True
                        auto[s["id"]] = s
            print(f"[ok] {name}")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {e}")
            print(f"[fail] {name}: {e}", file=sys.stderr)
    out = {"schema_version": 2, "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
           "groups": [{"id": "monthly", "label": "무지 월차"}, {"id": "quarterly", "label": "분기 실적"}, {"id": "stores", "label": "점포 수"},
                      {"id": "peer", "label": "유니클로"}, {"id": "fx", "label": "환율"}, {"id": "weather", "label": "도쿄 날씨"}, {"id": "search", "label": "검색 관심도"}],
           "price": price, "series": manual["series"] + list(auto.values()), "errors": errors}
    out.update({k: v for k, v in catalog.items() if k not in out})
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"saved {OUT} · series {len(out['series'])} · price {len((price or {}).get('points', []))}")


if __name__ == "__main__":
    main()
