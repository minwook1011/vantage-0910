(function () {
  "use strict";
  var S = window.PortfolioStore, state = S.load(), activeId = state.accounts[0].id, lastTransactionDate = new Date().toISOString().slice(0, 10);
  var COLORS = ["#6e9cff", "#ff7c8e", "#f0b429", "#58d3a6", "#b894ff", "#64b7ff", "#ff9d63", "#d5dfef"];
  function esc(v) { return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function num(v, digits) { return Number(v || 0).toLocaleString("ko-KR", { maximumFractionDigits: digits == null ? 0 : digits }); }
  function krw(v) { return v == null ? "—" : "₩" + num(v); }
  function local(v, market) { return v == null ? "—" : (market === "US" ? "$" : "₩") + num(v, market === "US" ? 2 : 0); }
  function pct(v) { return v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }
  function active() { return state.accounts.filter(function (a) { return a.id === activeId; })[0] || state.accounts[0]; }
  /* 시세를 못 받아온 종목을 0원으로 계산하면 매수금액 전체가 손실처럼 보인다.
     따라서 모든 보유 종목에 유효 시세가 있을 때만 평가액과 평가손익을 확정한다. */
  function valuation() {
    var holdings = S.aggregate(state, activeId), pending = holdings.filter(function (h) { return h.valueKrw == null; }), valued = holdings.filter(function (h) { return h.valueKrw != null; });
    return {
      holdings: holdings,
      pending: pending,
      complete: pending.length === 0,
      valued: valued,
      valueKrw: valued.reduce(function (sum, h) { return sum + h.valueKrw; }, 0),
      costKrw: valued.reduce(function (sum, h) { return sum + h.costKrw; }, 0)
    };
  }
  function holdingsValue() { return valuation().valueKrw; }
  function cashInfo() {
    var account = active(), fx = Number(state.fx && state.fx.price) || 1350, krw = Math.max(0, Number(account.cashKrw) || 0), usd = Math.max(0, Number(account.cashUsd) || 0);
    return { krw: krw, usd: usd, fx: fx, usdKrw: usd * fx, total: krw + usd * fx };
  }
  function allValue() { return holdingsValue() + cashInfo().total; }
  function renderTabs() {
    document.getElementById("account-tabs").innerHTML = state.accounts.map(function (a) {
      return '<button class="account-tab' + (a.id === activeId ? " on" : "") + '" data-account="' + esc(a.id) + '">' + esc(a.name) + '</button>';
    }).join("");
    document.querySelectorAll(".account-tab").forEach(function (b) { b.onclick = function () { activeId = b.dataset.account; render(); }; });
  }
  function ring(items, total, holdingCount, accountName) {
    var name = esc(accountName || "포트폴리오");
    if (!items.length || !total) return '<div class="ring-block"><div class="allocation-ring"><svg viewBox="0 0 220 220"><circle class="ring-track" cx="110" cy="110" r="88"></circle></svg><div class="ring-center"><span class="account-name">' + name + '</span><span class="label">주식 비중</span><b>0.0%</b><small>현금 비중 0.0%</small><em>원화 환산 기준</em></div></div></div>';
    var circumference = 2 * Math.PI * 88, offset = 0, paths = items.map(function (h, i) {
      var ratio = (h.valueKrw || 0) / total, length = Math.max(0, circumference * ratio - 4), item = '<circle class="ring-segment" cx="110" cy="110" r="88" stroke="' + COLORS[i % COLORS.length] + '" stroke-dasharray="' + length + ' ' + (circumference - length) + '" stroke-dashoffset="' + (-offset) + '"></circle>';
      offset += circumference * ratio; return item;
    }).join("");
    var legend = items.map(function (h, i) { var label = h.ticker === "원화 예수금" || h.ticker === "외화 예수금" ? h.ticker : S.displayTicker(h.ticker), ratio = (h.valueKrw || 0) / total * 100; return '<div class="ring-legend-item"><i style="background:' + COLORS[i % COLORS.length] + '"></i><span>' + esc(label) + '</span><b>' + ratio.toFixed(1) + '%</b></div>'; }).join("");
    var stockValue = items.reduce(function (sum, h) { return sum + (h.ticker === "원화 예수금" || h.ticker === "외화 예수금" ? 0 : Number(h.valueKrw) || 0); }, 0), stockPct = stockValue / total * 100, cashPct = Math.max(0, 100 - stockPct);
    return '<div class="ring-block"><div class="allocation-ring"><svg viewBox="0 0 220 220"><circle class="ring-track" cx="110" cy="110" r="88"></circle>' + paths + '</svg><div class="ring-center"><span class="account-name">' + name + '</span><span class="label">주식 비중</span><b>' + stockPct.toFixed(1) + '%</b><small>현금 비중 ' + cashPct.toFixed(1) + '%</small><em>원화 환산 기준</em></div></div><div class="ring-legend">' + legend + '</div></div>';
  }
  function renderSummary() {
    var account = active(), snapshot = valuation(), holdings = snapshot.holdings, invested = snapshot.valueKrw, cash = cashInfo(), total = allValue(), cost = snapshot.costKrw, pnl = invested - cost, rate = cost ? pnl / cost * 100 : null, fxLabel = num(cash.fx, 2);
    var allocation = holdings.slice(); if (cash.krw) allocation.push({ ticker: "원화 예수금", valueKrw: cash.krw }); if (cash.usdKrw) allocation.push({ ticker: "외화 예수금", valueKrw: cash.usdKrw });
    var list = allocation.map(function (h, i) { var label = h.ticker === "원화 예수금" || h.ticker === "외화 예수금" ? h.ticker : S.displayTicker(h.ticker), weight = total && h.valueKrw != null ? h.valueKrw / total * 100 : 0; return '<div class="allocation-item"><i class="dot" style="background:' + COLORS[i % COLORS.length] + '"></i><span class="name">' + esc(label) + '</span><span class="weight">' + (h.valueKrw == null ? '시세 대기' : weight.toFixed(1) + '%') + '</span></div>'; }).join("") || '<div class="allocation-item"><span></span><span class="name">예수금 또는 매수 기록을 추가하세요.</span><span></span></div>';
    var shownPnl = cost ? pnl : null, pendingNote = snapshot.pending.length ? '<small>시세 수신 대기 ' + snapshot.pending.length + '종목 · 아래 금액은 확인된 시세 기준입니다.</small>' : '<small>' + pct(rate) + '</small>', partial = snapshot.pending.length ? ' (일부)' : '';
    document.getElementById("portfolio-summary").innerHTML = '<div class="summary-grid">' + ring(allocation, total, holdings.length, account.name) + '<div class="summary-side"><div class="summary-title"><h3>' + esc(account.name) + '</h3><span>USD/KRW ' + fxLabel + '</span></div><div class="summary-metrics"><div class="metric"><span>총 자산' + partial + '</span><b>' + krw(total) + '</b></div><div class="metric"><span>주식 평가액' + partial + '</span><b>' + krw(invested) + '</b></div><div class="metric"><span>총 예수금</span><b>' + krw(cash.total) + '</b></div><div class="metric"><span>주식 평가손익' + partial + '</span><b class="' + (shownPnl == null ? "" : shownPnl >= 0 ? "pos" : "neg") + '">' + krw(shownPnl) + pendingNote + '</b></div></div><div class="allocation-list">' + list + '</div></div></div>';
  }
  function renderHoldings() {
    var holdings = S.aggregate(state, activeId), total = allValue();
    document.getElementById("holdings-body").innerHTML = holdings.length ? holdings.map(function (h) {
      var weight = total && h.valueKrw ? h.valueKrw / total * 100 : 0, cl = h.pnlKrw == null ? "" : h.pnlKrw >= 0 ? "pos" : "neg";
      return '<tr><td class="ticker">' + esc(S.displayTicker(h.ticker)) + '</td><td class="market">' + (h.market === "US" ? "미국" : "한국") + '</td><td>' + num(h.qty, 4) + '</td><td>' + local(h.avgLocal, h.market) + '</td><td>' + local(h.price, h.market) + '</td><td>' + krw(h.valueKrw) + '</td><td class="' + cl + '">' + krw(h.pnlKrw) + '<br><small>' + pct(h.returnPct) + '</small></td><td>' + weight.toFixed(1) + '%</td></tr>';
    }).join("") : '<tr><td colspan="8" class="empty-row">첫 매수 기록을 추가하면 보유 종목이 표시됩니다.</td></tr>';
  }
  function renderTransactions() {
    var recent = state.transactions.filter(function (t) { return t.accountId === activeId; }).slice().sort(function (a,b) { return String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0,8);
    document.getElementById("recent-transactions").innerHTML = recent.length ? recent.map(function (t) { return '<div class="tx-row"><span class="date">' + esc(t.date) + '</span><span class="market">' + (t.market === "US" ? "미국" : "한국") + '</span><b>' + esc(S.displayTicker(t.ticker)) + '</b><span class="' + (t.side === "buy" ? "buy" : "sell") + '">' + (t.side === "buy" ? "매수" : "매도") + '</span><span class="tx-price">' + num(t.qty,4) + '주 · ' + local(t.price,t.market) + '</span><button class="icon-btn" data-delete-tx="' + esc(t.id) + '" aria-label="기록 삭제">×</button></div>'; }).join("") : '<div class="empty-row">아직 매매 기록이 없습니다.</div>';
    document.querySelectorAll("[data-delete-tx]").forEach(function (b) { b.onclick = function () { if (!confirm("이 매매 기록을 삭제할까요?")) return; state.transactions = state.transactions.filter(function (t) { return t.id !== b.dataset.deleteTx; }); S.save(state); render(); }; });
  }
  function renderLists() {
    var buys = state.buyList.slice().sort(function (a,b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    document.getElementById("buy-list").innerHTML = buys.length ? buys.map(function (x) { return '<div class="buy-row"><b class="buy-ticker">' + esc(x.ticker) + '</b><span class="reason">' + esc(x.reason) + '</span><button class="icon-btn" data-delete-buy="' + esc(x.id) + '" aria-label="바잉리스트 삭제">×</button></div>'; }).join("") : '<div class="empty-row">종목과 매수 이유를 추가해 주세요.</div>';
    document.getElementById("watch-list").innerHTML = state.watchlist.length ? state.watchlist.map(function (x) { var quote = state.prices[S.groupKey(x.market, x.ticker)], price = quote && quote.price; return '<div class="watch-row"><div><b class="watch-ticker">' + esc(S.displayTicker(x.ticker)) + '</b><span class="watch-meta"> · ' + (x.market === "US" ? "미국" : "한국") + '</span></div><span class="watch-price">' + local(price, x.market) + '</span><button class="icon-btn" data-delete-watch="' + esc(x.id) + '" aria-label="관심종목 삭제">×</button></div>'; }).join("") : '<div class="empty-row">관심 종목을 추가해 주세요.</div>';
    document.querySelectorAll("[data-delete-buy]").forEach(function (b) { b.onclick = function () { state.buyList = state.buyList.filter(function (x) { return x.id !== b.dataset.deleteBuy; }); S.save(state); renderLists(); }; });
    document.querySelectorAll("[data-delete-watch]").forEach(function (b) { b.onclick = function () { state.watchlist = state.watchlist.filter(function (x) { return x.id !== b.dataset.deleteWatch; }); S.save(state); renderLists(); }; });
  }
  function renderCash() { var cash = cashInfo(); document.getElementById("cash-krw").value = cash.krw || ""; document.getElementById("cash-usd").value = cash.usd || ""; document.getElementById("cash-usd-krw").textContent = krw(cash.usdKrw); document.getElementById("cash-fx-rate").textContent = "USD/KRW " + num(cash.fx, 2); }
  function render() { renderTabs(); renderCash(); renderSummary(); renderHoldings(); renderTransactions(); renderLists(); }
  function setUpdated(text) { document.getElementById("portfolio-updated").textContent = text; }
  function clean(v) { return String(v == null ? "" : v).trim(); }
  function numberValue(v) { return Number(clean(v).replace(/,/g, "")); }
  function isoDate(v) {
    if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    var text = clean(v).replace(/\./g, "-").replace(/\//g, "-");
    var match = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) return match[1] + "-" + ("0" + match[2]).slice(-2) + "-" + ("0" + match[3]).slice(-2);
    if (typeof v === "number" && window.XLSX && XLSX.SSF) {
      var parsed = XLSX.SSF.parse_date_code(v);
      if (parsed) return parsed.y + "-" + ("0" + parsed.m).slice(-2) + "-" + ("0" + parsed.d).slice(-2);
    }
    return "";
  }
  function headerIndex(row, label) {
    for (var i = 0; i < row.length; i++) if (clean(row[i]).replace(/\s/g, "").indexOf(label) >= 0) return i;
    return -1;
  }
  function importTransactions(file) {
    if (!file) return;
    if (!window.XLSX) { alert("엑셀 읽기 도구를 불러오는 중입니다. 잠시 후 다시 눌러 주세요."); return; }
    var reader = new FileReader();
    reader.onerror = function () { alert("파일을 읽지 못했습니다. 엑셀 파일인지 확인해 주세요."); };
    reader.onload = function () {
      try {
        var book = XLSX.read(new Uint8Array(reader.result), { type: "array", cellDates: true });
        var sheet = book.Sheets[book.SheetNames[0]], rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
        var headerAt = -1;
        for (var r = 0; r < rows.length; r++) {
          if (headerIndex(rows[r], "날짜") >= 0 && headerIndex(rows[r], "종목명/티커") >= 0) { headerAt = r; break; }
        }
        if (headerAt < 0) throw new Error("header");
        var headers = rows[headerAt], dateAt = headerIndex(headers, "날짜"), marketAt = headerIndex(headers, "시장"), tickerAt = headerIndex(headers, "종목명/티커"), sideAt = headerIndex(headers, "매수/매도"), qtyAt = headerIndex(headers, "주식수"), priceAt = headerIndex(headers, "체결단가"), fxAt = headerIndex(headers, "적용환율");
        var imported = [];
        for (var i = headerAt + 1; i < rows.length; i++) {
          var row = rows[i], date = isoDate(row[dateAt]), ticker = clean(row[tickerAt]).toUpperCase(), sideText = clean(row[sideAt]);
          var qty = numberValue(row[qtyAt]), price = numberValue(row[priceAt]);
          if (!date || !ticker || !(qty > 0) || !(price > 0) || (!/매수|매도|buy|sell/i.test(sideText))) continue;
          var marketText = clean(row[marketAt]), market = /한국|KR/i.test(marketText) ? "KR" : "US";
          var fx = fxAt >= 0 ? numberValue(row[fxAt]) : 0;
          imported.push({ id: S.id("tx"), accountId: activeId, date: date, market: market, ticker: S.tickerFor(ticker, market), side: /매도|sell/i.test(sideText) ? "sell" : "buy", qty: qty, price: price, fx: fx > 0 ? fx : (market === "US" ? Number(state.fx && state.fx.price) || 1350 : 1), createdAt: new Date().toISOString() + "-" + i });
        }
        if (!imported.length) throw new Error("empty");
        var existing = state.transactions.filter(function (t) { return t.accountId === activeId; }).length;
        if (existing && !confirm("현재 포트폴리오에 매매 기록 " + imported.length + "건을 추가할까요? 같은 파일을 다시 가져오면 거래가 중복됩니다.")) return;
        state.transactions = state.transactions.concat(imported); S.save(state); render(); setUpdated("엑셀 " + imported.length + "건을 이 브라우저에 저장함"); refresh();
      } catch (e) { alert("첫 시트에서 날짜·시장·종목명/티커·매수/매도·주식 수·체결단가 열을 찾지 못했습니다."); }
    };
    reader.readAsArrayBuffer(file);
  }
  function backupPayload() {
    return { format: "vantage-portfolio-backup", version: 1, exportedAt: new Date().toISOString(), data: state };
  }
  function exportBackup() {
    var blob = new Blob([JSON.stringify(backupPayload(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "vantage-portfolio-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setUpdated("전체 기록을 백업 파일로 저장함");
  }
  function validBackup(raw) {
    var data = raw && raw.format === "vantage-portfolio-backup" ? raw.data : null;
    if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.transactions) || !Array.isArray(data.buyList) || !Array.isArray(data.watchlist)) return null;
    if (!data.accounts.length) return null;
    return { accounts: data.accounts, transactions: data.transactions, buyList: data.buyList, watchlist: data.watchlist, prices: data.prices || {}, fx: data.fx || null };
  }
  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { alert("백업 파일을 읽지 못했습니다."); };
    reader.onload = function () {
      try {
        var restored = validBackup(JSON.parse(reader.result));
        if (!restored) throw new Error("invalid");
        if (!confirm("이 백업으로 현재 컴퓨터의 포트폴리오 기록 전체를 바꿀까요?")) return;
        state = restored; activeId = state.accounts[0].id; S.save(state); render(); setUpdated("백업을 복원함 · 시세를 갱신하는 중"); refresh();
      } catch (e) { alert("VANTAGE 포트폴리오 백업 파일이 아니거나 파일 형식이 올바르지 않습니다."); }
    };
    reader.readAsText(file);
  }
  function wire() {
    var form = document.getElementById("transaction-form"); form.date.value = lastTransactionDate; form.fx.value = state.fx && state.fx.price ? Number(state.fx.price).toFixed(2) : "";
    form.date.addEventListener("change", function () { if (form.date.value) lastTransactionDate = form.date.value; });
    form.addEventListener("submit", function (e) { e.preventDefault(); var fd = new FormData(form), market = S.marketOf(fd.get("ticker")), ticker = S.tickerFor(fd.get("ticker"),market), qty = Number(fd.get("qty")), price = Number(fd.get("price")); if (!ticker || !(qty>0) || !(price>0)) return; lastTransactionDate = fd.get("date") || lastTransactionDate; state.transactions.push({ id:S.id("tx"), accountId:activeId, date:fd.get("date"), market:market, ticker:ticker, side:fd.get("side"), qty:qty, price:price, fx:Number(fd.get("fx")) || Number(state.fx && state.fx.price) || 1350, createdAt:new Date().toISOString() }); S.save(state); form.reset(); form.date.value = lastTransactionDate; form.fx.value = state.fx && state.fx.price ? Number(state.fx.price).toFixed(2) : ""; render(); refresh(); });
    document.getElementById("add-account").onclick = function () { var name = prompt("새 포트폴리오 이름", "포트폴리오 " + (state.accounts.length + 1)); if (!name || !name.trim()) return; var a={id:S.id("account"),name:name.trim()}; state.accounts.push(a); activeId=a.id; S.save(state); render(); };
    document.getElementById("rename-account").onclick = function () { var a=active(), name=prompt("포트폴리오 이름",a.name); if(!name||!name.trim())return;a.name=name.trim();S.save(state);render(); };
    document.getElementById("delete-account").onclick = function () { if(state.accounts.length<=1){alert("포트폴리오는 하나 이상 남겨야 합니다.");return;}var a=active();if(!confirm(a.name+"과 해당 매매 기록을 삭제할까요?"))return;state.accounts=state.accounts.filter(function(x){return x.id!==a.id;});state.transactions=state.transactions.filter(function(x){return x.accountId!==a.id;});activeId=state.accounts[0].id;S.save(state);render(); };
    document.getElementById("cash-settings").addEventListener("submit", function (e) { e.preventDefault(); var a = active(); a.cashKrw = Math.max(0, Number(document.getElementById("cash-krw").value) || 0); a.cashUsd = Math.max(0, Number(document.getElementById("cash-usd").value) || 0); S.save(state); render(); setUpdated("예수금을 이 브라우저에 저장함"); });
    document.getElementById("buy-form").addEventListener("submit",function(e){e.preventDefault();var f=new FormData(e.currentTarget),ticker=String(f.get("ticker")||"").trim().toUpperCase(),reason=String(f.get("reason")||"").trim();if(!ticker||!reason)return;state.buyList.push({id:S.id("buy"),ticker:ticker,reason:reason,createdAt:new Date().toISOString()});S.save(state);e.currentTarget.reset();renderLists();});
    document.getElementById("watch-form").addEventListener("submit",function(e){e.preventDefault();var f=new FormData(e.currentTarget),market=S.marketOf(f.get("ticker")),ticker=S.tickerFor(f.get("ticker"),market);if(!ticker)return;if(state.watchlist.some(function(x){return S.groupKey(x.market,x.ticker)===S.groupKey(market,ticker);})){return;}state.watchlist.push({id:S.id("watch"),market:market,ticker:ticker,createdAt:new Date().toISOString()});S.save(state);e.currentTarget.reset();renderLists();refresh();});
    var importButton = document.getElementById("portfolio-import-button"), importFile = document.getElementById("portfolio-import-file");
    importButton.onclick = function () { importFile.click(); };
    importFile.onchange = function () { importTransactions(importFile.files && importFile.files[0]); importFile.value = ""; };
    var backupExport = document.getElementById("portfolio-backup-export"), backupImport = document.getElementById("portfolio-backup-import"), backupFile = document.getElementById("portfolio-backup-file");
    backupExport.onclick = exportBackup;
    backupImport.onclick = function () { backupFile.click(); };
    backupFile.onchange = function () { importBackup(backupFile.files && backupFile.files[0]); backupFile.value = ""; };
  }
  async function refresh() { setUpdated("시세 갱신 중…"); try { state = await S.refresh(state); setUpdated("시세 갱신 " + new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})); } catch(e) { setUpdated("마지막 저장 시세 표시"); } render(); }
  wire(); render(); refresh();
})();
