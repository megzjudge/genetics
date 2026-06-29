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
      INSERT OR REPLACE INTO snp_frequencies
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
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization",
      },
    });
  }

  // ── GET /api/groups ──────────────────────────────
  if (method === "GET" && route === "groups") {
    const { results } = await env.genetic.prepare(
      `SELECT * FROM topic_groups ORDER BY name ASC`
    ).all();
    return json({ groups: results });
  }

  // ── GET /api/genes ───────────────────────────────
  if (method === "GET" && route === "genes") {
    const { results } = await env.genetic.prepare(`
      SELECT gi.*, tg.name AS group_name
      FROM gene_info gi
      LEFT JOIN gene_groups gg ON gi.gene_name = gg.gene_name
      LEFT JOIN topic_groups tg ON gg.group_id = tg.id
      ORDER BY gi.gene_name ASC
    `).all();
    return json({ genes: results });
  }

  // ── GET /api/gene/:name ──────────────────────────
  if (method === "GET" && route === "gene" && param) {
    const name = param.toUpperCase();
    const [info, groups, studies, alerts, snps] = await Promise.all([
      env.genetic.prepare(`SELECT * FROM gene_info WHERE gene_name = ?`).bind(name).first(),
      env.genetic.prepare(`
        SELECT tg.* FROM topic_groups tg
        JOIN gene_groups gg ON tg.id = gg.group_id
        WHERE gg.gene_name = ?
      `).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC`).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM email_alerts WHERE gene_name = ? ORDER BY received_at DESC`).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM genes WHERE gene_name = ? ORDER BY magnitude IS NULL, magnitude DESC`).bind(name).all(),
    ]);
    if (!info) return err("Gene not found", 404);
    return json({ info, groups: groups.results, studies: studies.results, alerts: alerts.results, snps: snps.results });
  }

  // ── GET /api/export/:name ────────────────────────
  if (method === "GET" && route === "export" && param) {
    const name = param.toUpperCase();
    const [studies, snps] = await Promise.all([
      env.genetic.prepare(`SELECT * FROM studies WHERE gene_name = ? ORDER BY year DESC`).bind(name).all(),
      env.genetic.prepare(`SELECT * FROM genes WHERE gene_name = ? ORDER BY magnitude IS NULL, magnitude DESC`).bind(name).all(),
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

  // ── POST /api/gene ───────────────────────────────
  if (method === "POST" && route === "gene") {
    const { gene_name, full_name, description, group_id } = await request.json();
    if (!gene_name || !full_name) return err("gene_name and full_name required");
    const name = gene_name.toUpperCase();
    await env.genetic.prepare(
      `INSERT OR IGNORE INTO gene_info (gene_name, full_name, description) VALUES (?, ?, ?)`
    ).bind(name, full_name, description || null).run();
    if (group_id) {
      await env.genetic.prepare(
        `INSERT OR IGNORE INTO gene_groups (gene_name, group_id) VALUES (?, ?)`
      ).bind(name, group_id).run();
    }
    return json({ ok: true, gene_name: name });
  }

  // ── DELETE /api/gene/:name ───────────────────────
  if (method === "DELETE" && route === "gene" && param) {
    const name = param.toUpperCase();
    await Promise.all([
      env.genetic.prepare(`DELETE FROM gene_info     WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM gene_groups   WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM genes         WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM studies       WHERE gene_name = ?`).bind(name).run(),
      env.genetic.prepare(`DELETE FROM email_alerts  WHERE gene_name = ?`).bind(name).run(),
    ]);
    return json({ ok: true, deleted: name });
  }

  // ── POST /api/snp ────────────────────────────────
  if (method === "POST" && route === "snp") {
    const { gene_name, rsid, genotype, chromosome, magnitude, status, notes } = await request.json();
    if (!gene_name || !rsid) return err("gene_name and rsid required");
    await env.genetic.prepare(`
      INSERT OR REPLACE INTO genes (gene_name, rsid, genotype, chromosome, magnitude, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      gene_name.toUpperCase(), rsid, genotype || null,
      chromosome || null, magnitude ?? null,
      status || "pending", notes || null
    ).run();
    // Fetch NCBI ALFA population frequencies automatically
    const freqRows = await fetchNcbiFreqs(rsid, env);
    if (freqRows.length > 0) await storeFreqs(rsid, freqRows, env);
    return json({ ok: true, frequencies_fetched: freqRows.length });
  }

  // ── GET /api/freqs/:rsid ──────────────────────────
  if (method === "GET" && route === "freqs" && param) {
    const rsid = /^rs/i.test(param) ? param : "rs" + param;
    const { results } = await env.genetic.prepare(`
      SELECT * FROM snp_frequencies WHERE rsid = ?
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
