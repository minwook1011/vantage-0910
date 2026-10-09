"""「포트폴리오 업데이트.xlsx」(메리츠 매매내역 붙여넣기)를 사이트 관리 파일로 올린다.

엑셀: OneDrive  민욱 동기화 폴더/포트폴리오 업데이트/포트폴리오 업데이트.xlsx
      계좌설정 · 내계좌 · 제현형님 · 종목매핑 시트 (형식은 엑셀의 사용법 시트)
결과: docs/data/pf/managed.enc.json  (kind:"excel" — 시트 칸을 그대로 담아 암호화)
      기기마다 portfolio-import.js 가 화면의 「엑셀 가져오기」와 똑같이 풀어서 반영한다.
      → 파서는 브라우저 쪽 하나뿐. 여기서는 칸 값만 옮긴다(날짜는 YYYY-MM-DD 로).

사용: python pf_excel.py [엑셀 경로]
      그다음 docs/data/pf/managed.enc.json 커밋·푸시.
"""
import datetime as dt
import os
import sys

import openpyxl

from pf_managed import OUT, write_encrypted

DEFAULT = os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop", "민욱 동기화 폴더", "포트폴리오 업데이트", "포트폴리오 업데이트.xlsx")


def cell(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def sheet_rows(ws):
    rows = []
    for r in ws.iter_rows(values_only=True):
        row = [cell(v) for v in r]
        while row and (row[-1] is None or row[-1] == ""):
            row.pop()
        rows.append(row)
    while rows and not rows[-1]:
        rows.pop()
    return rows


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    book = {ws.title: sheet_rows(ws) for ws in wb.worksheets if ws.title != "사용법"}
    if "계좌설정" not in book:
        sys.exit("계좌설정 시트가 없습니다 — 포트폴리오 업데이트 엑셀이 맞는지 확인하세요.")
    filled = [n for n, rows in book.items() if n not in ("계좌설정", "종목매핑") and len(rows) > 1]
    empty = [n for n, rows in book.items() if n not in ("계좌설정", "종목매핑") and len(rows) <= 1]
    if not filled:
        sys.exit("붙여넣은 매매내역이 없습니다(모든 계좌 시트가 비어 있음). 올리지 않습니다.")
    data = write_encrypted({"kind": "excel", "source": os.path.basename(path), "book": book})
    print(f"wrote {OUT} · 반영 시트 {', '.join(f'{n}({len(book[n]) - 1}줄)' for n in filled)}"
          + (f" · 빈 시트(기기의 기존 기록 유지) {', '.join(empty)}" if empty else "") + f" · {data['updated']}")


if __name__ == "__main__":
    main()
