# Progress — citycenter

> Handoff log. Every agent (Claude or Codex, any laptop) reads this at the start of a task and updates it at the end. Newest log entries at the top. The day-by-day plan and rules digest live in the private notebook `C:\Users\John Barlow\Projects\citycenter-notes`.

## Status
**Concept v2 is built and verified locally end to end; the live site is deployed but Meta's API refuses model calls from Render's network.** The help desk (routing, parcel lookup on the real county layers, code research with tools on the real Hildale code, packet drafting, edit-by-telling, submit), the reviewer workspace (consideration rail, document, evidence, agent strip, second read, letters), voice in, SAM outlines, Muse Image characters and the judges' demo mode all work locally against the real Meta API. 25 offline unit tests pass; 20 of 22 live scenarios pass (the two left are judgment calls, see log); the HTTP end-to-end journey passes locally.

- **Live link:** https://citycenter-puh5.onrender.com (resident) and https://citycenter-puh5.onrender.com/staff. Pages, map, parcel lookup and code lookups work there. **Model calls do not** (see Waiting on John): every conversation ends with "I hit a problem on my side".
- **Local:** `npm start` then http://localhost:3000 and http://localhost:3000/staff (passcode in `.env`). Everything works locally.
- **Last updated:** 2026-10-28 (early morning) by Claude Code on John's laptop

## RESUME POINT
The build plan is done through the Sunday items except John's own parts (real sketches, fresh eyes). **The one blocker is hosting:** from Render (both Oregon and Ohio, egress on Amazon addresses) Meta's `GET /v1/models` returns an empty list and every call returns `model_not_found`, with the same key that sees nine models from John's laptop. The staff-only route `/api/staff/diag` on the live site shows this. Meta's docs say nothing about network restrictions. Next steps, in order:
1. John: ask in the hackathon Discord (#questions) whether the Model API blocks cloud-hosted / AWS addresses, and check the Meta dashboard for any key or team restriction. Paste the answer into the notebook.
2. If cloud hosting is simply blocked, the fallback for the live link is the laptop plus a tunnel (Cloudflare quick tunnel, `winget install Cloudflare.cloudflared`, then `cloudflared tunnel --url http://localhost:3000`). The video can be recorded locally either way.
3. If a different host might work, test from a non-Amazon network first. A GitHub Actions probe is ready to write (Claude could not store the key as a repo secret; John can run `gh secret set MODEL_API_KEY` or add it in GitHub settings).
4. Then: seed the working host (`npm run seed:remote <url>`), John's three real sketches through it, fresh-eyes test, video (notebook `notes/submission-draft.md` has the script), submit.
Deploys: Render's auto-deploy did not fire on push for this API-created service; run `npm run deploy` after pushing (uses `.env.render.local`).

## Waiting on John
- **Hosting blocker (above):** Discord question about cloud addresses; or decide on the tunnel fallback.
- **Permission:** allow Claude to store `MODEL_API_KEY` as a GitHub Actions secret (auto mode refused secret-store writes), or set it yourself, so the cloud probe can run.
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
