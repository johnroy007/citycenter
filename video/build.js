// Builds the demo video from scenes.js, the screen recordings (capture.js), the illustrations (video/art)
// and the narration (John's recordings, or a stand-in computer voice for lines not recorded yet).
// Usage: node video/build.js [--draft] [--only sceneId,sceneId] [--captions]
// Output: video/out/citycenter-demo.mp4 and video/out/citycenter-demo.srt (captions for YouTube).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch } = require("./lib/cdp");
const { ff, duration, narration } = require("./lib/media");
const scenes = require("./scenes");

const args = process.argv.slice(2);
const DRAFT = args.includes("--draft");
const CAPTIONS = args.includes("--captions");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const HERE = __dirname;
const OUT = path.join(HERE, "out");
const WORK = path.join(OUT, "build");
const CAP = path.join(OUT, "capture");
const FPS = 30, W = 1920, H = 1080;
const MAX_TOTAL = 179.5; // the hackathon asks for a 3-minute video
let PRE = 0.35, POST = 0.6;
const ENC = DRAFT ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-tune", "animation"];

const log = (...a) => console.log(...a);
const fmtT = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };

// ---------- recordings ----------
const clipCache = {};
function loadClip(name) {
  if (clipCache[name]) return clipCache[name];
  const dir = path.join(CAP, name);
  if (!fs.existsSync(path.join(dir, "frames.json"))) throw new Error(`No recording "${name}". Run: node video/capture.js`);
  const frames = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8"));
  const markers = JSON.parse(fs.readFileSync(path.join(dir, "markers.json"), "utf8"));
  // Frame timestamps and markers should share the wall clock; if not, line up the first frame with "start".
  const shift = Math.abs(frames[0].t - markers[0].t) > 30 ? markers[0].t - frames[0].t : 0;
  frames.forEach((f) => { f.t += shift; f.file = path.isAbsolute(f.file) ? f.file : path.join(dir, path.basename(f.file)); });
  const at = (name2) => { const m = markers.find((x) => x.name === name2); if (!m) throw new Error(`Recording "${name}" has no marker "${name2}". Markers: ${markers.map((x) => x.name).join(", ")}`); return m.t; };
  return (clipCache[name] = { frames, markers, at });
}
function frameAt(clip, t) {
  const f = clip.frames;
  let lo = 0, hi = f.length - 1;
  if (t <= f[0].t) return f[0].file;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].t <= t) lo = mid; else hi = mid - 1; }
  return f[lo].file;
}

// ---------- overlays (rendered with Chrome) ----------
let browser = null;
const OVERLAY_VERSION = require("node:crypto").createHash("sha1").update(fs.readFileSync(path.join(HERE, "overlay.html"))).digest("hex").slice(0, 10);
async function overlay(spec, file) {
  const key = JSON.stringify({ ...spec, v: OVERLAY_VERSION });
  if (fs.existsSync(file) && fs.existsSync(file + ".json") && fs.readFileSync(file + ".json", "utf8") === key) return file;
  if (!browser) {
    browser = await launch({ port: 9334 });
    await browser.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await browser.goto("file:///" + path.join(HERE, "overlay.html").replace(/\\/g, "/"), 300);
  }
  await browser.eval(`return window.render(${JSON.stringify(spec)})`);
  await browser.screenshot(file);
  fs.writeFileSync(file + ".json", key);
  return file;
}

// ---------- one scene ----------
async function buildScene(sc, d, idx) {
  const dir = path.join(WORK, sc.id);
  fs.mkdirSync(dir, { recursive: true });
  const inputs = [], chains = [], overlays = [];
  let base;
  const frames = Math.round(d * FPS);

  if (sc.art) {
    const img = path.join(HERE, "art", sc.art + ".webp");
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", img);
    const dir2 = idx % 2 ? -1 : 1; // alternate the drift direction
    chains.push(`[0:v]crop=iw:iw*9/16,scale=3840:2160:flags=lanczos,zoompan=z='1.0+0.08*on/${frames}':x='iw/2-(iw/zoom/2)+${dir2}*on*0.35':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[base]`);
    base = "base";
    if (sc.title) overlays.push({ file: await overlay({ mode: "title", text: sc.title }, path.join(dir, "title.png")), a: 0.7, b: d - 0.25 });
  } else if (sc.card) {
    const spec = sc.card === "close" ? { mode: "close", bg: "file:///" + path.join(HERE, "..", "public", "office", "office-bg.webp").replace(/\\/g, "/") } : { mode: sc.card, decide: "Only real City Officials can make decisions." };
    const png = await overlay(spec, path.join(dir, "card.png"));
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", png);
    chains.push(`[0:v]scale=3840:2160:flags=lanczos,zoompan=z='1.0+0.025*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[base]`);
    base = "base";
  } else if (sc.clip || sc.segs) {
    const totalW = sc.segs.reduce((s, x) => s + (x.w || 1), 0);
    let list = "ffconcat version 1.0\n", tOut = 0, last = null, run = 0;
    const flush = () => { if (last) list += `file '${last.replace(/\\/g, "/").replace(/'/g, "'\\''")}'\nduration ${(run / FPS).toFixed(5)}\n`; };
    let made = 0;
    sc.segs.forEach((seg, si) => {
      const clip = loadClip(seg.clip || sc.clip);
      const t0 = clip.at(seg.from), t1 = clip.at(seg.to);
      const alloc = si === sc.segs.length - 1 ? frames - made : Math.round(frames * (seg.w || 1) / totalW);
      const speed = (t1 - t0) / (alloc / FPS);
      if (speed > 1.6) overlays.push({ badge: `▶▶ ${speed >= 10 ? Math.round(speed) : speed.toFixed(1)}× speed`, a: tOut, b: tOut + alloc / FPS });
      for (let k = 0; k < alloc; k++) {
        const f = frameAt(clip, t0 + (k / alloc) * (t1 - t0));
        if (f === last) run++; else { flush(); last = f; run = 1; }
      }
      made += alloc; tOut += alloc / FPS;
    });
    flush();
    list += `file '${last.replace(/\\/g, "/")}'\n`; // concat demuxer needs the last file repeated
    fs.writeFileSync(path.join(dir, "frames.ffconcat"), list);
    inputs.push("-f", "concat", "-safe", "0", "-i", path.join(dir, "frames.ffconcat"));
    chains.push(`[0:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,trim=duration=${d.toFixed(3)}[base]`);
    base = "base";
  }

  for (const c of (sc.callouts || []).filter((c) => c.at < d - 1)) {
    const name = "callout-" + (c.model + "-" + c.text).replace(/[^a-z0-9]+/gi, "-").slice(0, 60) + ".png";
    overlays.push({ file: await overlay({ mode: "callout", model: c.model, text: c.text }, path.join(dir, name)), a: c.at, b: Math.min(d - 0.1, c.at + c.dur) });
  }
  for (const o of overlays.filter((o) => o.badge)) o.file = await overlay({ mode: "badge", text: o.badge }, path.join(dir, "badge-" + o.badge.replace(/[^0-9.]+/g, "") + ".png"));
  if (CAPTIONS) for (const c of sc._captions) overlays.push({ file: await overlay({ mode: "caption", text: c.text }, path.join(dir, `cap-${c.i}.png`)), a: c.a, b: c.b });

  let cur = base;
  overlays.forEach((o, i) => {
    inputs.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", o.file);
    const n = i + 1, fi = Math.min(0.3, (o.b - o.a) / 3);
    chains.push(`[${n}:v]format=rgba,fade=t=in:st=${o.a.toFixed(3)}:d=${fi.toFixed(2)}:alpha=1,fade=t=out:st=${(o.b - fi).toFixed(3)}:d=${fi.toFixed(2)}:alpha=1[o${n}]`);
    chains.push(`[${cur}][o${n}]overlay=0:0:enable='between(t,${o.a.toFixed(3)},${o.b.toFixed(3)})'[v${n}]`);
    cur = `v${n}`;
  });
  const fades = [];
  if (sc.fadeIn) fades.push(`fade=t=in:st=0:d=${sc.fadeIn}`);
  if (sc.fadeOut) fades.push(`fade=t=out:st=${(d - sc.fadeOut).toFixed(3)}:d=${sc.fadeOut}`);
  chains.push(`[${cur}]${fades.length ? fades.join(",") + "," : ""}format=yuv420p[out]`);
  const out = path.join(WORK, `${String(idx).padStart(2, "0")}-${sc.id}.mp4`);
  ff([...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", "-frames:v", String(frames), "-r", String(FPS), ...ENC, "-pix_fmt", "yuv420p", out]);
  return out;
}

function captionsFor(sc, start, narrSeconds) {
  // Split the narration into short lines and spread them over its length, by length of text.
  const parts = [];
  for (const sent of sc.say.match(/[^.!?]+[.!?]+/g) || [sc.say]) {
    let s = sent.trim();
    while (s.length > 84) { const cut = s.lastIndexOf(",", 84) > 30 ? s.lastIndexOf(",", 84) + 1 : s.lastIndexOf(" ", 84); parts.push(s.slice(0, cut).trim()); s = s.slice(cut).trim(); }
    if (s) parts.push(s);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  let t = start;
  return parts.map((text, i) => { const len = narrSeconds * text.length / total; const c = { i, text, a: t, b: t + len }; t += len; return c; });
}

(async () => {
  fs.mkdirSync(WORK, { recursive: true });
  const list = ONLY ? scenes.filter((s) => ONLY.includes(s.id)) : scenes;
  log("Narration:");
  const narr = {};
  for (const sc of list) { narr[sc.id] = narration(sc, path.join(WORK, "voice")); log(`  ${sc.id.padEnd(9)} ${narr[sc.id].seconds.toFixed(1).padStart(5)} s  (${narr[sc.id].source})`); }
  const sumN = list.reduce((s, sc) => s + narr[sc.id].seconds, 0);
  const tot = () => list.reduce((s, sc) => s + Math.max(sc.min || 3, PRE + narr[sc.id].seconds + POST), 0);
  if (!ONLY && tot() > MAX_TOTAL) { POST = 0.35; PRE = 0.25; }
  if (!ONLY && tot() > MAX_TOTAL) {
    const tempo = sumN / (MAX_TOTAL - list.length * (PRE + POST));
    if (tempo > 1.12) throw new Error(`The narration is ${sumN.toFixed(0)} s, too long for 3 minutes even slightly sped up. Shorten some lines in video/scenes.js.`);
    log(`Narration runs long; speeding the voice up ${((tempo - 1) * 100).toFixed(0)}% to fit 3:00.`);
    for (const sc of list) { const n = narr[sc.id], f2 = n.file.replace(/\.wav$/, ".fit.wav"); ff(["-i", n.file, "-af", `atempo=${tempo.toFixed(4)}`, f2]); n.file = f2; n.seconds = duration(f2); }
  }
  // Scene lengths and captions.
  let t = 0;
  const srt = [];
  const durs = list.map((sc) => {
    const d = Math.max(sc.min || 3, PRE + narr[sc.id].seconds + POST);
    sc._captions = captionsFor(sc, PRE, narr[sc.id].seconds);
    sc._captions.forEach((c) => srt.push({ a: t + c.a, b: t + c.b, text: c.text }));
    t += d;
    return d;
  });
  log(`Total length: ${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`);

  log("Scenes:");
  const files = [];
  for (let i = 0; i < list.length; i++) {
    const t0 = Date.now();
    files.push(await buildScene(list[i], durs[i], scenes.indexOf(list[i])));
    log(`  ${list[i].id.padEnd(9)} ${durs[i].toFixed(1)} s  built in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (browser) await browser.close();

  // Join the scenes, then lay the narration under them.
  const concat = path.join(WORK, "scenes.txt");
  fs.writeFileSync(concat, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n") + "\n");
  const silent = path.join(WORK, "video-silent.mp4");
  ff(["-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", silent]);
  const audioParts = [];
  list.forEach((sc, i) => {
    const a = path.join(WORK, "voice", sc.id + ".scene.wav");
    ff(["-i", narr[sc.id].file, "-af", `adelay=${Math.round(PRE * 1000)}:all=1,apad`, "-t", durs[i].toFixed(3), "-ar", "48000", "-ac", "1", a]);
    audioParts.push(a);
  });
  const voice = path.join(WORK, "narration.wav");
  ff([...audioParts.flatMap((a) => ["-i", a]), "-filter_complex", audioParts.map((_, i) => `[${i}:a]`).join("") + `concat=n=${audioParts.length}:v=0:a=1[a]`, "-map", "[a]", voice]);
  const music = ["mp3", "m4a", "wav"].map((e) => path.join(HERE, "music." + e)).find((f) => fs.existsSync(f));
  const final = path.join(OUT, ONLY ? `preview-${ONLY.join("-")}.mp4` : "citycenter-demo.mp4");
  if (music) {
    ff(["-i", silent, "-i", voice, "-stream_loop", "-1", "-i", music, "-filter_complex", `[2:a]volume=0.10,afade=t=in:d=2,afade=t=out:st=${(t - 3).toFixed(2)}:d=3,atrim=duration=${t.toFixed(3)}[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final]);
  } else {
    ff(["-i", silent, "-i", voice, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", final]);
  }
  if (!ONLY) fs.writeFileSync(path.join(OUT, "citycenter-demo.srt"), srt.map((c, i) => `${i + 1}\n${fmtT(c.a)} --> ${fmtT(c.b)}\n${c.text}\n`).join("\n"));
  log(`Done: ${final} (${duration(final).toFixed(1)} s)`);
})().catch(async (e) => { console.error("BUILD FAILED: " + e.message); if (browser) await browser.close(); process.exit(1); });
