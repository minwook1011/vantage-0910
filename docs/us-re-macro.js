/* us-re-macro.js — 미국 부동산 화면의 탭 전환 + 「주가×금리×경기」 차트(2026-11-04 사용자).
   자료: data/us-re/macro.js 의 REM(build_us_re.py). 주가는 야후 주간 수정주가, 금리·실업률·PPI는 FRED.
   ① 업종별 대장주 주가(시작 주 = 100, 로그) ② 30년 모기지·10년물·기준금리 ③ 실업률 전년 차(%p)·PPI 전년 대비(%)
   빨강/파랑 띠 = 연준 인상/인하 구간, 회색 띠 = 경기침체(NBER), 점선 = 큰 사건. */
(function(){
"use strict";
/* ---------- 탭 ---------- */
const TABS=["scr","mac"];
function showTab(t){
  if(!TABS.includes(t)) t="scr";
  document.querySelectorAll("#retab button[data-tab]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.tab===t));
  TABS.forEach(k=>{ const v=document.getElementById("v-"+k); if(v) v.hidden = k!==t; });
  try{ localStorage.setItem("usre_tab",t); }catch(e){}
  try{ const u=new URL(location.href); if(t==="scr") u.searchParams.delete("tab"); else u.searchParams.set("tab",t); history.replaceState(null,"",u.pathname+u.search+u.hash); }catch(e){}
  if(t==="mac") requestAnimationFrame(()=>{ if(window.__remDraw) window.__remDraw(); });
  window.dispatchEvent(new Event("resize"));
}
document.querySelectorAll("#retab button[data-tab]").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
let t0=null; try{ t0=new URL(location.href).searchParams.get("tab"); }catch(e){}
if(!t0){ try{ t0=localStorage.getItem("usre_tab"); }catch(e){} }
if(typeof REM==="undefined"){ showTab("scr"); return; }

/* ---------- 차트 ---------- */
const NS="http://www.w3.org/2000/svg", DAY=864e5;
const T=s=>Date.parse(s+"T00:00:00Z");
const GROUPS=[
  {id:"hb",label:"홈빌더 5사",c:"--g1",stocks:[["DHI","D.R. 호튼"],["LEN","레나"],["PHM","펄티그룹"],["NVR","NVR"],["TOL","톨브라더스"]]},
  {id:"pf",label:"플랫폼 3사",c:"--g2",stocks:[["Z","질로우"],["COMP","컴퍼스"],["OPEN","오픈도어"]],
    note:"질로우는 2015-08(C주), 오픈도어는 2020-06(합병 전 스팩), 컴퍼스는 2021-04부터 자료가 있습니다."},
  {id:"rr",label:"주거용 리츠 3사",c:"--g3",stocks:[["VMRK","비브마크"],["ESS","에섹스"],["INVH","인비테이션 홈즈"]],
    note:"비브마크는 2026-08-18 AvalonBay·Equity Residential 합병 회사로, 그 전 주가는 Equity Residential(EQR)입니다. 인비테이션 홈즈는 2017-02 상장."},
  {id:"cr",label:"상업용 리츠 3사",c:"--g4",stocks:[["WELL","웰타워"],["PLD","프로로지스"],["EQIX","에퀴닉스"]],
    note:"에퀴닉스는 2000-08 상장. 웰타워=헬스케어(시니어하우징), 프로로지스=물류, 에퀴닉스=데이터센터."},
];
const SCOL=["--s1","--s2","--s3","--s4","--s5"];
const RECS=[
  {a:"2001-03-01",b:"2001-11-30",t:"닷컴버블 붕괴 침체",s:"닷컴"},
  {a:"2007-12-01",b:"2009-06-30",t:"글로벌 금융위기 침체",s:"금융위기"},
  {a:"2020-02-01",b:"2020-04-30",t:"코로나 침체",s:"코로나"},
];
const EVENTS=[
  {d:"2000-03-10",t:"나스닥 고점(닷컴버블 정점)"},
  {d:"2006-07-01",t:"미국 집값 고점(케이스-실러)"},
  {d:"2008-09-15",t:"리먼 브러더스 파산"},
  {d:"2020-03-23",t:"코로나 증시 바닥"},
];
const RANGES=[
  {id:"all",label:"전체 2000~",start:"2000-01-01"},
  {id:"r05",label:"2005~ (버블 붕괴)",start:"2005-01-01"},
  {id:"r12",label:"2012~ (회복기)",start:"2012-01-01"},
  {id:"r19",label:"2019~ (코로나·인상기)",start:"2019-01-01"},
  {id:"r22",label:"2022~",start:"2022-01-01"},
];
const D=REM, dates=D.dates, dT=dates.map(T), N=dates.length;
const mort=D.mort.map(r=>[T(r[0]),r[1],r[0]]), t10=D.t10.map(r=>[T(r[0]),r[1],r[0]]);
const urS=D.ur.map(r=>[T(r[0])+14*DAY,r[2],r[0],r[1]]).filter(r=>r[1]!=null);   // 월 자료는 그달 가운데에 찍는다
const ppS=D.ppi.map(r=>[T(r[0])+14*DAY,r[1],r[0]]);
const fedEv=D.fed.map(r=>({t:T(r[0]),d:r[0],from:r[1],to:r[2],bp:Math.round((r[2]-r[1])*100)}));
const RANGE_ERA=T("2008-12-16");
const endT=Math.max(dT[N-1],T(D.fedLast[0]),mort[mort.length-1][0],t10[t10.length-1][0]);
const fedPts=[[T("2000-01-01"),D.fedStart]]; fedEv.forEach(e=>fedPts.push([e.t,e.to]));
function fedAt(t){let v=D.fedStart;for(const e of fedEv){if(e.t<=t)v=e.to;else break;}return v;}
function lastAt(arr,t){let lo=0,hi=arr.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(arr[m][0]<=t){ans=m;lo=m+1}else hi=m-1}return ans<0?null:arr[ans];}
const monthAt=(arr,t)=>{ const iso=new Date(t).toISOString().slice(0,7)+"-01"; let r=null; for(const x of arr){ if(x[2]<=iso) r=x; else break; } return r; };
const cycles=[];
fedEv.forEach(e=>{const dir=Math.sign(e.bp);const c=cycles[cycles.length-1];
  if(c&&c.dir===dir){c.t1=e.t;c.n++;c.bp+=e.bp}else cycles.push({dir,t0:e.t,t1:e.t,n:1,bp:e.bp});});
const fmt=(v,d=2)=>v==null?"–":(+v).toFixed(d);
const sgn=(v,d=1)=>v==null?"–":(v>0?"+":"")+(+v).toFixed(d);
const ymd=t=>new Date(t).toISOString().slice(0,10);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let cur="all", grp="hb", avgOnly=false, showRec=true, showUR=true, showPPI=true;

/* 그룹 지수: 시작 주 = 100. 상장 전 종목은 빼고 주간 수익률을 같은 비중으로 이어 붙인다(체인 연결).
   늦게 상장한 종목의 선은 상장 주의 그룹 평균에서 시작한다. */
function groupSeries(g,i0){
  const P=g.stocks.map(s=>D.px[s[0]]||[]);
  const A=new Array(N).fill(null);
  for(let i=i0;i<N;i++){
    if(i===i0||A[i-1]==null){ if(P.some(p=>p[i]!=null)) A[i]=100; continue; }
    let sum=0,n=0; P.forEach(p=>{ if(p[i]!=null&&p[i-1]!=null){ sum+=p[i]/p[i-1]; n++; } });
    A[i]=n?A[i-1]*sum/n:A[i-1];
  }
  const idx={};
  g.stocks.forEach((s,j)=>{ const p=P[j], arr=new Array(N).fill(null); let base=null,anc=null;
    for(let i=i0;i<N;i++){ if(p[i]==null) continue; if(base==null){ base=p[i]; anc=A[i]==null?100:A[i]; } arr[i]=p[i]/base*anc; }
    idx[s[0]]=arr; });
  const first=A.findIndex(v=>v!=null);
  return {A,idx,first};
}

/* ---------- 고정 요소: 타일·버튼 ---------- */
(function tiles(){
  const m=mort[mort.length-1], b=t10[t10.length-1], f=D.fedLast;
  const m1y=lastAt(mort,m[0]-365*DAY), b1y=lastAt(t10,b[0]-365*DAY);
  const lastEv=fedEv[fedEv.length-1];
  const u=D.ur[D.ur.length-1], p=D.ppi[D.ppi.length-1];
  const ym=s=>s.slice(0,7);
  const tiles=[
    {k:"30년 고정 모기지",v:fmt(m[1])+"%",d:`${m[2]} · 1년 전 ${fmt(m1y&&m1y[1])}%`},
    {k:"10년물 국채",v:fmt(b[1])+"%",d:`${b[2]} · 1년 전 ${fmt(b1y&&b1y[1])}%`},
    {k:"기준금리(목표 범위)",v:`${fmt(f[1]-0.25)}~${fmt(f[1])}%`,d:`최근 ${lastEv.d} ${lastEv.bp>0?"▲ 인상":"▼ 인하"} ${Math.abs(lastEv.bp)}bp`},
    {k:"모기지 − 10년물",v:fmt(m[1]-(lastAt(t10,m[0])||b)[1])+"%p",d:"평소 1.5~2%p 안팎"},
    {k:"실업률",v:fmt(u[1],1)+"%",d:`${ym(u[0])} · 1년 전보다 ${sgn(u[2])}%p`},
    {k:"PPI 전년 대비",v:sgn(p[1])+"%",d:`${ym(p[0])} · 최종수요 생산자물가`},
  ];
  document.getElementById("m-tiles").innerHTML=tiles.map(x=>`<div class="mt"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="d">${x.d}</div></div>`).join("");
  document.getElementById("m-asof").textContent=ymd(endT);
})();
const gb=document.getElementById("m-grp");
gb.innerHTML=GROUPS.map(g=>`<button data-g="${g.id}" aria-pressed="${g.id===grp}">${g.label}</button>`).join("")+`<button data-g="cmp" aria-pressed="false">4그룹 평균 비교</button>`;
gb.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;grp=b.dataset.g;gb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.g===grp));draw();yearTable();});
const rb=document.getElementById("m-rng");
rb.innerHTML=RANGES.map(r=>`<button data-id="${r.id}" aria-pressed="${r.id===cur}">${r.label}</button>`).join("");
rb.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;cur=b.dataset.id;rb.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",x.dataset.id===cur));draw();});
const chk=(id,fn)=>document.getElementById(id).addEventListener("change",e=>{fn(e.target.checked);draw();});
chk("m-avg",v=>avgOnly=v); chk("m-rec",v=>showRec=v); chk("m-ur",v=>showUR=v); chk("m-ppi",v=>showPPI=v);

const svg=document.getElementById("m-chart"), tip=document.getElementById("m-tip");
let geo=null;
function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function niceLogTicks(lo,hi){const out=[];for(let p=Math.floor(Math.log10(lo))-1;p<=Math.ceil(Math.log10(hi));p++)for(const b of [1,2,5]){const v=b*Math.pow(10,p);if(v>=lo*0.98&&v<=hi*1.02)out.push(v);}return out;}
function placeEnds(items,x,ymin,ymax){
  items.sort((a,b)=>a.y-b.y); const gapY=13;
  for(let i=1;i<items.length;i++) if(items[i].y-items[i-1].y<gapY) items[i].y=items[i-1].y+gapY;
  const over=items.length?items[items.length-1].y-(ymax-4):0;
  if(over>0){items.forEach(it=>it.y-=over);for(let i=items.length-2;i>=0;i--) if(items[i+1].y-items[i].y<gapY) items[i].y=items[i+1].y-gapY;}
  items.forEach(it=>{ el("rect",{x:x-6,y:it.y-1.5,width:4,height:3,rx:1,fill:`var(${it.c})`},svg);
    const t=el("text",{x,y:it.y+4,class:"endlab"},svg); t.textContent=it.lab; if(!it.bold) t.setAttribute("font-weight","500"); });
}
function legends(series){
  const G=GROUPS.find(g=>g.id===grp);
  document.getElementById("m-leg1").innerHTML=series.map(s=>`<span class="it"><span class="sw" style="background:var(${s.c});${s.avg?"height:3px":""}"></span>${s.avg?"<b>"+esc(s.name)+"</b>":esc(s.name)}</span>`).join("")
    +`<span class="it src">출처: 야후 파이낸스 주간 수정주가(배당·분할 반영)</span>`;
  document.getElementById("m-gnote").textContent = grp==="cmp" ? "4개 그룹의 같은 비중 평균을 겹쳤습니다. 늦게 상장한 종목은 상장 주부터 평균에 들어갑니다. "+GROUPS.filter(g=>g.note).map(g=>g.note).join(" ") : (G&&G.note)||"";
  document.getElementById("m-leg2").innerHTML=
    `<span class="it"><span class="sw" style="background:var(--mort)"></span>30년 고정 모기지 <span class="src">· 프레디맥 PMMS(FRED MORTGAGE30US)</span></span>`+
    `<span class="it"><span class="sw" style="background:var(--t10)"></span>10년물 국채 <span class="src">· 미 재무부(FRED DGS10)</span></span>`+
    `<span class="it"><span class="sw" style="background:var(--fed)"></span>기준금리(상단) <span class="src">· 연준(FRED DFEDTARU)</span></span>`+
    `<span class="it"><span class="tri" style="color:var(--hike)">▲</span>인상</span><span class="it"><span class="tri" style="color:var(--cut)">▼</span>인하</span>`;
  document.getElementById("m-leg3").innerHTML=
    `<span class="it"><span class="sw" style="background:var(--ur)"></span>실업률 1년 전 대비 차이(%p) <span class="src">· 미 노동통계국(FRED UNRATE)</span></span>`+
    `<span class="it"><span class="sw" style="background:var(--ppi)"></span>PPI 전년 대비(%) <span class="src">· 최종수요 PPI(FRED PPIFIS), 2010-10 이전은 완제품 PPI(WPUFD49207)</span></span>`;
  document.getElementById("m-leg0").innerHTML=
    `<span class="it"><span class="box" style="background:var(--hikeBand);border:1px solid var(--hike)"></span>연준 인상 구간</span>`+
    `<span class="it"><span class="box" style="background:var(--cutBand);border:1px solid var(--cut)"></span>연준 인하 구간</span>`+
    `<span class="it"><span class="box" style="background:var(--recBand);border:1px solid var(--rec)"></span>경기침체(NBER 공식 기간)</span>`+
    `<span class="it"><span class="sw dash"></span>큰 사건</span>`;
}

function draw(){
  if(document.getElementById("v-mac").hidden) return;
  const W=svg.clientWidth||1100, mL=46, mR=92;
  const H1=320,STRIP=38,H2=200,H3=170,gap=14;
  const top1=8, top2=top1+H1+gap, top3=top2+STRIP+gap+18, top4=top3+H2+gap+22;
  const Htot=top4+H3+26;
  svg.setAttribute("viewBox",`0 0 ${W} ${Htot}`); svg.setAttribute("height",Htot); svg.innerHTML="";
  const R=RANGES.find(r=>r.id===cur), t0=T(R.start), t1=endT;
  const X=t=>mL+(t-t0)/(t1-t0)*(W-mL-mR);
  let i0=dT.findIndex(t=>t>=t0); if(i0<0) i0=0;
  document.getElementById("m-p1sub").textContent=`· ${dates[i0]} = 100으로 환산, 로그 눈금`;
  // 선 목록
  const series=[];
  if(grp==="cmp"){
    GROUPS.forEach(g=>{ const s=groupSeries(g,i0); series.push({name:g.label+" 평균",c:g.c,v:s.A,avg:1,first:s.first}); });
  }else{
    const g=GROUPS.find(x=>x.id===grp), s=groupSeries(g,i0);
    if(!avgOnly) g.stocks.forEach((st,j)=>series.push({k:st[0],name:`${st[1]} (${st[0]})`,short:st[0],c:SCOL[j],v:s.idx[st[0]]}));
    series.push({name:`${g.label} 평균`,short:"평균",c:"--ink",v:s.A,avg:1,bold:1});
  }
  legends(series);
  let lo=Infinity,hi=-Infinity;
  series.forEach(s=>{ for(let i=i0;i<N;i++){ const v=s.v[i]; if(v==null) continue; if(v<lo)lo=v; if(v>hi)hi=v; } });
  if(!isFinite(lo)){ lo=50; hi=200; }
  lo*=0.92; hi*=1.08;
  const Y1=v=>top1+H1-(Math.log(v)-Math.log(lo))/(Math.log(hi)-Math.log(lo))*H1;
  let rhi=0;[mort,t10].forEach(a=>a.forEach(r=>{if(r[0]>=t0&&r[1]>rhi)rhi=r[1]}));
  fedPts.forEach(p=>{if(p[0]>=t0&&p[1]>rhi)rhi=p[1]}); rhi=Math.ceil(Math.max(rhi,fedAt(t0))+0.3);
  const Y2=v=>top3+H2-v/rhi*H2;
  // ③ 축
  let mlo=0,mhi=0;
  if(showUR) urS.forEach(r=>{ if(r[0]>=t0){ mlo=Math.min(mlo,r[1]); mhi=Math.max(mhi,r[1]); } });
  if(showPPI) ppS.forEach(r=>{ if(r[0]>=t0){ mlo=Math.min(mlo,r[1]); mhi=Math.max(mhi,r[1]); } });
  if(mhi-mlo<4){ mhi+=2; mlo-=2; }
  const mstep=(mhi-mlo)>14?4:2; mlo=Math.floor(mlo/mstep)*mstep; mhi=Math.ceil(mhi/mstep)*mstep;
  const Y3=v=>top4+H3-(v-mlo)/(mhi-mlo)*H3;
  const yTop=top1, yBot=top4+H3;

  // 띠: 인상·인하 → 침체
  const gB=el("g",{},svg);
  cycles.forEach(c=>{ if(c.t1<t0) return; const a=X(Math.max(c.t0,t0)), b=X(c.t1), w=Math.max(b-a,3);
    el("rect",{x:a-(b-a<3?1.5:0),y:yTop,width:w,height:yBot-yTop,fill:c.dir>0?"var(--hikeBand)":"var(--cutBand)"},gB); });
  if(showRec) RECS.forEach(r=>{ const ta=T(r.a), tb=T(r.b); if(tb<t0) return; const a=X(Math.max(ta,t0)), b=X(tb);
    el("rect",{x:a,y:yTop,width:Math.max(b-a,2),height:yBot-yTop,fill:"var(--recBand)"},gB);
    el("text",{x:a+3,y:top1+12,class:"reclab"},gB).textContent=r.s; });
  // 격자
  const gG=el("g",{},svg);
  niceLogTicks(lo,hi).forEach(v=>{const y=Y1(v);
    el("line",{x1:mL,x2:W-mR,y1:y,y2:y,stroke:v===100?"var(--axis)":"var(--grid)","stroke-width":1,"stroke-dasharray":v===100?"4 3":""},gG);
    el("text",{x:mL-6,y:y+4,"text-anchor":"end",class:"tick"},gG).textContent=v>=1000?v.toLocaleString():v;});
  for(let v=0;v<=rhi;v+=(rhi>6?2:1)){const y=Y2(v);
    el("line",{x1:mL,x2:W-mR,y1:y,y2:y,stroke:v===0?"var(--axis)":"var(--grid)","stroke-width":1},gG);
    el("text",{x:mL-6,y:y+4,"text-anchor":"end",class:"tick"},gG).textContent=v+"%";}
  for(let v=mlo;v<=mhi+1e-9;v+=mstep){const y=Y3(v);
    el("line",{x1:mL,x2:W-mR,y1:y,y2:y,stroke:v===0?"var(--axis)":"var(--grid)","stroke-width":1},gG);
    el("text",{x:mL-6,y:y+4,"text-anchor":"end",class:"tick"},gG).textContent=(v>0?"+":"")+v;}
  const sy=top2+STRIP/2;
  el("line",{x1:mL,x2:W-mR,y1:sy,y2:sy,stroke:"var(--grid)"},gG);
  el("text",{x:mL-6,y:top2+12,"text-anchor":"end",class:"tick"},gG).textContent="인상";
  el("text",{x:mL-6,y:top2+STRIP-3,"text-anchor":"end",class:"tick"},gG).textContent="인하";
  const y0=new Date(t0).getUTCFullYear(), y1=new Date(t1).getUTCFullYear(), span=y1-y0, step=span>18?2:1;
  for(let y=y0;y<=y1;y++){const t=Date.UTC(y,0,1);if(t<t0)continue;const x=X(t);
    el("line",{x1:x,x2:x,y1:yBot,y2:yBot+4,stroke:"var(--axis)"},gG);
    if((y-y0)%step===0) el("text",{x,y:yBot+17,"text-anchor":"middle",class:"tick"},gG).textContent=(span>12?"'"+String(y).slice(2):y);}
  // 사건 점선
  const gEv=el("g",{},svg);
  EVENTS.forEach((e,k)=>{ const t=T(e.d); if(t<t0||t>t1) return; const x=X(t);
    el("line",{x1:x,x2:x,y1:yTop,y2:yBot,stroke:"var(--ink2)","stroke-width":1,"stroke-dasharray":"2 3",opacity:.55},gEv);
    el("text",{x:x+3,y:top1+H1-6-(k%2)*13,class:"evlab"},gEv).textContent=e.t; });
  // ① 주가 선
  const gL=el("g",{fill:"none","stroke-linejoin":"round","stroke-linecap":"round"},svg);
  const pathOf=arr=>{let d="",pen=false;for(let i=i0;i<N;i++){const v=arr[i];if(v==null){pen=false;continue;}d+=(pen?"L":"M")+X(dT[i]).toFixed(1)+","+Y1(v).toFixed(1);pen=true;}return d;};
  const ends=[];
  series.forEach(s=>{ const d=pathOf(s.v); if(!d) return;
    if(s.bold) el("path",{d,stroke:"var(--surface)","stroke-width":5},gL);
    el("path",{d,stroke:`var(${s.c})`,"stroke-width":s.bold?2.6:(s.avg?2.2:1.6),opacity:s.avg?1:.9},gL);
    const lv=s.v[N-1]; if(lv!=null) ends.push({y:Y1(lv),lab:`${s.avg&&grp==="cmp"?s.name.replace(" 평균",""):s.short||s.name} ${Math.round(lv).toLocaleString()}`,c:s.c,bold:s.bold||s.avg}); });
  placeEnds(ends,W-mR+6,top1,top1+H1);
  // ② 금리
  const gR=el("g",{fill:"none","stroke-linejoin":"round"},svg);
  const rpath=arr=>{let d="",first=true;for(const r of arr){if(r[0]<t0)continue;d+=(first?"M":"L")+X(r[0]).toFixed(1)+","+Y2(r[1]).toFixed(1);first=false;}return d;};
  el("path",{d:rpath(t10),stroke:"var(--t10)","stroke-width":1.6},gR);
  el("path",{d:rpath(mort),stroke:"var(--mort)","stroke-width":2},gR);
  let d="M"+X(t0).toFixed(1)+","+Y2(fedAt(t0)).toFixed(1);
  fedEv.forEach(e=>{if(e.t<=t0)return;d+="H"+X(e.t).toFixed(1)+"V"+Y2(e.to).toFixed(1);}); d+="H"+X(t1).toFixed(1);
  el("path",{d,stroke:"var(--surface)","stroke-width":4.5},gR); el("path",{d,stroke:"var(--fed)","stroke-width":2},gR);
  placeEnds([
    {y:Y2(mort[mort.length-1][1]),lab:`모기지 ${fmt(mort[mort.length-1][1])}%`,c:"--mort"},
    {y:Y2(t10[t10.length-1][1]),lab:`10년물 ${fmt(t10[t10.length-1][1])}%`,c:"--t10"},
    {y:Y2(D.fedLast[1]),lab:`기준 ${fmt(D.fedLast[1])}%`,c:"--fed"}],W-mR+6,top3,top3+H2);
  // ③ 실업률·PPI
  const gM=el("g",{fill:"none","stroke-linejoin":"round"},svg);
  const mpath=arr=>{let d="",first=true;for(const r of arr){if(r[0]<t0||r[1]==null){continue;}d+=(first?"M":"L")+X(r[0]).toFixed(1)+","+Y3(r[1]).toFixed(1);first=false;}return d;};
  const mends=[];
  if(showPPI){ el("path",{d:mpath(ppS),stroke:"var(--ppi)","stroke-width":1.7},gM); const l=ppS[ppS.length-1]; mends.push({y:Y3(l[1]),lab:`PPI ${sgn(l[1])}%`,c:"--ppi"}); }
  if(showUR){ el("path",{d:mpath(urS),stroke:"var(--ur)","stroke-width":1.9},gM); const l=urS[urS.length-1]; mends.push({y:Y3(l[1]),lab:`실업률 ${sgn(l[1])}%p`,c:"--ur"}); }
  placeEnds(mends,W-mR+6,top4,top4+H3);
  // 금리 결정 표시
  const gE=el("g",{},svg), evPos=[];
  fedEv.forEach(e=>{if(e.t<t0)return;const x=X(e.t),up=e.bp>0,size=Math.min(7,3+Math.abs(e.bp)/25*1.2),cy=up?sy-9:sy+9;
    const p=up?`M${x},${cy-size}L${x+size},${cy+size*.8}L${x-size},${cy+size*.8}Z`:`M${x},${cy+size}L${x+size},${cy-size*.8}L${x-size},${cy-size*.8}Z`;
    el("path",{d:p,fill:up?"var(--hike)":"var(--cut)",stroke:"var(--surface)","stroke-width":1},gE);
    el("circle",{cx:x,cy:Y2(e.to),r:2.6,fill:up?"var(--hike)":"var(--cut)",stroke:"var(--surface)","stroke-width":1},gE);
    evPos.push({x,e});});
  el("text",{x:mL,y:top3-6,class:"ptl"},svg).textContent="② 금리 (%) — 30년 모기지 · 10년물 · 기준금리";
  el("text",{x:mL,y:top4-6,class:"ptl"},svg).textContent="③ 경기·물가 — 실업률 1년 전 대비(%p) · PPI 전년 대비(%)";
  // 십자선
  const gX=el("g",{style:"pointer-events:none"},svg);
  const vline=el("line",{y1:yTop,y2:yBot,stroke:"var(--ink2)","stroke-width":1,"stroke-dasharray":"3 3",opacity:0},gX);
  const dots=el("g",{},gX);
  const hit=el("rect",{x:mL,y:yTop,width:W-mL-mR,height:yBot-yTop,fill:"transparent",style:"cursor:crosshair"},svg);
  geo={X,t0,t1,i0,series,evPos,vline,dots,Y1,Y2,Y3,mL,W,mR};
  hit.addEventListener("mousemove",onMove);
  hit.addEventListener("mouseleave",()=>{tip.style.display="none";vline.setAttribute("opacity",0);dots.innerHTML="";});
}
window.__remDraw=draw;

function onMove(ev){
  const g=geo, r=svg.getBoundingClientRect(), vb=svg.viewBox.baseVal, px=(ev.clientX-r.left)*vb.width/r.width;
  const t=g.t0+(px-g.mL)/(g.W-g.mL-g.mR)*(g.t1-g.t0);
  let lo=g.i0,hi=N-1; while(lo<hi){const m=(lo+hi)>>1;if(dT[m]<t)lo=m+1;else hi=m;}
  let i=lo; if(i>g.i0&&Math.abs(dT[i-1]-t)<Math.abs(dT[i]-t)) i--;
  const ti=dT[i], x=g.X(ti), tt=ti+6*DAY;
  g.vline.setAttribute("x1",x); g.vline.setAttribute("x2",x); g.vline.setAttribute("opacity",.7); g.dots.innerHTML="";
  const rows=[];
  g.series.forEach(s=>{ const v=s.v[i]; if(v==null) return;
    el("circle",{cx:x,cy:g.Y1(v),r:s.avg?3.5:3,fill:`var(${s.c})`,stroke:"var(--surface)","stroke-width":1.5},g.dots);
    const raw=s.k&&D.px[s.k][i]!=null?` <span style="color:var(--ink3)">($${D.px[s.k][i].toLocaleString(undefined,{maximumFractionDigits:2})})</span>`:"";
    rows.push(`<div class="row"><span class="l"><span class="sw" style="background:var(${s.c})"></span>${s.avg?"<b>"+esc(s.name)+"</b>":esc(s.name)}</span><span>${Math.round(v).toLocaleString()}${raw}</span></div>`); });
  rows.push('<div class="sep"></div>');
  const m=lastAt(mort,tt), b=lastAt(t10,tt), f=fedAt(tt);
  if(m){ el("circle",{cx:x,cy:g.Y2(m[1]),r:3,fill:"var(--mort)",stroke:"var(--surface)","stroke-width":1.5},g.dots); rows.push(`<div class="row"><span class="l"><span class="sw" style="background:var(--mort)"></span>30년 모기지</span><span>${fmt(m[1])}%</span></div>`); }
  if(b){ el("circle",{cx:x,cy:g.Y2(b[1]),r:3,fill:"var(--t10)",stroke:"var(--surface)","stroke-width":1.5},g.dots); rows.push(`<div class="row"><span class="l"><span class="sw" style="background:var(--t10)"></span>10년물</span><span>${fmt(b[1])}%</span></div>`); }
  rows.push(`<div class="row"><span class="l"><span class="sw" style="background:var(--fed)"></span>기준금리</span><span>${tt>=RANGE_ERA?fmt(Math.max(f-0.25,0))+"~":""}${fmt(f)}%</span></div>`);
  const u=monthAt(D.ur.map(r=>[0,r[2],r[0],r[1]]),tt), p=monthAt(D.ppi.map(r=>[0,r[1],r[0]]),tt);
  rows.push('<div class="sep"></div>');
  if(u) rows.push(`<div class="row"><span class="l"><span class="sw" style="background:var(--ur)"></span>실업률 ${u[2].slice(0,7)}</span><span>${fmt(u[3],1)}% (${sgn(u[1])}%p)</span></div>`);
  if(p) rows.push(`<div class="row"><span class="l"><span class="sw" style="background:var(--ppi)"></span>PPI 전년 대비 ${p[2].slice(0,7)}</span><span>${sgn(p[1])}%</span></div>`);
  const rec=RECS.find(r=>T(r.a)<=tt&&tt<=T(r.b)+6*DAY);
  const evs=fedEv.filter(e=>e.t>ti-3.5*DAY&&e.t<=ti+3.5*DAY);
  const near=g.evPos.filter(q=>Math.abs(q.x-x)<6&&!evs.includes(q.e)).map(q=>q.e);
  const big=EVENTS.filter(e=>Math.abs(T(e.d)-ti)<=4*DAY);
  const all=evs.concat(near).sort((a,b)=>a.t-b.t);
  if(rec||all.length||big.length){ rows.push('<div class="sep"></div>');
    if(rec) rows.push(`<div class="ev" style="color:var(--rec)">■ ${esc(rec.t)} (${rec.a.slice(0,7)}~${rec.b.slice(0,7)})</div>`);
    big.forEach(e=>rows.push(`<div class="ev">┆ ${esc(e.t)} · ${e.d}</div>`));
    all.forEach(e=>rows.push(`<div class="ev ${e.bp>0?"up":"dn"}">${e.bp>0?"▲ 인상":"▼ 인하"} ${Math.abs(e.bp)}bp · ${e.d} (${fmt(e.from)}→${fmt(e.to)}%)</div>`)); }
  tip.innerHTML=`<div class="h">${dates[i]} 주</div>`+rows.join(""); tip.style.display="block";
  const tw=tip.offsetWidth, th=tip.offsetHeight;
  let lx=ev.clientX+16; if(lx+tw>window.innerWidth-8) lx=ev.clientX-tw-16;
  let ly=ev.clientY-th/2; ly=Math.max(8,Math.min(ly,window.innerHeight-th-8));
  tip.style.left=lx+"px"; tip.style.top=ly+"px";
}

/* ---------- 표 ---------- */
(function(){
  const rows=fedEv.slice().reverse().map(e=>`<tr><td>${e.d}</td><td>${fmt(e.from)}%</td><td>${fmt(e.to)}%</td><td class="${e.bp>0?"up":"dn"}">${e.bp>0?"▲ +":"▼ "}${e.bp}bp</td></tr>`).join("");
  document.getElementById("m-fedTbl").innerHTML=`<thead><tr><th>날짜</th><th>이전(상단)</th><th>이후(상단)</th><th>변경</th></tr></thead><tbody>${rows}</tbody>`;
})();
function yearTable(){
  const gs = grp==="cmp" ? GROUPS : [GROUPS.find(g=>g.id===grp)];
  const tks=[].concat(...gs.map(g=>g.stocks));
  const yrs=[], y1=new Date(endT).getUTCFullYear();
  for(let y=2000;y<=y1;y++){
    const te=y===y1?endT:Date.UTC(y,11,31,23);
    let i=-1; for(let k=0;k<N;k++){ if(dT[k]<=te) i=k; else break; } if(i<0) continue;
    const m=lastAt(mort,te), b=lastAt(t10,te);
    const u=monthAt(D.ur.map(r=>[0,r[2],r[0],r[1]]),te), p=monthAt(D.ppi.map(r=>[0,r[1],r[0]]),te);
    yrs.push(`<tr><td>${y===y1?y+" (현재)":y}</td>${tks.map(s=>{const v=(D.px[s[0]]||[])[i];return `<td>${v==null?"–":v.toLocaleString(undefined,{maximumFractionDigits:2})}</td>`;}).join("")}<td>${fmt(m&&m[1])}%</td><td>${fmt(b&&b[1])}%</td><td>${fmt(fedAt(te))}%</td><td>${u?fmt(u[3],1)+"%":"–"}</td><td>${p?sgn(p[1])+"%":"–"}</td></tr>`);
  }
  document.getElementById("m-yrTbl").innerHTML=`<thead><tr><th>연말</th>${tks.map(s=>`<th>${s[0]} ($)</th>`).join("")}<th>모기지</th><th>10년물</th><th>기준(상단)</th><th>실업률</th><th>PPI YoY</th></tr></thead><tbody>${yrs.reverse().join("")}</tbody>`;
}
yearTable();
let rt; window.addEventListener("resize",()=>{clearTimeout(rt);rt=setTimeout(draw,120);});
showTab(t0||"scr");
})();
