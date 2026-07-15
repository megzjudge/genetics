// ── NCBI ALFA population name map ────────────────────────────
// ALFA study_name keys → display label + type (Total / Sub)
const ALFA_POP = {
  "ALFA:Total":            { label: "Global",           type: "Total" },
  "ALFA:European":         { label: "European",         type: "Sub"   },
  "ALFA:African":          { label: "African",          type: "Sub"   },
  "ALFA:African Others":   { label: "African Others",   type: "Sub"   },
  "ALFA:African American": { label: "African American", type: "Sub"   },
  "ALFA:Asian":            { label: "Asian",            type: "Sub"   },
  "ALFA:East Asian":       { label: "East Asian",       type: "Sub"   },
  "ALFA:Other Asian":      { label: "Other Asian",      type: "Sub"   },
  "ALFA:Latin American 1": { label: "Latin American 1", type: "Sub"   },
  "ALFA:Latin American 2": { label: "Latin American 2", type: "Sub"   },
  "ALFA:South Asian":      { label: "South Asian",      type: "Sub"   },
  "ALFA:Other":            { label: "Other",            type: "Sub"   },
};

function pct(n) { return n != null ? Math.round(n * 100) : null; }

// NCBI's protein SPDI uses 1-letter amino acid codes (e.g. "A"->"V") — spelled
// out in full rather than left as a cryptic single letter or 3-letter code.
const AMINO_ACIDS = {
  A: "Alanine", R: "Arginine", N: "Asparagine", D: "Aspartic Acid",
  C: "Cysteine", E: "Glutamic Acid", Q: "Glutamine", G: "Glycine",
  H: "Histidine", I: "Isoleucine", L: "Leucine", K: "Lysine",
  M: "Methionine", F: "Phenylalanine", P: "Proline", S: "Serine",
  T: "Threonine", W: "Tryptophan", Y: "Tyrosine", V: "Valine",
  "*": "Stop",
};
function aminoAcidName(code) {
  return AMINO_ACIDS[code] || code;
}

function seqIdToChrom(seqId) {
  const m = seqId?.match(/^NC_(\d+)\./);
  if (!m) return null;
  const n = parseInt(m[1]);
  if (n >= 1 && n <= 22) return String(n);
  if (n === 23) return "X";
  if (n === 24) return "Y";
  return null;
}

// A Ref/Alt Allele table cell can hold multiple "X=freq" pairs, comma-
// separated, for multi-allelic sites (e.g. "A=0.000000, C=0.145567" — rs212091
// carries a third allele essentially never observed here). Drop 0-frequency
// entries and return the first real one; null if nothing qualifies.
function parseAlleleCell(raw) {
  const parts = (raw || "").split(",").map(p => p.trim());
  for (const part of parts) {
    const m = part.match(/^([A-Za-z-]+)=([\d.]+)$/);
    if (!m) continue;
    const freq = parseFloat(m[2]);
    if (freq > 0) return { allele: m[1], freq };
  }
  return null;
}

function sortFreqRows(rows) {
  rows.sort((a, b) => {
    if (a.pop_type === "Total") return -1;
    if (b.pop_type === "Total") return 1;
    return a.population.localeCompare(b.population);
  });
  return rows;
}

// The report page has TWO different frequency tables, confirmed by directly
// inspecting rs924135's HTML — they can disagree on sample size for the same
// named sub-population (e.g. dbsnp_freq_datatable showed Latin American 1 as
// 16 where popfreq_datatable correctly shows 98, matching NCBI's own display).
// popfreq_datatable is the dedicated ALFA breakdown: no "Study" column (it's
// ALFA only), but has Ref HMOZ / Alt HMOZ / HTRZ genotype columns the other
// table lacks entirely. Always prefer it.
// A genuine 0.0 genotype frequency is real data ("nobody in this sample was
// homozygous alt"), not a missing value — `parseFloat(x) || null` would wrongly
// null it out since 0 is falsy in JS. Only actually-unparseable values (e.g.
// NCBI's own "N/A") should become null.
function parseNum(raw) {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}

function parsePopfreqTable(html) {
  const tableM = html.match(/<table id="popfreq_datatable"[\s\S]*?<\/table>/);
  if (!tableM) return [];
  const blocks = tableM[0].match(/<tr class="(?:par_row|chi_row)">[\s\S]*?<\/tr>/g) || [];
  const rows = [];
  for (const block of blocks) {
    const tds = (block.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, "").trim());
    if (tds.length !== 9) continue;
    const [population, group, sampleSize, refRaw, altRaw, refHmoz, altHmoz, htrz] = tds;
    const ref = parseAlleleCell(refRaw);
    const alt = parseAlleleCell(altRaw);
    if (!ref || !alt) continue;
    rows.push({
      population, pop_type: group.toLowerCase() === "sub" ? "Sub" : "Total",
      sample_size: parseInt(sampleSize) || null,
      allele1: ref.allele, allele1_freq: ref.freq,
      allele2: alt.allele, allele2_freq: alt.freq,
      geno_hom1: parseNum(refHmoz),
      geno_het:  parseNum(htrz),
      geno_hom2: parseNum(altHmoz),
    });
  }
  return sortFreqRows(rows);
}

// Secondary fallback for SNPs with no popfreq_datatable at all (no ALFA data
// on the page). Multi-study comparison table — no genotype columns, so
// geno_* stays null. Prefers "Allele Frequency Aggregator" (ALFA under its
// full display name here) if present; otherwise the richest breakdown.
function parseDbsnpFreqTable(html) {
  const tableM = html.match(/<table id="dbsnp_freq_datatable"[\s\S]*?<\/table>/);
  if (!tableM) return [];

  const blocks = tableM[0].match(/<tr class="(?:par_row|chi_row)">[\s\S]*?<\/tr>/g) || [];
  const studies = {};
  for (const block of blocks) {
    const tds = (block.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, "").trim());
    if (tds.length !== 6) continue;
    const [study, population, group, sampleSize, refRaw, altRaw] = tds;
    const ref = parseAlleleCell(refRaw);
    const alt = parseAlleleCell(altRaw);
    if (!ref || !alt) continue;
    if (!studies[study]) studies[study] = [];
    studies[study].push({
      population, pop_type: group.toLowerCase() === "sub" ? "Sub" : "Total",
      sample_size: parseInt(sampleSize) || null,
      allele1: ref.allele, allele1_freq: ref.freq,
      allele2: alt.allele, allele2_freq: alt.freq,
      geno_hom1: null, geno_het: null, geno_hom2: null,
    });
  }

  const names = Object.keys(studies);
  if (!names.length) return [];
  const chosen = names.find(n => n.toLowerCase().includes("allele frequency aggregator"))
    || names.reduce((best, n) => studies[n].length > studies[best].length ? n : best, names[0]);

  return sortFreqRows(studies[chosen]);
}

// Confirmed the actual data exists and parses fine even for SNPs that
// intermittently come back with nothing during a backfill run — pointing to
// NCBI throttling rapid sequential requests rather than a per-SNP data gap.
// Shared by both HTML scrape call sites; retries with backoff before giving up.
async function fetchNcbiHtml(rsid) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, 500 * attempt));
    try {
      const r = await fetch(`https://www.ncbi.nlm.nih.gov/snp/${rsid}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html",
        },
      });
      if (r.ok) return await r.text();
      console.error(`NCBI HTML fetch: ${rsid} attempt ${attempt + 1} responded ${r.status}`);
    } catch (e) {
      console.error(`NCBI HTML fetch: ${rsid} attempt ${attempt + 1} error: ${e.message}`);
    }
  }
  return null;
}

// Fallback: scrape the classic NCBI report page when the REST API either
// fails outright or (more often) succeeds but has nothing ALFA-tagged.
async function fetchNcbiFreqsFromHtml(rsid) {
  try {
    const html = await fetchNcbiHtml(rsid);
    if (!html) return [];

    const popRows = parsePopfreqTable(html);
    if (popRows.length) return popRows;
    return parseDbsnpFreqTable(html);
  } catch (e) {
    console.error("NCBI HTML freq scrape error:", e.message);
    return [];
  }
}

// Extracted so the lookup endpoint can reuse an NCBI JSON response it already
// fetched for gene_name/consequence, instead of fetching it a second time
// just to also check for frequency data.
function parseAlfaJsonFreqs(data) {
    // Build per-study allele buckets: { studyName: { allele: { count, total } } }
    const buckets = {};
    const annotations = data?.primary_snapshot_data?.allele_annotations || [];
    for (const ann of annotations) {
      for (const f of (ann.frequency || [])) {
        const study = f.study_name;
        if (!ALFA_POP[study]) continue;          // only ALFA populations
        const allele = f.observation?.deleted_sequence
                    || f.observation?.inserted_sequence || "?";
        if (!buckets[study]) buckets[study] = {};
        buckets[study][allele] = { count: f.allele_count, total: f.total_count };
      }
    }

    // Also check for genotype frequencies (stored under separate keys in some responses)
    // NCBI encodes genotypes in placements_with_allele[].allele_in_cur_release[].frequency
    // If not present, geno_* will remain null and display will show allele freqs only.
    const genoMap = {};
    for (const pl of (data?.primary_snapshot_data?.placements_with_allele || [])) {
      for (const rel of (pl.allele_in_cur_release || [])) {
        for (const f of (rel.frequency || [])) {
          const study = f.study_name;
          if (!ALFA_POP[study] || !f.observation?.genotype) continue;
          if (!genoMap[study]) genoMap[study] = {};
          genoMap[study][f.observation.genotype] = f.freq;
        }
      }
    }

    // Convert buckets to row objects
    const rows = [];
    for (const [study, alleles] of Object.entries(buckets)) {
      const pop   = ALFA_POP[study];
      const keys  = Object.keys(alleles);
      const a1key = keys[0], a2key = keys[1];
      const total = alleles[a1key]?.total || 0;
      const a1f   = total ? alleles[a1key]?.count / total : null;
      const a2f   = total && a2key ? alleles[a2key]?.count / total : null;

      // Genotype frequencies — try to extract hom1/het/hom2
      const genos  = genoMap[study] || {};
      const gkeys  = Object.keys(genos);
      // Expect keys like "GG", "GA", "AA"
      const homKeys = gkeys.filter(k => k[0] === k[1]);
      const hetKeys = gkeys.filter(k => k[0] !== k[1]);
      const hom1 = a1key ? genos[a1key + a1key] ?? null : null;
      const hom2 = a2key ? genos[a2key + a2key] ?? null : null;
      const het  = hetKeys.length ? Object.values(Object.fromEntries(hetKeys.map(k => [k, genos[k]]))).reduce((s, v) => s + v, 0) : null;

      rows.push({
        population:   pop.label,
        pop_type:     pop.type,
        sample_size:  total,
        allele1:      a1key || null,
        allele1_freq: a1f,
        allele2:      a2key || null,
        allele2_freq: a2f,
        geno_hom1:    hom1,
        geno_het:     het,
        geno_hom2:    hom2,
      });
    }

  // Sort: Total first, then subs alphabetically
  rows.sort((a, b) => {
    if (a.pop_type === "Total") return -1;
    if (b.pop_type === "Total") return 1;
    return a.population.localeCompare(b.population);
  });

  return rows;
}

// Standalone fetch-and-parse — used by callers (e.g. the individual "Pop"
// rescan) that don't already have an NCBI JSON response lying around. Prefer
// reusing parseAlfaJsonFreqs() directly when you already fetched the JSON
// for something else (see POST /api/snp/lookup) to avoid a duplicate fetch.
async function fetchNcbiFreqs(rsid, env) {
  const numId = rsid.replace(/^rs/i, "");
  try {
    const r = await fetch(
      `https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/${numId}`,
      { headers: { "Accept": "application/json", "User-Agent": "genetics.jdge.cc" } }
    );
    if (!r.ok) return await fetchNcbiFreqsFromHtml(rsid);
    const data = await r.json();

    // A 200 response doesn't guarantee ALFA data — plenty of SNPs come back
    // with only other studies (dbGaP_PopFreq, 1000Genomes, etc.) and zero
    // "ALFA:"-prefixed entries, silently producing nothing here. Same
    // fallback as an outright failure in that case.
    const rows = parseAlfaJsonFreqs(data);
    if (!rows.length) return await fetchNcbiFreqsFromHtml(rsid);
    return rows;
  } catch (e) {
    console.error("NCBI fetch error:", e.message);
    return await fetchNcbiFreqsFromHtml(rsid);
  }
}

async function storeFreqs(rsid, rows, env) {
  // Full replace, not a partial upsert — the frequency source has changed
  // more than once (JSON API vs HTML scrape label the same row differently,
  // e.g. "Global" vs "Total"), so a plain INSERT OR REPLACE keyed on
  // (rsid, population) can leave orphaned rows from an older run sitting
  // alongside fresh ones under a different population name. Clear first.
  await env.genetic.prepare(`DELETE FROM snp_pop WHERE rsid = ?`).bind(rsid).run();
  for (const row of rows) {
    await env.genetic.prepare(`
      INSERT OR REPLACE INTO snp_pop
        (rsid, population, pop_type, sample_size,
         allele1, allele1_freq, allele2, allele2_freq,
         geno_hom1, geno_het, geno_hom2)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      rsid, row.population, row.pop_type, row.sample_size,
      row.allele1, row.allele1_freq, row.allele2, row.allele2_freq,
      row.geno_hom1, row.geno_het, row.geno_hom2
    ).run();
  }
}

// ── Auto-search PubMed + Semantic Scholar for a given rsID ──
function authorsToStr(names) {
  if (!names || !names.length) return null;
  const shown = names.slice(0, 3);
  return shown.join(", ") + (names.length > 3 ? " et al." : "");
}

function truncate(str, n) {
  if (!str) return null;
  const s = String(str).trim();
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}

// PID = persistent identifier, the umbrella term — DOI (10.xxxx/yyyy, the
// namespace reserved for DOIs within the Handle System) resolves via
// doi.org; anything else (e.g. Handle/HDL-format ids from theses/repository
// items) resolves via hdl.handle.net.
function pidUrl(pid) {
  if (!pid) return null;
  return /^10\.\d{4,9}\//.test(pid) ? `https://doi.org/${pid}` : `https://hdl.handle.net/${pid}`;
}

async function fetchPubmedAbstracts(pmids, env) {
  try {
    const xml = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&rettype=abstract&retmode=xml&id=${pmids.join(",")}`,
      { headers: { "User-Agent": "genetics.jdge.cc" } }
    ).then(r => r.ok ? r.text() : "");
    const map = {};
    const blocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
    for (const block of blocks) {
      const pmidM = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
      if (!pmidM) continue;
      const abs = (block.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, "").trim())
        .join(" ");
      if (abs) map[pmidM[1]] = abs;
    }
    return map;
  } catch (e) {
    console.error("PubMed abstract fetch error:", e.message);
    return {};
  }
}

async function fetchAutoStudies(rsid, env) {
  const term = `"${rsid}"`;
  const results = [];

  // PubMed
  try {
    const search = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=${encodeURIComponent(term)}`,
      { headers: { "User-Agent": "genetics.jdge.cc" } }
    ).then(r => r.ok ? r.json() : null);
    const pmids = search?.esearchresult?.idlist || [];
    if (pmids.length) {
      const [summary, abstracts] = await Promise.all([
        fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}`,
          { headers: { "User-Agent": "genetics.jdge.cc" } }).then(r => r.ok ? r.json() : null),
        fetchPubmedAbstracts(pmids, env),
      ]);
      for (const uid of (summary?.result?.uids || pmids)) {
        const rec = summary?.result?.[uid];
        if (!rec) continue;
        const yearM = (rec.pubdate || "").match(/\d{4}/);
        results.push({
          title:   rec.title || null,
          authors: authorsToStr((rec.authors || []).map(a => a.name)),
          year:    yearM ? parseInt(yearM[0]) : null,
          url:     `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
          pid:     rec.articleids?.find(a => a.idtype === "doi")?.value || null,
          snippet: truncate(abstracts[uid], 500) || rec.title || null,
        });
      }
    }
  } catch (e) { console.error("PubMed auto-search error:", e.message); }

  // Semantic Scholar
  try {
    const r = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(rsid)}&fields=title,year,abstract,authors,externalIds&limit=20`,
      { headers: { "User-Agent": "genetics.jdge.cc" } }
    );
    if (r.ok) {
      const data = await r.json();
      for (const p of (data.data || [])) {
        const pid = p.externalIds?.DOI || null;
        results.push({
          title:   p.title || null,
          authors: authorsToStr((p.authors || []).map(a => a.name)),
          year:    p.year || null,
          url:     pidUrl(pid) || (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : null),
          pid,
          snippet: truncate(p.abstract, 500) || p.title || null,
        });
      }
    }
  } catch (e) { console.error("Semantic Scholar auto-search error:", e.message); }

  return results.filter(s => s.title && s.url);
}

// Domains this site already treats as standard per-variant/per-gene
// reference databases (linked directly from every SNP page) rather than
// primary literature — Brave reliably surfaces these for any rsID/gene
// query, but they're never a "study" worth reviewing, so Discover scans
// filter them out.
const DISCOVER_EXCLUDED_HOSTS = new Set([
  "www.snpedia.com", "snpedia.com",
  "www.genecards.org", "genecards.org",
  "www.omim.org", "omim.org",
  "gnomad.broadinstitute.org",
  "varsome.com",
  "databases.lovd.nl",
  "www.ebi.ac.uk",
  "platform.opentargets.org", "genetics.opentargets.org",
  "rgd.mcw.edu",
  "app.researchrabbit.ai", "www.researchrabbitapp.com",
  "scholar.google.com",
  "en.wikipedia.org", "wikipedia.org",
  // Other gene/variant reference databases — never a study, same reasoning
  // as everything above.
  "www.proteinatlas.org", "proteinatlas.org",
  "www.fulgentgenetics.com", "fulgentgenetics.com",
  "medlineplus.gov",
  "www.ensembl.org", "ensembl.org",
  "www.uniprot.org", "uniprot.org",
  "genome.ucsc.edu",
  "www.pharmgkb.org", "pharmgkb.org",
  "www.malacards.org", "malacards.org",
  // Other model-organism databases, same category as RGD but for other species.
  "informatics.jax.org",
  "flybase.org",
  "wormbase.org",
  "zfin.org",
  "yeastgenome.org",
]);

function isExcludedDiscoverResult(resUrl) {
  let u;
  try { u = new URL(resUrl); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (DISCOVER_EXCLUDED_HOSTS.has(host)) return true;
  // NCBI hosts both reference databases (dbSNP/ClinVar/Gene — exclude) and
  // actual papers (PubMed/PMC — keep), so this one needs a path check.
  if (host.endsWith("ncbi.nlm.nih.gov")) return /^\/(snp|clinvar|gene|omim)\b/i.test(u.pathname);
  // ScienceDirect hosts both Elsevier's auto-generated "Topics" aggregator
  // pages (exclude) and actual individual studies (keep) — path check too.
  if (host === "www.sciencedirect.com" || host === "sciencedirect.com") return /^\/topics\//i.test(u.pathname);
  return false;
}

// Broad open-web search (as opposed to the scholarly-index-only PubMed/
// Semantic Scholar auto-search above) — used by the admin Discover tab for
// manual, per-SNP "find me things I don't already have" scans. Requires a
// Brave Search API subscription token set as the BRAVE_API_KEY secret.
// One row per (service, year_month) in the existing api_usage table —
// (service, year_month) is a real composite primary key there (confirmed
// via PRAGMA table_info), so this can be a proper atomic upsert rather than
// a read-then-write.
async function logApiUsage(env, service) {
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  await env.genetic.prepare(`
    INSERT INTO api_usage (service, year_month, count) VALUES (?, ?, 1)
    ON CONFLICT(service, year_month) DO UPDATE SET count = count + 1
  `).bind(service, yearMonth).run();
}

async function fetchBraveResults(query, env) {
  if (!env.BRAVE_API_KEY) throw new Error("BRAVE_API_KEY not configured");
  await logApiUsage(env, "brave");
  const r = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=15`,
    { headers: { "Accept": "application/json", "X-Subscription-Token": env.BRAVE_API_KEY } }
  );
  if (!r.ok) throw new Error(`Brave Search API ${r.status}`);
  const data = await r.json();
  return (data.web?.results || [])
    .map(res => ({
      title: res.title || null,
      url: res.url || null,
      // Brave wraps matched query terms in <strong> tags in both fields.
      description: (res.description || "").replace(/<\/?strong>/g, ""),
    }))
    .filter(res => res.title && res.url && !isExcludedDiscoverResult(res.url));
}

async function insertAutoStudies(gene_name, rsid, env) {
  const candidates = await fetchAutoStudies(rsid, env);
  let inserted = 0;
  for (const c of candidates) {
    const dupe = await env.genetic.prepare(
      `SELECT 1 FROM studies WHERE rsid = ? AND (url = ? OR (pid IS NOT NULL AND pid = ?)) LIMIT 1`
    ).bind(rsid, c.url, c.pid).first();
    if (dupe) continue;
    await env.genetic.prepare(`
      INSERT INTO studies (gene_name, rsid, snippet, authors, title, url, pid, year, used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).bind(gene_name.toUpperCase(), rsid, c.snippet, c.authors, c.title, c.url, c.pid, c.year).run();
    inserted++;
  }
  return inserted;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function checkAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token  = header.replace(/^Bearer\s+/i, "").trim();
  return token === env.AUTH;
}

// IP-based brute-force throttle on top of checkAuth(), independent of any
// Cloudflare dashboard config — travels with the codebase. Sliding window:
// once an IP racks up AUTH_RATE_LIMIT_MAX failures within the window, further
// attempts are rejected with 429 (no password check even performed) until
// enough of those failures age out of the window.
const AUTH_RATE_LIMIT_MAX = 10;
const AUTH_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

async function checkAuthRateLimited(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const windowStart = Date.now() - AUTH_RATE_LIMIT_WINDOW_MS;

  // Prune this IP's stale rows so the table doesn't grow unbounded.
  await env.genetic.prepare(
    `DELETE FROM auth_attempts WHERE ip = ? AND created_at < ?`
  ).bind(ip, windowStart).run();

  const row = await env.genetic.prepare(
    `SELECT COUNT(*) AS n FROM auth_attempts WHERE ip = ? AND created_at >= ?`
  ).bind(ip, windowStart).first();

  if ((row?.n || 0) >= AUTH_RATE_LIMIT_MAX) return { ok: false, limited: true };

  const ok = checkAuth(request, env);
  if (!ok) {
    await env.genetic.prepare(
      `INSERT INTO auth_attempts (ip, created_at) VALUES (?, ?)`
    ).bind(ip, Date.now()).run();
  }
  return { ok, limited: false };
}

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

// A bare, uncaught exception anywhere below normally surfaces as a
// contentless framework 500 — nothing for the frontend toast to show and
// nothing in the response to diagnose from. This wrapper catches that and
// returns the real error message instead.
export async function onRequest(ctx) {
  try {
    return await handleApiRequest(ctx);
  } catch (e) {
    console.error("Unhandled API error:", e.stack || e.message);
    return err(e.message || "Internal error", 500);
  }
}

async function handleApiRequest({ request, env }) {
  const url      = new URL(request.url);
  const method   = request.method.toUpperCase();
  const segments = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route    = segments[0] || "";
  const param    = segments[1] || "";

  // OPTIONS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization",
      },
    });
  }

  // ── GET /api/personal?gene=NAME or ?rsid=RSID ────
  // Auth-gated (unlike the other GETs below) — this is the one place the
  // public site fetches personal alleles/notes, on demand, client-side.
  if (method === "GET" && route === "personal") {
    const auth = await checkAuthRateLimited(request, env);
    if (auth.limited) return err("Too many failed attempts — try again later.", 429);
    if (!auth.ok) return err("Unauthorised", 401);
    const gene = url.searchParams.get("gene");
    const rsid = url.searchParams.get("rsid");
    if (gene) {
      const { results } = await env.genetic.prepare(
        `SELECT rsid, alleles, notes FROM personal WHERE gene_name = ?`
      ).bind(gene.toUpperCase()).all();
      return json({ personal: results || [] });
    }
    if (rsid) {
      const row = await env.genetic.prepare(
        `SELECT rsid, alleles, notes FROM personal WHERE rsid = ?`
      ).bind(rsid).first();
      return json({ personal: row || null });
    }
    return err("gene or rsid required");
  }

  // ── GET /api/groups ──────────────────────────────
  if (method === "GET" && route === "groups") {
    const { results } = await env.genetic.prepare(
      `SELECT * FROM topics ORDER BY name ASC`
    ).all();
    return json({ groups: results });
  }

  // ── GET /api/diseases ─────────────────────────────
  if (method === "GET" && route === "diseases") {
    const { results } = await env.genetic.prepare(`
      SELECT d.*, COUNT(DISTINCT sd.rsid) AS snp_count
      FROM diseases d LEFT JOIN snp_diseases sd ON sd.disease_id = d.id
      GROUP BY d.id ORDER BY d.name ASC
    `).all();
    return json({ diseases: results });
  }

  // ── GET /api/snps ────────────────────────────────
  if (method === "GET" && route === "snps") {
    const { results } = await env.genetic.prepare(`
      SELECT p.gene_name, p.rsid, p.alleles, s.rr_url, s.scholar_scanned_at,
             (SELECT COUNT(*) FROM snp_pop WHERE snp_pop.rsid = p.rsid) AS pop_count,
             (SELECT GROUP_CONCAT(disease_id) FROM snp_diseases WHERE snp_diseases.rsid = p.rsid) AS disease_ids
      FROM personal p LEFT JOIN snps s ON s.rsid = p.rsid
      ORDER BY p.gene_name, p.rsid
    `).all();
    return json({ snps: results || [] });
  }

  // ── GET /api/snps/incomplete ─────────────────────
  // For the quick "fill true gaps" backfill — chromosome/position/
  // ref_allele/alt_allele/consequence should always be derivable for any
  // real SNP, unlike protein_change (genuinely null for non-coding variants)
  // or summary (only exists if SNPedia has a page), which are excluded here
  // so this doesn't keep re-flagging SNPs that are actually complete.
  if (method === "GET" && route === "snps" && param === "incomplete") {
    const { results } = await env.genetic.prepare(`
      SELECT p.gene_name, p.rsid
      FROM personal p
      LEFT JOIN snps s ON s.rsid = p.rsid
      WHERE s.rsid IS NULL
         OR s.chromosome IS NULL
         OR s.position IS NULL
         OR s.ref_allele IS NULL
         OR s.alt_allele IS NULL
         OR s.consequence IS NULL
         OR s.has_clinvar IS NULL
         OR s.has_snpedia IS NULL
         OR NOT EXISTS (SELECT 1 FROM snp_pop WHERE snp_pop.rsid = p.rsid)
      ORDER BY p.gene_name, p.rsid
    `).all();
    return json({ snps: results || [] });
  }

  // ── GET /api/genes ───────────────────────────────
  if (method === "GET" && route === "genes") {
    const { results } = await env.genetic.prepare(`
      SELECT gi.*, tg.id AS group_id, tg.name AS group_name,
             (SELECT GROUP_CONCAT(disease_id) FROM gene_diseases WHERE gene_diseases.gene_name = gi.gene_name) AS disease_ids
      FROM genes gi
      LEFT JOIN gene_topics gg ON gi.gene_name = gg.gene_name
      LEFT JOIN topics tg ON gg.group_id = tg.id
      ORDER BY gi.gene_name ASC
    `).all();
    return json({ genes: results });
  }

  // ── GET /api/gene/:name ──────────────────────────
  if (method === "GET" && route === "gene" && param) {
    const name = param.toUpperCase();
    const [info, groups, studies, snps] = await Promise.all([
      env.genetic.prepare(`SELECT * FROM genes WHERE gene_name = ?`).bind(name).first(),
      env.genetic.prepare(`
        SELECT tg.* FROM topics tg
        JOIN gene_topics gg ON tg.id = gg.group_id
        WHERE gg.gene_name = ?
      `).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC`).bind(name).all(),
      env.genetic.prepare(`
        SELECT p.*, si.chromosome, si.position, si.ref_allele, si.alt_allele,
               si.protein_change, si.consequence, si.summary
        FROM personal p LEFT JOIN snps si ON si.rsid = p.rsid
        WHERE p.gene_name = ? ORDER BY p.rsid ASC
      `).bind(name).all(),
    ]);
    if (!info) return err("Gene not found", 404);
    return json({ info, groups: groups.results, studies: studies.results, snps: snps.results });
  }

  // ── GET /api/export/:name ────────────────────────
  if (method === "GET" && route === "export" && param) {
    const name = param.toUpperCase();
    const [studies, snps] = await Promise.all([
      env.genetic.prepare(`SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC`).bind(name).all(),
      env.genetic.prepare(`
        SELECT p.gene_name, p.rsid, p.alleles, p.notes,
               si.chromosome, si.position, si.ref_allele, si.alt_allele,
               si.protein_change, si.consequence, si.summary
        FROM personal p LEFT JOIN snps si ON si.rsid = p.rsid
        WHERE p.gene_name = ? ORDER BY p.rsid ASC
      `).bind(name).all(),
    ]);
    const rows = [];
    rows.push("type,gene_name,rsid,snippet,authors,title,url,pid,year,alleles,chromosome,position,ref_allele,alt_allele,protein_change,consequence,summary,notes");
    for (const s of studies.results || []) {
      rows.push([
        "study", s.gene_name, s.rsid, s.snippet, s.authors, s.title, s.url, s.pid, s.year,
        "", "", "", "", "", "", "", "", "",
      ].map(csvEscape).join(","));
    }
    for (const s of snps.results || []) {
      rows.push([
        "snp", s.gene_name, s.rsid, "", "", "", "", "", "",
        s.alleles, s.chromosome, s.position, s.ref_allele, s.alt_allele,
        s.protein_change, s.consequence, s.summary, s.notes,
      ].map(csvEscape).join(","));
    }
    return new Response(rows.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}_export.csv"`,
      },
    });
  }

  // ── Auth-gated writes ────────────────────────────
  {
    const auth = await checkAuthRateLimited(request, env);
    if (auth.limited) return err("Too many failed attempts — try again later.", 429);
    if (!auth.ok) return err("Unauthorised", 401);
  }

  // ── PATCH /api/gene/:name ─────────────────────────
  if (method === "PATCH" && route === "gene" && param) {
    const name = param.toUpperCase();
    const { full_name, description, maplocation, group_id, disease_ids } = await request.json();
    if (full_name || description || maplocation) {
      await env.genetic.prepare(`
        UPDATE genes
        SET full_name   = COALESCE(?, full_name),
            description = COALESCE(?, description),
            maplocation = COALESCE(?, maplocation)
        WHERE gene_name = ?
      `).bind(full_name || null, description || null, maplocation || null, name).run();
    }
    // "" (explicit clear from the radio picker's "None" option) still needs
    // to remove any existing group, so this checks for the key being present
    // at all rather than truthiness — group_id === "" must still run the
    // DELETE, just skip the re-insert.
    if (group_id !== undefined) {
      await env.genetic.prepare(`DELETE FROM gene_topics WHERE gene_name = ?`).bind(name).run();
      if (group_id) {
        await env.genetic.prepare(`INSERT OR IGNORE INTO gene_topics (gene_name, group_id) VALUES (?, ?)`).bind(name, group_id).run();
      }
    }
    // Diseases — full replacement of this gene's disease set (checkbox list
    // in the admin panel), same pattern as PATCH /api/snp/:rsid.
    if (disease_ids !== undefined) {
      await env.genetic.prepare(`DELETE FROM gene_diseases WHERE gene_name = ?`).bind(name).run();
      const ids = (disease_ids || []).map(n => parseInt(n)).filter(Boolean);
      if (ids.length) {
        await Promise.all(ids.map(id =>
          env.genetic.prepare(`INSERT INTO gene_diseases (gene_name, disease_id) VALUES (?, ?)`).bind(name, id).run()
        ));
      }
    }
    return json({ ok: true });
  }

  // ── PATCH /api/snp/:rsid ──────────────────────────
  if (method === "PATCH" && route === "snp" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    const { ref_allele, alt_allele, protein_change, consequence,
            chromosome, position, summary, rr_url, frequencies, has_clinvar, has_snpedia,
            scholar_scanned, disease_ids, alleles } = await request.json();
    // alleles is personal — which genotype was actually observed, not a
    // fact about the SNP itself — so it lives in `personal`, not `snps`.
    // Present-but-empty (alleles === "") still needs to run, so a typo can
    // be cleared back to blank instead of only ever being overwritten.
    if (alleles !== undefined) {
      await env.genetic.prepare(
        `UPDATE personal SET alleles = ? WHERE rsid = ?`
      ).bind(alleles || null, rsid).run();
    }
    if (ref_allele || alt_allele || protein_change || consequence || chromosome || position != null || summary) {
      await env.genetic.prepare(`
        INSERT INTO snps (rsid, ref_allele, alt_allele, protein_change, consequence, chromosome, position, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rsid) DO UPDATE SET
          ref_allele     = COALESCE(excluded.ref_allele, snps.ref_allele),
          alt_allele     = COALESCE(excluded.alt_allele, snps.alt_allele),
          protein_change = COALESCE(excluded.protein_change, snps.protein_change),
          consequence    = COALESCE(excluded.consequence, snps.consequence),
          chromosome     = COALESCE(excluded.chromosome, snps.chromosome),
          position       = COALESCE(excluded.position, snps.position),
          summary        = COALESCE(excluded.summary, snps.summary)
      `).bind(
        rsid, ref_allele || null, alt_allele || null, protein_change || null,
        consequence || null, chromosome || null, position || null, summary || null
      ).run();
    }
    // has_clinvar is 0/1, not text — `|| null` would wrongly null out a real
    // "checked, nothing found" 0 (same class of bug as the geno_hom1 fix
    // earlier this session). Upsert directly, no COALESCE: a fresh check
    // should always overwrite whatever was there before.
    if (has_clinvar !== undefined) {
      await env.genetic.prepare(`
        INSERT INTO snps (rsid, has_clinvar) VALUES (?, ?)
        ON CONFLICT(rsid) DO UPDATE SET has_clinvar = excluded.has_clinvar
      `).bind(rsid, has_clinvar === null ? null : (has_clinvar ? 1 : 0)).run();
    }
    if (has_snpedia !== undefined) {
      await env.genetic.prepare(`
        INSERT INTO snps (rsid, has_snpedia) VALUES (?, ?)
        ON CONFLICT(rsid) DO UPDATE SET has_snpedia = excluded.has_snpedia
      `).bind(rsid, has_snpedia === null ? null : (has_snpedia ? 1 : 0)).run();
    }
    // rr_url is set directly (not COALESCEd) so an empty string can clear it back to "no".
    // Upsert (not plain UPDATE) in case this SNP's snps row doesn't exist yet.
    if (rr_url !== undefined) {
      await env.genetic.prepare(`
        INSERT INTO snps (rsid, rr_url) VALUES (?, ?)
        ON CONFLICT(rsid) DO UPDATE SET rr_url = excluded.rr_url
      `).bind(rsid, rr_url || null).run();
    }
    // Manual "I've run the Scholar scan for this SNP" toggle — no external
    // fetch involved, just a flag (with timestamp) the admin panel flips
    // directly. Server stamps the date itself (Unix epoch ms, not text —
    // sorts naturally as a plain number) rather than trusting the client.
    if (scholar_scanned !== undefined) {
      const stamp = scholar_scanned ? Date.now() : null;
      await env.genetic.prepare(`
        INSERT INTO snps (rsid, scholar_scanned_at) VALUES (?, ?)
        ON CONFLICT(rsid) DO UPDATE SET scholar_scanned_at = excluded.scholar_scanned_at
      `).bind(rsid, stamp).run();
    }
    // Diseases — full replacement of this SNP's disease set (checkbox list
    // in the admin panel, not an incremental add/remove), so clear and
    // re-insert rather than trying to diff against what's already there.
    if (disease_ids !== undefined) {
      await env.genetic.prepare(`DELETE FROM snp_diseases WHERE rsid = ?`).bind(rsid).run();
      const ids = (disease_ids || []).map(n => parseInt(n)).filter(Boolean);
      if (ids.length) {
        await Promise.all(ids.map(id =>
          env.genetic.prepare(`INSERT INTO snp_diseases (rsid, disease_id) VALUES (?, ?)`).bind(rsid, id).run()
        ));
      }
    }
    // Population frequencies — if the caller already looked these up (the
    // admin backfill flow calls /api/snp/lookup first and forwards its
    // `frequencies` here), reuse them rather than firing a second NCBI
    // fetch for the same rsid. Only fetch fresh if none were provided at
    // all (frequencies === undefined), so a plain PATCH with no lookup
    // step still works — but an explicit [] means "already checked, found
    // nothing", not "please go fetch".
    const freqRows = frequencies !== undefined ? frequencies : await fetchNcbiFreqs(rsid, env);
    if (freqRows.length > 0) await storeFreqs(rsid, freqRows, env);
    // Every PATCH already re-checks population frequencies above (that's
    // pre-existing, not new) — stamping the timestamp here just records that
    // fact, so a genuine "checked, found nothing" can be told apart from
    // "never checked" (see pop_scanned_at usage on the public SNP page).
    await env.genetic.prepare(`
      INSERT INTO snps (rsid, pop_scanned_at) VALUES (?, ?)
      ON CONFLICT(rsid) DO UPDATE SET pop_scanned_at = excluded.pop_scanned_at
    `).bind(rsid, Date.now()).run();
    return json({ ok: true, frequencies_fetched: freqRows.length, frequencies: freqRows });
  }

  // ── DELETE /api/snp/:rsid ────────────────────────
  if (method === "DELETE" && route === "snp" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    await Promise.all([
      env.genetic.prepare(`DELETE FROM personal WHERE rsid = ?`).bind(rsid).run(),
      env.genetic.prepare(`DELETE FROM snp_pop  WHERE rsid = ?`).bind(rsid).run(),
      env.genetic.prepare(`DELETE FROM snps     WHERE rsid = ?`).bind(rsid).run(),
    ]);
    return json({ ok: true });
  }

  // ── POST /api/group ──────────────────────────────
  if (method === "POST" && route === "group" && !param) {
    const { name, description } = await request.json();
    if (!name) return err("name required");
    await env.genetic.prepare(
      `INSERT INTO topics (name, description) VALUES (?, ?)`
    ).bind(name.trim(), description || null).run();
    return json({ ok: true });
  }

  // ── POST /api/group/description ───────────────────
  if (method === "POST" && route === "group" && param === "description") {
    const { name } = await request.json();
    if (!name) return err("name required");

    // No longer splits on ./!/? — that treated abbreviations and initials
    // (e.g. a middle initial like "A.") as sentence ends, cutting text off
    // mid-name. Just a plain character cap, snapped to the last full word.
    const trimDesc = text => {
      const max = 280;
      if (text.length <= max) return text.trim();
      const cut = text.slice(0, max);
      const lastSpace = cut.lastIndexOf(" ");
      return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + "…";
    };

    // Brave's Answers model writes in markdown (**bold**, headers, bullet
    // lists, links) — this is a plain-text description field, not a
    // renderer, so strip the formatting rather than showing the markup.
    const stripMarkdown = s => s
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/_(.*?)_/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Diagnostic trail — every step reports what it actually saw instead of
    // silently swallowing errors, so a "no description found" result can be
    // debugged from the response itself rather than guessed at blind.
    const debug = { bravePresent: !!env.BRAVE_API_AI_KEY };

    // 1. Brave Answers — the old Summarizer flow (2-step: search then
    // resolve a summarizer key) is on Brave's discontinued Pro AI plan.
    // Answers is the current product: a single chat-completions-style call,
    // gated to its own "Answers" plan, using a separate key (BRAVE_API_AI_KEY)
    // from the plain BRAVE_API_KEY used for Discover. The response embeds
    // <citation>/<enum_item>/<usage> tags with JSON inside the message
    // content, which get stripped out to leave plain prose.
    if (env.BRAVE_API_AI_KEY) {
      try {
        await logApiUsage(env, "brave_ai");
        const chatRes = await fetch(
          "https://api.search.brave.com/res/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-subscription-token": env.BRAVE_API_AI_KEY,
            },
            body: JSON.stringify({
              model: "brave",
              stream: false,
              messages: [{ role: "user", content: `Summarise the following topic in 30 words or less: "${name}"` }],
            }),
          }
        );
        debug.braveStatus = chatRes.status;
        const chat = chatRes.ok ? await chatRes.json() : null;
        const raw = chat?.choices?.[0]?.message?.content || "";
        const text = stripMarkdown(raw.replace(/<(citation|enum_item|usage)>[\s\S]*?<\/\1>/g, "")).replace(/\s+/g, " ").trim();
        debug.braveTextLength = text.length;
        if (text) return json({ description: trimDesc(text), source: "brave", debug });
      } catch (e) { debug.braveError = e.message; }
    }

    // 2. DuckDuckGo Instant Answer
    try {
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(name)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { "User-Agent": "genetics.jdge.cc/bot" } }
      );
      debug.ddgStatus = ddgRes.status;
      const ddg = ddgRes.ok ? await ddgRes.json() : null;
      const text = ddg?.AbstractText?.trim();
      debug.ddgTextLength = text ? text.length : 0;
      if (text) return json({ description: trimDesc(text), source: "duckduckgo", debug });
    } catch (e) { debug.ddgError = e.message; }

    // 3. Wikipedia REST API fallback
    try {
      const title = name.replace(/\s+/g, "_");
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { "User-Agent": "genetics.jdge.cc/bot" } }
      );
      debug.wikiStatus = wikiRes.status;
      const wiki = wikiRes.ok ? await wikiRes.json() : null;
      const text = wiki?.extract?.trim();
      debug.wikiTextLength = text ? text.length : 0;
      if (text) return json({ description: trimDesc(text), source: "wikipedia", debug });
    } catch (e) { debug.wikiError = e.message; }

    return json({ description: null, debug });
  }

  // ── POST /api/gene/lookup ────────────────────────
  if (method === "POST" && route === "gene" && param === "lookup") {
    const { gene_name: rawGene } = await request.json();
    if (!rawGene) return err("gene_name required");
    const sym = rawGene.trim().toUpperCase();

    const searchRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&term=${encodeURIComponent(sym + "[sym] AND Homo sapiens[Organism]")}&retmode=json`,
      { headers: { "User-Agent": "genetics.jdge.cc" } }
    ).then(r => r.ok ? r.json() : null);

    const geneId = searchRes?.esearchresult?.idlist?.[0];
    if (!geneId) return err("Gene not found on NCBI", 404);

    const summaryRes = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${geneId}&retmode=json`,
      { headers: { "User-Agent": "genetics.jdge.cc" } }
    ).then(r => r.ok ? r.json() : null);

    const info = summaryRes?.result?.[geneId];
    if (!info) return err("Gene summary not found", 404);

    const titleCase = s => s ? s.replace(/\b\w/g, c => c.toUpperCase()) : null;

    return json({
      gene_name:   sym,
      full_name:   titleCase(info.description) || null,
      description: info.summary     || null,
      maplocation: info.maplocation || null,
    });
  }

  // ── POST /api/gene ───────────────────────────────
  if (method === "POST" && route === "gene" && !param) {
    const { gene_name, full_name, description, group_id, maplocation, disease_ids } = await request.json();
    if (!gene_name) return err("gene_name required");
    const name = gene_name.toUpperCase();
    await env.genetic.prepare(
      `INSERT OR IGNORE INTO genes (gene_name, full_name, description, maplocation) VALUES (?, ?, ?, ?)`
    ).bind(name, full_name, description || null, maplocation || null).run();
    if (group_id) {
      await env.genetic.prepare(
        `INSERT OR IGNORE INTO gene_topics (gene_name, group_id) VALUES (?, ?)`
      ).bind(name, group_id).run();
    }
    const ids = (disease_ids || []).map(n => parseInt(n)).filter(Boolean);
    if (ids.length) {
      await Promise.all(ids.map(id =>
        env.genetic.prepare(`INSERT OR IGNORE INTO gene_diseases (gene_name, disease_id) VALUES (?, ?)`).bind(name, id).run()
      ));
    }
    return json({ ok: true, gene_name: name });
  }

  // ── GET /api/brave-usage ──────────────────────────
  // Reads this calendar month's rows from api_usage, to track against
  // Brave's own monthly quota reset. Auth-gated (below the blanket check
  // above) since it's usage/billing-adjacent info, not public.
  if (method === "GET" && route === "brave-usage") {
    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const { results } = await env.genetic.prepare(
      `SELECT service, count FROM api_usage WHERE year_month = ? AND service IN ('brave', 'brave_ai')`
    ).bind(yearMonth).all();
    const usage = { brave: 0, brave_ai: 0 };
    for (const row of results || []) usage[row.service] = row.count;
    return json({ usage, year_month: yearMonth });
  }

  // ── POST /api/disease ─────────────────────────────
  if (method === "POST" && route === "disease" && !param) {
    const { name, description } = await request.json();
    if (!name) return err("name required");
    const trimmed = name.trim();
    // Case-insensitive check ahead of the DB-level unique index, so a
    // near-miss like "gilbert syndrome" vs "Gilbert Syndrome" gets a clear
    // message instead of a raw SQLite constraint error.
    const dupe = await env.genetic.prepare(
      `SELECT id FROM diseases WHERE name = ? COLLATE NOCASE`
    ).bind(trimmed).first();
    if (dupe) return err(`Disease "${trimmed}" already exists.`);
    const result = await env.genetic.prepare(
      `INSERT INTO diseases (name, description) VALUES (?, ?)`
    ).bind(trimmed, description || null).run();
    return json({ ok: true, id: result.meta.last_row_id });
  }

  // ── PATCH /api/disease/:id ────────────────────────
  if (method === "PATCH" && route === "disease" && param) {
    const id = parseInt(param);
    if (!id) return err("invalid id");
    const { name, description } = await request.json();
    if (!name) return err("name required");
    const trimmed = name.trim();
    const dupe = await env.genetic.prepare(
      `SELECT id FROM diseases WHERE name = ? COLLATE NOCASE AND id != ?`
    ).bind(trimmed, id).first();
    if (dupe) return err(`Disease "${trimmed}" already exists.`);
    await env.genetic.prepare(
      `UPDATE diseases SET name = ?, description = ? WHERE id = ?`
    ).bind(trimmed, description || null, id).run();
    return json({ ok: true });
  }

  // ── DELETE /api/disease/:id ───────────────────────
  if (method === "DELETE" && route === "disease" && param) {
    const id = parseInt(param);
    if (!id) return err("invalid id");
    await Promise.all([
      env.genetic.prepare(`DELETE FROM diseases      WHERE id = ?`).bind(id).run(),
      env.genetic.prepare(`DELETE FROM snp_diseases  WHERE disease_id = ?`).bind(id).run(),
      env.genetic.prepare(`DELETE FROM gene_diseases WHERE disease_id = ?`).bind(id).run(),
    ]);
    return json({ ok: true });
  }

  // ── PATCH /api/group/:id ─────────────────────────
  if (method === "PATCH" && route === "group" && param) {
    const id = parseInt(param);
    if (!id) return err("invalid id");
    const { name, description } = await request.json();
    if (!name) return err("name required");
    await env.genetic.prepare(
      `UPDATE topics SET name = ?, description = ? WHERE id = ?`
    ).bind(name.trim(), description || null, id).run();
    return json({ ok: true });
  }

  // ── DELETE /api/group/:id ────────────────────────
  if (method === "DELETE" && route === "group" && param) {
    const id = parseInt(param);
    if (!id) return err("invalid id");
    await Promise.all([
      env.genetic.prepare(`DELETE FROM topics      WHERE id = ?`).bind(id).run(),
      env.genetic.prepare(`DELETE FROM gene_topics WHERE topic_id = ?`).bind(id).run(),
    ]);
    return json({ ok: true });
  }

  // ── DELETE /api/gene/:name ───────────────────────
  if (method === "DELETE" && route === "gene" && param) {
    const name = param.toUpperCase();

    // snp_pop has no gene_name column (only rsid), so capture the affected
    // rsids up front rather than racing a subquery against the deletes below.
    const { results: rows } = await env.genetic.prepare(
      `SELECT rsid FROM personal WHERE gene_name = ?`
    ).bind(name).all();
    const rsids = (rows || []).map(r => r.rsid);

    await Promise.all([
      env.genetic.prepare(`DELETE FROM genes         WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM gene_topics   WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM gene_diseases WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM personal      WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM studies       WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM snps          WHERE gene_name = ?`).bind(name).run(),
      ...rsids.map(rsid => env.genetic.prepare(`DELETE FROM snp_pop WHERE rsid = ?`).bind(rsid).run()),
    ]);
    return json({ ok: true, deleted: name });
  }

  // ── POST /api/snp/lookup ─────────────────────────────
  if (method === "POST" && route === "snp" && param === "lookup") {
    const { rsid: rawRsid } = await request.json();
    if (!rawRsid) return err("rsid required");
    const rsid  = /^rs/i.test(rawRsid) ? rawRsid : "rs" + rawRsid;
    const numId = rsid.replace(/^rs/i, "");

    const [ncbiRes, snpediaRes, clinvarRes] = await Promise.allSettled([
      fetch(`https://api.ncbi.nlm.nih.gov/variation/v0/refsnp/${numId}`, {
        headers: { Accept: "application/json", "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
      fetch(`https://www.snpedia.com/api.php?action=query&prop=revisions&titles=${rsid}&rvprop=content&rvslots=main&format=json`, {
        headers: { "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
      // Stored (not checked live per page view) so the public SNP page can
      // show the ClinVar link only when there's actually something there,
      // without an extra API call on every visit.
      fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&retmode=json&term=${encodeURIComponent(rsid)}`, {
        headers: { "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
    ]);
    const clinvarData = clinvarRes.status === "fulfilled" ? clinvarRes.value : null;
    const has_clinvar = (parseInt(clinvarData?.esearchresult?.count) || 0) > 0 ? 1 : 0;

    // Parse NCBI
    let gene_name = null, chromosome = null, consequence = null, protein_change = null;
    let ref_allele = null, alt_allele = null, position = null;
    const genes_found = [];
    const ncbi = ncbiRes.status === "fulfilled" ? ncbiRes.value : null;
    if (ncbi) {
      // NCBI returns a SEPARATE allele_annotations entry per observed allele,
      // including the reference allele itself — whose SPDI is always
      // deleted===inserted (a no-op "change"), and often has no
      // sequence_ontology either. Confirmed for rs4148356: the first ABCC1
      // entry encountered is the reference (R->R, empty SO); the real R->Q
      // missense change only shows up in a LATER entry for the same gene.
      // Merge into the existing entry for a gene instead of skipping once
      // seen once, so a later, more complete entry can still fill the gaps.
      const anns = ncbi?.primary_snapshot_data?.allele_annotations || [];
      for (const ann of anns) {
        for (const asm of (ann.assembly_annotation || [])) {
          for (const gene of (asm.genes || [])) {
            if (!gene.locus) continue;
            let entry = genes_found.find(g => g.name === gene.locus);
            if (!entry) {
              entry = { name: gene.locus, consequence: null, protein_change: null };
              genes_found.push(entry);
            }
            if (!entry.consequence) {
              entry.consequence = gene.sequence_ontology?.[0]?.name?.replace(/_/g, " ") ?? null;
            }
            if (!entry.protein_change) {
              for (const rna of (gene.rnas || [])) {
                const spdi = rna?.protein?.variant?.spdi;
                if (spdi?.deleted_sequence && spdi?.inserted_sequence
                    && spdi.deleted_sequence !== spdi.inserted_sequence
                    && spdi.position != null) {
                  entry.protein_change = `${aminoAcidName(spdi.deleted_sequence)} ${spdi.position + 1} → ${aminoAcidName(spdi.inserted_sequence)}`;
                  break;
                }
              }
            }
          }
        }
      }
      if (genes_found.length) {
        gene_name      = genes_found[0].name;
        consequence    = genes_found[0].consequence;
        protein_change = genes_found[0].protein_change;
      }
      for (const pl of (ncbi?.primary_snapshot_data?.placements_with_allele || [])) {
        const c = seqIdToChrom(pl.seq_id);
        if (c) {
          if (!chromosome) chromosome = c;
          // Extract ref and alt alleles (and exact base-pair position) from chromosome-level SPDI
          if (!ref_allele || !alt_allele) {
            for (const a of (pl.alleles || [])) {
              const spdi = a.allele?.spdi;
              if (!spdi) continue;
              if (!ref_allele) ref_allele = spdi.deleted_sequence || null;
              if (!alt_allele && spdi.deleted_sequence !== spdi.inserted_sequence) {
                alt_allele = spdi.inserted_sequence || null;
              }
              if (position == null && spdi.position != null) position = spdi.position + 1;
            }
          }
          if (chromosome && ref_allele && alt_allele) break;
        }
      }
    }

    // Fallback: scrape NCBI HTML when the JSON API is either missing gene
    // annotation entirely, OR (confirmed happening — e.g. rs119774's ABCC1
    // entry comes back with sequence_ontology: [], an empty array, not a
    // missing gene) found the gene but left consequence empty. Each sub-block
    // below only fills a field that's still actually missing, so this never
    // overwrites something the JSON path already got right.
    // ncbiHtml stays in scope below so the frequency lookup can reuse it
    // rather than firing a second fetch at the same URL — the previous
    // two-separate-fetches setup (this endpoint + PATCH /api/snp/:rsid each
    // hitting NCBI independently) was confirmed causing one or the other to
    // fail intermittently, most likely NCBI throttling rapid duplicate
    // requests to the same rsid's page.
    let ncbiHtml = null;
    if (!gene_name || !consequence) {
      ncbiHtml = await fetchNcbiHtml(rsid);
      if (ncbiHtml) {
        // Bounded to the <dd> immediately after the "Gene : Consequence" <dt>
        // — an intergenic SNP (confirmed for rs12568930) renders that <dd>
        // as just `<div class="gray">None</div>`, no <span> at all. The old
        // unbounded [\s\S]*? kept scanning past an empty/no-span <dd> into
        // the REST of the page and latched onto the first unrelated
        // "<span>...:" it found anywhere below (e.g. the page's "Added to
        // this RefSNP Cluster:" merge notice), producing a garbage gene name.
        const geneConsDd = ncbiHtml.match(/Gene\s*:\s*Consequence<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
        const geneConsBlock = geneConsDd && !/\bNone\b/i.test(geneConsDd[1]) ? geneConsDd[1] : null;
        if (!gene_name && geneConsBlock) {
          const gm = geneConsBlock.match(/<span>([^:<\s][^:<]*?)\s*:/i);
          if (gm) gene_name = gm[1].trim();
        }
        if (!consequence && geneConsBlock) {
          const cm = geneConsBlock.match(/<span>[^:]+:\s*([^<\n]+)/i);
          if (cm) consequence = cm[1].trim();
        }
        // Same fallback also recovers chromosome/position/alleles when the
        // JSON API 404s outright (happens for a real chunk of older rsIDs —
        // the classic report page still has them).
        if (!chromosome || position == null) {
          const posM = ncbiHtml.match(/<dt>Position<\/dt>[\s\S]*?<span>chr(\w+):(\d+)/i);
          if (posM) {
            if (!chromosome) chromosome = posM[1];
            if (position == null) position = parseInt(posM[2]);
          }
        }
        if (!ref_allele || !alt_allele) {
          const alleleM = ncbiHtml.match(/<dt>Alleles<\/dt>[\s\S]*?<dd>[\s\S]*?([ACGT])>([ACGT])/i);
          if (alleleM) {
            if (!ref_allele) ref_allele = alleleM[1];
            if (!alt_allele) alt_allele = alleleM[2];
          }
        }
      }
    }

    // Parse SNPedia. has_snpedia uses the MediaWiki API's own "missing"
    // marker (present on the page object when the title doesn't exist, absent
    // when it does) — standard MediaWiki behaviour, not summary-dependent, so
    // a real page with no `summary=` field still correctly counts as existing.
    let summary = null, has_snpedia = 0;
    const snpedia = snpediaRes.status === "fulfilled" ? snpediaRes.value : null;
    if (snpedia) {
      const pages = snpedia?.query?.pages || {};
      const page  = Object.values(pages)[0];
      has_snpedia = page && page.missing === undefined ? 1 : 0;
      const wikitext = page?.revisions?.[0]?.["*"]
                    || page?.revisions?.[0]?.slots?.main?.["*"] || "";
      const sumM = wikitext.match(/\|\s*[Ss]ummary\s*=\s*([^\n|{}]+)/);
      if (sumM) summary = sumM[1].trim().replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, "$1");
    }

    // Population frequencies — reuse whatever's already in hand (the JSON
    // response, or the HTML fetched above for consequence) before ever
    // firing a fresh fetch, so a lookup call costs at most one NCBI HTML
    // request total, not two.
    let frequencies = ncbi ? parseAlfaJsonFreqs(ncbi) : [];
    if (!frequencies.length) {
      if (!ncbiHtml) ncbiHtml = await fetchNcbiHtml(rsid);
      if (ncbiHtml) {
        frequencies = parsePopfreqTable(ncbiHtml);
        if (!frequencies.length) frequencies = parseDbsnpFreqTable(ncbiHtml);
      }
    }

    return json({ rsid, gene_name, gene_names: genes_found.map(g => g.name), chromosome, position, consequence, protein_change, ref_allele, alt_allele, summary, frequencies, has_clinvar, has_snpedia });
  }

  // ── POST /api/snp/clinvar-snpedia ────────────────
  // Dedicated fast path for the "Fix ClinVar + SNPedia" admin button — checks
  // and stores only these two flags, skipping the NCBI variation JSON/HTML
  // fetch entirely (that's the slow, retry-heavy, rate-limited part of a
  // normal lookup, and irrelevant to what this button needs).
  if (method === "POST" && route === "snp" && param === "clinvar-snpedia") {
    const { rsid: rawRsid } = await request.json();
    if (!rawRsid) return err("rsid required");
    const rsid = /^rs/i.test(rawRsid) ? rawRsid : "rs" + rawRsid;

    const [clinvarRes, snpediaRes] = await Promise.allSettled([
      fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&retmode=json&term=${encodeURIComponent(rsid)}`, {
        headers: { "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
      fetch(`https://www.snpedia.com/api.php?action=query&prop=revisions&titles=${rsid}&rvprop=content&rvslots=main&format=json`, {
        headers: { "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
    ]);

    const clinvarData = clinvarRes.status === "fulfilled" ? clinvarRes.value : null;
    const has_clinvar = (parseInt(clinvarData?.esearchresult?.count) || 0) > 0 ? 1 : 0;

    const snpedia = snpediaRes.status === "fulfilled" ? snpediaRes.value : null;
    let has_snpedia = 0;
    if (snpedia) {
      const page = Object.values(snpedia?.query?.pages || {})[0];
      has_snpedia = page && page.missing === undefined ? 1 : 0;
    }

    await env.genetic.prepare(`
      INSERT INTO snps (rsid, has_clinvar, has_snpedia) VALUES (?, ?, ?)
      ON CONFLICT(rsid) DO UPDATE SET has_clinvar = excluded.has_clinvar, has_snpedia = excluded.has_snpedia
    `).bind(rsid, has_clinvar, has_snpedia).run();

    return json({ ok: true, rsid, has_clinvar, has_snpedia });
  }

  // ── POST /api/snp ────────────────────────────────
  if (method === "POST" && route === "snp" && !param) {
    const { gene_name, rsid, alleles, notes,
            chromosome, position, ref_allele, alt_allele,
            protein_change, consequence, summary } = await request.json();
    if (!gene_name || !rsid) return err("gene_name and rsid required");
    const name = gene_name.toUpperCase();

    // personal — only what's specific to the individual: which alleles they carry
    await env.genetic.prepare(`
      INSERT INTO personal (gene_name, rsid, alleles, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(rsid) DO UPDATE SET
        gene_name = excluded.gene_name,
        alleles   = excluded.alleles,
        notes     = COALESCE(excluded.notes, personal.notes)
    `).bind(name, rsid, alleles || null, notes || null).run();

    // snps — facts about the SNP itself, same for anyone
    await env.genetic.prepare(`
      INSERT INTO snps (rsid, gene_name, chromosome, position, ref_allele, alt_allele, protein_change, consequence, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rsid) DO UPDATE SET
        gene_name      = excluded.gene_name,
        chromosome     = excluded.chromosome,
        position       = excluded.position,
        ref_allele     = excluded.ref_allele,
        alt_allele     = excluded.alt_allele,
        protein_change = excluded.protein_change,
        consequence    = excluded.consequence,
        summary        = excluded.summary
    `).bind(
      rsid, name, chromosome || null, position || null,
      ref_allele || null, alt_allele || null, protein_change || null,
      consequence || null, summary || null
    ).run();

    // Fetch NCBI ALFA population frequencies automatically
    const freqRows = await fetchNcbiFreqs(rsid, env);
    if (freqRows.length > 0) await storeFreqs(rsid, freqRows, env);
    await env.genetic.prepare(`
      INSERT INTO snps (rsid, pop_scanned_at) VALUES (?, ?)
      ON CONFLICT(rsid) DO UPDATE SET pop_scanned_at = excluded.pop_scanned_at
    `).bind(rsid, Date.now()).run();
    // Auto-search PubMed + Semantic Scholar for studies mentioning this rsID
    const studiesInserted = await insertAutoStudies(name, rsid, env);
    return json({ ok: true, frequencies_fetched: freqRows.length, studies_found: studiesInserted });
  }

  // ── GET /api/freqs/:rsid ──────────────────────────
  if (method === "GET" && route === "freqs" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    const { results } = await env.genetic.prepare(`
      SELECT * FROM snp_pop WHERE rsid = ?
      ORDER BY pop_type = 'Total' DESC, population ASC
    `).bind(rsid).all();
    return json({ rsid, frequencies: results || [] });
  }

  // ── POST /api/study ──────────────────────────────
  if (method === "POST" && route === "study" && !param) {
    const { gene_name, rsid, snippet, authors, title, url, pid, year, used } = await request.json();
    if (!gene_name || !snippet) return err("gene_name and snippet required");
    // Every insert path (manual "Add Study", bulk CSV import, auto-search)
    // now starts as NULL ("New") regardless — nothing is assumed curated
    // until a human explicitly promotes it via the gene page or admin.
    const usedVal = used === undefined ? null : used;
    await env.genetic.prepare(`
      INSERT INTO studies (gene_name, rsid, snippet, authors, title, url, pid, year, used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gene_name.toUpperCase(), rsid || null,
      snippet, authors || null, title || null,
      url || null, pid || null, year || null, usedVal
    ).run();
    return json({ ok: true });
  }

  // ── PATCH /api/study/:id ─────────────────────────
  // Toggles whether a study turned out to be useful for the gene it's filed
  // under (same paper can be "used" for one SNP and "unused" for another if
  // filed twice), and/or edits the study's own fields. Already covered by the
  // blanket "Auth-gated writes" check above, since this route is textually
  // below it in the same request handler.
  if (method === "PATCH" && route === "study" && param) {
    const id = parseInt(param);
    if (!id) return err("invalid id");
    const body = await request.json();
    const sets = [];
    const binds = [];
    if ("used" in body) {
      // Tri-state: null -> New, 1 -> Curated, 0 -> Unused. (A plain `used ? 1 : 0`
      // would wrongly coerce null to 0, making "revert to New" impossible.)
      const usedVal = body.used === null || body.used === undefined ? null : (body.used ? 1 : 0);
      sets.push("used = ?"); binds.push(usedVal);
    }
    for (const field of ["title", "pid", "authors", "url", "snippet"]) {
      if (field in body) {
        sets.push(`${field} = ?`);
        binds.push((body[field] || "").trim() || null);
      }
    }
    if ("year" in body) {
      sets.push("year = ?");
      binds.push(body.year === null || body.year === undefined ? null : parseInt(body.year) || null);
    }
    if (!sets.length) return err("nothing to update");
    binds.push(id);
    await env.genetic.prepare(`UPDATE studies SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds).run();
    return json({ ok: true });
  }

  // ── GET /api/studies ──────────────────────────────
  // Used by the bulk-import review table to detect duplicate papers already
  // in the DB (possibly under a different gene/rsid — the same paper often
  // covers many SNPs, but was only "useful" for one of them).
  if (method === "GET" && route === "studies") {
    const { results } = await env.genetic.prepare(
      `SELECT gene_name, rsid, title, url, pid FROM studies`
    ).all();
    return json({ studies: results || [] });
  }

  // ── GET /api/discover?rsid=&gene= ────────────────
  // Manual, per-SNP "find me studies I don't already have" scan via Brave
  // Search — a broader net than the PubMed/Semantic Scholar auto-search,
  // which only look at scholarly indexes. Returns raw candidates only; the
  // admin client cross-references against /api/studies + /api/exclusions
  // to show just what's actually new.
  if (method === "GET" && route === "discover") {
    const rsid = url.searchParams.get("rsid");
    const gene = url.searchParams.get("gene");
    if (!rsid) return err("rsid required");
    // Two passes: a bare rsID search (an rsID is specific enough on its own
    // that stray false positives are unlikely) alongside the gene/keyword-
    // qualified one, since the extra wording can filter out real studies
    // that don't happen to match that phrasing. Results are merged and
    // de-duped by URL before returning.
    const queries = [rsid, `${rsid}${gene ? " " + gene : ""} gene variant study`];
    try {
      const batches = await Promise.all(queries.map(q => fetchBraveResults(q, env)));
      const seen = new Set();
      const results = [];
      for (const res of batches.flat()) {
        const key = res.url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(res);
      }
      return json({ results });
    } catch (e) {
      return err("Brave Search error: " + e.message, 502);
    }
  }

  // ── GET /api/exclusions ───────────────────────────
  // Titles/URLs explicitly marked (via the Discover tab) as "don't show me
  // this again" — either a duplicate of something already filed, or
  // genuinely not useful (trash). Merged client-side with /api/studies to
  // filter subsequent Discover scans.
  if (method === "GET" && route === "exclusions") {
    const { results } = await env.genetic.prepare(
      `SELECT title, url, is_duplicate, is_trash FROM study_exclusions`
    ).all();
    return json({ exclusions: results || [] });
  }

  // ── POST /api/exclusion ───────────────────────────
  if (method === "POST" && route === "exclusion" && !param) {
    const { title, url: pageUrl, duplicate, trash } = await request.json();
    if (!title && !pageUrl) return err("title or url required");
    await env.genetic.prepare(`
      INSERT INTO study_exclusions (title, url, is_duplicate, is_trash)
      VALUES (?, ?, ?, ?)
    `).bind(title || null, pageUrl || null, duplicate ? 1 : 0, trash ? 1 : 0).run();
    return json({ ok: true });
  }

  return err("Not found", 404);
}
