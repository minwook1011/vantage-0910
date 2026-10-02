"""일본 결산 발표 예정일 — 도쿄증권거래소(JPX) 공식 목록 → docs/data/jp/earnings_dates.json 에 확정일로 반영

출처: https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html
      「決算発表予定日」 엑셀(분기말·결산기말 월별, kessanMM_MMDD.xlsx). 회사가 거래소에 알린 날짜를 JPX가 모아 공개한다.
      (야후 추정·카부탄 이력 추정보다 우선한다. 2026-10-02 사용자 지시: 캘린더는 공식 출처로)

- 각 종목은 '오늘 이후 가장 가까운 JPX 날짜'를 확정일(est:false, src:"jpx")로 쓴다. q(분기)·fy_end(결산기말)도 같이 남긴다.
- JPX 목록에 없는 종목은 기존 값을 그대로 둔다(아직 회사가 날짜를 안 알렸거나 목록 대상 기간 밖).
- 대상 종목: earnings_dates.json 에 이미 있는 종목(일본 소비재 + 주요 기업 명단). --all 이면 JPX 목록 전부.
- 엑셀을 하나도 못 받으면 파일을 건드리지 않는다. openpyxl 필요.
"""
import argparse
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "jp", "earnings_dates.json")
PAGE = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/index.html"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
KST = timezone(timedelta(hours=9))
Q = {"第１四半期": "1Q", "第２四半期": "2Q", "第３四半期": "3Q", "本決算": "FY", "決算": "FY"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()


def parse_xlsx(raw):
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True).active
    out = []
    for r in ws.iter_rows(values_only=True):
        if not r or not isinstance(r[0], datetime) or r[1] is None:
            continue
        code = str(r[1]).strip().upper()
        if not re.fullmatch(r"[0-9A-Z]{4}", code):
            continue
        out.append({"code": code, "date": r[0].strftime("%Y-%m-%d"),
                    "fy_end": r[4].strftime("%Y-%m-%d") if isinstance(r[4], datetime) else None,
                    "q": Q.get(str(r[7] or "").strip(), str(r[8] or "").strip() or None)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="JPX 목록의 모든 종목을 넣는다(기본: 이미 있는 명단만)")
    a = ap.parse_args()
    html = get(PAGE).decode("utf-8", "replace")
    links = sorted(set(re.findall(r'href="([^"]*kessan[^"]*\.xlsx)"', html)))
    if not links:
        print("JPX 페이지에서 엑셀 링크를 못 찾음 — 기존 파일 유지")
        return 1
    rows, ok = [], 0
    for href in links:
        url = href if href.startswith("http") else "https://www.jpx.co.jp" + href
        try:
            got = parse_xlsx(get(url))
            rows += got
            ok += 1
            print(f"  {url.rsplit('/', 1)[-1]}: {len(got)}건")
        except Exception as e:
            print(f"  {url}: 실패 {e}")
    if not ok:
        print("엑셀을 하나도 못 받음 — 기존 파일 유지")
        return 1

    today = datetime.now(KST).strftime("%Y-%m-%d")
    best = {}
    for r in rows:
        if r["date"] < today:
            continue
        if r["code"] not in best or r["date"] < best[r["code"]]["date"]:
            best[r["code"]] = r

    try:
        doc = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        doc = {"dates": {}}
    dates = doc.setdefault("dates", {})
    n_set = n_new = 0
    for code, r in best.items():
        if code not in dates and not a.all:
            continue
        old = dates.get(code) or {}
        new = {"date": r["date"], "est": False, "src": "jpx", "q": r["q"], "fy_end": r["fy_end"]}
        if any(old.get(k) != v for k, v in new.items()):
            n_new += old.get("date") != r["date"]
            dates[code] = dict(old, **new)
            n_set += 1
    now = datetime.now(KST)
    doc["count"] = len(dates)
    doc["jpx"] = {"checked_at": now.isoformat(timespec="minutes"), "files": [l.rsplit("/", 1)[-1] for l in links],
                  "rows": len(rows), "codes_future": len(best), "src": PAGE}
    if n_set:
        doc["updated"] = now.strftime("%Y-%m-%d")
        doc["generated_at"] = now.isoformat(timespec="minutes")
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    jpx_cnt = sum(1 for v in dates.values() if v.get("src") == "jpx")
    print(f"JPX 공식 예정일 {len(best)}종목(오늘 이후) · 반영 {n_set}건(날짜 바뀜 {n_new}) · 명단 중 JPX 확정 {jpx_cnt}/{len(dates)}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
