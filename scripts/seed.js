// Seeds the database with three invented applications by running the real pipeline (costs about 25 cents total).
// Run: npm run seed   (needs MODEL_API_KEY; uses DATA_DIR like the server)
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();
const { openStore } = require("../lib/store");
const { createClient } = require("../lib/meta");
const { runResidentFlow } = require("../lib/pipeline");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "requests.json"), "utf8"));
const SEEDS = [
  { text: fixtures.complete.text, sketch: "sketch-clear.png" },
  { text: fixtures.missing_parcel.text, sketch: null },
  { text: fixtures.legality.text, sketch: "sketch-messy.png" },
];

(async () => {
  const store = openStore();
  const client = createClient({ onUsage: (u) => store.logUsage(u) });
  if (store.listApplications().length && !process.argv.includes("--force")) {
    console.log(`Database already has ${store.listApplications().length} application(s). Use --force to add seeds anyway.`);
    return;
  }
  for (const s of SEEDS) {
    const sketch = s.sketch ? { mime: "image/png", data: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", s.sketch)) } : null;
    const { ref, viewKey } = store.createApplication({ requestText: s.text, sketch });
    process.stdout.write(`Running ${ref}... `);
    const app = await runResidentFlow(ref, { store, client });
    console.log(`${app.status}: ${app.gaps.missing_count} missing, ${app.gaps.unclear_count} unclear. Resident link: /?ref=${ref}&key=${viewKey}`);
  }
  const u = store.usageTotals();
  console.log(`Done. Model calls so far in this database: ${u.n} (${u.p} in / ${u.c} out tokens).`);
})().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
