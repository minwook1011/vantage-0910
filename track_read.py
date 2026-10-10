#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
track_read.py — 기사·네이버 블로그 본문을 글자만 뽑아 보기 (트래킹 예약 작업이 요약할 때)

  python track_read.py https://blog.naver.com/ranto28/224436787721
  python track_read.py <기사 주소>
네이버 블로그는 모바일 글 화면에서 문단을 뽑고, 일반 기사는 <p> 문단을 모은다(유료 기사는 앞부분만 나올 수 있음).
"""
import html
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from track_fetch import http

ZW = re.compile(r"[​‌‍﻿\xa0]")


def clean(s):
    s = html.unescape(re.sub(r"<[^>]+>", "", s))
    return ZW.sub(" ", s).strip()


def naver_blog(url):
    m = re.search(r"blog\.naver\.com/([^/?#]+)/(\d+)", url) or re.search(r"blogId=([^&]+).*?logNo=(\d+)", url)
    if not m:
        return None
    h = http(f"https://m.blog.naver.com/PostView.naver?blogId={m.group(1)}&logNo={m.group(2)}")
    seg = h[h.find("se-main-container"):] if "se-main-container" in h else h
    paras = [clean(p) for p in re.findall(r'(?s)<p class="se-text-paragraph[^"]*"[^>]*>(.*?)</p>', seg)]
    if not paras:                                            # 옛 편집기 글
        paras = [clean(p) for p in re.findall(r"(?s)<p[^>]*>(.*?)</p>", seg)]
    return "\n".join(p for p in paras if p)


def article(url):
    h = http(url)
    h = re.sub(r"(?s)<(script|style|nav|header|footer|aside)[^>]*>.*?</\1>", " ", h)
    paras = [clean(p) for p in re.findall(r"(?s)<p[^>]*>(.*?)</p>", h)]
    return "\n".join(p for p in paras if len(p) > 30)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    url = sys.argv[1]
    txt = (naver_blog(url) if "blog.naver.com" in url else None) or article(url)
    print(txt[:20000] if txt else "(본문을 못 읽음 — 제목·요지와 다른 보도로만 쓸 것)")
    print(f"\n— {len(txt or '')}자")


if __name__ == "__main__":
    main()
