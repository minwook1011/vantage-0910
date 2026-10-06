/* Data-driven research UI. All report facts and figures come from published JSON. */
(function () {
  "use strict";

  var page = document.body.dataset.indepthPage;
  var palette = ["#569bd4", "#ffcc00", "#f47b20", "#83b59b", "#b49cce"];
  var kindNames = { actual: "실적", estimate: "자체 추정", guidance: "회사 가이던스", external: "외부 추정", proforma: "공시 인수 가정" };
  var chartSerial = 0;
  var toastTimer;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function arr(value) { return Array.isArray(value) ? value : []; }
  function paragraphs(value) { return Array.isArray(value) ? value : (value ? [value] : []); }
  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function format(value) { return finite(value) ? value.toLocaleString("ko-KR", { maximumFractionDigits: 3 }) : "미확인"; }
  function kind(value) { return Object.prototype.hasOwnProperty.call(kindNames, value) ? value : "actual"; }
  function color(value, fallback) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback; }
  function sourceURL(value) {
    try { var parsed = new URL(value); return /^https?:$/.test(parsed.protocol) ? parsed.href : null; } catch (_) { return null; }
  }
  function reportID(value) { return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/.test(value || "") ? value : null; }
  function sourceLinks(sources) {
    var valid = arr(sources).filter(function (s) { return s && sourceURL(s.url); });
    if (!valid.length) return null;
    var box = el("div", "ir-sources");
    box.appendChild(el("span", "", "출처"));
    valid.forEach(function (s) {
      var a = el("a", "", s.label || new URL(s.url).hostname);
      a.href = sourceURL(s.url); a.target = "_blank"; a.rel = "noopener noreferrer";
      box.appendChild(a);
    });
    return box;
  }
  function appendSources(node, sources) { var links = sourceLinks(sources); if (links) node.appendChild(links); }
  function fetchJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }
  function errorState(container, text) {
    container.replaceChildren();
    var box = el("div", "ir-state");
    box.setAttribute("role", "alert");
    box.appendChild(el("p", "", text));
    box.appendChild(el("p", "", "잠시 후 다시 시도해 주세요."));
    var retry = el("button", "", "다시 불러오기");
    retry.type = "button"; retry.addEventListener("click", function () { window.location.reload(); });
    box.appendChild(retry); container.appendChild(box);
  }
  function originalPath(original) {
    var path = String((original || {}).path || "").replace(/\\/g, "/");
    if (!path || /^[a-z]:/i.test(path) || path.charAt(0) === "/" || path.split("/").indexOf("..") >= 0) return null;
    return path;
  }
  function originalURI(original, heading) {
    var path = originalPath(original);
    if (!path) return null;
    return "obsidian://open?vault=" + encodeURIComponent(original.vault || "리서치") + "&file=" + encodeURIComponent(path + (heading ? "#" + heading : ""));
  }
  function originalLink(original, heading, label, className) {
    var uri = originalURI(original, heading);
    if (!uri) return null;
    var a = el("a", className, label);
    a.href = uri;
    a.dataset.originalHeading = heading || "";
    a.title = "이 기기에 해당 Obsidian 보관함과 노트가 있어야 열립니다. 브라우저가 앱 실행을 확인할 수 있습니다.";
    return a;
  }
  function toast(message) {
    var box = document.getElementById("ir-toast");
    if (!box) return;
    clearTimeout(toastTimer); box.textContent = message; box.classList.add("is-visible");
    toastTimer = setTimeout(function () { box.classList.remove("is-visible"); }, 4200);
  }
  function fallbackCopy(text) {
    var input = el("textarea", "ir-sr-only");
    input.value = text; input.setAttribute("aria-label", "복사할 정본 경로");
    document.body.appendChild(input); input.focus(); input.select();
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (_) { /* The inline path remains available. */ }
    input.remove();
    return copied;
  }
  function copyButton(original, heading) {
    var path = originalPath(original);
    if (!path) return null;
    var button = el("button", "ir-copy-button", heading ? "원문 경로 · 절 복사" : "원문 경로 복사");
    button.type = "button";
    var text = path + (heading ? "#" + heading : "");
    button.title = text;
    button.dataset.copyOriginal = text;
    button.addEventListener("click", async function () {
      var copied = false;
      try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); copied = true; } } catch (_) { /* Use local fallback below. */ }
      if (!copied) copied = fallbackCopy(text);
      button.focus();
      if (copied) toast("정본 경로" + (heading ? "와 절 제목을" : "를") + " 복사했습니다.");
      else {
        var existing = button.parentElement.querySelector(".ir-copy-fallback");
        if (!existing) { existing = el("p", "ir-copy-fallback ir-original-hint", text); existing.style.display = "block"; existing.style.userSelect = "all"; button.parentElement.appendChild(existing); }
        toast("자동 복사를 사용할 수 없습니다. 표시된 경로를 선택해 복사해 주세요.");
      }
    });
    return button;
  }
  function tableBlock(data, compact) {
    var columns = arr(data.columns);
    if (!columns.length) return null;
    var block = el("div", compact ? "" : "ir-table-block");
    if (data.caption && !compact) block.appendChild(el("h3", "ir-table-caption", data.caption));
    var wrap = el("div", "ir-table-wrap");
    wrap.tabIndex = 0; wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", (data.caption || "데이터 표") + " — 가로로 스크롤할 수 있습니다");
    var table = el("table", "ir-table");
    table.appendChild(el("caption", "ir-sr-only", data.caption || "데이터 표"));
    var thead = el("thead"), head = el("tr");
    columns.forEach(function (column) { var th = el("th", "", column); th.scope = "col"; head.appendChild(th); });
    thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    arr(data.rows).forEach(function (row) {
      var tr = el("tr");
      columns.forEach(function (_, i) { var value = arr(row)[i]; tr.appendChild(el("td", "", value === null || value === undefined ? "미확인" : value)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table); block.appendChild(wrap);
    if (data.note) block.appendChild(el("p", "ir-chart-note", data.note));
    appendSources(block, data.sources);
    return block;
  }
  function svgNode(tag, attributes, text) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attributes || {}).forEach(function (key) { node.setAttribute(key, attributes[key]); });
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function pointKind(data, series, index) { return kind(arr(series.pointKinds)[index] || arr(data.pointKinds)[index] || series.kind); }
  function drawChart(svg, data, serial) {
    var labels = arr(data.labels), series = arr(data.series);
    var width = Math.max(280, Math.round(svg.parentElement.getBoundingClientRect().width - (window.innerWidth <= 560 ? 24 : 48)));
    var mobile = width < 480, height = mobile ? 282 : 306;
    var margin = { left: mobile ? 50 : 62, right: 15, top: 26, bottom: mobile ? 69 : 61 };
    var plotW = width - margin.left - margin.right, plotH = height - margin.top - margin.bottom;
    var values = [];
    series.forEach(function (s) { arr(s.values).slice(0, labels.length).forEach(function (v) { if (finite(v)) values.push(v); }); });
    svg.replaceChildren(); svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.appendChild(svgNode("title", {}, data.title || "데이터 차트"));
    svg.appendChild(svgNode("desc", {}, "단위: " + (data.unit || "미기재") + ". 실적은 채움 또는 실선, 추정·가이던스·인수 가정은 빗금 또는 점선으로 표시합니다. 아래 데이터 표에서 모든 값을 확인할 수 있습니다."));
    if (!values.length || !labels.length) { svg.appendChild(svgNode("text", { x: width / 2, y: 100, "text-anchor": "middle", fill: "#a7b5c0", "font-size": 12 }, "표시할 확인 수치가 없습니다.")); return; }
    var minimum = Math.min.apply(null, [0].concat(values)), maximum = Math.max.apply(null, [0].concat(values));
    if (minimum === maximum) maximum = minimum + 1;
    var span = maximum - minimum;
    if (minimum < 0) minimum -= span * .07;
    if (maximum > 0) maximum += span * .16;
    var roughStep = (maximum - minimum) / 4;
    var magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    var factor = roughStep / magnitude;
    var tickStep = (factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 2.5 ? 2.5 : factor <= 5 ? 5 : 10) * magnitude;
    minimum = Math.floor(minimum / tickStep) * tickStep;
    maximum = Math.ceil(maximum / tickStep) * tickStep;
    function y(value) { return margin.top + (maximum - value) / (maximum - minimum) * plotH; }
    var defs = svgNode("defs");
    series.forEach(function (s, i) {
      var paint = color(s.color, palette[i % palette.length]);
      var pattern = svgNode("pattern", { id: "ir-hatch-" + serial + "-" + i, patternUnits: "userSpaceOnUse", width: 6, height: 6, patternTransform: "rotate(35)" });
      pattern.appendChild(svgNode("rect", { width: 6, height: 6, fill: paint, opacity: .12 }));
      pattern.appendChild(svgNode("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: paint, "stroke-width": 2 }));
      defs.appendChild(pattern);
    });
    svg.appendChild(defs);
    for (var tick = 0; tick <= Math.round((maximum - minimum) / tickStep); tick++) {
      var tickValue = minimum + tickStep * tick;
      var tickY = y(tickValue);
      svg.appendChild(svgNode("line", { x1: margin.left, x2: width - margin.right, y1: tickY, y2: tickY, stroke: "#7f91a0", "stroke-opacity": .18, "stroke-dasharray": "3 4" }));
      var axisValue = Math.abs(tickValue) >= 1000 ? tickValue.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : tickValue.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
      svg.appendChild(svgNode("text", { x: margin.left - 9, y: tickY + 4, "text-anchor": "end", fill: "#81919e", "font-size": mobile ? 11 : 12 }, axisValue));
    }
    svg.appendChild(svgNode("line", { x1: margin.left, x2: width - margin.right, y1: y(0), y2: y(0), stroke: "#81919e", "stroke-opacity": .35 }));
    var band = plotW / labels.length;
    var maxTickLabels = mobile ? 4 : 8, step = Math.max(1, Math.ceil(labels.length / maxTickLabels));
    labels.forEach(function (label, i) {
      if (i % step !== 0 && i !== labels.length - 1) return;
      if (i === labels.length - 1 && i > 0 && (i - 1) % step === 0 && step > 1) return;
      var labelText = String(label), maxChars = Math.max(8, Math.min(mobile ? 12 : 18, Math.floor((band * step - 12) / 6)));
      var text = svgNode("text", { x: margin.left + band * (i + .5), y: margin.top + plotH + 21, "text-anchor": "middle", fill: "#a7b5c0", "font-size": mobile ? 11 : 12 });
      var chunks = [];
      while (labelText.length > maxChars && chunks.length < 2) { var at = labelText.lastIndexOf(" ", maxChars); if (at < 3) at = maxChars; chunks.push(labelText.slice(0, at)); labelText = labelText.slice(at).trim(); }
      if (labelText) chunks.push(labelText.length > maxChars ? labelText.slice(0, maxChars - 1) + "…" : labelText);
      chunks.slice(0, 3).forEach(function (chunk, j) { text.appendChild(svgNode("tspan", { x: margin.left + band * (i + .5), dy: j ? 14 : 0 }, chunk)); });
      svg.appendChild(text);
    });
    series.forEach(function (s, seriesIndex) {
      var paint = color(s.color, palette[seriesIndex % palette.length]);
      var seriesValues = arr(s.values);
      var isLine = data.type === "line";
      var barWidth = Math.min(52, band * .68 / Math.max(1, series.length));
      seriesValues.slice(0, labels.length).forEach(function (value, i) {
        if (!finite(value)) return;
        var status = pointKind(data, s, i), estimated = status !== "actual";
        var center = margin.left + band * (i + .5), x = center + (seriesIndex - (series.length - 1) / 2) * barWidth;
        var point;
        if (isLine) {
          if (i > 0 && finite(seriesValues[i - 1])) {
            var line = svgNode("line", { x1: center - band, y1: y(seriesValues[i - 1]), x2: center, y2: y(value), stroke: paint, "stroke-width": 2.5 });
            if (estimated || pointKind(data, s, i - 1) !== "actual") line.setAttribute("stroke-dasharray", "5 4");
            svg.appendChild(line);
          }
          point = svgNode("circle", { cx: center, cy: y(value), r: 3.7, fill: estimated ? "#161f27" : paint, stroke: paint, "stroke-width": 1.7 });
          x = center;
        } else {
          point = svgNode("rect", { x: x - barWidth * .42, y: Math.min(y(value), y(0)), width: Math.max(1, barWidth * .84), height: Math.max(1, Math.abs(y(value) - y(0))), fill: estimated ? "url(#ir-hatch-" + serial + "-" + seriesIndex + ")" : paint, stroke: estimated ? paint : "none", "stroke-width": 1, rx: 1 });
        }
        point.appendChild(svgNode("title", {}, labels[i] + " · " + (s.name || "값") + ": " + format(value) + " " + (data.unit || "") + " (" + kindNames[status] + ")"));
        svg.appendChild(point);
        if (band / Math.max(series.length, 1) >= Math.max(45, format(value).length * 7 + 8) && labels.length <= 8) {
          svg.appendChild(svgNode("text", { x: x, y: value >= 0 ? y(value) - 9 : y(value) + 15, "text-anchor": "middle", fill: paint, "font-size": 12, "font-weight": 600 }, format(value)));
        }
      });
    });
  }
  function chartBlock(data) {
    var series = arr(data.series), labels = arr(data.labels);
    if (!series.length || !labels.length) return null;
    var serial = ++chartSerial;
    var box = el("figure", "ir-chart");
    var head = el("div", "ir-chart-head");
    var caption = el("figcaption", "ir-chart-title", data.title || "주요 데이터");
    caption.id = "ir-chart-title-" + serial; head.appendChild(caption);
    head.appendChild(el("div", "ir-chart-unit", (data.unit ? "단위: " + data.unit : "") + (data.period || data.asOf ? " · " + (data.period || data.asOf) : "")));
    box.appendChild(head);
    var legend = el("div", "ir-chart-legend");
    var types = [];
    series.forEach(function (s, i) {
      var entry = el("span", "ir-legend-item");
      var swatch = el("i", "ir-legend-swatch"); swatch.setAttribute("aria-hidden", "true"); swatch.style.setProperty("--swatch", color(s.color, palette[i % palette.length]));
      entry.appendChild(swatch); entry.appendChild(document.createTextNode(s.name || "값")); legend.appendChild(entry);
      labels.forEach(function (_, j) { var status = pointKind(data, s, j); if (finite(arr(s.values)[j]) && types.indexOf(status) < 0) types.push(status); });
    });
    types.forEach(function (status) {
      var entry = el("span", "ir-legend-item");
      var swatch = el("i", "ir-legend-swatch" + (status !== "actual" ? " is-estimate" : "")); swatch.setAttribute("aria-hidden", "true"); swatch.style.setProperty("--swatch", "#a7b5c0"); entry.appendChild(swatch);
      entry.appendChild(document.createTextNode(kindNames[status] + (data.type === "line" ? (status === "actual" ? " · 실선" : " · 점선") : (status === "actual" ? " · 채움" : " · 빗금")))); legend.appendChild(entry);
    });
    box.appendChild(legend);
    var svg = svgNode("svg", { class: "ir-chart-svg", role: "img", "aria-labelledby": caption.id }); box.appendChild(svg);
    if (data.note) box.appendChild(el("p", "ir-chart-note", data.note));
    appendSources(box, data.sources);
    var details = el("details", "ir-chart-data"); details.appendChild(el("summary", "", "데이터 표로 전체 수치 보기"));
    var columns = ["기간 / 구분"].concat(series.map(function (s) { return (s.name || "값") + (data.unit ? " (" + data.unit + ")" : ""); }));
    var rows = labels.map(function (label, i) { return [label].concat(series.map(function (s) { var value = arr(s.values)[i]; return finite(value) ? format(value) + " · " + kindNames[pointKind(data, s, i)] : "미확인"; })); });
    details.appendChild(tableBlock({ caption: data.title || "차트 데이터", columns: columns, rows: rows }, true)); box.appendChild(details);
    requestAnimationFrame(function () {
      drawChart(svg, data, serial);
      if (window.ResizeObserver) { var observer = new ResizeObserver(function () { drawChart(svg, data, serial); }); observer.observe(box); }
    });
    return box;
  }
  function renderIndex(data) {
    var list = document.getElementById("report-list"), input = document.getElementById("report-search");
    var reports = arr(data.reports).filter(function (r) { return r && reportID(r.id); });
    if (data.updated) document.getElementById("index-updated").textContent = "업데이트 " + data.updated;
    function render() {
      var query = input.value.trim().toLowerCase();
      var results = reports.filter(function (r) { return [r.company, r.ticker, r.title, r.summary].concat(arr(r.tags)).join(" ").toLowerCase().indexOf(query) >= 0; });
      list.replaceChildren(); document.getElementById("report-count").textContent = String(results.length).padStart(2, "0");
      if (!results.length) { list.appendChild(el("div", "ir-state", query ? "검색어에 맞는 리서치가 없습니다." : "공개된 리서치가 아직 없습니다.")); return; }
      results.forEach(function (r) {
        var card = el("a", "ir-report-card"); card.href = "research-report.html?id=" + encodeURIComponent(r.id);
        var top = el("div", "ir-card-top"); top.appendChild(el("span", "ir-ticker", [r.market, r.ticker].filter(Boolean).join(" · ")));
        var time = el("time", "", r.asOf || ""); if (/^\d{4}-\d{2}-\d{2}$/.test(r.asOf || "")) time.dateTime = r.asOf; top.appendChild(time); card.appendChild(top);
        card.appendChild(el("p", "ir-company", r.company || r.ticker)); card.appendChild(el("h3", "", r.title || r.company));
        if (r.summary) card.appendChild(el("p", "ir-card-summary", r.summary));
        var tags = el("div", "ir-tags"); arr(r.tags).forEach(function (tag) { tags.appendChild(el("span", "", tag)); }); card.appendChild(tags);
        var bottom = el("div", "ir-card-bottom"); bottom.appendChild(el("span", "", r.latestQuarter || "기업 인뎁스")); bottom.appendChild(el("b", "", "요약 읽기 ↗")); card.appendChild(bottom); list.appendChild(card);
      });
    }
    render(); input.addEventListener("input", render);
  }
  function renderReport(data) {
    var main = document.getElementById("report-content"), toc = document.getElementById("report-toc");
    var original = data.original || {};
    document.title = (data.company || data.ticker || "기업") + " 인뎁스 — 100억";
    document.getElementById("side-company").textContent = data.company || "기업 인뎁스";
    document.getElementById("side-ticker").textContent = [data.market, data.ticker].filter(Boolean).join(" · ");
    main.replaceChildren(); toc.replaceChildren();
    var introLink = el("a", "is-active", "한눈에 보기"); introLink.href = "#report-top"; toc.appendChild(introLink);
    var hero = el("header", "ir-report-hero"); hero.id = "report-top";
    var breadcrumb = el("div", "ir-breadcrumb"); var back = el("a", "", "리서치 요약"); back.href = "research-summary.html"; breadcrumb.appendChild(back); breadcrumb.appendChild(el("span", "", "/")); breadcrumb.appendChild(el("span", "", data.company || data.ticker)); hero.appendChild(breadcrumb);
    var meta = el("div", "ir-hero-meta"); meta.appendChild(el("span", "ir-company-pill", [data.market, data.ticker].filter(Boolean).join(" · ")));
    if (data.asOf) meta.appendChild(el("time", "", "기준일 " + data.asOf));
    if (data.latestQuarter) meta.appendChild(el("span", "ir-period", "최신 실적 " + data.latestQuarter)); hero.appendChild(meta);
    hero.appendChild(el("h1", "", data.title || data.company));
    if (data.subtitle) hero.appendChild(el("p", "ir-report-subtitle", data.subtitle));
    if (arr(data.metrics).length) {
      var metrics = el("div", "ir-metrics");
      arr(data.metrics).forEach(function (metric) {
        var card = el("div", "ir-metric"); card.appendChild(el("p", "ir-metric-label", metric.label)); card.appendChild(el("p", "ir-metric-value", metric.value === null || metric.value === undefined ? "미확인" : metric.value));
        if (metric.kind) card.appendChild(el("span", "ir-kind", kindNames[metric.kind] || metric.kind));
        if (metric.note) card.appendChild(el("p", "ir-metric-note", metric.note)); appendSources(card, metric.sources); metrics.appendChild(card);
      }); hero.appendChild(metrics);
    }
    if (arr(data.takeaways).length) {
      var takeaways = el("div", "ir-takeaways"); takeaways.appendChild(el("h2", "", "핵심 판단")); var list = el("ol"); arr(data.takeaways).forEach(function (text) { var item = el("li"); item.appendChild(el("span", "", text)); list.appendChild(item); }); takeaways.appendChild(list); hero.appendChild(takeaways);
    }
    appendSources(hero, data.sources); main.appendChild(hero);
    var sectionIDs = new Set(["report-top"]);
    arr(data.sections).forEach(function (section, index) {
      var id = reportID(section.id) || "section-" + (index + 1); if (sectionIDs.has(id)) id += "-" + (index + 1); sectionIDs.add(id);
      var number = String(index + 1).padStart(2, "0"); var nav = el("a"); nav.href = "#" + id; nav.appendChild(el("span", "ir-toc-num", number)); nav.appendChild(el("span", "", section.navTitle || section.eyebrow || section.title)); toc.appendChild(nav);
      var block = el("section", "ir-section"); block.id = id; block.setAttribute("aria-labelledby", id + "-title");
      var kicker = el("div", "ir-section-kicker"); kicker.appendChild(el("span", "ir-section-num", number)); kicker.appendChild(el("span", "", section.eyebrow || "RESEARCH")); block.appendChild(kicker);
      var heading = el("h2", "", section.title); heading.id = id + "-title"; block.appendChild(heading);
      var prose = el("div", "ir-section-prose"); paragraphs(section.summary).forEach(function (text) { prose.appendChild(el("p", "", text)); }); block.appendChild(prose);
      if (arr(section.cards).length) { var cards = el("div", "ir-comparison"); arr(section.cards).forEach(function (card) { var item = el("article", "ir-insight"); item.dataset.tone = ["gold", "orange"].indexOf(card.tone) >= 0 ? card.tone : "blue"; item.appendChild(el("h3", "", card.title)); item.appendChild(el("p", "", card.text)); cards.appendChild(item); }); block.appendChild(cards); }
      arr(section.charts).concat(section.chart ? [section.chart] : []).forEach(function (chart) { var item = chartBlock(chart); if (item) block.appendChild(item); });
      arr(section.tables).concat(section.table ? [section.table] : []).forEach(function (table) { var item = tableBlock(table); if (item) block.appendChild(item); });
      if (section.note) block.appendChild(el("p", "ir-section-note", section.note));
      appendSources(block, section.sources);
      if (section.originalHeading && originalURI(original, section.originalHeading)) {
        var footer = el("div", "ir-section-footer"); footer.appendChild(originalLink(original, section.originalHeading, "정본에서 자세히 ↗", "ir-original-link")); footer.appendChild(copyButton(original, section.originalHeading)); block.appendChild(footer);
        block.appendChild(el("p", "ir-print-path", "정본: " + originalPath(original) + "#" + section.originalHeading));
      }
      main.appendChild(block);
    });
    var footer = el("footer", "ir-report-footer"); footer.appendChild(el("span", "", data.footer || "기준일 이후의 변화는 반영되지 않을 수 있습니다. 수치의 기간·정의·출처를 함께 확인하세요.")); var backLink = el("a", "", "리서치 요약 목록 ↗"); backLink.href = "research-summary.html"; footer.appendChild(backLink); main.appendChild(footer);
    var actions = document.getElementById("original-actions"); actions.replaceChildren();
    if (originalURI(original)) {
      actions.appendChild(originalLink(original, null, "Obsidian 정본 열기 ↗", "ir-original-button")); actions.appendChild(el("p", "ir-original-hint", "이 기기에 해당 보관함과 노트가 있어야 열립니다. 연결이 안 되면 경로를 복사해 찾아보세요.")); actions.appendChild(copyButton(original));
    }
    setupTOC();
  }
  function setupTOC() {
    var links = Array.from(document.querySelectorAll(".ir-toc a"));
    var disclosure = document.querySelector(".ir-toc-disclosure"); var mobile = window.matchMedia("(max-width: 800px)");
    function setDisclosure() { disclosure.open = !mobile.matches; }
    setDisclosure();
    if (mobile.addEventListener) mobile.addEventListener("change", setDisclosure);
    links.forEach(function (link) { link.addEventListener("click", function () { if (mobile.matches) disclosure.open = false; }); });
    if (window.IntersectionObserver) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { if (entry.isIntersecting) links.forEach(function (link) { var active = link.getAttribute("href") === "#" + entry.target.id; link.classList.toggle("is-active", active); if (active) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current"); }); });
      }, { rootMargin: "-5% 0px -65% 0px", threshold: 0 });
      document.querySelectorAll(".ir-report-hero, .ir-section").forEach(function (section) { observer.observe(section); });
    }
    var hash = window.location.hash.slice(1);
    if (hash) { var target = document.getElementById(hash); if (target) requestAnimationFrame(function () { target.scrollIntoView(); }); }
  }
  if (page === "index") {
    fetchJSON("data/indepth/index.json").then(renderIndex).catch(function () { errorState(document.getElementById("report-list"), "리서치 목록을 불러오지 못했습니다."); });
  } else if (page === "report") {
    document.getElementById("report-print").addEventListener("click", function () { window.print(); });
    var requestedID = new URLSearchParams(window.location.search).get("id") || "snps";
    var safeID = reportID(requestedID);
    if (!safeID) errorState(document.getElementById("report-content"), "올바르지 않은 리포트 주소입니다.");
    else fetchJSON("data/indepth/" + safeID + ".json").then(function (data) {
      if (!data || !Array.isArray(data.sections) || !data.title) throw new Error("Invalid report data");
      renderReport(data);
    }).catch(function () { errorState(document.getElementById("report-content"), "리포트를 불러오지 못했습니다. 목록에서 리포트 주소를 다시 확인해 주세요."); });
  }
})();
