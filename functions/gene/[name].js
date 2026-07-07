import { geneViz, chrFromMaploc } from "../lib/viz.js";

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
    <a href="/group/folate-metabolism">Genes</a>
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

function formatDate(str) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export async function onRequestGet({ params, env }) {
  const geneName = (params.name || "").toUpperCase();

  const [info, groupsRes, studiesRes, alertsRes, snpsRes] = await Promise.all([
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
      SELECT * FROM email_alerts WHERE gene_name = ? ORDER BY received_at DESC
    `).bind(geneName).all(),
    env.genetic.prepare(`
      SELECT g.rsid, g.alleles, g.notes, g.gene_name,
             si.chromosome, si.position, si.consequence,
             si.ref_allele, si.alt_allele, si.protein_change, si.summary,
             (
        SELECT json_group_array(json_object(
          'population', f.population, 'pop_type', f.pop_type,
          'sample_size', f.sample_size,
          'allele1', f.allele1, 'allele1_freq', f.allele1_freq,
          'allele2', f.allele2, 'allele2_freq', f.allele2_freq,
          'geno_hom1', f.geno_hom1, 'geno_het', f.geno_het, 'geno_hom2', f.geno_hom2
        ))
        FROM snp_pop f WHERE f.rsid = g.rsid
        ORDER BY f.pop_type = 'Total' DESC, f.population ASC
      ) AS freq_json
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
  const alerts  = alertsRes.results   || [];
  const snps    = snpsRes.results     || [];
  const unread  = alerts.filter(a => a.read === 0).length;

  const primaryGroup = groups[0] || null;
  const groupSlug    = primaryGroup ? slugify(primaryGroup.name) : "";
  const descMeta     = esc(info.description || `${geneName} — curated research and Scholar alerts.`);

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
    <div class="gene-header-inner" style="${vizSvg ? "display:flex;gap:40px;align-items:flex-start" : ""}">
      <div${vizSvg ? ' style="flex:1;min-width:0"' : ""}>
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
      ${vizSvg ? `<div style="flex-shrink:0;width:170px;margin-top:8px">${vizSvg}</div>` : ""}
    </div>
  </section>

  <div class="gene-body">

    <div class="gene-section">
      <h2 class="studies-heading">
        My Variants<span class="section-count">${snps.length}</span>
        <button id="personal-signin" class="personal-signin-btn" style="display:none;font-family:var(--mono);font-size:11px;color:var(--accent);background:none;border:1px solid var(--line);border-radius:3px;padding:3px 10px;cursor:pointer;margin-left:10px">Sign in to view</button>
      </h2>
      ${snps.length === 0
        ? `<p class="empty-state">No variant data entered yet.</p>`
        : snps.map(s => {
            const freqs = (() => { try { return JSON.parse(s.freq_json || "[]"); } catch(e) { return []; } })();
            const a1 = freqs[0]?.allele1 || "";
            const a2 = freqs[0]?.allele2 || "";
            return `<div class="snp-block">
          <div class="snp-row">
            <a class="rsid-link" href="/snp/${esc(s.rsid)}">${esc(s.rsid)}</a>
            <span class="snp-genotype" data-personal-alleles="${esc(s.rsid)}">···</span>
            ${s.chromosome ? `<span class="snp-meta-item">Chr ${esc(s.chromosome)}${s.position ? ":" + esc(s.position) : ""}</span>` : ""}
          </div>
          <div data-personal-notes="${esc(s.rsid)}"></div>
          ${freqs.length > 0 ? `<div class="freq-table">
            ${freqs.map(f => {
              const fa1 = f.allele1 || "?", fa2 = f.allele2 || "?";
              const a1pct = f.allele1_freq != null ? Math.round(f.allele1_freq * 100) + "%" : null;
              const a2pct = f.allele2_freq != null ? Math.round(f.allele2_freq * 100) + "%" : null;
              const hom1  = f.geno_hom1 != null ? Math.round(f.geno_hom1 * 100) + "%" : null;
              const het   = f.geno_het  != null ? Math.round(f.geno_het  * 100) + "%" : null;
              const hom2  = f.geno_hom2 != null ? Math.round(f.geno_hom2 * 100) + "%" : null;
              const allelePart = (a1pct && a2pct) ? `${fa1} ${a1pct} / ${fa2} ${a2pct}` : "";
              const genoPart   = (hom1 && het && hom2) ? `${fa1+fa1} ${hom1} / ${fa1+fa2}&amp;${fa2+fa1} ${het} / ${fa2+fa2} ${hom2}` : "";
              const nPart      = f.sample_size ? `n=${Number(f.sample_size).toLocaleString()}` : "";
              return `<div class="freq-row${f.pop_type === "Total" ? " freq-row--total" : ""}">
                <span class="freq-pop">${esc(f.population)}</span>
                <span class="freq-data">${[allelePart, genoPart, nPart].filter(Boolean).join(" | ")}</span>
                <a class="freq-link" href="https://www.ncbi.nlm.nih.gov/snp/${esc(s.rsid)}" target="_blank" rel="noopener" title="View on NCBI">↬</a>
              </div>`;
            }).join("")}
          </div>` : ""}
        </div>`;
          }).join("")}
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
<script src="/personal-auth.js"></script>
<script>
(function () {
  const geneName = ${JSON.stringify(geneName)};
  async function load() {
    const res = await PersonalAuth.fetchPersonal({ gene: geneName });
    const btn = document.getElementById("personal-signin");
    if (!res.ok) { btn.style.display = "inline-block"; return; }
    btn.style.display = "none";
    for (const p of (res.personal || [])) {
      const a = document.querySelector('[data-personal-alleles="' + p.rsid + '"]');
      if (a) a.textContent = p.alleles || "—";
      const n = document.querySelector('[data-personal-notes="' + p.rsid + '"]');
      if (n && p.notes) n.innerHTML = '<p class="snp-notes"></p>';
      if (n && p.notes) n.firstChild.textContent = p.notes;
    }
  }
  PersonalAuth.wireSignIn("personal-signin", load);
  load();
})();
</script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
