const FETCH = 24;
const SCIHUB_MIRROR = "https://sci-hub.red/";
const pageSize = () => (window.matchMedia("(max-width: 860px)").matches ? 2 : 3);
const elSections   = document.getElementById("sections");
const elRail       = document.getElementById("railnav");
const elStatus     = document.getElementById("status");
const elQ          = document.getElementById("q");
const elNew        = document.getElementById("newtag");
const elAdd        = document.getElementById("addbtn");
const elStudyUrl   = document.getElementById("studyurl");
const elStudyScan  = document.getElementById("studyscan");
const elStudyForm  = document.getElementById("studyform");
const elStudyTitle = document.getElementById("studytitle");
const elStudyAuthor = document.getElementById("studyauthor");
const elStudySnip  = document.getElementById("studysnip");
const elStudyTag   = document.getElementById("studytag");
const elStudySubmit = document.getElementById("studysubmit");
const elStudyCancel = document.getElementById("studycancel");
const elTrashLink  = document.getElementById("trashlink");
const elTrashCount = document.getElementById("trashcount");
const elShotsLink  = document.getElementById("shotslink");
const elShotsCount = document.getElementById("shotscount");
const elLightbox   = document.getElementById("lightbox");
const elLightboxImg = document.getElementById("lightbox-img");
const elToast      = document.getElementById("toast");

const pageOf = new Map();
let view   = "sections";
let authPw = null;
let allTags = [];
let studyLink = "";

const RAIL_GROUPS = [
  {
    banner: "Noetics",
    tags: ["Experimental Philosophy", "Dreams", "Śūnyatā", "Meditation"],
  },
];

// Keep in sync with worker.js
const TERM_ALIASES = {
  "big 5": "Big Five",
  "big five": "Big Five",
  "myers-briggs": "MBTI",
};

const CANONICAL_TAGS = [
  "Big Five",
  "Big Ten",
  "MBTI",
];

function canonical(tag) {
  const key = (tag || "").toLowerCase().trim();
  if (!key) return tag;
  if (TERM_ALIASES[key]) return TERM_ALIASES[key];
  for (const t of CANONICAL_TAGS) {
    if (t.toLowerCase() === key) return t;
  }
  return tag;
}

async function postWrite(url, payload) {
  if (authPw === null) {
    authPw = window.prompt("Password:") || "";
  }
  let r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, auth: authPw }),
  });
  if (r.status === 401) {
    authPw = window.prompt("Wrong password — try again:") || "";
    r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, auth: authPw }),
    });
    if (r.status === 401) { authPw = null; alert("Password incorrect."); }
  }
  return r;
}

function esc(s){ return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function slug(s){ return "sec-" + (s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }

const ACRONYMS = new Set(["adhd","mbti","hexaco","ocd","ptsd","iq","eq","big5","asd","bpd"]);

const TAG_DISPLAY_LABELS = {
  "Dark Triad": "Dark Triad / Dark Tetrad / Machiavellianism",
  "Mate Choice": "Mate Choice / Assortative Mating / Intersexual Selection",
  "Sunlight": "Sunlight / Red Light / Vitamin D / Blue Light",
  "Śūnyatā": "Śūnyatā / Śūnya",
  "ADHD": "ADHD / ADHD and Nicotine",
};

// Rail-only short labels — shown in sidebar but NOT in the main content heading
const RAIL_SHORT_LABELS = {};

function sectionLabel(s) {
  return TAG_DISPLAY_LABELS[s?.tag] || s?.label || s?.tag || "";
}

function prettyLabel(raw) {
  let s = (raw || "").trim();

  const term = (word) =>
    word.replace(/["""']/g, "").split(/\s+/).filter(Boolean).map((w) => {
      const low = w.toLowerCase();
      if (ACRONYMS.has(low.replace(/[^a-z0-9]/g, ""))) return esc(w.toUpperCase());
      return esc(w.charAt(0).toUpperCase() + w.slice(1));
    }).join(" ");

  if (s.includes("/")) {
    const parts = s.split("/").map((p) => p.trim()).filter(Boolean);
    const head = term(parts[0]);
    const rest = parts.slice(1)
      .map((p) => `<small class="op">/ ${term(p)}</small>`)
      .join(" ");
    return rest ? `${head} ${rest}` : head;
  }

  const hasOp = /\b(AND|OR|NOT)\b/i.test(s);
  if (!hasOp) return term(s);

  return s
    .split(/\b(AND|OR|NOT)\b/i)
    .map((part) => {
      if (/^(AND|OR|NOT)$/i.test(part.trim()) && part.trim()) {
        return `<small class="op">${part.trim().toLowerCase()}</small>`;
      }
      const t = part.trim();
      return t ? term(t) : "";
    })
    .filter(Boolean)
    .join(" ");
}

function ago(iso){
  if(!iso) return "";
  const d = new Date(iso.replace(" ","T")+"Z"); const days = Math.floor((Date.now()-d)/864e5);
  if (isNaN(days)) return "";
  if (days <= 0) return "today"; if (days === 1) return "yesterday";
  if (days < 30) return days+"d ago"; if (days < 365) return Math.floor(days/30)+"mo ago";
  return Math.floor(days/365)+"y ago";
}

function updateTrashLink(count) {
  if (!elTrashLink || !elTrashCount) return;
  elTrashCount.textContent = count;
  elTrashLink.hidden = count === 0;
}

function updateShotsLink(count) {
  if (!elShotsLink || !elShotsCount) return;
  elShotsCount.textContent = count;
  elShotsLink.hidden = count === 0;
}

elTrashLink?.addEventListener("click", (e) => {
  e.preventDefault();
  runTrash();
});

elShotsLink?.addEventListener("click", (e) => {
  e.preventDefault();
  runScreenshots();
});

async function loadSections() {
  view = "sections";
  elStatus.textContent = "loading…";
  try {
    const r = await fetch(`/api/sections?per=${FETCH}`);
    const { sections = [], trash_count = 0, screenshot_count = 0 } = await r.json();
    allTags = sections.map((s) => s.tag).sort((a, b) => a.localeCompare(b));
    populateStudyTags();
    renderRail(sections, trash_count, screenshot_count);
    renderAll(sections);
    elStatus.textContent = sections.length ? "" : "No tags yet — add one on the left.";
  } catch (e) {
    elStatus.textContent = "Couldn't reach the database.";
  }
}

function sectionsInRailOrder(sections) {
  const byTag = new Map(sections.map((s) => [s.tag, s]));
  const out = [];

  for (const group of RAIL_GROUPS) {
    for (const tag of group.tags) {
      const s = byTag.get(tag);
      if (!s || s.hidden) continue;
      out.push(s);
    }
  }

  const grouped = new Set(RAIL_GROUPS.flatMap((g) => g.tags));
  for (const s of sections) {
    if (s.hidden || grouped.has(s.tag) || grouped.has(canonical(s.tag))) continue;
    out.push(s);
  }

  return out;
}

function renderRail(sections, trashCount, screenshotCount) {
  elRail.innerHTML = "";
  const byTag = new Map(sections.map((s) => [s.tag, s]));

  updateTrashLink(trashCount);
  updateShotsLink(screenshotCount);

  for (const group of RAIL_GROUPS) {
    const liBanner = document.createElement("li");
    liBanner.className = "rail-banner";
    liBanner.textContent = group.banner;
    elRail.appendChild(liBanner);

    for (const tag of group.tags) {
      const s = byTag.get(tag);
      if (!s || s.hidden) continue;
      const li = document.createElement("li");
      const railLabel = RAIL_SHORT_LABELS[s.tag] ? prettyLabel(RAIL_SHORT_LABELS[s.tag]) : prettyLabel(sectionLabel(s));
      li.innerHTML = `<a href="#${slug(s.tag)}"><span>${railLabel}</span><span class="c">${s.count}</span></a>`;
      elRail.appendChild(li);
    }
  }

  const grouped = new Set(RAIL_GROUPS.flatMap((g) => g.tags));
  for (const s of sections) {
    if (s.hidden || grouped.has(s.tag) || grouped.has(canonical(s.tag))) continue;
    const li = document.createElement("li");
    const railLabel = RAIL_SHORT_LABELS[s.tag] ? prettyLabel(RAIL_SHORT_LABELS[s.tag]) : prettyLabel(sectionLabel(s));
    li.innerHTML = `<a href="#${slug(s.tag)}"><span>${railLabel}</span><span class="c">${s.count}</span></a>`;
    elRail.appendChild(li);
  }
}

function isStarred(p) { return !!(p.starred_at && String(p.starred_at).trim()); }
function isRead(p) { return !!(p.read_at && String(p.read_at).trim()); }
function isCompact(p) { return isStarred(p) || isRead(p); }

function compactSort(a, b) {
  const as = isStarred(a), bs = isStarred(b);
  if (as !== bs) return as ? -1 : 1;
  if (as) return String(b.starred_at).localeCompare(String(a.starred_at));
  return String(b.read_at || "").localeCompare(String(a.read_at || ""));
}

function splitPapers(papers) {
  const main = [], compact = [];
  for (const p of papers || []) {
    if (isCompact(p)) compact.push(p);
    else main.push(p);
  }
  compact.sort(compactSort);
  return { main, compact };
}

function renderAll(sections) {
  elSections.innerHTML = "";

  for (const s of sectionsInRailOrder(sections)) {
    if (s.hidden) continue;
    const sec = document.createElement("section");
    sec.className = "section";
    sec.id = slug(s.tag);

    const body = s.count === 0
      ? `<p class="sec-empty">No papers yet — waiting on the first alert.</p>`
      : `<div class="secbody">
           <div class="carousel carousel-main">
             <button class="navbtn prev" aria-label="previous papers"></button>
             <div class="grid grid-page"></div>
             <button class="navbtn next" aria-label="more papers"></button>
           </div>
           <div class="compact-wrap" hidden>
             <div class="grid compact-grid"></div>
           </div>
         </div>` +
        (s.count > FETCH ? `<a class="sec-more" href="#" data-all="${esc(s.tag)}">view all ${s.count} →</a>` : "");

    sec.innerHTML = `
      <div class="sechead">
        <h2>${prettyLabel(sectionLabel(s))}</h2>
        <span class="count">${s.count}</span>
      </div>${body}`;
    elSections.appendChild(sec);
    if (s.count > 0) initSection(sec, s);
  }
  wireSectionActions();
  elSections.querySelectorAll(".section").forEach(el => railObserver.observe(el));
}

function initSection(sec, s) {
  const { main, compact } = splitPapers(s.papers || []);
  initCarousel(sec.querySelector(".carousel-main"), { tag: s.tag, papers: main });
  renderCompactRow(sec.querySelector(".compact-wrap"), sec.querySelector(".compact-grid"), compact);
  sec._reshow = () => {
    const split = splitPapers(s.papers || []);
    initCarousel(sec.querySelector(".carousel-main"), { tag: s.tag, papers: split.main });
    renderCompactRow(sec.querySelector(".compact-wrap"), sec.querySelector(".compact-grid"), split.compact);
  };
}

function renderCompactRow(wrap, grid, papers) {
  if (!wrap || !grid) return;
  if (!papers.length) {
    wrap.hidden = true;
    grid.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  grid.innerHTML = papers.map((p) => cardHtml(p, true)).join("");
}

function initCarousel(carousel, s) {
  if (!carousel) return;
  const papers = s.papers || [];
  const grid = carousel.querySelector(".grid-page");
  const prev = carousel.querySelector(".navbtn.prev");
  const next = carousel.querySelector(".navbtn.next");
  if (!grid) return;

  function show(page) {
    const per = pageSize();
    const maxPage = Math.max(0, Math.ceil(papers.length / per) - 1);
    page = Math.min(Math.max(page, 0), maxPage);
    pageOf.set(s.tag, page);
    grid.innerHTML = papers.slice(page * per, page * per + per).map((p) => cardHtml(p, false)).join("");
    if (prev && next) {
      const hideArrows = papers.length <= per;
      prev.style.display = next.style.display = hideArrows ? "none" : "";
      prev.disabled = page <= 0;
      next.disabled = page >= maxPage;
    }
  }

  if (prev) prev.onclick = () => show((pageOf.get(s.tag) || 0) - 1);
  if (next) next.onclick = () => show((pageOf.get(s.tag) || 0) + 1);
  show(pageOf.get(s.tag) || 0);

  carousel._reshow = () => show(pageOf.get(s.tag) || 0);
}

let _rz;
window.addEventListener("resize", () => {
  clearTimeout(_rz);
  _rz = setTimeout(() => {
    elSections.querySelectorAll(".section").forEach((sec) => sec._reshow && sec._reshow());
  }, 150);
});

function parseScreenshots(raw) {
  if (!raw || !String(raw).trim()) return [];
  const s = String(raw).trim();
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        return arr.map(String).map((p) => p.trim()).filter(Boolean);
      }
    } catch { /* pipe-delimited fallback */ }
  }
  return s.split("|").map((p) => p.trim()).filter(Boolean);
}

let _toastTimer;
function showToast(msg, ok = true) {
  if (!elToast) return;
  clearTimeout(_toastTimer);
  elToast.textContent = msg;
  elToast.classList.toggle("toast-err", !ok);
  elToast.hidden = false;
  _toastTimer = setTimeout(() => { elToast.hidden = true; }, ok ? 2800 : 4200);
}

function imgSrc(path) {
  if (!path) return "";
  const base = path.split("?")[0];
  const file = base.split("/").pop() || "img";
  return `${base}?v=${encodeURIComponent(file)}`;
}

function shotHtml(p) {
  const shots = parseScreenshots(p.screenshot);
  if (!shots.length) return "";
  const btns = shots.map((src, i) =>
    `<button type="button" class="cardshot" data-lightbox="${esc(src)}" title="view screenshot ${i + 1}" aria-label="view screenshot ${i + 1}">
      <img src="${esc(imgSrc(src))}" alt="" loading="lazy" decoding="async" />
    </button>`
  ).join("");
  return `<div class="cardshots">${btns}</div>`;
}

function cardHtml(p, compact) {
  const canonTags = [...new Set((p.tags || []).map(t => canonical(t)))];
  const chips = canonTags.map(c =>
    `<button class="tagchip" data-tag="${esc(c)}">${prettyLabel(c)}</button>`
  ).join("");

  const has = new Set(canonTags);
  const addable = allTags.filter(t => !has.has(t));
  const plus = (!compact && p.id && addable.length)
    ? `<span class="addtag-wrap">
         <button class="tagchip tagadd" data-addtag="${p.id}" title="add to a section">+</button>
         <span class="tagmenu" hidden>${addable.map(t =>
           `<button class="tagmenu-item" data-id="${p.id}" data-tag="${esc(t)}">${esc(t)}</button>`
         ).join("")}</span>
       </span>`
    : "";
  const tags = (!compact && (chips || plus)) ? `<span class="cardtags">${chips}${plus}</span>` : "";
  const cls = compact ? "cardx cardx-compact" : "cardx";
  const shot = shotHtml(p);
  return `<article class="${cls}">
    <a class="ttl" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.title)}</a>
    ${compact ? "" : (p.authors ? `<p class="auth">${esc(p.authors)}</p>` : "")}
    ${compact ? "" : (p.snippet ? `<p class="snip">${esc(p.snippet)}</p>` : "")}
    ${shot}
    <span class="cardfoot">
      ${compact ? "" : `<span class="when">${ago(p.first_seen)}</span>`}
      ${cardActs(p)}
    </span>
    ${tags}
  </article>`;
}

function sciHubUrl(title) {
  if (!title) return "";
  const encoded = encodeURIComponent(title.trim()).replace(/%20/g, "+");
  return `${SCIHUB_MIRROR}match/${encoded}`;
}

function cardActs(p) {
  const sciBtn = p.title
    ? `<a class="scihubbtn" href="${esc(sciHubUrl(p.title))}" target="_blank" rel="noopener noreferrer" title="Sci-Hub" aria-label="Sci-Hub">SH</a>`
    : "";
  if (!p.id) return sciBtn ? `<span class="cardacts">${sciBtn}</span>` : "";
  if (p.status === "trash") {
    return `<span class="cardacts">${sciBtn}
      <button data-pstatus="inbox" data-id="${p.id}" title="restore" aria-label="restore">↩</button>
      <button class="starbtn" data-star="${p.id}" data-on="1" title="star" aria-label="star">☆</button>
    </span>`;
  }
  const linkBtn = `<button class="urlbtn" data-editurl="${p.id}" data-link="${esc(p.link)}" title="replace link" aria-label="replace link">↗</button>`;
  const uploadBtn = `<button class="uploadbtn" data-upload="${p.id}" title="upload screenshot(s)" aria-label="upload screenshot(s)">+</button>`;
  const trashBtn = `<button data-pstatus="trash" data-id="${p.id}" title="trash" aria-label="trash">✕</button>`;
  const starBtn = isStarred(p)
    ? `<button class="starbtn on" data-star="${p.id}" data-on="0" title="unstar" aria-label="unstar">★</button>`
    : `<button class="starbtn" data-star="${p.id}" data-on="1" title="star" aria-label="star">☆</button>`;
  const readBtn = isRead(p)
    ? `<button class="readbtn on" data-read="${p.id}" data-on="0" title="mark unread" aria-label="mark unread">R</button>`
    : `<button class="readbtn" data-read="${p.id}" data-on="1" title="read" aria-label="read">R</button>`;
  return `<span class="cardacts">${sciBtn}${linkBtn}${uploadBtn}${trashBtn}${starBtn}${readBtn}</span>`;
}

elSections.addEventListener("click", async (e) => {
  const delBtn = e.target.closest("[data-delshot]");
  if (delBtn && view === "screenshots") {
    const paperId = +delBtn.getAttribute("data-delshot");
    const path = delBtn.getAttribute("data-shot-path");
    if (!path || !paperId) return;
    delBtn.disabled = true;
    const r = await postWrite("/api/papers", { action: "delete_screenshot", id: paperId, path });
    if (r && r.ok) {
      showToast("Screenshot deleted.");
      runScreenshots();
    } else {
      const err = await r.json().catch(() => ({}));
      showToast(err.error || "Couldn't delete screenshot.", false);
      delBtn.disabled = false;
    }
    return;
  }

  const shot = e.target.closest("[data-lightbox]");
  if (shot) {
    openLightbox(shot.getAttribute("data-lightbox"));
    return;
  }

  const uploadBtn = e.target.closest("[data-upload]");
  if (uploadBtn) {
    pickScreenshot(+uploadBtn.getAttribute("data-upload"));
    return;
  }

  const starBtn = e.target.closest("[data-star]");
  if (starBtn) {
    starBtn.disabled = true;
    const on = starBtn.getAttribute("data-on") === "1";
    await postWrite("/api/papers", { action: "star", id: +starBtn.getAttribute("data-star"), on });
    refresh();
    return;
  }

  const readBtn = e.target.closest("[data-read]");
  if (readBtn) {
    readBtn.disabled = true;
    const on = readBtn.getAttribute("data-on") === "1";
    await postWrite("/api/papers", { action: "read", id: +readBtn.getAttribute("data-read"), on });
    refresh();
    return;
  }

  const urlBtn = e.target.closest("[data-editurl]");
  if (urlBtn) {
    const cur  = urlBtn.getAttribute("data-link") || "";
    const next = window.prompt("Replace link with:", cur);
    if (next === null) return;
    const link = next.trim();
    if (!link || link === cur) return;
    const r = await postWrite("/api/papers", { action: "link", id: +urlBtn.getAttribute("data-editurl"), link });
    if (r && r.status === 409) { alert("Another paper already has that link."); return; }
    if (r && !r.ok) { alert("Couldn't update the link."); return; }
    refresh();
    return;
  }

  const plus = e.target.closest("[data-addtag]");
  if (plus) {
    const menu = plus.parentElement.querySelector(".tagmenu");
    const wasHidden = menu.hidden;
    closeAllTagMenus();
    menu.hidden = !wasHidden;
    return;
  }

  const item = e.target.closest(".tagmenu-item");
  if (item) {
    const r = await postWrite("/api/papers", {
      action: "tag",
      id: +item.getAttribute("data-id"),
      tag: item.getAttribute("data-tag"),
    });
    closeAllTagMenus();
    if (r && r.ok) refresh();
    return;
  }

  const chip = e.target.closest(".tagchip:not(.tagadd)");
  if (chip) { elQ.value = ""; runSearch("", chip.getAttribute("data-tag")); return; }

  const act = e.target.closest("[data-pstatus]");
  if (!act) return;
  act.disabled = true;
  try {
    await postWrite("/api/papers", {
      id: +act.getAttribute("data-id"),
      status: act.getAttribute("data-pstatus"),
    });
  } catch (err) { /* refresh shows the truth either way */ }
  refresh();
});

function openLightbox(src) {
  if (!elLightbox || !elLightboxImg || !src) return;
  elLightboxImg.src = imgSrc(src);
  elLightbox.hidden = false;
  document.body.classList.add("lightbox-open");
}

function closeLightbox() {
  if (!elLightbox || !elLightboxImg) return;
  elLightbox.hidden = true;
  elLightboxImg.removeAttribute("src");
  document.body.classList.remove("lightbox-open");
}

elLightbox?.addEventListener("click", (e) => {
  if (e.target === elLightbox || e.target.closest(".lightbox-close")) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

async function pickScreenshot(paperId) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/jpeg,image/png,image/webp,image/gif";
  inp.multiple = true;
  inp.onchange = async () => {
    const files = inp.files ? [...inp.files] : [];
    if (!files.length) return;
    if (authPw === null) authPw = window.prompt("Password:") || "";
    let ok = 0;
    let lastErr = "";
    for (const file of files) {
      const fd = new FormData();
      fd.append("auth", authPw);
      fd.append("id", String(paperId));
      fd.append("file", file);
      let r = await fetch("/api/upload", { method: "POST", body: fd });
      if (r.status === 401) {
        authPw = window.prompt("Wrong password — try again:") || "";
        fd.set("auth", authPw);
        r = await fetch("/api/upload", { method: "POST", body: fd });
      }
      if (r.ok) {
        ok++;
      } else {
        const err = await r.json().catch(() => ({}));
        lastErr = err.error || "Upload failed.";
      }
    }
    if (ok && ok < files.length) {
      showToast(`${ok} of ${files.length} uploaded. ${lastErr}`, false);
      refresh();
    } else if (ok) {
      showToast(ok === 1 ? "Screenshot uploaded." : `${ok} screenshots uploaded.`);
      refresh();
    } else {
      showToast(lastErr || "Upload failed.", false);
    }
  };
  inp.click();
}

function closeAllTagMenus() {
  elSections.querySelectorAll(".tagmenu").forEach((m) => { m.hidden = true; });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".addtag-wrap")) closeAllTagMenus();
});

function refresh() {
  const q = elQ.value.trim();
  if (view === "trash") runTrash();
  else if (view === "screenshots") runScreenshots();
  else if (q) runSearch(q);
  else loadSections();
}

function wireSectionActions() {
  elSections.querySelectorAll("[data-all]").forEach(a => {
    a.onclick = (e) => { e.preventDefault(); elQ.value = ""; runSearch("", a.getAttribute("data-all")); };
  });
}

let debounce;
elQ.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const q = elQ.value.trim();
    if (q) runSearch(q); else loadSections();
  }, 220);
});

async function runSearch(q, tag) {
  view = "search";
  elStatus.textContent = "searching…";
  const params = new URLSearchParams({ limit: 100 });
  if (q)   params.set("q",   q);
  if (tag) params.set("tag", tag);
  try {
    const r = await fetch("/api/papers?" + params);
    const { papers = [] } = await r.json();
    elSections.innerHTML = `
      <section class="section">
        <div class="sechead"><h2>${tag ? prettyLabel(tag) : "Search"}</h2><span class="count">${papers.length}</span></div>
        <div class="grid">${papers.map((p) => cardHtml(p, false)).join("")}</div>
      </section>`;
    elStatus.textContent = papers.length ? "" : "Nothing matched.";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    elStatus.textContent = "Search failed.";
  }
}

async function runTrash() {
  view = "trash";
  elStatus.textContent = "loading trash…";
  try {
    const r = await fetch("/api/papers?status=trash&limit=200");
    const { papers = [] } = await r.json();
    elSections.innerHTML = `
      <section class="section">
        <div class="sechead"><h2>Trash</h2><span class="count">${papers.length}</span></div>
        <div class="grid">${papers.map((p) => cardHtml(p, false)).join("")}</div>
      </section>`;
    elStatus.textContent = papers.length ? "" : "Trash is empty.";
    updateTrashLink(papers.length);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    elStatus.textContent = "Couldn't load trash.";
  }
}

function screenshotItemHtml(paperId, title, src) {
  return `<article class="shotitem" data-shot-paper="${paperId}" data-shot-path="${esc(src)}">
    <button type="button" class="shotthumb" data-lightbox="${esc(src)}" aria-label="preview screenshot">
      <img src="${esc(imgSrc(src))}" alt="" loading="lazy" decoding="async" />
    </button>
    <p class="shottitle">${esc(title)}</p>
    <button type="button" class="shotdel" data-delshot="${paperId}" data-shot-path="${esc(src)}" title="delete screenshot" aria-label="delete screenshot">🗑</button>
  </article>`;
}

async function runScreenshots() {
  view = "screenshots";
  elStatus.textContent = "loading screenshots…";
  try {
    const r = await fetch("/api/papers?has_screenshot=1&limit=500");
    const { papers = [] } = await r.json();
    const items = [];
    for (const p of papers) {
      for (const src of parseScreenshots(p.screenshot)) {
        items.push(screenshotItemHtml(p.id, p.title, src));
      }
    }
    elSections.innerHTML = `
      <section class="section">
        <div class="sechead"><h2>Screenshots</h2><span class="count">${items.length}</span></div>
        <p class="shotshint">Review uploaded images. Click 🗑 to remove one from the site and database.</p>
        <div class="shotsgrid">${items.join("")}</div>
      </section>`;
    elStatus.textContent = items.length ? "" : "No screenshots uploaded yet.";
    updateShotsLink(items.length);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    elStatus.textContent = "Couldn't load screenshots.";
  }
}

async function addConstruct() {
  const tag = elNew.value.trim();
  if (!tag) return;
  const r = await postWrite("/api/sections", { tag, pinned:0, hidden:0 });
  if (!r.ok) return;
  elNew.value = "";
  await loadSections();
  location.hash = "#" + slug(tag);
}
elAdd.onclick = addConstruct;
elNew.addEventListener("keydown", e => { if (e.key === "Enter") addConstruct(); });

function populateStudyTags() {
  if (!elStudyTag) return;
  const cur = elStudyTag.value;
  elStudyTag.innerHTML = `<option value="">choose a section…</option>` +
    allTags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  if (cur && allTags.includes(cur)) elStudyTag.value = cur;
}

function hideStudyForm() {
  if (!elStudyForm) return;
  elStudyForm.hidden = true;
  studyLink = "";
  if (elStudyUrl) elStudyUrl.value = "";
}

function openStudyForm(url, data = {}) {
  studyLink = data.link || url;
  elStudyTitle.value = data.title || "";
  elStudyAuthor.value = data.authors || "";
  elStudySnip.value = data.snippet || "";
  populateStudyTags();
  elStudyForm.hidden = false;
  elStudyTitle.focus();
}

async function scanStudy() {
  const url = (elStudyUrl?.value || "").trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    showToast("Enter a link starting with http:// or https://", false);
    return;
  }
  elStudyScan.disabled = true;
  elStudyScan.textContent = "…";
  try {
    const r = await fetch(`/api/scan?url=${encodeURIComponent(url)}`);
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      openStudyForm(url, data);
      if (!data.found) {
        showToast("Nothing found — enter the details manually.", false);
      }
      return;
    }
    openStudyForm(url, {});
    showToast(data.error || "Scan failed — enter the details manually.", false);
  } catch {
    openStudyForm(url, {});
    showToast("Couldn't scan — enter the details manually.", false);
  } finally {
    elStudyScan.disabled = false;
    elStudyScan.textContent = "scan";
  }
}

async function submitStudy(e) {
  e.preventDefault();
  const title = elStudyTitle.value.trim();
  const authors = elStudyAuthor.value.trim();
  const snippet = elStudySnip.value.trim();
  const tag = elStudyTag.value.trim();
  const link = studyLink || (elStudyUrl?.value || "").trim();
  if (!title || !link || !tag) {
    showToast("Title, link, and section are required.", false);
    return;
  }
  elStudySubmit.disabled = true;
  const r = await postWrite("/api/papers", {
    action: "create",
    title,
    authors,
    snippet,
    link,
    tag,
  });
  elStudySubmit.disabled = false;
  if (r.status === 409) {
    showToast("Another paper already has that link.", false);
    return;
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    showToast(err.error || "Couldn't add the study.", false);
    return;
  }
  hideStudyForm();
  showToast("Study added.");
  await loadSections();
  location.hash = "#" + slug(tag);
}

elStudyScan?.addEventListener("click", scanStudy);
elStudyUrl?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); scanStudy(); }
});
elStudyForm?.addEventListener("submit", submitStudy);
elStudyCancel?.addEventListener("click", hideStudyForm);

const railObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) {
      elRail.querySelectorAll("a").forEach(a => a.classList.remove("active"));
      const link = elRail.querySelector(`a[href="#${en.target.id}"]`);
      if (link) link.classList.add("active");
    }
  }
}, { rootMargin: "-10% 0px -80% 0px" });

loadSections();

