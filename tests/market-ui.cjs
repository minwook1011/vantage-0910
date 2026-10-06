const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const {chromium} = require('playwright');
const docs = path.resolve(__dirname, '../docs');
const scope = process.env.VANTAGE_UI_SCOPE || 'all';
assert.ok(['all', 'signals'].includes(scope), 'VANTAGE_UI_SCOPE must be all or signals');
const signalStocks = new Map(JSON.parse(fs.readFileSync(path.join(docs, 'megacap_lite.json'), 'utf8')).stocks.map(stock => [stock.ticker, stock]));
const artifacts = path.join(os.tmpdir(), 'vantage-market-qa');
fs.mkdirSync(artifacts, {recursive:true});
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(docs, '.' + pathname);
  if (!file.startsWith(docs + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404);res.end();return; }
  res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json'})[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,channel:'msedge'});
    const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function tickers(selector='.sb-card') {
      return page.locator(selector).evaluateAll(nodes=>nodes.map(node=>node.dataset.ticker || node.dataset.t));
    }
    async function assertDescending(metric, label) {
      const names=await tickers();
      assert.ok(names.length>0, label+' has stocks');
      let prior=Infinity, missing=false;
      for(const ticker of names) {
        const stock=signalStocks.get(ticker);
        assert.ok(stock, 'known source stock '+ticker);
        const value=metric(stock);
        if(!Number.isFinite(value)) { missing=true;continue; }
        assert.equal(missing,false,label+' puts missing values last');
        assert.ok(value<=prior+1e-9,label+' descending at '+ticker);
        prior=value;
      }
    }
    async function assertActualChart(index=0) {
      await page.locator('.sb-card').nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction(i=>{
        const chart=document.querySelectorAll('.sb-card')[i]?.querySelector('.sb-chart');
        return chart?.getAttribute('aria-busy')==='false' && chart.querySelector('svg');
      },index);
      assert.ok(await page.locator('.sb-card').nth(index).locator('.sb-chart svg rect').count()>20,'actual candle and volume bars');
    }
    async function closeDetail() {
      await page.waitForSelector('#modal-back .m-body svg');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#modal-back',{state:'detached'});
    }
    async function assertMapLabels() {
      const layout=await page.locator('#map').evaluate(svg=>{
        const rect=svg.getBoundingClientRect();
        const labels=Array.from(svg.querySelectorAll('.dot-lbl')).map(label=>{
          const box=label.getBoundingClientRect(), style=getComputedStyle(label);
          return {text:label.textContent,left:box.left,right:box.right,top:box.top,bottom:box.bottom,visible:style.display!=='none'&&style.visibility!=='hidden'&&box.width>0&&box.height>0};
        }).filter(label=>label.visible);
        return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,labels};
      });
      assert.ok(layout.labels.length>0,'map has visible stock labels');
      for(const label of layout.labels) assert.ok(label.left>=layout.left-1&&label.right<=layout.right+1&&label.top>=layout.top-1&&label.bottom<=layout.bottom+1,'map label stays inside chart: '+label.text);
      for(let i=0;i<layout.labels.length;i++) for(let j=i+1;j<layout.labels.length;j++) {
        const a=layout.labels[i], b=layout.labels[j];
        const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left), overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        assert.ok(overlapX<=1||overlapY<=1,'map labels do not overlap: '+a.text+' / '+b.text);
      }
    }
    async function assertSectorTiles() {
      await page.waitForSelector('#sectors .sec-tile');
      assert.ok(await page.locator('#sectors .sec-tile').count()>0,'sector tiles rendered');
      assert.equal(await page.locator('#sectors .sec-tile').first().isVisible(),true,'sector tile visible');
      assert.match(await page.locator('#sectors .sec-tile .r').first().innerText(),/\d.*%/,'sector return rendered');
      assert.match(await page.locator('#sectors .sec-tile .c').first().innerText(),/[1-9]\d*종목/,'sector stock count rendered');
    }
    async function assertRankRows() {
      await page.waitForSelector('#list .rk');
      assert.ok(await page.locator('#list .rk').count()>0,'rank rows rendered');
      assert.equal(await page.locator('#list .rk').first().isVisible(),true,'rank row visible');
      assert.match(await page.locator('#list .rk-ret .big').first().innerText(),/\d.*%/,'rank return rendered');
      for(const ticker of await tickers('#list .rk')) assert.ok(signalStocks.has(ticker),'rank contains known stock '+ticker);
    }
    await page.goto(base+'/bottomup.html#map');
    await page.locator('#__gate_input').fill('1011'); await page.locator('#__gate_btn').click();
    await page.waitForSelector('.sb-card');
    await page.waitForSelector('#map-wrap svg#map');
    assert.equal(await page.locator('#map-wrap svg#map').isVisible(),true,'map visible on entry');
    assert.equal(await page.locator('#map-wrap').evaluate(node=>node.closest('details')===null),true,'map does not require expanding details');
    assert.equal(await page.evaluate(()=>{
      const map=document.querySelector('#map-wrap'), board=document.querySelector('#signal-board');
      return !!(map.compareDocumentPosition(board)&Node.DOCUMENT_POSITION_FOLLOWING) && map.getBoundingClientRect().bottom<=board.getBoundingClientRect().top;
    }),true,'visible map precedes stock cards');
    assert.equal(await page.locator('.sb-card').count(),20,'initial compact page has 20 stocks');
    const entryUniverse=await page.locator('#universe-toggle .on').getAttribute('data-n');
    for(const count of [100,300]) {
      await page.locator('#universe-toggle [data-n="'+count+'"]').click();
      await page.waitForFunction(expected=>document.querySelectorAll('#m-dots circle.dot').length===expected,count);
      assert.equal(await page.locator('#m-dots circle.dot:visible').count(),count,'TOP '+count+' rebuilds visible map circles');
      for(const ticker of await tickers('#m-dots circle.dot')) assert.ok(signalStocks.get(ticker).rank<=count,'map stock belongs to TOP '+count);
    }
    if(entryUniverse!=='300') await page.locator('#universe-toggle [data-n="'+entryUniverse+'"]').click();
    await assertMapLabels();
    await page.locator('#map-wrap').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifacts,'signals-map-desktop.png')});
    await assertActualChart();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.sb-card')).slice(0,5).every(card=>card.querySelector('.sb-chart svg')));
    const compact=await page.locator('#signal-board').evaluate(board=>({
      columns:getComputedStyle(board).gridTemplateColumns.split(/\s+/).length,
      cards:Array.from(board.querySelectorAll('.sb-card')).slice(0,5).map(card=>({
        ticker:card.dataset.ticker,width:card.getBoundingClientRect().width,height:card.getBoundingClientRect().height,
        parts:Object.fromEntries(['.sb-top','.sb-body','.sb-chart','.sb-summary','.sb-metrics','.sb-footer'].map(selector=>{
          const node=card.querySelector(selector), rect=node.getBoundingClientRect(), style=getComputedStyle(node);
          return [selector,{width:rect.width,height:rect.height,marginTop:style.marginTop,marginBottom:style.marginBottom,paddingTop:style.paddingTop,paddingBottom:style.paddingBottom}];
        }))
      }))
    }));
    await page.screenshot({path:path.join(artifacts,'signals-compact-desktop.png')});
    console.log(JSON.stringify({phase:'signals-layout',viewport:1440,...compact}));
    assert.equal(compact.columns,5,'1440px desktop shows five columns');
    for(const card of compact.cards) {
      assert.ok(card.width<300,'desktop tile width is compact: '+card.width);
      assert.ok(card.height<=330,'desktop tile height is compact: '+card.height);
    }
    await page.locator('[data-p="vol"]').click();
    await page.waitForFunction(()=>document.querySelector('#sb-sort [data-s="vol"]').getAttribute('aria-pressed')==='true');
    assert.match(await page.locator('.sb-card').first().innerText(),/거래대금/);
    for(const ticker of await tickers()) assert.ok(signalStocks.get(ticker).vol_ratio>=1.3,'volume preset filters '+ticker);
    await assertDescending(stock=>stock.vol_ratio,'volume sort');
    await page.locator('[data-p="pat"]').click();
    assert.equal(await page.locator('#sb-sort .on').getAttribute('data-s'),'breakout');
    await assertActualChart();
    assert.match(await page.locator('.sb-card').first().innerText(),/돌파/);
    assert.equal(await page.locator('.sb-card').evaluateAll(cards=>cards.every(card=>!!PatternRadar.primary(card.dataset.ticker))),true,'pattern preset contains detected patterns');
    await page.locator('#sb-sort [data-s="momentum"]').click();
    assert.match(await page.locator('#sb-sort-note').innerText(),/20%.*30%.*50%/);
    await assertDescending(stock=>[stock.r1w,stock.r1m,stock.r3m].every(Number.isFinite)?stock.r1w*.2+stock.r1m*.3+stock.r3m*.5:null,'momentum sort');
    await assertActualChart();
    await page.screenshot({path:path.join(artifacts,'signals-desktop.png')});
    const firstTicker=(await tickers())[0];
    await page.locator('.sb-card').first().click({position:{x:8,y:8}});
    await page.waitForSelector('#modal-back .m-body svg');
    assert.ok((await page.locator('#modal-back .m-head').innerText()).includes(signalStocks.get(firstTicker).name),'whole-card click opens its stock');
    await closeDetail();
    await page.locator('.sb-open').first().focus();
    await page.locator('.sb-open').first().press('Enter');
    await closeDetail();
    await page.locator('.sb-open-detail').first().focus();
    await page.locator('.sb-open-detail').first().press('Space');
    await closeDetail();
    await page.locator('#sb-reset').click();
    assert.equal(await page.locator('.sb-card').count(),20,'reset returns to first 20 stocks');
    const firstPage=await tickers();
    await page.locator('#sb-more').click();
    assert.equal(await page.locator('.sb-card').count(),40,'pagination appends another 20 stocks');
    const twoPages=await tickers();
    assert.deepEqual(twoPages.slice(0,20),firstPage,'pagination preserves first page');
    assert.equal(new Set(twoPages).size,40,'pagination does not duplicate stocks');
    await assertActualChart(20);
    await page.locator('#sb-sort [data-s="ret"]').focus();
    await page.locator('#sb-sort [data-s="ret"]').press('Enter');
    assert.equal(await page.locator('.sb-card').count(),20,'sorting resets pagination');
    assert.equal(await page.locator('#sb-sort .on').getAttribute('data-s'),'ret','keyboard sort activation');
    const period=await page.locator('#period-toggle .on').getAttribute('data-k');
    const universe=await page.locator('#universe-toggle .on').getAttribute('data-n');
    await assertDescending(stock=>stock[period],'return sort');
    await page.locator('#q').fill('no-such-stock-xyz');
    await page.waitForSelector('#signal-board .empty-note');
    await page.locator('.pane-tab[data-pane="sectors"]').click();
    await page.waitForSelector('#sectors .empty-note');
    assert.equal(await page.locator('#sectors .sec-tile').count(),0,'zero-match search has no sector tiles');
    assert.match(await page.locator('#sector-filter-status .bu-filter-description').innerText(),/no-such-stock-xyz/,'sector pane explains retained search');
    await page.locator('.pane-tab[data-pane="list"]').click();
    await page.waitForSelector('#list .empty-note');
    assert.equal(await page.locator('#list .rk').count(),0,'zero-match search has no rank rows');
    assert.match(await page.locator('#list-filter-status .bu-filter-description').innerText(),/no-such-stock-xyz/,'rank pane explains retained search');
    await page.locator('#list-filter-status .bu-filter-reset').click();
    await assertRankRows();
    assert.equal(await page.locator('#q').inputValue(),'','rank reset clears search');
    assert.equal(await page.locator('#period-toggle .on').getAttribute('data-k'),period,'reset retains selected period');
    assert.equal(await page.locator('#universe-toggle .on').getAttribute('data-n'),universe,'reset retains TOP scope');
    assert.equal(await page.locator('#sort-toggle .on').getAttribute('data-s'),'ret','reset retains sort');
    await page.locator('.pane-tab[data-pane="sectors"]').click();
    await page.locator('#q').fill('no-such-sector-stock-xyz');
    await page.waitForSelector('#sectors .empty-note');
    assert.match(await page.locator('#sector-filter-status .bu-filter-description').innerText(),/no-such-sector-stock-xyz/);
    await page.locator('#sector-filter-status .bu-filter-reset').click();
    await assertSectorTiles();
    assert.equal(await page.locator('#q').inputValue(),'','sector reset clears search');
    await page.locator('.pane-tab[data-pane="map"]').click();
    assert.equal(await page.locator('#presets .preset.on').getAttribute('data-p'),'all','pane resets restore all-stock preset');
    await page.locator('.pane-tab[data-pane="sectors"]').click();
    await assertSectorTiles();
    const sector=await page.locator('#sectors .sec-tile').first().getAttribute('data-s');
    await page.locator('#sectors .sec-tile').first().click();
    await page.locator('.pane-tab[data-pane="map"]').click();
    assert.ok((await tickers()).length>0,'selected sector has cards');
    for(const ticker of await tickers()) assert.equal(signalStocks.get(ticker).sector,sector,'sector filter applies to cards');
    await page.locator('.pane-tab[data-pane="list"]').click();
    await assertRankRows();
    for(const ticker of await tickers('#list .rk')) assert.equal(signalStocks.get(ticker).sector,sector,'sector filter applies to rank rows');
    await page.locator('.pane-tab[data-pane="map"]').click();
    await page.locator('#sb-reset').click();
    await page.locator('#sb-sort [data-s="breakout"]').click();
    await page.locator('.pane-tab[data-pane="list"]').click();
    assert.equal(await page.locator('#sort-toggle .on').getAttribute('data-s'),'breakout');
    await assertRankRows();
    await page.locator('.pane-tab[data-pane="pattern"]').click();
    await page.locator('.pt-card').first().scrollIntoViewIfNeeded();
    await page.waitForSelector('.pt-card svg');
    // Different query strings force a fresh document, exercising initial lazy rendering from each hash.
    await page.goto(base+'/bottomup.html?qa=sectors#sectors');
    await assertSectorTiles();
    await page.goto(base+'/bottomup.html?qa=list#list');
    await assertRankRows();
    await page.locator('.pane-tab[data-pane="map"]').click();
    for(const [width,columns] of [[1440,5],[1100,4],[900,3],[620,2],[390,1]]) {
      await page.setViewportSize({width,height:width<700?844:1100});
      await assertActualChart();
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#signal-board').evaluate(board=>getComputedStyle(board).gridTemplateColumns.split(/\s+/).length),columns,width+'px grid columns');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'signal overflow at '+width+'px');
      await assertMapLabels();
    }
    await page.screenshot({path:path.join(artifacts,'signals-mobile.png')});
    await page.setViewportSize({width:1440,height:1100});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(base+'/bottomup.html?qa=rank-animation#list');
    await assertRankRows();
    await page.locator('#list .rk').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{
      const rows=Array.from(document.querySelectorAll('#list .rk')).slice(0,3);
      return rows.length>0 && rows.every(row=>Number(getComputedStyle(row).opacity)>.95);
    });
    const animatedRank=await page.locator('#list .rk').first().evaluate(row=>{
      const rect=row.getBoundingClientRect();
      return {opacity:Number(getComputedStyle(row).opacity),inViewport:rect.top>=0&&rect.bottom<=innerHeight,width:rect.width,height:rect.height};
    });
    assert.ok(animatedRank.opacity>.95,'rank rows are opaque after animation');
    assert.equal(animatedRank.inViewport,true,'actual rank row is visible in the viewport');
    await page.screenshot({path:path.join(artifacts,'rank-normal-motion.png')});
    console.log(JSON.stringify({phase:'rank-animation',...animatedRank}));
    await page.emulateMedia({reducedMotion:'reduce'});

    await page.route('**/megacap_lite.json',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.goto(base+'/bottomup.html?qa=data-failure#sectors');
    await page.waitForSelector('#sectors .bu-load-retry');
    for(const [pane,container] of [['sectors','#sectors'],['list','#list'],['map','#signal-board']]) {
      await page.locator('.pane-tab[data-pane="'+pane+'"]').click();
      assert.equal(await page.locator(container+' .bu-load-retry').isVisible(),true,pane+' data failure offers retry');
      const message=await page.locator(container).innerText();
      assert.match(message,/불러오지 못|실패|다시/,'data failure is explained');
      assert.doesNotMatch(message,/\.json\b|\.py\b|fetch_megacap|스크립트.*실행/,'data failure does not expose implementation instructions');
    }
    await page.unroute('**/megacap_lite.json');
    await page.locator('.pane-tab[data-pane="list"]').click();
    await page.locator('#list .bu-load-retry').click();
    await assertRankRows();
    assert.equal(await page.locator('#list .bu-load-retry').count(),0,'retry restores rank data');

    if(scope==='all') {
    await page.setViewportSize({width:1440,height:1100});
    await page.goto(base+'/dashboard.html#trend');
    await page.waitForSelector('#trend-chart svg');
    assert.equal(await page.locator('.dashboard-panes .pane-tab').count(),2);
    assert.equal(await page.locator('.dashboard-panes > .pane').count(),2);
    for(const id of ['flow-year','flow-signals','flow-trend','flow-heatmap']) assert.equal(await page.locator('#'+id).isVisible(),true,id+' visible');
    await page.locator('.pane-tab[data-pane="compare"]').click();
    await page.waitForSelector('#etf-table tbody tr');
    await page.locator('.pane-tab[data-pane="flow"]').click();
    await page.locator('#flow-year').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(artifacts,'sectors-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'dashboard mobile overflow');
    await page.screenshot({path:path.join(artifacts,'sectors-mobile.png')});

    await page.setViewportSize({width:1440,height:1100});
    await page.goto(base+'/macro.html');
    await page.waitForFunction(()=>document.querySelectorAll('#mx-watch .mx-watch-value').length===3);
    assert.equal(await page.locator('#mx-watch article').count(),3);
    const titles=await page.locator('#mx-watch h2').allTextContents();
    assert.match(titles[0],/공포|Fear/);assert.match(titles[1],/국채/);assert.match(titles[2],/WTI/);
    assert.match(await page.locator('#mx-watch article').first().innerText(),/프록시/);
    assert.equal(await page.locator('#mx-watch svg').count(),3);
    assert.equal(await page.evaluate(()=>document.querySelector('#mx-watch').offsetTop<document.querySelector('#mx-rates-section').offsetTop&&document.querySelector('#mx-rates-section').offsetTop<document.querySelector('[aria-label="경제 캘린더"]').offsetTop),true);
    await page.screenshot({path:path.join(artifacts,'macro-desktop.png')});
    await page.locator('[data-watch-ind="wti"]').click();
    await page.waitForSelector('.mx-row[data-k="wti"].open');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'macro mobile overflow');
    await page.screenshot({path:path.join(artifacts,'macro-mobile.png')});
    await page.route('**/macro.json',route=>route.fulfill({status:503,body:'unavailable'}));
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#mx-watch article').textContent.includes('불러오지 못했습니다'));
    assert.equal(await page.locator('#mx-watch .mx-watch-value').count(),2,'independent macro failure preserves other cards');
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({result:'PASS',scope,checks:['visible map before cards','TOP 100 to 300 rebuilds visible map circles','map labels stay inside chart without overlap','five-column compact tiles','actual candles','preset filtering and numeric sorts','20 + 20 unique pagination','whole-card and keyboard details','keyboard sort','empty search explained in sector and rank panes','sector and rank reset restores data and retains preferences','sector tiles and sector filter','rank rows and sort sync','direct sector and rank entry','normal-motion rank visibility','data failure messages and retry recovery','pattern candles','responsive 5/4/3/2/1 columns','no horizontal overflow','no page errors',...(scope==='all'?['two sector panes and legacy hash','comparison table','macro first-screen order and real charts','oil detail','macro partial failure']:[])],artifacts}));
    await context.close();
  } finally { if(browser)await browser.close();server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
