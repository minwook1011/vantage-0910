#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ai_indicators.py — AI 인프라 지표 → docs/data/ai_indicators.json

표준 라이브러리만 사용. 매일 1회 실행(.github/workflows/ai-indicators.yml).
소스마다 독립적으로 수집하고, 하나가 실패해도 나머지는 갱신한다. 실패한 지표는
기존 값을 그대로 두고 status 를 "stale" 로 표시한다. 빈 값을 0이나 예시로 채우지 않는다.

스냅샷만 주는 소스(OpenRouter 주간 표, GPU 호가, HF 다운로드 등)는 매 실행마다
기존 파일에 날짜별로 **누적**해 시계열을 만든다. 비교용 과거 스냅샷은
docs/data/ai_indicators_state.json 에 둔다(화면에서는 읽지 않음).

    python fetch_ai_indicators.py            # 전체 수집
    python fetch_ai_indicators.py --only gpu # 한 묶음만 (디버그)
"""
import argparse
import email.utils
import gzip
import html
import json
import math
import os
import re
import ssl
import statistics
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "ai_indicators.json")
STATE = os.path.join(BASE, "docs", "data", "ai_indicators_state.json")
LINKS = os.path.join(BASE, "docs", "data", "company_links.json")
TRASS = os.path.join(BASE, "docs", "data", "trass_exports.json")
TSMC_CAPA_MANUAL = os.path.join(BASE, "data_sources", "tsmc_capa.json")
KST = timezone(timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
OR = "https://openrouter.ai/api/frontend/v1"
MAX_POINTS = 400
ACTIVITY_TOP = 30  # 지출·실효 단가 추이에 합산할 상위 모델 수

NOW = datetime.now(KST)
TODAY = NOW.date().isoformat()


# ── HTTP ─────────────────────────────────────────────────────────────
def http(url, headers=None, data=None, timeout=30, retries=2, insecure=False):
    hdr = {"User-Agent": UA, "Accept-Encoding": "gzip", **(headers or {})}
    ctx = None
    if insecure:  # 로컬 PC의 SSL 가로채기 환경 테스트용. Actions 에서는 쓰지 않는다.
        ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=hdr, data=data)
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return body
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as e:
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise last


def jget(url, **kw):
    return json.loads(http(url, **kw))


# ── 누적 병합 ─────────────────────────────────────────────────────────
def merge_points(old, new, keep=MAX_POINTS):
    by = {p["date"]: p for p in (old or []) if p.get("date")}
    for p in new:
        if p.get("value") is not None and math.isfinite(p["value"]):
            by[p["date"]] = p
    return [by[d] for d in sorted(by)][-keep:]


def merge_lines(old_lines, new_lines, keep=MAX_POINTS):
    old = {l["label"]: l.get("points", []) for l in (old_lines or [])}
    return [{"label": l["label"], "points": merge_points(old.get(l["label"]), l["points"], keep)} for l in new_lines]


def rnd(v, d=2):
    return None if v is None else round(v, d)


def week_start(d):
    return d - timedelta(days=d.weekday())


LAB_NAMES = {
    "google": "Google", "anthropic": "Anthropic", "openai": "OpenAI", "deepseek": "DeepSeek", "x-ai": "xAI",
    "qwen": "Qwen", "moonshotai": "Moonshot", "z-ai": "Z.ai", "minimax": "MiniMax", "meta-llama": "Meta",
    "mistralai": "Mistral", "xiaomi": "Xiaomi", "tencent": "Tencent", "nvidia": "NVIDIA", "amazon": "Amazon",
    "microsoft": "Microsoft", "cohere": "Cohere", "bytedance": "ByteDance", "bytedance-seed": "ByteDance",
    "baidu": "Baidu", "stepfun-ai": "StepFun", "inception": "Inception", "tngtech": "TNG", "meituan": "Meituan",
    "nousresearch": "Nous", "arcee-ai": "Arcee", "openrouter": "OpenRouter", "kwaipilot": "Kuaishou",
    "inclusionai": "Ant Group", "ibm-granite": "IBM", "perplexity": "Perplexity", "liquid": "Liquid AI",
}


def lab_of(slug):
    if slug == "Others":
        return "기타"
    a = slug.split("/")[0]
    return LAB_NAMES.get(a, a[:1].upper() + a[1:])


def base_slug(slug):
    return slug.split(":")[0]


# ── 결과 묶음 ─────────────────────────────────────────────────────────
class Ctx:
    def __init__(self, prev, state):
        self.prev = {s["id"]: s for s in prev.get("series", [])} if prev else {}
        self.prev_companies = (prev or {}).get("companies", {})
        self.state = state
        self.series = {}
        self.errors = []
        self.model_names = {}

    def put(self, s):
        s.setdefault("status", "ok")
        s.setdefault("updated_at", NOW.isoformat(timespec="minutes"))
        self.series[s["id"]] = s

    def keep_prev(self, sid, why):
        """수집 실패 → 기존 값을 유지하고 stale 표시."""
        old = self.prev.get(sid)
        if old:
            old = dict(old)
            old["status"] = "stale"
            old["status_note"] = why[:160]
            self.series[sid] = old

    def old_points(self, sid):
        return (self.prev.get(sid) or {}).get("points", [])

    def old_lines(self, sid):
        return (self.prev.get(sid) or {}).get("lines", [])


def collector(*ids):
    """묶음 수집기 데코레이터: 예외가 나면 해당 id 들을 stale 로 유지."""
    def deco(fn):
        def run(ctx):
            try:
                fn(ctx)
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                print(f"  [fail] {fn.__name__}: {msg}")
                traceback.print_exc(limit=2)
                ctx.errors.append({"collector": fn.__name__, "error": msg[:200]})
                for sid in ids:
                    if sid not in ctx.series:
                        ctx.keep_prev(sid, "수집 실패 · 이전 값 유지 (" + msg[:80] + ")")
        run.__name__ = fn.__name__
        run.ids = ids
        return run
    return deco


# ── 1. OpenRouter 모델 목록 · 가격 · 신규 모델 ──────────────────────────
@collector("or_new_models", "price_cuts")
def c_or_models(ctx):
    models = jget("https://openrouter.ai/api/v1/models")["data"]
    for m in models:
        ctx.model_names[m["id"]] = m["name"]
        if m.get("canonical_slug"):
            ctx.model_names[m["canonical_slug"]] = m["name"]

    # 신규 모델 등록 수 (주간) — 등록일(created)로 과거 52주 복원. 목록에서 내려간 모델은 빠짐.
    this_week = week_start(NOW.date())
    counts = {}
    for m in models:
        if m["id"].endswith(":free"):
            continue
        d = datetime.fromtimestamp(m["created"], KST).date()
        w = week_start(d)
        if w < this_week and w >= this_week - timedelta(weeks=52):
            counts[w] = counts.get(w, 0) + 1
    pts = [{"date": (this_week - timedelta(weeks=k)).isoformat(), "value": counts.get(this_week - timedelta(weeks=k), 0)} for k in range(52, 0, -1)]
    ctx.put({"id": "or_new_models", "group": "ecosystem", "label": "신규 모델 등록 수 (주간)", "unit": "개", "type": "line", "digits": 0,
             "cadence": "매일 확인 · 주간 집계", "source": "OpenRouter Models API", "source_url": "https://openrouter.ai/models", "method": "api",
             "related": ["NVDA", "AMD"], "points": pts,
             "caveat": "모델 출시 속도 = 공급 경쟁의 강도. 출시가 몰리는 구간 뒤에는 대개 가격 인하가 따라옵니다. 현재 목록에 남아 있는 모델만 셉니다(종료된 모델 제외)."})

    # 가격 인하 감지 — 어제 저장한 단가와 비교
    prices_now = {}
    for m in models:
        if m["id"].endswith(":free"):
            continue
        try:
            p = float(m["pricing"].get("prompt") or 0) * 1e6
            c = float(m["pricing"].get("completion") or 0) * 1e6
        except (TypeError, ValueError):
            continue
        if p > 0 or c > 0:
            prices_now[m["id"]] = [round(p, 4), round(c, 4)]
    before = ctx.state.get("or_prices") or {}
    events = list((ctx.prev.get("price_cuts") or {}).get("events", []))
    seen = {(e["date"], e["label"]) for e in events}
    for mid, (p, c) in prices_now.items():
        if mid not in before:
            continue
        bp, bc = before[mid]
        for kind, old, new in (("출력", bc, c), ("입력", bp, p)):
            if old > 0 and new < old * 0.99:
                key = (TODAY, ctx.model_names.get(mid, mid))
                if key in seen:
                    continue
                events.append({"date": TODAY, "label": ctx.model_names.get(mid, mid), "kind": kind, "before": old, "after": new, "unit": f"$/M {kind}"})
                seen.add(key)
                break
    events.sort(key=lambda e: e["date"], reverse=True)
    ctx.state["or_prices"] = prices_now
    ctx.state.setdefault("price_watch_since", TODAY)
    ctx.put({"id": "price_cuts", "group": "price", "label": "가격 인하 이벤트", "unit": "", "type": "events",
             "cadence": "매일 전일 대비 비교", "source": "OpenRouter Models API", "source_url": "https://openrouter.ai/models", "method": "api",
             "related": ["MSFT", "GOOGL", "NVDA"], "events": events[:60],
             "empty_note": f"{ctx.state['price_watch_since']}부터 감시 중 · 아직 감지된 인하 없음",
             "caveat": "OpenRouter 등록 단가가 1% 이상 내려간 경우만 잡습니다. 무료 변형, 볼륨·캐시 할인은 제외합니다."})


# ── 2. OpenRouter 1년 주간 토큰 (차트) ──────────────────────────────────
@collector("or_tokens_weekly", "or_lab_trend")
def c_or_chart(ctx):
    rows = jget(OR + "/rankings/model-rankings-chart")["data"]["data"]
    today = NOW.date()
    done = [r for r in rows if date.fromisoformat(r["x"]) + timedelta(days=7) <= today]  # 진행 중인 주 제외
    ctx.chart_totals = {r["x"]: sum(r["ys"].values()) for r in done}  # 주간 지출 추정에 재사용
    total = [{"date": r["x"], "value": round(sum(r["ys"].values()) / 1e12, 2)} for r in done]
    ctx.put({"id": "or_tokens_weekly", "group": "demand", "label": "OpenRouter 주간 토큰 총량", "unit": "T 토큰", "type": "line", "kpi": True, "digits": 1,
             "cadence": "주간 (월요일 시작) · 매일 확인", "source": "OpenRouter Rankings", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["NVDA", "MSFT", "GOOGL"], "points": merge_points(ctx.old_points("or_tokens_weekly"), total),
             "caveat": "OpenRouter를 거친 트래픽만 집계합니다. OpenAI·Anthropic 직접 API 물량은 빠진 하한값입니다. 진행 중인 주는 제외합니다."})

    # 랩별 점유율 추이 — 차트는 주마다 상위 10개 모델만 이름이 붙고 나머지는 Others
    weekly = []
    for r in done:
        tot = sum(r["ys"].values()) or 1
        labs = {}
        for slug, v in r["ys"].items():
            labs[lab_of(slug)] = labs.get(lab_of(slug), 0) + v
        weekly.append((r["x"], {k: v / tot * 100 for k, v in labs.items()}))
    top = ctx.state.get("lab_top5") or []
    if not top and weekly:
        top = [k for k, _ in sorted(weekly[-1][1].items(), key=lambda kv: -kv[1]) if k != "기타"][:5]
    lines = [{"label": lab, "points": [{"date": d, "value": round(s.get(lab, 0.0), 1)} for d, s in weekly]} for lab in top[:5]]
    ctx.put({"id": "or_lab_trend", "group": "demand", "label": "랩별 토큰 점유율 추이 (상위 5)", "unit": "%", "type": "share", "digits": 1,
             "cadence": "주간", "source": "OpenRouter Rankings", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["GOOGL", "MSFT", "AMZN"], "lines": lines,
             "caveat": "주별 상위 10개 모델만 랩이 붙어 있어 나머지(약 3~4할)는 '기타'로 빠집니다. 추세 확인용이며, 이번 주 정확한 점유율은 옆 '상위 10' 카드를 봅니다."})


# ── 3. OpenRouter 최근 7일 상세 (지출 · 단가 · 랩 · 모델 순위) ───────────
@collector("or_spend_7d", "or_avg_price", "or_lab_top10", "or_model_rank")
def c_or_week(ctx):
    rows = jget(OR + "/rankings/models?view=week")["data"]
    models = {}
    for r in rows:
        slug = base_slug(r["model_permaslug"])
        m = models.setdefault(slug, {"tokens": 0, "usd": 0.0, "req": 0})
        m["tokens"] += (r.get("total_prompt_tokens") or 0) + (r.get("total_completion_tokens") or 0)
        m["usd"] += r.get("total_usage") or 0
        m["req"] += r.get("count") or 0
    tot_tok = sum(m["tokens"] for m in models.values())
    tot_usd = sum(m["usd"] for m in models.values())
    if tot_tok <= 0:
        raise ValueError("빈 주간 표")

    # 지출·실효 단가 추이 — 모델별 일간 활동(최근 30일)으로 복원한다. 매일 30일을 다시 계산해 덮어쓴다.
    #  · 실효 단가 = 표본 모델의 지출 ÷ 토큰 (비율이라 표본 구성에 덜 민감)
    #  · 주간 지출 = 그 주 전체 토큰(차트, 정확) × 그 주 실효 단가  — 현재 인기 모델만 합산하면 과거가 과소 집계되기 때문
    tok_by, usd_by = {}, {}
    for r in rows:
        key = (r["model_permaslug"], r.get("variant") or "standard")
        tok_by[key] = tok_by.get(key, 0) + (r.get("total_prompt_tokens") or 0) + (r.get("total_completion_tokens") or 0)
        usd_by[key] = usd_by.get(key, 0) + (r.get("total_usage") or 0)
    pick = [k for k, _ in sorted(tok_by.items(), key=lambda kv: -kv[1])[:ACTIVITY_TOP]]
    pick += [k for k, _ in sorted(usd_by.items(), key=lambda kv: -kv[1])[:ACTIVITY_TOP] if k not in pick]
    top_variants = [(k, tok_by[k]) for k in pick]
    covered = sum(tok_by[k] for k in pick) / max(1, sum(tok_by.values())) * 100
    covered_usd = sum(usd_by[k] for k in pick) / max(1e-9, sum(usd_by.values())) * 100
    daily_tok, daily_usd = {}, {}
    utc_today = datetime.now(timezone.utc).date().isoformat()
    for (slug, variant), _ in top_variants:
        try:
            act = jget(f"{OR}/stats/model-activity?permaslug={urllib.parse.quote(slug, safe='')}&variant={variant}")["data"]["analytics"]
        except Exception as e:
            print(f"  [warn] activity {slug}: {e}")
            continue
        for a in act:
            d = a["date"][:10]
            if d >= utc_today:  # 오늘(UTC)은 집계 중이라 제외
                continue
            daily_tok[d] = daily_tok.get(d, 0) + (a.get("total_prompt_tokens") or 0) + (a.get("total_completion_tokens") or 0)
            daily_usd[d] = daily_usd.get(d, 0) + (a.get("total_usage") or 0)
        time.sleep(0.25)
    days = sorted(daily_tok)
    price_pts = []
    for i in range(6, len(days)):
        win = days[i - 6: i + 1]
        if (date.fromisoformat(win[-1]) - date.fromisoformat(win[0])).days != 6:
            continue
        t7, u7 = sum(daily_tok[d] for d in win), sum(daily_usd[d] for d in win)
        if t7:
            price_pts.append({"date": win[-1], "value": round(u7 / t7 * 1e6, 4)})
    # 주간 지출 = 차트의 주간 총 토큰 × 같은 주(월~일) 표본 실효 단가. 7일이 모두 있는 주만.
    weekly_total = ctx.chart_totals if getattr(ctx, "chart_totals", None) else {
        r["x"]: sum(r["ys"].values()) for r in jget(OR + "/rankings/model-rankings-chart")["data"]["data"]}
    spend_pts = []
    for wk, total in sorted(weekly_total.items()):
        wd = [(date.fromisoformat(wk) + timedelta(days=k)).isoformat() for k in range(7)]
        if not all(d in daily_tok for d in wd):
            continue
        t, u = sum(daily_tok[d] for d in wd), sum(daily_usd[d] for d in wd)
        if t:
            spend_pts.append({"date": wk, "value": round(total * (u / t) / 1e6, 2)})
    note = (f"표본 = 토큰 상위 {ACTIVITY_TOP} + 지출 상위 {ACTIVITY_TOP}개 모델 ({len(top_variants)}개, 최근 7일 토큰의 {covered:.0f}% · 지출의 {covered_usd:.0f}%).")
    # 이번에 다시 계산한 기간(최근 30일)과 그 이후의 옛 값은 버린다 — 계산 방식이 섞이지 않게
    first_price = price_pts[0]["date"] if price_pts else "9999"
    first_spend = spend_pts[0]["date"] if spend_pts else "9999"
    old_before = lambda sid, first: [p for p in ctx.old_points(sid) if p["date"] < first]
    ctx.put({"id": "or_spend_7d", "group": "demand", "label": "OpenRouter 주간 지출 (추정)", "unit": "$M", "type": "line", "digits": 1,
             "cadence": "주간 (월요일 시작) · 매일 확인", "source": "OpenRouter 주간 토큰 × 실효 단가", "source_url": "https://openrouter.ai/rankings", "method": "computed",
             "related": ["NVDA", "MSFT", "GOOGL"], "points": merge_points(old_before("or_spend_7d", first_spend), spend_pts),
             "caveat": "그 주 전체 토큰(정확) × 표본 모델의 실효 단가로 추정합니다. " + note + " 모델별 일간 기록이 최근 30일만 공개돼 그 이전 주는 이후 매주 쌓입니다."})
    ctx.put({"id": "or_avg_price", "group": "price", "label": "평균 실효 단가", "unit": "$/M", "type": "line", "kpi": True, "digits": 3,
             "cadence": "매일 · 최근 7일", "source": "OpenRouter (지출 ÷ 토큰)", "source_url": "https://openrouter.ai/rankings", "method": "computed",
             "related": ["NVDA", "MSFT", "GOOGL"], "points": merge_points(old_before("or_avg_price", first_price), price_pts),
             "caveat": note + " 무료·저가 모델 비중이 늘면 모델별 가격 변화가 없어도 내려갑니다."})

    # 랩 상위 10
    labs = {}
    for slug, m in models.items():
        labs[lab_of(slug)] = labs.get(lab_of(slug), 0) + m["tokens"]
    share = {k: v / tot_tok * 100 for k, v in labs.items()}
    snaps = ctx.state.setdefault("or_snap", {})
    week_ago = (NOW.date() - timedelta(days=7)).isoformat()
    ref = snaps.get(week_ago) or {}
    top10 = sorted(share.items(), key=lambda kv: -kv[1])[:10]
    items = [{"label": k, "value": round(v, 1), "sub": f"{labs[k] / 1e12:.1f}T",
              "delta": rnd(v - ref["labs"][k], 1) if ref.get("labs", {}).get(k) is not None else None} for k, v in top10]
    ctx.state["lab_top5"] = [k for k, _ in top10 if k != "기타"][:5]
    ctx.put({"id": "or_lab_top10", "group": "demand", "label": "랩별 토큰 점유율 (상위 10)", "unit": "%", "type": "rank", "digits": 1,
             "cadence": "매일 · 최근 7일", "source": "OpenRouter Rankings", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["GOOGL", "MSFT", "AMZN"], "items": items, "as_of": TODAY, "delta_unit": "%p",
             "caveat": "최근 7일 전체 모델을 랩별로 합산한 점유율입니다. 괄호는 1주 전 대비 %p (비교 스냅샷이 쌓인 뒤부터 표시)."})

    # 모델 순위
    ranked = sorted(models.items(), key=lambda kv: -kv[1]["tokens"])[:15]
    ref_models = ref.get("models", {})
    ref_rank = {s: i + 1 for i, s in enumerate(sorted(ref_models, key=lambda s: -ref_models[s]))}
    rows_out = []
    for i, (slug, m) in enumerate(ranked):
        r0 = ref_rank.get(slug)
        rows_out.append({"rank": i + 1, "move": (r0 - (i + 1)) if r0 else None, "model": ctx.model_names.get(slug, slug.split("/")[-1]),
                         "lab": lab_of(slug), "tokens": round(m["tokens"] / 1e12, 2), "share": round(m["tokens"] / tot_tok * 100, 1),
                         "usd": round(m["usd"] / 1e3, 0), "ppm": round(m["usd"] / m["tokens"] * 1e6, 3) if m["tokens"] else None})
    ctx.put({"id": "or_model_rank", "group": "ecosystem", "label": "모델별 사용량 순위", "unit": "", "type": "table",
             "cadence": "매일 · 최근 7일", "source": "OpenRouter Rankings", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["NVDA", "GOOGL", "MSFT"], "as_of": TODAY,
             "columns": [{"key": "rank", "label": "#"}, {"key": "model", "label": "모델", "align": "l"}, {"key": "lab", "label": "랩", "align": "l"},
                         {"key": "tokens", "label": "토큰(T)"}, {"key": "share", "label": "점유율 %"}, {"key": "usd", "label": "지출 $K"}, {"key": "ppm", "label": "$/M"}],
             "rows": rows_out,
             "caveat": "무료 변형(:free)은 같은 모델로 합산했습니다. 순위 옆 ▲▼는 1주 전 대비 순위 변화입니다."})

    snaps[TODAY] = {"labs": {k: round(v, 3) for k, v in share.items()}, "models": {s: m["tokens"] for s, m in ranked[:40]}}
    for d in sorted(snaps)[:-21]:
        snaps.pop(d)


# ── 4. 앱 순위 ────────────────────────────────────────────────────────
@collector("or_app_rank")
def c_or_apps(ctx):
    week = jget(OR + "/rankings/apps?view=week")["data"]["week"]
    week = sorted(week, key=lambda r: -int(r["total_tokens"]))[:10]
    items = [{"label": r["app"].get("title") or r["app"].get("slug"), "value": round(int(r["total_tokens"]) / 1e12, 2),
              "url": r["app"].get("origin_url") or r["app"].get("main_url")} for r in week]
    ctx.put({"id": "or_app_rank", "group": "ecosystem", "label": "앱별 주간 사용량 (상위 10)", "unit": "T 토큰", "type": "rank", "digits": 2,
             "cadence": "매일 · 최근 7일", "source": "OpenRouter Rankings · Apps", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["MSFT", "GOOGL"], "items": items, "as_of": TODAY,
             "caveat": "OpenRouter에 자신을 등록한 앱만 잡힙니다. 코딩 에이전트 비중이 높게 나오는 경향이 있습니다."})


# ── 5. 프론티어 가격 · 속도 ─────────────────────────────────────────────
def or_benchmarks():
    h = http("https://openrouter.ai/rankings").decode("utf-8", "replace")
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', h)
    payload = "".join(json.loads('"' + c + '"') for c in chunks)
    dec = json.JSONDecoder()
    for m in re.finditer(r'\{"dehydratedAt":', payload):
        try:
            obj, _ = dec.raw_decode(payload, m.start())
        except Exception:
            continue
        if obj.get("queryKey") == ["rankings", "benchmarks"]:
            return obj["state"]["data"]
    raise ValueError("벤치마크 데이터를 페이지에서 찾지 못함")


def frontier_candidates():
    bench = or_benchmarks()
    seen, out = set(), []
    for x in sorted(bench["aaData"]["intelligence"], key=lambda x: -x["score"]):
        slug = x.get("permaslug")
        if not slug or slug in seen:
            continue
        seen.add(slug)
        out.append({"slug": slug, "score": x["score"], "name": re.sub(r"\s*\(.*\)$", "", x.get("aa_name") or slug)})
    return out[:12]


@collector("frontier_price_index", "frontier_speed")
def c_frontier(ctx):
    per_day_out, per_day_blend, per_day_speed, table, top = {}, {}, {}, [], []
    for m in frontier_candidates():
        if len(top) == 5:
            break
        q = urllib.parse.quote(m["slug"], safe="")
        eff = jget(f"{OR}/stats/effective-pricing?permaslug={q}&range=3m&shape=v7&variant=standard")["data"]
        if not eff.get("weightedOutputPrice"):  # OpenRouter 에서 실제 거래가 없는 모델은 건너뛰고 다음 순위로
            continue
        top.append(m)
        ins = {r["x"][:10]: [v for v in r["y"].values() if v] for r in eff.get("inputChartData", [])}
        for r in eff.get("outputChartData", []):
            d, vals = r["x"][:10], [v for v in r["y"].values() if v]
            if not vals:
                continue
            o = statistics.mean(vals)
            per_day_out.setdefault(d, []).append(o)
            if ins.get(d):
                per_day_blend.setdefault(d, []).append((3 * statistics.mean(ins[d]) + o) / 4)
        spd = jget(f"{OR}/stats/throughput-comparison?perfWorkload=text_generation&permaslug={q}&timeRange=1w&variant=standard")["data"]
        last_speed = None
        for r in spd:
            vals = [v for v in r["y"].values() if v and v > 0]
            if vals:
                last_speed = statistics.median(vals)
                per_day_speed.setdefault(r["x"][:10], []).append(last_speed)
        table.append({"model": m["name"], "score": m["score"], "out": rnd(eff.get("weightedOutputPrice"), 2),
                      "in": rnd(eff.get("weightedInputPrice"), 2), "tps": rnd(last_speed, 0)})
        time.sleep(0.4)
    names = ", ".join(t["model"] for t in table)
    cols = [{"key": "model", "label": "모델", "align": "l"}, {"key": "score", "label": "지능 점수"}, {"key": "in", "label": "입력 $/M"},
            {"key": "out", "label": "출력 $/M"}, {"key": "tps", "label": "tok/s"}]
    avg = lambda dct: [{"date": d, "value": round(statistics.mean(v), 3)} for d, v in sorted(dct.items()) if len(v) >= max(2, len(top) - 1)]
    ctx.put({"id": "frontier_price_index", "group": "price", "label": "프론티어 모델 가격 지수", "unit": "$/M", "type": "share_abs", "digits": 2,
             "cadence": "매일", "source": "OpenRouter 실효 단가 · Artificial Analysis 지능 점수", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["MSFT", "GOOGL", "AMZN"],
             "lines": merge_lines(ctx.old_lines("frontier_price_index"), [{"label": "출력 단가", "points": avg(per_day_out)}, {"label": "블렌디드 (입력3:출력1)", "points": avg(per_day_blend)}]),
             "table": {"columns": cols, "rows": table},
             "caveat": f"지능 점수 상위 5개 모델({names})이 실제로 지불된 단가(제공사 가중)의 평균입니다. 과거 3개월은 현재 상위 5개 기준으로 복원한 값입니다."})
    ctx.put({"id": "frontier_speed", "group": "price", "label": "프론티어 추론 속도", "unit": "tok/s", "type": "line", "digits": 0,
             "cadence": "매일", "source": "OpenRouter 제공사별 처리량", "source_url": "https://openrouter.ai/rankings", "method": "scrape",
             "related": ["NVDA", "AMD", "AVGO"], "points": merge_points(ctx.old_points("frontier_speed"), avg(per_day_speed)),
             "table": {"columns": cols, "rows": table},
             "caveat": "같은 5개 모델의 제공사별 초당 출력 토큰 중앙값을 평균했습니다. 추론 칩 세대 교체·최적화 속도를 보는 지표입니다."})


# ── 6. 오픈모델 다운로드 ────────────────────────────────────────────────
HF_ORGS = {"Qwen": "Qwen", "deepseek-ai": "DeepSeek", "meta-llama": "Meta Llama", "google": "Google", "mistralai": "Mistral",
           "openai": "OpenAI", "microsoft": "Microsoft", "nvidia": "NVIDIA", "moonshotai": "Moonshot", "zai-org": "Z.ai"}


@collector("hf_downloads")
def c_hf(ctx):
    now = {}
    for org, label in HF_ORGS.items():
        rows = jget(f"https://huggingface.co/api/models?author={org}&sort=downloads&direction=-1&limit=100&expand[]=downloads")
        now[label] = sum(r.get("downloads") or 0 for r in rows) / 1e6
        time.sleep(0.3)
    hist = ctx.state.setdefault("hf_hist", {})
    for label, v in now.items():
        hist[label] = merge_points(hist.get(label), [{"date": TODAY, "value": round(v, 2)}])
    top5 = [k for k, _ in sorted(now.items(), key=lambda kv: -kv[1])[:5]]
    ctx.put({"id": "hf_downloads", "group": "ecosystem", "label": "오픈모델 월간 다운로드 (상위 5)", "unit": "M회", "type": "share_abs", "digits": 1,
             "cadence": "매일 · 최근 30일 합계", "source": "Hugging Face API", "source_url": "https://huggingface.co/models", "method": "api",
             "related": ["NVDA", "AMD"], "lines": [{"label": k, "points": hist[k]} for k in top5],
             "items": [{"label": k, "value": round(v, 1)} for k, v in sorted(now.items(), key=lambda kv: -kv[1])[:5]],
             "caveat": "조직별 상위 100개 모델의 최근 30일 다운로드 합계입니다. 미러·CI 다운로드가 섞이며 실제 사용량과 다릅니다. 오늘부터 매일 쌓입니다."})


# ── 7. GPU 임대가 ────────────────────────────────────────────────────
VAST_GPUS = ["H100 SXM", "H100 NVL", "H100 PCIE", "H200", "H200 NVL", "B200", "A100 SXM4", "A100 PCIE", "RTX 5090", "RTX 4090"]
MARKET_LINES = [("H100 SXM", "H100 SXM"), ("H200", "H200"), ("B200", "B200"), ("A100 SXM4", "A100"), ("RTX 5090", "RTX 5090")]
LIST_LINES = [("H100 SXM", "H100 SXM"), ("H200 SXM", "H200"), ("B200", "B200"), ("A100 SXM", "A100"), ("MI300X", "MI300X"), ("RTX 5090", "RTX 5090")]


ORNN = "https://data.ornn.com/api/public-index"
ORNN_GPUS = [("H100 SXM", "H100 SXM"), ("H200", "H200"), ("B200", "B200"), ("A100 SXM4", "A100"), ("RTX 5090", "RTX 5090")]


@collector("gpu_h100_index", "gpu_index_multi")
def c_ornn(ctx):
    """Ornn 컴퓨트 가격 지수(OCPI) — 실제 체결된 GPU 임대 거래로 매일 정산되는 지수. 공개 구간은 최근 3개월."""
    today_map = {r["gpu_type"]: r["index_value"] for r in jget(ORNN + "/daily-index/all")["data"]}
    lines, h100 = [], []
    for gpu, label in ORNN_GPUS:
        hist = jget(f"{ORNN}/gpu/{urllib.parse.quote(gpu)}/index-history")["data"]
        pts = [{"date": r["timestamp"][:10], "value": round(r["index_value"], 2)} for r in hist if r.get("index_value")]
        if gpu in today_map:
            pts.append({"date": datetime.fromisoformat(jget(ORNN + "/daily-index/all")["date"].replace("Z", "+00:00")).date().isoformat(),
                        "value": round(today_map[gpu], 2)})
        if gpu == "H100 SXM":
            h100 = pts
        lines.append({"label": label, "points": pts})
        time.sleep(0.3)
    if not h100:
        raise ValueError("Ornn H100 지수 없음")
    src, url = "Ornn 컴퓨트 가격 지수 (OCPI · 체결 기준)", "https://data.ornn.com/preview"
    ctx.put({"id": "gpu_h100_index", "group": "gpu", "label": "H100 렌탈 지수 (일별)", "unit": "$/GPU·h", "type": "line", "kpi": True, "digits": 2,
             "cadence": "매일 (미국 동부 16:00 정산)", "source": src, "source_url": url, "method": "api", "related": ["NVDA", "CRWV", "MSFT"],
             "points": merge_points(ctx.old_points("gpu_h100_index"), h100),
             "caveat": "공시가격이 아니라 실제 체결된 임대 거래로 매일 정산되는 지수입니다. 공개 구간은 최근 3개월이며 이후는 매일 이어 붙습니다."})
    ctx.put({"id": "gpu_index_multi", "group": "gpu", "label": "GPU별 렌탈 지수 추이", "unit": "$/GPU·h", "type": "share_abs", "digits": 2,
             "cadence": "매일", "source": src, "source_url": url, "method": "api", "related": ["NVDA", "AMD", "CRWV"],
             "lines": merge_lines(ctx.old_lines("gpu_index_multi"), lines),
             "caveat": "같은 체결 기준 지수의 GPU별 비교입니다. 신형(B200)이 비싸지는 동안 구형(A100)이 눌리는지 보면 세대 교체 속도를 알 수 있습니다."})


# ── ICE Clear Credit 단일물 CDS (5년) ────────────────────────────────
CDS_NAMES = [("ALPHINC", "Alphabet", ["GOOGL"]), ("AMZN", "Amazon", ["AMZN"]), ("MSFT", "Microsoft", ["MSFT"]),
             ("METAPL", "Meta", ["META"]), ("NVIDIA", "NVIDIA", ["NVDA"]), ("ORCLE", "Oracle", ["ORCL"]),
             ("COREWEI", "CoreWeave", ["CRWV"]), ("BROINC", "Broadcom", ["AVGO"]), ("APLINC", "Apple", []),
             ("IBM", "IBM", []), ("INTC", "Intel", []), ("TESLINC", "Tesla", [])]
CDS_BIGTECH = ["Alphabet", "Amazon", "Microsoft", "Meta"]
CDS_AI = ["NVIDIA", "Oracle", "CoreWeave", "Broadcom"]
RECOVERY = 0.4  # 회수율 가정
RISK_FREE = 0.04


def cds_spread_bp(price, coupon_bp, years):
    """결제가격(100 기준) → 5년 CDS 스프레드(bp). upfront = (s - c) × 위험연금(risky annuity) 을 이분법으로 푼다."""
    upfront = (100.0 - float(price)) / 100.0
    c = coupon_bp / 10000.0
    def gap(s):
        h = RISK_FREE + s / (1 - RECOVERY)
        annuity = (1 - math.exp(-h * years)) / h
        return (s - c) * annuity - upfront
    lo, hi = 1e-5, 1.5
    for _ in range(80):
        mid = (lo + hi) / 2
        if gap(mid) > 0:
            hi = mid
        else:
            lo = mid
    return round((lo + hi) / 2 * 10000, 1)


@collector("cds_bigtech", "cds_ai", "cds_table", "cds_gap")
def c_cds(ctx):
    rows = jget("https://www.ice.com/api/cds-settlement-prices/icc-single-names")
    by_ticker = {}
    for r in rows:
        parts = str(r.get("instrumentName", "")).split(".")
        if len(parts) < 6 or parts[1] != "SNRFOR" or parts[2] != "USD":
            continue
        ticker, coupon, maturity = parts[0], parts[4], parts[5]
        try:
            coupon_bp = float(coupon)
        except ValueError:
            continue
        years = (date.fromisoformat(maturity) - date.fromisoformat(r["clearingDate"])).days / 365.25
        if not (4.0 <= years <= 6.0):  # 5년물만
            continue
        spread = cds_spread_bp(r["eodPrice"], coupon_bp, years)
        prev = by_ticker.get(ticker)
        # 같은 이름에 쿠폰 100/500 이 함께 있으면 100bp 계약을 기준으로 삼는다
        if prev is None or (prev["coupon"] != 100 and coupon_bp == 100):
            by_ticker[ticker] = {"spread": spread, "coupon": coupon_bp, "date": r["clearingDate"], "name": r["name"]}
    obs_date = next(iter(by_ticker.values()))["date"] if by_ticker else TODAY
    line_of = lambda label, pt: {"label": label, "points": [pt] if pt else []}
    lines, table, spreads = {}, [], {}
    for ticker, label, related in CDS_NAMES:
        hit = by_ticker.get(ticker)
        if not hit:
            continue
        spreads[label] = hit["spread"]
        lines[label] = {"date": obs_date, "value": hit["spread"]}
    if not spreads:
        raise ValueError("ICE 결제가격에서 대상 종목을 찾지 못함")
    prev_cds = ctx.state.get("cds_prev") or {}
    for ticker, label, related in CDS_NAMES:
        if label not in spreads:
            continue
        p = prev_cds.get(label)
        table.append({"name": label, "bp": spreads[label], "chg": round(spreads[label] - p, 1) if p else None})
    ctx.state["cds_prev"] = spreads
    src, url = "ICE Clear Credit 결제가격 (5년물 · USD)", "https://www.ice.com/cds-settlement-prices/icc/single-name-instruments"
    common = {"unit": "bp", "type": "share_abs", "digits": 0, "cadence": "매 영업일 (미국 장 마감 후 결제)", "source": src, "source_url": url, "method": "api"}
    ctx.put(dict(common, id="cds_bigtech", group="credit", label="빅테크 CDS 추이", related=["GOOGL", "AMZN", "MSFT", "META"],
                 lines=merge_lines(ctx.old_lines("cds_bigtech"), [line_of(l, lines.get(l)) for l in CDS_BIGTECH if l in spreads]),
                 caveat="CDS는 그 회사 채권의 부도 위험을 사고파는 보험료입니다. 숫자가 오르면 시장이 위험을 더 크게 본다는 뜻. ICE가 과거치를 공개하지 않아 " + obs_date + "부터 매일 쌓습니다."))
    ctx.put(dict(common, id="cds_ai", group="credit", label="AI 차입 크레딧 CDS", related=["NVDA", "ORCL", "CRWV", "AVGO"],
                 lines=merge_lines(ctx.old_lines("cds_ai"), [line_of(l, lines.get(l)) for l in CDS_AI if l in spreads]),
                 caveat="AI 투자를 빚으로 키우는 쪽(오라클·코어위브)과 칩을 파는 쪽(엔비디아·브로드컴)의 신용 위험을 비교합니다."))
    gap = round(spreads.get("Oracle", 0) - spreads.get("Microsoft", 0), 1) if "Oracle" in spreads and "Microsoft" in spreads else None
    ctx.put({"id": "cds_gap", "group": "credit", "label": "오라클 − 마이크로소프트 CDS 격차", "unit": "bp", "type": "line", "digits": 0,
             "cadence": "매 영업일", "source": src, "source_url": url, "method": "computed", "related": ["ORCL", "MSFT"],
             "points": merge_points(ctx.old_points("cds_gap"), [{"date": obs_date, "value": gap}] if gap is not None else []),
             "caveat": "둘 다 대형 클라우드지만 오라클은 AI 데이터센터를 빚으로 짓습니다. 격차가 벌어지면 시장이 그 차입을 부담으로 본다는 신호입니다."})
    ctx.put({"id": "cds_table", "group": "credit", "label": "오늘의 CDS (5년물)", "unit": "bp", "type": "table",
             "cadence": "매 영업일", "source": src, "source_url": url, "method": "api", "related": ["ORCL", "CRWV", "NVDA"], "as_of": obs_date,
             "columns": [{"key": "name", "label": "기업", "align": "l"}, {"key": "bp", "label": "CDS (bp)"}, {"key": "chg", "label": "전일 대비"}],
             "rows": sorted(table, key=lambda r: -r["bp"]),
             "caveat": f"ICE Clear Credit 결제가격을 스프레드로 환산했습니다(회수율 {RECOVERY:.0%}, 무위험금리 {RISK_FREE:.0%} 가정). 기준일 {obs_date}."})


GD_GPUS = [("Nvidia H100", "H100"), ("Nvidia H200", "H200"), ("Nvidia B200", "B200"), ("Nvidia B300", "B300"),
           ("Nvidia A100", "A100"), ("AMD MI300X", "MI300X")]


@collector("gpu_cloud_multi", "gpu_h100_spread")
def c_gpu_history(ctx):
    """GetDeploying GPU 가격 지수 — 80여 개 클라우드의 GPU별 주간 중앙 온디맨드가 (2025년~)."""
    h = http("https://getdeploying.com/gpu-price-index").decode("utf-8", "replace")
    m = re.search(r'<script id="gpu-price-index-chart_data" type="application/json">(.*?)</script>', h, re.S)
    if not m:
        raise ValueError("GetDeploying 차트 데이터 블록을 찾지 못함")
    gd = json.loads(m.group(1))
    cards = {c["name"]: c for c in gd.get("cards", [])}
    pts = lambda name: [{"date": p["date"], "value": round(p["value"], 2), "providers": p.get("providers")} for p in (cards.get(name) or {}).get("points", []) if p.get("value")]
    h100 = pts("Nvidia H100")
    if not h100:
        raise ValueError("H100 시계열 없음")
    src, url = "GetDeploying GPU 가격 지수 (클라우드 80여 곳 중앙값)", "https://getdeploying.com/gpu-price-index"
    ctx.put({"id": "gpu_cloud_multi", "group": "gpu", "label": "GPU별 클라우드 임대가 추이", "unit": "$/GPU·h", "type": "share_abs", "digits": 2,
             "cadence": "주간 · 매일 확인", "source": src, "source_url": url, "method": "scrape", "related": ["NVDA", "AMD", "CRWV"],
             "lines": merge_lines(ctx.old_lines("gpu_cloud_multi"), [{"label": lab, "points": pts(n)} for n, lab in GD_GPUS if pts(n)]),
             "caveat": "GPU별 온디맨드 공시가 중앙값입니다. 신형(B200·B300)이 들어오며 구형 가격이 밀리는 속도가 GPU 세대 교체의 속도입니다."})
    spread = next((s for s in gd.get("providerSpreads", []) if s.get("gpu_name") == "Nvidia H100"), None)
    if spread:
        ctx.put({"id": "gpu_h100_spread", "group": "gpu", "label": "H100 하이퍼스케일러 vs 네오클라우드", "unit": "$/GPU·h", "type": "share_abs", "digits": 2,
                 "cadence": "주간 · 매일 확인", "source": src, "source_url": url, "method": "scrape", "related": ["CRWV", "MSFT", "AMZN", "GOOGL"],
                 "lines": [{"label": "하이퍼스케일러 (AWS·Azure·GCP)", "points": [{"date": p["date"], "value": round(p["hyperscaler"], 2)} for p in spread["points"] if p.get("hyperscaler")]},
                           {"label": "네오클라우드 (CoreWeave·Lambda 등)", "points": [{"date": p["date"], "value": round(p["neocloud"], 2)} for p in spread["points"] if p.get("neocloud")]}],
                 "caveat": f"같은 H100을 대형 클라우드와 GPU 전문 클라우드가 얼마에 파는지 비교합니다. 최근 하이퍼스케일러 프리미엄 {spread.get('latest_premium', 0):.0f}%."})


@collector()
def c_gpu(ctx):
    q = json.dumps({"gpu_name": {"in": VAST_GPUS}, "rentable": {"eq": True}, "type": "on-demand", "limit": 2000})
    offers = jget("https://console.vast.ai/api/v0/bundles/?q=" + urllib.parse.quote(q))["offers"]
    vast = {}
    for o in offers:
        if o.get("num_gpus") and o.get("dph_total"):
            vast.setdefault(o["gpu_name"], []).append(o["dph_total"] / o["num_gpus"])
    vmed = {k: round(statistics.median(v), 2) for k, v in vast.items() if len(v) >= 2}

    body = json.dumps({"query": "{ gpuTypes { id displayName securePrice communityPrice } }"}).encode()
    gql = json.loads(http("https://api.runpod.io/graphql", headers={"Content-Type": "application/json"}, data=body))["data"]["gpuTypes"]
    rp = {g["displayName"]: g for g in gql}

    pt = lambda v: [{"date": TODAY, "value": v}] if v else []
    rows = []
    for k, lab in [("H100 SXM", "H100 SXM"), ("H100 NVL", "H100 NVL"), ("H100 PCIE", "H100 PCIe"), ("H200", "H200"), ("B200", "B200"),
                   ("A100 SXM4", "A100 SXM"), ("RTX 5090", "RTX 5090"), ("RTX 4090", "RTX 4090")]:
        rpk = {"H100 PCIE": "H100 PCIe", "H200": "H200 SXM", "A100 SXM4": "A100 SXM"}.get(k, k)
        r = rp.get(rpk) or {}
        rows.append({"gpu": lab, "vast": vmed.get(k), "n": len(vast.get(k, [])), "secure": r.get("securePrice"), "community": r.get("communityPrice")})
    # Vast·RunPod 오늘 호가는 공시가 카드(gpu_cloud_multi)의 표로 붙인다
    table = {"columns": [{"key": "gpu", "label": "GPU", "align": "l"}, {"key": "vast", "label": "Vast 중앙값"}, {"key": "n", "label": "매물"},
                         {"key": "secure", "label": "RunPod 보안"}, {"key": "community", "label": "RunPod 커뮤니티"}], "rows": rows}
    target = ctx.series.get("gpu_cloud_multi") or ctx.prev.get("gpu_cloud_multi")
    if target:
        target["table"] = table
        ctx.series["gpu_cloud_multi"] = target
    ctx.state["gpu_quotes_" + TODAY] = {r["gpu"]: r["vast"] for r in rows if r.get("vast")}
    for k in [k for k in ctx.state if k.startswith("gpu_quotes_")][:-30]:
        ctx.state.pop(k, None)


# ── 8. TSMC 월매출 · CAPA ─────────────────────────────────────────────
@collector("tsmc_monthly_rev")
def c_tsmc_rev(ctx):
    rows = jget("https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=2330&start_date=2021-01-01")["data"]
    rev = {f"{r['revenue_year']}-{int(r['revenue_month']):02d}-01": r["revenue"] / 1e9 for r in rows}
    src = "FinMind (MOPS 월매출)"
    try:  # 거래소 공식 최신월로 덮어쓰기
        tw = jget("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", insecure=os.environ.get("AI_INSECURE_TWSE") == "1")
        for r in tw:
            if r.get("公司代號") == "2330":
                ym = r["資料年月"]  # 민국기년 11508
                y, m = int(ym[:-2]) + 1911, int(ym[-2:])
                rev[f"{y}-{m:02d}-01"] = int(r["營業收入-當月營收"]) / 1e6  # 천NT$ → 십억
                src = "TWSE 공개 API · FinMind"
    except Exception as e:
        print("  [warn] TWSE:", e)
    pts = [{"date": d, "value": round(v, 1)} for d, v in sorted(rev.items())]
    table = []
    for p in pts[-6:][::-1]:
        y, m = int(p["date"][:4]), int(p["date"][5:7])
        ly = rev.get(f"{y - 1}-{m:02d}-01")
        pm = rev.get(f"{y if m > 1 else y - 1}-{(m - 1) or 12:02d}-01")
        table.append({"month": p["date"][:7], "rev": p["value"], "yoy": rnd((p["value"] / ly - 1) * 100, 1) if ly else None,
                      "mom": rnd((p["value"] / pm - 1) * 100, 1) if pm else None})
    ctx.put({"id": "tsmc_monthly_rev", "group": "tsmc", "label": "TSMC 월매출", "unit": "NT$ 십억", "type": "line", "kpi": True, "digits": 0,
             "cadence": "월간 · 매월 10일경", "source": src, "source_url": "https://investor.tsmc.com/english/monthly-revenue", "method": "api",
             "related": ["TSM", "NVDA", "AMD", "AVGO"], "points": merge_points(ctx.old_points("tsmc_monthly_rev"), pts),
             "table": {"columns": [{"key": "month", "label": "월", "align": "l"}, {"key": "rev", "label": "매출(NT$ 십억)"}, {"key": "yoy", "label": "YoY %"}, {"key": "mom", "label": "MoM %"}], "rows": table},
             "caveat": "대만달러 기준 연결 매출입니다. 환율과 월별 출하 타이밍이 섞이므로 3개월 합으로 추세를 봅니다."})


CAPA_PAT = re.compile(r"(?:capacity|wafer shipments?)[^.]{0,160}?([\d,.]+)\s*(million|thousand|K)?\s*(?:12-inch|twelve-inch)[- ]equivalent wafers", re.I)


@collector("tsmc_capa")
def c_tsmc_capa(ctx):
    """분기 실적(SEC 6-K)·연간 보고서(20-F)에서 12인치 환산 CAPA/출하량 문장을 찾는다.
    못 찾으면 data_sources/tsmc_capa.json(수동 입력)을 쓰고, 그것도 없으면 대기로 둔다."""
    found = list((ctx.prev.get("tsmc_capa") or {}).get("rows", []))
    note = None
    try:
        subs = jget("https://data.sec.gov/submissions/CIK0001046179.json", headers={"User-Agent": "Mozilla/5.0"})
        rec = subs["filings"]["recent"]
        cands = [(rec["filingDate"][i], rec["accessionNumber"][i], rec["primaryDocument"][i], rec["form"][i])
                 for i in range(len(rec["form"])) if rec["form"][i] in ("6-K", "20-F")
                 and not re.search(r"revenue|monthend|dividend|board|agm|change", rec["primaryDocument"][i], re.I)][:8]
        done = {r.get("filing") for r in found}
        for fdate, acc, doc, form in cands:
            if acc in done:
                continue
            idx = jget(f"https://www.sec.gov/Archives/edgar/data/1046179/{acc.replace('-', '')}/index.json", headers={"User-Agent": "Mozilla/5.0"})
            for it in idx["directory"]["item"]:
                n = it["name"]
                if not n.lower().endswith((".htm", ".html")):
                    continue
                t = http(f"https://www.sec.gov/Archives/edgar/data/1046179/{acc.replace('-', '')}/{n}", headers={"User-Agent": "Mozilla/5.0"}).decode("utf-8", "replace")
                t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))
                for m in CAPA_PAT.finditer(t):
                    found.append({"filing": acc, "date": fdate, "form": form, "text": m.group(0)[:260],
                                  "value": m.group(1), "scale": m.group(2) or ""})
                time.sleep(0.3)
            time.sleep(0.5)
    except Exception as e:
        note = f"SEC 원문 조회 실패 ({type(e).__name__})"
    manual = []
    if os.path.exists(TSMC_CAPA_MANUAL):
        manual = json.load(open(TSMC_CAPA_MANUAL, encoding="utf-8")).get("rows", [])
    rows = sorted(found, key=lambda r: r["date"], reverse=True)[:12]
    ctx.put({"id": "tsmc_capa", "group": "tsmc", "label": "TSMC CAPA · 웨이퍼 출하 (12인치 환산)", "unit": "", "type": "capa",
             "status": "ok" if (rows or manual) else "pending",
             "status_note": None if (rows or manual) else (note or "실적 공시에서 CAPA 문장을 아직 찾지 못함 · 수동 입력 대기"),
             "cadence": "분기 · 실적 발표(1·4·7·10월 중순)", "source": "TSMC 분기 실적 (SEC 6-K) · 연간 보고서 (20-F)",
             "source_url": "https://investor.tsmc.com/english/quarterly-results", "method": "manual" if manual and not rows else "scrape",
             "related": ["TSM", "NVDA", "AMD"], "rows": rows, "manual": manual,
             "caveat": "TSMC는 CAPA를 연 단위(연간 보고서)로 주로 밝힙니다. 공시 문장에서 12인치 환산 수치만 자동으로 뽑고, 분기 값은 data_sources/tsmc_capa.json 으로 보충합니다."})


# ── 9. 하이퍼스케일러 캐팩스 (Yahoo) ─────────────────────────────────────
CAPEX_COS = [("AMZN", "Amazon"), ("MSFT", "Microsoft"), ("GOOGL", "Google"), ("META", "Meta"), ("ORCL", "Oracle")]


def yahoo_crumb():
    req = urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": UA})
    cookie = ""
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            cookie = r.headers.get("Set-Cookie", "")
    except urllib.error.HTTPError as e:
        cookie = e.headers.get("Set-Cookie", "")
    cookie = cookie.split(";")[0] if cookie else ""
    crumb = http("https://query1.finance.yahoo.com/v1/test/getcrumb", headers={"Cookie": cookie}).decode().strip()
    if not cookie or not crumb or "<" in crumb:
        raise ValueError("야후 인증값(crumb) 발급 실패")
    return cookie, crumb


def cal_q(d):
    """분기말 날짜 → 달력 분기 시작일 (오라클처럼 회계분기가 어긋나도 끝난 달 기준으로 묶는다)."""
    y, m = int(d[:4]), int(d[5:7])
    q = (m - 1) // 3
    return f"{y}-{q * 3 + 1:02d}-01"


@collector("hyperscaler_capex")
def c_capex(ctx):
    cookie, crumb = yahoo_crumb()
    lines = []
    for tk, label in CAPEX_COS:
        url = ("https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/" + tk + "?symbol=" + tk
               + "&type=quarterlyCapitalExpenditure&period1=1420070400&period2=1893456000&crumb=" + urllib.parse.quote(crumb))
        res = json.loads(http(url, headers={"Cookie": cookie}))["timeseries"]["result"]
        pts = []
        for r in res:
            for v in r.get("quarterlyCapitalExpenditure") or []:
                if v and v.get("reportedValue", {}).get("raw") is not None:
                    pts.append({"date": cal_q(v["asOfDate"]), "value": round(abs(v["reportedValue"]["raw"]) / 1e9, 2), "period_end": v["asOfDate"]})
        lines.append({"label": label, "points": pts})
        time.sleep(0.6)
    merged = merge_lines(ctx.old_lines("hyperscaler_capex"), lines)
    if not any(l["points"] for l in merged):
        raise ValueError("캐팩스 값 없음")
    ctx.put({"id": "hyperscaler_capex", "group": "capex", "label": "하이퍼스케일러 5사 분기 캐팩스", "unit": "$B", "type": "stack", "kpi": True, "digits": 1,
             "cadence": "매일 확인 · 실적 발표 시 갱신", "source": "각사 현금흐름표 (Yahoo Finance)", "source_url": "https://finance.yahoo.com", "method": "api",
             "related": ["NVDA", "AVGO", "TSM", "VRT"], "lines": merged,
             "caveat": "현금흐름표의 설비투자(유형자산 취득)입니다. 금융리스로 들여온 서버·데이터센터는 빠져 실제 투자보다 작게 나옵니다. 회계분기가 다른 오라클은 분기말이 속한 달력 분기로 묶었고, 5사가 모두 발표한 분기만 합산해 표시합니다."})


# ── 10. AI 랩 연매출 런레이트 (뉴스) ───────────────────────────────────
ARR_QUERIES = [("OpenAI", 'OpenAI ("annualized revenue" OR "revenue run rate" OR "run-rate" OR "annual recurring revenue")'),
               ("Anthropic", 'Anthropic ("annualized revenue" OR "revenue run rate" OR "run-rate" OR "annual recurring revenue")'),
               ("xAI", 'xAI ("annualized revenue" OR "revenue run rate" OR "run-rate")')]
AMT = re.compile(r"\$\s?(\d{1,4}(?:\.\d+)?)\s*(billion|bn|b\b|million|mn|m\b)", re.I)
NOISE = re.compile(r"valuation|valued|funding|raise|raising|round|loss|burn|spend|compute deal|invest|\bads?\b|advertis|Codex|API business|"
                   r"enterprise (?:unit|business)|segment|Moonshot|Kimi|Mistral|Cursor|in 20\d\d to|outpac|behind|\bby \$|gap", re.I)
PROJ = re.compile(r"on track|to top|will|expect|could|may\b|would|forecast|project|target|by 20\d\d|in 20\d\d|pace", re.I)
REV = re.compile(r"revenue|run[- ]rate|ARR|annuali[sz]ed", re.I)
TOP_SOURCES = ("Reuters", "Bloomberg", "CNBC", "The Information", "Wall Street Journal", "WSJ", "Financial Times", "Axios", "New York Times", "The Verge", "TechCrunch")


def pick_amount(title):
    """제목의 금액 중 '런레이트/매출' 단어에 가장 가까운 것을 고른다."""
    kw = [m.start() for m in REV.finditer(title)]
    best = None
    for m in AMT.finditer(title):
        dist = min(abs(m.start() - k) for k in kw) if kw else 0
        val = float(m.group(1)) * (1 if m.group(2).lower().startswith("b") else 0.001)
        if best is None or dist < best[0]:
            best = (dist, val)
    return best[1] if best else None


@collector("ai_lab_arr")
def c_arr(ctx):
    events = list((ctx.prev.get("ai_lab_arr") or {}).get("events", []))
    seen = {e.get("url") for e in events} | {e.get("text") for e in events}
    cutoff = NOW - timedelta(days=400)
    for lab, q in ARR_QUERIES:
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q + " when:60d", "hl": "en-US", "gl": "US", "ceid": "US:en"})
        root = ET.fromstring(http(url))
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            link = it.findtext("link") or ""
            src = it.findtext("source") or ""
            try:
                pub = email.utils.parsedate_to_datetime(it.findtext("pubDate")).astimezone(KST)
            except Exception:
                continue
            text = re.sub(r"\s+-\s+[^-]+$", "", title)
            if pub < cutoff or lab.lower() not in text.lower() or not REV.search(text) or NOISE.search(text):
                continue
            # 여러 랩이 함께 나오면 제목에서 먼저 나온 랩의 소식으로 본다 ("A outpaces B by $25B" → A)
            first = min((text.lower().find(l.lower()), l) for l, _ in ARR_QUERIES if l.lower() in text.lower())[1]
            if first != lab:
                continue
            amt = pick_amount(text)
            if amt is None or amt < 0.05 or text in seen or link in seen:
                continue
            seen.update({text, link})
            proj = PROJ.search(text.split(". ")[0])  # 첫 문장만 보고 전망 여부를 판단
            events.append({"date": pub.date().isoformat(), "label": lab, "amount": round(amt, 2), "unit": "$B",
                           "kind": "전망" if proj else "보도", "text": text, "source": src, "url": link, "sources": 1})
        time.sleep(0.6)
    # 같은 소식(랩·금액·구분이 같고 10일 이내)은 한 줄로 묶고, 주요 매체 기사를 대표로 남긴다
    events.sort(key=lambda e: e["date"])
    merged = []
    for e in events:
        twin = next((m for m in merged if m["label"] == e["label"] and m["amount"] == e["amount"] and m.get("kind") == e.get("kind")
                     and abs((date.fromisoformat(e["date"]) - date.fromisoformat(m["date"])).days) <= 10), None)
        if twin is None:
            merged.append(dict(e))
            continue
        twin["sources"] = twin.get("sources", 1) + e.get("sources", 1)
        if any(s in e["source"] for s in TOP_SOURCES) and not any(s in twin["source"] for s in TOP_SOURCES):
            twin.update({k: e[k] for k in ("text", "source", "url")})
    events = sorted(merged, key=lambda e: e["date"], reverse=True)
    ctx.put({"id": "ai_lab_arr", "group": "capex", "label": "AI 랩 연매출 런레이트 (보도 기준)", "unit": "$B", "type": "events",
             "cadence": "매일 뉴스 검색", "source": "Google News 검색 (Reuters · Bloomberg · The Information 등)", "source_url": "https://news.google.com",
             "method": "scrape", "related": ["MSFT", "AMZN", "GOOGL"], "events": events[:40],
             "empty_note": "최근 60일 보도에서 매출 런레이트 수치를 아직 찾지 못함",
             "caveat": "기사 제목에서 금액을 자동 추출합니다. 밸류에이션·투자·사업부(광고 등) 매출은 거르고, '~할 전망' 기사는 '전망'으로 따로 표시합니다. 같은 소식은 한 줄로 묶고 보도 매체 수를 붙입니다. 오탐이 있을 수 있으니 원문으로 확인하세요."})


# ── 11. 메모리 수출 (TRASS, 수출입 탭과 같은 원본) ────────────────────────
MEM_ITEMS = [("dram", "DRAM 수출"), ("mcp", "MCP 수출 (HBM 포함 추정)"), ("flash", "Flash 수출"), ("dram_module", "DRAM 모듈 수출")]
SPAN_ORDER = {"M": 3, "D20": 2, "D10": 1}
SPAN_EST = {"D10": 3, "D20": 1.5}  # 사용자 엑셀과 같은 월 환산 (1~10일 ×3, 1~20일 ×3/2)


@collector(*[f"trass_{k}" for k, _ in MEM_ITEMS])
def c_trass(ctx):
    t = json.load(open(TRASS, encoding="utf-8"))
    spans = t.get("spans", {})
    for key, label in MEM_ITEMS:
        obs = [o for o in t["observations"] if o["item"] == key]
        by_month = {o["month"]: o for o in obs if o["span"] == "M" and o.get("usd")}
        monthly = [{"date": m + "-01", "value": round(o["usd"] / 1e8, 1)} for m, o in sorted(by_month.items())]
        latest = max(obs, key=lambda o: (o["month"], SPAN_ORDER.get(o["span"], 0)), default=None)
        stat = None
        if latest and latest.get("usd"):
            rep = latest.get("reported") or {}
            ly = by_month.get(f"{int(latest['month'][:4]) - 1}{latest['month'][4:]}")
            yoy = rep.get("usd_yoy")
            if latest["span"] == "M" and ly:  # 월 전체끼리는 직접 계산
                yoy = round((latest["usd"] / ly["usd"] - 1) * 100, 1)
            stat = {"value": round(latest["usd"] / 1e8, 1), "period": f"{latest['month']} {spans.get(latest['span'], latest['span'])}",
                    "yoy": yoy, "mom": rep.get("usd_mom"),
                    "price": round(latest["usd"] / latest["kg"]) if latest.get("kg") else rep.get("price"), "price_yoy": rep.get("price_yoy")}
            if latest["span"] in SPAN_EST:  # 진행 중인 달: 월 환산 추정 막대
                monthly.append({"date": latest["month"] + "-01", "value": round(latest["usd"] * SPAN_EST[latest["span"]] / 1e8, 1), "est": True,
                                "note": f"{spans.get(latest['span'])} 잠정 ×{'3/2' if latest['span'] == 'D20' else '3'} 월 환산"})
        item = next((i for i in t["items"] if i["id"] == key), {})
        ctx.put({"id": f"trass_{key}", "group": "memory", "label": label, "unit": "억$", "type": "line", "digits": 1,
                 "cadence": "10일 단위 · 11일·21일·익월 1일경", "source": "관세청 TRASS (월별: 사용자 기준 엑셀)", "source_url": "https://www.trass.or.kr",
                 "method": "linked", "linked": "trass", "related": ["000660", "005930", "MU"], "points": monthly, "stat": stat,
                 "status": "ok" if monthly else "pending", "status_note": None if monthly else "TRASS 관측값 대기",
                 "caveat": item.get("hs_note", "") + " · 빗금 막대는 진행 중인 달의 순별 잠정치를 월로 환산한 추정입니다. 수출입 탭의 TRASS 표와 같은 원본."})


# ── 12. 기업 주가 (겹쳐보기 · 기업별 탭) ─────────────────────────────────
DEFAULT_COMPANIES = {
    "NVDA": ("NVIDIA", "NVDA", "US"), "AMD": ("AMD", "AMD", "US"), "AVGO": ("Broadcom", "AVGO", "US"), "TSM": ("TSMC ADR", "TSM", "US"),
    "MU": ("Micron", "MU", "US"), "MSFT": ("Microsoft", "MSFT", "US"), "GOOGL": ("Alphabet", "GOOGL", "US"), "AMZN": ("Amazon", "AMZN", "US"),
    "META": ("Meta", "META", "US"), "ORCL": ("Oracle", "ORCL", "US"), "CRWV": ("CoreWeave", "CRWV", "US"), "VRT": ("Vertiv", "VRT", "US"),
    "000660": ("SK하이닉스", "000660.KS", "KR"), "005930": ("삼성전자", "005930.KS", "KR"),
}


@collector()
def c_prices(ctx):
    comps = {k: {"label": v[0], "yahoo": v[1], "market": v[2]} for k, v in DEFAULT_COMPANIES.items()}
    if os.path.exists(LINKS):
        for c in json.load(open(LINKS, encoding="utf-8")).get("companies", []):
            comps[c["ticker"]] = {"label": c.get("label", c["ticker"]), "yahoo": c.get("yahoo", c["ticker"]), "market": c.get("market", "US")}
    out = {}
    for tk, c in comps.items():
        try:
            r = jget(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(c['yahoo'])}?range=2y&interval=1d")["chart"]["result"][0]
            ts, cl = r["timestamp"], r["indicators"]["quote"][0]["close"]
            pts = [{"date": datetime.fromtimestamp(t, KST).date().isoformat(), "value": round(v, 2)} for t, v in zip(ts, cl) if v is not None]
            out[tk] = {"label": c["label"], "market": c["market"], "currency": r["meta"].get("currency"), "points": pts}
        except Exception as e:
            print(f"  [warn] price {tk}: {e}")
            if tk in ctx.prev_companies:
                out[tk] = ctx.prev_companies[tk]
        time.sleep(0.25)
    ctx.companies = out


# ── 조립 ──────────────────────────────────────────────────────────────
GROUPS = [
    {"id": "demand", "label": "토큰 사용량", "desc": "얼마나 쓰이고, 누가 가져가나"},
    {"id": "ecosystem", "label": "모델 · 앱 생태계", "desc": "어떤 모델·앱이 뜨나"},
    {"id": "price", "label": "토큰 가격 · 속도", "desc": "단가가 얼마나 빠지나"},
    {"id": "gpu", "label": "GPU 렌탈가", "desc": "하드웨어 수급"},
    {"id": "credit", "label": "빅테크 CDS", "desc": "AI 투자의 신용 위험"},
    {"id": "memory", "label": "메모리 수출", "desc": "TRASS 잠정치"},
    {"id": "money", "label": "TSMC · 캐팩스 · AI 랩", "desc": "만드는 쪽 · 쓰는 쪽 · 버는 쪽"},
]
# 묶음마다 카드 4개 — 한 화면에 2×2 로 들어가게 맞춘다
BOARDS = {
    "demand": ["or_tokens_weekly", "or_spend_7d", "or_lab_top10", "or_lab_trend"],
    "ecosystem": ["or_model_rank", "or_app_rank", "hf_downloads", "or_new_models"],
    "price": ["or_avg_price", "frontier_price_index", "frontier_speed", "price_cuts"],
    "gpu": ["gpu_h100_index", "gpu_index_multi", "gpu_cloud_multi", "gpu_h100_spread"],
    "credit": ["cds_bigtech", "cds_ai", "cds_gap", "cds_table"],
    "memory": ["trass_dram", "trass_mcp", "trass_flash", "trass_dram_module"],
    "money": ["tsmc_monthly_rev", "tsmc_capa", "hyperscaler_capex", "ai_lab_arr"],
}
# 카드 아래에 붙는 한두 줄 설명 — "이게 무슨 데이터인가"
DESCS = {
    "or_tokens_weekly": "전 세계 개발자들이 OpenRouter(여러 AI 모델을 한 API로 쓰는 중개 서비스)로 한 주 동안 처리한 토큰 총량. AI 추론 수요의 온도계.",
    "or_spend_7d": "그 주에 AI 모델 사용료로 지불된 금액(주간 토큰 × 실효 단가). 토큰보다 지출이 덜 늘면 단가가 빠지고 있다는 뜻.",
    "or_lab_top10": "최근 7일 토큰을 모델을 만든 회사(랩)별로 합친 점유율. 누가 실제 사용량을 가져가고 있는지.",
    "or_lab_trend": "상위 5개 랩의 주간 점유율 변화. 신모델 출시·가격 인하 때 점유율이 어떻게 이동하는지 본다.",
    "or_model_rank": "최근 7일 사용량 상위 모델과 각 모델의 토큰·지출·실효 단가. 어떤 가격대 모델이 수요를 끄는지.",
    "or_app_rank": "OpenRouter로 모델을 호출하는 앱별 사용량. 코딩 에이전트 등 실제 수요처가 어디인지.",
    "hf_downloads": "Hugging Face에서 조직별 오픈모델이 최근 30일 내려받아진 횟수. 오픈소스 모델 확산 속도.",
    "or_new_models": "OpenRouter에 새로 등록된 모델 수(주간). 모델 공급 경쟁의 강도 — 몰리면 대개 가격 인하가 뒤따른다.",
    "or_avg_price": "토큰 100만 개당 실제로 낸 평균 금액(지출 ÷ 토큰). AI 추론 가격이 얼마나 빨리 싸지는지.",
    "frontier_price_index": "지능 점수 상위 5개 최고급 모델의 실제 지불 단가 평균. 최첨단 성능의 가격이 내려가는 속도.",
    "frontier_speed": "같은 최고급 모델들이 초당 뽑아내는 토큰 수. 추론 칩·서빙 최적화가 얼마나 빨라지는지.",
    "price_cuts": "OpenRouter 등록 모델 중 가격을 내린 사례를 매일 자동 감지해 기록. 가격 경쟁의 신호.",
    "gpu_h100_index": "H100 GPU 1장을 1시간 빌리는 값을 실제 체결 거래로 매일 정산한 지수. AI 연산 자원의 현재 시세.",
    "gpu_index_multi": "같은 체결 기준 지수를 GPU 세대별로 비교. 신형이 오르는 동안 구형이 눌리는지 본다.",
    "cds_bigtech": "빅테크 회사채의 부도 위험을 사고파는 보험료(5년물 CDS, bp). 오르면 시장이 그 회사 빚을 더 위험하게 본다는 뜻.",
    "cds_ai": "AI 투자를 빚으로 키우는 쪽(오라클·코어위브)과 칩을 파는 쪽(엔비디아·브로드컴)의 신용 위험 비교.",
    "cds_gap": "오라클 CDS에서 마이크로소프트 CDS를 뺀 값. AI 데이터센터 차입에 시장이 매기는 추가 위험 프리미엄.",
    "cds_table": "추적 중인 빅테크·AI 기업의 오늘 5년물 CDS와 전일 대비 변화.",
    "gpu_cloud_multi": "GPU 세대별 클라우드 임대 중앙가. 신형이 나오며 구형 가격이 얼마나 빨리 내려가는지.",
    "gpu_h100_spread": "같은 H100을 AWS·Azure 같은 대형 클라우드와 CoreWeave 같은 GPU 전문 클라우드가 파는 가격 차이.",
    "gpu_cloud_multi": "GPU 세대별 클라우드 공시가 중앙값(80여 개 클라우드). 정가는 체결가보다 늦게 움직인다.",
    "trass_dram": "한국에서 해외로 나간 DRAM 칩 수출액(월별). 삼성전자·SK하이닉스 메모리 업황의 가장 빠른 실측치.",
    "trass_mcp": "여러 칩을 한 패키지로 묶은 MCP 수출액. HBM이 주로 여기로 잡혀 AI 메모리 수요의 대리 지표로 본다.",
    "trass_flash": "낸드 등 플래시 메모리 수출액. 저장장치(SSD) 수요와 낸드 가격 흐름을 반영.",
    "trass_dram_module": "DRAM 칩을 기판에 꽂아 만든 서버·PC용 모듈 수출액. 완제품 단계의 메모리 출하.",
    "tsmc_monthly_rev": "세계 1위 파운드리 TSMC의 월 매출. 엔비디아·AMD 등 AI 칩 생산량의 가장 빠른 공식 지표.",
    "tsmc_capa": "TSMC의 웨이퍼 생산능력(12인치 환산). 공급이 수요를 따라가는지 본다.",
    "hyperscaler_capex": "아마존·MS·구글·메타·오라클이 분기마다 쓴 설비투자 합계. AI 데이터센터에 들어가는 돈의 총량.",
    "ai_lab_arr": "OpenAI·Anthropic 등 AI 랩의 연환산 매출(런레이트) 보도. AI에 들어간 돈이 매출로 돌아오는지.",
}
KPI_ORDER = ["or_tokens_weekly", "or_avg_price", "gpu_h100_index", "tsmc_monthly_rev", "hyperscaler_capex", "trass_dram"]
COLLECTORS = {"or_models": c_or_models, "or_chart": c_or_chart, "or_week": c_or_week, "or_apps": c_or_apps, "frontier": c_frontier,
              "hf": c_hf, "ornn": c_ornn, "cds": c_cds, "gpu_hist": c_gpu_history, "gpu": c_gpu, "tsmc": c_tsmc_rev, "capa": c_tsmc_capa, "capex": c_capex, "arr": c_arr, "trass": c_trass, "prices": c_prices}


def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="쉼표로 구분한 수집기 이름: " + ",".join(COLLECTORS))
    args = ap.parse_args()
    prev = load(OUT, {})
    if prev.get("sample"):
        prev = {}  # 디자인용 샘플 파일은 이력으로 쓰지 않는다
    ctx = Ctx(prev, load(STATE, {}))
    ctx.companies = prev.get("companies", {})
    names = args.only.split(",") if args.only else list(COLLECTORS)
    for n in names:
        print(f"[{n}]")
        COLLECTORS[n](ctx)
    # --only 로 일부만 돌렸으면 나머지 지표는 기존 값을 그대로 둔다
    for sid, s in ctx.prev.items():
        ctx.series.setdefault(sid, s)
    for s in ctx.series.values():
        s["kpi"] = s["id"] in KPI_ORDER
        if s["id"] in DESCS:
            s["desc"] = DESCS[s["id"]]
    order = [sid for g in GROUPS for sid in BOARDS[g["id"]]]
    series = [ctx.series[sid] for sid in order if sid in ctx.series]
    for s in series:
        s["group"] = next(g["id"] for g in GROUPS if s["id"] in BOARDS[g["id"]])
    doc = {"schema_version": 1, "generated_at": NOW.isoformat(timespec="minutes"), "sample": False,
           "groups": GROUPS, "boards": BOARDS, "kpis": KPI_ORDER, "series": series, "companies": ctx.companies,
           "errors": ctx.errors, "telegram": prev.get("telegram") or {"status": "pending", "label": "주간 요약 · 화요일 09:00", "last_sent": None}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump(ctx.state, f, ensure_ascii=False, separators=(",", ":"))
    ok = sum(1 for s in series if s.get("status") == "ok")
    print(f"wrote {OUT} · series {len(series)} (ok {ok}) · errors {len(ctx.errors)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
