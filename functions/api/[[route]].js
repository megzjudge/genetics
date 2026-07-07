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

function seqIdToChrom(seqId) {
  const m = seqId?.match(/^NC_(\d+)\./);
  if (!m) return null;
  const n = parseInt(m[1]);
  if (n >= 1 && n <= 22) return String(n);
  if (n === 23) return "X";
  if (n === 24) return "Y";
  return null;
}

async function fetchNcbiFreqs(rsid, env) {
  const numId = rsid.replace(/^rs/i, "");
  try {
    const r = await fetch(
      `https://api.ncbi.nlm.nih.gov/variation/v0/beta/refsnp/${numId}`,
      { headers: { "Accept": "application/json", "User-Agent": "genetics.jdge.cc" } }
    );
    if (!r.ok) return [];
    const data = await r.json();

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
  } catch (e) {
    console.error("NCBI fetch error:", e.message);
    return [];
  }
}

async function storeFreqs(rsid, rows, env) {
  for (const row of rows) {
    await env.genetic.prepare(`
      INSERT OR REPLACE INTO snps
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
          doi:     rec.articleids?.find(a => a.idtype === "doi")?.value || null,
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
        const doi = p.externalIds?.DOI || null;
        results.push({
          title:   p.title || null,
          authors: authorsToStr((p.authors || []).map(a => a.name)),
          year:    p.year || null,
          url:     doi ? `https://doi.org/${doi}` : (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : null),
          doi,
          snippet: truncate(p.abstract, 500) || p.title || null,
        });
      }
    }
  } catch (e) { console.error("Semantic Scholar auto-search error:", e.message); }

  return results.filter(s => s.title && s.url);
}

async function insertAutoStudies(gene_name, rsid, env) {
  const candidates = await fetchAutoStudies(rsid, env);
  let inserted = 0;
  for (const c of candidates) {
    const dupe = await env.genetic.prepare(
      `SELECT 1 FROM studies WHERE rsid = ? AND (url = ? OR (doi IS NOT NULL AND doi = ?)) LIMIT 1`
    ).bind(rsid, c.url, c.doi).first();
    if (dupe) continue;
    await env.genetic.prepare(`
      INSERT INTO studies (gene_name, rsid, snippet, authors, title, url, doi, year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(gene_name.toUpperCase(), rsid, c.snippet, c.authors, c.title, c.url, c.doi, c.year).run();
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

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function onRequest({ request, env }) {
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

  // ── GET /api/groups ──────────────────────────────
  if (method === "GET" && route === "groups") {
    const { results } = await env.genetic.prepare(
      `SELECT * FROM topics ORDER BY name ASC`
    ).all();
    return json({ groups: results });
  }

  // ── GET /api/snps ────────────────────────────────
  if (method === "GET" && route === "snps") {
    const { results } = await env.genetic.prepare(
      `SELECT gene_name, rsid, genotype, chromosome, ref_allele, alt_allele, protein_change, rr_url FROM personal ORDER BY gene_name, rsid`
    ).all();
    return json({ snps: results || [] });
  }

  // ── GET /api/genes ───────────────────────────────
  if (method === "GET" && route === "genes") {
    const { results } = await env.genetic.prepare(`
      SELECT gi.*, tg.name AS group_name
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
    const [info, groups, studies, alerts, snps] = await Promise.all([
      env.genetic.prepare(`SELECT * FROM genes WHERE gene_name = ?`).bind(name).first(),
      env.genetic.prepare(`
        SELECT tg.* FROM topics tg
        JOIN gene_topics gg ON tg.id = gg.group_id
        WHERE gg.gene_name = ?
      `).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC`).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM email_alerts WHERE gene_name = ? ORDER BY received_at DESC`).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM personal WHERE gene_name = ? ORDER BY magnitude IS NULL, magnitude DESC`).bind(name).all(),
    ]);
    if (!info) return err("Gene not found", 404);
    return json({ info, groups: groups.results, studies: studies.results, alerts: alerts.results, snps: snps.results });
  }

  // ── GET /api/export/:name ────────────────────────
  if (method === "GET" && route === "export" && param) {
    const name = param.toUpperCase();
    const [studies, snps] = await Promise.all([
      env.genetic.prepare(`SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC`).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM personal WHERE gene_name = ? ORDER BY magnitude IS NULL, magnitude DESC`).bind(name).all(),
    ]);
    const rows = [];
    rows.push("type,gene_name,rsid,snippet,authors,title,url,doi,year,genotype,chromosome,magnitude,status,notes");
    for (const s of studies.results || []) {
      rows.push([
        "study", s.gene_name, s.rsid, s.snippet, s.authors, s.title, s.url, s.doi, s.year,
        "", "", "", "", "",
      ].map(csvEscape).join(","));
    }
    for (const s of snps.results || []) {
      rows.push([
        "snp", s.gene_name, s.rsid, "", "", "", "", "", "",
        s.genotype, s.chromosome, s.magnitude, s.status, s.notes,
      ].map(csvEscape).join(","));
    }
    return new Response(rows.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}_export.csv"`,
      },
    });
  }

  // ── GET /api/alerts/unread ───────────────────────
  if (method === "GET" && route === "alerts" && param === "unread") {
    const row = await env.genetic.prepare(
      `SELECT COUNT(*) AS count FROM email_alerts WHERE read = 0`
    ).first();
    return json({ unread: row?.count ?? 0 });
  }

  // ── Auth-gated writes ────────────────────────────
  if (!checkAuth(request, env)) return err("Unauthorised", 401);

  // ── PATCH /api/gene/:name ─────────────────────────
  if (method === "PATCH" && route === "gene" && param) {
    const name = param.toUpperCase();
    const { full_name, description, maplocation, group_id } = await request.json();
    if (full_name || description || maplocation) {
      await env.genetic.prepare(`
        UPDATE genes
        SET full_name   = COALESCE(?, full_name),
            description = COALESCE(?, description),
            maplocation = COALESCE(?, maplocation)
        WHERE gene_name = ?
      `).bind(full_name || null, description || null, maplocation || null, name).run();
    }
    if (group_id) {
      await env.genetic.prepare(`DELETE FROM gene_topics WHERE gene_name = ?`).bind(name).run();
      await env.genetic.prepare(`INSERT OR IGNORE INTO gene_topics (gene_name, group_id) VALUES (?, ?)`).bind(name, group_id).run();
    }
    return json({ ok: true });
  }

  // ── PATCH /api/snp/:rsid ──────────────────────────
  if (method === "PATCH" && route === "snp" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    const { ref_allele, alt_allele, protein_change, rr_url } = await request.json();
    if (ref_allele || alt_allele || protein_change) {
      await env.genetic.prepare(`
        UPDATE personal
        SET ref_allele    = COALESCE(?, ref_allele),
            alt_allele    = COALESCE(?, alt_allele),
            protein_change = COALESCE(?, protein_change)
        WHERE rsid = ?
      `).bind(ref_allele || null, alt_allele || null, protein_change || null, rsid).run();
    }
    // rr_url is set directly (not COALESCEd) so an empty string can clear it back to "no"
    if (rr_url !== undefined) {
      await env.genetic.prepare(`UPDATE personal SET rr_url = ? WHERE rsid = ?`)
        .bind(rr_url || null, rsid).run();
    }
    return json({ ok: true });
  }

  // ── DELETE /api/snp/:rsid ────────────────────────
  if (method === "DELETE" && route === "snp" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    await Promise.all([
      env.genetic.prepare(`DELETE FROM personal WHERE rsid = ?`).bind(rsid).run(),
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

    const firstTwo = text => {
      const sentences = text.match(/[^.!?]*[.!?]+/g) || [];
      return sentences.slice(0, 2).join(" ").trim() || text.slice(0, 220).trim();
    };

    // 1. DuckDuckGo Instant Answer
    try {
      const ddg = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(name)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { "User-Agent": "genetics.jdge.cc/bot" } }
      ).then(r => r.ok ? r.json() : null).catch(() => null);
      const text = ddg?.AbstractText?.trim();
      if (text) return json({ description: firstTwo(text) });
    } catch (_) {}

    // 2. Wikipedia REST API fallback
    try {
      const title = name.replace(/\s+/g, "_");
      const wiki = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { "User-Agent": "genetics.jdge.cc/bot" } }
      ).then(r => r.ok ? r.json() : null).catch(() => null);
      const text = wiki?.extract?.trim();
      if (text) return json({ description: firstTwo(text) });
    } catch (_) {}

    return json({ description: null });
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
    const { gene_name, full_name, description, group_id, maplocation } = await request.json();
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
    return json({ ok: true, gene_name: name });
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
    await Promise.all([
      env.genetic.prepare(`DELETE FROM genes         WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM gene_topics   WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM personal      WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM studies       WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM email_alerts  WHERE gene_name = ?`).bind(name).run(),
    ]);
    return json({ ok: true, deleted: name });
  }

  // ── POST /api/snp/lookup ─────────────────────────────
  if (method === "POST" && route === "snp" && param === "lookup") {
    const { rsid: rawRsid } = await request.json();
    if (!rawRsid) return err("rsid required");
    const rsid  = /^rs/i.test(rawRsid) ? rawRsid : "rs" + rawRsid;
    const numId = rsid.replace(/^rs/i, "");

    const [ncbiRes, snpediaRes] = await Promise.allSettled([
      fetch(`https://api.ncbi.nlm.nih.gov/variation/v0/beta/refsnp/${numId}`, {
        headers: { Accept: "application/json", "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
      fetch(`https://www.snpedia.com/api.php?action=query&prop=revisions&titles=${rsid}&rvprop=content&rvslots=main&format=json`, {
        headers: { "User-Agent": "genetics.jdge.cc" },
      }).then(r => r.ok ? r.json() : null),
    ]);

    // Parse NCBI
    let gene_name = null, chromosome = null, consequence = null, protein_change = null;
    let ref_allele = null, alt_allele = null;
    const genes_found = [];
    const ncbi = ncbiRes.status === "fulfilled" ? ncbiRes.value : null;
    if (ncbi) {
      const anns = ncbi?.primary_snapshot_data?.allele_annotations || [];
      for (const ann of anns) {
        for (const asm of (ann.assembly_annotation || [])) {
          for (const gene of (asm.genes || [])) {
            if (gene.locus && !genes_found.find(g => g.name === gene.locus)) {
              const entry = {
                name:        gene.locus,
                consequence: gene.sequence_ontology?.[0]?.name?.replace(/_/g, " ") ?? null,
                protein_change: null,
              };
              for (const rna of (gene.rnas || [])) {
                const spdi = rna?.protein?.variant?.spdi;
                if (spdi?.deleted_sequence && spdi?.inserted_sequence
                    && spdi.deleted_sequence !== spdi.inserted_sequence
                    && spdi.position != null) {
                  entry.protein_change = `${spdi.deleted_sequence}${spdi.position + 1}${spdi.inserted_sequence}`;
                  break;
                }
              }
              genes_found.push(entry);
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
          // Extract ref and alt alleles from chromosome-level SPDI
          if (!ref_allele || !alt_allele) {
            for (const a of (pl.alleles || [])) {
              const spdi = a.allele?.spdi;
              if (!spdi) continue;
              if (!ref_allele) ref_allele = spdi.deleted_sequence || null;
              if (!alt_allele && spdi.deleted_sequence !== spdi.inserted_sequence) {
                alt_allele = spdi.inserted_sequence || null;
              }
            }
          }
          if (chromosome && ref_allele && alt_allele) break;
        }
      }
    }

    // Fallback: scrape NCBI HTML for upstream/near-gene variants where JSON API lacks gene annotation
    if (!gene_name) {
      const ncbiHtml = await fetch(`https://www.ncbi.nlm.nih.gov/snp/${rsid}`, {
        headers: { "User-Agent": "genetics.jdge.cc/bot", "Accept": "text/html" }
      }).then(r => r.ok ? r.text() : null).catch(() => null);
      if (ncbiHtml) {
        const gm = ncbiHtml.match(/Gene\s*:\s*Consequence<\/dt>[\s\S]*?<span>([^:<\s][^:<]*?)\s*:/i);
        if (gm) gene_name = gm[1].trim();
        if (!consequence) {
          const cm = ncbiHtml.match(/Gene\s*:\s*Consequence<\/dt>[\s\S]*?<span>[^:]+:\s*([^<\n]+)/i);
          if (cm) consequence = cm[1].trim();
        }
      }
    }

    // Parse SNPedia
    let magnitude = null, summary = null;
    const snpedia = snpediaRes.status === "fulfilled" ? snpediaRes.value : null;
    if (snpedia) {
      const pages = snpedia?.query?.pages || {};
      const page  = Object.values(pages)[0];
      const wikitext = page?.revisions?.[0]?.["*"]
                    || page?.revisions?.[0]?.slots?.main?.["*"] || "";
      const magM = wikitext.match(/\|\s*[Mm]agnitude\s*=\s*([\d.]+)/);
      if (magM) magnitude = parseFloat(magM[1]);
      const sumM = wikitext.match(/\|\s*[Ss]ummary\s*=\s*([^\n|{}]+)/);
      if (sumM) summary = sumM[1].trim().replace(/\[\[([^\]|]+)\|?[^\]]*\]\]/g, "$1");
    }

    return json({ rsid, gene_name, gene_names: genes_found.map(g => g.name), chromosome, consequence, protein_change, ref_allele, alt_allele, magnitude, summary });
  }

  // ── POST /api/snp ────────────────────────────────
  if (method === "POST" && route === "snp" && !param) {
    const { gene_name, rsid, genotype, chromosome, magnitude, status, notes,
            ref_allele, alt_allele, protein_change } = await request.json();
    if (!gene_name || !rsid) return err("gene_name and rsid required");
    await env.genetic.prepare(`
      INSERT OR REPLACE INTO personal
        (gene_name, rsid, genotype, chromosome, magnitude, status, notes, ref_allele, alt_allele, protein_change)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gene_name.toUpperCase(), rsid, genotype || null,
      chromosome || null, magnitude ?? null,
      status || "pending", notes || null,
      ref_allele || null, alt_allele || null, protein_change || null
    ).run();
    // Fetch NCBI ALFA population frequencies automatically
    const freqRows = await fetchNcbiFreqs(rsid, env);
    if (freqRows.length > 0) await storeFreqs(rsid, freqRows, env);
    // Auto-search PubMed + Semantic Scholar for studies mentioning this rsID
    const studiesInserted = await insertAutoStudies(gene_name, rsid, env);
    return json({ ok: true, frequencies_fetched: freqRows.length, studies_found: studiesInserted });
  }

  // ── GET /api/freqs/:rsid ──────────────────────────
  if (method === "GET" && route === "freqs" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    const { results } = await env.genetic.prepare(`
      SELECT * FROM snps WHERE rsid = ?
      ORDER BY pop_type = 'Total' DESC, population ASC
    `).bind(rsid).all();
    return json({ rsid, frequencies: results || [] });
  }

  // ── POST /api/study ──────────────────────────────
  if (method === "POST" && route === "study") {
    const { gene_name, rsid, snippet, authors, title, url, doi, year } = await request.json();
    if (!gene_name || !snippet) return err("gene_name and snippet required");
    await env.genetic.prepare(`
      INSERT INTO studies (gene_name, rsid, snippet, authors, title, url, doi, year)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gene_name.toUpperCase(), rsid || null,
      snippet, authors || null, title || null,
      url || null, doi || null, year || null
    ).run();
    return json({ ok: true });
  }

  return err("Not found", 404);
}
