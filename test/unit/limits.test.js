// Boots the real server with low limits and a judge code, and checks who gets stopped. No Meta key, so nothing is spent.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { openStore } = require("../../lib/store");

const PORT = 4000 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const CODE = "judge-code-for-tests";
let child;
const visit = (cookie) => fetch(BASE + "/api/sessions", { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ text: "Hello there" }) });

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, "..", "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "cc-lim-")), MODEL_API_KEY: "", TURNS_PER_HOUR: "2", TURNS_PER_DAY: "2", JUDGE_CODE: CODE, COOKIE_SECRET: "0123456789abcdef0123456789abcdef" },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + "/api/health")).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error("server did not start");
});
test.after(() => child && child.kill());

test("one person is stopped at their share, and the judge link is not", async () => {
  assert.equal((await visit()).status, 202);
  assert.equal((await visit()).status, 202);
  const over = await visit();
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /public demo's limit/);

  const wrong = await fetch(BASE + "/judge?code=nope", { redirect: "manual" });
  assert.equal(wrong.headers.get("set-cookie"), null, "a wrong code gets nothing");
  assert.equal(wrong.headers.get("location"), "/");
  const right = await fetch(BASE + "/judge?code=" + CODE, { redirect: "manual" });
  assert.equal(right.status, 302);
  assert.equal(right.headers.get("location"), "/?judge=1");
  const cookie = right.headers.get("set-cookie").split(";")[0];
  assert.match(right.headers.get("set-cookie"), /HttpOnly/);
  assert.ok(!cookie.includes(CODE), "the cookie doesn't hold the code");
  for (let i = 0; i < 4; i++) assert.equal((await visit(cookie)).status, 202, "a judge isn't limited");
  assert.equal((await visit("cc_judge=forged")).status, 429, "a forged cookie is an ordinary visitor");
});

test("the public budget counts dollars and leaves out judges", () => {
  const store = openStore(fs.mkdtempSync(path.join(os.tmpdir(), "cc-bud-")), { refPrefix: "TC" });
  store.logUsage({ tag: "x", model: "muse-spark-1.3", prompt_tokens: 1000000, completion_tokens: 1000000 });
  store.logUsage({ tag: "x", model: "muse-wonder-1.0", prompt_tokens: 1000000, completion_tokens: 0 });
  store.logUsage({ tag: "x", model: "sam-3.1" });
  store.logUsage({ tag: "x", model: "muse-spark-1.3", prompt_tokens: 9000000, completion_tokens: 9000000, judge: true });
  const t = store.publicToday();
  assert.equal(t.n, 3);
  assert.ok(Math.abs(t.usd - (1.25 + 4.25 + 4 + 0.0025)) < 0.0001, "dollars: " + t.usd);
});
