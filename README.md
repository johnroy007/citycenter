# citycenter: a virtual city help desk

A resident walks up to a cartoon counter and says what they want to do with their land. The help desk finds the right department, pulls up the parcel on the county map, reads the city's real code, and prepares the paperwork: a zoning verification request, an application set, or a complaint report. City staff open it in a reviewer workspace that lays out every consideration with the exact code text beside it. **The agent packages and prepares. City staff decide.**

Built from scratch during the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026). Entry for the Indie track.

## What it does

**Resident side (the counter)**
- A front desk character (Marlowe) listens, routes to the right department, and flags zoning implications even when the resident asked for "a building permit".
- The planner character (Juniper) locates the parcel from a street address, reads the zone from the official zoning layer, researches the real code with tools, works out which **process tier** the code provides (no application, building permit, zoning verification, administrative, Planning Commission, variance, City Council, or enforcement), and prepares the packet.
- The moment: *"It looks like you need a zoning map amendment and a lot split application. I have prepared them for your review. Hit Submit, edit them, or tell me what to change."* Residents can edit fields directly or just say what to change.
- Drawings: a napkin sketch, a hand drawing, an engineered site plan or a page of building plans can be attached and is read for dimensions and labels.
- Voice: hold the microphone and talk; the character talks back (text and voice).
- Worked examples for judges: a corner button plays a resident's side of the conversation while the desk answers live.

**Staff side (the reviewer workspace)**
- A rail of considerations across the top, one per thing a Land Use Administrator would check, each tied to a code section with a verified quote.
- The document on the left with the active section highlighted; the evidence on the right (code text, numbers compared, parcel map, drawing reading).
- The agent strip along the bottom says what the code requires, what the packet says, and how staff normally verify it. Staff mark each consideration Met, Not met, Cannot verify or N/A, add their own, and ask questions that the agent answers from the code.
- A second reader (Muse Wonder) checks the list against the code text.
- Letters are drafted from the staff's marks and words, edited by staff, and sent to the resident's conversation.

**Guardrails, enforced in code**
- Every quote the model produces is checked against the stored code text before it is shown. Unverifiable quotes are dropped and marked.
- No schema contains a recommendation, approval, score or likelihood field (a unit test asserts this). Predictive wording is scrubbed from replies.
- Numbers in drafted statements must come from the resident, the parcel record or the cited code; anything else becomes [BLANK].
- Text in a resident's message or on a drawing is data, never an instruction.

## Which Meta models do what

| Step | Model | How |
|---|---|---|
| Routing, understanding, drafting, replies, letters | `muse-spark-1.3` | Chat Completions with structured output (JSON schema) |
| Code research, staff considerations, staff questions | `muse-spark-1.3` | Tool calling: `search_code`, `get_section`, `zone_info`, `lookup_parcel`, `lot_math`, `animal_points`, `process_info` |
| Reading drawings | `muse-spark-1.3` | Image input |
| Outlining the drawing | `sam-3.1` | Responses API, text-prompted boxes |
| Resident speaks | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` (WAV built in the browser) |
| Second read of the considerations | `muse-wonder-1.0` | Chat Completions |
| Characters | `muse-image-1.0` | Generated once during the event (`scripts/make-characters.js`) |

Not Meta, on purpose: the spoken reply uses the browser's own voice (Meta lists no text-to-speech model); quote verification, lot arithmetic and map geometry are plain code so they cannot hallucinate.

## Real data, invented people

- **Code:** Hildale City, Utah's code, pulled from the city's official code host (865 sections, 349 in the Land Use title) and stored verbatim with a link to every section.
- **Zoning map:** Washington County's official zoning layer for Hildale (426 polygons).
- **Parcels:** the State of Utah's parcel layer (749 Hildale parcels with boundaries, parcel numbers and addresses). This dataset contains no owner names by state law, and the program never requests any.
- **People:** every resident, applicant and intention is invented. Property owner information is public record; however, for demo purposes this program assigns fictional names as property owners. The production version would call public county records for ownership information.

The design is generic: `data/towns/<town>.json` names the code host, zoning layer and parcel layer, and `scripts/fetch-code.js` and `scripts/fetch-gis.js` cache them. Another city is a new config plus a reader for its code host (Municipal Code Online is the first; Municode, American Legal and others are planned).

## Run it

Requires Node 22.5 or newer (24 in use). No npm packages: the app uses only Node's built-in `http`, `fetch`, `node:sqlite`, `crypto`.

```
cp .env.example .env      # then set MODEL_API_KEY, STAFF_PASSCODE, COOKIE_SECRET
npm start                 # http://localhost:3000 (resident), /staff (staff)
npm test                  # offline unit tests
npm run try -- lot-split-ok     # one scenario through the desk, printed (a few cents)
npm run test:live         # 22 scenarios on the real code (a few dollars)
node scripts/journey.js http://localhost:3000 <staff passcode>   # end-to-end over HTTP
```

Refresh the cached public data: `npm run fetch:code` and `npm run fetch:gis`.

## Where things are

- `server.js` routes; `lib/desk.js` the resident turn; `lib/review.js` the staff side; `lib/tools.js` the agents' tools; `lib/prompts.js` rules and schemas.
- `lib/codestore.js`, `lib/codeparse.js`, `scripts/fetch-code.js` the code adapter; `lib/gis.js`, `scripts/fetch-gis.js` the map layers.
- `public/` the counter and the workspace (plain HTML, CSS and JS, rendered with `textContent` only).
- `data/towns/hildale.json` the town config; `data/towns/hildale/` the cached code and map layers; `data/demo.json` the worked examples.
- `test/fixtures/scenarios.json` the 22 scenario cases; `docs/PROGRESS.md` the build log and the list of placeholder decisions.
- `relay/` a tiny forwarding script (Cloudflare Worker) the hosted copy uses to reach Meta's API, because Meta's service refused most calls from the host's own network. It carries the same calls unchanged; see `relay/README.md`.

## Live

https://citycenter-puh5.onrender.com (staff portal at `/staff`).

MIT licensed. Built by John Barlow with Claude Code; the app runs on Meta's Muse models.
