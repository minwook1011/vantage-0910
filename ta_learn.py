# -*- coding: utf-8 -*-
"""
ta_learn.py — 매일 백테스트로 '기술점수' 공식을 스스로 고치는 학습기 (backtest_ta.py가 호출)

생각의 틀
- 후보 지표 17개(추세·모멘텀·되돌림·이격·고점거리·변동성·거래대금·수축·RSI·차트패턴·기존점수)를
  날마다 300종목 안에서 순위(0~100)로 바꾼다. 순위라서 시장 전체가 오르든 내리든 '상대 위치'만 본다.
- 시장 국면을 셋으로 나눈다: 300종목 동일가중 지수의 최근 40거래일(약 2개월) 수익률이
  +3% 이상 = 상승장, −3% 이하 = 하락장, 그 사이 = 횡보장. (그날까지의 지수만 쓰므로 미래 정보 없음)
- 각 지표가 1D·1W·1M(1·5·20거래일) 뒤 '시장 대비 초과수익'을 얼마나 맞혔는지(IC = 순위상관)를 주 단위로 쌓고,
  세 기간 IC의 평균을 학습 신호로 쓴다(단기·중기 어느 한쪽에만 맞춘 공식이 되지 않게).
- 가중치 = 국면별 IC 평균(최근 7년 — 하락장이 드물어 3년으로는 표본이 없다). 국면 표본이 적으면 전체 평균 쪽으로 당겨서(수축 추정, K=26주) 과적합을 막는다.
  |t|≥1이면서 앞·뒤 절반에서 방향이 같은 지표만 쓰고, 음수면 '낮을수록 좋다'로 뒤집어 쓴다. 지표별 상한이 있다.
- 챔피언(지금 쓰는 공식) vs 도전자(오늘 다시 학습한 공식)를 최근 6개월 '학습에 안 쓴' 구간에서 겨룬다.
  채점 = 점수 상위 20%의 1D·1W·1M 초과수익을 한 달 기준으로 환산해 평균(1D×20, 1W×4, 1M×1).
  도전자가 0.10%p 이상 앞서고 평균 IC도 플러스일 때만 교체한다(너무 자주 바뀌지 않게 5거래일 간격).
- 20일 뒤 결과를 알아야 채점할 수 있으므로 학습 구간과 평가 구간 사이에 4주 공백(엠바고)을 둔다.
- 매일 '최근 60거래일 실제 성적'도 남긴다: 그날 공식으로 뽑은 상위 20%가 1D·1W·1M 뒤 시장을 이겼나.
출력: docs/ta_model.json(버전 기록·매일 채점·국면·걸어가며 검증), docs/ta_scores.json(오늘 종목별 점수)
"""
import json
import math
import os
from datetime import datetime

import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.abspath(__file__))
OUT_MODEL = os.path.join(BASE, "docs", "ta_model.json")
OUT_SCORES = os.path.join(BASE, "docs", "ta_scores.json")

# key, 이름, 설명, 가중치 상한
FEATURES = [
    ("ma200", "200일선 위 거리", "종가 ÷ 200일 이동평균", 0.25),
    ("ma50_200", "중기 정배열", "50일선 ÷ 200일선", 0.25),
    ("mom12_1", "12개월 모멘텀", "최근 1개월을 뺀 12개월 수익률", 0.25),
    ("mom6_1", "6개월 모멘텀", "최근 1개월을 뺀 6개월 수익률", 0.25),
    ("r1m", "1개월 수익률", "최근 21거래일 수익률", 0.25),
    ("r1w", "1주 수익률", "최근 5거래일 수익률", 0.25),
    ("gap20", "20일선 이격", "종가 ÷ 20일 이동평균", 0.25),
    ("hi52", "52주 고점 근접", "종가 ÷ 52주 최고가", 0.25),
    ("vol20", "변동성", "최근 20일 일간 수익률 표준편차", 0.15),
    ("dvol", "거래대금 증가", "5일 평균 거래대금 ÷ 60일 평균", 0.25),
    ("contr", "변동폭 수축", "최근 20일 고저폭 ÷ 60일 고저폭", 0.25),
    ("maxret", "최근 급등일", "최근 21일 중 가장 크게 오른 하루", 0.15),
    ("updays", "상승일 비율", "최근 20일 중 오른 날 비율", 0.25),
    ("rsi14", "RSI(14)", "14일 상대강도지수", 0.25),
    ("pat_brk", "패턴 돌파+거래량", "최근 5일 안에 상승형 차트 패턴을 거래량 1.3배 이상으로 돌파", 0.25),
    ("pat_near", "패턴 돌파 임박", "상승형 차트 패턴의 저항선 3% 이내", 0.25),
    ("score", "기존 기술점수(v1)", "이평선·거래량·RSI·MACD 등 8개 지표 가중합", 0.25),
]
FKEYS = [f[0] for f in FEATURES]
FMETA = {f[0]: {"label": f[1], "desc": f[2], "cap": f[3]} for f in FEATURES}


TRAIN_WEEKS = 156       # 국면 구분 없는 공식: 최근 3년
TRAIN_WEEKS_RG = 364    # 국면별 공식: 최근 7년(하락장이 드물어 3년으로는 표본이 없다. 5년은 공식이 한 지표로 쏠려 불안정)
EMBARGO_WEEKS = 4       # 20거래일 결과가 확정될 때까지 공백
HOLDOUT_WEEKS = 26      # 챔피언·도전자 겨루는 최근 6개월
T_MIN = 1.0             # 약한 신호도 쓰되, 앞·뒤 절반에서 방향이 같아야 함
T_MIN_RG = 1.5          # 전체로는 약해도 그 국면에서만 뚜렷하면(|t|≥1.5) 그 국면 공식에 넣는다
SHRINK_K = 26           # 국면 IC를 전체 IC 쪽으로 당기는 강도(주)
PROMOTE_MARGIN = 0.10   # %p (월 환산 종합 초과수익)
MIN_GAP_DAYS = 5
TOP_Q = 0.2             # 상위 20%
LEGACY = {"score": 1.0}
HZS = [1, 5, 20]        # 1D·1W·1M
HZ_LABEL = {1: "1D", 5: "1W", 20: "1M"}
HZ_TO_MONTH = {1: 20, 5: 4, 20: 1}
RGS = ["bull", "side", "bear"]
RG_LABEL = {"bull": "상승장", "side": "횡보장", "bear": "하락장"}
RG_WIN = 40             # 국면 판정 기간(거래일)
RG_TH = 0.03            # ±3%


# ───────────────────────── 시장 국면 ─────────────────────────
def market_regime(charts, win=RG_WIN, th=RG_TH):
    """300종목 동일가중 지수 → 날짜별 국면. 그날 종가까지의 지수만 쓴다."""
    rets = {}
    for tk, ch in charts.items():
        s = pd.Series(ch["c"], index=ch["dates"], dtype=float)
        s = s[s > 0]
        rets[tk] = s.pct_change()
    df = pd.DataFrame(rets).sort_index()
    cnt = df.notna().sum(axis=1)
    df = df[cnt >= max(30, 0.4 * len(charts))]
    m = df.clip(-0.5, 0.5).mean(axis=1).fillna(0)
    lvl = (1 + m).cumprod() * 100
    r = lvl / lvl.shift(win) - 1
    rg = pd.Series(np.where(r >= th, "bull", np.where(r <= -th, "bear", "side")), index=lvl.index)
    rg[r.isna()] = "side"
    by_date = rg.to_dict()
    # 시장마다 휴장일이 달라 지수에 없는 날짜는 직전 국면을 쓴다(backtest 쪽에서 ffill)
    hist = [[d, round(float(lvl[d]), 2), rg[d], (round(float(r[d]) * 100, 2) if np.isfinite(r[d]) else None)]
            for d in lvl.index[::5]]
    if hist and hist[-1][0] != lvl.index[-1]:
        d = lvl.index[-1]
        hist.append([d, round(float(lvl[d]), 2), rg[d], round(float(r[d]) * 100, 2)])
    runs, cur = [], None           # 최근 국면 구간(시작일·길이)
    for d, g in rg.items():
        if cur and cur["rg"] == g:
            cur["end"] = d; cur["days"] += 1
        else:
            cur = {"rg": g, "start": d, "end": d, "days": 1}; runs.append(cur)
    return {"by_date": by_date, "today": rg.iloc[-1], "today_date": lvl.index[-1],
            "r": round(float(r.iloc[-1]) * 100, 2), "since": runs[-1]["start"] if runs else None,
            "counts": {k: int((rg == k).sum()) for k in RGS}, "hist": hist, "runs": runs[-12:],
            "rule": f"300종목 동일가중 지수의 최근 {win}거래일 수익률 +{th*100:.0f}% 이상 = 상승장, −{th*100:.0f}% 이하 = 하락장, 그 사이 = 횡보장"}


def is_rg(model):
    return isinstance(model, dict) and "bull" in model and isinstance(model.get("bull"), dict)


def pick(model, rg):
    if is_rg(model):
        return model.get(rg) or model.get("side") or {}
    return model


# ───────────────────────── IC ─────────────────────────
def add_pct(df):
    """날짜별 300종목 안 순위(0~100). 값이 없으면 중간(50)."""
    g = df.groupby("d")
    for k in FKEYS:
        df["p_" + k] = (g[k].rank(pct=True) * 100).fillna(50.0)
    return df


def ic_series(dfr):
    """주별 IC: 각 지표 순위 vs 1D·1W·1M 초과수익 순위. {hz: DataFrame(주×지표)} + 세 기간 평균"""
    out = {hz: {} for hz in HZS}
    for d, g in dfr.groupby("d"):
        g = g[g["x20"].notna()]
        if len(g) < 40:
            continue
        for hz in HZS:
            gg = g[g[f"x{hz}"].notna()]
            if len(gg) < 40:
                continue
            y = gg[f"x{hz}"].rank().values
            row = {}
            for k in FKEYS:
                x = gg["p_" + k].values
                row[k] = float(np.corrcoef(x, y)[0, 1]) if x.std() > 0 else np.nan
            out[hz][d] = row
    frames = {hz: pd.DataFrame(v).T.sort_index() for hz, v in out.items()}
    idx = frames[20].index
    blend = sum(frames[hz].reindex(idx) for hz in HZS) / len(HZS)
    return blend, frames


def _tstat(s, ovl):
    sd = float(s.std())
    return float(s.mean()) / sd * math.sqrt(len(s) / ovl) if sd > 0 and len(s) > 1 else 0.0


def _normalize(w):
    if not w:
        return {}
    tot = sum(abs(x) for x in w.values())
    w = {k: x / tot for k, x in w.items()}
    for _ in range(20):
        over = [k for k in w if abs(w[k]) > FMETA[k]["cap"] + 1e-9]
        if not over:
            break
        extra = sum(abs(w[k]) - FMETA[k]["cap"] for k in over)
        for k in over:
            w[k] = math.copysign(FMETA[k]["cap"], w[k])
        free = [k for k in w if abs(w[k]) < FMETA[k]["cap"] - 1e-9]
        if not free:
            break
        ft = sum(abs(w[k]) for k in free)
        for k in free:
            w[k] += math.copysign(extra * abs(w[k]) / ft, w[k])
    return {k: round(x, 4) for k, x in w.items() if abs(x) >= 0.005}


OVL = 2.0   # 1D·1W·1M 평균 IC를 매주 쌓으므로(1M만 4주 겹침) 표본 수 보정


def fit(ic):
    """국면 구분 없는 공식: IC 평균을 가중치로.
    - |t| ≥ T_MIN 이고, 학습 구간 앞·뒤 절반에서 방향(부호)이 같은 지표만 쓴다(한때만 통한 지표 제외).
    - 부호 유지(음수 = 낮을수록 좋음), Σ|w|=1로 맞춘 뒤 지표별 상한을 넘는 몫은 다른 지표에 나눠 준다."""
    stats, w = {}, {}
    for k in FKEYS:
        s = ic[k].dropna() if k in ic else pd.Series(dtype=float)
        if len(s) < 20:
            continue
        m, t = float(s.mean()), _tstat(s, OVL)
        h = len(s) // 2
        stable = float(s.iloc[:h].mean()) * float(s.iloc[h:].mean()) > 0
        stats[k] = {"ic": round(m, 4), "t": round(t, 2), "stable": bool(stable), "n": int(len(s))}
        if abs(t) >= T_MIN and stable:
            w[k] = m
    if not w:
        return dict(LEGACY), stats
    return _normalize(w), stats


def fit_regime(ic, rg_of_week):
    """국면별 공식 {bull, side, bear}. 국면 IC는 표본 수에 따라 전체 IC 쪽으로 당긴다:
       m = (n·m_국면 + K·m_전체) / (n + K).
       전체에서 통하는 지표(방향 같을 때) + 그 국면에서만 뚜렷한 지표(|t|≥1.5, 앞·뒤 방향 같음)를 쓴다."""
    w_all, st_all = fit(ic)
    model, stats = {}, {"all": st_all}
    rg = pd.Series(rg_of_week).reindex(ic.index).fillna("side")
    for R in RGS:
        sub = ic[rg == R]
        st, w = {}, {}
        for k in FKEYS:
            s = sub[k].dropna() if k in sub else pd.Series(dtype=float)
            a = st_all.get(k)
            n = len(s)
            if n < 8 or a is None:
                if a and k in w_all:
                    w[k] = a["ic"]
                continue
            m_r, t_r = float(s.mean()), _tstat(s, OVL)
            h = n // 2
            stable_r = n >= 16 and float(s.iloc[:h].mean()) * float(s.iloc[h:].mean()) > 0
            m = (n * m_r + SHRINK_K * a["ic"]) / (n + SHRINK_K)
            st[k] = {"ic": round(m_r, 4), "t": round(t_r, 2), "n": int(n), "shrunk": round(m, 4), "stable": bool(stable_r)}
            # 전체에서 통하는 지표라도 이 국면에서 반대로 뚜렷하면(|t|≥1, 부호 반대) 이 국면 공식에서는 뺀다
            glob = k in w_all and m * a["ic"] > 0 and not (m_r * a["ic"] < 0 and abs(t_r) >= 1.0)
            local = abs(t_r) >= T_MIN_RG and stable_r and m * m_r > 0
            if glob or local:
                w[k] = m
        model[R] = _normalize(w) or dict(w_all)
        stats[R] = st
    return model, stats


# ───────────────────────── 점수·채점 ─────────────────────────
def raw_score(frame, w):
    r = np.zeros(len(frame))
    for k, x in w.items():
        r += x * (frame["p_" + k].values - 50)
    return r


def evaluate(frame, model):
    """주별로 점수 상위 20%를 샀을 때 1D·1W·1M 시장 대비 수익과 IC. model은 평면 공식 또는 국면별 공식."""
    if not len(frame):
        return None
    f = frame[frame["x20"].notna()]
    acc = {hz: {"ex": [], "ic": []} for hz in HZS}
    by_rg = {R: [] for R in RGS}
    for d, g in f.groupby("d"):
        if len(g) < 40:
            continue
        R = g["rg"].iloc[0]
        r = raw_score(g, pick(model, R))
        cut = np.quantile(r, 1 - TOP_Q)
        top = g[r >= cut]
        for hz in HZS:
            col = f"x{hz}"
            acc[hz]["ex"].append(top[col].mean())
            acc[hz]["ic"].append(np.corrcoef(pd.Series(r).rank().values, g[col].rank().values)[0, 1])
        by_rg[R].append(top["x20"].mean())
    if not acc[20]["ex"]:
        return None
    h = {}
    for hz in HZS:
        ex = np.array(acc[hz]["ex"], dtype=float); ics = np.array(acc[hz]["ic"], dtype=float)
        h[str(hz)] = {"excess": round(float(np.nanmean(ex)) * 100, 3), "ic": round(float(np.nanmean(ics)), 4),
                      "beat": round(float((ex[np.isfinite(ex)] > 0).mean()) * 100, 1)}
    comp = float(np.mean([h[str(hz)]["excess"] * HZ_TO_MONTH[hz] for hz in HZS]))
    ic_avg = float(np.mean([h[str(hz)]["ic"] for hz in HZS]))
    return {"excess": h["20"]["excess"], "ic": h["20"]["ic"], "beat": h["20"]["beat"], "weeks": len(acc[20]["ex"]),
            "h": h, "comp": round(comp, 3), "ic_avg": round(ic_avg, 4),
            "by_rg": {R: {"excess": round(float(np.nanmean(v)) * 100, 3), "weeks": len(v)} for R, v in by_rg.items() if v}}


def recent_realized(df, model, dates, rg_by_date):
    """최근 거래일마다(매일) 그날 공식으로 뽑은 상위 20%가 1D·1W·1M 뒤 시장을 이겼나 — 학습에 안 쓴 구간의 실제 성적"""
    rows = []
    for d in dates:
        g = df[df["d"] == d]
        if len(g) < 40:
            continue
        R = rg_by_date.get(d, "side")
        r = raw_score(g, pick(model, R))
        top = g[r >= np.quantile(r, 1 - TOP_Q)]
        lr = raw_score(g, LEGACY)
        ltop = g[lr >= np.quantile(lr, 1 - TOP_Q)]
        rec = [d, R]
        for hz in HZS:
            v = top[f"x{hz}"].dropna()
            rec.append(round(float(v.mean()) * 100, 2) if len(v) > 5 else None)
        lv = ltop["x20"].dropna()
        rec.append(round(float(lv.mean()) * 100, 2) if len(lv) > 5 else None)
        rows.append(rec)
    summ = {}
    for i, hz in enumerate(HZS):
        vals = np.array([r[2 + i] for r in rows if r[2 + i] is not None], dtype=float)
        if len(vals):
            summ[str(hz)] = {"excess": round(float(vals.mean()), 3), "beat": round(float((vals > 0).mean()) * 100, 1), "days": int(len(vals))}
    return {"rows": rows, "summary": summ}


# ───────────────────────── 설명 ─────────────────────────
def _diff(old, new, stats, prefix=""):
    out = []
    keys = sorted(set(old) | set(new), key=lambda k: -abs(new.get(k, 0)))
    for k in keys:
        a, b = old.get(k, 0.0), new.get(k, 0.0)
        lab = prefix + FMETA[k]["label"]
        st = stats.get(k, {})
        why = f"IC {st.get('ic', 0):+.3f}, t {st.get('t', 0):+.1f}" if st else ""
        direction = "높을수록 좋음" if b > 0 else "낮을수록 좋음"
        if a == 0 and b != 0:
            out.append({"type": "add", "key": k, "text": f"{lab} 추가 {abs(b)*100:.0f}% ({direction}) — {why}"})
        elif a != 0 and b == 0:
            out.append({"type": "drop", "key": k, "text": f"{lab} 제외 (기존 {abs(a)*100:.0f}%) — 예측력이 뚜렷하지 않음" + (f" ({why})" if why else "")})
        elif a * b < 0:
            out.append({"type": "flip", "key": k, "text": f"{lab} 방향 반대로 ({direction}, {abs(b)*100:.0f}%) — {why}"})
        elif abs(b - a) >= 0.03:
            out.append({"type": "up" if abs(b) > abs(a) else "down", "key": k,
                        "text": f"{lab} {abs(a)*100:.0f}% → {abs(b)*100:.0f}% — {why}"})
    return out


def describe_changes(old, new, stats):
    """가중치 변화 → 사람이 읽을 문장. 국면별 공식이면 국면마다 비교"""
    if not is_rg(new):
        return _diff(old if not is_rg(old) else old.get("side", {}), new, stats.get("all", stats))
    out = []
    for R in RGS:
        o = pick(old, R)
        out += _diff(o, new[R], stats.get(R, {}), f"[{RG_LABEL[R]}] ")
    return out


def _likes(w):
    likes, dislikes = [], []
    for k, x in sorted(w.items(), key=lambda kv: -abs(kv[1])):
        (likes if x > 0 else dislikes).append(FMETA[k]["label"])
    parts = []
    if likes:
        parts.append("가점: " + ", ".join(likes[:5]))
    if dislikes:
        parts.append("역방향: " + ", ".join(dislikes[:4]))
    return " · ".join(parts)


def note_for(model):
    if not is_rg(model):
        return _likes(model)
    return " / ".join(f"{RG_LABEL[R]} — {_likes(model[R])}" for R in RGS)


# ───────────────────────── 메인 ─────────────────────────
def run(df, rebal, today_str, meta_names, regime):
    """backtest_ta.main()에서 호출. df: 종목·날짜별 지표와 f1/f5/f20, x1/x5/x20 포함. regime: market_regime() 결과"""
    # 12개월 모멘텀·52주 고점은 260거래일이 쌓여야 계산된다. 그 전 날짜를 '중간값'으로 채우면 신호가 흐려지므로 뺀다.
    df = df[df["t"] >= 260].copy()
    rg_map = pd.Series(regime["by_date"])
    all_d = sorted(set(df["d"]) | set(rg_map.index))
    rg_by_date = rg_map.reindex(all_d).ffill().fillna("side").to_dict()
    df["rg"] = df["d"].map(rg_by_date).fillna("side")
    df = add_pct(df)
    rebal = [d for d in rebal if d >= df["d"].min()]
    dfr = df[df["d"].isin(set(rebal))]
    ic, ic_h = ic_series(dfr)
    wk = list(ic.index)                                 # 1M 결과까지 확정된 주들
    labeled = [d for d in rebal if d in set(wk)]
    rg_week = {d: rg_by_date.get(d, "side") for d in wk}

    model = {}
    if os.path.exists(OUT_MODEL):
        try:
            model = json.load(open(OUT_MODEL, encoding="utf-8"))
        except Exception:
            model = {}
    versions = model.get("versions") or []
    if not versions:
        versions = [{"ver": 1, "date": today_str, "weights": dict(LEGACY),
                     "changes": [{"type": "add", "key": "score", "text": "출발점: 기존 8개 지표 가중합 점수를 그대로 사용"}],
                     "note": "이평선 정배열 24 · 거래량 18 · 이격도 14 · RSI 10 · MACD 10 · 볼린저 6 · 일목 8 · 삼각수렴 10 (사람이 정한 가중치)"}]
    champ = versions[-1]

    # ── 챔피언 vs 도전자 ──
    hold = labeled[-HOLDOUT_WEEKS:]
    tr_end = len(labeled) - HOLDOUT_WEEKS - EMBARGO_WEEKS
    tr = labeled[max(0, tr_end - TRAIN_WEEKS_RG):max(0, tr_end)]
    chal_w, chal_stats = fit_regime(ic.loc[tr], rg_week)
    flat_w, _ = fit(ic.loc[tr[-TRAIN_WEEKS:]])
    hf = dfr[dfr["d"].isin(set(hold))]
    ev_champ = evaluate(hf, champ["weights"])
    ev_chal = evaluate(hf, chal_w)
    ev_flat = evaluate(hf, flat_w)
    ev_legacy = evaluate(hf, LEGACY)
    last_date = datetime.strptime(champ["date"], "%Y-%m-%d")
    gap_ok = (datetime.strptime(today_str, "%Y-%m-%d") - last_date).days >= MIN_GAP_DAYS or champ["ver"] == 1
    same = chal_w == champ["weights"]
    structural = not is_rg(champ["weights"])    # 국면 구분 없는 옛 공식 → 국면별 공식으로 구조 전환(한 번)
    better = (ev_chal and ev_champ and ev_chal["comp"] > ev_champ["comp"] + PROMOTE_MARGIN and ev_chal["ic_avg"] > 0)
    decision, reason = "keep", ""
    if same:
        reason = "다시 학습해도 공식이 같음"
    elif structural and ev_chal:
        decision = "promote"
        reason = (f"국면별(상승·횡보·하락) 공식으로 구조 전환 — 최근 6개월 상위 20% 월 환산 초과수익: "
                  f"새 공식 {ev_chal['comp']:+.2f}%p vs 기존 {ev_champ['comp']:+.2f}%p" if ev_champ else "국면별 공식으로 구조 전환")
    elif not better:
        reason = (f"도전자 {ev_chal['comp']:+.2f}%p ≤ 챔피언 {ev_champ['comp']:+.2f}%p + {PROMOTE_MARGIN} (1D·1W·1M 월 환산)" if ev_chal and ev_champ else "평가 데이터 부족")
        if ev_chal and ev_champ and ev_chal["ic_avg"] <= 0 and ev_chal["comp"] > ev_champ["comp"] + PROMOTE_MARGIN:
            reason = "도전자 평균 IC가 0 이하"
    elif not gap_ok:
        reason = f"직전 교체 후 {MIN_GAP_DAYS}일이 안 지남"
    else:
        decision = "promote"
        reason = f"최근 6개월(학습에 안 쓴 구간) 상위 20% 월 환산 초과수익: 도전자 {ev_chal['comp']:+.2f}%p vs 챔피언 {ev_champ['comp']:+.2f}%p"
    if decision == "promote":
        new = {"ver": champ["ver"] + 1, "date": today_str, "weights": chal_w,
               "train": [tr[0], tr[-1]] if tr else None, "holdout": [hold[0], hold[-1]] if hold else None,
               "eval": {"new": ev_chal, "old": ev_champ, "legacy": ev_legacy, "flat": ev_flat},
               "stats": chal_stats, "changes": describe_changes(champ["weights"], chal_w, chal_stats),
               "note": note_for(chal_w), "reason": reason}
        versions.append(new)
        champ = new

    daily = [x for x in (model.get("daily") or []) if x.get("date") != today_str]
    daily.append({"date": today_str, "champ_ver": champ["ver"], "regime": regime["today"],
                  "champ": ev_chal if decision == "promote" else ev_champ, "prev": ev_champ if decision == "promote" else None,
                  "chal": ev_chal, "flat": ev_flat, "legacy": ev_legacy, "decision": decision, "reason": reason,
                  "chal_weights": chal_w})
    daily = daily[-120:]

    # ── 걸어가며 검증: 과거 매달 그 시점까지 데이터로만 학습 → 다음 4주에 적용 ──
    wf = []
    start = TRAIN_WEEKS // 2 + EMBARGO_WEEKS     # 최소 1.5년 쌓인 뒤부터
    rb = list(rebal)
    pos = {d: i for i, d in enumerate(rb)}
    for i in range(start, len(rb), 4):
        known = [d for d in wk if pos.get(d, 1e9) <= i - EMBARGO_WEEKS]
        known = known[-TRAIN_WEEKS_RG:]
        if len(known) < 52:
            continue
        w_rg, _ = fit_regime(ic.loc[known], rg_week)
        w_fl, _ = fit(ic.loc[known[-TRAIN_WEEKS:]])
        for d in rb[i:i + 4]:
            g = dfr[dfr["d"] == d]
            if len(g) < 40:
                continue
            R = rg_by_date.get(d, "side")
            rec = {"d": d, "rg": R}
            for name, ww in (("learn", pick(w_rg, R)), ("flat", w_fl), ("legacy", LEGACY)):
                r = raw_score(g, ww)
                top = g[r >= np.quantile(r, 1 - TOP_Q)]
                for hz in (1, 5, 20):
                    rec[f"{name}{hz}"] = float(top[f"x{hz}"].mean()) if top[f"x{hz}"].notna().any() else None
            wf.append(rec)
    wfd = pd.DataFrame(wf)
    wf_sum, curve, wf_rg = {}, [], {}
    if len(wfd):
        for name in ("learn", "flat", "legacy"):
            s20 = wfd[name + "20"].dropna()
            wf_sum[name] = {"excess20": round(float(s20.mean()) * 100, 3), "beat": round(float((s20 > 0).mean()) * 100, 1), "weeks": int(len(s20)),
                            "excess5": round(float(wfd[name + "5"].dropna().mean()) * 100, 3),
                            "excess1": round(float(wfd[name + "1"].dropna().mean()) * 100, 3)}
        for R in RGS:
            g = wfd[wfd["rg"] == R]
            if len(g):
                wf_rg[R] = {name: round(float(g[name + "20"].dropna().mean()) * 100, 3) for name in ("learn", "flat", "legacy")}
                wf_rg[R]["weeks"] = int(len(g))
        cl = cf = cg = 0.0
        for _, r in wfd.iterrows():   # 매주 5일 보유 초과수익을 누적(겹치지 않음)
            for nm in ("learn", "flat", "legacy"):
                v = r[nm + "5"]
                if v is not None and not pd.isna(v):
                    if nm == "learn": cl += v * 100
                    elif nm == "flat": cf += v * 100
                    else: cg += v * 100
            curve.append([r["d"], round(cl, 2), round(cg, 2), round(cf, 2), r["rg"]])

    # ── 최근 60거래일 실제 성적(매일) ──
    good = df.groupby("d").size()
    recent_days = [d for d in sorted(good.index) if good[d] >= 60][-60:]
    realized = recent_realized(df, champ["weights"], recent_days, rg_by_date)

    # ── 오늘 점수 ──
    today_rg = regime["today"]
    last = df.sort_values("t").groupby("tk").tail(1)
    maxd = last["d"].max()
    last = last[last["d"] >= (pd.Timestamp(maxd) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")].copy()
    # 오늘 순위는 오늘 모인 종목끼리 다시 매김(시장마다 마지막 날짜가 달라서)
    for k in FKEYS:
        last["p_" + k] = (last[k].rank(pct=True) * 100).fillna(50.0)
    w = pick(champ["weights"], today_rg)
    last["_r"] = raw_score(last, w)
    last["_s"] = (last["_r"].rank(pct=True) * 100).round()
    stocks = {}
    for _, r in last.iterrows():
        stocks[r["tk"]] = {"s": int(r["_s"]), "legacy": int(r["score"]),
                           "p": {k: int(round(r["p_" + k])) for k in w}}
    top = last.sort_values("_s", ascending=False).head(20)
    _, ic_stats = fit_regime(ic.loc[labeled[-TRAIN_WEEKS_RG:]], rg_week)
    ic_by_h = {}
    for hz in HZS:
        f = ic_h[hz].reindex(labeled[-TRAIN_WEEKS_RG:])
        ic_by_h[str(hz)] = {k: round(float(f[k].mean()), 4) for k in FKEYS if k in f and f[k].notna().any()}

    reg_out = {k: v for k, v in regime.items() if k != "by_date"}
    model_out = {"updated": today_str, "current": champ["ver"], "features": [{"key": k, **FMETA[k]} for k in FKEYS],
                 "rules": {"train_weeks": TRAIN_WEEKS, "train_weeks_rg": TRAIN_WEEKS_RG, "embargo_weeks": EMBARGO_WEEKS, "holdout_weeks": HOLDOUT_WEEKS,
                           "t_min": T_MIN, "t_min_rg": T_MIN_RG, "shrink_k": SHRINK_K, "margin": PROMOTE_MARGIN,
                           "min_gap_days": MIN_GAP_DAYS, "top_q": TOP_Q, "horizons": HZS, "to_month": HZ_TO_MONTH},
                 "regime": reg_out, "regime_label": RG_LABEL,
                 "versions": versions, "daily": daily, "walk": {"summary": wf_sum, "curve": curve, "by_regime": wf_rg},
                 "realized": realized, "ic_recent": ic_stats, "ic_by_h": ic_by_h,
                 "top_today": [{"tk": r["tk"], "name": meta_names.get(r["tk"], [r["tk"]])[0], "s": int(r["_s"]),
                                "p": {k: int(round(r["p_" + k])) for k in w}} for _, r in top.iterrows()]}
    json.dump(_clean(model_out), open(OUT_MODEL, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(_clean({"ver": champ["ver"], "date": champ["date"], "updated": today_str,
                      "regime": today_rg, "regime_label": RG_LABEL[today_rg], "regime_r": regime["r"], "regime_since": regime["since"],
                      "features": [{"key": k, "label": FMETA[k]["label"], "desc": FMETA[k]["desc"], "w": w[k]} for k in sorted(w, key=lambda k: -abs(w[k]))],
                      "stocks": stocks}),
              open(OUT_SCORES, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return {"decision": decision, "reason": reason, "ver": champ["ver"], "weights": champ["weights"], "walk": wf_sum,
            "walk_rg": wf_rg, "champ": ev_champ, "chal": ev_chal, "flat": ev_flat, "regime": f"{RG_LABEL[today_rg]} ({regime['r']:+.1f}%, {regime['since']}~)",
            "realized": realized["summary"]}


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o
