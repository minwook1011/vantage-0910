/* 개인 포트폴리오 데이터: 이 브라우저의 localStorage에 저장하고, 로그인 시 firebase-sync.js가 기기 간 동기화 */
(function () {
  "use strict";
  var KEY = "vantage-portfolio-v1";
  var DEFAULT = {
    accounts: [{ id: "portfolio-1", name: "포트폴리오 1", cashKrw: 0, cashUsd: 0 }, { id: "portfolio-2", name: "포트폴리오 2", cashKrw: 0, cashUsd: 0 }],
    transactions: [], buyList: [], watchlist: [], prices: {}, fx: null
  };
  /* 국내 종목은 종목명으로도 입력할 수 있게 하되, 시세 조회에는 거래소 티커를 사용한다. */
  var KR_TICKERS = { "삼성전자": "005930.KS", "삼성전자우": "005935.KS", "파인텍": "131760.KQ", "파인엠텍": "441270.KQ", "441270": "441270.KQ", "티엘비": "356860.KQ", "TLB": "356860.KQ", "356860": "356860.KQ" };
  var KR_NAMES = { "005930": "삼성전자", "005935": "삼성전자우", "131760": "파인텍", "441270": "파인엠텍", "356860": "티엘비" };
  function id(prefix) { return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function load() {
    try {
      var parsed = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!parsed) return JSON.parse(JSON.stringify(DEFAULT));
      return {
        accounts: Array.isArray(parsed.accounts) && parsed.accounts.length ? parsed.accounts : JSON.parse(JSON.stringify(DEFAULT.accounts)),
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        buyList: Array.isArray(parsed.buyList) ? parsed.buyList : [],
        watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
        prices: parsed.prices || {}, fx: parsed.fx || null
      };
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULT)); }
  }
  function save(data) { localStorage.setItem(KEY, JSON.stringify(data)); return data; }
  function tickerFor(ticker, market) {
    ticker = String(ticker || "").trim().toUpperCase();
    var bare = ticker.replace(/\.(KS|KQ)$/i, "");
    if (market === "KR" && KR_TICKERS[bare]) return KR_TICKERS[bare];
    if (market === "KR" && !/\.(KS|KQ)$/.test(ticker)) return ticker + ".KS";
    return ticker;
  }
  /* 시장은 티커 모양으로 판단한다: .KS/.KQ, 6자리 국내 코드(숫자 5자리 + 숫자·영문 1자리), 한글 종목명 → 한국. 나머지 → 미국. */
  function marketOf(ticker) {
    var t = String(ticker || "").trim().toUpperCase();
    /* 국내 코드: 005930 같은 6자리 숫자, 0091A0·00104K 같은 신형(숫자 4자리 + 숫자·영문 2자리) */
    if (/\.(KS|KQ)$/.test(t) || /^\d{4}[0-9A-Z]{2}$/.test(t) || /[가-힣]/.test(t) || KR_TICKERS[t]) return "KR";
    return "US";
  }
  function displayTicker(ticker) { var bare = String(ticker || "").replace(/\.(KS|KQ)$/i, ""); return KR_NAMES[bare] || bare; }
  function groupKey(market, ticker) { return market + ":" + tickerFor(ticker, market); }
  function aggregate(data, accountId) {
    var result = {};
    data.transactions.filter(function (t) { return t.accountId === accountId; }).slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    }).forEach(function (t) {
      var market = t.market === "KR" ? "KR" : "US", ticker = tickerFor(t.ticker, market), key = groupKey(market, ticker);
      var h = result[key] || (result[key] = { key: key, market: market, ticker: ticker, qty: 0, costLocal: 0, costKrw: 0, realizedKrw: 0 });
      var qty = Number(t.qty) || 0, price = Number(t.price) || 0, fx = Number(t.fx) || Number(data.fx && data.fx.price) || 1350;
      if (t.side === "sell") {
        var sold = Math.min(qty, h.qty), avgLocal = h.qty ? h.costLocal / h.qty : 0, avgKrw = h.qty ? h.costKrw / h.qty : 0;
        h.realizedKrw += sold * (price * (market === "US" ? fx : 1) - avgKrw);
        h.qty -= sold; h.costLocal -= sold * avgLocal; h.costKrw -= sold * avgKrw;
      } else {
        h.qty += qty; h.costLocal += qty * price; h.costKrw += qty * price * (market === "US" ? fx : 1);
      }
    });
    return Object.keys(result).map(function (key) {
      var h = result[key]; if (h.qty <= 0.0000001) return null;
      var q = h.qty, quote = data.prices[h.key], current = quote && Number(quote.price);
      h.avgLocal = q ? h.costLocal / q : 0; h.avgKrw = q ? h.costKrw / q : 0;
      /* 0원·NaN은 실제 시세가 아니라 이전 조회 실패의 흔적이다. */
      h.price = isFinite(current) && current > 0 ? current : null; h.fx = Number(data.fx && data.fx.price) || 1350;
      h.valueKrw = h.price == null ? null : h.price * q * (h.market === "US" ? h.fx : 1);
      h.pnlKrw = h.valueKrw == null ? null : h.valueKrw - h.costKrw;
      h.returnPct = h.pnlKrw == null || !h.costKrw ? null : h.pnlKrw / h.costKrw * 100;
      h.updated = quote && quote.updated; return h;
    }).filter(Boolean).sort(function (a, b) { return (b.valueKrw || 0) - (a.valueKrw || 0); });
  }
  function quoteFromText(text, market) {
    var start = text.indexOf('{"chart"'); if (start < 0) throw new Error("quote unavailable");
    var json = JSON.parse(text.slice(start)), res = json && json.chart && json.chart.result && json.chart.result[0];
    var meta = res && res.meta || {}, closes = res && res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close || [];
    /* 장중·장후·직전 종가 순으로 쓰고, 모두 없으면 차트의 마지막 유효 종가를 사용한다. */
    var quote = meta.regularMarketPrice || meta.postMarketPrice || meta.preMarketPrice || meta.previousClose || meta.chartPreviousClose, quoteAt = meta.regularMarketTime || null;
    if (!isFinite(Number(quote)) || Number(quote) <= 0) {
      for (var i = closes.length - 1; i >= 0; i--) {
        if (isFinite(Number(closes[i])) && Number(closes[i]) > 0) { quote = Number(closes[i]); quoteAt = res.timestamp && res.timestamp[i] || null; break; }
      }
    }
    if (!isFinite(Number(quote)) || Number(quote) <= 0) throw new Error("invalid quote");
    return { price: Number(quote), currency: meta.currency || (market === "KR" ? "KRW" : "USD"), updated: new Date().toISOString(), quoteAt: quoteAt ? new Date(quoteAt * 1000).toISOString() : null };
  }
  async function quoteFor(symbol, market) {
    var source = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=1mo&interval=1d", response, text;
    /* 먼저 Yahoo를 직접 읽고, 브라우저에서 차단될 때만 읽기 전용 중계를 사용한다. 요청에는 티커만 포함된다. */
    try {
      response = await fetch(source, { cache: "no-store" }); if (!response.ok) throw new Error("quote unavailable");
      return quoteFromText(await response.text(), market);
    } catch (directError) {
      response = await fetch("https://r.jina.ai/" + source.replace("&", "%26"), { cache: "no-store" }); if (!response.ok) throw new Error("quote unavailable");
      text = await response.text(); return quoteFromText(text, market);
    }
  }
  /* 국내 종목은 코스피(.KS)·코스닥(.KQ)을 둘 다 조회해 더 최근 시세를 쓴다.
     Yahoo는 잘못된 시장 접미사에도 몇 년 전 가격을 돌려주는 경우가 있다 (예: 티엘비 356860.KS → 2024년 가격). */
  async function priceOne(market, ticker) {
    var symbol = tickerFor(ticker, market);
    if (market !== "KR" || !/^\d{4}[0-9A-Z]{2}\.(KS|KQ)$/.test(symbol)) return quoteFor(symbol, market);
    var other = symbol.replace(/\.(KS|KQ)$/, function (m) { return m === ".KS" ? ".KQ" : ".KS"; });
    var got = await Promise.all([symbol, other].map(function (s) { return quoteFor(s, market).catch(function () { return null; }); }));
    var best = got.filter(Boolean).sort(function (a, b) { return String(b.quoteAt || "").localeCompare(String(a.quoteAt || "")); })[0];
    if (!best) throw new Error("quote unavailable");
    return best;
  }
  /* 환율은 브라우저에서 바로 읽을 수 있는(CORS 허용) 곳부터 차례로 시도한다.
     frankfurter는 브라우저 요청을 막아서 예전엔 항상 실패하고 1,350원 고정값이 쓰였다. */
  var FX_SOURCES = [
    ["https://open.er-api.com/v6/latest/USD", function (j) { return j && j.rates && j.rates.KRW; }],
    ["https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", function (j) { return j && j.usd && j.usd.krw; }],
    ["https://api.frankfurter.app/latest?from=USD&to=KRW", function (j) { return j && j.rates && j.rates.KRW; }]
  ];
  async function fxUsdKrw() {
    for (var i = 0; i < FX_SOURCES.length; i++) {
      try {
        var response = await fetch(FX_SOURCES[i][0], { cache: "no-store" }); if (!response.ok) continue;
        var quote = Number(FX_SOURCES[i][1](await response.json()));
        if (isFinite(quote) && quote > 500 && quote < 3000) return { price: quote, currency: "KRW", updated: new Date().toISOString() };
      } catch (e) {}
    }
    throw new Error("fx unavailable");
  }
  async function refresh(data) {
    var prices = {}, fx = null, symbols = {}, failed = [];
    data.accounts.forEach(function (a) { aggregate(data, a.id).forEach(function (h) { symbols[h.key] = { market: h.market, ticker: h.ticker }; }); });
    data.watchlist.forEach(function (w) { symbols[groupKey(w.market, w.ticker)] = { market: w.market, ticker: tickerFor(w.ticker, w.market) }; });
    await Promise.all(Object.keys(symbols).map(async function (key) {
      try { prices[key] = await priceOne(symbols[key].market, symbols[key].ticker); } catch (e) { failed.push(displayTicker(symbols[key].ticker)); }
    }));
    window.PortfolioStore.lastFailed = failed;
    try { fx = await fxUsdKrw(); } catch (e) {}
    /* 시세 조회는 수 초가 걸린다. 그 사이 다른 기기의 기록이 동기화되어 들어왔을 수 있으므로
       조회 시작 시점의 data를 그대로 저장하지 않고, 최신 저장본에 시세·환율만 덮어쓴다. */
    var latest = load();
    Object.keys(latest.prices || {}).forEach(function (key) {
      var price = Number(latest.prices[key] && latest.prices[key].price);
      if (!isFinite(price) || price <= 0) delete latest.prices[key];
    });
    Object.keys(prices).forEach(function (key) { latest.prices[key] = prices[key]; });
    if (fx) latest.fx = fx;
    save(latest); return latest;
  }
  window.PortfolioStore = { load: load, save: save, id: id, aggregate: aggregate, refresh: refresh, tickerFor: tickerFor, displayTicker: displayTicker, groupKey: groupKey, marketOf: marketOf };
})();
