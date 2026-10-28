// Puts settings from a git-ignored file onto the Render service and redeploys. Prints names only, never values.
// Run: node scripts/render-env.js --file .env.render-vars.local
// Lines with an empty value are skipped. Needs RENDER_API_KEY in .env.render.local.
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SERVICE_ID = process.env.RENDER_SERVICE_ID || "srv-dbgkpgd9el5s73d373pg";
const fi = process.argv.indexOf("--file");
const file = fi > 0 ? process.argv[fi + 1] : ".env.render-vars.local";
const full = path.resolve(__dirname, "..", file);
if (!fs.existsSync(full)) {
  console.error(`No such file: ${file}`);
  process.exit(2);
}
try {
  execSync(`git check-ignore -q "${file}"`, { cwd: path.join(__dirname, "..") });
} catch {
  console.error(`${file} is not git-ignored; refusing to read secrets from a tracked file.`);
  process.exit(2);
}
const renderKey = (fs.readFileSync(path.join(__dirname, "..", ".env.render.local"), "utf8").split(/\r?\n/).find((l) => l.startsWith("RENDER_API_KEY=")) || "").slice("RENDER_API_KEY=".length).trim();
if (!renderKey) {
  console.error("RENDER_API_KEY missing in .env.render.local");
  process.exit(2);
}
const vars = [];
for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim()) vars.push([m[1], m[2].trim()]);
}
if (!vars.length) {
  console.log("Nothing to send: every value in the file is blank.");
  process.exit(0);
}
const H = { Authorization: "Bearer " + renderKey, "Content-Type": "application/json" };
(async () => {
  for (const [k, v] of vars) {
    const r = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${encodeURIComponent(k)}`, { method: "PUT", headers: H, body: JSON.stringify({ value: v }) });
    console.log(`${k}: ${r.ok ? "set" : "failed " + r.status + " " + (await r.text()).slice(0, 120)} (${v.length} chars)`);
  }
  console.log("Redeploying so the new settings take effect ...");
  execSync("node scripts/deploy.js", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
})().catch((e) => { console.error(e.message); process.exit(1); });
