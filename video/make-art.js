// Generates the opening illustrations for the demo video with Muse Image, once (about $0.01 each).
// Run: node video/make-art.js [--only town,official]   Writes video/art/<id>.webp and video/art/manifest.json.
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();
const { createClient } = require("../lib/meta");

const STYLE =
  "Friendly flat vector cartoon illustration, clean bold outlines, simple shapes, calm muted warm colors, soft warm lighting, " +
  "small-town American Southwest setting, same style as a children's picture book, wide 16:9 composition with open space, " +
  "no text, no letters, no words, no signs, no logos, no flags.";

const ART = {
  town: "A quiet small desert town main street at morning: a modest one-story city hall building with a covered entrance, a few houses, a pickup truck, two neighbors waving, tall red sandstone cliffs and blue sky behind.",
  local: "A friendly bird's-eye illustrated map of a wide American countryside dotted with dozens of tiny distinct small towns, each with its own little town hall, water tower and county building, connected by winding roads, from desert to farmland to mountains.",
  official: "Inside a small-town city hall: a kind, ordinary middle-aged town official with rolled-up sleeves stands behind a wooden service counter, surrounded by towering stacks of thick binders and rule books, scratching his head, a little overwhelmed but friendly.",
  resident: "A friendly resident in work clothes and a ball cap stands at a wooden city hall counter holding a hand-drawn sketch of his property, puzzled, looking at a very long multi-page government form that unrolls onto the floor.",
  fair: "Two different residents, a young woman and an older man, stand side by side at a city hall counter; each receives an identical neat folder of papers; a simple balance scale sits level on the counter between them.",
  personal: "At a city hall counter, a town clerk laughs and chats warmly with one resident, while a second resident walking away toward the door glances back over his shoulder with a doubtful, uneasy expression.",
  together: "A resident and a town official stand together on the same side of a city hall counter, both smiling, looking at a large friendly screen showing a property map and a neat application form, warm and hopeful.",
};

(async () => {
  const only = (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "").split(",").filter(Boolean);
  const client = createClient({ apiKey: process.env.MODEL_API_KEY });
  const dir = path.join(__dirname, "art");
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, "manifest.json");
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : { generated_with: "muse-image-1.0", style: STYLE, images: {} };
  for (const [id, scene] of Object.entries(ART)) {
    if (only.length && !only.includes(id)) continue;
    let buf;
    for (const size of ["1792x1024", "1536x1024"]) {
      try {
        process.stdout.write(`${id} ${size} ... `);
        buf = await client.generateImage({ prompt: scene + " " + STYLE, size, format: "webp" });
        console.log(`${(buf.length / 1024).toFixed(0)} KB`);
        break;
      } catch (e) { console.log("failed: " + e.message); }
    }
    if (!buf) continue;
    fs.writeFileSync(path.join(dir, id + ".webp"), buf);
    manifest.images[id] = { prompt: scene + " " + STYLE, file: id + ".webp" };
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
})().catch((e) => { console.error(e.message); process.exit(1); });
