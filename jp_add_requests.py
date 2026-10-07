"""일본 스크리너 '추가할 종목' 요청 처리 도우미 (2026-10-07 사용자: 화면 오른쪽 칸에 적은 종목을 매일 00시에 확인해 추가).

화면의 '추가할 종목' 칸 → 깃허브 이슈(제목 "[추가할 종목] …")로 요청이 남는다(공개 저장소라 누구나 이슈를 열 수 있으므로
저장소 주인(OWNER)이 쓴 것만 받는다). 이 스크립트는 읽기·기록만 하고, 이름 → 코드 확인·카테고리 고르기·수집은 예약 작업이 한다.

    python jp_add_requests.py --list                       # 아직 처리 안 한 요청(JSON)
    python jp_add_requests.py --done 12 --market jp --text "7769, 리듬" --added 7769 --note "…"   # 처리 결과 기록(미국은 --market us)
    python jp_add_requests.py --done 12 --failed "고라쿠엔 홀딩스(상장 안 됨)"

기록: docs/data/jp/add_requests.json  {"updated", "items":[{"n":이슈번호, "text", "at", "status":"added|failed|partial", "added":[…], "failed":[…], "note", "done_at"}]}
화면이 이 파일로 '추가됨 / 못 찾음'을 보여 준다.
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "docs", "data", "jp", "add_requests.json")
REPO = "minwook1011/vantage-0910"
OWNER = "minwook1011"
PREFIXES = {"[추가할 종목]": "jp", "[추가할 종목·미국]": "us"}   # 일본 스크리너 / 미국 실적 화면
KST = timezone(timedelta(hours=9))


def load():
    try:
        return json.load(open(OUT, encoding="utf-8"))
    except Exception:
        return {"items": []}


def save(d):
    d["updated"] = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    json.dump(d, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def issues():
    url = f"https://api.github.com/repos/{REPO}/issues?state=all&per_page=100"
    req = urllib.request.Request(url, headers={"User-Agent": "vantage-bot", "Accept": "application/vnd.github+json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def main():
    a = sys.argv[1:]
    d = load()
    done = {x["n"] for x in d["items"] if x.get("status")}
    if "--list" in a:
        out = []
        for it in issues():
            pre = next((p for p in PREFIXES if (it.get("title") or "").startswith(p)), None)
            if it.get("pull_request") or not pre:
                continue
            if (it.get("user") or {}).get("login") != OWNER:
                continue   # 다른 사람이 연 요청은 받지 않는다
            if it["number"] in done:
                continue
            text = (it["title"][len(pre):] + "\n" + (it.get("body") or "")).strip()
            text = re.sub(r"\n?—+\n.*$", "", text, flags=re.S).strip()   # 화면이 붙인 안내문 제거
            out.append({"n": it["number"], "market": PREFIXES[pre], "text": text, "at": it["created_at"], "url": it["html_url"]})
        print(json.dumps(out, ensure_ascii=False, indent=1))
        return 0
    if "--done" in a:
        n = int(a[a.index("--done") + 1])
        added = [c for c in (a[a.index("--added") + 1].split(",") if "--added" in a else []) if c]
        failed = [c for c in (a[a.index("--failed") + 1].split(",") if "--failed" in a else []) if c]
        note = a[a.index("--note") + 1] if "--note" in a else ""
        text = a[a.index("--text") + 1] if "--text" in a else ""
        x = next((x for x in d["items"] if x["n"] == n), None)
        if not x:
            x = {"n": n}
            d["items"].insert(0, x)
        mk = a[a.index("--market") + 1] if "--market" in a else x.get("market", "jp")
        x.update({"market": mk, "text": text or x.get("text", ""), "added": added, "failed": failed, "note": note,
                  "status": "added" if added and not failed else "partial" if added else "failed",
                  "done_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M")})
        d["items"] = d["items"][:100]
        save(d)
        print(f"기록: 요청 {n} → 추가 {added} · 못 찾음 {failed}")
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
