/* Run with: node tests/signal-board-core.cjs
   Browser layout is checked separately; this small DOM boundary exercises the
   public board API, user actions, and asynchronous chart ownership. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor() {
    this.children = [];
    this.nodes = new Map();
    this.listeners = new Map();
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty() {} };
    this.classList = { add: value => { this.className = `${this.className || ''} ${value}`; } };
    this.isConnected = true;
  }
  set innerHTML(value) { this.html = value; this.children = []; this.nodes.clear(); }
  get innerHTML() { return this.html || ''; }
  appendChild(child) { this.children.push(child); }
  contains(child) { return this.children.includes(child); }
  setAttribute(name, value) { this.attributes[name] = value; }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll(selector) { return selector.split(',').map(s => this.querySelector(s.trim())); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  click() { this.listeners.get('click')?.(); }
  insertAdjacentHTML(_where, value) { this.html = this.innerHTML + value; }
}

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function setup({ patterns = {}, loader = s => Promise.resolve(s) } = {}) {
  const observers = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.nodes = new Set(); observers.push(this); }
    observe(node) { this.nodes.add(node); }
    unobserve(node) { this.nodes.delete(node); }
    disconnect() { this.disconnected = true; this.nodes.clear(); }
    enter(node) { this.callback([{ target: node, isIntersecting: true }]); }
  }
  const radar = {
    primary: ticker => patterns[ticker] || null,
    info: () => ({ name: '삼각수렴' }),
    ensureCandles: loader,
    miniSVG: () => '<svg role="img" aria-label="실제 패턴 차트"></svg>'
  };
  const sandbox = { window: { PatternRadar: radar, IntersectionObserver: Observer }, PatternRadar: radar,
    IntersectionObserver: Observer, document: { createElement: () => new Element() }, escapeHtml, _dailyTail: cs => cs };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/signal-board.js'), 'utf8'), sandbox);
  return { board: sandbox.window.SignalBoard, observers, radar };
}
function tickers(board, stocks, opts) { return Array.from(board.sort(stocks, opts), s => s.ticker); }
function candleSeries() {
  return Array.from({ length: 30 }, (_, i) => ({ d: `2026-09-${String(i + 1).padStart(2, '0')}`, o: 100 + i, h: 105 + i, l: 95 + i, c: 102 + i, v: i === 2 ? null : 1000 + i }));
}
async function flush() { await new Promise(resolve => setImmediate(resolve)); }

async function main() {
  const { board } = setup();
  const missing = [null, undefined, NaN, Infinity, -Infinity, '5'];
  for (const [sort, key] of [['ret', 'r1m'], ['vol', 'vol_ratio'], ['high', 'from_high'], ['ta', 'score']]) {
    const stocks = [Object.freeze({ ticker: 'negative', [key]: -4 }), Object.freeze({ ticker: 'zero', [key]: 0 }),
      Object.freeze({ ticker: 'positive', [key]: 7 }), ...missing.map((v, i) => Object.freeze({ ticker: `missing${i}`, [key]: v }))];
    const original = stocks.slice();
    const got = tickers(board, Object.freeze(stocks), { sort, period: 'r1m', score: s => s.score });
    assert.deepEqual(got.slice(0, 3), ['positive', 'zero', 'negative'], `${sort}: missing data must never outrank a negative value`);
    assert.deepEqual(stocks, original, `${sort}: sorting must preserve the source order and objects`);
  }
  assert.equal(board.momentum({ r1w: 10, r1m: 20, r3m: 30 }), 23);
  assert.equal(board.momentum({ r1w: 0, r1m: 0, r3m: 0 }), 0);
  for (const missingValue of missing) assert.equal(board.momentum({ r1w: missingValue, r1m: 20, r3m: 30 }), null);
  assert.deepEqual(tickers(board, [{ ticker: 'B', r1m: 2 }, { ticker: 'A', r1m: 2 }], { sort: 'ret' }), ['A', 'B']);
  assert.equal(board.breakoutRank({ ticker: 'unknown', from_high: null }), 0, 'absent high data must not become a near-high signal');

  const patterns = {
    newest: { state: 'breakout', age: 0, surge: 1 }, older: { state: 'breakout', age: 3, surge: 3 },
    unknownAge: { state: 'breakout', age: null, surge: 9 },
    nearest: { state: 'near', dist: .2 }, close: { state: 'near', dist: -.5 }, far: { state: 'near', dist: -2.5 }, unknownDist: { state: 'near', dist: null }
  };
  const ranking = setup({ patterns }).board;
  const stocks = ['missing', 'far', 'oldHigh', 'technical', 'unknownDist', 'older', 'close', 'newest', 'nearest', 'unknownAge', 'high']
    .map(ticker => ({ ticker, from_high: ticker === 'high' ? -1 : ticker === 'oldHigh' ? -2.9 : null }));
  assert.deepEqual(tickers(ranking, stocks, { sort: 'breakout', detail: s => s.ticker === 'technical' ? '20일 신고가 돌파' : '' }),
    ['newest', 'older', 'unknownAge', 'technical', 'nearest', 'close', 'far', 'unknownDist', 'high', 'oldHigh', 'missing'],
    'confirmed patterns, technical breakouts, near patterns and true near-highs have separate priority; recency and absolute proximity break ties');

  let requests = 0;
  const calls = [];
  const live = setup({ loader: s => { requests++; return requests === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ ...s, candles: candleSeries() }); } });
  const root = new Element();
  const hostile = { ticker: 'T"<&', name: '<img src=x onerror=alert(1)>', sector: '<script>bad</script>', r1m: null, vol_ratio: null };
  live.board.render(root, [hostile], { open: ticker => calls.push(ticker), signals: () => [['" onclick="bad', '<b>signal</b>']] });
  const card = root.children[0];
  assert.equal(requests, 0, 'render must not fetch cards outside the viewport');
  assert.ok(live.observers[0].options.rootMargin.includes('250px'));
  assert.ok(card.innerHTML.includes('&lt;img'));
  assert.ok(card.innerHTML.includes('&lt;script&gt;'));
  assert.ok(card.innerHTML.includes('&lt;b&gt;signal&lt;/b&gt;'));
  assert.ok(!card.innerHTML.includes('class="sb-badge " onclick'));
  assert.ok(!card.innerHTML.includes('+0.0%'), 'a missing return must not display as a zero return');
  card.querySelector('.sb-open').click();
  card.querySelector('.sb-open-detail').click();
  assert.deepEqual(calls, [hostile.ticker, hostile.ticker], 'both keyboard-operable buttons open the correct stock');
  live.observers[0].enter(card);
  await flush();
  const chart = card.querySelector('.sb-chart');
  assert.equal(requests, 1);
  assert.equal(chart.attributes['aria-busy'], 'false');
  assert.match(chart.innerHTML, /다시 불러오기/, 'failed charts must offer a retry');
  chart.querySelector('.sb-retry').click();
  await flush();
  assert.equal(requests, 2);
  assert.match(chart.innerHTML, /<svg/, 'retry must recover into an actual candle chart');
  assert.match(chart.innerHTML, /2026-09-30/);
  assert.ok(!chart.innerHTML.includes('NaN'));
  assert.ok(!chart.innerHTML.includes('Infinity'));
  assert.match(card.querySelector('.sb-summary').innerHTML, /직전 20일 고가 133/, 'reference high excludes the latest candle high of 134');
  assert.match(card.querySelector('.sb-chart-note').innerHTML, /거래량 일부 미제공/);
  assert.match(card.querySelector('.sb-date').textContent, /일봉 2026-09-30 기준/);

  let resolvePending;
  const stale = setup({ loader: s => new Promise(resolve => { resolvePending = () => resolve({ ...s, candles: candleSeries() }); }) });
  const staleRoot = new Element();
  stale.board.render(staleRoot, [{ ticker: 'old' }], {});
  const removed = staleRoot.children[0];
  stale.observers[0].enter(removed);
  await flush();
  const removedChart = removed.querySelector('.sb-chart');
  stale.board.render(staleRoot, [{ ticker: 'new' }], {});
  const loadingMarkup = removedChart.innerHTML;
  resolvePending();
  await flush();
  assert.equal(removedChart.innerHTML, loadingMarkup, 'a chart response from the previous filter must not write into a detached card');
  assert.equal(staleRoot.children[0].dataset.ticker, 'new');
  assert.equal(stale.observers[0].disconnected, true);

  const datedPattern = { kind: 'asc', state: 'breakout', age: 2, date: '2026-09-25', dist: -1, level: 130,
    lines: [{ role: 'res', p: [['2026-09-01', 120], ['2026-09-29', 130]] }] };
  const dated = setup({ patterns: { dated: datedPattern }, loader: s => Promise.resolve({ ...s, candles: candleSeries() }) });
  const datedRoot = new Element();
  dated.board.render(datedRoot, [{ ticker: 'dated' }], {});
  dated.observers[0].enter(datedRoot.children[0]);
  await flush();
  const datedCard = datedRoot.children[0];
  assert.match(datedCard.querySelector('.sb-date').textContent, /패턴 판정 2026-09-29 · 돌파 발생 2026-09-25 · 일봉 2026-09-30 기준/);
  assert.match(datedCard.querySelector('.sb-chart-note').innerHTML, /기준일이 다릅니다/);
  assert.match(datedCard.querySelector('.sb-summary').innerHTML, /기준선 아래로 되밀림/);
  console.log('Signal board: missing values, deterministic ranking, breakout precedence, escaping, lazy load, retry, stale responses, candle reference high and independent dates passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
