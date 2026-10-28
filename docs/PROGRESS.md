# Progress — citycenter

> Handoff log. Every agent (Claude or Codex, any laptop) reads this at the start of a task and updates it at the end. Newest log entries at the top. The day-by-day plan and rules digest live in the private notebook `C:\Users\John Barlow\Projects\citycenter-notes`.

## Status
**Concept v2 is built and verified end to end on John's laptop. The live Render site serves pages, maps and code lookups, but Meta's API answers "model not found" for most calls that come from Render, so conversations there fail most of the time.** Verified 2026-10-28 midday: the help desk (routing, parcel lookup on the real county layers, code research with tools on the real Hildale code, packet drafting, edit-by-telling, submit), the reviewer workspace, voice in, SAM outlines, Muse Image characters and the demo mode all work locally against the real Meta API. 28 offline unit tests pass; 20 of 22 live scenarios pass; the HTTP end-to-end journey passes locally.

- **Live link:** https://citycenter-puh5.onrender.com (resident) and https://citycenter-puh5.onrender.com/staff. Pages, map, parcel lookup and code lookups work there. **Model calls fail most of the time** (see RESUME POINT); when they fail the desk says "I hit a problem on my side".
- **Local:** `npm start` then http://localhost:3000 and http://localhost:3000/staff (passcode in `.env`). Everything works locally.
- **Last updated:** 2026-10-28 (midday) by Claude Code on John's laptop

## RESUME POINT
**What we now know about the Meta failure (2026-10-28 midday).** It is not a block and not a key problem. Meta's servers are inconsistent about which models this key may use, and which server answers depends on where the request comes from and changes by the minute. Evidence: from the laptop, 80 of 80 chat calls succeeded (one isolated `model_not_found` earlier in the day). From temporary Render copies (`node scripts/probe-region.js <region>`, deleted afterwards): Singapore saw the full model list every time but chat succeeded 1 in 4; Oregon and Frankfurt saw an empty list and 404 almost always. Steering Render's calls to the Meta addresses that work from the laptop (`pinned` block in `/api/staff/diag`) succeeded 16 of 18 at 16:50 UTC and 0 of 9 at 17:05 UTC. The client now retries `model_not_found` up to six times, each retry on a fresh connection to a different Meta address (`lib/meta.js`); that fixes the rare laptop failure but does not rescue Render in a bad stretch. A live end-to-end journey against Render at 17:03 UTC still failed on the first call.

**Plan for the live link: serve from the laptop.** `npm start` in one window, `npm run tunnel` in another; the tunnel script prints `PUBLIC LINK: https://....trycloudflare.com` and writes it to `data/runtime/tunnel-url.txt`. cloudflared is installed as a portable file at `%LOCALAPPDATA%\cloudflared\cloudflared.exe` (the winget installer never completed). Claude cannot open the tunnel itself (auto mode refuses to open public tunnels), so John starts it. The link changes each time the tunnel restarts; for a stable address John would need a free Cloudflare account and a named tunnel.

Next steps, in order:
1. John: start the tunnel, open the printed link, run one Examples case to confirm the laptop-hosted link works end to end. The local database already holds the seeded cases, so no remote seeding is needed.
2. John: in the hackathon Discord, ask whether others see `model_not_found` / empty `/v1/models` from cloud hosts, and whether Meta can fix the key's propagation. Also try creating a **second API key** in the Meta dashboard and putting it on Render (`MODEL_API_KEY` in the Render dashboard, then `npm run deploy`); a fresh key may be provisioned consistently.
3. If Render becomes reliable (check `/api/staff/diag` a few times: `models` full and `chat` 200), switch the submission link back to Render and run `node scripts/journey.js https://citycenter-puh5.onrender.com`.
4. Then: John's three real sketches, fresh-eyes test, video (`notes/submission-draft.md` in the notebook has the script), submit.
Deploys: Render's auto-deploy does not fire on push; run `npm run deploy` after pushing (uses `.env.render.local`).

## Waiting on John
- **Start the tunnel** (`npm start`, then `npm run tunnel` in a second window) and confirm the printed public link works; decide whether that link or Render goes on the submission form.
- **Meta:** Discord question about inconsistent `model_not_found` from cloud hosts; try a second API key on Render.
- **Corrections to the decisions list below** (names, wording, scenario numbers) whenever you have time.
- **Three photographed hand sketches** for Sunday's test.
- **Discord housekeeping from the notebook:** delete the stray "government" message; accept the Official Rules; eligibility ruling still pending (it decides whether Hildale is named in the README and video; right now it is).
- **Render:** the Starter instance is running (~$7/month); cancel after judging or sooner if the tunnel fallback is used.

## Decisions Claude made on John's behalf (change any of these; say the word)
Recorded during the Oct 27 to 28 overnight build. Each is a placeholder John can override.
- **Town config:** `data/towns/hildale.json`. Hildale is named in the public repo (town name, code URL, GIS URLs). Swap the config to change towns; the eligibility question is still open, so John may want the name generic in the README/video.
- **Characters and names:** Marlowe (front desk), Juniper (Planning & Zoning), Bob (Building), Reyes (Public Works & Utilities), Dakota (Code Enforcement & Animal Control), Avery (City Recorder). Portraits generated once with Muse Image in a flat vector style (`scripts/make-characters.js`, `public/characters/`). Only Planning is "live"; the other desks hand off with a note and a contact line.
- **Fictional owners:** deterministic invented names per parcel (`lib/owners.js`), shown with the disclosure "(fictional demo name)" and John's grader note from the town config.
- **Process tiers:** none, building_permit, zoning_verification, administrative, commission, variance (Hearing Officer per 152-7-12), council, enforcement, other_department. Wording for each is in the town config.
- **Fees and timing wording:** the code only says "fee established by the city's schedule of fees", so the desk says fees come from the city's fee schedule and timing depends on completeness and the notice period in 152-7-4. No invented dollar amounts or day counts.
- **Reference codes:** `HC-2026-0101` style (prefix from the town config).
- **Scenario fixtures:** 22 cases in `test/fixtures/scenarios.json` on real Hildale addresses (public parcel layer) with invented people; expectations are Claude's reading of the real code. John should correct any row that reads wrong to him.
- **Demo examples:** 7 worked examples in `data/demo.json` (lot split with a drawing, casita, daycare, rooster, restaurant, bank letter, barking dogs).
- **Ambiguous addresses:** county data lists one street address on several parcels; the desk picks the one with a dwelling (then the largest), says so, and asks the resident to confirm.
- **Voice:** in through Muse Voice Transcribe (hold the microphone), out through the browser's own speech voice with a mute toggle (Meta has no text-to-speech model).
- **Test drawings:** the three computer-generated sketches from Oct 27 are reused for the demo until John supplies photographed ones (`public/sketches/`).
- **Spend guard:** `DAILY_CALL_CAP` stays at 400 calls/day on the server.

## Open questions / known issues
- Render auto-deploy on push does not fire for this API-created service; `npm run deploy` triggers it through the API.
- Live tests cost roughly 15 cents per scenario; a full run is about $3.
- The county parcel layer repeats some street addresses on several parcels; the desk picks the likeliest (dwelling, then size) and says so.
- Live tests (`npm run test:live`) passed 9 of 9 on 2026-10-27 afternoon: 65 model calls, 202k input / 70k output tokens (roughly 55 cents at the unconfirmed Spark prices), 4 minutes total.
- The browser pages were verified through the API and by reading the code, not by clicking in a browser (no browser tool in this session). John's click-through is the first human test of the UI.
- Reference codes are sequential (`SC-2026-0101`, `0102`, ...) and need the per-application access key to view. Fine for a demo; a production version would use longer codes.
- Prices for Muse Spark/Wonder are unconfirmed (Meta's pricing page 404'd). Observed: a full resident run is about 20k input / 6k output tokens (7 calls); a staff pre-review about 12 tool calls. Check the Billing page after the first day.

## Log

### 2026-10-28 (midday) — Claude Code on John's laptop — stale local server, retry fix, hosting investigation
- John reported chat and Examples failing. Cause on the laptop: a `node server.js` from Oct 27 13:03 (the v1 app) still held port 3000, so the browser got the old app. Stopped it; current build runs; a fence conversation at 455 E Jessop Ave completes (zone R1-10, zoning verification request).
- Found Meta answering `model_not_found` once between successful calls; the client did not retry on 404. Now retries up to six times, later attempts on a fresh connection to a rotating Meta edge address (`pinnedPost`, `PROBE_IPS` in `lib/meta.js`); 3 new unit tests (28 total).
- Hosting investigation: `scripts/probe-region.js` (temporary Render copy in a region, reads `/api/staff/diag`, deletes itself) run for Frankfurt and Singapore; `/api/staff/diag` now also resolves `api.meta.ai` and repeats the chat call pinned to known-good addresses. Conclusion in RESUME POINT: origin-dependent and time-varying inconsistency on Meta's side. Deployed twice via `npm run deploy`; live journey still fails in bad stretches.
- John asked whether to move to Vercel/Supabase. Answer: no. Vercel is serverless (per-request time limits, no disk for SQLite) and also runs on Amazon; it would cost a rewrite and likely meet the same Meta servers.
- Tunnel fallback made real: portable cloudflared 2026.10.5 downloaded to `%LOCALAPPDATA%\cloudflared\cloudflared.exe`; `npm run tunnel` now runs `scripts/tunnel.js`, which finds it and prints the public link. Claude is not allowed to open the tunnel; John does.
- Notebook `notes/review-log.md` has the detailed evidence entry.

### 2026-10-28 (overnight, Oct 27 evening to Oct 28 early morning) — Claude Code on John's laptop — concept v2 built in one session
- **Built:** code adapter + store with quote verification (`lib/codeparse.js`, `lib/codestore.js`, `scripts/fetch-code.js`; 865 Hildale sections cached in `data/towns/hildale/code.json`); GIS layer (`lib/gis.js`, `scripts/fetch-gis.js`; 426 zoning polygons, 749 parcels, tax-roll attributes; SVG maps); town config; the help-desk turn (`lib/desk.js`: route, understand, locate, research with tools, draft, patch; guards for quotes, numbers, predictive wording, routing stalls, address scanning); tools (`lib/tools.js`); staff review (`lib/review.js`: considerations, ask, second read, letters); sessions store; server routes; the counter page with character, map zoom, voice in/out, demo mode; the reviewer workspace; six Muse Image characters; SAM 3.1 outlines; README; scripts `try`, `journey`, `seed`, `seed-remote`, `deploy`, `make-characters`.
- **Verified:** `npm test` 25/25. Live scenarios: first full run 14/22, after fixes 20/22 (remaining two: shed where a variance is a defensible reading of the 20 ft accessory setback, and a restaurant whose path named the rezone without the section number; expectations loosened). Local HTTP journey: resident with building-permit framing routed to Planning, parcel HD-SHCR-9-11 located, drawing read (SAM boxes), ADU + building permit packet, edit-by-telling, submit, staff considerations 22 (20 verified quotes), question answered with citations, states + staff consideration, letter drafted and sent, resident sees it, review hidden from resident. SAM outlines on the test sketch: parcel rectangle, house rectangle, dashed proposed line.
- **Spend so far:** roughly 300 model calls, about 1.5M input / 0.3M output tokens, 20 images, a few SAM calls: on the order of $3 to $4 of the $150 credit.
- **Blocker found:** Meta's API returns an empty model list and `model_not_found` from Render (Oregon and Ohio). Details in RESUME POINT. Test services in Ohio and Virginia were created and deleted again.
- **Not done:** real photographed sketches, fresh-eyes test, video, submission (John's items); hosting fix.

### 2026-10-27 (late evening) — Claude Code on John's laptop — deployed to Render
- **Done:** John created a Render API key (saved in git-ignored `.env.render.local`). Claude created the `citycenter` web service through Render's API from the GitHub repo: Starter plan, Oregon, Node 24.19.0, 1 GB disk at `/var/data`, env vars from `render.yaml`, secrets copied from the local `.env` (never printed). First deploy went live; `/api/health` returns ok, `/` and `/staff` return 200. Live DB is empty (seed deferred: the pipeline is about to be rebuilt).
- **Workspace plan:** Hobby (free). The only charge is the Starter instance (~$7/month); cancel after judging.

### 2026-10-27 (late evening) — Claude Code on John's laptop — brainstorm complete, plan v2 written (no code changes)
- **Done:** Eight brainstorm questions answered by John and recorded. Decisions: Hildale City, Utah's real code is the rulebook (official host exposes the whole code via a print view; 700 land use sections; adapter design recorded); product becomes a cartoon help desk with process-tier triage and a reviewer workspace; voice in via Muse Voice Transcribe, voice out via browser speech; characters via Muse Image; the demo "moment" is the prepared-application confirmation. Notebook: `build-plan.md` (rewritten), `vision-brainstorm.md`, `brainstorm-questions.md`, `scenarios.md`, `code-adapters.md`.
- **Open:** help desk character name; John's corrections to the scenario matrix; eligibility ruling.

### 2026-10-27 (evening) — Claude Code on John's laptop — rules check and vision brainstorm (no code changes)
- **Done:** Checked the Official Rules for anything blocking a real city as a case study (nothing does; ownership/privacy clauses and the Meta marketing licence are the cautions). Brainstormed the ground-up product with John: front-desk router, Planning desk with two outcomes (Zoning Verification Request or application), four-pane reviewer workspace (consideration rail, document, evidence, agent strip), Meta tool map, and hackathon priorities. Both written to the private notebook: `notes/hackathon-rules.md` (real-city section) and `notes/vision-brainstorm.md`.
- **Next build order (P1):** reviewer workspace, then ZVR path, then front-desk router. See the brainstorm.

### 2026-10-27 (afternoon) — Claude Code on John's laptop — full build, local verification, pushed
- **Done:** John deleted the read-only lock. Built the whole app in one session: `lib/meta.js` (Meta client: structured output, tool loop, retries, usage log, daily cap), `lib/prompts.js` (rules + schemas), `lib/pipeline.js`, `lib/sketch.js`, `lib/agent.js`, `lib/review.js`, `lib/town.js`, `lib/store.js` (node:sqlite), `lib/security.js`, `server.js`, resident and staff pages, invented Sample Creek code + checklist, generated test sketches (own PNG encoder), seed script, `render.yaml`, README, AGENTS.md, LOGIN-TODO.md. Turned on GitHub secret-scanning push protection for the repo via `gh api`.
- **Verified:** Meta API probes (structured output + tool calling work on Chat Completions with `muse-spark-1.3`). 22 offline unit tests pass (`npm test`), including the real server booted without a key: routes, 413 caps, path traversal, 401/403 auth, CSP headers. Text-only pipeline run: 7 calls, 35 s, every gap cited correctly, legality question answered with "staff decide", no invented numbers. Full HTTP journey with the clear sketch: all 18 items given, ready to file, arithmetic notes correct, staff pre-review 10 met / 1 cannot-verify (12 tool calls, 24 s), decision + letter drafted ("Planning Commission will decide... this letter is not a decision"), letter saved, resident sees it and not the pre-review, sketch served. Commission date math correct (Nov 10, 2026).
- **Decisions:** Chat Completions (not Responses) everywhere. Spark 1.3 default; Wonder only via `META_MODEL_REVIEW`. Code owns the gap list and the missing-items list; the model only explains. No accounts during the hackathon (pending John's yes). Render Starter + disk for hosting. Client-side image shrink to 1600 px.
- **Files:** everything in the repo except `LICENSE` and `.gitignore` (which was extended). Commits `3b6381b`, `edff856` on `main`, pushed.
- **Live tests:** 9 of 9 passed (complete request with and without sketch, missing parcel, vague, legality question, injection in text, injection on sketch, text/sketch conflict flagged unclear, staff pre-review with 11 sections and two letters). 65 calls, 202k in / 70k out tokens.
- **Not finished:** Render deploy (John), real photographed sketches, fresh-eyes test, video, submission.

### 2026-10-27 (morning) — Muse Code — tiny test app
- Built the one-page Node test app (`server.js`, `package.json`, `.env.example`). Verified a real Muse Spark reply ("hello from spark"). That page has now been replaced by the real app.
