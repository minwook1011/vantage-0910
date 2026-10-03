/* ============================================================
   간단 접근 잠금 (클라이언트 사이드)
   - 사이트를 열면 비밀번호 입력 화면을 먼저 보여줍니다.
   - 비밀번호 평문은 저장하지 않고 SHA-256 해시만 비교합니다.
   - 한 번 맞추면 그 브라우저에는 기억됩니다(localStorage).
   - 정식 로그인 보안이 아닌, 공개 링크용 화면 잠금입니다.

   ▶ 비밀번호 바꾸는 법:
     1) 새 비밀번호의 SHA-256 해시를 구합니다.
        (예: 파이썬  python -c "import hashlib;print(hashlib.sha256('새비번'.encode()).hexdigest())")
     2) 아래 GATE_HASH 값을 그 해시로 교체하고,
     3) GATE_VER 값을 아무 다른 숫자로 바꾸면(기존에 로그인된 사람도 다시 입력하게 됨),
        각 HTML의 gate.js?v= 뒤 숫자도 함께 올려 배포하세요.
   ============================================================ */
(function () {
  "use strict";

  // 현재 비밀번호: 1011  (반드시 원하는 값으로 교체하세요)
  var GATE_HASH = "3dd9c0995d54c0abd51a90f1d57b1ce77bc885fc8a7cea52dcad3c2540dda5ee";
  var GATE_VER  = "3"; // 값을 바꾸면 모든 사용자가 재입력
  var STORE_KEY = "etf_gate_ok_v" + GATE_VER;

  window.vantageGateLogout = function () {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    location.reload();
  };

  // 이미 통과한 브라우저면 아무것도 안 함
  try {
    if (localStorage.getItem(STORE_KEY) === GATE_HASH) return;
  } catch (e) {}

  // 본문이 잠깐 보이는 것을 막고, 잠금 화면만 예외로 노출합니다.
  function sha256Hex(str) {
    var enc = new TextEncoder().encode(str);
    return crypto.subtle.digest("SHA-256", enc).then(function (buf) {
      return Array.prototype.map
        .call(new Uint8Array(buf), function (b) {
          return ("0" + b.toString(16)).slice(-2);
        })
        .join("");
    });
  }

  // 콘텐츠가 잠깐 비치지 않도록 즉시 스크롤 잠금 + 오버레이 삽입
  var docEl = document.documentElement;
  docEl.classList.add("gate-locked");
  var lockStyle = document.createElement("style");
  lockStyle.id = "__gate_lock_style";
  lockStyle.textContent = "html.gate-locked body > *{visibility:hidden!important}html.gate-locked body > #__gate_overlay{visibility:visible!important}";
  (document.head || docEl).appendChild(lockStyle);
  var prevOverflow = docEl.style.overflow;
  docEl.style.overflow = "hidden";

  var ov = document.createElement("div");
  ov.id = "__gate_overlay";
  ov.setAttribute(
    "style",
    [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "background:radial-gradient(1200px 700px at 50% -10%, #ffffff 0%, #eef3fb 60%, #e3eaf5 100%)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Malgun Gothic',sans-serif",
      "color:#172033",
    ].join(";")
  );

  ov.innerHTML =
    '<div style="width:min(92vw,380px);background:#ffffff;border:1px solid #dde4ef;border-radius:16px;padding:30px 26px 26px;box-shadow:0 24px 60px rgba(20,40,80,.12)">' +
      '<div style="font-size:34px;text-align:center;line-height:1">🔒</div>' +
      '<div style="text-align:center;margin-top:12px;font-size:19px;font-weight:700;letter-spacing:-.2px">개인 워크스페이스</div>' +
      '<div style="text-align:center;margin-top:8px;font-size:13px;color:#4f5b70;line-height:1.55">접근하려면 비밀번호가 필요합니다.</div>' +
      '<input id="__gate_input" type="password" autocomplete="off" placeholder="비밀번호 입력" ' +
        'style="width:100%;box-sizing:border-box;margin-top:18px;padding:13px 14px;font-size:15px;color:#172033;background:#f6f9fe;border:1px solid #c3cddc;border-radius:10px;outline:none">' +
      '<div id="__gate_err" style="height:18px;margin-top:8px;font-size:12.5px;color:#f0475a;text-align:center"></div>' +
      '<button id="__gate_btn" ' +
        'style="width:100%;margin-top:6px;padding:13px;font-size:15px;font-weight:700;color:#fff;background:#2563eb;border:0;border-radius:10px;cursor:pointer">입장</button>' +
    '</div>';

  function mount() {
    (document.body || docEl).appendChild(ov);
    var input = document.getElementById("__gate_input");
    var btn = document.getElementById("__gate_btn");
    var err = document.getElementById("__gate_err");
    if (input) input.focus();

    function fail() {
      err.textContent = "비밀번호가 올바르지 않습니다.";
      input.value = "";
      input.focus();
      ov.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-7px)" },
          { transform: "translateX(7px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 220 }
      );
    }

    function submit() {
      var val = input.value || "";
      if (!val) {
        input.focus();
        return;
      }
      err.textContent = "";
      sha256Hex(val).then(function (hex) {
        if (hex === GATE_HASH) {
          try {
            localStorage.setItem(STORE_KEY, GATE_HASH);
          } catch (e) {}
          docEl.style.overflow = prevOverflow;
          docEl.classList.remove("gate-locked");
          if (lockStyle.parentNode) lockStyle.parentNode.removeChild(lockStyle);
          ov.remove();
        } else {
          fail();
        }
      });
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
