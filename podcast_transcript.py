#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
podcast_transcript.py — 팟캐스트 에피소드 영어 대본 구하기 → data_sources/_podcast_tmp/<id>.txt
(Claude 작업이 대본을 찾느라 토큰을 쓰지 않게, 먼저 이걸로 받아 둔다)

순서
  1) 에피소드 페이지 본문에 전체 대본이 있으면 그걸 쓴다(드와케시는 전체 대본이 글 본문에 있음).
     본문의 'Transcript' 뒤 글자가 20,000자 이상일 때만 '전체'로 인정(콜로서스는 앞부분만 공개라 보통 미달).
  2) 유튜브 자막: yt-dlp 로 "방송명 + 제목"을 검색해 영상의 영어 자막(자동 자막 포함)을 받아 정리.
     필요: pip install yt-dlp
  3) 오디오 받아쓰기: 공개 mp3를 받아 faster-whisper 로 직접 받아쓴다(선택 — pip install faster-whisper, 1시간에 CPU 10~30분).
  4) 모두 없으면 실패로 끝낸다 → Claude 작업은 방송 소개글로 짧은 요약만 쓰고 '대본 없음' 표시.

사용: python podcast_transcript.py <에피소드 id>
출력(마지막 줄 JSON): {"ok": true, "path": "...txt", "chars": 123456, "source": "page|youtube|audio", "youtube": "https://..."}
"""
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(BASE, "docs", "data", "podcasts", "index.json")
TMP = os.path.join(BASE, "data_sources", "_podcast_tmp")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vantage-podcasts/1.0"
SHOW_YT = {"ilb": "Invest Like the Best", "bb": "Business Breakdowns Colossus", "ca": "Capital Allocators Ted Seides",
           "dwarkesh": "Dwarkesh Patel", "mad": "MAD Podcast Matt Turck"}


def page_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        t = r.read().decode("utf-8", "replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"<(br|p|div|h\d|li)[^>]*>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n\n", t)).strip()


PAGE_SHOWS = {"dwarkesh", "ilb", "bb"}   # 에피소드 페이지에 대본을 싣는 방송만(다른 방송 페이지는 다른 편 소개글이 섞여 오판)


def from_page(row):
    if not row.get("link") or row["show"] not in PAGE_SHOWS:
        return None
    try:
        t = page_text(row["link"])
    except Exception as e:
        print(f"  페이지 실패: {e}")
        return None
    i = t.lower().find("transcript")
    body = t[i:] if i >= 0 else ""
    print(f"  페이지 본문 {len(t):,}자 · 'Transcript' 뒤 {len(body):,}자")
    # 게스트 이름(제목 앞부분)이 대본에 여러 번 나와야 진짜 이 편의 대본으로 본다
    name = re.split(r"\s[-–—|:]\s", row["title"])[0].split()[-1] if row["title"] else ""
    if name and body.count(name) < 3:
        print(f"  '{name}'가 {body.count(name)}번뿐 — 이 편 대본이 아닌 것으로 판단")
        return None
    return body if len(body) >= 20000 else None


def clean_vtt(vtt):
    lines, last = [], ""
    for ln in vtt.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")) or "-->" in ln or re.fullmatch(r"\d+", ln):
            continue
        ln = re.sub(r"<[^>]+>", "", ln)          # 자동 자막의 단어별 타이밍 태그
        ln = html.unescape(ln).strip()
        if ln and ln != last:                    # 자동 자막은 같은 줄이 반복된다
            lines.append(ln)
            last = ln
    text = " ".join(lines)
    return re.sub(r"\s+", " ", text)


def from_youtube(row):
    q = f"{SHOW_YT.get(row['show'], row.get('show_name', ''))} {re.sub(r'\[.*?\]|\(EP\.?\s*\d+\)', '', row['title'])}".strip()
    with tempfile.TemporaryDirectory() as d:
        # 자막은 영어 한 종류만 받는다 — "en.*"처럼 여러 종류를 한꺼번에 받으면 유튜브가 429(요청 과다)로 막는다.
        cmd = [sys.executable, "-m", "yt_dlp", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en",
               "--sub-format", "vtt", "--playlist-items", "1", "--no-simulate", "--print", "%(webpage_url)s|%(title)s|%(duration)s",
               "-o", os.path.join(d, "%(id)s.%(ext)s"), f"ytsearch3:{q}"]
        try:   # 브라우저처럼 요청하면 차단이 훨씬 덜하다(pip install "yt-dlp[default,curl-cffi]")
            import curl_cffi  # noqa: F401
            cmd[3:3] = ["--impersonate", "chrome"]
        except ImportError:
            pass
        try:
            for attempt in range(3):   # 유튜브가 자막 요청을 잠깐 막으면(429) 쉬었다 다시
                p = subprocess.run(cmd + ["--sleep-subtitles", "3"], capture_output=True, text=True, encoding="utf-8", timeout=300)
                if "429" not in (p.stderr or "") or any(f.endswith(".vtt") for f in os.listdir(d)):
                    break
                print(f"  유튜브 429 — {30 * (attempt + 1)}초 뒤 다시")
                __import__("time").sleep(30 * (attempt + 1))
        except FileNotFoundError:
            print("  yt-dlp 없음 — pip install yt-dlp")
            return None, None
        except subprocess.TimeoutExpired:
            print("  yt-dlp 시간 초과")
            return None, None
        if p.returncode != 0 and "No module named" in (p.stderr or ""):
            print("  yt-dlp 없음 — pip install yt-dlp")
            return None, None
        info = (p.stdout or "").strip().splitlines()
        url = info[-1].split("|")[0] if info else None
        vtts = [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".vtt")]
        if not vtts:
            print(f"  유튜브 자막 없음 (검색어: {q}) {p.stderr[-300:] if p.stderr else ''}")
            return None, url
        vtts.sort(key=lambda f: (".en." not in f, "orig" in f))   # 사람이 단 영어 자막 우선
        text = clean_vtt(open(vtts[0], encoding="utf-8", errors="replace").read())
        print(f"  유튜브 자막 {len(text):,}자 ← {info[-1] if info else ''}")
        return (text if len(text) > 5000 else None), url


def from_audio(row):
    """마지막 수단: 공개 오디오(mp3)를 받아 PC에서 받아쓰기(faster-whisper). 1시간 분량이 CPU로 10~30분.
    필요: pip install faster-whisper   (없으면 건너뜀)"""
    if not row.get("audio"):
        return None
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("  faster-whisper 없음 — 오디오 받아쓰기 건너뜀 (pip install faster-whisper)")
        return None
    mp3 = os.path.join(TMP, row["id"] + ".mp3")
    try:
        req = urllib.request.Request(row["audio"], headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(mp3, "wb") as f:
            while True:
                b = r.read(1 << 20)
                if not b:
                    break
                f.write(b)
        print(f"  오디오 받음 {os.path.getsize(mp3) / 1e6:.0f}MB → 받아쓰기 중(small.en, CPU)…")
        model = WhisperModel(os.environ.get("WHISPER_MODEL", "small.en"), device="auto", compute_type="int8")
        segs, _ = model.transcribe(mp3, vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segs)
        return text if len(text) > 5000 else None
    except Exception as e:
        print(f"  오디오 받아쓰기 실패: {e}")
        return None
    finally:
        if os.path.exists(mp3):
            os.remove(mp3)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    eid = sys.argv[1]
    ix = json.load(open(INDEX, encoding="utf-8"))
    row = next((e for e in ix["episodes"] if e["id"] == eid), None)
    if not row:
        print(json.dumps({"ok": False, "error": "index.json 에 없는 id"}, ensure_ascii=False))
        return 1
    os.makedirs(TMP, exist_ok=True)
    text, src, yt = from_page(row), "page", None
    if not text:
        text, yt = from_youtube(row)
        src = "youtube"
    if not text and "--no-audio" not in sys.argv:
        text = from_audio(row)
        src = "audio"
    if not text:
        print(json.dumps({"ok": False, "error": "대본을 구하지 못함", "youtube": yt}, ensure_ascii=False))
        return 2
    path = os.path.join(TMP, eid + ".txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(json.dumps({"ok": True, "path": path, "chars": len(text), "source": src, "youtube": yt}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
