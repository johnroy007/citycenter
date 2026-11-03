// A small local page for recording the narration, one line at a time, and rebuilding the video.
// Run: node video/recorder.js   then open http://localhost:3100   (only reachable from this computer)
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { VOICE_DIR, recordingFor } = require("./lib/media");

const PORT = Number(process.env.PORT || 3100);
const HERE = __dirname;
const loadScenes = () => { delete require.cache[require.resolve("./scenes")]; return require("./scenes"); };
const VIDEO = path.join(HERE, "out", "citycenter-demo.mp4");
let build = { running: false, log: "", code: null, started: null };

function send(res, code, type, body) { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(body); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ids = loadScenes().map((s) => s.id);
  if (req.method === "GET" && url.pathname === "/") return send(res, 200, "text/html; charset=utf-8", fs.readFileSync(path.join(HERE, "record.html")));
  if (req.method === "GET" && url.pathname === "/scenes") {
    const voiceWork = path.join(HERE, "out", "build", "voice");
    const list = loadScenes().map((s) => {
      const rec = recordingFor(s.id);
      return { id: s.id, say: s.say, title: s.title || null, part: s.art ? "Opening: the problem" : s.card ? "Closing" : /^staff/.test(s.id) ? "Staff side" : "Resident side", recorded: !!rec, updated: rec ? fs.statSync(rec).mtimeMs : null, guide: fs.existsSync(path.join(voiceWork, s.id + ".tts.wav")) };
    });
    return send(res, 200, "application/json", JSON.stringify({ scenes: list, voiceDir: VOICE_DIR, video: fs.existsSync(VIDEO) ? fs.statSync(VIDEO).mtimeMs : null }));
  }
  const m = url.pathname.match(/^\/(voice|guide|save|delete)\/([a-z0-9-]+)$/);
  if (m && ids.includes(m[2])) {
    const id = m[2];
    if (m[1] === "voice") { const f = recordingFor(id); return f ? send(res, 200, f.endsWith(".wav") ? "audio/wav" : "audio/webm", fs.readFileSync(f)) : send(res, 404, "text/plain", "none"); }
    if (m[1] === "guide") { const f = path.join(HERE, "out", "build", "voice", id + ".tts.wav"); return fs.existsSync(f) ? send(res, 200, "audio/wav", fs.readFileSync(f)) : send(res, 404, "text/plain", "none"); }
    if (req.method === "POST" && m[1] === "save") {
      const chunks = []; for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length < 2000 || buf.length > 20e6) return send(res, 400, "text/plain", "recording too short or too long");
      fs.mkdirSync(VOICE_DIR, { recursive: true });
      const old = recordingFor(id); if (old) fs.rmSync(old);
      fs.writeFileSync(path.join(VOICE_DIR, id + ".webm"), buf);
      return send(res, 200, "application/json", "{\"ok\":true}");
    }
    if (req.method === "POST" && m[1] === "delete") { const old = recordingFor(id); if (old) fs.rmSync(old); return send(res, 200, "application/json", "{\"ok\":true}"); }
  }
  if (req.method === "POST" && url.pathname === "/build") {
    if (build.running) return send(res, 409, "text/plain", "already building");
    build = { running: true, log: "", code: null, started: Date.now() };
    const p = spawn(process.execPath, [path.join(HERE, "build.js"), ...(url.searchParams.get("draft") ? ["--draft"] : [])], { cwd: path.join(HERE, "..") });
    p.stdout.on("data", (d) => (build.log += d)); p.stderr.on("data", (d) => (build.log += d));
    p.on("close", (code) => { build.running = false; build.code = code; });
    return send(res, 200, "application/json", "{\"ok\":true}");
  }
  if (req.method === "GET" && url.pathname === "/build") return send(res, 200, "application/json", JSON.stringify(build));
  if (req.method === "GET" && url.pathname === "/video.mp4" && fs.existsSync(VIDEO)) {
    const size = fs.statSync(VIDEO).size, range = req.headers.range;
    if (range) {
      const [a, b] = range.replace("bytes=", "").split("-"); const start = Number(a), end = b ? Number(b) : size - 1;
      res.writeHead(206, { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
      return fs.createReadStream(VIDEO, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": "video/mp4", "content-length": size, "accept-ranges": "bytes" });
    return fs.createReadStream(VIDEO).pipe(res);
  }
  send(res, 404, "text/plain", "not found");
});
server.listen(PORT, "127.0.0.1", () => console.log(`Narration recorder: http://localhost:${PORT}  (recordings go to ${VOICE_DIR})`));
