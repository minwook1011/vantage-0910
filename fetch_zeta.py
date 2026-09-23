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
                  "unit": "회", "kind": "cumulative", "note": "페이지에 담긴 정확한 누적 설치 수(국가 구분 없음). 하루 증가분이 안드로이드 신규 설치 추정치."},
                  [{"date": TODAY, "value": int(first["realInstalls"])}])
    if first and first.get("ratings"):
        st.upsert("app_gplay_ratings", {**base, "group": "download", "country": "global", "label": "구글플레이 별점 수 (전 세계)",
                  "unit": "개", "kind": "cumulative", "note": "별점만 남긴 것까지 포함한 누적 수."},
                  [{"date": TODAY, "value": int(first["ratings"])}])


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
    # 수기 시계열(보도 인용)은 파일이 기준 — 매번 통째로 덮어써서 고친 값이 바로 반영되게 한다
    for ms in manual.get("series", []):
        meta = {k: v for k, v in ms.items() if k != "points"}
        meta["method"] = "manual"
        st.upsert(ms["id"], meta, ms.get("points", []), replace=True)
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
