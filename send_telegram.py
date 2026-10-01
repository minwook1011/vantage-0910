#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
send_telegram.py — 텔레그램 봇으로 알림 보내기 (표준 라이브러리만)

── 최초 설정(회사 PC에서 한 번) ─────────────────────────────
1) 텔레그램에서 @BotFather → /newbot → 봇 이름 정하기 → 토큰(123456:ABC...) 받기
2) 만든 봇과 1:1 대화방을 열고 아무 말이나 한 번 보내기(예: "hi")
3) 저장소 폴더에 telegram_bot.json 만들기 (.gitignore 에 있어 GitHub에 안 올라감):
     {"token": "123456:ABC...", "chat_id": ""}
4) python send_telegram.py --chat-id   → 대화방 chat_id 가 출력됨 → telegram_bot.json 의 chat_id 에 넣기
5) python send_telegram.py --test      → "100억 알림 테스트"가 오면 끝
   (환경변수 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 로 줘도 된다 — 파일보다 우선)

── 사용 ─────────────────────────────────────────────────────
  python send_telegram.py --podcast <에피소드 id>   # 팟캐스트 요약 알림(중복 전송 방지, 보낸 뒤 index.json 에 sent 기록)
  python send_telegram.py --podcast-pending          # 요약은 끝났는데(done) 아직 안 보낸 에피소드 전부
  python send_telegram.py --text "보낼 문장"          # 아무 문장
  python send_telegram.py --jp-report <rid>          # 일본 실적 리포트 알림(notes 의 tg 문장 + 링크)
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
SECRET = os.path.join(BASE, "telegram_bot.json")
SITE = "https://minwook1011.github.io/vantage-0910/"
PODCAST_INDEX = os.path.join(BASE, "docs", "data", "podcasts", "index.json")
PODCAST_EP = os.path.join(BASE, "docs", "data", "podcasts", "ep")
JP_REPORTS = os.path.join(BASE, "docs", "data", "jp", "reports")
KST = timezone(timedelta(hours=9))


def creds():
    tok = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if (not tok or not chat) and os.path.exists(SECRET):
        c = json.load(open(SECRET, encoding="utf-8"))
        tok = tok or c.get("token")
        chat = chat or str(c.get("chat_id") or "")
    if not tok:
        sys.exit("텔레그램 토큰이 없습니다 — 파일 맨 위 '최초 설정'을 따라 telegram_bot.json 을 만드세요.")
    return tok, chat


def api(method, params):
    tok, _ = creds()
    data = urllib.parse.urlencode(params).encode("utf-8")
    last = None
    for a in range(4):
        try:
            req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/{method}", data=data)
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.loads(r.read().decode("utf-8"))
            if res.get("ok"):
                return res["result"]
            last = res
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            last = body
            if e.code == 429:   # 너무 자주 보냄 → 기다렸다 다시
                try:
                    time.sleep(int(json.loads(body)["parameters"]["retry_after"]) + 1)
                    continue
                except Exception:
                    pass
            if e.code in (400, 401, 403):
                break
        except Exception as e:
            last = str(e)
        time.sleep(2 * (a + 1))
    raise RuntimeError(f"텔레그램 전송 실패: {last}")


def send(text, preview=False):
    _, chat = creds()
    if not chat:
        sys.exit("chat_id 가 없습니다 — python send_telegram.py --chat-id 로 확인해 telegram_bot.json 에 넣으세요.")
    # 텔레그램 한 메시지 최대 4096자 → 넘으면 나눠 보낸다
    parts, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > 3800:
            parts.append(cur)
            cur = ""
        cur += line + "\n"
    parts.append(cur)
    ids = []
    for p in parts:
        r = api("sendMessage", {"chat_id": chat, "text": p.strip(), "parse_mode": "HTML",
                                "disable_web_page_preview": "false" if preview else "true"})
        ids.append(r.get("message_id"))
        time.sleep(0.6)
    return ids


def esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def podcast_message(ep, ix_row):
    g, c = ep.get("guest") or {}, ep.get("company") or {}
    lines = [f"🎙 <b>[{esc(ep.get('show_name') or ix_row.get('show_name'))}]</b> {esc(ep.get('title_ko') or ep.get('title'))}"]
    if ep.get("title_ko") and ep.get("title"):
        lines.append(f"<i>{esc(ep['title'])}</i>")
    if g.get("name"):
        lines.append(f"👤 {esc(g['name'])} — {esc(g.get('role', ''))}")
    if c.get("name"):
        lines.append(f"🏢 {esc(c['name'])}" + (f" ({esc(c.get('sector'))})" if c.get("sector") else ""))
    if ep.get("tg"):
        lines += ["", esc(ep["tg"].replace("__", ""))]   # 사이트용 밑줄 표시는 빼고 보낸다
    lines.append("")
    lines.append(f"📝 요약·분석: {SITE}podcasts.html?id={ep['id']}")
    if ep.get("artifact_url"):
        lines.append(f"📄 전체 번역(아티팩트): {ep['artifact_url']}")
    if ep.get("link") or ix_row.get("link"):
        lines.append(f"▶️ 원본 듣기: {ep.get('link') or ix_row.get('link')}")
    return "\n".join(lines)


def send_podcast(eid, force=False):
    ix = json.load(open(PODCAST_INDEX, encoding="utf-8"))
    row = next((e for e in ix["episodes"] if e["id"] == eid), None)
    if not row:
        sys.exit(f"index.json 에 없는 에피소드: {eid}")
    if row.get("status") == "sent" and not force:
        print(f"이미 보냄({row.get('sent_at')}) — 다시 보내려면 --force")
        return
    path = os.path.join(PODCAST_EP, eid + ".json")
    if not os.path.exists(path):
        sys.exit(f"요약 파일이 아직 없습니다: docs/data/podcasts/ep/{eid}.json")
    ep = json.load(open(path, encoding="utf-8"))
    ids = send(podcast_message(ep, row))
    row["status"], row["sent_at"], row["tg_message_ids"] = "sent", datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"), ids
    with open(PODCAST_INDEX, "w", encoding="utf-8") as f:
        json.dump(ix, f, ensure_ascii=False, indent=1)
    print(f"보냄: {eid}")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return 0
    if a[0] == "--chat-id":
        ups = api("getUpdates", {})
        seen = {}
        for u in ups:
            m = u.get("message") or u.get("channel_post") or {}
            ch = m.get("chat") or {}
            if ch:
                seen[ch["id"]] = ch.get("title") or ch.get("username") or ch.get("first_name")
        if not seen:
            print("아직 받은 메시지가 없습니다 — 봇 대화방에 아무 말이나 보낸 뒤 다시 실행하세요.")
        for k, v in seen.items():
            print(f"chat_id = {k}   ({v})")
    elif a[0] == "--test":
        send("✅ 100억 알림 테스트 — 설정 완료 " + datetime.now(KST).strftime("%Y-%m-%d %H:%M"))
        print("보냄")
    elif a[0] == "--text":
        send(" ".join(a[1:]))
    elif a[0] == "--podcast":
        send_podcast(a[1], force="--force" in a)
    elif a[0] == "--podcast-pending":
        ix = json.load(open(PODCAST_INDEX, encoding="utf-8"))
        for e in sorted(ix["episodes"], key=lambda e: e.get("published", "")):
            if e.get("status") == "done" and os.path.exists(os.path.join(PODCAST_EP, e["id"] + ".json")):
                send_podcast(e["id"])
    elif a[0] == "--jp-report":
        rid = a[1]
        r = json.load(open(os.path.join(JP_REPORTS, rid + ".json"), encoding="utf-8"))
        npath = os.path.join(JP_REPORTS, "notes", rid + ".json")
        n = json.load(open(npath, encoding="utf-8")) if os.path.exists(npath) else {}
        txt = f"🇯🇵 <b>{esc(r.get('name'))}</b> ({esc(r.get('code'))}) 실적 · {esc(r.get('date'))}\n"
        txt += esc(n.get("tg") or n.get("headline") or "요약 준비 중") + f"\n\n📝 리포트: {SITE}jp-report.html?id={rid}"
        send(txt)
    else:
        print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
