let TOKEN = "";
let geneList = [];
let groupList = [];
let snpList = [];

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
function init() {
  Promise.all([
    apiFetch("/api/genes").then(r => r.json()),
    apiFetch("/api/groups").then(r => r.json()),
    apiFetch("/api/snps").then(r => r.json()),
  ]).then(([genes, groups, snps]) => {
    geneList  = genes.genes   || genes   || [];
    groupList = groups.groups || groups  || [];
    snpList   = snps.snps     || snps    || [];
    renderGeneTable();
    renderGroupTable();
    renderSnpTable();
    populateGeneSelects();
    populateGroupSelect();
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
  if (!confirm(`Delete ${name} and all its studies, alerts, and SNPs? This cannot be undone.`)) return;
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
function renderSnpTable() {
  const tbody = document.getElementById("snp-tbody");
  if (!tbody) return;
  tbody.innerHTML = snpList.map(s => `
    <tr>
      <td><span class="gene-sym">${s.gene_name}</span></td>
      <td style="font-family:var(--mono);font-size:12px"><a href="/snp/${s.rsid}" target="_blank" style="color:var(--accent);text-decoration:none">${s.rsid}</a></td>
      <td style="font-family:var(--mono);font-size:12px">${s.genotype || ""}</td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--faint)">${s.chromosome ? "Chr " + s.chromosome : ""}</td>
      <td><button class="btn-danger" onclick="deleteSnp('${s.rsid}')">Delete</button></td>
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
  const geneSelect = document.getElementById("prev-gene-select");
  const gene = geneSelect.style.display !== "none" ? geneSelect.value : snpLookupData.gene_name;
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
    document.getElementById("prev-chr").textContent = d.chromosome ? "Chr " + d.chromosome : "";

    const geneSpan   = document.getElementById("prev-gene");
    const geneSelect = document.getElementById("prev-gene-select");
    if (d.gene_names && d.gene_names.length > 1) {
      geneSpan.style.display = "none";
      geneSelect.style.display = "";
      geneSelect.innerHTML = d.gene_names.map(n => `<option value="${n}">${n}</option>`).join("");
    } else {
      geneSpan.style.display = "";
      geneSpan.textContent = d.gene_name || "Gene unknown";
      geneSelect.style.display = "none";
    }
    document.getElementById("prev-consequence").textContent = d.consequence || "";
    document.getElementById("prev-magnitude").textContent = d.magnitude != null ? "Magnitude " + d.magnitude : "";
    document.getElementById("prev-summary").textContent = d.summary || "";
    document.getElementById("prev-ncbi").href = "https://www.ncbi.nlm.nih.gov/snp/" + d.rsid;
    document.getElementById("prev-snpedia").href = "https://www.snpedia.com/index.php/" + d.rsid;
    document.getElementById("prev-genecards").href = d.gene_name
      ? `https://www.genecards.org/card/${d.gene_name}?Search=${d.rsid}#Variants_Variants`
      : "#";
    document.getElementById("snp-preview").style.display = "block";

    checkSnpGeneWarn();
    if (d.gene_names && d.gene_names.length > 1) {
      document.getElementById("prev-gene-select").addEventListener("change", checkSnpGeneWarn);
    }
  } catch (e) {
    toast("Lookup failed: " + e.message, true);
  } finally {
    btn.textContent = "Lookup";
    btn.disabled = false;
  }
}

function saveSnp() {
  if (!snpLookupData) return toast("Look up an SNP first.", true);
  const geneSelect = document.getElementById("prev-gene-select");
  const chosenGene = geneSelect.style.display !== "none"
    ? geneSelect.value
    : snpLookupData.gene_name;
  if (!chosenGene) return toast("No gene found for this SNP.", true);
  if (geneList.length && !geneList.find(g => g.gene_name === chosenGene)) {
    if (!confirm(`"${chosenGene}" is not in your gene list yet. Save the SNP anyway?`)) return;
  }
  const body = {
    gene_name:      chosenGene,
    rsid:           snpLookupData.rsid,
    genotype:       document.getElementById("snp-genotype").value.trim().toUpperCase() || null,
    chromosome:     snpLookupData.chromosome,
    magnitude:      snpLookupData.magnitude,
    status:         "pending",
    notes:          [snpLookupData.protein_change, snpLookupData.summary].filter(Boolean).join(" — ") || null,
    ref_allele:     snpLookupData.ref_allele    || null,
    alt_allele:     snpLookupData.alt_allele    || null,
    protein_change: snpLookupData.protein_change || null,
  };
  apiFetch("/api/snp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async r => {
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      toast("SNP saved." + (d.frequencies_fetched ? " " + d.frequencies_fetched + " freq rows." : ""));
      clearSnpPreview();
      document.getElementById("snp-rsid").value = "";
      document.getElementById("snp-genotype").value = "";
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
        body: JSON.stringify({ ref_allele: ld.ref_allele, alt_allele: ld.alt_allele, protein_change: ld.protein_change }),
      });
      if (!pr.ok) throw new Error("PATCH failed " + pr.status);

      done++;
      const alleles = (ld.ref_allele && ld.alt_allele) ? `${ld.ref_allele}/${ld.alt_allele}` : "—";
      bfLog(`✓  ${alleles}${ld.protein_change ? "  " + ld.protein_change : ""}\n`);
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
