// Seeds a running server (local or the live site) with the worked examples by driving the public HTTP API,
// exactly as the demo mode does. Costs roughly 20 to 40 cents per example.
// Usage: node scripts/seed-remote.js https://citycenter-puh5.onrender.com [example-id,example-id]
"use strict";
const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://localhost:3000";
const only = (process.argv[3] || "").split(",").filter(Boolean);
const demo = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "demo.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  const res = await fetch(BASE + p, { ...opts, headers: { "Content-Type": "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${data.error || ""}`);
  return data;
}
async function waitIdle(ref, key) {
  for (let i = 0; i < 240; i++) {
    const s = await api(`/api/sessions/${ref}?key=${key}`);
    if (!s.busy) return s;
    await sleep(1500);
  }
  throw new Error("timed out");
}

(async () => {
  for (const ex of demo.examples) {
    if (only.length && !only.includes(ex.id)) continue;
    process.stdout.write(`${ex.title} ... `);
    const sketch = ex.sketch ? { mime: "image/png", base64: fs.readFileSync(path.join(__dirname, "..", "public", "sketches", ex.sketch)).toString("base64") } : null;
    const lastTurn = ex.turns.length - 1;
    const attachOn = sketch ? (ex.turns.findIndex((t) => /sketch|drawing|attached/i.test(t)) + 1 || ex.turns.length) - 1 : -1;
    const first = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: ex.turns[0], image: attachOn === 0 ? sketch : undefined, demo_id: ex.id }) });
    const { ref, view_key: key } = first;
    let s = await waitIdle(ref, key);
    for (let i = 1; i <= lastTurn; i++) {
      await api(`/api/sessions/${ref}/messages?key=${key}`, { method: "POST", body: JSON.stringify({ text: ex.turns[i], image: attachOn === i ? sketch : undefined }) });
      s = await waitIdle(ref, key);
      process.stdout.write(".");
    }
    let submitted = "";
    if (s.packet && s.packet.documents && s.packet.documents.length && s.parcel && s.packet.packet_type !== "referral") {
      await api(`/api/sessions/${ref}/submit?key=${key}`, { method: "POST", body: "{}" });
      submitted = " submitted";
    }
    console.log(` ${ref} ${s.status}${submitted}; tier ${s.research ? s.research.process_tier : "-"}; ${BASE}/?ref=${ref}&key=${key}`);
  }
})().catch((e) => {
  console.error("seed-remote failed:", e.message);
  process.exit(1);
});
