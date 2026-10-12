/* jp-monthly.js — 데이터 허브 '일본 소비재 월차' (datahub.html#jpm)
   2026-10-12 사용자: 일본 기업 스크리너에 모은 월차(月次)의 원본을 데이터 허브에도 모아 둔다.
   데이터: data/jp/monthly/index.json(회사 목록·최근 새로 나온 월차) + data/jp/monthly/<코드>.json(달별 원본 표, 열 이름 원문)
   만드는 쪽: build_jp_monthly_hub.py(예약 작업 vantage-jp-monthly 가 월차를 받을 때마다). 새 월차는 텔레그램으로도 나간다.
   전년比 값은 '전년 같은 달 = 100' 지수 그대로 싣고, 옆에 ±%로 풀어 준다. */
(function () {
  "use strict";
  var host = document.getElementById("jpm-workspace");
  if (!host) return;
  var BASE = "data/jp/monthly/";
  // 열 이름 풀이 — 긴 말부터 바꾼다. 못 바꾼 말(브랜드·점포 이름 등)은 원문 그대로 둔다
  var DICT = [["1日当たり", "하루당 "], ["国内飲料事業販売本数", "국내 음료 판매 개수"], ["月次興行収入", "월간 흥행 수입"], ["旅行取扱高", "여행 취급액"], ["店頭販売額", "점포 판매액"], ["店頭売上高", "점포 매출"],
    ["売上総利益", "매출총이익"], ["営業利益", "영업이익"], ["鉄道輸送人員", "철도 수송 인원"], ["運賃収入", "운임 수입"], ["新規出店数", "신규 출점 수"], ["出品台数", "출품 대수"], ["調剤薬局", "조제 약국"],
    ["全業態", "전 업태"], ["月末店舗数", "월말 점포 수"], ["全店舗数", "전체 점포 수"], ["店舗数", "점포 수"], ["店数", "점포 수"], ["客単価", "객단가"], ["客数", "객수"], ["売上高", "매출"], ["売上", "매출"],
    ["既存店", "기존점"], ["全店舗", "전 점포"], ["全店", "전점"], ["直営店", "직영점"], ["直営", "직영"], ["加盟店", "가맹점"], ["FC店", "가맹점"], ["新店", "신규점"], ["全社", "전사"], ["合計", "합계"],
    ["グループ", "그룹"], ["ブランド", "브랜드"], ["Eコマース", "온라인"], ["国内", "국내 "], ["海外", "해외 "], ["事業", " 사업"], ["前期", "전기"], ["含む", " 포함"], ["百貨店", "백화점"],
    ["販売数量", "판매 수량"], ["取扱高", "취급액"], ["取扱額", "취급액"], ["その他", "기타"], ["映画", "영화"], ["業界平均", "업계 평균"], ["計", " 계"], ["전년比", "전년비"]];
  function ko(col) { var s = col; DICT.forEach(function (d) { s = s.split(d[0]).join(d[1]); }); return s.replace(/\s+/g, " ").trim(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getJSON(p) { return fetch(p + "?t=" + Date.now(), { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function isYoy(col) { return col.indexOf("전년比") >= 0; }
  function yoyTxt(v) { if (v == null) return "—"; var p = v - 100; return '<span class="' + (p > 0 ? "up" : p < 0 ? "dn" : "") + '">' + (p > 0 ? "+" : "") + p.toFixed(1) + "%</span>"; }
  function num(v) { if (v == null) return "—"; return typeof v === "number" ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(v)) : esc(v); }
  function mLabel(m) { return m ? m.slice(2, 4) + "." + m.slice(5, 7) : "—"; }

  var IX = null, st = { q: "", cat: "", sort: "pub", open: null };
  try { var sv = JSON.parse(localStorage.getItem("jpm-view") || "null"); if (sv) { st.cat = sv.cat || ""; st.sort = sv.sort || "pub"; } } catch (e) {}
  var CACHE = {};

  function load() {
    if (IX) return;
    host.innerHTML = '<div class="jpm-empty">월차 자료를 불러오는 중…</div>';
    getJSON(BASE + "index.json").then(function (d) { IX = d; draw(); }).catch(function () { host.innerHTML = '<div class="jpm-empty">월차 자료를 불러오지 못했습니다.</div>'; });
  }
  function draw() {
    try { localStorage.setItem("jpm-view", JSON.stringify({ cat: st.cat, sort: st.sort })); } catch (e) {}
    var items = IX.items || [], q = st.q.toLowerCase();
    var cats = items.map(function (x) { return x.cat; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var L = items.filter(function (x) {
      if (st.cat && x.cat !== st.cat) return false;
      return !q || [x.c, x.n, x.en, x.ko].some(function (s) { return String(s || "").toLowerCase().indexOf(q) >= 0; });
    });
    L.sort(st.sort === "hv" ? function (a, b) { return (b.hv || 0) - (a.hv || 0); }
      : st.sort === "mc" ? function (a, b) { return (b.mc || 0) - (a.mc || 0); }
      : function (a, b) { return String(b.pub || "").localeCompare(String(a.pub || "")) || String(b.m || "").localeCompare(String(a.m || "")); });
    var wk = new Date(Date.now() + 9 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);
    var ev = (IX.events || []).filter(function (e) { return (e.found || "") >= wk; }).slice().reverse();
    var seg = function (v, l) { return '<button data-sort="' + v + '"' + (st.sort === v ? ' aria-pressed="true"' : "") + ">" + l + "</button>"; };
    var h = '<div class="jpm-head"><div><div class="kicker">원본 데이터</div><h2>일본 소비재 월차</h2>' +
      '<p class="jpm-sub">회사가 매달 내는 기존점·전점 매출, 객수, 객단가 원본 ' + items.length + "곳 · 갱신 " + esc(IX.updated || "") + "</p></div></div>" +
      (ev.length ? '<div class="jpm-new"><b>최근 7일 새로 나온 월차 ' + ev.length + "건</b>" + ev.slice(0, 40).map(function (e) {
        return '<button class="jpm-chip" data-open="' + esc(e.c) + '">' + esc(e.ko || e.c) + " <small>" + mLabel(e.m) + "</small> " + (e.hv != null ? yoyTxt(e.hv) : "") + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="jpm-ctl"><input type="search" id="jpm-q" placeholder="회사 이름 · 코드" value="' + esc(st.q) + '">' +
      '<select id="jpm-cat"><option value="">전체 업종</option>' + cats.map(function (c) { return "<option" + (c === st.cat ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>" +
      '<div class="jpm-seg">' + seg("pub", "최근 공시 순") + seg("hv", "대표 지표 높은 순") + seg("mc", "시총 순") + "</div><span class=\"jpm-n\">" + L.length + "곳</span></div>" +
      '<div class="jpm-tbl"><div class="jpm-row head"><span>회사</span><span class="hm">업종</span><span>최신 달</span><span class="hm">공시일</span><span>대표 지표</span><span class="hm">개월</span></div>' +
      L.map(function (x) {
        var open = st.open === x.c;
        return '<div class="jpm-row' + (open ? " on" : "") + '" data-c="' + esc(x.c) + '"><span class="nm"><b>' + esc(x.ko || x.n) + '</b><small>' + esc(x.c) + " · " + esc(x.ko ? x.n : x.en || "") + "</small></span>" +
          '<span class="hm cat">' + esc(x.cat || "") + "</span><span>" + mLabel(x.m) + (x.pre ? ' <i class="pre" title="속보치 — 나중에 확정치로 바뀔 수 있음">속보</i>' : "") + '</span><span class="hm mono">' + esc((x.pub || "").slice(5).replace("-", ".")) + "</span>" +
          "<span>" + (x.hk ? '<small class="hk">' + esc(ko(x.hk).replace(" 전년비", "")) + "</small> " + yoyTxt(x.hv) : "—") + '</span><span class="hm mono">' + (x.n_m || "") + "</span></div>" +
          (open ? '<div class="jpm-det" id="jpm-det">불러오는 중…</div>' : "");
      }).join("") + "</div>" +
      '<div class="jpm-note">전년比(전년 같은 달 = 100)는 ±%로 풀어 보여 줍니다(104.7 → +4.7%). 열 이름은 회사 원문을 한국어로 풀었고, 마우스를 올리면 원문이 보입니다. ' +
      "<i class=\"pre\">속보</i>는 나중에 확정치로 바뀔 수 있는 값입니다. 출처: TDnet 공시 · 회사 IR 사이트. 새 월차가 나오면 텔레그램으로도 알려 드립니다.</div>";
    host.innerHTML = h;
    var qi = host.querySelector("#jpm-q"), tm;
    qi.oninput = function () { clearTimeout(tm); tm = setTimeout(function () { st.q = qi.value.trim(); draw(); var q2 = host.querySelector("#jpm-q"); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }, 200); };
    host.querySelector("#jpm-cat").onchange = function (e) { st.cat = e.target.value; draw(); };
    host.querySelectorAll("[data-sort]").forEach(function (b) { b.onclick = function () { st.sort = b.dataset.sort; draw(); }; });
    host.querySelectorAll(".jpm-row[data-c]").forEach(function (r) { r.onclick = function () { st.open = st.open === r.dataset.c ? null : r.dataset.c; draw(); }; });
    host.querySelectorAll("[data-open]").forEach(function (b) { b.onclick = function () { st.open = b.dataset.open; st.q = ""; st.cat = ""; draw(); var r = host.querySelector('.jpm-row[data-c="' + b.dataset.open + '"]'); if (r) r.scrollIntoView({ block: "center" }); }; });
    if (st.open) detail(st.open);
  }
  function detail(c) {
    var box = host.querySelector("#jpm-det"); if (!box) return;
    (CACHE[c] ? Promise.resolve(CACHE[c]) : getJSON(BASE + c + ".json").then(function (d) { CACHE[c] = d; return d; })).then(function (d) {
      var months = Object.keys(d.data || {}).sort().reverse(), cols = d.cols || [], lt = d.latest || {};
      var src = lt.pdf ? '<a href="' + esc(lt.pdf) + '" target="_blank" rel="noopener">원문(TDnet 공시) ›</a>' : lt.url ? '<a href="' + esc(lt.url) + '" target="_blank" rel="noopener">원문(회사 IR) ›</a>' : "";
      var t = '<div class="jpm-dh"><span>' + esc(d.name || "") + (d.name_en ? " · " + esc(d.name_en) : "") + (d.fy_end_month ? " · " + d.fy_end_month + "월 결산" : "") + "</span>" + src +
        ' <a href="jp-screener.html?u=consumer&code=' + encodeURIComponent(c) + '" target="_blank" rel="noopener">스크리너에서 재무제표·차트 ›</a></div>' +
        '<div class="jpm-scroll"><table class="jpm-t"><thead><tr><th>달</th>' + cols.map(function (k) { return '<th title="' + esc(k) + '">' + esc(ko(k)) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        months.map(function (m) {
          var r = d.data[m] || {};
          return "<tr><td class=\"m\">" + mLabel(m) + "</td>" + cols.map(function (k) { var v = r[k]; return '<td title="' + (v == null ? "" : esc(v)) + '">' + (isYoy(k) ? yoyTxt(v) : num(v)) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>";
      box.innerHTML = t;
    }).catch(function () { box.innerHTML = "표를 불러오지 못했습니다."; });
  }
  document.addEventListener("vantage-view", function (e) { if (e.detail && e.detail.view === "jpm") load(); });
  if (location.hash === "#jpm") load();
})();
