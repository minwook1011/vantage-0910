#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
track_apply.py — Claude 가 쓴 트래킹 기사 요약을 사이트 데이터에 반영 (track_fetch.py 다음 단계)

입력: data_sources/_tracking_decisions.json
  {
    "keep": [{"id": "<후보 id>", "headline": "제목(결론) 한 줄",
              "bullets": ["3줄 요약 1", "2", "3"], "summary": "내용 요약(문단, 400~700자)"}],
    "drop": ["<후보 id>", ...],                          # 걸러낸 것(이유 불필요)
    "resolve": [{"term": "네비우스", "market": "us|kr|theme", "ticker": "NBIS",
                 "aliases": ["Nebius", "NBIS", "네비우스"], "name": "Nebius Group"}]   # 새 단어 정보(선택)
  }
결과: docs/data/tracking/items/<slug>.json 앞에 추가(단어당 최근 300건), watchlist.json 정보 보강,
      후보·결정 파일 삭제. 텔레그램 발송은 푸시 후 GitHub(tg_notify.py)이 한다.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
WATCH = os.path.join(BASE, "docs", "data", "tracking", "watchlist.json")
ITEMS = os.path.join(BASE, "docs", "data", "tracking", "items")
CAND = os.path.join(BASE, "data_sources", "_tracking_candidates.json")
DEC = os.path.join(BASE, "data_sources", "_tracking_decisions.json")
KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)


def load(p, d):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return d


def save(p, o):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(o, f, ensure_ascii=False, indent=1)


def main():
    cand = {c["id"]: c for c in load(CAND, {}).get("candidates", [])}
    dec = load(DEC, None)
    if dec is None:
        sys.exit("결정 파일이 없습니다: data_sources/_tracking_decisions.json")
    watch = load(WATCH, {"schema": 1, "terms": []})

    # 새 단어 정보 보강(시장·티커·영문 이름) — slug 는 처음 정한 것을 유지(기사 파일 이름)
    for r in dec.get("resolve") or []:
        for t in watch.get("terms", []):
            if t["term"] == r.get("term"):
                for k in ("market", "ticker", "name"):
                    if r.get(k):
                        t[k] = r[k]
                al = [a for a in (r.get("aliases") or []) if a]
                t["aliases"] = list(dict.fromkeys(al + [t["term"]]))
                t["resolved"] = True

    added, bad = {}, []
    for k in dec.get("keep") or []:
        c = cand.get(k.get("id"))
        b = [x for x in (k.get("bullets") or []) if x]
        if not c or not k.get("headline") or len(b) < 3:
            bad.append(k.get("id"))
            continue
        item = {"id": c["id"], "headline": k["headline"].strip(), "bullets": b[:3], "summary": (k.get("summary") or "").strip(),
                "title": c["title"], "source": c["source"], "url": c["url"], "published": c["published"],
                "written": NOW.strftime("%Y-%m-%d %H:%M KST")}
        added.setdefault(c["slug"], []).append(item)

    for slug, new in added.items():
        p = os.path.join(ITEMS, slug + ".json")
        cur = load(p, {"schema": 1, "slug": slug, "items": []})
        have = {x["id"] for x in cur["items"]}
        new = sorted([x for x in new if x["id"] not in have], key=lambda x: x["published"], reverse=True)
        cur["items"] = (new + cur["items"])[:300]
        cur["updated"] = NOW.strftime("%Y-%m-%d %H:%M KST")
        save(p, cur)

    # 단어별 기사 수·최근 시각(사이트 목록용)
    for t in watch.get("terms", []):
        it = load(os.path.join(ITEMS, t["slug"] + ".json"), {}).get("items", [])
        t["count"] = len(it)
        t["last"] = it[0]["published"] if it else ""
    watch["updated"] = NOW.strftime("%Y-%m-%d %H:%M KST")
    save(WATCH, watch)

    for p in (CAND, DEC):
        if os.path.exists(p):
            os.remove(p)
    n = sum(len(v) for v in added.values())
    print(f"반영 {n}건 · 탈락 {len(dec.get('drop') or [])}건" + (f" · 형식 오류로 뺀 것 {len(bad)}건" if bad else ""))


if __name__ == "__main__":
    main()
