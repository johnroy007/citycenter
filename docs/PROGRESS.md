# Progress — citycenter

> Handoff log. Every agent (Claude or Codex, any laptop) reads this at the start of a task and updates it at the end. Newest log entries at the top. The day-by-day plan and rules digest live in the private notebook `C:\Users\John Barlow\Projects\citycenter-notes`.

## Status
**Working locally, end to end, on the real Meta API.** Resident flow (sketch, extract, classify, draft, agentic check) and staff portal (queue, pre-review with citations, decision, drafted letter) are built, tested and pushed to the public repo `johnroy007/citycenter`. Not yet deployed. Hackathon submission due Nov 4, 2026, 9 PM ET.

- **Live link:** none yet (Render deploy is John's next click; see Waiting on John)
- **Local:** `npm start` then http://localhost:3000 (resident) and http://localhost:3000/staff (staff; passcode is in `.env`)
- **Last updated:** 2026-10-27 (afternoon) by Claude Code on John's laptop

## RESUME POINT
Everything in the Oct 28 to Oct 31 plan is built ahead of schedule and verified locally (see the log entry below for exactly what was tested). Next steps, in order:
1. John deploys to Render from `render.yaml` and enters `MODEL_API_KEY` + `STAFF_PASSCODE` in Render's dashboard. Then run `npm run seed` once against the live database (Render shell) or submit three applications by hand so the staff queue is not empty.
2. John draws and photographs 3 real hand sketches (the current test sketches are computer-generated) and runs them through the live site. Fix anything the real photos break.
3. Fresh-eyes test, polish, then README final pass, video (Nov 3), submit (Nov 4). Details in the notebook's `notes/build-plan.md`.
If anything model-related misbehaves, change `lib/prompts.js` first; the schemas and rules live there.

## Waiting on John
- **Confirm the login decision:** no user accounts during the hackathon (reference code + access key for residents; one shared staff passcode). Written up in `LOGIN-TODO.md`. Say "yes" or ask for changes.
- **Open the app and click through it:** http://localhost:3000 (the server is running). Paste the sample text from the box, add `test/fixtures/sketch-clear.png` as the photo, submit. Then http://localhost:3000/staff with the passcode from `.env` (open `.env` in VS Code to read it; never paste it anywhere else).
- **Render:** create an account if needed, New → Blueprint → pick `johnroy007/citycenter`, enter the two secrets, deploy. Starter plan (~$7/month, cancel after judging). Send the live link back.
- **Review the invented town rules** in `data/sample-creek-code.json` and `data/sample-creek-checklist.json`. They are Claude's invention; edit freely (keep the `CL-xx` ids).
- **Still open from the notebook:** delete the stray "government" Discord message; lower the Meta billing alert to ~$5; accept the Official Rules; eligibility ruling pending.

## Open questions / known issues
- Live tests (`npm run test:live`) passed 9 of 9 on 2026-10-27 afternoon: 65 model calls, 202k input / 70k output tokens (roughly 55 cents at the unconfirmed Spark prices), 4 minutes total.
- The browser pages were verified through the API and by reading the code, not by clicking in a browser (no browser tool in this session). John's click-through is the first human test of the UI.
- Reference codes are sequential (`SC-2026-0101`, `0102`, ...) and need the per-application access key to view. Fine for a demo; a production version would use longer codes.
- Prices for Muse Spark/Wonder are unconfirmed (Meta's pricing page 404'd). Observed: a full resident run is about 20k input / 6k output tokens (7 calls); a staff pre-review about 12 tool calls. Check the Billing page after the first day.

## Log

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
