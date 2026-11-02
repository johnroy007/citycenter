# citycenter

## What this is
John's entry in the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026; submission due Nov 4, 9 PM ET). A virtual city help desk for a real small town (Hildale City, Utah): a resident talks to cartoon desk characters, the planner reads the real city code and the real county parcel and zoning layers, prepares the application in the city's form, and the resident signs and submits it. Town staff review it in a four-step workspace (what was submitted, the code that applies, point-by-point review, return letter). Only real city officials decide; the agent never recommends, predicts or rates. See `README.md` for the judges' description.

The private planning notebook (rules digest, plan, review log, submission drafts) lives at `C:\Users\John Barlow\Projects\citycenter-notes`. Read its `notes/hackathon-rules.md` before adding any feature.

## Stack
- Node.js 22.5+ (24 in use), built-in modules only: `http`, `fetch`, `node:sqlite`, `crypto`. No npm packages, on purpose.
- Meta Model API (`lib/meta.js` is the only caller): `muse-spark-1.3` for every desk and staff step (structured output, tool calling, image input); `sam-3.1` for drawing outlines; `muse-voice-transcribe-1.0` for the microphone; `muse-wonder-1.0` for the staff second read; `muse-image-1.0` generated the characters and the office background (once, via scripts).
- Front end: plain HTML/CSS/JS in `public/`, rendered with `textContent` only (never innerHTML). The page's Content-Security-Policy blocks inline `style` attributes; set styles through `element.style`.
- Storage: one SQLite file (`data/runtime/citycenter.sqlite`, git-ignored; `/var/data` on Render).
- Hosting: Render web service, with Meta calls routed through a Cloudflare Worker relay (see Deploys).

## How to run it locally
1. Copy `.env.example` to `.env`; set `MODEL_API_KEY`, `STAFF_PASSCODE`, `COOKIE_SECRET`.
2. `npm start`, open http://localhost:3000 (resident) and http://localhost:3000/staff (staff passcode).
3. `npm test` (offline, about 30 s). `npm run test:live` (real API, about a dollar). `node scripts/journey.js http://localhost:3000` runs the whole resident-to-staff flow over HTTP. `node scripts/seed-remote.js http://localhost:3000 [ids] [--fresh]` replays the worked examples (`--fresh` first deletes earlier demo conversations).
4. A server started from an earlier session can keep holding port 3000; stop old `node server.js` processes before starting a new one.

## Where the important things are
- `server.js`: routes, limits, auth (staff passcode cookie; optional resident accounts), static files, relay/health/diag.
- `lib/prompts.js`: the rules every model call gets and every JSON schema (no schema may have an approval, recommendation, score or likelihood field; a unit test enforces this).
- `lib/desk.js`: the resident turn: sketch, route (with consent before every hand-off), understand, locate, research (tool loop), draft. `lib/tools.js`: the planner's tools over the code and the map. `lib/review.js`: staff steps (submission summary, code summary, considerations, ask, second read, letter generation and the derived letter kind).
- `lib/codestore.js`, `lib/codeparse.js`, `scripts/fetch-code.js`: Hildale's code from Municipal Code Online (865 sections, stored verbatim; quotes are verified against it). `lib/gis.js`, `scripts/fetch-gis.js`: Washington County zoning and Utah SGID parcels (no owner names; fictional owners come from `lib/owners.js`).
- `lib/signature.js`: electronic signature helpers (typed SVG, PNG check, document hash). `lib/security.js`: cookies, tokens, scrypt passwords, rate limits, headers. `lib/store.js`: SQLite schema and migrations (new columns are added on open).
- `data/towns/hildale.json`: everything town-specific: departments and characters, process tiers, application types, wording, office letterhead, GIS and code URLs. `data/demo.json`: the 13 worked examples. `public/characters/`, `public/office/`: generated art.
- `public/resident.js`, `public/index.html`: the office scene (history, character, TV with remote). `public/staff.js`, `public/staff.html`: the reviewer workspace. `public/form.js`: the application form, shared by both.
- `relay/`: the Cloudflare Worker that forwards Meta calls, with dashboard setup steps.
- `scripts/`: `deploy.js` (Render deploy), `render-env.js` (push settings from `.env.render-vars.local`), `probe-relay.js`, `probe-region.js`, `tunnel.js` (laptop fallback), `make-characters.js`, `make-office.js`, `seed.js`, `seed-remote.js`, `journey.js`, `try.js`.
- `test/unit/`: offline tests (32). `test/live/`: scenario tests against the real API. `test/fixtures/scenarios.json`: 22 cases.
- `docs/PROGRESS.md`: handoff log and the list of decisions John can change. `LOGIN-TODO.md`: what the resident accounts have and lack.

## Deploys
- Render web service `citycenter` (Starter, Oregon, 1 GB disk at `/var/data`). Live: https://citycenter-puh5.onrender.com (staff at `/staff`). Health: `/api/health`. Staff-only diagnostic: `/api/staff/diag`.
- Render's auto-deploy on push does not fire for this service. After pushing, run `npm run deploy` (uses `RENDER_API_KEY` from the git-ignored `.env.render.local`).
- Meta's API refuses most calls from Render's own network, so the app sends every Meta call through a Cloudflare Worker in John's Cloudflare account (`citycenter-relay`; code in `relay/worker.js`; the worker checks a shared secret). Render's environment holds `META_API_BASE` (the worker address) and `META_RELAY_SECRET`. To change Render settings, edit the git-ignored `.env.render-vars.local` and run `node scripts/render-env.js --file .env.render-vars.local` (it redeploys). `node scripts/probe-relay.js <worker address>` checks the relay from the laptop.
- Secrets live only in `.env*` files (git-ignored) and in Render's and Cloudflare's dashboards.

## Project rules
- Core features must call Meta models. Never swap in a non-Meta model for them.
- New work only. Never copy code, data, images, docs or prompts from any other project, including anything about Colorado City or Short Creek.
- Real public data, invented people: Hildale's published code, the county zoning layer and the state parcel layer are real; every person, owner name, phone number and signature is invented. Never fetch, store or show real owner names. Keep the grader note about fictional owners visible.
- Public repo. No keys, passwords or personal data in any file or commit. If a key ever lands in a commit, stop and tell John so he can revoke it. GitHub push protection is on.
- The app never rates the applicant, predicts approval, recommends a decision, or answers "is this allowed / legal". It describes what the code says, which process applies and what the paperwork needs, and quotes the code. Keep that true in prompts, schemas, code and UI text. The staff-decide line is in the town config (`wording.staffDecide`).
- Commit after each working step with a plain-English message and push to `origin main`. Never force-push. This folder is deliberately outside `Projects\` and outside auto-sync; keep it that way.
- Explain things to John in plain English; he is not a coder.
