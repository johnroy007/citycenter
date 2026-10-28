// Creates a temporary copy of the app on Render in another region, asks Meta for the model list
// from there, prints the answer, and deletes the copy. Used to find out where Meta's API will
// serve this key from. Run: node scripts/probe-region.js frankfurt [--keep]
// Needs RENDER_API_KEY in .env.render.local and the app secrets in .env (both git-ignored). Prints no secret values.
"use strict";
const fs = require("fs");
const path = require("path");

const region = process.argv[2];
const keep = process.argv.includes("--keep");
if (!region) {
  console.error("usage: node scripts/probe-region.js <oregon|ohio|virginia|frankfurt|singapore> [--keep]");
  process.exit(2);
}
function envFile(file) {
  const out = {};
  const p = path.join(__dirname, "..", file);
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const renderKey = envFile(".env.render.local").RENDER_API_KEY;
const app = envFile(".env");
if (!renderKey) throw new Error("RENDER_API_KEY missing in .env.render.local");
for (const k of ["MODEL_API_KEY", "STAFF_PASSCODE", "COOKIE_SECRET"]) if (!app[k]) throw new Error(k + " missing in .env");
const H = { Authorization: "Bearer " + renderKey, "Content-Type": "application/json" };
const api = async (method, p, body) => {
  const r = await fetch("https://api.render.com/v1" + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${typeof j === "string" ? j.slice(0, 200) : JSON.stringify(j).slice(0, 200)}`);
  return j;
};

(async () => {
  const owners = await api("GET", "/owners");
  const ownerId = owners[0].owner.id;
  const name = `citycenter-probe-${region}`;
  console.log(`Creating ${name} (free plan, no disk) ...`);
  const created = await api("POST", "/services", {
    type: "web_service",
    name,
    ownerId,
    repo: "https://github.com/johnroy007/citycenter",
    branch: "main",
    autoDeploy: "no",
    serviceDetails: {
      region,
      plan: "free",
      runtime: "node",
      envSpecificDetails: { buildCommand: "echo no build step", startCommand: "npm start" },
      healthCheckPath: "/api/health",
    },
    envVars: [
      { key: "NODE_VERSION", value: "24.19.0" },
      { key: "META_MODEL", value: "muse-spark-1.3" },
      { key: "DAILY_CALL_CAP", value: "50" },
      { key: "MODEL_API_KEY", value: app.MODEL_API_KEY },
      { key: "STAFF_PASSCODE", value: app.STAFF_PASSCODE },
      { key: "COOKIE_SECRET", value: app.COOKIE_SECRET },
    ],
  });
  const svc = created.service;
  const url = svc.serviceDetails.url;
  console.log(`Service ${svc.id} at ${url}; waiting for the first deploy ...`);
  let live = false;
  try {
    for (let i = 0; i < 60 && !live; i++) {
      await sleep(10000);
      const deps = await api("GET", `/services/${svc.id}/deploys?limit=1`);
      const st = deps[0] && deps[0].deploy && deps[0].deploy.status;
      process.stdout.write(`  ${st}\n`);
      if (st === "live") live = true;
      if (/failed|canceled|deactivated/.test(st || "")) throw new Error("deploy " + st);
    }
    if (!live) throw new Error("deploy did not go live in time");
    for (let i = 0; i < 12; i++) {
      try { await (await fetch(url + "/api/health")).json(); break; } catch { await sleep(5000); }
    }
    const login = await fetch(url + "/api/staff/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode: app.STAFF_PASSCODE }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    if (!cookie) throw new Error("staff login failed: " + login.status);
    for (let i = 1; i <= 4; i++) {
      const d = await (await fetch(url + "/api/staff/diag", { headers: { Cookie: cookie } })).json();
      console.log(`try ${i}: egress ${d.egress_ip} | models ${JSON.stringify(d.models)} | chat ${d.chat_status} | responses(spark-1.2) ${d.responses_status}`);
      await sleep(3000);
    }
  } finally {
    if (keep) console.log(`Kept ${svc.id} (${url}). Delete it in Render when done.`);
    else {
      await api("DELETE", `/services/${svc.id}`);
      console.log(`Deleted ${svc.id}.`);
    }
  }
})().catch((e) => { console.error("probe failed:", e.message); process.exit(1); });
