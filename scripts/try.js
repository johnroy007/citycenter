// Run one scenario (or any text) through the help desk and print what happened. Costs a few cents.
// Usage: node scripts/try.js fence-ok            (a scenario id from test/fixtures/scenarios.json)
//        node scripts/try.js "I want to keep goats at 595 E 1400 N"
//        node scripts/try.js lot-split-ok --staff   (also builds the staff considerations)
"use strict";
const os = require("os");
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
const review = require("../lib/review");

(async () => {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const staff = process.argv.includes("--staff");
  const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "scenarios.json"), "utf8")).scenarios;
  const sc = fixtures.find((s) => s.id === args[0]);
  const text = sc ? sc.text : args.join(" ");
  if (!text) throw new Error("Give a scenario id or some text.");
  const town = loadTown();
  const code = loadCode(town);
  const gis = loadGis(town);
  const { tools } = createTools({ code, gis, town });
  const store = openStore(fs.mkdtempSync(path.join(os.tmpdir(), "cc-try-")), { refPrefix: town.refPrefix });
  let calls = 0;
  const client = createClient({ onUsage: (u) => (calls++, process.stdout.write(`   · ${u.tag} ${u.model} ${u.prompt_tokens}/${u.completion_tokens} ${u.ms}ms\n`)) });
  const ctx = { store, client, town, code, gis, tools, model: process.env.META_MODEL || "muse-spark-1.3" };
  console.log(`RESIDENT: ${text}\n`);
  const t0 = Date.now();
  const { ref } = store.createSession({ town: town.id, text });
  let s = await runTurn(ref, ctx);
  const last = s.messages[s.messages.length - 1];
  if (last && last.role === "desk" && last.asks_consent) {
    console.log(`\n${last.character}: ${last.text}\nRESIDENT: Yes, please.`);
    store.addMessage(ref, { role: "resident", text: "Yes, please." });
    s = await runTurn(ref, ctx);
  }
  console.log(`\n[${ref}] ${((Date.now() - t0) / 1000).toFixed(0)}s, ${calls} calls, status ${s.status}, department ${s.department}`);
  for (const m of s.messages.filter((x) => x.role === "desk")) console.log(`\n${m.character} (${m.department}): ${m.text}`);
  if (s.parcel) console.log(`\nPARCEL: ${s.parcel.id} ${s.parcel.address} zone ${s.parcel.zone} ${s.parcel.areaAcres} ac; owner (fictional) ${s.owner && s.owner.name}`);
  if (s.research) {
    const r = s.research;
    console.log(`\nRESEARCH: use ${r.use_status}; tier ${r.process_tier}; apps ${r.required_applications.join(", ") || "-"}; ${r.tool_log.length} tool calls`);
    console.log("  " + r.process_explanation);
    if (r.path_if_blocked) console.log("  PATH IF BLOCKED: " + r.path_if_blocked);
    for (const x of r.applicable_sections) console.log(`  § ${x.section} ${x.title || ""} [${x.quote_verified ? "verified" : "no verified quote"}] ${x.quote ? '"' + x.quote.slice(0, 120) + '"' : x.quote_rejected ? "(rejected: " + x.quote_rejected.slice(0, 80) + ")" : ""}`);
    for (const st of r.standards) console.log(`  STD ${st.section}: ${st.requirement} | required ${st.required_value} | proposed ${st.proposed_value} | ${st.status}`);
    for (const c of r.considerations) console.log(`  CONSIDER ${c.id} [${c.status}] ${c.title} (${c.section})`);
    for (const q of r.missing_information) console.log(`  MISSING: ${q.question}`);
    for (const t of r.tool_log) console.log(`  tool: ${t.summary}`);
  }
  if (s.packet) {
    console.log(`\nPACKET (${s.packet.packet_type}): ${s.packet.title}\n  ${s.packet.one_line_summary}\n  ${s.packet.process_summary}`);
    for (const d of s.packet.documents) {
      console.log(`  --- ${d.name} (${d.doc_type}, §${d.section}) ---`);
      for (const f of d.fields) console.log(`    ${f.label}: ${f.value || "[blank]"} (${f.source})`);
      console.log(`    narrative: ${d.narrative.replace(/\n/g, " ").slice(0, 400)}`);
      if (d.invented_numbers_removed && d.invented_numbers_removed.length) console.log(`    removed invented numbers: ${d.invented_numbers_removed}`);
    }
  }
  if (staff) {
    console.log("\nSTAFF: building considerations...");
    const cons = await review.buildConsiderations(client, store.getSession(ref), ctx);
    for (const c of cons.considerations) console.log(`  [${c.document_reading}] ${c.title} (${c.sections.join(", ")}) ${c.quote_verified ? "✓quote" : ""}\n      ${c.requirement}\n      packet: ${c.evidence_in_packet}\n      verify: ${c.how_to_verify}`);
  }
  console.log(`\nTotal calls: ${calls}`);
})().catch((e) => {
  console.error("try failed:", e.stack || e.message);
  process.exit(1);
});
