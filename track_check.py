#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
track_check.py — 이 사건이 지난 7일 안에 이미 보도됐는지 직접 찾아보기 (트래킹 예약 작업이 재탕 여부를 판단할 때)

  python track_check.py "Nebius Rosenblatt buy rating"        # 영문
  python track_check.py "삼성전기 FC-BGA 수주"                 # 한글
지난 7일 구글 뉴스를 오래된 순으로 출력한다(날짜 · 매체 · 제목). 맨 위가 처음 보도.
"""
import re
import sys
import urllib.parse

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from track_fetch import http, parse_rss


def main():
    q = " ".join(sys.argv[1:]).strip()
    if not q:
        print(__doc__)
        return
    hl = "hl=ko&gl=KR&ceid=KR:ko" if re.search(r"[가-힣]", q) else "hl=en-US&gl=US&ceid=US:en"
    items = parse_rss(http("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:7d") + "&" + hl))
    for it in sorted(items, key=lambda x: x["published"])[:30]:
        t = re.sub(r"\s+-\s+[^-]{2,40}$", "", it["title"])
        print(f"{it['published']:%m/%d %H:%M} · {it['source'][:20]} · {t[:110]}")
    print(f"— {len(items)}건(지난 7일)")


if __name__ == "__main__":
    main()
