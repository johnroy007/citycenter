// LIVE tests: real Meta API calls against the real Hildale code (roughly 10 to 25 cents per scenario).
// Run all:  npm run test:live
// Run some: SCENARIOS=fence-ok,lot-split-ok npm run test:live
// Skipped automatically when MODEL_API_KEY is not set.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const fs = require("fs");
const path = require("path");
require("../../lib/env").loadEnv();
const { loadTown } = require("../../lib/townconfig");
const { loadCode } = require("../../lib/codestore");
const { loadGis } = require("../../lib/gis");
const { createTools } = require("../../lib/tools");
const { openStore } = require("../../lib/store");
const { createClient } = require("../../lib/meta");
const { runTurn } = require("../../lib/desk");
const review = require("../../lib/review");

const HAVE_KEY = !!process.env.MODEL_API_KEY;
const only = (process.env.SCENARIOS || "").split(",").map((s) => s.trim()).filter(Boolean);
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "scenarios.json"), "utf8")).scenarios.filter((s) => !only.length || only.includes(s.id));

let ctx = null;
const usage = { calls: 0, p: 0, c: 0 };
if (HAVE_KEY) {
  const town = loadTown("hildale");
  const code = loadCode(town);
  const gis = loadGis(town);
  const { tools } = createTools({ code, gis, town });
  const store = openStore(fs.mkdtempSync(path.join(os.tmpdir(), "cc-live-")), { refPrefix: town.refPrefix });
  const client = createClient({
    onUsage: (u) => {
      usage.calls++;
      usage.p += u.prompt_tokens;
      usage.c += u.completion_tokens;
    },
  });
  ctx = { store, client, town, code, gis, tools, model: process.env.META_MODEL || "muse-spark-1.3" };
}
test.after(() => {
  if (HAVE_KEY) console.log(`live usage: ${usage.calls} calls, ${usage.p} in / ${usage.c} out tokens`);
});

const arr = (v) => (Array.isArray(v) ? v : [v]);
const lower = (o) => JSON.stringify(o).toLowerCase();

for (const sc of fixtures) {
  test(`${sc.id}: ${sc.title}`, { skip: !HAVE_KEY }, async () => {
    const { ref } = ctx.store.createSession({ town: "hildale", text: sc.text });
    let s = await runTurn(ref, ctx);
    const last = s.messages[s.messages.length - 1];
    if (last && last.role === "desk" && last.asks_consent) {
      // The front desk asks for consent before a hand-off; the resident says yes.
      ctx.store.addMessage(ref, { role: "resident", text: "Yes, please." });
      s = await runTurn(ref, ctx);
    }
    const e = sc.expect || {};
    const desk = s.messages.filter((m) => m.role === "desk");
    assert.ok(desk.length >= 1, "the desk replied");
    assert.notEqual(s.status, "error", s.error || "");
    const all = lower([s.packet, s.research, desk.map((m) => m.text)]);
    assert.doesNotMatch(all, /will be approved|will not be approved|you are approved|don't bother|no chance|guaranteed to|likely to be approved/, "no predictions");
    if (e.department) assert.ok(arr(e.department).includes(s.department), `department ${s.department} not in ${arr(e.department)}`);
    const routeStep = s.steps.find((x) => x.name === "route");
    if (e.zoning_implications != null && routeStep && routeStep.output) assert.equal(routeStep.output.zoning_implications, e.zoning_implications);
    if (e.offer_tell_me_more != null && routeStep && routeStep.output) assert.equal(routeStep.output.offer_tell_me_more, e.offer_tell_me_more);
    if (s.department !== "planning") return;
    const r = s.research;
    assert.ok(r, "research ran");
    if (e.request_kind) assert.ok(arr(e.request_kind).includes(s.understanding.request_kind), `request_kind ${s.understanding.request_kind}`);
    if (e.use_status) assert.ok(arr(e.use_status).includes(r.use_status), `use_status ${r.use_status}`);
    if (e.tiers) assert.ok(e.tiers.includes(r.process_tier), `tier ${r.process_tier} not in ${e.tiers}`);
    if (e.applications_any) assert.ok(r.required_applications.some((a) => e.applications_any.includes(a)), `applications ${r.required_applications} lack ${e.applications_any}`);
    if (e.sections_any) assert.ok(r.applicable_sections.some((x) => e.sections_any.some((id) => x.section.startsWith(id))), `sections ${r.applicable_sections.map((x) => x.section)} lack ${e.sections_any}`);
    if (e.standards_not_met_any) assert.ok(r.standards.some((x) => x.status === "does_not_meet"), "a standard should be does_not_meet: " + JSON.stringify(r.standards));
    if (e.path_if_blocked_mentions) assert.ok(e.path_if_blocked_mentions.some((w) => (r.path_if_blocked + r.process_explanation).includes(w)), `path/process should mention ${e.path_if_blocked_mentions}: ${r.path_if_blocked}`);
    assert.ok(r.applicable_sections.some((x) => x.quote_verified), "at least one verified quote: " + JSON.stringify(r.applicable_sections.map((x) => [x.section, x.quote_verified, x.quote_rejected])));
    assert.ok(s.packet && s.packet.documents.length >= 1, "a packet document exists");
    console.log(`  [${sc.id}] ${s.department} / ${s.understanding.request_kind} / ${r.use_status} / tier ${r.process_tier} / apps ${r.required_applications.join("+") || "-"} / parcel ${s.parcel ? s.parcel.id + " " + s.parcel.zone : "none"} / ${r.tool_log.length} tool calls / packet ${s.packet.packet_type}`);
  });
}

test("staff workspace: considerations, a question, and a letter for a lot split", { skip: !HAVE_KEY || (only.length && !only.includes("staff")) }, async () => {
  const sc = fixtures.find((x) => x.id === "lot-split-ok") || JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "scenarios.json"), "utf8")).scenarios.find((x) => x.id === "lot-split-ok");
  const { ref } = ctx.store.createSession({ town: "hildale", text: sc.text });
  await runTurn(ref, ctx);
  let s = ctx.store.getSession(ref);
  const cons = await review.buildConsiderations(ctx.client, s, { ...ctx });
  assert.ok(cons.considerations.length >= 5, "several considerations");
  assert.ok(cons.considerations.every((c) => ["consistent", "inconsistent", "cannot_verify", "not_applicable"].includes(c.document_reading)));
  assert.ok(cons.considerations.some((c) => c.quote_verified), "at least one verified quote");
  assert.doesNotMatch(lower(cons), /recommend (approval|denial)|should be approved|should be denied/);
  ctx.store.saveReview(ref, cons, cons.model);
  s = ctx.store.getSession(ref);
  const ans = await review.askStaff(ctx.client, s, { question: "What does the subdivision chapter require before staff can approve a one-lot split?", ...ctx });
  assert.ok(ans.answer.length > 40);
  assert.ok(ans.citations.some((c) => c.section.startsWith("152-39")), "cites chapter 39: " + JSON.stringify(ans.citations.map((c) => c.section)));
  ctx.store.setReviewState(ref, cons.considerations[0].id, { state: "met", note: "" });
  s = ctx.store.getSession(ref);
  const letter = await review.draftLetter(ctx.client, s, { decision: "request_info", staffNote: "Please bring the utility committee sign-off.", ...ctx });
  assert.ok(letter.subject && letter.body.length > 100);
  assert.match(letter.body, /utility/i);
  assert.doesNotMatch(letter.body, /\bapproved\b/i);
  console.log(`  [staff] ${cons.considerations.length} considerations (${cons.considerations.filter((c) => c.quote_verified).length} verified quotes), answer cites ${ans.citations.map((c) => c.section).join(", ")}`);
});
