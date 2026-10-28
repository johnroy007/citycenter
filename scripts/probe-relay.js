// Checks a Meta relay from this laptop: health, the model list and five chat calls through it.
// Run: node scripts/probe-relay.js https://citycenter-relay.example.workers.dev [--secret <value>]
// Uses MODEL_API_KEY from .env and, unless --secret is given, META_RELAY_SECRET from .env.render-vars.local.
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();

const base = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("usage: node scripts/probe-relay.js https://<relay address> [--secret <value>]");
  process.exit(2);
}
let secret = "";
const si = process.argv.indexOf("--secret");
if (si > 0) secret = process.argv[si + 1] || "";
else {
  const f = path.join(__dirname, "..", ".env.render-vars.local");
  if (fs.existsSync(f)) {
    const line = fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith("META_RELAY_SECRET="));
    if (line) secret = line.slice("META_RELAY_SECRET=".length).trim();
  }
}
const key = process.env.MODEL_API_KEY || "";
if (!key) {
  console.error("MODEL_API_KEY is not set in .env");
  process.exit(2);
}
const H = { Authorization: "Bearer " + key, "Content-Type": "application/json", ...(secret ? { "x-relay-secret": secret } : {}) };

(async () => {
  let r = await fetch(base + "/health");
  console.log("health:", r.status, (await r.text()).slice(0, 160));
  r = await fetch(base + "/v1/models", { headers: H });
  const t = await r.text();
  let models = [];
  try { models = (JSON.parse(t).data || []).map((m) => m.id); } catch {}
  console.log("models:", r.status, models.length ? models.join(", ") : t.slice(0, 160));
  const codes = [];
  for (let i = 0; i < 5; i++) {
    r = await fetch(base + "/v1/chat/completions", { method: "POST", headers: H, body: JSON.stringify({ model: "muse-spark-1.3", messages: [{ role: "user", content: "Say ok." }], max_completion_tokens: 5 }) });
    codes.push(r.status);
    await r.text();
  }
  console.log("chat (muse-spark-1.3) x5:", codes.join(" "));
  const ok = codes.filter((c) => c === 200).length;
  console.log(ok === 5 ? "RELAY WORKS: all five calls answered." : ok ? `Partly: ${ok} of 5 answered.` : "Relay reached, but Meta refused every call from its network too.");
})().catch((e) => { console.error("probe failed:", e.message); process.exit(1); });
