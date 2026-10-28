// Generates the help desk characters with Muse Image (about $0.01 per image) into public/characters/.
// Run: node scripts/make-characters.js [--only juniper] [--force]
// Generated once during the hackathon; the PNGs are committed so deploys need no image calls.
"use strict";
const fs = require("fs");
const path = require("path");
require("../lib/env").loadEnv();
const { createClient } = require("../lib/meta");
const { loadTown } = require("../lib/townconfig");

const STYLE =
  "Friendly flat vector cartoon illustration of a city hall employee, waist-up portrait, centered, facing the viewer, clean bold outlines, soft warm colors, simple shapes, " +
  "plain solid light cream background (#FBF7EF) with nothing else, no text, no logos, no name tag text, no desk, consistent style for a set of characters.";

const CHARACTERS = {
  marlowe: { role: "front desk greeter", look: "a cheerful middle-aged person with short silver hair, round glasses, a teal cardigan over a collared shirt, warm smile" },
  juniper: { role: "land use planner", look: "a calm thirty-something person with dark curly hair tied back, a mustard yellow blouse, a rolled zoning map tucked under one arm" },
  bob: { role: "building official", look: "a sturdy person in a white hard hat and an orange safety vest over a plaid shirt, clipboard in hand, friendly expression" },
  reyes: { role: "utility department desk", look: "a practical person with a blue work shirt, short hair, a small wrench embroidered patch, kind expression" },
  dakota: { role: "code enforcement officer", look: "a person in a navy polo shirt with a small city badge patch, a lanyard, neat short hair, patient expression" },
  avery: { role: "city recorder", look: "an older person with a grey bob haircut, a cardigan, reading glasses on a chain, holding a folder, gentle smile" },
  sol: { role: "public works crew lead", look: "a weathered, friendly person with a grey beard, a yellow high-visibility jacket over a work shirt, a city cap, holding a rolled street map" },
  harper: { role: "police officer", look: "a calm person in a plain dark blue police uniform shirt with a small star badge and no text, short dark hair, reassuring expression" },
  mateo: { role: "fire chief", look: "a broad-shouldered person in a navy fire department polo with a small red shield patch, a white fire chief helmet held under one arm, warm smile" },
  rosa: { role: "parks and recreation coordinator", look: "an energetic person with a long dark braid, a green polo shirt with a small leaf patch, a whistle on a lanyard, sunny smile" },
};
const POSES = {
  neutral: "standing relaxed with a small friendly smile, hands at sides or lightly clasped",
  talking: "mid-sentence, mouth open in a friendly way, one hand raised slightly in an explaining gesture",
  thinking: "looking slightly upward with a thoughtful expression, one hand on chin",
};

(async () => {
  const only = (() => {
    const i = process.argv.indexOf("--only");
    return i > -1 ? process.argv[i + 1].split(",") : null;
  })();
  const force = process.argv.includes("--force");
  const town = loadTown();
  const dir = path.join(__dirname, "..", "public", "characters");
  fs.mkdirSync(dir, { recursive: true });
  const client = createClient({ onUsage: (u) => process.stdout.write(`   · ${u.model} ${u.ms}ms\n`) });
  const manifest = { generated_with: "muse-image-1.0", style: STYLE, characters: {} };
  for (const [name, c] of Object.entries(CHARACTERS)) {
    if (only && !only.includes(name)) continue;
    const dept = (town.departments || []).find((d) => String(d.character).toLowerCase() === name);
    manifest.characters[name] = { role: c.role, department: dept ? dept.id : null, poses: {} };
    for (const [pose, poseText] of Object.entries(POSES)) {
      const file = path.join(dir, `${name}-${pose}.webp`);
      manifest.characters[name].poses[pose] = `/public/characters/${name}-${pose}.webp`;
      if (fs.existsSync(file) && !force) {
        console.log(`keep ${path.basename(file)}`);
        continue;
      }
      const prompt = `${STYLE} The character is ${c.look}, a ${c.role}, ${poseText}.`;
      process.stdout.write(`generate ${name}-${pose} ... `);
      try {
        const img = await client.generateImage({ prompt, size: "1024x1024", format: "webp" });
        fs.writeFileSync(file, img);
        console.log(`${(img.length / 1024).toFixed(0)} KB`);
      } catch (e) {
        console.log("FAILED: " + e.message);
      }
    }
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("wrote manifest.json");
})().catch((e) => {
  console.error("make-characters failed:", e.message);
  process.exit(1);
});
