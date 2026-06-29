// Pages Function: /api/*
// Public read API + password-protected admin write API

export async function onRequest({ request, env }) {
  // TODO: implement API routes
  return new Response(JSON.stringify({ status: "ok" }), {
    headers: { "content-type": "application/json" },
  });
}
