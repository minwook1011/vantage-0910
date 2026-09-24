/* 차트 패턴 레이더 — backtest_ta.py가 만든 chart_patterns.json(오늘 패턴 상태·선 좌표)과
   ta_backtest.json(패턴별 과거 성과)을 읽어 '돌파 임박 / 돌파' 카드와 미니 차트를 그린다.
   패턴 규칙은 차트/차트 패턴 및 성호님 방식.pdf 기준. stocks-common.js 다음에 로드. */
(function () {
  "use strict";
  var PT = { data: null, bt: null };

  var DESC = {
    cup: "컵(U자) 뒤 손잡이(핸들)가 <b>컵 깊이의 1/3 이내</b>로만 눌렸다가 오른쪽 림을 뚫는 자리. U자일수록 믿을 만하고 V자는 신뢰도가 낮습니다. 거래량은 컵에서 줄고 돌파 때 늘어야 합니다. 목표 = 컵 깊이만큼.",
    dbl: "비슷한 저점을 두 번 찍고 가운데 고점(<b>넥라인</b>)을 뚫는 자리. 목표 = 바닥~넥라인 높이만큼.",
    flag: "급등(깃대) 뒤 살짝 아래로 흐르는 채널(깃발). <b>깃대의 1/3 넘게 되돌리면 무효</b>, 깃발 각도가 너무 가파르면 제외. 목표 = 깃대 길이만큼.",
    asc: "위는 평평한 저항선, 아래 저점은 점점 높아지는 삼각형. 주로 위로 뚫립니다. 거래량이 줄다가 <b>뚫을 때 실려야</b> 합니다.",
    sym: "고점은 낮아지고 저점은 높아지며 좁아지는 삼각형. 거래량이 더 극단적으로 줄어듭니다. <b>꼭짓점(apex) 전에 뚫어야 유효</b> — 꼭짓점까지 가서 내려오면 패턴이 아닙니다.",
    fwedge: "두 선이 모두 내려가며 좁아지는 쐐기. 약 70%가 위로 빠진다고 봅니다.",
    box: "고점·저점이 평평한 박스권. 위로 뚫으면(특히 신고가) 위에 쌓인 매물이 없어 목표가를 열어둘 수 있습니다.",
    tline: "고점끼리 이은 추세선을 뚫는 자리. 저항과 지지가 자주 바뀌는 구간이라 한 번 뚫으면 의미가 큽니다.",
    desc: "위가 눌리고 바닥은 평평한 삼각형 — 주로 아래로 이탈합니다(하락형, 참고용).",
    rwedge: "두 선이 모두 오르며 좁아지는 쐐기 — 약 70%가 아래로 빠집니다. 위로 뚫으면 상승 삼각형처럼 봅니다(하락형, 참고용)."
  };
  var STATES = [["near", "👀 돌파 임박"], ["breakout", "🚀 돌파"], ["bear", "⚠️ 하락형"], ["all", "전체"]];
  var view = { state: "near", kinds: null, shown: 24 };
  try { var sv = JSON.parse(localStorage.getItem("pt-view-v1") || "null"); if (sv && sv.state) view.state = sv.state; } catch (e) {}
  var ctx = null;

  function info(k) { return (PT.data && PT.data.patterns && PT.data.patterns[k]) || { name: k, side: "bull", emoji: "" }; }
  function isBull(p) { return info(p.kind).side === "bull"; }
  function patternsOf(tk) { return (PT.data && PT.data.stocks && PT.data.stocks[tk]) || []; }
  /* 순위표·프리셋용: 상승형 중 가장 우선순위 높은 '돌파'/'임박' 1개 */
  function primary(tk) {
    var ps = patternsOf(tk).filter(isBull);
    return ps.filter(function (p) { return p.state === "breakout"; })[0] || ps.filter(function (p) { return p.state === "near"; })[0] || null;
  }

  function fmtP(v) { return v >= 1000 ? Math.round(v).toLocaleString() : v >= 100 ? v.toFixed(1) : v.toFixed(2); }
  function pctTxt(v, d) { if (v == null || !isFinite(v)) return "–"; return (v > 0 ? "+" : "") + v.toFixed(d == null ? 1 : d) + "%"; }

  /* ── 미니 차트: 패턴 구간 캔들 + 저항/지지선 + 목표가 ── */
  function sliceFor(s, p) {
    var d = _dailyTail(s.candles || []);
    if (d.length < 20) return null;
    var si = 0;
    for (var i = 0; i < d.length; i++) { if (d[i].d >= p.start) { si = i; break; } }
    var from = Math.max(0, si - 12);
    from = Math.min(from, Math.max(0, d.length - 70));
    return { c: d.slice(from), off: from };
  }
  /* 차트에 없는 날짜(시세 파일이 하루 늦는 경우 등)는 마지막/첫 봉에서 평일 수만큼 떨어진 위치로 본다 */
  function bdays(d0, d1) {
    var a = new Date(d0 + "T00:00:00Z"), b = new Date(d1 + "T00:00:00Z"), sgn = b >= a ? 1 : -1, n = 0;
    if (sgn < 0) { var t = a; a = b; b = t; }
    for (var d = new Date(a); d < b; d.setUTCDate(d.getUTCDate() + 1)) { var w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; }
    return sgn * n;
  }
  function posOf(idxOf, cs, date) {
    if (idxOf[date] != null) return idxOf[date];
    var n = cs.length;
    if (date > cs[n - 1].d) return n - 1 + bdays(cs[n - 1].d, date);
    if (date < cs[0].d) return bdays(cs[0].d, date);
    for (var i = 0; i < n; i++) if (cs[i].d > date) return i;
    return n - 1;
  }
  function lineAt(ln, idxOf, i, cs) {
    /* 로그가격 기준 직선(파이썬 판정과 동일) → 인덱스 i에서의 가격 */
    var a = ln.p[0], b = ln.p[1], ia = posOf(idxOf, cs, a[0]), ib = posOf(idxOf, cs, b[0]);
    if (ia == null || ib == null || ia === ib) return null;
    var la = Math.log(a[1]), lb = Math.log(b[1]);
    return Math.exp(la + (lb - la) * (i - ia) / (ib - ia));
  }
  function miniSVG(s, p, W, H, big) {
    var sl = sliceFor(s, p); if (!sl) return '<div class="muted small">차트 데이터 없음</div>';
    var cs = sl.c, n = cs.length, idxOf = {};
    cs.forEach(function (c, i) { idxOf[c.d] = i; });
    var padL = big ? 52 : 4, padR = big ? 10 : 4, padT = 8, padB = big ? 22 : 6, volH = big ? 46 : 18;
    var ph = H - padT - padB - volH - 4;
    var hi = Math.max.apply(null, cs.map(function (c) { return c.h; }));
    var lo = Math.min.apply(null, cs.map(function (c) { return c.l; }));
    var showT = p.target && p.target <= hi * 1.45;
    if (showT) hi = Math.max(hi, p.target);
    var sp = (hi - lo) || 1; hi += sp * .04; lo -= sp * .04; sp = hi - lo;
    var cw = (W - padL - padR) / n, bw = Math.max(1, Math.min(cw * .62, 9));
    var maxV = Math.max.apply(null, cs.map(function (c) { return c.v || 0; })) || 1;
    function x(i) { return padL + cw * i + cw / 2; }
    function y(v) { return padT + (1 - (v - lo) / sp) * ph; }
    var out = "";
    if (big) {
      for (var g = 0; g <= 4; g++) {
        var gv = lo + sp * g / 4;
        out += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(gv).toFixed(1) + '" y2="' + y(gv).toFixed(1) + '" stroke="var(--border)"/>' +
          '<text x="' + (padL - 6) + '" y="' + (y(gv) + 4).toFixed(1) + '" fill="var(--muted)" font-size="10" text-anchor="end">' + fmtP(gv) + "</text>";
      }
    }
    var vy0 = padT + ph + 4;
    cs.forEach(function (c, i) {
      var up = c.c >= c.o, col = up ? "var(--up)" : "var(--dn)";
      var t = y(Math.max(c.o, c.c)), b = y(Math.min(c.o, c.c));
      out += '<line x1="' + x(i).toFixed(1) + '" x2="' + x(i).toFixed(1) + '" y1="' + y(c.h).toFixed(1) + '" y2="' + y(c.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1" opacity=".85"/>' +
        '<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + t.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, b - t).toFixed(1) + '" fill="' + col + '"' + (big ? "><title>" + c.d + " 종 " + c.c + "</title></rect>" : "/>");
      var vh = (c.v || 0) / maxV * volH;
      out += '<rect x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + (vy0 + volH - vh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(.5, vh).toFixed(1) + '" fill="' + col + '" opacity=".35"/>';
      if (big && i % Math.ceil(n / 7) === 0) out += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" fill="var(--muted)" font-size="10" text-anchor="middle">' + c.d.slice(2) + "</text>";
    });
    var COL = { res: "#f0b429", sup: "#5b8cff", pole: "rgba(240,180,41,.55)" };
    (p.lines || []).forEach(function (ln) {
      var ia = Math.max(0, posOf(idxOf, cs, ln.p[0][0])), ib = Math.min(n - 1, posOf(idxOf, cs, ln.p[1][0]));
      if (ln.role === "pole") {
        out += '<line x1="' + x(ia).toFixed(1) + '" y1="' + y(ln.p[0][1]).toFixed(1) + '" x2="' + x(ib).toFixed(1) + '" y2="' + y(ln.p[1][1]).toFixed(1) + '" stroke="' + COL.pole + '" stroke-width="' + (big ? 3 : 2.4) + '" stroke-linecap="round"/>';
        return;
      }
      var pts = [];
      for (var i = ia; i <= n - 1; i += Math.max(1, Math.floor((n - ia) / 24))) { var v = lineAt(ln, idxOf, i, cs); if (v != null) pts.push(x(i).toFixed(1) + "," + y(v).toFixed(1)); }
      var ve = lineAt(ln, idxOf, n - 1, cs); if (ve != null) pts.push(x(n - 1).toFixed(1) + "," + y(ve).toFixed(1));
      out += '<polyline fill="none" stroke="' + (COL[ln.role] || "#f0b429") + '" stroke-width="' + (big ? 2 : 1.6) + '" points="' + pts.join(" ") + '"/>';
    });
    (p.marks || []).forEach(function (m) {
      var i = idxOf[m[0]]; if (i == null) return;
      out += '<circle cx="' + x(i).toFixed(1) + '" cy="' + (y(m[1]) + 5).toFixed(1) + '" r="' + (big ? 5 : 3.6) + '" fill="none" stroke="#5b8cff" stroke-width="1.6"/>';
    });
    if (showT) {
      var tx0 = x(Math.max(0, n - 1 - Math.min(20, Math.floor(n / 4))));
      out += '<line x1="' + tx0.toFixed(1) + '" x2="' + (W - padR).toFixed(1) + '" y1="' + y(p.target).toFixed(1) + '" y2="' + y(p.target).toFixed(1) + '" stroke="#34d399" stroke-width="1.4" stroke-dasharray="4 3"/>';
      if (big) out += '<text x="' + (W - padR - 2) + '" y="' + (y(p.target) - 5).toFixed(1) + '" fill="#34d399" font-size="11" text-anchor="end">목표 ' + fmtP(p.target) + "</text>";
    }
    if (p.state === "breakout") {
      var bi = idxOf[p.date];
      if (bi != null) out += '<circle cx="' + x(bi).toFixed(1) + '" cy="' + y(cs[bi].c).toFixed(1) + '" r="' + (big ? 6 : 4.2) + '" fill="#f0475a" stroke="var(--card)" stroke-width="2"/>';
    }
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + escapeHtml(info(p.kind).name) + ' 패턴 차트">' + out + "</svg>";
  }

  function stateBadge(p) {
    if (!isBull(p)) return '<span class="pt-badge bear">⚠️ 하락형</span>';
    if (p.state === "breakout") return '<span class="pt-badge breakout">🚀 돌파' + (p.age ? " · " + p.age + "일 전" : " · 오늘") + "</span>";
    return '<span class="pt-badge near">👀 저항선 ' + pctTxt(p.dist) + "</span>";
  }
  function btLine(p) {
    var st = PT.data && PT.data.stats && PT.data.stats[p.kind];
    if (!st) return "";
    var f = st.f20 || {}, parts = [];
    if (f.n) parts.push("과거 돌파 <b>" + f.n + "건</b> → 20일 평균 <b>" + pctTxt(f.mean) + "</b> · 승률 <b>" + f.win + "%</b>");
    if (st.target_hit != null) parts.push("목표 도달 " + st.target_hit + "%");
    if (p.state === "near" && st.near && st.near.brk20 != null) parts.push("임박 신호 뒤 20일 안에 실제 돌파 <b>" + st.near.brk20 + "%</b>");
    return parts.length ? '<div class="pt-bt">🧪 ' + parts.join(" · ") + "</div>" : "";
  }
  function volTxt(p) {
    if (p.state === "breakout") return p.surge == null ? "–" : (p.surge >= 1.3 ? "✅ " : "") + p.surge.toFixed(1) + "배";
    return p.dry == null ? "–" : (p.dry < 0.85 ? "✅ " : "") + p.dry.toFixed(2) + "배";
  }

  function items() {
    var list = ctx.stocks(), out = [];
    list.forEach(function (s) {
      patternsOf(s.ticker).forEach(function (p) {
        if (view.state === "bear" ? isBull(p) : (view.state !== "all" && (!isBull(p) || p.state !== view.state))) return;
        if (view.kinds && !view.kinds[p.kind]) return;
        out.push({ s: s, p: p });
      });
    });
    out.sort(function (a, b) {
      if (a.p.state !== b.p.state) return a.p.state === "breakout" ? -1 : 1;
      if (a.p.state === "breakout") return (a.p.age - b.p.age) || ((b.p.surge || 0) - (a.p.surge || 0));
      return b.p.dist - a.p.dist;   // 저항선에 가까운 순
    });
    return out;
  }
  function card(it, i) {
    var s = it.s, p = it.p, inf = info(p.kind), sc = ctx.score(s);
    return '<div class="pt-card' + (p.state === "breakout" && isBull(p) ? " brk" : "") + '" data-i="' + i + '">' +
      '<div class="pt-top"><div><b>' + escapeHtml(s.name) + '</b><div class="sub">' + escapeHtml(s.ticker.replace(/\.[A-Z]+$/, "")) + " · " + escapeHtml(s.sector) + (sc != null ? " · 기술점수 " + sc : "") + "</div></div>" + stateBadge(p) + "</div>" +
      '<div class="pt-name">' + inf.emoji + " " + escapeHtml(inf.name) + ' <span>· ' + p.start.slice(2) + " 부터</span></div>" +
      '<div class="pt-chart">' + miniSVG(s, p, 300, 120, false) + "</div>" +
      '<div class="pt-rows"><div>돌파 기준가<b>' + fmtP(p.level) + '</b></div><div>현재가 대비<b class="' + (p.dist >= 0 ? "up" : "") + '">' + pctTxt(p.dist) + "</b></div>" +
      "<div>목표가<b>" + (isBull(p) ? pctTxt(p.height, 0) : "–") + "</b></div><div>" + (p.state === "breakout" ? "돌파 거래량" : "거래량 수축") + "<b>" + volTxt(p) + "</b></div></div>" +
      btLine(p) + "</div>";
  }

  function render() {
    if (!ctx) return;
    var grid = document.getElementById("pt-grid");
    if (!PT.data) { grid.innerHTML = '<div class="pt-empty">chart_patterns.json이 아직 없습니다 — backtest_ta.py를 실행하세요.</div>'; return; }
    var base = ctx.stocks(), cnt = { near: 0, breakout: 0, bear: 0, all: 0 }, kc = {};
    base.forEach(function (s) {
      patternsOf(s.ticker).forEach(function (p) {
        cnt.all++;
        if (!isBull(p)) cnt.bear++; else cnt[p.state] = (cnt[p.state] || 0) + 1;
        var inTab = view.state === "bear" ? !isBull(p) : view.state === "all" || (isBull(p) && p.state === view.state);
        if (inTab) kc[p.kind] = (kc[p.kind] || 0) + 1;
      });
    });
    document.getElementById("pt-state").innerHTML = STATES.map(function (x) {
      return '<button data-st="' + x[0] + '" class="' + (x[0] === view.state ? "on" : "") + '">' + x[1] + " " + (cnt[x[0]] || 0) + "</button>";
    }).join("");
    var kinds = Object.keys(kc).sort(function (a, b) { return kc[b] - kc[a]; });
    document.getElementById("pt-kinds").innerHTML = kinds.map(function (k) {
      var on = !view.kinds || view.kinds[k];
      return '<button class="pt-kind' + (on && view.kinds ? " on" : "") + '" data-k="' + k + '">' + info(k).emoji + " " + escapeHtml(info(k).name) + "<i>" + kc[k] + "</i></button>";
    }).join("");
    var list = items(), shown = list.slice(0, view.shown);
    grid.innerHTML = shown.length ? shown.map(card).join("")
      : '<div class="pt-empty">' + (view.state === "breakout" ? "최근 5거래일 안에 패턴을 뚫은 종목이 없습니다." : "조건에 맞는 패턴이 없습니다.") + " 섹터·검색 필터를 풀어보세요.</div>";
    var more = document.getElementById("pt-more");
    more.style.display = list.length > view.shown ? "" : "none";
    more.textContent = "더 보기 (남은 " + (list.length - view.shown) + ")";
    more.onclick = function () { view.shown += 24; render(); };
    Array.prototype.forEach.call(document.querySelectorAll("#pt-state button"), function (b) {
      b.onclick = function () { view.state = b.dataset.st; view.kinds = null; view.shown = 24; try { localStorage.setItem("pt-view-v1", JSON.stringify({ state: view.state })); } catch (e) {} render(); };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#pt-kinds .pt-kind"), function (b) {
      b.onclick = function () {
        var k = b.dataset.k;
        if (!view.kinds) { view.kinds = {}; view.kinds[k] = true; }
        else if (view.kinds[k]) { delete view.kinds[k]; if (!Object.keys(view.kinds).length) view.kinds = null; }
        else view.kinds[k] = true;
        view.shown = 24; render();
      };
    });
    Array.prototype.forEach.call(grid.querySelectorAll(".pt-card"), function (el) {
      el.onclick = function () { openPattern(shown[+el.dataset.i]); };
    });
  }

  function openPattern(it) {
    var s = it.s, p = it.p, inf = info(p.kind), st = (PT.data.stats || {})[p.kind] || {};
    var f = st.f20 || {}, nv = st.near || {}, vf = st.vol_f20 || {};
    var rows = '<div class="pt-rows" style="grid-template-columns:repeat(4,1fr);margin-top:10px">' +
      "<div>돌파 기준가<b>" + fmtP(p.level) + "</b></div><div>현재가 대비<b>" + pctTxt(p.dist) + "</b></div>" +
      "<div>목표가<b>" + (isBull(p) ? fmtP(p.target) + " (" + pctTxt(p.height, 0) + ")" : "–") + "</b></div><div>" + (p.state === "breakout" ? "돌파 거래량" : "거래량 수축") + "<b>" + volTxt(p) + "</b></div></div>";
    var bt = [];
    if (f.n) bt.push("이 패턴이 과거 5년 300종목에서 <b>" + f.n + "번</b> 돌파 → 20일 뒤 평균 <b>" + pctTxt(f.mean) + "</b>, 중앙값 " + pctTxt(f.median) + ", 오른 비율 <b>" + f.win + "%</b>");
    if (vf.n) bt.push("그중 돌파일 거래량이 20일 평균의 1.3배 이상이었던 " + vf.n + "건: 20일 평균 <b>" + pctTxt(vf.mean) + "</b> · 승률 " + vf.win + "%");
    if (st.target_hit != null) bt.push("60일 안에 목표가 도달 <b>" + st.target_hit + "%</b> · 10일 안에 돌파선 −3% 아래로 되밀림(실패) " + st.fail10 + "%");
    if (nv.n) bt.push("'돌파 임박' 신호 " + nv.n + "번 중 20일 안에 실제로 뚫은 비율 <b>" + nv.brk20 + "%</b>");
    var body = '<div class="pt-name" style="margin-top:0">' + stateBadge(p) + " &nbsp;" + inf.emoji + " " + escapeHtml(inf.name) + " <span>· " + p.start + " ~</span></div>" +
      '<div class="pt-chart" style="margin-top:8px">' + miniSVG(s, p, 820, 340, true) + "</div>" + rows +
      '<div class="pt-modal-note">📐 ' + (DESC[p.kind] || "") + "</div>" +
      (bt.length ? '<div class="pt-modal-note">🧪 ' + bt.join("<br>🧪 ") + "</div>" : "") +
      '<div class="pt-modal-note" style="font-size:11.5px;color:var(--faint)">자동 판정입니다. 고점·저점은 좌우 5봉이 지나야 확정되므로 최근 며칠의 움직임은 선에 반영이 늦을 수 있습니다.</div>' +
      '<div style="margin-top:12px"><button class="more-btn" id="pt-open-stock" style="display:inline-block;margin:0">종목 상세(재무·뉴스) 열기 →</button></div>';
    openModal(escapeHtml(s.name) + ' <span class="muted small">' + escapeHtml(s.ticker) + "</span>", body);
    var btn = document.getElementById("pt-open-stock");
    if (btn) btn.onclick = function () { closeModal(); ctx.open(s.ticker); };
  }

  function load() {
    return Promise.all([
      fetchJSON("chart_patterns.json").catch(function () { return null; }),
      fetchJSON("ta_backtest.json").catch(function () { return null; })
    ]).then(function (rs) { PT.data = rs[0]; PT.bt = rs[1]; return PT; });
  }

  window.PatternRadar = {
    load: load, render: render, patternsOf: patternsOf, primary: primary, info: info, miniSVG: miniSVG,
    mount: function (c) { ctx = c; render(); },
    get data() { return PT.data; }, get bt() { return PT.bt; }
  };
})();
