# citycenter

## What this is
John's entry in the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026; submission due Nov 4, 9 PM ET). An agent for small towns: a resident's plain-English request plus a sketch photo becomes a complete lot-split application with a cited list of what is missing; town staff get an agent pre-review with every code section cited. Staff and the Planning Commission decide; the agent never does. See `README.md` for the full description.

The private planning notebook (rules digest, day-by-day plan, review log) lives at `C:\Users\John Barlow\Projects\citycenter-notes`. Read its `notes/hackathon-rules.md` before adding any feature.

## Stack
- Node.js 22.5+ (24 in use), built-in modules only: `http`, `fetch`, `node:sqlite`, `crypto`, `zlib`. No npm packages.
- Meta Model API, Chat Completions: `https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3` (structured output via `response_format`, image input via `image_url`, tool calling). `META_MODEL_REVIEW` can point the staff steps at `muse-wonder-1.0`.
- Front end: plain HTML/CSS/JS in `public/`, rendered with `textContent` only.
- Deploy target: Render web service with a persistent disk (`render.yaml`).

## How to run it locally
1. Copy `.env.example` to `.env`; set `MODEL_API_KEY`, `STAFF_PASSCODE`, `COOKIE_SECRET` (names in `.env.example`).
2. `npm start`, open http://localhost:3000 (resident) and http://localhost:3000/staff (staff).
3. `npm test` (offline, fast). `npm run test:live` (real API, about a dollar). `npm run seed` (three demo applications, about 25 cents).

## Where the important things are
- `server.js`: routes, limits, auth, static files.
- `lib/prompts.js`: the six rules every model call gets, and every JSON schema. Change behavior here first.
- `lib/pipeline.js`: resident steps (sketch, extract, classify, draft, check) and `runResidentFlow`.
- `lib/agent.js`: gap detection in code plus the tool-using explainer; `lib/review.js`: staff pre-review and letters.
- `lib/meta.js`: the only place that calls Meta. Retries, timeouts, usage logging, daily cap hook.
- `data/sample-creek-code.json`, `data/sample-creek-checklist.json`: the invented town rules. The checklist item ids (`CL-01`..`CL-18`) are referenced by schemas and tests.
- `data/runtime/` (git-ignored): local SQLite file and nothing else.
- `docs/PROGRESS.md`: handoff log. `LOGIN-TODO.md`: why there are no user accounts during the hackathon.

## Deploys
Render, from `render.yaml`, auto-deploy on push to `main`. Secrets are entered in Render's dashboard. Not yet created as of 2026-10-27; see `docs/PROGRESS.md`.

## Project rules
- Core features must call Meta models (Muse Spark or Muse Wonder). Never swap in a non-Meta model for them.
- New work only. Write everything fresh here; never copy code, data, images, docs or prompts from any other project, including anything about Colorado City or Short Creek.
- Invented data only: the Town of Sample Creek, made-up parcels and people. No real parcels, owners or records.
- Public repo. No keys, passwords or personal data in any file or commit. Secrets only in `.env` (git-ignored) or Render's dashboard. If a key ever lands in a commit, stop and tell John so he can revoke it. GitHub push protection is on.
- The app never rates the applicant, predicts approval, recommends a decision, or answers "is this allowed / legal". It describes what the application needs and cites the code. Keep that true in prompts, schemas, code and UI text.
- Commit after each working step with a plain-English message and push to `origin main`. Never force-push. This folder is deliberately outside `Projects\` and outside auto-sync; keep it that way.
- Explain things to John in plain English; he is not a coder.
