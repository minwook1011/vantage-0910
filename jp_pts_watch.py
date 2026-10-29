"""일본 실적 발표 후 주가 반응 — 카부탄 16시·19시 두 번 확인(2026-10-30 사용자: '발표 10분 후 가격' 대신
카부탄에서 16:00 주가를 확인해 반영하고 19:00 쯤 다시 확인해 덮어쓴다. 장중 발표 종목도 같은 규칙).

- 대상: 그날 도쿄증권거래소 TDnet 공식 공시 목록(release.tdnet.info)에 決算短信을 낸 종목(첫 공시 시각 t)
- 가격: 카부탄 종목 화면(kabutan.jp/stock/?code=) 의 현재가·전일비·PTS 체결가/시각
- 장 마감(15:30) 뒤 발표 → 기준 = 그날 종가, 가격 = 발표 뒤 체결된 장외거래(PTS) 가격(없으면 그 회차는 비워 둔다)
- 장 마감 전 발표(장중·개장 전) → 기준 = 전날 종가, 16시 = 그날 종가, 19시 = 장 마감 뒤 PTS 체결이 있으면 PTS, 없으면 종가
- 회차(slot)마다 s16·s19 에 남기고, 화면 값(px·pct·at·src)은 마지막 회차가 덮어쓴다. 확인 시각보다 늦게 낸 발표는 그 회차를 건너뛴다.
결과: docs/data/jp/earnings_pts.json {"updated", "items": {code: {...}}} — jp-screener.js 가 '카부탄 16시/19시' 칩으로 보여 준다.
(예전 값 px10·pct10·at10 은 2026-10-29 까지의 '발표 10분 후' 기록 — 화면은 그대로 읽는다)

사용: python jp_pts_watch.py              (지금 시각으로 회차 결정: 17:30 전 = 16시, 그 뒤 = 19시 — 예약 작업이 16:00·19:00 에 부른다)
      python jp_pts_watch.py --slot 19    (회차 지정)
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
    """(현재가 또는 그날 종가, 그 날짜 'YYYY-MM-DD', 전날 종가), (PTS 가격, PTS 'YYYY-MM-DD HH:MM')"""
    h = get(f"https://kabutan.jp/stock/?code={code}")
    if not h:
        return None, None
    num = lambda s: float(s.replace(",", "").replace("円", "")) if s and re.search(r"\d", s) else None
    px = re.search(r'<span class="kabuka">([\d,\.]+)円</span>', h)
    tm = re.search(r'<div class="si_i1_1_rbox">.*?<time datetime="(\d{4}-\d{2}-\d{2})T', h, re.S)
    chg = re.search(r'<dt>前日比</dt>\s*<dd><span[^>]*>([+\-−]?[\d,\.]+)</span>', h)
    close = None
    if px and tm:
        c = num(px.group(1))
        d = num(chg.group(1).replace("−", "-")) if chg else None
        close = (c, tm.group(1), round(c - d, 2) if (c is not None and d is not None) else None)
    pts = re.search(r'<div class="kabuka1">PTS</div>\s*<div class="kabuka2">([\d,\.]+)円</div>\s*<div class="kabuka3">(\d{2}:\d{2})\D+(\d{2})/(\d{2})</div>', h)
    p = None
    if pts:
        y = datetime.now(KST).year
        p = (num(pts.group(1)), f"{y}-{pts.group(3)}-{pts.group(4)} {pts.group(2)}")
    return close, p


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    now = datetime.now(KST)
    date, hm = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
    slot = sys.argv[sys.argv.index("--slot") + 1] if "--slot" in sys.argv else ("16" if hm < "17:30" else "19")
    try:
        doc = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        doc = {"items": {}}
    before = json.dumps(doc["items"], ensure_ascii=False, sort_keys=True)
    cut = (now - timedelta(days=10)).strftime("%Y-%m-%d")
    items = {c: v for c, v in doc["items"].items() if v.get("date", "") >= cut}
    uni = set()
    for f, key in ((DATES, "dates"), (os.path.join(ROOT, "docs", "data", "jp", "earnings_results.json"), "results")):
        try:
            uni |= set(json.load(open(f, encoding="utf-8")).get(key, {}).keys())
        except Exception:
            pass
    ann = tdnet_times(date)
    todo = {c: t for c, t in ann.items() if (not uni or c in uni)}
    print(f"{date} {hm} · {slot}시 회차 · TDnet 결산단신 {len(ann)}곳 · 대상 {len(todo)}곳")
    n_new = n_skip = 0
    for code, t in sorted(todo.items(), key=lambda kv: kv[1]):
        rec = items.get(code) if items.get(code, {}).get("date") == date else None
        rec = rec or {"date": date, "t": t}
        rec["t"] = t
        items[code] = rec
        if t > hm:  # 확인 시각보다 늦게 낸 발표 — 다음 회차에서
            continue
        close, pts = kabutan(code)
        time.sleep(0.8)
        if not close or close[1] != date or not close[0]:
            n_skip += 1
            continue
        after = t >= "15:30"
        pts_ok = bool(pts and pts[0] and pts[1].startswith(date) and pts[1][11:] >= max(t, "15:30"))
        if after:
            base, base_src = close[0], "그날 종가"
            v = (pts[0], pts[1][11:], "PTS") if pts_ok else None
        else:
            base, base_src = close[2], "전날 종가"
            v = (pts[0], pts[1][11:], "PTS") if (slot == "19" and pts_ok) else (close[0], "15:30", "종가")
        if not base or not v:
            n_skip += 1
            continue
        r = {"px": v[0], "at": v[1], "src": v[2], "pct": round((v[0] / base - 1) * 100, 1), "checked": hm}
        rec[f"s{slot}"] = r
        rec.update(base=base, base_src=base_src, slot=slot, **{k: r[k] for k in ("px", "at", "src", "pct")})
        n_new += 1
    if json.dumps(items, ensure_ascii=False, sort_keys=True) == before:
        print("변경 없음")
        return 0
    doc = {"updated": now.isoformat(timespec="minutes"),
           "note": "실적 발표 후 주가 — 카부탄 16시·19시 확인(장후 발표 = PTS, 장 마감 전 발표 = 종가, 19시엔 PTS 있으면 PTS) · jp_pts_watch.py",
           "items": items}
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    got = sum(1 for v in items.values() if v.get("date") == date and v.get(f"s{slot}"))
    print(f"저장 · {slot}시 카부탄 가격 확보 {got}곳 (이번 {n_new}곳, 값 없음 {n_skip}곳)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
