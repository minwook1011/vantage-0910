"""일본 소비재 월차(月次) 지표를 스크리너(docs/data/jp/screener-data.js 의 KPI)에 반영한다.

입력: data_sources/_cache/jp_monthly/*.json — 예약 작업(vantage-jp-monthly)이 월차 원장 도구(jp_monthly)로 받은 응답을
      그대로 저장한 파일({"batch":[{code, rows, columns, latest...}, ...]}). 파일 이름 순서대로 읽고, 같은 회사·같은 달은 뒤 파일이 이긴다.
처리: 회사마다 열 이름(일본어)을 우리 계열 이름으로 바꿔 ts(달별 표)에 덮어쓰고, k(카드용 최근 3개월)를 다시 만든다.
      - 既存店 売上高 전년比 → 기존점 매출 / 既存店 客数 → 기존점 객수 / 既存店 客単価 → 기존점 객단가
      - 全店·直営店 売上高 전년比 → 전점 매출
      RAW(소비재 명단)에 있는 회사만. KPI 에 없던 회사도 월차가 있으면 새로 넣는다. x(메모)·s 는 건드리지 않는다.
출력: 바뀐 게 있을 때만 screener-data.js 를 다시 쓴다. 마지막에 회사별 최신 월을 요약 출력.

사용: python update_jp_kpi.py [--cache C:/dev/vantage-0910/data_sources/_cache/jp_monthly]
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SCREENER = os.path.join(ROOT, "docs", "data", "jp", "screener-data.js")
CACHE = os.path.join(ROOT, "data_sources", "_cache", "jp_monthly")
KEEP_MONTHS = 25
DEC = json.JSONDecoder()


def block(s, name):
    i = s.index("const " + name)
    j = s.index("=", i) + 1
    rest = s[j:]
    k = len(rest) - len(rest.lstrip())
    v, end = DEC.raw_decode(rest.lstrip())
    return v, j + k, j + k + end


def series_of(col):
    """월차 열 이름 → 우리 계열 이름 (전년比 열만)"""
    if "전년比" not in col:
        return None
    if "店舗数" in col or "店数" in col:
        return None
    exist = "既存店" in col
    if "客単価" in col:
        return "기존점 객단가" if exist else None
    if "客数" in col:
        return "기존점 객수" if exist else None
    if "売上" in col:
        if exist:
            return "기존점 매출"
        if "全店" in col or "直営店" in col or "全社" in col:
            return "전점 매출"
    return None


def load_cache():
    by = {}
    for f in sorted(glob.glob(os.path.join(CACHE, "*.json"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception as e:
            print("못 읽음:", os.path.basename(f), e)
            continue
        for c in d.get("batch") or []:
            if c.get("code") and c.get("rows") and c.get("columns"):
                by.setdefault(c["code"], []).append(c)
    return by


def merge_company(entry, recs):
    ts = entry.setdefault("ts", {"m": [], "s": {}})
    ts.setdefault("m", [])
    ts.setdefault("s", {})
    vals = {}  # 계열 → {월: 값}
    for rec in recs:  # 뒤 파일이 이김
        cols = rec["columns"]
        picked = {}
        for ci, col in enumerate(cols):
            nm = series_of(col)
            if nm and nm not in picked:   # 같은 계열 열이 여럿이면 앞 열(대개 합계)
                picked[nm] = ci
        if "기존점 매출" not in picked and "전점 매출" not in picked:
            # 백화점·철도·여행 등 점포 매출 형식이 아닌 회사: 회사 전체 매출·거래액 전년比 열을 '전점 매출'로
            amt = ("売上", "販売額", "取扱額", "取扱高", "興行収入", "運賃収入")
            tot = ("全社", "合計", "計", "全店", "企業計", "連結", "単体")
            cand = [ci for ci, col in enumerate(cols) if "전년比" in col and any(a in col for a in amt) and "前々年" not in col]
            best = [ci for ci in cand if any(t in cols[ci].split(" ")[0] for t in tot)]
            if best or cand:
                picked["전점 매출"] = (best or cand)[0]
        for row in rec["rows"]:
            m = row[0]
            for nm, ci in picked.items():
                v = row[ci] if ci < len(row) else None
                if isinstance(v, (int, float)):
                    vals.setdefault(nm, {})[m] = round(float(v), 1)
    if not vals:
        return False
    before = json.dumps(ts, ensure_ascii=False, sort_keys=True)
    months = sorted(set(ts["m"]) | {m for d in vals.values() for m in d})[-KEEP_MONTHS:]
    old = {nm: dict(zip(ts["m"], arr)) for nm, arr in ts["s"].items()}
    for nm, d in vals.items():
        old.setdefault(nm, {}).update(d)
    ts["m"] = months
    ts["s"] = {nm: [old[nm].get(m) for m in months] for nm in old}
    # 카드용 k: 최근 3개월(최신 먼저)
    kname = {"기존점 매출": "기존점매출", "기존점 객수": "객수", "기존점 객단가": "객단가"}
    k_old = {k[0]: k for k in entry.get("k") or []}
    for nm, kn in kname.items():
        arr = ts["s"].get(nm)
        if not arr:
            continue
        pts = [(m, v) for m, v in zip(months, arr) if v is not None]
        if not pts:
            continue
        k_old[kn] = [kn, "%", "m", pts[-1][0], [v for _, v in pts[-3:]][::-1]]
    if "기존점매출" not in k_old and ts["s"].get("전점 매출"):
        pts = [(m, v) for m, v in zip(months, ts["s"]["전점 매출"]) if v is not None]
        if pts:
            k_old["전점매출"] = ["전점매출", "%", "m", pts[-1][0], [v for _, v in pts[-3:]][::-1]]
    order = ["기존점매출", "객수", "객단가", "전점매출"]
    newest = max((k_old[n][3] for n in order if n in k_old), default="")
    # 예전 이식 때 들어온 별도 카드(예: 'UNIQLO국내 기존점')는 표준 카드보다 오래됐으면 뺀다
    entry["k"] = [k_old[n] for n in order if n in k_old] + [v for n, v in k_old.items() if n not in order and str(v[3]) >= newest]
    return True


def main():
    global CACHE
    sys.stdout.reconfigure(encoding="utf-8")
    if "--cache" in sys.argv:   # pc_job(별도 작업 폴더)에서 돌릴 때 원래 폴더의 캐시를 가리킨다
        CACHE = sys.argv[sys.argv.index("--cache") + 1]
    s = open(SCREENER, encoding="utf-8").read()
    raw = {r[0] for r in block(s, "RAW")[0]}
    kpi, a, b = block(s, "KPI")
    before = json.dumps(kpi, ensure_ascii=False, sort_keys=True)
    by = load_cache()
    added, latest = [], {}
    for code, recs in by.items():
        if code not in raw:
            continue
        if code not in kpi:
            kpi[code] = {}
            added.append(code)
        if merge_company(kpi[code], recs):
            m = kpi[code].get("ts", {}).get("m") or []
            latest[code] = m[-1] if m else None
        elif code in added:
            kpi.pop(code)
            added.remove(code)
    if json.dumps(kpi, ensure_ascii=False, sort_keys=True) == before:
        print("변경 없음")
        return 0
    s = s[:a] + json.dumps(kpi, ensure_ascii=False, separators=(",", ":")) + s[b:]
    open(SCREENER, "w", encoding="utf-8", newline="").write(s)
    cnt = {}
    for m in latest.values():
        cnt[m] = cnt.get(m, 0) + 1
    print(f"월차 반영: 회사 {len(latest)}곳 (새로 추가 {len(added)}곳) · 최신 월 분포 {dict(sorted(cnt.items()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
