"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeFacts, buildFields, LEGALITY_RE, numbersIn, nextStepsText } = require("../../lib/pipeline");
const { findGaps } = require("../../lib/agent");
const prompts = require("../../lib/prompts");

test("normalizeFacts always yields all 18 items in order and demotes empty 'given' values", () => {
  const facts = normalizeFacts({ items: [{ id: "CL-04", status: "given", value: "SC-1", source: "", note: "" }, { id: "CL-01", status: "given", value: "   ", source: "", note: "" }], resident_questions: [], summary: "" });
  assert.equal(facts.items.length, 18);
  assert.equal(facts.items[0].id, "CL-01");
  assert.equal(facts.items[0].status, "missing");
  assert.equal(facts.items[3].status, "given");
  assert.ok(facts.items.every((i) => ["given", "unclear", "missing"].includes(i.status)));
});

test("findGaps is pure code over the facts", () => {
  const facts = normalizeFacts({ items: prompts.ITEM_IDS.map((id) => ({ id, status: id === "CL-09" ? "unclear" : "given", value: "x", source: "", note: "" })), resident_questions: [], summary: "" });
  const g = findGaps(facts);
  assert.deepEqual(g.missing, []);
  assert.deepEqual(g.unclear, ["CL-09"]);
  assert.equal(g.ready_to_file, false);
  const all = normalizeFacts({ items: prompts.ITEM_IDS.map((id) => ({ id, status: "given", value: "x", source: "", note: "" })), resident_questions: [], summary: "" });
  assert.equal(findGaps(all).ready_to_file, true);
});

test("buildFields leaves blanks for anything not given", () => {
  const facts = normalizeFacts({ items: [{ id: "CL-01", status: "given", value: "Dana", source: "", note: "" }, { id: "CL-02", status: "unclear", value: "555", source: "", note: "two numbers" }], resident_questions: [], summary: "" });
  const f = buildFields(facts);
  assert.equal(f[0].value, "Dana");
  assert.equal(f[1].blank, true);
  assert.equal(f[1].blank_reason, "needs clarification");
  assert.equal(f[2].blank_reason, "not provided");
});

test("legality questions are caught by the fallback regex", () => {
  assert.ok(LEGALITY_RE.test("Is this allowed?"));
  assert.ok(LEGALITY_RE.test("Will it be approved by the town?"));
  assert.ok(LEGALITY_RE.test("is it legal to split"));
  assert.ok(!LEGALITY_RE.test("I want to split my lot into two."));
});

test("numbersIn strips commas and finds decimals", () => {
  assert.deepEqual([...numbersIn("12,000 sq ft and 0.5 acre, section 12.03")].sort(), ["0.5", "12.03", "12000"].sort());
});

test("nextStepsText never claims a decision", () => {
  const ready = nextStepsText({ ready_to_file: true, missing_count: 0, unclear_count: 0 });
  const notReady = nextStepsText({ ready_to_file: false, missing_count: 3, unclear_count: 1 });
  for (const t of [ready, notReady]) {
    assert.match(t, /Planning Commission/);
    assert.doesNotMatch(t, /\bapproved\b/i);
  }
});

test("no schema has a recommendation or approval field", () => {
  const all = JSON.stringify([prompts.FACTS_SCHEMA, prompts.CLASSIFY_SCHEMA, prompts.DRAFT_SCHEMA, prompts.GAPS_SCHEMA, prompts.PREREVIEW_SCHEMA, prompts.LETTER_SCHEMA]);
  assert.doesNotMatch(all, /"recommend|"approve|"approval|"score|"rating|"likelihood/i);
});
