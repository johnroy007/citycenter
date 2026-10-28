// Triggers a Render deploy of the current main branch and waits for it to go live.
// Run: npm run deploy   (needs RENDER_API_KEY in .env.render.local, git-ignored; names only in .env.example)
// Render's auto-deploy on push did not fire for this API-created service, so pushes are followed by this.
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SERVICE_ID = process.env.RENDER_SERVICE_ID || "srv-dbgkpgd9el5s73d373pg";
const LIVE_URL = "https://citycenter-puh5.onrender.com";

function readKey() {
  const file = path.join(__dirname, "..", ".env.render.local");
  if (!fs.existsSync(file)) throw new Error("No .env.render.local with RENDER_API_KEY");
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("RENDER_API_KEY="));
  const key = line ? line.slice("RENDER_API_KEY=".length).trim() : "";
  if (!key) throw new Error("RENDER_API_KEY is empty in .env.render.local");
  return key;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const key = readKey();
  const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const sha = execSync("git rev-parse HEAD").toString().trim();
  const dirty = execSync("git status --porcelain").toString().trim();
  if (dirty) console.log("Note: uncommitted changes are not deployed.");
  let res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, { method: "POST", headers, body: JSON.stringify({ clearCache: "do_not_clear" }) });
  const d = await res.json();
  if (!res.ok) throw new Error(`Render refused: ${res.status} ${JSON.stringify(d).slice(0, 200)}`);
  console.log(`Deploy ${d.id} started for ${(d.commit && d.commit.id || "").slice(0, 7)} (local HEAD ${sha.slice(0, 7)})`);
  for (let i = 0; i < 80; i++) {
    await sleep(10000);
    res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys/${d.id}`, { headers });
    const s = await res.json();
    process.stdout.write(`  ${s.status}\n`);
    if (s.status === "live") break;
    if (/failed|canceled|deactivated/.test(s.status)) throw new Error("Deploy " + s.status);
  }
  const h = await (await fetch(LIVE_URL + "/api/health")).json();
  console.log(`Live: ${LIVE_URL} -> ${JSON.stringify(h)}`);
})().catch((e) => {
  console.error("deploy failed:", e.message);
  process.exit(1);
});
