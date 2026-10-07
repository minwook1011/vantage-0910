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
