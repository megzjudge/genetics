const BASE = "https://genetics.jdge.cc";

function esc(str) {
  return (str == null ? "" : String(str))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nav() {
  return `<header class="site-nav">
  <a class="nav-brand" href="/">
    <img class="nav-icon" src="/images/icon.png" alt="Genetics" width="26" height="26">
    Genetics Research
  </a>
  <nav class="nav-links">
    <a href="/basics">Basics</a>
    <a href="/groups">Genes</a>
  </nav>
</header>`;
}

function foot() {
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

export async function onRequestGet({ env }) {
  const { results } = await env.genetic.prepare(`
    SELECT tg.id, tg.name, tg.description,
           COUNT(DISTINCT gg.gene_name) AS gene_count
    FROM topics tg
    LEFT JOIN gene_topics gg ON gg.group_id = tg.id
    GROUP BY tg.id
    ORDER BY tg.name ASC
  `).all();
  const groups = results || [];
  const descMeta = "Every research area on this site — pick one to browse its genes.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Research Areas | Megan Judge</title>
  <meta name="description" content="${esc(descMeta)}">
  <meta name="author" content="Megan Judge">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE}/groups">
  <meta property="og:title" content="Research Areas | Megan Judge">
  <meta property="og:description" content="${esc(descMeta)}">
  <meta property="og:url" content="${BASE}/groups">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${BASE}/images/icon_full.png">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Research Areas | Megan Judge">
  <meta name="twitter:image" content="${BASE}/images/icon_full.png">
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${nav()}
<main>

  <section class="basics-hero">
    <div class="basics-hero-inner">
      <p class="hero-eyebrow">Browse</p>
      <h1 style="font-size:clamp(32px,5vw,54px);font-weight:700;letter-spacing:-0.03em;line-height:1.1;margin:0 0 18px">
        Research Areas
      </h1>
      <p style="font-size:clamp(15px,2vw,18px);color:var(--muted);max-width:560px;margin:0 auto;line-height:1.6">
        ${groups.length} area${groups.length === 1 ? "" : "s"} of research, each grouping the genes relevant to it.
      </p>
    </div>
  </section>

  <section class="groups-section" style="border-bottom:none">
    <div class="groups-inner">
      ${groups.length === 0
        ? `<p class="empty-state">No research areas yet.</p>`
        : `<div class="groups-grid">
      ${groups.map(g => `<div class="group-card">
        <a class="group-card-text" href="/group/${esc(slugify(g.name))}">
          <div class="group-card-head">
            <span class="group-name">${esc(g.name)}</span>
            <span class="group-count">${g.gene_count} gene${g.gene_count === 1 ? "" : "s"}</span>
          </div>
          ${g.description ? `<p class="group-desc">${esc(g.description)}</p>` : ""}
          <span class="group-link">Explore →</span>
        </a>
      </div>`).join("")}
      </div>`}
    </div>
  </section>

</main>
${foot()}
<script src="/personal-auth.js"></script>
<script>PersonalAuth.wireSignIn("personal-signin", () => true);</script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
