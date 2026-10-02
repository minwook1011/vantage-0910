"""이 PC(회사 PC)에서 도는 '파이썬만 돌리는' 수집 작업을 전용 git worktree 에서 실행하고 바로 푸시한다.

왜: 예약 작업 여러 개가 같은 저장소 폴더(C:\\dev\\vantage-0910)를 함께 쓰면, 한 작업이 파일을 쓰는 중에
다른 작업의 git pull --rebase 가 끼어들어 실패·충돌이 났다(2026-10-02). 수집 작업은 작업마다 따로 폴더를 쓴다.

    python pc_job.py --name kr -m "data: 한국 기업 주가·실적 갱신 {now} KST (PC)" \\
        --add docs/data/kr docs/data/kr_companies.json -- python fetch_kr_companies.py

- 전용 폴더: C:\\dev\\vantage-jobs\\<name> (없으면 git worktree add --detach 로 만든다)
- 매번 origin/main 최신으로 맞춘 뒤(그 폴더는 이 작업 전용이라 reset --hard 해도 된다) 명령을 돌리고,
  --add 경로만 커밋해 origin main 으로 푸시한다. 푸시가 밀리면 fetch → rebase → 재시도(최대 4번).
  같은 데이터 파일이 원격에서 먼저 바뀌어 충돌하면, 원격 것을 받고 명령을 한 번 더 돌린다.
- 명령이 실패하면(종료 코드 ≠ 0) 커밋하지 않는다. 결과는 마지막 줄 JSON 으로 출력.
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

REPO = os.path.dirname(os.path.abspath(__file__))
JOBS = os.path.join(os.path.dirname(REPO), "vantage-jobs")
KST = timezone(timedelta(hours=9))


def git(args, cwd, check=True):
    r = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 실패: {r.stderr.strip() or r.stdout.strip()}")
    return r


def ensure_worktree(name):
    path = os.path.join(JOBS, name)
    if not os.path.exists(os.path.join(path, ".git")):
        os.makedirs(JOBS, exist_ok=True)
        git(["worktree", "prune"], REPO, check=False)
        git(["fetch", "-q", "origin", "main"], REPO)
        git(["worktree", "add", "--detach", path, "origin/main"], REPO)
    return path


def sync(path):
    git(["fetch", "-q", "origin", "main"], path)
    git(["reset", "-q", "--hard", "origin/main"], path)
    git(["clean", "-qfd", "docs", "data_sources"], path, check=False)


def run_cmd(cmd, path):
    print(f"$ {' '.join(cmd)}  (폴더 {path})", flush=True)
    return subprocess.run(cmd, cwd=path).returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True, help="작업 이름(전용 폴더 이름)")
    ap.add_argument("-m", "--message", required=True, help="커밋 메시지({now} = 현재 KST 시각)")
    ap.add_argument("--add", nargs="+", required=True, help="커밋할 경로")
    ap.add_argument("cmd", nargs=argparse.REMAINDER, help="-- 뒤에 실행할 명령")
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd[:1] == ["--"] else a.cmd
    if not cmd:
        ap.error("실행할 명령이 없음(-- 뒤에 적기)")
    if cmd[0] in ("python", "python3"):
        cmd[0] = sys.executable

    path = ensure_worktree(a.name)
    out = {"job": a.name, "ok": False, "committed": False, "pushed": False}
    for attempt in range(2):  # 원격과 같은 데이터 파일이 충돌하면 원격 기준으로 한 번 더 돌린다
        sync(path)
        rc = run_cmd(cmd, path)
        if rc != 0:
            out["error"] = f"명령 종료 코드 {rc} — 커밋 안 함"
            print(json.dumps(out, ensure_ascii=False))
            return 1
        git(["add", "--"] + a.add, path, check=False)
        if git(["diff", "--cached", "--quiet"], path, check=False).returncode == 0:
            out.update(ok=True, note="바뀐 것 없음")
            print(json.dumps(out, ensure_ascii=False))
            return 0
        msg = a.message.replace("{now}", datetime.now(KST).strftime("%Y-%m-%d %H:%M"))
        git(["-c", "user.name=minwook1011", "-c", "user.email=minwook1011@gmail.com", "commit", "-q", "-m", msg], path)
        out["committed"] = True
        conflict = False
        for _ in range(4):
            if git(["push", "-q", "origin", "HEAD:main"], path, check=False).returncode == 0:
                out.update(ok=True, pushed=True)
                print(json.dumps(out, ensure_ascii=False))
                return 0
            git(["fetch", "-q", "origin", "main"], path)
            if git(["rebase", "-q", "origin/main"], path, check=False).returncode != 0:
                git(["rebase", "--abort"], path, check=False)
                print("원격과 같은 데이터 파일이 충돌 — 원격 기준으로 다시 돌린다", flush=True)
                conflict = True
                break
        if not conflict:
            break  # 충돌은 아닌데 푸시가 4번 거부됨 — 더 돌려도 소용없다
    out["error"] = "푸시 실패(충돌·거부 반복)"
    print(json.dumps(out, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
