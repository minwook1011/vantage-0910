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
def send_photos(pngs, caption, thread=None):
    """사진 1장이면 sendPhoto, 여러 장이면 앨범 — 글(링크)은 첫 사진 설명으로. 첫 메시지 번호를 돌려준다"""
    caption = caption[:1020]
    th = {"message_thread_id": thread} if thread else {}
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
    r = call("sendMediaGroup", {"chat_id": chat(), "media": json.dumps(media, ensure_ascii=False), "disable_notification": silent(), **th}, files=files)
    return r[0]["message_id"]


def out(pngs, caption, tag):
    """--dry 면 사진은 data_sources/tg_shots_preview/ 에 저장하고 글만 출력"""
    if DRY:
        os.makedirs(SHOT_DIR, exist_ok=True)
        for i, b in enumerate(pngs):
            open(os.path.join(SHOT_DIR, f"{tag}_{i}.png"), "wb").write(b)
        print("─" * 34, tag, f"사진 {len(pngs)}장 → {SHOT_DIR}")
        print(re.sub(r"<[^>]+>", "", caption))
        return 0
    return send_photos(pngs, caption) if pngs else send_text(caption)


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
           f'<a href="{SITE}jp-screener.html">일본 캘린더</a> · <a href="{SITE}us-report.html">미국 캘린더</a>')
    use_topic("sched")
    out(pngs, cap, "weekly")
    st["sent"].add(key)


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


# ── ③ 발표 후 알림 ───────────────────────────────────────────
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
        rows.append(("jp", code, d, x.get("rid") or ix.get("rid") or "", kind, f"{ko[code]}({nm})" if code in ko else nm, why, nums))
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
        rows.append(("us", r["c"], d, r["rid"], "us", r.get("n") or r["c"], why, nums))
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
    """요약 글 마크다운 한 줄 → 텔레그램 글(굵게만 살림)"""
    s = esc(s.strip())
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    return re.sub(r"`([^`]+)`", r"\1", s)


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
    """자세한 해설(텔레그램 메시지 1~2개) — 결론 · 핵심 포인트(사실/왜/그래서) · 남은 계획 · 리스크 · 체크포인트"""
    sec = sections(N.get("analysis_md"))
    blocks = []
    concl = pick(sec, "한 줄 결론", "결론")
    if concl:
        blocks.append("💡 <b>한 줄 결론</b>\n" + md_tg(" ".join(l for l in concl.split("\n") if l.strip())))
    pts = bullets(pick(sec, "핵심 포인트"))
    if pts:
        lines = ["📌 <b>핵심 포인트</b>"]
        for p in pts:
            m = re.match(r"\*\*(.+?)\*\*\s*[—-]\s*(.*)", p)
            title, rest = (m.group(1), m.group(2)) if m else ("", p)
            lines.append("")
            if title:
                lines.append(f"<b>{esc(title)}</b>")
            # **사실**: … **왜**: … **그래서**: … → 줄 나눔
            chunks = re.split(r"\*\*(사실|왜|그래서)\*\*\s*[:：]\s*", rest)
            if len(chunks) > 1:
                if chunks[0].strip():
                    lines.append(md_tg(chunks[0]))
                icon = {"사실": "▫️ 사실", "왜": "▫️ 왜", "그래서": "👉 그래서"}
                for lab, txt in zip(chunks[1::2], chunks[2::2]):
                    lines.append(f"{icon[lab]} — {md_tg(txt)}")
            else:
                lines.append(md_tg(rest))
        blocks.append("\n".join(lines))
    g = bullets(pick(sec, "가이던스", "진척"))
    if g:
        blocks.append("🎯 <b>회사 계획·진척률</b>\n" + "\n".join("• " + md_tg(x) for x in g[:4]))
    r = bullets(pick(sec, "리스크", "반론"))
    if r:
        blocks.append("⚠️ <b>리스크·반론</b>\n" + "\n".join("• " + md_tg(x) for x in r[:4]))
    c = bullets(pick(sec, "체크포인트"))
    if c:
        blocks.append("🔭 <b>다음에 볼 것</b>\n" + "\n".join("• " + md_tg(x) for x in c[:4]))
    if not blocks:   # 분석이 없으면 짧은 요약 문장이라도
        blocks = ["\n".join("• " + md_tg(l) for l in (N.get("tg") or "").split("\n") if l.strip())]
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


def alerts(st, seed=False, sample=None):
    """sample="2026-10-01" 처럼 날짜를 주면 그날 이후 조건 맞은 기업을 '시험'으로 보낸다(최대 6건, 보낸 기록은 남기지 않음)"""
    use_topic("surp")
    favs = None
    n = 0
    rows = candidates()
    if sample:
        rows = sorted(candidates(since=sample), key=lambda r: r[2])[:6]
        st = {"sent": set(), "msg": {}, "topics": st.get("topics", {})}   # 실제 기록과 분리
    for m, code, d, rid, kind, name, why, nums in rows:
        ak, sk = f"alert:{m}:{code}:{d}", f"sum:{m}:{code}:{d}"
        if seed:
            st["sent"].add(ak)
            continue
        if ak not in st["sent"] or DRY:
            import tg_shots
            if favs is None:
                favs = favorites()
            pngs = tg_shots.alert_pics(kind, code, d, rid, favs)
            head = f"{FLAG[m]} <b>{esc(name)}</b> <code>{esc(code)}</code> 실적 발표 {d[5:].replace('-', '.')}"
            cap = "\n".join((["🧪 <b>시험 발송</b> · 지난 실적으로 모양 확인"] if sample else []) +
                            ([f'🔗 <a href="{link(m, rid)}">사이트 실적 리포트</a>'] if rid else []) +
                            [head, " · ".join(why), ""] + [f"• {esc(x)}" for x in nums])
            try:
                mid = out(pngs, cap, f"alert_{code}")
                if not DRY:
                    st["sent"].add(ak)
                    st["msg"][ak] = mid
                n += 1
                print("알림:", ak, "/", " · ".join(why))
            except SystemExit as e:
                print("설정 없음:", e)
                return
            except Exception as e:
                print("알림 실패:", ak, e)
                continue
        # 요약 글이 붙으면: 재무제표 사진(위) → 자세한 해설(아래, 답글)
        if rid and (sk not in st["sent"] or DRY):
            N = load(f"docs/data/{m}/reports/notes/{rid}.json")
            if not N:
                continue
            import tg_shots
            if favs is None:
                favs = favorites()
            kb = [[{"text": "🔍 분석", "url": link(m, rid, "ana")}]]   # 버튼은 하나로(2026-10-07 사용자)
            cap = "\n".join([f"📝 {FLAG[m]} <b>{esc(name)}</b> 실적 요약",
                             f'🔗 <a href="{link(m, rid)}">사이트 실적 리포트</a>', ""] +
                            ([md_tg(N["headline"])] if N.get("headline") else []))
            parts = detail(N)
            try:
                png = tg_shots.fin_pic(kind, code, rid, favs)
                if DRY:
                    out([png] if png else [], cap, f"sum_{code}")
                    for p in parts:
                        print("─" * 34, "(해설)\n" + re.sub(r"<[^>]+>", "", p))
                    continue
                top = send_photos([png], cap) if png else send_text(cap)
                for i, p in enumerate(parts):
                    send_text(p, kb if i == len(parts) - 1 else None, reply_to=top if i == 0 else None)
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
        if "--sample" in a:   # 시험: 일정 사진(다음 주·오늘) + 지난 서프 알림 — 기록 안 남김
            since = a[a.index("--since") + 1] if "--since" in a else (NOW - timedelta(days=10)).strftime("%Y-%m-%d")
            weekly({"sent": set()})
            daily({"sent": set()})
            alerts(st, sample=since)
            return
        if "--weekly" in a:
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
