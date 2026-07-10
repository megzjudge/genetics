let TOKEN = "";
let geneList = [];
let groupList = [];
let snpList = [];

// ── Bulk study import state ───────────────────────
let bulkRawCsv = null;
let bulkGene = null, bulkRsid = null;
let bulkRows = [];
let bulkExistingStudies = [];

// ── Discover (Brave Search) state ─────────────────
let discoverGene = null, discoverRsid = null;
let discoverResults = [];

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

function popBadge(s) {
  const has = (s.pop_count || 0) > 0;
  return `<button class="btn-sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:${has ? "#4ade80" : "#f87171"}"
            onclick="scanOnePop('${s.rsid}')" title="${has ? s.pop_count + " population rows" : "Click to fetch population frequency data"}">Pop: ${has ? "Yes" : "No"}</button>`;
}

async function scanOnePop(rsid) {
  toast(`Scanning ${rsid}…`);
  try {
    const lr = await apiFetch("/api/snp/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rsid }),
    });
    const ld = await lr.json();
    if (!lr.ok) throw new Error(ld.error || lr.status);
    const pr = await apiFetch(`/api/snp/${rsid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref_allele: ld.ref_allele, alt_allele: ld.alt_allele, protein_change: ld.protein_change,
        consequence: ld.consequence, chromosome: ld.chromosome, position: ld.position,
        summary: ld.summary, frequencies: ld.frequencies, has_clinvar: ld.has_clinvar, has_snpedia: ld.has_snpedia,
      }),
    });
    if (!pr.ok) throw new Error("PATCH failed " + pr.status);
    const pd = await pr.json().catch(() => ({}));
    toast(`${rsid}: ${pd.frequencies_fetched ?? 0} population rows fetched.`);
    init();
  } catch (e) {
    toast(`Scan failed for ${rsid}: ${e.message}`, true);
  }
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
      <td>${popBadge(s)}</td>
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
    pid:       document.getElementById("study-pid").value.trim() || null,
  };
  if (!body.snippet) return toast("Snippet is required.", true);
  apiFetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (r.ok) {
      toast("Study saved.");
      ["study-rsid","study-snippet","study-authors","study-year","study-title","study-url","study-pid"]
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
  document.getElementById("bf-snps-missing-btn").disabled = disabled;
  document.getElementById("bf-clinvar-snpedia-btn").disabled = disabled;
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

// Full rewrite — re-checks every SNP against NCBI regardless of current
// state, since NCBI's own data (esp. population frequencies) changes over
// time. Meant to be run periodically (e.g. every few months), not routinely.
async function backfillSnps() {
  return runSnpBackfill("/api/snps", "No SNPs found in database.");
}

// Quick scan — only SNPs missing a core field that should always be
// derivable (chromosome/position/ref_allele/alt_allele/consequence) or with
// zero snp_pop rows. Skips anything already complete, so it's much faster
// than the full rewrite and safe to run any time you suspect a gap.
async function backfillMissingSnps() {
  return runSnpBackfill("/api/snps/incomplete", "No incomplete SNPs found — everything already has core data.");
}

// Fast, targeted — only checks/stores has_clinvar and has_snpedia, skipping
// the slow NCBI variation JSON/HTML fetch entirely (that's a different
// concern this button doesn't need). Runs across every SNP, not just
// incomplete ones, since re-checking is cheap and either flag can change
// over time as ClinVar/SNPedia add new entries.
async function fixClinvarSnpedia() {
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
    try {
      const r = await apiFetch("/api/snp/clinvar-snpedia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rsid: snp.rsid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      done++;
      bfLog(`→ ${snp.rsid} (${snp.gene_name}): has_clinvar=${d.has_clinvar} has_snpedia=${d.has_snpedia}\n`);
    } catch (e) {
      errs++;
      bfLog(`→ ${snp.rsid} (${snp.gene_name}): ✗ ${e.message}\n`);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  bfProgress(`Done — ${done}/${total} updated, ${errs} errors.`);
  bfLog(`\n✦ ClinVar/SNPedia fix complete: ${done} updated, ${errs} errors.\n`);
  bfSetBtns(false);
}

async function runSnpBackfill(listUrl, emptyMessage) {
  bfSetBtns(true);
  bfProgress("Fetching SNP list…");

  let snps = [];
  try {
    const r = await apiFetch(listUrl);
    const d = await r.json();
    snps = d.snps || [];
  } catch (e) {
    bfProgress("Failed to fetch SNP list: " + e.message);
    bfSetBtns(false);
    return;
  }

  if (!snps.length) {
    bfProgress(emptyMessage);
    bfSetBtns(false);
    return;
  }

  const total = snps.length;
  let done = 0, errs = 0;

  for (let i = 0; i < snps.length; i++) {
    const snp = snps[i];
    bfProgress(`SNP ${i + 1} / ${total} — ${snp.rsid}`);
    bfLog(`→ ${snp.rsid} (${snp.gene_name})\n`);
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
          summary: ld.summary, frequencies: ld.frequencies, has_clinvar: ld.has_clinvar, has_snpedia: ld.has_snpedia,
        }),
      });
      if (!pr.ok) throw new Error("PATCH failed " + pr.status);
      const pd = await pr.json().catch(() => ({}));

      done++;
      bfLog(`  snps: chromosome=${ld.chromosome || "—"} position=${ld.position || "—"} ref_allele=${ld.ref_allele || "—"} alt_allele=${ld.alt_allele || "—"} protein_change=${ld.protein_change || "—"} consequence=${ld.consequence || "—"} summary=${ld.summary ? '"' + truncateStr(ld.summary, 70) + '"' : "—"}\n`);
      const freqs = pd.frequencies || [];
      if (freqs.length) {
        bfLog(`  snp_pop (${freqs.length} rows):\n`);
        for (const f of freqs) {
          const a1f = f.allele1_freq != null ? f.allele1_freq.toFixed(3) : "—";
          const a2f = f.allele2_freq != null ? f.allele2_freq.toFixed(3) : "—";
          const h1  = f.geno_hom1   != null ? f.geno_hom1.toFixed(3)   : "—";
          const het = f.geno_het    != null ? f.geno_het.toFixed(3)    : "—";
          const h2  = f.geno_hom2   != null ? f.geno_hom2.toFixed(3)   : "—";
          bfLog(`    ${f.population} (${f.pop_type}): allele1=${f.allele1 || "?"} allele1_freq=${a1f} allele2=${f.allele2 || "?"} allele2_freq=${a2f} geno_hom1=${h1} geno_het=${het} geno_hom2=${h2} sample_size=${f.sample_size ?? "—"}\n`);
        }
      } else {
        bfLog(`  snp_pop: 0 rows\n`);
      }
    } catch (e) {
      errs++;
      bfLog(`  ✗  ${e.message}\n`);
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
  document.getElementById("bulk-scan-btn").disabled = true;
  const reader = new FileReader();
  reader.onload = () => {
    bulkRawCsv = reader.result;
    document.getElementById("bulk-scan-btn").disabled = false;
  };
  reader.onerror = () => {
    bulkRawCsv = null;
    toast("Failed to read that file: " + (reader.error?.message || "unknown error"), true);
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

// PID = persistent identifier (umbrella term for DOI, Handle/HDL, etc.).
// DOI (10.xxxx/yyyy) resolves via doi.org; anything else assumed Handle-format,
// resolves via hdl.handle.net. If a row already has a PID but no URL, this is
// the primary, deterministic way to fill it (no search needed).
function bulkPidUrl(pid) {
  if (!pid) return null;
  return /^10\.\d{4,9}\//.test(pid) ? `https://doi.org/${pid}` : `https://hdl.handle.net/${pid}`;
}
function bulkDerivePidUrl(row) {
  if (row.pid && !row.url) row.url = bulkPidUrl(row.pid);
}

function bulkIsFlagged(row) {
  return !row.title || !row.authors || !row.year || !row.abstract || (!row.url && !row.pid);
}

// Manual convenience link, not an automated fetch — opens Scholar with the
// title (or authors, if title's missing) pre-filled in quotes.
function bulkScholarUrl(row) {
  const q = row.title || row.authors || "";
  if (!q) return null;
  return `https://scholar.google.com/scholar?hl=en&as_sdt=0,5&q=${encodeURIComponent('"' + q + '"')}`;
}

function bulkNormTitle(t) {
  return (t || "").toLowerCase().replace(/[\s.,;:'"’…-]+/g, " ").trim();
}

// Checks a CSV row against every study already in the DB (any gene/rsid —
// the same paper often covers many SNPs, so a match under a different rsid
// isn't a true duplicate, just a paper worth re-using).
function bulkFindDuplicate(row, existingStudies) {
  const normTitle = bulkNormTitle(row.title);
  for (const s of existingStudies) {
    const matched = [];
    if (row.pid && s.pid && row.pid.toLowerCase() === s.pid.toLowerCase()) matched.push("pid");
    if (row.url && s.url && row.url.toLowerCase() === s.url.toLowerCase()) matched.push("url");
    if (normTitle && normTitle === bulkNormTitle(s.title)) matched.push("title");
    if (matched.length) return { study: s, matched };
  }
  return null;
}

// Row state drives both styling and Import-All eligibility:
//   grey  = exact duplicate already imported under THIS SAME rsid — skipped
//   blue  = exact duplicate exists, but under a DIFFERENT rsid — still imported
//   red   = missing a required field — skipped
//   normal = clean — imported
function bulkComputeState(row, existingStudies) {
  const dup = bulkFindDuplicate(row, existingStudies);
  row._dup = dup;
  if (dup && dup.study.rsid === bulkRsid) return "grey";
  if (dup) return "blue";
  return bulkIsFlagged(row) ? "red" : "normal";
}

async function bulkScanCsv() {
  if (!bulkRawCsv) return toast("Choose a CSV file first.", true);
  if (!bulkGene || !bulkRsid) return toast("Pick a gene/rsID first.", true);

  const table = parseCsv(bulkRawCsv);
  if (!table.length) return toast("CSV appears empty.", true);
  const header = table[0].map(h => h.trim().toLowerCase());
  const idx = {
    pid: header.indexOf("doi"), // ResearchRabbit's own CSV column is literally named "DOI"
    title: header.indexOf("title"),
    authors: header.indexOf("authors"),
    year: header.indexOf("year"),
    abstract: header.indexOf("abstract"),
    url: header.indexOf("pubmedid"),
  };
  bulkRows = table.slice(1).map(r => ({
    pid:      bulkNormalize(r[idx.pid]),
    title:    bulkNormalize(r[idx.title]),
    authors:  bulkNormalize(r[idx.authors]),
    year:     bulkNormalize(r[idx.year]),
    abstract: bulkNormalize(r[idx.abstract]),
    url:      bulkNormalize(r[idx.url]),
    _open:    false,
  }));
  bulkRows.forEach(bulkDerivePidUrl);

  document.getElementById("bulk-scan-btn").disabled = true;
  bulkExistingStudies = await safeFetchJson("/api/studies").then(d => (d && d.studies) || []);
  bulkRows.forEach(row => { row._state = bulkComputeState(row, bulkExistingStudies); });
  document.getElementById("bulk-scan-btn").disabled = false;

  renderBulkTable();
  document.getElementById("bulk-review").style.display = "block";
}

function bulkField(i, key, value) {
  bulkRows[i][key] = value;
  // Re-derive the url from pid if either was just edited, then recheck
  // flagged/duplicate state so the red/grey/blue highlight actually updates
  // once a row becomes complete (previously only computed once, at scan time).
  if (key === "pid" || key === "url") bulkDerivePidUrl(bulkRows[i]);
  bulkRows[i]._state = bulkComputeState(bulkRows[i], bulkExistingStudies);
}

function bulkToggleEdit(i) {
  bulkRows[i]._open = !bulkRows[i]._open;
  renderBulkTable();
}

function bulkRemoveRow(i) {
  const row = bulkRows[i];
  if (!confirm(`Remove "${truncateStr(row.title || "(untitled)", 60)}" from this import list? You'd need to re-upload the CSV to get it back.`)) return;
  bulkRows.splice(i, 1);
  renderBulkTable();
}

async function bulkSubmitOne(row) {
  const snippet = row.abstract || row.title;
  if (!snippet) throw new Error("no abstract or title");
  const r = await apiFetch("/api/study", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gene_name: bulkGene, rsid: bulkRsid,
      snippet, authors: row.authors || null, title: row.title || null,
      url: row.url || null, pid: row.pid || null,
      year: row.year ? parseInt(row.year) : null,
      used: null, // bulk-imported, not yet triaged -> "New Unread Studies"
    }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

async function bulkSubmitRow(i) {
  const row = bulkRows[i];
  try {
    await bulkSubmitOne(row);
    bulkRows.splice(i, 1);
    renderBulkTable();
    toast("Study imported.");
  } catch (e) {
    toast("Import failed: " + e.message, true);
  }
}

const BULK_ROW_CLASS = { grey: "bulk-row--dup-same", blue: "bulk-row--dup-other", red: "bulk-row--flagged", normal: "" };

function bulkFieldStyle(row, field) {
  return (row._dup && row._dup.matched.includes(field)) ? "border-color:#f87171" : "";
}

function renderBulkTable() {
  const tbody = document.getElementById("bulk-tbody");
  document.getElementById("bulk-count").textContent = `${bulkRows.length} rows`;
  tbody.innerHTML = bulkRows.map((row, i) => {
    const link = row.url || bulkPidUrl(row.pid) || "";
    const scholarUrl = bulkScholarUrl(row);
    const compact = `
    <tr class="${BULK_ROW_CLASS[row._state] || ""}">
      <td title="${escAttr(row.title)}">${row.title ? escHtml(truncateStr(row.title, 60)) : '<span class="bulk-cell-empty">missing</span>'}</td>
      <td title="${escAttr(row.authors)}">${row.authors ? escHtml(truncateStr(row.authors, 40)) : '<span class="bulk-cell-empty">missing</span>'}</td>
      <td>${row.year ? escHtml(row.year) : '<span class="bulk-cell-empty">—</span>'}</td>
      <td>${link ? `<a href="${escAttr(link)}" target="_blank" rel="noopener">↗</a>` : '<span class="bulk-cell-empty">none</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="bulkToggleEdit(${i})">${row._open ? "Done" : "Edit"}</button>
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="bulkSubmitRow(${i})">Submit</button>
        <button class="btn-danger" onclick="bulkRemoveRow(${i})">Remove</button>
      </td>
    </tr>`;
    const dupNote = row._dup
      ? row._state === "grey"
        ? `<p class="bulk-dup-note" style="color:#94a3b8">Already imported for <strong>${escHtml(row._dup.study.rsid)}</strong> (${escHtml(row._dup.study.gene_name)}) — matched on ${row._dup.matched.map(escHtml).join(", ")}. Won't import via "Import All"; fields below are highlighted red where they matched. Use Submit to force it through anyway.</p>`
        : `<p class="bulk-dup-note" style="color:#7db4ff">Also exists under <strong>${escHtml(row._dup.study.rsid)}</strong> (${escHtml(row._dup.study.gene_name)}) — matched on ${row._dup.matched.map(escHtml).join(", ")}. Will still import as a new entry for ${escHtml(bulkRsid)}, since the same paper can be useful for more than one SNP.</p>`
      : "";
    const editRow = `
    <tr${row._open ? "" : ' style="display:none"'}>
      <td colspan="5" class="bulk-edit-row">
        ${dupNote}
        <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">Title</label>
        <input type="text" value="${escAttr(row.title)}" style="${bulkFieldStyle(row, "title")}" oninput="bulkField(${i},'title',this.value)">
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
            <input type="text" value="${escAttr(row.url)}" style="${bulkFieldStyle(row, "url")}" oninput="bulkField(${i},'url',this.value)">
          </div>
          <div style="flex:1">
            <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">PID</label>
            <input type="text" value="${escAttr(row.pid)}" style="${bulkFieldStyle(row, "pid")}" oninput="bulkField(${i},'pid',this.value)">
          </div>
        </div>
        <label style="font-family:var(--mono);font-size:10px;color:var(--faint)">Abstract / Snippet</label>
        <textarea oninput="bulkField(${i},'abstract',this.value)">${escHtml(row.abstract)}</textarea>
        ${scholarUrl ? `<a href="${escAttr(scholarUrl)}" target="_blank" rel="noopener" class="btn-sm" style="text-decoration:none;display:inline-block;font-size:10px;padding:3px 8px">Search Google Scholar ↗</a>` : ""}
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
  const toImport = bulkRows.filter(r => r._state === "normal" || r._state === "blue");
  if (!toImport.length) return toast("Nothing eligible to import — only red/grey rows remain.", true);

  const total = toImport.length;
  let done = 0, errs = 0;
  document.getElementById("bulk-log").textContent = "";
  const imported = new Set();

  for (let n = 0; n < toImport.length; n++) {
    const row = toImport[n];
    document.getElementById("bulk-progress").textContent = `${n + 1} / ${total}`;
    try {
      await bulkSubmitOne(row);
      done++;
      imported.add(row);
      bulkLog(`✓  ${truncateStr(row.title || "(untitled)", 60)}\n`);
    } catch (e) {
      errs++;
      bulkLog(`✗  ${truncateStr(row.title || "(untitled)", 60)}: ${e.message}\n`);
    }
    await new Promise(res => setTimeout(res, 150));
  }

  // Only successfully-imported rows disappear — red/grey (skipped) and any
  // that errored stay on screen for review.
  bulkRows = bulkRows.filter(r => !imported.has(r));
  renderBulkTable();

  document.getElementById("bulk-progress").textContent = `Done — ${done}/${total} imported, ${errs} errors.`;
  toast(`Imported ${done} studies.`);
}

// ── Discover tab (Brave Search) ───────────────────
function discoverSnpPicked() {
  const val = document.getElementById("discover-snp-picker").value.trim();
  let match = null;
  let m = val.match(/^(.+?)\s*—\s*(rs\d+)$/i);
  if (m) match = snpList.find(s => s.gene_name === m[1].trim().toUpperCase() && s.rsid.toLowerCase() === m[2].toLowerCase());
  if (!match) {
    m = val.match(/^(rs\d+)$/i);
    if (m) match = snpList.find(s => s.rsid.toLowerCase() === m[1].toLowerCase());
  }
  discoverGene = match ? match.gene_name : null;
  discoverRsid = match ? match.rsid : null;
  document.getElementById("discover-scan-btn").disabled = !match;
}

async function discoverScan() {
  if (!discoverGene || !discoverRsid) return toast("Pick a gene/rsID first.", true);
  const btn = document.getElementById("discover-scan-btn");
  btn.disabled = true;
  btn.textContent = "Scanning…";
  try {
    const [scan, studies, exclusions] = await Promise.all([
      safeFetchJson(`/api/discover?rsid=${encodeURIComponent(discoverRsid)}&gene=${encodeURIComponent(discoverGene)}`),
      safeFetchJson("/api/studies"),
      safeFetchJson("/api/exclusions"),
    ]);
    const known = (studies?.studies || []).concat(exclusions?.exclusions || []);
    const raw = scan?.results || [];
    // Reuses the same normalized-title/url matching the bulk CSV importer
    // uses (bulkFindDuplicate/bulkNormTitle) — "known" here is anything
    // already filed as a study OR previously marked Duplicate/Trash.
    discoverResults = raw.filter(r => !bulkFindDuplicate(r, known));
    renderDiscoverResults();
    document.getElementById("discover-review").style.display = "block";
  } catch (e) {
    toast("Scan failed: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Scan";
  }
}

function renderDiscoverResults() {
  document.getElementById("discover-count").textContent =
    `${discoverResults.length} new result${discoverResults.length === 1 ? "" : "s"} for ${discoverGene} — ${discoverRsid}`;
  const wrap = document.getElementById("discover-results");
  if (!discoverResults.length) {
    wrap.innerHTML = `<p style="font-size:13px;color:var(--faint)">Nothing new — everything Brave returned is already filed or excluded.</p>`;
    return;
  }
  wrap.innerHTML = discoverResults.map((r, i) => `
    <div style="background:var(--card);border:1px solid var(--line);border-radius:6px;padding:16px;margin-bottom:12px">
      <a href="${escAttr(r.url)}" target="_blank" rel="noopener" style="font-size:14px;font-weight:600;color:var(--accent)">${escHtml(r.title)}</a>
      <div style="font-family:var(--mono);font-size:10px;color:var(--faint);margin:4px 0 8px;word-break:break-all">${escHtml(r.url)}</div>
      ${r.description ? `<p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:12px">${escHtml(r.description)}</p>` : ""}
      <div style="display:flex;gap:10px">
        <button class="btn-sm" onclick="discoverAdd(${i})">+ Add as Study</button>
        <button class="btn-sm" style="background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="discoverExclude(${i}, true, false)">Mark Duplicate</button>
        <button class="btn-sm" style="background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="discoverExclude(${i}, false, true)">Trash</button>
      </div>
    </div>
  `).join("");
}

function discoverAdd(i) {
  const r = discoverResults[i];
  document.getElementById("study-gene").value = discoverGene;
  document.getElementById("study-rsid").value = discoverRsid;
  document.getElementById("study-title").value = r.title || "";
  document.getElementById("study-url").value = r.url || "";
  document.getElementById("study-snippet").value = r.description || r.title || "";
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".admin-panel").forEach(p => p.classList.remove("active"));
  document.querySelector('button[onclick="switchTab(\'study\')"]').classList.add("active");
  document.getElementById("panel-study").classList.add("active");
  toast("Study form pre-filled — review authors/year/PID, then Save Study.");
}

async function discoverExclude(i, duplicate, trash) {
  const r = discoverResults[i];
  try {
    const res = await apiFetch("/api/exclusion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: r.title, url: r.url, duplicate, trash }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    discoverResults.splice(i, 1);
    renderDiscoverResults();
    toast(duplicate ? "Marked as duplicate — won't resurface in future scans." : "Trashed — won't resurface in future scans.");
  } catch (e) {
    toast("Failed: " + e.message, true);
  }
}
