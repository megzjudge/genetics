// Shared by /gene/[name] and /snp/[rsid] pages — gates personal alleles and
// notes behind the same AUTH password used by /admin.
// The password is remembered in localStorage so you don't re-enter it every visit.
(function () {
  const KEY = "geneticsPersonalAuth";

  function getToken() { return localStorage.getItem(KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); }

  let lastFailReason = null;

  async function fetchPersonal(params) {
    const token = getToken();
    if (!token) { lastFailReason = "signed-out"; return { ok: false, reason: "signed-out" }; }
    const qs = new URLSearchParams(params).toString();
    try {
      const r = await fetch(`/api/personal?${qs}`, { headers: { Authorization: "Bearer " + token } });
      if (r.status === 429) { lastFailReason = "rate-limited"; return { ok: false, reason: "rate-limited" }; }
      if (r.status === 401) { setToken(""); lastFailReason = "bad-token"; return { ok: false, reason: "bad-token" }; }
      if (!r.ok) { lastFailReason = "error"; return { ok: false, reason: "error" }; }
      const d = await r.json();
      lastFailReason = null;
      return { ok: true, personal: d.personal };
    } catch (e) {
      lastFailReason = "network";
      return { ok: false, reason: "network" };
    }
  }

  // Small styled red popup — used for the rate-limit case since a native
  // alert() can't be colored.
  function showRedToast(msg) {
    let el = document.getElementById("personal-auth-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "personal-auth-toast";
      el.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);"
        + "background:#2a1418;border:1px solid #f87171;color:#f87171;font-family:monospace;"
        + "font-size:14px;padding:12px 20px;border-radius:6px;z-index:9999;"
        + "box-shadow:0 4px 16px rgba(0,0,0,.4)";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = "none"; }, 4000);
  }

  // Wires the footer "Login" button: prompts for the password, stores it, re-runs
  // `onSuccess` (expected to return true/false). Alerts on a wrong password, since
  // the button itself no longer changes state to signal success/failure.
  function wireSignIn(btnId, onSuccess) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = async () => {
      const pw = prompt("Password:");
      if (!pw) return;
      setToken(pw);
      const ok = await onSuccess();
      if (ok === false) {
        if (lastFailReason === "rate-limited") showRedToast("Sowee, my bad, pwease dont");
        else alert("Incorrect password.");
      }
    };
  }

  window.PersonalAuth = { getToken, setToken, fetchPersonal, wireSignIn };
})();
