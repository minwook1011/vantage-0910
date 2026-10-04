"""관리 계좌(사진으로 받은 매매기록)를 암호화해 사이트에 올린다.

원본: private/managed_accounts.json (gitignore — 공개 저장소에 평문으로 올리지 않음)
키:   private/pf_key.txt (없으면 새로 만든다. 사용자에게 한 번 알려 주고, 기기마다 포트폴리오 화면에서 한 번 입력)
결과: docs/data/pf/managed.enc.json  — AES-256-GCM, 키 = PBKDF2-SHA256(키 문구, salt, 200,000회)
      portfolio-managed.js 가 브라우저에서 풀어 그 계좌·매매기록을 통째로 교체한다.

사용: python pf_managed.py
"""
import base64
import json
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "private", "managed_accounts.json")
KEYF = os.path.join(ROOT, "private", "pf_key.txt")
OUT = os.path.join(ROOT, "docs", "data", "pf", "managed.enc.json")
ITER = 200_000


def key_phrase():
    if os.path.exists(KEYF):
        return open(KEYF, encoding="utf-8").read().strip()
    alpha = "abcdefghjkmnpqrstuvwxyz23456789"
    k = "-".join("".join(secrets.choice(alpha) for _ in range(4)) for _ in range(3))
    open(KEYF, "w", encoding="utf-8").write(k)
    print("새 키를 만들었습니다:", k)
    return k


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.load(open(SRC, encoding="utf-8"))
    data["updated"] = datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="minutes")
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(key_phrase().encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, raw, None)
    b64 = lambda b: base64.b64encode(b).decode()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"v": 1, "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}, open(OUT, "w", encoding="utf-8"))
    n = len(data.get("transactions", []))
    print(f"wrote {OUT} · 계좌 {len(data.get('accounts', []))}개 · 매매 {n}건 · {data['updated']}")


if __name__ == "__main__":
    main()
