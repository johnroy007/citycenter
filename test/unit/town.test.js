"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const town = require("../../lib/town");

test("code and checklist load with the expected shape", () => {
  assert.equal(town.code.sections.length, 11);
  assert.equal(town.checklist.items.length, 18);
  for (const item of town.checklist.items) assert.ok(town.getSection(item.section), `checklist ${item.id} points at a real section`);
  assert.match(town.code.notice, /fictional/);
});

test("parseArea understands acres and square feet", () => {
  assert.equal(town.parseArea("10,000 sq ft"), 10000);
  assert.equal(town.parseArea("0.5 acre"), 21780);
  assert.equal(town.parseArea("1.2 acres"), 52272);
  assert.equal(town.parseArea("7500"), 7500);
  assert.equal(town.parseArea("2"), 87120); // bare small number = acres
  assert.equal(town.parseArea("the rest"), null);
});

test("computeLotSplit compares against district minimums and sums lots", () => {
  const r = town.computeLotSplit({ district: "R-1", currentArea: "22,000 sq ft", proposedAreas: ["12,000 sq ft", "10,000 sq ft"], frontages: ["109 ft", "91 ft"] });
  assert.equal(r.district_known, true);
  assert.equal(r.totals_match, true);
  assert.equal(r.lots[0].size_compared_to_minimum, "at or above minimum");
  assert.equal(r.lots[1].size_compared_to_minimum, "at or above minimum");
  const bad = town.computeLotSplit({ district: "R-1", currentArea: "0.5 acre", proposedAreas: ["12,000 sq ft", "9,780 sq ft"], frontages: ["70", "55"] });
  assert.match(bad.lots[1].size_compared_to_minimum, /below minimum by 220/);
  assert.match(bad.lots[1].frontage_compared_to_minimum, /below minimum by 5/);
  const unknown = town.computeLotSplit({ district: "R-9", currentArea: "", proposedAreas: [], frontages: [] });
  assert.equal(unknown.district_known, false);
  assert.equal(unknown.lot_count, 0);
});
