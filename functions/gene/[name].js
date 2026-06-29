// Pages Function: /gene/[name]
// Handles: genetics.jdge.cc/gene/MTHFR, /gene/ADA, etc.
// Queries D1 genetic database and returns server-rendered HTML

export async function onRequestGet({ params, env }) {
  const gene = (params.name || "").toUpperCase();
  // TODO: query env.genetic D1, render full gene page HTML
  return new Response(`Gene page: ${gene} — coming soon`, {
    headers: { "content-type": "text/html" },
  });
}
