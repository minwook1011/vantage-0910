/* VANTAGE 개인 입력 데이터의 Firestore 실시간 동기화.
   공개 시세·리포트 파일은 동기화하지 않고, 사용자가 직접 저장한 기록만 다룬다. */
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
    "vantage-finemtec-custom-series-v1", "etf_news_favs_v1", "etf_favs_v1",
    "etf_stmt_favs_v1", "megacapN", "perspKr"
  ];
  var applyingRemote = false, timer = null, auth = null, db = null, api = null, currentUser = null;
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
  function updateButtons() {
    mountedButtons.forEach(function (button) {
      if (!button || !button.isConnected) return;
      if (currentUser) {
        button.textContent = "☁ 동기화됨";
        button.title = currentUser.email ? currentUser.email + " · 클릭하면 로그아웃" : "동기화됨 · 클릭하면 로그아웃";
        button.classList.add("cloud-sync-ready");
      } else {
        button.textContent = "☁ 동기화 로그인";
        button.title = "Google 계정으로 로그인하면 모든 개인 기록이 동기화됩니다";
        button.classList.remove("cloud-sync-ready");
      }
    });
  }
  function reloadForRemoteChange() { window.setTimeout(function () { window.location.reload(); }, 80); }
  function applyRemote(values) {
    applyingRemote = true;
    try {
      KEYS.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(values || {}, key)) localStorage.setItem(key, values[key]);
        else localStorage.removeItem(key);
      });
    } finally { applyingRemote = false; }
  }
  function queueSave() {
    if (applyingRemote || !currentUser || !db || !api) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      api.setDoc(api.doc(db, "vantageUsers", currentUser.uid), {
        schema: 1, values: snapshot(), updatedAt: api.serverTimestamp()
      }, { merge: true }).catch(function (error) { console.warn("VANTAGE sync save failed", error); });
    }, 450);
  }
  function patchStorage() {
    var originalSet = Storage.prototype.setItem, originalRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      var result = originalSet.apply(this, arguments);
      if (this === localStorage && isManaged(key)) queueSave();
      return result;
    };
    Storage.prototype.removeItem = function (key) {
      var result = originalRemove.apply(this, arguments);
      if (this === localStorage && isManaged(key)) queueSave();
      return result;
    };
  }
  function subscribe(user) {
    var ref = api.doc(db, "vantageUsers", user.uid);
    api.getDoc(ref).then(function (snap) {
      if (!snap.exists()) return api.setDoc(ref, { schema: 1, values: snapshot(), updatedAt: api.serverTimestamp() });
      var cloudValues = snap.data() && snap.data().values || {};
      applyRemote(cloudValues); reloadForRemoteChange();
    }).catch(function (error) { console.warn("VANTAGE sync load failed", error); });
    api.onSnapshot(ref, function (snap) {
      if (!snap.exists()) return;
      var cloudValues = snap.data() && snap.data().values || {};
      if (JSON.stringify(snapshot()) !== JSON.stringify(cloudValues)) { applyRemote(cloudValues); reloadForRemoteChange(); }
    }, function (error) { console.warn("VANTAGE sync listener failed", error); });
  }
  function signIn() {
    if (!auth || !api) return;
    var provider = new api.GoogleAuthProvider();
    var method = window.matchMedia && window.matchMedia("(max-width: 820px)").matches ? api.signInWithRedirect : api.signInWithPopup;
    method(auth, provider).catch(function (error) {
      console.warn("VANTAGE sign-in failed", error);
      window.alert("동기화 로그인에 실패했습니다. 팝업 차단을 해제한 뒤 다시 눌러주세요.");
    });
  }
  function signOut() { if (auth && currentUser) api.signOut(auth); }
  function mount(container) {
    if (!container || container.querySelector(".cloud-sync-button")) return;
    var button = document.createElement("button");
    button.type = "button"; button.className = "cloud-sync-button";
    button.addEventListener("click", function () { if (currentUser) signOut(); else signIn(); });
    container.appendChild(button); mountedButtons.push(button); updateButtons();
  }
  window.VantageCloud = { mount: mount, signIn: signIn, signOut: signOut };
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
      doc: modules[2].doc, getDoc: modules[2].getDoc, setDoc: modules[2].setDoc, onSnapshot: modules[2].onSnapshot,
      serverTimestamp: modules[2].serverTimestamp
    };
    modules[1].onAuthStateChanged(auth, function (user) { currentUser = user || null; updateButtons(); if (currentUser) subscribe(currentUser); });
  }).catch(function (error) { console.warn("VANTAGE Firebase unavailable", error); });
})();
