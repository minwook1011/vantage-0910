# -*- coding: utf-8 -*-
"""
공개 텔레그램 채널 뉴스 수집기 (표준 라이브러리만 사용, API키·로그인 불필요)

동작:
  - docs/telegram_channels.json 의 channels(공개 채널 username 목록)를 읽어
  - 각 채널의 https://t.me/s/<username> 미리보기 페이지를 긁어 최근 글을 파싱
  - 채널 간/기존 데이터와 중복 제거(정규화 텍스트 해시)
  - docs/telegram_news.json 으로 병합 저장 (최신순, 보관 개수/기간 제한)

주의:
  - 이 방식은 "공개" 채널만 됩니다. 유료·비공개 방은 로그인이 필요해 별도 수집기가 필요합니다.
  - 채널 목록을 바꾸려면 docs/telegram_channels.json 의 channels 배열만 편집하세요.
"""
import json, os, re, html, hashlib, urllib.request
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
CONF_PATH = os.path.join(HERE, "docs", "telegram_channels.json")
OUT_PATH = os.path.join(HERE, "docs", "telegram_news.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en,ko;q=0.9"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "replace")


def html_to_text(s):
    """메시지 HTML을 줄바꿈 보존 평문으로."""
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)          # 남은 태그 제거
    s = html.unescape(s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s


def norm_key(text):
    """중복 판정용 정규화: 소문자화 + URL 제거 + 영숫자/한글만 남김."""
    t = text.lower()
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"[^0-9a-z가-힣]+", "", t)
    return hashlib.sha1(t[:400].encode("utf-8")).hexdigest() if t else None


def parse_channel(username):
    """t.me/s/<username> 파싱 → (channel_title, [{date, text, link}, ...])"""
    url = "https://t.me/s/" + username
    doc = fetch(url)
    m = re.search(r'<meta property="og:title" content="([^"]*)"', doc)
    title = html.unescape(m.group(1)) if m else username

    items = []
    # 메시지 단위로 분할
    chunks = doc.split("js-widget_message_wrap")
    for ch in chunks[1:]:
        post = re.search(r'data-post="([^"]+)"', ch)
        if not post:
            continue
        link = "https://t.me/" + post.group(1)
        mt = re.search(r'tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', ch, re.S)
        text = html_to_text(mt.group(1)) if mt else ""
        if not text or len(text) < 4:
            continue
        times = re.findall(r'<time[^>]*datetime="([^"]+)"', ch)
        date = times[-1] if times else ""
        items.append({"date": date, "text": text[:1200], "link": link})
    return title, items


def to_dt(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def main():
    if not os.path.exists(CONF_PATH):
        print("설정 파일 없음:", CONF_PATH)
        return
    conf = json.load(open(CONF_PATH, encoding="utf-8"))
    channels = [c.strip().lstrip("@") for c in conf.get("channels", []) if c.strip()]
    keep = int(conf.get("keep", 200))
    max_age_days = int(conf.get("max_age_days", 21))

    # 기존 데이터 로드
    existing = []
    if os.path.exists(OUT_PATH):
        try:
            existing = json.load(open(OUT_PATH, encoding="utf-8")).get("items", [])
        except Exception:
            existing = []

    by_key = {}
    order = []

    def add(it):
        k = norm_key(it["text"])
        if not k:
            return
        if k in by_key:
            return  # 중복(채널 간 리포스트 포함) 제거 — 먼저 본 것 유지
        by_key[k] = it
        order.append(k)

    # 기존 것 먼저(우선 유지)
    for it in existing:
        add(it)

    # 채널별 수집
    titles = {}
    for u in channels:
        try:
            title, items = parse_channel(u)
            titles[u] = title
            for it in items:
                it2 = {"channel": u, "channel_title": title,
                       "date": it["date"], "text": it["text"], "link": it["link"]}
                add(it2)
            print(f"  {u}: {len(items)}건 수집 (채널명 {title})")
        except Exception as e:
            print(f"  {u}: 실패 — {type(e).__name__} {str(e)[:60]}")

    # 채널 제목 최신화(기존 항목에도 반영)
    items_all = [by_key[k] for k in order]
    for it in items_all:
        if it.get("channel") in titles:
            it["channel_title"] = titles[it["channel"]]

    # 기간/개수 제한 + 최신순 정렬
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    items_all = [it for it in items_all if to_dt(it.get("date", "")) >= cutoff]
    items_all.sort(key=lambda it: to_dt(it.get("date", "")), reverse=True)
    items_all = items_all[:keep]

    # 30분마다 돈다 → 새 글이 없으면(목록이 그대로면) 파일을 다시 쓰지 않는다(커밋 안 생김)
    if [it.get("link") for it in items_all] == [it.get("link") for it in existing]:
        print(f"새 글 없음 — {OUT_PATH} 그대로 둠")
        return
    out = {
        "updated": datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=9)))
                   .strftime("%Y-%m-%d %H:%M KST"),
        "channels": [{"username": u, "title": titles.get(u, u)} for u in channels],
        "count": len(items_all),
        "items": items_all,
    }
    json.dump(out, open(OUT_PATH, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"저장: {OUT_PATH} · {len(items_all)}건 · 채널 {len(channels)}개")


if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
