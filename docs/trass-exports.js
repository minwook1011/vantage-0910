/* TRASS 순별 수출 트래커 — docs/data/trass_exports.json을 읽어 품목별 수출금액·수출단가를 보여준다.
   비교는 항상 "같은 구간끼리"다. 1~20일 값은 이전 달·작년 같은 달의 1~20일 값과 비교한다.
   YoY·MoM은 저장된 관측값으로 계산하고, 비교 대상이 아직 없으면 원출처 표기값(reported)을 쓴다. */
(function () {
  "use strict";
  var host = document.getElementById("trass-workspace");
  if (!host) return;

  var DATA = null, span = "D20", metric = "usd";
  var SPAN_ORDER = ["D10", "D20", "M"];

  var css = document.createElement("style");
  css.textContent =
    ".tr-wrap{margin-top:26px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px}" +
    ".tr-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-end}" +
    ".tr-head h2{margin:2px 0 4px;font-size:18px}.tr-head p{margin:0;color:var(--muted);font-size:12.5px;line-height:1.6}" +
    ".tr-cadence{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.tr-cadence span{font-size:11px;color:var(--muted);border:1px solid var(--border-strong);border-radius:999px;padding:2px 9px}" +
    ".tr-cadence span b{color:var(--text)}" +
    ".tr-tools{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 10px}" +
    ".tr-tbl{width:100%;border-collapse:collapse;font-size:12.5px}.tr-tbl th{color:var(--muted);font-weight:700;text-align:right;padding:7px 8px;border-bottom:1px solid var(--border-strong);white-space:nowrap}" +
    ".tr-tbl th.l,.tr-tbl td.l{text-align:left}.tr-tbl td{padding:8px;text-align:right;border-bottom:1px solid var(--border);font-family:var(--mono);white-space:nowrap}" +
    ".tr-tbl td.l b{font-family:var(--sans)}.tr-tbl td.l small{display:block;color:var(--faint);font:10.5px var(--mono)}" +
    ".tr-tbl .grp td{color:var(--muted);font:700 11px var(--sans);letter-spacing:.04em;background:var(--bg2)}" +
    ".tr-tbl .wait{color:var(--faint)}.tr-src{font-size:9.5px;color:#f0b429;margin-left:3px;font-family:var(--sans)}" +
    ".tr-scroll{overflow-x:auto}" +
    ".tr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px;margin-top:14px}" +
    ".tr-card{border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--bg2)}" +
    ".tr-card b{font-size:13px}.tr-card .v{font:800 16px var(--mono);margin-top:2px}.tr-card .sub{color:var(--muted);font-size:11px}" +
    ".tr-card svg{display:block;width:100%;height:auto;margin-top:6px}.tr-card .ax{font:9.5px var(--mono);fill:var(--faint)}" +
    ".tr-empty{color:var(--faint);font-size:11.5px;padding:18px 0 8px;text-align:center}" +
    ".tr-note{margin-top:12px;color:var(--faint);font-size:11.5px;line-height:1.7}.up{color:#ff7a8c}.dn{color:#76a4ff}" +
    ".tr-est{margin-top:4px;color:#e88a97;font-size:10.5px}" +
    ".tr-card{transition:border-color .2s,transform .2s}.tr-card:hover{border-color:var(--border-strong);transform:translateY(-2px)}" +
    "@keyframes tr-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}" +
    ".tr-bar{transform-box:fill-box;transform-origin:bottom;animation:tr-grow .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 12ms)}" +
    "@media (prefers-reduced-motion:reduce){.tr-bar{animation:none}.tr-card:hover{transform:none}}";
  document.head.appendChild(css);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function prevMonth(m, n) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - n; while (mo < 1) { mo += 12; y--; } return y + "-" + (mo < 10 ? "0" : "") + mo; }
  function obs(item, month, sp) { return DATA.observations.filter(function (o) { return o.item === item && o.month === month && o.span === sp; })[0] || null; }
  function price(o) { return o && o.kg ? o.usd / o.kg : (o && o.reported && o.reported.price) || null; }
  function chg(a, b) { return a == null || b == null || b === 0 ? null : (a / b - 1) * 100; }
  function fmtUsd(v) { if (v == null) return "–"; return v >= 1e8 ? (v / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억$" : (v / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 0 }) + "만$"; }
  function fmtPrice(v) { return v == null ? "–" : Math.round(v).toLocaleString("ko-KR") + " $/kg"; }
  function fmtChg(v, reported) {
    if (v == null) return '<span class="wait">–</span>';
    return '<span class="' + (v >= 0 ? "up" : "dn") + '">' + (v >= 0 ? "+" : "") + v.toFixed(1) + "%</span>" + (reported ? '<span class="tr-src" title="비교 기간 관측값이 아직 없어 원출처 표기값을 표시">원출처</span>' : "");
  }
  /* 계산값 우선, 없으면 원출처 표기값 */
  function yoyMom(o, key) {
    var yo = obs(o.item, prevMonth(o.month, 12), o.span), mo = obs(o.item, prevMonth(o.month, 1), o.span);
    var cur = key === "usd" ? o.usd : price(o);
    var y = chg(cur, yo && (key === "usd" ? yo.usd : price(yo))), m = chg(cur, mo && (key === "usd" ? mo.usd : price(mo)));
    var rep = o.reported || {};
    return {
      yoy: y != null ? y : (rep[key + "_yoy"] != null ? rep[key + "_yoy"] : null), yoyRep: y == null && rep[key + "_yoy"] != null,
      mom: m != null ? m : (rep[key + "_mom"] != null ? rep[key + "_mom"] : null), momRep: m == null && rep[key + "_mom"] != null
    };
  }
  function latestMonth(sp) {
    var ms = DATA.observations.filter(function (o) { return o.span === sp; }).map(function (o) { return o.month; }).sort();
    return ms.length ? ms[ms.length - 1] : null;
  }

  function table(month) {
    var groups = [], html = "";
    DATA.items.forEach(function (it) { if (groups.indexOf(it.group) < 0) groups.push(it.group); });
    groups.forEach(function (g) {
      html += '<tr class="grp"><td class="l" colspan="7">' + esc(g) + "</td></tr>";
      DATA.items.filter(function (it) { return it.group === g; }).forEach(function (it) {
        var o = month && obs(it.id, month, span);
        var hs = it.hs ? "HS " + it.hs : "HS 확인 필요";
        if (!o) {
          html += '<tr><td class="l"><b>' + esc(it.label) + "</b><small>" + hs + '</small></td><td colspan="6" class="wait">데이터 대기</td></tr>';
          return;
        }
        var u = yoyMom(o, "usd"), p = yoyMom(o, "price");
        html += '<tr><td class="l"><b>' + esc(it.label) + "</b><small>" + hs + "</small></td>" +
          "<td>" + fmtUsd(o.usd) + "</td><td>" + fmtChg(u.yoy, u.yoyRep) + "</td><td>" + fmtChg(u.mom, u.momRep) + "</td>" +
          "<td>" + fmtPrice(price(o)) + "</td><td>" + fmtChg(p.yoy, p.yoyRep) + "</td><td>" + fmtChg(p.mom, p.momRep) + "</td></tr>";
      });
    });
    return '<div class="tr-scroll"><table class="tr-tbl"><thead><tr><th class="l">품목</th><th>수출금액</th><th>YoY</th><th>MoM</th><th>수출단가</th><th>YoY</th><th>MoM</th></tr></thead><tbody>' + html + "</tbody></table></div>";
  }

  /* 품목별 월 추이 — 월 전체(M) 36개월 막대 + 진행 중인 달은 순별 누적 잠정치를 월로 환산한 추정 막대(빗금).
     환산은 사용자 엑셀과 같은 방식: 1~10일 ×3, 1~20일 ×3/2. 단가($/kg)는 비율이라 환산하지 않는다. */
  var EST = {D10: 3, D20: 1.5};
  function bars(item) {
    var list = DATA.observations.filter(function (o) { return o.item === item && o.span === "M"; }).sort(function (a, b) { return a.month < b.month ? -1 : 1; }).slice(-36);
    var rows = list.map(function (o) { return {month: o.month, v: metric === "usd" ? o.usd : price(o), est: false}; });
    var lastM = list.length ? list[list.length - 1].month : "";
    var part = DATA.observations.filter(function (o) { return o.item === item && o.span !== "M" && o.month > lastM; })
      .sort(function (a, b) { return a.month === b.month ? SPAN_ORDER.indexOf(b.span) - SPAN_ORDER.indexOf(a.span) : (a.month < b.month ? 1 : -1); })[0];
    if (part) rows.push({month: part.month, v: metric === "usd" ? part.usd * EST[part.span] : price(part), est: true, span: part.span});
    if (rows.length < 2) return '<div class="tr-empty">' + (rows.length ? "관측 1회 — 월별 확정치가 쌓이면 추이가 그려집니다" : "데이터 대기") + "</div>";
    var W = 300, H = 120, L = 2, R = 2, T = 6, B = 16, iw = W - L - R, ih = H - T - B, n = rows.length;
    var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).filter(function (v) { return v != null; })) || 1, bw = iw / n * 0.72, svg = "";
    svg += '<defs><pattern id="tr-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="rgba(240,71,90,.25)"/><line x1="0" y1="0" x2="0" y2="4" stroke="#f0475a" stroke-width="2"/></pattern></defs>';
    rows.forEach(function (r, k) {
      if (r.v == null) return;
      var h = r.v / max * ih, x = L + (k + 0.5) * (iw / n) - bw / 2, last = k === n - 1;
      var tip = r.month + (r.est ? " " + DATA.spans[r.span] + " 잠정" + (metric === "usd" ? " → 월 환산 추정 (×" + (EST[r.span] === 1.5 ? "3/2" : "3") + ")" : "") : "") + " " + (metric === "usd" ? fmtUsd(r.v) : fmtPrice(r.v));
      svg += '<rect class="tr-bar" style="--i:' + k + '" x="' + x.toFixed(1) + '" y="' + (T + ih - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (r.est ? "url(#tr-hatch)" : last ? "#f0475a" : "#8b93a7") + '"><title>' + tip + "</title></rect>";
      if (k === 0 || last || r.month.slice(5) === "01") svg += '<text class="ax" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 3) + '" text-anchor="' + (k === 0 ? "start" : last ? "end" : "middle") + '">' + r.month.slice(2).replace("-", "/") + "</text>";
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '">' + svg + "</svg>" + (part ? '<div class="tr-est">▨ ' + part.month.slice(5) + "월은 " + DATA.spans[part.span] + " 잠정치" + (metric === "usd" ? "를 월로 환산한 추정" : "") + "</div>" : "");
  }

  function render() {
    var month = latestMonth(span), label = DATA.spans[span];
    var cards = DATA.items.map(function (it) {
      var o = month && obs(it.id, month, span), v = o ? (metric === "usd" ? o.usd : price(o)) : null;
      return '<div class="tr-card"><b>' + esc(it.label) + '</b><div class="v">' + (metric === "usd" ? fmtUsd(v) : fmtPrice(v)) + '</div><div class="sub">' + (o ? month + " · " + label : "이 구간 관측 없음 · 아래는 월별 추이") + "</div>" + bars(it.id) + "</div>";
    }).join("");
    host.innerHTML =
      '<div class="tr-wrap"><div class="tr-head"><div><div class="kicker">KOREA EXPORTS · 10-DAY</div><h2>TRASS 순별 수출</h2>' +
      "<p>" + (month ? "<b>" + month + " " + label + "</b> 기준 · " : "") + "같은 구간끼리 비교합니다 (1~20일은 이전 달·작년 같은 달의 1~20일과).</p>" +
      '<div class="tr-cadence"><span><b>1~10일</b> → 11일경</span><span><b>1~20일</b> → 21일경</span><span><b>월 전체</b> → 익월 1일경</span></div></div>' +
      '<div class="tr-tools"><div class="toggle" id="tr-span">' + SPAN_ORDER.map(function (s) { return '<button data-s="' + s + '" class="' + (s === span ? "on" : "") + '">' + DATA.spans[s] + "</button>"; }).join("") + "</div>" +
      '<div class="toggle" id="tr-metric"><button data-m="usd" class="' + (metric === "usd" ? "on" : "") + '">수출금액</button><button data-m="price" class="' + (metric === "price" ? "on" : "") + '">수출단가</button></div></div></div>' +
      table(month) + '<div class="tr-grid">' + cards + "</div>" +
      '<div class="tr-note">수출금액은 FOB 달러, 수출단가는 금액 ÷ 순중량(kg)입니다. 중량은 칩 개수·비트 출하량이 아니므로 고부가 제품 비중이 바뀌면 단가도 바뀝니다. ' +
      '<span class="tr-src">원출처</span> 표시는 비교 기간 값이 아직 쌓이지 않아 원출처(TRASS 인용) 표기값을 그대로 보여준다는 뜻입니다. 입력: <code>python ingest_trass.py</code></div></div>';
    host.querySelectorAll("#tr-span button").forEach(function (b) { b.onclick = function () { span = b.dataset.s; render(); }; });
    host.querySelectorAll("#tr-metric button").forEach(function (b) { b.onclick = function () { metric = b.dataset.m; render(); }; });
  }

  fetch("data/trass_exports.json?t=" + Date.now()).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { DATA = d; if (!latestMonth(span)) span = SPAN_ORDER.filter(function (s) { return latestMonth(s); })[0] || span; render(); })
    .catch(function (e) { host.innerHTML = '<div class="tr-wrap"><div class="tr-empty">TRASS 데이터를 불러오지 못했습니다 (' + esc(e.message) + ")</div></div>"; });
})();
