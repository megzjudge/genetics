let TOKEN = "";
let diseaseList = [];
let geneList = [];
let groupList = [];
let snpList = [];
// Staged SNPs for a not-yet-saved disease — linked once the disease's real
// id comes back from the save call, since snp_diseases needs that id.
let pendingDiseaseSnps = [];

// ── Bulk study import state ───────────────────────
let bulkRawCsv = null;
let bulkGene = null, bulkRsid = null;
let bulkRows = [];
let bulkExistingStudies = [];

// ── Discover (Brave Search) state ─────────────────
let discoverGene = null, discoverRsid = null;
let discoverResults = [];

// ── Scholar (pasted-page-source parser) state ─────
let scholarGene = null, scholarRsid = null;
let scholarResults = [];

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
        const errEl = document.getElementById("auth-err");
        errEl.textContent = r.status === 429 ? "Sowee, my bad, pwease dont" : "Incorrect password.";
        errEl.style.display = "block";
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
    safeFetchJson("/api/diseases"),
  ]).then(([genes, groups, snps, diseases]) => {
    geneList    = (genes    && (genes.genes       || genes))    || [];
    groupList   = (groups   && (groups.groups     || groups))   || [];
    diseaseList = (diseases && (diseases.diseases || diseases)) || [];
    snpList     = (snps     && (snps.snps         || snps))     || [];
    snpList.forEach(s => {
      s.disease_ids = (s.disease_ids || "").toString().split(",").filter(Boolean).map(Number);
    });
    geneList.forEach(g => {
      g.disease_ids = (g.disease_ids || "").toString().split(",").filter(Boolean).map(Number);
    });
    renderGeneTable();
    renderGroupTable();
    renderDiseaseTable();
    renderSnpTable();
    populateGeneSelects();
    renderNewGeneGroupDiseasePicker();
    renderNewSnpDiseasePicker();
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
// Merged Group/Disease popover — Group stays single-select (radios, one
// active group per gene, same as the old <select> enforced) since that's
// the existing convention elsewhere in the app; Diseases is a checkbox
// multi-select, same pattern as the SNP table's disease picker.
// Shared with diseaseCell()/renderNewSnpDiseasePicker() so every disease
// checklist in the admin panel is generated from one place — same markup,
// same styling, no risk of the three copies drifting apart.
function diseaseChecklistHtml(ids) {
  if (!diseaseList.length) return `<div style="font-size:11px;color:var(--faint)">No diseases yet — add one in the Add Disease tab.</div>`;
  return diseaseList.map(d => `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink);padding:3px 0;white-space:nowrap">
      <input type="checkbox" value="${d.id}" ${ids.includes(d.id) ? "checked" : ""}> ${d.name}
    </label>`).join("");
}

function groupDiseaseButton(idPrefix, selectedGroupId, selectedDiseaseIds) {
  const ids = selectedDiseaseIds || [];
  const count = (selectedGroupId ? 1 : 0) + ids.length;
  const label = count ? `Group / Disease (${count})` : "Group / Disease";
  const groupRadios = `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink);padding:3px 0">
      <input type="radio" name="${idPrefix}-group" value="" ${!selectedGroupId ? "checked" : ""}> <span style="color:var(--faint)">None</span>
    </label>` + groupList.map(g => `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink);padding:3px 0;white-space:nowrap">
      <input type="radio" name="${idPrefix}-group" value="${g.id}" ${String(g.id) === String(selectedGroupId) ? "checked" : ""}> ${g.name}
    </label>`).join("");
  return `<div class="gd-picker" style="position:relative;display:inline-block">
    <button class="btn-sm" type="button" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:${count ? "#4ade80" : "var(--faint)"}"
      onclick="toggleGdPanel('${idPrefix}')">${label}</button>
    <div id="gd-panel-${idPrefix}" style="display:none;position:absolute;top:100%;left:0;z-index:10;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;margin-top:4px;min-width:200px;max-height:260px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.3)">
      <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin:0 0 4px">Group</div>
      ${groupRadios}
      <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin:10px 0 4px">Diseases</div>
      ${diseaseChecklistHtml(ids)}
    </div>
  </div>`;
}

function toggleGdPanel(idPrefix) {
  const panel = document.getElementById("gd-panel-" + idPrefix);
  const isOpen = panel.style.display === "block";
  document.querySelectorAll("[id^='gd-panel-']").forEach(p => p.style.display = "none");
  panel.style.display = isOpen ? "none" : "block";
}

// Reads whatever's currently checked in a gd-picker panel — used both to
// collect a save payload and to preserve in-progress picks across a
// re-render triggered by something unrelated (e.g. saving a SNP in another
// tab calls init(), which would otherwise wipe an unsaved Add Gene form).
function readGdPanel(idPrefix) {
  const panel = document.getElementById("gd-panel-" + idPrefix);
  if (!panel) return { groupId: null, diseaseIds: [] };
  const g = panel.querySelector(`input[name="${idPrefix}-group"]:checked`);
  const diseaseIds = Array.from(panel.querySelectorAll("input[type=checkbox]:checked")).map(el => parseInt(el.value));
  return { groupId: g && g.value ? parseInt(g.value) : null, diseaseIds };
}

function renderNewGeneGroupDiseasePicker() {
  const el = document.getElementById("new-gene-groupdisease");
  if (!el) return;
  const prev = readGdPanel("new-gene");
  el.innerHTML = groupDiseaseButton("new-gene", prev.groupId, prev.diseaseIds);
}

function renderGeneTable() {
  document.getElementById("gene-count").textContent = geneList.length + " genes";
  const tbody = document.getElementById("gene-tbody");
  tbody.innerHTML = geneList.map(g => `
    <tr>
      <td><span class="gene-sym"><a href="/gene/${g.gene_name}" target="_blank" style="color:var(--accent);text-decoration:none">${g.gene_name}</a></span></td>
      <td style="font-size:12px">${g.full_name || ""}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center">
          ${groupDiseaseButton(g.gene_name, g.group_id, g.disease_ids)}
          <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="updateGeneGroupDisease('${g.gene_name}')">Set</button>
        </div>
      </td>
      <td><button class="btn-danger" onclick="deleteGene('${g.gene_name}')">Delete</button></td>
    </tr>`).join("");
}

function populateGeneSelects() {
  const opts = geneList.map(g => `<option value="${g.gene_name}">${g.gene_name}</option>`).join("");
  ["study-gene","export-gene"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
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
  const picked = readGdPanel("new-gene");
  const body = {
    gene_name:   geneLookupData.gene_name,
    full_name:   geneLookupData.full_name,
    description: geneLookupData.description,
    maplocation: geneLookupData.maplocation || null,
    group_id:    picked.groupId,
    disease_ids: picked.diseaseIds,
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
      document.getElementById("new-gene-groupdisease").innerHTML = "";
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
    ? `Delete ${name}, its studies, and these ${affected.length} SNPs: ${affected.join(", ")}? This cannot be undone.`
    : `Delete ${name} and all its studies? This cannot be undone.`;
  if (!confirm(msg)) return;
  apiFetch(`/api/gene/${name}`, { method: "DELETE" }).then(r => {
    if (r.ok) { toast("Deleted."); init(); }
    else toast("Delete failed.", true);
  });
}

async function updateGeneGroupDisease(geneName) {
  const picked = readGdPanel(geneName);
  const r = await apiFetch(`/api/gene/${geneName}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_id: picked.groupId || "", disease_ids: picked.diseaseIds }),
  });
  if (r.ok) { toast("Group/Disease updated."); init(); }
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

// Manual toggle, not a scan — nothing to fetch automatically for Scholar,
// this just flips a "have I done the paste-and-parse for this SNP" flag,
// with the date stamped server-side when turned on.
function schlrBadge(s) {
  const has = !!s.scholar_scanned_at;
  const dateStr = has ? new Date(s.scholar_scanned_at).toLocaleDateString() : null;
  const title = has ? `Scanned ${dateStr} — click to mark as not done` : "Click to mark Scholar scan as done";
  return `<button class="btn-sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:${has ? "#4ade80" : "var(--faint)"}"
            onclick="toggleScholarScanned('${s.rsid}', ${has ? 0 : 1})" title="${title}">Schlr: ${has ? "Yes" : "No"}</button>`;
}

function diseaseCell(s) {
  const ids = s.disease_ids || [];
  const label = ids.length ? `Diseases (${ids.length})` : "Diseases";
  return `<div class="disease-picker" style="position:relative;display:inline-block">
    <button class="btn-sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:${ids.length ? "#4ade80" : "var(--faint)"}"
      onclick="toggleDiseasePanel('${s.rsid}')">${label}</button>
    <div id="disease-panel-${s.rsid}" style="display:none;position:absolute;top:100%;left:0;z-index:10;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;margin-top:4px;min-width:180px;max-height:220px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.3)">
      ${diseaseChecklistHtml(ids)}
      ${diseaseList.length ? `<button class="btn-sm" style="font-size:10px;padding:3px 8px;margin-top:8px" onclick="saveSnpDiseases('${s.rsid}')">Save</button>` : ""}
    </div>
  </div>`;
}

// Reads whatever's currently checked in a bare disease-only picker panel —
// used for the Add SNP form, where the SNP doesn't exist yet so there's
// nothing to PATCH until Save SNP actually creates it.
function readDiseasePanel(idPrefix) {
  const panel = document.getElementById("disease-panel-" + idPrefix);
  if (!panel) return [];
  return Array.from(panel.querySelectorAll("input[type=checkbox]:checked")).map(el => parseInt(el.value));
}

// Same picker as diseaseCell() but for the Add SNP form's not-yet-saved SNP
// — no inline Save button (nothing to PATCH yet), read via readDiseasePanel()
// when Save SNP actually creates the row.
function renderNewSnpDiseasePicker() {
  const el = document.getElementById("new-snp-diseases");
  if (!el) return;
  const ids = readDiseasePanel("new-snp");
  el.innerHTML = `<div class="disease-picker" style="position:relative;display:inline-block">
    <button class="btn-sm" type="button" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:${ids.length ? "#4ade80" : "var(--faint)"}"
      onclick="toggleDiseasePanel('new-snp')">${ids.length ? `Diseases (${ids.length})` : "Diseases"}</button>
    <div id="disease-panel-new-snp" style="display:none;position:absolute;top:100%;left:0;z-index:10;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;margin-top:4px;min-width:180px;max-height:220px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,.3)">
      ${diseaseChecklistHtml(ids)}
    </div>
  </div>`;
}

function toggleDiseasePanel(rsid) {
  const panel = document.getElementById("disease-panel-" + rsid);
  const isOpen = panel.style.display === "block";
  document.querySelectorAll("[id^='disease-panel-']").forEach(p => p.style.display = "none");
  panel.style.display = isOpen ? "none" : "block";
}

document.addEventListener("click", e => {
  if (e.target.closest(".disease-picker") || e.target.closest(".gd-picker")) return;
  document.querySelectorAll("[id^='disease-panel-'], [id^='gd-panel-']").forEach(p => p.style.display = "none");
});

function saveSnpDiseases(rsid) {
  const panel = document.getElementById("disease-panel-" + rsid);
  const ids = Array.from(panel.querySelectorAll("input[type=checkbox]:checked")).map(el => parseInt(el.value));
  apiFetch(`/api/snp/${rsid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disease_ids: ids }),
  }).then(r => {
    if (r.ok) { toast("Diseases updated."); init(); }
    else toast("Failed to update.", true);
  });
}

function toggleScholarScanned(rsid, value) {
  apiFetch(`/api/snp/${rsid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scholar_scanned: value }),
  }).then(r => {
    if (r.ok) { toast(value ? "Marked as scanned." : "Marked as not scanned."); init(); }
    else toast("Failed to update.", true);
  });
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

// null = unsorted; otherwise "rr" | "pop" | "schlr". dir 1 = ascending
// (No's first; for schlr, Yes's after that sorted oldest-scanned-first),
// -1 = descending (Yes's first, newest-scanned-first, No's last).
let snpSortCol = null, snpSortDir = 1;

function snpSortCompare(col, a, b) {
  if (col === "rr") return (a.rr_url ? 1 : 0) - (b.rr_url ? 1 : 0);
  if (col === "pop") return ((a.pop_count || 0) > 0 ? 1 : 0) - ((b.pop_count || 0) > 0 ? 1 : 0);
  if (col === "schlr") {
    const ah = a.scholar_scanned_at ? 1 : 0, bh = b.scholar_scanned_at ? 1 : 0;
    if (ah !== bh) return ah - bh;
    if (!ah) return 0;
    return a.scholar_scanned_at - b.scholar_scanned_at;
  }
  return 0;
}

function sortSnpTable(col) {
  snpSortDir = (snpSortCol === col) ? -snpSortDir : 1;
  snpSortCol = col;
  snpList.sort((a, b) => snpSortDir * snpSortCompare(col, a, b));
  renderSnpTable();
}

function updateSnpSortArrows() {
  for (const col of ["rr", "pop", "schlr"]) {
    const el = document.getElementById("snp-sort-arrow-" + col);
    if (!el) continue;
    el.textContent = snpSortCol === col ? (snpSortDir === 1 ? "▲" : "▼") : "⇅";
  }
}

function renderSnpTable() {
  const tbody = document.getElementById("snp-tbody");
  if (!tbody) return;
  tbody.innerHTML = snpList.map(s => `
    <tr>
      <td><span class="gene-sym">${s.gene_name}</span></td>
      <td style="font-family:var(--mono);font-size:12px"><a href="/snp/${s.rsid}" target="_blank" style="color:var(--accent);text-decoration:none">${s.rsid}</a></td>
      <td id="allele-cell-${s.rsid}" style="font-family:var(--mono);font-size:12px">${s.alleles || ""}</td>
      <td style="display:flex;gap:6px">
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="editSnpAlleles('${s.rsid}')">Edit</button>
        <button class="btn-danger" onclick="deleteSnp('${s.rsid}')">Delete</button>
      </td>
      <td>${rrBadge(s)}</td>
      <td>${popBadge(s)}</td>
      <td>${schlrBadge(s)}</td>
      <td>${diseaseCell(s)}</td>
    </tr>`).join("");
  updateSnpSortArrows();
}

// Just the Alleles field is editable here — a forgotten-at-insert genotype
// is the common case this is for, not a general SNP-fact editor (those live
// on the `snps` table and get filled via Lookup/Scan instead).
function editSnpAlleles(rsid) {
  const cell = document.getElementById("allele-cell-" + rsid);
  const snp = snpList.find(s => s.rsid === rsid);
  cell.innerHTML = `
    <input id="allele-edit-${rsid}" value="${snp?.alleles || ""}" maxlength="4"
           oninput="this.value=this.value.toUpperCase()"
           style="font-family:var(--mono);font-size:11px;width:60px;background:var(--bg);border:1px solid var(--line);border-radius:3px;padding:3px 6px;color:var(--ink)">
    <button class="btn-sm" style="font-size:10px;padding:3px 6px;margin-left:4px" onclick="saveSnpAlleles('${rsid}')">Save</button>
    <button class="btn-sm" style="font-size:10px;padding:3px 6px;margin-left:2px;background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="renderSnpTable()">✕</button>`;
}

function saveSnpAlleles(rsid) {
  const val = document.getElementById("allele-edit-" + rsid).value.trim().toUpperCase();
  apiFetch(`/api/snp/${rsid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alleles: val }),
  }).then(r => {
    if (r.ok) { toast("Alleles updated."); init(); }
    else toast("Failed to update.", true);
  });
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

function snpOpenScholar() {
  const rsid = document.getElementById("snp-rsid").value.trim();
  if (!/^rs\d+$/i.test(rsid)) return toast("Enter a valid rsID first.", true);
  const url = `https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=%22${encodeURIComponent(rsid)}%22&btnG=`;
  window.open(url, "_blank", "noopener");
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

    // No gene on the lookup means NCBI couldn't attribute this rsID to a
    // single gene — genome-wide/intergenic association, not a lookup
    // failure. Default to the placeholder "INTERGENIC" gene rather than
    // leaving the field blank (which would block saving until typed).
    document.getElementById("prev-gene").value = d.gene_name || "INTERGENIC";
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
  const pickedDiseaseIds = readDiseasePanel("new-snp");
  apiFetch("/api/snp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      const linkDiseases = pickedDiseaseIds.length
        ? apiFetch(`/api/snp/${snpLookupData.rsid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ disease_ids: pickedDiseaseIds }),
          })
        : Promise.resolve();
      await linkDiseases;
      toast("SNP saved." + (d.frequencies_fetched ? " " + d.frequencies_fetched + " freq rows." : "") + (d.studies_found ? " " + d.studies_found + " studies found." : ""));
      clearSnpPreview();
      document.getElementById("snp-rsid").value = "";
      document.getElementById("snp-alleles").value = "";
      document.getElementById("new-snp-diseases").innerHTML = "";
      init();
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
// Backend runs Brave → DuckDuckGo → Wikipedia as one sequential fallback
// chain within a single request (see POST /api/group/description) and
// reports what happened at each step in `debug`. This turns that trail into
// a plain-English breakdown — not a true live stream (the whole chain has
// already finished by the time the response lands), but revealed one line
// at a time so it reads as the step-by-step account it actually is.
// Matches fetch()'s own .ok semantics (any 2xx counts, not just exactly
// 200) — DuckDuckGo in particular routinely answers with 202 while still
// returning a perfectly good body, which the backend already treats as
// success via .ok. Checking `=== 200` here would call that a failure even
// though the backend used it, which is exactly the bug that happened.
function isHttpOk(status) {
  return status >= 200 && status < 300;
}

function genSourceLogLines(d) {
  const dbg = d.debug || {};
  const lines = [];

  if (!dbg.bravePresent) {
    lines.push("Brave: skipped — no BRAVE_API_AI_KEY configured.");
  } else if (dbg.braveError) {
    lines.push(`Brave: error — ${dbg.braveError}`);
  } else if (!isHttpOk(dbg.braveSearchStatus)) {
    lines.push(`Brave: search request failed (HTTP ${dbg.braveSearchStatus}).`);
  } else if (!dbg.braveSummarizerKeyFound) {
    lines.push("Brave: no summarizer available for this query (plan may not include Summarizer).");
  } else if (!dbg.braveTextLength) {
    lines.push("Brave: summarizer returned no usable text.");
  } else if (d.source === "brave") {
    lines.push(`Brave: success — used this result (${dbg.braveTextLength} chars).`);
    return lines;
  }

  if (dbg.ddgError) {
    lines.push(`DuckDuckGo: error — ${dbg.ddgError}`);
  } else if (dbg.ddgStatus === undefined) {
    lines.push("DuckDuckGo: not reached.");
  } else if (!isHttpOk(dbg.ddgStatus)) {
    lines.push(`DuckDuckGo: request failed (HTTP ${dbg.ddgStatus}).`);
  } else if (!dbg.ddgTextLength) {
    lines.push("DuckDuckGo: no instant-answer abstract for this term.");
  } else if (d.source === "duckduckgo") {
    lines.push(`DuckDuckGo: success — used this result (${dbg.ddgTextLength} chars).`);
    return lines;
  }

  if (dbg.wikiError) {
    lines.push(`Wikipedia: error — ${dbg.wikiError}`);
  } else if (dbg.wikiStatus === undefined) {
    lines.push("Wikipedia: not reached.");
  } else if (!isHttpOk(dbg.wikiStatus)) {
    lines.push(`Wikipedia: no matching article (HTTP ${dbg.wikiStatus}).`);
  } else if (!dbg.wikiTextLength) {
    lines.push("Wikipedia: article found but had no summary text.");
  } else if (d.source === "wikipedia") {
    lines.push(`Wikipedia: success — used this result (${dbg.wikiTextLength} chars).`);
    return lines;
  }

  lines.push("No source returned a usable description.");
  return lines;
}

function renderGenLog(elId, d) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.style.display = "block";
  el.innerHTML = "";
  genSourceLogLines(d).forEach((line, i) => {
    setTimeout(() => {
      const row = document.createElement("div");
      row.textContent = line;
      el.appendChild(row);
    }, i * 350);
  });
}

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
    renderGenLog("group-gen-log", d);
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

// ── Disease tab ───────────────────────────────────
// Reuses the same generic name→description lookup as Groups (DuckDuckGo,
// falling back to Wikipedia) — it's not gene/group-specific, just a lookup
// by name, so no separate disease endpoint is needed.
async function generateDiseaseDescription() {
  const name = document.getElementById("disease-name").value.trim();
  if (!name) return toast("Enter a disease name first.", true);
  const btn = document.getElementById("disease-gen-btn");
  btn.textContent = "...";
  btn.disabled = true;
  try {
    const r = await apiFetch("/api/group/description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json();
    renderGenLog("disease-gen-log", d);
    if (d.description) {
      document.getElementById("disease-description").value = d.description;
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

function renderDiseaseTable() {
  const tbody = document.getElementById("disease-tbody");
  if (!tbody) return;
  tbody.innerHTML = diseaseList.map(d => diseaseRow(d)).join("");
}

// Parses the shared "GENE — rsID" picker format used by the Bulk/Discover
// tabs' datalist (#bulk-snp-list), so the same typed value works here too.
function parseSnpPickerValue(val) {
  const m = (val || "").trim().match(/^(.+?)\s*—\s*(rs\d+)$/i);
  if (!m) return null;
  return snpList.find(s => s.gene_name === m[1].trim().toUpperCase() && s.rsid.toLowerCase() === m[2].toLowerCase()) || null;
}

function snpDiseaseChip(rsid, onRemove) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-family:var(--mono);font-size:11px;background:var(--card);border:1px solid var(--line);border-radius:3px;padding:2px 6px;color:var(--ink)">
    ${rsid}<span style="cursor:pointer;color:#f87171" onclick="${onRemove}" title="Remove">×</span>
  </span>`;
}

// ── Add-Disease-form SNP staging (disease doesn't exist yet, so nothing is
// saved to snp_diseases until addDisease() gets a real id back) ──────────
function addPendingDiseaseSnp() {
  const inputEl = document.getElementById("disease-new-snp-picker");
  const snp = parseSnpPickerValue(inputEl.value);
  if (!snp) return toast("Pick a valid SNP from the list.", true);
  if (!pendingDiseaseSnps.includes(snp.rsid)) pendingDiseaseSnps.push(snp.rsid);
  inputEl.value = "";
  renderPendingDiseaseSnpChips();
}

function removePendingDiseaseSnp(rsid) {
  pendingDiseaseSnps = pendingDiseaseSnps.filter(r => r !== rsid);
  renderPendingDiseaseSnpChips();
}

function renderPendingDiseaseSnpChips() {
  const el = document.getElementById("disease-new-snp-chips");
  if (!el) return;
  el.innerHTML = pendingDiseaseSnps.length
    ? pendingDiseaseSnps.map(rsid => snpDiseaseChip(rsid, `removePendingDiseaseSnp('${rsid}')`)).join("")
    : "";
}

function diseaseRow(d) {
  const name = d.name.replace(/'/g, "\\'");
  const desc = (d.description || "").replace(/'/g, "\\'");
  const linked = snpList.filter(s => (s.disease_ids || []).includes(d.id));
  return `
    <tr id="drow-${d.id}">
      <td id="dcell-name-${d.id}"><span class="gene-sym">${d.name}</span></td>
      <td id="dcell-desc-${d.id}" style="font-size:12px;color:var(--muted)">${d.description || ""}</td>
      <td id="dcell-actions-${d.id}" style="display:flex;gap:6px">
        <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="editDisease(${d.id}, '${name}', '${desc}')">Edit</button>
        <button class="btn-danger" onclick="deleteDisease(${d.id}, '${name}')">Delete</button>
      </td>
      <td style="min-width:220px">
        <div id="disease-snps-${d.id}" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          ${linked.length
            ? linked.map(s => snpDiseaseChip(s.rsid, `removeSnpFromDisease(${d.id}, '${s.rsid}')`)).join("")
            : `<span style="font-size:11px;color:var(--faint)">No SNPs yet</span>`}
        </div>
        <div style="display:flex;gap:6px">
          <input list="bulk-snp-list" id="disease-snp-picker-${d.id}" placeholder="Type to search…"
                 style="font-family:var(--mono);font-size:11px;background:var(--card);border:1px solid var(--line);border-radius:3px;padding:4px 8px;color:var(--ink);margin:0;flex:1"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();addSnpToDisease(${d.id});}">
          <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="addSnpToDisease(${d.id})">Add</button>
        </div>
      </td>
    </tr>`;
}

function editDisease(id, name, desc) {
  document.getElementById("dcell-name-" + id).innerHTML =
    `<input id="dedit-name-${id}" value="${name}" style="font-family:var(--mono);font-size:12px;width:100%;background:var(--bg);border:1px solid var(--line);border-radius:3px;padding:4px 8px;color:var(--ink)">`;
  document.getElementById("dcell-desc-" + id).innerHTML =
    `<input id="dedit-desc-${id}" value="${desc}" style="font-size:12px;width:100%;background:var(--bg);border:1px solid var(--line);border-radius:3px;padding:4px 8px;color:var(--ink)">`;
  document.getElementById("dcell-actions-" + id).innerHTML = `
    <button class="btn-sm" style="font-size:10px;padding:3px 8px" onclick="saveDiseaseEdit(${id})">Save</button>
    <button class="btn-sm" style="font-size:10px;padding:3px 8px;background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="renderDiseaseTable()">Cancel</button>`;
}

async function saveDiseaseEdit(id) {
  const name = document.getElementById("dedit-name-" + id).value.trim();
  const desc = document.getElementById("dedit-desc-" + id).value.trim();
  if (!name) return toast("Name cannot be empty.", true);
  const r = await apiFetch(`/api/disease/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: desc || null }),
  });
  if (r.ok) { toast("Disease updated."); init(); }
  else toast("Update failed.", true);
}

function deleteDisease(id, name) {
  if (!confirm(`Delete disease "${name}"? SNPs assigned to it will lose that link.`)) return;
  apiFetch(`/api/disease/${id}`, { method: "DELETE" }).then(r => {
    if (r.ok) { toast("Disease deleted."); init(); }
    else toast("Delete failed.", true);
  });
}

// Adds/removes one disease id from a single SNP's existing disease set —
// PATCH /api/snp/:rsid replaces the whole set, so read-modify-write against
// the SNP's current disease_ids rather than sending just the one id.
function addSnpToDisease(diseaseId) {
  const inputEl = document.getElementById("disease-snp-picker-" + diseaseId);
  const snp = parseSnpPickerValue(inputEl.value);
  if (!snp) return toast("Pick a valid SNP from the list.", true);
  if ((snp.disease_ids || []).includes(diseaseId)) { inputEl.value = ""; return toast("Already linked."); }
  const ids = [...(snp.disease_ids || []), diseaseId];
  apiFetch(`/api/snp/${snp.rsid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disease_ids: ids }),
  }).then(r => {
    if (r.ok) { toast("SNP linked."); init(); }
    else toast("Failed to link.", true);
  });
}

function removeSnpFromDisease(diseaseId, rsid) {
  const snp = snpList.find(s => s.rsid === rsid);
  if (!snp) return;
  const ids = (snp.disease_ids || []).filter(id => id !== diseaseId);
  apiFetch(`/api/snp/${rsid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disease_ids: ids }),
  }).then(r => {
    if (r.ok) { toast("SNP unlinked."); init(); }
    else toast("Failed to unlink.", true);
  });
}

function addDisease() {
  const name = document.getElementById("disease-name").value.trim();
  const description = document.getElementById("disease-description").value.trim();
  if (!name) return toast("Disease name is required.", true);
  apiFetch("/api/disease", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  }).then(async r => {
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      const linkAll = pendingDiseaseSnps.length && d.id
        ? Promise.all(pendingDiseaseSnps.map(rsid => {
            const snp = snpList.find(s => s.rsid === rsid);
            const ids = [...new Set([...(snp?.disease_ids || []), d.id])];
            return apiFetch(`/api/snp/${rsid}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ disease_ids: ids }),
            });
          }))
        : Promise.resolve();
      linkAll.then(() => {
        toast("Disease saved.");
        document.getElementById("disease-name").value = "";
        document.getElementById("disease-description").value = "";
        pendingDiseaseSnps = [];
        renderPendingDiseaseSnpChips();
        init();
      });
    } else {
      const d = await r.json().catch(() => ({}));
      toast("Error: " + (d.error || r.status), true);
    }
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
      ${r._open ? `
        <div class="admin-form" style="border-top:1px solid var(--line);margin-top:4px;padding-top:16px">
          <label>Title</label>
          <input type="text" id="discover-title-${i}" value="${escAttr(r.title || "")}">
          <div class="field-row">
            <div class="field">
              <label>Authors</label>
              <input type="text" id="discover-authors-${i}" placeholder="Smith J et al.">
            </div>
            <div class="field">
              <label>Year</label>
              <input type="number" id="discover-year-${i}" placeholder="2023" min="1950" max="2099">
            </div>
          </div>
          <label>PID (DOI / Handle, optional)</label>
          <input type="text" id="discover-pid-${i}" placeholder="10.1234/example">
          <label>Snippet</label>
          <textarea id="discover-snippet-${i}" class="mono">${escHtml(r.description || r.title || "")}</textarea>
          <div style="display:flex;gap:10px">
            <button class="btn-sm" onclick="discoverSubmitAdd(${i})">Save Study</button>
            <button class="btn-sm" style="background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="discoverToggleAdd(${i})">Cancel</button>
          </div>
        </div>
      ` : `
        <div style="display:flex;gap:10px">
          <button class="btn-sm" onclick="discoverToggleAdd(${i})">+ Add as Study</button>
          <button class="btn-sm" style="background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="discoverExclude(${i}, true, false)">Mark Duplicate</button>
          <button class="btn-sm" style="background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="discoverExclude(${i}, false, true)">Trash</button>
        </div>
      `}
    </div>
  `).join("");
}

function discoverToggleAdd(i) {
  discoverResults[i]._open = !discoverResults[i]._open;
  renderDiscoverResults();
}

async function discoverSubmitAdd(i) {
  const r = discoverResults[i];
  const body = {
    gene_name: discoverGene,
    rsid: discoverRsid,
    snippet: document.getElementById(`discover-snippet-${i}`).value.trim() || r.title,
    authors: document.getElementById(`discover-authors-${i}`).value.trim() || null,
    year: parseInt(document.getElementById(`discover-year-${i}`).value) || null,
    title: document.getElementById(`discover-title-${i}`).value.trim() || null,
    url: r.url || null,
    pid: document.getElementById(`discover-pid-${i}`).value.trim() || null,
  };
  try {
    const res = await apiFetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    discoverResults.splice(i, 1);
    renderDiscoverResults();
    toast("Study saved.");
  } catch (e) {
    toast("Save failed: " + e.message, true);
  }
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

// ── Scholar tab (pasted-page-source parser) ───────
// No network fetch of Scholar itself — you paste the page's HTML source
// (View Page Source, not the rendered page, which loses hrefs) after
// browsing it yourself, sidestepping bot-detection entirely since a real
// browser session already rendered it.
function scholarSnpPicked() {
  const val = document.getElementById("scholar-snp-picker").value.trim();
  let match = null;
  let m = val.match(/^(.+?)\s*—\s*(rs\d+)$/i);
  if (m) match = snpList.find(s => s.gene_name === m[1].trim().toUpperCase() && s.rsid.toLowerCase() === m[2].toLowerCase());
  if (!match) {
    m = val.match(/^(rs\d+)$/i);
    if (m) match = snpList.find(s => s.rsid.toLowerCase() === m[1].toLowerCase());
  }
  scholarGene = match ? match.gene_name : null;
  scholarRsid = match ? match.rsid : null;
  document.getElementById("scholar-parse-btn").disabled = !match;

  const urlInput = document.getElementById("scholar-open-url");
  const openBtn = document.getElementById("scholar-open-btn");
  if (match) {
    urlInput.value = `https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=%22${encodeURIComponent(match.rsid)}%22&btnG=`;
    openBtn.disabled = false;
  } else {
    urlInput.value = "";
    openBtn.disabled = true;
  }
}

function scholarOpenUrl() {
  const url = document.getElementById("scholar-open-url").value;
  if (url) window.open(url, "_blank", "noopener");
}

// The pagination nav renders every neighboring page as a linked
// <a class="gs_nma" href="...start=N...">, except the current page, which is
// the one exception: <b class="gs_nma">47</b> — bold text, no link, no start=
// at all. That's the reliable signal (confirmed against a real paste: page 47
// with no link corresponded to start=460 in the URL, i.e. (page-1)*10).
function scholarDetectStart(html) {
  const m = html.match(/<b class="gs_nma">(\d+)<\/b>/);
  if (!m) return null;
  const page = parseInt(m[1]);
  return { page, start: (page - 1) * 10 };
}

function scholarDetectPageUpdate() {
  const html = document.getElementById("scholar-html-input").value;
  const det = scholarDetectStart(html);
  document.getElementById("scholar-page-detect").value = det ? `Page ${det.page} (start=${det.start})` : "—";
}

function scholarStripTags(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Abstracts on Scholar often open with a structured header ("Background:",
// "Aim:", "Purpose:", "Objective:", "Introduction:", "Methods:",
// "Full Article:", "Results:"), a pair joined by "and"/"&" (e.g. "Purpose
// & Aims:"), a trailing "of the Review" (e.g. "Purpose of the Review:",
// "Results of the Review:"), or the fixed idiom "What is known and
// objective" (common in pharmacy-journal abstracts) — strip it so the
// snippet reads as plain prose instead of starting mid-label.
function scholarStripLeadLabel(s) {
  const label = "(?:backgrounds?|aims?|purposes?|objectives?|introductions?|introducci(?:ón|ones)|introdu(?:ção|ções)|resumen|resúmenes|résumés?|contextes?|abstracts?|scopes?|methods?|full articles?|results?)";
  const combo = `(?:${label}(?:\\s*(?:and|&|\\/)\\s*${label})?(?:\\s+of\\s+the\\s+review)?)`;
  const phrase = "what is known and objective";
  // A lone "." right after the label is stray label punctuation and gets
  // stripped, but "..." (ellipsis) is left alone — that's a deliberate
  // truncation marker, not a delimiter, so the negative lookahead guards it.
  const re = new RegExp(`^\\s*(?:${combo}|${phrase})\\s*(?:[:/]|\\.(?!\\.\\.))?\\s*[-—]?\\s*`, "i");
  return (s || "").replace(re, "");
}

function scholarDecodeEntities(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Generic fallback for any other numeric entity (e.g. &#8217; curly
    // apostrophe, &#8211;/&#8212; en/em dash) rather than enumerating each one.
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// Ported from worker.js's email-intake path — only kicks in when a whole
// field is genuinely SHOUTING in all-caps (titles, authors, or snippets can
// all come through that way from certain publishers), leaving normally-cased
// text untouched rather than reformatting it.
const SCHOLAR_TITLE_ACRONYMS = new Set([
  "adhd", "iq", "llm", "llms", "ai", "ml", "usa", "uk", "eu",
  "pdf", "doi", "gpt", "nlp", "dna", "rna", "snp", "snps",
  "mrna", "pcr", "gwas", "mthfr", "mtr", "mtrr", "dhfr",
  "ada", "ak2", "rag1", "rag2", "phd", "covid", "hiv",
]);
const SCHOLAR_TITLE_SMALL = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on",
  "or", "the", "to", "vs", "via", "with", "from",
]);

function scholarCapTitleCore(core, idx, total) {
  if (!core) return core;
  for (const sep of ["–", "—", "-"]) {
    if (core.includes(sep)) {
      const parts = core.split(sep);
      return parts.map((p, i) => scholarCapTitleCore(p, i, parts.length)).join(sep);
    }
  }
  const low = core.toLowerCase();
  if (SCHOLAR_TITLE_ACRONYMS.has(low)) return core.toUpperCase();
  if (idx > 0 && idx < total - 1 && SCHOLAR_TITLE_SMALL.has(low)) return low;
  if (core.length === 1) return core.toUpperCase();
  return core[0].toUpperCase() + core.slice(1).toLowerCase();
}

function scholarTitleCaseFromAllCaps(text) {
  const s = (text || "").trim().toLowerCase();
  if (!s) return text;
  const parts = s.split(/(\s+)/);
  const words = parts.filter((p) => p && !/^\s+$/.test(p));
  let wi = 0;
  const out = [];
  for (const p of parts) {
    if (/^\s+$/.test(p)) { out.push(p); continue; }
    const m = p.match(/^([\"'(\[]*)(.*?)([\"')\].,:;!?™]*)$/);
    if (!m) { out.push(scholarCapTitleCore(p, wi, words.length)); wi++; continue; }
    const [, pre, core, suf] = m;
    if (core) { out.push(pre + scholarCapTitleCore(core, wi, words.length) + suf); wi++; }
    else out.push(p);
  }
  return out.join("");
}

function scholarNormalizeAllCaps(text) {
  const t = (text || "").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return t;
  return scholarTitleCaseFromAllCaps(t);
}

// Author lines ("JY Kim, HS Cheong, …") aren't prose — the generic title-case
// logic above would wrongly lowercase initials like "JY" into "Jy". Only
// fires on a genuinely all-caps line. A length threshold isn't reliable (some
// surnames, e.g. "Kim", are as short as an initials cluster) — position is:
// the first word in each comma-separated author entry is the initials
// cluster and stays fully capitalized, every word after it is the surname
// and gets normal capitalization.
function scholarNormalizeAuthorsAllCaps(text) {
  const t = (text || "").trim();
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return t;
  return t.split(",").map(part => {
    let first = true;
    return part.replace(/[A-Za-z]+/g, w => {
      if (first) { first = false; return w.toUpperCase(); }
      return w[0].toUpperCase() + w.slice(1).toLowerCase();
    });
  }).join(",");
}

// Google Scholar's results markup, per result: a div.gs_ri containing an
// h3.gs_rt (title + link, sometimes prefixed with a [PDF]/[CITATION] tag),
// a div.gs_a (authors/venue/year line), and a div.gs_rs (snippet). Class
// names could drift over time — if parsing comes back empty on a real
// paste, that's the first thing to check against the actual pasted HTML.
function scholarParseHtml(html) {
  const results = [];
  const blocks = html.split(/<div class="gs_ri">/).slice(1);
  for (const block of blocks) {
    const h3Match = block.match(/<h3[^>]*class="gs_rt"[^>]*>([\s\S]*?)<\/h3>/i);
    if (!h3Match) continue;
    const linkMatch = h3Match[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue; // e.g. [CITATION] entries with no linked source
    const url = scholarDecodeEntities(linkMatch[1]);
    const title = scholarNormalizeAllCaps(scholarDecodeEntities(scholarStripTags(linkMatch[2])));
    if (!title || !url) continue;

    const authorsMatch = block.match(/<div[^>]*class="gs_a"[^>]*>([\s\S]*?)<\/div>/i);
    const authorsFull = authorsMatch ? scholarDecodeEntities(scholarStripTags(authorsMatch[1])) : "";
    // Format is "Authors - Venue, Year - Publisher"; only split on " - " (spaces
    // required on both sides) so hyphenated surnames like "Jean-Pierre" survive.
    // Strip any digits that leak in (e.g. a year, if the split above ever
    // misfires on an unusual line) — author names shouldn't contain numbers.
    const authors = scholarNormalizeAuthorsAllCaps(
      authorsFull.split(" - ")[0].replace(/\d+/g, "").replace(/\s+/g, " ").trim()
    );

    const snippetMatch = block.match(/<div[^>]*class="gs_rs"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = snippetMatch
      ? scholarNormalizeAllCaps(scholarStripLeadLabel(scholarDecodeEntities(scholarStripTags(snippetMatch[1]))))
      : "";

    const yearMatch = authorsFull.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? parseInt(yearMatch[0]) : null;

    results.push({ title, url, authors, snippet, year });
  }
  return results;
}

async function scholarParse() {
  if (!scholarGene || !scholarRsid) return toast("Pick a gene/rsID first.", true);
  const html = document.getElementById("scholar-html-input").value;
  if (!html.trim()) return toast("Paste the page source first.", true);

  const parsed = scholarParseHtml(html);
  if (!parsed.length) return toast("Nothing parsed — check you pasted View Page Source, not the visible page.", true);

  const [studies, exclusions] = await Promise.all([
    safeFetchJson("/api/studies"),
    safeFetchJson("/api/exclusions"),
  ]);
  const known = (studies?.studies || []).concat(exclusions?.exclusions || []);
  // Unlike Discover, known results stay visible (dimmed) rather than being
  // dropped, per spec — you can see what got skipped and why.
  scholarResults = parsed.map(r => ({ ...r, _known: !!bulkFindDuplicate(r, known) }));
  renderScholarResults();
  document.getElementById("scholar-review").style.display = "block";
}

function renderScholarResults() {
  const newCount = scholarResults.filter(r => !r._known && !r._excluded).length;
  const knownCount = scholarResults.filter(r => r._known).length;
  const excludedCount = scholarResults.filter(r => r._excluded).length;
  document.getElementById("scholar-count").textContent =
    `${scholarResults.length} parsed for ${scholarGene} — ${scholarRsid} (${newCount} new, ${knownCount} already known, ${excludedCount} excluded)`;
  const wrap = document.getElementById("scholar-results");
  // New results first, already-known/excluded ones sunk to the bottom — stable
  // within each group, so relative parse order is preserved either side of the split.
  const order = scholarResults.map((_, i) => i).sort((a, b) => {
    const sortKey = r => (r._known || r._excluded) ? 1 : 0;
    return sortKey(scholarResults[a]) - sortKey(scholarResults[b]);
  });
  wrap.innerHTML = order.map(i => {
    const r = scholarResults[i];
    if (r._known) {
      return `
      <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:6px;padding:14px 16px;margin-bottom:10px;opacity:0.55">
        <a href="${escAttr(r.url)}" target="_blank" rel="noopener" style="font-size:13px;font-weight:600;color:#34d399">${escHtml(r.title)}</a>
        <div style="font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:4px">Already known — skipped</div>
      </div>`;
    }
    if (r._excluded) {
      return `
      <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);border-radius:6px;padding:14px 16px;margin-bottom:10px;opacity:0.55">
        <a href="${escAttr(r.url)}" target="_blank" rel="noopener" style="font-size:13px;font-weight:600;color:#f87171">${escHtml(r.title)}</a>
        <div style="font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:4px">Excluded — won't resurface in future scans</div>
      </div>`;
    }
    return `
    <div style="background:var(--card);border:1px solid var(--line);border-radius:6px;padding:16px;margin-bottom:12px">
      <a href="${escAttr(r.url)}" target="_blank" rel="noopener" style="font-size:14px;font-weight:600;color:var(--accent)">${escHtml(r.title)}</a>
      <div style="font-family:var(--mono);font-size:10px;color:var(--faint);margin:4px 0 8px;word-break:break-all">${escHtml(r.url)}</div>
      ${r.snippet ? `<p style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:12px">${escHtml(r.snippet)}</p>` : ""}
      ${r._open ? `
        <div class="admin-form" style="border-top:1px solid var(--line);margin-top:4px;padding-top:16px">
          <label>Title</label>
          <input type="text" id="scholar-title-${i}" value="${escAttr(r.title)}">
          <div class="field-row">
            <div class="field">
              <label>Authors</label>
              <input type="text" id="scholar-authors-${i}" value="${escAttr(r.authors)}" placeholder="Smith J et al.">
            </div>
            <div class="field">
              <label>Year</label>
              <input type="number" id="scholar-year-${i}" value="${escAttr(r.year)}" placeholder="2023" min="1950" max="2099">
            </div>
          </div>
          <label>PID (DOI / Handle, optional)</label>
          <input type="text" id="scholar-pid-${i}" placeholder="10.1234/example">
          <label>Snippet</label>
          <textarea id="scholar-snippet-${i}" class="mono">${escHtml(r.snippet || r.title || "")}</textarea>
          <div style="display:flex;gap:10px;justify-content:space-between">
            <div style="display:flex;gap:10px">
              <button class="btn-sm" onclick="scholarSubmitAdd(${i})">Save Study</button>
              <button class="btn-sm" style="background:transparent;border:1px solid var(--line);color:var(--muted)" onclick="scholarToggleAdd(${i})">Cancel</button>
            </div>
            <button class="btn-sm" style="background:#e84580;color:#2a1220" onclick="scholarExcludeStudy(${i})">Exclude</button>
          </div>
        </div>
      ` : `
        <button class="btn-sm" onclick="scholarToggleAdd(${i})">+ Add as Study</button>
      `}
    </div>`;
  }).join("");
}

function scholarToggleAdd(i) {
  scholarResults[i]._open = !scholarResults[i]._open;
  renderScholarResults();
}

async function scholarSubmitAdd(i) {
  const r = scholarResults[i];
  const body = {
    gene_name: scholarGene,
    rsid: scholarRsid,
    snippet: document.getElementById(`scholar-snippet-${i}`).value.trim() || r.title,
    authors: document.getElementById(`scholar-authors-${i}`).value.trim() || null,
    year: parseInt(document.getElementById(`scholar-year-${i}`).value) || null,
    title: document.getElementById(`scholar-title-${i}`).value.trim() || null,
    url: r.url || null,
    pid: document.getElementById(`scholar-pid-${i}`).value.trim() || null,
  };
  try {
    const res = await apiFetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    scholarResults.splice(i, 1);
    renderScholarResults();
    toast("Study saved.");
  } catch (e) {
    toast("Save failed: " + e.message, true);
  }
}

async function scholarExcludeStudy(i) {
  const r = scholarResults[i];
  try {
    const res = await apiFetch("/api/exclusion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: r.title, url: r.url, trash: true }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    r._excluded = true;
    r._open = false;
    renderScholarResults();
    toast("Excluded — won't resurface in future scans.");
  } catch (e) {
    toast("Failed: " + e.message, true);
  }
}
