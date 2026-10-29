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
  var DICT = [["購入お客様単価伸長率", "구매 객단가 신장률"], ["調理済み商品お届け数", "조리 완제품 배달 수"], ["アミューズメント施設", "어뮤즈먼트 시설"], ["国内飲料事業販売本数", "국내 음료 판매 개수"], ["購入お客様数伸長率", "구매 객수 신장률"], ["鉄道輸送人員定期外", "철도 수송 인원(정기권 외)"], ["カードキャッシング", "카드 현금서비스"], ["オンラインショップ", "온라인숍"], ["プレミアムサービス", "프리미엄 서비스"], ["マックスバリュ東海", "맥스밸류도카이"], ["インターナショナル", "인터내셔널"], ["鉄道輸送人員定期", "철도 수송 인원(정기권)"], ["アミューズメント", "어뮤즈먼트"], ["リボ分割払い残高", "리볼빙·할부 잔액"], ["ビジネスユニット", "사업부"], ["デベロップメント", "개발"], ["タイムズカー車両", "타임즈카 차량"], ["データベース活用", "데이터베이스 활용"], ["セブン‐イレブン", "세븐일레븐"], ["ファミリーマート", "패밀리마트"], ["横浜ファーマシー", "요코하마파머시"], ["取得業態を除く", "인수 업태 제외"], ["営業貸付金残高", "영업 대출금 잔액"], ["ドラッグストア", "드럭스토어"], ["ディスカウント", "디스카운트"], ["ビジネスウェア", "비즈니스웨어"], ["ソリューション", "솔루션"], ["クロスメディア", "크로스미디어"], ["伊勢丹新宿本店", "이세탄 신주쿠 본점"], ["リンガーハット", "링거헛"], ["ロイヤルホスト", "로열호스트"], ["イトーヨーカ堂", "이토요카도"], ["イオンリテール", "이온리테일"], ["ピーチ・ジョン", "피치존"], ["成約車両単価", "성약 차량 단가"], ["アウトレット", "아울렛"], ["ファッション", "패션"], ["フィンテック", "핀테크"], ["コーヒー飲料", "커피 음료"], ["イオン北海道", "이온홋카이도"], ["にぎり長次郎", "니기리초지로"], ["月次興行収入", "월간 흥행 수입"], ["鉄道輸送人員", "철도 수송 인원"], ["曜日調整前", " 요일 조정 전"], ["曜日調整後", " 요일 조정 후"], ["稼働日増減", "영업일 증감"], ["処方箋単価", "처방전 단가"], ["処方箋枚数", "처방전 매수"], ["関連商品他", "관련 상품 등"], ["個人買取額", "개인 매입액"], ["日当り平均", "하루 평균"], ["ドルベース", "달러 기준"], ["納品ベース", "납품 기준"], ["ネット通販", "인터넷 통판"], ["セグメント", " 부문"], ["ヤクルト類", "야쿠르트류"], ["ソフール類", "소풀류"], ["シネマズ等", "시네마즈 등"], ["モビリティ", "모빌리티"], ["パーキング", "주차"], ["活性化店舗", "활성화 점포"], ["洋服の青山", "요후쿠노아오야마"], ["三越伊勢丹", "미쓰코시이세탄"], ["大丸松坂屋", "다이마루마쓰자카야"], ["イオン九州", "이온규슈"], ["トライアル", "트라이얼"], ["カワチ薬品", "가와치약품"], ["ブックオフ", "북오프"], ["オフハウス", "오프하우스"], ["スポッチャ", "스포차"], ["サブウェイ", "서브웨이"], ["1日当たり", "하루당 "], ["旅行取扱高", "여행 취급액"], ["店頭販売額", "점포 판매액"], ["店頭売上高", "점포 매출"], ["売上総利益", "매출총이익"], ["新規出店数", "신규 출점 수"], ["月末店舗数", "월말 점포 수"], ["Eコマース", "온라인"], ["お客様単価", "객단가"], ["ヨーロッパ", "유럽"], ["曜日要因", "요일 요인"], ["既存業態", "기존 업태"], ["一品単価", "품목 단가"], ["買上点数", "구매 점수"], ["成約台数", "성약 대수"], ["開催回数", "개최 횟수"], ["商品受注", "상품 수주"], ["月末面積", "월말 면적"], ["売場面積", "매장 면적"], ["営業所数", "영업소 수"], ["経常利益", "경상이익"], ["営業債権", "영업 채권"], ["テナント", "입점"], ["販売本数", "판매 개수"], ["ビール類", "맥주류"], ["エアコン", "에어컨"], ["映画興行", "영화 흥행"], ["映画営業", "영화 영업"], ["洋画作品", "외화"], ["邦画作品", "방화"], ["訪日旅行", "방일 여행"], ["カラオケ", "노래방"], ["タイムズ", "타임즈"], ["閉店店舗", "폐점 점포"], ["九州沖縄", "규슈·오키나와"], ["アセアン", "아세안"], ["住居余暇", "주거·여가"], ["銀座本店", "긴자 본점"], ["日本橋店", "니혼바시점"], ["スシロー", "스시로"], ["丸亀製麺", "마루가메제면"], ["とんかつ", "돈가스"], ["和食さと", "와쇼쿠사토"], ["スギ薬局", "스기약국"], ["アルペン", "알펜"], ["ワコール", "와코루"], ["黒ラベル", "구로라벨"], ["アインズ", "아인즈"], ["リテール", "리테일"], ["株式会社", ""], ["営業利益", "영업이익"], ["運賃収入", "운임 수입"], ["出品台数", "출품 대수"], ["調剤薬局", "조제 약국"], ["全店舗数", "전체 점포 수"], ["グループ", "그룹"], ["ブランド", "브랜드"], ["販売数量", "판매 수량"], ["業界平均", "업계 평균"], ["スポーツ", "스포츠"], ["成約率", "성약률"], ["会員数", "회원 수"], ["併設数", "병설 수"], ["連結総", "연결 총"], ["成長率", "성장률"], ["伸長率", "신장률"], ["デンキ", "가전"], ["小売店", "소매점"], ["自販機", "자판기"], ["ビール", "맥주"], ["テレビ", "TV"], ["ゴルフ", "골프"], ["ホテル", "호텔"], ["フーズ", "푸즈"], ["子会社", "자회사"], ["大阪店", "오사카점"], ["新宿店", "신주쿠점"], ["銀座店", "긴자점"], ["浅草店", "아사쿠사점"], ["てんや", "텐야"], ["かつや", "가쓰야"], ["ガスト", "가스토"], ["鳥貴族", "도리키조쿠"], ["木曽路", "기소지"], ["髙島屋", "다카시마야"], ["パルコ", "파르코"], ["カスミ", "카스미"], ["バロー", "바로"], ["ツルハ", "쓰루하"], ["ゼビオ", "제비오"], ["ヱビス", "에비스"], ["コメ兵", "고메효"], ["トルペ", "토르페"], ["グルメ", "고메"], ["全業態", "전 업태"], ["店舗数", "점포 수"], ["客単価", "객단가"], ["売上高", "매출"], ["既存店", "기존점"], ["全店舗", "전 점포"], ["直営店", "직영점"], ["加盟店", "가맹점"], ["FC店", "가맹점"], ["百貨店", "백화점"], ["取扱高", "취급액"], ["取扱額", "취급액"], ["その他", "기타"], ["전년比", "전년비"], ["シェア", "점유율"], ["通販", "통판"], ["環境", "환경"], ["金融", "금융"], ["住建", "주택·건설"], ["外販", "외판"], ["免税", "면세"], ["小売", "소매"], ["外食", "외식"], ["流通", "유통"], ["飲料", "음료"], ["宅食", "택배 식사"], ["旅行", "여행"], ["企業", "기업"], ["法人", "법인"], ["全国", "전국"], ["全体", "전체"], ["単体", "단독"], ["単月", "단월"], ["月末", "월말"], ["月期", "월기"], ["対前", "전년 대비"], ["比率", "비율"], ["新設", "신설"], ["閉鎖", "폐쇄"], ["閉店", "폐점"], ["出店", "출점"], ["受注", "수주"], ["商品", "상품"], ["店舗", "점포"], ["中国", "중국"], ["北陸", "호쿠리쿠"], ["米国", "미국"], ["日本", "일본"], ["衣料", "의류"], ["既存", "기존"], ["業態", "업태"], ["対象", "대상"], ["除く", " 제외"], ["うち", "그중 "], ["総額", "총액"], ["本店", "본점"], ["松屋", "마쓰야"], ["西友", "세이유"], ["店数", "점포 수"], ["客数", "객수"], ["売上", "매출"], ["全店", "전점"], ["直営", "직영"], ["新店", "신규점"], ["全社", "전사"], ["合計", "합계"], ["国内", "국내 "], ["海外", "해외 "], ["事業", " 사업"], ["前期", "전기"], ["含む", " 포함"], ["映画", "영화"], ["新規", "신규 "], ["連結", "연결"], ["稼働", "가동"], ["株", ""], ["・", " · "], ["計", " 계"], ["退", "퇴점"]];
  function ko(col) { var s = col; DICT.forEach(function (d) { s = s.split(d[0]).join(d[1]); }); return s.replace(/\s+/g, " ").trim(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function getJSON(p) { return fetch(p + "?t=" + Date.now(), { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function isYoy(col) { return col.indexOf("전년比") >= 0; }
  function yoyTxt(v) { if (v == null) return "—"; var p = v - 100; return '<span class="' + (p > 0 ? "up" : p < 0 ? "dn" : "") + '">' + (p > 0 ? "+" : "") + p.toFixed(1) + "%</span>"; }
  function num(v) { if (v == null) return "—"; return typeof v === "number" ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(v)) : esc(v); }
  function mLabel(m) { return m ? m.slice(2, 4) + "." + m.slice(5, 7) : "—"; }

  // 최근 12개월 한 줄(2026-10-13 사용자: 대표 지표 대신 12개월을 쭉, 작은 주가 차트와 함께)
  function strip(x) {
    var h = x.h12 || [];
    if (!h.length) return "—";
    var cells = h.map(function (p) {
      var v = p[1] == null ? null : p[1] - 100, a = v == null ? 0 : Math.min(1, Math.abs(v) / 20) * 0.55 + 0.08;
      var bg = v == null ? "" : ' style="background:' + (v >= 0 ? "rgba(214,51,74," : "rgba(47,111,228,") + a.toFixed(2) + ')"';
      return '<i' + bg + ' title="' + esc(mLabel(p[0]) + " " + (v == null ? "없음" : (v > 0 ? "+" : "") + v.toFixed(1) + "%")) + '">' + (v == null ? "·" : (v > 0 ? "+" : "") + v.toFixed(0)) + "</i>";
    }).join("");
    return '<span class="m12">' + cells + '</span><small class="m12n">' + esc(ko(x.hk || "").replace(" 전년비", "")) + " · " + mLabel(h[0][0]) + "~" + mLabel(h[h.length - 1][0]) + "</small>";
  }
  function px6(px) {
    if (!px || px.length < 2) return '<span class="na">—</span>';
    var n = px.length, W = 90, H = 24, lo = Math.min.apply(null, px), hi = Math.max.apply(null, px), sp = (hi - lo) || 1, r = (px[n - 1] / px[0] - 1) * 100;
    var d = px.map(function (v, i) { return (i ? "L" : "M") + (i / (n - 1) * W).toFixed(1) + " " + (H - 2 - (v - lo) / sp * (H - 4)).toFixed(1); }).join("");
    return '<span class="px6"><svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><path d="' + d + '" class="' + (r >= 0 ? "up" : "dn") + '"/></svg><b class="' + (r >= 0 ? "up" : "dn") + '">' + (r >= 0 ? "+" : "") + r.toFixed(0) + "%</b></span>";
  }
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
      '<div class="jpm-seg">' + seg("pub", "최근 공시 순") + seg("hv", "최근 달 높은 순") + seg("mc", "시총 순") + "</div><span class=\"jpm-n\">" + L.length + "곳</span></div>" +
      '<div class="jpm-tbl"><div class="jpm-row head"><span>회사</span><span class="hm">업종</span><span>최신 달</span><span class="hm">공시일</span><span>최근 12개월 전년 대비 <small>(왼쪽 → 오른쪽 최신)</small></span><span class="hm">주가 6개월</span></div>' +
      L.map(function (x) {
        var open = st.open === x.c;
        return '<div class="jpm-row' + (open ? " on" : "") + '" data-c="' + esc(x.c) + '"><span class="nm"><b>' + esc(x.ko || x.n) + '</b><small>' + esc(x.c) + " · " + esc(x.ko ? x.n : x.en || "") + "</small></span>" +
          '<span class="hm cat">' + esc(x.cat || "") + "</span><span>" + mLabel(x.m) + (x.pre ? ' <i class="pre" title="속보치 — 나중에 확정치로 바뀔 수 있음">속보</i>' : "") + '</span><span class="hm mono">' + esc((x.pub || "").slice(5).replace("-", ".")) + "</span>" +
          "<span>" + strip(x) + '</span><span class="hm">' + px6(x.px) + "</span></div>" +
          (open ? '<div class="jpm-det" id="jpm-det">불러오는 중…</div>' : "");
      }).join("") + "</div>" +
      ((IX.blocked || []).length ? '<details class="jpm-blk"><summary>자동으로 못 모으는 회사 ' + IX.blocked.length + "곳 — 회사 IR 사이트에서 직접 확인</summary><ul>" +
        IX.blocked.map(function (b) { return "<li><b>" + esc(b.ko || b.n) + "</b> <small>" + esc(b.c) + "</small> · " + esc(b.why || "") + (b.url ? ' · <a href="' + esc(b.url) + '" target="_blank" rel="noopener">회사 IR ›</a>' : "") + "</li>"; }).join("") + "</ul></details>" : "") +
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
        // 달은 가로(왼쪽 → 오른쪽 최신), 지표는 세로(2026-10-30 사용자)
        '<div class="jpm-scroll"><table class="jpm-t tr"><thead><tr><th></th>' + months.slice().reverse().map(function (m) { return '<th class="mh">' + mLabel(m) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        cols.map(function (k) {
          return '<tr><td class="m" title="' + esc(k) + '">' + esc(ko(k)) + "</td>" + months.slice().reverse().map(function (m) { var v = (d.data[m] || {})[k]; return '<td title="' + (v == null ? "" : esc(v)) + '">' + (isYoy(k) ? yoyTxt(v) : num(v)) + "</td>"; }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>";
      box.innerHTML = t;
      var sc = box.querySelector(".jpm-scroll"); if (sc) sc.scrollLeft = sc.scrollWidth;   // 최신 달이 보이게
    }).catch(function () { box.innerHTML = "표를 불러오지 못했습니다."; });
  }
  document.addEventListener("vantage-view", function (e) { if (e.detail && e.detail.view === "jpm") load(); });
  if (location.hash === "#jpm") load();
})();
