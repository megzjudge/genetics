import { geneViz, chrFromMaploc } from "../lib/viz.js";
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
  const geneName = (params.name || "").toUpperCase();

  const [info, groupsRes, studiesRes, snpsRes] = await Promise.all([
    env.genetic.prepare(`SELECT * FROM genes WHERE gene_name = ?`).bind(geneName).first(),
    env.genetic.prepare(`
      SELECT tg.id, tg.name FROM topics tg
      JOIN gene_topics gg ON tg.id = gg.group_id
      WHERE gg.gene_name = ?
    `).bind(geneName).all(),
    env.genetic.prepare(`
      SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC, created_at DESC
    `).bind(geneName).all(),
    env.genetic.prepare(`
      SELECT g.rsid, g.alleles, g.notes, g.gene_name,
             si.chromosome, si.position, si.consequence,
             si.ref_allele, si.alt_allele, si.protein_change, si.summary
      FROM personal g LEFT JOIN snps si ON si.rsid = g.rsid
      WHERE g.gene_name = ?
      ORDER BY g.rsid ASC
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
  const snps    = snpsRes.results     || [];

  const primaryGroup = groups[0] || null;
  const groupSlug    = primaryGroup ? slugify(primaryGroup.name) : "";
  const descMeta     = esc(info.description || `${geneName} — SNPs, population frequencies, and curated research.`);

  const maploc  = info.maplocation || "";
  const chrNum  = chrFromMaploc(maploc) || snps[0]?.chromosome || null;
  const vizSvg  = (chrNum || maploc) ? geneViz({ chrNum, geneName, maploc }) : null;

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
    <div class="gene-header-inner" style="${vizSvg ? "display:flex;gap:40px;align-items:center" : ""}">
      <div${vizSvg ? ' style="flex:1;min-width:0"' : ""}>
        <nav class="gene-breadcrumb" aria-label="breadcrumb">
          <a href="/">Home</a> / <a href="/groups">Groups</a>${primaryGroup
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
      ${vizSvg ? `<div style="flex-shrink:0;width:250px;max-width:100%">${vizSvg}</div>` : ""}
    </div>
  </section>

  <div class="gene-body">

    <div class="gene-section">
      <h2 class="studies-heading">SNPs<span class="section-count">${snps.length}</span></h2>
      <p style="font-size:13px;color:var(--muted);margin:-8px 0 20px">These are a select few set of SNPs chosen to research within ${esc(geneName)}${primaryGroup ? ` to do with the area ${esc(primaryGroup.name)}` : ""}.</p>
      ${snps.length === 0
        ? `<p class="empty-state">No variant data entered yet.</p>`
        : snps.map(s => {
            const snpStudies = studies.filter(st => st.rsid === s.rsid);
            return `<a class="snp-row snp-row--link" href="/snp/${esc(s.rsid)}">
              <span class="rsid-link">${esc(s.rsid)}</span>
              <span class="snp-genotype" data-personal-alleles="${esc(s.rsid)}"></span>
              ${snpStudies.length ? `<span class="snp-meta-item">${snpStudies.length} ${snpStudies.length === 1 ? "study" : "studies"}</span>` : ""}
            </a>`;
          }).join("")}
    </div>

  </div>
</main>
${foot()}
<script src="/personal-auth.js"></script>
<script>
(function () {
  const geneName = ${JSON.stringify(geneName)};
  async function load() {
    const res = await PersonalAuth.fetchPersonal({ gene: geneName });
    if (!res.ok) return false;
    for (const p of (res.personal || [])) {
      const a = document.querySelector('[data-personal-alleles="' + p.rsid + '"]');
      if (a) a.textContent = p.alleles || "—";
    }
    return true;
  }
  PersonalAuth.wireSignIn("personal-signin", load);
  load();
})();
</script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
