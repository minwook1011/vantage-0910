#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tg_charts.py — 텔레그램으로 보낼 그래프 이미지(PNG) 그리기 (tg_notify.py 가 부른다)

사이트와 같은 밝은 색감(흰 바탕·진한 글자·연한 격자)과 검증된 팔레트를 쓴다.
한글 글꼴: GitHub(우분투)은 fonts-nanum 의 NanumGothic, 윈도우는 맑은 고딕.
"""
import os
import tempfile
from datetime import date, timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib import font_manager

PALETTE = ["#5b8cff", "#22a886", "#a070e6", "#c9801f", "#dc5573", "#3399c2"]
INK, MUTED, GRID, BG = "#1b2433", "#5b6576", "#e6ebf2", "#ffffff"
OUT = os.path.join(tempfile.gettempdir(), "vantage_tg")


def _font():
    names = {f.name for f in font_manager.fontManager.ttflist}
    for n in ("NanumGothic", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR"):
        if n in names:
            return n
    return "DejaVu Sans"


plt.rcParams.update({
    "font.family": _font(), "axes.unicode_minus": False,
    "figure.facecolor": BG, "axes.facecolor": BG, "savefig.facecolor": BG,
    "axes.edgecolor": GRID, "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
    "font.size": 11,
})


def _d(s):
    return date.fromisoformat(s[:10])


def _fig(title, sub):
    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    fig.subplots_adjust(left=0.08, right=0.86, top=0.82, bottom=0.12)
    fig.text(0.08, 0.93, title, fontsize=15, fontweight="bold", color=INK)
    # sub = "문장" 또는 ("문장", "굵게 붙일 부분") — 뒤쪽(예: 기준 일시)만 굵고 진하게
    plain, bold = sub if isinstance(sub, tuple) else (sub, "")
    t = fig.text(0.08, 0.875, plain, fontsize=9.5, color=MUTED)
    if bold:
        r = fig.canvas.get_renderer()
        x1 = fig.transFigure.inverted().transform(t.get_window_extent(r))[1][0]
        fig.text(x1 + 0.006, 0.875, bold, fontsize=9.5, fontweight="bold", color=INK)
    ax.tick_params(length=0)
    return fig, ax


def _save(fig, name):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name + ".png")
    fig.savefig(p)
    plt.close(fig)
    return p


def _fmt(v, digits):
    return f"{v:,.{digits}f}"


def _xaxis(ax, span_days):
    if span_days > 200:
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2 if span_days < 500 else 3))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%y/%m"))
    else:
        ax.xaxis.set_major_locator(mdates.AutoDateLocator(maxticks=7))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d"))


def line(name, title, sub, series, digits=2, unit="", since_days=None, fill=False, bands=None):
    """series = [(이름, [(날짜문자열, 값), ...]), ...] — 끝 점에 최신값 표시"""
    fig, ax = _fig(title, sub)
    cut = date.today() - timedelta(days=since_days) if since_days else None
    x0, x1 = None, None
    if bands:
        for lo, hi, col, lab in bands:
            ax.axhspan(lo, hi, color=col, alpha=0.16, lw=0)
            ax.text(1.008, (lo + hi) / 2, lab, transform=ax.get_yaxis_transform(), fontsize=9, color=col,
                    fontweight="bold", va="center")
        # 구간 경계: 진한 점선 + 눈금을 경계값으로
        edges = sorted({b for lo, hi, _, _ in bands for b in (lo, hi)})
        for b in edges[1:-1]:
            ax.axhline(b, color="#5b6576", lw=1, ls=(0, (4, 3)), alpha=0.8, zorder=1)
        ax.set_yticks(edges)
        ax.set_ylim(edges[0], edges[-1])
        ax.grid(axis="y", visible=False)
    for i, (label, pts) in enumerate(series):
        pts = [(_d(d), v) for d, v in pts if v is not None and (not cut or _d(d) >= cut)]
        if not pts:
            continue
        xs, ys = zip(*pts)
        c = PALETTE[i % len(PALETTE)]
        ax.plot(xs, ys, color=c, lw=2, label=f"{label} {_fmt(ys[-1], digits)}{unit}" if len(series) > 1 else None)
        if fill and len(series) == 1:
            ax.fill_between(xs, ys, min(ys) - (max(ys) - min(ys)) * 0.08, color=c, alpha=0.08)
        ax.scatter([xs[-1]], [ys[-1]], color=c, s=28, zorder=5)
        ax.annotate(_fmt(ys[-1], digits), (xs[-1], ys[-1]), xytext=(6, 0), textcoords="offset points",
                    fontsize=10, fontweight="bold", color=c, va="center")
        x0 = min(x0, xs[0]) if x0 else xs[0]
        x1 = max(x1, xs[-1]) if x1 else xs[-1]
    if len(series) > 1:
        ax.legend(loc="upper left", frameon=False, fontsize=9.5, ncol=min(len(series), 4), bbox_to_anchor=(0, 1.02))
    if x0:
        _xaxis(ax, (x1 - x0).days)
    return _save(fig, name)


def bars(name, title, sub, pts, digits=1, unit=""):
    fig, ax = _fig(title, sub)
    xs = [_d(d) for d, _ in pts]
    ys = [v for _, v in pts]
    width = max(1, int(min((b - a).days for a, b in zip(xs, xs[1:])) * 0.7)) if len(xs) > 1 else 5
    cols = [PALETTE[0]] * (len(xs) - 1) + ["#2f5fd6"]
    ax.bar(xs, ys, width=width, color=cols, alpha=0.9)
    ax.annotate(_fmt(ys[-1], digits) + unit, (xs[-1], ys[-1]), xytext=(0, 4), textcoords="offset points",
                ha="center", fontsize=10, fontweight="bold", color="#2f5fd6")
    if len(ys) > 1:
        ax.annotate(_fmt(ys[-2], digits), (xs[-2], ys[-2]), xytext=(0, 4), textcoords="offset points",
                    ha="center", fontsize=8.5, color=MUTED)
    ax.grid(axis="x", visible=False)
    _xaxis(ax, (xs[-1] - xs[0]).days if len(xs) > 1 else 0)
    return _save(fig, name)


def gauge(name, score, rating, prev=None, title="공포·탐욕 지수", sub=""):
    """반원 계기판 — CNN 구간(0·25·45·55·75·100) 경계가 딱 끊기는 블록형(LED 막대) 디자인.
    점수까지 블록이 켜지고, 바깥 삼각 표지가 현재 값을 가리킨다. prev = [(라벨, 값), ...] 아래 줄"""
    import numpy as np
    from matplotlib.patches import Polygon, Wedge

    zones = [(0, 25, "#d9364f", "극도 공포"), (25, 45, "#f07c3a", "공포"), (45, 55, "#8792a8", "중립"),
             (55, 75, "#3fb27a", "탐욕"), (75, 100, "#138a62", "극도 탐욕")]
    zone = lambda v: next(z for z in zones if z[0] <= v < z[1] or (z[1] == 100 and v >= 100))
    A = lambda v: 180 - v * 1.8                                # 값 → 각도(도)
    P = lambda v, r: (r * np.cos(np.radians(A(v))), r * np.sin(np.radians(A(v))))
    MONO = "DejaVu Sans Mono"
    sv = max(0.0, min(100.0, score))
    zc = zone(sv)[2]

    fig = plt.figure(figsize=(8, 5.6), dpi=150)
    fig.text(0.07, 0.925, title, fontsize=16, fontweight="bold", color=INK)
    if sub:
        fig.text(0.93, 0.93, sub, fontsize=9, color=MUTED, ha="right", family=MONO)
    ax = fig.add_axes([0.04, 0.19, 0.92, 0.69])
    ax.set_xlim(-1.45, 1.45)
    ax.set_ylim(-0.14, 1.36)
    ax.set_aspect("equal")
    ax.axis("off")

    # 블록: 1칸 = 1점(100칸). 칸 사이 얇은 틈, 구간 경계는 넓은 틈
    for lo, hi, col, lab in zones:
        for v in range(lo, hi):
            g0 = 0.9 if v == lo else 0.28
            g1 = 0.9 if v + 1 == hi else 0.28
            on = v < sv
            ax.add_patch(Wedge((0, 0), 1.0, A(v + 1) + g1, A(v) - g0, width=0.17,
                               facecolor=col, alpha=1.0 if on else 0.16, lw=0))
        # 구간 이름(호 바깥)
        x, y = P((lo + hi) / 2, 1.2)
        here = col == zc
        ax.text(x, y, lab, ha="center", va="center", fontsize=10 if here else 8.5,
                color=col if here else "#9aa3b2", fontweight="bold" if here else "normal")
    # 경계선 + 경계 숫자
    for b in (0, 25, 45, 55, 75, 100):
        (x0, y0), (x1, y1) = P(b, 0.76), P(b, 1.05)
        ax.plot([x0, x1], [y0, y1], color=INK, lw=1.3, alpha=0.75, solid_capstyle="butt")
        x, y = P(b, 0.69)
        ax.text(x, y, str(b), ha="center", va="center", fontsize=8.5, color=INK, alpha=0.7, family=MONO)
    # 안쪽 가는 테두리
    ax.add_patch(Wedge((0, 0), 0.8, 0, 180, width=0.006, facecolor="#c9cfda", lw=0))
    # 현재 값 표지: 바깥 삼각형 + 안쪽 짧은 막대
    t = np.radians(A(sv))
    ux, uy = np.cos(t), np.sin(t)
    nx, ny = -uy, ux
    tip = (1.03 * ux, 1.03 * uy)
    ax.add_patch(Polygon([tip, (1.13 * ux + 0.045 * nx, 1.13 * uy + 0.045 * ny),
                          (1.13 * ux - 0.045 * nx, 1.13 * uy - 0.045 * ny)], closed=True, facecolor=INK, lw=0, zorder=6))
    ax.plot([0.8 * ux, 0.9 * ux], [0.8 * uy, 0.9 * uy], color=INK, lw=2.4, zorder=6, solid_capstyle="butt")
    # 가운데 숫자(고정폭 글꼴) + 구간
    ax.text(0, 0.27, f"{score:.0f}", ha="center", va="center", fontsize=62, fontweight="bold", color=INK, family=MONO)
    ax.text(0, 0.0, f"[ {rating} ]", ha="center", va="center", fontsize=13, fontweight="bold", color=zc)
    # 아래 줄: 지난 값(각 값의 구간 색 막대)
    prev = [(l, v) for l, v in (prev or []) if v is not None]
    if prev:
        w = 0.84 / len(prev)
        for i, (lab, v) in enumerate(prev):
            x = 0.08 + w * i
            c = zone(float(v))[2]
            fig.add_artist(plt.Line2D([x + 0.012, x + 0.012], [0.05, 0.14], transform=fig.transFigure, color=c, lw=3))
            fig.text(x + 0.03, 0.118, lab, ha="left", va="center", fontsize=9, color=MUTED)
            fig.text(x + 0.03, 0.068, f"{float(v):.0f}", ha="left", va="center", fontsize=16, fontweight="bold",
                     color=INK, family=MONO)
            fig.text(x + 0.03 + 0.065, 0.068, zone(float(v))[3], ha="left", va="center", fontsize=8.5, color=c)
    return _save(fig, name)
