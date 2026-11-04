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
