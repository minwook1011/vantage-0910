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
    fig.subplots_adjust(left=0.08, right=0.9, top=0.82, bottom=0.12)
    fig.text(0.08, 0.93, title, fontsize=15, fontweight="bold", color=INK)
    fig.text(0.08, 0.875, sub, fontsize=9.5, color=MUTED)
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
            ax.axhspan(lo, hi, color=col, alpha=0.10, lw=0)
            ax.text(1.005, (lo + hi) / 2, lab, transform=ax.get_yaxis_transform(), fontsize=8, color=MUTED, va="center")
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


def gauge(name, score, rating, prev=None, title="CNN 공포·탐욕 지수", sub=""):
    """반원 계기판(바늘) — 0 극도 공포 ~ 100 극도 탐욕. prev = [(라벨, 값), ...] 아래 비교 칸"""
    import numpy as np
    from matplotlib.patches import Circle, FancyBboxPatch, Polygon, Wedge
    segs = [(0, 25, "#e0475f", "극도 공포"), (25, 45, "#f08a4b", "공포"), (45, 55, "#7f8aa3", "중립"),
            (55, 75, "#4cb782", "탐욕"), (75, 100, "#1f9d74", "극도 탐욕")]

    def seg_of(v):
        return next(x for x in segs if x[0] <= v < x[1] or (x[1] == 100 and v >= 100))

    ang = lambda v: 180 - v * 1.8
    fig = plt.figure(figsize=(8, 5.6), dpi=150)
    fig.text(0.06, 0.935, title, fontsize=15, fontweight="bold", color=INK)
    if sub:
        fig.text(0.06, 0.893, sub, fontsize=9.5, color=MUTED)
    ax = fig.add_axes([0.0, 0.2, 1.0, 0.66])
    ax.set_xlim(-1.75, 1.75)
    ax.set_ylim(-0.38, 1.18)
    ax.set_aspect("equal")
    ax.axis("off")

    act = seg_of(score)
    # 바탕 트랙 + 구간 색(현재 구간만 진하게·두껍게)
    ax.add_patch(Wedge((0, 0), 1.0, 0, 180, width=0.2, facecolor="#f1f3f7", edgecolor="none"))
    for lo, hi, col, lab in segs:
        on = (lo, hi) == act[:2]
        ax.add_patch(Wedge((0, 0), 1.0 if not on else 1.035, ang(hi) + 0.8, ang(lo) - 0.8,
                           width=0.2 if not on else 0.27, facecolor=col, alpha=1 if on else 0.32, edgecolor="none"))
        m = np.radians(ang((lo + hi) / 2))
        ax.text(1.2 * np.cos(m), 1.2 * np.sin(m), lab, ha="center", va="center",
                fontsize=10 if on else 9, color=col if on else MUTED, fontweight="bold" if on else "normal")
    # 눈금
    for v in range(0, 101, 5):
        a = np.radians(ang(v))
        r0 = 0.74 if v % 50 else 0.715
        ax.plot([r0 * np.cos(a), 0.77 * np.cos(a)], [r0 * np.sin(a), 0.77 * np.sin(a)],
                color="#c9ced8" if v % 50 else "#9aa3b2", lw=1 if v % 50 else 1.5, solid_capstyle="round")
    for v in (0, 50, 100):
        a = np.radians(ang(v))
        ax.text(0.62 * np.cos(a), 0.62 * np.sin(a) + (0.03 if v == 50 else 0.0), str(v), ha="center", va="center",
                fontsize=8, color=MUTED)
    # 바늘(끝으로 갈수록 가늘게) + 축
    a = np.radians(ang(max(0, min(100, score))))
    tip = (0.86 * np.cos(a), 0.86 * np.sin(a))
    nx, ny = -np.sin(a) * 0.035, np.cos(a) * 0.035
    ax.add_patch(Polygon([(nx, ny), tip, (-nx, -ny)], closed=True,
                         facecolor=INK, edgecolor="none", zorder=5))
    ax.add_patch(Circle((0, 0), 0.075, facecolor=BG, edgecolor=INK, linewidth=3, zorder=6))
    # 숫자 + 구간 알약
    ax.text(0, -0.25, f"{score:.0f}", ha="center", va="center", fontsize=34, fontweight="bold", color=INK)
    fig.patches.append(FancyBboxPatch((0.5 - 0.075, 0.155), 0.15, 0.06, boxstyle="round,pad=0,rounding_size=0.03",
                                      transform=fig.transFigure, facecolor=act[2], alpha=0.16, edgecolor="none"))
    fig.text(0.5, 0.185, rating, ha="center", va="center", fontsize=12.5, fontweight="bold", color=act[2])
    # 비교 칸
    prev = [(l, v) for l, v in (prev or []) if v is not None]
    if prev:
        w = 0.17
        x0 = 0.5 - (w * len(prev) + 0.02 * (len(prev) - 1)) / 2
        for i, (lab, v) in enumerate(prev):
            x = x0 + i * (w + 0.02)
            fig.patches.append(FancyBboxPatch((x, 0.025), w, 0.095, boxstyle="round,pad=0,rounding_size=0.015",
                                              transform=fig.transFigure, facecolor="#f5f7fa", edgecolor="#e6ebf2"))
            fig.text(x + w / 2, 0.095, lab, ha="center", va="center", fontsize=8.5, color=MUTED)
            c = seg_of(float(v))[2]
            fig.text(x + w / 2, 0.05, f"{float(v):.0f}", ha="center", va="center", fontsize=12, fontweight="bold", color=c)
    return _save(fig, name)
