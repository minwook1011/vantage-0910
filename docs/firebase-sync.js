/* VANTAGE 개인 입력 데이터의 Firestore 실시간 동기화.
   공개 시세·리포트 파일은 동기화하지 않고, 사용자가 직접 저장한 기록만 다룬다.

   v2 (2026-09-19) — 기기 간 불일치 수정
   - 이전: 마지막으로 저장한 기기가 문서 전체를 덮어씀 → 오래된 화면을 연 기기가 시세만 갱신해도
     다른 기기에서 추가한 매매 기록이 사라질 수 있었음. 키 순서 차이로 불필요한 새로고침도 발생.
   - 지금: 이 기기가 마지막으로 동기화한 값(base)을 기억해 두고 base·이 기기·클라우드를 3-way 병합.
     배열은 id 기준으로 추가·삭제·수정을 각각 반영하므로 두 기기에서 따로 추가한 기록이 모두 남는다.
     쓰기는 Firestore 트랜잭션이라 동시에 저장해도 한쪽이 유실되지 않는다.
   - 모바일도 팝업 로그인 우선(github.io에서 redirect 로그인은 사파리·최신 크롬에서 실패함). */
(function () {
  "use strict";

  var CONFIG = {
    apiKey: "AIzaSyCfpZXhrBb2aQFk_Ot90shPpb2O249O3F0",
    authDomain: "minwook-3d6b1.firebaseapp.com",
    projectId: "minwook-3d6b1",
    storageBucket: "minwook-3d6b1.firebasestorage.app",
    messagingSenderId: "522402989148",
    appId: "1:522402989148:web:644dd0cc0557a0f872d299",
    measurementId: "G-F40MW0B72G"
  };
  var KEYS = [
    "vantage-portfolio-v1", "vantage_coverage_watch_v1",
    "vantage-datahub-favorite-companies-v1", "vantage-finemtec-workbench-v1",
    "vantage-finemtec-custom-series-v1", "vantage-company-bench-v1", "vantage-company-bench-custom-v1", "vantage-zeta-bench-v1",
    "etf_news_favs_v1", "etf_favs_v1",
    "etf_stmt_favs_v1", "megacapN", "perspKr"
  ];
  /* 동기화 상태(마지막 동기화 값·미전송 여부). 이 키 자체는 동기화하지 않는다. */
  var META_KEY = "vantage-sync-meta-v2", BACKUP_KEY = "vantage-sync-backup-v2";
  var originalSet = Storage.prototype.setItem, originalRemove = Storage.prototype.removeItem;
  var applyingRemote = false, frozen = false, timer = null, syncing = false, again = false, deferred = false;
  var auth = null, db = null, api = null, currentUser = null, unsubscribe = null, lastError = null;
  var mountedButtons = [];

  function isManaged(key) { return KEYS.indexOf(String(key)) >= 0; }
  function snapshot() {
    var values = {};
    KEYS.forEach(function (key) {
      var value = localStorage.getItem(key);
      if (value != null) values[key] = value;
    });
    return values;
  }
  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || "null") || {}; } catch (e) { return {}; }
  }
  function writeMeta(meta) { try { originalSet.call(localStorage, META_KEY, JSON.stringify(meta)); } catch (e) {} }
  function markDirty() { var m = readMeta(); if (!m.dirty) { m.dirty = true; writeMeta(m); } }

  /* ---------- 3-way 병합 ---------- */
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return v === undefined ? "~" : JSON.stringify(v);
  }
  function same(a, b) { return canon(a) === canon(b); }
  function isObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function itemKey(x) { return isObj(x) && x.id != null ? "id:" + x.id : "v:" + canon(x); }
  function index(arr) { var m = {}; (Array.isArray(arr) ? arr : []).forEach(function (x) { m[itemKey(x)] = x; }); return m; }
  function mergeArrays(b, l, c) {
    var bm = index(b), lm = index(l), out = [], seen = {};
    c.forEach(function (x) {
      var k = itemKey(x); if (seen[k]) return; seen[k] = true;
      var inBase = Object.prototype.hasOwnProperty.call(bm, k), inLocal = Object.prototype.hasOwnProperty.call(lm, k);
      if (inBase && !inLocal) return;                    /* 이 기기에서 삭제함 */
      out.push(inLocal ? merge3(bm[k], lm[k], x) : x);
    });
    l.forEach(function (x) {
      var k = itemKey(x); if (seen[k]) return; seen[k] = true;
      if (!Object.prototype.hasOwnProperty.call(bm, k)) out.push(x); /* 이 기기에서 추가함 (base에 있었는데 클라우드에 없으면 다른 기기가 삭제한 것) */
    });
    return out;
  }
  function merge3(b, l, c) {
    if (same(l, b)) return c;
    if (same(c, b) || same(l, c)) return l;
    if (Array.isArray(l) && Array.isArray(c)) return mergeArrays(b, l, c);
    if (isObj(l) && isObj(c)) {
      var out = {}, bo = isObj(b) ? b : {}, keys = {};
      Object.keys(l).concat(Object.keys(c)).forEach(function (k) { keys[k] = true; });
      Object.keys(keys).forEach(function (k) { var v = merge3(bo[k], l[k], c[k]); if (v !== undefined) out[k] = v; });
      return out;
    }
    return l; /* 같은 값을 양쪽에서 다르게 바꾼 경우: 지금 쓰고 있는 이 기기 우선 */
  }
  function parse(s) {
    if (s == null) return { v: undefined };
    try { return { v: JSON.parse(s) }; } catch (e) { return { raw: s }; }
  }
  function mergeStored(b, l, c) {
    if (l === c) return l;
    if (l === b) return c;
    if (c === b) return l;
    var pb = parse(b), pl = parse(l), pc = parse(c);
    if ("raw" in pl || "raw" in pc || "raw" in pb) return l;
    var v = merge3(pb.v, pl.v, pc.v);
    if (v === undefined) return undefined;
    if (same(v, pc.v)) return c;
    if (same(v, pl.v)) return l;
    return JSON.stringify(v);
  }
  function mergeValues(base, local, cloud) {
    var out = {};
    KEYS.forEach(function (key) {
      var v = mergeStored(base[key], local[key], cloud[key]);
      if (v !== undefined && v !== null) out[key] = v;
    });
    return out;
  }
  function sameValues(a, b) {
    return KEYS.every(function (key) { var x = a[key], y = b[key]; if (x === y) return true; if (x == null || y == null) return false; var px = parse(x), py = parse(y); return "raw" in px || "raw" in py ? false : same(px.v, py.v); });
  }

  /* ---------- 로컬 반영 ---------- */
  function applyLocal(values) {
    applyingRemote = true;
    try {
      KEYS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(values, key)) originalSet.call(localStorage, key, values[key]);
        else originalRemove.call(localStorage, key);
      });
    } finally { applyingRemote = false; }
  }
  function reloadSoon() {
    /* 화면에 올라가 있는 데이터는 이제 오래된 것이므로, 새로고침 전까지 관리 키 쓰기를 막는다. */
    frozen = true;
    window.setTimeout(function () { window.location.reload(); }, 80);
  }
  function busyTyping() {
    var el = document.activeElement;
    return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.readOnly;
  }

  /* ---------- 클라우드 동기화 ---------- */
  function sync(reason) {
    if (!currentUser || !db || !api || frozen) return;
    if (syncing) { again = true; return; }
    if (busyTyping() && reason === "remote") { deferred = true; return; }
    syncing = true; again = false; setStatus("syncing");
    var uid = currentUser.uid, ref = api.doc(db, "vantageUsers", uid), result = null;
    api.runTransaction(db, function (tx) {
      return tx.get(ref).then(function (snap) {
        var meta = readMeta(), local = snapshot();
        var cloud = snap.exists() ? (snap.data() && snap.data().values) || {} : null;
        var merged, backup = null;
        if (!cloud) merged = local;                                  /* 첫 업로드 */
        else if (meta.uid === uid && meta.base) merged = mergeValues(meta.base, local, cloud);
        else {
          /* 이 기기에서 처음 동기화: 양쪽 기록을 합친다(어느 쪽도 버리지 않음). 합치기 전 로컬 값은 백업. */
          merged = mergeValues({}, local, cloud);
          if (Object.keys(local).length && !sameValues(local, cloud)) backup = local;
        }
        if (!cloud || !sameValues(merged, cloud)) {
          tx.set(ref, { schema: 1, values: merged, updatedAt: api.serverTimestamp() }, { merge: true });
        }
        result = { merged: merged, local: local, backup: backup };
      });
    }).then(function () {
      if (result.backup) {
        try { originalSet.call(localStorage, BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), values: result.backup })); } catch (e) {}
      }
      var changedHere = !sameValues(result.merged, snapshot());
      if (changedHere) applyLocal(result.merged);
      writeMeta({ uid: uid, base: result.merged, dirty: false, syncedAt: new Date().toISOString() });
      lastError = null; syncing = false; setStatus("ok");
      if (changedHere) { reloadSoon(); return; }
      if (again) sync("again");
    }).catch(function (error) {
      syncing = false; lastError = error; setStatus("error");
      console.warn("VANTAGE sync failed", error);
    });
  }
  function queueSave() {
    if (applyingRemote) return;
    markDirty();
    if (!currentUser) { setStatus(); return; }
    window.clearTimeout(timer);
    timer = window.setTimeout(function () { sync("local"); }, 450);
  }
  function patchStorage() {
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && isManaged(key) && frozen) return;
      var result = originalSet.apply(this, arguments);
      if (this === localStorage && isManaged(key)) queueSave();
      return result;
    };
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage && isManaged(key) && frozen) return;
      var result = originalRemove.apply(this, arguments);
      if (this === localStorage && isManaged(key)) queueSave();
      return result;
    };
  }
  function subscribe(user) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    var ref = api.doc(db, "vantageUsers", user.uid);
    sync("login");
    unsubscribe = api.onSnapshot(ref, function (snap) {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      var cloud = (snap.data() && snap.data().values) || {}, meta = readMeta();
      if (meta.uid === user.uid && meta.base && sameValues(cloud, meta.base)) return; /* 내가 쓴 값의 메아리 */
      sync("remote");
    }, function (error) { lastError = error; setStatus("error"); console.warn("VANTAGE sync listener failed", error); });
  }
  document.addEventListener("focusout", function () {
    if (!deferred) return;
    window.setTimeout(function () { if (deferred && !busyTyping()) { deferred = false; sync("deferred"); } }, 400);
  });
  window.addEventListener("online", function () { if (readMeta().dirty) sync("online"); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && currentUser) sync("visible"); });

  /* ---------- 로그인 ---------- */
  function signIn() {
    if (!auth || !api) { window.alert("동기화 모듈을 불러오는 중입니다. 잠시 후 다시 눌러주세요."); return; }
    var provider = new api.GoogleAuthProvider();
    api.signInWithPopup(auth, provider).catch(function (error) {
      var code = error && error.code || "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        return api.signInWithRedirect(auth, provider);
      }
      console.warn("VANTAGE sign-in failed", error);
      window.alert("동기화 로그인에 실패했습니다 (" + code + "). 팝업 차단을 해제한 뒤 다시 눌러주세요.");
    });
  }
  function signOut() { if (auth && currentUser && window.confirm("동기화에서 로그아웃할까요? 이 기기의 기록은 그대로 남습니다.")) api.signOut(auth); }

  /* ---------- 버튼 ---------- */
  function setStatus(state) {
    mountedButtons.forEach(function (button) {
      if (!button || !button.isConnected) return;
      button.classList.remove("cloud-sync-ready", "cloud-sync-off", "cloud-sync-error");
      if (!currentUser) {
        var hasLocal = Object.keys(snapshot()).length > 0;
        button.textContent = "☁ 동기화 꺼짐 · 로그인";
        button.title = "이 기기의 기록은 다른 기기에 보이지 않습니다. Google 로그인하면 모든 기기가 같은 기록을 봅니다.";
        if (hasLocal) button.classList.add("cloud-sync-off");
      } else if (state === "error") {
        button.textContent = "☁ 동기화 오류 · 재시도";
        button.title = (lastError && (lastError.code || lastError.message)) + " · 클릭하면 다시 동기화";
        button.classList.add("cloud-sync-error");
      } else if (state === "syncing") {
        button.textContent = "☁ 동기화 중…";
      } else {
        button.textContent = "☁ 동기화됨";
        button.title = (currentUser.email || "동기화됨") + " · 길게 누르거나 Shift+클릭하면 로그아웃";
        button.classList.add("cloud-sync-ready");
      }
    });
  }
  function injectStyle() {
    if (document.getElementById("cloud-sync-style")) return;
    var st = document.createElement("style"); st.id = "cloud-sync-style";
    st.textContent = "#topnav .cloud-sync-button.cloud-sync-off{border-color:#7a4a1f;color:#f5b46a;background:#2a1a0d;animation:cloudPulse 2.4s ease-in-out infinite}" +
      "#topnav .cloud-sync-button.cloud-sync-error{border-color:#7a2530;color:#ff8b98;background:#2a0f14}" +
      "@keyframes cloudPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,180,106,0)}50%{box-shadow:0 0 0 4px rgba(245,180,106,.18)}}";
    (document.head || document.documentElement).appendChild(st);
  }
  function mount(container) {
    if (!container || container.querySelector(".cloud-sync-button")) return;
    injectStyle();
    var button = document.createElement("button"), pressTimer = null;
    button.type = "button"; button.className = "cloud-sync-button";
    button.addEventListener("click", function (e) {
      if (!currentUser) return signIn();
      if (e.shiftKey) return signOut();
      sync("manual");
    });
    button.addEventListener("pointerdown", function () { pressTimer = window.setTimeout(function () { pressTimer = null; signOut(); }, 900); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { button.addEventListener(ev, function () { if (pressTimer) { window.clearTimeout(pressTimer); pressTimer = null; } }); });
    container.appendChild(button); mountedButtons.push(button); setStatus();
  }
  window.VantageCloud = { mount: mount, signIn: signIn, signOut: signOut, sync: function () { sync("manual"); } };
  patchStorage();

  Promise.all([
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js")
  ]).then(function (modules) {
    var app = modules[0].initializeApp(CONFIG);
    auth = modules[1].getAuth(app); db = modules[2].getFirestore(app);
    api = {
      GoogleAuthProvider: modules[1].GoogleAuthProvider, signInWithPopup: modules[1].signInWithPopup, signInWithRedirect: modules[1].signInWithRedirect, signOut: modules[1].signOut,
      doc: modules[2].doc, onSnapshot: modules[2].onSnapshot, runTransaction: modules[2].runTransaction,
      serverTimestamp: modules[2].serverTimestamp
    };
    modules[1].getRedirectResult(auth).catch(function (error) { console.warn("VANTAGE redirect sign-in failed", error); });
    modules[1].onAuthStateChanged(auth, function (user) {
      currentUser = user || null; setStatus();
      if (currentUser) subscribe(currentUser);
      else if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    });
  }).catch(function (error) { console.warn("VANTAGE Firebase unavailable", error); });
})();
