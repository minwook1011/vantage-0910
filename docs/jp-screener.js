const F = {CODE:0,NAME:1,CAT:2,IND:3,CLOSE:4,MCAP:5,REVG:6,PY:7,PYTD:8,PER:9,ROE:10,OPM:11,REV:12};
const CATS = ["리테일·유통","식품·음료","외식","라멘","게임·엔터","미용·헬스케어서비스","패션·명품","생활·홈","화장품·퍼스널케어","여행·레저"];
/* 소비재 추가 종목(data/jp/consumer-extra.js: RAW_EXT·BUNDLE_EXT — fetch_jp_consumer_extra.py 가 만든다).
   고정 번들(screener-data.js)에 없는 코드만 뒤에 붙이고 시총 순으로 다시 정렬한다. 파일이 없어도 그대로 동작. */
(function mergeConsumerExtra(){
  /* global RAW_EXT, BUNDLE_EXT */
  if(typeof RAW_EXT==="undefined" || !Array.isArray(RAW_EXT)) return;
  const have=new Set(RAW.map(r=>r[0])), added=new Set();
  RAW_EXT.forEach(r=>{ if(r && r[0] && !have.has(r[0]) && CATS.includes(r[2])){ have.add(r[0]); added.add(r[0]); RAW.push(r); } });
  if(!added.size) return;
  RAW.sort((a,b)=>(b[5]||0)-(a[5]||0));
  if(typeof BUNDLE_EXT!=="undefined" && Array.isArray(BUNDLE_EXT)){
    const hb=new Set(BUNDLE.map(b=>b.c));
    BUNDLE_EXT.forEach(b=>{ if(b && added.has(b.c) && !hb.has(b.c)){ hb.add(b.c); BUNDLE.push(b); } });
  }
})();
const BY = {}; BUNDLE.forEach(b=>BY[b.c]=b);

/* ===== 유니버스: 소비재 / 주요 기업 =====
   RAW·BUNDLE·CATS는 전역 const 배열 — 유니버스를 바꿀 때 내용만 제자리 교체하고 BY를 다시 만든다.
   주요 기업 데이터(data/jp/major-data.js: RAW_MAJ·BUNDLE_MAJ·CATS_MAJ)는 처음 고를 때만 불러온다. */
const MAJ_SRC = "data/jp/major-data.js?v=20260929a";
const UNI = {
  con:{label:"소비재", raw:RAW.slice(), bundle:BUNDLE.slice(), cats:CATS.slice(), eyebrow:"Tokyo Stock Exchange · Consumer", kanji:"消", asof:"2026-09-04"},
  maj:{label:"주요 기업", raw:null, bundle:null, cats:null, eyebrow:"Tokyo Stock Exchange · Top 200 + Nikkei 225", kanji:"主", asof:null},
};
let universe = "con", uniLoading = false, _majPromise = null;
const isMaj = () => universe==="maj";
const KPI_COLS = ["STORE","PSU"];   // 원가율·FL비율 버튼은 뺐다(2026-10-07 사용자) — 가게 상세의 비용률 표에는 그대로 있다
function swapInPlace(dst, src){ dst.length=0; for(const x of src) dst.push(x); }
function loadMajor(){
  if(UNI.maj.raw) return Promise.resolve();
  if(_majPromise) return _majPromise;
  _majPromise = new Promise((ok,fail)=>{
    const s=document.createElement("script"); s.src=MAJ_SRC; s.async=true;
    s.onload=()=>{ try{
        /* global RAW_MAJ, BUNDLE_MAJ, CATS_MAJ */
        UNI.maj.raw=RAW_MAJ; UNI.maj.bundle=BUNDLE_MAJ; UNI.maj.cats=CATS_MAJ;
        let last=0; BUNDLE_MAJ.forEach(b=>{ if(b.dd&&b.dd.length) last=Math.max(last,lastDay(b)); });
        UNI.maj.asof = last ? dstr(last) : "—";
        mergeRecent(UNI.maj, "maj");
        ok();
      }catch(e){ fail(e); } };
    s.onerror=()=>fail(new Error("load"));
    document.head.appendChild(s);
  }).catch(e=>{ _majPromise=null; throw e; });
  return _majPromise;
}
function applyUniverse(u){
  const U=UNI[u];
  universe=u;
  swapInPlace(RAW,U.raw); swapInPlace(BUNDLE,U.bundle); swapInPlace(CATS,U.cats);
  for(const k in BY) delete BY[k];
  BUNDLE.forEach(b=>BY[b.c]=b);
}
function saveUniverse(u){
  try{ localStorage.setItem("jp_screener_universe",u); }catch(e){}
  try{ const url=new URL(location.href);
    if(u==="maj") url.searchParams.set("u","major"); else url.searchParams.delete("u");
    if(/^#(u=)?(major|consumer)$/.test(url.hash)) url.hash="";
    history.replaceState(null,"",url.pathname+url.search+url.hash);
  }catch(e){}
}
function initialUniverse(){
  let v=null;
  try{ v=new URL(location.href).searchParams.get("u"); }catch(e){}
  if(!v){ const m=location.hash.match(/^#(?:u=)?(major|consumer|maj|con)$/); if(m) v=m[1]; }
  if(!v){ try{ v=localStorage.getItem("jp_screener_universe"); }catch(e){} }
  return (v==="major"||v==="maj") ? "maj" : "con";
}
/* ===== 즐겨찾기 그룹 (2026-10-07 사용자: 그룹을 만들고 어디에 넣을지 고르게) =====
   저장: 이미 기기 간 동기화가 허용된 키 "vantage-datahub-favorite-companies-v1" 의 jp 칸 — {g:[{id,n,c:[코드…]}]}
   (firebase-sync 에 새 키를 넣으면 보안 규칙에 막힌다). 로그인하면 내 계정의 다른 기기와 같아지고, 다른 사람과는 섞이지 않는다.
   예전 "jp_screener_favs"(이 브라우저에만 있던 목록)는 처음 한 번 "기본" 그룹으로 옮긴다. */
const FKEY="vantage-datahub-favorite-companies-v1";
function favRoot(){ try{ const v=JSON.parse(localStorage.getItem(FKEY)||"{}"); return v&&typeof v==="object"&&!Array.isArray(v)?v:{}; }catch(e){ return {}; } }
function loadGroups(){
  const v=favRoot(); let g=(v.jp&&Array.isArray(v.jp.g))?v.jp.g.filter(x=>x&&x.id&&Array.isArray(x.c)):[];
  try{ const old=JSON.parse(localStorage.getItem("jp_screener_favs")||"[]");
    if(Array.isArray(old)&&old.length){
      let d=g.find(x=>x.id==="base"); if(!d){ d={id:"base",n:"기본",c:[]}; g.unshift(d); }
      old.forEach(c=>{ if(!d.c.includes(c)) d.c.push(c); });
      localStorage.removeItem("jp_screener_favs"); saveGroups(g);
    } }catch(e){}
  if(!g.length) g=[{id:"base",n:"기본",c:[]}];
  return g;
}
// 그룹 색(2026-10-07 사용자: 그룹별로 별 색을 정하게). 종목이 여러 그룹에 있으면 먼저 만든 그룹 색
const FAV_PAL=["#e0901f","#d64545","#2f7de1","#1f9d6b","#8e5bd6","#d6559b","#16a3b5","#6b7a8f"];
function grpCol(g,i){ return g.col || FAV_PAL[(i==null?GROUPS.indexOf(g):i)%FAV_PAL.length]; }
function favCol(code){ for(let i=0;i<GROUPS.length;i++) if(GROUPS[i].c.includes(code)) return grpCol(GROUPS[i],i); return ""; }
function favSty(code){ const c=favCol(code); return c?` style="--fc:${c}"`:""; }
function saveGroups(g){ try{ const v=favRoot(); v.jp={g:g}; localStorage.setItem(FKEY,JSON.stringify(v)); }catch(e){} }
let GROUPS=loadGroups(), FAVS=new Set();
function rebuildFavs(){ FAVS=new Set(); GROUPS.forEach(x=>x.c.forEach(c=>FAVS.add(c))); }
rebuildFavs();
function saveFavs(){ saveGroups(GROUPS); rebuildFavs(); }
// 다른 기기에서 동기화돼 들어온 값 반영
window.addEventListener("storage",e=>{ if(e.key===FKEY){ GROUPS=loadGroups(); rebuildFavs(); renderFavFilter(); renderTable(); } });
// 필터: 0 = 전체, 1 = 즐겨찾기 전부, "g:<id>" = 그 그룹만
function favOk(code){
  if(!state.favonly) return true;
  if(state.favonly===1) return FAVS.has(code);
  const g=GROUPS.find(x=>"g:"+x.id===state.favonly); return !!(g&&g.c.includes(code));
}
function renderFavFilter(){
  const el=document.getElementById("favflt"); if(!el) return;
  if(typeof state!=="undefined" && typeof state.favonly==="string" && !GROUPS.some(x=>"g:"+x.id===state.favonly)) state.favonly=0;
  const cur=(typeof state!=="undefined")?state.favonly:0;
  const btn=(v,l,n)=>`<button data-fv="${v}" aria-pressed="${cur===v}">${esc(l)}${n!=null?` <small>${n}</small>`:""}</button>`;
  el.innerHTML=btn(0,"전체")+btn(1,"★ 전부",FAVS.size)+(GROUPS.length>1||GROUPS[0].n!=="기본"?GROUPS.map((x,i)=>btn("g:"+x.id,x.n,x.c.length).replace("<button ",`<button style="--fc:${grpCol(x,i)}" class="fgb" `)).join(""):"");
  el.querySelectorAll("button").forEach(b=>b.onclick=()=>{ const v=b.dataset.fv; state.favonly=v==="0"?0:v==="1"?1:v; renderFavFilter(); renderTable(); });
}
function closeFavPop(){ const p=document.getElementById("favpop"); if(p) p.remove(); document.removeEventListener("mousedown",favPopOut,true); }
function favPopOut(e){ const p=document.getElementById("favpop"); if(p && !p.contains(e.target)) closeFavPop(); }
function favChanged(code){
  saveFavs(); renderFavFilter(); renderTable();
  const fb=document.getElementById("dfav");
  if(fb && fb.dataset.c===code){ fb.classList.toggle("on",FAVS.has(code)); fb.textContent=FAVS.has(code)?"★":"☆"; fb.style.setProperty("--fc",favCol(code)||""); }
}
function toggleFav(code,ev){
  if(ev){ev.stopPropagation();ev.preventDefault();}
  closeFavPop();
  const pop=document.createElement("div"); pop.id="favpop"; pop.className="favpop";
  const draw=()=>{
    pop.innerHTML=`<div class="fp-h"><b>즐겨찾기 그룹</b><span class="mono">${code}</span><button class="fp-x" aria-label="닫기">×</button></div>
      <div class="fp-list">${GROUPS.map(x=>`<label class="fp-row"><input type="checkbox" data-g="${x.id}" ${x.c.includes(code)?"checked":""}><input type="color" class="fp-col" data-col="${x.id}" value="${grpCol(x)}" title="그룹 색"><span style="color:${grpCol(x)}">★</span><span>${esc(x.n)}</span><small>${x.c.length}</small>${x.id!=="base"?`<button class="fp-del" data-del="${x.id}" title="그룹 삭제">삭제</button>`:""}</label>`).join("")}</div>
      <div class="fp-new"><input type="text" placeholder="새 그룹 이름" maxlength="20"><button>+ 그룹 추가</button></div>
      <div class="fp-foot">체크한 그룹에 들어갑니다 · 모두 끄면 즐겨찾기에서 빠집니다</div>`;
    pop.querySelector(".fp-x").onclick=closeFavPop;
    pop.querySelectorAll("input[data-g]").forEach(cb=>cb.onchange=()=>{
      const g=GROUPS.find(x=>x.id===cb.dataset.g); if(!g) return;
      if(cb.checked){ if(!g.c.includes(code)) g.c.push(code); } else g.c=g.c.filter(c=>c!==code);
      favChanged(code); draw();
    });
    pop.querySelectorAll("input[data-col]").forEach(ci=>{ ci.onclick=e=>e.stopPropagation(); ci.onchange=()=>{
      const g=GROUPS.find(x=>x.id===ci.dataset.col); if(!g) return; g.col=ci.value; favChanged(code); draw(); }; });
    pop.querySelectorAll("[data-del]").forEach(b=>b.onclick=e=>{ e.preventDefault();
      const g=GROUPS.find(x=>x.id===b.dataset.del); if(!g) return;
      if(!confirm(`"${g.n}" 그룹을 지울까요? (종목 ${g.c.length}개가 이 그룹에서 빠집니다)`)) return;
      GROUPS=GROUPS.filter(x=>x!==g); favChanged(code); draw(); });
    const inp=pop.querySelector(".fp-new input"), add=()=>{ const n=inp.value.trim(); if(!n) return;
      let g=GROUPS.find(x=>x.n===n); if(!g){ const used=GROUPS.map((x,i)=>grpCol(x,i)); g={id:"g"+Date.now().toString(36),n:n,c:[],col:FAV_PAL.find(c=>!used.includes(c))||FAV_PAL[GROUPS.length%FAV_PAL.length]}; GROUPS.push(g); }
      if(!g.c.includes(code)) g.c.push(code); favChanged(code); draw(); };
    pop.querySelector(".fp-new button").onclick=add;
    inp.onkeydown=e=>{ if(e.key==="Enter") add(); };
  };
  draw(); document.body.appendChild(pop);
  const t=ev&&ev.currentTarget&&ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : (document.getElementById("dfav")||document.body).getBoundingClientRect();
  const w=pop.offsetWidth, h=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(window.innerWidth-w-8,t.left))+"px";
  pop.style.top=(t.bottom+6+h>window.innerHeight ? Math.max(8,t.top-h-6) : t.bottom+6)+"px";
  setTimeout(()=>document.addEventListener("mousedown",favPopOut,true),0);
}

let state = {cat:"전체", sort:"mc", dir:-1, minmc:0, q:"", qrom:null, onlych:0, favonly:0, smart:null, fcmpMetric:"기존점매출",
  cols:["REVG","PY","PYTD","PER","ROE","OPM","EARN"], matrix:null, matrixMon:null};

/* ===== 표시 지표(컬럼) 정의 ===== */
/* ===== 실적 발표일 (data/jp/earnings_dates.json, 매주 일요일 자동 갱신) ===== */
let EARN = {}, EARN_META = null;
const todayJST = () => new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
function earnInfo(code){
  const e = EARN[code]; if(!e || !e.date) return null;
  const d = Math.round((Date.parse(e.date) - Date.parse(todayJST()))/864e5);
  return {date:e.date, est:!!e.est, days:d};
}
function earnDays(code){ const e=earnInfo(code); return e && e.days>=0 ? e.days : null; }
/* ===== 발표 끝난 실적: 가이던스 대비·주가 반응 (data/jp/earnings_results.json, fetch_jp_earnings_results.py) ===== */
let RES = {}, RES_META = null;
const BASIS_KO = {op:"영업이익", ord:"경상이익", ni:"순이익", rev:"매출"};
const sgn = v => (v>0?"+":v<0?"−":"") + Math.abs(v).toFixed(1);
const okuYen = v => v==null ? "—" : (Math.abs(v)>=10000 ? Math.round(v/100).toLocaleString() : (v/100).toLocaleString(undefined,{maximumFractionDigits:1})) + "억엔";
const tone = v => v==null ? "" : v>0 ? " up" : v<0 ? " dn" : "";
/* 발표 10분 후 주가(data/jp/earnings_pts.json, jp_pts_watch.py — 장후 발표는 PTS, 장중은 1분봉). 2026-10-06 사용자: 다음 거래일 말고 10분 뒤 주가로 */
let PTS = {};
function ptsOf(code, date){ const p=PTS[code]; return p && p.pct10!=null && (!date || p.date===date) ? p : null; }
function ptsChip(p){
  const now = p.now_pct!=null && p.now_at && p.now_at!==p.at10 ? ` <small>지금 ${sgn(p.now_pct)}% ${p.now_at}</small>` : "";
  return `<em class="rb px big${tone(p.pct10)}" title="발표 ${p.t} → ${p.at10} ${p.src==="PTS"?"장외거래(PTS) 가격":"장중 가격"} · 기준 ${p.base_src||""} ${p.base}">발표 10분 후 ${sgn(p.pct10)}% <small>${p.src} ${p.at10}</small>${now}</em>`;
}
function resBadges(x, code){
  const pq = code ? ptsOf(code, x && x.date) : null;
  if(!x) return pq ? `<span class="eu-rx">${ptsChip(pq)}</span>` : "";
  const b = [];
  // 주가 반응을 맨 앞에(진척률 칩은 2026-10-02 사용자 요청으로 뺌 — 진척률은 마우스를 올리면 나오는 설명에만 남김)
  const p = x.px||{};
  const live = p.d1_live ? ` <small>장중 ${p.d1_at||""}</small>` : "";
  if(pq) b.push(ptsChip(pq));
  if(p.d1==null){ if(!pq) b.push(`<em class="rb px">주가 반응 ${p.base?"10분 후 가격 수집 중":"—"}</em>`); }
  else b.push(`<em class="rb px${pq?"":" big"}${tone(p.d1)}">${pq?(p.timing==="after"?"다음 거래일":"그날 종가"):"발표 후"} ${sgn(p.d1)}%${live}</em>`);
  if(p.d1!=null && !p.d1_live) b.push(`<em class="rb px${tone(p.d5)}">5D ${p.d5==null?"—":sgn(p.d5)+"%"}</em>`);
  if(x.beat && x.beat.pct!=null) b.push(`<em class="rb${tone(x.beat.pct)}">가이던스 ${sgn(x.beat.pct)}%</em>`);
  if(x.revision && !x.revision.kept && x.revision.pct!=null && x.revision.pct!==0) b.push(`<em class="rb${tone(x.revision.pct)}">${x.revision.pct>0?"상향":"하향"} ${sgn(x.revision.pct)}%</em>`);
  if(x.cons && x.cons.pct!=null) b.push(`<em class="rb${tone(x.cons.pct)}">컨센 ${sgn(x.cons.pct)}%</em>`);
  return `<span class="eu-rx">${b.join("")}</span>`;
}
// 실적 리포트 페이지(jp-report.html) 링크 — 결과 레코드에 rid가 있을 때만
function repLink(x, cls){
  if(!x || x.rid==null || x.rid==="") return "";
  return `<a class="${cls||"eu-rep"}" href="jp-report.html?id=${encodeURIComponent(x.rid)}" target="_blank" rel="noopener">실적 리포트 ›</a>`;
}
function resTip(x){
  if(!x) return "";
  const L = [];
  const per = x.kind==="FY" ? `FY${x.fy} 결산(${x.period})` : `FY${x.fy} ${x.period}`;
  const tm = x.time ? `${x.time} ${(x.px||{}).timing==="after"?"장 마감 후":(x.px||{}).timing==="pre"?"장 시작 전":"장중"}` : "시각 미상(장 마감 후로 가정)";
  L.push(`${per} · ${x.date} ${tm} 발표`);
  if(x.q) L.push(`분기(${x.q.label}) 매출 ${okuYen(x.q.rev)} · 영업 ${okuYen(x.q.op)}${x.q_yoy&&x.q_yoy.op!=null?` (영업 YoY ${sgn(x.q_yoy.op)}%)`:""}`);
  if(x.beat){
    const g=x.guide_prev||{}, a=x.fyres||{}, k=x.beat.basis;
    const src={snapshot:"발표 전 저장한 회사 예상","kabutan-hist":"카부탄 수정 이력","kabutan-article":"직전 카부탄 기사의 통기 계획"}[g.src]||"";
    L.push(`가이던스 대비: 통기 ${BASIS_KO[k]} ${okuYen(a[k])} vs 직전 회사 예상 ${okuYen(g[k])} → ${sgn(x.beat.pct)}%${src?` (기준: ${src})`:""}`);
  } else if(x.kind==="FY") L.push("가이던스 대비: 직전 회사 예상 확보 못함");
  if(x.progress){
    const p=x.progress;
    L.push(`진척률(${BASIS_KO[p.basis]}, 통기 회사 예상 대비) ${p.pct.toFixed(1)}%${p.avg!=null?` vs ${p.avg_src} ${p.avg.toFixed(1)}% → ${sgn(p.diff)}%p`:""}`);
  }
  if(x.revision) L.push(x.revision.kept ? "통기 가이던스 유지" : `통기 가이던스 ${x.revision.pct>0?"상향":x.revision.pct<0?"하향":"수정"}: ${BASIS_KO[x.revision.basis]||""} ${x.revision.pct==null?"":sgn(x.revision.pct)+"%"}${x.revision.rev_pct!=null?` · 매출 ${sgn(x.revision.rev_pct)}%`:""}`);
  if(x.next_guide) L.push(`새 회사 예상 FY${x.next_guide.fy}: 매출 ${okuYen(x.next_guide.rev)} · 영업 ${okuYen(x.next_guide.op)}${x.next_guide.op_g!=null?` (영업 ${sgn(x.next_guide.op_g)}%)`:""}`);
  if(x.cons) L.push(`분기 EPS 컨센서스 ${x.cons.est} → 실제 ${x.cons.eps} (${sgn(x.cons.pct)}%, 야후)`);
  const p=x.px;
  if(p) L.push(`주가: ${p.base_d} 종가 ${p.base.toLocaleString()}엔 기준 → ${p.d1_d||"반응일 대기"} ${p.d1==null?"—":sgn(p.d1)+"%"} · 5거래일 ${p.d5==null?"—":sgn(p.d5)+"%"}`);
  if(x.headline) L.push(`카부탄: ${x.headline}`);
  return L.join("\n");
}
function earnLabel(e, long){
  if(!e) return "—";
  const md = long ? e.date : e.date.slice(5).replace("-","/");
  const dd = e.days===0 ? "오늘" : e.days>0 ? `D-${e.days}` : "발표됨";
  return `${md} · ${dd}${e.est?" · 예상":""}`;
}
const COLS = {
  EARN:{label:"실적발표", get:r=>earnDays(r[F.CODE]), kind:"earn"},
  REVG:{label:"매출성장", get:r=>r[F.REVG], kind:"pct"},
  PY:  {label:"1Y",     get:r=>r[F.PY],   kind:"pct"},
  PYTD:{label:"YTD",    get:r=>r[F.PYTD], kind:"pct"},
  PER: {label:"PER",    get:r=>r[F.PER],  kind:"per"},
  ROE: {label:"ROE",    get:r=>r[F.ROE],  kind:"f1"},
  OPM: {label:"OPM",    get:r=>r[F.OPM],  kind:"f1"},
  STORE:{label:"점포수", kpi:"__store", kind:"int"},
  PSU: {label:"점포당매출", kpi:"__psu",   kind:"int"},
  FOOD:{label:"원가율",   kpi:"__food",  kind:"f1"},
  FLR: {label:"FL비율",   kpi:"__fl",    kind:"f1"},
};
const FIN_ORDER = ["REVG","PY","PYTD","PER","ROE","OPM","STORE","PSU","FOOD","FLR","EARN"];   // 실적발표는 맨 오른쪽
// 월별 히트맵 매트릭스로 펼칠 지표(기업 × 12개월)
const MTX = { SSS:{label:"기존점매출", metric:"기존점 매출"}, TRAF:{label:"객수", metric:"기존점 객수"},
  SPEND:{label:"객단가", metric:"기존점 객단가"}, ALLS:{label:"전점매출", metric:"전점 매출"} };
const MTX_ORDER = ["SSS","TRAF","SPEND","ALLS"];
let _mtxMonths=null;
function mtxMonths(){ if(_mtxMonths) return _mtxMonths; const s=new Set();
  for(const c in KPI){ const ts=KPI[c].ts; if(ts)(ts.m||[]).forEach(m=>s.add(m)); }
  _mtxMonths=[...s].sort().slice(-14); return _mtxMonths; }
function tsVal(code, metric, m){ const ts=(KPI[code]||{}).ts; if(!ts||!ts.s[metric]) return null; const i=ts.m.indexOf(m); return i<0?null:ts.s[metric][i]; }
function tsLatest(code, metric){ const ts=(KPI[code]||{}).ts; if(!ts||!ts.s[metric]) return null; const a=ts.s[metric]; for(let i=a.length-1;i>=0;i--) if(a[i]!=null) return a[i]; return null; }
function kpiLatest(code, metricName){
  const kpi=KPI[code]; if(!kpi) return null;
  const r=kpi.r||{};
  // 외식 표준 지표(r)를 우선 쓰고, 없으면 예전 s(점포수)로 대체
  if(metricName==="__store") return ((r.st||{}).total) ?? ((kpi.s&&kpi.s[0])?kpi.s[0]:null);
  if(metricName==="__psu")   return r.psu ?? null;
  if(metricName==="__food")  return (r.fl||{}).food ?? null;
  if(metricName==="__fl"){ const f=r.fl||{}; return (f.food!=null&&f.labor!=null)?+(f.food+f.labor).toFixed(1):null; }
  const t=tsLatest(code, metricName); if(t!=null) return t;
  for(const it of (kpi.k||[])){ const nm=it[0], vals=it[4]; if(!vals||!vals.length) continue;
    if(metricName==="기존점 매출" && nm.includes("기존점")&&!nm.includes("객")) return vals[0];
    if(metricName==="기존점 객수" && nm.includes("객수")) return vals[0];
    if(metricName==="기존점 객단가" && nm.includes("객단")) return vals[0];
    if(metricName==="전점 매출" && nm.includes("전점")) return vals[0];
  }
  return null;
}
function colValue(r, key){ const c=COLS[key]; if(!c) return null; return c.kpi ? kpiLatest(r[F.CODE], c.kpi) : c.get(r); }
function sortVal(r, key){
  if(key==="code") return r[F.CODE]; if(key==="name") return r[F.NAME];
  if(key==="mc") return r[F.MCAP]; if(key==="rev") return r[F.REV];
  return colValue(r, key);
}
function colCell(r, key){
  const c=COLS[key], v=colValue(r,key);
  if(c.kind==="earn"){ const e=earnInfo(r[F.CODE]);
    if(!e || e.days<0) return `<td><span class="na">—</span></td>`;
    const cls = e.days<=7 ? "earn soon" : "earn";
    return `<td class="${cls}"${e.est?' title="회사 미확정 · 예상일"':''}>${e.date.slice(5).replace("-","/")} <span class="dd">D-${e.days}</span>${e.est?'<span class="est">예상</span>':''}</td>`; }
  if(c.kind==="int") return v==null?`<td class="na">—</td>`:`<td>${int(v)}</td>`;
  if(c.kind==="per") return (v==null||v<0)?`<td><span class="na">—</span></td>`:`<td>${f1(v)}</td>`;
  if(c.kind==="f1") return v==null?`<td><span class="na">—</span></td>`:`<td>${f1(v)}</td>`;
  return `<td>${pct(v)}</td>`;
}
function renderColsel(){
  const el=document.getElementById("colsel"); if(!el) return;
  const finBtn=k=>`<button data-col="${k}" aria-pressed="${!state.matrix && state.cols.includes(k)}">${COLS[k].label}</button>`;
  const mtxBtn=k=>`<button data-mtx="${k}" aria-pressed="${state.matrix===k}">${MTX[k].label}</button>`;
  // 일반 지표(실적발표~OPM)는 늘 표시 — 켜고 끄는 버튼은 외식 지표와 월별 펼치기만 둔다(소비재 전용)
  if(isMaj()){ el.innerHTML=""; el.hidden=true; }
  else {
    el.hidden=false;
    el.innerHTML=`<span class="cslabel">외식 지표</span><div class="csgrp">${KPI_COLS.map(finBtn).join("")}</div>`
      +`<span class="cslabel cs2">월별 펼치기</span><div class="csgrp kpi">${MTX_ORDER.map(mtxBtn).join("")}</div>`;
  }
  el.querySelectorAll("button[data-col]").forEach(b=>b.onclick=()=>toggleCol(b.dataset.col));
  el.querySelectorAll("button[data-mtx]").forEach(b=>b.onclick=()=>setMatrix(b.dataset.mtx));
  const note=document.getElementById("mtxnote");
  if(note) note.innerHTML = state.matrix
    ? `<b>${MTX[state.matrix].label}</b> · 기업 × 월별 전년동월비(%p) · <span style="color:var(--up)">빨강 증가</span>·<span style="color:var(--down)">파랑 감소</span>, 진할수록 큼 · 월 헤더 클릭으로 그 달 순 정렬 · 다시 누르면 표로 복귀`
    : "";
}
function setMatrix(key){ state.matrix = state.matrix===key ? null : key; state.matrixMon=null; renderColsel(); renderTable(); }
function toggleCol(key){
  state.matrix=null; state.matrixMon=null;
  const i=state.cols.indexOf(key);
  if(i>=0) state.cols.splice(i,1);
  else { state.cols.push(key); state.cols.sort((a,b)=>FIN_ORDER.indexOf(a)-FIN_ORDER.indexOf(b)); }
  if(!state.cols.includes(state.sort) && !["mc","rev","code","name"].includes(state.sort)) state.sort="mc";
  renderColsel(); renderTable();
}
function sortBy(key){
  if(state.sort===key) state.dir=-state.dir;
  else { state.sort=key; state.dir=(key==="PER"||key==="EARN")?1:-1; }
  if(state.smart && state.smart.sortKey) state.smart.sortKey=null;
  const sel=document.getElementById("sort"); if([...sel.options].some(o=>o.value===key)) sel.value=key;
  renderTable();
}
// 필터만 적용(정렬 제외) — 매트릭스가 자체 정렬
function filtered(){
  const sm = state.smart && !state.smart.empty ? state.smart : null;
  return RAW.filter(r=>
    (state.cat==="전체" || r[F.CAT]===state.cat) &&
    (r[F.MCAP]||0) >= state.minmc &&
    (!state.onlych || (BY[r[F.CODE]]&&!BY[r[F.CODE]].iv)) &&
    favOk(r[F.CODE]) &&
    (!state.q || searchMatch(r, state.q, state.qrom)) &&
    (!sm || ((!sm.need109 || BY[r[F.CODE]]) && passSmart(r, sm)))
  );
}
function renderMatrix(){
  const key=state.matrix, metric=MTX[key].metric, months=mtxMonths();
  let rows=filtered().filter(r=>{ const ts=(KPI[r[F.CODE]]||{}).ts; return ts&&ts.s[metric]&&ts.s[metric].some(v=>v!=null); });
  const sm=state.matrixMon;
  const val=r=> sm ? tsVal(r[F.CODE],metric,sm) : tsLatest(r[F.CODE],metric);
  rows.sort((a,b)=>((val(b)??-1e9)-(val(a)??-1e9)));
  document.getElementById("cnt").textContent=rows.length;
  document.getElementById("empty").hidden=rows.length>0;
  const sortMon = sm || months[months.length-1];
  const head=`<tr><th class="l" style="width:34px"></th><th class="l">코드</th><th class="l">종목</th>`
    + months.map(m=>`<th data-mon="${m}">${m.slice(2)}${m===sortMon?` <span class="ar">▼</span>`:""}</th>`).join("") + `</tr>`;
  document.getElementById("thead").innerHTML=head;
  document.querySelectorAll("#thead th[data-mon]").forEach(th=>th.onclick=()=>{ state.matrixMon=th.dataset.mon; renderTable(); });
  document.getElementById("tb").innerHTML=rows.map((r,i)=>{
    const has=!!BY[r[F.CODE]];
    const cells=months.map(m=>{ const v=tsVal(r[F.CODE],metric,m); if(v==null) return `<td class="mtna">·</td>`;
      const d=v-100; return `<td class="hcell" style="background:${kheat(d,12)}" title="${m} ${v}%">${(d>=0?"+":"")+d.toFixed(1)}</td>`; }).join("");
    return `<tr data-c="${r[F.CODE]}" tabindex="0"><td class="l rk"><button class="star${FAVS.has(r[F.CODE])?" on":""}"${favSty(r[F.CODE])} onclick="toggleFav('${r[F.CODE]}',event)">★</button>${i+1}</td><td class="l tk"><span class="${has?"hasc":"noc"}"></span>${r[F.CODE]}</td><td class="l"><span class="nm jp">${esc(r[F.NAME])}</span><span class="ind">${r[F.CAT]} · ${esc(r[F.IND])}</span></td>${cells}</tr>`;
  }).join("");
}
let view  = {code:null, tf:"D", range:null, ma:{5:true,10:true,20:true,120:true}, spike:null, fin:"q"};

const int = v => v===null||v===undefined ? "—" : Math.round(v).toLocaleString("ko-KR");
const f1  = v => v===null||v===undefined ? "—" : v.toFixed(1);
const pct = v => v===null||v===undefined ? '<span class="na">—</span>'
              : `<span class="${v>0?"up":v<0?"dn":"na"}">${v>0?"+":""}${v.toFixed(1)}%</span>`;
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const dstr = d => { const t=new Date(d*86400000); return t.getUTCFullYear()+"-"+String(t.getUTCMonth()+1).padStart(2,"0")+"-"+String(t.getUTCDate()).padStart(2,"0"); };

const _CHO=['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const _JUN=['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const _JON=['','k','kk','ks','n','nj','nh','t','l','lk','lm','lb','ls','lt','lp','lh','m','p','ps','s','ss','ng','j','ch','k','t','p','h'];
function ko2rom(s){
  let o='';
  for(const c of s){const p=c.codePointAt(0);
    if(p>=0xAC00&&p<=0xD7A3){const i=p-0xAC00;o+=_CHO[i/588|0]+_JUN[(i%588)/28|0]+_JON[i%28];}
    else o+=c;}
  return o;
}
function hasKo(s){for(const c of s){const p=c.codePointAt(0);if(p>=0xAC00&&p<=0xD7A3)return true;}return false;}
/* 로마자 표기 흔들림 맞추기: KOURAKUEN·KORAKUEN·고라쿠엔(gorakuen) → 같은 열쇠 */
function nzRom(s){ return String(s).toLowerCase().replace(/[^a-z0-9]/g,"").replace(/ou|oo/g,"o").replace(/uu/g,"u").replace(/ei/g,"e").replace(/g/g,"k").replace(/d/g,"t").replace(/b/g,"p").replace(/j/g,"ch").replace(/(.)\1/g,"$1"); }
/* 회사 설명(BM)에 '코라쿠엔(幸楽苑)'처럼 적힌 한글 이름을 검색어로 */
const _KO_ALIAS={};
function koAlias(code){
  if(code in _KO_ALIAS) return _KO_ALIAS[code];
  const b=(typeof BM!=="undefined"&&BM[code])||{}, src=[b.sum||""].concat((b.seg||[]).map(x=>x.d||"")).join(" ");
  const out=[]; const re=/([가-힣][가-힣A-Za-z0-9·&]*)\s*\(([^)]*[぀-ヿ一-鿿][^)]*)\)/g; let m;
  while((m=re.exec(src))) out.push(m[1]+" "+m[2]);
  return _KO_ALIAS[code]=out.join(" ").toLowerCase();
}
function searchMatch(r, q, qrom){
  const txt=(r[F.NAME]+" "+r[F.CODE]+" "+r[F.IND]+" "+r[F.CAT]+" "+((typeof KO_NAMES!=="undefined"&&KO_NAMES[r[F.CODE]])||"")+" "+koAlias(r[F.CODE])).toLowerCase();
  if(txt.includes(q)) return true;
  if(qrom && txt.includes(qrom)) return true;
  const nq=nzRom(qrom||q); if(nq.length>=4 && nzRom(r[F.NAME]).includes(nq)) return true;
  const toks=q.split(/\s+/).filter(t=>t.length>0);
  if(toks.length>1) return toks.every(t=>{
    if(txt.includes(t)) return true;
    if(hasKo(t)){const tr=ko2rom(t).toLowerCase();if(txt.includes(tr))return true;}
    return false;
  });
  return false;
}

/* ================= 조건(자연어) 검색 ================= */
// 차트 수록 종목의 마지막 거래일(에폭일)
function lastDay(b){ let d=b.d0; for(let i=1;i<b.dd.length;i++) d+=b.dd[i]; return d; }
// 연간 매출 성장률이 최근으로 올수록 빨라지는가(가속). 확정연도만 사용.
function accel(code){
  const b=BY[code]; if(!b||!b.a||!b.a.rev) return null;
  const off = b.a.lb[0]==="TTM" ? 1 : 0;
  const rev = b.a.rev.slice(off).filter(x=>x!=null);
  if(rev.length<4) return null;                       // YoY 3개 필요
  const g=[]; for(let i=0;i<3;i++){ const c=rev[i], p=rev[i+1]; if(p<=0) return null; g.push(c/p-1); }
  // g[0]=최근 YoY, g[2]=가장 과거. 최근이 더 빠르면 가속
  const ok = g[0]>g[1] && g[1]>g[2];
  return {ok, score:(g[0]-g[2])*100, latest:g[0]*100};
}
// 최근 months개월 안에 거래량이 mult배 이상 급증한 적이 있는가
function volspike(code, mult, months){
  const b=BY[code]; if(!b||!b.sp||!b.sp.length) return null;
  const cut = lastDay(b) - months*30.4;
  let best=0;
  for(const s of b.sp){ if(s.dy>=cut && s.m>=mult) best=Math.max(best,s.m); }
  return {ok:best>0, score:best};
}

const SMETRICS = [
  {kw:["시가총액","시총"], idx:F.MCAP, unit:"money", label:"시총", fmt:v=>v>=10000?(v/10000)+"조엔":v+"억엔"},
  {kw:["매출성장률","매출 성장률","매출성장","매출 성장","매출증가율","매출 증가율"], idx:F.REVG, unit:"pct", label:"매출성장", fmt:v=>v+"%"},
  {kw:["영업이익률","영업 이익률"], idx:F.OPM, unit:"pct", label:"영업이익률", fmt:v=>v+"%"},
  {kw:["roe","자기자본이익률"], idx:F.ROE, unit:"pct", label:"ROE", fmt:v=>v+"%"},
  {kw:["per","피이알","주가수익비율"], idx:F.PER, unit:"x", label:"PER", fmt:v=>v+"배"},
  {kw:["ytd","연초이후","연초 이후"], idx:F.PYTD, unit:"pct", label:"YTD수익률", fmt:v=>v+"%"},
  // 기간을 적은 주가 조건(1·3·6개월)은 차트 주가로 계산. 기간 없이 '주가 상승률/수익률'이면 1년으로 본다
  {kw:["1개월 수익률","1개월 주가","주가 1개월","한달 수익률","한 달 수익률","1달 수익률","1개월"], get:r=>pxRet(r[F.CODE],30), unit:"pct", label:"1개월 주가", fmt:v=>v+"%"},
  {kw:["3개월 수익률","3개월 주가","주가 3개월","3개월"], get:r=>pxRet(r[F.CODE],91), unit:"pct", label:"3개월 주가", fmt:v=>v+"%"},
  {kw:["6개월 수익률","6개월 주가","주가 6개월","6개월"], get:r=>pxRet(r[F.CODE],182), unit:"pct", label:"6개월 주가", fmt:v=>v+"%"},
  {kw:["1년 수익률","1년수익률","연간 수익률","1년 주가","주가 1년","1년","주가 성장률","주가성장률","주가 상승률","주가상승률","주가 수익률","주가수익률","주가 성장","주가 상승","수익률"], idx:F.PY, unit:"pct", label:"1년수익률", fmt:v=>v+"%"},
  {kw:["매출액","매출 규모","매출"], idx:F.REV, unit:"money", label:"매출(TTM)", fmt:v=>v>=10000?(v/10000)+"조엔":v+"억엔"},
];
/* 차트 주가(일·주·월봉)로 최근 N일 등락률. 코드별로 한 번만 계산 */
const PXR = {};
function pxRet(code, days){
  const key=code+"|"+days; if(key in PXR) return PXR[key];
  const b=BY[code]; let out=null;
  if(b && b.px && b.px.length>1){
    const bars=dailyBars(b), last=bars[bars.length-1], target=last.d-days;
    let base=null; for(let i=bars.length-1;i>=0;i--){ if(bars[i].d<=target){ base=bars[i]; break; } }
    if(base && base.c>0 && last.d-base.d<=days+20) out=Math.round((last.c/base.c-1)*1000)/10;
  }
  return (PXR[key]=out);
}
function opAt(t, from, span){
  const seg = t.slice(from, from+(span||34));
  // 가장 먼저 등장하는 비교어를 채택(범위 안에 둘 다 있으면 앞선 것)
  const gte = seg.search(/이상|초과|넘|위|↑|이고?\s*고|높/);
  const lte = seg.search(/이하|미만|밑|아래|↓|낮/);
  if(gte<0 && lte<0) return null;
  if(lte<0) return ">=";
  if(gte<0) return "<=";
  return gte<lte ? ">=" : "<=";
}
function parseSmart(text){
  const t = " " + text.toLowerCase().replace(/\s+/g," ").trim() + " ";
  if(t.trim().length<2) return null;
  const cls=[], miss=[]; let need109=false, sortKey=null, sortDir=-1, sortPos=-1, sortLabel="";
  const used=[0,0];  // 이미 매칭한 구간 표시(중복 방지용은 생략, 단순 스캔)

  for(const m of SMETRICS){
    for(const kw of m.kw){
      let pos = t.indexOf(kw);
      if(pos<0) continue;
      if(m.idx===F.REV && /^\s*(성장|증가|yoy)/.test(t.slice(pos+kw.length))) continue;   // '매출 성장'은 매출 규모가 아님
      // 기간 없는 말(수익률·주가 상승률…)이 '1개월 수익률'·'ytd 수익률' 안에 들어 있으면 1년 조건으로 잡지 않는다
      if(m.idx===F.PY && !/^\d/.test(kw) && /(개월|달|주|ytd|연초)\s*$/.test(t.slice(Math.max(0,pos-6),pos))) continue;
      // 지표명 뒤에서 숫자를 찾고, 그 숫자 바로 뒤 8자 안에서만 비교어를 판정(다음 조건의 비교어를 끌어오지 않도록)
      const after = t.slice(pos+kw.length, pos+kw.length+26);
      const num = after.match(/(-?\d+(?:[.,]\d+)?)\s*(조엔|조|억엔|억|%|퍼센트|배)?/);
      const op = num ? opAt(t, pos+kw.length+num.index+num[0].length, 9) : null;
      if(num && op){
        let v = parseFloat(num[1].replace(/,/g,""));
        if(m.unit==="money" && /조/.test(num[2]||"")) v*=10000;
        cls.push({kind:"metric", idx:m.idx, get:m.get, op, val:v, label:m.label, fmt:m.fmt, per:m.unit==="x"&&op===">="?false:true});
      }
      // 정렬 기준 후보: 텍스트에서 가장 뒤에 나온 지표
      if(pos>sortPos){ sortKey={type:"metric", idx:m.idx, get:m.get}; sortPos=pos; sortLabel=m.label; }
      break;
    }
  }
  // 성장 가속
  if(/성장.{0,3}가속|가속.{0,3}성장|성장률.{0,2}(상승|증가|개선)|가속화|가속되/.test(t)){
    cls.push({kind:"accel", label:"성장 가속"});
    const p=t.search(/가속/); if(p>sortPos){ sortKey={type:"accel"}; sortPos=p; sortLabel="가속 강도"; }
  }
  // 거래량 급증
  const vm = t.match(/거래량[^\d]{0,8}(\d+(?:\.\d+)?)\s*배/);
  const vg = /거래량[^가-힣]{0,6}(급증|폭증|급등|터진|터졌|증가)/.test(t);
  if(vm || vg){
    const mult = vm ? parseFloat(vm[1]) : 5;
    const mo = t.match(/(\d+)\s*(개월|달|주)/);
    let months = 3;
    if(mo){ months = parseInt(mo[1]); if(/주/.test(mo[2])) months = Math.max(1, Math.round(months/4.3)); }
    cls.push({kind:"vol", mult, months, label:`거래량 ${mult}배`, sub:`최근 ${months}개월`}); need109=true;
    const p=t.search(/거래량/); if(p>sortPos){ sortKey={type:"vol"}; sortPos=p; sortLabel="급증 강도"; }
  }
  // 필터 조건도 정렬 기준도 못 찾으면 이해 실패
  if(!cls.length && !sortKey) return {empty:true, raw:text};
  // 정렬 방향: 텍스트에 '낮은/작은/적은/오름'이 있으면 오름차순, 아니면 내림차순. PER 정렬은 낮은 값이 기본.
  sortDir = /낮은|작은|적은|오름|낮을수록|적을수록/.test(t) ? 1 : -1;
  if(sortKey && sortKey.type==="metric" && sortKey.idx===F.PER && !/높은|큰|많|내림|높을수록/.test(t)) sortDir=1;
  return {cls, need109, sortKey, sortDir, sortLabel, raw:text};
}
function passSmart(r, sm){
  for(const c of sm.cls){
    if(c.kind==="metric"){
      let v=c.get ? c.get(r) : r[c.idx];
      if(c.idx===F.PER && (v==null||v<=0)) return false;
      if(v==null) return false;
      if(c.op===">=" && !(v>=c.val)) return false;
      if(c.op==="<=" && !(v<=c.val)) return false;
    } else if(c.kind==="accel"){
      const a=accel(r[F.CODE]); if(!a||!a.ok) return false;
    } else if(c.kind==="vol"){
      const s=volspike(r[F.CODE], c.mult, c.months); if(!s||!s.ok) return false;
    }
  }
  return true;
}
function smartScore(r, sm){
  if(!sm.sortKey) return 0;
  const k=sm.sortKey;
  if(k.type==="accel"){ const a=accel(r[F.CODE]); return a?a.score:-1e9; }
  if(k.type==="vol"){ const s=volspike(r[F.CODE], 1, 120); return s?s.score:-1e9; }
  let v=k.get ? k.get(r) : r[k.idx];
  if(k.idx===F.PER && (v==null||v<=0)) return sm.sortDir<0 ? -1e9 : 1e9;
  return v==null ? (sm.sortDir<0?-1e9:1e9) : v;
}

/* ================= 표 ================= */
function current(){
  const sm = state.smart && !state.smart.empty ? state.smart : null;
  let rows = RAW.filter(r=>
    (state.cat==="전체" || r[F.CAT]===state.cat) &&
    (r[F.MCAP]||0) >= state.minmc &&
    (!state.onlych || (BY[r[F.CODE]]&&!BY[r[F.CODE]].iv)) &&
    favOk(r[F.CODE]) &&
    (!state.q || searchMatch(r, state.q, state.qrom)) &&
    (!sm || ((!sm.need109 || BY[r[F.CODE]]) && passSmart(r, sm)))
  );
  if(sm && sm.sortKey){
    rows.sort((a,b)=>(smartScore(a,sm)-smartScore(b,sm))*sm.sortDir);
    return rows;
  }
  const s=state.sort, d=state.dir;
  rows.sort((a,b)=>{
    if(s==="code"||s==="name") return String(sortVal(a,s)).localeCompare(String(sortVal(b,s)))*(-d);
    let av=sortVal(a,s), bv=sortVal(b,s);
    if(s==="PER"){ if(av<=0)av=null; if(bv<=0)bv=null; }
    if(av===null||av===undefined) return 1;
    if(bv===null||bv===undefined) return -1;
    return (av-bv)*d;
  });
  return rows;
}
function renderThead(){
  const smartSort = state.smart && !state.smart.empty && state.smart.sortKey;
  const arrow = key => (!smartSort && key===state.sort) ? ` <span class="ar">${state.dir<0?"▼":"▲"}</span>` : "";
  let ths = `<th class="l" style="width:34px"></th>`
    + `<th class="l" data-k="code">코드${arrow("code")}</th>`
    + `<th class="l" data-k="name">종목${arrow("name")}</th>`
    + `<th data-k="mc">시총(억엔)${arrow("mc")}</th>`
    + `<th data-k="rev">매출(억엔)${arrow("rev")}</th>`;
  ths += state.cols.map(k=>`<th data-k="${k}"${COLS[k].grp==="kpi"?' style="color:var(--up)"':''}>${COLS[k].label}${arrow(k)}</th>`).join("");
  document.getElementById("thead").innerHTML = `<tr>${ths}</tr>`;
  document.querySelectorAll("#thead th[data-k]").forEach(th=>th.onclick=()=>sortBy(th.dataset.k));
}
/* 다가오는 실적 발표: 현재 카테고리·즐겨찾기 필터를 따른다. 주간 캘린더(기본) / 목록 */
let earnMode = "week", earnSpan = 14, earnWeek = null;
const earnOpen = new Set();
const WKD = ["일","월","화","수","목","금","토"];
const EU_MAX = 12;
/* 캘린더 이름: 영문 약칭 + (한글 이름) — 한글은 names-ko.js 의 첫 단어 */
function koFirst(code){ const k=(typeof KO_NAMES!=="undefined"&&KO_NAMES[code])||""; const w=k.split(/\s+/)[0]||""; return /[가-힣]/.test(w)?w:""; }
function calName(r){ const ko=koFirst(r[F.CODE]); return esc(shortName(r[F.NAME]))+(ko?` <small class="eu-ko">(${esc(ko)})</small>`:""); }
function shortName(n){ return n.replace(/,?\s+(Co\.,?\s?Ltd\.?|Company,?\s?Limited|Corporation|Corp\.?|Holdings.*|Inc\.?|Ltd\.?|Limited)$/i,""); }
const isoAdd = (iso,n) => { const t=new Date(iso+"T00:00:00Z"); t.setUTCDate(t.getUTCDate()+n); return t.toISOString().slice(0,10); };
const dowOf = iso => new Date(iso+"T00:00:00Z").getUTCDay();
const mondayOf = iso => { const d=dowOf(iso); return isoAdd(iso, d===0?-6:1-d); };
const mdDot = iso => iso.slice(5).replace("-",".");
const weekLabel = w => `${+w.slice(5,7)}월 ${Math.ceil(+w.slice(8)/7)}주차`;
function earnRows(){
  const out=[];
  RAW.forEach(r=>{
    if(state.cat!=="전체" && r[F.CAT]!==state.cat) return;
    if(!favOk(r[F.CODE])) return;
    const code=r[F.CODE], e=earnInfo(code), x=RES[code];
    if(e) out.push([r,e,x&&x.date===e.date?x:null]);
    // 발표가 끝난 종목: 실적 결과 파일의 발표일로 달력에 올린다(예정일과 같은 날이면 위에서 합쳐짐)
    if(x && (!e || e.date!==x.date)) out.push([r,{date:x.date,est:false,days:Math.round((Date.parse(x.date)-Date.parse(todayJST()))/864e5)},x]);
  });
  return out.sort((a,b)=>(b[0][F.MCAP]||0)-(a[0][F.MCAP]||0));
}
function euCo([r,e,x]){
  const tip = esc(r[F.NAME]) + (e.est?" (예상일)":"") + (x?"\n"+esc(resTip(x)):"");
  return `<button class="eu-co${FAVS.has(r[F.CODE])?" fav":""}${e.est?" est":""}${x?" done":""}" data-c="${r[F.CODE]}"${favSty(r[F.CODE])} title="${tip}"><b class="mono">${r[F.CODE]}</b><span>${calName(r)}</span>${e.est&&!x?'<i>예상</i>':''}${resBadges(x, r[F.CODE])}</button>${repLink(x)}`;
}
let euFold=false; try{ euFold=localStorage.getItem("jp_screener_eu_fold")==="1"; }catch(e){}
function renderEarnUp(){
  const box=document.getElementById("earnup"); if(!box) return;
  if(!EARN_META){ box.innerHTML=""; return; }
  const all = earnRows(), today = todayJST(), td = dowOf(today);
  const thisMon = td===6 ? isoAdd(today,2) : td===0 ? isoAdd(today,1) : mondayOf(today);
  const scope = (state.cat==="전체"?"전체":state.cat) + (state.favonly===1?" · ★ 전부":typeof state.favonly==="string"?" · ★ "+((GROUPS.find(x=>"g:"+x.id===state.favonly)||{}).n||""):"");
  let h = `<div class="eu-h"><h3>실적 발표 캘린더</h3><span class="sub">${scope} · 발표일 갱신 ${EARN_META.updated||"—"}${RES_META?` · 발표 결과 ${RES_META.updated||"—"}`:""}</span>
    ${euFold?"":`<div class="eu-seg" data-g="mode">${[["week","주간 캘린더"],["list","목록"]].map(([k,l])=>`<button data-mode="${k}" aria-pressed="${earnMode===k}">${l}</button>`).join("")}</div>`}
    <button class="eu-fold" aria-expanded="${!euFold}">${euFold?"펼치기 ▾":"접기 ▴"}</button></div>`;
  if(euFold){   // 접힌 상태 — 제목 줄만(2026-10-07 사용자)
    box.innerHTML=h; box.classList.add("folded");
    box.querySelector(".eu-fold").onclick=()=>{euFold=false; try{localStorage.setItem("jp_screener_eu_fold","0");}catch(e){} renderEarnUp();};
    return;
  }
  box.classList.remove("folded");

  if(earnMode==="week"){
    const byWeek={};
    // 지난 주는 발표 결과가 있는 주만(예정일만 있고 결과가 없는 과거 항목은 넣지 않는다)
    all.forEach(x=>{ if(x[1].date>=thisMon || x[2]){ const w=mondayOf(x[1].date); (byWeek[w]=byWeek[w]||[]).push(x); } });
    const keys=Object.keys(byWeek).sort();
    const firstW = keys.length && keys[0]<thisMon ? keys[0] : thisMon;
    const lastW = keys.length && keys[keys.length-1]>thisMon ? keys[keys.length-1] : thisMon;
    if(!earnWeek) earnWeek=thisMon;
    if(earnWeek<firstW) earnWeek=firstW;
    if(earnWeek>lastW) earnWeek=lastW;
    const weeks=[]; for(let w=firstW; w<=lastW; w=isoAdd(w,7)) weeks.push(w);
    h += `<div class="eu-weeks" role="tablist" aria-label="주차 선택">${weeks.map(w=>`<button role="tab" data-w="${w}" aria-pressed="${w===earnWeek}"><b>${weekLabel(w)}${w===thisMon?" · 이번 주":""}</b><span>${mdDot(w)}~${mdDot(isoAdd(w,4))} · ${(byWeek[w]||[]).length}개</span></button>`).join("")}</div>`;
    const prevOk = earnWeek>firstW, nextOk = earnWeek<lastW;
    h += `<div class="eu-wnav"><button data-nav="-7" ${prevOk?"":"disabled"} aria-label="이전 주">‹ 이전 주</button><b>${weekLabel(earnWeek)}</b><span class="mono">${mdDot(earnWeek)} – ${mdDot(isoAdd(earnWeek,4))}</span><button data-nav="7" ${nextOk?"":"disabled"} aria-label="다음 주">다음 주 ›</button></div>`;
    h += `<div class="eu-cal">` + [0,1,2,3,4].map(i=>{
      const d=isoAdd(earnWeek,i), open=earnOpen.has(d);
      // 지난 날짜는 결과가 있는 종목만, 결과 있는 종목을 먼저(시총 순 유지)
      const items=all.filter(x=>x[1].date===d && (d>=today || x[2])).sort((a,b)=>(b[2]?1:0)-(a[2]?1:0));
      const shown = open ? items : items.slice(0,EU_MAX);
      const cls = (d===today?" today":"") + (d<today?" past":"");
      return `<div class="eu-col${cls}"><div class="eu-colh"><b class="mono">${mdDot(d)}(${WKD[dowOf(d)]})</b><span>${d===today?"오늘 · ":""}${items.length?items.length+"개":""}</span></div>
        <div class="eu-colb">${items.length ? shown.map(euCo).join("") : `<span class="eu-none">예정 없음</span>`}${items.length>EU_MAX?`<button class="eu-more" data-d="${d}">${open?"접기":"+"+(items.length-EU_MAX)+"개 더 보기"}</button>`:""}</div></div>`;
    }).join("") + `</div>`;
    const wkend = all.filter(x=>(x[1].date===isoAdd(earnWeek,5)||x[1].date===isoAdd(earnWeek,6)) && (x[1].date>=today || x[2]));
    if(wkend.length) h += `<div class="eu-wkend">주말 발표 ${wkend.length}개: ${wkend.map(([r,e])=>`<button class="eu-link" data-c="${r[F.CODE]}">${calName(r)} ${mdDot(e.date)}</button>`).join(", ")}</div>`;
  } else {
    const by = {};
    all.forEach(([r,e])=>{ if(e.days>=0 && e.days<=earnSpan) (by[e.date]=by[e.date]||[]).push([r,e]); });
    const days = Object.keys(by).sort();
    h += `<div class="eu-seg eu-span">${[7,14,30].map(n=>`<button data-n="${n}" aria-pressed="${earnSpan===n}">${n}일</button>`).join("")}</div>`;
    if(!days.length) h += `<div class="eu-empty">이 기간에 예정된 발표가 없습니다.</div>`;
    else h += `<div class="eu-days">` + days.map(d=>{
      const items = by[d], dd = items[0][1].days;
      return `<div class="eu-day"><div class="eu-date"><b class="mono">${mdDot(d)}(${WKD[dowOf(d)]})</b><span>${dd===0?"오늘":"D-"+dd} · ${items.length}개</span></div>
        <div class="eu-list">${items.map(euCo).join("")}</div></div>`;
    }).join("") + `</div>`;
  }
  h += `<div class="eu-note">도쿄증권거래소(JPX) 공식 「결산 발표 예정일」 기준(회사가 거래소에 알린 날짜). <i class="est-i">예상</i>은 회사가 아직 날짜를 알리지 않아 작년 같은 분기 발표일 등으로 추정한 날입니다. 시총 순 정렬 · 매일 2번 자동 갱신.</div>`;
  if(RES_META) h += `<div class="eu-note eu-legend"><b>발표 끝난 종목</b> ·
    <em class="rb px big">발표 후 ±%</em> 발표 직전 종가 대비 주가 반응(장 마감 후 발표면 다음 거래일). 장중이면 현재가로 바로 보여 주고 <small>장중</small>을 붙이며, 마감 뒤 종가로 바뀝니다 ·
    <em class="rb">가이던스 ±%</em> 결산(통기) 실적 ÷ 발표 직전 회사 예상(영업이익, 없으면 경상이익) ·
    <em class="rb">상향/하향</em> 같은 날 통기 가이던스 수정 폭 ·
    <em class="rb">컨센</em> 분기 EPS 컨센서스 대비(야후, 커버 종목만) ·
    <em class="rb px">5D</em> 5거래일 뒤 종가 등락. 붉은색 +, 파란색 −, 값이 없으면 —. 종목에 마우스를 올리면 진척률 등 수치와 기준이 보입니다. 주가 반응은 평일 장중 30분마다 갱신.</div>`;
  box.innerHTML = h;
  box.querySelector(".eu-fold").onclick=()=>{euFold=true; try{localStorage.setItem("jp_screener_eu_fold","1");}catch(e){} renderEarnUp();};
  box.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{earnMode=b.dataset.mode; renderEarnUp();});
  box.querySelectorAll("[data-w]").forEach(b=>b.onclick=()=>{earnWeek=b.dataset.w; renderEarnUp();});
  box.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{earnWeek=isoAdd(earnWeek,+b.dataset.nav); renderEarnUp();});
  box.querySelectorAll("[data-n]").forEach(b=>b.onclick=()=>{earnSpan=+b.dataset.n; renderEarnUp();});
  box.querySelectorAll(".eu-more").forEach(b=>b.onclick=()=>{const d=b.dataset.d; earnOpen.has(d)?earnOpen.delete(d):earnOpen.add(d); renderEarnUp();});
  box.querySelectorAll(".eu-co,.eu-link").forEach(b=>b.onclick=()=>openDetail(b.dataset.c));
  const on = box.querySelector('.eu-weeks [aria-pressed="true"]');
  if(on){ const wk=box.querySelector(".eu-weeks"); wk.scrollLeft = on.offsetLeft - wk.offsetLeft - 8; }
}
function renderTable(){
  const mb=document.getElementById("tbmore"); if(mb) mb.hidden=true;
  if(uniLoading) return;
  renderEarnUp();
  if(state.matrix){ renderMatrix(); return; }
  const rows = current();
  const maxmc = Math.max(...rows.map(r=>r[F.MCAP]||0), 1);
  document.getElementById("cnt").textContent = rows.length;
  document.getElementById("empty").hidden = rows.length>0;
  // 한 번에 전부 그리면(700행+) 스크롤이 버벅인다 → 150행씩 그리고, 끝에 닿으면 이어서 붙인다
  const tb=document.getElementById("tb");
  tbRows=rows; tbShown=0; tbMax=maxmc; tb.innerHTML="";
  appendRows(TB_PAGE);
  renderThead();
}
const TB_PAGE=150;
let tbRows=[], tbShown=0, tbMax=1, tbIO=null;
function appendRows(n){
  const rows=tbRows, maxmc=tbMax, from=tbShown, to=Math.min(rows.length, from+n);
  document.getElementById("tb").insertAdjacentHTML("beforeend", rows.slice(from,to).map((r,j)=>{ const i=from+j;
    const mc=r[F.MCAP]||0, has=!!(BY[r[F.CODE]]&&!BY[r[F.CODE]].iv);
    const dyn = state.cols.map(k=>colCell(r,k)).join("");
    return `<tr data-c="${r[F.CODE]}" tabindex="0">
      <td class="l rk"><button class="star${FAVS.has(r[F.CODE])?" on":""}"${favSty(r[F.CODE])} onclick="toggleFav('${r[F.CODE]}',event)">★</button>${i+1}</td>
      <td class="l tk"><span class="${has?"hasc":"noc"}"></span>${r[F.CODE]}</td>
      <td class="l"><span class="nm jp">${esc(r[F.NAME])}</span><span class="ind">${r[F.CAT]} · ${esc(r[F.IND])}</span></td>
      <td class="mc">${int(mc)}<i style="width:${(mc/maxmc*46).toFixed(1)}px"></i></td>
      <td>${int(r[F.REV])}</td>${dyn}
    </tr>`;
  }).join(""));
  tbShown=to;
  let more=document.getElementById("tbmore");
  if(!more){ more=document.createElement("button"); more.id="tbmore"; more.className="tb-more"; more.onclick=()=>appendRows(TB_PAGE);
    document.querySelector(".tblwrap").after(more);
    if(window.IntersectionObserver){ tbIO=new IntersectionObserver(es=>{ if(es[0].isIntersecting && tbShown<tbRows.length) appendRows(TB_PAGE); },{rootMargin:"600px 0px"}); tbIO.observe(more); } }
  more.hidden = tbShown>=rows.length;
  more.textContent = `더 보기 (${tbShown} / ${rows.length})`;
}

/* ================= 외식 비교 ================= */
// 외식/라멘 종목의 '최신 기존점(같은 점포) 지표'를 뽑는다. YoY는 100=전년동월.
const FCMP_METRICS = ["기존점매출","객수","객단가","점포수"];
const FCMP_MAP={"기존점매출":"기존점 매출","객수":"기존점 객수","객단가":"기존점 객단가","점포수":"__store"};
function fcmpValue(code, metric){
  const v=kpiLatest(code, FCMP_MAP[metric]||metric);
  if(v==null) return null;
  // 최신 월(시계열이 있으면 그 라벨)
  let period=null; const ts=(KPI[code]||{}).ts, mn=FCMP_MAP[metric];
  if(ts && ts.s[mn]){ for(let i=ts.s[mn].length-1;i>=0;i--){ if(ts.s[mn][i]!=null){ period=ts.m[i]; break; } } }
  return {v, period};
}
function setFcmpMetric(m){ state.fcmpMetric=m; renderFoodCompare(); }
function renderFoodCompare(){
  const el=document.getElementById("foodcmp");
  if(isMaj() || !(state.cat==="외식"||state.cat==="라멘")){ el.innerHTML=""; return; }
  const metric = state.fcmpMetric || "기존점매출";
  const isStore = metric==="점포수";
  const cats = new Set(["외식","라멘"]);
  let items = RAW.filter(r=>cats.has(r[F.CAT]) && KPI[r[F.CODE]])
    .map(r=>({code:r[F.CODE], name:r[F.NAME], d:fcmpValue(r[F.CODE], metric)}))
    .filter(x=>x.d!=null);
  const seg = FCMP_METRICS.map(m=>`<button aria-pressed="${m===metric}" onclick="setFcmpMetric('${m}')">${m}</button>`).join("");
  if(!items.length){
    el.innerHTML = `<div class="fcmp"><div class="fcmp-h"><h3>외식·라멘 기존점 비교</h3></div>
      <div class="fcmp-seg">${seg}</div>
      <div class="fcmp-note">이 지표를 공개한 외식·라멘 종목이 아직 없습니다.</div></div>`;
    return;
  }
  items.sort((a,b)=>b.d.v-a.d.v);
  const vals = items.map(x=>x.d.v);
  let lo=Math.min(...vals), hi=Math.max(...vals);
  if(isStore){ lo=0; hi=Math.max(hi,1); }
  else { lo=Math.min(lo,98); hi=Math.max(hi,102); }
  const span=(hi-lo)||1;
  const pos = v => ((v-lo)/span)*100;
  const basePos = isStore ? 0 : pos(100);
  const rows = items.map(x=>{
    const v=x.d.v, p=pos(v);
    let left,width,color;
    if(isStore){ left=0; width=p; color="var(--bar)"; }
    else if(p>=basePos){ left=basePos; width=p-basePos; color="var(--up)"; }
    else { left=p; width=basePos-p; color="var(--down)"; }
    const cl = isStore ? "" : (v>=100?"up":v<100?"dn":"");
    const vt = isStore ? v.toLocaleString("ko-KR") : v.toFixed(1)+"%";
    const per = (!isStore && x.d.period) ? `<span class="fcmp-per">${x.d.period.slice(2)}</span>` : "";
    const baseLine = isStore ? "" : `<span class="base" style="left:${basePos.toFixed(1)}%"></span>`;
    return `<div class="fcmp-row" data-c="${x.code}">
      <span class="fcmp-nm"><b>${x.code}</b>${esc(x.name)}</span>
      <span class="fcmp-track">${baseLine}<i style="left:${left.toFixed(1)}%;width:${Math.max(width,0.6).toFixed(1)}%;background:${color}"></i></span>
      <span class="fcmp-v ${cl}">${vt} ${per}</span></div>`;
  }).join("");
  const noteMap = {
    "기존점매출":"기존점(개점 13개월 이상 동일 점포) 월간 매출의 전년동월비. 100 = 작년과 동일, 빨강 = 성장.",
    "객수":"기존점 객수(방문 고객 수)의 전년동월비. 매출 성장이 손님 증가에서 나오는지 보여줍니다.",
    "객단가":"기존점 객단가(1인당 지출)의 전년동월비. 가격·메뉴 믹스로 인한 성장을 보여줍니다.",
    "점포수":"공시된 그룹 총 점포수(브랜드 합산, 국내+해외). 규모 비교용."
  };
  el.innerHTML = `<div class="fcmp">
    <div class="fcmp-h"><h3>외식·라멘 기존점 비교</h3><span class="sub">같은 점포 기준 · 최신 공시 · ${items.length}개 종목</span></div>
    <div class="fcmp-seg">${seg}</div>
    <div class="fcmp-rows">${rows}</div>
    <div class="fcmp-note">${noteMap[metric]||""} 막대를 클릭하면 상세가 열립니다.</div>
  </div>`;
  el.querySelectorAll(".fcmp-row").forEach(r=>r.onclick=()=>openDetail(r.dataset.c));
}

function buildRail(){
  const el=document.getElementById("rail");
  const mk=(n,c)=>`<button class="cat" data-cat="${n}" aria-pressed="${state.cat===n}">${n}<span class="n">${c}</span></button>`;
  el.innerHTML = mk("전체",RAW.length)+CATS.map(c=>mk(c,RAW.filter(r=>r[F.CAT]===c).length)).join("");
  el.querySelectorAll(".cat").forEach(b=>b.onclick=()=>{state.cat=b.dataset.cat;buildRail();renderFoodCompare();renderTable();});
}

/* ================= 봉 집계 ================= */
function dailyBars(b){
  const out=[]; let cur=b.d0;
  for(let i=0;i<b.px.length;i++){
    cur = i===0 ? b.d0 : cur + b.dd[i];
    out.push({d:cur, c:b.px[i]/10, v:b.vo[i]*100, i});
  }
  return out;
}
function aggregate(bars, tf){
  if(tf==="D") return bars;
  const out=[]; let key=null, acc=null;
  for(const b of bars){
    const dt=new Date(b.d*86400000);
    let k;
    if(tf==="M") k = dt.getUTCFullYear()*12 + dt.getUTCMonth();
    else { const t=Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth(),dt.getUTCDate()); k = Math.floor(t/604800000); }
    if(k!==key){ if(acc) out.push(acc); key=k; acc={d:b.d, c:b.c, v:b.v, i:b.i}; }
    else { acc.d=b.d; acc.c=b.c; acc.v+=b.v; acc.i=b.i; }
  }
  if(acc) out.push(acc);
  return out;
}
function sma(arr,n){
  const out=new Array(arr.length).fill(null); let s=0;
  for(let i=0;i<arr.length;i++){ s+=arr[i]; if(i>=n) s-=arr[i-n]; if(i>=n-1) out[i]=s/n; }
  return out;
}

/* ================= 차트 ================= */
let CH = {bars:[], mas:{}, x0:0, x1:0, geo:null, spikes:[]};
const MAS=[5,10,20,120], MACOL={5:"--ma5",10:"--ma10",20:"--ma20",120:"--ma120"};
function cssv(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

function prepChart(){
  const b=BY[view.code]; if(!b) return;
  const bars=aggregate(dailyBars(b), view.tf);
  const closes=bars.map(x=>x.c);
  CH.bars=bars;
  CH.mas={}; MAS.forEach(n=>CH.mas[n]=sma(closes,n));
  const spMap={}; (b.sp||[]).forEach(s=>spMap[s.i]=s);
  CH.spikes = bars.map((bar,idx)=>{
    for(const s of (b.sp||[])) if(Math.abs(s.i-bar.i)<=(view.tf==="D"?0:(view.tf==="W"?3:15))) return {...s, x:idx};
    return null;
  }).filter(Boolean).filter((v,i,a)=>a.findIndex(z=>z.i===v.i)===i);
  const n=bars.length;
  // 일봉은 최근 구간(약 1년)만 보여주고 좌우로 패닝/확대하게 한다. 주·월봉은 전체.
  if(!view.range) view.range = view.tf==="D" ? [Math.max(0, n-1-Math.min(240, n-1)), n-1] : [0, n-1];
  view.range=[Math.max(0,view.range[0]), Math.min(n-1, view.range[1])];
  if(view.range[1]-view.range[0]<2) view.range=[0, n-1];
}

function drawChart(){
  const cv=document.getElementById("cv"), cvv=document.getElementById("cvv");
  if(!cv) return;
  const dpr=window.devicePixelRatio||1;
  const W=cv.clientWidth, H=340, HV=90;
  cv.width=W*dpr; cv.height=H*dpr; cv.style.height=H+"px";
  cvv.width=W*dpr; cvv.height=HV*dpr; cvv.style.height=HV+"px";
  const g=cv.getContext("2d"), gv=cvv.getContext("2d");
  g.setTransform(dpr,0,0,dpr,0,0); gv.setTransform(dpr,0,0,dpr,0,0);
  g.clearRect(0,0,W,H); gv.clearRect(0,0,W,HV);

  const [i0,i1]=view.range, bars=CH.bars.slice(i0,i1+1);
  if(!bars.length) return;
  const PL=8, PR=62, PT=14, PB=20;
  const cw=W-PL-PR, chh=H-PT-PB;
  let lo=Infinity, hi=-Infinity;
  bars.forEach(b=>{ lo=Math.min(lo,b.c); hi=Math.max(hi,b.c); });
  MAS.forEach(n=>{ if(!view.ma[n])return; for(let i=i0;i<=i1;i++){ const v=CH.mas[n][i]; if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v);} } });
  const pad=(hi-lo)*0.08||1; lo=Math.max(0,lo-pad); hi+=pad;   // 주가는 음수가 될 수 없다
  const X = i => PL + (bars.length===1?cw/2:(i/(bars.length-1))*cw);
  const Y = v => PT + (1-(v-lo)/(hi-lo))*chh;
  CH.geo={PL,PR,PT,PB,cw,chh,W,H,HV,lo,hi,i0,i1,X,Y,n:bars.length};

  const line=cssv("--line-soft"), mute=cssv("--ink-mute"), ink=cssv("--ink");

  // 급등 밴드
  const sp=cssv("--spike");
  CH.spikes.forEach(s=>{ if(s.x<i0||s.x>i1) return;
    const x=X(s.x-i0), w=Math.max(3,cw/bars.length);
    g.fillStyle=sp; g.fillRect(x-w/2,PT,w,chh);
    gv.fillStyle=sp; gv.fillRect(x-w/2,0,w,HV);
    g.fillStyle=cssv("--spike-line"); g.beginPath();
    g.moveTo(x,PT+1); g.lineTo(x-4,PT-5); g.lineTo(x+4,PT-5); g.closePath(); g.fill();
  });

  // 가로 그리드 + 우측 축
  g.strokeStyle=line; g.lineWidth=1; g.font='10px "IBM Plex Mono",monospace'; g.fillStyle=mute; g.textAlign="left";
  for(let k=0;k<=4;k++){
    const v=lo+(hi-lo)*k/4, y=Math.round(Y(v))+.5;
    g.beginPath(); g.moveTo(PL,y); g.lineTo(PL+cw,y); g.stroke();
    g.fillText(Math.round(v).toLocaleString("ko-KR"), PL+cw+7, y+3);
  }
  // 날짜 축 (양 끝 레이블이 잘리지 않게 정렬을 바꾼다)
  const step=Math.max(1,Math.floor(bars.length/6));
  for(let i=0;i<bars.length;i+=step){
    const s=dstr(bars[i].d), txt=view.tf==="M"?s.slice(0,7):s;
    const last=i+step>=bars.length;
    g.textAlign = i===0 ? "left" : (last ? "right" : "center");
    g.fillText(txt, i===0 ? PL : (last ? Math.min(X(i),PL+cw) : X(i)), H-6);
  }
  g.textAlign="center";

  // 이평선
  MAS.forEach(n=>{
    if(!view.ma[n]) return;
    g.strokeStyle=cssv(MACOL[n]); g.lineWidth=1.2; g.beginPath(); let started=false;
    for(let i=i0;i<=i1;i++){ const v=CH.mas[n][i]; if(v==null){started=false;continue;}
      const x=X(i-i0), y=Y(v); if(!started){g.moveTo(x,y);started=true;} else g.lineTo(x,y); }
    g.stroke();
  });
  // 주가
  g.strokeStyle=ink; g.lineWidth=1.7; g.beginPath();
  bars.forEach((b,i)=>{ const x=X(i), y=Y(b.c); i?g.lineTo(x,y):g.moveTo(x,y); });
  g.stroke();

  // 거래량
  let vmax=0; bars.forEach(b=>vmax=Math.max(vmax,b.v)); vmax=vmax||1;
  const bw=Math.max(1,cw/bars.length*0.72);
  bars.forEach((b,i)=>{
    const h=(b.v/vmax)*(HV-14), x=X(i);
    const isSp=CH.spikes.some(s=>s.x===i+i0);
    gv.fillStyle = isSp ? cssv("--spike-line") : cssv("--vol");
    gv.fillRect(x-bw/2, HV-4-h, bw, h);
  });
  gv.strokeStyle=line; gv.beginPath(); gv.moveTo(PL,HV-3.5); gv.lineTo(PL+cw,HV-3.5); gv.stroke();
}

function chartHTML(b){
  const legend = MAS.map(n=>`<button class="lgi" data-ma="${n}" aria-pressed="${view.ma[n]}"><i style="background:var(${MACOL[n]})"></i>${n}</button>`).join("");
  const spikes = (b.sp||[]).slice().sort((x,y)=>x.dy-y.dy).map(s=>
    `<button class="spk" data-sp="${s.i}"><b>${dstr(s.dy)}</b> · ${s.m}배 · ${s.d1>0?"+":""}${s.d1}%</button>`).join("");
  return `
  <div class="dsec">주가
    <span class="hint">${b.iv==="w"?"주봉 단위 수록(10년) · ":""}드래그로 좌우 이동 · 휠로 확대·축소 · 더블클릭 전체 보기 · 마우스 올리면 그날 값</span></div>
  <div class="seg" id="tf" style="margin-bottom:10px">
    ${b.iv==="w"?"":`<button data-v="D" aria-pressed="${view.tf==="D"}">일봉</button>`}
    <button data-v="W" aria-pressed="${view.tf==="W"}">주봉</button>
    <button data-v="M" aria-pressed="${view.tf==="M"}">월봉</button>
  </div>
  <div class="chartbox">
    <div class="legend"><span style="color:var(--ink);font-weight:600">종가</span>${legend}
      <span style="margin-left:auto;color:var(--ink-mute)">노란 띠 = 거래량 급증(평소 5배↑)</span></div>
    <canvas id="cv"></canvas><canvas id="cvv"></canvas>
    <div class="tip" id="tip"></div>
  </div>
  ${spikes ? `<div class="spikelist">${spikes}</div>` : ""}
  <div id="evt"></div>`;
}

/* ================= 사업 구조 ================= */
function bmHTML(code){
  const bm = BM[code];
  if(!bm && isMaj()) return "";
  if(!bm) return `<div class="dsec">사업 구조</div>
    <div class="slot">이 종목은 아직 사업 구조를 정리하지 않았습니다. 아래 카부탄·회사 IR 링크에서 확인하세요.</div>`;
  const segs = (bm.seg||[]).slice().sort((a,b)=>(b.p??-1)-(a.p??-1));
  const maxp = Math.max(...segs.map(s=>s.p??0), 1);
  const rows = segs.map(s=>`<tr>
      <td class="seg">${esc(s.n)}</td>
      <td class="desc">${esc(s.d||"")}</td>
      <td class="pw">${s.p===null||s.p===undefined ? '<span class="na">—</span>'
        : `<span class="pv">${s.p.toFixed(1)}%</span><span class="pbar"><i style="width:${(s.p/maxp*100).toFixed(1)}%"></i></span>`}</td>
    </tr>`).join("");
  return `<div class="dsec">사업 구조${bm.asof?`<span class="hint">매출 비중 · ${esc(bm.asof)} 기준</span>`:""}</div>
    <div class="fin"><table class="bmtab">
      <thead><tr><th>사업부문</th><th>무엇을 파는가</th><th>매출 비중</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${bm.sum ? `<details class="bmsum" open>
      <summary>핵심 요약 — 뭘 팔고, 성장이 어디서 나오는가<span class="chev">▾</span></summary>
      <div class="body">${esc(bm.sum)}</div></details>` : ""}`;
}

/* ================= 운영 지표 ================= */
// 히트맵 색: d=변화폭(%p), cap=최대강도 기준. 오르면 빨강·내리면 파랑, 진할수록 폭이 큼
function kheat(d,cap){ if(d==null||!isFinite(d))return"transparent"; const t=Math.max(-1,Math.min(1,d/cap));
  return t>=0?`rgba(196,52,44,${(0.05+0.45*t).toFixed(3)})`:`rgba(31,111,178,${(0.05+0.45*(-t)).toFixed(3)})`; }
function heatCells(cells){ return cells.map(c=> c&&c.d!=null
  ? `<td class="hc" style="background:${kheat(c.d,c.cap)}" title="${esc(c.title||'')}">${c.txt}</td>`
  : `<td class="hc na"></td>`).join(""); }
function heatTable(labels, rows){
  const head=`<tr><th class="hn"></th>${labels.map(p=>`<th class="hp">${p}</th>`).join("")}</tr>`;
  const body=rows.map(r=>`<tr><th class="hn">${esc(r.name)}</th>${heatCells(r.cells)}</tr>`).join("");
  return `<div class="hmwrap"><table class="hm"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
// latest("YYYY-MM")에서 n개월 라벨(오래된→최신)
function monthsBack(latest,n){ if(!/^\d{4}-\d{2}$/.test(latest||"")) return Array.from({length:n},(_,i)=>String(n-i));
  const [y,mo]=latest.split("-").map(Number); const out=[]; for(let i=n-1;i>=0;i--){ let mm=mo-i,yy=y; while(mm<=0){mm+=12;yy--;} out.push((""+yy).slice(2)+"-"+String(mm).padStart(2,"0")); } return out; }
// 외식 ts → 월간 히트맵(기존점·전점)
function heatMonthly(ts){
  const labels=ts.m.map(x=>x.slice(2)), rows=[];
  for(const [name] of KSER){ const arr=ts.s[name]; if(!arr||!arr.some(v=>v!=null))continue;
    rows.push({name, cells: arr.map(v=> v==null?null:{d:v-100,cap:12,txt:(v-100>=0?"+":"")+(v-100).toFixed(1),title:name+" "+v+"%"})}); }
  return rows.length? heatTable(labels, rows):"";
}
// 분기 실적 성장(전년동기비) 히트맵
function finGrowthHeat(b){
  const q=b&&b.q; if(!q||!q.lb||q.lb.length<5) return "";
  const lb=q.lb,n=lb.length;
  const yoyOf=key=>{ const a=q[key]||[],out=[]; for(let i=0;i<n;i++){ const cur=a[i],prev=a[i+4]; out.push((cur==null||prev==null||prev<=0)?null:(cur/prev-1)*100); } return out; };
  const rev=yoyOf("rev"),oi=yoyOf("oi");
  const idx=[]; for(let i=0;i<n;i++) if(i+4<n) idx.push(i); idx.reverse();
  if(!idx.length) return "";
  const labels=idx.map(i=>lb[i]);
  const mk=(name,arr)=>({name, cells: idx.map(i=> arr[i]==null?null:{d:arr[i],cap:40,txt:(arr[i]>0?"+":"")+arr[i].toFixed(0),title:lb[i]+" "+(arr[i]>0?"+":"")+arr[i].toFixed(1)+"%"})});
  return heatTable(labels, [mk("매출 성장",rev), mk("영업이익 성장",oi)]);
}
const isYoYname = n => /성장|기존점|객수|객단|전점|증가|월매출|매출성장/.test(n);
// 비-외식: k 데이터를 지표 성격에 맞게(증감률=히트맵, 비율/수준=값)
function kpiKBlock(kk){
  const yoyRows=[], statRows=[]; let yoyLabels=null;
  for(const [name,unit,freq,latest,vals] of kk){
    if(!vals||!vals.length) continue;
    const yoy = isYoYname(name) && unit==="%";
    if(yoy && vals.length>=3){   // 시계열(3개월+)만 미니 히트맵
      const lbls = freq==="m" ? monthsBack(latest, vals.length) : Array.from({length:vals.length},(_,i)=>String(vals.length-i));
      const rev=vals.slice().reverse();   // 최신순 → 오래된→최신
      yoyRows.push({name, cells: rev.map(v=>({d:v-100,cap:12,txt:(v-100>=0?"+":"")+(v-100).toFixed(1),title:name+" "+v+"%"}))});
      if(!yoyLabels || lbls.length>yoyLabels.length) yoyLabels=lbls;
    } else {   // 단일값/비율 → 스탯 행
      const v=vals[0], cl = yoy ? (v>=100?"up":"dn") : "";
      const vt = yoy ? ((v-100>=0?"+":"")+(v-100).toFixed(1)+"%") : (unit==="%" ? v.toFixed(1)+"%" : v.toLocaleString("ko-KR")+(unit||""));
      statRows.push(`<div class="krow2"><span class="kn2">${esc(name)}</span><span class="kv ${cl}">${vt}</span></div>`);
    }
  }
  let html="";
  if(yoyRows.length){ // 라벨은 가장 긴 것 기준으로 우측 정렬 채움
    const maxn=Math.max(...yoyRows.map(r=>r.cells.length));
    yoyRows.forEach(r=>{ while(r.cells.length<maxn) r.cells.unshift(null); });
    const labels = (yoyLabels&&yoyLabels.length===maxn)?yoyLabels:Array.from({length:maxn},(_,i)=>String(maxn-i));
    html += heatTable(labels, yoyRows);
  }
  if(statRows.length) html += `<div class="kstats">${statRows.join("")}</div>`;
  return html;
}
// 운영지표 본문(라인/히트맵 전환)
function kpiBodyHTML(code, mode){
  const kpi=KPI[code], b=BY[code];
  if(kpi && kpi.ts && kpi.ts.m && kpi.ts.m.length){
    if(mode==="heat"){
      const mon=heatMonthly(kpi.ts), fin=finGrowthHeat(b);
      return `${mon?`<div class="hmsub">기존점·전점 (월별 · 전년동월비 %p)</div>${mon}`:""}
        ${fin?`<div class="hmsub" style="margin-top:16px">전사 실적 성장 (분기 · 전년동기비 %)</div>${fin}`:""}
        <div class="kpicap"><b style="color:var(--up)">빨강=증가</b> · <b style="color:var(--down)">파랑=감소</b>, 진할수록 변동 폭이 큽니다. 숫자는 전년 대비 증감입니다.</div>`;
    }
    return `<div class="kpichart"><div class="kpileg" id="kpileg"></div><canvas id="kpicv"></canvas><div class="ktip" id="ktip"></div></div>
      <div class="kpicap">기존점 <b>객수</b>와 <b>객단가</b>를 같이 보면 매출 증가가 ‘사람이 더 온 것’인지 ‘더 쓴 것’인지 갈립니다. <b>전점</b> 매출은 신규 출점 효과까지 포함합니다.</div>`;
  }
  // 비-외식
  const body = kpiKBlock(kpi.k||[]);
  const fin = finGrowthHeat(b);
  return `${body}${fin?`<div class="hmsub" style="margin-top:16px">전사 실적 성장 (분기 · 전년동기비 %)</div>${fin}`:""}`;
}
function setKpiMode(m){
  view.kpiMode=m;
  const body=document.getElementById("kpibody"); if(!body) return;
  body.innerHTML=kpiBodyHTML(view.code, m);
  document.querySelectorAll("#kpitoggle button").forEach(bn=>bn.setAttribute("aria-pressed", bn.dataset.m===m));
  if(m==="line" && document.getElementById("kpicv")){ prepKpiChart(view.code); drawKpiChart(); wireKpiChart(); requestAnimationFrame(drawKpiChart); }
}
/* ===== 외식 표준 지표 (점포수 분해 · FL비율 · 점포당 매출) ===== */
const nfmt = v => v==null ? null : Number(v).toLocaleString("ko-KR");
function rstHTML(code){
  const r = (KPI[code]||{}).r;
  if(!r) return "";
  const st = r.st||{}, fl = r.fl||{};
  // 점포 카드 — 값이 있는 것만
  const cards = [];
  const put=(label,val,unit)=>{ if(val!=null) cards.push(`<div class="rst-c"><em>${label}</em><b>${nfmt(val)}<i>${unit}</i></b></div>`); };
  put("총 점포수", st.total, "점");
  put("국내", st.dom, "점");
  put("해외", st.ovs, "점");
  put("직영", st.direct, "점");
  put("FC·가맹", st.fc, "점");
  if(st.open!=null) cards.push(`<div class="rst-c"><em>당기 출점</em><b class="up">+${nfmt(st.open)}<i>점</i></b></div>`);
  if(st.close!=null) cards.push(`<div class="rst-c"><em>당기 폐점</em><b class="dn">−${nfmt(st.close)}<i>점</i></b></div>`);
  if(st.open!=null && st.close!=null){
    const net=st.open-st.close;
    cards.push(`<div class="rst-c"><em>순증</em><b class="${net>0?"up":net<0?"dn":""}">${net>0?"+":net<0?"−":""}${nfmt(Math.abs(net))}<i>점</i></b></div>`);
  }
  put("점포당 매출", r.psu, "백만엔");
  put("객단가", r.spend, "엔");
  // FL 비율 막대 (원가 + 인건비 = FL, 여기에 임차료까지)
  let flBlock = "";
  const segs = [["f","원가", fl.food],["l","인건비", fl.labor],["r","임차료", fl.rent]].filter(x=>x[2]!=null);
  if(segs.length){
    const flSum = (fl.food!=null && fl.labor!=null) ? (fl.food+fl.labor) : null;
    const bars = segs.map(([cls,,v])=>`<i class="${cls}" style="width:${v.toFixed(1)}%">${v.toFixed(0)}%</i>`).join("")
      + `<i style="flex:1;background:transparent"></i>`;
    const leg = segs.map(([cls,label,v])=>`<span><i class="${cls}" style="background:var(--kpi-${cls==="f"?"spend":cls==="l"?"traf":"sss"})"></i>${label} ${v.toFixed(1)}%</span>`).join("");
    flBlock = `<div class="rst-fl">
      <div class="rst-flh">매출 대비 비용률${flSum!=null?` · FL비율 ${flSum.toFixed(1)}%`:""}</div>
      <div class="rst-bar">${bars}</div>
      <div class="rst-leg">${leg}</div></div>`;
  }
  if(!cards.length && !flBlock) return "";
  return `<div class="rst">
    <div class="rst-h"><b>외식 표준 지표</b><span>${esc(r.asof||"")}</span></div>
    ${cards.length?`<div class="rst-grid">${cards.join("")}</div>`:""}
    ${flBlock}
    ${r.note?`<div class="rst-note">${esc(r.note)}</div>`:""}
  </div>`;
}
function kpiHTML(code){
  const kpi = KPI[code];
  if(!kpi || (!(kpi.k && kpi.k.length) && !(kpi.ts && kpi.ts.m && kpi.ts.m.length) && !kpi.x && !kpi.r && !(kpi.s && kpi.s[0]))) return "";
  const rst = rstHTML(code);
  let extra = "";
  // 표준 지표 표에 총 점포수가 이미 있으면 아래 한 줄짜리 점포수는 생략(중복 방지)
  if(kpi.s && kpi.s[0] && !((kpi.r||{}).st||{}).total){ const yoy=kpi.s[1];
    extra += `<div class="kst">점포수 <b>${kpi.s[0].toLocaleString("ko-KR")}점</b>${yoy!=null?` (YoY <span class="${yoy>0?"up":yoy<0?"dn":""}">${yoy>0?"+":""}${yoy}</span>)`:""}</div>`; }
  if(kpi.x && kpi.x.length){ extra += `<div class="kex">${kpi.x.map(s=>`<span>${esc(s)}</span>`).join("")}</div>`; }
  const hasTs = kpi.ts && kpi.ts.m && kpi.ts.m.length;
  const mode = hasTs ? (view.kpiMode||"line") : "heat";
  const toggle = hasTs
    ? `<div class="kseg" id="kpitoggle"><button data-m="line" aria-pressed="${mode==="line"}" onclick="setKpiMode('line')">추이</button><button data-m="heat" aria-pressed="${mode==="heat"}" onclick="setKpiMode('heat')">히트맵</button></div>`
    : "";
  const hint = hasTs ? `기존점(같은 점포)·전점 · ${kpi.ts.m[0]}~${kpi.ts.m[kpi.ts.m.length-1]}` : "";
  const src = `<div class="ksrc">출처 · <a href="https://www.ryutsuu.biz/sales/" target="_blank" rel="noopener">류츠뉴스(월차)</a> · <a href="https://kabutan.jp/stock/finance?code=${code}" target="_blank" rel="noopener">카부탄 ${code}</a> · 회사 월차 매출속보 · 유가증권보고서</div>`;
  const body = kpiBodyHTML(code, mode);
  return `<div class="dsec">운영 지표<div style="display:flex;gap:10px;align-items:center">${hint?`<span class="hint">${hint}</span>`:""}${toggle}</div></div>
    ${rst}
    <div id="kpibody"${rst?' style="margin-top:14px"':""}>${body}</div>
    ${src}${extra}`;
}

/* ===== KPI 라인차트 (기존점 매출·객수·객단가 + 전점 매출) ===== */
const KSER = [["기존점 매출","--kpi-sss"],["전점 매출","--kpi-all"],["기존점 객수","--kpi-traf"],["기존점 객단가","--kpi-spend"]];
let KC = {ts:null, active:{}, geo:null, hover:null};
function prepKpiChart(code){
  const ts = (KPI[code]||{}).ts;
  KC = {ts:ts||null, active:{}, geo:null, hover:null};
  if(ts) for(const [name] of KSER){ if((ts.s[name]||[]).some(v=>v!=null)) KC.active[name]=true; }
}
function drawKpiChart(){
  const cv=document.getElementById("kpicv"); if(!cv||!KC.ts) return;
  const dpr=window.devicePixelRatio||1, W=cv.clientWidth, H=280;
  cv.width=W*dpr; cv.height=H*dpr; cv.style.height=H+"px";
  const g=cv.getContext("2d"); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  const m=KC.ts.m, n=m.length;
  const PL=8, PR=46, PT=12, PB=22, cw=W-PL-PR, chh=H-PT-PB;
  let lo=Infinity, hi=-Infinity;
  for(const [name] of KSER){ if(!KC.active[name])continue; (KC.ts.s[name]||[]).forEach(v=>{ if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v);} }); }
  if(!isFinite(lo)){ lo=95; hi=105; }
  lo=Math.min(lo,100); hi=Math.max(hi,100);
  const pad=(hi-lo)*0.12||2; lo-=pad; hi+=pad;
  const X=i=> PL + (n===1?cw/2:(i/(n-1))*cw);
  const Y=v=> PT + (1-(v-lo)/(hi-lo))*chh;
  KC.geo={PL,PR,PT,PB,cw,chh,W,H,X,Y,n,lo,hi};
  const line=cssv("--line-soft"), mute=cssv("--ink-mute");
  g.font='10px "IBM Plex Mono",monospace'; g.textAlign="left";
  for(let k=0;k<=4;k++){ const v=lo+(hi-lo)*k/4, y=Math.round(Y(v))+.5;
    g.strokeStyle=line; g.lineWidth=1; g.beginPath(); g.moveTo(PL,y); g.lineTo(PL+cw,y); g.stroke();
    const pct=Math.round(v-100); g.fillStyle=mute; g.fillText((pct>0?"+":"")+pct+"%", PL+cw+6, y+3); }
  // 100(전년동월) 기준선 강조
  const y100=Math.round(Y(100))+.5; g.strokeStyle=mute; g.globalAlpha=.5; g.lineWidth=1.2;
  g.beginPath(); g.moveTo(PL,y100); g.lineTo(PL+cw,y100); g.stroke(); g.globalAlpha=1;
  const step=Math.max(1,Math.round(n/6));
  for(let i=0;i<n;i+=step){ const last=i+step>=n; g.textAlign=i===0?"left":(last?"right":"center");
    g.fillStyle=mute; g.fillText(m[i], i===0?PL:(last?Math.min(X(i),PL+cw):X(i)), H-6); }
  g.textAlign="center";
  for(const [name,col] of KSER){ if(!KC.active[name])continue; const arr=KC.ts.s[name]||[];
    g.strokeStyle=cssv(col); g.lineWidth=1.8; g.beginPath(); let started=false;
    for(let i=0;i<n;i++){ const v=arr[i]; if(v==null){started=false;continue;} const x=X(i),y=Y(v); if(!started){g.moveTo(x,y);started=true;} else g.lineTo(x,y); }
    g.stroke();
    g.fillStyle=cssv(col); for(let i=0;i<n;i++){ const v=arr[i]; if(v==null)continue; g.beginPath(); g.arc(X(i),Y(v),2.1,0,7); g.fill(); }
  }
  if(KC.hover!=null && KC.hover>=0 && KC.hover<n){ const hx=X(KC.hover);
    g.strokeStyle=mute; g.lineWidth=1; g.setLineDash([3,3]); g.beginPath(); g.moveTo(hx,PT); g.lineTo(hx,PT+chh); g.stroke(); g.setLineDash([]);
    for(const [name,col] of KSER){ if(!KC.active[name])continue; const v=(KC.ts.s[name]||[])[KC.hover]; if(v==null)continue;
      g.fillStyle=cssv(col); g.beginPath(); g.arc(hx,Y(v),3.4,0,7); g.fill();
      g.fillStyle=cssv("--surface"); g.beginPath(); g.arc(hx,Y(v),1.5,0,7); g.fill(); }
  }
}
function wireKpiChart(){
  const cv=document.getElementById("kpicv"), tip=document.getElementById("ktip"), leg=document.getElementById("kpileg");
  if(!cv||!KC.ts) return;
  leg.innerHTML = KSER.filter(([name])=>(KC.ts.s[name]||[]).some(v=>v!=null))
    .map(([name,col])=>`<button data-s="${name}" aria-pressed="${!!KC.active[name]}"><i style="background:var(${col})"></i>${name}</button>`).join("");
  leg.querySelectorAll("button").forEach(bn=>bn.onclick=()=>{ const s=bn.dataset.s; KC.active[s]=!KC.active[s]; bn.setAttribute("aria-pressed",!!KC.active[s]); drawKpiChart(); });
  const idxAt=ev=>{ const rc=cv.getBoundingClientRect(),G=KC.geo; if(!G)return null; const x=ev.clientX-rc.left; const t=(x-G.PL)/G.cw; return Math.max(0,Math.min(G.n-1,Math.round(t*(G.n-1)))); };
  cv.onmousemove=ev=>{ const G=KC.geo; if(!G)return; const k=idxAt(ev); if(k===null)return; KC.hover=k; drawKpiChart();
    const rows=KSER.filter(([name])=>KC.active[name] && (KC.ts.s[name]||[])[k]!=null)
      .map(([name,col])=>{ const v=KC.ts.s[name][k], p=v-100; return `<div class="ktr"><span><i style="background:var(${col})"></i>${name}</span><b class="${v>=100?"up":"dn"}">${p>0?"+":""}${p.toFixed(1)}%</b></div>`; }).join("");
    tip.innerHTML=`<div class="ktd">${KC.ts.m[k]}</div>${rows||'<div class="ktr"><span>데이터 없음</span></div>'}`; tip.classList.add("on");
    const px=G.X(k), rc=cv.getBoundingClientRect(); tip.style.left=Math.min(rc.width-176,Math.max(4,px+14))+"px"; tip.style.top="10px"; };
  cv.onmouseleave=()=>{ KC.hover=null; tip.classList.remove("on"); drawKpiChart(); };
  // 패널 슬라이드/리사이즈로 캔버스가 실제 폭을 얻는 순간 다시 그린다(빈 차트 방지)
  if(window.ResizeObserver){
    let lastW=0;
    const ro=new ResizeObserver(()=>{ if(!cv.isConnected){ ro.disconnect(); return; } const w=cv.clientWidth; if(w>0 && w!==lastW){ lastW=w; drawKpiChart(); } });
    ro.observe(cv);
  }
}

/* ================= 실적 ================= */
function heat(p){
  if(p===null||p===undefined||!isFinite(p)) return "transparent";
  const t=Math.max(-1,Math.min(1,p/50));
  return t>=0 ? `rgba(196,52,44,${(0.06+0.40*t).toFixed(3)})`
              : `rgba(31,111,178,${(0.06+0.40*(-t)).toFixed(3)})`;
}
function gr(cur,prev){
  if(cur===null||prev===null||cur===undefined||prev===undefined) return null;
  if(prev===0) return null;
  if(prev<0) return null;                       // 적자 기준 증감률은 오독 소지가 커 생략
  return (cur/prev-1)*100;
}
function gtxt(p){
  if(p===null) return '<span class="na">—</span>';
  return `<b class="${p>0?"up":p<0?"dn":"na"}">${p>0?"+":""}${p.toFixed(0)}%</b>`;
}
/* 회계연도 라벨(26Q4·2026)을 실제 달로 — 결산월이 회사마다 달라 헷갈린다(2026-10-07 사용자). 결산월은 JPX 발표 예정일 자료의 fy_end.
   라벨 연도 = 그 회계연도가 끝나는 해(예: 3월 결산 27Q1 = 2026년 4~6월) */
function fyEndMonth(code){ const b=BY[code]; if(b && b.fm) return +b.fm; const e=EARN[code]; const m=e&&e.fy_end&&/^\d{4}-(\d{2})/.exec(e.fy_end); return m?+m[1]:null; }
function periodOf(lb, fym, isQ){
  if(!fym || lb==null) return "";
  const yy = n => String((n%100+100)%100).padStart(2,"0"), mm = n => String(n).padStart(2,"0");
  if(isQ){
    const m=/^(\d{2})Q([1-4])$/.exec(String(lb)); if(!m) return "";
    let y=2000+(+m[1]), e=fym-3*(4-(+m[2]));
    while(e<=0){ e+=12; y--; }
    let s=e-2, sy=y; if(s<=0){ s+=12; sy--; }
    return `${yy(sy)}.${mm(s)}~${sy===y?"":yy(y)+"."}${mm(e)}`;
  }
  if(!/^\d{4}$/.test(String(lb))) return "";
  const y=+lb; let s=fym+1, sy=y-1; if(s>12){ s-=12; sy++; }
  return `${yy(sy)}.${mm(s)}~${yy(y)}.${mm(fym)}`;
}
// 영업이익 칸 맨 위에 영업이익률(OPM) — 2026-10-07 사용자: 모든 기업
function opmTxt(oi, rev){
  const v = (oi==null||!rev||rev<=0) ? null : oi/rev*100;
  return `<span class="opm">OPM <b>${v==null?"—":v.toFixed(1)+"%"}</b></span>`;
}
function finHTML(b){
  const src = view.fin==="q" ? b.q : b.a;
  const isQ = view.fin==="q";
  if(!src || !src.lb || !src.lb.length) return `<div class="slot">이 종목은 실적 데이터를 불러오지 못했습니다.</div>`;
  // 연간 표는 TTM을 빼고 확정 회계연도 5개만 쓴다
  const off = (!isQ && src.lb[0]==="TTM") ? 1 : 0;
  const n=Math.min(5, src.lb.length-off);
  const rows=[["매출액","rev"],["영업이익","oi"],["당기순이익","ni"]];
  // 연간에서만, 그리고 예상 연도가 최신 확정 연도보다 뒤일 때만 컨센서스 칸을 붙인다
  const latest = (!isQ && src.lb[off]!=null) ? String(src.lb[off]) : null;
  const est = (!isQ && b.f && latest && /^\d{4}$/.test(latest) && +b.f.y > +latest) ? b.f : null;
  // 왼쪽 = 과거, 오른쪽 = 최근(예상 칸은 맨 오른쪽). 데이터 배열은 최근이 앞이라 거꾸로 돈다
  let head=`<tr><th>억엔</th>`;
  const fym=fyEndMonth(b.c);
  for(let i=n-1;i>=0;i--){ const pd=periodOf(src.lb[i+off], fym, isQ); head+=`<th${i===0?' class="lastp"':""}>${esc(src.lb[i+off])}${pd?`<small>${pd}${i===0?" · 최근":""}</small>`:""}</th>`; }
  if(est) head+=`<th class="esth${est.co?" co":""}">${esc(est.y)}E</th>`;
  head+=`</tr>`;
  let body="";
  for(const [label,key] of rows){
    const a=src[key]||[];
    body+=`<tr><th>${label}</th>`;
    for(let i=n-1;i>=0;i--){
      const j=i+off, cur=a[j];
      const qoq=gr(cur, a[j+1]);
      const yoy=isQ ? gr(cur, a[j+4]) : gr(cur, a[j+1]);
      body+=`<td class="fcell" style="background:${heat(yoy)}">
        <span class="fv">${cur===null||cur===undefined?"—":Math.round(cur).toLocaleString("ko-KR")}</span>
        <span class="fg">${key==="oi"?opmTxt(cur,(src.rev||[])[j]):""}${isQ?`<span>QoQ ${gtxt(qoq)}</span>`:""}<span>YoY ${gtxt(yoy)}</span></span></td>`;
    }
    if(est){
      const ev=est[key], eyoy=gr(ev, a[off]);
      body+=`<td class="fcell est" style="background:${heat(eyoy)}">
        <span class="fv">${ev===null||ev===undefined?"—":Math.round(ev).toLocaleString("ko-KR")}</span>
        <span class="fg">${key==="oi"?opmTxt(ev,est.rev):""}<span>YoY ${gtxt(eyoy)}</span></span></td>`;
    }
    body+=`</tr>`;
  }
  const warn = src.warn ? `<div class="warn">⚠ ${esc(src.warn)}</div>` : "";
  const estNote = est
    ? (est.co ? `<b>${esc(est.y)}E</b>는 확정 실적이 아니라 <b>회사 예상(가이던스)</b>입니다(점선 칸, 카부탄 기준). `
              : `<b>${esc(est.y)}E</b>는 확정 실적이 아니라 애널리스트 <b>${est.n}명</b>의 컨센서스 평균입니다(점선 칸). `)
    : (!isQ && !b.f ? (isMaj() ? `이 종목은 회사 예상이 없어 예상 칸이 비어 있습니다. ` : `이 종목은 애널리스트 컨센서스가 없어 예상 칸이 비어 있습니다. `) : "");
  return `${warn}<div class="fin"><table class="fintab"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="slot" style="margin-top:11px;border-style:solid">${estNote}배경색은 <b>YoY 증감률</b>입니다 — 플러스가 클수록 붉게, 마이너스가 클수록 푸르게(±50%에서 최대). 직전 기가 적자면 증감률이 의미를 잃어 <b>—</b>로 둡니다.</div>`;
}

/* ================= 상세 ================= */
function openDetail(code){
  const r=RAW.find(x=>x[F.CODE]===code); if(!r) return;
  const b=BY[code];
  // 분기 데이터가 없는 종목(반기만 공시 등)은 연간을 기본 탭으로 연다
  const hasQ = b && b.q && b.q.lb && b.q.lb.length;
  view={code, tf:(b&&b.iv==="w")?"W":"D", range:null, ma:{5:true,10:true,20:true,120:true}, spike:null, fin:hasQ?"q":"a", kpiMode:"line"};
  const links=[["株探 카부탄","주가·뉴스·결산 속보",`https://kabutan.jp/stock/?code=${code}`],
    ["IR BANK","10년+ 장기 재무",`https://irbank.net/${code}`],
    ["Buffett Code","경쟁사 재무 비교",`https://www.buffett-code.com/company/${code}/`],
    ["logmi Finance","결산설명회 녹취록",`https://finance.logmi.jp/search?query=${code}`],
    ["StockAnalysis","영문 재무 10년",`https://stockanalysis.com/quote/tyo/${code}/`],
    ["TradingView","차트 원본",`https://www.tradingview.com/symbols/TSE-${code}/`]];
  const cells=[["종가 (엔)",int(r[F.CLOSE])],["시가총액 (억엔)",int(r[F.MCAP])],["매출 TTM (억엔)",int(r[F.REV])],
    ["매출성장 YoY",r[F.REVG]===null?"—":(r[F.REVG]>0?"+":"")+f1(r[F.REVG])+"%",r[F.REVG]],
    ["주가 1년",r[F.PY]===null?"—":(r[F.PY]>0?"+":"")+f1(r[F.PY])+"%",r[F.PY]],
    ["주가 YTD",r[F.PYTD]===null?"—":(r[F.PYTD]>0?"+":"")+f1(r[F.PYTD])+"%",r[F.PYTD]],
    ["PER",r[F.PER]===null||r[F.PER]<0?"—":f1(r[F.PER])+"배"],["ROE",r[F.ROE]===null?"—":f1(r[F.ROE])+"%"],
    ["영업이익률",r[F.OPM]===null?"—":f1(r[F.OPM])+"%"],
    ["다음 실적 발표",earnLabel(earnInfo(code),true)]];

  document.getElementById("pin").innerHTML=`
    <div class="ptop"><div>
      <div class="dtk">TSE : ${code}</div>
      <div class="dnm jp">${esc(r[F.NAME])}</div>
      <div class="chips"><span class="chip k">${r[F.CAT]}</span><span class="chip">${esc(r[F.IND])}</span>${(()=>{const e=earnInfo(code);return e&&e.days>=0?`<span class="chip earnchip">실적발표 ${earnLabel(e)}</span>`:"";})()}</div>
      ${RES[code]?`<div class="d-res" title="${esc(resTip(RES[code]))}"><span class="d-res-h">최근 실적 ${mdDot(RES[code].date)} · ${RES[code].kind==="FY"?"결산":RES[code].period}</span>${resBadges(RES[code], code)}${repLink(RES[code],"d-rep")}</div>`:""}
    </div><div style="display:flex;gap:7px"><button class="favbtn${FAVS.has(code)?" on":""}" id="dfav" data-c="${code}"${favSty(code)} title="즐겨찾기 그룹">${FAVS.has(code)?"★":"☆"}</button><button class="x" id="dx" aria-label="닫기">×</button></div></div>

    <div class="dtabs" role="tablist"><button data-dt="info" aria-pressed="true">기본 정보</button><button data-dt="earn" aria-pressed="false">실적발표 <small id="dt-earn-n"></small></button></div>
    <div id="dt-earn" hidden></div>
    <div id="dt-info">
    ${bmHTML(code)}

    ${kpiHTML(code)}

    ${b ? chartHTML(b) : `<div class="dsec">주가</div><div class="slot">이 종목은 주가 데이터 수집에 실패했습니다. 아래 카부탄·트레이딩뷰 링크에서 확인하세요.</div>`}

    <div class="dsec">실적
      <div class="seg" id="fintg"><button data-v="q" aria-pressed="true">분기</button><button data-v="a" aria-pressed="false">연간</button></div></div>
    <div id="finbox">${b ? finHTML(b) : `<div class="slot">실적 데이터를 수록하지 않은 종목입니다.</div>`}</div>

    <div class="dsec">현재 지표</div>
    <div class="grid">${cells.map(c=>{
      const cl=c.length>2&&c[2]!==null?(c[2]>0?"up":c[2]<0?"dn":""):"";
      return `<div class="cell"><span>${c[0]}</span><b class="${cl}">${c[1]}</b></div>`;}).join("")}</div>

    <div class="dsec">1차 자료</div>
    <div class="links">${links.map(l=>`<a class="lk" href="${l[2]}" target="_blank" rel="noopener"><b>${l[0]}</b><span>${l[1]}</span></a>`).join("")}</div>
    </div>`;

  document.getElementById("panel").classList.add("on");
  document.getElementById("scrim").classList.add("on");
  document.getElementById("panel").scrollTop=0;
  document.getElementById("dx").onclick=closeDetail;
  document.getElementById("dfav").onclick=e=>toggleFav(code,e);
  wireDetail(b);
  wireDetailTabs(code);
}
/* ===== 종목 창: 기본 정보 | 실적발표(발표마다 탭이 쌓임) — 리포트 내용은 jp-report.js 가 그린다 ===== */
function earnList(code){
  if(!window.JPReport) return Promise.resolve([]);
  return JPReport.index().then(ix=>(ix.reports||[]).filter(x=>x.c===code).sort((a,b)=>String(b.d).localeCompare(String(a.d))));
}
function wireDetailTabs(code){
  const box=document.getElementById("dt-earn"), info=document.getElementById("dt-info");
  let list=null, cur=null;
  const show=t=>{
    document.querySelectorAll(".dtabs button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.dt===t));
    info.hidden = t!=="info"; box.hidden = t!=="earn";
    if(t==="earn") drawEarn();
    if(t==="info" && BY[code]) drawChart();
  };
  const drawEarn=()=>{
    if(!list){ box.innerHTML=`<div class="slot">실적발표 목록 불러오는 중…</div>`; earnList(code).then(l=>{ list=l; drawEarn(); }); return; }
    if(!list.length){ box.innerHTML=`<div class="slot">아직 이 종목의 실적 리포트가 없습니다. 실적 시즌(1·2·4·5·7·8·10·11월)에는 일·화·목 21시에 발표분이 자동으로 쌓이고, 쌓인 발표는 여기서 탭으로 모두 볼 수 있습니다. <a href="https://kabutan.jp/stock/finance?code=${code}" target="_blank" rel="noopener">카부탄 결산 표 ›</a></div>`; return; }
    if(!cur) cur=list[0].rid;
    box.innerHTML=`<div class="rtabs">${list.map(x=>`<button data-rid="${esc(x.rid)}" aria-pressed="${x.rid===cur}"><span>${esc(x.d)}</span><b>${esc(x.cq||x.p||"")} 실적발표</b>${x.note?`<i title="요약·분석 있음">요약</i>`:""}</button>`).join("")}</div><div class="jr jr-embed" id="rbody"><div class="slot">리포트 불러오는 중…</div></div>`;
    box.querySelectorAll(".rtabs button").forEach(b=>b.onclick=()=>{ cur=b.dataset.rid; drawEarn(); });
    const rid=cur;
    JPReport.load(rid).then(([R,N])=>{ if(cur!==rid||view.code!==code) return; const rb=document.getElementById("rbody"); rb.innerHTML=JPReport.html(R,N,true); if(JPReport.hydrate) JPReport.hydrate(rb,R); })
      .catch(()=>{ const el=document.getElementById("rbody"); if(el) el.innerHTML=`<div class="slot">리포트를 불러오지 못했습니다.</div>`; });
  };
  document.querySelectorAll(".dtabs button").forEach(b=>b.onclick=()=>show(b.dataset.dt));
  earnList(code).then(l=>{ list=l; const n=document.getElementById("dt-earn-n"); if(n&&view.code===code) n.textContent=l.length?l.length+"건":""; });
  // 머리글의 '실적 리포트 ›' 링크는 새 창 대신 이 탭으로
  const hr=document.querySelector("#pin .d-rep"); if(hr) hr.onclick=e=>{ e.preventDefault(); show("earn"); };
  show("info");   // 종목을 열면 늘 기본 정보부터
}
function closeDetail(){
  document.getElementById("panel").classList.remove("on");
  document.getElementById("scrim").classList.remove("on");
  view.code=null;
}

function showEvent(i){
  const b=BY[view.code]; if(!b) return;
  const s=(b.sp||[]).find(x=>x.i===i); if(!s) return;
  view.spike=i;
  document.querySelectorAll(".spk").forEach(el=>el.setAttribute("aria-pressed", el.dataset.sp===String(i)));
  const key=`${view.code}:${s.i}`, note=NEWS[key];
  const day=dstr(s.dy);
  const search=`https://kabutan.jp/stock/news?code=${view.code}`;
  document.getElementById("evt").innerHTML=`
    <div class="evt">
      <h4>${day} · 거래량 평소의 ${s.m}배</h4>
      <div class="meta">당일 ${s.d1>0?"+":""}${s.d1}% &nbsp;·&nbsp; 이후 5거래일 ${s.f5>0?"+":""}${s.f5}% &nbsp;·&nbsp; 20거래일 ${s.f20>0?"+":""}${s.f20}%</div>
      ${note ? `<p>${esc(note.t)}</p><div class="src">출처 · ${note.s.map(u=>`<a href="${u.u}" target="_blank" rel="noopener">${esc(u.n)}</a>`).join(" / ")}</div>`
             : `<p>이 이벤트의 배경은 아직 조사하지 않았습니다. 아래에서 해당 시점 공시·뉴스를 확인하세요.</p>
                <div class="src"><a href="${search}" target="_blank" rel="noopener">카부탄 뉴스 이력</a></div>`}
    </div>`;
}

function wireDetail(b){
  const ft=document.getElementById("fintg");
  if(ft) ft.querySelectorAll("button").forEach(x=>x.onclick=()=>{
    ft.querySelectorAll("button").forEach(y=>y.setAttribute("aria-pressed","false"));
    x.setAttribute("aria-pressed","true"); view.fin=x.dataset.v;
    document.getElementById("finbox").innerHTML=finHTML(b);
  });
  // KPI 라인차트(외식·라멘) — 패널 슬라이드 후 레이아웃이 잡히면 다시 그린다
  if(document.getElementById("kpicv")){ prepKpiChart(view.code); drawKpiChart(); wireKpiChart(); requestAnimationFrame(drawKpiChart); }
  if(!b) return;
  const tf=document.getElementById("tf");
  tf.querySelectorAll("button").forEach(x=>x.onclick=()=>{
    tf.querySelectorAll("button").forEach(y=>y.setAttribute("aria-pressed","false"));
    x.setAttribute("aria-pressed","true"); view.tf=x.dataset.v; view.range=null; prepChart(); drawChart();
  });
  document.querySelectorAll(".lgi").forEach(x=>x.onclick=()=>{
    const n=+x.dataset.ma; view.ma[n]=!view.ma[n]; x.setAttribute("aria-pressed",view.ma[n]); drawChart();
  });
  document.querySelectorAll(".spk").forEach(x=>x.onclick=()=>showEvent(+x.dataset.sp));
  prepChart(); drawChart(); wireCanvas();
  if((b.sp||[]).length) showEvent(b.sp[0].i);
}

function wireCanvas(){
  const cv=document.getElementById("cv"), tip=document.getElementById("tip");
  const MINW=8;                       // 최소 표시 봉 수(=window+1)
  let pan=null, moved=false;          // 패닝 상태 / 실제로 끌렸는지(클릭과 구분)
  const idxAt = ev => {
    const rc=cv.getBoundingClientRect(), G=CH.geo; if(!G) return null;
    const x=ev.clientX-rc.left;
    const t=(x-G.PL)/G.cw;
    return Math.max(0, Math.min(G.n-1, Math.round(t*(G.n-1))));
  };
  // 절대 인덱스 [i0,i1]로 표시 구간을 설정(범위·최소폭 클램프). TradingView식 이동/확대의 공통 경로.
  const setRange = (i0,i1) => {
    const N=CH.bars.length;
    let w=Math.round(i1-i0);
    w=Math.max(MINW, Math.min(N-1, w));
    i0=Math.round(i0); if(i0<0) i0=0;
    i1=i0+w;
    if(i1>N-1){ i1=N-1; i0=Math.max(0,i1-w); }
    view.range=[i0,i1];
  };
  cv.onmousemove = ev => {
    const G=CH.geo; if(!G) return;
    if(pan){                          // 드래그 중 → 좌우 패닝
      const dxpx = ev.clientX - pan.mx;
      const span = pan.r0[1]-pan.r0[0];
      const dBars = Math.round(dxpx * span / G.cw);
      if(dBars!==0) moved=true;
      setRange(pan.r0[0]-dBars, pan.r0[1]-dBars);   // 오른쪽으로 끌면 과거로 이동
      tip.classList.remove("on");
      drawChart();
      return;
    }
    const k=idxAt(ev); if(k===null) return;
    const b=CH.bars[G.i0+k]; if(!b) return;
    const rows=[`<div class="tr"><span>종가</span><b>${b.c.toLocaleString("ko-KR")}엔</b></div>`,
      `<div class="tr"><span>거래량</span><b>${Math.round(b.v/1000).toLocaleString("ko-KR")}K</b></div>`];
    MAS.forEach(n=>{ if(!view.ma[n])return; const v=CH.mas[n][G.i0+k];
      if(v!=null) rows.push(`<div class="tr"><span style="color:var(${MACOL[n]})">MA${n}</span><b>${Math.round(v).toLocaleString("ko-KR")}</b></div>`); });
    tip.innerHTML=`<div class="td">${dstr(b.d)}</div>${rows.join("")}`;
    tip.classList.add("on");
    const px=G.X(k), rc=cv.getBoundingClientRect();
    tip.style.left = Math.min(rc.width-160, Math.max(4, px+12))+"px";
    tip.style.top  = "44px";
    drawChart();
    const g=cv.getContext("2d");
    g.strokeStyle=cssv("--ink-mute"); g.lineWidth=1; g.setLineDash([3,3]);
    g.beginPath(); g.moveTo(px,G.PT); g.lineTo(px,G.PT+G.chh); g.stroke(); g.setLineDash([]);
    g.fillStyle=cssv("--ink"); g.beginPath(); g.arc(px,G.Y(b.c),3,0,7); g.fill();
  };
  cv.onmouseleave = ()=>{ tip.classList.remove("on"); pan=null; cv.style.cursor="grab"; drawChart(); };
  cv.onmousedown = ev => { pan={mx:ev.clientX, r0:[...view.range]}; moved=false; cv.style.cursor="grabbing"; };
  cv.onmouseup = ev => {
    cv.style.cursor="grab";
    if(pan && !moved){                // 끌지 않았으면 클릭 → 근처 급등 이벤트 선택
      const k=idxAt(ev), G=CH.geo;
      if(k!==null && G){
        const abs=G.i0+k; let best=null, bd=1e9;
        CH.spikes.forEach(s=>{ const d=Math.abs(s.x-abs); if(d<bd){bd=d;best=s;} });
        if(best && bd<=Math.max(2, Math.round(G.n/120))) showEvent(best.i);
      }
    }
    pan=null;
  };
  cv.ondblclick = ()=>{ view.range=[0,CH.bars.length-1]; drawChart(); };
  // 휠 = 커서 위치를 기준으로 확대/축소
  cv.onwheel = ev => {
    const G=CH.geo; if(!G) return;
    ev.preventDefault();
    const k=idxAt(ev); if(k===null) return;
    const anchor=G.i0+k, i0=view.range[0], w=view.range[1]-view.range[0];
    const nw=Math.max(MINW, Math.min(CH.bars.length-1, Math.round(w*(ev.deltaY>0?1.18:0.84))));
    const rel = w ? (anchor-i0)/w : .5;               // 커서 아래 봉을 제자리에 고정
    setRange(anchor-rel*nw, anchor-rel*nw+nw);
    drawChart();
  };
  cv.style.cursor="grab";
}

/* ================= 이벤트 ================= */
document.getElementById("tb").addEventListener("click",e=>{const tr=e.target.closest("tr"); if(tr) openDetail(tr.dataset.c);});
document.getElementById("tb").addEventListener("keydown",e=>{
  if(e.key==="Enter"||e.key===" "){const tr=e.target.closest("tr"); if(tr){e.preventDefault();openDetail(tr.dataset.c);}}});
document.getElementById("scrim").onclick=closeDetail;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDetail();});
const defDir=s=>(s==="PER"||s==="EARN"?1:-1);
document.getElementById("sort").onchange=e=>{state.sort=e.target.value;state.dir=defDir(e.target.value);if(state.smart&&state.smart.sortKey)state.smart.sortKey=null;renderTable();};
renderFavFilter();
[["minmc","minmc"],["onlych","onlych"]].forEach(([id,key])=>{
  const el=document.getElementById(id);
  el.querySelectorAll("button").forEach(b=>b.onclick=()=>{
    el.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed","false"));
    b.setAttribute("aria-pressed","true"); state[key]=+b.dataset.v; renderTable();});
});
let tmr; document.getElementById("q").oninput=e=>{clearTimeout(tmr);tmr=setTimeout(()=>{
  state.q=e.target.value.trim().toLowerCase();
  state.qrom=hasKo(state.q)?ko2rom(state.q).toLowerCase():null;
  renderTable();
},140);};

/* ---- 조건 검색 ---- */
function renderSmartChips(){
  const box=document.getElementById("sqchips"), sm=state.smart;
  if(!sm){ box.innerHTML=""; return; }
  if(sm.empty){ box.innerHTML=`<span class="sqchip miss">이해할 수 있는 조건을 찾지 못했습니다 — 예: “시총 3000억엔 이상, 매출성장 10% 이상 순”</span>`; return; }
  let h="";
  for(const c of sm.cls){
    if(c.kind==="metric") h+=`<span class="sqchip ok">${c.label} ${c.op===">="?"≥":"≤"} <span class="mono">${c.fmt(c.val)}</span></span>`;
    else if(c.kind==="accel") h+=`<span class="sqchip ok">성장 가속 (연 매출성장률 3년 우상향)</span>`;
    else if(c.kind==="vol") h+=`<span class="sqchip ok">거래량 ${c.mult}배↑ · ${c.sub}</span>`;
  }
  if(sm.sortLabel) h+=`<span class="sqchip sort">정렬 · ${sm.sortLabel} ${sm.sortDir<0?"↓":"↑"}</span>`;
  if(sm.need109) h+=`<span class="sqchip scope">거래량 조건은 일봉 수록 ${BUNDLE.filter(x=>!x.iv).length}개에만 적용</span>`;
  box.innerHTML=h;
}
function runSmart(){
  const v=document.getElementById("sq").value;
  state.smart = v.trim() ? parseSmart(v) : null;
  document.getElementById("sqclear").hidden = !state.smart;
  renderSmartChips(); renderTable();
}
function clearSmart(){
  document.getElementById("sq").value=""; state.smart=null;
  document.getElementById("sqclear").hidden=true;
  renderSmartChips(); renderTable();
}
document.getElementById("sqgo").onclick=runSmart;
document.getElementById("sqclear").onclick=clearSmart;
document.getElementById("sq").addEventListener("keydown",e=>{ if(e.key==="Enter") runSmart(); });

window.addEventListener("resize",()=>{ if(view.code&&BY[view.code]) drawChart(); });
matchMedia("(prefers-color-scheme:dark)").addEventListener("change",()=>{ if(view.code&&BY[view.code]) drawChart(); });

/* ---- 유니버스 전환 ---- */
const NOTE_HTML = {con: document.getElementById("unote") ? document.getElementById("unote").innerHTML : "",
  maj: `<b>모든 종목을 클릭하면 주가 차트(10년, 주봉·월봉)와 분기·연간 실적이 열립니다.</b>
    주요 기업은 <b>도쿄증권거래소 시가총액 상위 200개</b>(전 시장)와 <b>닛케이225 구성 종목</b>을 합친 목록이며, 섹터는 東証33業種을 묶어 나눴습니다.
    매출·영업이익은 카부탄 결산(3개월 실적) 기준 최근 4분기 합(TTM), 매출성장은 그 1년 전 TTM 대비, 연간 표의 <b>E</b> 칸은 회사 예상(가이던스)입니다.
    PER은 회사 예상 기준, ROE는 최근 확정 연도 값입니다. 은행·보험 등 영업이익을 공시하지 않는 업종은 영업이익 칸에 경상이익을 표시하고 영업이익률은 비워 둡니다.
    매주 토요일 자동 갱신.`};
function renderHeader(){
  const U=UNI[universe];
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set("eyebrow", U.eyebrow); set("subkind", isMaj()?"섹터별":"카테고리별"); set("kanji", U.kanji);
  set("s-n", RAW.length); set("s-ch", BUNDLE.length);
  set("s-m", (RAW.reduce((a,r)=>a+(r[F.MCAP]||0),0)/10000).toFixed(0));
  set("asof", U.asof||"—");
  const note=document.getElementById("unote"); if(note) note.innerHTML=NOTE_HTML[universe];
  document.querySelectorAll("#useg button[data-u]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.u===universe));
  const us=(u,t)=>{ const el=document.querySelector(`#useg button[data-u="${u}"] span`); if(el) el.textContent=t; };
  us("con", `${UNI.con.raw.length} · 카테고리별`);
  if(UNI.maj.raw) us("maj", `${UNI.maj.raw.length} · 시총 상위 200 + 닛케이225`);
  // 외식 전용 정렬·일봉 필터는 소비재에서만
  document.querySelectorAll("#sort option").forEach(o=>{ const kpi=/외식/.test(o.textContent); o.hidden=kpi&&isMaj(); o.disabled=kpi&&isMaj(); });
  const oc=document.getElementById("onlych"); if(oc&&oc.closest(".fld")) oc.closest(".fld").hidden=isMaj();
  document.title = `일본 기업 스크리너 · ${U.label} — 100억`;
}
function resetForUniverse(){
  state.cat="전체"; state.matrix=null; state.matrixMon=null; state.onlych=0;
  state.cols=state.cols.filter(k=>k!=="FOOD"&&k!=="FLR");
  if(isMaj()) state.cols=state.cols.filter(k=>!KPI_COLS.includes(k));
  if(!state.cols.length) state.cols=["REVG","PY","PYTD","PER","ROE","OPM","EARN"];
  state.cols.sort((a,b)=>FIN_ORDER.indexOf(a)-FIN_ORDER.indexOf(b));
  const okSort=["mc","rev","code","name",...Object.keys(COLS).filter(k=>!(isMaj()&&KPI_COLS.includes(k)))];
  if(!okSort.includes(state.sort)){ state.sort="mc"; state.dir=-1; }
  const sel=document.getElementById("sort"); if(sel && [...sel.options].some(o=>o.value===state.sort)) sel.value=state.sort;
  const oc=document.getElementById("onlych");
  if(oc) oc.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed", x.dataset.v==="0"));
  earnWeek=null; earnOpen.clear();
}
/* ===== 매일 주가 이어 붙이기 (data/jp/px_recent.json · fetch_jp_px.py · 평일 16:40 KST) =====
   번들(screener-data.js·major-data.js)은 그대로 두고, 번들 마지막 봉 이후 일봉만 받아 뒤에 붙인다.
   주봉 번들(iv:"w")은 같은 주(월요일 시작)면 마지막 봉을 덮어쓰고, 새 주면 봉을 하나 더한다.
   붙인 뒤 종가·시총·1년/YTD 수익률을 새 주가로 다시 계산한다. */
let PXREC = null;
const wkStart = d => d - ((d + 3) % 7);   // 에폭일 0 = 목요일 → 월요일로 내림
function retFrom(b, day){
  const bars=dailyBars(b), last=bars[bars.length-1]; let base=null;
  for(let i=bars.length-1;i>=0;i--){ if(bars[i].d<=day){ base=bars[i]; break; } }
  return base && base.c>0 && last.d-base.d<=400 ? Math.round((last.c/base.c-1)*1000)/10 : null;
}
function mergeRecent(U, tag){
  if(!PXREC || !U || !U.bundle) return;
  const ADJ=(PXREC.adj||{})[tag]||{};
  const rows={}; (U.raw||[]).forEach(r=>rows[r[F.CODE]]=r);
  let newest=0;
  U.bundle.forEach(b=>{
    if(!b.px || !b.px.length) return;
    const first = !b._rec, add = first && PXREC.bars[b.c]; b._rec = 1;
    // 번들에 반영 안 된 주식 분할: 기준일 이전 봉을 비율로 나눈다(야후 원본이 분할 전 가격 그대로인 종목)
    let adjd = false;
    if(first && ADJ[b.c]){
      for(const [sd,f] of ADJ[b.c]){ let d=b.d0; for(let i=0;i<b.px.length;i++){ if(i) d+=b.dd[i]; if(d>=sd) break; b.px[i]=Math.round(b.px[i]/f); b.vo[i]=Math.round(b.vo[i]*f); } }
      adjd = true;
    }
    if((add && add.length) || adjd){
      const c0 = adjd ? null : b.px[b.px.length-1];
      for(const [d,px,vo] of (add||[])){
        const ld = lastDay(b);
        if(d<=ld) continue;
        if(b.iv==="w" && wkStart(d)===wkStart(ld)){
          b.px[b.px.length-1]=px; b.vo[b.vo.length-1]=(b.vo[b.vo.length-1]||0)+(vo||0);
          if(b.dd.length>1) b.dd[b.dd.length-1]+=d-ld; else b.d0=d;
        } else { b.px.push(px); b.vo.push(vo||0); b.dd.push(d-ld); }
      }
      const r=rows[b.c], c1=b.px[b.px.length-1];
      if(r && c1!==c0){
        const close=c1/10;
        if(r[F.MCAP] && r[F.CLOSE]) r[F.MCAP]=Math.round(r[F.MCAP]*close/r[F.CLOSE]);
        r[F.CLOSE]= close>=1000 ? Math.round(close) : Math.round(close*10)/10;
        const ld=lastDay(b), y=new Date(ld*86400000).getUTCFullYear();
        r[F.PY]=retFrom(b, ld-365);
        r[F.PYTD]=retFrom(b, Date.UTC(y-1,11,31)/86400000);
      }
    }
    newest=Math.max(newest,lastDay(b));
  });
  for(const k in PXR) delete PXR[k];
  if(newest) U.asof=dstr(newest);
}
fetch("data/jp/px_recent.json",{cache:"no-cache"}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(d=>{
  PXREC=d||{bars:{}}; PXREC.bars=PXREC.bars||{};
  mergeRecent(UNI.con, "con"); if(UNI.maj.raw) mergeRecent(UNI.maj, "maj");
  if(!uniLoading){ renderHeader(); renderTable(); }
}).catch(()=>{});
function renderAll(){ const ue=document.getElementById("uerr"); if(ue && UNI.maj.raw) ue.remove(); renderHeader(); buildRail(); renderColsel(); renderFoodCompare(); renderSmartChips(); renderTable(); }
function setUniverse(u, opts){
  opts=opts||{};
  if(u===universe && !opts.force) return;
  closeDetail();
  if(u==="maj" && !UNI.maj.raw){
    uniLoading=true;
    document.querySelectorAll("#useg button[data-u]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.u===u));
    document.getElementById("tb").innerHTML=`<tr><td class="l" colspan="14" style="padding:28px 12px;color:var(--ink-mute)">주요 기업 데이터를 불러오는 중…</td></tr>`;
    document.getElementById("empty").hidden=true;
    document.getElementById("earnup").innerHTML="";
    loadMajor().then(()=>{ uniLoading=false; applyUniverse("maj"); saveUniverse("maj"); resetForUniverse(); renderAll(); })
      .catch(()=>{ uniLoading=false;
        document.querySelectorAll("#useg button[data-u]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.u===universe));
        renderAll();
        const g=document.getElementById("useg"); if(g && !document.getElementById("uerr")) g.insertAdjacentHTML("afterend",`<div class="uerr" id="uerr">주요 기업 데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.</div>`);
      });
    return;
  }
  applyUniverse(u); saveUniverse(u); resetForUniverse(); renderAll();
}
document.querySelectorAll("#useg button[data-u]").forEach(b=>b.onclick=()=>setUniverse(b.dataset.u));
if(initialUniverse()==="maj"){ renderHeader(); buildRail(); renderColsel(); setUniverse("maj",{force:true}); }
else { renderHeader(); buildRail(); renderColsel(); renderTable(); }
(function stickyOffsets(){
  const set=()=>{ const nav=document.getElementById("topnav"), rail=document.querySelector(".rail");
    document.documentElement.style.setProperty("--navh",(nav?nav.offsetHeight:0)+"px");
    document.documentElement.style.setProperty("--railh",(rail?rail.offsetHeight:0)+"px"); };
  // theme.js가 이 파일보다 뒤에 로드돼 처음엔 내비가 비어 있다(높이 1px) → 내비가 채워진 뒤에도 다시 잰다
  set(); window.addEventListener("resize",set); window.addEventListener("load",set); setTimeout(set,0); setTimeout(set,600);
  if(window.ResizeObserver){ const ro=new ResizeObserver(set); const nav=document.getElementById("topnav"), rail=document.querySelector(".rail"); if(nav) ro.observe(nav); if(rail) ro.observe(rail); }
  if(window.MutationObserver){ const nav=document.getElementById("topnav"); if(nav) new MutationObserver(set).observe(nav,{childList:true}); }
})();
fetch("data/jp/earnings_dates.json",{cache:"no-cache"}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(d=>{
  EARN=d.dates||{}; EARN_META=d;
  const el=document.getElementById("earnasof"); if(el) el.textContent=d.updated||"—";
  renderTable();
}).catch(()=>{ const el=document.getElementById("earnasof"); if(el) el.textContent="불러오기 실패"; });
fetch("data/jp/earnings_pts.json",{cache:"no-cache"}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(d=>{ PTS=d.items||{}; renderTable(); }).catch(()=>{});
fetch("data/jp/earnings_results.json",{cache:"no-cache"}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(d=>{
  RES=d.results||{}; RES_META=d;
  renderTable();
}).catch(()=>{});

/* ===== 추가할 종목 (2026-10-07 사용자: 오른쪽 빈칸에 적으면 매일 0시에 확인해 추가) =====
   보내기 → 깃허브 이슈 작성 화면(제목 "[추가할 종목] …")이 열리고, 거기서 한 번 더 '제출'을 누르면 요청이 남는다.
   매일 0시 예약 작업(jp_add_requests.py)이 저장소 주인이 연 요청만 읽어 종목을 넣고, 결과는 data/jp/add_requests.json 에 남긴다. */
(function(){
  const REPO="minwook1011/vantage-0910", PRE="[추가할 종목] ";
  const box=document.getElementById("addreq"); if(!box) return;
  const q=document.getElementById("ar-q"), list=document.getElementById("ar-list");
  const send=()=>{ const t=q.value.trim(); if(!t){ q.focus(); return; }
    const body="스크리너에 넣어 주세요: "+t+"\n\n—\n(일본 기업 스크리너 '추가할 종목' 칸에서 보냄 · 매일 0시에 처리)";
    window.open("https://github.com/"+REPO+"/issues/new?title="+encodeURIComponent(PRE+t)+"&body="+encodeURIComponent(body),"_blank","noopener");
    q.value=""; list.innerHTML='<div class="ar-tip">깃허브 창에서 <b>Submit new issue</b>(제출)를 눌러야 요청이 남습니다.</div>'+list.innerHTML; };
  document.getElementById("ar-go").onclick=send;
  q.onkeydown=e=>{ if(e.key==="Enter") send(); };
  const ST={added:"추가됨",partial:"일부 추가",failed:"못 찾음"};
  Promise.all([
    fetch("data/jp/add_requests.json",{cache:"no-cache"}).then(r=>r.ok?r.json():{items:[]}).catch(()=>({items:[]})),
    fetch("https://api.github.com/repos/"+REPO+"/issues?state=open&per_page=50").then(r=>r.ok?r.json():[]).catch(()=>[])
  ]).then(([d,iss])=>{
    const done={}; (d.items||[]).forEach(x=>done[x.n]=x);
    const pend=(iss||[]).filter(i=>!i.pull_request && (i.title||"").indexOf("[추가할 종목]")===0 && (i.user||{}).login==="minwook1011" && !(done[i.number]||{}).status)
      .map(i=>`<div class="ar-row"><span class="ar-st wait">대기</span><span>${esc(i.title.replace("[추가할 종목]","").trim())}</span></div>`);
    const fin=(d.items||[]).filter(x=>x.status&&x.market!=="us").slice(0,4).map(x=>`<div class="ar-row" title="${esc(x.note||"")}"><span class="ar-st ${x.status}">${ST[x.status]||""}</span><span>${esc(x.text||"")}${x.added&&x.added.length?` → ${x.added.map(esc).join(", ")}`:""}${x.failed&&x.failed.length?` · 못 찾음 ${x.failed.map(esc).join(", ")}`:""}</span></div>`);
    list.innerHTML=(pend.concat(fin).join(""))||'<div class="ar-tip">아직 요청이 없습니다.</div>';
  });
})();
