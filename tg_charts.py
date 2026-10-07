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


def gauge(name, score, rating, prev=None, title="공포·탐욕 지수", sub=""):
    """반원 계기판 — 0 극도 공포 ~ 100 극도 탐욕. 연속 그라데이션 호 + 빛나는 표지 + 지난 값 표지.
    prev = [(라벨, 값), ...] — 호 바깥에 작은 점으로, 아래 줄에 숫자로"""
    import numpy as np
    from matplotlib.colors import LinearSegmentedColormap, to_rgb
    from matplotlib.patches import Circle, Wedge

    stops = [(0.0, "#d33f5b"), (0.25, "#ee7d4a"), (0.5, "#9fabc2"), (0.75, "#4fb985"), (1.0, "#178f6b")]
    cmap = LinearSegmentedColormap.from_list("fg", stops)
    names = [(0, 25, "극도 공포"), (25, 45, "공포"), (45, 55, "중립"), (55, 75, "탐욕"), (75, 101, "극도 탐욕")]
    col_of = lambda v: cmap(max(0, min(100, v)) / 100)
    deep = lambda v: tuple(c * (0.62 if 40 <= v <= 60 else 0.8) for c in to_rgb(col_of(v)))   # 글자용으로 한 톤 진하게
    ang = lambda v: np.radians(180 - v * 1.8)
    pos = lambda v, r: (r * np.cos(ang(v)), r * np.sin(ang(v)))

    fig = plt.figure(figsize=(8, 5.6), dpi=150)
    bg = fig.add_axes([0, 0, 1, 1], zorder=-10)
    bg.imshow(np.linspace(0, 1, 256)[:, None], aspect="auto", extent=[0, 1, 0, 1],
              cmap=LinearSegmentedColormap.from_list("bg", ["#eef2f9", "#fdfdfe"]), origin="lower")
    bg.axis("off")
    fig.text(0.07, 0.925, title, fontsize=16, fontweight="bold", color=INK)
    if sub:
        fig.text(0.93, 0.93, sub, fontsize=9.5, color=MUTED, ha="right")
    ax = fig.add_axes([0.04, 0.2, 0.92, 0.68])
    ax.set_xlim(-1.45, 1.45)
    ax.set_ylim(-0.12, 1.32)
    ax.set_aspect("equal")
    ax.axis("off")

    # 은은한 번짐 → 본 호(연속 그라데이션)
    n = 360
    for k in range(n):
        v0, v1 = 100 * k / n, 100 * (k + 1) / n + 0.15
        c = col_of((v0 + v1) / 2)
        ax.add_patch(Wedge((0, 0), 1.0, 180 - v1 * 1.8, 180 - v0 * 1.8, width=0.12, facecolor=c, edgecolor=c, lw=0.3))
    ax.add_patch(Wedge((0, 0), 1.06, 0, 180, width=0.24, facecolor="#ffffff", alpha=0.55, lw=0, zorder=-1))
    # 안쪽 점 눈금과 숫자
    for v in np.arange(0, 100.1, 2.5):
        x, y = pos(v, 0.8)
        big = v % 25 == 0
        ax.add_patch(Circle((x, y), 0.012 if big else 0.006, color="#8d96a8" if big else "#c5cbd6", lw=0))
    for v in (0, 25, 50, 75, 100):
        x, y = pos(v, 0.7)
        ax.text(x, y, str(v), ha="center", va="center", fontsize=8, color="#9aa3b2")
    # 구간 이름(호 바깥)
    for lo, hi, lab in names:
        on = lo <= score < hi
        x, y = pos((lo + min(hi, 100)) / 2, 1.2)
        ax.text(x, y, lab, ha="center", va="center", fontsize=10 if on else 8.5,
                color=deep(score) if on else "#9aa3b2", fontweight="bold" if on else "normal")
    # 바늘: 가는 선 + 호 위의 빛나는 표지
    sv = max(0, min(100, score))
    tx, ty = pos(sv, 0.94)
    # 호 안쪽으로 짧은 바늘(표지 → 중심 방향)
    ix, iy = pos(sv, 0.62)
    ax.plot([ix, tx * 0.93], [iy, ty * 0.93], color=deep(sv), lw=2.2, solid_capstyle="round", zorder=5)
    for r, a in ((0.11, 0.08), (0.085, 0.14), (0.065, 0.25)):
        ax.add_patch(Circle((tx, ty), r, color=col_of(sv), alpha=a, lw=0, zorder=6))
    ax.add_patch(Circle((tx, ty), 0.048, facecolor=BG, edgecolor=deep(sv), lw=2.6, zorder=7))
    ax.add_patch(Circle((tx, ty), 0.02, color=deep(sv), zorder=8))
    # 가운데 큰 숫자 + 구간
    ax.text(0, 0.25, f"{score:.0f}", ha="center", va="center", fontsize=60, fontweight="bold", color=INK, zorder=3)
    ax.text(0, 0.0, rating, ha="center", va="center", fontsize=13, fontweight="bold", color=deep(score), zorder=3)
    # 아래 줄: 지난 값
    prev = [(l, v) for l, v in (prev or []) if v is not None]
    if prev:
        w = 0.8 / len(prev)
        for i, (lab, v) in enumerate(prev):
            cx = 0.1 + w * (i + 0.5)
            fig.text(cx, 0.135, lab, ha="center", va="center", fontsize=9, color=MUTED)
            fig.text(cx, 0.08, f"{float(v):.0f}", ha="center", va="center", fontsize=15, fontweight="bold", color=deep(float(v)))
            if i:
                fig.add_artist(plt.Line2D([0.1 + w * i] * 2, [0.06, 0.155], transform=fig.transFigure, color="#dde2ea", lw=1))
    return _save(fig, name)
