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
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-srv-"));
  child = spawn(process.execPath, [path.join(__dirname, "..", "..", "server.js")], {
    // MODEL_API_KEY is set to empty on purpose: the .env loader never overrides a variable that already exists, so no real calls happen.
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, MODEL_API_KEY: "", STAFF_PASSCODE: PASS, COOKIE_SECRET: "0123456789abcdef0123456789abcdef", DAILY_CALL_CAP: "5" },
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
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal((await fetch(BASE + "/staff")).status, 200);
  assert.equal((await fetch(BASE + "/public/app.css")).status, 200);
  assert.equal((await fetch(BASE + "/public/../server.js")).status, 404);
  assert.equal((await fetch(BASE + "/public/%2e%2e/server.js")).status, 404);
  assert.equal((await fetch(BASE + "/nope")).status, 404);
});

test("health reports the model and staff portal state", async () => {
  const h = await (await fetch(BASE + "/api/health")).json();
  assert.equal(h.ok, true);
  assert.equal(h.staff_portal, true);
  assert.equal(h.daily_cap, 5);
});

test("submission validation: short text, bad image, oversize body", async () => {
  let r = await fetch(BASE + "/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "too short" }) });
  assert.equal(r.status, 400);
  r = await fetch(BASE + "/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(40), image: { mime: "image/png", base64: Buffer.from("nope").toString("base64") } }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /real image/);
  r = await fetch(BASE + "/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(40), image: { mime: "image/png", base64: "A".repeat(9 * 1024 * 1024) } }) });
  assert.equal(r.status, 413);
});

test("a submission without an API key is accepted, then ends in a clear error; reading needs the key", async () => {
  const r = await fetch(BASE + "/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "I want to split my parcel SC-100-200 into two lots please." }) });
  assert.equal(r.status, 202);
  const { ref, view_key } = await r.json();
  assert.match(ref, /^SC-\d{4}-\d{4}$/);
  assert.equal((await fetch(`${BASE}/api/applications/${ref}`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/applications/${ref}?key=wrong`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/applications/SC-1999-0001?key=x`)).status, 404);
  let app;
  for (let i = 0; i < 50; i++) {
    app = await (await fetch(`${BASE}/api/applications/${ref}?key=${view_key}`)).json();
    if (app.status !== "processing") break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(app.status, "error");
  assert.match(app.error, /API key/);
  assert.equal(app.view_key, undefined, "view key is never echoed");
  assert.equal(app.prereview, undefined, "residents never see the staff pre-review");
});

test("staff portal: wrong passcode 401, right passcode sets cookie, queue lists the application", async () => {
  assert.equal((await fetch(BASE + "/api/staff/queue")).status, 401);
  let r = await fetch(BASE + "/api/staff/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: "wrong" }) });
  assert.equal(r.status, 401);
  r = await fetch(BASE + "/api/staff/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: PASS }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /cc_staff=.*HttpOnly/);
  const q = await (await fetch(BASE + "/api/staff/queue", { headers: { cookie: cookie.split(";")[0] } })).json();
  assert.ok(q.applications.length >= 1);
  const ref = q.applications[0].ref;
  const detail = await (await fetch(`${BASE}/api/staff/applications/${ref}`, { headers: { cookie: cookie.split(";")[0] } })).json();
  assert.match(detail.resident_link, /\?ref=SC-/);
  assert.equal(detail.view_key, undefined);
  // Decision without a key fails cleanly (no model), and the app is not corrupted.
  r = await fetch(`${BASE}/api/staff/applications/${ref}/decision`, { method: "POST", headers: { "Content-Type": "application/json", cookie: cookie.split(";")[0] }, body: JSON.stringify({ decision: "request_info" }) });
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /API key/);
  // Letter save works without the model.
  r = await fetch(`${BASE}/api/staff/applications/${ref}/letter`, { method: "POST", headers: { "Content-Type": "application/json", cookie: cookie.split(";")[0] }, body: JSON.stringify({ subject: "Hello", body: "Body" }) });
  assert.equal(r.status, 200);
});
