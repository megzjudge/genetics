import { snpViz, chrFromMaploc } from "../lib/viz.js";

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
    <span>Megan Judge · <a href="/admin">Admin</a> · <button id="personal-signin" class="personal-signin-btn" style="font-family:var(--mono);font-size:inherit;color:var(--accent);background:none;border:none;padding:0;cursor:pointer;text-decoration:underline">Login</button> · <a href="https://github.com/megzjudge/genetics/" target="_blank" rel="noopener">Github</a></span>
    <div style="display:flex;gap:20px">
      <a href="https://hereditary.substack.com">Hereditary →</a>
      <a href="https://research.jdge.cc">Other Research Alerts →</a>
    </div>
  </div>
</footer>`;
}

export async function onRequestGet({ params, env }) {
  const rawRsid  = (params.rsid || "").toLowerCase();
  const rsid     = /^rs/i.test(rawRsid) ? rawRsid : "rs" + rawRsid;

  const [snp, freqsRes] = await Promise.all([
    env.genetic.prepare(
      `SELECT g.rsid, g.alleles, g.notes, g.gene_name, gi.full_name, gi.maplocation,
              si.chromosome, si.position, si.ref_allele, si.alt_allele,
              si.protein_change, si.consequence, si.summary
       FROM personal g
       LEFT JOIN genes gi ON gi.gene_name = g.gene_name
       LEFT JOIN snps si ON si.rsid = g.rsid
       WHERE g.rsid = ?`
    ).bind(rsid).first(),
    env.genetic.prepare(
      `SELECT * FROM snp_pop WHERE rsid = ?
       ORDER BY pop_type = 'Total' DESC, population ASC`
    ).bind(rsid).all(),
  ]);

  if (!snp) {
    const html404 = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(rsid)} not found | Megan Judge</title>
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
${nav()}
<main style="padding:80px 24px;text-align:center;max-width:560px;margin:0 auto">
  <h1 style="font-family:var(--serif);font-size:clamp(28px,4vw,44px);margin:0 0 14px">${esc(rsid)}</h1>
  <p style="color:var(--muted);margin:0 0 32px">This variant is not in the database yet.</p>
  <a href="/" class="btn-primary">Back to home</a>
</main>
${foot()}
</body></html>`;
    return new Response(html404, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const freqs      = freqsRes.results || [];
  const geneName   = snp.gene_name   || "";
  const maploc     = snp.maplocation || "";
  const chrNum     = snp.chromosome  || chrFromMaploc(maploc) || "";
  const refAllele  = snp.ref_allele  || null;
  const altAllele  = snp.alt_allele  || null;
  const protChange = snp.protein_change || null;

  const vizSvg = snpViz({
    chrNum,
    geneName,
    maploc,
    rsid,
    refAllele,
    altAllele,
    proteinChange: protChange,
  });

  const titleParts = [esc(rsid)];
  if (protChange)  titleParts.push(esc(protChange));
  if (geneName)    titleParts.push(esc(geneName));
  const pageTitle = titleParts.join(" · ");

  const descParts = [];
  if (geneName)           descParts.push(`${geneName} variant`);
  if (chrNum)             descParts.push(`chromosome ${chrNum}`);
  if (snp.consequence)    descParts.push(snp.consequence);
  const descMeta = esc(descParts.join(", ") || `${rsid} — variant data and population frequencies.`);

  // Frequency table rows
  const freqRows = freqs.map(f => {
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
      <a class="freq-link" href="https://www.ncbi.nlm.nih.gov/snp/${esc(rsid)}" target="_blank" rel="noopener" title="View on NCBI">↬</a>
    </div>`;
  }).join("");

  const geneSlug = geneName ? slugify(snp.full_name || geneName) : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle} | Megan Judge</title>
  <meta name="description" content="${descMeta}">
  <meta name="author" content="Megan Judge">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${BASE}/snp/${esc(rsid)}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${descMeta}">
  <meta property="og:url" content="${BASE}/snp/${esc(rsid)}">
  <meta property="og:type" content="article">
  <meta property="og:image" content="${BASE}/images/icon_full.png">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${pageTitle}">
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
        <a href="/">Home</a>${geneName
          ? ` / <a href="/gene/${esc(geneName)}">${esc(geneName)}</a>`
          : ""} / ${esc(rsid)}
      </nav>

      <div class="snp-viz-wrap" style="margin:24px 0 28px;border-radius:10px;overflow:hidden;line-height:0">
        ${vizSvg}
      </div>

      <h1 class="gene-title" style="font-size:clamp(22px,3vw,32px)">${esc(rsid)}${protChange ? ` <span style="font-family:var(--mono);font-size:0.6em;color:var(--muted);font-weight:400">${esc(protChange)}</span>` : ""}</h1>

      <div style="display:flex;flex-wrap:wrap;gap:18px;margin:12px 0 20px;font-family:var(--mono);font-size:12px;color:var(--muted)">
        ${geneName ? `<span>Gene: <a href="/gene/${esc(geneName)}" style="color:var(--accent)">${esc(geneName)}</a>${snp.full_name ? ` — ${esc(snp.full_name)}` : ""}</span>` : ""}
        ${chrNum   ? `<span>Chr ${esc(chrNum)}${snp.position ? ":" + esc(snp.position) : ""}</span>` : ""}
        ${maploc   ? `<span>${esc(maploc)}</span>` : ""}
        ${snp.consequence ? `<span>${esc(snp.consequence)}</span>` : ""}
      </div>

      <div data-personal-notes="${esc(rsid)}"></div>

      <div style="display:flex;gap:20px;font-family:var(--mono);font-size:11px;margin-top:8px">
        <a href="https://www.ncbi.nlm.nih.gov/snp/${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">NCBI ↗</a>
        <a href="https://www.snpedia.com/index.php/${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">SNPedia ↗</a>
        ${geneName ? `<a href="https://www.genecards.org/card/${esc(geneName)}?Search=${esc(rsid)}#Variants_Variants" target="_blank" rel="noopener" style="color:var(--accent)">GeneCards ↗</a>` : ""}
      </div>
    </div>
  </section>

  <div class="gene-body">
    <div class="gene-section">
      <h2 class="studies-heading">Population Frequencies<span class="section-count">${freqs.length}</span></h2>
      ${freqs.length === 0
        ? `<p class="empty-state">No frequency data stored yet.</p>`
        : `<div class="freq-table">${freqRows}</div>`}
    </div>
  </div>

</main>
${foot()}
<script src="/personal-auth.js"></script>
<script>
(function () {
  const rsid = ${JSON.stringify(rsid)};
  async function load() {
    const res = await PersonalAuth.fetchPersonal({ rsid });
    if (!res.ok) return false;
    const n = document.querySelector('[data-personal-notes="' + rsid + '"]');
    if (n && res.personal && res.personal.notes) {
      n.innerHTML = '<p class="gene-desc"></p>';
      n.firstChild.textContent = res.personal.notes;
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
