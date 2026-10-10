#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
track_fetch.py — '트래킹' 단어(섹터·기업)별 새 뉴스 후보 모으기 (30분마다, 예약 작업 vantage-tracking)

1) 텔레그램 봇 명령 처리: /추가 네비우스 · /삭제 네비우스 · /목록  (처음 명령한 사람만 주인으로 인정)
2) docs/data/tracking/watchlist.json 의 단어마다 출처를 훑어 새 기사만 data_sources/_tracking_candidates.json 에 쓴다
   해외(market us): 구글 뉴스(로이터·블룸버그·CNBC·WSJ·배런스·마켓워치·FT·디인포메이션·AP·악시오스만) + 시킹알파·야후·나스닥 종목 피드
   한국(market kr): 구글 뉴스(한경·매경·이데일리·머니투데이·서울경제·연합·조선비즈·더벨·인포맥스·뉴스1·헤럴드경제만) + 한경 증권·연합 경제 피드
   섹터·주제(market theme): 해외·한국 둘 다
3) 잡글(추천주·"1,000달러 넣으면"·주가만 읊는 자동 기사 등)과 제목에 단어가 없는 기사는 여기서 1차로 뺀다.
   남은 후보를 Claude 가 읽고 걸러 요약한 뒤 track_apply.py 로 반영한다.

  python track_fetch.py            # 후보 수를 마지막 줄에 출력 ("후보 N건")
  python track_fetch.py --no-tg    # 텔레그램 명령 처리 건너뛰기
"""
import hashlib
import html
import json
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
WATCH = os.path.join(BASE, "docs", "data", "tracking", "watchlist.json")
STATE = os.path.join(BASE, "data_sources", "tracking_state.json")
CAND = os.path.join(BASE, "data_sources", "_tracking_candidates.json")
KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)

EN_SITES = ["reuters.com", "bloomberg.com", "cnbc.com", "wsj.com", "barrons.com", "marketwatch.com", "ft.com",
            "theinformation.com", "apnews.com", "axios.com", "finance.yahoo.com"]
KO_SITES = ["hankyung.com", "mk.co.kr", "edaily.co.kr", "mt.co.kr", "sedaily.com", "yna.co.kr", "biz.chosun.com",
            "thebell.co.kr", "news.einfomax.co.kr", "news1.kr", "heraldcorp.com"]
KO_FEEDS = ["https://www.hankyung.com/feed/finance", "https://www.yna.co.kr/rss/economy.xml"]

# 잡글: 추천·전망 낚시, 장기 가정, 자동 생성 시세 기사
JUNK = re.compile(
    r"(stocks? to (buy|watch|own)|should you buy|is it (time|too late) to buy|buy (now|right now)\??|"
    r"\binvested in\b|could be worth|millionaire|prediction:|\bmy top\b|\b\d+ (growth|ai|top|best) stocks?\b|"
    r"best stocks?|motley fool|zacks rank|strong buy|here'?s why|what you need to know|top (picks|stocks)|"
    r"wallstreetbets|social buzz|unusual options|options (activity|trading)|short interest|price target (raised|lowered) to \$?\d|"
    r"\bvs\.?\b.*which (stock|is)|economic moat|better buy|better .{0,30} pick|which .{0,20}stock is|"
    r"(in|out)flows detected|advanced charts|research & ratings|company & people|\| [A-Z]{1,5}$|"
    r"stock (quote|price) (today|history)|earnings (preview|call transcript)|"
    r"추천주|급등주|테마주 정리|오늘의 특징주|특징주 \]|\[마감시황\]|\[개장시황\]|장마감|주가 (\d|상승|하락) ?(%|률)|"
    r"\[포토\]|\[인사\]|\[부고\]|\[게시판\])", re.I)
JUNK_SRC = re.compile(r"(fool\.com|motley fool|zacks|insidermonkey|investorplace|247wallst|24/7 wall|tipranks|"
                      r"gurufocus|marketbeat|simply wall|stocktwits|benzinga|finbold|coincodex)", re.I)

CTX = None


def http(url, timeout=25):
    global CTX
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (VANTAGE tracking)"})
    for ctx in ([CTX] if CTX else [None, ssl._create_unverified_context()]):
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                CTX = ctx
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            err = e
    raise err


def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def slugify(term, ticker=""):
    if ticker:
        return re.sub(r"[^a-z0-9]+", "-", ticker.lower()).strip("-")
    a = re.sub(r"[^a-z0-9]+", "-", term.lower()).strip("-")
    return a if a and a.isascii() and len(a) >= 2 else "t-" + hashlib.md5(term.encode("utf-8")).hexdigest()[:8]


def norm_title(t):
    t = re.sub(r"\s+[-|·]\s+[^-|·]{2,40}$", "", t or "")           # 구글 뉴스 제목 끝 '- 매체명' 제거
    return re.sub(r"[\W_]+", "", t.lower())[:80]


# ── 1) 텔레그램 명령 ──────────────────────────────────────────
def telegram_commands(watch, state):
    try:
        import send_telegram as tg
        ups = tg.api("getUpdates", {"offset": state.get("tg_offset", 0), "timeout": 0,
                                    "allowed_updates": json.dumps(["message", "channel_post"])})
    except SystemExit:
        return False
    except Exception as e:
        print("텔레그램 명령 확인 실패:", e)
        return False
    changed = False
    for u in ups:
        state["tg_offset"] = u["update_id"] + 1
        m = u.get("message") or u.get("channel_post") or {}
        text = (m.get("text") or "").strip()
        chat = m.get("chat") or {}
        who = (m.get("from") or {}).get("id") or chat.get("id")
        mt = re.match(r"^/?(추가|삭제|목록|add|del|list)(?:@\w+)?\s*(.*)$", text, re.I)
        if not mt:
            continue
        if not state.get("owner"):
            state["owner"] = who                       # 처음 명령한 사람이 주인
        if who != state["owner"] and chat.get("id") != state.get("channel"):
            continue
        cmd, arg = mt.group(1).lower(), mt.group(2).strip().strip('"\'')
        terms = watch.setdefault("terms", [])
        if cmd in ("추가", "add") and arg:
            new, dup = [], []
            for term, tk in split_terms(arg):          # 쉼표로 여러 개 보내도 하나씩 따로
                if any(t["term"] == term for t in terms):
                    dup.append(term)
                    continue
                terms.append({"term": term, "slug": slugify(term, tk), "market": "", "ticker": tk,
                              "aliases": [term] + ([tk] if tk else []), "resolved": False,
                              "added": NOW.strftime("%Y-%m-%d %H:%M"), "by": "telegram"})
                new.append(term)
            changed = changed or bool(new)
            reply = (("✅ 트래킹 추가: " + " ".join(f"#{hashtag(x)}" for x in new) + "\n다음 수집(30분 이내)부터 관련 뉴스를 보냅니다.")
                     if new else "") + (("\n" if new else "") + "이미 트래킹 중: " + " ".join(f"#{hashtag(x)}" for x in dup) if dup else "")
        elif cmd in ("삭제", "del") and arg:
            gone = [term for term, _ in split_terms(arg) if any(t["term"] == term for t in watch["terms"])]
            watch["terms"] = [t for t in watch["terms"] if t["term"] not in gone]
            changed = changed or bool(gone)
            reply = ("🗑 트래킹 삭제: " + ", ".join(gone)) if gone else f"목록에 없는 단어: {arg}"
        else:
            reply = "📋 트래킹 목록\n" + ("\n".join(f"#{hashtag(t['term'])}" for t in terms) or "(비어 있음)") + \
                    "\n\n/추가 단어 · /삭제 단어"
        try:
            tg.api("sendMessage", {"chat_id": chat.get("id"), "text": reply})
        except Exception:
            pass
    return changed


def hashtag(term):
    return re.sub(r"[^\w가-힣]", "", term.replace(" ", "_"))


def split_terms(arg):
    """'/추가 기판(티엘비, 심텍), 아마존(AMZN), 메타' → [('기판',''), ('티엘비',''), ('심텍',''), ('아마존','AMZN'), ('메타','')]
    쉼표·줄바꿈·슬래시로 나눈다. 괄호 안이 목록이면 묶음 이름과 안의 이름을 각각, 괄호 안이 영문 한 단어면 티커로 본다."""
    out = []

    def group(m):
        head, inner = m.group(1).strip(), m.group(2)
        parts = [p.strip() for p in re.split(r"[,/·\n]+", inner) if p.strip()]
        if len(parts) == 1 and re.fullmatch(r"[A-Za-z0-9.\-]{1,10}", parts[0]):
            return f"{head}\x00{parts[0].upper()}"          # 아마존(AMZN) → 티커 힌트
        return ",".join(([head] if head else []) + parts)
    s = re.sub(r"([^,(\n]*)\(([^)]*)\)", group, arg)
    for p in re.split(r"[,/·\n]+", s):
        p = p.strip().strip('"\'')
        if not p:
            continue
        term, _, tk = p.partition("\x00")
        if term.strip() and term.strip() not in [t for t, _ in out]:
            out.append((term.strip(), tk))
    return out


# ── 2) 출처별 수집 ────────────────────────────────────────────
def parse_rss(xml, default_src=""):
    out = []
    for it in re.findall(r"<item\b.*?</item>", xml, re.S):
        def tag(n):
            m = re.search(rf"<{n}\b[^>]*>(.*?)</{n}>", it, re.S)
            v = m.group(1) if m else ""
            v = re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", v.strip(), flags=re.S)
            return html.unescape(re.sub(r"<[^>]+>", " ", v)).strip()
        src = tag("source") or default_src
        try:
            pub = parsedate_to_datetime(tag("pubDate")).astimezone(KST)
        except Exception:
            continue
        title = re.sub(r"\s+", " ", tag("title"))
        link = tag("link") or (re.search(r"<link>(.*?)</link>", it, re.S) or [None, ""])[1]
        out.append({"title": title, "url": link.strip(), "source": src, "published": pub,
                    "snippet": re.sub(r"\s+", " ", tag("description"))[:400]})
    return out


def gnews(query, sites, lang):
    q = f"({query}) ({' OR '.join('site:' + s for s in sites)}) when:2d"
    hl = "hl=en-US&gl=US&ceid=US:en" if lang == "en" else "hl=ko&gl=KR&ceid=KR:ko"
    items = parse_rss(http("https://news.google.com/rss/search?q=" + urllib.parse.quote(q) + "&" + hl))
    for it in items:   # 구글 뉴스 제목 끝의 ' - 매체명' 은 떼고 매체 칸으로
        it["title"] = re.sub(r"\s+-\s+[^-]{2,40}$", "", it["title"])
    return items


def fetch_term(t):
    aliases = [a for a in (t.get("aliases") or [t["term"]]) if a]
    market = t.get("market") or ("kr" if re.search(r"[가-힣]", t["term"]) else "us")
    en = [a for a in aliases if not re.search(r"[가-힣]", a)]
    ko = [a for a in aliases if re.search(r"[가-힣]", a)] or [t["term"]]
    q = lambda xs: " OR ".join(f'"{x}"' for x in xs)
    got, errs = [], []

    def add(fn, *a):
        try:
            got.extend(fn(*a))
        except Exception as e:
            errs.append(f"{fn.__name__}: {str(e)[:80]}")

    if market in ("us", "theme") and en:
        add(gnews, q(en), EN_SITES, "en")
    if market in ("kr", "theme") or (market == "us" and not en):
        add(gnews, q(ko), KO_SITES, "ko")
        for f in KO_FEEDS:
            add(lambda u: parse_rss(http(u), urllib.parse.urlparse(u).netloc), f)
    tk = (t.get("ticker") or "").upper()
    if market == "us" and tk:
        add(lambda: parse_rss(http(f"https://seekingalpha.com/api/sa/combined/{tk}.xml"), "Seeking Alpha"))
        add(lambda: parse_rss(http(f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={tk}&region=US&lang=en-US"), "Yahoo Finance"))
        add(lambda: parse_rss(http(f"https://www.nasdaq.com/feed/rssoutbound?symbol={tk}"), "Nasdaq"))
    return got, errs, aliases + ([tk] if tk else [])


# ── 3) 최근 일주일 중복 확인(2026-10-10 사용자 지시: 새롭고 가장 최근 뉴스만, 지난 보도를 재탕한 기사는 뺀다) ──
STOP = set("the a an of to in on for and with is are as at by from its after over new says said will stock stocks shares "
           "inc corp group co ltd plc 및 등 의 에 를 을 이 가 은 는 와 과 로 으로 한다 했다 위해 대한 관련".split())


def sim(a, b):
    from difflib import SequenceMatcher
    return SequenceMatcher(None, norm_title(a), norm_title(b)).ratio()


def key_words(title, n=7):
    t = re.sub(r"[^\w가-힣$%.\- ]", " ", title)
    ws = [w for w in t.split() if w.lower() not in STOP and len(w) > 1]
    return ws[:n]


def week_check(cands, watch):
    """후보마다 ① 지난 7일 이미 보낸 기사(모든 단어) 중 비슷한 것 ② 다른 매체가 12시간 넘게 먼저 낸 비슷한 기사를 붙인다."""
    from datetime import datetime as _dt
    cut = (NOW - timedelta(days=7)).strftime("%Y-%m-%d %H:%M")
    sent = []
    for t in watch.get("terms", []):
        for it in load(os.path.join(BASE, "docs", "data", "tracking", "items", t["slug"] + ".json"), {}).get("items", []):
            if (it.get("published") or "") >= cut:
                sent.append(it)
    for c in cands[:40]:
        if "earlier" in c:                                 # 지난번에 확인한 후보
            continue
        c["sent_similar"] = [{"headline": s["headline"], "title": s["title"], "published": s["published"]}
                             for s in sent if max(sim(c["title"], s["title"]), sim(c["title"], s["headline"])) >= 0.42][:3]
        kw = key_words(c["title"])
        c["earlier"] = []
        if len(kw) < 2:
            continue
        lang = "ko" if re.search(r"[가-힣]", c["title"]) else "en"
        hl = "hl=en-US&gl=US&ceid=US:en" if lang == "en" else "hl=ko&gl=KR&ceid=KR:ko"
        try:
            got = parse_rss(http("https://news.google.com/rss/search?q=" + urllib.parse.quote(" ".join(kw) + " when:7d") + "&" + hl))
        except Exception:
            continue
        mine = _dt.strptime(c["published"][:16], "%Y-%m-%d %H:%M").replace(tzinfo=KST)
        for g in got:
            g["title"] = re.sub(r"\s+-\s+[^-]{2,40}$", "", g["title"])
            if g["published"] < mine - timedelta(hours=12) and sim(c["title"], g["title"]) >= 0.38:
                c["earlier"].append({"title": g["title"], "source": g["source"], "published": g["published"].strftime("%Y-%m-%d %H:%M KST")})
        c["earlier"] = sorted(c["earlier"], key=lambda x: x["published"])[:4]
    return cands


def main():
    a = sys.argv[1:]
    watch = load(WATCH, {"schema": 1, "terms": []})
    state = load(STATE, {"tg_offset": 0, "seen": {}})
    changed = False if "--no-tg" in a else telegram_commands(watch, state)
    if changed:
        watch["updated"] = NOW.strftime("%Y-%m-%d %H:%M KST")
        save(WATCH, watch)

    seen = state.setdefault("seen", {})
    # 지난번 후보를 아직 반영 못 했으면(요약 도중 실패 등) 이어서 처리
    cands = [c for c in load(CAND, {}).get("candidates", []) if any(t["term"] == c["term"] for t in watch.get("terms", []))]
    report = [f"지난번 미처리 후보 {len(cands)}건 이어서"] if cands else []
    for t in watch.get("terms", []):
        slug = t.setdefault("slug", slugify(t["term"], t.get("ticker", "")))
        first = slug not in state.setdefault("started", {})
        since = NOW - timedelta(hours=24 if first else 36)       # 새 단어는 최근 24시간만(첫 수집 폭주 방지)
        items, errs, keys = fetch_term(t)
        keys_l = [k.lower() for k in keys if k]
        kept = 0
        for it in sorted(items, key=lambda x: x["published"], reverse=True):
            nt = norm_title(it["title"])
            sid = hashlib.md5((slug + nt).encode("utf-8")).hexdigest()[:12]
            if not nt or sid in seen or it["published"] < since:
                continue
            seen[sid] = NOW.strftime("%Y-%m-%d")                   # 후보로 올린 건 다시 안 올림(채택·탈락 무관)
            text = (it["title"] + " " + it["snippet"]).lower()
            if JUNK.search(it["title"]) or JUNK_SRC.search(it["source"] + " " + it["url"]):
                continue
            if not any(k in it["title"].lower() for k in keys_l) and not any(k in text for k in keys_l):
                continue
            if any(norm_title(c["title"]) == nt for c in cands):
                continue
            cands.append({"id": sid, "term": t["term"], "slug": slug, "source": it["source"], "url": it["url"],
                          "title": it["title"], "snippet": it["snippet"],
                          "published": it["published"].strftime("%Y-%m-%d %H:%M KST")})
            kept += 1
        state["started"][slug] = state["started"].get(slug) or NOW.strftime("%Y-%m-%d %H:%M")
        report.append(f"#{hashtag(t['term'])} 원문 {len(items)} → 후보 {kept}" + (f" (실패: {'; '.join(errs)})" if errs else ""))

    cands = week_check(cands, watch)
    flagged = sum(1 for c in cands if c.get("earlier") or c.get("sent_similar"))
    if flagged:
        report.append(f"지난 7일 비슷한 보도가 있는 후보 {flagged}건(재탕 여부 확인 필요)")

    # 오래된 기록 정리(10일)
    cut = (NOW - timedelta(days=10)).strftime("%Y-%m-%d")
    state["seen"] = {k: v for k, v in seen.items() if v >= cut}
    save(STATE, state)
    unresolved = [t["term"] for t in watch.get("terms", []) if not t.get("resolved")]
    save(CAND, {"generated": NOW.strftime("%Y-%m-%d %H:%M KST"), "unresolved": unresolved, "candidates": cands})
    for r in report:
        print(r)
    if unresolved:
        print("정보 확인 필요(시장·티커·영문 이름):", ", ".join(unresolved))
    print(f"후보 {len(cands)}건" + (" · 목록 바뀜" if changed else ""))


if __name__ == "__main__":
    main()
