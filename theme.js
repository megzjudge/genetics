// Light/dark theme toggle, shared by every page. Loaded synchronously
// (no defer/async) right after styles.css in <head> so the theme is set
// before the page paints — avoids a flash of the wrong theme.
(function () {
  const KEY = "geneticsTheme";

  function getStored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setStored(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
  }
  function preferredTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light" : "dark";
  }
  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  apply(getStored() || preferredTheme());

  // Event delegation on document, not the button directly — this script
  // runs in <head> before the nav (and its #theme-toggle button) exists.
  document.addEventListener("click", function (e) {
    const btn = e.target.closest("#theme-toggle");
    if (!btn) return;
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    apply(next);
    setStored(next);
  });
})();
