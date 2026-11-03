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

// Stand-in narration with the Windows speech voice, until John records his own.
function tts(text, outWav, voice = process.env.TTS_VOICE || "Microsoft Zira Desktop") {
  const tmp = path.join(os.tmpdir(), "cc-tts-" + process.pid + ".txt");
  fs.writeFileSync(tmp, text, "utf8");
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $s.SelectVoice('${voice}') } catch {}; $s.Rate = 0; $s.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}'); $s.Speak([IO.File]::ReadAllText('${tmp.replace(/'/g, "''")}')); $s.Dispose()`;
  execFileSync("powershell", ["-NoProfile", "-Command", ps]);
  fs.rmSync(tmp, { force: true });
}

// Returns { file, seconds, source } for a scene's narration: cleaned 48 kHz mono WAV, silence trimmed at both ends.
function narration(scene, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const out = path.join(workDir, scene.id + ".wav");
  let src = recordingFor(scene.id), source = "john";
  if (!src) {
    src = path.join(workDir, scene.id + ".tts.wav");
    const stamp = path.join(workDir, scene.id + ".tts.txt");
    if (!fs.existsSync(src) || !fs.existsSync(stamp) || fs.readFileSync(stamp, "utf8") !== scene.say) { tts(scene.say, src); fs.writeFileSync(stamp, scene.say); }
    source = "computer voice";
  }
  const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse";
  const clean = source === "john" ? ",highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7" : ",loudnorm=I=-16:TP=-1.5:LRA=7";
  ff(["-i", src, "-af", trim + clean, "-ar", "48000", "-ac", "1", out]);
  return { file: out, seconds: duration(out), source };
}

module.exports = { ff, duration, narration, FFMPEG, FFPROBE, VOICE_DIR, recordingFor };
