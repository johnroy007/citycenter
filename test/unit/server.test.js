// Boots the real server on a spare port with NO Meta key and a temp data folder, then checks routes, limits and auth.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

const PORT = 3900 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const PASS = "test-passcode-123";
let child;

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

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-srv-"));
  child = spawn(process.execPath, [path.join(__dirname, "..", "..", "server.js")], {
    // MODEL_API_KEY is set to empty on purpose: the .env loader never overrides a variable that already exists, so no real calls happen.
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, MODEL_API_KEY: "", TURNS_PER_HOUR: "1000", TURNS_PER_DAY: "1000", STAFF_PASSCODE: PASS, COOKIE_SECRET: "0123456789abcdef0123456789abcdef", DAILY_CALL_CAP: "5" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  await waitForServer();
});
test.after(() => {
  if (child) child.kill();
});

test("pages and static files come with security headers", async () => {
  const r = await fetch(BASE + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal((await fetch(BASE + "/staff")).status, 200);
  assert.equal((await fetch(BASE + "/public/app.css")).status, 200);
  assert.equal((await fetch(BASE + "/public/../server.js")).status, 404);
  assert.equal((await fetch(BASE + "/public/%2e%2e/server.js")).status, 404);
  assert.equal((await fetch(BASE + "/nope")).status, 404);
});

test("health, town, demo, map and code endpoints answer from the cached public data", async () => {
  const h = await (await fetch(BASE + "/api/health")).json();
  assert.equal(h.ok, true);
  assert.equal(h.staff_portal, true);
  assert.ok(h.code_sections > 300);
  const t = await (await fetch(BASE + "/api/town")).json();
  assert.equal(t.name, "Trust City");
  assert.ok(t.departments.find((d) => d.id === "planning"));
  assert.ok(t.zones["R1-8"]);
  const demo = await (await fetch(BASE + "/api/demo")).json();
  assert.ok(Array.isArray(demo.examples));
  const city = await fetch(BASE + "/api/map/city.svg");
  assert.equal(city.headers.get("content-type"), "image/svg+xml");
  assert.match(await city.text(), /<svg/);
  const look = await (await fetch(BASE + "/api/parcels/lookup?q=" + encodeURIComponent("250 E Newel Ave"))).json();
  assert.equal(look.match, "address");
  assert.equal(look.parcel.zone, "PF");
  assert.equal(look.parcel.owner, undefined, "no owner field exists");
  const pm = await fetch(BASE + "/api/map/parcel/" + encodeURIComponent(look.parcel.id) + ".svg");
  assert.equal(pm.status, 200);
  assert.match(await pm.text(), /class="target"/);
  assert.equal((await fetch(BASE + "/api/map/parcel/NOPE.svg")).status, 404);
  const sec = await (await fetch(BASE + "/api/code/sections/152-37-9")).json();
  assert.match(sec.title, /Fences/);
  const srch = await (await fetch(BASE + "/api/code/search?q=accessory+dwelling+unit")).json();
  assert.ok(srch.results.length > 0);
});

test("session validation: empty text, bad image, oversize body, bad audio", async () => {
  let r = await post("/api/sessions", { text: "" });
  assert.equal(r.status, 400);
  r = await post("/api/sessions", { text: "x".repeat(40), image: { mime: "image/png", base64: Buffer.from("nope").toString("base64") } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /real image/);
  r = await post("/api/sessions", { text: "x".repeat(40), image: { mime: "image/png", base64: "A".repeat(9 * 1024 * 1024) } });
  assert.equal(r.status, 413);
  r = await fetch(BASE + "/api/voice/transcribe", { method: "POST", body: Buffer.alloc(2000) });
  assert.equal(r.status, 400);
});

test("a session without an API key is accepted, ends in a clear error; reading needs the key; staff flow works", async () => {
  const r = await post("/api/sessions", { text: "I want to split my lot at 345 E Jessop Ave and sell half to my son." });
  assert.equal(r.status, 202);
  const { ref, view_key } = await r.json();
  assert.match(ref, /^TC-\d{4}-\d{4}$/);
  assert.equal((await fetch(`${BASE}/api/sessions/${ref}`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/sessions/${ref}?key=wrong`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/sessions/HC-1999-0001?key=x`)).status, 404);
  let s;
  for (let i = 0; i < 60; i++) {
    s = await (await fetch(`${BASE}/api/sessions/${ref}?key=${view_key}`)).json();
    if (!s.busy) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(s.status, "error");
  assert.match(s.error, /API key/);
  assert.equal(s.view_key, undefined, "view key is never echoed");
  assert.equal(s.review, undefined, "residents never see the staff review");
  assert.ok(s.messages.some((m) => m.role === "desk"), "the desk apologizes in the conversation");
  // Submitting without a packet is refused.
  assert.equal((await post(`/api/sessions/${ref}/submit?key=${view_key}`, {})).status, 400);

  // Staff: the workspace is open to everyone (no sign-in), but it never reveals a resident's visit code.
  const cookie = "";
  assert.equal((await fetch(BASE + "/api/staff/me")).status, 200);
  const qr = await fetch(BASE + "/api/staff/queue");
  assert.equal(qr.status, 200);
  const qText = await qr.text();
  assert.ok(JSON.parse(qText).sessions.length >= 1);
  assert.ok(!qText.includes(view_key), "the queue never contains a visit code");
  const dText = await (await fetch(`${BASE}/api/staff/sessions/${ref}`)).text();
  const detail = JSON.parse(dText);
  assert.equal(detail.ref, ref);
  assert.equal(detail.view_key, undefined);
  assert.equal(detail.resident_link, undefined);
  assert.ok(!dText.includes(view_key), "the staff view never contains the visit code");
  // Without the visit code nobody can read or act on the resident's side; only the drawing and signature images are open.
  assert.equal((await post(`/api/sessions/${ref}/messages`, { text: "hello" })).status, 403);
  assert.equal((await post(`/api/sessions/${ref}/submit`, {})).status, 403);
  assert.equal((await post(`/api/sessions/${ref}/sign`, { name: "Someone Else", method: "typed", agree: true })).status, 403);
  assert.equal((await fetch(`${BASE}/api/sessions/${ref}/sketch`)).status, 404, "no drawing on this visit, but not refused");
  assert.equal((await fetch(`${BASE}/api/sessions/${ref}/signature`)).status, 404, "no signature yet, but not refused");
  // The maintenance tools still need the passcode.
  assert.equal((await fetch(BASE + "/api/staff/diag")).status, 401);
  assert.equal((await post("/api/staff/purge-demo", {})).status, 401);
  let lr = await post("/api/staff/login", { passcode: "wrong" });
  assert.equal(lr.status, 401);
  lr = await post("/api/staff/login", { passcode: PASS });
  assert.equal(lr.status, 200);
  assert.match(lr.headers.get("set-cookie"), /HttpOnly/);
  // Building considerations needs the model: clean error, nothing corrupted.
  let cr = await post(`/api/staff/sessions/${ref}/considerations`, {}, cookie);
  assert.equal(cr.status, 500);
  assert.match((await cr.json()).error, /API key/);
  // Marking a state before considerations exist fails cleanly; saving a letter works without the model.
  cr = await post(`/api/staff/sessions/${ref}/consideration`, { id: "x", state: "met" }, cookie);
  assert.equal(cr.status, 500);
  cr = await post(`/api/staff/sessions/${ref}/letter`, { subject: "Hello", body: "Body text", decision: "request_info" }, cookie);
  assert.equal(cr.status, 200);
  assert.equal((await cr.json()).status, "needs_info");
  const after = await (await fetch(`${BASE}/api/sessions/${ref}?key=${view_key}`)).json();
  assert.ok(after.messages.some((m) => m.letter), "the resident sees the saved letter in the conversation");
  assert.equal(after.staff_actions.length, 1);
});

test("documents on the checklist: only real PDFs and pictures, only with the visit code, and they can be removed", async () => {
  const visit = await (await post("/api/sessions", { text: "Hello, I have a question." })).json();
  const url = `/api/sessions/${visit.ref}/documents`, key = `?key=${encodeURIComponent(visit.view_key)}`;
  const pdf = Buffer.from("%PDF-1.4 sample").toString("base64");
  assert.equal((await post(url, { item: "Water letter", name: "w.pdf", base64: pdf })).status, 403, "no visit code");
  assert.equal((await post(url + key, { item: "Water letter", name: "w.pdf", base64: Buffer.from("<script>alert(1)</script>").toString("base64") })).status, 400, "a web page named .pdf is refused");
  assert.equal((await post(url + key, { item: "", name: "w.pdf", base64: pdf })).status, 400, "it must belong to a line");
  const made = await post(url + key, { item: "Water letter", name: "w<x>.pdf", base64: pdf });
  assert.equal(made.status, 200);
  const { id } = await made.json();
  const got = await fetch(BASE + url + "/" + id);
  assert.equal(got.headers.get("content-type"), "application/pdf");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("content-disposition"), /filename="w_x_.pdf"/);
  const s = await (await fetch(BASE + `/api/sessions/${visit.ref}` + key)).json();
  assert.equal(s.documents.length, 1);
  assert.equal(s.documents[0].item, "Water letter");
  assert.equal(s.documents[0].data, undefined, "the file itself never rides along with the visit");
  assert.equal((await fetch(BASE + url + "/" + id, { method: "DELETE" })).status, 403);
  assert.equal((await fetch(BASE + url + "/" + id + key, { method: "DELETE" })).status, 200);
  assert.equal((await fetch(BASE + url + "/" + id)).status, 404);
});
