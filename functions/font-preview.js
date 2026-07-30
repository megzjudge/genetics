import { geneViz, chrFromMaploc } from "./lib/viz.js";

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
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle light and dark theme" title="Toggle theme">
      <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
      <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"></path></svg>
    </button>
    <a href="/basics">Basics</a>
    <a href="/groups">Genes</a>
  </nav>
</header>`;
}

// Font files you dropped into /fonts — family name derived from the filename.
const FONTS = [
  { file: "5thgradecursive.ttf",   family: "5th Grade Cursive" },
  { file: "MrsSaintDelafield.ttf", family: "Mrs Saint Delafield" },
  { file: "NigraScript.otf",       family: "Nigra Script" },
  { file: "Precious.ttf",          family: "Precious" },
  { file: "Wolgast Script.ttf",    family: "Wolgast Script" },
];

export async function onRequestGet({ env }) {
  const geneName = "ABCC2";

  const [info, groupsRes] = await Promise.all([
    env.genetic.prepare(`SELECT * FROM genes WHERE gene_name = ?`).bind(geneName).first(),
    env.genetic.prepare(`
      SELECT tg.id, tg.name FROM topics tg
      JOIN gene_topics gg ON tg.id = gg.group_id
      WHERE gg.gene_name = ?
    `).bind(geneName).all(),
  ]);

  if (!info) {
    return new Response("ABCC2 not found — can't build the comparison page without it.", { status: 404 });
  }

  const groups   = groupsRes.results || [];
  const primaryGroup = groups[0] || null;
  const groupSlug = primaryGroup ? slugify(primaryGroup.name) : "";
  const maploc = info.maplocation || "";
  const chrNum = chrFromMaploc(maploc) || "10";

  const fontFaces = FONTS.map(f => `
  @font-face {
    font-family: "${f.family}";
    src: url("/fonts/${encodeURIComponent(f.file)}");
    font-display: swap;
  }`).join("");

  const rows = FONTS.map(f => `
  <section class="gene-header" style="border-top:4px solid var(--accent)">
    <div class="gene-header-inner" style="display:flex;gap:40px;align-items:center">
      <div style="flex:1;min-width:0">
        <p style="font-family:var(--mono);font-size:12px;color:var(--accent);margin:0 0 14px;letter-spacing:.05em;text-transform:uppercase">Font: ${esc(f.family)} <span style="color:var(--faint)">(${esc(f.file)})</span></p>
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
      <div style="flex-shrink:0;width:250px;max-width:100%">
        ${geneViz({ chrNum, geneName, maploc, numberFont: `'${f.family}'` })}
      </div>
    </div>
  </section>`).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Font comparison — chromosome number | scratch</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/png" href="/images/icon.png">
  <link rel="stylesheet" href="/styles.css">
  <script src="/theme.js"></script>
  <style>${fontFaces}</style>
</head>
<body>
${nav()}
<main>
  <div style="max-width:var(--max-w);margin:0 auto;padding:32px 36px 0">
    <p style="font-family:var(--mono);font-size:12px;color:var(--faint)">
      Scratch page — comparing 5 candidate fonts for the chromosome number only.
      Everything else on each row is real ABCC2 data, unchanged. Not linked from anywhere on the site.
    </p>
  </div>
  ${rows}
</main>
</body>
</html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
