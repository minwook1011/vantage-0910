# -*- coding: utf-8 -*-
"""
일본 기업 인력 수(후생연금 가입자 수) — 일본연금기구 '후생연금·건강보험 적용사업소 검색'(2026-10-19 사용자 요청)

  회사가 직원을 뽑으면 후생연금(사회보험) 가입자가 늘어난다. 연금기구는 법인별 가입자 수를 한 달에 한 번
  ('데이터 갱신일') 바꾸므로, 결산(분기)보다 먼저 채용 속도를 볼 수 있다.

  대상 기업: data_sources/headcount_watch.json  {"companies":[{"name":"베이커런트","code":"6532","houjin":["법인번호13자리",…]}]}
  결과:      docs/data/tracking/headcount.json   갱신일마다 법인별 인원 기록(history) — tg_notify headcount() 가 뉴스방으로 보냄

  python fetch_headcount.py          갱신일이 바뀌었을 때만 조회·기록(평소엔 페이지 한 번만 읽고 끝)
  python fetch_headcount.py --force  갱신일과 상관없이 지금 조회(새 기업을 넣었을 때)
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
WATCH = os.path.join(BASE, "data_sources", "headcount_watch.json")
OUT = os.path.join(BASE, "docs", "data", "tracking", "headcount.json")
URL = "https://www.nenkin.go.jp/do/search_section"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
KST = timezone(timedelta(hours=9))


def load(p, d):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return d


def page(s):
    h = s.get(URL + "/", timeout=25).text
    upd = re.search(r"データ更新日：\s*(\d{4})年(\d{2})月(\d{2})日", h)
    tok = re.search(r'name="hdnTransactionToken" value="([^"]+)"', h)
    if not upd or not tok:
        raise RuntimeError("연금기구 검색 화면 모양이 바뀜(갱신일·토큰 못 찾음)")
    return "-".join(upd.groups()), tok.group(1)


def lookup(s, houjin):
    """법인번호 → [(사업소 이름, 가입자 수)] — 한 법인에 사업소가 여럿이면 각각"""
    _, tok = page(s)                       # 토큰은 한 번 쓰면 끝이라 조회마다 새로 받는다
    data = [("hdnPrefectureCode", ""), ("hdnSearchOffice", "1"), ("hdnSearchCriteria", "3"), ("txtOfficeName", ""),
            ("txtOfficeAddress", ""), ("txtHoujinNo", houjin), ("hdnDisplayItemsRestorationScreenDto", ""),
            ("hdnDisplayItemsRestorationScreenDtoKeepParam", "false"), ("hdnTransactionToken", tok), ("hdnTokenKeepParam", "false"),
            ("gmnId", "GB10001SC010"), ("hdnErrorFlg", ""), ("eventId", "/SEARCH.HTML"), ("/search.html", "")]
    r = s.post(URL, data=data, timeout=25, headers={"Referer": URL + "/", "Origin": "https://www.nenkin.go.jp"})
    r.raise_for_status()
    t = r.text
    i = t.find("被保険者数")
    if i < 0:
        return []
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t[i:], re.S):
        cells = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) >= 3 and houjin in cells and re.fullmatch(r"\d+", cells[-1] or ""):
            out.append((cells[0].replace("　", " "), int(cells[-1])))
    return out


def main():
    force = "--force" in sys.argv
    watch = load(WATCH, {}).get("companies") or []
    data = load(OUT, {"companies": [], "history": []})
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ja"})
    upd, _ = page(s)
    hist = data.setdefault("history", [])
    have = {(h["date"], h["code"]) for h in hist}
    todo = [c for c in watch if force or (upd, c["code"]) not in have]
    if not todo:
        print(f"갱신일 {upd} 그대로 — 새 데이터 없음")
        return
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    for c in todo:
        rows = []
        for h in c["houjin"]:
            got = lookup(s, h)
            rows += [{"houjin": h, "name": n, "n": v} for n, v in got]
            time.sleep(1.5)
        if not rows:
            print("조회 실패(0건):", c["name"])
            continue
        rec = {"date": upd, "code": c["code"], "name": c["name"], "total": sum(r["n"] for r in rows), "rows": rows, "fetched": now}
        hist[:] = [h for h in hist if not (h["date"] == upd and h["code"] == c["code"])] + [rec]
        print(f"{c['name']}({c['code']}) {upd} 합계 {rec['total']:,}명 · " + " · ".join(f"{r['name']} {r['n']:,}" for r in rows))
    hist.sort(key=lambda h: (h["code"], h["date"]))
    data["companies"] = watch
    data["updated"] = now
    data["source"] = "일본연금기구 후생연금보험·건강보험 적용사업소 검색(데이터 갱신일 기준)"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("새 데이터 기록")


if __name__ == "__main__":
    main()
