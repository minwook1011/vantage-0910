/* 관리 계좌: 사진으로 받은 매매기록을 Claude 가 암호화해 올린 파일(data/pf/managed.enc.json)을 풀어
   그 계좌와 매매기록을 통째로 교체한다. 기기마다 키를 한 번 입력하면(이 기기에만 저장, 동기화 안 함) 이후 자동.
   원본·키는 저장소 private/ (공개 안 됨) — pf_managed.py 참고. */
(function () {
  "use strict";
  var URL = "data/pf/managed.enc.json", KEY = "vantage-pf-mkey";
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
    var before = JSON.stringify([state.accounts, state.transactions.length]), changed = false;
    (data.accounts || []).slice().reverse().forEach(function (a) {
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
    load: async function (cb) {
      var k = getKey(); if (!k) return;
      try { var d = await decrypt(await fetchFile(), k); cb(d); }
      catch (e) { console.warn("관리 계좌 불러오기 실패", e); }
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
    merge: merge
  };
})();
