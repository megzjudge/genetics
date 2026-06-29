/**
 * email-genetics Worker  —  v1
 *
 * Receives Google Scholar alert emails via Cloudflare Email Routing,
 * parses out each paper, tags it by the gene/SNP that triggered the
 * alert, de-dupes on the paper link, and writes into the genetic D1 database.
 *
 * Accepts mail from scholaralerts-noreply@google.com, or from addresses
 * listed in the FORWARDED_EMAILS secret (comma-separated) — so you can
 * forward old alerts in from your own inbox.
 *
 * Forwarding support: handles inline forwards and forward-as-attachment
 * from Gmail, Proton Mail, Outlook (incl. SafeLinks-rewritten URLs),
 * Apple Mail, etc. Decodes quoted-printable and base64 MIME parts in
 * their declared charset, scans every text/html part in the message,
 * and falls back to scholar_url-anchor parsing when a client rewrites
 * Scholar's markup. Plain-text-only forwards are NOT supported — the
 * paper links don't survive them. Forward as inline HTML.
 *
 * Bindings:
 *   - D1:     genetic           (env.genetic)
 *   - Secret: FORWARDED_EMAILS  (env.FORWARDED_EMAILS)
 */

const VERSION = "email-genetics v1 — genetic D1 (2026-06-30)";

// Gene names you have Scholar alerts set up for.
// Add new genes here as you create alerts.
const KNOWN_TERMS = [
  // Folate / one-carbon metabolism
  "MTHFR", "MTHFD1", "MTHFD1L", "MTHFD2", "MTHFD2L", "MTHFS",
  "MTR", "MTRR",
  "FOLR1", "FOLR2", "FOLR3",
  "SLC19A1", "SLC46A1", "SLC25A32",
  "DHFR", "FTCD", "SHMT1", "SHMT2",
  // Immune / DNA repair
  "ADA", "AK2", "CUBN", "DCLRE1C", "PNKP", "RAG1", "RAG2",
  // Transport
  "ABCC2",
];

// Map variant names, full gene names, or rsIDs to a canonical gene name.
// Add rsID → gene mappings here as you create per-SNP Scholar alerts.
const TERM_ALIASES = {
  // MTHFR common names
  "methylenetetrahydrofolate reductase": "MTHFR",
  "5,10-methylenetetrahydrofolate reductase": "MTHFR",
  // MTR
  "methionine synthase": "MTR",
  "5-methyltetrahydrofolate-homocysteine methyltransferase": "MTR",
  // MTRR
  "methionine synthase reductase": "MTRR",
  // DHFR
  "dihydrofolate reductase": "DHFR",
  // FOLR1
  "folate receptor alpha": "FOLR1",
  "folate receptor 1": "FOLR1",
  // FOLR2
  "folate receptor beta": "FOLR2",
  "folate receptor 2": "FOLR2",
  // SLC19A1
  "reduced folate carrier": "SLC19A1",
  "solute carrier family 19 member 1": "SLC19A1",
  // SLC46A1
  "proton-coupled folate transporter": "SLC46A1",
  "pcft": "SLC46A1",
  // ADA
  "adenosine deaminase": "ADA",
  // ABCC2
  "multidrug resistance protein 2": "ABCC2",
  "mrp2": "ABCC2",
};

// Canonical gene names — must match entries in KNOWN_TERMS or TERM_ALIASES values.
const CANONICAL_GENES = [
  "MTHFR", "MTHFD1", "MTHFD1L", "MTHFD2", "MTHFD2L", "MTHFS",
  "MTR", "MTRR",
  "FOLR1", "FOLR2", "FOLR3",
  "SLC19A1", "SLC46A1", "SLC25A32",
  "DHFR", "FTCD", "SHMT1", "SHMT2",
  "ADA", "AK2", "CUBN", "DCLRE1C", "PNKP", "RAG1", "RAG2",
  "ABCC2",
];

// Title-case ALL CAPS Scholar titles on intake.
const TITLE_ACRONYMS = new Set([
  "adhd", "iq", "llm", "llms", "ai", "ml", "usa", "uk", "eu",
  "pdf", "doi", "gpt", "nlp", "dna", "rna", "snp", "snps",
  "mrna", "pcr", "gwas", "mthfr", "mtr", "mtrr", "dhfr",
  "ada", "ak2", "rag1", "rag2", "phd", "covid", "hiv",
]);
const TITLE_SMALL = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on",
  "or", "the", "to", "vs", "via", "with", "from",
]);

function capTitleCore(core, idx, total) {
  if (!core) return core;
  for (const sep of ["–", "—", "-"]) {
    if (core.includes(sep)) {
      const parts = core.split(sep);
      return parts.map((p, i) => capTitleCore(p, i, parts.length)).join(sep);
    }
  }
  const low = core.toLowerCase();
  if (TITLE_ACRONYMS.has(low)) return core.toUpperCase();
  if (idx > 0 && idx < total - 1 && TITLE_SMALL.has(low)) return low;
  if (core.length === 1) return core.toUpperCase();
  return core[0].toUpperCase() + core.slice(1).toLowerCase();
}

function titleCaseFromAllCaps(title) {
  const s = (title || "").trim().toLowerCase();
  if (!s) return title;
  const parts = s.split(/(\s+)/);
  const words = parts.filter((p) => p && !/^\s+$/.test(p));
  let wi = 0;
  const out = [];
  for (const p of parts) {
    if (/^\s+$/.test(p)) { out.push(p); continue; }
    const m = p.match(/^([\"'(\[]*)(.*?)([\"')\].,:;!?™]*)$/);
    if (!m) { out.push(capTitleCore(p, wi, words.length)); wi++; continue; }
    const [, pre, core, suf] = m;
    if (core) { out.push(pre + capTitleCore(core, wi, words.length) + suf); wi++; }
    else out.push(p);
  }
  return out.join("");
}

function normalizeIntakeTitle(title) {
  const t = (title || "").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return t;
  return titleCaseFromAllCaps(t);
}

function canonicalGene(term) {
  const key = (term || "").toLowerCase().trim();
  if (!key) return "untagged";
  if (TERM_ALIASES[key]) return TERM_ALIASES[key];
  for (const g of CANONICAL_GENES) {
    if (g.toLowerCase() === key) return g;
  }
  return term.trim();
}

// Extract rsid pattern from a string (e.g. "rs1801133").
function extractRsid(text) {
  const m = (text || "").match(/\b(rs\d+)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function parseAddress(headerValue) {
  const m = headerValue.match(/<([^>]+)>/);
  return (m ? m[1] : headerValue).trim();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/backfill-links") {
      if (!env.BACKFILL_TOKEN || url.searchParams.get("token") !== env.BACKFILL_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const report = await backfillLinks(env.genetic);
        return new Response(JSON.stringify(report, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } catch (e) {
        return new Response("backfill error: " + String(e), { status: 500 });
      }
    }

    return new Response(VERSION, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },

  async email(message, env, ctx) {
    console.log(VERSION);

    const envelopeFrom = (message.from || "").toLowerCase();
    const headerFrom = parseAddress(message.headers.get("from") || "").toLowerCase();

    const allowed = (env.FORWARDED_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const SCHOLAR = "scholaralerts-noreply@google.com";
    const isScholar =
      envelopeFrom === SCHOLAR ||
      headerFrom === SCHOLAR ||
      envelopeFrom.endsWith(".bounces.google.com");
    const isForwarder = allowed.includes(envelopeFrom) || allowed.includes(headerFrom);

    console.log(
      `gate check → envelope="${envelopeFrom}" header="${headerFrom}" | secretSet=${env.FORWARDED_EMAILS !== undefined} | allowed=[${allowed.join(" | ")}]`
    );

    if (!isScholar && !isForwarder) {
      console.log(`Rejected mail (envelope="${envelopeFrom}" header="${headerFrom}")`);
      message.setReject("Sender not allowed");
      return;
    }

    try {
      if (!env.genetic) {
        console.log("Missing D1 binding env.genetic — check worker bindings.");
        return;
      }

      const raw = await streamToString(message.raw);
      const subject = message.headers.get("subject") || "";

      const htmlParts = extractHtmlBodies(raw);
      if (htmlParts.length === 0) {
        console.log("No HTML body found; skipping. (Plain-text forwards aren't supported — forward as inline HTML.)");
        return;
      }

      let papers = [];
      for (const html of htmlParts) {
        papers = papers.concat(parseScholarHtml(html));
      }
      papers = dedupeByLink(papers);

      if (papers.length === 0) {
        const first = htmlParts[0] || "";
        console.log(
          `No papers parsed from alert: ${subject} | ${htmlParts.length} html part(s), first ${first.length} chars, starts: ${first.slice(0, 100).replace(/\s+/g, " ")}`
        );
        return;
      }

      const { geneName, rsid } = deriveGeneAndRsid(subject);
      let stored = 0;
      let failed = 0;

      for (const p of papers) {
        try {
          await upsertAlert(env.genetic, p, geneName, rsid, subject);
          stored++;
        } catch (e) {
          failed++;
          console.log(
            `upsert failed (${failed}) title="${(p.title || "").slice(0, 80)}" link="${p.link || ""}": ${String(e)}`
          );
        }
      }

      console.log(
        `Ingest done: ${stored}/${papers.length} stored, ${failed} failed, gene="${geneName}" rsid="${rsid || "none"}" (subject: ${subject}).`
      );
    } catch (e) {
      console.log(`email handler error: ${String(e)}`);
    }
  },
};

/* ------------------------- parsing ------------------------- */

function parseScholarHtml(html) {
  let results = parseByH3(html);
  let via = "h3";
  if (results.length === 0) {
    results = parseByAnchors(html);
    via = "scholar_url anchors";
  }
  results = dedupeByLink(results);
  if (results.length) console.log(`Parsed ${results.length} paper(s) via ${via}.`);
  return results;
}

function parseByH3(html) {
  const results = [];
  const blocks = html.split(/<h3\b/i).slice(1);

  for (const block of blocks) {
    const chunk = "<h3" + block;

    const titleAnchor = chunk.match(/<a[^>]*href="([^"]*scholar_url[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleAnchor) continue;

    const link = unwrapLink(decodeEntities(titleAnchor[1]));
    const title = stripTags(titleAnchor[2]).trim();
    if (!title) continue;

    const meta = chunk.match(/<div[^>]*color:\s*#?00?6621[^>]*>([\s\S]*?)<\/div>/i)
      || chunk.match(/<div[^>]*green[^>]*>([\s\S]*?)<\/div>/i);
    const authors = meta ? stripTags(meta[1]).trim() : "";

    const snippetMatch = chunk.match(/<div[^>]*gse_alrt_sni[^>]*>([\s\S]*?)<\/div>/i)
      || chunk.match(/<div[^>]*>([\s\S]{40,}?)<\/div>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : "";

    results.push({ title, link, authors, snippet });
  }

  return results;
}

function parseByAnchors(html) {
  const results = [];
  const re = /<a[^>]*href="([^"]*scholar_url[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  const anchors = [];
  let m;
  while ((m = re.exec(html))) {
    anchors.push({ start: m.index, end: re.lastIndex, href: m[1], inner: m[2] });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const title = stripTags(a.inner).trim();
    if (!title || title.length < 8) continue;

    const link = unwrapLink(decodeEntities(a.href));

    const tailEnd = i + 1 < anchors.length ? anchors[i + 1].start : Math.min(a.end + 2000, html.length);
    const text = stripTags(html.slice(a.end, tailEnd)).trim();

    let authors = "";
    let snippet = text;
    const by = text.match(/^(.{0,160}?\b(?:19|20)\d{2}\b)\s*/);
    if (by) {
      authors = by[1].trim();
      snippet = text.slice(by[0].length).trim();
    }
    snippet = snippet
      .replace(/\b(Save|Twitter|LinkedIn|Facebook)\b.*$/s, "")
      .replace(/This message was sent by Google Scholar.*$/is, "")
      .replace(/Cancel alert.*$/is, "")
      .trim();

    results.push({ title, link, authors, snippet });
  }

  return results;
}

function unwrapLink(href) {
  let link = href;
  for (let i = 0; i < 4; i++) {
    let inner = null;
    try {
      inner = new URL(link).searchParams.get("url");
    } catch {
      break;
    }
    if (inner && !/^https?:\/\//i.test(inner)) {
      try { inner = decodeURIComponent(inner); } catch { /* leave as-is */ }
    }
    if (inner && /^https?:\/\//i.test(inner)) link = inner;
    else break;
  }
  return normalizeLink(link);
}

function normalizeLink(link) {
  let u;
  try { u = new URL(link); } catch { return link; }

  try {
    let decoded = u.pathname;
    for (let i = 0; i < 3 && /%[0-9A-Fa-f]{2}/.test(decoded); i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    u.pathname = encodeURI(decoded);
  } catch { /* leave path as-is on malformed encoding */ }

  const DROP = new Set([
    "dq", "ots", "sig", "ei", "scisig", "oi", "hl", "lr", "sa", "usg",
    "ved", "source", "cd", "client", "scisbd", "as_sdt", "gbv", "gbpv",
    "newbks", "redir_esc", "utm_source", "utm_medium", "utm_campaign",
    "utm_term", "utm_content", "__cf_chl_tk", "__cf_chl_rt_tk", "s",
  ]);
  for (const k of [...u.searchParams.keys()]) {
    if (DROP.has(k)) u.searchParams.delete(k);
  }

  if (/(^|\.)books\.google\./i.test(u.hostname)) {
    const id = u.searchParams.get("id");
    if (id) {
      const pg = u.searchParams.get("pg");
      const qs = pg ? `id=${id}&pg=${pg}` : `id=${id}`;
      return `${u.origin}${u.pathname}?${qs}`;
    }
  }

  const pairs = [...u.searchParams.entries()].sort(
    (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])
  );
  u.search = pairs.length
    ? "?" + pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")
    : "";

  const out = u.toString();
  return out.endsWith("?") ? out.slice(0, -1) : out;
}

// Derive the canonical gene name and any rsid from the alert subject.
function deriveGeneAndRsid(subject) {
  subject = subject.replace(/^\s*(?:(?:fwd?|fw|re)\s*:\s*)+/i, "");

  // Check for rsid in subject first
  const rsid = extractRsid(subject);

  // Extract quoted term
  const quoted = subject.match(/[""']([^""']+)[""']/);
  const termText = quoted ? quoted[1] : subject.replace(/\s*-\s*new results.*/i, "").trim();

  const matched = matchKnownTerm(termText);
  const geneName = matched ? canonicalGene(matched) : canonicalGene(termText);

  return { geneName, rsid };
}

function matchKnownTerm(text) {
  const lower = text.toLowerCase();
  for (const term of KNOWN_TERMS) {
    if (lower.includes(term.toLowerCase())) return term;
  }
  return null;
}

/* ------------------------- storage ------------------------- */

const TITLE_DEDUP_MIN_LEN = 15;

function titleKey(t) {
  return (t || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function upsertAlert(db, p, geneName, rsid, subject) {
  const title = normalizeIntakeTitle(p.title);

  // Primary de-dup on normalized link.
  await db
    .prepare(
      `INSERT INTO email_alerts (gene_name, rsid, title, authors, snippet, link, alert_subject)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(link) DO NOTHING`
    )
    .bind(geneName, rsid || null, title, p.authors, p.snippet, p.link, subject)
    .run();

  let row = await db
    .prepare(`SELECT id FROM email_alerts WHERE link = ?`)
    .bind(p.link)
    .first();

  // Secondary de-dup on title key for cross-host duplicates.
  const key = titleKey(title);
  if (key.length >= TITLE_DEDUP_MIN_LEN) {
    const existing = (await db
      .prepare(`SELECT id, title, link FROM email_alerts ORDER BY id ASC`)
      .all()).results || [];
    let twin = null;
    for (const e of existing) {
      if (titleKey(e.title) === key) { twin = e; break; }
    }
    if (twin && (!row || twin.id !== row.id)) {
      if (row && row.id !== twin.id) {
        await db.prepare(`DELETE FROM email_alerts WHERE id = ?`).bind(row.id).run();
      }
      row = twin;
    }
  }
}

/* ------------------------- maintenance ------------------------- */

async function backfillLinks(db) {
  const all = (await db.prepare(`SELECT id, link FROM email_alerts ORDER BY id ASC`).all()).results || [];

  const groups = new Map();
  for (const r of all) {
    const norm = normalizeLink(r.link || "");
    if (!groups.has(norm)) groups.set(norm, { keep: r.id, rows: [] });
    groups.get(norm).rows.push({ id: r.id, link: r.link });
  }

  let relinked = 0, merged = 0;

  for (const [norm, g] of groups) {
    const keep = g.keep;
    const dups = g.rows.filter((r) => r.id !== keep);

    for (const d of dups) {
      await db.prepare(`DELETE FROM email_alerts WHERE id = ?`).bind(d.id).run();
      merged++;
    }

    const keptRow = g.rows.find((r) => r.id === keep);
    if (keptRow && keptRow.link !== norm) {
      await db.prepare(`UPDATE email_alerts SET link = ? WHERE id = ?`).bind(norm, keep).run();
      relinked++;
    }
  }

  let titleMerged = 0;
  const survivors = (await db.prepare(`SELECT id, title FROM email_alerts ORDER BY id ASC`).all()).results || [];
  const byTitle = new Map();
  for (const r of survivors) {
    const key = titleKey(r.title);
    if (key.length < TITLE_DEDUP_MIN_LEN) continue;
    if (!byTitle.has(key)) { byTitle.set(key, r.id); continue; }
    const keepId = byTitle.get(key);
    await db.prepare(`DELETE FROM email_alerts WHERE id = ?`).bind(r.id).run();
    titleMerged++;
  }

  return {
    scanned: all.length,
    unique_after: groups.size,
    relinked,
    merged,
    title_merged: titleMerged,
    remaining: all.length - merged - titleMerged,
  };
}

/* ------------------------- MIME helpers ------------------------- */

async function streamToString(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(concat(chunks));
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function extractHtmlBodies(raw) {
  const bodies = [];
  const re = /Content-Type:\s*text\/html[^\r\n]*/gi;
  let m;
  while ((m = re.exec(raw))) {
    const chunk = raw.slice(m.index);

    const blank = chunk.match(/\r?\n\r?\n/);
    if (!blank) continue;
    const headerEnd = blank.index + blank[0].length;
    const partHeaders = chunk.slice(0, headerEnd);

    let body = chunk.slice(headerEnd);
    const end = body.search(/\r?\n--/);
    if (end !== -1) body = body.slice(0, end);

    const enc = (partHeaders.match(/Content-Transfer-Encoding:\s*([\w-]+)/i)?.[1] || "7bit").toLowerCase();
    const charset = partHeaders.match(/charset="?([A-Za-z0-9_-]+)"?/i)?.[1] || "utf-8";

    const decoded = decodePart(body, enc, charset);
    if (decoded && decoded.trim()) bodies.push(decoded);
  }

  if (bodies.length === 0 && /<html|<body|<h3|scholar_url/i.test(raw)) {
    bodies.push(raw);
  }

  return bodies;
}

function decodePart(body, enc, charset) {
  try {
    if (enc === "base64") {
      const clean = body.replace(/[^A-Za-z0-9+/=]/g, "");
      const bin = atob(clean);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return decodeCharset(bytes, charset);
    }
    if (enc === "quoted-printable") {
      const joined = body.replace(/=\r?\n/g, "");
      const bytes = [];
      for (let i = 0; i < joined.length; i++) {
        if (joined[i] === "=" && /^[0-9A-Fa-f]{2}/.test(joined.slice(i + 1, i + 3))) {
          bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          bytes.push(joined.charCodeAt(i) & 0xff);
        }
      }
      return decodeCharset(new Uint8Array(bytes), charset);
    }
    return body;
  } catch (e) {
    console.log(`part decode failed (${enc}/${charset}):`, String(e));
    return body;
  }
}

function decodeCharset(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

function dedupeByLink(arr) {
  const seen = new Set();
  return arr.filter((p) => {
    if (!p.link || seen.has(p.link)) return false;
    seen.add(p.link);
    return true;
  });
}

export { parseScholarHtml, extractHtmlBodies, unwrapLink, normalizeLink, deriveGeneAndRsid };
