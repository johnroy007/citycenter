// ffmpeg helpers and narration audio for the demo video.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

function findTool(name) {
  const env = process.env[name.toUpperCase()];
  if (env && fs.existsSync(env)) return env;
  const pk = path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages");
  if (fs.existsSync(pk)) {
    for (const d of fs.readdirSync(pk).filter((d) => /FFmpeg/i.test(d))) {
      const stack = [path.join(pk, d)];
      while (stack.length) {
        const cur = stack.pop();
        for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
          const p = path.join(cur, e.name);
          if (e.isDirectory()) stack.push(p);
          else if (e.name.toLowerCase() === name + ".exe") return p;
        }
      }
    }
  }
  return name; // hope it is on PATH
}
const FFMPEG = findTool("ffmpeg");
const FFPROBE = findTool("ffprobe");

function ff(args, { quiet = true } = {}) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-y", ...(quiet ? ["-loglevel", "error"] : []), ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error("ffmpeg failed: " + (r.stderr || "").slice(-2000) + "\nargs: " + args.join(" ").slice(0, 600));
  return r.stderr;
}
function duration(file) {
  return Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" }).trim());
}

// Where John's own recordings live: the private notebook if present (survives laptop switches), else video/voice.
const NOTES_VOICE = path.join(os.homedir(), "Projects", "citycenter-notes", "video-voice");
const VOICE_DIR = process.env.VOICE_DIR || (fs.existsSync(path.dirname(NOTES_VOICE)) ? NOTES_VOICE : path.join(__dirname, "..", "voice"));

function recordingFor(id) {
  if (!fs.existsSync(VOICE_DIR)) return null;
  const f = fs.readdirSync(VOICE_DIR).find((n) => n.replace(/\.[^.]+$/, "") === id && /\.(webm|wav|m4a|mp3|ogg)$/i.test(n));
  return f ? path.join(VOICE_DIR, f) : null;
}

// Google Cloud Text-to-Speech, used when a key is set (GOOGLE_TTS_API_KEY, in the environment or in the
// git-ignored .env.google-tts.local at the project root). Voice: GOOGLE_TTS_VOICE (default below).
const ROOT = path.join(__dirname, "..", "..");
function setting(name) {
  if (process.env[name]) return process.env[name].trim();
  for (const file of [".env.google-tts.local", ".env"]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(new RegExp("^" + name + "=(.*)$", "m"));
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}
const GOOGLE_DEFAULT_VOICE = "en-US-Chirp3-HD-Charon";
function googleVoice() { return setting("GOOGLE_TTS_API_KEY") ? setting("GOOGLE_TTS_VOICE") || GOOGLE_DEFAULT_VOICE : ""; }
async function googleTts(text, outWav, voice = googleVoice()) {
  const key = setting("GOOGLE_TTS_API_KEY");
  if (!key) throw new Error("GOOGLE_TTS_API_KEY is not set");
  const languageCode = voice.split("-").slice(0, 2).join("-");
  const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input: { text }, voice: { languageCode, name: voice }, audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 48000 } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google voice failed (HTTP ${r.status}): ${(body.error && body.error.message) || "no details"}`);
  fs.writeFileSync(outWav, Buffer.from(body.audioContent, "base64"));
}

// Stand-in narration with the Windows speech voice, until John records his own.
function tts(text, outWav, voice = process.env.TTS_VOICE || "Microsoft Zira Desktop") {
  const tmp = path.join(os.tmpdir(), "cc-tts-" + process.pid + ".txt");
  fs.writeFileSync(tmp, text, "utf8");
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.SelectVoice('${voice}') } catch {}; $s.Rate = 0; $s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}'); $s.Speak([IO.File]::ReadAllText('${tmp.replace(/'/g, "''")}')); $s.Dispose()`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps]);
  fs.rmSync(tmp, { force: true });
}

// Returns { file, seconds, source } for a scene's narration: cleaned 48 kHz mono WAV, silence trimmed at both ends.
// Order: John's own recording, else the Google voice (if a key is set), else the Windows voice.
async function narration(scene, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const out = path.join(workDir, scene.id + ".wav");
  let src = recordingFor(scene.id), source = "john";
  if (!src) {
    src = path.join(workDir, scene.id + ".tts.wav");
    const stamp = path.join(workDir, scene.id + ".tts.txt");
    const gv = googleVoice();
    const want = (gv ? "google:" + gv : "windows") + " | " + scene.say;
    if (!fs.existsSync(src) || !fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== want) {
      if (gv) await googleTts(scene.say, src, gv); else tts(scene.say, src);
      fs.writeFileSync(stamp, want);
    }
    source = gv ? "Google voice " + gv : "computer voice";
  }
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse";
  const clean = source === "john" ? ",highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7" : ",loudnorm=I=-16:TP=-1.5:LRA=7";
  ff(["-i", src, "-af", trim + clean, "-ar", "48000", "-ac", "1", out]);
  return { file: out, seconds: duration(out), source };
}

module.exports = { ff, duration, narration, googleTts, googleVoice, setting, FFMPEG, FFPROBE, VOICE_DIR, recordingFor };
