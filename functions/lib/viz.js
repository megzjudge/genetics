// ── Shared SVG visualisation generator ───────────────────────────────────────

function esc(s) {
  return (s == null ? "" : String(s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Approximate centromere position (fraction from top) per chromosome
const CHR_CEN = {
  "1":"0.44","2":"0.39","3":"0.46","4":"0.37","5":"0.46","6":"0.40",
  "7":"0.39","8":"0.44","9":"0.36","10":"0.40","11":"0.45","12":"0.39",
  "13":"0.18","14":"0.18","15":"0.20","16":"0.45","17":"0.33","18":"0.22",
  "19":"0.47","20":"0.44","21":"0.27","22":"0.27","X":"0.40","Y":"0.28",
};

// Full nucleotide names for legend
const NUKE = { A:"Adenine", T:"Thymine", G:"Guanine", C:"Cytosine" };

// Parse arm + region from maplocation string e.g. "14q24.1"
function parseLoc(maploc) {
  const m = (maploc || "").match(/([pq])(\d+)/i);
  if (!m) return { arm: "q", region: 24 };
  return { arm: m[1].toLowerCase(), region: parseInt(m[2]) };
}

// Derive flanking band labels from maplocation e.g. "14q24.1" → ["14q23","14q25"]
function flankingBands(chr, maploc) {
  const { arm, region } = parseLoc(maploc);
  const c = esc(chr || "");
  if (arm === "p") {
    return [`${c}p${region + 1}`, `${c}p${region > 1 ? region - 1 : "cen"}`];
  }
  return [`${c}q${region > 1 ? region - 1 : "cen"}`, `${c}q${region + 1}`];
}

// Approximate fraction of chromosome length where the gene band sits
function geneBandFrac(maploc, cenFrac) {
  const { arm, region } = parseLoc(maploc);
  const MAX = 36;
  const r = Math.min(region, MAX);
  if (arm === "p") {
    // p arm: from top (0) down to centromere (cenFrac), region 1 = near centromere
    return cenFrac * (1 - r / (MAX * 1.1));
  }
  // q arm: from centromere (cenFrac) down to bottom (1)
  return cenFrac + (1 - cenFrac) * (r / (MAX * 1.05));
}

// Parse chromosome number from maplocation string e.g. "14q24.1" → "14"
export function chrFromMaploc(maploc) {
  const m = (maploc || "").match(/^(\d+|[XY])/i);
  return m ? m[1] : null;
}

// ── Panel 1: chromosome schematic ────────────────────────────────────────────
// panelTwoX: if provided, draw zoom connector lines pointing to that x (Panel 2 left edge)
function chrPanel(chrNum, geneName, maploc, idSuffix, panelTwoX) {
  const chr    = String(chrNum || "?");
  const cenFrac = parseFloat(CHR_CEN[chr] || "0.40");
  const suffix  = String(idSuffix || chr).replace(/\W/g, "");

  const CX = 120, HW = 17, NHW = 11; // center-x, half-width, narrow half-width (centromere)
  // Panel body spans y=20..540 (520px). Top 1/6 (~87px) is the title zone above
  // TOP; the pill runs 4.5/6 of that (TOP..BOT); the last 0.5/6 below BOT is
  // reserved for the watermark.
  const TOP = 108, BOT = 496, H = BOT - TOP;
  const cenY  = Math.round(TOP + cenFrac * H);
  const cenT  = cenY - 7;
  const cenB  = cenY + 7;

  const gFrac = geneBandFrac(maploc, cenFrac);
  const gMid  = Math.round(TOP + Math.max(0.04, Math.min(0.96, gFrac)) * H);
  const gTop  = Math.max(TOP + 4, gMid - 12);
  const gBot  = Math.min(BOT - 4, gTop + 24);

  // Chromosome outline path
  const path = [
    `M${CX},${TOP}`,
    `Q${CX+HW},${TOP} ${CX+HW},${TOP+10}`,
    `L${CX+HW},${cenT}`,
    `Q${CX+NHW},${cenY} ${CX+HW},${cenB}`,
    `L${CX+HW},${BOT-10}`,
    `Q${CX+HW},${BOT} ${CX},${BOT}`,
    `Q${CX-HW},${BOT} ${CX-HW},${BOT-10}`,
    `L${CX-HW},${cenB}`,
    `Q${CX-NHW},${cenY} ${CX-HW},${cenT}`,
    `L${CX-HW},${TOP+10}`,
    `Q${CX-HW},${TOP} ${CX},${TOP} Z`,
  ].join(" ");

  // Generate chromosome band stripes (generic banding pattern)
  const bandFracs = [0.08, 0.17, 0.27, 0.38, 0.55, 0.67, 0.77, 0.88];
  const bands = bandFracs.map(f => {
    const by = Math.round(TOP + f * H);
    const bh = 12;
    // skip if overlaps centromere region
    if (by + bh > cenT - 2 && by < cenB + 2) return "";
    return `<rect x="${CX-HW}" y="${by}" width="${HW*2}" height="${bh}" fill="#2a3d52"/>`;
  }).join("\n    ");

  const lineY = Math.round((gTop + gBot) / 2);

  // Optional zoom connector to Panel 2 (only in 3-panel SVG)
  const connector = panelTwoX != null ? `
  <path d="M${CX+HW},${gTop} L${panelTwoX},112 L${panelTwoX},428 L${CX+HW},${gBot} Z" fill="#34d399" opacity="0.04"/>
  <line x1="${CX+HW}" y1="${gTop}" x2="${panelTwoX}" y2="112" stroke="#34d399" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>
  <line x1="${CX+HW}" y1="${gBot}" x2="${panelTwoX}" y2="428" stroke="#34d399" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>` : "";

  return `
  <rect x="20" y="20" width="270" height="520" rx="10" fill="#131820" stroke="#1f2d3d" stroke-width="1"/>
  <text x="155" y="54"  text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#7a8fa6" letter-spacing="2">CHROMOSOME</text>
  <text x="155" y="76"  text-anchor="middle" font-family="Georgia,serif" font-size="14" fill="#e2e8f2" font-weight="700">${esc(chr)}</text>
  <defs><clipPath id="chr-clip-${suffix}"><path d="${path}"/></clipPath></defs>
  <g clip-path="url(#chr-clip-${suffix})">
    <rect x="${CX-HW}" y="${TOP}" width="${HW*2}" height="${H}" fill="#3d5068"/>
    ${bands}
    <rect x="${CX-HW}" y="${gTop}" width="${HW*2}" height="${gBot-gTop}" fill="#155e3e"/>
  </g>
  <path d="${path}" fill="none" stroke="#4a6680" stroke-width="1.5"/>
  <ellipse cx="${CX}" cy="${cenY}" rx="${NHW}" ry="5" fill="#0e1117" stroke="#3d5068" stroke-width="1"/>
  <circle cx="${CX}" cy="${lineY}" r="3" fill="#34d399"/>
  <line x1="${CX+HW}" y1="${lineY}" x2="195" y2="${lineY}" stroke="#34d399" stroke-width="1.5" stroke-dasharray="3,2"/>
  <text x="200" y="${lineY - 4}" font-family="ui-monospace,monospace" font-size="10" fill="#34d399" font-weight="600">${esc(geneName)}</text>
  <text x="200" y="${lineY + 9}" font-family="ui-monospace,monospace" font-size="9"  fill="#7a8fa6">${esc(maploc || "")}</text>
  ${connector}`;
}

// ── Panel 2: gene view ────────────────────────────────────────────────────────
function genePanel(geneName, maploc, rsid) {
  const chr        = (maploc || "").split(/[pq]/)[0] || "?";
  const [above, below] = flankingBands(chr, maploc);
  const title      = maploc ? `${esc(geneName)} · ${esc(maploc)}` : esc(geneName);
  const rsLabel    = rsid ? esc(rsid) : "";

  // Rainbow strand colours cycling through 26 strands
  const COLS = ["#34d399","#60a5fa","#a78bfa","#f59e0b","#f87171","#2dd4bf",
                "#fbbf24","#f472b6","#86efac","#93c5fd"];
  const strands = [];
  for (let i = 0; i < 26; i++) {
    const x = 460 + i * 6;
    strands.push(`<line x1="${x}" y1="230" x2="${x}" y2="310" stroke="${COLS[i % COLS.length]}" stroke-width="1.1" opacity="0.9" clip-path="url(#rhombus-clip)"/>`);
  }

  return `
  <!-- ── PANEL 2: Gene view ── -->
  <rect x="310" y="20" width="460" height="520" rx="10" fill="#131820" stroke="#1f2d3d" stroke-width="1"/>
  <text x="540" y="54"  text-anchor="middle" font-family="ui-monospace,monospace" font-size="9"  fill="#7a8fa6" letter-spacing="2">GENE VIEW</text>
  <text x="540" y="76"  text-anchor="middle" font-family="Georgia,serif"          font-size="14" fill="#e2e8f2" font-weight="700">${title}</text>

  <!-- Flanking grey bands -->
  <rect x="330" y="88"  width="420" height="24" rx="3" fill="#2a3d52" opacity="0.4"/>
  <text x="540" y="105" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#4a6680">${esc(above)}</text>
  <rect x="330" y="428" width="420" height="24" rx="3" fill="#2a3d52" opacity="0.4"/>
  <text x="540" y="445" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#4a6680">${esc(below)}</text>

  <!-- MTHFD1 green region -->
  <rect x="330" y="112" width="420" height="316" rx="3" fill="#0a2218"/>
  <rect x="330" y="112" width="420" height="316" rx="3" fill="none" stroke="#34d399" stroke-width="1" opacity="0.3"/>

  <!-- Green strands — full block -->
  ${Array.from({length:70},(_,i)=>330+i*6).map(x=>
    `<line x1="${x}" y1="112" x2="${x}" y2="428" stroke="#34d399" stroke-width="0.8" opacity="0.25"/>`
  ).join("\n  ")}

  <!-- Coloured strands visible only inside rhombus -->
  <defs>
    <clipPath id="rhombus-clip">
      <polygon points="460,270 540,230 620,270 540,310"/>
    </clipPath>
  </defs>
  ${strands.join("\n  ")}

  <!-- rs strand + marker -->
  <line x1="541" y1="230" x2="541" y2="310" stroke="#e84580" stroke-width="2.5"/>
  <circle cx="541" cy="270" r="5" fill="#e84580"/>
  <polygon points="460,270 540,230 620,270 540,310" fill="none" stroke="#e84580" stroke-width="1.2" opacity="0.5"/>
  ${rsLabel ? `<text x="541" y="326" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#e84580" font-weight="600">${rsLabel}</text>` : ""}

  <!-- Density labels -->
  <text x="335" y="464" font-family="ui-monospace,monospace" font-size="9" fill="#3d5068">— ~70,000 base pairs in the gene</text>
  <text x="335" y="480" font-family="ui-monospace,monospace" font-size="9" fill="#3d5068">— ~14,000 uncommon variants · &lt;1% of humans have them</text>
  <text x="335" y="496" font-family="ui-monospace,monospace" font-size="9" fill="#34d399">— ~1,000 common variants · &gt;1% carry the alternate allele</text>`;
}

// ── Panel 3: allele state ─────────────────────────────────────────────────────
function allelePanel(rsid, refA, altA, maploc, geneName, proteinChange) {
  const ref  = ((refA || "").toUpperCase().charAt(0)) || "?";
  const alt  = ((altA || "").toUpperCase().charAt(0)) || "?";
  const refName = NUKE[ref] || ref;
  const altName = NUKE[alt] || alt;

  const subtitle = [
    ref !== "?" && alt !== "?" ? `${ref} / ${alt}` : null,
    geneName ? esc(geneName) : null,
    maploc   ? esc(maploc)   : null,
  ].filter(Boolean).join(" · ");

  // Allele block — 3 rows, each 90px tall, 12px gap
  function allelePair(y, letter1, col1, letter2, col2, label) {
    const bg1 = col1 === "#34d399" ? "#071e12" : "#12080f";
    const bg2 = col2 === "#34d399" ? "#071e12" : "#12080f";
    const genotype = letter1 + letter2;
    return `
  <rect x="826" y="${y}" width="236" height="90" rx="6" fill="#0e0f14" stroke="#e84580" stroke-width="1"/>
  <text x="944" y="${y+20}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8" fill="#e84580">${esc(label)}</text>
  <rect x="864" y="${y+36}" width="160" height="12" rx="6" fill="#1f2d3d"/>
  <text x="868"  y="${y+46}" font-family="ui-monospace,monospace" font-size="8" fill="#3d5068">5&#x2032;</text>
  <text x="1017" y="${y+46}" font-family="ui-monospace,monospace" font-size="8" fill="#3d5068">3&#x2032;</text>
  <circle cx="944" cy="${y+42}" r="10" fill="${bg1}" stroke="${col1}" stroke-width="1.5"/>
  <text x="944" y="${y+46}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="${col1}" font-weight="700">${esc(letter1)}</text>
  <rect x="864" y="${y+54}" width="160" height="12" rx="6" fill="#1f2d3d"/>
  <text x="868"  y="${y+64}" font-family="ui-monospace,monospace" font-size="8" fill="#3d5068">5&#x2032;</text>
  <text x="1017" y="${y+64}" font-family="ui-monospace,monospace" font-size="8" fill="#3d5068">3&#x2032;</text>
  <circle cx="944" cy="${y+60}" r="10" fill="${bg2}" stroke="${col2}" stroke-width="1.5"/>
  <text x="944" y="${y+64}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" fill="${col2}" font-weight="700">${esc(letter2)}</text>`;
  }

  return `
  <!-- ── PANEL 3: Allele state ── -->
  <rect x="810" y="20" width="270" height="520" rx="10" fill="#131820" stroke="#1f2d3d" stroke-width="1"/>
  <text x="945" y="54"  text-anchor="middle" font-family="ui-monospace,monospace" font-size="9"  fill="#7a8fa6" letter-spacing="2">ALLELE STATE</text>
  <text x="945" y="76"  text-anchor="middle" font-family="Georgia,serif"          font-size="14" fill="#e2e8f2" font-weight="700">${esc(rsid || "")}</text>
  ${proteinChange ? `<text x="945" y="92"  text-anchor="middle" font-family="ui-monospace,monospace" font-size="9"  fill="#7a8fa6">${esc(proteinChange)}</text>` : ""}
  <text x="945" y="${proteinChange ? 108 : 94}"  text-anchor="middle" font-family="ui-monospace,monospace" font-size="9"  fill="#3d5068">${subtitle}</text>

  ${allelePair(116, ref, "#34d399", ref, "#34d399", "HOMOZYGOUS WILD TYPE (DOMINANT)")}
  ${allelePair(218, ref, "#34d399", alt, "#e84580", "HETEROZYGOUS")}
  ${allelePair(320, alt, "#e84580", alt, "#e84580", "HOMOZYGOUS ALTERNATE (RECESSIVE)")}

  <!-- Zoom connector — Panel 2 rs point (541,270) → Panel 3 blocks (826, y=116..410); lines clipped inside Panel 2 at x=760 -->
  <path d="M760,152 L826,116 L826,410 L760,378 Z" fill="#e84580" opacity="0.04"/>
  <line x1="760" y1="152" x2="826" y2="116" stroke="#e84580" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>
  <line x1="760" y1="378" x2="826" y2="410" stroke="#e84580" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.4"/>

  <!-- Legend -->
  <rect x="826" y="432" width="236" height="62" rx="6" fill="#1a2030" stroke="#1f2d3d" stroke-width="1"/>
  <circle cx="844" cy="452" r="8" fill="#071e12" stroke="#34d399" stroke-width="1.5"/>
  <text x="844"  y="456" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#34d399" font-weight="700">${esc(ref)}</text>
  <text x="858"  y="456" font-family="ui-monospace,monospace" font-size="9" fill="#7a8fa6">${esc(refName)} — reference allele</text>
  <circle cx="844" cy="474" r="8" fill="#12080f" stroke="#e84580" stroke-width="1.5"/>
  <text x="844"  y="478" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#e84580" font-weight="700">${esc(alt)}</text>
  <text x="858"  y="478" font-family="ui-monospace,monospace" font-size="9" fill="#7a8fa6">${esc(altName)} — variant allele</text>`;
}

// ── Public exports ────────────────────────────────────────────────────────────

// Full 3-panel SVG — inline string (no XML declaration, for embedding in HTML)
export function snpViz({ chrNum, geneName, maploc, rsid, refAllele, altAllele, proteinChange }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 560" style="width:100%;height:auto;display:block">
  <rect width="1100" height="560" fill="#0e1117"/>
  ${chrPanel(chrNum, geneName, maploc, rsid ? rsid.replace(/\W/g,"") : "snp", 310)}
  ${genePanel(geneName, maploc, rsid)}
  ${allelePanel(rsid, refAllele, altAllele, maploc, geneName, proteinChange)}
  <text x="550" y="550" text-anchor="middle" font-family="ui-monospace,monospace" font-size="9" fill="#1e3a2a" letter-spacing="0.05em">genetics.jdge.cc</text>
</svg>`;
}

// Panel 1 only — inline string (for embedding in gene page HTML)
export function geneViz({ chrNum, geneName, maploc }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 560" style="width:100%;height:auto;display:block;border-radius:8px">
  <rect width="300" height="560" fill="#0e1117"/>
  ${chrPanel(chrNum, geneName, maploc, String(geneName || "gene").replace(/\W/g,""), null)}
  <text x="278" y="522" text-anchor="end" font-family="ui-monospace,monospace" font-size="9" fill="#7a8fa6" opacity="0.25" letter-spacing="0.05em">genetics.jdge.cc</text>
</svg>`;
}
