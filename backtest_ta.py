#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backtest_ta.py — 기술점수 백테스트 + 차트 패턴 감지 → docs/ta_backtest.json, docs/chart_patterns.json

1) 기술점수 백테스트
   docs/stocks-common.js 의 computeTA()를 그대로 파이썬으로 옮겨 5년 일봉의 '매일' 점수를 만든 뒤
   5·20·60거래일 뒤 수익률과 비교한다.
   - 점수 구간별 평균 수익률·승률·시장 대비 초과수익
   - 매주 점수 상위 X%만 샀다면? (X = 1·3·5·10·20·30·50%) → 가장 좋은 X
   - 8개 세부 지표별 예측력(IC) → 학습 구간(앞 60%)에서 가중치를 다시 잡고 검증 구간(뒤 40%)에서 확인
   - 익절·손절 % 조합(60거래일 안에 먼저 닿는 쪽) 기대수익
2) 차트 패턴 (차트/차트 패턴 및 성호님 방식.pdf)
   컵앤핸들 · 쌍바닥 · 상승 깃발 · 상승/대칭 삼각수렴 · 하락 쐐기 · 박스권 · 추세선 (+ 하락형: 하락 삼각·상승 쐐기)
   - 매일 '돌파 임박(저항선 3% 이내)' / '돌파(종가가 저항선 위)' 상태를 판정
   - 과거 돌파가 실제로 몇 % 올랐는지, 임박 신호 뒤 몇 %가 실제로 뚫었는지 백테스트

미래 데이터 금지: 고점·저점(피벗)은 좌우 K봉이 지나서 '확정된' 것만 쓰고, 패턴 판정은 그날 종가까지만 본다.
입력: data_sources/_cache/megacap_daily.json (fetch_megacap.py가 남김). 없거나 오래되면 야후에서 직접 받는다.
"""
import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
MEGACAP = os.path.join(BASE, "docs", "megacap.json")
UNIVERSE = os.path.join(BASE, "docs", "megacap_universe.json")
CACHE = os.path.join(BASE, "data_sources", "_cache", "megacap_daily.json")
OUT_BT = os.path.join(BASE, "docs", "ta_backtest.json")
OUT_PT = os.path.join(BASE, "docs", "chart_patterns.json")
KST = timezone(timedelta(hours=9))

HORIZONS = [5, 20, 60]
WARMUP = 130            # MA120·일목(77봉) 계산이 모두 가능해지는 지점부터 표본으로 쓴다
REBAL_EVERY = 5         # 상위 X% 포트폴리오는 5거래일(1주)마다 교체
TOP_PCTS = [1, 3, 5, 10, 20, 30, 50, 100]
TRAIN_FRAC = 0.6

# ───────────────────────── 데이터 ─────────────────────────
def load_charts():
    fresh = False
    if os.path.exists(CACHE):
        age_h = (time.time() - os.path.getmtime(CACHE)) / 3600
        fresh = age_h < 30
    if fresh:
        charts = json.load(open(CACHE, encoding="utf-8"))["charts"]
        print(f"  캐시 사용: {len(charts)}종목")
        return charts
    print("  캐시 없음/오래됨 → 야후에서 5년 일봉 다운로드")
    sys.path.insert(0, BASE)
    from fetch_megacap import fetch_chart
    uni = json.load(open(UNIVERSE, encoding="utf-8"))["stocks"]
    charts = {}
    for i, s in enumerate(uni, 1):
        ch = fetch_chart(s["ticker"])
        if ch:
            charts[s["ticker"]] = ch
        if i % 50 == 0:
            print(f"    {i}/{len(uni)}")
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump({"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"), "charts": charts},
              open(CACHE, "w", encoding="utf-8"), separators=(",", ":"))
    return charts

# ───────────────────────── 기술점수 (computeTA 이식) ─────────────────────────
SUB_KEYS = ["ma", "vol", "sup", "rsi", "macd", "boll", "ichi", "brk"]
SUB_LABEL = {"ma": "이동평균선 정배열", "vol": "거래량", "sup": "이평선 지지·이격도", "rsi": "RSI(14)",
             "macd": "MACD", "boll": "볼린저밴드 %B", "ichi": "일목균형표 구름대", "brk": "삼각수렴·돌파"}
WEIGHTS = {"ma": 24, "vol": 18, "sup": 14, "rsi": 10, "macd": 10, "boll": 6, "ichi": 8, "brk": 10}

def _clip(a):
    return np.clip(a, 0, 100)

def ta_series(o, h, l, c, v):
    """매일의 세부 점수 8개 + 종합점수. JS computeTA와 같은 규칙(그날까지 데이터만 사용)."""
    n = len(c)
    C, H, L, V = pd.Series(c), pd.Series(h), pd.Series(l), pd.Series(v, dtype=float)
    idx = np.arange(n)
    ma5, ma20, ma60, ma120 = (C.rolling(p).mean().values for p in (5, 20, 60, 120))
    out = {}

    ok = np.zeros(n); tot = np.zeros(n)
    for a, b in ((ma5, ma20), (ma20, ma60), (ma60, ma120)):
        av = ~np.isnan(a) & ~np.isnan(b)
        tot += av
        ok += av & (np.nan_to_num(a) > np.nan_to_num(b))
    align = np.where(tot > 0, ok / np.maximum(tot, 1) * 85, 42.0)
    align = align + np.where(~np.isnan(ma20) & (c > np.nan_to_num(ma20, nan=np.inf)), 15, 0)
    out["ma"] = _clip(align)

    v5 = V.rolling(5).mean().values
    v20 = V.rolling(20).mean().shift(5).values
    c6 = C.shift(5).values
    r5 = np.where(np.nan_to_num(c6) != 0, c / np.where(np.nan_to_num(c6) != 0, c6, 1) - 1, 0)
    ratio = np.where((np.nan_to_num(v5) > 0) & (np.nan_to_num(v20) > 0), np.nan_to_num(v5) / np.where(np.nan_to_num(v20) > 0, v20, 1), np.nan)
    vs = _clip(40 + (ratio - 1) * 50 + np.where(r5 > 0, 10, -10))
    out["vol"] = np.where(np.isnan(ratio), 50, vs)

    gap = (c / ma20 - 1) * 100
    sc = np.where(gap < -8, 25, np.where(gap < 0, 55 + gap * 2, np.where(gap <= 7, 100 - gap * 2, _clip(86 - (gap - 7) * 3))))
    sc = sc + np.where(np.nan_to_num(ma5) > np.nan_to_num(ma20, nan=np.inf), 6, 0)
    out["sup"] = np.where(np.isnan(ma20), 50, _clip(sc))

    d = C.diff()
    gain = d.clip(lower=0).rolling(14).sum().values
    loss = (-d).clip(lower=0).rolling(14).sum().values
    rsi = np.where(loss == 0, 100.0, 100 - 100 / (1 + gain / np.where(loss == 0, 1, loss)))
    rs = np.where((rsi >= 50) & (rsi <= 65), 100, np.where(rsi > 65, _clip(100 - (rsi - 65) * 3),
                  np.where(rsi >= 40, 60 + (rsi - 40) * 4, _clip(rsi * 1.2))))
    out["rsi"] = np.where(np.isnan(gain), 50, _clip(rs))

    e12 = C.ewm(span=12, adjust=False).mean(); e26 = C.ewm(span=26, adjust=False).mean()
    m = (e12 - e26); s = m.ewm(span=9, adjust=False).mean()
    m, s = m.values, s.values
    out["macd"] = np.where(idx + 1 < 35, 50, _clip(50 + np.where(m > s, 25, -20) + np.where(m > 0, 20, -15)))

    mid = C.rolling(20).mean().values; sd = C.rolling(20).std(ddof=0).values
    up, lo = mid + 2 * sd, mid - 2 * sd
    pctB = np.where(up == lo, 0.5, (c - lo) / np.where(up == lo, 1, up - lo))
    bs = np.where((pctB >= 0.5) & (pctB <= 0.9), 100, np.where(pctB > 0.9, _clip(100 - (pctB - 0.9) * 200), _clip(pctB * 120)))
    out["boll"] = np.where(idx + 1 < 20, 50, _clip(bs))

    hh = lambda p: H.rolling(p).max(); ll = lambda p: L.rolling(p).min()
    tenkan = ((hh(9) + ll(9)) / 2); kijun = ((hh(26) + ll(26)) / 2)
    spanA = ((tenkan + kijun) / 2).shift(26).values; spanB = ((hh(52) + ll(52)) / 2).shift(26).values
    top, bot = np.fmax(spanA, spanB), np.fmin(spanA, spanB)
    ich = np.where(c > top, 90, np.where(c < bot, 20, 50)) + np.where(tenkan.values > kijun.values, 8, 0)
    ich = np.where(np.isnan(spanA) | np.isnan(spanB), 50, ich)
    out["ichi"] = np.where(idx + 1 < 52, 50, _clip(ich))

    rh, rl = H.rolling(20).max(), L.rolling(20).min()
    recent = ((rh - rl) / rl * 100).values
    prior = ((rh - rl) / rl * 100).shift(20).values
    contracting = recent < prior * 0.85
    hi20 = H.rolling(20).max().shift(1).values
    breakout = c > hi20
    bk = np.where(contracting & breakout, 92, np.where(breakout, 74, np.where(contracting, 60, 45)))
    out["brk"] = np.where(idx + 1 < 40, 50, bk)

    total = sum(out[k] * WEIGHTS[k] for k in SUB_KEYS) / sum(WEIGHTS.values())
    out["score"] = np.floor(total + 0.5)
    return out

def tuned_score(subs, w):
    """50 + Σ w·(세부점수−50) / Σ|w| — 가중치가 음수면 '반대로 작동하는 지표'라는 뜻"""
    den = sum(abs(x) for x in w.values()) or 1
    return np.clip(50 + sum(w[k] * (subs[k] - 50) for k in SUB_KEYS) / den, 0, 100)

# ───────────────────────── 피벗(확정된 고점·저점) ─────────────────────────
PIV_K = 5

def pivots(h, l, k=PIV_K):
    """좌우 k봉 중 최고/최저인 봉. j번째 피벗은 j+k일에야 확정된다(그 전에는 모름)."""
    n = len(h)
    H = pd.Series(h); L = pd.Series(l)
    hmax = H.rolling(2 * k + 1, center=True).max().values
    lmin = L.rolling(2 * k + 1, center=True).min().values
    ph = [j for j in range(k, n - k) if h[j] == hmax[j] and h[j] > h[j - 1]]
    pl = [j for j in range(k, n - k) if l[j] == lmin[j] and l[j] < l[j - 1]]
    return np.array(ph, dtype=int), np.array(pl, dtype=int)

# ───────────────────────── 패턴 판정 ─────────────────────────
PATTERNS = {
    "cup":     {"name": "컵앤핸들",     "side": "bull", "emoji": "☕"},
    "dbl":     {"name": "쌍바닥",       "side": "bull", "emoji": "W"},
    "flag":    {"name": "상승 깃발",    "side": "bull", "emoji": "🚩"},
    "asc":     {"name": "상승 삼각수렴", "side": "bull", "emoji": "◺"},
    "sym":     {"name": "대칭 삼각수렴", "side": "bull", "emoji": "◁"},
    "fwedge":  {"name": "하락 쐐기",    "side": "bull", "emoji": "⟍"},
    "box":     {"name": "박스권",       "side": "bull", "emoji": "▭"},
    "tline":   {"name": "추세선",       "side": "bull", "emoji": "／"},
    "desc":    {"name": "하락 삼각수렴", "side": "bear", "emoji": "◸"},
    "rwedge":  {"name": "상승 쐐기",    "side": "bear", "emoji": "⟋"},
}
PRIORITY = ["cup", "dbl", "flag", "asc", "fwedge", "sym", "box", "tline", "desc", "rwedge"]
NEAR = 0.03      # 저항선 3% 이내 = 돌파 임박
BRK = 0.005      # 저항선 +0.5% 위 종가 = 돌파

def _fit(x, y):
    """로그가격 최소제곱 직선 → (기울기, 절편, 최대잔차)"""
    if len(x) < 2:
        return None
    b, a = np.polyfit(x, y, 1)
    res = np.abs(y - (a + b * x)).max()
    return b, a, res

class Detector:
    def __init__(self, o, h, l, c, v):
        self.o, self.h, self.l, self.c, self.v = o, h, l, c, v
        self.lh, self.ll, self.lc = np.log(h), np.log(l), np.log(c)
        self.ph, self.pl = pivots(h, l)
        self.vma20 = pd.Series(v, dtype=float).rolling(20).mean().shift(1).values
        self.n = len(c)
        self._memo = {}

    def _fitc(self, idx, arr, tag):
        """같은 피벗 조합의 직선은 다시 계산하지 않는다(피벗은 며칠에 한 번만 바뀜)"""
        key = (tag, tuple(idx))
        r = self._memo.get(key)
        if r is None:
            r = _fit(idx.astype(float), arr[idx])
            self._memo[key] = r
        return r

    def _conf(self, arr, t, lo):
        """t일까지 확정된(j+K<=t) 피벗 중 lo 이후 것"""
        a = arr[(arr + PIV_K <= t) & (arr >= lo)]
        return a

    def _state(self, t, level, prev_level):
        c = self.c
        if c[t] > level * (1 + BRK):
            return "breakout" if c[t - 1] <= prev_level * (1 + BRK) else None
        if c[t] >= level * (1 - NEAR):
            return "near"
        return "forming"

    def _vol(self, t, s):
        """패턴 안에서 거래량이 줄었는지(후반 10봉 / 전반), 오늘 거래량이 20일 평균의 몇 배인지"""
        v = self.v
        seg = v[s:t]
        dry = None
        if len(seg) >= 16:
            half = len(seg) // 2
            a, b = seg[:half].mean(), seg[-10:].mean()
            dry = round(float(b / a), 2) if a > 0 else None
        surge = round(float(v[t] / self.vma20[t]), 2) if self.vma20[t] and self.vma20[t] > 0 else None
        return dry, surge

    # --- 추세선 계열: 삼각수렴·쐐기·박스·추세선 ---
    def lines(self, t):
        c, lc = self.c, self.lc
        best = None
        highs_all = self._conf(self.ph, t, t - 130)
        lows_all = self._conf(self.pl, t, t - 130)
        if len(highs_all) < 2:
            return None
        starts = sorted(set(list(highs_all[:-1]) + list(lows_all)))
        for s in starts:
            if t - s < 15:
                continue
            hi = highs_all[highs_all >= s][-5:]
            lw = lows_all[lows_all >= s][-5:]
            if len(hi) < 2:
                continue
            fu = self._fitc(hi, self.lh, "h")
            if fu is None or fu[2] > 0.025:
                continue
            bu, au, _ = fu
            span = t - s
            xs = np.arange(s, t)
            upper = au + bu * xs
            # 저항선 아래에서 움직였어야 함(종가가 선을 1.5% 넘게 뚫은 날이 없어야)
            if len(xs) and (lc[s:t] - upper).max() > 0.015:
                continue
            kind = None
            fl = None
            if len(lw) >= 2:
                fl = self._fitc(lw, self.ll, "l")
                if fl is not None and fl[2] <= 0.025:
                    bl, al, _ = fl
                    lower = al + bl * xs
                    if (lower - lc[s:t]).max() > 0.02:
                        fl = None
                else:
                    fl = None
            du = bu * span
            if fl is not None:
                bl, al, _ = fl
                dl = bl * span
                w0 = (au + bu * s) - (al + bl * s)
                wt = (au + bu * t) - (al + bl * t)
                flat_u, flat_l = abs(du) < 0.03, abs(dl) < 0.03
                conv = wt < w0 * 0.8 and wt > 0
                apex_ok = True
                if bu - bl < 0:   # 두 선이 만나는 꼭짓점(apex) 전에 뚫어야 유효
                    apex = (al - au) / (bu - bl)
                    apex_ok = apex > t + 2
                if w0 <= 0.02 or w0 > 0.6:
                    continue
                if flat_u and dl >= 0.03 and conv and apex_ok:
                    kind = "asc"
                elif du <= -0.03 and dl >= 0.03 and conv and apex_ok:
                    kind = "sym"
                elif du <= -0.03 and flat_l and conv and apex_ok:
                    kind = "desc"
                elif du >= 0.03 and dl > du and conv and apex_ok:
                    kind = "rwedge"
                elif du <= -0.03 and dl <= -0.03 and du < dl and conv and apex_ok:
                    kind = "fwedge"
                elif flat_u and flat_l and 0.04 <= w0 <= 0.35 and len(hi) >= 2 and len(lw) >= 2 and span >= 20:
                    kind = "box"
                height = math.exp(w0) - 1
            if kind is None and len(hi) >= 3 and span >= 30 and du <= 0.03:
                kind = "tline"
                height = math.exp((au + bu * s) - self.ll[s:t].min()) - 1 if t > s else 0.1
                fl = None
            if kind is None:
                continue
            cand = {"kind": kind, "s": int(s), "bu": bu, "au": au, "fl": fl, "height": float(height),
                    "touch": int(len(hi) + (len(lw) if fl is not None else 0))}
            if best is None or cand["s"] < best["s"]:   # 가장 길게 이어진 패턴 우선
                best = cand
        if best is None:
            return None
        level = math.exp(best["au"] + best["bu"] * t)
        prev = math.exp(best["au"] + best["bu"] * (t - 1))
        st = self._state(t, level, prev)
        if st is None:
            return None
        best.update(level=level, state=st)
        return best

    # --- 쌍바닥 ---
    def double_bottom(self, t):
        pl = self._conf(self.pl, t, t - 160)
        if len(pl) < 2:
            return None
        j2 = pl[-1]
        if t - j2 > 60:
            return None
        for j1 in pl[:-1][::-1]:
            if not (15 <= j2 - j1 <= 130):
                continue
            l1, l2 = self.l[j1], self.l[j2]
            if abs(l2 / l1 - 1) > 0.04:
                continue
            low = min(l1, l2)
            if self.l[j1:j2 + 1].min() < low * 0.995:
                continue
            neck = self.h[j1:j2 + 1].max()
            if neck < low * 1.08:
                continue
            pre = self.h[max(0, j1 - 60):j1]
            if len(pre) == 0 or pre.max() < neck:          # 하락 뒤 바닥이어야
                continue
            if t - 1 > j2 and self.c[j2 + 1:t].max() > neck * (1 + BRK):
                return None
            if self.l[j2 + 1:t + 1].min() < low * 0.97:
                return None
            st = self._state(t, neck, neck)
            if st is None:
                return None
            return {"kind": "dbl", "s": int(j1), "j1": int(j1), "j2": int(j2), "level": float(neck),
                    "low": float(low), "height": float(neck / low - 1), "state": st}
        return None

    # --- 컵앤핸들 ---
    def cup(self, t):
        ph = self._conf(self.ph, t, t - 300)
        if len(ph) < 2:
            return None
        h, l, c = self.h, self.l, self.c
        for jR in ph[::-1]:
            hl = t - jR
            if hl > 40:
                break
            if hl < 3:
                continue
            for jL in ph[ph < jR][::-1]:
                span = jR - jL
                if span < 30:
                    continue
                if span > 250:
                    break
                rimL, rimR = h[jL], h[jR]
                if not (rimL * 0.93 <= rimR <= rimL * 1.05):
                    continue
                inner = h[jL + 1:jR]
                if len(inner) and inner.max() > min(rimL, rimR) * 1.01:
                    continue
                seg = l[jL:jR + 1]
                bi = int(seg.argmin()); bottom = seg[bi]
                depth = (rimL - bottom) / rimL
                if not (0.12 <= depth <= 0.5):
                    continue
                if not (0.2 <= bi / span <= 0.8):          # 바닥이 한쪽으로 쏠리면 컵 아님
                    continue
                cseg = c[jL:jR + 1]
                lower = (cseg <= bottom + (rimL - bottom) * 0.4).mean()
                if lower < 0.2:                             # V자(바닥에서 머문 시간 없음) 제외
                    continue
                pre = l[max(0, jL - 100):jL]
                if len(pre) == 0 or rimL < pre.min() * 1.15:  # 컵 전에 상승 구간
                    continue
                handle_low = l[jR:t + 1].min()
                if (rimR - handle_low) > (rimR - bottom) / 3:   # 핸들이 컵 깊이의 1/3 넘게 빠지면 무효
                    return None
                level = rimR
                if c[jR + 1:t].size and c[jR + 1:t].max() > level * (1 + BRK):
                    return None
                st = self._state(t, level, level)
                if st is None:
                    return None
                return {"kind": "cup", "s": int(jL), "jL": int(jL), "jR": int(jR), "jB": int(jL + bi),
                        "level": float(level), "bottom": float(bottom), "height": float(depth / (1 - depth)),
                        "handle_low": float(handle_low), "state": st}
        return None

    # --- 상승 깃발 ---
    def flag(self, t):
        h, l, c = self.h, self.l, self.c
        if t < 45:
            return None
        w = h[t - 30:t - 4]
        p1 = t - 30 + int(w.argmax())
        p0 = max(0, p1 - 25) + int(l[max(0, p1 - 25):p1 + 1].argmin())
        if p1 - p0 < 3:
            return None
        top, base = h[p1], l[p0]
        pole = top / base - 1
        if pole < 0.12:
            return None
        fl = t - p1
        if not (4 <= fl <= 25):
            return None
        flow = l[p1:t + 1].min()
        if (top - flow) > (top - base) / 3:                 # 깃대의 1/3 넘게 되돌리면 무효
            return None
        xs = np.arange(p1, t).astype(float)
        bu, au = np.polyfit(xs, self.lh[p1:t], 1)
        if bu > 0.002 or bu < -0.01:                        # 옆·아래로 흐르되 너무 가파르면 X
            return None
        au = max(au, float((self.lh[p1:t] - bu * xs).max()))  # 깃발 윗선이 고가들을 덮도록
        level = math.exp(au + bu * t)
        prev = math.exp(au + bu * (t - 1))
        if c[p1 + 1:t].size and (self.lc[p1 + 1:t] - (au + bu * np.arange(p1 + 1, t))).max() > np.log(1 + BRK):
            return None
        st = self._state(t, level, prev)
        if st is None:
            return None
        return {"kind": "flag", "s": int(p0), "p0": int(p0), "p1": int(p1), "bu": float(bu), "au": float(au),
                "level": float(level), "height": float(pole), "state": st, "top": float(top), "base": float(base)}

    def detect(self, t):
        found = []
        for fn in (self.cup, self.double_bottom, self.flag, self.lines):
            try:
                r = fn(t)
            except Exception:
                r = None
            if r:
                found.append(r)
        found.sort(key=lambda r: PRIORITY.index(r["kind"]))
        return found

# ───────────────────────── 전략 토너먼트용 보조 지표 ─────────────────────────
FEAT_KEYS = ["ma200", "ma50_200", "gap20", "r1w", "r1m", "hi52", "mom12_1"]

def features(h, l, c):
    C, H = pd.Series(c), pd.Series(h)
    return {
        "ma200": (C / C.rolling(200).mean()).values,
        "ma50_200": (C.rolling(50).mean() / C.rolling(200).mean()).values,
        "gap20": (C / C.rolling(20).mean()).values,
        "r1w": (C / C.shift(5) - 1).values,
        "r1m": (C / C.shift(21) - 1).values,
        "hi52": (C / H.rolling(252, min_periods=120).max()).values,
        "mom12_1": (C.shift(21) / C.shift(252) - 1).values,
    }

# 매 실행마다 전부 다시 채점해서 '학습·검증·연도별로 꾸준히 이긴' 규칙만 추천한다. 새 아이디어는 여기에 추가.
UPTREND = lambda f: (f["ma200"] > 1) & (f["ma50_200"] > 1)
STRATEGIES = [
    {"id": "pull_1w", "name": "🎯 추세 속 눌림목", "desc": "200일선 위 · 50일선>200일선(상승추세)인데 최근 1주 −3% 이하로 밀린 종목",
     "f": lambda f: UPTREND(f) & (f["r1w"] <= -0.03)},
    {"id": "pull_ma20", "name": "🎯 20일선 아래 눌림", "desc": "상승추세인데 종가가 20일선보다 3% 이상 아래",
     "f": lambda f: UPTREND(f) & (f["gap20"] <= 0.97)},
    {"id": "rebound", "name": "🧊 낙폭과대 반등", "desc": "52주 고점 대비 −20% 이하인데 최근 1주 +3% 이상 반등",
     "f": lambda f: (f["hi52"] <= 0.8) & (f["r1w"] >= 0.03),
     "bias": "명단이 '지금' 시총 상위 300이라, 과거에 크게 빠진 뒤 회복 못 하고 명단에서 빠진 종목은 빠져 있습니다 → 실제보다 좋게 나올 수 있음"},
    {"id": "mom_dip", "name": "🏃 강한 종목 쉬어가기", "desc": "12개월(최근 1개월 제외) 수익률 상위 30%인데 최근 1개월은 하락",
     "f": lambda f: (f["mom12_1"] >= f["_mom_q70"]) & (f["r1m"] < 0)},
    {"id": "hot", "name": "🔥 기술점수 80+", "desc": "기존 기술점수 80점 이상(이미 강하게 오른 종목)",
     "f": lambda f: f["score"] >= 80},
    {"id": "cold", "name": "❄️ 기술점수 35 미만", "desc": "기존 기술점수 35점 미만(많이 눌린 종목)",
     "f": lambda f: f["score"] < 35,
     "bias": "낙폭 큰 종목을 사는 규칙이라 생존자 편향(지금 살아남은 300종목만 봄)으로 실제보다 좋게 나올 수 있음"},
    {"id": "brk_vol", "name": "🚀 거래량 실린 패턴 돌파", "desc": "상승 삼각수렴·박스권·상승 깃발 돌파 + 돌파일 거래량 20일 평균 1.3배 이상",
     "event": lambda e: e["k"].isin(["asc", "box", "flag"]) & (e["surge"].fillna(0) >= 1.3)},
    {"id": "brk_all", "name": "📐 상승형 패턴 돌파(전체)", "desc": "컵앤핸들·쌍바닥·깃발·삼각수렴·쐐기·박스·추세선 등 상승형 패턴의 모든 돌파",
     "event": lambda e: e["k"].isin([k for k, v in PATTERNS.items() if v["side"] == "bull"])},
]

# ───────────────────────── 통계 헬퍼 ─────────────────────────
TPS = [5, 10, 15, 20, 25, 30, 40]
SLS = [5, 7, 10, 15, 20, 0]      # 0 = 손절 없음

def tpsl_grid(picks, paths, hold=60):
    """매수 뒤 60거래일 안에 익절가(고가)·손절가(저가) 중 먼저 닿는 쪽으로 청산. 같은 날 둘 다면 손절(보수적). 못 닿으면 60일째 종가."""
    ups, dns, fin = [], [], []
    for tk, t in picks:
        dates, h, l, c = paths[tk]
        t = int(t)
        if t + hold >= len(c):
            continue
        e = c[t]
        ups.append(h[t + 1:t + hold + 1] / e - 1); dns.append(l[t + 1:t + hold + 1] / e - 1); fin.append(c[t + hold] / e - 1)
    if not ups:
        return {"tps": TPS, "sls": SLS, "grid": {}}
    U, D, F = np.array(ups), np.array(dns), np.array(fin)
    big = hold + 5
    grid = {}
    for tp in TPS:
        hitU = U >= tp / 100
        iu = np.where(hitU.any(1), hitU.argmax(1), big)
        for sl in SLS:
            if sl:
                hitD = D <= -sl / 100
                idn = np.where(hitD.any(1), hitD.argmax(1), big)
            else:
                idn = np.full(len(U), big)
            r = np.where((iu == big) & (idn == big), F, np.where(idn <= iu, -sl / 100, tp / 100))
            grid[f"{tp}|{sl}"] = {"exp": round(float(r.mean()) * 100, 2), "win": round(float((r > 0).mean()) * 100, 1), "n": int(len(r))}
    bk = max(grid, key=lambda k: grid[k]["exp"])
    return {"tps": TPS, "sls": SLS, "grid": grid, "hold60": round(float(F.mean()) * 100, 2),
            "best": {"tp": int(bk.split("|")[0]), "sl": int(bk.split("|")[1]), **grid[bk]}}

def stats(arr):
    a = np.asarray([x for x in arr if x is not None and np.isfinite(x)], dtype=float)
    if len(a) == 0:
        return {"n": 0}
    return {"n": int(len(a)), "mean": round(float(a.mean()) * 100, 2), "median": round(float(np.median(a)) * 100, 2),
            "win": round(float((a > 0).mean()) * 100, 1)}

def spearman(x, y):
    if len(x) < 8:
        return None
    rx = pd.Series(x).rank().values; ry = pd.Series(y).rank().values
    if rx.std() == 0 or ry.std() == 0:
        return None
    return float(np.corrcoef(rx, ry)[0, 1])

# ───────────────────────── 메인 ─────────────────────────
def main():
    t0 = time.time()
    print(f"=== backtest_ta.py 시작 ({datetime.now(KST).strftime('%Y-%m-%d %H:%M KST')}) ===")
    meta = {s["ticker"]: s for s in json.load(open(MEGACAP, encoding="utf-8"))["stocks"]}
    charts = load_charts()

    rows = []          # 표본(종목·날짜별 점수와 미래 수익률)
    events = []        # 패턴 돌파 사건
    nears = []         # 돌파 임박 신호(에피소드 첫날)
    live = {}          # 오늘 기준 패턴 상태
    paths = {}         # 익절·손절 시뮬레이션용 (ticker → arrays)
    for n_i, (tk, ch) in enumerate(charts.items(), 1):
        if tk not in meta:
            continue
        o, h, l, c, v = (np.asarray(ch[k], dtype=float) for k in ("o", "h", "l", "c", "v"))
        dates = ch["dates"]
        n = len(c)
        if n < WARMUP + 70:
            continue
        # 액면분할 등으로 저가·고가가 0이거나 비정상인 봉 보정
        h = np.maximum(h, c); l = np.where(l <= 0, c, np.minimum(l, c))
        sub = ta_series(o, h, l, c, v)
        paths[tk] = (dates, h, l, c)
        fwd = {hz: np.concatenate([c[hz:] / c[:-hz] - 1, np.full(hz, np.nan)]) for hz in HORIZONS}
        fx = features(h, l, c)
        for t in range(WARMUP, n):
            rows.append((tk, dates[t], t, *(float(sub[k][t]) for k in SUB_KEYS), float(sub["score"][t]),
                         *(float(fx[k][t]) for k in FEAT_KEYS),
                         *(float(fwd[hz][t]) for hz in HORIZONS)))

        det = Detector(o, h, l, c, v)
        last_near = {}
        for t in range(WARMUP, n):
            for p in det.detect(t):
                k = p["kind"]
                if p["state"] == "breakout":
                    dry, surge = det._vol(t, p["s"])
                    tgt = p["level"] * (1 + p["height"])
                    hit = None; fail10 = None
                    if t + 60 < n:
                        hit = bool(h[t + 1:t + 61].max() >= tgt)
                        fail10 = bool(c[t + 1:t + 11].min() < p["level"] * 0.97)
                    events.append({"tk": tk, "d": dates[t], "t": t, "k": k,
                                   **{f"f{hz}": (float(fwd[hz][t]) if np.isfinite(fwd[hz][t]) else None) for hz in HORIZONS},
                                   "surge": surge, "dry": dry, "hit": hit, "fail": fail10})
                elif p["state"] == "near":
                    if t - last_near.get(k, -99) > 10:
                        brk20 = None
                        if t + 20 < n:
                            brk20 = bool(c[t + 1:t + 21].max() > p["level"] * (1 + BRK))
                        nears.append({"tk": tk, "d": dates[t], "k": k, "brk20": brk20,
                                      **{f"f{hz}": (float(fwd[hz][t]) if np.isfinite(fwd[hz][t]) else None) for hz in HORIZONS}})
                    last_near[k] = t
        # 오늘(마지막 봉) 기준 상태 + 최근 5봉 안의 돌파
        cur = []
        for t in range(n - 5, n):
            for p in det.detect(t):
                if p["state"] == "forming":
                    continue
                if p["state"] == "near" and t != n - 1:
                    continue
                dry, surge = det._vol(t, p["s"])
                cur.append(serialize(p, dates, t, n, c, dry, surge))
        if cur:
            # 같은 패턴 종류는 가장 최근 것만
            seen = {}
            for p in cur:
                seen[p["kind"]] = p
            live[tk] = sorted(seen.values(), key=lambda p: PRIORITY.index(p["kind"]))
        if n_i % 50 == 0:
            print(f"  {n_i}/{len(charts)} 처리 ({time.time() - t0:.0f}s)")

    cols = ["tk", "d", "t"] + SUB_KEYS + ["score"] + FEAT_KEYS + [f"f{hz}" for hz in HORIZONS]
    df = pd.DataFrame(rows, columns=cols)
    print(f"  표본 {len(df):,}행 · 돌파 사건 {len(events):,} · 임박 신호 {len(nears):,}")

    # 시장 대비 초과수익: 같은 날 유니버스 평균을 뺀다(시장 전체 상승·하락 효과 제거)
    for hz in HORIZONS:
        df[f"x{hz}"] = df[f"f{hz}"] - df.groupby("d")[f"f{hz}"].transform("mean")

    all_dates = sorted(df["d"].unique())
    cnt = df.groupby("d").size()
    good_dates = [d for d in all_dates if cnt[d] >= max(60, 0.4 * len(charts))]
    rebal = good_dates[::REBAL_EVERY]
    split_i = int(len(rebal) * TRAIN_FRAC)
    train_dates, test_dates = set(rebal[:split_i]), set(rebal[split_i:])
    dfr = df[df["d"].isin(set(rebal))].copy()

    result = {"updated": datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
              "universe": len(charts), "samples": int(len(df)),
              "period": [all_dates[0], all_dates[-1]], "rebal_dates": len(rebal),
              "split_date": rebal[split_i] if split_i < len(rebal) else None,
              "weights": WEIGHTS, "labels": SUB_LABEL}

    # 1) 점수 구간별
    bins = [0, 30, 40, 50, 60, 70, 80, 90, 101]
    labels = ["0-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90-100"]
    df["bin"] = pd.cut(df["score"], bins=bins, right=False, labels=labels)
    result["bins"] = []
    for lb in labels:
        g = df[df["bin"] == lb]
        rec = {"bin": lb, "n": int(len(g)), "share": round(len(g) / len(df) * 100, 1)}
        for hz in HORIZONS:
            s = stats(g[f"f{hz}"]); x = g[f"x{hz}"].dropna()
            rec[f"h{hz}"] = {**s, "excess": round(float(x.mean()) * 100, 2) if len(x) else None}
        result["bins"].append(rec)

    # 2) 상위 X% 포트폴리오 (주 1회 교체)
    def top_curve(frame, col, dates_set=None):
        out = {}
        f = frame if dates_set is None else frame[frame["d"].isin(dates_set)]
        pct_rank = f.groupby("d")[col].rank(ascending=False, pct=True, method="first")
        for p in TOP_PCTS:
            sel = f[pct_rank <= p / 100]
            rec = {}
            for hz in HORIZONS:
                port = sel.groupby("d")[f"f{hz}"].mean().dropna()
                ex = sel.groupby("d")[f"x{hz}"].mean().dropna()
                if len(port) == 0:
                    continue
                ovl = max(1, hz / REBAL_EVERY)   # 겹치는 보유기간 보정
                sharpe = float(ex.mean() / ex.std() * math.sqrt(len(ex) / ovl)) if ex.std() > 0 else 0
                rec[f"h{hz}"] = {"mean": round(float(port.mean()) * 100, 2), "excess": round(float(ex.mean()) * 100, 2),
                                 "win": round(float((sel[f"f{hz}"].dropna() > 0).mean()) * 100, 1),
                                 "beat": round(float((ex > 0).mean()) * 100, 1), "t": round(sharpe, 2)}
            rec["picks"] = round(len(sel) / max(1, sel["d"].nunique()), 1)
            out[str(p)] = rec
        return out

    result["top"] = top_curve(dfr, "score")
    result["top_train"] = top_curve(dfr, "score", train_dates)
    result["top_test"] = top_curve(dfr, "score", test_dates)

    def best_pct(curve, hz=20):
        cands = [(p, curve[str(p)][f"h{hz}"]) for p in TOP_PCTS if p != 100 and f"h{hz}" in curve[str(p)]]
        cands = [(p, r) for p, r in cands if curve[str(p)]["picks"] >= 3]   # 한 번에 최소 3종목은 되게
        if not cands:
            return None
        cands = [(p, r) for p, r in cands if r["excess"] > 0 and r["t"] > 0]   # 시장을 못 이기면 '최적 비율 없음'
        if not cands:
            return None
        return max(cands, key=lambda pr: pr[1]["excess"] * min(1.0, pr[1]["t"] / 2))[0]
    result["best_pct"] = {str(hz): best_pct(result["top"], hz) for hz in HORIZONS}

    # 기준점수 이상만 샀다면
    result["threshold"] = []
    for th in range(40, 95, 5):
        g = dfr[dfr["score"] >= th]
        rec = {"th": th, "per_week": round(len(g) / len(rebal), 1)}
        for hz in HORIZONS:
            x = g.groupby("d")[f"x{hz}"].mean().dropna()
            rec[f"h{hz}"] = {**stats(g[f"f{hz}"]), "excess": round(float(x.mean()) * 100, 2) if len(x) else None}
        result["threshold"].append(rec)

    # 3) 세부 지표별 IC (순위상관: 점수 높을수록 20일 초과수익도 높은가)
    ic = {k: [] for k in SUB_KEYS + ["score"]}
    ic_dates = []
    for d, g in dfr.groupby("d"):
        g = g.dropna(subset=["x20"])
        if len(g) < 30:
            continue
        ic_dates.append(d)
        for k in SUB_KEYS + ["score"]:
            ic[k].append(spearman(g[k].values, g["x20"].values))
    ic_df = pd.DataFrame(ic, index=ic_dates)
    ovl = 20 / REBAL_EVERY
    def ic_summary(frame):
        out = {}
        for k in SUB_KEYS + ["score"]:
            s = frame[k].dropna()
            if len(s) < 5:
                continue
            tstat = float(s.mean() / s.std() * math.sqrt(len(s) / ovl)) if s.std() > 0 else 0
            out[k] = {"ic": round(float(s.mean()), 4), "t": round(tstat, 2), "pos": round(float((s > 0).mean()) * 100, 1)}
        return out
    tr_ic = ic_df[ic_df.index.isin(train_dates)]
    te_ic = ic_df[ic_df.index.isin(test_dates)]
    result["ic"] = {"all": ic_summary(ic_df), "train": ic_summary(tr_ic), "test": ic_summary(te_ic)}

    # 학습 구간 IC로 가중치 재조정: |t|≥1.5인 지표만, IC 크기에 비례(음수면 반대로)
    trs = result["ic"]["train"]
    w_new = {}
    for k in SUB_KEYS:
        r = trs.get(k)
        w_new[k] = round(r["ic"] * 1000, 1) if r and abs(r["t"]) >= 1.5 else 0.0
    if all(abs(x) < 1e-9 for x in w_new.values()):
        w_new = dict(WEIGHTS)
    df["tuned"] = tuned_score({k: df[k].values for k in SUB_KEYS}, w_new)
    dfr["tuned"] = df.loc[dfr.index, "tuned"]
    result["tuned"] = {"weights": w_new,
                       "rule": "학습 구간(앞 60%) 세부지표 IC×1000, |t|≥1.5만 사용. 음수 = 높을수록 오히려 덜 오름",
                       "top_test": top_curve(dfr, "tuned", test_dates),
                       "top_train": top_curve(dfr, "tuned", train_dates),
                       "top": top_curve(dfr, "tuned")}
    # 검증 구간에서 새 가중치가 원래보다 나았나
    def ex_at(curve, p, hz=20):
        r = curve.get(str(p), {}).get(f"h{hz}")
        return r["excess"] if r else None
    bp = result["best_pct"]["20"] or 10     # 최적 비율이 없으면 비교용으로 상위 10%
    old_ex, new_ex = ex_at(result["top_test"], bp), ex_at(result["tuned"]["top_test"], bp)
    use_tuned = old_ex is not None and new_ex is not None and new_ex > old_ex
    result["tuned"]["verdict"] = {"pct": bp, "old_excess": old_ex, "new_excess": new_ex, "use": bool(use_tuned)}
    active = "tuned" if use_tuned else "score"
    tuned_best = best_pct(result["tuned"]["top"], 20) if use_tuned else bp

    # 연도별 안정성(원점수 상위 best%)
    result["by_year"] = []
    pr = dfr.groupby("d")["score"].rank(ascending=False, pct=True, method="first")
    sel = dfr[pr <= bp / 100]
    for yr in sorted({d[:4] for d in rebal}):
        g = sel[sel["d"].str.startswith(yr)]; u = dfr[dfr["d"].str.startswith(yr)]
        if len(g) == 0:
            continue
        result["by_year"].append({"year": yr, "top": round(float(g.groupby("d")["f20"].mean().mean()) * 100, 2),
                                  "all": round(float(u.groupby("d")["f20"].mean().mean()) * 100, 2),
                                  "excess": round(float(g.groupby("d")["x20"].mean().mean()) * 100, 2)})

    # 4) 익절·손절 조합 (원점수 상위 best%, 60거래일 안)
    result["tpsl"] = {**tpsl_grid(sel[["tk", "t"]].values, paths), "pct": bp}

    # 5) 패턴 백테스트
    ev = pd.DataFrame(events)
    nr = pd.DataFrame(nears)
    base = {f"f{hz}": stats(df[f"f{hz}"]) for hz in HORIZONS}
    result["pattern_base"] = base
    pstats = {}
    for k, info in PATTERNS.items():
        rec = {"name": info["name"], "side": info["side"]}
        g = ev[ev["k"] == k] if len(ev) else ev
        if len(g):
            for hz in HORIZONS:
                rec[f"f{hz}"] = stats(g[f"f{hz}"])
            gv = g[g["surge"].fillna(0) >= 1.3]
            rec["vol_f20"] = stats(gv["f20"]) if len(gv) else {"n": 0}
            gn = g[g["surge"].fillna(0) < 1.3]
            rec["novol_f20"] = stats(gn["f20"]) if len(gn) else {"n": 0}
            hh_ = g["hit"].dropna(); ff = g["fail"].dropna()
            rec["target_hit"] = round(float(hh_.mean()) * 100, 1) if len(hh_) else None
            rec["fail10"] = round(float(ff.mean()) * 100, 1) if len(ff) else None
            rec["events"] = int(len(g))
        gn = nr[nr["k"] == k] if len(nr) else nr
        if len(gn):
            b = gn["brk20"].dropna()
            rec["near"] = {"n": int(len(gn)), "brk20": round(float(b.mean()) * 100, 1) if len(b) else None,
                           "f20": stats(gn["f20"])}
        pstats[k] = rec
    result["patterns"] = pstats
    # 최근 돌파 사례(검증용 샘플)
    result["recent_events"] = ev.sort_values("d").tail(40).replace({np.nan: None}).to_dict("records") if len(ev) else []

    # 5-2) 전략 토너먼트: 규칙별 20일 초과수익을 학습/검증/연도별로 채점
    years = sorted({d[:4] for d in rebal})
    split_d = result["split_date"] or "9999"
    dfr["_mom_q70"] = dfr.groupby("d")["mom12_1"].transform(lambda x: x.quantile(0.7))
    if len(ev):
        ev = ev.merge(df[["tk", "d", "x20", "x60"]], on=["tk", "d"], how="left")
        ev["s_d"] = ev["d"]
    strat_out = []
    strat_picks = {}
    for st in STRATEGIES:
        if "f" in st:
            g = dfr[st["f"](dfr)]
            per = g.groupby("d")["x20"].mean().dropna()
            f20 = g["f20"]; x20 = g["x20"]; freq = round(len(g) / len(rebal), 1); unit = "주당 종목"
        else:
            if not len(ev):
                continue
            g = ev[st["event"](ev)]
            per = g.set_index("d")["x20"].dropna()
            f20 = g["f20"]; x20 = g["x20"]; freq = round(len(g) / max(1, len(rebal)), 2); unit = "주당 신호"
        if len(g) < 30:
            continue
        xtr = per[per.index < split_d]; xte = per[per.index >= split_d]
        yr = {y: (round(float(per[per.index.str.startswith(y)].mean()) * 100, 2) if (per.index.str.startswith(y)).any() else None) for y in years}
        yv = [v for v in yr.values() if v is not None]
        rec = {"id": st["id"], "name": st["name"], "desc": st["desc"], "n": int(len(g)), "freq": freq, "unit": unit,
               "f20": stats(f20), "x20": round(float(x20.mean()) * 100, 2), "beat": round(float((x20.dropna() > 0).mean()) * 100, 1),
               "x_train": round(float(xtr.mean()) * 100, 2) if len(xtr) else None,
               "x_test": round(float(xte.mean()) * 100, 2) if len(xte) else None,
               "years": yr, "pos_years": round(sum(1 for v in yv if v > 0) / max(1, len(yv)) * 100)}
        rob = min(rec["x_train"] or -9, rec["x_test"] or -9)
        rec["robust"] = round(rob, 2)
        rec["pass"] = bool(rob >= 0.15 and rec["pos_years"] >= 80)
        rec["bias"] = st.get("bias")
        strat_out.append(rec)
        # 익절·손절 격자용 표본(날짜별로 겹치지 않게 최대 4000개)
        strat_picks[st["id"]] = g[["tk", "t"]].values[:: max(1, len(g) // 4000)] if "t" in g else None
    strat_out.sort(key=lambda r: (not r["pass"], -r["robust"]))
    for rec in strat_out[:5]:
        pk = strat_picks.get(rec["id"])
        if pk is not None and len(pk):
            rec["tpsl"] = tpsl_grid(pk, paths)
    result["strategies"] = strat_out
    result["strategy_base"] = {"f20": stats(dfr["f20"]), "note": "초과수익 = 같은 날 유니버스 평균 대비"}

    last = df.sort_values("t").groupby("tk").tail(1).set_index("tk")
    maxd = last["d"].max()
    last = last[last["d"] >= (datetime.strptime(maxd, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")]
    last["rank_pct"] = last[active].rank(ascending=False, pct=True) * 100
    bin_ex = {r["bin"]: r["h20"].get("excess") for r in result["bins"]}
    today = []
    for tk, r in last.iterrows():
        today.append({"tk": tk, "score": int(r["score"]), "tuned": round(float(r["tuned"]), 1),
                      "pct": round(float(r["rank_pct"]), 1), "bin_ex20": bin_ex.get(str(r["bin"])),
                      "pick": bool(r["rank_pct"] <= (tuned_best or bp))})
    result["active"] = active
    result["active_pct"] = tuned_best or bp
    result["today"] = sorted(today, key=lambda x: x["pct"])
    # 전략별 오늘 해당 종목
    last["_mom_q70"] = last["mom12_1"].quantile(0.7)
    lv = pd.DataFrame([{"tk": tk, "k": p["kind"], "surge": p["surge"], "age": p["age"]}
                       for tk, ps in live.items() for p in ps if p["state"] == "breakout"])
    for rec in result["strategies"]:
        st = next(x for x in STRATEGIES if x["id"] == rec["id"])
        if "f" in st:
            m = last[st["f"](last).fillna(False)] if hasattr(st["f"](last), "fillna") else last[st["f"](last)]
            rec["today"] = sorted(m.index.tolist())
        else:
            rec["today"] = sorted(set(lv[st["event"](lv)]["tk"])) if len(lv) else []
    need = {x["tk"] for x in today} | {tk for r in result["strategies"] for tk in r.get("today", [])}
    result["names"] = {tk: [meta[tk].get("name", tk), meta[tk].get("sector", "")] for tk in need if tk in meta}
    result["elapsed_s"] = round(time.time() - t0)

    json.dump(clean(result), open(OUT_BT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(clean({"updated": result["updated"], "patterns": {k: {"name": v["name"], "side": v["side"], "emoji": v["emoji"]} for k, v in PATTERNS.items()},
                     "stats": {k: {"f20": pstats[k].get("f20"), "target_hit": pstats[k].get("target_hit"),
                                   "fail10": pstats[k].get("fail10"), "near": pstats[k].get("near"),
                                   "vol_f20": pstats[k].get("vol_f20")} for k in pstats},
                     "stocks": live}),
              open(OUT_PT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    nb = sum(1 for v in live.values() for p in v if p["state"] == "breakout")
    nn = sum(1 for v in live.values() for p in v if p["state"] == "near")
    print(f"  최적 상위 비율(20일): {result['best_pct']} · 사용 점수: {active} · 오늘 돌파 {nb} · 임박 {nn}")
    print(f"=== 완료 ({time.time() - t0:.0f}s) ===")

def serialize(p, dates, t, n, c, dry, surge):
    """프런트에서 캔들 위에 선을 그릴 수 있게 날짜·가격 좌표로 변환"""
    k = p["kind"]
    out = {"kind": k, "state": p["state"], "date": dates[t], "age": n - 1 - t,
           "level": round(p["level"], 4), "target": round(p["level"] * (1 + p["height"]), 4),
           "height": round(p["height"] * 100, 1), "start": dates[p["s"]],
           "dist": round((c[n - 1] / p["level"] - 1) * 100, 2), "dry": dry, "surge": surge, "lines": []}
    end = n - 1
    if k in ("asc", "sym", "desc", "rwedge", "fwedge", "box", "tline"):
        s = p["s"]
        out["lines"].append({"role": "res", "p": [[dates[s], round(math.exp(p["au"] + p["bu"] * s), 4)],
                                                   [dates[end], round(math.exp(p["au"] + p["bu"] * end), 4)]]})
        if p.get("fl") is not None:
            bl, al, _ = p["fl"]
            out["lines"].append({"role": "sup", "p": [[dates[s], round(math.exp(al + bl * s), 4)],
                                                       [dates[end], round(math.exp(al + bl * end), 4)]]})
    elif k == "dbl":
        out["lines"].append({"role": "res", "p": [[dates[p["j1"]], round(p["level"], 4)], [dates[end], round(p["level"], 4)]]})
        out["marks"] = [[dates[p["j1"]], round(p["low"], 4)], [dates[p["j2"]], round(p["low"], 4)]]
    elif k == "cup":
        out["lines"].append({"role": "res", "p": [[dates[p["jL"]], round(p["level"], 4)], [dates[end], round(p["level"], 4)]]})
        out["marks"] = [[dates[p["jB"]], round(p["bottom"], 4)]]
        out["handle_low"] = round(p["handle_low"], 4)
    elif k == "flag":
        s = p["p1"]
        out["lines"].append({"role": "res", "p": [[dates[s], round(math.exp(p["au"] + p["bu"] * s), 4)],
                                                   [dates[end], round(math.exp(p["au"] + p["bu"] * end), 4)]]})
        out["lines"].append({"role": "pole", "p": [[dates[p["p0"]], round(p["base"], 4)], [dates[p["p1"]], round(p["top"], 4)]]})
    return out

def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o

if __name__ == "__main__":
    main()
