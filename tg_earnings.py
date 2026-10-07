#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tg_earnings.py — 실적 채널 봇 (사이트 화면 사진 + 링크)

  --weekly   매주 토 05:00  다음 주 실적 발표 캘린더 사진 3장(일본 소비재 · 일본 닛케이 · 미국)
  --daily    평일 07:30     오늘 발표 기업: 세 캘린더의 오늘 칸을 나란히 붙인 사진 1장
  (기본)     발표 후 알림   아래 셋 중 하나라도 맞으면(또는) 링크 + 발표 카드 사진 + 재무제표 사진
                 ① 즐겨찾기 기업(사이트 별 표시 — 전부)  ② 발표 후 주가 +2% 이상  ③ 컨센서스 +5% 이상 상회
             요약 글이 붙으면 그 알림에 답글로 한 줄 결론 + 핵심 문장 + 사이트 바로가기 버튼

사진은 tg_shots.py 가 실제 사이트를 열어 찍는다. 데이터는 origin/main 을 읽는다(tg_notify.py 와 같은 방식).

── 설정 ────────────────────────────────────────────────────
  봇 토큰  TELEGRAM_EARN_BOT_TOKEN(없으면 TELEGRAM_BOT_TOKEN) 또는 telegram_bot.json "earn_token"/"token"
  채널     TELEGRAM_EARN_CHAT_ID 또는 telegram_bot.json "earn_chat_id"  (봇을 채널 관리자로 추가)
  즐겨찾기 FIREBASE_SA(서비스 계정 키 JSON 문자열)가 있으면 사이트 클라우드에서 바로 읽고,
           없으면 data_sources/tg_favs.json({"jp":{"g":[{"c":[코드…]}]},"us":[티커…]})
  시험     python tg_earnings.py --test | --chat-id | --dry | --weekly --dry | --daily --dry | --seed
"""
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import timedelta

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import shutil
import subprocess
from datetime import datetime

import requests

import send_telegram as tg
from send_telegram import esc, SITE, KST

BASE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(BASE, "data_sources", "tg_earn_state.json")
FAV_FILE = os.path.join(BASE, "data_sources", "tg_favs.json")
SHOT_DIR = os.path.join(BASE, "data_sources", "tg_shots_preview")
FKEY = "vantage-datahub-favorite-companies-v1"
UP, BEAT = 2.0, 5.0            # ② 주가 +2% 이상 · ③ 컨센서스 +5% 이상
FRESH_DAYS = 2                 # 발표일이 오늘~이틀 전인 것만
FLAG = {"jp": "🇯🇵", "us": "🇺🇸"}
PAGE = {"jp": "jp-report.html", "us": "us-report.html"}
DRY = "--dry" in sys.argv
NOW = datetime.now(KST)
GIT = shutil.which("git") or r"C:\Program Files\Git\cmd\git.exe"


def git(*args):
    r = subprocess.run([GIT, *args], cwd=BASE, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip())
    return r.stdout


def load(path):
    """origin/main 의 파일(작업 폴더를 건드리지 않음)"""
    try:
        return json.loads(git("show", f"origin/main:{path}").decode("utf-8"))
    except Exception:
        return None


# ── 텔레그램 ─────────────────────────────────────────────────
def creds():
    c = json.load(open(tg.SECRET, encoding="utf-8")) if os.path.exists(tg.SECRET) else {}
    tok = os.environ.get("TELEGRAM_EARN_BOT_TOKEN") or c.get("earn_token") or os.environ.get("TELEGRAM_BOT_TOKEN") or c.get("token")
    chat = os.environ.get("TELEGRAM_EARN_CHAT_ID") or str(c.get("earn_chat_id") or "")
    if not tok:
        raise SystemExit("봇 토큰 없음 — 파일 맨 위 설정 참고")
    return tok, chat


def call(method, data=None, files=None):
    tok, _ = creds()
    last = None
    for a in range(4):
        try:
            r = requests.post(f"https://api.telegram.org/bot{tok}/{method}", data=data, files=files, timeout=90)
            res = r.json()
            if res.get("ok"):
                return res["result"]
            last = res
            if r.status_code == 429:
                time.sleep(int((res.get("parameters") or {}).get("retry_after", 5)) + 1)
                continue
            if r.status_code == 400 and data and data.get("reply_to_message_id") and "reply" in str(res).lower():
                data = {k: v for k, v in data.items() if k != "reply_to_message_id"}   # 원글이 없으면 새 글로
                continue
            if r.status_code in (400, 401, 403):
                break
        except Exception as e:
            last = str(e)
        time.sleep(2 * (a + 1))
    raise RuntimeError(f"텔레그램 전송 실패: {last}")


def chat():
    c = creds()[1]
    if not c:
        raise SystemExit("실적 채널 chat_id 없음 — TELEGRAM_EARN_CHAT_ID 또는 telegram_bot.json 의 earn_chat_id")
    return c


# ── 그룹 안 방(주제) ─────────────────────────────────────────
# 받는 곳이 주제 기능을 켠 그룹이면 봇이 방을 직접 만들어 그 방에 올린다(봇은 사람이 만든 방을 찾을 수 없다).
# 방 번호는 기록 파일(topics)에 남긴다. 그룹에서 봇에게 '주제 관리' 권한이 있어야 한다. 방을 못 만들면 General 에 올린다.
TOPICS = {"surp": "🚀 실적 서프", "sched": "🗓 실적 일정"}
_ST = None          # main 에서 기록(st)을 넣어 둔다
_TOPIC = None       # 지금 보낼 방 키


def use_topic(key):
    global _TOPIC
    _TOPIC = key


def thread_id(new=False):
    if not _TOPIC or _ST is None or not str(chat()).startswith("-100"):
        return None
    tp = _ST.setdefault("topics", {})
    if not new and tp.get(_TOPIC):
        return tp[_TOPIC]
    try:
        r = call("createForumTopic", {"chat_id": chat(), "name": TOPICS[_TOPIC]})
        tp[_TOPIC] = r["message_thread_id"]
        print("방 만듦:", TOPICS[_TOPIC], r["message_thread_id"])
        return tp[_TOPIC]
    except Exception as e:
        print("방 만들기 실패 — General 에 올림(봇에게 '주제 관리' 권한이 있는지 확인):", e)
        return None


def in_topic(fn):
    """보낼 때 방 번호를 붙이고, 방이 지워졌으면 다시 만들어 한 번 더 보낸다"""
    def wrap(*a, **k):
        tid = thread_id()
        try:
            return fn(*a, thread=tid, **k)
        except RuntimeError as e:
            if tid and "thread" in str(e).lower():
                return fn(*a, thread=thread_id(new=True), **k)
            raise
    return wrap


def silent():
    return "true" if NOW.hour < 7 else "false"


@in_topic
def send_text(text, buttons=None, reply_to=None, thread=None):
    d = {"chat_id": chat(), "text": text[:4000], "parse_mode": "HTML", "disable_web_page_preview": "true",
         "disable_notification": silent()}
    if thread:
        d["message_thread_id"] = thread
    if buttons:
        d["reply_markup"] = json.dumps({"inline_keyboard": buttons}, ensure_ascii=False)
    if reply_to:
        d["reply_to_message_id"] = reply_to
    return call("sendMessage", d)["message_id"]


@in_topic
def send_photos(pngs, caption, buttons=None, thread=None):
    """사진 1장이면 sendPhoto, 여러 장이면 앨범 — 글(링크)은 첫 사진 설명으로. 첫 메시지 번호를 돌려준다"""
    caption = caption[:1020]
    th = {"message_thread_id": thread} if thread else {}
    if buttons:
        th["reply_markup"] = json.dumps({"inline_keyboard": buttons}, ensure_ascii=False)
    if len(pngs) == 1:
        r = call("sendPhoto", {"chat_id": chat(), "caption": caption, "parse_mode": "HTML", "disable_notification": silent(), **th},
                 files={"photo": ("p.png", pngs[0], "image/png")})
        return r["message_id"]
    media, files = [], {}
    for i, b in enumerate(pngs[:10]):
        m = {"type": "photo", "media": f"attach://p{i}"}
        if i == 0:
            m.update(caption=caption, parse_mode="HTML")
        media.append(m)
        files[f"p{i}"] = (f"p{i}.png", b, "image/png")
    th.pop("reply_markup", None)   # 앨범엔 버튼을 못 단다
    r = call("sendMediaGroup", {"chat_id": chat(), "media": json.dumps(media, ensure_ascii=False), "disable_notification": silent(), **th}, files=files)
    return r[0]["message_id"]


def out(pngs, caption, tag, buttons=None):
    """--dry 면 사진은 data_sources/tg_shots_preview/ 에 저장하고 글만 출력"""
    if DRY:
        os.makedirs(SHOT_DIR, exist_ok=True)
        for i, b in enumerate(pngs):
            open(os.path.join(SHOT_DIR, f"{tag}_{i}.png"), "wb").write(b)
        print("─" * 34, tag, f"사진 {len(pngs)}장 → {SHOT_DIR}")
        print(re.sub(r"<[^>]+>", "", caption))
        return 0
    if pngs:
        return send_photos(pngs, caption, buttons=buttons)
    return send_text(caption, buttons)


# ── 즐겨찾기 ─────────────────────────────────────────────────
def favorites():
    """사이트 즐겨찾기 원본({jp:{g:[…]}, us:[…], usg:…}) — 클라우드(서비스 계정) → 파일 순"""
    sa = os.environ.get("FIREBASE_SA")
    if sa:
        try:
            from google.oauth2 import service_account
            from google.auth.transport.requests import Request
            info = json.loads(sa)
            cr = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/datastore"])
            cr.refresh(Request())
            url = f"https://firestore.googleapis.com/v1/projects/{info['project_id']}/databases/(default)/documents/vantageUsers"
            docs = requests.get(url, headers={"Authorization": f"Bearer {cr.token}"}, timeout=30).json().get("documents") or []
            for d in docs:
                v = ((d.get("fields") or {}).get("values") or {}).get("mapValue", {}).get("fields", {}).get(FKEY, {}).get("stringValue")
                if v:
                    return json.loads(v)
            print("클라우드에 즐겨찾기 없음 — 파일로")
        except Exception as e:
            print("클라우드 즐겨찾기 읽기 실패 — 파일로:", e)
    if os.path.exists(FAV_FILE):
        return json.load(open(FAV_FILE, encoding="utf-8"))
    return {}


def fav_sets(f):
    jp = set()
    for g in ((f.get("jp") or {}).get("g") or []):
        jp.update(g.get("c") or [])
    us = set(f.get("us") or [])
    for g in ((f.get("usg") or {}).get("g") or []):
        us.update(g.get("c") or [])
    return jp, us


# ── 링크 ─────────────────────────────────────────────────────
def link(m, rid, sec=""):
    return f"{SITE}{PAGE[m]}?id={urllib.parse.quote(rid)}" + (f"#{sec}" if sec else "")


def sgn(v):
    return f"{v:+.1f}%".replace("-", "−")


def kst_today():
    return NOW.strftime("%Y-%m-%d")


# ── ① 주간 ───────────────────────────────────────────────────
def weekly(st):
    import tg_shots
    d = NOW.date()
    monday = d + timedelta(days=(7 - d.weekday()) % 7 or 7)       # 다음 주 월요일
    key = f"week:{monday}"
    if key in st["sent"] and not DRY:
        print("이미 보냄:", key)
        return
    pngs = [b for _, b in tg_shots.week_all(monday.isoformat(), favorites())]
    fri = monday + timedelta(days=4)
    cap = (f"🗓 <b>다음 주 실적 발표</b> {monday:%m.%d}–{fri:%m.%d}\n"
           f"일본 소비재 · 일본 닛케이 · 미국\n\n"
           f'<a href="{SITE}jp-screener.html">일본 캘린더</a> · <a href="{SITE}us-report.html">미국 캘린더</a>\n#실적예정')
    use_topic("sched")
    out(pngs, cap, "weekly")
    st["sent"].add(key)
    try:
        watch(monday, fri)
    except Exception as e:
        print("주의 종목 실패:", e)


def watch(monday, fri):
    """다음 주 실적 발표 기업 중 기술적 분석 신호(🔥 주도주 · 📈 거래량 급증 · 🧊 바닥 반등)에 걸린 종목 — 주간 예정 사진 아래 한 통(2026-10-07 사용자)"""
    import tg_shots
    sig = tg_shots.ta_signals()
    S = sig.get("stocks") or {}
    # 다음 주 발표일: 일본(JPX 예정일, 코드 → 코드.T) · 미국(나스닥 캘린더)
    days = {}
    jd = (load("docs/data/jp/earnings_dates.json") or {}).get("dates") or {}
    for c, v in jd.items():
        if v.get("date") and monday.isoformat() <= v["date"] <= fri.isoformat():
            days[f"{c}.T"] = v["date"]
    ud = (load("docs/data/us/earnings_dates.json") or {}).get("dates") or {}
    for tk, v in ud.items():
        n = v.get("next") or {}
        if n.get("date") and monday.isoformat() <= n["date"] <= fri.isoformat():
            days[tk] = n["date"]
    groups = {"lead": [], "vol": [], "rebound": []}
    for tk, x in S.items():
        if tk not in days:
            continue
        for g in x["sig"]:
            groups[g].append((days[tk], tk, x))
    if not any(groups.values()):
        text = (f"👀 <b>다음 주 실적 발표 · 주의 깊게 볼 종목</b> {monday:%m.%d}–{fri:%m.%d}\n"
                "이번 주 발표 기업 중 주도주 · 거래량 급증 · 바닥 반등 신호에 걸린 종목은 없습니다.\n#실적예정")
        if DRY:
            print("─" * 34, "주의 종목\n" + re.sub(r"<[^>]+>", "", text))
            return
        use_topic("sched")
        send_text(text)
        return
    wd = "월화수목금토일"
    def line(d, tk, x, g):
        from datetime import date as D
        dd = D.fromisoformat(d)
        code = tk[:-2] if tk.endswith(".T") else tk
        stat = {"lead": f"기술점수 {x.get('score')} · 1개월 {sgn(x['r1m'])}" if x.get("r1m") is not None else f"기술점수 {x.get('score')}",
                "vol": f"거래대금 평소의 {x['vol']:.1f}배" if x.get("vol") else "",
                "rebound": f"고점 대비 {sgn(x['from_high'])} · 1주 {sgn(x['r1w'])}" if x.get("from_high") is not None else ""}[g]
        return f"• {dd:%m.%d}({wd[dd.weekday()]}) <b>{esc(x.get('name') or code)}</b>({esc(code)})" + (f" · {stat}" if stat else "")
    head = {"lead": "🔥 <b>주도주</b> · 오르고 추세 강함", "vol": "📈 <b>거래량 급증</b> · 돈이 몰리는 중", "rebound": "🧊 <b>바닥 반등</b> · 낙폭 과대 후 반등 시작"}
    parts = [f"👀 <b>다음 주 실적 발표 · 주의 깊게 볼 종목</b> {monday:%m.%d}–{fri:%m.%d}",
             "기술적 분석 신호에 걸린 발표 예정 기업"]
    for g in ("lead", "vol", "rebound"):
        if groups[g]:
            parts += ["", head[g]] + [line(d, tk, x, g) for d, tk, x in sorted(groups[g], key=lambda r: (r[0], r[1]))]
    parts += ["", f'<a href="{SITE}bottomup.html">기술적 분석</a>\n#실적예정']
    text = "\n".join(parts)
    if DRY:
        print("─" * 34, "주의 종목\n" + re.sub(r"<[^>]+>", "", text))
        return
    use_topic("sched")
    send_text(text)


# ── ② 매일 ───────────────────────────────────────────────────
def daily(st):
    import tg_shots
    today = kst_today()
    key = f"day:{today}"
    if NOW.weekday() >= 5:
        print("주말 — 보내지 않음")
        return
    if key in st["sent"] and not DRY:
        print("이미 보냄:", key)
        return
    png = tg_shots.day_all(today, favorites())
    cap = (f"☀️ <b>오늘 실적 발표</b> {NOW:%m.%d}({'월화수목금토일'[NOW.weekday()]})\n"
           f"일본 소비재 · 일본 닛케이 · 미국(미 동부 날짜 — 장 전 = 오늘 밤, 장 후 = 내일 새벽)\n\n"
           f'<a href="{SITE}jp-screener.html">일본 캘린더</a> · <a href="{SITE}us-report.html">미국 캘린더</a>')
    use_topic("sched")
    out([png] if png else [], cap if png else cap + "\n\n오늘은 발표 예정이 없습니다.", "daily")
    st["sent"].add(key)


# ── ②' 발표 결과(2026-10-07 사용자: 아침 '오늘 발표 예정' 대신, 발표가 끝난 뒤 결과만 한눈에) ──
#   일본: 평일 18:00 KST 그날 발표분(소비재 · 닛케이 두 칸)
#   미국: 화~토 06:00 KST 전날(미 동부 날짜) 발표분 — 장 후 발표까지 끝난 시각
def results(st, market):
    import tg_shots
    if market == "jp":
        day = NOW.date()
        kinds, label = ("jpc", "jpm"), "일본"
    else:
        day = NOW.date() - timedelta(days=1)
        kinds, label = ("us",), "미국"
    if day.weekday() >= 5:
        print("주말 — 보내지 않음")
        return
    key = f"res:{market}:{day}"
    if key in st["sent"] and not DRY:
        print("이미 보냄:", key)
        return
    png = tg_shots.day_all(day.isoformat(), favorites(), kinds)
    if not png:
        print(f"{label} {day} 발표 없음 — 보내지 않음")
        st["sent"].add(key)
        return
    page = "jp-screener.html" if market == "jp" else "us-report.html"
    cap = (f"📊 <b>{label} 실적 결과</b> {day:%m.%d}({'월화수목금토일'[day.weekday()]})"
           + (" · 미 동부 날짜" if market == "us" else "") + "\n"
           + ("일본 소비재 · 일본 닛케이" if market == "jp" else "장 전 · 장 후 발표 모두") + "\n\n"
           + f'<a href="{SITE}{page}">{label} 캘린더</a>\n#실적결과')
    use_topic("sched")
    out([png], cap, f"results_{market}")
    st["sent"].add(key)


# ── ③ 발표 후 알림 ───────────────────────────────────────────
TAGS = {}
_USKO = None


def us_ko():
    """미국 기업 한글 이름(data_sources/us_names_ko.json)"""
    global _USKO
    if _USKO is None:
        _USKO = load("data_sources/us_names_ko.json") or {}
        if not _USKO and os.path.exists(os.path.join(BASE, "data_sources", "us_names_ko.json")):
            _USKO = json.load(open(os.path.join(BASE, "data_sources", "us_names_ko.json"), encoding="utf-8"))
    return _USKO


def hashtags(en, code, ko):
    """검색용 해시태그 3개: #영어이름 #티커 #한글이름 (예: #AMAZON #AMZN #아마존)"""
    e = re.sub(r"\(The\)|\(Class [A-Z]\)|\.com\b", "", en or "", flags=re.I)
    e = re.sub(r"(?:,\s*|\s+)(Holdings?|Co|Ltd|Inc|Incorporated|Corporation|Corp|Company|plc|Limited|N\.?V|S\.?A)\b\.?", "", e, flags=re.I)
    e = re.sub(r"[^0-9A-Za-z]", "", e).upper()
    t = re.sub(r"[^0-9A-Za-z]", "", code or "").upper()
    if t.isdigit():
        t += "JP"   # 텔레그램은 숫자만 있는 해시태그를 태그로 안 만든다 → #3549JP
    k = re.sub(r"[^0-9A-Za-z가-힣]", "", ko or "")
    out = []
    for x in (e, t, k):
        if x and f"#{x}" not in out:
            out.append(f"#{x}")
    return " ".join(out)


def candidates(days=FRESH_DAYS, since=None):
    """[(m, code, date, rid, kind, name, reasons[], 숫자줄[])]"""
    since = since or (NOW - timedelta(days=days)).strftime("%Y-%m-%d")
    fj, fu = fav_sets(favorites())
    rows = []
    # 일본: 발표 결과(주가 반응·컨센) + 10분 후 주가 + 리포트 목록(이름·유니버스)
    res = (load("docs/data/jp/earnings_results.json") or {}).get("results") or {}
    pts = (load("docs/data/jp/earnings_pts.json") or {}).get("items") or {}
    ixj = {r["c"]: r for r in (load("docs/data/jp/reports/index.json") or {}).get("reports") or []}
    ko = {}
    try:   # 한글 이름(첫 낱말) — docs/data/jp/names-ko.js 의 KO_NAMES
        js = git("show", "origin/main:docs/data/jp/names-ko.js").decode("utf-8")
        ko = {k: v.split()[0] for k, v in json.loads(js[js.index("{"):js.rindex("}") + 1]).items() if v}
    except Exception:
        pass
    for code, x in res.items():
        d = x.get("date") or ""
        if d < since:
            continue
        ix = ixj.get(code) or {}
        px = x.get("px") or {}
        p10 = pts.get(code) if (pts.get(code) or {}).get("date") == d else None
        moves = [v for v in ((p10 or {}).get("pct10"), px.get("d1")) if v is not None]
        cons = (x.get("cons") or {}).get("pct")
        why = []
        if code in fj:
            why.append("⭐ 즐겨찾기")
        if moves and max(moves) >= UP:
            why.append(f"📈 주가 {sgn(max(moves))}")
        if cons is not None and cons >= BEAT:
            why.append(f"🎯 컨센 {sgn(cons)}")
        if not why:
            continue
        nums = []
        q, qy = x.get("q") or {}, x.get("q_yoy") or {}
        if q.get("rev") is not None:
            nums.append(f"매출 {q['rev']/100:,.0f}억엔" + (f" ({sgn(qy['rev'])})" if qy.get("rev") is not None else ""))
        if q.get("op") is not None:
            nums.append(f"영업이익 {q['op']/100:,.1f}억엔" + (f" ({sgn(qy['op'])})" if qy.get("op") is not None else ""))
        if p10:
            nums.append(f"발표 10분 후 {sgn(p10['pct10'])} ({p10.get('src', '')} {p10.get('at10', '')})")
        if px.get("d1") is not None:
            nums.append(f"{'다음 거래일' if px.get('timing') == 'after' else '그날 종가'} {sgn(px['d1'])}")
        if cons is not None:
            nums.append(f"컨센서스 대비 {sgn(cons)}")
        kind = "jpc" if "cons" in (ix.get("u") or []) else "jpm"
        nm = ix.get("n") or code
        TAGS[("jp", code)] = hashtags(nm, code, ko.get(code))
        rows.append(("jp", code, d, x.get("rid") or ix.get("rid") or "", kind, ko.get(code) or nm, why, nums))
    # 미국: 리포트 목록(발표 후 주가·컨센)
    for r in (load("docs/data/us/reports/index.json") or {}).get("reports") or []:
        d = r.get("d") or ""
        if d < since:
            continue
        why = []
        if r["c"] in fu:
            why.append("⭐ 즐겨찾기")
        if r.get("d1") is not None and r["d1"] >= UP:
            why.append(f"📈 주가 {sgn(r['d1'])}")
        if r.get("cons") is not None and r["cons"] >= BEAT:
            why.append(f"🎯 컨센 {sgn(r['cons'])}")
        if not why:
            continue
        nums = []
        if r.get("rev_yoy") is not None:
            nums.append(f"매출 YoY {sgn(r['rev_yoy'])}")
        if r.get("op_yoy") is not None:
            nums.append(f"영업이익 YoY {sgn(r['op_yoy'])}")
        if r.get("d1") is not None:
            nums.append(f"발표 후 주가 {sgn(r['d1'])}")
        if r.get("cons") is not None:
            nums.append(f"EPS 컨센서스 대비 {sgn(r['cons'])}")
        kus = us_ko().get(r["c"])
        TAGS[("us", r["c"])] = hashtags(r.get("n") or r["c"], r["c"], kus)
        rows.append(("us", r["c"], d, r["rid"], "us", kus or r.get("n") or r["c"], why, nums))
    return rows


def pending(st):
    """보낼 것(새 알림·새 요약 답글) 개수 — 화면 찍기 도구 설치 전에 깃허브에서 먼저 확인"""
    n = 0
    for m, code, d, rid, *_ in candidates():
        if f"alert:{m}:{code}:{d}" not in st["sent"]:
            n += 1
        elif rid and f"sum:{m}:{code}:{d}" not in st["sent"] and load(f"docs/data/{m}/reports/notes/{rid}.json"):
            n += 1
    return n


def md_tg(s):
    """요약 글 마크다운 한 줄 → 텔레그램 글. 굵게만 살리고, AI 글 티 나는 긴 줄표·출처 꼬리표를 걷어낸다"""
    s = esc(s.strip())
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\s*\((?:카부탄|[^()]*?월차|[^()]*?단신|보도자료[^()]*|콜)\)", "", s)   # (6월 월차)·(카부탄) 같은 출처 꼬리표
    s = re.sub(r"\s+—\s+", ", ", s)
    return re.sub(r",\s*,", ",", s).strip()


def sections(md):
    """### 1. 제목 단위로 나눔 → {제목: 본문}"""
    out, cur = {}, None
    for line in (md or "").split("\n"):
        h = re.match(r"#{2,4}\s*\d*\.?\s*(.+)", line)
        if h:
            cur = h.group(1).strip()
            out[cur] = []
        elif cur:
            out[cur].append(line)
    return {k: "\n".join(v).strip() for k, v in out.items()}


def pick(sec, *keys):
    for k, v in sec.items():
        if any(x in k for x in keys):
            return v
    return ""


def bullets(text):
    return [re.sub(r"^\s*[-*]\s*", "", l).strip() for l in text.split("\n") if re.match(r"^\s*[-*]\s+", l)]


def detail(N):
    """자세한 해설(텔레그램 메시지 1~2개). 증권사 텔레그램 채널처럼 ■ 소제목 + 이어 쓴 문단.
    2026-10-07 사용자: '사실/왜/그래서' 꼬리표·이모지 소제목이 AI 같다 → 포인트는 한 문단으로 잇고 결론만 → 한 줄"""
    sec = sections(N.get("analysis_md"))
    blocks = []
    concl = pick(sec, "한 줄 결론", "결론")
    if concl:
        blocks.append("■ <b>요약</b>\n" + md_tg(" ".join(l for l in concl.split("\n") if l.strip())))
    pts = bullets(pick(sec, "핵심 포인트"))
    if pts:
        lines = ["■ <b>포인트</b>"]
        for i, p in enumerate(pts, 1):
            m = re.match(r"\*\*(.+?)\*\*\s*[—-]\s*(.*)", p)
            title, rest = (m.group(1), m.group(2)) if m else ("", p)
            title = re.sub(r"^[①-⑩]\s*", "", title)
            lines.append("")
            if title:
                lines.append(f"<b>{i}) {esc(title)}</b>")
            chunks = re.split(r"\*\*(사실|왜|그래서)\*\*\s*[:：]\s*", rest)
            if len(chunks) > 1:
                body, so = [chunks[0].strip()] if chunks[0].strip() else [], ""
                for lab, txt in zip(chunks[1::2], chunks[2::2]):
                    if lab == "그래서":
                        so = txt
                    else:
                        body.append(txt.strip())
                if body:
                    lines.append(md_tg(" ".join(body)))
                if so:
                    lines.append("→ " + md_tg(so))
            else:
                lines.append(md_tg(rest))
        blocks.append("\n".join(lines))
    g = bullets(pick(sec, "가이던스", "진척"))
    g = [x for x in g if "컨센서스 자료는" not in x and "비교 불가" not in x]
    if g:
        blocks.append("■ <b>가이던스</b>\n" + "\n".join("- " + md_tg(x) for x in g[:4]))
    r = bullets(pick(sec, "리스크", "반론"))
    if r:
        blocks.append("■ <b>리스크</b>\n" + "\n".join("- " + md_tg(x) for x in r[:4]))
    # '다음에 볼 것'(체크포인트)은 넣지 않는다 — 실적 확인 글이라 앞으로의 일정은 군더더기(2026-10-07 사용자)
    if not blocks:   # 분석이 없으면 짧은 요약 문장이라도
        blocks = ["\n".join("- " + md_tg(l) for l in (N.get("tg") or "").split("\n") if l.strip())]
    # 4,000자 넘으면 덩어리 단위로 나눠 여러 메시지
    out, cur = [], ""
    for b in blocks:
        if cur and len(cur) + len(b) + 2 > 3800:
            out.append(cur)
            cur = ""
        cur = (cur + "\n\n" + b) if cur else b
    if cur:
        out.append(cur)
    return [x[:4000] for x in out]


def _sents(x):
    x = re.sub(r"\*\*(.+?)\*\*", r"\1", x or "").replace("\n", " ")
    return [t.strip() for t in re.split(r"(?<=다\.)\s+", x) if t.strip()]


def _plain(x):
    """한 문장 다듬기: 출처 꼬리표·긴 줄표 제거"""
    x = re.sub(r"\s*\((?:CFO|CEO|콜|카부탄|[^()]*?월차|[^()]*?단신|보도자료[^()]*)\)", "", x)
    x = re.sub(r"\s+—\s+", ", ", x)
    return x.strip()


def brief(N, limit=5):
    """줄글 5줄 요약(2026-10-07 사용자: 아래는 줄글 5줄로).
    요약 작업이 써 둔 tg5(사람이 읽기 좋게 쓴 5문장)를 그대로 쓰고, 없을 때만 결론 문단 + '포인트 제목. 그래서 문장'으로 채운다"""
    if isinstance(N.get("tg5"), list) and N["tg5"]:
        return [esc(str(x).strip()) for x in N["tg5"] if str(x).strip()][:limit]
    sec = sections(N.get("analysis_md"))
    lines = [esc(_plain(t)) for t in _sents(pick(sec, "한 줄 결론", "결론"))][:limit]
    for x in bullets(pick(sec, "핵심 포인트")):
        if len(lines) >= limit:
            break
        t = re.match(r"\*\*(.+?)\*\*", x)
        title = re.sub(r"^[①-⑩]\s*", "", t.group(1)).strip() if t else ""
        so = re.split(r"\*\*그래서\*\*\s*[:：]\s*", x)
        so = _sents(so[1])[0] if len(so) > 1 and _sents(so[1]) else ""
        if title and so:
            lines.append(f"<b>{esc(title)}</b>. {esc(_plain(so))}")
    if not lines:
        lines = [esc(l.strip()) for l in (N.get("tg") or "").split("\n") if l.strip()][:limit]
    return lines


def alerts(st, seed=False, sample=None, only=None):
    """sample="2026-10-01" 처럼 날짜를 주면 그날 이후 조건 맞은 기업을 '시험'으로 보낸다(최대 6건, 보낸 기록은 남기지 않음)"""
    use_topic("surp")
    favs = None
    n = 0
    rows = candidates()
    if sample:
        rows = sorted(candidates(since=sample), key=lambda r: r[2])
        rows = [r for r in rows if r[1].upper() == only] if only else rows[:6]
        if only and not rows:
            print(f"{only}: 최근 30일 안에 조건(주가 +2%·컨센 +5%)에 맞는 발표가 없음")
        st = {"sent": set(), "msg": {}, "topics": st.get("topics", {})}   # 실제 기록과 분리
    for m, code, d, rid, kind, name, why, nums in rows:
        ak, sk = f"alert:{m}:{code}:{d}", f"sum:{m}:{code}:{d}"
        if seed:
            st["sent"].add(ak)
            continue
        title = f"{FLAG[m]} <b>{esc(name)}({esc(code)})</b>"
        N = load(f"docs/data/{m}/reports/notes/{rid}.json") if rid else None
        kb = [[{"text": "🔍 분석", "url": link(m, rid, "ana")}]] if rid else None   # 버튼은 하나로
        tags = [TAGS[(m, code)]] if TAGS.get((m, code)) else []
        if ak not in st["sent"] or DRY:
            # 알림 = 재무제표 사진 한 장 + 짧은 글. 요약이 이미 있으면 한 메시지에 같이(2026-10-07 사용자)
            import tg_shots
            if favs is None:
                favs = favorites()
            png = tg_shots.fin_pic(kind, code, rid, favs) if rid else None
            num = " · ".join(esc(x) for x in nums[:2])
            body = brief(N) if N else []
            cap = "\n".join([f"{title} · {d[5:].replace('-', '.')} 발표", " · ".join(why)] +
                            ([num] if num else []) +
                            (["🧪 시험 발송"] if sample else []) +
                            ([""] + body if body else []) +
                            ([""] + tags if tags else []))
            while len(re.sub(r"<[^>]+>", "", cap)) > 1000 and body:
                body.pop()
                cap = "\n".join([f"{title} · {d[5:].replace('-', '.')} 발표", " · ".join(why)] +
                                ([num] if num else []) + (["🧪 시험 발송"] if sample else []) +
                                ([""] + body if body else []) + ([""] + tags if tags else []))
            try:
                mid = out([png] if png else [], cap, f"alert_{code}", buttons=kb)
                if not DRY:
                    st["sent"].add(ak)
                    st["msg"][ak] = mid
                    if body:
                        st["sent"].add(sk)
                n += 1
                print("알림:", ak, "/", " · ".join(why))
            except SystemExit as e:
                print("설정 없음:", e)
                return
            except Exception as e:
                print("알림 실패:", ak, e)
                continue
            if body:
                continue
        # 요약이 나중에 붙으면: 그 알림에 짧은 답글
        if rid and N and (sk not in st["sent"]):
            text = "\n".join([f"📝 {title} 요약", ""] + brief(N) + ([""] + tags if tags else []))
            try:
                if DRY:
                    print("─" * 34, "(요약 답글)\n" + re.sub(r"<[^>]+>", "", text))
                    continue
                send_text(text, kb, reply_to=st["msg"].get(ak))
                st["sent"].add(sk)
            except Exception as e:
                print("요약 실패:", sk, e)
    print(f"발표 후 알림 {n}건")


# ── 실행 ─────────────────────────────────────────────────────
def main():
    a = sys.argv[1:]
    if "--chat-id" in a:
        for u in call("getUpdates", {}):
            c = (u.get("channel_post") or u.get("my_chat_member") or {}).get("chat") or {}
            if c.get("type") == "channel":
                print(f"chat_id = {c['id']}   ({c.get('title')})")
        return
    try:
        git("fetch", "-q", "origin", "main")
    except Exception as e:
        print("git fetch 실패(이전 내용으로 진행):", e)
    raw = json.load(open(STATE_PATH, encoding="utf-8")) if os.path.exists(STATE_PATH) else {}
    st = {"sent": set(raw.get("sent") or []), "msg": dict(raw.get("msg") or {}), "topics": dict(raw.get("topics") or {})}
    global _ST
    _ST = st
    first = not raw.get("seeded")      # 발표 후 알림을 아직 한 번도 안 돌렸으면(시험·일정 발송과 무관)
    try:
        if "--test" in a:   # 방을 만들고 방마다 시험 글 하나
            for k, msg in (("sched", "🗓 실적 일정 방 — 토요일 05시 다음 주 일정, 평일 07:30 오늘 발표 사진이 여기로 옵니다."),
                           ("surp", "🚀 실적 서프 방 — 발표 후 즐겨찾기 · 주가 +2% 이상 · 컨센서스 +5% 이상 기업이 여기로 옵니다.")):
                use_topic(k)
                send_text("✅ 연결 확인\n" + msg)
            print("시험 글 보냄")
            return
        if "--pending" in a:
            n = pending(st) if raw.get("seeded") else 1      # 처음이면 한 번 돌려 기록(seed)을 만든다
            print(f"pending={n}")
            if os.environ.get("GITHUB_OUTPUT"):
                open(os.environ["GITHUB_OUTPUT"], "a").write(f"pending={n}\n")
            return
        if "--code" in a:     # 시험: 한 기업만(예: --code 3549, --code JBL) — 최근 30일 발표분, 기록 안 남김
            alerts(st, sample=(NOW - timedelta(days=30)).strftime("%Y-%m-%d"), only=a[a.index("--code") + 1].upper())
            return
        if "--sample" in a:   # 시험: 일정 사진(다음 주·오늘) + 지난 서프 알림 — 기록 안 남김
            since = a[a.index("--since") + 1] if "--since" in a else (NOW - timedelta(days=10)).strftime("%Y-%m-%d")
            weekly({"sent": set()})
            daily({"sent": set()})
            alerts(st, sample=since)
            return
        if "--results" in a:   # --results jp | us
            results(st, a[a.index("--results") + 1])
        elif "--weekly" in a:
            weekly(st)
        elif "--daily" in a:
            daily(st)
        else:
            # 처음 켤 때는 지금 조건에 맞는 것들을 '보낸 것'으로만 기록(옛 알림이 쏟아지지 않게)
            alerts(st, seed=("--seed" in a) or (first and not DRY))
            st["seeded"] = True
    finally:
        if not DRY:
            # 기록은 최근 것만(보낸 키 3000개 · 답글용 메시지 번호 400개)
            new = {"sent": sorted(st["sent"])[-3000:], "msg": dict(list(st["msg"].items())[-400:]), "topics": st["topics"], "seeded": bool(st.get("seeded") or raw.get("seeded"))}
            if new != {"sent": raw.get("sent") or [], "msg": raw.get("msg") or {}, "topics": raw.get("topics") or {}, "seeded": bool(raw.get("seeded"))}:
                os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
                json.dump(new, open(STATE_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
