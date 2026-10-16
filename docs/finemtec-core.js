(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FineMtecCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const METRICS = {
    price: {label: "파인엠텍 주가", unit: "원", color: "#83aaff", group: "price"},
    revenue: {label: "매출", unit: "억원", color: "#55d6bc", group: "financial"},
    operating_income: {label: "영업이익", unit: "억원", color: "#c7a2ff", group: "financial"},
    opm: {label: "OPM · 영업이익률", unit: "%", color: "#ffbd76", group: "financial"},
    revenue_yoy: {label: "매출 성장률 · YoY", unit: "%", color: "#53c5ee", group: "financial"},
    operating_income_yoy: {label: "영업이익 성장률 · YoY", unit: "%", color: "#fa829d", group: "financial"},
    trade_value: {label: "백플레이트 납품 금액", unit: "USD", color: "#e7d27c", group: "trade"},
    trade_quantity: {label: "백플레이트 납품 수량", unit: "개", color: "#6bdfb7", group: "trade"},
    trade_weight: {label: "백플레이트 순중량", unit: "kg", color: "#73d4ef", group: "trade"},
    trade_asp: {label: "동일 품목군 개당 금액", unit: "USD/개", color: "#d698e3", group: "trade"},
    trade_value_yoy: {label: "납품 금액 성장률 · YoY", unit: "%", color: "#ec9580", group: "trade"},
    trade_count: {label: "확인된 납품 거래 수", unit: "건", color: "#a9b9db", group: "trade"}
  };
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const timestamp = date => Date.parse(date + "T00:00:00Z");
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(timestamp(value)) && new Date(timestamp(value)).toISOString().slice(0, 10) === value;
  }
  function financialWindow(data, period) {
    const annual = period === "annual";
    const records = (data.financials?.[annual ? "annual" : "quarterly"] || [])
      .filter(row => validDate(row.date) && row.is_estimate !== true && (finite(row.revenue) || finite(row.operating_income)))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!records.length) return [];
    const latest = new Date(timestamp(records.at(-1).date));
    const byDate = new Map(records.map(row => [row.date, row]));
    return Array.from({length: annual ? 5 : 12}, (_, index) => {   // 분기 12개(2026-10-16 사용자)
      const offset = (annual ? 4 : 11) - index;
      const date = new Date(Date.UTC(latest.getUTCFullYear() - (annual ? offset : 0), annual ? 12 : latest.getUTCMonth() + 1 - offset * 3, 0)).toISOString().slice(0, 10);
      const year = Number(date.slice(0, 4));
      const original = byDate.get(date);
      const note = original?.period_note || (year < 2022 ? "법인 설립 전 · 해당 없음" : annual && year === 2022 ? "분할 설립 후 단기 실적" : "");
      return original ? {...original, period_note: note} : {date, revenue: null, operating_income: null, opm: null, revenue_yoy: null, operating_income_yoy: null, missing: true, period_note: note || "공시 자료 미확보", profit_growth_label: "—"};
    });
  }
  function financialRangeStart(rows, period) {
    if (!rows.length) return 0;
    const first = new Date(timestamp(rows[0].date));
    return Date.UTC(first.getUTCFullYear(), period === "annual" ? 0 : first.getUTCMonth() - 2, 1);
  }
  function seriesFor(id, data, period, customs) {
    if (id === "price") return (data.price?.points || []).map(p => ({...p, source: data.price.source}));
    if (METRICS[id]?.group === "financial") return financialWindow(data, period).map(row => ({
      date: row.date, value: finite(row[id]) ? row[id] : null,
      reported_at: row.reported_at, source: row.field_sources?.[id]?.source || row.source, period_note: row.period_note,
      label: id === "operating_income_yoy" && !finite(row[id]) ? row.profit_growth_label : null
    }));
    if (METRICS[id]?.group === "trade") return data.trade?.series?.[id] || [];
    return customs.find(s => s.id === id)?.points || [];
  }
  function rangeStart(points, range) {
    if (!points.length) return 0;
    const latest = new Date(timestamp(points[points.length - 1].date));
    if (range === "ALL") return timestamp(points[0].date);
    if (range === "YTD") return Date.UTC(latest.getUTCFullYear(), 0, 1);
    const months = {"6M": 6, "1Y": 12, "2Y": 24}[range] || 24;
    latest.setUTCMonth(latest.getUTCMonth() - months);
    return latest.getTime();
  }
  function domain(values, includeZero) {
    const good = values.filter(finite);
    if (!good.length) return [0, 1];
    let low = Math.min(...good), high = Math.max(...good);
    if (includeZero) { low = Math.min(low, 0); high = Math.max(high, 0); }
    const padding = Math.max((high - low) * .12, Math.abs(high) * .02, .01);
    return [low - padding, high + padding];
  }
  function normalize(points) {
    const values = points.map(p => p.value).filter(finite);
    if (!values.length) return points;
    const low = Math.min(...values), high = Math.max(...values);
    return points.map(p => ({...p, original: p.value, value: finite(p.value) ? (high === low ? 50 : (p.value - low) / (high - low) * 100) : null}));
  }
  function parsePoints(text) {
    const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
    if (!lines.length || lines.length > 3000) throw new Error("날짜·값을 1~3,000행 입력해 주세요.");
    const seen = new Set();
    return lines.map((line, index) => {
      const match = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s*[,\t]\s*([-+]?\d+(?:\.\d+)?)$/);
      if (!match || !validDate(match[1]) || !Number.isFinite(Number(match[2]))) throw new Error(`${index + 1}행을 확인해 주세요. 예: 2026-01-31,120.5`);
      if (seen.has(match[1])) throw new Error(`${match[1]} 날짜가 중복됐어요.`);
      seen.add(match[1]);
      return {date: match[1], value: Number(match[2])};
    }).sort((a, b) => a.date.localeCompare(b.date));
  }
  function nearest(points, time) {
    return points.reduce((best, row) => !best || Math.abs(timestamp(row.date) - time) < Math.abs(timestamp(best.date) - time) ? row : best, null);
  }
  function lineGeometry(points, x, y) {
    let path = "", pen = false;
    const vertices = [];
    for (const point of points) {
      if (!finite(point.value)) { pen = false; continue; }
      const xx = x(point.date), yy = y(point.value);
      if (!finite(xx) || !finite(yy)) { pen = false; continue; }
      path += `${pen ? "L" : "M"}${xx.toFixed(2)} ${yy.toFixed(2)} `;
      vertices.push([xx, yy]); pen = true;
    }
    return {path, vertices};
  }
  function format(value, unit, digits) {
    if (!finite(value)) return "—";
    return new Intl.NumberFormat("ko-KR", {maximumFractionDigits: digits ?? (unit === "%" || unit === "USD/개" ? 2 : 1)}).format(value) + (unit === "%" ? "%" : " " + unit);
  }
  return {METRICS, finite, timestamp, validDate, financialWindow, financialRangeStart, seriesFor, rangeStart, domain, normalize, parsePoints, nearest, lineGeometry, format};
});
