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
    Megan Judge
  </a>
  <nav class="nav-links">
    <a href="/basics">Basics</a>
    <a href="/group/folate-metabolism">Genes</a>
    <a href="https://research.jdge.cc" class="nav-external">Research →</a>
  </nav>
</header>`;
}

function foot() {
  return `<footer class="site-footer">
  <div class="footer-inner">
    <span>Megan Judge · Personal Genomics</span>
    <div style="display:flex;gap:20px">
      <a href="https://hereditary.substack.com">Hereditary →</a>
      <a href="https://research.jdge.cc">Research Alerts →</a>
    </div>
  </div>
</footer>`;
}

function formatDate(str) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export async function onRequestGet({ params, env }) {
  const geneName = (params.name || "").toUpperCase();

  const [info, groupsRes, studiesRes, alertsRes, snpsRes] = await Promise.all([
    env.genetic.prepare(`SELECT * FROM gene_info WHERE gene_name = ?`).bind(geneName).first(),
    env.genetic.prepare(`
      SELECT tg.id, tg.name FROM topic_groups tg
      JOIN gene_groups gg ON tg.id = gg.group_id
      WHERE gg.gene_name = ?
    `).bind(geneName).all(),
    env.genetic.prepare(`
      SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC, created_at DESC
    `).bind(geneName).all(),
    env.genetic.prepare(`
      SELECT * FROM email_alerts WHERE gene_name = ? ORDER BY received_at DESC
    `).bind(geneName).all(),
    env.genetic.prepare(`
      SELECT * FROM genes WHERE gene_name = ? ORDER BY magnitude IS NULL, magnitude DESC
    `).bind(geneName).all(),
  ]);

  if (!info) {
    const html404 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gene not found | Megan Judge</title>
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${nav()}
<main style="padding:80px 24px;text-align:center;max-width:560px;margin:0 auto">
  <h1 style="font-family:var(--serif);font-size:clamp(28px,4vw,44px);margin:0 0 14px">${esc(geneName)}</h1>
  <p style="color:var(--muted);margin:0 0 32px">This gene is not in the database yet.</p>
  <a href="/" class="btn-primary">Back to home</a>
</main>
${foot()}
</body></html>`;
    return new Response(html404, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const groups  = groupsRes.results  || [];
  const studies = studiesRes.results  || [];
  const alerts  = alertsRes.results   || [];
  const snps    = snpsRes.results     || [];
  const unread  = alerts.filter(a => a.read === 0).length;

  const primaryGroup = groups[0] || null;
  const groupSlug    = primaryGroup ? slugify(primaryGroup.name) : "";
  const descMeta     = esc(info.description || `${geneName} — curated research and Scholar alerts.`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(geneName)} — ${esc(info.full_name)} | Megan Judge</title>
  <meta name="description" content="${descMeta}">
  <meta name="author" content="Megan Judge">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE}/gene/${esc(geneName)}">
  <meta property="og:title" content="${esc(geneName)} — ${esc(info.full_name)}">
  <meta property="og:description" content="${descMeta}">
  <meta property="og:url" content="${BASE}/gene/${esc(geneName)}">
  <meta property="og:type" content="article">
  <meta property="og:image" content="${BASE}/images/icon_full.png">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(geneName)} — ${esc(info.full_name)}">
  <meta name="twitter:image" content="${BASE}/images/icon_full.png">
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${nav()}
<main>

  <section class="gene-header">
    <div class="gene-header-inner">
      <nav class="gene-breadcrumb" aria-label="breadcrumb">
        <a href="/">Home</a>${primaryGroup
          ? ` / <a href="/group/${groupSlug}">${esc(primaryGroup.name)}</a>`
          : ""} / ${esc(geneName)}
      </nav>
      <h1 class="gene-title">${esc(geneName)}</h1>
      <p class="gene-fullname">${esc(info.full_name)}</p>
      ${info.description ? `<p class="gene-desc">${esc(info.description)}</p>` : ""}
      ${groups.length > 0 ? `<div class="gene-tags">${
        groups.map(g => `<a class="gene-tag" href="/group/${slugify(g.name)}">${esc(g.name)}</a>`).join("")
      }</div>` : ""}
    </div>
  </section>

  <div class="gene-body">

    <div class="gene-section">
      <h2 class="studies-heading">My Variants<span class="section-count">${snps.length}</span></h2>
      ${snps.length === 0
        ? `<p class="empty-state">No variant data entered yet.</p>`
        : `<div class="snp-table-wrap"><table class="snp-table">
          <thead><tr>
            <th>rsID</th><th>Genotype</th><th>Chr</th><th>Magnitude</th><th>Status</th><th>Notes</th>
          </tr></thead>
          <tbody>${snps.map(s => `<tr>
            <td><a class="rsid-link" href="https://www.ncbi.nlm.nih.gov/snp/${esc(s.rsid)}" target="_blank" rel="noopener">${esc(s.rsid)}</a></td>
            <td class="snp-genotype">${esc(s.genotype || "—")}</td>
            <td>${esc(s.chromosome || "—")}</td>
            <td>${s.magnitude != null ? s.magnitude : "—"}</td>
            <td><span class="snp-status snp-status--${esc(s.status || "pending")}">${esc(s.status || "pending")}</span></td>
            <td class="snp-notes">${esc(s.notes || "")}</td>
          </tr>`).join("")}</tbody>
        </table></div>`}
    </div>

    <div class="studies-section gene-section">
      <h2 class="studies-heading">Curated Studies<span class="section-count">${studies.length}</span></h2>
      ${studies.length === 0
        ? `<p class="empty-state">No studies added yet.</p>`
        : studies.map(s => `<div class="study-card">
          ${s.snippet ? `<blockquote class="study-snippet">${esc(s.snippet)}</blockquote>` : ""}
          <p class="study-meta">${[
            s.authors ? esc(s.authors) : null,
            s.year    ? esc(String(s.year)) : null,
            s.title   ? (s.url
              ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`
              : esc(s.title)) : null,
            s.doi     ? `<a href="https://doi.org/${esc(s.doi)}" target="_blank" rel="noopener">DOI</a>` : null,
          ].filter(Boolean).join(" · ")}</p>
        </div>`).join("")}
    </div>

    <div class="alerts-section gene-section">
      <h2 class="studies-heading">Scholar Alerts${
        unread > 0 ? `<span class="unread-tag">${unread} new</span>` : ""
      }<span class="section-count">${alerts.length}</span></h2>
      ${alerts.length === 0
        ? `<p class="empty-state">No alerts received yet.</p>`
        : alerts.map(a => `<div class="alert-card${a.read === 0 ? " unread" : ""}">
          <p class="alert-title">
            ${a.read === 0 ? `<span class="unread-dot"></span>` : ""}
            ${a.link
              ? `<a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title || "Untitled")}</a>`
              : esc(a.title || "Untitled")}
          </p>
          ${a.authors ? `<p class="alert-authors">${esc(a.authors)}</p>` : ""}
          ${a.snippet ? `<p class="alert-snippet">${esc(a.snippet)}</p>` : ""}
          <div class="alert-foot">
            <span>${esc(a.gene_name)}${a.rsid ? ` · ${esc(a.rsid)}` : ""}</span>
            <span>${formatDate(a.received_at)}</span>
          </div>
        </div>`).join("")}
    </div>

  </div>
</main>
${foot()}
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
