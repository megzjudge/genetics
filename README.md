# Personal Genomics

This is a personal website that turns one person's whole-genome sequencing
results into something readable: a set of pages, organised by gene and by
topic (like "Folate Metabolism" or "ADHD"), that explain what the science
currently says about specific spots in one's DNA — backed by research papers.

This README explains what the project is, how it's put together, and what
every folder and file does — written for someone who has never built a
website before. Wherever a web-design or web-development term shows up for
the first time, it's explained in plain English. There's also a
[glossary](#glossary-of-terms) at the very bottom you can jump to any time.

---

## Table of contents

1. [What this project actually is](#what-this-project-actually-is)
2. [How a website like this is put together, in plain English](#how-a-website-like-this-is-put-together-in-plain-english)
3. [A tour of every file and folder](#a-tour-of-every-file-and-folder)
4. [How the pages get their content](#how-the-pages-get-their-content)
5. [The email pipeline: how new research finds its way in automatically](#the-email-pipeline-how-new-research-finds-its-way-in-automatically)
6. [The admin panel and the personal-data lock](#the-admin-panel-and-the-personal-data-lock)
7. [Keeping the data safe: automatic backups](#keeping-the-data-safe-automatic-backups)
8. [Running your own copy of this site](#running-your-own-copy-of-this-site)
9. [Glossary of terms](#glossary-of-terms)
10. [License](#license)

---

## What this project actually is

At its heart, this is a **website with a database behind it**, the specific things this website does is:

- Pulls in live population-frequency data and variant details from NCBI
  (the US National Center for Biotechnology Information) so each SNP page
  shows real statistics, not just hand-typed notes.

- Automatically intakes in new Google Scholar research alerts by e-mail.

This is called email-routing which means say you send an email to my email address at xxxxxxx@jdge.cc, I then select that one specific email address to direct its results to the database, the program intaking the emails (a worker) is told to only accept emails from google scholar's main email address and blocks anything else, and sends the information in the email to the database), and then it files new papers under correct section in a database — so the site's
  research library grows on its own over time with every new paper published and pulled by google into its search engine rather than manual researches (details
  [below](#the-email-pipeline-how-new-research-finds-its-way-in-automatically)). Any prior papers were scrapped manually by page-inspect and entered one page at a time (10 studies at once in raw HTML rather than normal human 1 study at a time) into the backend via page-inspect of each scholar page due to google blocking automatically scraping. This was the best procedure, tried a bunch of things, like researchrabbit, etc, google scholar has the biggest database available alongside researchrabbit, whereas things like semanticscholar which do allow scraping have much much smaller databases - so manual scholar scraping was required. New studies are all intaken automatically, was just for the past - some SNPs have 1 page in google (most have between 1-5) but some have 100 pages, so it just depends for each SNP the length of time to scrape.
  
- Presents genes, organised into topic groups (folate metabolism, ADHD,
  neurotransmitters, and more), each with the SNPs (specific DNA
  positions — see the [glossary](#glossary-of-terms)) that have been
  researched, their allele possibilities, the studies that discuss them,
  and (behind a password) what Megan's genome shows at that position 
  (accessed via the login button at the bottom of the screen).
  
- Cross-links genes to diseases/conditions they're associated with.

- Has a private "admin" area (password-protected) where notes, new genes/snps/alleles 
  and research papers can be manually added.

- Backs its database up automatically every week.

---

## How a website like this is put together, in plain English

If you've never worked on a website, here's the mental model this whole
project follows.

### Front end vs. back end

Every website has (up to) two halves:

- **Front end** — everything that happens *inside your browser*: the HTML,
  CSS, and JavaScript that get downloaded and turned into the page you see
  and click around on. In this project, `index.html`, `styles.css`, and
  `script.js` are the front end for the homepage.
- **Back end** — code that runs on a *server* somewhere else on the
  internet, not on your computer. It does things a browser alone can't do
  safely, like talking to a database, checking a password, or reading an
  incoming email. In this project, the back end is the code inside the
  `functions/` folder plus `worker.js` which works through a free
  Cloudflare Worker to host the backend online and connect the
  Database (like a multi-table spreadsheet) to the static website front-end.

When you type `genetics.jdge.cc/gene/MTHFR` into a browser, here's what
actually happens, step by step:

1. Your browser sends a request to Cloudflare (the hosting company) asking for that page.
2. Cloudflare runs the back-end code in `functions/gene/[name].js`.
3. That code asks the database "give me everything you know about MTHFR."
4. The database answers with rows of data (gene info, related studies, SNPs).
5. The code stitches that data into an HTML page — literally builds a
   string of HTML text with the right values plugged in — and sends it back.
   Even the main svg gene images on that page is entirely crafted via HTML,
   it is not a downloadable image, it is made via code custom based on what
   chromosome position, allele combination and snp location is recorded in the database.
7. Your browser receives that finished HTML, along with `styles.css` (for
   the page's look style) and `script.js` (for the interactive bits, such as click interactions), and renders the
   page you see.

This whole round-trip usually takes well under a second - and with cloudflare it takes under a second in most countries around the world due to their CDN (content delivery network) in difference to a traditional non-CDN host.

### Where it's hosted: Cloudflare Pages & Workers

This site doesn't run on Megan's own computer — it's hosted on
**Cloudflare**, a company that runs servers all over the world and rents out
space on them. Two of Cloudflare's products are used here:

- **Cloudflare Pages** — hosts the static files (`index.html`, `styles.css`,
  `script.js`, images, fonts) and also runs the "Functions" (see next
  section) whenever someone requests a dynamic page.
- **Cloudflare Workers** — a way to run small pieces of JavaScript code "at
  the edge" (i.e., on servers close to wherever the request came from,
  rather than one single far-away server). The `worker.js` file in this
  project is a Worker that processes incoming emails (explained
  [below](#the-email-pipeline-how-new-research-finds-its-way-in-automatically)).

The file `wrangler.toml` is the configuration file for **Wrangler**,
Cloudflare's command-line tool for deploying and managing these pieces. It
tells Cloudflare things like "this project is called `email-genetics`,"
"connect it to a database called `genetic`," and "run the weekly research
check every Monday at 5am UTC."

### The database: Cloudflare D1

The database itself is a **Cloudflare D1** database — a hosted version of
**SQLite**, a lightweight, widely-used database format. Think of it as
several linked spreadsheets:

- a table of **genes**
- a table of **SNPs** (specific DNA variants within those genes)
- a table of **studies** (research papers)
- a table of **topics** (groupings like "Folate Metabolism")
- a table of **diseases**
- a table of Megan's **personal** genome results, kept separate and gated
  behind a password
- a table of **email_alerts**, logging incoming Scholar-alert emails

Rows in these tables are linked to each other (e.g., a study "belongs to" a
gene, a SNP "belongs to" a gene, a gene "belongs to" one or more topics).
This linking is what lets the site say, on the MTHFR page, "here are 12
studies and 6 SNPs related to this gene" without anyone manually typing that
list — it's just a database query.

### "Functions": back-end code that runs per-request

The `functions/` folder uses a Cloudflare Pages convention where the file
path **is** the URL path. That's worth spelling out because it looks like
magic at first:

| File | Responds to |
|---|---|
| `functions/gene/[name].js` | `/gene/MTHFR`, `/gene/COMT`, etc. |
| `functions/snp/[rsid].js` | `/snp/rs1801133`, etc. |
| `functions/disease/[slug].js` | `/disease/gilbert-syndrome`, etc. |
| `functions/group/[slug].js` | `/group/folate-metabolism`, etc. |
| `functions/groups.js` | `/groups` (the index of all topic groups) |
| `functions/api/[[route]].js` | anything under `/api/...` |
| `functions/sitemap.xml.js` | `/sitemap.xml` (a map of the site for search engines) |
| `functions/font-preview.js` | a page for previewing the custom fonts in `fonts/` |

A name in square brackets, like `[name]` or `[slug]`, is a **placeholder** —
it means "match anything here and hand it to the code as a variable." So
`[name].js` handles *every* gene, not one file per gene. `[[route]]` (double
brackets) means "match anything, including multiple path segments," which
is why one file can serve every single `/api/...` URL.

---

## A tour of every file and folder

```
genetics/
├── index.html          Homepage
├── styles.css           All the visual styling for the whole site
├── script.js             Homepage interactivity (search, tagging, adding studies)
├── personal-auth.js      Shared login/lock logic for personal genome data
├── worker.js              Cloudflare Worker that reads incoming Scholar-alert emails
├── wrangler.toml          Cloudflare configuration (project name, database, cron schedule)
├── robots.txt              Instructions for search-engine crawlers
├── LICENSE                  MIT license (see below)
├── results.txt              Raw exported notes/results (working file)
├── woof.txt                   A working list of easy-to-verify genetic findings, with the
│                               lab test that could confirm each one
│
├── admin/
│   ├── index.html          The private admin dashboard (password-protected)
│   └── admin.js               All the logic for the admin dashboard: adding studies,
│                                   editing genes/SNPs, managing personal results, etc.
│
├── basics/
│   ├── index.html           "Genetics 101" — explains genes, SNPs, alleles, haplogroups
│   └── index2.html          A second/alternate basics page
│
├── databases/
│   └── index.html           A directory of external genetics databases (ClinVar, gnomAD,
│                                 SNPedia, OMIM, etc.) with logos and links
│
├── functions/                  Back-end code (see above) — one file/folder per URL pattern
│   ├── api/[[route]].js         Handles all /api/... requests: looks up live variant data
│   │                                 from NCBI, formats population frequencies, etc.
│   ├── gene/[name].js             Builds a gene's page on demand
│   ├── snp/[rsid].js              Builds a SNP's page on demand
│   ├── disease/[slug].js          Builds a disease/condition's page on demand
│   ├── group/[slug].js            Builds a topic group's page on demand
│   ├── groups.js                    Builds the "all groups" index page
│   ├── sitemap.xml.js               Generates the sitemap for search engines
│   ├── font-preview.js              A page to preview the custom fonts
│   └── lib/
│       ├── layout.js                Shared page furniture: the nav bar and footer HTML,
│       │                                reused by every page so they all look consistent
│       └── viz.js                       Builds the little chromosome/gene diagrams shown
│                                            on gene and SNP pages
│
├── fonts/                       Custom typefaces used around the site (decorative
│                                    script fonts, a "5th grade cursive" font, etc.)
│
├── images/                    Photos, illustrations, and small logos (external database
│                                  logos like ClinVar/gnomAD/OMIM, plus topic thumbnails)
│
└── rabbit/                    CSV (spreadsheet) exports, one per SNP (named by its rsID,
                                    e.g. rs10498514.csv), sourced from ResearchRabbit —
                                    likely raw citation-network data feeding the research
                                    library
```

A couple of naming conventions worth knowing:

- **`index.html`** is the default file a web server looks for when you visit
  a folder without naming a specific file — that's why visiting `/basics`
  shows you `basics/index.html` automatically.
- **rsID** (e.g. `rs1801133`) is the standard ID format for a specific,
  named position in the human genome, assigned by NCBI's dbSNP database.
  You'll see it used as a filename, a URL segment, and a database key
  throughout this project — it's the "primary key" that ties a SNP's page,
  its data file, and its database row all together.

---

## How the pages get their content

Two different back ends feed this site, and it's useful to know which is
which:

1. **The site's own database (D1)** — genes, topics, diseases, studies, and
   Megan's personal results all live here. This is data the site *owns* and
   fully controls (added via the admin panel or the email pipeline).
2. **Live lookups to NCBI** — `functions/api/[[route]].js` reaches out, in
   real time, to NCBI's public genetics databases to fetch things like
   population allele frequencies, chromosome position, and amino-acid
   changes for a given SNP. This means SNP pages always show current NCBI
   data without Megan having to manually copy it in.

`functions/lib/viz.js` turns raw position data (a "maploc," meaning "map
location" — where on a chromosome a variant sits) into the small visual
diagrams shown on gene and SNP pages.

---

## The email pipeline: how new research finds its way in automatically

This is one of the more unusual parts of the project, so it's worth
explaining on its own.

Megan has **Google Scholar alerts** set up for each gene she's researching
(Scholar is Google's search engine for academic papers; an "alert" is an
email Google sends you whenever it indexes a new paper matching your search
terms). Rather than reading each alert email and manually copying
interesting papers into the site, `worker.js` — a Cloudflare Worker — is
wired up to **Cloudflare Email Routing**, a feature that lets incoming email
to a domain be handed to code instead of (or in addition to) a normal
inbox.

Here's the flow:

1. Google sends a Scholar alert email (or Megan forwards an old one in).
2. Cloudflare Email Routing hands that email to `worker.js`.
3. The Worker reads through the email's content — including handling the
   different ways email clients (Gmail, Outlook, Apple Mail, Proton Mail)
   format forwarded messages, and decoding the underlying character
   encodings emails are sent in — and extracts each paper mentioned:
   its title, link, and which gene/SNP triggered the alert.
4. It matches the paper against a known list of gene names and common
   alternate names (e.g. "methionine synthase" gets recognised as `MTR`),
   using the `KNOWN_TERMS` and `TERM_ALIASES` lists near the top of the
   file.
5. It checks the database to make sure this exact paper (by its link)
   hasn't already been logged, so the same paper can't get added twice even
   if the same alert email arrives more than once.
6. New papers are written into the `genetic` D1 database.

Separately, `wrangler.toml` schedules a **cron trigger** — a "run this on a
schedule" job, the same concept `cron` jobs use on Unix/Linux servers —
every Monday at 5am UTC, to re-check PubMed and Semantic Scholar (two other
academic search services) for anything new, independent of the email
alerts.

---

## The admin panel and the personal-data lock

The `/admin` page (`admin/index.html` + `admin/admin.js`) is where Megan
manages everything: adding/editing genes, SNPs, studies, and her own
personal genome results. It's protected by a password, checked against a
secret value the server holds (never shown in the site's public code).

`personal-auth.js` is a small, shared script used on gene and SNP pages
(not just admin) to gate one specific thing: **Megan's personal genotype at
that position** (i.e., which version of a gene/SNP she actually has) and
any personal notes she's attached to it. Here's how it behaves:

- A visitor without a password sees the general research and public data on
  a gene/SNP page freely.
- If they click "Login" and enter the correct password, the site remembers
  it in the browser's **localStorage** (a small storage area a website is
  allowed to keep on your own device, so you don't have to log in again on
  your next visit) and then reveals the personal genotype/notes section.
- Wrong passwords, and even too many rapid attempts (rate-limiting, to deter
  guessing), are handled with clear on-screen messages rather than generic
  errors.

This means the *research content* (genes, SNPs, studies, population data)
is public and freely browsable — it's only Megan's own individual results
that sit behind the password.

---

## Keeping the data safe: automatic backups

Two files in `.github/workflows/` set up **GitHub Actions** — a way to run
automated jobs (like backups, tests, or deployments) whenever something
happens in a GitHub repository, or on a schedule, without anyone needing to
run a command by hand.

- **`backup.yml`** runs every Monday at 4am UTC (an hour before the weekly
  research re-check, deliberately, so the two jobs don't run at the same
  time and interfere with each other). It exports the entire D1 database to
  a `.sql` file and stores it as a downloadable "artifact" attached to that
  run, kept for 90 days.
- **`restore.yml`** is a manual, on-demand job: given the ID of a past
  backup run, it downloads that backup and loads it back into the live
  database — optionally wiping all existing tables first for a completely
  clean restore. This exists purely as an "undo button" in case something
  ever goes wrong with the live data.

---

## Running your own copy of this site

This project isn't currently packaged as a one-click template, but the
pieces needed to run it are:

1. A [Cloudflare](https://cloudflare.com) account, with **Pages** and a
   **D1** database created (matching the structure implied by the tables
   referenced throughout `functions/` and `worker.js`: `genes`, `snps`,
   `gene_topics`, `topics`, `diseases`, `snp_diseases`, `studies`,
   `personal`, `email_alerts`).
2. [Node.js](https://nodejs.org) installed, so you can run Cloudflare's
   `wrangler` command-line tool (`npm install -g wrangler`).
3. Your own `database_id` filled in to `wrangler.toml` in place of
   `REPLACE_WITH_YOUR_D1_ID`, and your own admin password and any other
   secrets set via `wrangler secret put` rather than written into any file.
4. (Optional) Cloudflare Email Routing set up if you want the automatic
   Scholar-alert email pipeline (`worker.js`) to work.
5. `wrangler pages deploy` to publish the site.

Because this is a personal project built around one specific person's
genome and research interests, running your own copy would mean starting
with an empty database and populating it yourself via the admin panel.

---

## Glossary of terms

A quick reference for web-related words used throughout this README and the
codebase.

| Term | Meaning |
|---|---|
| **HTML** | The language used to write a web page's structure and content — headings, paragraphs, links, images. |
| **CSS** | The language used to style HTML — colours, fonts, spacing, layout. |
| **JavaScript** | A programming language that runs in the browser (and, here, also on the server) to make pages interactive or to process data. |
| **Front end** | The part of a website that runs in your browser — what you see and click. |
| **Back end** | The part of a website that runs on a server, handling things like databases, passwords, and business logic. |
| **Server** | A computer, usually far away and always on, that responds to requests from browsers over the internet. |
| **Database** | A structured, searchable store of information — like a set of linked spreadsheets a program can query. |
| **SQL / SQLite** | SQL is the standard language for asking a database questions ("give me all studies about MTHFR"). SQLite is a specific, lightweight database format; Cloudflare D1 is a hosted version of it. |
| **API** | "Application Programming Interface" — a defined way for one piece of software to ask another for data. `functions/api/[[route]].js` is this site's API: other code (like the front-end JavaScript) calls it to fetch data. |
| **Static vs. dynamic page** | A static page is a fixed file that looks the same for everyone until someone edits it. A dynamic page is generated fresh on each visit, often filled in from a database. |
| **Hosting** | Renting space on someone else's servers (here, Cloudflare) so your website is reachable on the internet 24/7. |
| **Cloudflare Pages** | Cloudflare's product for hosting websites, including running small pieces of server-side code ("Functions") alongside the static files. |
| **Cloudflare Workers** | Cloudflare's product for running small, fast pieces of server-side JavaScript — used here to process incoming email. |
| **Cloudflare D1** | Cloudflare's hosted SQLite database service — where all this site's structured data lives. |
| **Cron / cron trigger** | A schedule for running a task automatically at set times (e.g., "every Monday at 5am"), without a person needing to start it. |
| **GitHub Actions / workflow** | A system for running automated jobs (tests, backups, deployments) triggered by events or schedules in a GitHub repository. |
| **Route / URL path** | The part of a web address after the domain, e.g. `/gene/MTHFR` — used to decide which page or code should handle a request. |
| **Placeholder segment (`[name]`, `[[route]]`)** | A part of a file name that matches *any* value in that spot of a URL, letting one file serve many different pages. |
| **localStorage** | A small amount of storage a website is permitted to keep in your own browser, so it can remember things (like a login) between visits. |
| **rsID** | The standard identifier for a specific, named position in the human genome (e.g. `rs1801133`), assigned by NCBI's dbSNP database. |
| **SNP** | "Single Nucleotide Polymorphism" — a single-letter difference in DNA at a specific position that varies between people. |
| **Gene** | A specific stretch of DNA that codes for something functional, usually a protein; genes are made up of many possible SNPs/positions. |
| **Allele** | One of the possible variants ("versions") found at a given genetic position. |

---

## License

Released under the [MIT License](LICENSE) — free to use, copy, and modify,
provided the original copyright notice is kept.
