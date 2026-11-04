"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadTown } = require("../../lib/townconfig");
const { loadCode } = require("../../lib/codestore");
const { loadGis } = require("../../lib/gis");
const { loadServices, createServiceTools } = require("../../lib/services");
const { isEmergency, namedDesk, runTurn } = require("../../lib/desk");
const { fillFields, missingRequired, pinText } = require("../../lib/servicedesk");
const { openStore } = require("../../lib/store");
const prompts = require("../../lib/prompts");
const certified = require("../../lib/certified");
const review = require("../../lib/review");

const town = loadTown("trust-city");
const code = loadCode(town);
const gis = loadGis(town);
const services = loadServices(town);

test("every department desk is live and has services", () => {
  for (const d of town.departments) {
    assert.equal(d.live, true, d.id);
    if (!["front_desk", "planning"].includes(d.id)) assert.ok(services.forDepartment(d.id).length >= 3, d.id);
  }
});

test("the catalog only cites real code sections, real departments and listed sources", () => {
  const depts = new Set(town.departments.map((d) => d.id));
  const sources = new Set(services.sources.map((s) => s.id));
  for (const s of services.services) {
    assert.ok(depts.has(s.department), s.id);
    for (const id of s.sections) assert.ok(code.getSection(id), `${s.id}: section ${id}`);
    assert.ok(s.sources.length, `${s.id} has no source`);
    for (const id of s.sources) assert.ok(sources.has(id), `${s.id}: source ${id}`);
    assert.ok(s.fields.some((f) => f.auto === "name" && f.required), `${s.id} asks who is writing`);
    assert.ok(s.review_points.length, `${s.id} has review points`);
    if (s.location === "pin") assert.ok(s.fields.some((f) => f.auto === "location"), `${s.id} has a location field`);
    if (s.kind === "report") assert.equal(s.signature, false, `${s.id}: a report needs no signature`);
  }
});

test("the sources list is honest: every entry is complete, and an open license is claimed only where confirmed", () => {
  for (const s of services.sources) {
    assert.match(s.url, /^https?:\/\//, s.id);
    for (const k of ["government", "title", "kind", "how_used"]) assert.ok(s[k], `${s.id}: ${k}`);
    assert.ok(!/colorado city|short creek/i.test(JSON.stringify(s)), `${s.id} must not use material from another project`);
    if (s.license) assert.match(s.government, /UGRC/, `${s.id}: only UGRC's license has been confirmed`);
  }
  assert.ok(services.sources.some((s) => /Hildale/.test(s.government)), "the real town is named");
});

test("samples never pose as law: the desk tool labels them, and the model is told not to quote them", () => {
  const [read, search] = createServiceTools(services);
  const out = read.handler({ id: "burn_permit" });
  assert.match(out.sample.label, /SAMPLE/);
  assert.match(out.sample.label, /not law/);
  assert.deepEqual(out.real_code_sections, ["91-80", "91-81"]);
  assert.ok(search.handler({ query: "pothole in the road" }).results.some((r) => r.id === "road_hazard"));
  assert.match(prompts.rules(town), /never quote or cite one as code/);
});

test("danger right now is caught in plain code", () => {
  for (const t of ["My neighbor's house is on fire!", "I smell gas in the kitchen", "there's a gas leak", "he's not breathing", "someone is breaking in", "a power line is down, downed lines everywhere", "she's having a stroke"]) assert.ok(isEmergency(t), t);
  for (const t of ["I need a burn permit for my weeds", "I need a fire alarm inspection", "A hydrant flow test please", "Can I keep a rooster?", "My water bill is high", "gas bill question", "There's a pothole on my street"]) assert.equal(isEmergency(t), false, t);
});

test("an emergency gets the fixed 911 line with no model call", async () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "cc-"));
  const store = openStore(dir, { refPrefix: "TC" });
  const { ref } = store.createSession({ town: town.id, text: "My house is on fire!" });
  const client = { complete() { throw new Error("no model may run"); }, runTools() { throw new Error("no model may run"); } };
  const s = await runTurn(ref, { store, client, town, code, gis, tools: [], services, deskTools: [], model: "x" });
  const last = s.messages[s.messages.length - 1];
  assert.equal(last.emergency, true);
  assert.equal(last.text, town.wording.emergency);
  assert.match(last.text, /call 911/);
  assert.equal(s.busy, false);
  store.db.close();
});

test("a form keeps the catalog's fields, whatever labels the model sends back", () => {
  const svc = services.get("burn_permit");
  const fields = fillFields(svc, [{ label: "Size of the pile (required)", value: "3 feet" }, { label: "What will be burned", value: "weeds" }, { label: "Secret extra field", value: "x" }], { understanding: { applicant: { name: "Dana", phone: "", email: "" } }, parcel: { address: "345 E JESSOP AVE", id: "HD-1" }, pin: null });
  assert.deepEqual(fields.map((f) => f.label), svc.fields.map((f) => f.label));
  const get = (l) => fields.find((f) => f.label === l);
  assert.equal(get("Size of the pile").value, "3 feet");
  assert.equal(get("What will be burned?").value, "weeds");
  assert.equal(get("Your name").value, "Dana");
  assert.equal(get("Burn location").source, "parcel_record");
  assert.ok(missingRequired({ fields }).includes("Planned date"));
  assert.ok(!missingRequired({ fields }).includes("Email"));
});

test("a map pin finds the closest street and address, and stays inside the city", () => {
  const [lon, lat] = gis.townCenter;
  assert.equal(gis.inCity(lon, lat), true);
  assert.equal(gis.inCity(-111.9, 40.7), false);
  const near = gis.nearest(lon, lat);
  assert.ok(near.address && near.road, JSON.stringify(near));
  const svg = gis.renderSvg({ center: [lon, lat], meters: 300, width: 1000, height: 750, pin: [lon, lat] });
  assert.match(svg, /class="pin"/);
  assert.match(svg, /class="roads"/);
  assert.match(pinText({ lon, lat, road: "UTAH AVE", address: "1 Main", note: "by the mailbox" }), /UTAH AVE.*by the mailbox/);
  const box = gis.viewBox([lon, lat], 300, 1000, 750);
  assert.ok(box[0] < lon && box[2] > lon && box[1] < lat && box[3] > lat);
});

test("the information page names the example city's sources and has its three tabs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "public", "about.html"), "utf8");
  assert.match(html, /This is an example city/);
  assert.match(html, /works the way a real city would/);
  assert.match(html, /Hildale, Utah/);
  for (const id of ["tab-about", "tab-sources", "tab-qa"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.doesNotMatch(html, /style="/, "the page's security policy blocks inline styles");
});

test("a certified question is its own thing: wanted on request, never for a verification letter", () => {
  const u = { request_kind: "question", wants_certified_question: false };
  assert.equal(certified.wanted("Send a certified question", u), true);
  assert.equal(certified.wanted("how many hens can I have?", u), false);
  assert.equal(certified.wanted("how many?", { ...u, wants_certified_question: true }), true);
  assert.equal(certified.wanted("certified answer please", { request_kind: "verification_letter", wants_certified_question: true }), false);
});

test("staff's marks choose the certified answer, and nothing is answered until the review is done", () => {
  const s = (states) => ({ status: "submitted", packet: { packet_type: "certified_question" }, review: { considerations: [{ id: "a" }, { id: "b" }], states } });
  assert.equal(review.deriveDecision(s({ a: { state: "met" }, b: { state: "not_applicable" } })).decision, "certified_yes");
  assert.equal(review.deriveDecision(s({ a: { state: "met" }, b: { state: "not_met" } })).decision, "certified_no");
  assert.equal(review.deriveDecision(s({ a: { state: "met" }, b: { state: "cannot_verify" } })).decision, "request_info");
  assert.equal(review.deriveDecision(s({ a: { state: "met" } })).decision, "request_info");
  assert.ok(review.DECISIONS.certified_yes && review.DECISIONS.certified_no);
});

test("a plain question gets information and the certified offer, never a zoning verification", async () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "cc-"));
  const store = openStore(dir, { refPrefix: "TC" });
  const { ref } = store.createSession({ town: town.id, text: "How many hens can I keep at 595 E 1400 N?" });
  store.updateSession(ref, { department: "planning", character: "Juniper" });
  const parsed = {
    understanding: { turn_kind: "new_request", request_kind: "question", summary: "hens", proposal: { what: "hens", use_or_structure: "", numbers: [] }, location: { address_text: "595 E 1400 N", parcel_id_text: "", is_own_property: true }, applicant: { name: "", phone: "", email: "" }, questions_asked: [], change_instruction: "", wants_certified_question: false },
    research: { use_status: "permitted", use_table_row: "", applicable_sections: [{ section: "152-37-15", quote: "", why: "animal points" }], standards: [], process_tier: "none", process_explanation: "The section sets animal points.", required_applications: [], path_if_blocked: "", other_departments: [], considerations: [], missing_information: [] },
    reply: { reply: "Section 152-37-15 sets animal points for your lot.", questions: [] },
  };
  const client = {
    complete: async ({ schemaName }) => { if (!parsed[schemaName]) throw new Error("unexpected model step: " + schemaName); return { parsed: JSON.parse(JSON.stringify(parsed[schemaName])), model: "x" }; },
    runTools: async () => ({ transcript: [], toolLog: [], rounds: 1 }),
  };
  const s = await runTurn(ref, { store, client, town, code, gis, tools: [], services, deskTools: [], model: "x" });
  const last = s.messages[s.messages.length - 1];
  assert.equal(s.packet, null, "no paperwork for a question");
  assert.deepEqual(last.quick_replies, [certified.OFFER, "No thanks, that's all"]);
  store.db.close();
});

test("a request that names its desk goes there, unless the resident asks about zoning", () => {
  assert.equal(namedDesk("How much are the sewer impact fees for a new house?"), "utilities");
  assert.equal(namedDesk("Actually, can you tell me about my water bill instead?"), "utilities");
  assert.equal(namedDesk("I want to open a bakery and need a business license."), "recorder");
  assert.equal(namedDesk("Can I get a business license in this zone?"), null);
  assert.equal(namedDesk("I need a burn permit"), null);
});

test("nothing reads as a real city's act: sample forms, demo letters, AI labels", () => {
  assert.doesNotMatch(JSON.stringify(town.office), /Newel/, "no real city hall on the sample forms");
  assert.match(town.office.formFooter, /no effect in any real city/);
  assert.match(town.wording.letterNotice, /no legal effect/);
  for (const d of town.departments) assert.doesNotMatch(d.role, /officer|chief|official|lead/i, d.id + " is an AI desk, not a person in office");
  const server = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  assert.match(server, /town\.wording\.letterNotice/, "every sent letter carries the notice");
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "public", "resident.js"), "utf8");
  assert.match(page, /"AI assistant · "/);
});

test("the phone app stays out of the desktop site and out of people's data", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
  for (const page of ["index.html", "staff.html"]) assert.match(read(page), /phone\.css[^>]*media="\(max-width: 700px\)/, page + " loads phone styles on phone-sized screens only");
  assert.match(read("app.css"), /\.phone-only \{ display: none; \}/, "phone parts are hidden on desktop");
  const sw = read("sw.js").replace(/^\/\/.*$/gm, "");
  assert.doesNotMatch(sw, /cache\.put|\/api/, "the service worker never stores conversations");
  const app = JSON.parse(read("manifest.webmanifest"));
  assert.equal(app.display, "standalone");
  for (const i of app.icons) assert.ok(fs.existsSync(path.join(__dirname, "..", "..", i.src)), i.src);
  assert.ok(app.icons.some((i) => i.purpose === "maskable"));
  assert.match(read("offline.html"), /call 911/);
  assert.doesNotMatch(read("offline.html"), /style="/);
  const js = read("resident.js");
  assert.match(js, /!state\.lockOnce && !isPhone\(\)/, "only a phone stops the screen changing by itself");
  assert.match(js, /is a public demo/, "the phone start screen keeps the public demo notice");
  assert.match(js, /18 or older/, "the phone start screen keeps the age notice");
  assert.match(js, /AI assistants/, "the phone start screen keeps the AI notice");
});

test("lot splits and other site work ask for a drawing, and the site can only frame itself", () => {
  for (const id of ["lot_split", "accessory_dwelling_unit"]) assert.equal(town.applicationTypes[id].sketch, true, id);
  assert.match(town.wording.askSketch, /draw one here, or upload/);
  assert.ok(services.get("building_permit").sketch);
  const { securityHeaders } = require("../../lib/security");
  const h = {};
  securityHeaders({ setHeader: (k, v) => { h[k] = v; } }, true);
  assert.match(h["Content-Security-Policy"], /frame-ancestors 'self'/);
  assert.equal(h["X-Frame-Options"], "SAMEORIGIN");
  for (const d of town.departments) if (d.id !== "front_desk") assert.ok(d.short, d.id + " has a short name for the directory");
});

test("the dashes of one dashed line become one outline; separate lines stay separate", () => {
  const { joinDashes } = require("../../lib/segment");
  const dash = (x, y) => ({ label: "dashed line", x1: x, y1: y, x2: x + 20, y2: y + 6, confidence: 0.5 });
  const house = { label: "rectangle outline", x1: 10, y1: 10, x2: 200, y2: 200, confidence: 0.7 };
  const out = joinDashes([house, dash(100, 300), dash(130, 300), dash(160, 301), dash(100, 700)], 1000);
  assert.equal(out.filter((o) => o.label === "dashed line").length, 2);
  assert.ok(out.includes(house));
  const line = out.find((o) => o.label === "dashed line" && o.y1 === 300);
  assert.equal(line.x1, 100);
  assert.equal(line.x2, 180);
});

// ---------- the concept site plan ----------
const siteplan = require("../../lib/siteplan");
const { zoneSetbacks } = require("../../lib/tools");
const facts = { city: "Trust City", title: "Test", ref: "TC-1", notice: town.wording.planNotice };
const parcelOf = (address) => gis.locate({ address }).parcel;
const planFor = (o) => siteplan.build({ frame: () => siteplan.parcelFrame(gis, o.parcel), facts, ...o });

test("site plan: setbacks come from the right headings of the real tables, and odd values stay out", () => {
  const t = (zone) => zoneSetbacks(code.getSection(town.zones[zone].standardsSection).text, zone);
  assert.deepEqual([t("R1-10").front, t("R1-10").rear, t("R1-10").side, t("R1-10").street], [25, 20, 10, 20]);
  assert.deepEqual([t("R1-8").front, t("R1-8").rear, t("R1-8").side], [25, 10, 10]);
  const ra = t("RA-1");
  assert.equal(ra.front, 25); assert.equal(ra.rear, 30);
  assert.equal(ra.side, null, "'10 feet one side and 20 feet other side' is not one number");
  assert.ok(ra.skipped.includes("interior side"));
});

test("site plan: the ruler test. Measuring the drawing gives back the feet", () => {
  const plan = siteplan.build({ parcel: null, facts, extraction: { lot: { width_ft: 100, depth_ft: 120 }, lines: [], structures: [{ name: "House", status: "existing", width_ft: 40, depth_ft: 30, from_front_ft: 25, from_left_ft: 20, from_rear_ft: null, from_right_ft: null }] } });
  assert.equal(plan.conflicts.length, 0);
  const inch = siteplan.PER_INCH / plan.perFoot;
  assert.equal(inch, plan.feetPerInch);
  const s = plan.structures[0];
  assert.equal(s.w, 40); assert.equal(s.d, 30);
  assert.equal(Math.round(s.dist.front.value), 25);
  assert.equal(Math.round(s.dist.left.value), 20);
  assert.equal(Math.round(s.dist.rear.value), 65, "120 deep less 25 less 30");
  assert.equal(Math.round(s.dist.right.value), 40, "100 wide less 20 less 40");
  const svg = siteplan.renderSvg(plan);
  assert.match(svg, /width="10in" height="7\.5in" viewBox="0 0 1000 750"/, "100 drawing units are one real inch");
  const m = svg.match(/<path d="M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)L[\d. L]+Z" fill="#e6ebf2"/);
  assert.ok(m, "the house is drawn");
  assert.equal(Math.round(((Number(m[3]) - Number(m[1])) / 100) * plan.feetPerInch), 40, "a ruler on the page reads 40 feet");
  assert.match(svg, new RegExp("1 inch = " + plan.feetPerInch + " feet"));
  assert.match(svg, /NOT A SURVEY/);
  assert.match(svg, /no legal effect/);
  assert.doesNotMatch(svg, /meets the|is compliant|approved/i);
});

test("site plan: numbers that can't all be true become questions, and answers settle them", () => {
  const parcel = parcelOf("345 E Jessop Ave");
  const extraction = { lot: { width_ft: 200, depth_ft: 110 }, lines: [], structures: [] };
  let plan = planFor({ parcel, extraction });
  const c = plan.conflicts.find((x) => x.id === "lot-size");
  assert.ok(c && plan.open === 1, "22,000 sq ft against about 42,000 on the record");
  assert.equal(plan.lotSource, "parcel");
  plan = planFor({ parcel, extraction, answers: { "lot-size": "mine" } });
  assert.equal(plan.open, 0);
  assert.equal(plan.lotSource, "given");
  assert.equal(Math.round(plan.area), 22000);
  const tight = siteplan.build({ parcel: null, facts, extraction: { lot: { width_ft: 60, depth_ft: 100 }, lines: [], structures: [{ name: "Shop", status: "proposed", width_ft: 50, depth_ft: 20, from_left_ft: 20, from_right_ft: 20, from_front_ft: 10, from_rear_ft: null }] } });
  assert.ok(tight.conflicts.some((x) => x.id === "fit-w-0"), "20 + 50 + 20 does not fit in 60");
  const fixed = siteplan.build({ parcel: null, facts, answers: { values: { "s0.from_right_ft": null, "s0.from_left_ft": 5 } }, extraction: { lot: { width_ft: 60, depth_ft: 100 }, lines: [], structures: [{ name: "Shop", status: "proposed", width_ft: 50, depth_ft: 20, from_left_ft: 20, from_right_ft: 20, from_front_ft: 10, from_rear_ft: null }] } });
  assert.ok(!fixed.conflicts.some((x) => x.id === "fit-w-0"));
});

test("site plan: a number counts as given only if the resident wrote it", () => {
  const out = siteplan.keepStated({ lot: { width_ft: "100", depth_ft: "999" }, structures: [{ name: "House", width_ft: "40", depth_ft: "77", from_front_ft: "", from_rear_ft: "", from_left_ft: "", from_right_ft: "" }], proposed_lines: [] }, new Set(["100", "40"]));
  assert.equal(out.lot.width_ft, 100);
  assert.equal(out.lot.depth_ft, null, "the model's invented depth is dropped");
  assert.equal(out.structures[0].width_ft, 40);
  assert.equal(out.structures[0].depth_ft, null);
});

test("site plan: a pad sketch keeps exact positions, in feet, on the real lot", () => {
  const parcel = parcelOf("345 E Jessop Ave");
  // A map 200 m tall on a 1000 x 750 picture, shown on a 1200 x 900 canvas: 100 canvas pixels are 200/900*100 m.
  const map = { meters: 100, svg: [1000, 750], box: [0, 0, 1200, 900] };
  const feetPerPx = (200 / 900) * 3.28084;
  const marks = { map, items: [{ type: "box", a: [560, 400], b: [640, 500] }, { type: "line", a: [450, 450], b: [750, 450], dash: true }, { type: "label", text: "Shed", x: 600, y: 450 }] };
  const plan = planFor({ parcel, marks });
  const shed = plan.structures[0];
  assert.equal(shed.name, "Shed");
  assert.ok(Math.abs(Math.hypot(shed.poly[1][0] - shed.poly[0][0], shed.poly[1][1] - shed.poly[0][1]) - 80 * feetPerPx) < 0.5, "drawn size comes through exactly");
  assert.ok(Math.abs(plan.lines[0].len - 300 * feetPerPx) < 0.5);
  assert.equal(plan.lines[0].proposed, true);
  const label = planFor({ parcel, marks: { map, items: [{ type: "line", a: [450, 450], b: [750, 450], dash: true }, { type: "label", text: "Lot line, 500 ft", x: 600, y: 455 }] } });
  assert.ok(label.conflicts.some((x) => /your label and drawing differ/.test(x.title)), "a label far from the drawn length is a question");
});

test("site plan: no schema or drawing gives a verdict", () => {
  assert.doesNotMatch(JSON.stringify(prompts.SITE_PLAN_SCHEMA), /"recommend|"approve|"score"|complies|compliant/i);
  const plan = siteplan.build({ parcel: null, facts, setbacks: { front: 25, rear: 20, side: 10, section: "section 152-13-4", note: "" }, extraction: { lot: { width_ft: 100, depth_ft: 120 }, lines: [], structures: [] } });
  assert.equal(plan.setbacks.length, 4);
  const words = siteplan.renderSvg(plan).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(words, /not a finding that anything complies/);
});

test("site plan: printing goes through a page that fixes the size in real inches", () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "public", f), "utf8");
  assert.match(read("plan-print.css"), /@page \{ size: 11in 8\.5in/);
  assert.match(read("plan-print.css"), /#plan \{[^}]*width: 10in; height: 7\.5in/);
  assert.match(read("resident.js"), /\/site-plan\?ref=/);
  assert.doesNotMatch(read("plan-print.html"), /style="/);
});

test("a sketch over the map: the first view's middle is the middle of the lot, and layers turn on and off", () => {
  const { padToFeet } = require("../../lib/siteplan");
  const toFeet = padToFeet({ meters: 53, svg: [1200, 900], box: [0, 0, 1200, 900] });
  assert.deepEqual(toFeet([600, 450]).map((n) => Math.round(Math.abs(n))), [0, 0]);
  // 450 pixels up from the middle is the top of the view: 53 meters is about 174 feet.
  assert.equal(Math.round(toFeet([600, 0])[1]), 174);

  const { loadGis } = require("../../lib/gis");
  const gis = loadGis(town);
  const parcel = gis.locate({ address: "345 E Jessop" }).parcel;
  const view = { center: parcel.centroid, meters: 53, width: 1200, height: 900, parcelId: parcel.id };
  const none = gis.renderSvg({ ...view, layers: [] });
  assert.doesNotMatch(none, /data-zone=/);
  assert.doesNotMatch(none, /class="roads"/);
  assert.match(none, /class="target"/, "their lot is always outlined");
  assert.match(gis.renderSvg({ ...view, layers: ["zoning"] }), /data-zone=/);
  assert.match(gis.renderSvg({ ...view, layers: ["streets"] }), /class="roads"/);
  const photo = gis.renderSvg({ ...view, layers: ["parcels"], photo: "Aerial credit" });
  assert.doesNotMatch(photo, /fill="#f4f1ea"/, "the aerial picture must show through");
  assert.match(photo, /Aerial credit/);
});
