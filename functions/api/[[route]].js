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
    return json({ ok: true });
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
