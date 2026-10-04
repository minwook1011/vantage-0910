/* 포트폴리오 › 플래너 — 개인 할 일.
   구조는 Things 3(오늘·예정·날짜 없음·완료 기록), 입력은 Todoist(한 줄 빠른 입력 문법·우선순위 4단계), 달력은 TickTick 월간 보기를 참고.
   데이터는 vantage-portfolio-v1 의 planner 칸에 저장(동기화 키를 새로 만들면 클라우드 규칙에 막힘 — firebase-sync.js 주석 참고).
   할 일·프로젝트는 id 가 있는 배열이라 기기 간 3-way 병합이 항목 단위로 된다. */
(function () {
  "use strict";
  var KEY = "vantage-portfolio-v1", UI_KEY = "vantage-planner-ui";
  var PRI = { 1: "#e02d3c", 2: "#e8890c", 3: "#2563eb", 4: "#9aa5b8" };
  var PRI_NAME = { 1: "긴급", 2: "높음", 3: "보통", 4: "없음" };
  var COLORS = ["#2563eb", "#e02d3c", "#16a34a", "#e8890c", "#8b5cf6", "#0891b2", "#db2777", "#64748b"];
  var REPEAT = { d: "매일", wd: "평일마다", w: "매주", m: "매월" };
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var host = null, P = null, ui = loadUI(), openId = null;

  /* ── 저장 ── */
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null") || {}; } catch (e) { return {}; } }
  function load() { var p = read().planner || {}; return { tasks: Array.isArray(p.tasks) ? p.tasks : [], projects: Array.isArray(p.projects) ? p.projects : [] }; }
  function save() { var d = read(); d.planner = P; localStorage.setItem(KEY, JSON.stringify(d)); }
  function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY) || "null") || { view: "today" }; } catch (e) { return { view: "today" }; } }
  function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) {} }

  /* ── 도구 ── */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function uid(p) { return p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pd(s) { var a = s.split("-"); return new Date(+a[0], a[1] - 1, +a[2]); }
  function today() { return ymd(new Date()); }
  function addDays(s, n) { var d = pd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diff(a, b) { return Math.round((pd(a) - pd(b)) / 864e5); }
  function longDate(s) { var d = pd(s); return (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + DOW[d.getDay()] + "요일"; }
  function dateLabel(s) {
    var n = diff(s, today()), d = pd(s);
    if (n === 0) return "오늘"; if (n === 1) return "내일"; if (n === -1) return "어제";
    if (n > 1 && n < 7) return DOW[d.getDay()] + "요일";
    return (d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + ". " : "") + (d.getMonth() + 1) + "월 " + d.getDate() + "일";
  }
  function timeLabel(t) { if (!t) return ""; var h = +t.slice(0, 2), m = t.slice(3); return (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + (m !== "00" ? ":" + m : "시"); }
  function proj(id) { return P.projects.filter(function (p) { return p.id === id; })[0]; }
  function task(id) { return P.tasks.filter(function (t) { return t.id === id; })[0]; }
  function sortTasks(a, b) { return (a.pri || 4) - (b.pri || 4) || String(a.time || "99").localeCompare(String(b.time || "99")) || String(a.created).localeCompare(String(b.created)); }

  /* ── 한 줄 빠른 입력: "내일 오후 3시 실적 정리 #리서치 !1 매주" ── */
  function parseQuick(text) {
    var r = { due: null, time: null, pri: 4, projName: null, repeat: null }, t = " " + text + " ", m, base = today(), now = new Date();
    function cut(s) { t = t.replace(s, " "); }
    if ((m = t.match(/\s(?:!|p)([1-4])(?=\s)/i))) { r.pri = +m[1]; cut(m[0]); }
    if ((m = t.match(/\s#(\S+)(?=\s)/))) { r.projName = m[1]; cut(m[0]); }
    if ((m = t.match(/\s(매일|평일마다|매주|매월)(?=\s)/))) { r.repeat = { "매일": "d", "평일마다": "wd", "매주": "w", "매월": "m" }[m[1]]; cut(m[0]); }
    if ((m = t.match(/\s(오전|오후)?\s?(\d{1,2})시(?:\s?(\d{1,2})분|\s?반)?(?=\s)/))) {
      var h = +m[2]; if (m[1] === "오후" && h < 12) h += 12; if (m[1] === "오전" && h === 12) h = 0; if (!m[1] && h >= 1 && h <= 6) h += 12;
      if (h < 24) { r.time = pad(h) + ":" + (/반/.test(m[0]) ? "30" : pad(+(m[3] || 0))); cut(m[0]); }
    } else if ((m = t.match(/\s(\d{1,2}):(\d{2})(?=\s)/)) && +m[1] < 24) { r.time = pad(+m[1]) + ":" + m[2]; cut(m[0]); }
    if ((m = t.match(/\s(오늘|내일|모레|글피)(?=\s)/))) { r.due = addDays(base, { "오늘": 0, "내일": 1, "모레": 2, "글피": 3 }[m[1]]); cut(m[0]); }
    else if ((m = t.match(/\s(이번\s?주|다음\s?주)?\s?([일월화수목금토])요일(?=\s)/))) {
      var k = DOW.indexOf(m[2]), cur = now.getDay();
      if (m[1] && /다음/.test(m[1])) { var mon = addDays(base, ((8 - cur) % 7) || 7); r.due = addDays(mon, (k + 6) % 7); }
      else r.due = addDays(base, (k - cur + 7) % 7);
      cut(m[0]);
    } else if ((m = t.match(/\s(\d{1,2})월\s?(\d{1,2})일(?=\s)/)) || (m = t.match(/\s(\d{1,2})\/(\d{1,2})(?=\s)/))) {
      var y = now.getFullYear(), d = ymd(new Date(y, +m[1] - 1, +m[2]));
      if (diff(d, base) < -7) d = ymd(new Date(y + 1, +m[1] - 1, +m[2]));
      r.due = d; cut(m[0]);
    } else if ((m = t.match(/\s(\d{1,3})일\s?(?:후|뒤)(?=\s)/))) { r.due = addDays(base, +m[1]); cut(m[0]); }
    else if ((m = t.match(/\s(다음\s?주)(?=\s)/))) { r.due = addDays(base, ((8 - now.getDay()) % 7) || 7); cut(m[0]); }
    else if ((m = t.match(/\s(이번\s?주말|주말)(?=\s)/))) { r.due = addDays(base, (6 - now.getDay() + 7) % 7); cut(m[0]); }
    if (r.repeat && !r.due) r.due = base;
    r.title = t.replace(/\s+/g, " ").trim();
    return r;
  }
  function chipsFor(q) {
    var c = [];
    if (q.due) c.push('<span class="pl-chip d">' + esc(dateLabel(q.due)) + (q.time ? " " + esc(timeLabel(q.time)) : "") + "</span>");
    else if (q.time) c.push('<span class="pl-chip d">' + esc(timeLabel(q.time)) + "</span>");
    if (q.repeat) c.push('<span class="pl-chip">↻ ' + REPEAT[q.repeat] + "</span>");
    if (q.pri < 4) c.push('<span class="pl-chip" style="color:' + PRI[q.pri] + '">● ' + PRI_NAME[q.pri] + "</span>");
    if (q.projName) c.push('<span class="pl-chip"># ' + esc(q.projName) + (projByName(q.projName) ? "" : " (새 프로젝트)") + "</span>");
    return c.join("");
  }
  function projByName(n) { n = String(n).toLowerCase(); return P.projects.filter(function (p) { return p.name.toLowerCase() === n; })[0]; }

  /* ── 동작 ── */
  function addTask(text) {
    var q = parseQuick(text); if (!q.title) return;
    var pid = null;
    if (q.projName) { var p = projByName(q.projName); if (!p) { p = { id: uid("pj"), name: q.projName, color: COLORS[P.projects.length % COLORS.length] }; P.projects.push(p); } pid = p.id; }
    else if (/^proj:/.test(ui.view)) pid = ui.view.slice(5);
    var due = q.due;
    if (!due && !q.projName) { if (ui.view === "today") due = today(); else if (/^day:/.test(ui.view)) due = ui.view.slice(4); }
    P.tasks.push({ id: uid("t"), title: q.title, note: "", due: due, time: q.time, pri: q.pri, proj: pid, repeat: q.repeat, subs: [], done: false, doneAt: null, created: new Date().toISOString() });
    save();
  }
  function nextDue(t) {
    var d = t.due || today();
    if (t.repeat === "d") return addDays(d, 1);
    if (t.repeat === "w") return addDays(d, 7);
    if (t.repeat === "wd") { var n = addDays(d, 1); while (pd(n).getDay() === 0 || pd(n).getDay() === 6) n = addDays(n, 1); return n; }
    if (t.repeat === "m") { var x = pd(d), y = new Date(x.getFullYear(), x.getMonth() + 1, x.getDate()); if (y.getDate() !== x.getDate()) y = new Date(x.getFullYear(), x.getMonth() + 2, 0); return ymd(y); }
    return null;
  }
  function toggle(id) {
    var t = task(id); if (!t) return;
    t.done = !t.done; t.doneAt = t.done ? new Date().toISOString() : null;
    if (t.done && t.repeat && !t.spawned) {
      t.spawned = true;   /* 반복: 다음 회차를 새 할 일로 만든다(완료 기록은 남김) */
      P.tasks.push({ id: uid("t"), title: t.title, note: t.note, due: nextDue(t), time: t.time, pri: t.pri, proj: t.proj, repeat: t.repeat,
        subs: (t.subs || []).map(function (s) { return { id: uid("s"), t: s.t, done: false }; }), done: false, doneAt: null, created: new Date().toISOString() });
    }
    save();
  }
  function remove(id) { P.tasks = P.tasks.filter(function (t) { return t.id !== id; }); if (openId === id) openId = null; save(); }

  /* ── 보기 ── */
  var ICON = {
    today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>',
    upcoming: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/></svg>',
    inbox: '<svg viewBox="0 0 24 24"><path d="M4 13.5 6.3 5.8A1.6 1.6 0 0 1 7.8 4.7h8.4a1.6 1.6 0 0 1 1.5 1.1L20 13.5V18a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18z"/><path d="M4 13.5h4.5l1.2 2.2h4.6l1.2-2.2H20"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8.5 13h1M11.5 13h1M14.5 13h1M8.5 16.3h1M11.5 16.3h1"/></svg>',
    log: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.3 12.2 2.6 2.6 4.9-5.4"/></svg>'
  };
  function open(t) { return !t.done; }
  function counts() {
    var td = today(), c = { today: 0, overdue: 0, upcoming: 0, inbox: 0 };
    P.tasks.forEach(function (t) {
      if (t.done) return;
      if (!t.due) c.inbox++;
      else if (t.due < td) { c.overdue++; c.today++; }
      else if (t.due === td) c.today++;
      else if (diff(t.due, td) <= 7) c.upcoming++;
    });
    return c;
  }
  function sideHTML() {
    var c = counts();
    function item(v, icon, label, n, red) {
      return '<button type="button" class="pl-nav' + (ui.view === v ? " on" : "") + '" data-act="view" data-v="' + v + '"><i class="ic ic-' + icon + '">' + ICON[icon] + "</i><span>" + label + "</span>" +
        (red ? '<em class="red">' + red + "</em>" : "") + (n ? "<em>" + n + "</em>" : "") + "</button>";
    }
    return '<aside class="pl-side">' +
      item("today", "today", "오늘", c.today - c.overdue || "", c.overdue || "") +
      item("upcoming", "upcoming", "예정", c.upcoming || "") +
      item("inbox", "inbox", "날짜 없음", c.inbox || "") +
      item("calendar", "calendar", "달력", "") +
      item("log", "log", "완료 기록", "") +
      '<div class="pl-sec"><span>프로젝트</span><button type="button" data-act="addproj" title="프로젝트 추가">＋</button></div>' +
      P.projects.map(function (p) {
        var n = P.tasks.filter(function (t) { return t.proj === p.id && !t.done; }).length;
        return '<button type="button" class="pl-nav pj' + (ui.view === "proj:" + p.id ? " on" : "") + '" data-act="view" data-v="proj:' + p.id + '"><i class="dot" style="background:' + p.color + '"></i><span>' + esc(p.name) + "</span>" + (n ? "<em>" + n + "</em>" : "") + "</button>";
      }).join("") +
      (P.projects.length ? "" : '<p class="pl-hint">입력할 때 <b>#이름</b>을 붙이면 프로젝트가 생깁니다.</p>') +
      "</aside>";
  }
  function rowHTML(t, opt) {
    opt = opt || {};
    var td = today(), p = t.proj && proj(t.proj), subs = t.subs || [], sd = subs.filter(function (s) { return s.done; }).length, meta = [];
    if (t.due && !opt.noDate) meta.push('<span class="m-date' + (!t.done && t.due < td ? " over" : t.due === td ? " today" : "") + '">' + esc(dateLabel(t.due)) + "</span>");
    if (t.time) meta.push('<span class="m-time">' + esc(timeLabel(t.time)) + "</span>");
    if (t.repeat) meta.push('<span title="' + REPEAT[t.repeat] + '">↻ ' + REPEAT[t.repeat] + "</span>");
    if (subs.length) meta.push('<span class="m-sub">☑ ' + sd + "/" + subs.length + "</span>");
    if (t.note) meta.push('<span class="m-note" title="메모">메모</span>');
    if (p && !opt.noProj) meta.push('<span class="m-proj"><i class="dot" style="background:' + p.color + '"></i>' + esc(p.name) + "</span>");
    var html = '<div class="pl-task' + (t.done ? " done" : "") + (openId === t.id ? " open" : "") + '" data-id="' + t.id + '">' +
      '<button type="button" class="pl-chk" style="--c:' + PRI[t.pri || 4] + '" data-act="toggle" aria-label="완료 표시"><svg viewBox="0 0 24 24"><path d="m7 12.5 3.3 3.3L17 9"/></svg></button>' +
      '<div class="pl-tmain" data-act="open"><div class="pl-ttl">' + esc(t.title) + "</div>" + (meta.length ? '<div class="pl-meta">' + meta.join("") + "</div>" : "") + "</div>" +
      '<button type="button" class="pl-del" data-act="del" title="삭제" aria-label="삭제">×</button></div>';
    if (openId === t.id) html += editHTML(t);
    return html;
  }
  function editHTML(t) {
    var td = today();
    return '<div class="pl-edit" data-id="' + t.id + '">' +
      '<input class="pl-e-title" data-f="title" value="' + esc(t.title) + '" aria-label="제목">' +
      '<textarea class="pl-e-note" data-f="note" rows="2" placeholder="메모">' + esc(t.note || "") + "</textarea>" +
      '<div class="pl-subs">' + (t.subs || []).map(function (s) {
        return '<div class="pl-sub' + (s.done ? " done" : "") + '" data-sid="' + s.id + '"><button type="button" class="pl-schk" data-act="subtoggle" aria-label="하위 완료"></button><input data-f="sub" value="' + esc(s.t) + '"><button type="button" class="pl-del" data-act="subdel" aria-label="삭제">×</button></div>';
      }).join("") + '<input class="pl-subadd" data-f="subadd" placeholder="+ 하위 할 일 (Enter)"></div>' +
      '<div class="pl-e-grid">' +
      '<label>날짜<input type="date" data-f="due" value="' + esc(t.due || "") + '"></label>' +
      '<label>시간<input type="time" data-f="time" value="' + esc(t.time || "") + '"></label>' +
      '<label>반복<select data-f="repeat"><option value="">안 함</option>' + Object.keys(REPEAT).map(function (k) { return '<option value="' + k + '"' + (t.repeat === k ? " selected" : "") + ">" + REPEAT[k] + "</option>"; }).join("") + "</select></label>" +
      '<label>프로젝트<select data-f="proj"><option value="">없음</option>' + P.projects.map(function (p) { return '<option value="' + p.id + '"' + (t.proj === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + "</select></label>" +
      "</div>" +
      '<div class="pl-e-foot"><div class="pl-quick">' +
      [["오늘", td], ["내일", addDays(td, 1)], ["다음 주", addDays(td, ((8 - new Date().getDay()) % 7) || 7)], ["날짜 없음", ""]].map(function (q) { return '<button type="button" data-act="setdue" data-d="' + q[1] + '"' + ((t.due || "") === q[1] ? ' class="on"' : "") + ">" + q[0] + "</button>"; }).join("") +
      '</div><div class="pl-pri">' + [1, 2, 3, 4].map(function (k) { return '<button type="button" data-act="pri" data-p="' + k + '" title="우선순위 ' + PRI_NAME[k] + '"' + ((t.pri || 4) === k ? ' class="on"' : "") + ' style="--c:' + PRI[k] + '">' + (k < 4 ? "P" + k : "–") + "</button>"; }).join("") +
      '</div><button type="button" class="pl-close" data-act="close">닫기</button></div></div>';
  }
  function group(title, list, opt, extra) {
    if (!list.length && !(opt && opt.showEmpty)) return "";
    return '<section class="pl-group"><h4>' + title + (extra || "") + (list.length ? "<small>" + list.length + "</small>" : "") + "</h4>" +
      (list.length ? list.sort(sortTasks).map(function (t) { return rowHTML(t, opt); }).join("") : '<p class="pl-empty-day">—</p>') + "</section>";
  }
  function emptyHTML(msg) { return '<div class="pl-empty"><div class="pl-empty-ic">' + ICON.log + "</div><p>" + msg + "</p></div>"; }

  function viewToday() {
    var td = today(), over = P.tasks.filter(function (t) { return open(t) && t.due && t.due < td; }),
      now = P.tasks.filter(function (t) { return open(t) && t.due === td; }),
      doneToday = P.tasks.filter(function (t) { return t.done && t.doneAt && ymd(new Date(t.doneAt)) === td; });
    var total = now.length + over.length + doneToday.length, pct = total ? Math.round(doneToday.length / total * 100) : 0;
    var head = '<div class="pl-progress"><div><b>' + doneToday.length + "</b> / " + total + " 완료</div><span><i style=\"width:" + pct + '%"></i></span></div>';
    var body = group("지난 일", over, {}, '<button type="button" class="pl-mini" data-act="rollover">모두 오늘로</button>') + group("오늘", now, { noDate: true });
    if (!over.length && !now.length) body += emptyHTML(doneToday.length ? "오늘 할 일을 모두 끝냈습니다." : "오늘 할 일이 없습니다. 위 입력칸에 적어 보세요.");
    if (doneToday.length) body += group("오늘 완료", doneToday, { noDate: true });
    return { title: "오늘", sub: longDate(td), head: head, body: body };
  }
  function viewUpcoming() {
    var td = today(), strip = "", body = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(td, i), n = P.tasks.filter(function (t) { return open(t) && t.due === d; }).length, dd = pd(d);
      strip += '<button type="button" class="pl-day' + (i === 0 ? " now" : "") + (dd.getDay() === 0 ? " sun" : dd.getDay() === 6 ? " sat" : "") + '" data-act="jump" data-d="' + d + '"><small>' + DOW[dd.getDay()] + "</small><b>" + dd.getDate() + "</b><i>" + (n ? Array(Math.min(n, 4) + 1).join("•") : "") + "</i></button>";
      body += '<div id="pl-d-' + d + '">' + group(esc(i === 0 ? "오늘" : i === 1 ? "내일" : DOW[dd.getDay()] + "요일") + ' <span class="pl-gdate">' + (dd.getMonth() + 1) + "." + dd.getDate() + "</span>",
        P.tasks.filter(function (t) { return open(t) && t.due === d; }), { noDate: true, showEmpty: true }) + "</div>";
    }
    var later = P.tasks.filter(function (t) { return open(t) && t.due && diff(t.due, td) >= 7; }), byDate = {};
    later.forEach(function (t) { (byDate[t.due] = byDate[t.due] || []).push(t); });
    Object.keys(byDate).sort().forEach(function (d) { body += group(esc(dateLabel(d)) + ' <span class="pl-gdate">' + DOW[pd(d).getDay()] + "</span>", byDate[d], { noDate: true }); });
    return { title: "예정", sub: "앞으로 7일과 그 이후", head: '<div class="pl-strip">' + strip + "</div>", body: body };
  }
  function viewInbox() {
    var list = P.tasks.filter(function (t) { return open(t) && !t.due; }), body = "";
    body += group("프로젝트 없음", list.filter(function (t) { return !t.proj; }), {});
    P.projects.forEach(function (p) { body += group('<i class="dot" style="background:' + p.color + '"></i>' + esc(p.name), list.filter(function (t) { return t.proj === p.id; }), { noProj: true }); });
    return { title: "날짜 없음", sub: "언젠가 할 일 · 생각나는 대로 적어 두는 곳", body: body || emptyHTML("날짜 없는 할 일이 없습니다.") };
  }
  function viewProject(id) {
    var p = proj(id); if (!p) { ui.view = "today"; return viewToday(); }
    var list = P.tasks.filter(function (t) { return t.proj === id; }), td = today();
    var openL = list.filter(open), done = list.filter(function (t) { return t.done; });
    var pct = list.length ? Math.round(done.length / list.length * 100) : 0;
    var body = group("지난 일", openL.filter(function (t) { return t.due && t.due < td; }), { noProj: true }) +
      group("날짜 있음", openL.filter(function (t) { return t.due && t.due >= td; }).sort(function (a, b) { return a.due.localeCompare(b.due); }), { noProj: true }) +
      group("날짜 없음", openL.filter(function (t) { return !t.due; }), { noProj: true });
    if (!openL.length) body += emptyHTML("남은 할 일이 없습니다.");
    if (done.length) body += '<details class="pl-donebox"><summary>완료 ' + done.length + "개</summary>" + done.map(function (t) { return rowHTML(t, { noProj: true }); }).join("") + "</details>";
    return { title: '<i class="dot big" style="background:' + p.color + '"></i>' + esc(p.name), sub: "진행 " + pct + "% · 남은 일 " + openL.length + "개",
      tools: '<button type="button" class="pl-mini" data-act="renproj" data-p="' + id + '">이름 변경</button><button type="button" class="pl-mini" data-act="colproj" data-p="' + id + '">색</button><button type="button" class="pl-mini danger" data-act="delproj" data-p="' + id + '">삭제</button>',
      head: '<div class="pl-progress"><div><b>' + done.length + "</b> / " + list.length + " 완료</div><span><i style=\"width:" + pct + "%;background:" + p.color + '"></i></span></div>', body: body };
  }
  function viewDay(d) {
    var list = P.tasks.filter(function (t) { return t.due === d; });
    return { title: dateLabel(d), sub: longDate(d), tools: '<button type="button" class="pl-mini" data-act="view" data-v="calendar">‹ 달력</button>',
      body: group("할 일", list.filter(open), { noDate: true }) + group("완료", list.filter(function (t) { return t.done; }), { noDate: true }) || emptyHTML("이 날 할 일이 없습니다. 위에 적으면 이 날짜로 들어갑니다.") };
  }
  function viewCalendar() {
    var td = today(), base = ui.month ? pd(ui.month + "-01") : new Date(), y = base.getFullYear(), mo = base.getMonth();
    var first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay()), cells = "";
    for (var i = 0; i < 42; i++) {
      var d = new Date(start); d.setDate(start.getDate() + i);
      var s = ymd(d), list = P.tasks.filter(function (t) { return t.due === s; }).sort(function (a, b) { return a.done - b.done || sortTasks(a, b); });
      if (i >= 35 && d.getMonth() !== mo) break;
      cells += '<button type="button" class="pl-cell' + (d.getMonth() !== mo ? " out" : "") + (s === td ? " now" : "") + (d.getDay() === 0 ? " sun" : d.getDay() === 6 ? " sat" : "") + '" data-act="view" data-v="day:' + s + '"><b>' + d.getDate() + "</b>" +
        list.slice(0, 3).map(function (t) { return '<span class="' + (t.done ? "done" : "") + '" style="--c:' + PRI[t.pri || 4] + '">' + esc(t.title) + "</span>"; }).join("") +
        (list.length > 3 ? "<em>+" + (list.length - 3) + "</em>" : "") + "</button>";
    }
    return { title: y + "년 " + (mo + 1) + "월", sub: "날짜를 누르면 그날 할 일을 보고 추가할 수 있습니다",
      tools: '<button type="button" class="pl-mini" data-act="month" data-n="-1">‹</button><button type="button" class="pl-mini" data-act="month" data-n="0">이번 달</button><button type="button" class="pl-mini" data-act="month" data-n="1">›</button>',
      body: '<div class="pl-cal"><div class="pl-cal-h">' + DOW.map(function (d, i) { return "<span" + (i === 0 ? ' class="sun"' : i === 6 ? ' class="sat"' : "") + ">" + d + "</span>"; }).join("") + "</div><div class=\"pl-cal-g\">" + cells + "</div></div>", noAdd: true };
  }
  function viewLog() {
    var done = P.tasks.filter(function (t) { return t.done; }).sort(function (a, b) { return String(b.doneAt).localeCompare(String(a.doneAt)); }), by = {}, order = [];
    done.forEach(function (t) { var d = t.doneAt ? ymd(new Date(t.doneAt)) : "기록 없음"; if (!by[d]) { by[d] = []; order.push(d); } by[d].push(t); });
    var body = order.map(function (d) { return '<section class="pl-group"><h4>' + esc(d === "기록 없음" ? d : dateLabel(d)) + " <span class=\"pl-gdate\">" + (d === "기록 없음" ? "" : longDate(d)) + "</span><small>" + by[d].length + "</small></h4>" + by[d].map(function (t) { return rowHTML(t); }).join("") + "</section>"; }).join("");
    var week = done.filter(function (t) { return t.doneAt && diff(today(), ymd(new Date(t.doneAt))) < 7; }).length;
    return { title: "완료 기록", sub: "최근 7일 " + week + "개 완료 · 전체 " + done.length + "개", body: body || emptyHTML("아직 완료한 할 일이 없습니다."), noAdd: true,
      tools: done.length ? '<button type="button" class="pl-mini danger" data-act="purge">30일 지난 기록 지우기</button>' : "" };
  }

  function render(keepFocus) {
    if (!host) return;
    P = load();
    var v = ui.view, V = v === "today" ? viewToday() : v === "upcoming" ? viewUpcoming() : v === "inbox" ? viewInbox() : v === "calendar" ? viewCalendar() : v === "log" ? viewLog() :
      /^proj:/.test(v) ? viewProject(v.slice(5)) : /^day:/.test(v) ? viewDay(v.slice(4)) : viewToday();
    var draft = host.querySelector(".pl-add input"), dv = draft ? draft.value : "";
    host.innerHTML = '<div class="pl">' + sideHTML() + '<div class="pl-main">' +
      '<header class="pl-head"><div><h3>' + V.title + "</h3><p>" + esc(V.sub || "") + '</p></div><div class="pl-tools">' + (V.tools || "") + "</div></header>" +
      (V.noAdd ? "" : '<form class="pl-add" autocomplete="off"><span class="pl-plus">＋</span><input type="text" placeholder="할 일 추가 — 예: 내일 오후 3시 실적 정리 #리서치 !1" value="' + esc(dv) + '" aria-label="할 일 추가"><button type="submit">추가</button><div class="pl-preview">' + (dv ? chipsFor(parseQuick(dv)) : "") + "</div></form>" +
        '<p class="pl-syntax"><b>오늘·내일·금요일·10/12</b> 날짜 · <b>오후 3시</b> 시간 · <b>#이름</b> 프로젝트 · <b>!1~!3</b> 우선순위 · <b>매일·매주·매월</b> 반복 · 단축키 <kbd>N</kbd></p>') +
      (V.head || "") + '<div class="pl-body">' + V.body + "</div></div></div>";
    if (keepFocus === "add") { var inp = host.querySelector(".pl-add input"); if (inp) inp.focus(); }
    if (keepFocus === "sub") { var sa = host.querySelector(".pl-subadd"); if (sa) sa.focus(); }
  }

  function bind() {
    host.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b || !host.contains(b)) return;
      var act = b.dataset.act, row = b.closest("[data-id]"), id = row && row.dataset.id, t = id && task(id);
      if (act === "view") { ui.view = b.dataset.v; openId = null; saveUI(); render(); host.scrollIntoView({ block: "nearest" }); return; }
      if (act === "toggle") { toggle(id); if (openId === id) openId = null; return render(); }
      if (act === "open") { openId = openId === id ? null : id; render(); var ti = host.querySelector(".pl-e-title"); if (ti && openId) ti.focus(); return; }
      if (act === "close") { openId = null; return render(); }
      if (act === "del") { if (confirm("‘" + (t ? t.title : "") + "’ 할 일을 삭제할까요?")) { remove(id); render(); } return; }
      if (act === "setdue" && t) { t.due = b.dataset.d || null; save(); return render(); }
      if (act === "pri" && t) { t.pri = +b.dataset.p; save(); return render(); }
      if (act === "subtoggle" && t) { var s = (t.subs || []).filter(function (x) { return x.id === b.closest("[data-sid]").dataset.sid; })[0]; if (s) { s.done = !s.done; save(); render(); } return; }
      if (act === "subdel" && t) { var sid = b.closest("[data-sid]").dataset.sid; t.subs = (t.subs || []).filter(function (x) { return x.id !== sid; }); save(); return render(); }
      if (act === "rollover") { var td = today(); P.tasks.forEach(function (x) { if (open(x) && x.due && x.due < td) x.due = td; }); save(); return render(); }
      if (act === "jump") { var el = document.getElementById("pl-d-" + b.dataset.d); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (act === "month") { var n = +b.dataset.n, base = ui.month ? pd(ui.month + "-01") : new Date(); var m = n ? new Date(base.getFullYear(), base.getMonth() + n, 1) : new Date(); ui.month = m.getFullYear() + "-" + pad(m.getMonth() + 1); saveUI(); return render(); }
      if (act === "addproj") { var name = prompt("새 프로젝트 이름"); if (name && name.trim()) { var p = { id: uid("pj"), name: name.trim().replace(/^#/, ""), color: COLORS[P.projects.length % COLORS.length] }; P.projects.push(p); save(); ui.view = "proj:" + p.id; saveUI(); render(); } return; }
      var pj = b.dataset.p && proj(b.dataset.p);
      if (act === "renproj" && pj) { var nn = prompt("프로젝트 이름", pj.name); if (nn && nn.trim()) { pj.name = nn.trim(); save(); render(); } return; }
      if (act === "colproj" && pj) { pj.color = COLORS[(COLORS.indexOf(pj.color) + 1) % COLORS.length]; save(); return render(); }
      if (act === "delproj" && pj) {
        if (!confirm("‘" + pj.name + "’ 프로젝트를 삭제할까요? 안의 할 일은 지워지지 않고 '프로젝트 없음'으로 옮겨집니다.")) return;
        P.tasks.forEach(function (x) { if (x.proj === pj.id) x.proj = null; }); P.projects = P.projects.filter(function (x) { return x.id !== pj.id; }); save(); ui.view = "today"; saveUI(); return render();
      }
      if (act === "purge") { var cut = addDays(today(), -30); var before = P.tasks.length; if (!confirm("완료한 지 30일이 지난 기록을 지울까요?")) return; P.tasks = P.tasks.filter(function (x) { return !(x.done && x.doneAt && ymd(new Date(x.doneAt)) < cut); }); save(); render(); alert((before - P.tasks.length) + "개를 지웠습니다."); return; }
    });
    host.addEventListener("submit", function (e) {
      if (!e.target.classList.contains("pl-add")) return;
      e.preventDefault();
      var inp = e.target.querySelector("input"), v = inp.value.trim(); if (!v) return;
      addTask(v); inp.value = ""; render("add");
    });
    host.addEventListener("input", function (e) {
      if (e.target.closest(".pl-add")) { var pv = host.querySelector(".pl-preview"); if (pv) pv.innerHTML = e.target.value.trim() ? chipsFor(parseQuick(e.target.value)) : ""; return; }
      var ed = e.target.closest(".pl-edit"); if (!ed) return;
      var t = task(ed.dataset.id), f = e.target.dataset.f; if (!t) return;
      if (f === "title") { t.title = e.target.value; save(); }
      if (f === "note") { t.note = e.target.value; save(); }
      if (f === "sub") { var s = (t.subs || []).filter(function (x) { return x.id === e.target.closest("[data-sid]").dataset.sid; })[0]; if (s) { s.t = e.target.value; save(); } }
    });
    host.addEventListener("change", function (e) {
      var ed = e.target.closest(".pl-edit"); if (!ed) return;
      var t = task(ed.dataset.id), f = e.target.dataset.f; if (!t) return;
      if (f === "due") t.due = e.target.value || null;
      else if (f === "time") t.time = e.target.value || null;
      else if (f === "repeat") t.repeat = e.target.value || null;
      else if (f === "proj") t.proj = e.target.value || null;
      else if (f === "title" || f === "note" || f === "sub") { render(); return; }
      else return;
      save(); render();
    });
    host.addEventListener("keydown", function (e) {
      if (e.target.dataset && e.target.dataset.f === "subadd" && e.key === "Enter") {
        e.preventDefault(); var t = task(e.target.closest(".pl-edit").dataset.id), v = e.target.value.trim();
        if (t && v) { (t.subs = t.subs || []).push({ id: uid("s"), t: v, done: false }); save(); render("sub"); }
      }
      if (e.target.dataset && e.target.dataset.f === "title" && e.key === "Enter") { e.preventDefault(); openId = null; render(); }
      if (e.key === "Escape" && openId) { openId = null; render(); }
    });
    document.addEventListener("keydown", function (e) {
      if (!host || host.offsetParent === null) return;
      if ((e.key === "n" || e.key === "N") && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName)) {
        var inp = host.querySelector(".pl-add input"); if (inp) { e.preventDefault(); inp.focus(); }
      }
    });
    /* 다른 기기에서 동기화돼 들어오면 다시 그림(입력 중이면 미룸) */
    window.addEventListener("storage", function (e) { if (e.key === KEY && !host.contains(document.activeElement)) render(); });
    window.addEventListener("vantage-sync-applied", function () { if (!host.contains(document.activeElement)) render(); });
    /* 자정이 지나면 '오늘'을 새로 */
    var day = today(); setInterval(function () { if (today() !== day) { day = today(); if (!host.contains(document.activeElement)) render(); } }, 60000);
  }

  window.PortfolioPlanner = {
    mount: function (el) {
      if (host !== el) { host = el; bind(); }
      render();
    }
  };
})();
