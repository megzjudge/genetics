// Shared by /gene/[name] and /snp/[rsid] pages — gates personal alleles and
// notes behind the same AUTH password used by /admin.
// The password is remembered in localStorage so you don't re-enter it every visit.
(function () {
  const KEY = "geneticsPersonalAuth";

  function getToken() { return localStorage.getItem(KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); }

  async function fetchPersonal(params) {
    const token = getToken();
    if (!token) return { ok: false, reason: "signed-out" };
    const qs = new URLSearchParams(params).toString();
    try {
      const r = await fetch(`/api/personal?${qs}`, { headers: { Authorization: "Bearer " + token } });
      if (r.status === 401) { setToken(""); return { ok: false, reason: "bad-token" }; }
      if (!r.ok) return { ok: false, reason: "error" };
      const d = await r.json();
      return { ok: true, personal: d.personal };
    } catch (e) {
      return { ok: false, reason: "network" };
    }
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
      if (ok === false) alert("Incorrect password.");
    };
  }

  window.PersonalAuth = { getToken, setToken, fetchPersonal, wireSignIn };
})();
