"""브롱코빌리(3091) 기존점 매출 전년比 — 월차 대신 분기 결산 참고자료에서(2026-10-29 사용자: 월차를 안 내니 분기 자료로 넣자)

브롱코빌리는 月次를 내지 않는다(회사 IR·TDnet 모두 없음). 분기마다 TDnet 에 내는 「決算参考資料」 2쪽
「（２）売上高の状況」 표의 '既存店売上高前年比' 줄(1Q~4Q)만 옮긴다. 값은 분기 평균이라 그 분기 마지막 달(3·6·9·12월)에 둔다.

입력: 決算参考資料 PDF 주소(여러 개). 예약 작업 vantage-jp-monthly 가 jp_tdnet(code=3091, keyword=参考資料)로 찾은 최신 것을 넘긴다.
저장: data_sources/jp_monthly_quarterly/3091.json (누적, 커밋) — 월차 원장 응답과 같은 모양({"batch":[...]})
      --cache <폴더> 를 주면 그 폴더에 zq_3091.json 으로도 복사 → update_jp_kpi.py · build_jp_monthly_hub.py 가 같이 읽는다.

사용: python fetch_bronco_quarterly.py [--cache <폴더>] <pdf 주소> ...
"""
import argparse
import json
import os
import re
import urllib.request

import pymupdf

ROOT = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(ROOT, "data_sources", "jp_monthly_quarterly", "3091.json")
COLS = ["既存店 売上高 전년比", "既存店 客数 전년比", "既存店 客単価 전년比"]
QCOL = "既存店 売上高 전년比(분기 평균)"
QM = {"1Q": "03", "2Q": "06", "3Q": "09", "4Q": "12"}
Z2H = str.maketrans("０１２３４５６７８９ＱＱ", "0123456789QQ")


def parse(pdf_bytes):
    """→ (결산기 연도, {"YYYY-MM": {열: 값}}, {"1Q": 값}, 발표일)
    「①既存店前年比」 표: 月別(1~12월) 売上高·客数·客単価 + 四半期別. 2026년 3Q 자료처럼 月別이 없고
    「既存店売上高前年比」 분기 줄만 있는 자료도 있다 → 그때는 분기 값만."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    first = doc[0].get_text().translate(Z2H)
    fy = re.search(r"(\d{4})年12月期\s*(?:第\s*\dQ?四半期\s*)?決算参考資料", re.sub(r"\s+", "", first)) or re.search(r"(\d{4})年12月期", first)
    pub = re.search(r"(\d{4})年(\d{1,2})月(\d{1,2})日", first)
    if not fy:
        return None
    year = int(fy.group(1))
    lab = {"売上高": COLS[0], "客数": COLS[1], "客単価": COLS[2]}
    months, quarters = {}, {}
    for pg in doc:
        ws = [(w[0], w[1], w[2], w[4].translate(Z2H).replace("　", "").replace(" ", "")) for w in pg.get_text("words")]
        top = [w for w in ws if w[3].startswith("①既存店前年比") or w[3].startswith("既存店売上高前年比")]
        if not top:
            continue
        y0 = top[0][1]
        end = min([w[1] for w in ws if w[3].startswith("②") and w[1] > y0] or [y0 + 140])
        def pct_at(y, xs):
            got = {}
            for w in ws:
                m = re.fullmatch(r"(\d{2,3}\.\d)%", w[3])
                if not m or abs(w[1] - y) > 4:
                    continue
                x = (w[0] + w[2]) / 2
                k = min(xs, key=lambda c: abs(c[0] - x))
                if abs(k[0] - x) < 25:
                    got[k[1]] = float(m.group(1))
            return got
        if top[0][3].startswith("既存店売上高前年比"):   # 분기 줄만 있는 자료
            heads = [((w[0] + w[2]) / 2, w[3]) for w in ws if w[3] in QM and y0 - 25 < w[1] < y0]
            quarters.update(pct_at(y0, heads))
            break
        blocks = sorted([w for w in ws if w[3] in ("月別", "四半期別") and y0 < w[1] < end], key=lambda w: w[1])
        for i, bl in enumerate(blocks):
            by, bend = bl[1], (blocks[i + 1][1] if i + 1 < len(blocks) else end)
            if bl[3] == "月別":
                heads = [((w[0] + w[2]) / 2, f"{year}-{int(w[3][:-1]):02d}") for w in ws if re.fullmatch(r"\d{1,2}月", w[3]) and abs(w[1] - by) < 4]
            else:
                heads = [((w[0] + w[2]) / 2, w[3]) for w in ws if w[3] in QM and abs(w[1] - by) < 4]
            for w in ws:
                if w[3] in lab and by < w[1] < bend and w[0] < 60:
                    for k, v in pct_at(w[1], heads).items():
                        if bl[3] == "月別":
                            months.setdefault(k, {})[lab[w[3]]] = v
                        elif lab[w[3]] == COLS[0]:
                            quarters[k] = v
        break
    p = f"{pub.group(1)}-{int(pub.group(2)):02d}-{int(pub.group(3)):02d}" if pub else ""
    return (year, months, quarters, p) if months or quarters else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    ap.add_argument("urls", nargs="*")
    a = ap.parse_args()
    try:
        store = json.load(open(STORE, encoding="utf-8"))
    except (OSError, ValueError):
        store = {}
    mon, qtr, src = store.get("monthly", {}), store.get("quarterly", {}), store.get("src", {})
    for u in a.urls:
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
        r = parse(urllib.request.urlopen(req, timeout=60).read())
        if not r:
            print(f"  [skip] 표를 못 찾음: {u}")
            continue
        fy, ms, qs, pub = r
        for m, v in ms.items():
            mon.setdefault(m, {}).update(v)
            src[m] = {"pdf": u, "published": pub}
        for q, v in qs.items():
            qtr[f"{fy}-{QM[q]}"] = v
            src.setdefault(f"{fy}-{QM[q]}", {"pdf": u, "published": pub})
        print(f"  {fy}: 월 {len(ms)}개 · 분기 " + " ".join(f"{q} {v}" for q, v in sorted(qs.items())))
    # 월별이 없는 분기만 분기 평균 값으로(같은 달에 월 값이 있으면 월 값이 이긴다)
    qonly = {m: v for m, v in qtr.items() if not any(f"{m[:4]}-{int(m[5:]) - k:02d}" in mon for k in range(3))}
    if not mon and not qonly:
        print("값 없음")
        return
    batch = []
    base = {"code": "3091", "name": "ブロンコビリー", "name_en": "BRONCO BILLY Co.,LTD.", "sector": "小売業", "class": "전년比만"}
    if mon:
        ms = sorted(mon)
        batch.append(dict(base, columns=["month"] + COLS, rows=[[m] + [mon[m].get(c) for c in COLS] for m in ms[::-1]],
                          units={c: "전년 같은 달=100" for c in COLS}))
    if qonly:
        qs = sorted(qonly)
        batch.append(dict(base, columns=["month", QCOL], rows=[[m, qonly[m]] for m in qs[::-1]],
                          units={QCOL: "전년 같은 분기=100(분기 평균 · 그 분기 마지막 달에 표시)"}))
    last = max(list(mon) + list(qonly))
    lv = {QCOL: qonly[last]} if last in qonly else {c: mon[last].get(c) for c in COLS}
    batch[-1 if last in qonly else 0]["latest"] = dict({"month": last, "published": src[last]["published"], "preliminary": False,
                                                        "source": "분기 결산 참고자료", "pdf": src[last]["pdf"]}, **lv)
    for b in batch:   # 다른 레코드에도 latest(공시일·원문)가 있어야 허브가 읽는다
        b.setdefault("latest", batch[-1 if last in qonly else 0]["latest"])
    store = {"monthly": mon, "quarterly": qtr, "src": src, "batch": batch}
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
        json.dump({"batch": batch}, open(os.path.join(a.cache, "zq_3091.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"브롱코빌리 기존점: 월 {len(mon)}개({min(mon) if mon else '-'}~{max(mon) if mon else '-'}) · 분기만 {sorted(qonly)} · 최신 {last}")

if __name__ == "__main__":
    main()
