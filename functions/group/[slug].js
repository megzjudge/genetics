// Pages Function: /group/[slug]
// Handles: genetics.jdge.cc/group/folate-metabolism, etc.

export async function onRequestGet({ params, env }) {
  const slug = params.slug || "";
  // TODO: query env.genetic D1, render group overview page
  return new Response(`Group page: ${slug} — coming soon`, {
    headers: { "content-type": "text/html" },
  });
}
