"""CNN 공포·탐욕 지수(Fear & Greed Index) 공식 값 — CNN 사이트가 쓰는 데이터 주소에서 받는다(2026-10-07 사용자 요청).

CNN 은 미국 장중 몇 분마다 값을 바꾸고 장 마감 뒤 그날 값을 확정한다. 30분마다 확인해(vantage-fast-collect)
CNN 쪽 갱신 시각(timestamp)이 바뀌었을 때만 docs/data/fear_greed.json 을 다시 쓴다 → 바뀔 때마다 사이트에 반영.
출력: score·rating(한국어)·timestamp(CNN 갱신 시각)·전일/1주/1달/1년 전 값·최근 1년 일별 값·7개 세부 지표.
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs", "data", "fear_greed.json")
URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
KST = timezone(timedelta(hours=9))
KO = {"extreme fear": "극도 공포", "fear": "공포", "neutral": "중립", "greed": "탐욕", "extreme greed": "극도 탐욕"}
SUB = {"market_momentum_sp500": "주가 모멘텀(S&P500 vs 125일 평균)", "stock_price_strength": "주가 강도(52주 신고가·신저가)",
       "stock_price_breadth": "주가 폭(상승·하락 거래량)", "put_call_options": "풋/콜 옵션 비율", "market_volatility_vix": "변동성(VIX)",
       "junk_bond_demand": "정크본드 수요", "safe_haven_demand": "안전자산 수요(주식 vs 채권)"}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    d = None
    hdr = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
           "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
           "Origin": "https://edition.cnn.com", "Referer": "https://edition.cnn.com/markets/fear-and-greed"}
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(URL, headers=hdr), timeout=30))
    except Exception as e:
        # CNN 이 파이썬 요청을 418 로 막을 때가 있다 → curl 로 다시
        import subprocess
        print("파이썬 요청 실패", e, "→ curl 재시도")
        out = subprocess.run(["curl", "-s", "-m", "30", "-A", hdr["User-Agent"], "-H", "Referer: " + hdr["Referer"], URL], capture_output=True).stdout
        d = json.loads(out.decode("utf-8"))
    fg = d["fear_and_greed"]
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        old = {}
    if old.get("timestamp") == fg["timestamp"]:
        print("변경 없음 (CNN 갱신", fg["timestamp"], ")")
        return 0
    hist = []
    for p in (d.get("fear_and_greed_historical") or {}).get("data") or []:
        day = datetime.fromtimestamp(p["x"] / 1000, timezone.utc).strftime("%Y-%m-%d")
        if hist and hist[-1][0] == day:
            hist[-1] = [day, round(p["y"], 1)]
        else:
            hist.append([day, round(p["y"], 1)])
    subs = []
    for k, nm in SUB.items():
        v = d.get(k) or {}
        if v.get("score") is not None:
            subs.append({"key": k, "name": nm, "score": round(v["score"], 1), "rating": KO.get(str(v.get("rating", "")).lower(), v.get("rating"))})
    ts = datetime.fromisoformat(fg["timestamp"])
    doc = {"source": "CNN Fear & Greed Index", "source_url": "https://edition.cnn.com/markets/fear-and-greed",
           "score": round(fg["score"], 1), "rating": KO.get(str(fg["rating"]).lower(), fg["rating"]),
           "timestamp": fg["timestamp"], "updated_kst": ts.astimezone(KST).strftime("%Y-%m-%d %H:%M"),
           "previous_close": round(fg.get("previous_close") or 0, 1), "previous_1_week": round(fg.get("previous_1_week") or 0, 1),
           "previous_1_month": round(fg.get("previous_1_month") or 0, 1), "previous_1_year": round(fg.get("previous_1_year") or 0, 1),
           "history": hist, "components": subs, "checked_kst": datetime.now(KST).strftime("%Y-%m-%d %H:%M")}
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"저장: {doc['score']} {doc['rating']} · CNN 갱신 {doc['updated_kst']} KST · 일별 {len(hist)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
