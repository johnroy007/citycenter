// Reads the video's opening line in several Google voices so John can pick one by ear.
// Run: node video/voice-samples.js [voice names...]   Writes video/out/voice-samples/<voice>.wav
// Needs GOOGLE_TTS_API_KEY (see video/README.md). Then set GOOGLE_TTS_VOICE to the one you like.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { googleTts, setting } = require("./lib/media");
const scenes = require("./scenes");

const DEFAULT = ["Charon", "Orus", "Iapetus", "Algenib", "Kore", "Aoede", "Leda", "Sulafat"].map((n) => "en-US-Chirp3-HD-" + n);

(async () => {
  if (!setting("GOOGLE_TTS_API_KEY")) throw new Error("No Google key yet: put GOOGLE_TTS_API_KEY in .env.google-tts.local (see video/README.md).");
  const voices = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  const text = scenes[0].say + " " + scenes.find((s) => s.id === "idea").say;
  const dir = path.join(__dirname, "out", "voice-samples");
  fs.mkdirSync(dir, { recursive: true });
  for (const v of voices) {
    process.stdout.write(v.padEnd(28));
    try { await googleTts(text, path.join(dir, v + ".wav"), v); console.log("ok"); } catch (e) { console.log(e.message); }
  }
  console.log("Samples in " + dir);
})().catch((e) => { console.error(e.message); process.exit(1); });
