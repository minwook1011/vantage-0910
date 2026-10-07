#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tg_shots.py — 사이트 화면을 그대로 찍어 텔레그램 실적 채널용 사진으로 만든다(tg_earnings.py 가 쓴다)

  · 주간 캘린더  week(kind, monday)     kind = "jpc"(일본 소비재) · "jpm"(일본 닛케이=주요 기업) · "us"(미국)
  · 하루 칸 3개  day(date)              세 캘린더에서 그날 칸만 잘라 나란히 붙인 한 장
  · 발표 카드    card(kind, code, date) 캘린더의 그 종목 카드(발표 후 주가·컨센 배지)
  · 재무제표 표  fin(kind, code, rid)    일본 = 스크리너 종목 창 분기 실적표, 미국 = 실적 리포트 분기 표

즐겨찾기(별·색)는 브라우저 저장소에 넣어서 사이트와 똑같이 보이게 한다.
필요: pip install playwright pillow && python -m playwright install chromium
"""
import asyncio
import io
import json
import os

from PIL import Image

SITE = os.environ.get("VANTAGE_SITE", "https://minwook1011.github.io/vantage-0910/")
_GATE = None


def gate():
    """사이트 잠금 통과 표시(저장 키, 값) — 사이트에 공개된 gate.js 에서 실행할 때 읽는다(파일에 적어 두지 않음)"""
    global _GATE
    if _GATE is None:
        import re
        import urllib.request
        js = urllib.request.urlopen(SITE + "gate.js", timeout=30).read().decode("utf-8")
        h = re.search(r'GATE_HASH\s*=\s*"([0-9a-f]+)"', js).group(1)
        v = re.search(r'GATE_VER\s*=\s*"([^"]+)"', js).group(1)
        _GATE = ("etf_gate_ok_v" + v, h)
    return _GATE
FKEY = "vantage-datahub-favorite-companies-v1"
LABEL = {"jpc": "일본 소비재", "jpm": "일본 닛케이", "us": "미국"}
PAGE = {"jpc": "jp-screener.html?u=consumer", "jpm": "jp-screener.html?u=major", "us": "us-report.html"}
WD = "월화수목금토일"


def _init(favs, monday=None):
    g = gate()
    kv = {g[0]: g[1], "jp_screener_eu_fold": "0", "us-cal-fold": "0"}
    if favs:
        kv[FKEY] = json.dumps(favs, ensure_ascii=False)
    js = "try{" + "".join(f"localStorage.setItem({json.dumps(k)},{json.dumps(v, ensure_ascii=False)});" for k, v in kv.items())
    if monday:
        js += f"sessionStorage.setItem('us-cal-week',{json.dumps(monday)});"
    return js + "}catch(e){}"


def _md(d):
    return d[5:].replace("-", ".")


async def _open(br, kind, favs, monday=None, width=1500):
    pg = await br.new_page(viewport={"width": width, "height": 1000}, device_scale_factor=2)
    await pg.add_init_script(_init(favs, monday))
    await pg.goto(SITE + PAGE[kind], wait_until="networkidle", timeout=90000)
    if kind == "us":
        await pg.wait_for_selector("#cal .cw", timeout=60000)
    else:
        await pg.wait_for_selector("#earnup .eu-cal", timeout=60000)
        if monday:   # 주차 단추로 그 주를 연다(없으면 가장 가까운 주로 남는다)
            await pg.evaluate("""m => { const b = document.querySelector('#earnup [data-w="' + m + '"]'); if (b) b.click(); }""", monday)
    await pg.wait_for_timeout(1200)
    # 화면 위 고정 메뉴·목차가 사진에 끼지 않게
    await pg.add_style_tag(content="#page-toc,.topnav,nav.top,header.site,.vs-cloud{display:none!important}")
    return pg


async def _shot(loc):
    png = await loc.screenshot(type="png")
    im = Image.open(io.BytesIO(png))
    if im.height > 7000:   # 텔레그램 사진 한도(가로+세로 1만 픽셀) — 너무 길면 줄인다
        r = 7000 / im.height
        im = im.resize((int(im.width * r), 7000))
    return im


def _png(im):
    b = io.BytesIO()
    im.convert("RGB").save(b, "PNG", optimize=True)
    return b.getvalue()


# ── 주간 ─────────────────────────────────────────────────────
async def _week(br, kind, monday, favs):
    pg = await _open(br, kind, favs, monday)
    lab = LABEL[kind]
    if kind == "us":
        await pg.add_style_tag(content="#cal .cal-h,#cal .cw-note{display:none!important}")
        await pg.evaluate("""l => { const t = document.querySelector('#cal .cw-t b'); if (t) t.textContent = l + ' · ' + t.textContent; }""", lab)
        im = await _shot(pg.locator("#cal"))
    else:
        await pg.add_style_tag(content="#earnup .eu-h,#earnup .eu-weeks,#earnup .eu-note,#earnup .eu-wkend{display:none!important}")
        await pg.evaluate("""l => { const t = document.querySelector('#earnup .eu-wnav b'); if (t) t.textContent = l + ' · ' + t.textContent; }""", lab)
        im = await _shot(pg.locator("#earnup"))
    await pg.close()
    return im


# ── 하루(세 시장 그날 칸) ─────────────────────────────────────
async def _day_col(br, kind, date, favs):
    from datetime import date as D, timedelta
    d = D.fromisoformat(date)
    monday = (d - timedelta(days=d.weekday())).isoformat()
    pg = await _open(br, kind, favs, monday)
    sel = "#cal .cd" if kind == "us" else "#earnup .eu-col"
    head = ".cd-h" if kind == "us" else ".eu-colh"
    more = ".cd-more" if kind == "us" else ".eu-more"
    # 그날 칸을 찾아 '더 보기'를 펼치고 시장 이름표를 단다
    for _ in range(2):
        idx = await pg.evaluate("""([s, h, md]) => [...document.querySelectorAll(s)].findIndex(c => (c.querySelector(h) || {}).innerText?.trim().startsWith(md))""",
                                [sel, head, _md(date)])
        if idx < 0:
            await pg.close()
            return None
        btn = pg.locator(sel).nth(idx).locator(more)
        if await btn.count():
            await btn.first.click()
            await pg.wait_for_timeout(400)
            continue
        break
    await pg.evaluate("""([s, i, l]) => { const c = document.querySelectorAll(s)[i]; const t = document.createElement('div');
        t.textContent = l; t.style.cssText = 'font-weight:800;font-size:17px;color:#1d4ed8;padding:4px 2px 10px;letter-spacing:-.2px';
        c.prepend(t);
        // 그날 칸만 남기고 한 칸짜리 격자로 — 옆 칸이 같이 찍히지 않게
        [...c.parentElement.children].forEach(x => { if (x !== c) x.style.display = 'none'; });
        c.parentElement.style.gridTemplateColumns = '400px'; c.parentElement.style.width = '400px'; }""", [sel, idx, LABEL[kind]])
    im = await _shot(pg.locator(sel).nth(idx))
    await pg.close()
    return im


def _side(ims, gap=24):
    ims = [i for i in ims if i is not None]
    if not ims:
        return None
    h = max(i.height for i in ims)
    w = sum(i.width for i in ims) + gap * (len(ims) + 1)
    bg = (238, 243, 251)
    out = Image.new("RGB", (w, h + gap * 2), bg)
    x = gap
    for i in ims:
        out.paste(i.convert("RGB"), (x, gap))
        x += i.width + gap
    if out.height + out.width > 9800:
        r = 9800 / (out.height + out.width)
        out = out.resize((int(out.width * r), int(out.height * r)))
    return out


# ── 발표 카드 · 재무제표 ─────────────────────────────────────
async def _card(br, kind, code, date, favs):
    from datetime import date as D, timedelta
    d = D.fromisoformat(date)
    monday = (d - timedelta(days=d.weekday())).isoformat()
    pg = await _open(br, kind, favs, monday)
    if kind == "us":
        loc = pg.locator(f'#cal .ce[data-t="{code}"]')
        if not await loc.count():
            for b in await pg.locator("#cal .cd-more").all():
                await b.click()
                await pg.wait_for_timeout(300)
            loc = pg.locator(f'#cal .ce[data-t="{code}"]')
    else:
        loc = pg.locator(f'#earnup .eu-co[data-c="{code}"]')
        if not await loc.count():
            for b in await pg.locator("#earnup .eu-more").all():
                await b.click()
                await pg.wait_for_timeout(300)
            loc = pg.locator(f'#earnup .eu-co[data-c="{code}"]')
    im = await _shot(loc.first) if await loc.count() else None
    await pg.close()
    return im


async def _fin(br, kind, code, rid, favs):
    if kind == "us":
        pg = await br.new_page(viewport={"width": 1100, "height": 1000}, device_scale_factor=2)
        await pg.add_init_script(_init(favs))
        await pg.goto(SITE + f"us-report.html?id={rid}", wait_until="networkidle", timeout=90000)
        loc = pg.locator('section[data-sec="sum"] .tbl')
        await loc.wait_for(timeout=60000)
    else:
        pg = await _open(br, kind, favs, width=1300)
        ok = await pg.evaluate("c => { try { openDetail(c); return !!document.querySelector('#finbox .fintab'); } catch (e) { return false; } }", code)
        if not ok:
            await pg.close()
            return None
        await pg.wait_for_timeout(800)
        loc = pg.locator("#finbox .fintab")
    im = await _shot(loc.first)
    await pg.close()
    return im


# ── 바깥에서 부르는 함수(PNG 바이트) ───────────────────────────
async def _run(coro_fn):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        br = await p.chromium.launch()
        try:
            return await coro_fn(br)
        finally:
            await br.close()


def week_all(monday, favs=None):
    """[(kind, png)] — 세 캘린더의 그 주"""
    async def go(br):
        out = []
        for k in ("jpc", "jpm", "us"):
            try:
                out.append((k, _png(await _week(br, k, monday, favs))))
            except Exception as e:
                print("주간 사진 실패:", k, e)
        return out
    return asyncio.run(_run(go))


def day_all(date, favs=None):
    """그날 세 시장 칸을 나란히 붙인 PNG(발표가 하나도 없으면 None)"""
    async def go(br):
        cols = []
        for k in ("jpc", "jpm", "us"):
            try:
                cols.append(await _day_col(br, k, date, favs))
            except Exception as e:
                print("하루 칸 실패:", k, e)
        im = _side(cols)
        return _png(im) if im else None
    return asyncio.run(_run(go))


def alert_pics(kind, code, date, rid, favs=None):
    """[png] — 발표 카드 + 재무제표 표"""
    async def go(br):
        out = []
        for f in (lambda: _card(br, kind, code, date, favs), lambda: _fin(br, kind, code, rid, favs)):
            try:
                im = await f()
                if im is not None:
                    out.append(_png(im))
            except Exception as e:
                print("발표 사진 실패:", code, e)
        return out
    return asyncio.run(_run(go))


if __name__ == "__main__":   # 시험: python tg_shots.py 2026-10-05  → shots/ 에 저장
    import sys
    d = sys.argv[1] if len(sys.argv) > 1 else "2026-10-05"
    os.makedirs("shots", exist_ok=True)
    for k, b in week_all(d):
        open(f"shots/week_{k}.png", "wb").write(b)
    b = day_all(d)
    if b:
        open("shots/day.png", "wb").write(b)
    print("저장: shots/")
