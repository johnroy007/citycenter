# citycenter

**An agent for small towns.** A resident describes what they want to do with their land in plain English and adds a photo of their hand-drawn sketch. citycenter reads both with Meta's Muse Spark, drafts a complete, ready-to-file lot-split application, and lists exactly what is still missing and why, citing the town code. Town staff then get an agent pre-review that checks the packet against every code section, with evidence quoted and the section cited. **Staff and the Planning Commission decide. The agent never does.**

Built during the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026), Indie track, by one person. Everything in this repository was written during the event. The town, its code, its parcels and its people are invented ("Town of Sample Creek").

## Why

Small-town land use applications bounce. A resident files, waits two weeks, and gets a letter saying the sketch has no north arrow or the legal description is missing. Staff spend their time on completeness instead of judgment. citycenter moves the completeness work to the moment of filing, and gives staff a cited pre-review instead of a blank page.

## What it does

**Resident flow** (five steps, each a separate structured call to Muse Spark):

1. **Read sketch.** The photo goes to `muse-spark-1.3` as an image. It returns a fixed JSON shape: dimensions as written, the proposed lot line, structures, road, north arrow, and every text label on the drawing.
2. **Extract.** Request text plus sketch reading become one entry per checklist item (18 items), each marked `given`, `unclear` or `missing`, with the words it came from. Conflicts between the text and the sketch become `unclear` with both values recorded.
3. **Classify.** Which application type under section 12.02, with the section cited. If the resident asked "is this allowed?", the answer is that staff and the Planning Commission decide, with a pointer to the checklist.
4. **Draft.** The application narrative is written from `given` facts only. Anything missing becomes `[BLANK]`. Code checks every number in the narrative against the facts; an invented number triggers a retry and is then blanked.
5. **Check.** Code decides which items are missing or unclear. The agent then uses tools (`get_code_section`, `get_checklist_item`, `compute_lot_split`) to explain each gap with the exact citation and to report lot arithmetic against the district minimums. The tool log is shown to the resident.

The resident gets a reference code, a printable packet, the gap list, and "what happens next" under section 12.10.

**Staff portal** (passcode):

- Queue of applications with status.
- **Agent pre-review**: for each section 12.01 to 12.11, the requirement, the evidence quoted from the packet, and a status of `met`, `not_met` or `cannot_verify`. `cannot_verify` is the default when evidence is absent. The output schema has no recommendation field, so the model cannot give one.
- Staff choose **request more information** or **accept as complete and schedule for Planning Commission**. The agent drafts the letter; staff edit and save; the resident's page shows it.

## Meta models

| Where | Model | How |
|---|---|---|
| Sketch reading | `muse-spark-1.3` | Chat Completions with `image_url` (base64) and `response_format` JSON schema |
| Extract, classify, draft | `muse-spark-1.3` | Chat Completions with `response_format` JSON schema |
| Completeness agent | `muse-spark-1.3` | Tool calling loop (max 8 rounds) then a final structured answer |
| Staff pre-review and letters | `META_MODEL_REVIEW` (default `muse-spark-1.3`; `muse-wonder-1.0` can be tried) | Tool calling loop plus structured answer |

Endpoint: `https://api.meta.ai/v1/chat/completions`. Only the server talks to it. The key never reaches the browser.

## Run it locally

Needs Node 22.5 or newer (24 recommended). No packages to install.

1. Copy `.env.example` to `.env`.
2. Fill in `MODEL_API_KEY` (from dev.meta.ai). For the staff portal, also set `STAFF_PASSCODE` (8+ characters) and `COOKIE_SECRET` (16+ random characters).
3. `npm start`, then open http://localhost:3000. The staff portal is at http://localhost:3000/staff.

Optional: `npm run seed` runs the pipeline on three invented requests so the staff queue is not empty (about 25 cents of API credit).

## Tests

- `npm test`: offline tests. Town rules and arithmetic, facts normalization, gap detection, storage, security helpers, and the real server booted without an API key (routes, limits, auth, headers).
- `npm run test:live`: the five fixture requests and four generated sketches through the real pipeline, plus a staff pre-review and two letters. Checks that nothing is invented, that legality questions get the staff-decide answer, that prompt injection in the text or on the sketch changes nothing, and that a text/sketch conflict is flagged. Costs about a dollar.
- `npm run make-sketches` regenerates the test sketches (a tiny PNG encoder and bitmap font, no libraries).

## Deploy

`render.yaml` describes a Render web service with a 1 GB persistent disk for the SQLite file. Create a Blueprint from this repo, then enter `MODEL_API_KEY` and `STAFF_PASSCODE` in Render's dashboard. The free tier sleeps and would make a live demo wait a minute, so the blueprint uses the Starter plan.

## Safety and limits

- The app describes what an application needs. It never says whether a split is allowed, legal, or likely to be approved, and it never rates a person. These rules are in `lib/prompts.js` and enforced again in code (`lib/agent.js`, `lib/review.js`).
- Request and sketch text are treated as data, never instructions.
- Request body capped at 64 KB (8 MB with an image, which the browser shrinks to 1600 px first), 20 submissions per hour per IP, 10 staff sign-in attempts per 15 minutes, and a daily model-call cap (`DAILY_CALL_CAP`) so a public demo cannot burn the credits.
- Resident pages need the reference code and an access key. Staff routes need a signed, HttpOnly cookie. Model output is rendered with `textContent` only. Content Security Policy is `default-src 'self'`.
- No real personal data: the demo says so on the page and all fixtures are invented.

## Layout

```
server.js            routes, static files, limits, auth
lib/meta.js          Meta API client: structured output, tool loop, retries, usage log
lib/prompts.js       the rules and every JSON schema
lib/pipeline.js      resident steps and orchestration
lib/sketch.js        image validation and sketch reading
lib/agent.js         gap detection (code) + tool-using explainer (model)
lib/review.js        staff pre-review and letters
lib/town.js          Sample Creek code/checklist loader and lot arithmetic
lib/store.js         SQLite (node:sqlite)
lib/security.js      cookie signing, rate limits, body caps, headers
data/                the invented code and checklist (JSON)
public/              resident page, staff page, styles
test/                unit tests, live tests, fixtures
scripts/             seed and sketch generator
```

Built with Claude Code; the app runs on Meta's Muse models. MIT license.
