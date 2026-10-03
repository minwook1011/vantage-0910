#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_podcasts.py — 팟캐스트 새 에피소드 감지 → docs/data/podcasts/index.json
대상 방송은 data_sources/podcasts.json. 표준 라이브러리만 사용.

에피소드 상태(status)
  new    : 방금 발견 — 아직 요약 안 함
  done   : 요약·번역 아티팩트 완료(docs/data/podcasts/ep/<id>.json 존재)
  sent   : 텔레그램까지 보냄(send_telegram.py --podcast <id> 가 기록)
  skip   : 대본을 못 구하는 등 이유로 건너뜀(reason 기록)

사용
  python fetch_podcasts.py            # 새 에피소드 찾기 → 새로 생긴 id를 마지막 줄에 JSON 배열로 출력
  python fetch_podcasts.py --pending  # 아직 처리 안 된(new) 에피소드만 출력
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(BASE, "data_sources", "podcasts.json")
OUT_DIR = os.path.join(BASE, "docs", "data", "podcasts")
INDEX = os.path.join(OUT_DIR, "index.json")
EP_DIR = os.path.join(OUT_DIR, "ep")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vantage-podcasts/1.0"
NS = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}


def get(url):
    for a in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            print(f"  [재시도 {a + 1}] {url} → {e}")
            time.sleep(2 * (a + 1))
    return None


def clean(s, n=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n] + "…" if n and len(s) > n else s


def ep_id(show, date, title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48].strip("-")
    h = hashlib.md5(title.encode("utf-8")).hexdigest()[:5]
    return f"{date}-{show}-{slug or h}"


def og_image(url):
    """에피소드 페이지의 대표 이미지(og:image) — 보통 게스트 사진"""
    try:
        t = get(url)
        t = t.decode("utf-8", "replace") if t else ""
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', t) or \
            re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image', t)
        return html.unescape(m.group(1)) if m else None
    except Exception:
        return None


def parse_feed(show, xml_bytes, since):
    root = ET.fromstring(xml_bytes)
    ch = root.find("./channel/itunes:image", NS)
    ch_img = ch.get("href") if ch is not None else (root.findtext("./channel/image/url") or None)
    out = []
    for it in root.findall("./channel/item"):
        title = clean(it.findtext("title"))
        pub = it.findtext("pubDate") or ""
        try:
            dt = parsedate_to_datetime(pub).astimezone(KST)
        except Exception:
            continue
        date = dt.strftime("%Y-%m-%d")
        if date < since:
            continue
        enc = it.find("enclosure")
        dur = (it.findtext("itunes:duration", default="", namespaces=NS) or "").strip()
        if dur.isdigit():   # 초 단위로 주는 피드 → 1:26:13
            sec = int(dur)
            dur = f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"
        out.append({
            "id": ep_id(show["id"], date, title), "show": show["id"], "show_name": show["name"],
            "title": title, "date": date, "published": dt.strftime("%Y-%m-%d %H:%M KST"),
            "link": (it.findtext("link") or "").strip(), "audio": enc.get("url") if enc is not None else None,
            "duration": dur, "desc": clean(it.findtext("description"), 600), "status": "new",
            **({"status": "skip", "reason": "재방송(REPLAY)"} if re.search(r"replay|rerun|encore|best of", title, re.I) else {}),
            "found": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        })
        # 얼굴 사진: 에피소드별 이미지 → 방송 로고뿐이면 에피소드 페이지 대표 이미지 → 그래도 없으면 방송 로고
        ii = it.find("itunes:image", NS)
        img = ii.get("href") if ii is not None else None
        out[-1]["image"] = img if img and img != ch_img else None
        out[-1]["show_image"] = ch_img
    return out


def fill_images(eps):
    for e in eps:
        if not e.get("image") and e.get("link") and "spotify.com" not in e["link"]:
            e["image"] = og_image(e["link"])
            time.sleep(0.5)
        if not e.get("image"):
            e["image"] = e.get("show_image")


def load_index():
    if os.path.exists(INDEX):
        try:
            return json.load(open(INDEX, encoding="utf-8"))
        except Exception:
            pass
    return {"updated": None, "episodes": []}


def save_index(ix):
    os.makedirs(OUT_DIR, exist_ok=True)
    # ep/<id>.json 이 있으면 최소 done (텔레그램 전송 기록 sent 는 유지)
    for e in ix["episodes"]:
        path = os.path.join(EP_DIR, e["id"] + ".json")
        if not os.path.exists(path):
            continue
        if e.get("status") == "new":
            e["status"] = "done"
        try:   # 목록 카드용 요약(제목·누구·기업·한 줄)을 에피소드 파일에서 옮겨 온다
            E = json.load(open(path, encoding="utf-8"))
            g, c = E.get("guest") or {}, E.get("company") or {}
            e["summary"] = {"title_ko": E.get("title_ko"), "headline": E.get("headline"), "image": E.get("image"),
                            "guest": (g.get("name", "") + (" — " + g["role"] if g.get("role") else "")) or None,
                            "company": (c.get("name", "") + (f" ({c['sector']})" if c.get("sector") else "")) or None}
        except Exception as ex:
            print(f"  [요약 읽기 실패] {e['id']}: {ex}")
    ix["episodes"].sort(key=lambda e: (e["date"], e.get("published", "")), reverse=True)
    ix["updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(ix, f, ensure_ascii=False, indent=1)


def main():
    cfg = json.load(open(CFG, encoding="utf-8"))
    ix = load_index()
    if "--pending" in sys.argv:
        save_index(ix)
        pend = [e["id"] for e in ix["episodes"] if e.get("status") == "new"]
        print(json.dumps(pend, ensure_ascii=False))
        return 0
    known = {e["id"] for e in ix["episodes"]}
    known_links = {e.get("link") for e in ix["episodes"] if e.get("link")}
    known_audio = {e.get("audio") for e in ix["episodes"] if e.get("audio")}
    new = []
    for show in cfg["shows"]:
        raw = get(show["feed"])
        if not raw:
            print(f"{show['name']}: 피드 수신 실패 — 다음 실행에서 다시")
            continue
        try:
            eps = parse_feed(show, raw, cfg.get("since", "2000-01-01"))
        except Exception as e:
            print(f"{show['name']}: 피드 해석 실패 {e}")
            continue
        # 방송사가 제목만 바꿔 다시 올려도(링크·id가 바뀜) 같은 오디오 파일이면 같은 편으로 본다
        fresh = [e for e in eps if e["id"] not in known and (not e["link"] or e["link"] not in known_links)
                 and (not e.get("audio") or e["audio"] not in known_audio)]
        fill_images(fresh)
        # 예전에 올린 에피소드에 사진이 없으면 채워 넣는다
        by_id = {e["id"]: e for e in eps}
        old_rows = [r for r in ix["episodes"] if r["id"] in by_id and not r.get("image")]
        fill_images([by_id[r["id"]] for r in old_rows])
        for r in old_rows:
            r["image"], r["show_image"] = by_id[r["id"]].get("image"), by_id[r["id"]].get("show_image")
        print(f"{show['name']}: 기간 내 {len(eps)}편 · 새로 발견 {len(fresh)}편")
        for e in fresh:
            print(f"   + {e['date']} {e['title']}")
        new += fresh
        time.sleep(0.8)
    ix["episodes"] += new
    save_index(ix)
    print(f"새 에피소드 {len(new)}편 · 처리 대기(new) {sum(1 for e in ix['episodes'] if e.get('status') == 'new')}편")
    print(json.dumps([e["id"] for e in new], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
