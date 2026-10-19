"""베이커런트(6532) 워크벤치 데이터 → docs/data/baycurrent.json

컨설턴트 수가 매출로 바로 이어지는 회사라, 인력 숫자를 주가 위에 겹쳐 본다.

자동(매일): 주가(야후 6532.T 일간).
자동(실적 발표 뒤): 회사 공시 인원 — 일본 실적 수집기가 만든 docs/data/jp/reports/6532-*.json 의 결산 보충자료(deck) PDF를
                   TDnet·JPX 아카이브에서 받아 컨설턴트 수·총사원 수를 읽는다. 한 번 읽은 문서는 data_sources/baycurrent_auto.json 에 남겨 다시 받지 않는다.
수동(월 1회): 일본연금기구 피보험자 수(법인 3곳), doda 구인 건수 → data_sources/baycurrent_manual.json.
              연금기구 검색은 결과 전재·2차 이용 금지라 자동 수집하지 않는다.
빈 값은 0으로 채우지 않는다. 한 소스가 실패하면 직전 값을 그대로 둔다.

사용: python fetch_baycurrent.py [--only price,deck]
"""
import argparse
import calendar
import datetime as dt
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs" / "data" / "baycurrent.json"
MANUAL = ROOT / "data_sources" / "baycurrent_manual.json"
AUTO = ROOT / "data_sources" / "baycurrent_auto.json"
REPORTS = ROOT / "docs" / "data" / "jp" / "reports"
DATES = ROOT / "docs" / "data" / "jp" / "earnings_dates.json"
CODE = "6532"
UA = {"User-Agent": "Mozilla/5.0 (vantage baycurrent collector)"}
KST = dt.timezone(dt.timedelta(hours=9))


def get(url, tries=3, timeout=60):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 + i * 3)


def series(id, group, label, unit, points, source, url="", cadence="", note="", **extra):
    s = {"id": id, "group": group, "label": label, "unit": unit, "cadence": cadence, "source": source, "source_url": url, "note": note,
         "points": sorted(points, key=lambda p: p["date"])}
    s.update(extra)
    return s


def fetch_price():
    j = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{CODE}.T?range=10y&interval=1d"))
    r = j["chart"]["result"][0]
    ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
    pts = [{"date": dt.datetime.fromtimestamp(t, KST).strftime("%Y-%m-%d"), "value": round(c, 1)} for t, c in zip(ts, cl) if c is not None]
    return {"label": "베이커런트 주가", "unit": "엔", "source": f"Yahoo Finance ({CODE}.T)", "points": pts}


# ── 회사 공시 인원 (결산 보충자료) ──
def quarter_end(fy, period):
    """fy '2027.02' + period '2Q' → '2026-08-31' (2월 결산: 1Q=3~5월)."""
    y, fm, q = int(fy[:4]), int(fy[5:7]), int(period[0])
    idx = y * 12 + (fm - 1) - 3 * (4 - q)  # 결산월에서 남은 분기만큼 거슬러 올라감
    end_y, end_m = idx // 12, idx % 12 + 1
    return f"{end_y:04d}-{end_m:02d}-{calendar.monthrange(end_y, end_m)[1]:02d}"


def parse_deck(text):
    t = re.sub(r"\s+", " ", text)
    cons = None
    m = re.search(r"(?<!約)(\d{1,2},\d{3})名 \+[\d.]+%\(YoY\)", t)
    if m:
        cons = m.group(1)
    if not cons:
        for p in (r"当[１２３４1-4]Q末\s*(\d{1,2},\d{3})名", r"当期末\s*(\d{1,2},\d{3})名", r"コンサルタント数\s*[：:]\s*(\d{1,2},\d{3})名"):
            m = re.search(p, t)
            if m:
                cons = m.group(1)
                break
    m = re.search(r"総社員数\s*[：:]?\s*(\d{1,2},\d{3})名", t)
    tot = m.group(1) if m else None
    num = lambda s: int(s.replace(",", "")) if s else None
    return num(cons), num(tot)


def deck_urls(doc):
    out = []
    m = re.search(r"(\d{18})\.pdf", doc.get("url", ""))
    if m:
        i = m.group(1)
        out += [f"https://www.release.tdnet.info/inbs/{i}.pdf", f"https://www2.jpx.co.jp/disc/{CODE}0/{i}.pdf"]
    if doc.get("url"):
        out.append(doc["url"])
    return out


def fetch_decks(auto):
    from pypdf import PdfReader  # noqa: PLC0415  (GitHub 실행기에서만 설치)
    seen = {a["rid"] for a in auto}
    added = []
    for f in sorted(REPORTS.glob(f"{CODE}-*.json")):
        rep = json.loads(f.read_text(encoding="utf-8"))
        rid = rep.get("rid")
        if not rid or rid in seen:
            continue
        deck = next((d for d in rep.get("docs", []) if d.get("kind") == "deck"), None)
        if not deck:
            continue
        cons = tot = None
        err = ""
        for u in deck_urls(deck):
            try:
                pdf = get(u, tries=2)
                if pdf[:4] != b"%PDF":
                    continue
                text = " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages)
                cons, tot = parse_deck(text)
                if cons:
                    break
            except Exception as e:  # noqa: BLE001
                err = str(e)
        if not cons:
            print(f"[skip] {rid}: 보충자료에서 컨설턴트 수를 못 읽음 {err}", file=sys.stderr)
            continue
        rec = {"rid": rid, "date": quarter_end(rep["fy"], rep["period"]), "consultants": cons, "total": tot,
               "announced": rep.get("date"), "src": deck.get("title", "결산 보충자료"), "auto": True}
        auto.append(rec)
        added.append(rec)
        print(f"[deck] {rid} → 컨설턴트 {cons:,} · 총사원 {tot or '—'}")
    return added


def merge_headcount(manual_rows, auto_rows):
    by = {}
    for r in auto_rows:
        by[r["date"]] = dict(r)
    for r in manual_rows:  # 수동이 우선
        by[r["date"]] = {**by.get(r["date"], {}), **r}
    rows = sorted(by.values(), key=lambda r: r["date"])
    # 자동 판독 값이 직전 분기와 너무 다르면(±40%) 버린다
    clean, prev = [], None
    for r in rows:
        c = r.get("consultants")
        if r.get("auto") and prev and c and not (0.6 * prev <= c <= 1.4 * prev):
            print(f"[warn] {r['date']} 자동 판독 값 {c} 이 직전 {prev} 와 크게 달라 제외", file=sys.stderr)
            continue
        if r.get("total") and c and r["total"] < c:
            r = {k: v for k, v in r.items() if k != "total"}
        clean.append(r)
        prev = c or prev
    return clean


def next_event():
    try:
        d = json.loads(DATES.read_text(encoding="utf-8"))["dates"].get(CODE)
        if d:
            return {"date": d.get("date"), "est": bool(d.get("est"))}
    except Exception:  # noqa: BLE001
        pass
    return {}


def build_series(m, rows):
    out = []
    ent = {e["id"]: e for e in m["entities"]}
    nk = m.get("nenkin", [])
    tot_pts = [{"date": r["date"], "value": r["hold"] + r["consult"] + r["tech"], "updated": r.get("updated")}
               for r in nk if all(isinstance(r.get(k), (int, float)) for k in ("hold", "consult", "tech"))]
    url = "https://www.nenkin.go.jp/do/search_section/"
    out.append(series("nk_total", "pension", "연금 피보험자 · 3개 법인 합계", "명", tot_pts, "일본연금기구", url, "월간 · 매달 20일쯤 기준",
                      "지주사+컨설팅+테크놀로지. 그룹 국내 직원 근사"))
    for k, lab in (("consult", "컨설팅 자회사"), ("tech", "테크놀로지 자회사"), ("hold", "지주사")):
        pts = [{"date": r["date"], "value": r[k]} for r in nk if isinstance(r.get(k), (int, float))]
        out.append(series(f"nk_{k}", "pension", f"연금 피보험자 · {lab}", "명", pts, "일본연금기구", url, "월간 · 매달 20일쯤 기준",
                          f"{ent[k]['name']} · 법인번호 {ent[k]['corp_no']}"))
    out.append(series("doda_jobs", "jobs", "doda 구인 공고 건수", "건", [{"date": r["date"], "value": r["count"]} for r in m.get("doda", [])],
                      "doda", "https://doda.jp/", "월간 기록", "키워드 「ベイカレント」 · 채용 인원이 아니라 공고 수"))
    q = lambda key: [{"date": r["date"], "value": r[key], "announced": r.get("announced"), "basis": r.get("basis")} for r in rows if isinstance(r.get(key), (int, float))]
    out.append(series("co_consultants", "company", "회사 공시 · 컨설턴트 수", "명", q("consultants"), "결산 보충자료", "", "분기 · 분기 말 기준",
                      "1Q·2Q는 연수 중인 신입 제외, 3Q·4Q는 포함", quarterly=True))
    out.append(series("co_total", "company", "회사 공시 · 총사원 수", "명", q("total"), "결산 보충자료", "", "분기 · 분기 말 기준", "25년 2월 말부터 공시", quarterly=True))
    non = [{"date": r["date"], "value": r["total"] - r["consultants"]} for r in rows if isinstance(r.get("total"), (int, float)) and isinstance(r.get("consultants"), (int, float))]
    out.append(series("co_non", "company", "회사 공시 · 비컨설턴트 수", "명", non, "총사원 − 컨설턴트", "", "분기", "본사·연수 중 신입·휴직자", quarterly=True))
    yoy = []
    byd = {r["date"]: r for r in rows}
    for r in rows:
        y, mo, d = r["date"].split("-")
        p = byd.get(f"{int(y) - 1}-{mo}-{calendar.monthrange(int(y) - 1, int(mo))[1]:02d}")
        if p and r.get("consultants") and p.get("consultants"):
            yoy.append({"date": r["date"], "value": round((r["consultants"] / p["consultants"] - 1) * 100, 1)})
    out.append(series("co_consultants_yoy", "company", "회사 공시 · 컨설턴트 전년비", "%", yoy, "결산 보충자료", "", "분기", "", quarterly=True))
    g = m.get("guidance", [])
    out.append(series("gd_consultants", "guidance", "회사 전망 · 컨설턴트 (중간값)", "명",
                      [{"date": x["date"], "value": (x["consultants_lo"] + x["consultants_hi"]) / 2, "range": [x["consultants_lo"], x["consultants_hi"]]} for x in g],
                      "결산 보충자료", "", "다음 분기 말", "범위의 중간값", quarterly=True, link="co_consultants"))
    out.append(series("gd_total", "guidance", "회사 전망 · 총사원", "명", [{"date": x["date"], "value": x["total"]} for x in g if x.get("total")],
                      "결산 보충자료", "", "다음 분기 말", "", quarterly=True, link="co_total"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    prev = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    manual = json.loads(MANUAL.read_text(encoding="utf-8"))
    auto = json.loads(AUTO.read_text(encoding="utf-8")) if AUTO.exists() else []
    errors = []
    price = prev.get("price")
    if not only or "price" in only:
        try:
            price = fetch_price()
            print("[ok] price")
        except Exception as e:  # noqa: BLE001
            errors.append(f"price: {e}")
            print(f"[fail] price: {e}", file=sys.stderr)
    if not only or "deck" in only:
        try:
            if fetch_decks(auto):
                AUTO.write_text(json.dumps(auto, ensure_ascii=False, indent=1), encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            errors.append(f"deck: {e}")
            print(f"[fail] deck: {e}", file=sys.stderr)
    rows = merge_headcount(manual.get("company_headcount", []), auto)
    out = {"schema_version": 1, "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
           "company": manual["company"], "next_event": next_event(), "entities": manual["entities"], "sites": manual["sites"],
           "groups": [{"id": "company", "label": "회사 공시 인원 (분기)"}, {"id": "guidance", "label": "회사 전망"},
                      {"id": "pension", "label": "연금 피보험자 (월간)"}, {"id": "jobs", "label": "구인 공고"}],
           "headcount": rows, "nenkin": manual.get("nenkin", []), "doda": manual.get("doda", []),
           "price": price, "series": build_series(manual, rows), "errors": errors}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"saved {OUT} · series {len(out['series'])} · 분기 인원 {len(rows)} · price {len((price or {}).get('points', []))}")


if __name__ == "__main__":
    main()
