"""일본 실적 발표 '10분 후' 주가 반응 (2026-10-06 사용자 요청: 다음 거래일까지 기다리지 말고 발표 10분 뒤 주가로).

- 발표 시각: 도쿄증권거래소 TDnet 공식 공시 목록(release.tdnet.info)의 決算短信 시각
- 장 마감(15:30) 뒤 발표 → 장외거래(PTS) 가격. 카부탄 종목 화면의 PTS 체결가·체결 시각을 쓰고,
  체결 시각이 '발표 + 10분' 이후인 첫 값을 고정(px10). 기준은 그날 종가.
- 장중 발표 → 야후 1분봉에서 '발표 + 10분' 봉의 가격, 기준은 발표 직전 봉. (09:00 전 발표는 09:10 가격, 기준은 전날 종가)
- 고정한 뒤에도 PTS 최신가(now)는 30분마다 갱신.
결과: docs/data/jp/earnings_pts.json {"updated", "items": {code: {...}}} — jp-screener.js 가 '발표 10분 후' 칩으로 보여 준다.

사용: python jp_pts_watch.py            (한 번 돌고 끝 — 예약 작업이 10분마다 pc_job 으로 부른다)
      python jp_pts_watch.py --date 2026-10-06 (그날 다시 계산; 지난 날은 PTS 값을 못 받으니 장중 발표만)
"""
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs", "data", "jp", "earnings_pts.json")
DATES = os.path.join(ROOT, "docs", "data", "jp", "earnings_dates.json")
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}


def get(url, timeout=20):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode("utf-8", "replace")
        except Exception:
            time.sleep(1.5 * (i + 1))
    return ""


def tdnet_times(date):
    """그날 決算短信 낸 종목 → 처음 공시 시각 'HH:MM'"""
    ymd = date.replace("-", "")
    out = {}
    for page in range(1, 40):
        h = get(f"https://www.release.tdnet.info/inbs/I_list_{page:03d}_{ymd}.html")
        if not h:
            break
        got = 0
        for r in re.findall(r"<tr>(.*?)</tr>", h, re.S):
            tds = [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
            if len(tds) < 4 or not re.match(r"^\d{2}:\d{2}$", tds[0]):
                continue
            got += 1
            m = re.match(r"^(\w{4})0$", tds[1])
            if m and "決算短信" in tds[3]:
                c = m.group(1)
                if c not in out or tds[0] < out[c]:
                    out[c] = tds[0]
        if not got or f"I_list_{page + 1:03d}_{ymd}" not in h:
            break
    return out


def kabutan(code):
    """(그날 종가 또는 현재가, 그 시각 'YYYY-MM-DD'), (PTS 가격, PTS 'YYYY-MM-DD HH:MM')"""
    h = get(f"https://kabutan.jp/stock/?code={code}")
    if not h:
        return None, None
    num = lambda s: float(s.replace(",", "").replace("円", "")) if s and re.search(r"\d", s) else None
    px = re.search(r'<span class="kabuka">([\d,\.]+)円</span>', h)
    tm = re.search(r'<div class="si_i1_1_rbox">.*?<time datetime="(\d{4}-\d{2}-\d{2})T', h, re.S)
    close = (num(px.group(1)), tm.group(1)) if px and tm else None
    pts = re.search(r'<div class="kabuka1">PTS</div>\s*<div class="kabuka2">([\d,\.]+)円</div>\s*<div class="kabuka3">(\d{2}:\d{2})\D+(\d{2})/(\d{2})</div>', h)
    p = None
    if pts:
        y = datetime.now(KST).year
        p = (num(pts.group(1)), f"{y}-{pts.group(3)}-{pts.group(4)} {pts.group(2)}")
    return close, p


def yahoo_1m(code, date):
    """그날 1분봉 [(HH:MM, close)] 과 전날 종가"""
    h = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{code}.T?range=5d&interval=1m")
    try:
        r = json.loads(h)["chart"]["result"][0]
    except Exception:
        return [], None
    bars, prev = [], None
    for t, c in zip(r.get("timestamp") or [], r["indicators"]["quote"][0].get("close") or []):
        if c is None:
            continue
        d = datetime.fromtimestamp(t, KST)
        if d.strftime("%Y-%m-%d") == date:
            bars.append((d.strftime("%H:%M"), c))
        elif d.strftime("%Y-%m-%d") < date:
            prev = c
    return bars, prev


def plus(hm, mins):
    h, m = map(int, hm.split(":"))
    t = h * 60 + m + mins
    return f"{t // 60:02d}:{t % 60:02d}"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    now = datetime.now(KST)
    date = sys.argv[sys.argv.index("--date") + 1] if "--date" in sys.argv else now.strftime("%Y-%m-%d")
    hm = now.strftime("%H:%M") if date == now.strftime("%Y-%m-%d") else "23:59"
    try:
        doc = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        doc = {"items": {}}
    before = json.dumps(doc["items"], ensure_ascii=False, sort_keys=True)
    cut = (datetime.strptime(date, "%Y-%m-%d") - timedelta(days=10)).strftime("%Y-%m-%d")
    items = {c: v for c, v in doc["items"].items() if v.get("date", "") >= cut}
    uni = set()
    for f, key in ((DATES, "dates"), (os.path.join(ROOT, "docs", "data", "jp", "earnings_results.json"), "results")):
        try:
            uni |= set(json.load(open(f, encoding="utf-8")).get(key, {}).keys())
        except Exception:
            pass
    ann = tdnet_times(date)
    todo = {c: t for c, t in ann.items() if (not uni or c in uni)}
    print(f"{date} {hm} · TDnet 결산단신 {len(ann)}곳 · 대상 {len(todo)}곳")
    n_new = 0
    for code, t in sorted(todo.items(), key=lambda kv: kv[1]):
        rec = items.get(code) if items.get(code, {}).get("date") == date else None
        rec = rec or {"date": date, "t": t}
        rec["t"] = t
        after = t >= "15:30"
        target = plus(t, 10) if t >= "09:00" else "09:10"
        if hm < target:
            items[code] = rec
            continue
        if not after:
            if rec.get("px10") is None:
                bars, prev = yahoo_1m(code, date)
                if bars:
                    pre = [c for m, c in bars if m < t] if t >= "09:00" else []
                    base = pre[-1] if pre else prev
                    hit = [(m, c) for m, c in bars if m >= target]
                    if base and hit:
                        rec.update(base=round(base, 2), base_src="발표 직전" if pre else "전날 종가", px10=round(hit[0][1], 2), at10=hit[0][0],
                                   pct10=round((hit[0][1] / base - 1) * 100, 1), src="장중")
                        n_new += 1
                time.sleep(0.4)
        else:
            stale = rec.get("now_checked", "") < plus(hm, -30) if rec.get("now_checked") else True
            if rec.get("px10") is None or stale:
                close, pts = kabutan(code)
                time.sleep(0.8)
                if close and close[1] == date and close[0]:
                    rec["base"], rec["base_src"] = close[0], "그날 종가"
                if pts and pts[0] and pts[1].startswith(date) and rec.get("base"):
                    pt = pts[1][11:]
                    if rec.get("px10") is None and pt >= target:
                        rec.update(px10=pts[0], at10=pt, pct10=round((pts[0] / rec["base"] - 1) * 100, 1), src="PTS")
                        n_new += 1
                    rec.update(now_px=pts[0], now_at=pt, now_pct=round((pts[0] / rec["base"] - 1) * 100, 1))
                rec["now_checked"] = hm
        items[code] = rec
    if json.dumps(items, ensure_ascii=False, sort_keys=True) == before:
        print("변경 없음")
        return 0
    doc = {"updated": now.isoformat(timespec="minutes"), "note": "실적 발표 10분 후 주가(장후 발표 = PTS, 장중 = 1분봉) · jp_pts_watch.py", "items": items}
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    got = sum(1 for v in items.values() if v.get("date") == date and v.get("px10") is not None)
    print(f"저장 · 오늘 10분 후 가격 확보 {got}곳 (이번에 새로 {n_new}곳)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
