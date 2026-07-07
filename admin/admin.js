let TOKEN = "";
let geneList = [];
let groupList = [];
let snpList = [];

// ── Bulk study import state ───────────────────────
let bulkRawCsv = null;
let bulkGene = null, bulkRsid = null;
let bulkRows = [];

// ── Auth ──────────────────────────────────────────
function tryAuth() {
  const pw = document.getElementById("auth-input").value.trim();
  if (!pw) return;
  TOKEN = pw;
  apiFetch("/api/genes")
    .then(r => {
      if (r.ok) {
        document.getElementById("auth-gate").style.display = "none";
        init();
      } else {
        document.getElementById("auth-err").style.display = "block";
        TOKEN = "";
      }
    })
    .catch(() => {
      document.getElementById("auth-err").style.display = "block";
      TOKEN = "";
    });
}

document.getElementById("auth-input").addEventListener("keydown", e => {
  if (e.key === "Enter") tryAuth();
});

function signOut() {
  TOKEN = "";
  location.reload();
}

// ── API helpers ───────────────────────────────────
function apiFetch(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (TOKEN) opts.headers["Authorization"] = "Bearer " + TOKEN;
  return fetch(path, opts);
}

function toast(msg, err = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (err ? " err" : "");
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

// ── Init ──────────────────────────────────────────
function safeFetchJson(path) {
  return apiFetch(path)
    .then(async r => {
      if (!r.ok) throw new Error(`${path} → ${r.status}`);
      return r.json();
    })
    .catch(e => {
      console.error("Failed to load", path, e);
      toast(`Failed to load ${path}`, true);
      return null;
    });
}

function init() {
  Promise.all([
    safeFetchJson("/api/genes"),
    safeFetchJson("/api/groups"),
    safeFetchJson("/api/snps"),
  ]).then(([genes, groups, snps]) => {
    geneList  = (genes  && (genes.genes   || genes))  || [];
    groupList = (groups && (groups.groups || groups)) || [];
    snpList   = (snps   && (snps.snps     || snps))   || [];
    renderGeneTable();
    renderGroupTable();
    renderSnpTable();
    populateGeneSelects();
    populateGroupSelect();
    populateBulkSnpList();
  });
}

// ── Tabs ──────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".admin-panel").forEach(p => p.classList.remove("active"));
  event.target.classList.add("active");
  document.getElementById("panel-" + name).classList.add("active");
}

// ── Genes tab ─────────────────────────────────────
function renderGeneTable() {
  document.getElementById("gene-count").textContent = geneList.length + " genes";
  const tbody = document.getElementById("gene-tbody");
  tbody.innerHTML = geneList.map(g => {
    const opts = groupList.map(gr =>
      `<option value="${gr.id}"${gr.name === g.group_name ? " selected" : ""}>${gr.name}</option>`
    ).join("");
    return `
    <tr>
      <td><span class="gene-sym"><a href="/gene/${g.gene_name}" target="_blank" style="color:var(--accent);text-decoration:none">${g.gene_name}</a></span></td>
      <td style="font-size:12px">${g.full_name || ""}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="grp-${g.gene_name}" style="font-family:var(--mono);font-size:11px;background:var(--card);border:1px solid var(--line);border-radius:3px;padding:3px 6px;color:var(--ink);margin:0">${opts}</select>
          <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="updateGeneGroup('${g.gene_name}')">Set</button>
        </div>
      </td>
      <td><button class="btn-danger" onclick="deleteGene('${g.gene_name}')">Delete</button></td>
    </tr>`;
  }).join("");
}

function populateGeneSelects() {
  const opts = geneList.map(g => `<option value="${g.gene_name}">${g.gene_name}</option>`).join("");
  ["study-gene","export-gene"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
}

function populateGroupSelect() {
  const el = document.getElementById("new-gene-group");
  if (el) el.innerHTML = groupList.map(g => `<option value="${g.id}">${g.name}</option>`).join("");
}

function toggleAddGene() {
  const f = document.getElementById("add-gene-form");
  f.style.display = f.style.display === "none" ? "block" : "none";
}

let geneLookupData = null;

function clearGenePreview() {
  document.getElementById("gene-preview").style.display = "none";
  geneLookupData = null;
}

async function lookupGene() {
  const sym = document.getElementById("new-gene-name").value.trim().toUpperCase();
  if (!sym) return toast("Enter a gene symbol first.", true);
  const btn = document.getElementById("gene-lookup-btn");
  btn.textContent = "...";
  btn.disabled = true;
  try {
    let r, d;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(res => setTimeout(res, 600));
      r = await apiFetch("/api/gene/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene_name: sym }),
      });
      d = await r.json();
      if (r.ok || r.status !== 404) break;
    }
    if (!r.ok) throw new Error(d.error || r.status);
    geneLookupData = d;
    document.getElementById("gprev-name").textContent = d.gene_name + (d.full_name ? " · " + d.full_name : "");
    document.getElementById("gprev-loc").textContent = d.maplocation || "";
    document.getElementById("gprev-desc").textContent = d.description || "";
    document.getElementById("gene-preview").style.display = "block";
  } catch (e) {
    toast("Lookup failed: " + e.message, true);
  } finally {
    btn.textContent = "Lookup";
    btn.disabled = false;
  }
}

function saveGene() {
  if (!geneLookupData) return toast("Look up a gene first.", true);
  const body = {
    gene_name:   geneLookupData.gene_name,
    full_name:   geneLookupData.full_name,
    description: geneLookupData.description,
    maplocation: geneLookupData.maplocation || null,
    group_id:    document.getElementById("new-gene-group").value,
  };
  apiFetch("/api/gene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (r.ok) {
      toast("Gene saved.");
      toggleAddGene();
      clearGenePreview();
      document.getElementById("new-gene-name").value = "";
      init();
    } else {
      const d = await r.json().catch(() => ({}));
      toast("Error: " + (d.error || r.status), true);
    }
  });
}

function deleteGene(name) {
  const affected = snpList.filter(s => s.gene_name === name).map(s => s.rsid);
  const msg = affected.length
    ? `Delete ${name}, its studies/alerts, and these ${affected.length} SNPs: ${affected.join(", ")}? This cannot be undone.`
    : `Delete ${name} and all its studies/alerts? This cannot be undone.`;
  if (!confirm(msg)) return;
  apiFetch(`/api/gene/${name}`, { method: "DELETE" }).then(r => {
    if (r.ok) { toast("Deleted."); init(); }
    else toast("Delete failed.", true);
  });
}

async function updateGeneGroup(geneName) {
  const groupId = document.getElementById("grp-" + geneName).value;
  const r = await apiFetch(`/api/gene/${geneName}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_id: groupId }),
  });
  if (r.ok) toast("Group updated.");
  else toast("Update failed.", true);
}

// ── SNP tab ───────────────────────────────────────
function rrBadge(s) {
  const has = !!s.rr_url;
  return `<button class="btn-sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:${has ? "#4ade80" : "var(--faint)"}"
            onclick="setRrUrl('${s.rsid}')" title="${has ? s.rr_url.replace(/"/g, "&quot;") : "Click to add a Research Rabbit folder-share URL"}">RR: ${has ? "Yes" : "No"}</button>`;
}

function setRrUrl(rsid) {
  const current = snpList.find(s => s.rsid === rsid);
  const value = prompt(`Research Rabbit folder-share URL for ${rsid} (leave blank to clear):`, current?.rr_url || "");
  if (value === null) return;
  apiFetch(`/api/snp/${rsid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rr_url: value.trim() }),
  }).then(r => {
    if (r.ok) { toast(value.trim() ? "Research Rabbit URL saved." : "Research Rabbit URL cleared."); init(); }
    else toast("Failed to save.", true);
  });
}

function renderSnpTable() {
  const tbody = document.getElementById("snp-tbody");
  if (!tbody) return;
  tbody.innerHTML = snpList.map(s => `
    <tr>
      <td><span class="gene-sym">${s.gene_name}</span></td>
      <td style="font-family:var(--mono);font-size:12px"><a href="/snp/${s.rsid}" target="_blank" style="color:var(--accent);text-decoration:none">${s.rsid}</a></td>
      <td style="font-family:var(--mono);font-size:12px">${s.alleles || ""}</td>
      <td><button class="btn-danger" onclick="deleteSnp('${s.rsid}')">Delete</button></td>
      <td>${rrBadge(s)}</td>
    </tr>`).join("");
}

function deleteSnp(rsid) {
  if (!confirm(`Delete ${rsid} and all its frequency data? This cannot be undone.`)) return;
  apiFetch(`/api/snp/${rsid}`, { method: "DELETE" }).then(r => {
    if (r.ok) { toast("SNP deleted."); init(); }
    else toast("Delete failed.", true);
  });
}

let snpLookupData = null;

function checkSnpGeneWarn() {
  if (!snpLookupData) return;
  const gene = document.getElementById("prev-gene").value.trim().toUpperCase();
  const w = document.getElementById("snp-warn");
  if (gene && !geneList.find(g => g.gene_name === gene)) {
    w.textContent = `Gene "${gene}" is not in your gene list yet — add it under the Genes tab first.`;
    w.style.display = "block";
  } else {
    w.style.display = "none";
  }
}

function clearSnpPreview() {
  document.getElementById("snp-preview").style.display = "none";
  document.getElementById("snp-warn").style.display = "none";
  snpLookupData = null;
}

async function lookupSnp() {
  const rsid = document.getElementById("snp-rsid").value.trim();
  if (!rsid) return toast("Enter an SNP ID first.", true);
  const btn = document.getElementById("snp-lookup-btn");
  btn.textContent = "...";
  btn.disabled = true;
  document.getElementById("snp-warn").style.display = "none";
  try {
    let r, d;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(res => setTimeout(res, 600));
      r = await apiFetch("/api/snp/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rsid }),
      });
      d = await r.json();
      if (r.ok || r.status !== 404) break;
    }
    if (!r.ok) throw new Error(d.error || r.status);
    snpLookupData = d;

    document.getElementById("prev-rsid").textContent = d.rsid + (d.protein_change ? " · " + d.protein_change : "");
    document.getElementById("prev-chr").textContent = d.chromosome ? "Chr " + d.chromosome + (d.position ? ":" + d.position : "") : "";

    document.getElementById("prev-gene").value = d.gene_name || "";
    document.getElementById("prev-consequence").textContent = d.consequence || "";
    document.getElementById("prev-summary").textContent = d.summary || "";
    document.getElementById("prev-ncbi").href = "https://www.ncbi.nlm.nih.gov/snp/" + d.rsid;
    document.getElementById("prev-snpedia").href = "https://www.snpedia.com/index.php/" + d.rsid;
    document.getElementById("prev-genecards").href = d.gene_name
      ? `https://www.genecards.org/card/${d.gene_name}?Search=${d.rsid}#Variants_Variants`
      : "#";
    document.getElementById("snp-preview").style.display = "block";

    checkSnpGeneWarn();
  } catch (e) {
    toast("Lookup failed: " + e.message, true);
  } finally {
    btn.textContent = "Lookup";
    btn.disabled = false;
  }
}

function saveSnp() {
  if (!snpLookupData) return toast("Look up an SNP first.", true);
  const chosenGene = document.getElementById("prev-gene").value.trim().toUpperCase();
  if (!chosenGene) return toast("No gene found for this SNP.", true);
  if (geneList.length && !geneList.find(g => g.gene_name === chosenGene)) {
    if (!confirm(`"${chosenGene}" is not in your gene list yet. Save the SNP anyway?`)) return;
  }
  const body = {
    gene_name:      chosenGene,
    rsid:           snpLookupData.rsid,
    // Personal — specific to the person, not the SNP itself
    alleles:        document.getElementById("snp-alleles").value.trim().toUpperCase() || null,
    // SNP-level facts — same for anyone, stored in snps
    chromosome:     snpLookupData.chromosome     || null,
    position:       snpLookupData.position       || null,
    ref_allele:     snpLookupData.ref_allele     || null,
    alt_allele:     snpLookupData.alt_allele     || null,
    protein_change: snpLookupData.protein_change || null,
    consequence:    snpLookupData.consequence    || null,
    summary:        snpLookupData.summary        || null,
  };
  apiFetch("/api/snp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      toast("SNP saved." + (d.frequencies_fetched ? " " + d.frequencies_fetched + " freq rows." : "") + (d.studies_found ? " " + d.studies_found + " studies found." : ""));
      clearSnpPreview();
      document.getElementById("snp-rsid").value = "";
      document.getElementById("snp-alleles").value = "";
    } else {
      const d = await r.json().catch(() => ({}));
      toast("Error: " + (d.error || r.status), true);
    }
  });
}

// ── Study tab ─────────────────────────────────────
function addStudy() {
  const body = {
    gene_name: document.getElementById("study-gene").value,
    rsid:      document.getElementById("study-rsid").value.trim() || null,
    snippet:   document.getElementById("study-snippet").value.trim(),
    authors:   document.getElementById("study-authors").value.trim(),
    year:      parseInt(document.getElementById("study-year").value) || null,
    title:     document.getElementById("study-title").value.trim(),
    url:       document.getElementById("study-url").value.trim() || null,
    doi:       document.getElementById("study-doi").value.trim() || null,
  };
  if (!body.snippet) return toast("Snippet is required.", true);
  apiFetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (r.ok) {
      toast("Study saved.");
      ["study-rsid","study-snippet","study-authors","study-year","study-title","study-url","study-doi"]
        .forEach(id => document.getElementById(id).value = "");
    } else {
      const d = await r.json().catch(() => ({}));
      toast("Error: " + (d.error || r.status), true);
    }
  });
}

// ── Group tab ─────────────────────────────────────
async function generateGroupDescription() {
  const name = document.getElementById("group-name").value.trim();
  if (!name) return toast("Enter a group name first.", true);
  const btn = document.getElementById("group-gen-btn");
  btn.textContent = "...";
  btn.disabled = true;
  try {
    const r = await apiFetch("/api/group/description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    if (d.description) {
      document.getElementById("group-description").value = d.description;
    } else {
      toast("No description found — try a more specific term.", true);
    }
  } catch (e) {
    toast("Generate failed: " + e.message, true);
  } finally {
    btn.textContent = "Generate";
    btn.disabled = false;
  }
}

function renderGroupTable() {
  const tbody = document.getElementById("group-tbody");
  if (!tbody) return;
  tbody.innerHTML = groupList.map(g => groupRow(g)).join("");
}

function groupRow(g) {
  const name = g.name.replace(/'/g, "\\'");
  const desc = (g.description || "").replace(/'/g, "\\'");
  return `
    <tr id="grow-${g.id}">
      <td><span class="gene-sym">${g.name}</span></td>
      <td style="font-size:12px;color:var(--muted)">${g.description || ""}</td>
      <td style="display:flex;gap:6px">
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="editGroup(${g.id}, '${name}', '${desc}')">Edit</button>
        <button class="btn-danger" onclick="deleteGroup(${g.id}, '${name}')">Delete</button>
      </td>
    </tr>`;
}

function editGroup(id, name, desc) {
  const row = document.getElementById("grow-" + id);
  row.innerHTML = `
    <td><input id="gedit-name-${id}" value="${name}" style="font-family:var(--mono);font-size:12px;width:100%;background:var(--bg);border:1px solid var(--line);border-radius:3px;padding:4px 8px;color:var(--ink)"></td>
    <td><input id="gedit-desc-${id}" value="${desc}" style="font-size:12px;width:100%;background:var(--bg);border:1px solid var(--line);border-radius:3px;padding:4px 8px;color:var(--ink)"></td>
    <td style="display:flex;gap:6px">
      <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="saveGroupEdit(${id})">Save</button>
      <button class="btn-sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="renderGroupTable()">Cancel</button>
    </td>`;
}

async function saveGroupEdit(id) {
  const name = document.getElementById("gedit-name-" + id).value.trim();
  const desc = document.getElementById("gedit-desc-" + id).value.trim();
  if (!name) return toast("Name cannot be empty.", true);
  const r = await apiFetch(`/api/group/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: desc || null }),
  });
  if (r.ok) { toast("Group updated."); init(); }
  else toast("Update failed.", true);
}

function deleteGroup(id, name) {
  if (!confirm(`Delete group "${name}"? Genes assigned to it will lose their group.`)) return;
  apiFetch(`/api/group/${id}`, { method: "DELETE" }).then(r => {
    if (r.ok) { toast("Group deleted."); init(); }
    else toast("Delete failed.", true);
  });
}

function addGroup() {
  const name = document.getElementById("group-name").value.trim();
  const description = document.getElementById("group-description").value.trim();
  if (!name) return toast("Group name is required.", true);
  apiFetch("/api/group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  }).then(async r => {
    if (r.ok) {
      toast("Group saved.");
      document.getElementById("group-name").value = "";
      document.getElementById("group-description").value = "";
      init();
    } else {
      const d = await r.json().catch(() => ({}));
      toast("Error: " + (d.error || r.status), true);
    }
  });
}

// ── Export tab ────────────────────────────────────
function exportCsv() {
  const gene = document.getElementById("export-gene").value;
  if (!gene) return;
  apiFetch(`/api/export/${gene}`)
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = gene + "_export.csv";
      a.click();
    });
}

// ── Fix Data tab ──────────────────────────────────
function bfLog(msg) {
  const el = document.getElementById("bf-log");
  el.textContent += msg;
  el.scrollTop = el.scrollHeight;
}

function bfProgress(msg) {
  document.getElementById("bf-progress").textContent = msg;
}

function bfSetBtns(disabled) {
  document.getElementById("bf-genes-btn").disabled = disabled;
  document.getElementById("bf-snps-btn").disabled  = disabled;
}

async function backfillGenes() {
  if (!geneList.length) return toast("No genes loaded.", true);
  bfSetBtns(true);
  bfProgress("");
  const total = geneList.length;
  let done = 0, errs = 0;

  for (let i = 0; i < geneList.length; i++) {
    const gene = geneList[i];
    bfProgress(`Gene ${i + 1} / ${total} — ${gene.gene_name}`);
    bfLog(`→ ${gene.gene_name} `);
    try {
      const lr = await apiFetch("/api/gene/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene_name: gene.gene_name }),
      });
      const ld = await lr.json();
      if (!lr.ok) throw new Error(ld.error || lr.status);

      const pr = await apiFetch(`/api/gene/${gene.gene_name}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: ld.full_name, description: ld.description, maplocation: ld.maplocation }),
      });
      if (!pr.ok) throw new Error("PATCH failed " + pr.status);

      done++;
      bfLog(`✓  ${ld.maplocation || "—"}\n`);
    } catch (e) {
      errs++;
      bfLog(`✗  ${e.message}\n`);
    }
    await new Promise(r => setTimeout(r, 380));
  }

  bfProgress(`Done — ${done}/${total} updated, ${errs} errors.`);
  bfLog(`\n✦ Gene backfill complete: ${done} updated, ${errs} errors.\n`);
  bfSetBtns(false);
  init();
}

async function backfillSnps() {
  bfSetBtns(true);
  bfProgress("Fetching SNP list…");

  let snps = [];
  try {
    const r = await apiFetch("/api/snps");
    const d = await r.json();
    snps = d.snps || [];
  } catch (e) {
    bfProgress("Failed to fetch SNP list: " + e.message);
    bfSetBtns(false);
    return;
  }

  if (!snps.length) {
    bfProgress("No SNPs found in database.");
    bfSetBtns(false);
    return;
  }

  const total = snps.length;
  let done = 0, errs = 0;

  for (let i = 0; i < snps.length; i++) {
    const snp = snps[i];
    bfProgress(`SNP ${i + 1} / ${total} — ${snp.rsid}`);
    bfLog(`→ ${snp.rsid} (${snp.gene_name}) `);
    try {
      const lr = await apiFetch("/api/snp/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rsid: snp.rsid }),
      });
      const ld = await lr.json();
      if (!lr.ok) throw new Error(ld.error || lr.status);

      const pr = await apiFetch(`/api/snp/${snp.rsid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref_allele: ld.ref_allele, alt_allele: ld.alt_allele, protein_change: ld.protein_change,
          consequence: ld.consequence, chromosome: ld.chromosome, position: ld.position,
          summary: ld.summary,
        }),
      });
      if (!pr.ok) throw new Error("PATCH failed " + pr.status);
      const pd = await pr.json().catch(() => ({}));

      done++;
      const alleles = (ld.ref_allele && ld.alt_allele) ? `${ld.ref_allele}/${ld.alt_allele}` : "—";
      bfLog(`✓  ${alleles}${ld.protein_change ? "  " + ld.protein_change : ""}  (${pd.frequencies_fetched ?? 0} freq rows)\n`);
    } catch (e) {
      errs++;
      bfLog(`✗  ${e.message}\n`);
    }
    await new Promise(r => setTimeout(r, 420));
  }

  bfProgress(`Done — ${done}/${total} updated, ${errs} errors.`);
  bfLog(`\n✦ SNP backfill complete: ${done} updated, ${errs} errors.\n`);
  bfSetBtns(false);
}

// ── Bulk study import (ResearchRabbit CSV) ────────
function escHtml(s) {
  return (s == null ? "" : String(s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, "&quot;");
}
function truncateStr(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}

// Minimal RFC4180-style CSV parser — handles quoted fields, embedded commas/
// newlines/escaped quotes ("") within quotes, since abstracts and author
// lists routinely contain commas.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== "");
}

function bulkNormalize(v) {
  if (v == null) return "";
  const t = v.trim();
  return /^\(missing[^)]*\)$/i.test(t) ? "" : t;
}

function populateBulkSnpList() {
  const dl = document.getElementById("bulk-snp-list");
  if (!dl) return;
  dl.innerHTML = snpList.map(s => `<option value="${escAttr(s.gene_name + " — " + s.rsid)}">`).join("");
}

function bulkFileSelected() {
  const file = document.getElementById("bulk-file").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    bulkRawCsv = reader.result;
    document.getElementById("bulk-scan-btn").disabled = false;
  };
  reader.readAsText(file);

  const base = file.name.replace(/\.csv$/i, "");
  const m = base.match(/^(rs\d+)/i);
  const note = document.getElementById("bulk-detect-note");
  if (m) {
    const rsid = m[1].toLowerCase();
    const match = snpList.find(s => s.rsid.toLowerCase() === rsid);
    if (match) {
      bulkGene = match.gene_name; bulkRsid = match.rsid;
      document.getElementById("bulk-snp-picker").value = `${match.gene_name} — ${match.rsid}`;
      note.textContent = `Detected ${match.rsid} (${match.gene_name}) from filename.`;
      note.style.color = "var(--faint)";
    } else {
      bulkGene = null; bulkRsid = rsid;
      note.textContent = `Filename suggests ${rsid}, but it's not in your SNP list yet — pick the gene manually.`;
      note.style.color = "#f87171";
    }
  } else {
    bulkGene = null; bulkRsid = null;
    note.textContent = "Couldn't detect an rsID from the filename — pick the gene/rsID manually.";
    note.style.color = "#f87171";
  }
}

function bulkSnpPicked() {
  const val = document.getElementById("bulk-snp-picker").value.trim();
  let m = val.match(/^(.+?)\s*—\s*(rs\d+)$/i);
  if (m) {
    const match = snpList.find(s => s.gene_name === m[1].trim().toUpperCase() && s.rsid.toLowerCase() === m[2].toLowerCase());
    if (match) { bulkGene = match.gene_name; bulkRsid = match.rsid; return; }
  }
  m = val.match(/^(rs\d+)$/i);
  if (m) {
    const match = snpList.find(s => s.rsid.toLowerCase() === m[1].toLowerCase());
    if (match) { bulkGene = match.gene_name; bulkRsid = match.rsid; return; }
  }
  bulkGene = null; bulkRsid = null;
}

function bulkScanCsv() {
  if (!bulkRawCsv) return toast("Choose a CSV file first.", true);
  if (!bulkGene || !bulkRsid) return toast("Pick a gene/rsID first.", true);

  const table = parseCsv(bulkRawCsv);
  if (!table.length) return toast("CSV appears empty.", true);
  const header = table[0].map(h => h.trim().toLowerCase());
  const idx = {
    doi: header.indexOf("doi"),
    title: header.indexOf("title"),
    authors: header.indexOf("authors"),
    year: header.indexOf("year"),
    abstract: header.indexOf("abstract"),
    url: header.indexOf("pubmedid"),
  };
  bulkRows = table.slice(1).map(r => ({
    doi:      bulkNormalize(r[idx.doi]),
    title:    bulkNormalize(r[idx.title]),
    authors:  bulkNormalize(r[idx.authors]),
    year:     bulkNormalize(r[idx.year]),
    abstract: bulkNormalize(r[idx.abstract]),
    url:      bulkNormalize(r[idx.url]),
    _open:    false,
  }));
  renderBulkTable();
  document.getElementById("bulk-review").style.display = "block";
}

function bulkIsFlagged(row) {
  return !row.title || !row.authors || !row.year || !row.abstract || (!row.url && !row.doi);
}

function bulkField(i, key, value) {
  bulkRows[i][key] = value;
}

function bulkToggleEdit(i) {
  bulkRows[i]._open = !bulkRows[i]._open;
  renderBulkTable();
}

function bulkRemoveRow(i) {
  bulkRows.splice(i, 1);
  renderBulkTable();
}

async function bulkScanRow(i) {
  const row = bulkRows[i];
  const query = [row.title, row.authors].filter(Boolean).join(" ") || (row.abstract ? row.abstract.slice(0, 80) : "");
  if (!query) return toast("Not enough info in this row to search.", true);
  try {
    const r = await apiFetch("/api/study/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.status);
    if (!row.doi && d.doi) row.doi = d.doi;
    if (!row.title && d.title) row.title = d.title;
    if (!row.authors && d.authors) row.authors = d.authors;
    if (!row.year && d.year) row.year = String(d.year);
    renderBulkTable();
    toast(d.warning || "Scan complete — check the filled fields.", !!d.warning);
  } catch (e) {
    toast("Scan failed: " + e.message, true);
  }
}

function renderBulkTable() {
  const tbody = document.getElementById("bulk-tbody");
  document.getElementById("bulk-count").textContent = `${bulkRows.length} rows`;
  tbody.innerHTML = bulkRows.map((row, i) => {
    const flagged = bulkIsFlagged(row);
    const link = row.url || (row.doi ? `https://doi.org/${row.doi}` : "");
    const compact = `
    <tr class="${flagged ? "bulk-row--flagged" : ""}">
      <td title="${escAttr(row.title)}">${row.title ? escHtml(truncateStr(row.title, 60)) : '<span class="bulk-cell-empty">missing</span>'}</td>
      <td title="${escAttr(row.authors)}">${row.authors ? escHtml(truncateStr(row.authors, 40)) : '<span class="bulk-cell-empty">missing</span>'}</td>
      <td>${row.year ? escHtml(row.year) : '<span class="bulk-cell-empty">—</span>'}</td>
      <td>${link ? `<a href="${escAttr(link)}" target="_blank" rel="noopener">↗</a>` : '<span class="bulk-cell-empty">none</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="bulkToggleEdit(${i})">${row._open ? "Done" : "Edit"}</button>
        <button class="btn-danger" onclick="bulkRemoveRow(${i})">Remove</button>
      </td>
    </tr>`;
    const editRow = `
    <tr${row._open ? "" : ' style="display:none"'}>
      <td colspan="5" class="bulk-edit-row">
        <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">Title</label>
        <input type="text" value="${escAttr(row.title)}" oninput="bulkField(${i},'title',this.value)">
        <div style="display:flex;gap:10px">
          <div style="flex:1">
            <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">Authors</label>
            <input type="text" value="${escAttr(row.authors)}" oninput="bulkField(${i},'authors',this.value)">
          </div>
          <div style="width:100px">
            <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">Year</label>
            <input type="number" value="${escAttr(row.year)}" oninput="bulkField(${i},'year',this.value)">
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <div style="flex:1">
            <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">URL</label>
            <input type="text" value="${escAttr(row.url)}" oninput="bulkField(${i},'url',this.value)">
          </div>
          <div style="flex:1">
            <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">DOI</label>
            <input type="text" value="${escAttr(row.doi)}" oninput="bulkField(${i},'doi',this.value)">
          </div>
        </div>
        <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">Abstract / Snippet</label>
        <textarea oninput="bulkField(${i},'abstract',this.value)">${escHtml(row.abstract)}</textarea>
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="bulkScanRow(${i})">Scan for missing details</button>
      </td>
    </tr>`;
    return compact + editRow;
  }).join("");
}

function bulkLog(msg) {
  const el = document.getElementById("bulk-log");
  el.textContent += msg;
  el.scrollTop = el.scrollHeight;
}

async function bulkImportAll() {
  if (!bulkGene || !bulkRsid) return toast("Pick a gene/rsID first.", true);
  if (!bulkRows.length) return toast("Nothing to import.", true);
  const total = bulkRows.length;
  let done = 0, errs = 0;
  document.getElementById("bulk-log").textContent = "";

  for (let i = 0; i < bulkRows.length; i++) {
    const row = bulkRows[i];
    document.getElementById("bulk-progress").textContent = `${i + 1} / ${total}`;
    const snippet = row.abstract || row.title;
    if (!snippet) {
      errs++;
      bulkLog(`✗  row ${i + 1}: no abstract or title, skipped\n`);
      continue;
    }
    try {
      const r = await apiFetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene_name: bulkGene, rsid: bulkRsid,
          snippet, authors: row.authors || null, title: row.title || null,
          url: row.url || null, doi: row.doi || null,
          year: row.year ? parseInt(row.year) : null,
        }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      done++;
      bulkLog(`✓  ${truncateStr(row.title || "(untitled)", 60)}\n`);
    } catch (e) {
      errs++;
      bulkLog(`✗  row ${i + 1}: ${e.message}\n`);
    }
    await new Promise(res => setTimeout(res, 150));
  }

  document.getElementById("bulk-progress").textContent = `Done — ${done}/${total} imported, ${errs} errors.`;
  toast(`Imported ${done} studies.`);
}
