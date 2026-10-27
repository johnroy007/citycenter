// citycenter server: resident flow + staff portal. Plain Node, no packages.
// The Meta API key and the staff passcode live only in the server's environment. They never reach the browser.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
require("./lib/env").loadEnv();

const { openStore } = require("./lib/store");
const { createClient, MetaError } = require("./lib/meta");
const { runResidentFlow } = require("./lib/pipeline");
const { preReview, draftLetter } = require("./lib/review");
const { validateImage } = require("./lib/sketch");
const town = require("./lib/town");
const sec = require("./lib/security");

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.META_MODEL || "muse-spark-1.3";
const REVIEW_MODEL = process.env.META_MODEL_REVIEW || MODEL;
const DAILY_CAP = Number(process.env.DAILY_CALL_CAP || 400);
const STAFF_PASSCODE = process.env.STAFF_PASSCODE || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_JSON_BYTES = 64 * 1024; // ordinary JSON requests
const MAX_SUBMIT_BYTES = 8 * 1024 * 1024; // submission with a base64 image
const MAX_TEXT_CHARS = 6000;
const MAX_CONCURRENT_RUNS = 4;
const REF_RE = /^SC-\d{4}-\d{4}$/;

const store = openStore();
const client = createClient({
  model: MODEL,
  onUsage: (u) => store.logUsage(u),
  canCall: () => store.callsToday().n < DAILY_CAP,
});

const submitLimiter = sec.createRateLimiter({ limit: 20, windowMs: 60 * 60 * 1000 });
const loginLimiter = sec.createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
const readLimiter = sec.createRateLimiter({ limit: 600, windowMs: 60 * 1000 });
let runningFlows = 0;

// ---------- helpers ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function sendError(res, status, message, extra) {
  sendJson(res, status, { error: message, ...(extra || {}) });
}
function errorFrom(e) {
  if (e instanceof MetaError) {
    if (e.code === "daily_cap") return [429, e.message];
    if (e.code === "no_key") return [500, e.message];
    return [502, e.message];
  }
  if (e && e.status === 413) return [413, "That upload is too large."];
  return [500, "Something went wrong on the server."];
}

async function readJson(req, maxBytes) {
  const buf = await sec.readBody(req, maxBytes);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    const e = new Error("Bad JSON");
    e.status = 400;
    throw e;
  }
}

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
function serveStatic(res, rel) {
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) return notFound(res);
  const ext = path.extname(full).toLowerCase();
  const type = STATIC_TYPES[ext];
  if (!type || !fs.existsSync(full) || !fs.statSync(full).isFile()) return notFound(res);
  res.writeHead(200, { "Content-Type": type, "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300" });
  fs.createReadStream(full).pipe(res);
}
function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function staffConfigured() {
  return STAFF_PASSCODE.length >= 8 && COOKIE_SECRET.length >= 16;
}
function isStaff(req) {
  if (!staffConfigured()) return false;
  const cookies = sec.parseCookies(req.headers.cookie);
  return sec.verifyStaffToken(cookies.cc_staff, COOKIE_SECRET);
}
function requireStaff(req, res) {
  if (!staffConfigured()) {
    sendError(res, 503, "The staff portal is not set up on this server yet (STAFF_PASSCODE and COOKIE_SECRET are needed).");
    return false;
  }
  if (!isStaff(req)) {
    sendError(res, 401, "Please sign in to the staff portal.");
    return false;
  }
  return true;
}

function publicApp(app, { staff }) {
  const out = { ...app };
  delete out.view_key;
  if (!staff) {
    // Residents see only saved letters, not staff notes or draft letters.
    out.staff_actions = (app.staff_actions || []).filter((a) => a.action === "letter_saved").map((a) => ({ action: a.action, created_at: a.created_at, payload: a.payload }));
    delete out.prereview;
  } else {
    out.resident_link = `/?ref=${encodeURIComponent(app.ref)}&key=${encodeURIComponent(app.view_key)}`;
  }
  return out;
}

function startFlow(ref) {
  runningFlows++;
  runResidentFlow(ref, { store, client, model: MODEL })
    .catch((e) => console.error(`[${ref}] pipeline failed: ${e.message}`))
    .finally(() => {
      runningFlows--;
    });
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const ip = sec.clientIp(req);
  const https = sec.isHttps(req);
  sec.securityHeaders(res, https);
  const p = url.pathname;

  // Pages and static files
  if (req.method === "GET" && p === "/") return serveStatic(res, "index.html");
  if (req.method === "GET" && p === "/staff") return serveStatic(res, "staff.html");
  if (req.method === "GET" && p === "/favicon.ico") return serveStatic(res, "favicon.svg");
  if (req.method === "GET" && p.startsWith("/public/")) return serveStatic(res, p.slice("/public/".length));

  if (req.method === "GET" && p === "/api/health") {
    const u = store.callsToday();
    return sendJson(res, 200, { ok: true, model: MODEL, review_model: REVIEW_MODEL, calls_today: u.n, daily_cap: DAILY_CAP, staff_portal: staffConfigured() });
  }
  if (req.method === "GET" && p === "/api/town") {
    return sendJson(res, 200, { code: town.code, checklist: town.checklist });
  }

  // Resident: submit
  if (req.method === "POST" && p === "/api/applications") {
    if (!submitLimiter.check(ip)) return sendError(res, 429, "Too many submissions from this connection. Please try again in an hour.");
    if (runningFlows >= MAX_CONCURRENT_RUNS) return sendError(res, 503, "The assistant is busy right now. Please try again in a minute.");
    const body = await readJson(req, MAX_SUBMIT_BYTES);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 20) return sendError(res, 400, "Please describe what you want to do in a sentence or two.");
    if (text.length > MAX_TEXT_CHARS) return sendError(res, 400, `Please keep the description under ${MAX_TEXT_CHARS} characters.`);
    let sketch = null;
    if (body.image && typeof body.image === "object") {
      const mime = String(body.image.mime || "");
      let data;
      try {
        data = Buffer.from(String(body.image.base64 || ""), "base64");
      } catch {
        return sendError(res, 400, "The image could not be read.");
      }
      const problem = validateImage(mime, data);
      if (problem) return sendError(res, 400, problem);
      sketch = { mime, data };
    }
    const { ref, viewKey } = store.createApplication({ requestText: text, sketch });
    startFlow(ref);
    return sendJson(res, 202, { ref, view_key: viewKey });
  }

  // Resident: read (needs the view key) and sketch image
  let m = p.match(/^\/api\/applications\/([^/]+)(\/sketch)?$/);
  if (req.method === "GET" && m) {
    if (!readLimiter.check(ip)) return sendError(res, 429, "Too many requests.");
    const ref = decodeURIComponent(m[1]);
    if (!REF_RE.test(ref)) return sendError(res, 404, "No application with that reference code.");
    const app = store.getApplication(ref);
    if (!app) return sendError(res, 404, "No application with that reference code.");
    const staff = isStaff(req);
    const key = url.searchParams.get("key") || "";
    if (!staff && !(key && sec.constantTimeEqual(key, app.view_key))) return sendError(res, 403, "That reference code needs its access key. Use the link you were given.");
    if (m[2]) {
      const img = store.getSketch(ref);
      if (!img) return notFound(res);
      res.writeHead(200, { "Content-Type": img.mime, "Cache-Control": "private, max-age=600", "Content-Length": img.data.length });
      return res.end(img.data);
    }
    return sendJson(res, 200, publicApp(app, { staff }));
  }

  // Staff: session
  if (req.method === "POST" && p === "/api/staff/login") {
    if (!staffConfigured()) return sendError(res, 503, "The staff portal is not set up on this server yet.");
    if (!loginLimiter.check(ip)) return sendError(res, 429, "Too many sign-in attempts. Please wait 15 minutes.");
    const body = await readJson(req, MAX_JSON_BYTES);
    const pass = typeof body.passcode === "string" ? body.passcode : "";
    if (!pass || !sec.constantTimeEqual(pass, STAFF_PASSCODE)) return sendError(res, 401, "That passcode is not right.");
    const token = sec.signStaffToken(COOKIE_SECRET);
    res.setHeader("Set-Cookie", `cc_staff=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${https ? "; Secure" : ""}`);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/staff/logout") {
    res.setHeader("Set-Cookie", "cc_staff=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && p === "/api/staff/me") {
    if (!staffConfigured()) return sendError(res, 503, "The staff portal is not set up on this server yet.");
    return isStaff(req) ? sendJson(res, 200, { ok: true, review_model: REVIEW_MODEL }) : sendError(res, 401, "Not signed in.");
  }

  // Staff: queue and actions
  if (p.startsWith("/api/staff/")) {
    if (!requireStaff(req, res)) return;
    if (req.method === "GET" && p === "/api/staff/queue") {
      const u = store.callsToday();
      return sendJson(res, 200, { applications: store.listApplications(), usage_today: u, daily_cap: DAILY_CAP });
    }
    m = p.match(/^\/api\/staff\/applications\/([^/]+)(?:\/(prereview|decision|letter|rerun))?$/);
    if (m) {
      const ref = decodeURIComponent(m[1]);
      if (!REF_RE.test(ref)) return sendError(res, 404, "No application with that reference code.");
      const app = store.getApplication(ref);
      if (!app) return sendError(res, 404, "No application with that reference code.");
      const action = m[2];
      if (req.method === "GET" && !action) return sendJson(res, 200, publicApp(app, { staff: true }));
      if (req.method === "POST" && action === "prereview") {
        if (app.status === "processing") return sendError(res, 409, "The resident flow is still running for this application.");
        try {
          const out = await preReview(client, app, { model: REVIEW_MODEL });
          store.savePrereview(ref, out, out.model);
          store.addStaffAction(ref, { action: "prereview_run", payload: { model: out.model, counts: out.counts } });
          return sendJson(res, 200, { prereview: out });
        } catch (e) {
          const [s, msg] = errorFrom(e);
          return sendError(res, s, msg);
        }
      }
      if (req.method === "POST" && action === "decision") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const decision = body.decision === "request_info" || body.decision === "move_to_review" ? body.decision : null;
        if (!decision) return sendError(res, 400, "Choose 'request more information' or 'move to Planning Commission review'.");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
        try {
          const letter = await draftLetter(client, app, { decision, staffNote: note, model: REVIEW_MODEL });
          store.updateApplication(ref, { status: decision === "request_info" ? "needs_info" : "in_review" });
          store.addStaffAction(ref, { action: decision, note, payload: { draft_letter: letter } });
          return sendJson(res, 200, { letter, status: decision === "request_info" ? "needs_info" : "in_review" });
        } catch (e) {
          const [s, msg] = errorFrom(e);
          return sendError(res, s, msg);
        }
      }
      if (req.method === "POST" && action === "letter") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) : "";
        const text = typeof body.body === "string" ? body.body.trim().slice(0, 8000) : "";
        if (!subject || !text) return sendError(res, 400, "The letter needs a subject and a body.");
        store.addStaffAction(ref, { action: "letter_saved", payload: { subject, body: text, decision: body.decision || null } });
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === "POST" && action === "rerun") {
        if (app.status === "processing") return sendError(res, 409, "Already running.");
        if (runningFlows >= MAX_CONCURRENT_RUNS) return sendError(res, 503, "Busy. Try again in a minute.");
        store.updateApplication(ref, { status: "processing", error: null });
        startFlow(ref);
        return sendJson(res, 202, { ok: true });
      }
    }
    return notFound(res);
  }

  return notFound(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const [status, message] = errorFrom(e);
    if (status === 500) console.error(e);
    if (!res.headersSent) sendError(res, e && e.status === 400 ? 400 : status, e && e.status === 400 ? "Bad request." : message);
    else res.end();
  });
});

server.listen(PORT, () => {
  console.log(`citycenter running at http://localhost:${PORT}`);
  console.log(`Model: ${MODEL} (review: ${REVIEW_MODEL}) ${process.env.MODEL_API_KEY ? "key found" : "NO KEY: add MODEL_API_KEY to .env"}`);
  console.log(`Staff portal: ${staffConfigured() ? "enabled at /staff" : "disabled (set STAFF_PASSCODE and COOKIE_SECRET)"}; data in ${store.dir}`);
});
