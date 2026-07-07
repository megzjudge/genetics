// Shared by /gene/[name] and /snp/[rsid] pages — gates "My Variants" alleles
// and notes (personal data) behind the same AUTH password used by /admin.
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

  function signInLinkHtml(id) {
    return `<button id="${id}" class="personal-signin-btn" style="font-family:var(--mono);font-size:11px;color:var(--accent);background:none;border:1px solid var(--line);border-radius:3px;padding:3px 10px;cursor:pointer">Sign in to view</button>`;
  }

  // Wires a "Sign in" button: prompts for the password, stores it, re-runs `onSuccess`.
  // If the password is wrong, onSuccess's own fetch will 401 and clear the token again.
  function wireSignIn(btnId, onSuccess) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = async () => {
      const pw = prompt("Password:");
      if (!pw) return;
      setToken(pw);
      await onSuccess();
    };
  }

  window.PersonalAuth = { getToken, setToken, fetchPersonal, signInLinkHtml, wireSignIn };
})();
