# Meta relay

Meta's API answers "model not found" for most calls that come from Render's network (see `docs/PROGRESS.md`, 2026-10-28), while it answers every call from other networks. This folder holds a tiny forwarding script that runs on a network Meta serves. The app on Render sends its Meta calls to the relay; the relay passes them to `https://api.meta.ai` unchanged, including the app's own API key header, and streams the answer back. The relay stores nothing and has no key of its own.

## Set it up on Cloudflare Workers (free, no card, about five minutes)

1. Sign in or create a free account at https://dash.cloudflare.com.
2. Left menu: **Workers & Pages** → **Create** → **Create Worker** (the "Hello World" starter). Name it `citycenter-relay`. Click **Deploy**.
3. Click **Edit code**. Select everything in the editor, delete it, and paste the whole contents of `relay/worker.js`. Click **Deploy** (top right).
4. Go to the worker's **Settings** → **Variables and Secrets** → **Add**. Type: Secret. Name: `RELAY_SECRET`. Value: the secret from the project's `.env.render-vars.local` file (Claude generated it). Save, then **Deploy** again if asked.
5. Copy the worker's address. It looks like `https://citycenter-relay.<your-subdomain>.workers.dev`. Paste it into `.env.render-vars.local` as `META_API_BASE=` and save.
6. Tell Claude (or run `node scripts/probe-relay.js <that address>` yourself). The probe checks the relay from this laptop, then `node scripts/render-env.js --file .env.render-vars.local` puts the settings on Render and redeploys.

If Cloudflare's network turns out to be refused too, do the same on Deno Deploy (https://dash.deno.com → New Playground → paste `relay/deno.js` with `worker.js` inlined) or any other host, and point `META_API_BASE` there instead.

## Security notes

- The relay only forwards paths under `/v1/`, only to `api.meta.ai`, and only when the `x-relay-secret` header matches `RELAY_SECRET`.
- The Meta key never lives on the relay; it stays in the app's environment and travels in the `Authorization` header over HTTPS, exactly as it would to Meta directly.
- Remove the worker after the hackathon if the hosting problem is fixed.
