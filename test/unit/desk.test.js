"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const prompts = require("../../lib/prompts");
const { sanitizeReply, verifyCited, numbersIn, conversationText, parcelAsText, addressCandidates } = require("../../lib/desk");
const { createCodeStore } = require("../../lib/codestore");
const { zoneStandardsFromText, parseArea, createTools } = require("../../lib/tools");
const { ownerFor } = require("../../lib/owners");
const { loadTown } = require("../../lib/townconfig");
const { loadCode } = require("../../lib/codestore");
const { loadGis, createGis } = require("../../lib/gis");

const town = loadTown("hildale");

test("no schema has a recommendation, approval, score or likelihood field", () => {
  const all = JSON.stringify(prompts.ALL_SCHEMAS);
  assert.doesNotMatch(all, /"recommend|"approve|"approval|"score"|"rating|"likelihood|"odds/i);
});

test("predictive wording is removed from replies and the staff-decide line is added", () => {
  const t = sanitizeReply("Looks fine, this will be approved next week.", town);
  assert.doesNotMatch(t, /will be approved/);
  assert.match(t, /City Officials/i, "the staff-decide line is appended");
  assert.equal(sanitizeReply("The use table marks restaurants N in R1-8, so the code does not list the use there.", town).includes("[wording removed]"), false);
});

test("citations are verified against the stored code and unverifiable quotes are dropped", () => {
  const store = createCodeStore({ sections: [{ id: "1-1", title: "Fences", chapterName: "CH", text: "No fence shall exceed six feet (6') in height in a side yard.", url: "u" }] });
  const out = verifyCited(store, [
    { section: "1-1", quote: "No fence shall exceed six feet (6') in height in a side yard.", why: "a" },
    { section: "1-1", quote: "Fences may be any height.", why: "b" },
    { section: "9-9", quote: "x", why: "c" },
  ]);
  assert.equal(out[0].quote_verified, true);
  assert.equal(out[1].quote_verified, false);
  assert.equal(out[1].quote, "");
  assert.equal(out[1].quote_rejected, "Fences may be any height.");
  assert.equal(out[2].section_found, false);
});

test("numbersIn, conversationText and parcelAsText", () => {
  assert.deepEqual([...numbersIn("12,000 sq ft and 0.5 acre, section 152-37-9")].sort(), ["0.5", "12000", "152", "37", "9"].sort());
  const t = conversationText([{ role: "resident", text: "hi" }, { role: "desk", character: "Juniper", department: "planning", text: "hello" }]);
  assert.match(t, /RESIDENT: hi\nJUNIPER \(planning\): hello/);
  assert.match(parcelAsText(null), /not located/);
  assert.match(parcelAsText({ id: "HD-1", address: "1 Main", zone: "R1-8", zoneName: "Single", areaSqft: 10000, areaAcres: 0.23, zonesTouched: ["R1-8"], straddlesZones: false }, { name: "Jane Alder" }), /FICTIONAL/);
});

test("addressCandidates finds street addresses written mid-sentence and skips measurements", () => {
  const c = addressCandidates("Ryan Castillo here, 385 W Utah Ave. I'd like a 900 square foot guest house. Priya at 595 E 1400 N has 10 hens. Call 435-555-0101.");
  assert.ok(c.includes("385 W Utah Ave"), JSON.stringify(c));
  assert.ok(c.includes("595 E 1400 N"), JSON.stringify(c));
  assert.ok(!c.some((x) => /^900 square/.test(x)), JSON.stringify(c));
  const g = loadGis(town);
  assert.equal(g.locate({ address: c[0] }).parcel.zone, "R1-8");
});

test("fictional owners are deterministic and flagged", () => {
  const a = ownerFor("HD-178-A-1");
  assert.equal(a.fictional, true);
  assert.equal(a.name, ownerFor("hd-178-a-1").name);
  assert.notEqual(a.name, ownerFor("HD-178-A-2").name);
});

test("zone standards are read from the real standards tables and lot math compares against them", () => {
  const code = loadCode(town);
  const gis = loadGis(town);
  const { zoneStandards, tools } = createTools({ code, gis, town });
  const r18 = zoneStandards("R1-8");
  assert.equal(parseArea(r18.minimum_lot_area), 6400);
  assert.match(r18.minimum_lot_width, /70/);
  assert.match(r18.max_accessory_building_size, /500/);
  const ra1 = zoneStandards("RA-1");
  assert.equal(parseArea(ra1.minimum_lot_area), Math.round(0.8 * 43560));
  assert.match(ra1.minimum_lot_width, /100/);
  const lot = tools.find((t) => t.name === "lot_math").handler({ zone: "R1-8", current_area: "0.9 acre", proposed_areas: ["20,000 sq ft", "19,000 sq ft"], proposed_widths: ["100 ft", "60 ft"] });
  assert.match(lot.lots[0].area_vs_minimum, /at or above/);
  assert.match(lot.lots[1].width_vs_minimum, /below the 70 ft minimum by 10/);
  const pts = tools.find((t) => t.name === "animal_points").handler({ acres: 0.25, animals: [{ type: "chickens", count: 8 }, { type: "rooster", count: 1 }] });
  assert.equal(pts.points_allowed, 125);
  assert.equal(pts.points_used, 49);
  const zi = tools.find((t) => t.name === "zone_info").handler({ zone: "GC" });
  assert.match(zi.uses_table_excerpt, /Restaurant/);
  const lp = tools.find((t) => t.name === "lookup_parcel").handler({ address: "595 E 1400 N" });
  assert.equal(lp.parcel.zone, "RA-1");
  assert.equal(Object.keys(lp.parcel).some((k) => /owner/i.test(k)), false);
  // Same house number on another street must not count as a match.
  assert.equal(gis.locate({ address: "345 E Jessop Ave" }).match, "address");
  assert.equal(gis.locate({ address: "345 East Jessop Avenue, Hildale UT 84784" }).parcel.id, "HD-SHCR-9-1");
  assert.equal(gis.locate({ address: "1280 W Field Ave" }).parcel.zone, "M-1");
  assert.equal(gis.locate({ address: "865 N Redwood St" }).parcel.zone, "RA-.5");
  assert.equal(gis.locate({ address: "345 Jessop" }).match, "address", "direction and suffix are optional");
  assert.equal(gis.locate({ address: "999 Nowhere Rd" }).match, "none");
  const dup = createGis({ zoning: { features: [] }, parcels: { features: [1, 2].map((i) => ({ type: "Feature", properties: { id: "X-" + i, address: "10 MAIN ST" }, geometry: { type: "Polygon", coordinates: [[[-113 + i * 0.001, 37], [-113 + i * 0.001 + 0.0005, 37], [-113 + i * 0.001 + 0.0005, 37.0005], [-113 + i * 0.001, 37]]] } })) }, town });
  assert.equal(dup.locate({ address: "10 Main St" }).match, "ambiguous", "true duplicates stay ambiguous");
});

test("zoneStandardsFromText handles a header row that names the zones", () => {
  const rows = zoneStandardsFromText("Development Standard | R1-10 | R1-8\nMinimum lot area | 8,000 sq. ft. | 6,400 sq. ft.\nMinimum lot width | 80 ft. | 70 ft.", "R1-8");
  assert.deepEqual(rows, [{ standard: "Minimum lot area", value: "6,400 sq. ft." }, { standard: "Minimum lot width", value: "70 ft." }]);
});
