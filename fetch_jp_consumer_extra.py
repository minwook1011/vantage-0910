#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_jp_consumer_extra.py — 일본 기업 스크리너「소비재」유니버스 추가 종목
→ docs/data/jp/consumer-extra.js  (RAW_EXT · BUNDLE_EXT, jp-screener.js 가 소비재 RAW·BUNDLE 뒤에 합친다)

screener-data.js(소비재 332개 — 2026-10-02 시총 300억엔 미만 정리, 고정 번들)에는 생성 스크립트가 없어서 직접 고치지 않는다.
빠진 소비재·소비재 인접 종목은 data_sources/jp_consumer_extra.json 에 적고 이 스크립트를 돌린다.

  [{"code": "7552", "cat": "게임·엔터", "note": "완구·게임 도매"}, ...]
  - cat  : 스크리너의 기존 카테고리 중 하나(CATS 참고). 새 카테고리는 만들지 않는다.
  - note : 업종 칸에 그대로 보이는 짧은 한국어 설명.

행·번들 형식은 fetch_jp_major.py 의 build_one 을 그대로 쓴다(카부탄 종목·결산 페이지 + 야후 10년 주봉).
소비재 RAW 와 같은 13칸 [코드,이름,카테고리,업종,종가,시총(억엔),매출성장,1년,YTD,PER,ROE,영업이익률,매출(억엔)].

사용
  python fetch_jp_consumer_extra.py            # 전체 갱신(종목당 약 3초)
  python fetch_jp_consumer_extra.py 7552,7844  # 이 종목만 새로 받고 나머지는 기존 파일 값 유지
- 이미 screener-data.js RAW 에 있는 코드는 건너뛴다(중복 방지).
- 카부탄에서 종목 페이지가 확인되지 않거나(상장폐지·코드 오류) 주가·실적을 하나도 못 받은 종목은
  기존 파일의 값을 유지하고, 그것도 없으면 빼고 끝에 목록으로 알린다.
카부탄은 GitHub 서버를 막으므로 이 PC에서 돌린다. 로컬 SSL 가로채기는 JP_INSECURE_SSL=1.
"""
import json
import os
import re
import sys
import time

import fetch_jp_major as M

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
LIST = os.path.join(BASE, "data_sources", "jp_consumer_extra.json")
SCREENER = os.path.join(BASE, "docs", "data", "jp", "screener-data.js")
OUT = os.path.join(BASE, "docs", "data", "jp", "consumer-extra.js")
MIN_MCAP = 300  # 억엔 — 이보다 작은 종목은 소비재 명단에 넣지 않는다
CATS = ["리테일·유통", "식품·음료", "외식", "라멘", "게임·엔터", "미용·헬스케어서비스", "패션·명품", "생활·홈",
        "화장품·퍼스널케어", "여행·레저"]


def load_var(path, var):
    """`const VAR = [...]` 를 읽는다. 없으면 []"""
    try:
        s = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        return []
    m = re.search(r"const\s+" + var + r"\s*=\s*", s)
    if not m:
        return []
    try:
        return json.JSONDecoder().raw_decode(s, m.end())[0]
    except Exception:
        return []


def load_extra_list():
    """data_sources/jp_consumer_extra.json → [{code, cat, note}] (다른 스크립트도 이 함수를 쓴다)"""
    try:
        items = json.load(open(LIST, encoding="utf-8"))
    except FileNotFoundError:
        return []
    out, seen = [], set()
    for x in items:
        code = str(x.get("code") or "").strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "cat": x.get("cat"), "note": (x.get("note") or "").strip()})
    return out


def main():
    t0 = time.time()
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    only = set(only[0].upper().split(",")) if only else None
    items = load_extra_list()
    if not items:
        print("data_sources/jp_consumer_extra.json 이 비어 있음")
        return 1
    base_codes = {r[0] for r in load_var(SCREENER, "RAW")}
    if not base_codes:
        print("screener-data.js 의 RAW 를 읽지 못함 — 중단")
        return 1
    old_raw = {r[0]: r for r in load_var(OUT, "RAW_EXT")}
    old_bun = {b["c"]: b for b in load_var(OUT, "BUNDLE_EXT")}

    raw, bundle = [], []
    dup, bad_cat, failed, kept = [], [], [], []
    todo = [x for x in items if x["code"] not in base_codes]
    dup = [x["code"] for x in items if x["code"] in base_codes]
    for i, x in enumerate(todo, 1):
        code = x["code"]
        if x["cat"] not in CATS:
            bad_cat.append(code)
            continue

        def keep_old(why):
            if code in old_raw:
                r = old_raw[code]
                r[2], r[3] = x["cat"], x["note"] or r[3]
                raw.append(r)
                if code in old_bun:
                    b = old_bun[code]
                    b["cat"], b["ind"] = r[2], r[3]
                    bundle.append(b)
                if why:
                    kept.append(f"{code}({why})")
                return True
            return False

        if only is not None and code not in only:
            keep_old(None)
            continue
        try:
            row, b, info = M.build_one(code, cat=x["cat"], ind=x["note"] or None)
        except Exception as e:
            if not keep_old(f"오류 {e}"):
                failed.append(f"{code}(오류 {e})")
            continue
        st = info["st"]
        if not st.get("jp") or not st.get("market"):
            if not keep_old("카부탄 종목 페이지 확인 실패"):
                failed.append(f"{code}({st.get('jp') or '이름 없음'}: 카부탄에 시장·주가 정보 없음 — 상장폐지·코드 오류?)")
            continue
        if not st["market"].startswith("東証"):
            failed.append(f"{code}({st['jp']}: 도쿄증권거래소 상장이 아님 — {st['market']})")
            continue
        if not b or not b.get("px") or row[4] is None:
            if not keep_old("주가 수집 실패"):
                failed.append(f"{code}(주가 수집 실패)")
            continue
        raw.append(row)
        bundle.append(b)
        print(f"[{i}/{len(todo)}] {code} {x['cat']} {info['jp']} [{st.get('market')}·{st.get('sector')}] {row[1]} "
              f"close={row[4]} mcap={row[5]} px={info['bars']} q={len(info['q']['lb']) if info['q'] else 0} "
              f"rev={row[12]} per={row[9]}")

    if not raw:
        print("받은 종목이 없음 — 기존 파일 유지")
        return 1
    n_list = len(todo) - len(bad_cat)
    if only is not None:   # 일부만 받을 때는 기존 파일에 있던 종목 + 이번 종목만 기준(시총 미달로 빠진 종목은 세지 않음)
        n_list = sum(1 for x in todo if x["code"] in old_raw or x["code"] in only)
    if len(raw) < n_list * 0.7:
        print(f"수집률이 너무 낮음({len(raw)}/{n_list}) — 기존 파일 유지")
        return 1
    # 시총 300억엔 미만은 소비재 명단에서 뺀다(2026-10-02 사용자 지시 — screener-data.js 도 같은 기준으로 정리함)
    small = [f"{r[0]}({r[5]})" for r in raw if (r[5] or 0) < MIN_MCAP]
    keep = {r[0] for r in raw if (r[5] or 0) >= MIN_MCAP}
    raw = [r for r in raw if r[0] in keep]
    bundle = [b for b in bundle if b["c"] in keep]
    if small:
        print(f"시총 {MIN_MCAP}억엔 미만이라 뺌:", " ".join(small))
    raw.sort(key=lambda r: -(r[5] or 0))
    order = {r[0]: k for k, r in enumerate(raw)}
    bundle.sort(key=lambda b: order.get(b["c"], 9999))
    for b in bundle:  # RAW 의 최신 시총과 맞춘다
        b["mcap"] = raw[order[b["c"]]][5]
    js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8", newline="\n") as fo:
        fo.write("/* 소비재 유니버스 추가 종목 — fetch_jp_consumer_extra.py 가 만든다(목록: data_sources/jp_consumer_extra.json). 직접 고치지 말 것 */\n")
        fo.write("const RAW_EXT = " + js(raw) + ";\n")
        fo.write("const BUNDLE_EXT = [\n" + ",\n".join(js(b) for b in bundle) + "\n];\n")
    print(f"완료 {len(raw)}종목 · {os.path.getsize(OUT)/1e6:.2f}MB · {(time.time()-t0)/60:.1f}분")
    print("카테고리:", " / ".join(f"{c}({sum(1 for r in raw if r[2]==c)})" for c in CATS if any(r[2] == c for r in raw)))
    if dup:
        print("이미 소비재 RAW 에 있어 건너뜀:", " ".join(dup))
    if bad_cat:
        print("카테고리 이름이 기존 목록에 없어 건너뜀:", " ".join(bad_cat))
    if kept:
        print("새로 못 받아 기존 값 유지:", " ".join(kept))
    if failed:
        print("실패(빠짐):", " ".join(failed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
