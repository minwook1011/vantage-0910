#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tg_notify.py — 사이트(origin/main) 데이터를 읽어 텔레그램 '돈벌레' 채널로 보낸다 (봇: @vantage0910_alert_bot)

GitHub Actions(.github/workflows/tg-notify.yml)가 PC 푸시·데이터 수집 직후와 15분마다 돌린다 — PC 가 꺼져 있어도 된다.
데이터는 사이트 수집기가 이미 모아 둔 파일만 읽는다(새 API 없음). 메시지에 사이트(깃허브) 주소는 넣지 않는다(사용자 지시). 보낸 기록은 data_sources/tg_state.json(커밋됨).

보내는 것 — 2026-10-19 사용자: 정해 둔 시각이 아니라 각 데이터가 새로 들어오는 즉시 한 번씩(워크플로가 데이터 푸시 직후·15분마다 확인)
  1) AI 지표(그래프)
     · GPU별 렌탈 지수(H100·H200·B200·A100) — 새 정산일이 들어오면(Ornn 미 동부 16:00 정산 → 보통 한국 05~07시)
     · 네비우스 GPU 스팟 가격 카드 — 하루 한 번, 09:00(세계 표준시 하루 마감) 이후 첫 확인 때
     · 빅테크·AI CDS — 새 결제일이 들어오면
     · 네오클라우드·빅테크 회사채 수익률(코어위브 등) — FINRA 장 마감 값의 새 거래일이 들어오면
     · OpenRouter 지표 — 새 날짜(세계 표준시 하루 = 09:00 KST 마감)가 들어오면, 월요일엔 주간 토큰 총량·주간 지출 그래프를 함께(앨범)
  ·) 일본 소비재 월차 — 새 달 월차가 들어오면 확인 회차마다 한 통(데이터 허브 일본 소비재 월차)
  2) 팟캐스트 — 새 편 요약이 올라오면: 제목 · 핵심 3줄 · 내용 정리(tg_body, 1,000자 이내 단락)
  3) 오늘 시황 요약 — 매일 06:30 예약 작업이 쓰고 올리면 바로(본문 그대로)
  ·) 세상 흐름 딥 인사이트 — 인물 발언 1건당 1편이 insights.json 에 새로 들어오면: 인물 · 발단 · 제목 · 요약 · 출처(뉴스방, 2026-10-26 사용자)
  4) 매크로 요약 — 미국 국채 새 종가가 들어오면: 공포·탐욕 · 미 국채 2·10·30년 · WTI 그래프 묶음 / 원/달러 환율 그래프는 새 환율 날짜가 들어오면

  python tg_notify.py            # 때가 된 것 중 아직 안 보낸 것만 보냄
  python tg_notify.py --dry      # 보내지 않고 내용만 출력(그래프는 임시 폴더에 그림)
  python tg_notify.py --due      # 지금 보낼 게 있으면 "yes" — 워크플로가 그래프 도구 설치 여부를 정할 때
  python tg_notify.py --force all|gpu|cds|bond|openrouter|macro|digest|podcast|insight   # 기록 무시하고 그 항목을 지금 보냄(시험용)
"""
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import send_telegram as tg
from send_telegram import esc, KST

BASE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(BASE, "data_sources", "tg_state.json")
GIT = shutil.which("git") or r"C:\Program Files\Git\cmd\git.exe"
REF = "origin/main"
NOW = datetime.now(KST)
DOW = "월화수목금토일"


# ── origin/main 에서 읽기 ─────────────────────────────────────
def git(*args):
    r = subprocess.run([GIT, *args], cwd=BASE, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip())
    return r.stdout


_cache = {}


def load(path):
    if path not in _cache:
        try:
            _cache[path] = json.loads(git("show", f"{REF}:{path}").decode("utf-8"))
        except Exception:
            _cache[path] = None
    return _cache[path]


def ls(path):
    try:
        out = git("ls-tree", "--name-only", f"{REF}:{path}").decode("utf-8")
        return [n for n in out.split("\n") if n.endswith(".json")]
    except Exception:
        return []


# ── 공통 ─────────────────────────────────────────────────────
def at(d, hh, mm):
    """d(날짜) 의 한국시간 hh:mm"""
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=KST)


def us_dst(d):
    """미국 서머타임(3월 둘째 일요일 ~ 11월 첫째 일요일)"""
    def nth_sunday(y, m, n):
        first = date(y, m, 1)
        return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))
    return nth_sunday(d.year, 3, 2) <= d < nth_sunday(d.year, 11, 1)


def stamp(t):
    """'2026-10-07T05:49+09:00' · '2026-10-07 08:11 KST' → '10/07(수) 05:49'"""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})", str(t or ""))
    if not m:
        return ""
    y, mo, d, hh, mi = m.groups()
    return f"{mo}/{d}({DOW[date(int(y), int(mo), int(d)).weekday()]}) {hh}:{mi}"


def upd_mark(basis, upd):
    """그래프 점선 옆 글귀 — '10/27 장 마감' + '10/29(목) 08:51 갱신' 두 줄 (2026-10-29 사용자)"""
    return "\n".join(x for x in (basis, f"{upd} 갱신" if upd else "") if x)


def md(d):
    return str(d)[5:10].replace("-", "/")


def chg(a, b):
    return (b / a - 1) * 100 if a else 0.0


def arrow(p):
    return "🔺" if p > 0.05 else "🔻" if p < -0.05 else "▫️"


def ai_series():
    d = load("docs/data/ai_indicators.json") or {}
    return {s["id"]: s for s in d.get("series") or []}


def md_to_html(md):
    """사이트 마크다운 → 텔레그램 HTML(굵게·제목·글머리표·링크)"""
    out = []
    for ln in md.split("\n"):
        quote = ln.lstrip().startswith(">")
        s = esc(ln.lstrip()[1:].strip() if quote else ln.rstrip())
        s = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        s = s.replace("__", "")
        m = re.match(r"^#{2,4}\s+(.*)", s)
        if m:
            s = f"\n<b>■ {m.group(1)}</b>"
        elif re.match(r"^\s*[-*]\s+", s):
            s = re.sub(r"^(\s*)[-*]\s+", lambda g: "  " * (len(g.group(1)) // 2) + "• ", s)
        out.append(f"<i>{s}</i>" if quote else s)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


# ── 1) AI 지표 ───────────────────────────────────────────────
def gpu():
    s = ai_series().get("gpu_index_multi") or {}
    lines = [l for l in s.get("lines") or [] if l.get("points")]
    if not lines:
        return None
    last = max(l["points"][-1]["date"] for l in lines)
    d = date.fromisoformat(last)
    gate = READY   # 새 정산일이 들어오는 즉시(2026-10-19 사용자: 정해진 시각 말고 데이터가 갱신될 때)

    def build():
        from tg_charts import line
        order = {"B200": 0, "H200": 1, "H100 SXM": 2, "A100": 3}
        ls_ = sorted(lines, key=lambda l: order.get(l["label"], 9))
        img = line("gpu", "GPU별 렌탈 지수", f"Ornn 컴퓨트 가격 지수(OCPI · 실제 체결 기준) · $/GPU·시간 · {last} 정산",
                   [(l["label"], [(p["date"], p["value"]) for p in l["points"]]) for l in ls_], digits=2,
                   mark=upd_mark(f"{md(last)} 정산", stamp(s.get("updated_at"))))
        rows = []
        for l in ls_:
            p = l["points"]
            pc = chg(p[-2]["value"], p[-1]["value"]) if len(p) > 1 else 0
            rows.append(f"{arrow(pc)} {esc(l['label'])} <b>${p[-1]['value']:.2f}</b> ({pc:+.1f}%)")
        cap = (f"🖥 <b>GPU 렌탈 지수</b> · {d.strftime('%m/%d')} 정산 · {stamp(s.get('updated_at'))} 갱신\n" + "\n".join(rows) +
               "\n<i>1시간 임대 체결가 · 전일 대비</i>")
        return [img], cap
    return (f"gpu:{last}", gate, build)


def nebius():
    """네비우스 GPU 스팟 가격 카드(2026-10-20 사용자) — 하루 한 번, 세계 표준시 새 날의 값이 처음 들어오면(보통 09:00~09:30 KST).
    GPU마다 지금 가장 싼 지역의 최근 7일 15분 단위 가격과 7일 전 대비. 자료: docs/data/nebius_spot.json(fetch_ai_indicators.c_nebius 가 쌓음)"""
    st = load("docs/data/nebius_spot.json") or {}
    pts, skus, seen = st.get("pts") or {}, st.get("skus") or {}, st.get("seen") or {}
    if not pts or not seen:
        return None
    last = max(seen.values())

    def build():
        from tg_charts import spot_cards
        now = datetime.fromisoformat(last)
        t0 = now - timedelta(days=7)
        def at_(L, t):
            v = None
            for ts_, p in L:
                if ts_ > t:
                    break
                v = p
            return v
        cards, rows = [], []
        for g in ("B300", "B200", "H200", "H100", "RTX PRO 6000"):
            cand = [k for k, m in skus.items() if m.get("gpu") == g and pts.get(k)]
            if not cand:
                continue
            k = min(cand, key=lambda k: pts[k][-1][1])
            L = pts[k]
            cur = L[-1][1]
            t7 = t0.strftime("%Y-%m-%dT%H:%M")
            old = at_(L, t7)
            if old is None and L[0][0] <= (now - timedelta(days=6, hours=12)).strftime("%Y-%m-%dT%H:%M"):
                old = L[0][1]
            pc = (cur / old - 1) * 100 if old else None
            series = []
            for ts_, v in L:
                t = datetime.fromisoformat(ts_)
                if t >= t0:
                    series.append((t, v))
            first = at_(L, t7)
            if first is not None:
                series.insert(0, (t0, first))
            series.append((now, cur))
            cards.append((g, skus[k].get("region") or "", cur, pc, series))
            rows.append(f"{arrow(pc or 0)} {esc(g)} <b>${cur:,.2f}</b>" + (f" ({pc:+.1f}%)" if pc is not None else "") + f" · {esc(skus[k].get('region') or '')}")
        if not cards:
            return None, None
        img = spot_cards("nebius", "네비우스 GPU 스팟 가격", f"선점형 임대가 · $/GPU·시간 · GPU마다 지금 가장 싼 지역 · 최근 7일 · {stamp(st.get('updated'))} 기준", cards)
        cap = (f"🟣 <b>네비우스 GPU 스팟 가격</b> · {stamp(st.get('updated'))} 기준" + NL + NL.join(rows) +
               NL + "<i>가장 싼 지역 기준 · 괄호는 7일 전 대비 · 네비우스는 7일만 공개해 우리가 계속 쌓는 중</i>")
        return [img], cap
    # 15분마다 바뀌는 가격이라 하루 한 번 — 한국 날짜마다 09:00(세계 표준시 하루가 닫힌 뒤) 이후 첫 확인 때
    return (f"nebius:{NOW.date().isoformat()}", at(NOW.date(), 9, 0), build)


def cds():
    """빅테크·AI CDS(2026-10-15 사용자) — ICE 결제가격이 들어오는 매일 아침(약 06:20)에 그래프 2장 + 오늘 표.
    기준일(as_of) 다음 날 06:20 이후, 새 기준일이 들어왔을 때 한 번."""
    S = ai_series()
    tab = S.get("cds_table") or {}
    asof = tab.get("as_of")
    if not asof or not tab.get("rows"):
        return None
    gate = READY   # 새 결제일이 들어오는 즉시

    def build():
        from tg_charts import line
        imgs = []
        for sid, title, log in (("cds_bigtech", "빅테크 CDS", False), ("cds_neocloud", "오라클·네오클라우드 CDS", True), ("cds_ai", "AI 칩·서버 CDS", False)):
            ls_ = [l for l in (S.get(sid) or {}).get("lines") or [] if len(l.get("points") or []) > 1]
            if ls_:
                imgs.append(line(sid, title, f"5년물 · bp · ICE 결제가격 · {asof} 기준" + (" · 로그 눈금" if log else ""),
                                 [(l["label"], [(p["date"], p["value"]) for p in l["points"]]) for l in ls_], digits=0, log=log,
                                 mark=upd_mark(f"{md(asof)} 결제", stamp((S.get(sid) or {}).get("updated_at") or tab.get("updated_at")))))
        rows = []
        for r in tab["rows"]:
            c = r.get("chg")
            mark = "▫️" if c is None or abs(c) < 0.05 else ("🔺" if c > 0 else "🔻")
            rows.append(f"{mark} {esc(r['name'])} <b>{r['bp']:,.1f}</b>" + (f" ({c:+.1f})" if c is not None else ""))
        cap = (f"🛡 <b>빅테크·AI CDS (5년물)</b> · {asof[5:].replace('-', '/')} 결제 · {stamp(tab.get('updated_at'))} 갱신\n"
               + "\n".join(rows) + "\n<i>bp · 괄호는 전일 대비 · 오르면 시장이 그 회사 빚을 더 위험하게 본다는 뜻</i>")
        return imgs, cap
    return (f"cds:{asof}", gate, build)


def bonds():
    """네오클라우드·빅테크 회사채 수익률(2026-10-29 사용자: 코어위브 채권 금리도 종가로) — FINRA 장 마감 값의 새 거래일이 들어오면
    그래프 2장(네오클라우드+국채 5년 · 빅테크+국채 30년) + 채권별 종가 수익률·전 거래일 대비. 자료: fetch_ai_indicators.c_bonds"""
    S = ai_series()
    tab = S.get("bond_table") or {}
    asof = tab.get("as_of")
    if not asof or not tab.get("rows"):
        return None
    price = {r["name"]: r.get("price") for r in tab["rows"]}

    def build():
        from tg_charts import line
        imgs, parts = [], []
        for sid, title, sub in (("bond_neocloud", "네오클라우드 채권 수익률", "만기수익률 · % · 미국 국채 5년과 비교"),
                                ("bond_bigtech", "빅테크·오라클 장기채 수익률", "만기수익률 · % · 미국 국채 30년과 비교")):
            ls_ = [l for l in (S.get(sid) or {}).get("lines") or [] if len(l.get("points") or []) > 1]
            if not ls_:
                continue
            imgs.append(line(sid, title, f"{sub} · 최근 1년 · FINRA 장 마감 · {asof} 기준",
                             [(l["label"], [(p["date"], p["value"]) for p in l["points"]]) for l in ls_], digits=2, unit="%", since_days=365,
                             mark=upd_mark(f"{md(asof)} 장 마감", stamp((S.get(sid) or {}).get("updated_at") or tab.get("updated_at")))))
            rows = []
            for l in ls_:
                p = l["points"]
                d = (p[-1]["value"] - p[-2]["value"]) * 100
                mark = "▫️" if abs(d) < 0.5 else ("🔺" if d > 0 else "🔻")
                px = price.get(l["label"])
                rows.append(f"{mark} {esc(l['label'])} <b>{p[-1]['value']:.2f}%</b> ({d:+.0f}bp)"
                            + (f" · 가격 {px:.2f}" if px is not None else "") + (f" · {p[-1]['date'][5:].replace('-', '/')}" if p[-1]["date"] != asof else ""))
            parts.append(f"<b>{'🏗 네오클라우드' if sid == 'bond_neocloud' else '🏢 빅테크·오라클'}</b>\n" + "\n".join(rows))
        if not parts:
            return None, None
        cap = (f"💵 <b>회사채 수익률 (종가)</b> · {asof[5:].replace('-', '/')} 장 마감 · {stamp(tab.get('updated_at'))} 갱신\n\n"
               + "\n\n".join(parts) + "\n<i>그날 마지막 체결 수익률 · 괄호는 전 거래일 대비 · 날짜가 붙은 건 그날 거래가 없어 마지막 체결일 값 · 오르면 시장이 그 빚을 더 위험하게 본다는 뜻</i>")
        return imgs, cap
    return (f"bond:{asof}", READY, build)


CO_REF = {"6532": "docs/data/baycurrent.json"}  # 회사 공시 분기 인원·전망이 있는 기업 (데이터 허브 워크벤치 파일)


def co_kpi(code, c):
    """직전 분기 회사 공시 인원(k)·다음 분기 회사 전망(g) — 데이터 허브 워크벤치 파일(CO_REF, 결산 때 자동 갱신)이 있으면 그걸,
    없으면 data_sources/headcount_watch.json 의 kpi·guide 를 쓴다. k={q,end,total,consultants} g={q,end,total,consultants}"""
    d = load(CO_REF[code]) if code in CO_REF else None
    if d:
        hc = [h for h in d.get("headcount") or [] if isinstance(h.get("total"), (int, float))]
        sr = {x["id"]: x for x in d.get("series") or []}
        k = {"q": "직전 분기", "end": hc[-1]["date"], "total": hc[-1]["total"], "consultants": hc[-1].get("consultants")} if hc else None
        gt = [x for x in (sr.get("gd_total") or {}).get("points") or [] if not k or x["date"] > k["end"]]
        gc = {x["date"]: x for x in (sr.get("gd_consultants") or {}).get("points") or []}
        g = None
        if gt:
            rng = gc.get(gt[0]["date"], {}).get("range")
            g = {"q": "다음 분기", "end": gt[0]["date"], "total": gt[0]["value"],
                 "consultants": f"{rng[0]:,}~{rng[1]:,}" if rng else (f"{gc[gt[0]['date']]['value']:,.0f}" if gt[0]["date"] in gc else None)}
        if k or g:
            return k, g
    return ((c.get("kpi") or [None])[-1], c.get("guide"))


def headcount():
    """일본 기업 인력 수(후생연금 가입자, 2026-10-19 사용자) — 연금기구 데이터 갱신일마다 fetch_headcount.py 가 기록하면 바로 뉴스방으로"""
    d = load("docs/data/tracking/headcount.json") or {}
    comps = {c["code"]: c for c in (load("data_sources/headcount_watch.json") or {}).get("companies") or []}   # 공시 인원·회사 전망
    hist = d.get("history") or []
    out = []
    for code in sorted({h["code"] for h in hist}):
        hs = [h for h in hist if h["code"] == code]
        cur = hs[-1]
        prev = hs[-2] if len(hs) > 1 else None
        yago = next((h for h in reversed(hs) if h["date"] <= f"{int(cur['date'][:4]) - 1}{cur['date'][4:]}"), None)

        def build(cur=cur, prev=prev, yago=yago, c=comps.get(code) or {}):
            n = cur["total"]
            pct = lambda a, b: f"{(a - b) / b * 100:+.1f}%"
            mon = lambda e: f"{int(e[5:7])}월 말"
            lines = [f"👥 <b>{esc(cur['name'])}({cur['code']}) 인력 · 후생연금 가입자</b>",
                     f"<i>일본연금기구 {cur['date'][5:].replace('-', '/')} 갱신</i>", "",
                     f"<b>지금 {n:,}명</b>" + (f"  전월 {n - prev['total']:+,} ({pct(n, prev['total'])})" if prev else "  (첫 기록 — 다음 갱신부터 전월 비교)")]
            if yago:
                lines.append(f"1년 전 대비 {n - yago['total']:+,} ({pct(n, yago['total'])})")
            # 회사 공시(총사원 = 연금 가입자와 같은 기준)와 다음 분기 회사 전망
            k, g = co_kpi(cur["code"], c)
            if k:
                lines += ["", f"📌 직전 분기 실적 ({mon(k['end'])} · 회사 공시)",
                          f"   총사원 {k['total']:,}명 → 지금 <b>{n - k['total']:+,}</b> ({pct(n, k['total'])})"]
            if g:
                left = round(g["total"] - n)
                prog = f" · 진척 {(n - k['total']) / (g['total'] - k['total']) * 100:.0f}%" if k and g["total"] != k["total"] else ""
                lines += [f"🎯 다음 분기 회사 전망 ({mon(g['end'])})",
                          f"   총사원 약 {g['total']:,.0f}명 → " + (f"<b>남은 {left:+,}명</b>{prog}" if left > 0 else f"<b>이미 넘음 ({-left:+,}명)</b>")]
            if k and g and k.get("consultants") and g.get("consultants"):
                lines.append(f"   (컨설턴트 {k['consultants']:,} → 전망 {g['consultants']}명)")
            pr = {r["houjin"]: r["n"] for r in (prev or {}).get("rows") or []}
            labels = c.get("labels") or {}
            lines += ["", "🏢 " + " · ".join(f"{esc(labels.get(r['houjin']) or r['name'])} {r['n']:,}" + (f"({r['n'] - pr[r['houjin']]:+,})" if r["houjin"] in pr else "")
                                             for r in cur["rows"]),
                      "", "<i>연금 가입자 ≈ 총사원(본사·연수 중 신입 포함, 파견·임원 제외) · 결산보다 먼저 채용 속도를 보는 지표</i>",
                      f"#{hashtag(cur['name'])}"]
            dest = route("news")
            return (None, "\n".join(lines), dest) if dest else (None, None)
        out.append((f"hc:{code}:{cur['date']}", NOW, build))
    return out


def span(ws):
    """주 시작일 → '10.05~10.11'"""
    d = date.fromisoformat(ws)
    return f"{d:%m.%d}~{d + timedelta(days=6):%m.%d}"


def openrouter():
    """평균 실효 단가 + 주간 토큰 총량 + 주간 지출 — 한 메시지(그래프 3장 앨범), 매일 09:30"""
    S = ai_series()
    p = (S.get("or_avg_price") or {}).get("points") or []
    t = (S.get("or_tokens_weekly") or {}).get("points") or []
    sp = (S.get("or_spend_7d") or {}).get("points") or []
    if len(p) < 2:
        return None
    last = p[-1]["date"]
    gate = READY   # 새 날짜 값이 들어오는 즉시(주간 값은 아래 규칙대로 월요일에 붙임)
    # 주간 값(토큰·지출)은 OpenRouter 가 지난주를 확정하는 월 09:00 KST(세계 표준시 월 0시) 이후, 둘 다 같은 새 주로
    # 바뀐 날의 메시지에만 한 번 붙인다(2026-10-10·12 사용자 지시). 월요일엔 주간 값이 들어올 때까지 12:00 까지 기다린다.
    wk = (NOW.date() - timedelta(days=NOW.weekday() + 7)).isoformat()      # 마지막으로 끝난 주(월요일)
    wk_key = f"weekly:{wk}"
    weekly_ready = len(t) > 1 and len(sp) > 1 and t[-1]["date"] == wk and sp[-1]["date"] == wk
    forced = "--force" in sys.argv                                         # 시험 발송은 이미 보낸 주간 값도 다시 붙인다
    weekly_due = weekly_ready and (forced or wk_key not in SENT) and NOW >= at(date.fromisoformat(wk) + timedelta(days=7), 9, 0)
    if NOW.weekday() == 0 and not weekly_ready and wk_key not in SENT and NOW < at(NOW.date(), 12, 0):
        return None
    if not weekly_due:
        t, sp = [], []

    def build():
        from tg_charts import bars, line
        imgs = [line("price", "OpenRouter 평균 실효 단가", f"토큰 100만 개당 실제 지불액(지출 ÷ 토큰) · $/M · 최근 7일 기준 · {last}",
                     [("단가", [(x["date"], x["value"]) for x in p])], digits=3, fill=True,
                     mark=upd_mark(f"{md(last)} 마감", stamp((S.get('or_avg_price') or {}).get('updated_at'))))]
        d1 = chg(p[-2]["value"], p[-1]["value"])
        wk = (date.fromisoformat(last) - timedelta(days=7)).isoformat()
        w = next((x for x in reversed(p) if x["date"] <= wk), None)
        rows = [f"{arrow(d1)} 평균 실효 단가 <b>${p[-1]['value']:.4f}</b>/100만 토큰 (전일 {d1:+.1f}%"
                + (f" · 1주 전 대비 {chg(w['value'], p[-1]['value']):+.1f}%)" if w else ")")]
        if len(t) > 1:
            ws = t[-1]["date"]
            imgs.append(bars("tokens", "OpenRouter 주간 토큰 총량", f"한 주(월~일) 처리 토큰 · 조(T) 토큰 · 최근 26주 · {span(ws)}",
                             [(x["date"], x["value"]) for x in t[-26:]], digits=1, unit="T",
                             mark=upd_mark(span(ws), stamp((S.get('or_avg_price') or {}).get('updated_at')))))
            w1 = chg(t[-2]["value"], t[-1]["value"])
            rows.append(f"{arrow(w1)} 주간 토큰 <b>{t[-1]['value']:,.1f}T</b> (전주 대비 {w1:+.1f}% · {span(ws)})")
        if len(sp) > 1:
            imgs.append(bars("spend", "OpenRouter 주간 지출", f"주간 토큰 × 실효 단가 · 백만 달러 · {span(sp[-1]['date'])}",
                             [(x["date"], x["value"]) for x in sp], digits=1, unit="M",
                             mark=upd_mark(span(sp[-1]["date"]), stamp((S.get('or_avg_price') or {}).get('updated_at')))))
            w2 = chg(sp[-2]["value"], sp[-1]["value"])
            rows.append(f"{arrow(w2)} 주간 지출 <b>${sp[-1]['value']:,.1f}M</b> (전주 대비 {w2:+.1f}%)")
        cap = (f"🤖 <b>OpenRouter 지표</b> · {last[5:].replace('-', '/')} 기준 · "
               f"{stamp((S.get('or_avg_price') or {}).get('updated_at'))} 갱신\n" + "\n".join(rows) +
               "\n<i>OpenRouter 경유 트래픽만 집계(직접 API 제외)" + (" · 주간 값은 OpenRouter가 지난주를 확정하는 월요일에만" if t else "") + "</i>")
        return imgs, cap
    return (f"or:{last}|{wk_key}" if weekly_due else f"or:{last}", gate, build)


# ── 2) 팟캐스트 ───────────────────────────────────────────────
def route(kind):
    """트래킹 전용 그룹 토픽(텔레그램에서 '/연결 뉴스|블로그'로 지정, track_fetch 가 tracking_state 에 저장).
    지정돼 있으면 {"chat","thread"}, 없으면 {} → 기본 채널"""
    r = ((load("data_sources/tracking_state.json") or {}).get("route") or {}).get(kind) or {}
    return {"chat": r.get("chat"), "thread": r.get("thread")} if r.get("chat") else {}


def podcasts():
    ix = load("docs/data/podcasts/index.json") or {}
    since = (NOW - timedelta(days=3)).strftime("%Y-%m-%d")
    have = set(ls("docs/data/podcasts/ep"))
    out = []
    for row in ix.get("episodes") or []:
        if row.get("status") not in ("done", "sent") or row["id"] + ".json" not in have or row.get("published", "") < since:
            continue

        def build(row=row):
            ep = load(f"docs/data/podcasts/ep/{row['id']}.json") or {}
            show = ep.get("show_name") or row.get("show_name") or ""
            lines = [f"🎙 <b>{esc(ep.get('title_ko') or ep.get('title') or row.get('title'))}</b>"]
            # 공개 일시·길이(2026-10-12 사용자: 인터뷰 날짜·시간이 왜 없나) — 방송사가 올린 시각(한국 시간). 녹화일은 방송사가 밝히지 않는다
            pub, when = row.get("published") or "", ""
            try:
                dt = datetime.strptime(pub[:16], "%Y-%m-%d %H:%M")
                h = dt.hour
                when = f"{dt.year}년 {dt.month}월 {dt.day}일({'월화수목금토일'[dt.weekday()]}) {'오전' if h < 12 else '오후'} {h % 12 or 12}:{dt.minute:02d} 공개"
            except Exception:
                when = (row.get("date") or "") and f"{row['date']} 공개"
            dur = row.get("duration") or ""
            if dur:
                p = [int(x) for x in dur.split(":") if x.isdigit()]
                sec = 0
                for x in p:
                    sec = sec * 60 + x
                hh, mm = sec // 3600, round(sec % 3600 / 60)
                dur = (f"{hh}시간 {mm}분" if hh else f"{mm}분") if sec else ""
            top = " · ".join(x for x in (when, dur) if x)   # 제목 바로 다음 줄에 날짜·시간(2026-10-12 사용자)
            if top:
                lines.append(f"🗓 {esc(top)}")
            if show:
                lines.append(f"<i>{esc(show)}</i>")
            tl = ep.get("tldr") or []
            if tl:
                lines += ["", "<b>핵심 요약</b>"] + [f"{i}. {esc(str(x).replace('__', ''))}" for i, x in enumerate(tl[:3], 1)]
            body = ep.get("tg_body") or ep.get("tg") or ""
            if body:
                lines += ["", "<b>내용 정리</b>", md_to_html(body)]
            lines.append("")
            if ep.get("link") or row.get("link"):
                lines.append(f"▶️ 원본: {ep.get('link') or row.get('link')}")
            dest = route("blog")       # 팟캐스트 = 인터뷰 → 블로그·인터뷰 토픽. 그룹 연결 전엔 보내지 않고 대기(채널엔 안 올림)
            return (None, "\n".join(lines), dest) if dest else (None, None)
        out.append((f"pod:{row['id']}", NOW, build))
    return out


# ── 3) 오늘 시황 요약 ─────────────────────────────────────────
def hashtag(term):
    return re.sub(r"[^\w가-힣]", "", (term or "").replace(" ", "_"))


STATE = {}   # main 이 채움 — 기업별 토픽 번호(topics)를 여기서 읽고 쓴다


def topic_name(t):
    """토픽 이름: 기업 '티엘비 · 356860' · '아마존 · AMZN', 섹터·주제는 단어 그대로"""
    return (f"{t['term']} · {t['ticker']}" if t.get("ticker") and t.get("market") in ("us", "kr") else t["term"])[:120]


def company_topic(t, renew=False):
    """'트래킹 기업' 그룹(토픽 켬)에서 이 단어의 토픽 번호 — 없으면 봇이 만든다(봇에 '토픽 관리' 권한 필요)"""
    r = route("company")
    if not r:
        return None
    tops = STATE.setdefault("topics", {})
    if t["slug"] in tops and not renew:
        return tops[t["slug"]]
    res = tg.api("createForumTopic", {"chat_id": r["chat"], "name": topic_name(t),
                                      "icon_color": 0x6FB9F0 if t.get("market") == "us" else 0xFF93B2 if t.get("market") == "kr" else 0x8EEE98})
    tops[t["slug"]] = res["message_thread_id"]
    print("토픽 만듦:", topic_name(t), res["message_thread_id"])
    return tops[t["slug"]]


def sync_topics():
    """새로 추가한 기업·섹터는 기사가 없어도 토픽부터 만들어 둔다. 종합(General) 이름은 '📋 종합'으로 한 번만."""
    r = route("company")
    if not r:
        return False
    before = dict(STATE.get("topics") or {})
    if STATE.get("topic_fail_at") and NOW.timestamp() - STATE["topic_fail_at"] < 3600:   # 실패하면 1시간 쉬었다 다시
        return False
    for t in (load("docs/data/tracking/watchlist.json") or {}).get("terms") or []:
        if t.get("market") in ("blog", "youtube") or t.get("dest") or not t.get("resolved") or t["slug"] in before:
            continue
        try:
            company_topic(t)
        except Exception as e:
            print("토픽 만들기 실패:", t["term"], e)
            STATE["topic_fail_at"] = NOW.timestamp()
            break
    if not STATE.get("general_named"):
        try:
            tg.api("editGeneralForumTopic", {"chat_id": r["chat"], "name": "📋 종합"})
            STATE["general_named"] = True
        except Exception as e:
            print("종합 이름 바꾸기 실패:", e)
    return STATE.get("topics") != before


def tracking():
    """트래킹 단어 뉴스(2026-10-10~) — 예약 작업 vantage-tracking 이 30분마다 걸러 요약해 올린 기사를 #단어 로 바로 보낸다.
    형식: #단어 → 제목(결론) → 3줄 요약 → 내용 요약 → 원문 링크"""
    watch = load("docs/data/tracking/watchlist.json") or {}
    cut = (NOW - timedelta(days=2)).strftime("%Y-%m-%d %H:%M")
    out = []
    from track_fetch import url_key
    # 같은 주소(제목만 바뀐 같은 글·영상, 여러 단어에 걸린 같은 기사)를 이미 보냈으면 다시 안 보낸다 — 단어 전체에서
    allitems = {t.get("slug"): (load(f"docs/data/tracking/items/{t.get('slug')}.json") or {}).get("items") or [] for t in watch.get("terms") or []}
    done = {url_key(it.get("url")) for sl, its in allitems.items() for it in its if f"trk:{sl}:{it['id']}" in SENT}
    for t in watch.get("terms") or []:
        items = allitems.get(t.get("slug")) or []
        for it in sorted(items, key=lambda x: x.get("written", "")):
            if (it.get("written") or "") < cut:
                continue
            k = url_key(it.get("url"))
            if k in done and f"trk:{t.get('slug')}:{it['id']}" not in SENT:
                continue
            done.add(k)

            def build(t=t, it=it):
                label = (" · 📝 블로그" if t.get("market") == "blog" else " · ▶️ 유튜브" if t.get("market") == "youtube"
                         else (f" · {esc(t.get('ticker'))}" if t.get("ticker") else ""))
                # 출처(누르면 원문)·올라온 시각을 맨 위에(2026-10-11 사용자)
                icon = "📝" if t.get("market") == "blog" else "▶️" if t.get("market") == "youtube" else "📰"
                lines = [f"#{hashtag(t['term'])}" + label,
                         f'{icon} <a href="{esc(it["url"])}">{esc(it.get("source") or "원문")}</a> · {stamp(it.get("published"))}',
                         "", f"<b>{esc(it['headline'])}</b>", ""]
                lines += [f"{i}. {esc(b)}" for i, b in enumerate(it.get("bullets") or [], 1)]
                if it.get("summary"):
                    lines += ["", esc(it["summary"])]
                dest = route(t.get("dest") or ("blog" if t.get("market") in ("blog", "youtube") else "news"))   # 유튜브도 블로그·인터뷰 쪽, dest 로 바꿀 수 있음(테크크런치 → 뉴스방)
                comp = route("company") if t.get("market") not in ("blog", "youtube") and not t.get("dest") else {}   # dest 를 정한 주제(일본 방위·사이버보안·AX 등)는 기업 토픽 대신 그 방으로만
                if comp:   # 기업별 토픽 그룹이 연결돼 있으면: 그 기업 토픽 + 📋 종합(General) 두 곳으로(2026-10-19 사용자)
                    try:
                        dest = {"chat": comp["chat"], "thread": company_topic(t), "also": [{"chat": comp["chat"], "thread": None}], "term": t}
                    except Exception as e:   # 토픽이 안 켜졌거나 권한이 없으면 뉴스방으로 계속 보낸다(뉴스가 멈추지 않게)
                        print("기업 토픽 실패 → 뉴스방으로:", t["term"], str(e)[:120])
                return (None, "\n".join(lines), dest) if dest else (None, None)   # 그룹 연결 전엔 대기
            out.append((f"trk:{t.get('slug')}:{it['id']}", NOW, build))
    return out


def insights():
    """세상 흐름 파악 — 주차별 인물 발언마다 쓰는 딥 인사이트(insights.json)를 새로 들어오는 즉시 뉴스방으로(2026-10-26 사용자).
    added 가 최근 3일 안인 것만(옛 365편을 한꺼번에 보내지 않게). 뉴스방 연결 전엔 대기."""
    since = (NOW - timedelta(days=3)).strftime("%Y-%m-%d")
    names = {p.get("id"): p for p in (load("docs/people.json") or {}).get("people") or []}
    out = []
    for ins in (load("docs/insights.json") or {}).get("insights") or []:
        if (ins.get("added") or "") < since or not ins.get("id"):
            continue

        def build(ins=ins):
            pid = ((ins.get("linked_statement_keys") or [""])[0]).split("::")[0]
            who = names.get(pid) or {}
            lines = ["💡 <b>딥 인사이트</b>" + (f" · {esc(who['name'])}" if who.get("name") else "")
                     + (f" <i>({esc(who['affil'])})</i>" if who.get("affil") else "")]
            if ins.get("trigger"):
                lines.append(f"🗣 {esc(ins['trigger'])}")
            lines += ["", f"<b>{esc(ins.get('title'))}</b>"]
            if ins.get("summary"):
                lines += ["", esc(ins["summary"])]
            if ins.get("linked_tickers"):
                lines += ["", "관련: " + " · ".join(esc(t) for t in ins["linked_tickers"][:6])]
            src = [s for s in ins.get("sources") or [] if s.get("url")][:3]
            if src:
                lines += ["", "<b>출처</b>"] + [f'· <a href="{esc(s["url"])}">{esc(s.get("label") or "원문")}</a>' for s in src]
            dest = route("news")
            return (None, "\n".join(lines), dest) if dest else (None, None)
        out.append((f"ins:{ins['id']}", NOW, build))
    return out


SESSION_NAME = {"asia": "아시아 마감", "us": "미국 마감"}


def digest():
    """하루 두 번(2026-10-10~): 16:10 아시아 마감(일본·한국 + 밤사이 미국 이슈) · 06:30 미국 마감(미국 + 장 후 한국·일본 이슈).
    session 칸이 있는 항목은 회차별로 한 번씩, 없는 옛 항목은 날짜당 한 번."""
    out = []
    for g in (load("docs/news_digest.json") or {}).get("digests") or []:
        if g.get("date") != NOW.strftime("%Y-%m-%d"):
            continue
        ses = g.get("session")

        def build(g=g, ses=ses):
            md = re.sub(r"^## [^\n]*시황 요약[^\n]*\n", "", g.get("markdown") or "").strip()
            head = f"📰 <b>시황 요약 · {SESSION_NAME[ses]}</b>" if ses in SESSION_NAME else "📰 <b>오늘 시황 요약</b>"
            txt = (f"{head} · {stamp(g.get('generated')) or NOW.strftime('%m/%d')} 작성\n<b>{esc(g.get('title'))}</b>\n\n"
                   + md_to_html(md))
            return (None, txt)   # 2026-10-28 사용자: 시황 요약은 뉴스방 말고 돈벌레 채널로(10-17 뉴스방 라우팅 되돌림)
        out.append((f"digest:{g['date']}:{ses}" if ses else f"digest:{g['date']}", NOW, build))
    return out


# ── 4) 매크로 요약 ────────────────────────────────────────────
LIVE_SYMS = {"y2": "US2Y", "y10": "US10Y", "y30": "US30Y", "wti": "@CL.1", "usdkrw": "KRW="}


def live_quotes():
    """보내는 순간의 시세(CNBC 실시간) — {키: (값, 시세 시각 datetime)}. 실패하면 빈 사전(사이트 데이터만 씀)"""
    import ssl
    import urllib.request
    url = ("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols="
           + "|".join(LIVE_SYMS.values()) + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for ctx in (None, ssl._create_unverified_context()):   # 이 PC 는 SSL 가로채기가 있어 두 번째로 재시도
        try:
            with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
                qs = json.loads(r.read().decode("utf-8"))["FormattedQuoteResult"]["FormattedQuote"]
            break
        except Exception as e:
            err = e
    else:
        print("실시간 시세 실패(사이트 데이터로 보냄):", err)
        return {}
    by = {q.get("symbol"): q for q in qs}
    out = {}
    for k, sym in LIVE_SYMS.items():
        q = by.get(sym) or {}
        try:
            v = float(str(q["last"]).replace("%", "").replace(",", ""))
            t = datetime.fromisoformat(re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", q["last_time"]))
            out[k] = (v, t)
        except Exception:
            continue
    return out


def macro():
    today = NOW.date()
    live = {}

    def pts(k, days=365):
        x = ((load("docs/macro_dash.json") or {}).get("indicators") or {}).get(k) or {}
        cut = (today - timedelta(days=days)).isoformat()
        p = [(d, v) for d, v in zip(x.get("dates") or [], x.get("values") or []) if d >= cut and v is not None]
        # 보내는 순간의 실시간 값으로 마지막 점을 바꾸거나(같은 거래일) 새 점으로 붙인다(다음 거래일)
        if k in live and p:
            v, t = live[k]
            d = t.date().isoformat() if k != "usdkrw" else t.astimezone(KST).date().isoformat()
            if d > p[-1][0]:
                p.append((d, v))
            elif d == p[-1][0]:
                p[-1] = (d, v)
        return p

    def when(k):
        """'10/07 종가' 대신 '10/08(목) 08:46 실시간' 처럼 시세 시각까지"""
        return f"{stamp(live[k][1].astimezone(KST).isoformat())} 실시간" if k in live else ""

    def build():
        from tg_charts import line
        fg = load("docs/data/fear_greed.json") or {}
        imgs, rows = [], []
        if fg.get("history"):
            # 사용자가 계기판 대신 처음의 1년 추이 그래프를 골랐다(2026-10-07). tg_charts.gauge 는 남겨 둠
            imgs.append(line("fg", "CNN 공포·탐욕 지수", ("0 = Extreme Fear · 100 = Extreme Greed · 최근 1년 ·", f"{fg.get('updated_kst', '')} 기준"),
                             [("지수", [(d, v) for d, v in fg["history"]])], digits=0, since_days=365,
                             bands=[(0, 25, "#d33f5b", "Extreme Fear"), (25, 45, "#e07a3f", "Fear"), (45, 55, "#6b7588", "Neutral"),
                                    (55, 75, "#3a9f6c", "Greed"), (75, 100, "#1b8a63", "Extreme Greed")],
                             mark=upd_mark("", stamp(fg.get("updated_kst")))))
            rows.append(f"😨 공포·탐욕 <b>{fg.get('score'):.0f} {esc(fg.get('rating'))}</b> (전일 {fg.get('previous_close')} · 1주 전 {fg.get('previous_1_week')} · CNN {stamp(fg.get('updated_kst'))[-5:]})")
        live.update(live_quotes())
        upd = stamp((load("docs/macro_dash.json") or {}).get("updated"))
        ys = [(lab, pts(k)) for lab, k in (("2년", "y2"), ("10년", "y10"), ("30년", "y30"))]
        if all(p for _, p in ys):
            t_y = when("y10") or f"{ys[1][1][-1][0]} 종가 · {upd} 갱신"
            imgs.append(line("yields", "미국 국채금리", ("2년 · 10년 · 30년물 · % · 최근 1년 ·", f"{t_y} 기준"), ys, digits=2, unit="%",
                             mark=t_y.replace(" · ", "\n")))
            parts = [f"{lab} <b>{p[-1][1]:.2f}%</b>({(p[-1][1] - p[-2][1]) * 100:+.0f}bp)" for lab, p in ys if len(p) > 1]
            rows.append("🏦 국채 " + " · ".join(parts) + f"\n      <i>{t_y}</i>")
        w = pts("wti")
        if w:
            t_w = when("wti") or f"{w[-1][0]} 종가 · {upd} 갱신"
            imgs.append(line("wti", "WTI 원유 선물", ("달러/배럴 · 최근 1년 ·", f"{t_w} 기준"), [("WTI", w)], digits=2, fill=True,
                             mark=t_w.replace(" · ", "\n")))
            rows.append(f"🛢 WTI <b>${w[-1][1]:.2f}</b>" + (f" ({chg(w[-2][1], w[-1][1]):+.1f}%)" if len(w) > 1 else "")
                        + f"\n      <i>{t_w}</i>")
        cap = f"📊 <b>매크로 요약</b> · {stamp(NOW.isoformat())} 발송\n" + "\n".join(rows)
        return imgs, cap

    def build_krw():
        from tg_charts import line
        if not live:
            live.update(live_quotes())
        p = pts("usdkrw")
        if not p:
            return None, None
        upd = stamp((load("docs/macro_dash.json") or {}).get("updated"))
        t_k = when("usdkrw") or f"{p[-1][0]} 기준 · {upd} 갱신"
        img = line("usdkrw", "원/달러 환율", ("원 · 최근 1년 ·", f"{t_k} 기준"), [("원/달러", p)], digits=1, fill=True,
                   mark=t_k.replace(" · ", "\n"))
        c = chg(p[-2][1], p[-1][1]) if len(p) > 1 else 0
        return [img], f"💱 <b>원/달러 환율</b> {p[-1][1]:,.1f}원 ({c:+.2f}%)\n<i>{t_k}</i>"

    # 정해진 08:20 대신 새 종가가 들어오면 바로(2026-10-19 사용자) — 국채 10년물(미국 종가)·원/달러 마지막 날짜가 바뀔 때 한 번씩
    def lastd(k):
        x = ((load("docs/macro_dash.json") or {}).get("indicators") or {}).get(k) or {}
        dd = [d for d, v in zip(x.get("dates") or [], x.get("values") or []) if v is not None]
        return dd[-1] if dd else None
    out = []
    if lastd("y10"):
        out.append((f"macro:{lastd('y10')}", READY, build))
    if lastd("usdkrw"):
        out.append((f"usdkrw:{lastd('usdkrw')}", READY, build_krw))
    return out


READY = datetime(2000, 1, 1, tzinfo=KST)   # '때가 됨' — 새 데이터가 있으면 바로 보냄
SENT = set()   # 이미 보낸 키(항목 함수가 '주간 값을 붙일지' 정할 때 씀)


# ── 실행 ─────────────────────────────────────────────────────
NL = chr(10)


def jp_monthly():
    """일본 소비재 월차 새로 나옴(2026-10-12~) — build_jp_monthly_hub.py 가 index.json events 에 남긴 것을
    확인한 회차(found)마다 한 통으로 묶어 보낸다. 형식: 회사(코드) 달 · 대표 지표 ±% (전년 같은 달 대비)"""
    ix = load("docs/data/jp/monthly/index.json") or {}
    cut = (NOW - timedelta(days=2)).strftime("%Y-%m-%d %H:%M")
    groups = {}
    for e in ix.get("events") or []:
        if (e.get("found") or "") >= cut:
            groups.setdefault(e["found"], []).append(e)
    out = []
    for found, evs in sorted(groups.items()):
        def build(evs=evs, found=found):
            def ko_col(k):   # 텔레그램엔 '기존점 매출'·'전점 객수'처럼 짧게(사업부·브랜드 이름은 빼고)
                k = k or ""
                scope = "기존점" if "既存店" in k else "전점" if any(x in k for x in ("全店", "全社", "直営", "合計", "計")) else ""
                metric = "객단가" if "客単価" in k else "객수" if "客数" in k else "매출" if "売上" in k else "지표"
                return (scope + " " + metric).strip()
            rows = []
            for e in sorted(evs, key=lambda x: -(x.get("hv") or 0)):
                m = e.get("m") or ""
                val = f" {ko_col(e.get('hk'))} {'+' if e['hv'] >= 100 else ''}{e['hv'] - 100:.1f}%" if e.get("hv") is not None else ""
                rows.append(f"• {esc(e.get('ko') or e['c'])}({e['c']}) {int(m[5:7]) if m else ''}월{esc(val)}")
            more = (NL + "…외 " + str(len(rows) - 40) + "곳") if len(rows) > 40 else ""
            head = f"📊 <b>일본 소비재 월차 — {len(evs)}곳 새로 나옴</b>"
            tail = "전년 같은 달 대비 · 전체 표: 데이터 허브 → 일본 소비재 월차" + NL + "https://minwook1011.github.io/vantage-0910/datahub.html#jpm"
            return (None, head + NL + NL.join(rows[:40]) + more + NL + NL + tail, {})
        out.append((f"jpm:{found}", NOW, build))
    return out


ITEMS = {"gpu": gpu, "nebius": nebius, "cds": cds, "bond": bonds,"headcount": headcount, "openrouter": openrouter, "podcast": podcasts, "digest": digest, "insight": insights, "macro": macro, "tracking": tracking, "jp_monthly": jp_monthly}


def collect():
    out = []
    for name, fn in ITEMS.items():
        try:
            r = fn()
        except Exception as e:
            print(f"{name} 확인 실패:", e)
            continue
        for it in (r if isinstance(r, list) else [r] if r else []):
            out.append((name,) + it)
    return out


def main():
    a = sys.argv[1:]
    dry, due_only = "--dry" in a, "--due" in a
    force = a[a.index("--force") + 1] if "--force" in a else None
    try:
        git("fetch", "-q", "origin", "main")
    except Exception as e:
        print("git fetch 실패(이전 내용으로 진행):", e)
    state = json.load(open(STATE_PATH, encoding="utf-8")) if os.path.exists(STATE_PATH) else {}
    sent = set(state.get("sent") or [])
    SENT.update(sent)
    before = set(sent)
    STATE.update(state)
    topics_changed = False
    if not dry and not due_only:
        try:
            topics_changed = sync_topics()
        except SystemExit:
            pass

    todo = [(key, build) for name, key, gate, build in collect()
            if ((force == "all" or name == force) if force else (key not in sent and NOW >= gate))]
    if due_only:   # 기업별 토픽 그룹에 아직 토픽이 없는 기업이 있어도 돌린다
        need = route("company") and any(t.get("market") not in ("blog", "youtube") and not t.get("dest") and t.get("resolved") and t["slug"] not in (state.get("topics") or {})
                                        for t in (load("docs/data/tracking/watchlist.json") or {}).get("terms") or [])
        print("yes" if todo or need else "no")
        return

    silent = NOW.hour < 7
    for key, build in todo:
        try:
            res = build()
            imgs, text = res[0], res[1]
            dest = res[2] if len(res) > 2 else {}
            if not text:
                continue
            # 사이트(깃허브) 주소는 어떤 경우에도 내보내지 않는다(사용자 지시) — 본문에 섞여 들어와도 그 줄째 뺀다
            text = "\n".join(l for l in text.split("\n") if "github.io" not in l and "github.com" not in l)
            if dry:
                print("─" * 30, key, imgs or "", "\n" + text)
                continue
            if imgs:
                r = tg.send_photos(imgs, text if len(text) <= 1024 else text[:1000] + "…", silent=silent)
                ids = [m.get("message_id") for m in (r if isinstance(r, list) else [r]) if isinstance(m, dict)]
            else:
                try:
                    ids = tg.send(text, silent=silent, chat=dest.get("chat"), thread=dest.get("thread"))
                except RuntimeError as e:   # 사용자가 토픽을 지웠으면 다시 만들어 한 번 더
                    if not dest.get("term") or "thread" not in str(e).lower():
                        raise
                    ids = tg.send(text, silent=silent, chat=dest["chat"], thread=company_topic(dest["term"], renew=True))
                for o in dest.get("also") or []:
                    tg.send(text, silent=True, chat=o["chat"], thread=o.get("thread"))
            sent.update(key.split("|"))
            # 채널 메시지 번호 기록(나중에 고치거나 지울 때 씀) — 최근 500건만
            msgs = state.setdefault("msg", {})
            msgs[key] = ids
            if len(msgs) > 500:
                for k in list(msgs)[:-500]:
                    del msgs[k]
            print("보냄:", key)
        except SystemExit as e:
            print("텔레그램 설정 없음:", e)
            break
        except Exception as e:
            print("전송 실패:", key, e)

    for k in ("topics", "general_named", "topic_fail_at"):
        if k in STATE and STATE[k] != state.get(k):
            state[k] = STATE[k]
            topics_changed = True
    if not dry and (sent != before or topics_changed):   # 보낸 게 있을 때만 쓴다(GitHub 에서 불필요한 커밋 방지)
        state["sent"] = sorted(sent)
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
    print(f"확인 끝 — 보낼 것 {len(todo)}건" + (" (미리보기)" if dry else ""))


if __name__ == "__main__":
    main()
