# -*- coding: utf-8 -*-
"""
ta_learn.py — 매일 백테스트로 '기술점수' 공식을 스스로 고치는 학습기 (backtest_ta.py가 호출)

생각의 틀
- 후보 지표 17개(추세·모멘텀·되돌림·이격·고점거리·변동성·거래대금·수축·RSI·차트패턴·기존점수)를
  날마다 300종목 안에서 순위(0~100)로 바꾼다. 순위라서 시장 전체가 오르든 내리든 '상대 위치'만 본다.
- 각 지표가 '20거래일 뒤 시장 대비 초과수익'을 얼마나 맞혔는지(IC = 순위상관)를 주 단위로 쌓는다.
- 가중치 = 최근 3년 IC 평균. |t|≥1이면서 3년의 앞·뒤 절반에서 방향이 같은(꾸준한) 지표만 쓰고, 음수면 '낮을수록 좋다'로 뒤집어 쓴다.
  한 지표가 전체를 좌우하지 않게 상한을 둔다(변동성·급등일은 강세장 베타 효과라 상한을 더 낮게).
- 챔피언(지금 쓰는 공식) vs 도전자(오늘 다시 학습한 공식)를 최근 6개월 '학습에 안 쓴' 구간에서 겨룬다.
  도전자가 상위 20% 초과수익에서 0.10%p 이상 앞서고 IC도 플러스일 때만 교체한다(너무 자주 바뀌지 않게 5거래일 간격).
- 20일 뒤 결과를 알아야 채점할 수 있으므로 학습 구간과 평가 구간 사이에 4주 공백(엠바고)을 둔다.
출력: docs/ta_model.json(버전 기록·매일 채점 기록·걸어가며 검증), docs/ta_scores.json(오늘 종목별 점수)
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

TRAIN_WEEKS = 156       # 최근 3년
EMBARGO_WEEKS = 4       # 20거래일 결과가 확정될 때까지 공백
HOLDOUT_WEEKS = 26      # 챔피언·도전자 겨루는 최근 6개월
T_MIN = 1.0             # 약한 신호도 쓰되, 앞·뒤 절반에서 방향이 같아야 함
PROMOTE_MARGIN = 0.10   # %p
MIN_GAP_DAYS = 5
TOP_Q = 0.2             # 상위 20%
LEGACY = {"score": 1.0}


def add_pct(df):
    """날짜별 300종목 안 순위(0~100). 값이 없으면 중간(50)."""
    g = df.groupby("d")
    for k in FKEYS:
        df["p_" + k] = (g[k].rank(pct=True) * 100).fillna(50.0)
    return df


def ic_series(dfr):
    """주별 IC: 각 지표 순위 vs 20일 초과수익 순위"""
    out = {}
    for d, g in dfr.groupby("d"):
        g = g[g["x20"].notna()]
        if len(g) < 40:
            continue
        y = g["x20"].rank().values
        row = {}
        for k in FKEYS:
            x = g["p_" + k].values
            row[k] = float(np.corrcoef(x, y)[0, 1]) if x.std() > 0 else np.nan
        out[d] = row
    return pd.DataFrame(out).T.sort_index()


def fit(ic):
    """IC 평균을 가중치로.
    - |t| ≥ T_MIN 이고, 학습 구간 앞·뒤 절반에서 방향(부호)이 같은 지표만 쓴다(한때만 통한 지표 제외).
    - 부호 유지(음수 = 낮을수록 좋음), Σ|w|=1로 맞춘 뒤 지표별 상한을 넘는 몫은 다른 지표에 나눠 준다.
      더 받을 지표가 없으면 남는 몫은 버린다(그래도 점수는 상대 순위라 상관없음)."""
    stats, w = {}, {}
    ovl = 4.0   # 20일 결과를 매주 겹쳐 쓰므로 표본 수 보정
    for k in FKEYS:
        s = ic[k].dropna() if k in ic else pd.Series(dtype=float)
        if len(s) < 20:
            continue
        m, sd = float(s.mean()), float(s.std())
        t = m / sd * math.sqrt(len(s) / ovl) if sd > 0 else 0.0
        h = len(s) // 2
        a, b = float(s.iloc[:h].mean()), float(s.iloc[h:].mean())
        stable = a * b > 0
        stats[k] = {"ic": round(m, 4), "t": round(t, 2), "stable": bool(stable)}
        if abs(t) >= T_MIN and stable:
            w[k] = m
    if not w:
        return dict(LEGACY), stats
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
    return {k: round(x, 4) for k, x in w.items() if abs(x) >= 0.005}, stats


def raw_score(frame, w):
    r = np.zeros(len(frame))
    for k, x in w.items():
        r += x * (frame["p_" + k].values - 50)
    return r


def evaluate(frame, w, col="x20"):
    """주별로 점수 상위 20%를 샀을 때 시장 대비 수익, 점수-수익 IC"""
    if not len(frame):
        return None
    f = frame[frame[col].notna()].copy()
    f["_r"] = raw_score(f, w)
    ex, ics = [], []
    for d, g in f.groupby("d"):
        if len(g) < 40:
            continue
        cut = g["_r"].quantile(1 - TOP_Q)
        ex.append(g.loc[g["_r"] >= cut, col].mean())
        ics.append(np.corrcoef(g["_r"].rank(), g[col].rank())[0, 1])
    if not ex:
        return None
    ex = np.array(ex); ics = np.array(ics)
    return {"excess": round(float(ex.mean()) * 100, 3), "ic": round(float(np.nanmean(ics)), 4),
            "beat": round(float((ex > 0).mean()) * 100, 1), "weeks": int(len(ex))}


def describe_changes(old, new, stats):
    """가중치 변화 → 사람이 읽을 문장"""
    out = []
    keys = sorted(set(old) | set(new), key=lambda k: -abs(new.get(k, 0)))
    for k in keys:
        a, b = old.get(k, 0.0), new.get(k, 0.0)
        lab = FMETA[k]["label"]
        st = stats.get(k, {})
        why = f"IC {st.get('ic', 0):+.3f}, t {st.get('t', 0):+.1f}" if st else ""
        direction = "높을수록 좋음" if b > 0 else "낮을수록 좋음"
        if a == 0 and b != 0:
            out.append({"type": "add", "key": k, "text": f"{lab} 추가 {abs(b)*100:.0f}% ({direction}) — {why}"})
        elif a != 0 and b == 0:
            out.append({"type": "drop", "key": k, "text": f"{lab} 제외 (기존 {abs(a)*100:.0f}%) — 최근 3년 예측력이 뚜렷하지 않음" + (f" ({why})" if why else "")})
        elif a * b < 0:
            out.append({"type": "flip", "key": k, "text": f"{lab} 방향 반대로 ({direction}, {abs(b)*100:.0f}%) — {why}"})
        elif abs(b - a) >= 0.03:
            out.append({"type": "up" if abs(b) > abs(a) else "down", "key": k,
                        "text": f"{lab} {abs(a)*100:.0f}% → {abs(b)*100:.0f}% — {why}"})
    return out


def note_for(w):
    """새 공식이 무엇을 좋아하는지 한 문단"""
    likes, dislikes = [], []
    for k, x in sorted(w.items(), key=lambda kv: -abs(kv[1])):
        lab = FMETA[k]["label"]
        (likes if x > 0 else dislikes).append(lab)
    parts = []
    if likes:
        parts.append("높을수록 가점: " + ", ".join(likes[:5]))
    if dislikes:
        parts.append("낮을수록 가점(역방향): " + ", ".join(dislikes[:5]))
    return " · ".join(parts)


def run(df, rebal, today_str, meta_names):
    """backtest_ta.main()에서 호출. df: 종목·날짜별 지표와 f5/f20, x5/x20 포함"""
    # 12개월 모멘텀·52주 고점은 260거래일이 쌓여야 계산된다. 그 전 날짜를 '중간값'으로 채우면 신호가 흐려지므로 뺀다.
    df = df[df["t"] >= 260].copy()
    df = add_pct(df)
    rebal = [d for d in rebal if d >= df["d"].min()]
    dfr = df[df["d"].isin(set(rebal))]
    ic = ic_series(dfr)
    wk = list(ic.index)                                 # 결과가 확정된 주들
    labeled = [d for d in rebal if d in set(wk)]

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
    tr = labeled[max(0, tr_end - TRAIN_WEEKS):max(0, tr_end)]
    chal_w, chal_stats = fit(ic.loc[tr])
    hf = dfr[dfr["d"].isin(set(hold))]
    ev_champ = evaluate(hf, champ["weights"])
    ev_chal = evaluate(hf, chal_w)
    ev_legacy = evaluate(hf, LEGACY)
    last_date = datetime.strptime(champ["date"], "%Y-%m-%d")
    gap_ok = (datetime.strptime(today_str, "%Y-%m-%d") - last_date).days >= MIN_GAP_DAYS or champ["ver"] == 1
    same = chal_w == champ["weights"]
    better = (ev_chal and ev_champ and ev_chal["excess"] > ev_champ["excess"] + PROMOTE_MARGIN and ev_chal["ic"] > 0)
    decision, reason = "keep", ""
    if same:
        reason = "다시 학습해도 공식이 같음"
    elif not better:
        reason = (f"도전자 {ev_chal['excess']:+.2f}%p ≤ 챔피언 {ev_champ['excess']:+.2f}%p + {PROMOTE_MARGIN}" if ev_chal and ev_champ else "평가 데이터 부족")
        if ev_chal and ev_chal["ic"] <= 0 and ev_champ and ev_chal["excess"] > ev_champ["excess"] + PROMOTE_MARGIN:
            reason = "도전자 IC가 0 이하"
    elif not gap_ok:
        reason = f"직전 교체 후 {MIN_GAP_DAYS}일이 안 지남"
    else:
        decision = "promote"
        reason = f"최근 6개월(학습에 안 쓴 구간) 상위 20%: 도전자 {ev_chal['excess']:+.2f}%p vs 챔피언 {ev_champ['excess']:+.2f}%p"
    if decision == "promote":
        new = {"ver": champ["ver"] + 1, "date": today_str, "weights": chal_w,
               "train": [tr[0], tr[-1]] if tr else None, "holdout": [hold[0], hold[-1]] if hold else None,
               "eval": {"new": ev_chal, "old": ev_champ, "legacy": ev_legacy},
               "stats": chal_stats, "changes": describe_changes(champ["weights"], chal_w, chal_stats),
               "note": note_for(chal_w), "reason": reason}
        versions.append(new)
        champ = new

    daily = [x for x in (model.get("daily") or []) if x.get("date") != today_str]
    daily.append({"date": today_str, "champ_ver": champ["ver"],
                  "champ": ev_chal if decision == "promote" else ev_champ, "prev": ev_champ if decision == "promote" else None,
                  "chal": ev_chal, "legacy": ev_legacy, "decision": decision, "reason": reason,
                  "chal_weights": chal_w})
    daily = daily[-120:]

    # ── 걸어가며 검증: 과거 매달 그 시점까지 데이터로만 학습 → 다음 4주에 적용 ──
    wf = []
    start = TRAIN_WEEKS // 2 + EMBARGO_WEEKS     # 최소 1.5년 쌓인 뒤부터
    rb = list(rebal)
    pos = {d: i for i, d in enumerate(rb)}
    for i in range(start, len(rb), 4):
        cut = rb[i]
        known = [d for d in wk if pos.get(d, 1e9) <= i - EMBARGO_WEEKS]
        known = known[-TRAIN_WEEKS:]
        if len(known) < 52:
            continue
        w, _ = fit(ic.loc[known])
        for d in rb[i:i + 4]:
            g = dfr[dfr["d"] == d]
            if len(g) < 40:
                continue
            rec = {"d": d}
            for name, ww in (("learn", w), ("legacy", LEGACY)):
                r = raw_score(g, ww)
                top = g[r >= np.quantile(r, 1 - TOP_Q)]
                rec[name + "5"] = float(top["x5"].mean()) if top["x5"].notna().any() else None
                rec[name + "20"] = float(top["x20"].mean()) if top["x20"].notna().any() else None
            wf.append(rec)
    wfd = pd.DataFrame(wf)
    wf_sum = {}
    curve = []
    if len(wfd):
        for name in ("learn", "legacy"):
            s20 = wfd[name + "20"].dropna()
            wf_sum[name] = {"excess20": round(float(s20.mean()) * 100, 3), "beat": round(float((s20 > 0).mean()) * 100, 1), "weeks": int(len(s20))}
        cl = cg = 0.0
        for _, r in wfd.iterrows():   # 매주 5일 보유 초과수익을 누적(겹치지 않음)
            if r["learn5"] is not None and not pd.isna(r["learn5"]):
                cl += r["learn5"] * 100
            if r["legacy5"] is not None and not pd.isna(r["legacy5"]):
                cg += r["legacy5"] * 100
            curve.append([r["d"], round(cl, 2), round(cg, 2)])

    # ── 오늘 점수 ──
    last = df.sort_values("t").groupby("tk").tail(1)
    maxd = last["d"].max()
    last = last[last["d"] >= (pd.Timestamp(maxd) - pd.Timedelta(days=7)).strftime("%Y-%m-%d")].copy()
    # 오늘 순위는 오늘 모인 종목끼리 다시 매김(시장마다 마지막 날짜가 달라서)
    for k in FKEYS:
        last["p_" + k] = (last[k].rank(pct=True) * 100).fillna(50.0)
    w = champ["weights"]
    last["_r"] = raw_score(last, w)
    last["_s"] = (last["_r"].rank(pct=True) * 100).round()
    stocks = {}
    for _, r in last.iterrows():
        stocks[r["tk"]] = {"s": int(r["_s"]), "legacy": int(r["score"]),
                           "p": {k: int(round(r["p_" + k])) for k in w}}
    top = last.sort_values("_s", ascending=False).head(20)
    ic_all = {k: v for k, v in fit(ic.loc[labeled[-TRAIN_WEEKS:]])[1].items()}

    model_out = {"updated": today_str, "current": champ["ver"], "features": [{"key": k, **FMETA[k]} for k in FKEYS],
                 "rules": {"train_weeks": TRAIN_WEEKS, "embargo_weeks": EMBARGO_WEEKS, "holdout_weeks": HOLDOUT_WEEKS,
                           "t_min": T_MIN, "margin": PROMOTE_MARGIN, "min_gap_days": MIN_GAP_DAYS, "top_q": TOP_Q},
                 "versions": versions, "daily": daily, "walk": {"summary": wf_sum, "curve": curve},
                 "ic_recent": ic_all,
                 "top_today": [{"tk": r["tk"], "name": meta_names.get(r["tk"], [r["tk"]])[0], "s": int(r["_s"]),
                                "p": {k: int(round(r["p_" + k])) for k in w}} for _, r in top.iterrows()]}
    json.dump(_clean(model_out), open(OUT_MODEL, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump(_clean({"ver": champ["ver"], "date": champ["date"], "updated": today_str,
                      "features": [{"key": k, "label": FMETA[k]["label"], "desc": FMETA[k]["desc"], "w": w[k]} for k in sorted(w, key=lambda k: -abs(w[k]))],
                      "stocks": stocks}),
              open(OUT_SCORES, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return {"decision": decision, "reason": reason, "ver": champ["ver"], "weights": w, "walk": wf_sum,
            "champ": ev_champ, "chal": ev_chal}


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
