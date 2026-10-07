#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tg_notify.py — 사이트(origin/main) 데이터를 읽어 텔레그램 '돈벌레' 채널로 보낸다 (봇: @vantage0910_alert_bot)

GitHub Actions(.github/workflows/tg-notify.yml)가 PC 푸시·데이터 수집 직후와 15분마다 돌린다 — PC 가 꺼져 있어도 된다.
데이터는 사이트 수집기가 이미 모아 둔 파일만 읽는다(새 API 없음). 메시지에 사이트(깃허브) 주소는 넣지 않는다(사용자 지시). 보낸 기록은 data_sources/tg_state.json(커밋됨).

보내는 것(2026-10-07 사용자 지정) — 각 데이터가 실제로 갱신되는 시각 직후에 한 번씩
  1) AI 지표(그래프)
     · GPU별 렌탈 지수(H100·H200·B200·A100) — 매일 06:00 (Ornn 이 미 동부 16:00 정산 → 서머타임 해제 뒤엔 07:00)
     · OpenRouter 지표 한 메시지(그래프 3장) — 매일 09:30: 평균 실효 단가 + 주간 토큰 총량 + 주간 지출
       (하루는 UTC 자정 = 09:00 KST 에 닫히고, 주간 값은 월 09:00 KST 에 새 주로 바뀜)
  2) 팟캐스트 — 새 편 요약이 올라오면: 제목 · 핵심 3줄 · 내용 정리(tg_body, 1,000자 이내 단락)
  3) 오늘 시황 요약 — 매일 06:30 예약 작업이 쓰고 올리면 바로(본문 그대로)
  4) 매크로 요약 — 매일 08:20: 공포·탐욕 · 미 국채 2·10·30년 · WTI 그래프 묶음 + 원/달러 환율 그래프

  python tg_notify.py            # 때가 된 것 중 아직 안 보낸 것만 보냄
  python tg_notify.py --dry      # 보내지 않고 내용만 출력(그래프는 임시 폴더에 그림)
  python tg_notify.py --due      # 지금 보낼 게 있으면 "yes" — 워크플로가 그래프 도구 설치 여부를 정할 때
  python tg_notify.py --force all|gpu|openrouter|macro|digest|podcast   # 기록 무시하고 그 항목을 지금 보냄(시험용)
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
    gate = at(d + timedelta(days=1), 6 if us_dst(d) else 7, 0)

    def build():
        from tg_charts import line
        order = {"B200": 0, "H200": 1, "H100 SXM": 2, "A100": 3}
        ls_ = sorted(lines, key=lambda l: order.get(l["label"], 9))
        img = line("gpu", "GPU별 렌탈 지수", f"Ornn 컴퓨트 가격 지수(OCPI · 실제 체결 기준) · $/GPU·시간 · {last} 정산",
                   [(l["label"], [(p["date"], p["value"]) for p in l["points"]]) for l in ls_], digits=2)
        rows = []
        for l in ls_:
            p = l["points"]
            pc = chg(p[-2]["value"], p[-1]["value"]) if len(p) > 1 else 0
            rows.append(f"{arrow(pc)} {esc(l['label'])} <b>${p[-1]['value']:.2f}</b> ({pc:+.1f}%)")
        cap = (f"🖥 <b>GPU 렌탈 지수</b> · {d.strftime('%m/%d')} 정산 · {stamp(s.get('updated_at'))} 갱신\n" + "\n".join(rows) +
               "\n<i>1시간 임대 체결가 · 전일 대비</i>")
        return [img], cap
    return (f"gpu:{last}", gate, build)


def openrouter():
    """평균 실효 단가 + 주간 토큰 총량 + 주간 지출 — 한 메시지(그래프 3장 앨범), 매일 09:30"""
    S = ai_series()
    p = (S.get("or_avg_price") or {}).get("points") or []
    t = (S.get("or_tokens_weekly") or {}).get("points") or []
    sp = (S.get("or_spend_7d") or {}).get("points") or []
    if len(p) < 2:
        return None
    last = p[-1]["date"]
    gate = at(date.fromisoformat(last) + timedelta(days=1), 9, 30)

    def build():
        from tg_charts import bars, line
        imgs = [line("price", "OpenRouter 평균 실효 단가", f"토큰 100만 개당 실제 지불액(지출 ÷ 토큰) · $/M · 최근 7일 기준 · {last}",
                     [("단가", [(x["date"], x["value"]) for x in p])], digits=3, fill=True)]
        d1 = chg(p[-2]["value"], p[-1]["value"])
        wk = (date.fromisoformat(last) - timedelta(days=7)).isoformat()
        w = next((x for x in reversed(p) if x["date"] <= wk), None)
        rows = [f"{arrow(d1)} 평균 실효 단가 <b>${p[-1]['value']:.4f}</b>/100만 토큰 (전일 {d1:+.1f}%"
                + (f" · 1주 전 대비 {chg(w['value'], p[-1]['value']):+.1f}%)" if w else ")")]
        if len(t) > 1:
            ws = t[-1]["date"]
            we = date.fromisoformat(ws) + timedelta(days=6)
            imgs.append(bars("tokens", "OpenRouter 주간 토큰 총량", f"한 주(월~일) 처리 토큰 · 조(T) 토큰 · 최근 26주 · {ws} 주",
                             [(x["date"], x["value"]) for x in t[-26:]], digits=1, unit="T"))
            w1 = chg(t[-2]["value"], t[-1]["value"])
            rows.append(f"{arrow(w1)} 주간 토큰 <b>{t[-1]['value']:,.1f}T</b> (전주 대비 {w1:+.1f}% · {ws[5:].replace('-', '/')}~{we.strftime('%m/%d')})")
        if len(sp) > 1:
            imgs.append(bars("spend", "OpenRouter 주간 지출", f"주간 토큰 × 실효 단가 · 백만 달러 · {sp[-1]['date']} 주",
                             [(x["date"], x["value"]) for x in sp], digits=1, unit="M"))
            w2 = chg(sp[-2]["value"], sp[-1]["value"])
            rows.append(f"{arrow(w2)} 주간 지출 <b>${sp[-1]['value']:,.1f}M</b> (전주 대비 {w2:+.1f}%)")
        cap = (f"🤖 <b>OpenRouter 지표</b> · {last[5:].replace('-', '/')} 기준 · "
               f"{stamp((S.get('or_avg_price') or {}).get('updated_at'))} 갱신\n" + "\n".join(rows) +
               "\n<i>OpenRouter 경유 트래픽만 집계(직접 API 제외) · 주간 값은 매주 월요일 갱신</i>")
        return imgs, cap
    return (f"or:{last}", gate, build)


# ── 2) 팟캐스트 ───────────────────────────────────────────────
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
            return None, "\n".join(lines)
        out.append((f"pod:{row['id']}", NOW, build))
    return out


# ── 3) 오늘 시황 요약 ─────────────────────────────────────────
def digest():
    g = ((load("docs/news_digest.json") or {}).get("digests") or [None])[0]
    if not g or g.get("date") != NOW.strftime("%Y-%m-%d"):
        return None

    def build():
        md = re.sub(r"^## 금일 시황 요약[^\n]*\n", "", g.get("markdown") or "").strip()
        txt = (f"📰 <b>오늘 시황 요약</b> · {stamp(g.get('generated')) or NOW.strftime('%m/%d')} 작성\n<b>{esc(g.get('title'))}</b>\n\n"
               + md_to_html(md))
        return None, txt
    return (f"digest:{g['date']}", NOW, build)


# ── 4) 매크로 요약 ────────────────────────────────────────────
def macro():
    today = NOW.date()

    def pts(k, days=365):
        x = ((load("docs/macro_dash.json") or {}).get("indicators") or {}).get(k) or {}
        cut = (today - timedelta(days=days)).isoformat()
        return [(d, v) for d, v in zip(x.get("dates") or [], x.get("values") or []) if d >= cut and v is not None]

    def build():
        from tg_charts import line
        fg = load("docs/data/fear_greed.json") or {}
        imgs, rows = [], []
        if fg.get("history"):
            # 사용자가 계기판 대신 처음의 1년 추이 그래프를 골랐다(2026-10-07). tg_charts.gauge 는 남겨 둠
            imgs.append(line("fg", "CNN 공포·탐욕 지수", f"0 = Extreme Fear · 100 = Extreme Greed · 최근 1년 · {fg.get('updated_kst', '')} 기준",
                             [("지수", [(d, v) for d, v in fg["history"]])], digits=0, since_days=365,
                             bands=[(0, 25, "#d33f5b", "Extreme Fear"), (25, 45, "#e07a3f", "Fear"), (45, 55, "#6b7588", "Neutral"),
                                    (55, 75, "#3a9f6c", "Greed"), (75, 100, "#1b8a63", "Extreme Greed")]))
            rows.append(f"😨 공포·탐욕 <b>{fg.get('score'):.0f} {esc(fg.get('rating'))}</b> (전일 {fg.get('previous_close')} · 1주 전 {fg.get('previous_1_week')} · CNN {stamp(fg.get('updated_kst'))[-5:]})")
        ys = [(lab, pts(k)) for lab, k in (("2년", "y2"), ("10년", "y10"), ("30년", "y30"))]
        if all(p for _, p in ys):
            imgs.append(line("yields", "미국 국채금리", f"2년 · 10년 · 30년물 · % · 최근 1년 · {ys[1][1][-1][0]} 기준", ys, digits=2, unit="%"))
            parts = [f"{lab} <b>{p[-1][1]:.2f}%</b>({(p[-1][1] - p[-2][1]) * 100:+.0f}bp)" for lab, p in ys if len(p) > 1]
            rows.append("🏦 국채 " + " · ".join(parts))
        w = pts("wti")
        if w:
            imgs.append(line("wti", "WTI 원유 선물", f"달러/배럴 · 최근 1년 · {w[-1][0]} 기준", [("WTI", w)], digits=2, fill=True))
            rows.append(f"🛢 WTI <b>${w[-1][1]:.2f}</b>" + (f" ({chg(w[-2][1], w[-1][1]):+.1f}%)" if len(w) > 1 else ""))
        upd = stamp((load("docs/macro_dash.json") or {}).get("updated")) or f"{today.strftime('%m/%d')}({DOW[today.weekday()]})"
        cap = f"📊 <b>매크로 요약</b> · {upd} 갱신\n" + "\n".join(rows)
        return imgs, cap

    def build_krw():
        from tg_charts import line
        p = pts("usdkrw")
        if not p:
            return None, None
        img = line("usdkrw", "원/달러 환율", f"원 · 최근 1년 · {p[-1][0]} 기준", [("원/달러", p)], digits=1, fill=True)
        c = chg(p[-2][1], p[-1][1]) if len(p) > 1 else 0
        upd = stamp((load("docs/macro_dash.json") or {}).get("updated"))
        return [img], (f"💱 <b>원/달러 환율</b> {p[-1][1]:,.1f}원 ({c:+.2f}%)\n"
                       f"<i>{p[-1][0][5:].replace('-', '/')} 기준 · {upd} 갱신</i>")

    gate = at(today, 8, 20)
    return [(f"macro:{today}", gate, build), (f"usdkrw:{today}", gate, build_krw)]


# ── 실행 ─────────────────────────────────────────────────────
ITEMS = {"gpu": gpu, "openrouter": openrouter, "podcast": podcasts, "digest": digest, "macro": macro}


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
    before = set(sent)

    todo = [(key, build) for name, key, gate, build in collect()
            if ((force == "all" or name == force) if force else (key not in sent and NOW >= gate))]
    if due_only:
        print("yes" if todo else "no")
        return

    silent = NOW.hour < 7
    for key, build in todo:
        try:
            imgs, text = build()
            if not text:
                continue
            # 사이트(깃허브) 주소는 어떤 경우에도 내보내지 않는다(사용자 지시) — 본문에 섞여 들어와도 그 줄째 뺀다
            text = "\n".join(l for l in text.split("\n") if "github.io" not in l and "github.com" not in l)
            if dry:
                print("─" * 30, key, imgs or "", "\n" + text)
                continue
            if imgs:
                tg.send_photos(imgs, text if len(text) <= 1024 else text[:1000] + "…", silent=silent)
            else:
                tg.send(text, silent=silent)
            sent.add(key)
            print("보냄:", key)
        except SystemExit as e:
            print("텔레그램 설정 없음:", e)
            break
        except Exception as e:
            print("전송 실패:", key, e)

    if not dry and sent != before:   # 보낸 게 있을 때만 쓴다(GitHub 에서 불필요한 커밋 방지)
        state["sent"] = sorted(sent)
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
    print(f"확인 끝 — 보낼 것 {len(todo)}건" + (" (미리보기)" if dry else ""))


if __name__ == "__main__":
    main()
