import { nav, foot } from "../lib/layout.js";

const BASE = "https://genetics.jdge.cc";

function esc(str) {
  return (str == null ? "" : String(str))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function onRequestGet({ params, env }) {
  const slug = (params.slug || "").toLowerCase();

  const allDiseasesRes = await env.genetic.prepare(`SELECT * FROM diseases`).all();
  const disease = (allDiseasesRes.results || []).find(d => slugify(d.name) === slug);

  if (!disease) {
    return new Response("Disease not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const snpsRes = await env.genetic.prepare(`
    SELECT
      p.rsid,
      p.gene_name,
      gi.full_name,
      COUNT(DISTINCT s.id) AS study_count,
      (SELECT COUNT(*) FROM studies s2
       WHERE s2.rsid = p.rsid AND s2.used IS NULL) AS unread_count
    FROM personal p
    JOIN snp_diseases sd ON sd.rsid = p.rsid
    LEFT JOIN genes gi ON gi.gene_name = p.gene_name
    LEFT JOIN studies s ON s.rsid = p.rsid
    WHERE sd.disease_id = ?
    GROUP BY p.rsid, p.gene_name, gi.full_name
    ORDER BY p.gene_name ASC, p.rsid ASC
  `).bind(disease.id).all();

  const snps        = snpsRes.results || [];
  const totalStudies = snps.reduce((n, s) => n + (s.study_count || 0), 0);
  const totalUnread  = snps.reduce((n, s) => n + (s.unread_count || 0), 0);
  const descMeta  = esc(disease.description || `${disease.name} — curated genetics research.`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(disease.name)} | Megan Judge Personal Genomics</title>
  <meta name="description" content="${descMeta}">
  <meta name="author" content="Megan Judge">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE}/disease/${esc(slug)}">
  <meta property="og:title" content="${esc(disease.name)} | Megan Judge">
  <meta property="og:description" content="${descMeta}">
  <meta property="og:url" content="${BASE}/disease/${esc(slug)}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${BASE}/images/icon_full.png">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${esc(disease.name)} | Megan Judge">
  <meta name="twitter:image" content="${BASE}/images/icon_full.png">
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
  <script src="/theme.js"></script>
</head>
<body>
${nav()}
<main>

  <section class="group-header">
    <div class="group-header-inner">
      <nav class="gene-breadcrumb" aria-label="breadcrumb">
        <a href="/">Home</a> / <a href="/groups">Diseases</a> / ${esc(disease.name)}
      </nav>
      <h1 class="group-page-title">${esc(disease.name)}</h1>
      ${disease.description ? `<p class="group-page-desc">${esc(disease.description)}</p>` : ""}
      <p class="group-stats">
        <span class="group-stats-num">${snps.length}</span> SNP${snps.length === 1 ? "" : "s"} ·
        <span class="group-stats-num">${totalStudies}</span> ${totalStudies === 1 ? "study" : "studies"}
        ${totalUnread > 0 ? ` · <span class="unread-tag">${totalUnread} new</span>` : ""}
      </p>
    </div>
  </section>

  <div class="group-body">
    <div class="gene-list">
      ${snps.length === 0
        ? `<p class="empty-state">No SNPs linked to this disease yet.</p>`
        : snps.map(s => {
            const countParts = [];
            if (s.study_count > 0) countParts.push(`<span class="count-num">${s.study_count}</span> ${s.study_count === 1 ? "study" : "studies"}`);
            if (s.unread_count > 0) countParts.push(`<span class="unread-tag">${s.unread_count} new</span>`);
            return `<a class="gene-row" href="/snp/${esc(s.rsid)}">
        <span class="gene-row-name">${esc(s.rsid)}</span>
        <span class="gene-row-full">${esc(s.gene_name)}${s.full_name ? " — " + esc(s.full_name) : ""}</span>
        <span class="gene-row-count">${countParts.join(" · ") || "—"}</span>
      </a>`;
          }).join("")}
    </div>
  </div>

</main>
${foot()}
<script src="/personal-auth.js"></script>
<script>
  PersonalAuth.wireSignIn("personal-signin", async function () {
    var res = await PersonalAuth.fetchPersonal({ gene: "__ping__" });
    return res.ok;
  });
</script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
