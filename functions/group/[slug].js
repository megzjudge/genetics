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
    <span>Megan Judge · <a href="https://github.com/megzjudge/genetics/" target="_blank" rel="noopener">Github</a></span>
    <div style="display:flex;gap:20px">
      <a href="https://hereditary.substack.com">Hereditary →</a>
      <a href="https://research.jdge.cc">Other Research Alerts →</a>
    </div>
  </div>
</footer>`;
}

export async function onRequestGet({ params, env }) {
  const slug = (params.slug || "").toLowerCase();

  const allGroupsRes = await env.genetic.prepare(`SELECT * FROM topics`).all();
  const group = (allGroupsRes.results || []).find(g => slugify(g.name) === slug);

  if (!group) {
    return new Response("Group not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const genesRes = await env.genetic.prepare(`
    SELECT
      gi.gene_name,
      gi.full_name,
      COUNT(DISTINCT s.id)                                  AS study_count,
      COUNT(DISTINCT ea.id)                                 AS alert_count,
      SUM(CASE WHEN ea.read = 0 THEN 1 ELSE 0 END)         AS unread_count
    FROM genes gi
    JOIN gene_topics gg ON gi.gene_name = gg.gene_name
    LEFT JOIN studies s     ON gi.gene_name = s.gene_name
    LEFT JOIN email_alerts ea ON gi.gene_name = ea.gene_name
    WHERE gg.group_id = ?
    GROUP BY gi.gene_name, gi.full_name
    ORDER BY gi.gene_name ASC
  `).bind(group.id).all();

  const genes     = genesRes.results || [];
  const totalStudies = genes.reduce((n, g) => n + (g.study_count || 0), 0);
  const totalUnread  = genes.reduce((n, g) => n + (g.unread_count || 0), 0);
  const descMeta  = esc(group.description || `${group.name} — curated genetics research.`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(group.name)} | Megan Judge Personal Genomics</title>
  <meta name="description" content="${descMeta}">
  <meta name="author" content="Megan Judge">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE}/group/${esc(slug)}">
  <meta property="og:title" content="${esc(group.name)} | Megan Judge">
  <meta property="og:description" content="${descMeta}">
  <meta property="og:url" content="${BASE}/group/${esc(slug)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${BASE}/images/icon_full.png">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(group.name)} | Megan Judge">
  <meta name="twitter:image" content="${BASE}/images/icon_full.png">
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${nav()}
<main>

  <section class="group-header">
    <div class="group-header-inner">
      <nav class="gene-breadcrumb" aria-label="breadcrumb">
        <a href="/">Home</a> / <a href="/groups">Groups</a> / ${esc(group.name)}
      </nav>
      <h1 class="group-page-title">${esc(group.name)}</h1>
      ${group.description ? `<p class="group-page-desc">${esc(group.description)}</p>` : ""}
      <p class="group-stats">
        ${genes.length} genes ·
        ${totalStudies} ${totalStudies === 1 ? "study" : "studies"}
        ${totalUnread > 0 ? ` · <span class="unread-tag">${totalUnread} new alerts</span>` : ""}
      </p>
    </div>
  </section>

  <div class="group-body">
    <div class="gene-list">
      ${genes.length === 0
        ? `<p class="empty-state">No genes in this group yet.</p>`
        : genes.map(g => {
            const countParts = [];
            if (g.study_count > 0) countParts.push(`${g.study_count} ${g.study_count === 1 ? "study" : "studies"}`);
            if (g.unread_count > 0) countParts.push(`<span class="unread-tag">${g.unread_count} new</span>`);
            return `<a class="gene-row" href="/gene/${esc(g.gene_name)}">
        <span class="gene-row-name">${esc(g.gene_name)}</span>
        <span class="gene-row-full">${esc(g.full_name || "")}</span>
        <span class="gene-row-count">${countParts.join(" · ") || "—"}</span>
      </a>`;
          }).join("")}
    </div>
  </div>

</main>
${foot()}
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
