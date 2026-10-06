/* 관리 계좌: 사진으로 받은 매매기록을 Claude 가 암호화해 올린 파일(data/pf/managed.enc.json)을 풀어
   그 계좌와 매매기록을 통째로 교체한다. 기기마다 키를 한 번 입력하면(이 기기에만 저장, 동기화 안 함) 이후 자동.
   원본·키는 저장소 private/ (공개 안 됨) — pf_managed.py 참고. */
(function () {
  "use strict";
  var URL = "data/pf/managed.enc.json", KEY = "vantage-pf-mkey", OVR = "vantage-pf-overrides";
  /* 화면에서 고친 관리 거래: {거래id: {side, qty, price, date, fx} 또는 {del:true}} — 파일 값보다 우선 */
  function ovGet() { try { return JSON.parse(localStorage.getItem(OVR) || "{}") || {}; } catch (e) { return {}; } }
  function ovSet(o) { try { localStorage.setItem(OVR, JSON.stringify(o)); } catch (e) {} }
  function applyOv(list) {
    var o = ovGet();
    return list.filter(function (t) { return !(o[t.id] && o[t.id].del); }).map(function (t) { return o[t.id] ? Object.assign({}, t, o[t.id]) : t; });
  }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function getKey() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  async function decrypt(file, phrase) {
    var base = await crypto.subtle.importKey("raw", new TextEncoder().encode(phrase), "PBKDF2", false, ["deriveKey"]);
    var key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(file.salt), iterations: file.iter || 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(file.iv) }, key, b64(file.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function fetchFile() {
    var r = await fetch(URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("파일 없음");
    return r.json();
  }
  /* 상태에 반영: 관리 계좌는 맨 앞, 매매기록은 파일 것으로 교체. 바뀐 게 있으면 true */
  function merge(state, data) {
    data = Object.assign({}, data, { transactions: applyOv(data.transactions || []) });
    var before = JSON.stringify([state.accounts, state.transactions.length]), changed = false;
    (data.accounts || []).slice().reverse().forEach(function (a0) {
      /* 덧붙이기(mode:"append", 사장님 본인 계좌): 기존 기록은 그대로 두고 파일의 거래만 id 기준으로 추가·수정.
         대상 = 이름에 match 가 들어간 계좌, 없으면 다른 관리 계좌가 아닌 첫 계좌 */
      if (a0.mode === "append") {
        var others = (data.accounts || []).filter(function (x) { return x !== a0; }).map(function (x) { return x.match || String(x.name || "").replace(/형님|계좌|\s/g, ""); });
        var tg = state.accounts.filter(function (x) { return a0.match && String(x.name || "").indexOf(a0.match) >= 0; })[0] ||
          state.accounts.filter(function (x) { return !x.managed && !others.some(function (k) { return k && String(x.name || "").indexOf(k) >= 0; }); })[0];
        if (!tg) return;
        (data.transactions || []).filter(function (t) { return t.accountId === a0.id; }).forEach(function (t) {
          var c = Object.assign({}, t, { accountId: tg.id }); delete c.no;
          var j = state.transactions.findIndex(function (x) { return x.id === c.id; });
          if (j < 0) { state.transactions.push(c); changed = true; }
          else if (JSON.stringify(state.transactions[j]) !== JSON.stringify(c)) { state.transactions[j] = c; changed = true; }
        });
        return;
      }
      /* 사용자가 직접 만든 같은 사람 계좌(예: '제현형님 계좌')가 있으면 그 계좌에 넣는다 — 이름에 match(예: '제현')가 들어간 계좌 */
      var a = Object.assign({}, a0), key = a.match || String(a.name || "").replace(/형님|계좌|\s/g, "");
      var own = state.accounts.filter(function (x) { return x.id !== a.id && key && String(x.name || "").indexOf(key) >= 0; })[0];
      if (own) {
        a.id = own.id; a.name = own.name;
        state.accounts = state.accounts.filter(function (x) { return x.id !== a0.id; });   // 예전에 따로 만들어진 관리 계좌는 정리
        state.transactions = state.transactions.filter(function (t) { return t.accountId !== a0.id; });
        data = Object.assign({}, data, { transactions: (data.transactions || []).map(function (t) { return t.accountId === a0.id ? Object.assign({}, t, { accountId: own.id }) : t; }) });
      }
      var i = state.accounts.findIndex(function (x) { return x.id === a.id; }), cur = i >= 0 ? state.accounts[i] : null;
      var next = Object.assign({}, cur || {}, a);
      if (cur) { if (cur.cashKrw) next.cashKrw = cur.cashKrw; if (cur.cashUsd) next.cashUsd = cur.cashUsd; state.accounts.splice(i, 1); }   // 예수금은 화면에서 적은 값 유지
      state.accounts.unshift(next);
      var mine = state.transactions.filter(function (t) { return t.accountId === a.id; }), theirs = (data.transactions || []).filter(function (t) { return t.accountId === a.id; });
      if (JSON.stringify(mine.map(function (t) { return [t.id, t.date, t.side, t.qty, t.price, t.fx]; })) !== JSON.stringify(theirs.map(function (t) { return [t.id, t.date, t.side, t.qty, t.price, t.fx]; }))) {
        state.transactions = state.transactions.filter(function (t) { return t.accountId !== a.id; }).concat(theirs.map(function (t) { var c = Object.assign({}, t); delete c.no; return c; }));
        changed = true;
      }
    });
    return changed || before !== JSON.stringify([state.accounts, state.transactions.length]);
  }
  window.PortfolioManaged = {
    hasKey: function () { return !!getKey(); },
    /* 키가 있으면 파일을 받아 풀어서 cb(data, updated) */
    load: async function (cb, fail) {
      var k = getKey(); if (!k) return;
      try { var d = await decrypt(await fetchFile(), k); cb(d); }
      catch (e) { console.warn("관리 계좌 불러오기 실패", e); if (fail) fail(e); }
    },
    /* 키 입력 → 맞으면 저장하고 cb(data) */
    unlock: async function (cb) {
      var k = (prompt("관리 계좌 키를 입력하세요 (예: abcd-efgh-jkmn)") || "").trim();
      if (!k) return;
      try {
        var d = await decrypt(await fetchFile(), k);
        try { localStorage.setItem(KEY, k); } catch (e) {}
        cb(d);
      } catch (e) { alert("키가 맞지 않거나 파일을 받지 못했습니다."); }
    },
    merge: merge,
    isManaged: function (t) { return /^(mj|me)-/.test(String(t && t.id || "")); },
    override: function (t, del) {
      var o = ovGet();
      o[t.id] = del ? { del: true } : { side: t.side, qty: t.qty, price: t.price, date: t.date, fx: t.fx };
      ovSet(o);
    }
  };
})();
