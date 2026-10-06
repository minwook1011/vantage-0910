/* Bottom-up signal cards: honest missing values, shared lazy candles and stable sorts. */
(function () {
  "use strict";

  var periods = { r1w: "1주", r1m: "1개월", r3m: "3개월", ytd: "연초 이후" };
  var renders = new WeakMap();
  function finite(v) { return typeof v === "number" && isFinite(v); }
  function esc(v) { return escapeHtml(v); }
  function pct(v) { return finite(v) ? (v > 0 ? "+" : "") + v.toFixed(1) + "%" : "—"; }
  function price(v) { return finite(v) ? v.toLocaleString("ko-KR", { maximumFractionDigits: v >= 1000 ? 0 : 2 }) : "—"; }
  function tone(v) { return finite(v) ? (v > 0 ? "up" : v < 0 ? "dn" : "") : ""; }
  function primary(s) { return window.PatternRadar ? PatternRadar.primary(s.ticker) : null; }
  function detailOf(s, key, opts) { return opts.detail ? String(opts.detail(s, key) || "") : ""; }
  function scoreOf(s, opts) { return opts.score ? opts.score(s) : null; }

  function momentum(s) {
    return finite(s.r1w) && finite(s.r1m) && finite(s.r3m)
      ? s.r1w * .2 + s.r1m * .3 + s.r3m * .5 : null;
  }
  function breakoutRank(s, detail) {
    var p = primary(s);
    if (p && p.state === "breakout") return 4;
    if (detail && /돌파/.test(String(detail(s, "brk") || ""))) return 3;
    if (p && p.state === "near") return 2;
    return finite(s.from_high) && s.from_high >= -3 ? 1 : 0;
  }
  function descending(a, b) {
    if (!finite(a)) return finite(b) ? 1 : 0;
    if (!finite(b)) return -1;
    return b - a;
  }
  function sort(stocks, opts) {
    opts = opts || {};
    function value(s) {
      switch (opts.sort) {
      case "momentum": return momentum(s);
      case "breakout": return breakoutRank(s, opts.detail);
      case "ta": return scoreOf(s, opts);
      case "vol": return s.vol_ratio;
      case "high": return s.from_high;
      default: return s[opts.period || "r1m"];
      }
    }
    return stocks.slice().sort(function (a, b) {
      var cmp = descending(value(a), value(b));
      if (!cmp && opts.sort === "breakout") {
        var pa = primary(a), pb = primary(b), rank = breakoutRank(a, opts.detail);
        if (rank === 4) {
          cmp = descending(pa && finite(pa.age) ? -pa.age : null, pb && finite(pb.age) ? -pb.age : null)
            || descending(pa && pa.surge, pb && pb.surge);
        } else if (rank === 2) {
          cmp = descending(pa && finite(pa.dist) ? -Math.abs(pa.dist) : null, pb && finite(pb.dist) ? -Math.abs(pb.dist) : null);
        } else if (rank === 1) cmp = descending(a.from_high, b.from_high);
      }
      if (cmp) return cmp;
      var at = String(a.ticker || ""), bt = String(b.ticker || "");
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
  }

  /* The line endpoint is the last session used to calculate p.dist; p.date is
     the event date, which can be several sessions earlier for breakouts. */
  function patternAsOf(p) {
    var dates = [];
    (p.lines || []).forEach(function (line) {
      if (line.role !== "pole" && line.p && line.p[1] && /^\d{4}-\d{2}-\d{2}$/.test(line.p[1][0])) dates.push(line.p[1][0]);
    });
    dates.sort();
    return dates.length ? dates[dates.length - 1] : (p.age === 0 ? p.date : null);
  }
  function candleData(s) {
    return _dailyTail(s.candles || []).filter(function (c) {
      return c && /^\d{4}-\d{2}-\d{2}$/.test(c.d) && finite(c.o) && finite(c.h) && finite(c.l) && finite(c.c)
        && c.o > 0 && c.c > 0 && c.l > 0 && c.h >= Math.max(c.o, c.c, c.l) && c.l <= Math.min(c.o, c.c);
    });
  }
  function previousHigh(cs) {
    if (cs.length < 21) return null;
    return Math.max.apply(null, cs.slice(-21, -1).map(function (c) { return c.h; }));
  }
  function averageClose(cs, end, length) {
    if (end < length - 1) return null;
    var total = 0;
    for (var i = end - length + 1; i <= end; i++) total += cs[i].c;
    return total / length;
  }
  function metric(label, value, cls, title) {
    return '<div class="sb-metric"' + (title ? ' title="' + esc(title) + '"' : "") + '><span class="sb-caption">'
      + esc(label) + '</span><strong class="sb-value ' + (cls || "") + '">' + esc(value) + '</strong></div>';
  }
  function summary(s, p, opts, cs) {
    var parts = [], sub = [], short = "", close = cs && cs.length ? cs[cs.length - 1].c : null;
    if (p) {
      var name = PatternRadar.info(p.kind).name;
      parts.push(name + (p.state === "breakout" ? " 돌파 신호" : " 돌파 임박"));
      if (finite(p.level)) parts.push("돌파 기준 " + price(p.level));
      if (finite(p.dist)) parts.push("신호 종가 기준선 대비 " + pct(p.dist));
      short = (finite(p.level) ? "기준 " + price(p.level) : name) + (finite(p.dist) ? " · " + pct(p.dist) : "");
      if (p.state === "breakout") {
        if (finite(p.age)) sub.push("판정 기준 " + p.age + "거래일 전 돌파");
        if (finite(p.dist) && p.dist < 0) sub.push("이후 기준선 아래로 되밀림");
      } else sub.push("임박 판정 · 돌파 여부 확인");
    } else if (finite(close)) {
      var high = previousHigh(cs), gap = finite(high) && high > 0 ? (close / high - 1) * 100 : null;
      parts.push("마지막 종가 " + price(close));
      if (finite(high)) {
        parts.push("직전 20일 고가 " + price(high));
        sub.push("고가 대비 " + pct(gap) + (close > high ? " · 종가 돌파" : ""));
        short = "종가 " + price(close) + " · 고가 " + pct(gap);
      } else { sub.push("직전 20일 고가를 계산할 일봉이 부족합니다"); short = "종가 " + price(close) + " · 고가 확인 대기"; }
    } else {
      var brk = detailOf(s, "brk", opts), ma = detailOf(s, "ma", opts);
      parts.push(brk && brk !== "-" ? brk : ma && ma !== "-" ? ma : "가격·거래량 흐름 확인");
      sub.push("일봉을 불러오면 종가와 직전 20일 고가를 표시합니다");
      short = parts[0];
    }
    if (finite(s.vol_ratio)) sub.push("거래대금 5일/20일 " + s.vol_ratio.toFixed(2) + "배");
    if (finite(s.from_high)) sub.push("52주 종가 고점 대비 " + pct(s.from_high));
    var full = parts.concat(sub).join(" · ");
    return '<p title="' + esc(full) + '" aria-label="' + esc(full) + '">' + esc(short) + '</p>';
  }
  function dateText(p, cs) {
    var out = [];
    if (p) {
      var asof = patternAsOf(p);
      out.push("패턴 판정 " + (asof || "기준일 미제공"));
      if (p.state === "breakout" && p.date) out.push("돌파 발생 " + p.date);
    }
    out.push(cs && cs.length ? "일봉 " + cs[cs.length - 1].d + " 기준" : "일봉 대기");
    return out.join(" · ");
  }
  /* Actual OHLC bars, MA20 and the latest session's previous-20-session high.
     Missing volume leaves a gap instead of implying a zero-volume session. */
  function baselineSVG(s, cs) {
    var shown = cs.slice(-70), offset = cs.length - shown.length, n = shown.length;
    var W = 260, H = 130, L = 4, R = 4, T = 5, PH = 88, VH = 23, VY = 98;
    var high = previousHigh(cs), ma = shown.map(function (_, i) { return averageClose(cs, offset + i, 20); });
    var hi = Math.max.apply(null, shown.map(function (c) { return c.h; }));
    var lo = Math.min.apply(null, shown.map(function (c) { return c.l; }));
    ma.forEach(function (v) { if (finite(v)) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
    if (finite(high)) { hi = Math.max(hi, high); lo = Math.min(lo, high); }
    var span = hi - lo || hi * .02 || 1; hi += span * .07; lo -= span * .07; span = hi - lo;
    var step = (W - L - R) / n, bw = Math.max(1, Math.min(8, step * .6));
    var maxV = Math.max.apply(null, shown.map(function (c) { return finite(c.v) && c.v >= 0 ? c.v : 0; })) || 1;
    function x(i) { return L + step * (i + .5); }
    function y(v) { return T + (hi - v) / span * PH; }
    function f(v) { return v.toFixed(2); }
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(s.name || s.ticker) + ' 최근 일봉, 20일 이동평균, 직전 20일 고가와 거래량"><title>' + esc(s.ticker) + " · " + esc(shown[0].d) + " ~ " + esc(shown[n - 1].d) + '</title>';
    for (var g = 1; g < 3; g++) {
      var yy = y(lo + span * g / 3);
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f(yy) + '" y2="' + f(yy) + '" stroke="var(--border)" opacity=".5"/>';
    }
    shown.forEach(function (c, i) {
      var color = c.c >= c.o ? "var(--up)" : "var(--dn)", xx = x(i), top = y(Math.max(c.c, c.o)), bottom = y(Math.min(c.c, c.o));
      out += '<g><title>' + esc(c.d) + " · 시 " + price(c.o) + " 고 " + price(c.h) + " 저 " + price(c.l) + " 종 " + price(c.c) + " · 거래량 " + (finite(c.v) ? price(c.v) : "미제공") + '</title><line x1="' + f(xx) + '" x2="' + f(xx) + '" y1="' + f(y(c.h)) + '" y2="' + f(y(c.l)) + '" stroke="' + color + '"/><rect x="' + f(xx - bw / 2) + '" y="' + f(top) + '" width="' + f(bw) + '" height="' + f(Math.max(1, bottom - top)) + '" fill="' + color + '"/>';
      if (finite(c.v) && c.v > 0) {
        var vh = c.v / maxV * VH;
        out += '<rect x="' + f(xx - bw / 2) + '" y="' + f(VY + VH - vh) + '" width="' + f(bw) + '" height="' + f(vh) + '" fill="' + color + '" opacity=".35"/>';
      }
      out += '</g>';
    });
    var points = [];
    ma.forEach(function (v, i) { if (finite(v)) points.push(f(x(i)) + "," + f(y(v))); });
    if (points.length) out += '<polyline points="' + points.join(" ") + '" fill="none" stroke="#818cf8" stroke-width="1.2"/>';
    if (finite(high)) out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + f(y(high)) + '" y2="' + f(y(high)) + '" stroke="#f0b429" stroke-width="1.2" stroke-dasharray="3 3"/>';
    return out + '</svg>';
  }

  function render(root, stocks, opts) {
    if (!root) return;
    opts = opts || {};
    var old = renders.get(root);
    if (old && old.observer) old.observer.disconnect();
    var state = { observer: null };
    renders.set(root, state);
    root.innerHTML = "";
    var cards = [];
    stocks.forEach(function (s, index) {
      var p = primary(s), article = document.createElement("article"), period = opts.period || "r1m", sc = scoreOf(s, opts), mom = momentum(s);
      article.className = "sb-card" + (p ? " sb-" + p.state : "");
      article.dataset.ticker = s.ticker;
      article.style.setProperty("--sb-i", Math.min(index, 8));
      var badges = opts.signals ? opts.signals(s) : [], allSignals = badges.map(function (b) { return b[1]; }).join(" · ");
      article.innerHTML = '<div class="sb-top"><div class="sb-identity"><button type="button" class="sb-open" title="' + esc(s.name || s.ticker) + '" aria-label="' + esc((s.name || s.ticker) + " 상세 차트 열기") + '">' + esc(s.name || s.ticker) + '</button><span class="sb-meta" title="' + esc(s.ticker + " · " + (s.sector || "섹터 미분류")) + '">' + esc(s.ticker) + ' · ' + esc(s.sector || "섹터 미분류") + '</span></div><div class="sb-badges" title="' + esc(allSignals) + '">'
        + (badges.length ? badges.slice(0, 2).map(function (b) { return '<span class="sb-badge ' + (/^[gybn]$/.test(b[0]) ? b[0] : "n") + '">' + esc(b[1]) + '</span>'; }).join("") : '<span class="sb-badge n">추세 관찰</span>')
        + '</div></div><div class="sb-body"><div class="sb-chart-wrap"><div class="sb-chart" aria-busy="true"><div class="sb-state"><span class="sb-loader" aria-hidden="true"></span>일봉 대기</div></div><div class="sb-chart-note"></div></div><div class="sb-info"><div class="sb-summary">' + summary(s, p, opts, null) + '</div><div class="sb-metrics">'
        + metric(periods[period] || period, pct(s[period]), tone(s[period]), (periods[period] || period) + " 수익률")
        + metric("모멘텀", pct(mom), tone(mom), "1주 수익률×20% + 1개월×30% + 3개월×50% · 세 기간 데이터가 모두 있을 때 계산")
        + metric("기술점수", finite(sc) ? Math.round(sc) + "점" : "—", "", "기존 기술 분석 모델의 점수")
        + metric("거래대금", finite(s.vol_ratio) ? s.vol_ratio.toFixed(2) + "배" : "—", finite(s.vol_ratio) && s.vol_ratio >= 1.3 ? "up" : "", "최근 5일 일평균 거래대금 ÷ 최근 20일 일평균 거래대금")
        + '</div></div></div><div class="sb-footer"><span class="sb-date" title="' + esc(dateText(p, null)) + '" aria-label="' + esc(dateText(p, null)) + '">일봉 대기</span><button type="button" class="sb-open-detail" aria-label="' + esc((s.name || s.ticker) + " 상세 차트 열기") + '">상세 <span aria-hidden="true">↗</span></button></div>';
      article.querySelectorAll(".sb-open, .sb-open-detail").forEach(function (button) {
        button.addEventListener("click", function () { if (opts.open) opts.open(s.ticker); });
      });
      article.addEventListener("click", function (event) {
        if (event.defaultPrevented || (event.target.closest && event.target.closest("button, a, input, select, textarea, [role='button']"))) return;
        if (opts.open) opts.open(s.ticker);
      });
      function current() { return renders.get(root) === state && root.contains(article) && root.isConnected; }
      var loading = false;
      function load() {
        if (!current() || loading) return;
        loading = true;
        var chart = article.querySelector(".sb-chart");
        chart.setAttribute("aria-busy", "true");
        chart.innerHTML = '<div class="sb-state" role="status"><span class="sb-loader" aria-hidden="true"></span>일봉 불러오는 중</div>';
        Promise.resolve().then(function () {
          if (!window.PatternRadar || !PatternRadar.ensureCandles) throw new Error("캔들 로더를 사용할 수 없습니다");
          return PatternRadar.ensureCandles(s, current);
        }).then(function (loaded) {
          if (!current()) return;
          var cs = candleData(loaded || s);
          if (cs.length < 2) throw new Error("일봉 데이터가 부족합니다");
          var chartStock = Object.assign({}, s, { candles: cs });
          chart.innerHTML = p && cs.length >= 20 ? PatternRadar.miniSVG(chartStock, p, 260, 130, false) : baselineSVG(s, cs);
          chart.setAttribute("aria-busy", "false");
          article.querySelector(".sb-summary").innerHTML = summary(s, p, opts, cs);
          var date = article.querySelector(".sb-date"), fullDate = dateText(p, cs);
          date.textContent = cs[cs.length - 1].d + " · 일봉";
          date.setAttribute("title", fullDate);
          date.setAttribute("aria-label", fullDate);
          var note = article.querySelector(".sb-chart-note");
          note.innerHTML = "";
          if (p && patternAsOf(p) && patternAsOf(p) !== cs[cs.length - 1].d) note.insertAdjacentHTML("beforeend", '<span class="sb-date-warning" title="' + esc(fullDate) + '">기준일 다름</span>');
          if (cs.some(function (c) { return !finite(c.v); })) note.insertAdjacentHTML("beforeend", '<span class="sb-date-warning" title="거래량 일부 미제공">거래량 누락</span>');
          article.classList.add("sb-loaded");
        }).catch(function () {
          if (!current()) return;
          chart.setAttribute("aria-busy", "false");
          chart.innerHTML = '<div class="sb-state sb-error" role="status"><span>일봉 로드 실패</span><button type="button" class="sb-retry">다시 불러오기</button></div>';
          var date = article.querySelector(".sb-date"), fullDate = dateText(p, null).replace("일봉 대기", "일봉 확인 필요");
          date.textContent = "일봉 미확인";
          date.setAttribute("title", fullDate);
          date.setAttribute("aria-label", fullDate);
          chart.querySelector(".sb-retry").addEventListener("click", load);
        }).then(function () { loading = false; });
      }
      root.appendChild(article);
      cards.push({ node: article, load: load });
    });
    if (window.IntersectionObserver) {
      state.observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          state.observer.unobserve(entry.target);
          var card = cards.find(function (item) { return item.node === entry.target; });
          if (card) card.load();
        });
      }, { rootMargin: "250px 0px", threshold: 0 });
      cards.forEach(function (card) { state.observer.observe(card.node); });
    } else cards.forEach(function (card) { card.load(); });
  }

  window.SignalBoard = { sort: sort, render: render, momentum: momentum, breakoutRank: breakoutRank };
})();
