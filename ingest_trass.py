"""TRASS 순별 수출 관측값을 docs/data/trass_exports.json에 반영한다.

TRASS는 매월 1~10일·1~20일·월 전체 잠정치를 품목별로 낸다. 이 스크립트는
그 값을 (품목, 월, 구간) 단위로 저장하고, 같은 칸의 값이 바뀌면 정정 이력을 남긴다.
YoY·MoM·단가는 저장하지 않고 화면(trass-exports.js)이 같은 구간끼리 계산한다.

TRASS 계정 로그인은 자동화하지 않는다. TRASS에서 확인한 값을 아래 방법으로 넣는다.

  # 한 칸 입력 (금액은 달러, 중량은 순중량 kg)
  python ingest_trass.py add --item dram --month 2026-09 --span D20 --usd 10643860000 --kg 143474

  # 여러 칸을 CSV로 한 번에 (양식: data_sources/trass_template.csv)
  python ingest_trass.py csv data_sources/trass_input.csv

  # 저장된 값 확인
  python ingest_trass.py list --month 2026-09
"""
import argparse, csv, json, os, sys
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "docs", "data", "trass_exports.json")
SPANS = ("D10", "D20", "M")
REPORTED_KEYS = ("price", "usd_yoy", "usd_mom", "price_yoy", "price_mom")


def load():
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    data["updated_at"] = datetime.now(KST).strftime("%Y-%m-%d")
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def num(v):
    if v is None or str(v).strip() == "":
        return None
    return float(str(v).replace(",", ""))


def validate(data, item, month, span, usd, kg):
    ids = {it["id"] for it in data["items"]}
    if item not in ids:
        sys.exit(f"알 수 없는 품목 '{item}'. 가능한 값: {', '.join(sorted(ids))} (새 품목은 JSON items에 먼저 추가)")
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        sys.exit(f"월 형식은 YYYY-MM 이어야 한다: {month}")
    if span not in SPANS:
        sys.exit(f"구간은 {SPANS} 중 하나: {span}")
    if usd is None or usd < 0:
        sys.exit("수출금액(usd)은 0 이상의 달러 금액이어야 한다")
    if kg is not None and kg <= 0:
        sys.exit("중량(kg)은 0보다 커야 한다 (모르면 비워둔다)")


def upsert(data, item, month, span, usd, kg, source, reported):
    """같은 (품목, 월, 구간)이 있으면 갱신하고, 값이 바뀌면 이전 값을 history에 남긴다."""
    validate(data, item, month, span, usd, kg)
    today = datetime.now(KST).strftime("%Y-%m-%d")
    for ob in data["observations"]:
        if (ob["item"], ob["month"], ob["span"]) != (item, month, span):
            continue
        if ob["usd"] == usd and ob.get("kg") == kg:
            return "unchanged"
        ob.setdefault("history", []).append({"usd": ob["usd"], "kg": ob.get("kg"), "until": today, "source": ob.get("source")})
        ob.update({"usd": usd, "kg": kg, "source": source or ob.get("source"), "revised_at": today})
        if reported:
            ob["reported"] = reported
        return "revised"
    ob = {"item": item, "month": month, "span": span, "usd": usd, "kg": kg,
          "source": source or "TRASS", "first_seen_at": today, "revised_at": None}
    if reported:
        ob["reported"] = reported
    data["observations"].append(ob)
    data["observations"].sort(key=lambda o: (o["month"], SPANS.index(o["span"]), o["item"]))
    return "added"


def cmd_add(a):
    data = load()
    usd, kg = num(a.usd), num(a.kg)
    r = upsert(data, a.item, a.month, a.span, usd, kg, a.source, None)
    save(data)
    print(f"{r}: {a.item} {a.month} {a.span} usd={usd:,.0f} kg={kg if kg is None else f'{kg:,.0f}'}")


def cmd_csv(a):
    data = load()
    counts = {"added": 0, "revised": 0, "unchanged": 0}
    with open(a.path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if not (row.get("item") or "").strip() or row["item"].startswith("#"):
                continue
            reported = {k: num(row.get(k)) for k in REPORTED_KEYS if num(row.get(k)) is not None}
            r = upsert(data, row["item"].strip(), row["month"].strip(), row["span"].strip(),
                       num(row.get("usd")), num(row.get("kg")), (row.get("source") or "").strip() or None,
                       reported or None)
            counts[r] += 1
    save(data)
    print(f"완료 — 추가 {counts['added']}, 정정 {counts['revised']}, 변화없음 {counts['unchanged']}")


def cmd_list(a):
    data = load()
    labels = {it["id"]: it["label"] for it in data["items"]}
    for ob in data["observations"]:
        if a.month and ob["month"] != a.month:
            continue
        kg = ob.get("kg")
        price = f"{ob['usd'] / kg:,.0f} $/kg" if kg else "-"
        print(f"{ob['month']} {data['spans'][ob['span']]:>5}  {labels.get(ob['item'], ob['item']):<18} "
              f"${ob['usd'] / 1e8:>8,.1f}억  단가 {price}")


def main():
    p = argparse.ArgumentParser(description="TRASS 순별 수출 관측값 입력")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="한 칸 입력")
    a.add_argument("--item", required=True)
    a.add_argument("--month", required=True, help="YYYY-MM")
    a.add_argument("--span", required=True, choices=SPANS, help="D10=1~10일, D20=1~20일, M=월 전체")
    a.add_argument("--usd", required=True, help="수출금액(달러)")
    a.add_argument("--kg", help="순중량(kg). 모르면 생략 — 단가가 계산되지 않는다")
    a.add_argument("--source", help="출처 메모 (기본: TRASS)")
    a.set_defaults(fn=cmd_add)
    c = sub.add_parser("csv", help="CSV 일괄 입력 (data_sources/trass_template.csv 양식)")
    c.add_argument("path")
    c.set_defaults(fn=cmd_csv)
    l = sub.add_parser("list", help="저장된 값 보기")
    l.add_argument("--month")
    l.set_defaults(fn=cmd_list)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
