/* portfolio-import.js — 「포트폴리오 업데이트.xlsx」(메리츠 매매내역 붙여넣기)를 읽어 계좌별 매매·입출금으로 바꾼다.
 *
 * 쓰는 곳 두 군데, 파서는 이것 하나:
 *   ① 포트폴리오 화면 「엑셀에서 가져오기」 — 브라우저가 엑셀을 읽어 바로 반영
 *   ② 관리 파일(data/pf/managed.enc.json, kind:"excel") — pf_excel.py 가 엑셀 시트를 칸 그대로 담아 암호화해 올리면
 *      기기마다 이 파서로 똑같이 풀어 반영(휴대폰처럼 동기화가 안 되는 기기용)
 *
 * 엑셀 구성: 「계좌설정」(시트 ↔ 사이트 계좌, 시드·예수금), 계좌마다 붙여넣기 시트(내계좌, 제현형님 …), 「종목매핑」(종목명 → 티커)
 * 붙여넣기 시트는 머리줄(거래일자·종목명·수량·단가 …)을 찾아 읽는다. 메리츠 화면처럼 한 거래가 2줄이면 머리줄도 2줄이라 그대로 2줄씩 묶어 읽는다.
 *
 * 반영 방식(apply): 붙여넣은 내역의 가장 이른 날짜부터는 엑셀이 정답 — 그 계좌의 그 날짜 이후 기록을 지우고 엑셀 것으로 채운다.
 * 그 전 기록은 그대로 둔다(최근 몇 달만 붙여넣어도 예전 기록이 사라지지 않게).
 * 메리츠는 국내 거래내역과 해외주식 거래내역이 다른 화면이라, 한 계좌에 시트를 둘(예: 내계좌_국내·내계좌_해외) 둘 수 있다.
 * 그때는 시트마다 자기 몫(국내 종목·원화 / 미국 종목·달러)만 바꿔서 서로의 기록을 지우지 않는다.
 */
(function () {
  "use strict";

  /* ───────── 머리줄 이름(띄어쓰기·괄호 무시) ───────── */
  var FIELDS = {
    date: ["거래일자", "거래일", "체결일자", "체결일", "매매일자", "매매일", "주문일자", "일자", "날짜"],
    type: ["거래구분", "거래종류", "거래유형", "적요명", "적요", "거래명", "매매구분", "구분", "매수/매도", "매수매도", "주문구분"],
    name: ["종목명", "종목", "상품명", "종목명/티커"],
    code: ["종목코드", "티커", "심볼", "코드", "종목번호"],
    market: ["시장", "국가", "거래소", "시장구분"],
    qty: ["거래수량", "체결수량", "수량", "주식수", "매매수량"],
    price: ["거래단가", "체결단가", "단가", "체결가", "체결가격", "매매단가"],
    amount: ["거래금액", "체결금액", "매매금액", "약정금액", "금액"],
    fee: ["수수료", "거래수수료", "매매수수료"],
    tax: ["제세금", "세금", "거래세", "농특세", "제세금합", "세금합계", "기타비용"],
    settle: ["정산금액", "결제금액", "입출금액", "입금액", "출금액", "반영금액"],
    fx: ["적용환율", "환율", "거래환율", "체결환율"],
    cur: ["통화", "통화코드", "통화구분", "결제통화", "거래통화"]
  };
  /* 칸 하나가 여러 필드에 걸리면(예: '금액'은 거래금액·정산금액 모두) 더 긴(구체적인) 이름이 이긴다 */
  function norm(s) { return String(s == null ? "" : s).replace(/[\s()\[\]·_\-:]/g, "").toLowerCase(); }
  function fieldOf(text) {
    var t = norm(text); if (!t || t.length > 14) return null;
    if (/잔고|잔액|잔량|예수금|평가|주문수량|주문단가|주문가|원주문|후금액/.test(t)) return null;   // 거래 후 잔고·주문 칸은 거래값이 아님
    var best = null, bl = 0;
    Object.keys(FIELDS).forEach(function (f) {
      FIELDS[f].forEach(function (k) { var nk = norm(k); if ((t === nk || (nk.length >= 2 && t.indexOf(nk) >= 0)) && nk.length > bl) { best = f; bl = nk.length; } });
    });
    return best;
  }

  /* ───────── 값 정리 ───────── */
  function clean(v) { return String(v == null ? "" : v).replace(/ /g, " ").trim(); }
  function numberOf(v) {
    if (typeof v === "number") return v;
    var s = clean(v); if (!s || s === "-") return NaN;
    var neg = /^\(.*\)$/.test(s) || /^[-−]/.test(s);
    s = s.replace(/[^\d.]/g, ""); if (!s) return NaN;
    var n = Number(s); return neg ? -n : n;
  }
  function pad(n) { return ("0" + n).slice(-2); }
  function excelSerialDate(n) {   // 1900 날짜 체계 일련번호 → YYYY-MM-DD (시간대 영향 없음)
    var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function dateOf(v) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + pad(v.getMonth() + 1) + "-" + pad(v.getDate());
    if (typeof v === "number" && v > 30000 && v < 80000) return excelSerialDate(v);
    var s = clean(v), m = s.match(/(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
    if (m) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    m = s.match(/^(20\d{2})(\d{2})(\d{2})$/);
    if (m) return m[1] + "-" + m[2] + "-" + m[3];
    return "";
  }

  /* ───────── 거래 종류 ───────── */
  function kindOf(text) {
    var t = clean(text).replace(/\s/g, "");
    if (!t) return null;
    if (/환전|외화매수|외화매도|환매수|환매도/.test(t)) return "fx";        // 계좌 안 원화↔달러 — 수익률과 무관
    if (/취소/.test(t)) return null;
    if (/배당세|배당소득세|원천세|원천징수|외국납부세/.test(t)) return "tax";
    if (/배당/.test(t)) return "div";
    if (/이자|이용료/.test(t)) return "int";
    if (/매도|sell/i.test(t)) return "sell";
    if (/매수|buy/i.test(t)) return "buy";
    if (/출금|송금|이체출|대체출|출고/.test(t)) return /출고/.test(t) ? "out-stock" : "out";
    if (/입금|이체입|대체입|입고/.test(t)) return /입고/.test(t) ? "in-stock" : "in";
    return null;
  }

  /* ───────── 종목명 → 티커 ───────── */
  var US_NAMES = {
    "엔비디아": "NVDA", "애플": "AAPL", "마이크로소프트": "MSFT", "아마존닷컴": "AMZN", "아마존": "AMZN", "알파벳a": "GOOGL", "알파벳c": "GOOG", "알파벳": "GOOGL",
    "메타플랫폼스": "META", "메타": "META", "테슬라": "TSLA", "브로드컴": "AVGO", "네비우스그룹": "NBIS", "네비우스": "NBIS", "ase테크놀로지": "ASX", "ase테크놀로지홀딩": "ASX",
    "ase": "ASX", "tsmc": "TSM", "타이완반도체": "TSM", "대만반도체": "TSM", "마이크론테크놀로지": "MU", "마이크론": "MU", "amd": "AMD", "어드밴스드마이크로디바이시스": "AMD",
    "팔란티어": "PLTR", "팔란티어테크놀로지스": "PLTR", "넷플릭스": "NFLX", "오라클": "ORCL", "코어위브": "CRWV", "인텔": "INTC", "퀄컴": "QCOM", "어플라이드머티어리얼즈": "AMAT",
    "램리서치": "LRCX", "kla": "KLAC", "슈퍼마이크로컴퓨터": "SMCI", "버티브홀딩스": "VRT", "버티브": "VRT", "아이온큐": "IONQ", "세레브라스": "CBRS", "세레브라스시스템즈": "CBRS",
    "코스트코": "COST", "월마트": "WMT", "버크셔해서웨이b": "BRK-B", "일라이릴리": "LLY", "노보노디스크": "NVO", "유나이티드헬스": "UNH", "jp모건체이스": "JPM", "비자": "V",
    "마스터카드": "MA", "어도비": "ADBE", "세일즈포스": "CRM", "시스코시스템즈": "CSCO", "arm홀딩스": "ARM", "암홀딩스": "ARM", "asml홀딩": "ASML", "asml": "ASML",
    "로빈후드마켓": "HOOD", "코인베이스글로벌": "COIN", "스트래티지": "MSTR", "마이크로스트래티지": "MSTR", "써클인터넷그룹": "CRCL", "델테크놀로지스": "DELL", "아리스타네트웍스": "ANET",
    "마벨테크놀로지": "MRVL", "샌디스크": "SNDK", "웨스턴디지털": "WDC", "씨게이트테크놀로지": "STX", "코히런트": "COHR", "루멘텀홀딩스": "LITE", "크레도테크놀로지그룹": "CRDO",
    "알리바바그룹홀딩": "BABA", "쿠팡": "CPNG", "우버테크놀로지스": "UBER", "스노우플레이크": "SNOW", "크라우드스트라이크": "CRWD", "오클로": "OKLO", "비스트라": "VST", "콘스텔레이션에너지": "CEG",
    "proshares울트라프로qqq": "TQQQ", "인베스코qqq": "QQQ", "spdrs&p500": "SPY", "디렉시온반도체3배": "SOXL"
  };
  function nameKey(s) { return clean(s).replace(/\s|\(.*?\)|주식회사|\(주\)|보통주|ADR|adr/g, "").toLowerCase(); }
  function tickerShape(s) {
    var t = clean(s).toUpperCase().replace(/^A(?=\d{6}$)/, "");          // 국내 코드 'A005930' 형태
    if (/^\d{4}[0-9A-Z]{2}$/.test(t) || /^\d{6}\.(KS|KQ)$/.test(t)) return { t: t, m: "KR" };
    t = t.replace(/\.(OQ|O|NQ|N|NY|OB|PK|AM)$/, "");                    // 메리츠 해외 종목코드 'AMZN.OQ'·'ASX.NY' → 거래소 꼬리표 떼기
    if (/^[A-Z][A-Z0-9.\-]{0,6}$/.test(t)) return { t: t, m: "US" };
    return null;
  }

  /* ctx: { map: {종목명키: {t, m}}, krNames: {이름키: 코드}, fx: {d:[], c:[]} } */
  function resolve(name, code, ctx) {
    var c = code && tickerShape(code); if (c) return c;
    var k = nameKey(name);
    if (k && ctx.map && ctx.map[k]) return ctx.map[k];
    var sh = tickerShape(name); if (sh) return sh;
    if (k && US_NAMES[k]) return { t: US_NAMES[k], m: "US" };
    if (k && ctx.krNames && ctx.krNames[k]) return { t: ctx.krNames[k], m: "KR" };
    return null;
  }
  function fxOn(ctx, date) {
    var h = ctx.fx; if (!h || !h.d || !h.d.length) return null;
    var lo = 0, hi = h.d.length - 1, ans = null;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (h.d[mid] <= date) { ans = h.c[mid]; lo = mid + 1; } else hi = mid - 1; }
    return ans || h.c[0];
  }

  /* 시트 이름으로 국내·해외 구분: '내계좌_해외' → 미국 종목·달러, '내계좌_국내' → 국내 종목·원화. 구분이 없으면 null */
  function sideOf(sheetName) {
    var s = String(sheetName || "");
    if (/해외|미국|외화|usd|(^|[^a-z])us([^a-z]|$)/i.test(s)) return { market: "US", cur: "USD" };
    if (/국내|한국|원화|krw|(^|[^a-z])kr([^a-z]|$)/i.test(s)) return { market: "KR", cur: "KRW" };
    return { market: null, cur: null };
  }

  /* ───────── 시트 하나 읽기 ───────── */
  function isHeaderRow(row) {
    var hits = 0, nums = 0;
    (row || []).forEach(function (v) { if (fieldOf(v)) hits++; if (typeof v === "number" || /^[\d,.\-]+$/.test(clean(v)) && clean(v)) nums++; });
    return hits >= 2 && nums <= 1;
  }
  function findLayout(rows) {
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      if (!isHeaderRow(rows[r])) continue;
      var span = 1; while (span < 3 && rows[r + span] && isHeaderRow(rows[r + span])) span++;
      var cols = {};
      for (var k = 0; k < span; k++) (rows[r + k] || []).forEach(function (v, c) {
        var f = fieldOf(v); if (!f) return;
        /* 같은 필드가 두 번 나오면 먼저 나온 칸을 쓴다(예: 1줄 '금액' + 2줄 '정산금액'은 다른 필드) */
        if (!cols[f]) cols[f] = { r: k, c: c };
      });
      if (cols.date && (cols.qty || cols.settle || cols.amount)) return { at: r, span: span, cols: cols };
    }
    return null;
  }
  function parseSheet(rows, sheetName, ctx) {
    var out = { sheet: sheetName, txs: [], flows: [], skipped: 0, ignored: {}, unresolved: {}, from: null, to: null, layout: null };
    var L = findLayout(rows || []); if (!L) { out.error = "머리줄(거래일자·종목명·수량·단가)을 찾지 못함"; return out; }
    out.layout = Object.keys(L.cols).join(",") + (L.span > 1 ? " · " + L.span + "줄 묶음" : "");
    function get(rec, f) { var p = L.cols[f]; return p ? (rec[p.r] || [])[p.c] : null; }
    var seen = {};
    function uid(parts) { var base = parts.join("|").replace(/[^0-9A-Za-z가-힣.|\-]/g, ""), n = (seen[base] = (seen[base] || 0) + 1); return "x-" + base + (n > 1 ? "|" + n : ""); }
    var mktDefault = sideOf(sheetName).market;
    /* 환율 칸이 없는 화면(메리츠 [7631] 거래내역 등)은 환전 줄(달러 금액 ↔ 원화 금액)에서 실제 환전 환율을 구해 쓴다 */
    var fxRows = [];   // { d: 날짜, n: 줄 순서, c: 원/달러 }
    for (var j = L.at + L.span; j < rows.length; j += L.span) {
      var fr = rows.slice(j, j + L.span), fd = dateOf(get(fr, "date"));
      if (!fd || kindOf(clean(get(fr, "type"))) !== "fx") continue;
      var a1 = Math.abs(numberOf(get(fr, "amount"))), a2 = Math.abs(numberOf(get(fr, "settle")));
      if (!(a1 > 0 && a2 > 0)) continue;
      var rt = Math.max(a1, a2) / Math.min(a1, a2);
      if (rt > 500 && rt < 3000) fxRows.push({ d: fd, n: j, c: Math.round(rt * 100) / 100 });
    }
    /* 그 거래 바로 전에 한 환전(날짜 → 같은 날이면 줄 순서)의 환율. 그 전 환전이 없으면 그날 시장 환율 */
    function usdRate(fx, date, n) {
      if (fx > 100) return fx;
      var best = null;
      fxRows.forEach(function (x) { if ((x.d < date || x.d === date && x.n < n) && (!best || x.d > best.d || x.d === best.d && x.n > best.n)) best = x; });
      return best ? best.c : (fxOn(ctx, date) || ctx.fxNow || 1350);
    }
    for (var i = L.at + L.span; i < rows.length; i += L.span) {
      var rec = rows.slice(i, i + L.span), date = dateOf(get(rec, "date"));
      if (!date) { if ((rec[0] || []).some(function (v) { return clean(v); })) out.skipped++; continue; }
      var typeText = clean(get(rec, "type")), kind = kindOf(typeText);
      var name = clean(get(rec, "name")), code = clean(get(rec, "code"));
      var qty = Math.abs(numberOf(get(rec, "qty"))), price = Math.abs(numberOf(get(rec, "price"))), amount = Math.abs(numberOf(get(rec, "amount")));
      var settle = numberOf(get(rec, "settle")), fee = Math.abs(numberOf(get(rec, "fee"))) || 0, tax = Math.abs(numberOf(get(rec, "tax"))) || 0;
      var fx = numberOf(get(rec, "fx")), curText = clean(get(rec, "cur")).toUpperCase(), mktText = clean(get(rec, "market"));
      if (!kind) { out.ignored[typeText || "(구분 없음)"] = (out.ignored[typeText || "(구분 없음)"] || 0) + 1; continue; }
      if (kind === "fx") { out.ignored[typeText] = (out.ignored[typeText] || 0) + 1; continue; }
      if (!out.from || date < out.from) out.from = date;
      if (!out.to || date > out.to) out.to = date;
      var cur = /USD|달러|\$/.test(curText) ? "USD" : /KRW|원/.test(curText) ? "KRW" : null;
      if (kind === "buy" || kind === "sell") {
        var r = resolve(name, code, ctx);
        if (!r) { var nk = name || code || "(이름 없음)"; out.unresolved[nk] = (out.unresolved[nk] || 0) + 1; continue; }
        var market = /한국|국내|kr|코스피|코스닥/i.test(mktText) ? "KR" : /미국|해외|us|나스닥|뉴욕|nyse|nasdaq|amex/i.test(mktText) ? "US" : cur === "USD" ? "US" : cur === "KRW" && r.m !== "US" ? "KR" : r.m || mktDefault || "US";
        if (!(qty > 0)) { out.skipped++; continue; }
        if (!(price > 0) && amount > 0) price = amount / qty;
        if (!(price > 0)) { out.skipped++; continue; }
        /* 국내: 이 계좌에 이미 있는 표기(예: 356860.KQ) > 상장시장 표(코스피 .KS·코스닥 .KQ) > 기본 규칙 */
        var bare = r.t.toUpperCase().replace(/\.(KS|KQ)$/, "");
        var ticker = market === "KR" ? ((ctx.krTick && ctx.krTick[bare]) || window_tickerFor(/\.(KS|KQ)$/.test(r.t) ? r.t.toUpperCase() : bare + ((ctx.krSfx && ctx.krSfx[bare]) || ""), "KR")) : r.t.toUpperCase();
        var rate = market === "US" ? usdRate(fx, date, i) : 1;
        out.txs.push({ id: uid([out.sheet, date, ticker, kind, qty, price]), date: date, market: market, ticker: ticker, side: kind, qty: qty, price: price, fee: Math.round((fee + tax) * 10000) / 10000, fx: rate, src: "excel", name: market === "KR" && name && !tickerShape(name) ? name : undefined, createdAt: date + "T00:00:00.000Z-" + ("00000" + i).slice(-6) });
      } else if (kind === "in-stock" || kind === "out-stock") {
        out.ignored[typeText] = (out.ignored[typeText] || 0) + 1;   // 주식 입·출고는 가격을 몰라 수익률에 넣지 않음 — 화면에 알림
      } else {
        var amt = Math.abs(isFinite(settle) && settle ? settle : amount);
        if (!(amt > 0)) { out.skipped++; continue; }
        var fcur = cur || (/[A-Z]/.test(code) && !/^\d/.test(code) ? "USD" : "KRW");
        out.flows.push({ id: uid([out.sheet, date, kind, fcur, amt]), date: date, kind: kind, cur: fcur, amt: amt, fx: fcur === "USD" ? usdRate(fx, date, i) : 1, memo: (typeText + " " + name).trim() });
      }
    }
    return out;
  }
  /* portfolio-store.js 가 있으면 그 규칙(코스피·코스닥 접미사)을 쓴다 */
  function window_tickerFor(t, m) { return typeof window !== "undefined" && window.PortfolioStore ? window.PortfolioStore.tickerFor(t, m) : (/\.(KS|KQ)$/.test(t) ? t : t + ".KS"); }

  /* ───────── 책 전체 읽기 ───────── */
  function cellText(v) { return v instanceof Date ? dateOf(v) : clean(v); }
  function readSettings(rows) {
    var list = [], head = -1;
    for (var r = 0; r < (rows || []).length; r++) { if ((rows[r] || []).some(function (v) { return /^시트/.test(norm(v)); })) { head = r; break; } }
    if (head < 0) return list;
    var H = rows[head].map(function (v) { return norm(v); });
    function col(re) { for (var i = 0; i < H.length; i++) if (re.test(H[i])) return i; return -1; }
    var cS = col(/시트/), cM = col(/계좌이름|포함|사이트/), cSeed = col(/시드/), cSD = col(/시작일/), cK = col(/원화예수금/), cU = col(/외화예수금|usd/), cOn = col(/반영/);
    for (var i = head + 1; i < rows.length; i++) {
      var row = rows[i] || [], sheet = clean(row[cS]); if (!sheet) continue;
      var on = cOn >= 0 ? clean(row[cOn]) : "";
      list.push({ sheet: sheet, match: cM >= 0 ? clean(row[cM]) : "", seed: cSeed >= 0 ? numberOf(row[cSeed]) : NaN, seedDate: cSD >= 0 ? dateOf(row[cSD]) : "",
        cashKrw: cK >= 0 ? numberOf(row[cK]) : NaN, cashUsd: cU >= 0 ? numberOf(row[cU]) : NaN, off: /아니|x|끔|제외|no/i.test(on) });
    }
    return list;
  }
  function readMap(rows) {
    var map = {};
    (rows || []).forEach(function (row, i) {
      if (!row || i === 0 && /종목/.test(clean(row[0]))) return;
      var k = nameKey(row[0]), t = clean(row[1]); if (!k || !t) return;
      var sh = tickerShape(t), m = /한국|국내|kr/i.test(clean(row[2])) ? "KR" : /미국|해외|us/i.test(clean(row[2])) ? "US" : sh ? sh.m : "US";
      map[k] = { t: sh ? sh.t : t.toUpperCase(), m: m };
    });
    return map;
  }
  /* book: { 시트이름: rows[][] } */
  function parseBook(book, ctx) {
    ctx = Object.assign({}, ctx || {});
    var names = Object.keys(book || {});
    var setName = names.filter(function (n) { return /계좌설정|설정/.test(n); })[0], mapName = names.filter(function (n) { return /매핑|종목표/.test(n); })[0];
    ctx.map = Object.assign({}, ctx.map || {}, mapName ? readMap(book[mapName]) : {});
    var settings = setName ? readSettings(book[setName]) : [];
    var dataSheets = names.filter(function (n) { return n !== setName && n !== mapName && !/사용법|안내|설명/.test(n); });
    /* 계좌설정의 '제현형님' 한 줄 → 「제현형님(국내)」「제현형님(해외)」처럼 그 이름으로 시작하는 시트 모두. 설정에 없는 시트도 그대로 읽는다 */
    var targets = [], used = {};
    settings.forEach(function (s) {
      dataSheets.filter(function (n) { return n === s.sheet || baseName(n) === s.sheet; }).forEach(function (n) { used[n] = 1; targets.push(Object.assign({}, s, { sheet: n })); });
    });
    dataSheets.forEach(function (n) { if (!used[n]) targets.push({ sheet: n, match: "" }); });
    var accounts = [];
    targets.forEach(function (s) {
      if (s.off || !book[s.sheet]) return;
      var rows = book[s.sheet];
      if (!rows.some(function (r) { return (r || []).some(function (v) { return cellText(v); }); })) return;   // 빈 시트(아직 안 붙여넣음)
      var p = parseSheet(rows, s.sheet, ctx);
      p.match = s.match; p.seed = s.seed; p.seedDate = s.seedDate; p.cashKrw = s.cashKrw; p.cashUsd = s.cashUsd;
      accounts.push(p);
    });
    return { accounts: accounts, sheets: names };
  }

  /* ───────── 상태에 반영 ───────── */
  function targetFor(state, p, all) {
    var accts = state.accounts;
    function has(a, k) { return k && String(a.name || "").replace(/\s/g, "").indexOf(String(k).replace(/\s/g, "")) >= 0; }
    if (p.match) { var m = accts.filter(function (a) { return has(a, p.match); })[0]; if (m) return m; }
    var bn = baseName(p.sheet).replace(/계좌/g, "");
    var bySheet = bn.length >= 2 ? accts.filter(function (a) { return has(a, bn); })[0] : null;
    if (bySheet) return bySheet;
    /* '내계좌'처럼 이름으로 못 찾으면: 다른 시트가 가리키는 계좌가 아닌 첫 계좌 */
    if (/^내/.test(p.sheet)) {
      var others = all.filter(function (x) { return baseName(x.sheet) !== baseName(p.sheet); }).map(function (x) { return x.match || baseName(x.sheet).replace(/계좌|형님|\s/g, ""); });
      var free = accts.filter(function (a) { return !others.some(function (k) { return has(a, k); }); })[0];
      if (free) return free;
    }
    return null;
  }
  /* parsed = parseBook 결과. opt: { stamp, newId(prefix), only(acct, p) → false 면 건너뜀 }. 반환: 계좌별 요약 */
  /* 같은 계좌로 가는 시트가 여럿이면(예: 내계좌_국내 + 내계좌_해외) 시트마다 자기 몫만 바꾼다.
     국내 시트 → 국내 종목 매매·원화 입출금, 해외 시트 → 미국 종목 매매·달러 입출금·배당. 이름에 구분이 없으면 붙여넣은 내용의 시장·통화로 정한다.
     이름에 국내·해외가 들어간 시트는 혼자 붙여넣어도 자기 몫만 바꾼다(해외만 새로 붙여넣어도 국내 기록이 남게).
     이름에 구분이 없는 시트가 계좌에 하나뿐이면 예전처럼 그 날짜 이후 계좌 기록 전체를 바꾼다. */
  function scopeOf(p) {
    /* 이름의 구분 + 실제로 붙여넣은 내용의 시장·통화(국내·미국이 같이 나오는 [7631] 거래내역을 _국내 시트에 붙여도 둘 다 바뀌게) */
    var side = sideOf(p.sheet), mk = {}, cu = {};
    if (side.market) { mk[side.market] = 1; cu[side.cur] = 1; }
    p.txs.forEach(function (t) { mk[t.market] = 1; }); p.flows.forEach(function (f) { cu[f.cur] = 1; });
    var label = mk.KR && mk.US ? "국내·해외분" : mk.US ? "해외분만" : mk.KR ? "국내분만" : "이 시트 통화분만";
    return { market: function (m) { return !!mk[m]; }, cur: function (c) { return !!cu[c]; }, label: label };
  }
  /* '제현형님(국내)'·'내계좌_해외'·'내계좌 US' → '제현형님'·'내계좌' */
  function baseName(sheet) { return String(sheet || "").replace(/[\s_\-]*[(\[]?\s*(국내|해외|한국|미국|원화|외화|KRW|USD|KR|US)\s*[)\]]?$/i, "").trim() || sheet; }

  /* parsed = parseBook 결과. opt: { stamp, newId(prefix), only(acct, p) → false 면 건너뜀 }. 반환: 시트별 요약 */
  function apply(state, parsed, opt) {
    opt = opt || {};
    var stamp = opt.stamp || new Date().toISOString(), report = [], groups = [], byKey = {};
    state.transactions = state.transactions || [];
    /* ① 시트 → 계좌 묶기(계좌를 새로 만들 때도 국내·해외 시트는 한 계좌로) */
    parsed.accounts.forEach(function (p) {
      var line = { sheet: p.sheet, error: p.error, unresolved: p.unresolved, ignored: p.ignored, skipped: p.skipped, layout: p.layout };
      if (p.error || !p.from) { line.error = line.error || "반영할 거래가 없음"; report.push(line); return; }
      var a = targetFor(state, p, parsed.accounts), key = a ? "id:" + a.id : "new:" + baseName(p.sheet);
      if (!byKey[key]) { byKey[key] = { a: a, items: [] }; groups.push(byKey[key]); }
      byKey[key].items.push({ p: p, line: line });
      report.push(line);
    });
    /* ② 계좌마다 한 번에 반영 */
    groups.forEach(function (g) {
      var first = g.items[0].p, a = g.a;
      if (!a) {
        a = { id: (opt.newId ? opt.newId("account") : "account-" + Date.now().toString(36)), name: g.items.length > 1 ? baseName(first.sheet) : first.sheet, cashKrw: 0, cashUsd: 0 };
        state.accounts.push(a); g.items.forEach(function (it) { it.line.created = true; });
      }
      /* 이미 더 최근에 가져온 계좌면(관리 파일) 이 계좌의 시트는 모두 건너뜀 — 반영 전에 한 번만 판단 */
      if (opt.only && opt.only(a, first) === false) { g.items.forEach(function (it) { it.line.kept = true; it.line.account = a.name; }); return; }
      var multi = g.items.length > 1, from = null, to = null;
      g.items.forEach(function (it) {
        var p = it.p, sc = multi || sideOf(p.sheet).market ? scopeOf(p) : null;   // 이름에 국내·해외가 있으면 혼자여도 자기 몫만
        var newTx = {}, newFl = {};
        p.txs.forEach(function (t) { newTx[t.id] = 1; }); p.flows.forEach(function (f) { newFl[f.id] = 1; });
        function dropTx(t) { return t.accountId === a.id && (newTx[t.id] || t.date >= p.from && (!sc || sc.market(t.market))); }
        function dropFl(f) { return newFl[f.id] || f.date >= p.from && (!sc || sc.cur(f.cur)); }
        var before = state.transactions.filter(dropTx).length;
        state.transactions = state.transactions.filter(function (t) { return !dropTx(t); })
          .concat(p.txs.map(function (t) { return Object.assign({}, t, { accountId: a.id }); }));
        a.flows = (a.flows || []).filter(function (f) { return !dropFl(f); }).concat(p.flows);
        if (p.seed > 0) { a.seed = p.seed; a.seedDate = p.seedDate || a.seedDate || p.from; }
        if (isFinite(p.cashKrw) && p.cashKrw >= 0) a.cashKrw = p.cashKrw;
        if (isFinite(p.cashUsd) && p.cashUsd >= 0) a.cashUsd = p.cashUsd;
        if (!from || p.from < from) from = p.from;
        if (!to || p.to > to) to = p.to;
        var L = it.line; L.account = a.name; L.from = p.from; L.to = p.to; L.trades = p.txs.length; L.flows = p.flows.length; L.replaced = before;
        if (sc) L.scope = sc.label;
      });
      a.importedAt = stamp; a.importFrom = from; a.importTo = to;
    });
    return report;
  }
  function describe(report) {
    return report.map(function (r) {
      var s = "• " + r.sheet + (r.account ? " → " + r.account : "") + ": ";
      if (r.error) s += r.error;
      else if (r.kept) s += "이 기기에 더 최근에 가져온 기록이 있어 건너뜀";
      else s += r.from + " ~ " + r.to + " · 매매 " + r.trades + "건" + (r.flows ? " · 입출금·배당 " + r.flows + "건" : "") + " (그 기간 기존 기록" + (r.scope ? " 중 " + r.scope : "") + " " + r.replaced + "건 교체)" + (r.created ? " · 새 계좌 만듦" : "");
      var un = Object.keys(r.unresolved || {}); if (un.length) s += "\n   ⚠️ 티커를 못 찾은 종목(종목매핑 시트에 추가): " + un.join(", ");
      var ig = Object.keys(r.ignored || {}).filter(function (k) { return !/환전/.test(k); }); if (ig.length) s += "\n   · 계산에서 뺀 줄: " + ig.map(function (k) { return k + " " + r.ignored[k] + "건"; }).join(", ");
      return s;
    }).join("\n");
  }

  /* 브라우저: 종목명 표(국내)·환율 기록을 사이트에서 받아 ctx 를 만든다 */
  async function context(state) {
    var ctx = { krNames: {}, krSfx: {}, krTick: {}, fx: null, fxNow: Number(state && state.fx && state.fx.price) || 1350 };
    try {
      var r = await fetch("data/kr_companies.json", { cache: "no-cache" });
      if (r.ok) ((await r.json()).companies || []).forEach(function (c) { if (c.name && c.code) { ctx.krNames[nameKey(c.name)] = c.code; ctx.krSfx[c.code] = /KOSDAQ|코스닥/i.test(c.market || "") ? ".KQ" : ".KS"; } });
    } catch (e) {}
    try { var b = await fetch("data/bench_hist.json", { cache: "no-cache" }); if (b.ok) ctx.fx = ((await b.json()).series || {})["KRW=X"] || null; } catch (e) {}
    /* 화면에 이미 있는 기록의 국내 종목 이름도 쓴다 */
    if (typeof window !== "undefined" && window.PortfolioStore) {
      ((state && state.transactions) || []).forEach(function (t) {
        if (t.market !== "KR") return;
        var code = String(t.ticker).toUpperCase().replace(/\.(KS|KQ)$/, ""), n = window.PortfolioStore.displayTicker(t.ticker);
        if (/\.(KS|KQ)$/i.test(t.ticker)) ctx.krTick[code] = String(t.ticker).toUpperCase();
        if (n && !/^\d/.test(n)) ctx.krNames[nameKey(n)] = code;
      });
    }
    return ctx;
  }
  /* SheetJS 통합문서 → { 시트이름: rows } (날짜는 일련번호 그대로 두고 dateOf 가 바꾼다 — 시간대 밀림 방지) */
  function bookFromWorkbook(wb) {
    var out = {};
    wb.SheetNames.forEach(function (n) { out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true }); });
    return out;
  }
  /* 이 파일이 '포트폴리오 업데이트' 형식인가(계좌설정 시트가 있거나 붙여넣기 시트에 메리츠식 머리줄이 있음) */
  function looksLikeBook(book) {
    return Object.keys(book).some(function (n) { return /계좌설정/.test(n); });
  }

  var api = { parseBook: parseBook, parseSheet: parseSheet, apply: apply, describe: describe, context: context, bookFromWorkbook: bookFromWorkbook, looksLikeBook: looksLikeBook, dateOf: dateOf, kindOf: kindOf, resolve: resolve };
  if (typeof window !== "undefined") window.PortfolioImport = api;
  if (typeof module !== "undefined") module.exports = api;
})();
