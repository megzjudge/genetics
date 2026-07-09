// Shared header/footer for all Cloudflare Function pages (gene, snp, group,
// groups) — edit once here rather than in every page file.

export function nav() {
  return `<header class="site-nav">
  <a class="nav-brand" href="/">
    <img class="nav-icon" src="/images/icon.png" alt="Genetics" width="26" height="26">
    Genetics Research
  </a>
  <nav class="nav-links">
    <a href="/basics">Basics</a>
    <a href="/groups">Genes</a>
    <a href="/databases">Databases</a>
  </nav>
</header>`;
}

export function foot() {
  return `<footer class="site-footer">
  <div class="footer-inner">
    <span>Megan Judge · <a href="/admin">Admin</a> · <button id="personal-signin" class="personal-signin-btn">Login</button> · <a href="https://github.com/megzjudge/genetics/" target="_blank" rel="noopener">Github</a></span>
    <div style="display:flex;gap:20px">
      <a href="https://hereditary.substack.com">Hereditary →</a>
      <a href="https://research.jdge.cc">Other Research Alerts →</a>
    </div>
  </div>
</footer>`;
}
