"""일본 스크리너 실적표(분기·연간)를 실적 발표 직후 그 종목만 바로 갱신한다.

왜: 소비재 번들(screener-data.js)은 생성 스크립트가 없는 고정 번들이고, 주요 기업(major-data.js)·추가 소비재
(consumer-extra.js)는 토요일에만 다시 만든다. 그래서 실적 리포트(jp-report)는 새 분기가 나왔는데 스크리너 표는
직전 분기에 멈춰 있었다(2026-10-07 사용자: 쿠스리노아오키 6~8월이 리포트엔 있고 스크리너엔 없음).

    python update_jp_bundle_fin.py               # 최근 3일 안 실적 리포트가 나온 종목
    python update_jp_bundle_fin.py --days 10
    python update_jp_bundle_fin.py --codes 3549,2726

종목마다 카부탄 재무 페이지 → fetch_jp_major.build_fin(주간 수집과 같은 규칙) → 그 종목이 든 번들 파일의 q·a·f 만 교체.
결산월(fm)도 같이 넣는다 — 화면이 회계연도 라벨(26Q4)을 실제 달(26.03~05)로 바꿔 보여 줄 때 쓴다.
새 분기 수가 기존보다 적거나 최신 분기가 더 옛날이면(카부탄 오류) 건드리지 않는다.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import fetch_jp_major as M

BASE = os.path.dirname(os.path.abspath(__file__))
JP = os.path.join(BASE, "docs", "data", "jp")
KST = timezone(timedelta(hours=9))
FILES = [  # (파일, 번들 변수, 형식) — one: 한 줄 배열 / lines: 한 줄에 한 종목
    ("screener-data.js", "BUNDLE", "one"),
    ("consumer-extra.js", "BUNDLE_EXT", "lines"),
    ("major-data.js", "BUNDLE_MAJ", "lines"),
]
js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def recent_codes(days):
    idx = json.load(open(os.path.join(JP, "reports", "index.json"), encoding="utf-8"))
    since = (datetime.now(KST).date() - timedelta(days=days)).isoformat()
    return sorted({r["c"] for r in idx.get("reports", []) if (r.get("d") or "") >= since})


def qkey(lb):
    """'26Q4' → (26, 4) — 최신 비교용"""
    try:
        return int(lb[:2]), int(lb[3])
    except Exception:
        return (0, 0)


def better(old, new):
    oq, nq = (old or {}).get("lb") or [], (new or {}).get("lb") or []
    if not nq:
        return False
    if oq and (qkey(nq[0]) < qkey(oq[0]) or len(nq) < min(len(oq), 8)):
        return False
    return True


def load(fn, var, kind):
    path = os.path.join(JP, fn)
    lines = open(path, encoding="utf-8").read().split("\n")
    ents = {}
    if kind == "one":
        i = next(k for k, l in enumerate(lines) if l.startswith(f"const {var} = ["))
        arr = json.loads(lines[i][len(f"const {var} = "):].rstrip().rstrip(";"))
        for k, b in enumerate(arr):
            ents[b["c"]] = (i, k)
        return path, lines, {"line": i, "arr": arr}, ents
    i = next(k for k, l in enumerate(lines) if l.startswith(f"const {var} = ["))
    j = next(k for k in range(i + 1, len(lines)) if lines[k].startswith("];"))
    for k in range(i + 1, j):
        t = lines[k].rstrip().rstrip(",")
        if t:
            ents[json.loads(t)["c"]] = (k, None)
    return path, lines, None, ents


def main():
    a = sys.argv[1:]
    if "--codes" in a:
        codes = a[a.index("--codes") + 1].split(",")
    else:
        codes = recent_codes(int(a[a.index("--days") + 1]) if "--days" in a else 3)
    print(f"대상 {len(codes)}종목: {','.join(codes)}")
    if not codes:
        return 0
    books = [(fn,) + load(fn, var, kind) for fn, var, kind in FILES]
    changed = set()
    n_ok = 0
    for code in codes:
        hit = next(((fn, path, lines, one, ents) for fn, path, lines, one, ents in books if code in ents), None)
        if not hit:
            print(f"  {code}: 스크리너 번들에 없음 — 건너뜀")
            continue
        fn, path, lines, one, ents = hit
        li, k = ents[code]
        b = one["arr"][k] if one else json.loads(lines[li].rstrip().rstrip(","))
        fin, _ = M.kabu_fin(code)
        if not fin:
            print(f"  {code}: 카부탄 재무를 못 읽음 — 그대로 둠")
            continue
        q, an, f, _ttm = M.build_fin(fin)
        if not better(b.get("q"), q):
            print(f"  {code}: 새 분기 자료가 기존보다 나을 게 없음({(b.get('q') or {}).get('lb', [None])[0]} → {(q or {}).get('lb', [None])[0]}) — 그대로 둠")
            continue
        before = (b.get("q") or {}).get("lb", [None])[0]
        b["q"] = q
        if an:
            b["a"] = an
        if f:
            b["f"] = f
        if fin.get("fy_month"):
            b["fm"] = fin["fy_month"]
        if not one:
            lines[li] = js(b) + ("," if lines[li].rstrip().endswith(",") else "")
        changed.add(fn)
        n_ok += 1
        print(f"  {code} [{fn}] 분기 {before} → {q['lb'][0]} · 결산월 {fin.get('fy_month')}")
    for fn, path, lines, one, ents in books:
        if fn not in changed:
            continue
        if one:
            lines[one["line"]] = "const BUNDLE = " + js(one["arr"]) + ";"
        with open(path, "w", encoding="utf-8", newline="\n") as fo:
            fo.write("\n".join(lines))
    print(f"완료: {n_ok}종목 갱신 · 바뀐 파일 {sorted(changed) or '없음'}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
