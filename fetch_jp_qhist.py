#!/usr/bin/env python3
"""일본 기업 분기 실적 장기 이력 — IR BANK 四半期推移(5개 회계연도 = 20분기)에서 매출·영업이익·경상이익·순이익.

카부탄 결산 표는 최근 8분기뿐이라, 실적 리포트·스크리너 그래프를 12분기로 늘리려고 더 오래된 분기를 여기서 채운다(2026-10-16 사용자).
IR BANK 값은 億 단위 반올림(예: 77.1億)이라 최근 8분기는 카부탄 정확한 값을 쓰고, 그보다 옛날 분기만 이 값을 쓴다.

  python fetch_jp_qhist.py              # 리포트·스크리너 전 종목(이미 받은 종목은 30일 지나야 다시)
  python fetch_jp_qhist.py --codes 7453 # 특정 종목만
출력: data_sources/jp_qhist.json {코드: {"fym": 결산월, "ecode": "E…", "at": 받은 날, "q": [{"end": "YYYY-MM", "rev", "op", "ord", "ni"}]}}  단위: 백만엔
       docs/data/jp/qhist.json  (화면용: {코드: [[끝난 해·달 "YYYY-MM", 매출, 영업, 경상, 순이익], …]})
IR BANK 에 부담이 가지 않게 동시에 2개, 요청 사이 1초 쉰다.
"""
import argparse
import glob
import html as H
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(ROOT, "data_sources", "jp_qhist.json")
PUB = os.path.join(ROOT, "docs", "data", "jp", "qhist.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def get(url):
    for t in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
            return urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        except Exception:
            time.sleep(3 + 3 * t)
    return None


def val(s):
    s = H.unescape(re.sub(r"<[^>]+>", "", s.split("<br")[0])).strip().replace(",", "")
    m = re.fullmatch(r"(-?[\d.]+)(兆|億|万)?", s)
    if not m:
        return None
    v = float(m.group(1)) * {"兆": 1e6, "億": 100, "万": 0.01, None: 1e-6}[m.group(2)]
    return round(v, 2)


KEYS = (("rev", r"売上|営業収益|経常収益|収益"), ("op", r"営業利益|営業損益"), ("ord", r"経常利益|税引前|税前"), ("ni", r"純利|純損益|当期利益"))


def parse(html):
    """四半期推移 표 → (결산월, {(끝 연, 끝 월): {rev, op, ord, ni}})"""
    i = html.find("四半期毎の業績推移")
    if i < 0:
        return None, {}
    t = html[i:html.find("</table>", i)]
    out, fym, cur = {}, None, None
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        tds = re.findall(r"<td([^>]*)>(.*?)</td>", tr, re.S)
        if not tds:
            continue
        cells = [c for _, c in tds]
        if 'rowspan' in tds[0][0]:
            name = H.unescape(re.sub(r"<[^>]+>", "", cells[0])).strip()
            cur = next((k for k, pat in KEYS if re.search(pat, name)), None)
            if name.endswith("率"):
                cur = None
            cells = cells[1:]
        if not cur or len(cells) < 5:
            continue
        m = re.fullmatch(r"(\d{4})/(\d{2})", re.sub(r"<[^>]+>", "", cells[0]).strip())
        if not m:
            continue
        fy, fym = int(m.group(1)), int(m.group(2))
        for n in range(1, 5):
            em, ey = fym - 3 * (4 - n), fy
            while em <= 0:
                em += 12; ey -= 1
            v = val(cells[n])
            if v is not None:
                out.setdefault((ey, em), {})[cur] = v
    return fym, out


def one(code, old):
    ecode = (old or {}).get("ecode")
    if not ecode:
        h = get(f"https://irbank.net/{code}")
        time.sleep(1)
        m = re.search(r'href="/(E\d{5})/quarter"', h or "")
        if not m:
            return code, None
        ecode = m.group(1)
    h = get(f"https://irbank.net/{ecode}/quarter")
    time.sleep(1)
    if not h:
        return code, None
    fym, q = parse(h)
    if not q:
        return code, {"ecode": ecode, "fym": fym, "at": date.today().isoformat(), "q": (old or {}).get("q", [])}
    rows = {r["end"]: r for r in (old or {}).get("q", [])}   # 예전에 받은 분기는 남기고 새 값으로 덮는다
    for (y, m_), d in q.items():
        rows[f"{y}-{m_:02d}"] = {"end": f"{y}-{m_:02d}", **{k: d.get(k) for k in ("rev", "op", "ord", "ni")}}
    return code, {"ecode": ecode, "fym": fym, "at": date.today().isoformat(), "q": sorted(rows.values(), key=lambda r: r["end"])}


def all_codes():
    codes = set()
    for p in glob.glob(os.path.join(ROOT, "docs", "data", "jp", "reports", "*.json")):
        codes.add(os.path.basename(p).split("-")[0])
    for f, var in (("screener-data.js", "RAW"), ("consumer-extra.js", "RAW_EXT"), ("major-data.js", "RAW_MAJ")):
        try:
            t = open(os.path.join(ROOT, "docs", "data", "jp", f), encoding="utf-8").read()
            m = re.search(r"const\s+" + var + r"\s*=\s*(\[.*?\]);?\s*(?:\n|$)", t, re.S)
            codes |= {str(r[0]) for r in json.loads(m.group(1))} if m else set()
        except Exception:
            pass
    return sorted(c for c in codes if re.fullmatch(r"[0-9A-Z]{4}", c))


def publish(store):
    pub = {c: [[r["end"], r.get("rev"), r.get("op"), r.get("ord"), r.get("ni")] for r in v.get("q", [])] for c, v in store.items() if v.get("q")}
    json.dump(pub, open(PUB, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--codes", nargs="*")
    ap.add_argument("--days", type=int, default=30, help="이 날수 안에 받은 종목은 건너뜀")
    a = ap.parse_args()
    try:
        store = json.load(open(STORE, encoding="utf-8"))
    except Exception:
        store = {}
    codes = a.codes or all_codes()
    today = date.today()
    todo = [c for c in codes if a.codes or not store.get(c) or (today - date.fromisoformat(store[c].get("at", "2000-01-01"))).days >= a.days]
    print("대상", len(todo), "/", len(codes), flush=True)
    done = 0
    with ThreadPoolExecutor(2) as ex:
        for code, rec in ex.map(lambda c: one(c, store.get(c)), todo):
            done += 1
            if rec:
                store[code] = rec
            if done % 25 == 0 or done == len(todo):
                json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                publish(store)
                print(f"  {done}/{len(todo)} · 받음 {len(store)}", flush=True)
    json.dump(store, open(STORE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    publish(store)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
