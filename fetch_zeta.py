#!/usr/bin/env python3
"""스캐터랩(제타) 트래픽 지표 수집 → docs/data/zeta.json

비상장이라 주가가 없으므로, 공개·무료로 매일/매달 얻을 수 있는 대리 지표를 모은다.
각 수집기는 실패해도 이전 값을 유지한다(빈 값은 0으로 채우지 않는다).
사용법: python fetch_zeta.py [--only crux,tranco,...]

수집기(키가 필요한 것은 환경변수가 있을 때만 실행):
  crux     크롬 사용자 기준 국가별 인기 순위 구간(월간)   GitHub 공개 CSV
  tranco   도메인 글로벌 순위(일간)                        tranco-list.eu API
  (앱·검색·유튜브·고용 등은 아래에 이어서 추가)
"""
import argparse
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "zeta.json")
MANUAL = os.path.join(BASE, "data_sources", "zeta_manual.json")
KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
TODAY = NOW.date().isoformat()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"

DOMAIN = "zeta-ai.io"
IOS_ID = "1619030760"
ANDROID_ID = "com.scatterlab.messenger"
COUNTRIES = {"kr": "한국", "jp": "일본", "us": "미국", "tw": "대만", "vn": "베트남", "ph": "필리핀", "id": "인도네시아", "th": "태국"}


def http(url, headers=None, data=None, timeout=40, retries=2, raw=False):
    hdr = {"User-Agent": UA, **(headers or {})}
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdr, data=data)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return body if raw else body.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 401, 403, 404):
                raise
        except Exception as e:  # 네트워크 일시 오류는 재시도
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise last


def jget(url, headers=None):
    return json.loads(http(url, headers=headers))


# ── 저장 구조 ──────────────────────────────────────────────────────────
class Store:
    def __init__(self, prev):
        self.prev = prev or {}
        self.series = {s["id"]: s for s in self.prev.get("series", [])}
        self.errors = []
        self.state = self.prev.get("state", {})

    def upsert(self, sid, meta, points=None, replace=False):
        """meta 는 매번 덮어쓰고, points 는 날짜 기준으로 병합한다(과거 값 보존)."""
        s = self.series.get(sid, {"id": sid, "points": []})
        s.update({k: v for k, v in meta.items() if k != "points"})
        if points is not None:
            merged = {} if replace else {p["date"]: p for p in s.get("points", [])}
            for p in points:
                if p.get("value") is None:
                    continue
                merged[p["date"]] = p
            s["points"] = [merged[d] for d in sorted(merged)]
        s["checked_at"] = NOW.isoformat(timespec="seconds")
        self.series[sid] = s

    def error(self, name, e):
        msg = f"{name}: {type(e).__name__}: {str(e)[:200]}"
        print("  [warn]", msg)
        self.errors.append({"collector": name, "message": msg, "at": NOW.isoformat(timespec="seconds")})


COLLECTORS = []


def collector(name):
    def deco(fn):
        COLLECTORS.append((name, fn))
        return fn
    return deco


# ── 1. CrUX 국가별 인기 순위 구간 (월간) ───────────────────────────────
CRUX_REPO = "https://raw.githubusercontent.com/InternetHealthReport/crux-top-lists-country/main/data/country/{cc}/{ym}.csv.gz"
CRUX_LIST = "https://api.github.com/repos/InternetHealthReport/crux-top-lists-country/contents/data/country/{cc}"
CRUX_FROM = "202401"


def crux_rank(cc, ym):
    """해당 국가·월 목록에서 https://zeta-ai.io 의 순위 구간을 찾는다. 없으면 None(목록 밖)."""
    raw = http(CRUX_REPO.format(cc=cc, ym=ym), raw=True, timeout=120)
    target = f"https://{DOMAIN},".encode()
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as f:
        for line in f:
            if line.startswith(target):
                return int(line.strip().split(b",")[1])
    return None


@collector("crux")
def c_crux(st):
    done = st.state.setdefault("crux_done", {})
    for cc, name in COUNTRIES.items():
        try:
            months = sorted(x["name"][:6] for x in jget(CRUX_LIST.format(cc=cc)) if x["name"].endswith(".csv.gz"))
        except Exception as e:
            st.error(f"crux list {cc}", e)
            continue
        months = [m for m in months if m >= CRUX_FROM and m not in done.get(cc, [])]
        pts = []
        for ym in months[-40:]:
            try:
                r = crux_rank(cc, ym)
            except Exception as e:
                st.error(f"crux {cc} {ym}", e)
                continue
            # 목록 밖(100만 위 밖)은 값이 없는 것이지 0이 아니다 → 점을 찍지 않고 기록만 남긴다
            if r is not None:
                pts.append({"date": f"{ym[:4]}-{ym[4:]}-01", "value": r})
            done.setdefault(cc, []).append(ym)
            time.sleep(0.3)
        st.upsert(f"web_crux_{cc}", {
            "group": "web", "country": cc, "label": f"웹 인기 순위 구간 · {name}", "unit": "위 이내", "kind": "rank_bucket",
            "cadence": "월간 · 다음 달 둘째 주 공개", "source": "Chrome UX Report (국가별 top 목록)",
            "source_url": "https://github.com/InternetHealthReport/crux-top-lists-country",
            "note": "크롬 사용자의 실제 방문 기준. 1천·5천·1만·5만·10만·50만·100만 구간이라 거칠고, 값이 작을수록 인기. 인앱 웹뷰는 빠진다.",
        }, pts)


# ── 2. Tranco 글로벌 도메인 순위 (일간) ─────────────────────────────────
@collector("tranco")
def c_tranco(st):
    d = jget(f"https://tranco-list.eu/api/ranks/domain/{DOMAIN}")
    pts = [{"date": r["date"], "value": r["rank"]} for r in d.get("ranks", []) if r.get("rank")]
    st.upsert("web_tranco", {
        "group": "web", "country": "global", "label": "웹 글로벌 순위 (Tranco)", "unit": "위", "kind": "rank",
        "cadence": "일간 · API는 최근 30일(매일 쌓아 보존)", "source": "Tranco list", "source_url": f"https://tranco-list.eu/api/ranks/domain/{DOMAIN}",
        "note": "여러 순위 목록을 30일 평균해 합친 순위. 값이 작을수록 인기.",
    }, pts)


# ── 3. Google Play 누적 설치·리뷰 (일간 스냅샷) ─────────────────────────
@collector("gplay")
def c_gplay(st):
    from google_play_scraper import app as gp_app  # requirements: google-play-scraper
    base = {"cadence": "일간 스냅샷 · 매일 쌓아 추이 계산", "source": "Google Play 공개 페이지",
            "source_url": f"https://play.google.com/store/apps/details?id={ANDROID_ID}"}
    first = None
    for cc, lang in (("kr", "ko"), ("jp", "ja"), ("us", "en")):
        try:
            r = gp_app(ANDROID_ID, lang=lang, country=cc)
        except Exception as e:
            st.error(f"gplay {cc}", e)
            continue
        first = first or r
        if r.get("reviews"):
            st.upsert(f"app_gplay_reviews_{cc}", {**base, "group": "download", "country": cc, "label": f"구글플레이 리뷰 수 · {COUNTRIES[cc]} 스토어",
                      "unit": "개", "kind": "cumulative", "note": "해당 언어·국가 스토어에 보이는 글 리뷰 누적 수. 늘어나는 속도가 신규 설치의 대리 지표."},
                      [{"date": TODAY, "value": int(r["reviews"])}])
        time.sleep(1)
    if first and first.get("realInstalls"):
        st.upsert("app_gplay_installs", {**base, "group": "download", "country": "global", "label": "구글플레이 누적 설치 (전 세계)",
                  "unit": "회", "kind": "cumulative", "note": "[원천] 구글플레이 앱 페이지 HTML에 들어 있는 정확한 누적 설치 수(realInstalls). 화면에는 '500만+'처럼 구간으로만 보인다. 국가 구분 없음. 과거 값은 인터넷 아카이브(웨이백 머신)에 보관된 페이지(2022-11~, 약 40개 시점)에서 읽었고, 2026-09-20 이후는 매일 수집한다."},
                  [{"date": TODAY, "value": int(first["realInstalls"])}])
    if first and first.get("ratings"):
        st.upsert("app_gplay_ratings", {**base, "group": "download", "country": "global", "label": "구글플레이 별점 수 (전 세계)",
                  "unit": "개", "kind": "cumulative", "note": "별점만 남긴 것까지 포함한 누적 수."},
                  [{"date": TODAY, "value": int(first["ratings"])}])


# ── 2-1. 구글 트렌드 국가별 월간 검색 관심도 ─────────────────────────────
# 나라마다 제타를 찾는 표현이 달라, 2023년 검색량이 거의 0(= 제타와 무관한 검색이 섞이지 않음)인 검색어만 골랐다.
GTRENDS = {
    "global": ("", "전 세계", ["zeta ai", "제타 ai", "ゼタ ai"]),
    "kr": ("KR", "한국", ["제타 ai", "제타ai", "zeta ai"]),
    "jp": ("JP", "일본", ["zeta ai", "ゼタ ai", "zeta アプリ"]),
    "us": ("US", "미국", ["zeta ai", "zeta app"]),
}


@collector("gtrends")
def c_gtrends(st):
    from trendspy import Trends  # requirements: trendspy
    tr = Trends()
    for key, (geo, name, kws) in GTRENDS.items():
        try:
            df = tr.interest_over_time(kws, geo=geo, timeframe="all")  # 2004년부터 월간
        except Exception as e:
            st.error(f"gtrends {key}", e)
            time.sleep(5)
            continue
        df = df[df.index >= "2023-01-01"]
        total = df[kws].sum(axis=1)
        top = float(total.max()) or 1.0
        partial = df["isPartial"] if "isPartial" in df.columns else None
        pts = []
        for ts, v in total.items():
            p = {"date": ts.strftime("%Y-%m-01"), "value": round(float(v) / top * 100, 1)}
            if partial is not None and bool(partial.loc[ts]):
                p["partial"] = True
            pts.append(p)
        st.upsert(f"search_gtrends_{key}", {"group": "search", "country": "global" if key == "global" else key,
                  "label": f"구글 검색 관심도 · {name}", "unit": "지수", "kind": "index", "cadence": "월간 · 매일 확인(이번 달은 진행 중)",
                  "source": "Google Trends", "source_url": "https://trends.google.com/trends/explore?date=all&q=" + urllib.parse.quote(",".join(kws)) + (f"&geo={geo}" if geo else ""),
                  "note": "[원천] 구글 트렌드 월간 검색 관심도. [산출] 검색어 " + " · ".join(kws) + " 을 한 번에 조회해(같은 척도) 합친 뒤 2023-01 이후 최댓값을 100으로 다시 맞췄다. "
                          "상대지수라 나라끼리 크기 비교는 안 되고 각 나라 안의 추세만 본다. 구글 사용 비중이 낮은 한국(네이버 중심)은 과소 대표될 수 있다."},
                  pts, replace=True)
        time.sleep(4)


# ── 3-0. 구글플레이 국가별 월 신규 리뷰 수 (리뷰 작성일 기준, 출시 때부터 복원) ──
GP_REVIEW_STORES = (("kr", "ko"), ("jp", "ja"), ("us", "en"))


@collector("gpreviews")
def c_gpreviews(st):
    from google_play_scraper import reviews as gp_reviews, Sort
    box = st.state.setdefault("gp_reviews", {})
    for cc, lang in GP_REVIEW_STORES:
        cur = box.setdefault(cc, {"counts": {}, "newest": None})
        newest_seen, newest_now, tok, pages = cur.get("newest"), cur.get("newest"), None, 0
        added = {}
        try:
            while pages < 600:  # 최초 1회는 전체(수백 쪽), 이후에는 새 리뷰가 있는 앞쪽 몇 쪽만 읽는다
                batch, tok = gp_reviews(ANDROID_ID, lang=lang, country=cc, sort=Sort.NEWEST, count=200, continuation_token=tok)
                pages += 1
                stop = False
                for r in batch:
                    at = r["at"].isoformat()
                    if newest_seen and at <= newest_seen:
                        stop = True
                        break
                    ym = at[:7]
                    added[ym] = added.get(ym, 0) + 1
                    if not newest_now or at > newest_now:
                        newest_now = at
                if stop or not batch or not tok:
                    break
                time.sleep(0.3)
        except Exception as e:
            st.error(f"gpreviews {cc}", e)
            continue  # 중간 실패 시 이번 결과는 버리고 다음 실행에서 다시 읽는다(중복 집계 방지)
        for ym, n in added.items():
            cur["counts"][ym] = cur["counts"].get(ym, 0) + n
        cur["newest"] = newest_now
        this_month = TODAY[:7]
        pts = [{"date": ym + "-01", "value": n, **({"partial": True} if ym == this_month else {})} for ym, n in sorted(cur["counts"].items())]
        st.upsert(f"app_gplay_newreviews_{cc}", {"group": "download", "country": cc, "label": f"구글플레이 월 신규 리뷰 · {COUNTRIES[cc]} 스토어", "unit": "개", "kind": "flow",
                  "cadence": "월간 · 리뷰 작성일 기준", "source": "Google Play 리뷰 (공개 페이지)", "source_url": f"https://play.google.com/store/apps/details?id={ANDROID_ID}",
                  "note": "그 달에 새로 달린 글 리뷰 수(해당 언어·국가 스토어). 신규 설치·활성 사용자의 국가별 대리 지표. 한국 사용자가 리뷰를 더 많이 쓰는 경향이 있어 국가 간 절대 비교는 주의."},
                  pts, replace=True)


# ── 3-1. 웨이백 머신 과거 스냅샷으로 누적값 복원 (구글플레이 설치 · 앱스토어 평점 수) ──
GP_INSTALLS = re.compile(r'\["([\d,.]+\+?)",(\d+),(\d+),"([^"]*)"\]')
AS_RATINGS = re.compile(r'"aggregateRating"\s*:\s*\{[^}]*?"(?:reviewCount|ratingCount)"\s*:\s*"?(\d+)')


def wb_get(ts, original):
    """웨이백 원본(id_) 페이지. gzip 으로 오는 경우가 있어 직접 푼다."""
    b = http(f"https://web.archive.org/web/{ts}id_/{original}", headers={"Accept-Encoding": "gzip"}, raw=True, timeout=120)
    if b[:2] == b"\x1f\x8b":
        b = gzip.decompress(b)
    return b.decode("utf-8", "replace")


def wb_list(url, prefix=False, flt=None):
    q = {"url": url, "output": "json", "fl": "timestamp,original", "filter": "statuscode:200", "collapse": "timestamp:8"}
    if prefix:
        q["matchType"] = "prefix"
    qs = urllib.parse.urlencode(q) + (("&filter=" + urllib.parse.quote(flt)) if flt else "")
    rows = jget(f"https://web.archive.org/cdx/search/cdx?{qs}")
    return [(r[0], r[1]) for r in rows[1:]]


@collector("wayback")
def c_wayback(st):
    done = st.state.setdefault("wayback_done", {})
    # 구글플레이 누적 설치(전 세계)
    seen = set(done.get("play", []))
    pts = []
    try:
        snaps = wb_list(f"play.google.com/store/apps/details?id={ANDROID_ID}", prefix=True)
    except Exception as e:
        st.error("wayback play list", e)
        snaps = []
    by_day = {}
    for ts, orig in snaps:
        by_day.setdefault(ts[:8], (ts, orig))
    for day, (ts, orig) in sorted(by_day.items()):
        if day in seen:
            continue
        try:
            m = GP_INSTALLS.search(wb_get(ts, orig))
        except Exception as e:
            st.error(f"wayback play {day}", e)
            continue
        if m:
            pts.append({"date": f"{day[:4]}-{day[4:6]}-{day[6:]}", "value": int(m.group(3)), "src": "wayback"})
        seen.add(day)
        time.sleep(1.2)
    done["play"] = sorted(seen)
    if pts:
        st.upsert("app_gplay_installs", {"group": "download", "country": "global", "label": "구글플레이 누적 설치 (전 세계)", "unit": "회", "kind": "cumulative",
                  "cadence": "일간 스냅샷 · 과거는 웨이백 머신 보관본", "source": "Google Play 공개 페이지 · Internet Archive",
                  "source_url": f"https://play.google.com/store/apps/details?id={ANDROID_ID}",
                  "note": "[원천] 구글플레이 앱 페이지 HTML에 들어 있는 정확한 누적 설치 수(realInstalls). 화면에는 '500만+'처럼 구간으로만 보인다. 국가 구분 없음. 과거 값은 인터넷 아카이브(웨이백 머신)에 보관된 페이지(2022-11~, 약 40개 시점)에서 읽었고, 2026-09-20 이후는 매일 수집한다."}, pts)
    # 앱스토어 국가별 누적 평점 수
    for cc in ("kr", "jp", "us"):
        key = f"appstore_{cc}"
        seen = set(done.get(key, []))
        pts = []
        try:
            snaps = wb_list(f"apps.apple.com/{cc}/app/", prefix=True, flt=f"original:.*{IOS_ID}.*")
        except Exception as e:
            st.error(f"wayback appstore {cc} list", e)
            continue
        by_day = {}
        for ts, orig in snaps:
            by_day.setdefault(ts[:8], (ts, orig))
        for day, (ts, orig) in sorted(by_day.items()):
            if day in seen:
                continue
            try:
                m = AS_RATINGS.search(wb_get(ts, orig))
            except Exception as e:
                st.error(f"wayback appstore {cc} {day}", e)
                continue
            if m:
                pts.append({"date": f"{day[:4]}-{day[4:6]}-{day[6:]}", "value": int(m.group(1)), "src": "wayback"})
            seen.add(day)
            time.sleep(1.2)
        done[key] = sorted(seen)
        if pts:
            st.upsert(f"app_ios_ratings_{cc}", ios_ratings_meta(cc), pts)


# ── 3-2. 앱스토어 국가별 누적 평점 수 + 스토어 설명의 캐릭터 수 (애플 공식 조회 API) ──
IOS_COUNTRIES = ["kr", "jp", "us", "tw", "ph", "vn"]


def ios_ratings_meta(cc):
    return {"group": "download", "country": cc, "label": f"앱스토어 누적 평점 수 · {COUNTRIES.get(cc, cc)}", "unit": "개", "kind": "cumulative",
            "cadence": "일간 · 과거는 웨이백 머신 보관본", "source": "Apple iTunes Lookup API",
            "source_url": f"https://itunes.apple.com/lookup?id={IOS_ID}&country={cc}",
            "note": "국가별 스토어의 누적 평점 수. 늘어나는 속도가 그 나라 iOS 신규 설치의 대리 지표(평점을 남기는 비율은 나라마다 다름)."}


def characters_from_text(text):
    """스토어 설명 문구의 '400만 개 이상' · '300万体以上' · '4 million characters' 같은 표현에서 캐릭터 수를 뽑는다."""
    for pat, mul in ((r"([\d,.]+)\s*만\s*(?:개|명의)?\s*(?:이상의\s*)?(?:캐릭터|AI)", 10000), (r"([\d,.]+)\s*万\s*(?:体|人|個)", 10000),
                     (r"([\d,.]+)\s*million\s+(?:characters|stories)", 1000000)):
        m = re.search(pat, text)
        if m:
            return int(float(m.group(1).replace(",", "")) * mul)
    return None


@collector("itunes")
def c_itunes(st):
    for cc in IOS_COUNTRIES:
        try:
            res = jget(f"https://itunes.apple.com/lookup?id={IOS_ID}&country={cc}").get("results") or []
        except Exception as e:
            st.error(f"itunes {cc}", e)
            continue
        if not res:
            continue
        r = res[0]
        if r.get("userRatingCount"):
            st.upsert(f"app_ios_ratings_{cc}", ios_ratings_meta(cc), [{"date": TODAY, "value": int(r["userRatingCount"])}])
        n = characters_from_text(r.get("description", ""))
        if n and cc in ("kr", "jp", "us"):
            st.upsert(f"content_store_characters_{cc}", {"group": "content", "country": cc, "label": f"스토어 설명의 캐릭터 수 · {COUNTRIES[cc]}", "unit": "개", "kind": "cumulative",
                      "cadence": "일간 확인 · 문구가 바뀔 때만 변함", "source": "App Store 설명 문구 (Apple Lookup API)",
                      "source_url": f"https://apps.apple.com/{cc}/app/id{IOS_ID}",
                      "note": "회사가 스토어 설명에 적은 반올림 수치(예: 400만 개 이상). 계단식으로만 움직인다. 제타 서버 자동 수집은 이용약관상 하지 않는다."},
                      [{"date": TODAY, "value": n}])
        time.sleep(0.4)


# ── 3-3. 앱스토어 국가별 무료·매출 순위 (애플 공개 RSS, 상위 100위) ──────────
CHARTS = {"free": ("topfreeapplications", "무료", "download"), "grossing": ("topgrossingapplications", "매출", "revenue")}
GENRES = {"all": ("", "전체"), "ent": ("/genre=6016", "엔터테인먼트")}


@collector("applerank")
def c_applerank(st):
    for cc in ("kr", "jp", "us"):
        for ck, (feed, cname, group) in CHARTS.items():
            for gk, (gpath, gname) in GENRES.items():
                sid = f"app_rank_ios_{cc}_{ck}_{gk}"
                try:
                    d = jget(f"https://itunes.apple.com/{cc}/rss/{feed}/limit=100{gpath}/json")
                except Exception as e:
                    st.error(f"applerank {cc} {ck} {gk}", e)
                    continue
                entries = (d.get("feed") or {}).get("entry") or []
                rank = next((i + 1 for i, e in enumerate(entries) if str(((e.get("id") or {}).get("attributes") or {}).get("im:id")) == IOS_ID), None)
                meta = {"group": group, "country": cc, "label": f"앱스토어 {cname} 순위 · {COUNTRIES[cc]} · {gname}", "unit": "위", "kind": "rank",
                        "cadence": "일간 · 월간은 월 평균", "source": "Apple iTunes RSS (상위 100위)",
                        "source_url": f"https://itunes.apple.com/{cc}/rss/{feed}/limit=100{gpath}/json",
                        "note": ("매출 순위는 그 나라 iOS 매출 규모의 대리 지표. " if ck == "grossing" else "무료 순위는 그 나라 신규 다운로드 속도의 대리 지표. ") +
                                "100위 밖인 날은 값을 비워 둔다(0이 아님)."}
                st.upsert(sid, meta, [{"date": TODAY, "value": rank}] if rank else [])
                time.sleep(0.3)


# ── 4. 유튜브 공식 채널 누적 조회수 (광고 조회수 대리 지표, 키 필요) ─────────
YT_CHANNELS = {"kr": "@zeta_official_KR", "jp": "@zeta_official_JP"}


def pending(st, sid, meta, note):
    """키가 없어 아직 못 받는 지표 — 카드에 '키 등록 대기'로 보이게 메타만 남긴다(값은 채우지 않음)."""
    if sid not in st.series or not st.series[sid].get("points"):
        st.upsert(sid, {**meta, "status": "needs_key", "status_note": note}, [])


@collector("youtube")
def c_youtube(st):
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    for cc, handle in YT_CHANNELS.items():
        sid = f"ads_youtube_views_{cc}"
        meta = {"group": "ads", "country": cc, "label": f"공식 유튜브 누적 조회수 · {COUNTRIES[cc]} 채널", "unit": "회", "kind": "cumulative",
                "cadence": "일간 스냅샷 · 월 증가분이 광고 조회 규모의 대리 지표", "source": f"YouTube Data API ({handle})",
                "source_url": f"https://www.youtube.com/{handle}",
                "note": "구독자에 비해 조회수가 매우 커서 대부분 광고 집행 조회로 추정. 미등록 광고 영상은 빠질 수 있다."}
        if not key:
            pending(st, sid, meta, "유튜브 API 키 등록 대기")
            continue
        q = urllib.parse.urlencode({"part": "statistics", "forHandle": handle, "key": key})
        items = jget(f"https://www.googleapis.com/youtube/v3/channels?{q}").get("items", [])
        if not items:
            st.error(f"youtube {cc}", Exception("채널을 찾지 못함"))
            continue
        stats = items[0]["statistics"]
        st.upsert(sid, {**meta, "status": "ok", "status_note": None}, [{"date": TODAY, "value": int(stats["viewCount"])}])
        st.upsert(f"ads_youtube_subs_{cc}", {**meta, "label": f"공식 유튜브 구독자 · {COUNTRIES[cc]} 채널", "unit": "명", "status": "ok",
                  "note": "자연 유입 관심도."}, [{"date": TODAY, "value": int(stats.get("subscriberCount", 0))}] if stats.get("subscriberCount") else [])


# ── 5. 국민연금 가입자 수 (월별 직원 수, 공공데이터포털 키 필요) ─────────────
NPS = "https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2"


@collector("nps")
def c_nps(st):
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    meta = {"group": "company", "country": "kr", "label": "국민연금 가입자 수 (직원 수)", "unit": "명", "kind": "count",
            "cadence": "월간 · 매달 말 갱신", "source": "국민연금공단 가입 사업장 내역 (공공데이터포털)",
            "source_url": "https://www.data.go.kr/data/3046071/openapi.do",
            "note": "사업장 가입자 기준이라 실제 인원과 약간 다를 수 있다. 성장 속도(채용)를 보는 대리 지표."}
    if not key:
        pending(st, "company_nps_employees", meta, "공공데이터포털 키 등록 대기")
        return
    q = urllib.parse.urlencode({"serviceKey": key, "wkplNm": "스캐터랩", "dataType": "json", "numOfRows": 20, "pageNo": 1})
    body = jget(f"{NPS}/getBassInfoSearchV2?{q}")
    items = (((body.get("response") or {}).get("body") or {}).get("items") or {}).get("item") or []
    items = items if isinstance(items, list) else [items]
    items = [i for i in items if "스캐터랩" in str(i.get("wkplNm", ""))]
    if not items:
        raise RuntimeError("스캐터랩 사업장을 찾지 못함")
    latest = max(items, key=lambda i: str(i.get("dataCrtYm", "")))
    q2 = urllib.parse.urlencode({"serviceKey": key, "seq": latest["seq"], "dataType": "json"})
    det = jget(f"{NPS}/getDetailInfoSearchV2?{q2}")
    it = (((det.get("response") or {}).get("body") or {}).get("item")) or {}
    ym = str(latest.get("dataCrtYm") or TODAY[:7].replace("-", ""))
    cnt = it.get("jnngpCnt")
    if cnt is None:
        raise RuntimeError("가입자 수 필드 없음")
    st.upsert("company_nps_employees", {**meta, "status": "ok", "status_note": None}, [{"date": f"{ym[:4]}-{ym[4:6]}-01", "value": int(cnt)}])
    amt = it.get("crrmmNtcAmt")
    if amt:
        st.upsert("company_nps_amount", {**meta, "label": "국민연금 당월 고지금액", "unit": "원", "status": "ok",
                  "note": "고지금액 ÷ 가입자 수 ÷ 보험료율로 평균 신고 소득을 대략 추정할 수 있다(상한 적용으로 과소 가능)."},
                  [{"date": f"{ym[:4]}-{ym[4:6]}-01", "value": int(amt)}])


# ── 6. 네이버 데이터랩 검색어 트렌드 (한국, 연령별, 키 필요) ───────────────
NAVER_KEYWORDS = ["제타 AI", "제타ai", "zeta ai", "제타 앱", "제타 캐릭터"]
NAVER_AGES = {"all": ("전체", []), "teen": ("13–18세", ["2"]), "young": ("19–24세", ["3"])}


@collector("naver")
def c_naver(st):
    cid, secret = os.environ.get("NAVER_CLIENT_ID", "").strip(), os.environ.get("NAVER_CLIENT_SECRET", "").strip()
    for key, (name, ages) in NAVER_AGES.items():
        sid = f"search_naver_{key}"
        meta = {"group": "search", "country": "kr", "label": f"네이버 검색 관심도 · {name}", "unit": "지수", "kind": "index",
                "cadence": "월간 · 매일 확인(이번 달은 진행 중)", "source": "네이버 데이터랩 검색어 트렌드 API",
                "source_url": "https://datalab.naver.com/keyword/trendSearch.naver",
                "note": "키워드 묶음 " + ", ".join(NAVER_KEYWORDS) + " 의 검색량 상대지수(기간 내 최대 = 100). 연령 그룹끼리 절대 크기 비교는 안 된다."}
        if not (cid and secret):
            pending(st, sid, meta, "네이버 API 키 등록 대기")
            continue
        body = {"startDate": "2024-01-01", "endDate": TODAY, "timeUnit": "month",
                "keywordGroups": [{"groupName": "제타", "keywords": NAVER_KEYWORDS}]}
        if ages:
            body["ages"] = ages
        res = json.loads(http("https://openapi.naver.com/v1/datalab/search", data=json.dumps(body).encode(),
                              headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": secret, "Content-Type": "application/json"}))
        data = (res.get("results") or [{}])[0].get("data", [])
        # 상대지수라 매번 전체를 다시 받아 통째로 교체한다
        st.upsert(sid, {**meta, "status": "ok", "status_note": None}, [{"date": d["period"], "value": round(d["ratio"], 2)} for d in data], replace=True)
        time.sleep(0.3)


# ── 누적값 → 월 증가분 (추정) ───────────────────────────────────────────
FLOW_FROM = ["app_gplay_installs", "app_ios_ratings_kr", "app_ios_ratings_jp", "app_ios_ratings_us", "app_gplay_reviews_kr", "app_gplay_reviews_jp",
             "ads_youtube_views_kr", "ads_youtube_views_jp"]
FLOW_LABEL = {"app_gplay_installs": "구글플레이 월 신규 설치 (전 세계, 추정)"}


def month_add(d, n):
    y, m = d.year + (d.month - 1 + n) // 12, (d.month - 1 + n) % 12 + 1
    return date(y, m, 1)


def clean_cumulative(points):
    """누적값은 줄 수 없으므로, 뒤 시점 값보다 큰 관측치(보관소가 다른 날짜 보관본을 돌려준 경우 등)는 뺀다."""
    pts = sorted([p for p in points if isinstance(p.get("value"), (int, float))], key=lambda p: p["date"])
    keep, floor = [], float("inf")
    for p in reversed(pts):
        if p["value"] <= floor:
            keep.append(p)
            floor = p["value"]
    return list(reversed(keep))


def derive_flows(st):
    """관측 시점이 불규칙한 누적값을 매월 1일 값으로 선형 보간한 뒤 차이를 월 증가분으로 만든다.
    양쪽 달 경계가 모두 관측 범위 안에 있는 달만 계산한다(밖으로 늘려 추정하지 않음)."""
    for sid in FLOW_FROM:
        s = st.series.get(sid)
        if s and s.get("kind") == "cumulative":
            s["points"] = clean_cumulative(s.get("points", []))
        pts = [p for p in (s or {}).get("points", []) if isinstance(p.get("value"), (int, float))]
        if len(pts) < 2:
            continue
        xs = [date.fromisoformat(p["date"]) for p in pts]
        ys = [p["value"] for p in pts]

        def at(d):
            if d < xs[0] or d > xs[-1]:
                return None
            for i in range(1, len(xs)):
                if xs[i] >= d:
                    span = (xs[i] - xs[i - 1]).days or 1
                    return ys[i - 1] + (ys[i] - ys[i - 1]) * (d - xs[i - 1]).days / span
            return ys[-1]

        out, m = [], date(xs[0].year, xs[0].month, 1)
        while month_add(m, 1) <= xs[-1]:
            a, b = at(m), at(month_add(m, 1))
            if a is not None and b is not None:
                # 두 관측 사이 간격이 넓으면(>75일) 그 달 값은 긴 구간 평균이라 '보간'으로 표시
                gap = max((xs[i] - xs[i - 1]).days for i in range(1, len(xs)) if xs[i - 1] <= month_add(m, 1) and xs[i] >= m)
                out.append({"date": m.isoformat(), "value": round(b - a), "est": True, "wide": gap > 75})
            m = month_add(m, 1)
        if not out:
            continue
        label = FLOW_LABEL.get(sid) or s["label"].replace("누적 ", "") + " · 월 증가 (추정)"
        base_name = s["label"]
        st.upsert(sid + "__mom", {"group": s.get("group"), "country": s.get("country"), "label": label, "unit": s.get("unit"), "kind": "flow",
                  "cadence": "월간 · 누적값 차분", "source": s.get("source"), "source_url": s.get("source_url"), "derived_from": sid,
                  "note": f"[추정 방법] '{base_name}'(누적값)을 관측한 날짜별로 모은 뒤, 매월 1일 값을 앞뒤 관측치의 날짜 비율로 선형 보간하고 '다음 달 1일 − 이번 달 1일'로 월 증가분을 계산했다. "
                          "공식 월간 수치가 아니라 누적값 차이로 만든 추정이다. 관측 간격이 75일을 넘는 달(속 빈 점)은 그 긴 구간의 평균 속도라 월별 변동이 평평하게 나온다"
                          "(예: 2023-06~2024-06은 보관본이 거의 없음). 누적값이 뒤 시점보다 큰 관측치(보관소가 다른 날짜 보관본을 돌려준 경우)는 계산에서 뺐다."},
                  out, replace=True)


# ── 조립 ─────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    prev = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    st = Store(prev)
    for name, fn in COLLECTORS:
        if only and name not in only:
            continue
        print("▶", name)
        try:
            fn(st)
        except Exception as e:
            st.error(name, e)
    manual = json.load(open(MANUAL, encoding="utf-8")) if os.path.exists(MANUAL) else {}
    # 수기 시계열은 파일이 기준 — 파일에서 지운 수기 지표는 결과에서도 지우고, 남은 것은 통째로 덮어쓴다
    manual_ids = {ms["id"] for ms in manual.get("series", [])}
    for sid in [k for k, v in st.series.items() if v.get("method") == "manual" and k not in manual_ids]:
        del st.series[sid]
    for ms in manual.get("series", []):
        meta = {k: v for k, v in ms.items() if k != "points"}
        meta["method"] = "manual"
        st.upsert(ms["id"], meta, ms.get("points", []), replace=True)
    derive_flows(st)
    out = {
        "schema_version": 1,
        "generated_at": NOW.isoformat(timespec="seconds"),
        "company": {"name": "스캐터랩", "service": "제타 (zeta)", "domain": DOMAIN, "ios_id": IOS_ID, "android_id": ANDROID_ID, "listed": False},
        "countries": COUNTRIES,
        "series": sorted(st.series.values(), key=lambda s: (s.get("group", ""), s["id"])),
        "milestones": manual.get("milestones", []),
        "snapshots": manual.get("snapshots", []),
        "errors": st.errors,
        "state": st.state,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장: {OUT} · 시리즈 {len(out['series'])}개 · 오류 {len(st.errors)}개")


if __name__ == "__main__":
    main()
