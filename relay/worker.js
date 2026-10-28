// citycenter Meta relay. Forwards /v1/* requests to https://api.meta.ai from a network Meta serves,
// passing the caller's own Authorization header through. Nothing is stored. Written for Cloudflare
// Workers; the same handler shape runs on Deno Deploy (see deno.js).
//
// Settings (Worker > Settings > Variables): RELAY_SECRET (optional but recommended). The app sends it
// as the x-relay-secret header (META_RELAY_SECRET in the app's environment).
const UPSTREAM = "https://api.meta.ai";
const PASS_HEADERS = ["authorization", "content-type", "accept"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, relay: "citycenter", upstream: UPSTREAM, colo: (request.cf && request.cf.colo) || null }), { headers: { "content-type": "application/json" } });
    }
    if (!url.pathname.startsWith("/v1/")) return new Response("Not found", { status: 404 });
    if (env && env.RELAY_SECRET && request.headers.get("x-relay-secret") !== env.RELAY_SECRET) {
      return new Response(JSON.stringify({ error: { message: "relay secret missing or wrong" } }), { status: 403, headers: { "content-type": "application/json" } });
    }
    const headers = new Headers();
    for (const h of PASS_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const init = { method: request.method, headers, redirect: "follow" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, init);
    const out = new Headers();
    for (const h of ["content-type", "content-length", "x-request-id"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set("x-relay", "citycenter");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
