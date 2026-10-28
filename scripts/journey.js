// End-to-end journey over HTTP against a running server (local or the live site). Costs roughly 50 cents.
// Usage: node scripts/journey.js [http://localhost:3000] [staff-passcode]
// Resident: start a conversation, answer a follow-up, attach a drawing, submit. Staff: sign in, build considerations,
// ask a question, mark states, draft and save a letter. Resident sees the letter.
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();

const BASE = process.argv[2] || "http://localhost:3000";
const PASS = process.argv[3] || process.env.STAFF_PASSCODE || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(opts.headers || {}) } });
  const sc = res.headers.get("set-cookie");
  if (sc && sc.startsWith("cc_staff=") && !sc.includes("Max-Age=0")) cookie = sc.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${data.error || ""}`);
  return data;
}
async function waitIdle(ref, key) {
  for (let i = 0; i < 200; i++) {
    const s = await api(`/api/sessions/${ref}?key=${key}`);
    if (!s.busy) return s;
    await sleep(1500);
  }
  throw new Error("timed out waiting for the desk");
}
// The front desk asks for consent before a hand-off; answer yes like a resident would.
async function consentIfAsked(ref, key, s) {
  const last = s.messages[s.messages.length - 1];
  if (last && last.role === "desk" && last.asks_consent) {
    console.log(`  front desk: ${last.text.slice(0, 140)} -> resident: Yes, please.`);
    await api(`/api/sessions/${ref}/messages?key=${key}`, { method: "POST", body: JSON.stringify({ text: "Yes, please." }) });
    return waitIdle(ref, key);
  }
  return s;
}
const ok = (cond, msg) => {
  if (!cond) throw new Error("CHECK FAILED: " + msg);
  console.log("  ✓ " + msg);
};

(async () => {
  const t0 = Date.now();
  console.log(`Journey against ${BASE}`);
  const health = await api("/api/health");
  ok(health.ok && health.code_sections > 300, `health: ${health.code_sections} code sections, ${health.parcels} parcels`);

  // Resident: open with a building-permit framing that is really zoning
  let r = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: "I need a building permit for a mother-in-law suite." }) });
  const { ref, view_key: key } = r;
  let s = await waitIdle(ref, key);
  console.log(`  desk: ${s.messages.filter((m) => m.role === "desk").map((m) => m.character + ": " + m.text.slice(0, 160)).join(" | ")}`);
  ok(s.status !== "error", "first turn finished without error");
  const route = s.steps.find((x) => x.name === "route");
  ok(route && route.output && route.output.zoning_implications === true, "front desk flagged zoning implications");

  // Resident gives the details plus a drawing
  const sketch = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "sketch-clear.png")).toString("base64");
  await api(`/api/sessions/${ref}/messages?key=${key}`, { method: "POST", body: JSON.stringify({ text: "Sure. I'm Ryan Castillo at 455 E Jessop Ave, 435-555-0102. It would be attached to the house, about 650 square feet, with its own entrance. My mom would live there; we own the house and live in it. Here is a sketch of the lot.", image: { mime: "image/png", base64: sketch } }) });
  s = await consentIfAsked(ref, key, await waitIdle(ref, key));
  ok(s.department === "planning", `routed to planning (department ${s.department})`);
  ok(s.parcel && s.parcel.id, `parcel located: ${s.parcel && s.parcel.id} ${s.parcel && s.parcel.address} zone ${s.parcel && s.parcel.zone}`);
  ok(s.owner && s.owner.fictional, `fictional owner: ${s.owner && s.owner.name}`);
  const sk = s.steps.find((x) => x.name === "sketch");
  ok(sk && sk.status === "done" && sk.output.drawing_type, `drawing read as ${sk && sk.output && sk.output.drawing_type}`);
  ok(s.research && s.research.process_tier, `research tier ${s.research.process_tier}; apps ${s.research.required_applications.join(",") || "-"}; ${s.research.tool_log.length} tool calls`);
  ok(s.research.applicable_sections.some((x) => x.quote_verified), "a verified quote exists");
  ok(s.packet && s.packet.documents.length, `packet ${s.packet.packet_type}: ${s.packet.title} (${s.packet.documents.length} documents)`);
  console.log(`  planner: ${s.messages.filter((m) => m.role === "desk").pop().text.slice(0, 300)}`);

  // Resident asks for a change
  await api(`/api/sessions/${ref}/messages?key=${key}`, { method: "POST", body: JSON.stringify({ text: "Please change my phone number to 435-555-0177 in the application." }) });
  s = await waitIdle(ref, key);
  const u = s.steps.find((x) => x.name === "understand");
  console.log(`  change turn: turn_kind ${u && u.output && u.output.turn_kind}; planner: ${s.messages.filter((m) => m.role === "desk").pop().text.slice(0, 200)}`);
  ok(JSON.stringify(s.packet).includes("0177"), "the edit-by-telling landed in the packet");

  // Submit
  const unsigned = await fetch(`${BASE}/api/sessions/${ref}/submit?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  ok(unsigned.status === 409, "submit without a signature is refused");
  r = await api(`/api/sessions/${ref}/sign?key=${key}`, { method: "POST", body: JSON.stringify({ name: "Ryan Castillo", method: "typed", agree: true }) });
  ok(r.ok && r.method === "typed", "signed (typed)");
  r = await api(`/api/sessions/${ref}/submit?key=${key}`, { method: "POST", body: "{}" });
  ok(r.status === "submitted", "submitted");

  // Staff
  if (!PASS) {
    console.log("No staff passcode given; stopping before the staff side.");
    return;
  }
  await api("/api/staff/login", { method: "POST", body: JSON.stringify({ passcode: PASS }) });
  const q = await api("/api/staff/queue");
  ok(q.sessions.some((x) => x.ref === ref && x.status === "submitted"), "staff queue lists the submission");
  r = await api(`/api/staff/sessions/${ref}/considerations`, { method: "POST", body: "{}" });
  const cons = r.review.considerations;
  ok(cons.length >= 5, `${cons.length} considerations built (${cons.filter((c) => c.quote_verified).length} with verified quotes)`);
  for (const c of cons.slice(0, 6)) console.log(`    [${c.document_reading}] ${c.title} (${c.sections.join(", ")})`);
  const ask = await api(`/api/staff/sessions/${ref}/ask`, { method: "POST", body: JSON.stringify({ question: "What size limit applies to an attached accessory dwelling unit in this zone?", consideration_id: cons[0].id }) });
  ok(ask.answer.length > 30, `agent answered staff: ${ask.answer.slice(0, 200)}`);
  await api(`/api/staff/sessions/${ref}/consideration`, { method: "POST", body: JSON.stringify({ id: cons[0].id, state: "met" }) });
  await api(`/api/staff/sessions/${ref}/consideration`, { method: "POST", body: JSON.stringify({ add: { title: "Call the fire district about the second kitchen", how_to_verify: "Phone the Hildale Valley Fire District" } }) });
  let d = await api(`/api/staff/sessions/${ref}`);
  ok(d.review.states[cons[0].id].state === "met" && d.review.considerations.some((c) => c.added_by === "staff"), "states saved and a staff consideration added");
  r = await api(`/api/staff/sessions/${ref}/summary`, { method: "POST", body: "{}" });
  ok(r.submission_summary && r.submission_summary.bullets.length >= 3, `step 1 summary: ${r.submission_summary && r.submission_summary.bullets.length} bullets`);
  r = await api(`/api/staff/sessions/${ref}/code-summary`, { method: "POST", body: "{}" });
  ok(r.code_summary && r.code_summary.sections.length >= 1, `step 2 code summary: ${r.code_summary && r.code_summary.sections.length} sections, ${r.code_summary && r.code_summary.sections.filter((x) => x.quote_verified).length} verified quotes`);
  r = await api(`/api/staff/sessions/${ref}/letter/generate`, { method: "POST", body: JSON.stringify({ mode: "regenerate" }) });
  ok(r.letter && r.letter.subject, `letter generated (${r.letter && r.letter.decision}, auto: ${r.letter && r.letter.decision_auto}): ${r.letter && r.letter.subject}`);
  ok(r.letter.subject && r.letter.body.length > 100, `letter drafted: ${r.letter.subject}`);
  ok(!/\bapproved\b/i.test(r.letter.body), "letter does not claim an approval");
  r = await api(`/api/staff/sessions/${ref}/letter`, { method: "POST", body: JSON.stringify({ subject: r.letter.subject, body: r.letter.body, decision: "request_info" }) });
  ok(r.status === "needs_info", "letter saved; status needs_info");
  cookie = ""; // back to being the resident
  s = await api(`/api/sessions/${ref}?key=${key}`);
  ok(s.messages.some((m) => m.letter), "resident sees the letter in the conversation");
  ok(!s.review, "resident cannot see the staff review");
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s. Resident link: ${BASE}/?ref=${ref}&key=${key}`);
})().catch((e) => {
  console.error("JOURNEY FAILED:", e.message);
  process.exit(1);
});
