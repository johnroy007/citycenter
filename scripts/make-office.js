// Generates the city-office background for the resident counter with Muse Image, once.
// Run: node scripts/make-office.js   (about $0.02; writes public/office/office-bg.webp)
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();
const { createClient } = require("../lib/meta");

const PROMPT =
  "Friendly flat vector cartoon illustration, wide interior of a small-town city hall front office, empty, no people. " +
  "A long wooden service counter in the foreground center, filing cabinets and a potted plant on the left, a tall window on the right showing red desert cliffs and blue sky, " +
  "a framed zoning map and a city seal shape on the back wall, warm cream walls, soft warm lighting, clean bold outlines, simple shapes, calm muted colors, " +
  "lots of open uncluttered wall space, no text, no letters, no signs, no logos.";

(async () => {
  const client = createClient({ apiKey: process.env.MODEL_API_KEY });
  const out = path.join(__dirname, "..", "public", "office", "office-bg.webp");
  let buf;
  for (const size of ["1536x1024", "1792x1024", "1024x1024"]) {
    try {
      process.stdout.write(`generate office background ${size} ... `);
      buf = await client.generateImage({ prompt: PROMPT, size, format: "webp" });
      console.log(`${(buf.length / 1024).toFixed(0)} KB`);
      break;
    } catch (e) {
      console.log("failed: " + e.message);
    }
  }
  if (!buf) throw new Error("no image generated");
  fs.writeFileSync(out, buf);
  fs.writeFileSync(path.join(__dirname, "..", "public", "office", "manifest.json"), JSON.stringify({ generated_with: "muse-image-1.0", prompt: PROMPT, file: "office-bg.webp" }, null, 2) + "\n");
  console.log("wrote " + out);
})().catch((e) => { console.error(e.message); process.exit(1); });
