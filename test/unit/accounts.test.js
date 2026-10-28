// Resident accounts and working after submission. Boots the real server with NO Meta key and a temp data folder.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { openStore } = require("../../lib/store");

const PORT = 4100 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
let child;
let dir;

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
}
const post = (p, body, cookie) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (p, cookie) => fetch(BASE + p, { headers: cookie ? { cookie } : {} });
const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];
async function settled(ref, key) {
  for (let i = 0; i < 40; i++) {
    const s = await (await get(`/api/sessions/${ref}?key=${key}`)).json();
    if (!s.busy) return s;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("session stayed busy");
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-acct-"));
  child = spawn(process.execPath, [path.join(__dirname, "..", "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, MODEL_API_KEY: "", STAFF_PASSCODE: "test-passcode-123", COOKIE_SECRET: "0123456789abcdef0123456789abcdef", DAILY_CALL_CAP: "5" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  await waitForServer();
});
test.after(() => {
  if (child) child.kill();
});

test("a resident can create an account, sign in, and see their visits; the key still works without an account", async () => {
  let r = await post("/api/resident/signup", { email: "pat@example.com", password: "longenough1", password2: "different1" });
  assert.equal(r.status, 400, "mismatched passwords are refused");
  r = await post("/api/resident/signup", { email: "not-an-email", password: "longenough1", password2: "longenough1" });
  assert.equal(r.status, 400);
  r = await post("/api/resident/signup", { name: "Pat", email: "Pat@Example.com", password: "longenough1", password2: "longenough1" });
  assert.equal(r.status, 201);
  const cookie = cookieOf(r);
  assert.match(cookie, /^cc_resident=/);
  r = await post("/api/resident/signup", { email: "pat@example.com", password: "longenough1", password2: "longenough1" });
  assert.equal(r.status, 409, "duplicate email");
  r = await post("/api/resident/login", { email: "pat@example.com", password: "wrongwrong" });
  assert.equal(r.status, 401);
  r = await post("/api/resident/login", { email: "pat@example.com", password: "longenough1" });
  assert.equal(r.status, 200);
  const me = await (await get("/api/resident/me", cookie)).json();
  assert.equal(me.signed_in, true);
  assert.equal(me.email, "pat@example.com");
  assert.equal(me.visits.length, 0);
  // A visit started while signed in belongs to the account
  r = await post("/api/sessions", { text: "I want to build a fence." }, cookie);
  assert.equal(r.status, 202);
  const { ref, view_key } = await r.json();
  await settled(ref, view_key);
  const me2 = await (await get("/api/resident/me", cookie)).json();
  assert.equal(me2.visits.length, 1);
  assert.equal(me2.visits[0].ref, ref);
  assert.equal(me2.visits[0].view_key, view_key);
  // The reference + key still opens it with no account at all
  const anon = await (await get(`/api/sessions/${ref}?key=${view_key}`)).json();
  assert.equal(anon.ref, ref);
  assert.equal(anon.linked_to_account, true);
  assert.equal(anon.resident_id, undefined, "account ids are not exposed");
  // A visit started anonymously is attached when opened while signed in
  r = await post("/api/sessions", { text: "Can I keep chickens?" });
  const second = await r.json();
  await settled(second.ref, second.view_key);
  const before = await (await get("/api/resident/me", cookie)).json();
  assert.equal(before.visits.length, 1);
  await get(`/api/sessions/${second.ref}?key=${second.view_key}`, cookie);
  const after = await (await get("/api/resident/me", cookie)).json();
  assert.equal(after.visits.length, 2);
  // Sign out
  r = await post("/api/resident/logout", {}, cookie);
  assert.equal(cookieOf(r), "cc_resident=", "sign-out clears the cookie");
  const out = await (await get("/api/resident/me")).json();
  assert.equal(out.signed_in, false);
});

test("after submitting, the resident can keep editing and talking; the application is resubmitted as an update", async () => {
  let r = await post("/api/sessions", { text: "I want to split my lot." });
  const { ref, view_key } = await r.json();
  await settled(ref, view_key);
  // Give the session a packet and parcel directly (no model in tests).
  const store = openStore(dir);
  store.updateSession(ref, {
    status: "ready",
    error: null,
    parcel: { id: "HD-TEST-1", address: "1 Test St", zone: "R1-8" },
    packet: { packet_type: "application_set", title: "Lot split", one_line_summary: "x", documents: [{ doc_type: "lot_split", name: "Lot split", section: "152-39-4", fields: [{ label: "Phone", value: "", source: "blank" }], narrative: "Hello", code_basis: [] }], process_summary: "", reply: "", questions: [] },
  });
  store.close();
  r = await post(`/api/sessions/${ref}/submit?key=${view_key}`, {});
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, "submitted");
  // Editing the paperwork after submission is allowed and flags the change
  r = await post(`/api/sessions/${ref}/packet?key=${view_key}`, { documents: [{ fields: [{ value: "435-555-0100" }], narrative: "Hello again" }] });
  assert.equal(r.status, 200);
  let s = await (await get(`/api/sessions/${ref}?key=${view_key}`)).json();
  assert.equal(s.status, "submitted");
  assert.equal(s.changed_since_submit, true);
  assert.equal(s.packet.documents[0].fields[0].value, "435-555-0100");
  // Resubmit sends the update
  r = await post(`/api/sessions/${ref}/submit?key=${view_key}`, {});
  j = await r.json();
  assert.equal(j.resubmit_count, 1);
  s = await (await get(`/api/sessions/${ref}?key=${view_key}`)).json();
  assert.equal(s.changed_since_submit, false);
  assert.equal(s.resubmit_count, 1);
  assert.match(s.messages[s.messages.length - 1].text, /Resubmitted/);
  // Submitting again with nothing changed is a no-op
  j = await (await post(`/api/sessions/${ref}/submit?key=${view_key}`, {})).json();
  assert.equal(j.unchanged, true);
  // Talking after submission is allowed; the staff-facing status is kept even though the desk (no key) fails
  r = await post(`/api/sessions/${ref}/messages?key=${view_key}`, { text: "Also, the back lot will be 20,000 square feet." });
  assert.equal(r.status, 202);
  s = await settled(ref, view_key);
  assert.equal(s.status, "submitted", "status stays as staff last saw it");
  assert.equal(s.changed_since_submit, true);
  // Staff see the flags in the queue
  const login = await post("/api/staff/login", { passcode: "test-passcode-123" });
  const staffCookie = cookieOf(login);
  const q = await (await get("/api/staff/queue", staffCookie)).json();
  const row = q.sessions.find((x) => x.ref === ref);
  assert.equal(row.resubmit_count, 1);
  assert.equal(row.changed_since_submit, true);
});
