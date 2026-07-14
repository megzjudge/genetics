import { snpViz, chrFromMaploc } from "../lib/viz.js";
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

// Math.round(x*100) rounds anything under 0.5% down to a flat "0%" — for a
// Show the raw fraction exactly as pulled from NCBI (e.g. 0.000119) — no
// ×100 conversion, no rounding. Only trims meaningless trailing zeros
// (0.561860 -> 0.56186), never touches significant digits.
function fmtFreq(n) {
  if (n == null) return null;
  let s = n.toFixed(6);
  s = s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return s;
}

// PID = persistent identifier (umbrella term for DOI, Handle/HDL, etc.)
function pidUrl(pid) {
  if (!pid) return null;
  return /^10\.\d{4,9}\//.test(pid) ? `https://doi.org/${pid}` : `https://hdl.handle.net/${pid}`;
}

// Plain-English definitions for NCBI/Sequence Ontology consequence terms,
// keyed lowercase for case-insensitive lookup.
const CONSEQUENCE_INFO = {
  "missense variant": "Changes one amino acid in the protein for another. May or may not affect how the protein works.",
  "synonymous variant": "Changes the DNA but not the resulting amino acid — the protein is unaffected.",
  "nonsense variant": "Creates a premature stop signal, cutting the protein short. Usually damaging.",
  "stop gained": "Creates a premature stop signal, cutting the protein short. Usually damaging.",
  "stop lost": "Removes the normal stop signal, so the protein keeps being built past where it should end.",
  "start lost": "Destroys the site where protein-building normally begins, usually blocking normal production.",
  "frameshift variant": "Inserts or deletes DNA in a way that shifts the reading frame, scrambling everything downstream. Usually damaging.",
  "inframe insertion": "Adds extra amino acids to the protein without disrupting the reading frame.",
  "inframe deletion": "Removes amino acids from the protein without disrupting the reading frame.",
  "intron variant": "Falls within an intron — a non-coding section that gets spliced out before the protein is made. Usually has little effect.",
  "splice donor variant": "Falls at the start of an intron, right where splicing begins — can disrupt how the gene is spliced together.",
  "splice acceptor variant": "Falls at the end of an intron, right where splicing ends — can disrupt how the gene is spliced together.",
  "splice region variant": "Falls near a splice site and may subtly affect splicing.",
  "5 prime utr variant": "Falls in the region before the coding sequence starts — can affect how efficiently the protein is produced.",
  "3 prime utr variant": "Falls in the region after the coding sequence ends — can affect mRNA stability or regulation.",
  "coding sequence variant": "Falls within the protein-coding region; exact effect depends on additional details.",
  "non coding transcript variant": "Falls within a gene that doesn't code for protein — affects a functional RNA instead.",
  "upstream gene variant": "Falls just before the gene starts — may affect regulation but doesn't change the protein.",
  "downstream gene variant": "Falls just after the gene ends — may affect regulation but doesn't change the protein.",
  "intergenic variant": "Falls between genes, not inside any known gene.",
  "regulatory region variant": "Falls in a region known to help control gene activity, such as a promoter or enhancer.",
  "tf binding site variant": "Falls within a site where a transcription factor protein normally binds to help control the gene.",
  "genic downstream transcript variant": "Falls just after a transcript ends — may affect regulation but doesn't change the protein.",
  "genic upstream transcript variant": "Falls just before a transcript starts — may affect regulation but doesn't change the protein.",
};

// Wraps a consequence string with a hover tooltip explaining what it means,
// when a definition is known. Falls back to plain text otherwise.
function consequenceSpan(consequence) {
  const def = CONSEQUENCE_INFO[consequence.toLowerCase()];
  if (!def) return `<span>${esc(consequence)}</span>`;
  return `<span class="tooltip" tabindex="0" data-tooltip="${esc(def)}">${esc(consequence)}</span>`;
}

function studyCard(s, extraClass) {
  return `<div class="study-card${extraClass ? " " + extraClass : ""}">
          <button class="study-edit-btn" data-study-edit style="display:none" title="Edit" onclick="window.toggleStudyEdit(${s.id})">✎</button>
          <div class="study-view" data-study-view="${s.id}">
          ${s.title ? `<p class="study-title">${s.url
              ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`
              : esc(s.title)}</p>` : ""}
          <p class="study-meta">${[
            s.pid     ? `<a href="${esc(pidUrl(s.pid))}" target="_blank" rel="noopener">PID</a>` : null,
            s.authors ? esc(s.authors) : null,
            s.year    ? esc(String(s.year)) : null,
          ].filter(Boolean).join(" · ")}</p>
          ${s.snippet ? `<blockquote class="study-snippet">${esc(s.snippet)}</blockquote>` : ""}
          <div class="study-assign" data-study-assign style="display:none">
            <label for="study-used-${s.id}">Move to</label>
            <select id="study-used-${s.id}" onchange="window.assignStudy(${s.id},this.value)">
              <option value=""  ${s.used == null ? "selected" : ""}>New</option>
              <option value="1" ${s.used === 1   ? "selected" : ""}>Curated</option>
              <option value="0" ${s.used === 0   ? "selected" : ""}>Unused</option>
            </select>
          </div>
          </div>
          <div class="study-edit-form" id="study-edit-${s.id}" style="display:none">
            <label for="study-edit-title-${s.id}">Title</label>
            <input type="text" id="study-edit-title-${s.id}" value="${esc(s.title)}">
            <label for="study-edit-url-${s.id}">URL</label>
            <input type="text" id="study-edit-url-${s.id}" value="${esc(s.url)}">
            <div class="study-edit-row">
              <div>
                <label for="study-edit-authors-${s.id}">Authors</label>
                <input type="text" id="study-edit-authors-${s.id}" value="${esc(s.authors)}">
              </div>
              <div>
                <label for="study-edit-year-${s.id}">Year</label>
                <input type="number" id="study-edit-year-${s.id}" value="${esc(s.year)}" min="1950" max="2099">
              </div>
              <div>
                <label for="study-edit-pid-${s.id}">PID</label>
                <input type="text" id="study-edit-pid-${s.id}" value="${esc(s.pid)}">
              </div>
            </div>
            <label for="study-edit-snippet-${s.id}">Snippet</label>
            <textarea id="study-edit-snippet-${s.id}">${esc(s.snippet)}</textarea>
            <div class="study-edit-actions">
              <button class="btn-sm" onclick="window.saveStudyEdit(${s.id})">Save</button>
              <button class="study-edit-cancel" onclick="window.toggleStudyEdit(${s.id})">Cancel</button>
            </div>
          </div>
        </div>`;
}

function studyRow(s, i) {
  return `<div class="snp-study-row">
    <div class="snp-study-num">${i + 1}</div>
    ${studyCard(s, i % 2 === 0 ? "study-card--pastel-a" : "study-card--pastel-b")}
  </div>`;
}

// A collapsible sub-section — e.g. "New Unread Studies". Always renders
// (even with zero studies) so it can show emptyText as a placeholder
// rather than disappearing entirely.
function studiesSubAccordion(pinkWord, restOfLabel, desc, studiesArr, emptyText) {
  return `<details class="snp-substudies">
    <summary>
      <span class="snp-studies-subhead"><span class="text-pink">${esc(pinkWord)}</span> ${esc(restOfLabel)}<span class="section-count">${studiesArr.length}</span></span>
      <span class="snp-chevron snp-chevron--sm">▼</span>
    </summary>
    <div class="snp-substudies-body">
      ${desc ? `<p class="snp-studies-subdesc">${esc(desc)}</p>` : ""}
      ${studiesArr.length ? studiesArr.map(studyRow).join("") : `<p class="empty-state">${esc(emptyText || "Nothing here yet.")}</p>`}
    </div>
  </details>`;
}

export async function onRequestGet({ params, env }) {
  const rawRsid  = (params.rsid || "").toLowerCase();
  const rsid     = /^rs/i.test(rawRsid) ? rawRsid : "rs" + rawRsid;

  const [snp, freqsRes, studiesRes] = await Promise.all([
    env.genetic.prepare(
      `SELECT g.rsid, g.alleles, g.notes, g.gene_name, gi.full_name, gi.maplocation,
              si.chromosome, si.position, si.ref_allele, si.alt_allele,
              si.protein_change, si.consequence, si.summary, si.rr_url, si.has_clinvar, si.has_snpedia
       FROM personal g
       LEFT JOIN genes gi ON gi.gene_name = g.gene_name
       LEFT JOIN snps si ON si.rsid = g.rsid
       WHERE g.rsid = ?`
    ).bind(rsid).first(),
    env.genetic.prepare(
      `SELECT * FROM snp_pop WHERE rsid = ?
       ORDER BY pop_type = 'Total' DESC, population ASC`
    ).bind(rsid).all(),
    env.genetic.prepare(
      `SELECT * FROM studies WHERE rsid = ? ORDER BY year DESC, created_at DESC`
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
  const studies    = studiesRes.results || [];
  const curatedStudies = studies.filter(s => s.used === 1);
  const unusedStudies  = studies.filter(s => s.used === 0);
  const newStudies     = studies.filter(s => s.used == null);
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
    const a1pct = fmtFreq(f.allele1_freq);
    const a2pct = fmtFreq(f.allele2_freq);
    const hom1  = fmtFreq(f.geno_hom1);
    const het   = fmtFreq(f.geno_het);
    const hom2  = fmtFreq(f.geno_hom2);
    const chips = [];
    if (a1pct && a2pct) {
      chips.push(`<span class="freq-chip freq-chip--a">${esc(fa1)} ${a1pct}</span>`);
      chips.push(`<span class="freq-chip freq-chip--a">${esc(fa2)} ${a2pct}</span>`);
    }
    if (hom1 && het && hom2) {
      chips.push(`<span class="freq-chip freq-chip--g">${esc(fa1+fa1)} ${hom1}</span>`);
      chips.push(`<span class="freq-chip freq-chip--g">${esc(fa1+fa2)}/${esc(fa2+fa1)} ${het}</span>`);
      chips.push(`<span class="freq-chip freq-chip--g">${esc(fa2+fa2)} ${hom2}</span>`);
    }
    if (f.sample_size) {
      chips.push(`<span class="freq-chip freq-chip--n">pop=${Number(f.sample_size).toLocaleString()}</span>`);
    }
    const isTotal = f.pop_type === "Total";
    return `<div class="freq-row${isTotal ? " freq-row--total" : ""}"
      data-total="${isTotal ? "1" : "0"}"
      data-reffreq="${f.allele1_freq != null ? f.allele1_freq : -1}"
      data-altfreq="${f.allele2_freq != null ? f.allele2_freq : -1}"
      data-hetfreq="${f.geno_het != null ? f.geno_het : -1}"
      data-n="${f.sample_size != null ? f.sample_size : 0}">
      <span class="freq-pop">${esc(f.population)}</span>
      <span class="freq-data">${chips.join("")}</span>
      ${isTotal
        ? `<a class="freq-link" href="https://www.ncbi.nlm.nih.gov/snp/${esc(rsid)}" target="_blank" rel="noopener" title="View on NCBI">↬</a>`
        : `<span></span>`}
    </div>`;
  }).join("");

  const freqSortBar = freqs.length > 1 ? `<div class="freq-sort-bar">
    <button class="freq-sort-btn freq-sort-btn--freq" data-sort-key="reffreq">Ref Allele Frequency</button>
    <button class="freq-sort-btn freq-sort-btn--freq" data-sort-key="hetfreq">Hetero Frequency</button>
    <button class="freq-sort-btn freq-sort-btn--freq" data-sort-key="altfreq">Alt Allele Frequency</button>
    <button class="freq-sort-btn" data-sort-key="n">Sample Size</button>
    <span class="freq-sort-label">Sort by</span>
  </div>` : "";

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
        <a href="/">Home</a> / <a href="/groups">Groups</a>${geneName
          ? ` / <a href="/gene/${esc(geneName)}">${esc(geneName)}</a>`
          : ""} / ${esc(rsid)}
      </nav>

      <div class="snp-viz-wrap" style="margin:38px 0 44px;border-radius:10px;overflow:hidden;line-height:0">
        ${vizSvg}
      </div>

      <h1 class="gene-title" style="font-size:38px">${esc(rsid)}</h1>

      <div style="display:flex;flex-wrap:wrap;gap:18px;margin:28px 0 10px;font-family:var(--mono);font-size:16px;color:var(--muted)">
        ${protChange ? `<span style="color:var(--ink);font-weight:600">${esc(protChange)}</span>` : ""}
        ${geneName ? `<span>Gene: <a href="/gene/${esc(geneName)}" style="color:var(--accent)">${esc(geneName)}</a>${snp.full_name ? ` — ${esc(snp.full_name)}` : ""}</span>` : ""}
        ${chrNum   ? `<span>Chr ${esc(chrNum)}${snp.position ? ":" + esc(snp.position) : ""}</span>` : ""}
        ${maploc   ? `<span>${esc(maploc)}</span>` : ""}
        ${snp.consequence ? consequenceSpan(snp.consequence) : ""}
      </div>

      <div data-personal-notes="${esc(rsid)}"></div>

      <div style="display:flex;gap:20px;font-family:var(--mono);font-size:15px;margin-top:8px">
        <a href="https://www.ncbi.nlm.nih.gov/snp/${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">NCBI ↗</a>
        ${snp.rr_url ? `<a href="${esc(snp.rr_url)}" target="_blank" rel="noopener" style="color:var(--accent)">Research Rabbit ↗</a>` : ""}
        ${snp.has_snpedia === 1
          ? `<a href="https://www.snpedia.com/index.php/${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">SNPedia ↗</a>`
          : ""}
        ${geneName ? `<a href="https://www.genecards.org/card/${esc(geneName)}?Search=${esc(rsid)}#Variants_Variants" target="_blank" rel="noopener" style="color:var(--accent)">GeneCards ↗</a>` : ""}
        ${geneName ? `<a href="https://platform.opentargets.org/search?q=${esc(geneName)}" target="_blank" rel="noopener" style="color:var(--accent)">Open Targets ↗</a>` : ""}
        ${snp.chromosome && snp.position && refAllele && altAllele
          ? `<a href="https://gnomad.broadinstitute.org/variant/${esc(snp.chromosome)}-${esc(snp.position)}-${esc(refAllele)}-${esc(altAllele)}?dataset=gnomad_r4" target="_blank" rel="noopener" style="color:var(--accent)">gnomAD ↗</a>`
          : ""}
        <a href="https://www.omim.org/search?index=entry&search=${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">OMIM ↗</a>
        ${snp.has_clinvar === 1
          ? `<a href="https://www.ncbi.nlm.nih.gov/clinvar/?term=${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">ClinVar ↗</a>`
          : ""}
        <a href="https://varsome.com/variant/hg38/${esc(rsid)}?" target="_blank" rel="noopener" style="color:var(--accent)">Varsome ↗</a>
        <a href="https://databases.lovd.nl/shared/variants?search_VariantOnGenome%2FdbSNP=${esc(rsid)}" target="_blank" rel="noopener" style="color:var(--accent)">LOVD ↗</a>
      </div>
    </div>
  </section>

  <div class="gene-body">
    <div class="gene-section">
      <h2 class="studies-heading">Population Frequencies<span class="section-count">${freqs.length}</span></h2>
      ${freqs.length === 0
        ? `<p class="empty-state">No frequency data stored yet.</p>`
        : `<div class="freq-section">${freqSortBar}<div class="freq-table">${freqRows}</div></div>`}
    </div>

    <div class="gene-section">
      <h2 class="studies-heading">Studies<span class="section-count">${studies.length}</span></h2>
      ${studiesSubAccordion("Curated", "Studies",
        `These studies were determined to be useful for this variant — check "Unused Studies" further down if curious what didn't make the cut.`,
        curatedStudies, "No curated studies yet.")}
      ${studiesSubAccordion("Unread", "Studies", null, newStudies, "No new studies.")}
      ${studiesSubAccordion("Unused", "Studies", null, unusedStudies, "No unused studies.")}
    </div>
  </div>

</main>
${foot()}
<script src="/personal-auth.js"></script>
<script>
(function () {
  const rsid = ${JSON.stringify(rsid)};
  function escC(str) {
    return (str == null ? "" : String(str))
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pidUrlC(pid) {
    if (!pid) return null;
    return /^10\\.\\d{4,9}\\//.test(pid) ? "https://doi.org/" + pid : "https://hdl.handle.net/" + pid;
  }
  function showBottomToast(msg) {
    let el = document.getElementById("study-edit-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "study-edit-toast";
      el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);"
        + "background:var(--card);border:1px solid var(--accent);color:var(--accent);"
        + "font-family:var(--mono);font-size:13px;padding:10px 20px;border-radius:6px;"
        + "z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.4)";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () { el.style.display = "none"; }, 2500);
  }
  async function load() {
    const res = await PersonalAuth.fetchPersonal({ rsid });
    if (!res.ok) return false;
    const n = document.querySelector('[data-personal-notes="' + rsid + '"]');
    if (n && res.personal && res.personal.notes) {
      n.innerHTML = '<p class="gene-desc"></p>';
      n.firstChild.textContent = res.personal.notes;
    }
    document.querySelectorAll('[data-study-assign]').forEach(function (el) { el.style.display = "flex"; });
    document.querySelectorAll('[data-study-edit]').forEach(function (el) { el.style.display = "flex"; });
    return true;
  }
  window.toggleStudyEdit = function (id) {
    const view = document.querySelector('[data-study-view="' + id + '"]');
    const form = document.getElementById("study-edit-" + id);
    if (!view || !form) return;
    const opening = form.style.display === "none";
    form.style.display = opening ? "block" : "none";
    view.style.display = opening ? "none" : "block";
  };
  window.saveStudyEdit = async function (id) {
    const token = PersonalAuth.getToken();
    if (!token) return;
    const body = {
      title:   document.getElementById("study-edit-title-" + id).value.trim(),
      url:     document.getElementById("study-edit-url-" + id).value.trim(),
      authors: document.getElementById("study-edit-authors-" + id).value.trim(),
      year:    parseInt(document.getElementById("study-edit-year-" + id).value) || null,
      pid:     document.getElementById("study-edit-pid-" + id).value.trim(),
      snippet: document.getElementById("study-edit-snippet-" + id).value.trim(),
    };
    const r = await fetch("/api/study/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    if (!r.ok) { alert("Failed to save — check you're still signed in."); return; }

    const view = document.querySelector('[data-study-view="' + id + '"]');
    const assignHtml = view.querySelector(".study-assign").outerHTML;
    const titleHtml = body.title ? '<p class="study-title">' + (body.url
      ? '<a href="' + escC(body.url) + '" target="_blank" rel="noopener">' + escC(body.title) + '</a>'
      : escC(body.title)) + '</p>' : "";
    const metaParts = [];
    if (body.pid)     metaParts.push('<a href="' + escC(pidUrlC(body.pid)) + '" target="_blank" rel="noopener">PID</a>');
    if (body.authors) metaParts.push(escC(body.authors));
    if (body.year)    metaParts.push(escC(String(body.year)));
    const metaHtml = '<p class="study-meta">' + metaParts.join(" · ") + '</p>';
    const snippetHtml = body.snippet ? '<blockquote class="study-snippet">' + escC(body.snippet) + '</blockquote>' : "";
    view.innerHTML = titleHtml + metaHtml + snippetHtml + assignHtml;

    window.toggleStudyEdit(id);
    showBottomToast("Submitted");
  };
  window.assignStudy = async function (id, value) {
    const token = PersonalAuth.getToken();
    if (!token) return;
    const used = value === "" ? null : parseInt(value);
    const r = await fetch("/api/study/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ used }),
    });
    if (r.ok) location.reload();
    else alert("Failed to update — check you're still signed in.");
  };
  PersonalAuth.wireSignIn("personal-signin", load);
  load();
})();

(function () {
  const bar = document.querySelector(".freq-sort-bar");
  const table = document.querySelector(".freq-table");
  if (!bar || !table) return;
  const originalOrder = Array.from(table.querySelectorAll(".freq-row"));
  let activeKey = null, state = 0; // state: 0 = original, 1 = ascending, 2 = descending

  function clearActive() {
    bar.querySelectorAll(".freq-sort-btn").forEach(function (b) {
      b.classList.remove("active", "freq-sort-btn--desc");
    });
  }

  bar.querySelectorAll(".freq-sort-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const key = btn.dataset.sortKey;
      state = (activeKey === key) ? (state + 1) % 3 : 1;
      activeKey = key;
      clearActive();

      if (state === 0) {
        activeKey = null;
        originalOrder.forEach(function (r) { table.appendChild(r); });
        return;
      }

      btn.classList.add("active");
      btn.classList.toggle("freq-sort-btn--desc", state === 2);
      const dir = state === 2 ? -1 : 1;

      const rows = Array.from(table.querySelectorAll(".freq-row"));
      const pinned = rows.filter(function (r) { return r.dataset.total === "1"; });
      const rest   = rows.filter(function (r) { return r.dataset.total !== "1"; });
      rest.sort(function (a, b) {
        const va = a.dataset[key], vb = b.dataset[key];
        const na = parseFloat(va), nb = parseFloat(vb);
        const cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : String(va).localeCompare(String(vb));
        return cmp * dir;
      });
      pinned.concat(rest).forEach(function (r) { table.appendChild(r); });
    });
  });
})();
</script>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
