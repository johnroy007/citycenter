# CityCenter: a virtual city help desk

A resident walks up to a cartoon counter and says what they need: a permit, a pothole, a water bill, a pavilion for a party. The help desk finds the right department, pulls up the parcel on the county map, reads the city's real code, and prepares the paperwork: a zoning verification request, an application set, or a complaint report. City staff open it in a reviewer workspace that lays out every consideration with the exact code text beside it. **The agent packages and prepares. City staff decide.**

Entry for the Indie track of the Meta Global AI Developer Hackathon (Oct 26 to Nov 4, 2026).

## Judges: start here

1. Open https://citycenter-puh5.onrender.com and press **Examples**, then choose Devon's lot split. It plays the resident's side while the desk answers live. A full example takes about five minutes, because each planner reply takes a minute or two.
2. Or type your own request. Try "Can I keep a rooster at 595 E 1400 N?"
3. Open https://citycenter-puh5.onrender.com/staff (no sign-in), pick a Submitted application, and walk the four steps across the bar. Opening a step for the first time runs the models, which can take up to two minutes.

This is a shared public demo. Please use made-up names and details. Every department desk works: Planning & Zoning does the deepest land use work, and the eight other departments handle 28 services between them. Trust City is an example city; the [Information page](https://citycenter-puh5.onrender.com/about) explains what is real and lists every source.

## Built during the hackathon

Everything in this repository was written during the event, starting with the first commit on Oct 27, 2026: the app, the agents and their tools, the tests, the video scripts and the Muse Image art. Nothing was carried over from an earlier project.

Not ours: the town's code and the county and state map data, and the real public pages listed on the Information page, which were read but not copied (see "Real data, invented people"). The app has no third-party code packages.

## What it does

**Resident side (the counter)**
- A front desk character (Marlowe) listens, routes to the right department, and flags zoning implications even when the resident asked for "a building permit".
- The planner character (Juniper) locates the parcel from a street address, reads the zone from the official zoning layer, researches the real code with tools, works out which **process tier** the code provides (no application, building permit, zoning verification, administrative, Planning Commission, variance, City Council, or enforcement), and prepares the packet.
- The moment: *"It looks like you need a zoning map amendment and a lot split application. I have prepared them for your review. Hit Submit, edit them, or tell me what to change."* Residents can edit fields directly or just say what to change.
- Department desks: Building, Utilities, Public Works, Police, Fire, Parks and Recreation, Code Enforcement and the City Recorder each answer questions from the real code and a sample procedure, then prepare the right form: for example a burn permit, a hydrant flow test, police standby for an event, or a pavilion reservation. Reports such as potholes need no signature.
- Three levels of help at every department: **information** (the desk shows the code and draws no conclusion), a **certified question** (the desk helps the resident write it; staff answer in writing through the same four steps, and that answer can be relied on), and a **formal application** (a zoning verification, a lot split, a permit).
- A phone app: on a phone the site becomes a chat with bottom tabs for the map, code, uploads and forms, and it can be installed to the home screen. It is the same site and server; desktop is unchanged.
- A clickable street map: a resident marks a pothole on a real street, and the program finds the closest address and street for the crew.
- Danger right now gets a fixed "call 911" message from plain code, before any model runs.
- Drawings: a sketch, an engineered site plan or a page of building plans can be attached and is read for dimensions and labels. The sample sketches in this repo are computer-made stand-ins.
- Voice: hold the microphone and talk; the character talks back (text and voice).
- Worked examples for judges: a corner button plays a resident's side of the conversation while the desk answers live.

**Staff side (the reviewer workspace)**
- A queue across the top, then four steps: what was submitted, the code that applies, the point-by-point review, and the return document.
- Step 1 shows the submitted documents with the facts pulled out. Step 2 summarizes the code sections that matter, with a verified quote from each.
- Step 3 lists the points a Land Use Administrator would check, each with the requirement, a verified quote where one exists, what the packet says and how staff normally verify it. Staff mark each point Approve, Deny, Needs info or N/A, add comments, and ask questions that the agent answers from the code.
- A second reader (Muse Wonder) checks the list against the code text and reports what it thinks was missed or not supported.
- The return letter is drafted from the staff's marks and words, can be edited, and is sent to the resident's conversation with a note that AI drafted it.

**Guardrails, enforced in code**
- Code quotes in the application and the staff review are checked against the stored code text before they are shown. Unverifiable quotes are dropped and marked. Letters are written from those checked quotes, and staff read them before sending.
- No schema contains a recommendation, approval, score or likelihood field (a unit test asserts this). Predictive wording is scrubbed from replies.
- Numbers in drafted narrative statements must come from the resident, the parcel record or the cited code; anything else becomes [BLANK].
- Text in a resident's message or on a drawing is data, never an instruction.

## Which Meta models do what

| Step | Model | How |
|---|---|---|
| Routing, understanding, drafting, replies, letters | `muse-spark-1.3` | Chat Completions with structured output (JSON schema) |
| Code research, staff considerations, staff questions | `muse-spark-1.3` | Tool calling: `search_code`, `get_section`, `zone_info`, `lookup_parcel`, `lot_math`, `animal_points`, `process_info` |
| Department desks: answers, forms and certified questions | `muse-spark-1.3` | Tool calling (`read_service`, `search_services`, `search_code`, `get_section`, `lookup_parcel`), then structured output; each form's field list is fixed in the schema |
| Reading drawings and photos, at every desk | `muse-spark-1.3` | Image input |
| Outlining the drawing | `sam-3.1` | Responses API, text-prompted boxes |
| Resident speaks | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` (WAV built in the browser) |
| Second read of the considerations | `muse-wonder-1.0` | Chat Completions |
| Characters, office background, video art | `muse-image-1.0` | Generated once during the event (`scripts/make-characters.js`, `scripts/make-office.js`, `video/make-art.js`) |

Not Meta, on purpose: the spoken reply uses the browser's own voice and the demo video's narration uses a Google voice (Meta lists no text-to-speech model); quote verification, lot arithmetic and map geometry are plain code so they cannot hallucinate. The parcel is found by plain code before the planner starts, and the planner can look up other parcels with a tool.

## Real data, invented people

The demo town is called **Trust City**. It is an example city, not a real place. Its code and maps are the real published data of Hildale, Utah; only the town's name is changed on screen (the setting is `sourceName` in the town config). Hildale City did not make or review this project.

- **Code:** the town's code, pulled from the city's official code host (865 sections, 349 in the Land Use title) and stored verbatim with a link to every section.
- **Zoning map:** Washington County's official zoning layer for the town (426 polygons), saved as a copy.
- **Parcels:** the UGRC SGID parcel layer (749 parcels with boundaries, parcel numbers and addresses), saved as a copy and used under CC BY 4.0 (data modified). This dataset contains no owner names, and the program never requests any.
- **Procedures, forms, fees and timelines:** original samples for the example city, written after reading real public pages from about 40 governments, and shown in a box marked as a sample. They are not any city's rules. The Information page lists each page and marks what is a public record; "open license" appears only where the license was confirmed.
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
node scripts/journey.js http://localhost:3000   # end-to-end over HTTP
```

Refresh the cached public data: `npm run fetch:code` and `npm run fetch:gis`.

## Where things are

- `server.js` routes; `lib/desk.js` the resident turn; `lib/review.js` the staff side; `lib/tools.js` the agents' tools; `lib/prompts.js` rules and schemas.
- `lib/codestore.js`, `lib/codeparse.js`, `scripts/fetch-code.js` the code adapter; `lib/gis.js`, `scripts/fetch-gis.js` the map layers.
- `public/` the counter and the workspace (plain HTML, CSS and JS, rendered with `textContent` only).
- `data/towns/trust-city.json` the town config; `data/towns/trust-city/` the cached code and map layers; `data/demo.json` the worked examples.
- `test/fixtures/scenarios.json` the 22 scenario cases; `docs/PROGRESS.md` the build log and the list of placeholder decisions.
- `relay/` a forwarding script from early in the event, when the hosted copy could not reach Meta's API reliably. It is no longer used: the live site calls Meta directly.

## Live

https://citycenter-puh5.onrender.com (staff workspace at `/staff`, open to everyone with no sign-in so you can try both sides; residents need no account either). Privacy and terms: `/privacy`.

## License

The software written for this project is MIT licensed. That license does not cover the data in `data/towns/`, which belongs to its sources: see [data/towns/trust-city/NOTICE.md](data/towns/trust-city/NOTICE.md) for credits, license terms and disclaimers.

Data sources: UGRC SGID (data modified, CC BY 4.0), Washington County GIS, and the town's published code.

Built by John Barlow with Claude Code; the app runs on Meta's Muse models.
