"""국제 유가 3종(두바이 현물·브렌트 선물·WTI 선물, 달러/배럴) — 한국석유공사 오피넷 국제유가(glopcoilSelect.do).

오피넷은 화~토 아침에 전날(현지) 가격을 올린다. 최근 1년 일별 값을 받아 docs/data/oil3.json 에 쓴다(바뀌었을 때만).
매크로 화면의 원유 카드가 세 유종을 나란히 보여 준다(2026-10-07 사용자 요청).
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs", "data", "oil3.json")
KST = timezone(timedelta(hours=9))
NAMES = [("dubai", "두바이(현물)"), ("brent", "브렌트(선물)"), ("wti", "WTI(선물)")]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    now = datetime.now(KST)
    form = [("TERM", "D"), ("OILSRTCD1", "001"), ("OILSRTCD2", "002"), ("OILSRTCD3", "003"),
            ("STDDATE", (now - timedelta(days=370)).strftime("%Y%m%d")), ("ENDDATE", now.strftime("%Y%m%d")), ("SEL_DIV", "div_dar"),
            ("OILSRTCD", "001"), ("OILSRTCD", "002"), ("OILSRTCD", "003")]
    req = urllib.request.Request("https://www.opinet.co.kr/glopcoilSelect.do", data=urllib.parse.urlencode(form).encode(),
                                 headers={"User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded"})
    t = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "replace")
    tb = re.search(r'<tbody id="tbody2"[^>]*>(.*?)</tbody>', t, re.S)   # tbody2 = 달러/배럴 (tbody1 은 원/리터)
    if not tb:
        raise SystemExit("오피넷 표를 찾지 못함")
    ser = {k: [] for k, _ in NAMES}
    for r in re.findall(r"<tr>(.*?)</tr>", tb.group(1), re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
        m = re.match(r"(\d{2})년(\d{2})월(\d{2})일", cells[0] if cells else "")
        if not m or len(cells) < 4:
            continue
        d = f"20{m.group(1)}-{m.group(2)}-{m.group(3)}"
        for (k, _), c in zip(NAMES, cells[1:4]):
            try:
                v = float(c.replace(",", ""))
            except ValueError:
                continue
            if v > 0:   # 0 = 그날 값 없음
                ser[k].append([d, round(v, 2)])
    if min(len(v) for v in ser.values()) < 20:
        raise SystemExit(f"값이 너무 적음: { {k: len(v) for k, v in ser.items()} }")
    doc = {"source": "한국석유공사 오피넷 국제유가", "source_url": "https://www.opinet.co.kr/glopcoilSelect.do", "unit": "달러/배럴",
           "names": dict(NAMES), "series": ser}
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
    if old.get("series") == ser:
        print("변경 없음 — 최신", {k: v[-1] for k, v in ser.items()})
        return 0
    doc["updated_kst"] = now.strftime("%Y-%m-%d %H:%M")
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("저장 — 최신", {k: v[-1] for k, v in ser.items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
