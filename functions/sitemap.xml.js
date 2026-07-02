const BASE = "https://genetics.jdge.cc";

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function url(loc, priority, changefreq) {
  const today = new Date().toISOString().split("T")[0];
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export async function onRequestGet({ env }) {
  const [genesRes, groupsRes] = await Promise.all([
    env.genetic.prepare(`SELECT gene_name FROM genes ORDER BY gene_name ASC`).all(),
    env.genetic.prepare(`SELECT name FROM topics ORDER BY name ASC`).all(),
  ]);

  const genes  = genesRes.results  || [];
  const groups = groupsRes.results || [];

  const urls = [
    url(`${BASE}/`,       "1.0", "weekly"),
    url(`${BASE}/basics`, "0.7", "monthly"),
    ...groups.map(g => url(`${BASE}/group/${slugify(g.name)}`, "0.8", "weekly")),
    ...genes.map(g  => url(`${BASE}/gene/${g.gene_name}`,      "0.9", "weekly")),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
