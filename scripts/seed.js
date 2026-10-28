// Seeds the database with a few finished conversations from data/demo.json by running the real desk (about 20 cents each).
// Run: npm run seed [-- --force]   (needs MODEL_API_KEY; uses DATA_DIR like the server)
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();
const { loadTown } = require("../lib/townconfig");
const { loadCode } = require("../lib/codestore");
const { loadGis } = require("../lib/gis");
const { createTools } = require("../lib/tools");
const { openStore } = require("../lib/store");
const { createClient } = require("../lib/meta");
const { runTurn } = require("../lib/desk");
const signature = require("../lib/signature");

const demo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "demo.json"), "utf8"));
const PICK = ["lot-split-son", "casita", "rooster"];

(async () => {
  const town = loadTown();
  const code = loadCode(town);
  const gis = loadGis(town);
  const { tools } = createTools({ code, gis, town });
  const store = openStore(null, { refPrefix: town.refPrefix });
  const client = createClient({ onUsage: (u) => store.logUsage(u) });
  const ctx = { store, client, town, code, gis, tools, model: process.env.META_MODEL || "muse-spark-1.3" };
  if (store.listSessions().length && !process.argv.includes("--force")) {
    console.log(`Database already has ${store.listSessions().length} conversation(s). Use --force to add seeds anyway.`);
    return;
  }
  for (const id of PICK) {
    const ex = demo.examples.find((e) => e.id === id);
    if (!ex) continue;
    const sketch = ex.sketch ? { mime: "image/png", data: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", ex.sketch)) } : null;
    const { ref, viewKey } = store.createSession({ town: town.id, text: ex.turns[0], sketch: ex.turns.length === 1 ? sketch : null, demoId: ex.id });
    process.stdout.write(`${ex.title} -> ${ref}: `);
    const yesIfAsked = async () => {
      const t = store.getSession(ref);
      const last = t.messages[t.messages.length - 1];
      if (last && last.role === "desk" && last.asks_consent) {
        store.addMessage(ref, { role: "resident", text: "Yes, please." });
        await runTurn(ref, ctx);
        process.stdout.write("y");
      }
    };
    await runTurn(ref, ctx);
    await yesIfAsked();
    for (let i = 1; i < ex.turns.length; i++) {
      if (i === ex.turns.length - 1 && /change/i.test(ex.turns[i]) === false && sketch) store.setSketch(ref, sketch);
      store.addMessage(ref, { role: "resident", text: ex.turns[i] });
      await runTurn(ref, ctx);
      await yesIfAsked();
      process.stdout.write(".");
    }
    const s = store.getSession(ref);
    if (s.packet && s.packet.documents.length && s.parcel) {
      const who = (s.understanding && s.understanding.applicant && s.understanding.applicant.name) || ex.persona || "Resident";
      store.setSignature(ref, { data: Buffer.from(signature.typedSignatureSvg(who), "utf8"), mime: "image/svg+xml", meta: { name: who, method: "typed", signed_at: new Date().toISOString(), ip: "seed", consent: signature.CONSENT_TEXT, doc_hash: signature.docHash(s.packet), documents: s.packet.documents.map((d) => d.name) } });
      store.updateSession(ref, { status: "submitted", submitted_at: new Date().toISOString() });
      store.addMessage(ref, { role: "desk", department: s.department, character: s.character, text: `Submitted. Your reference code is ${ref}.` });
    }
    console.log(` ${store.getSession(ref).status}; tier ${s.research ? s.research.process_tier : "-"}; resident link /?ref=${ref}&key=${viewKey}`);
  }
  const u = store.usageTotals();
  console.log(`Done. Model calls in this database: ${u.n} (${u.p} in / ${u.c} out tokens).`);
})().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
