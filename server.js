// citycenter server: the virtual city help desk (resident side) and the reviewer workspace (staff side). Plain Node, no packages.
// The Meta API key and the staff passcode live only in the server's environment. They never reach the browser.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
require("./lib/env").loadEnv();

const { loadTown } = require("./lib/townconfig");
const { loadCode } = require("./lib/codestore");
const { loadGis } = require("./lib/gis");
const { createTools } = require("./lib/tools");
const { openStore } = require("./lib/store");
const { createClient, MetaError } = require("./lib/meta");
const { runTurn } = require("./lib/desk");
const review = require("./lib/review");
const { validateImage } = require("./lib/sketch");
const signature = require("./lib/signature");
const crypto = require("crypto");
const sec = require("./lib/security");

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.META_MODEL || "muse-spark-1.3";
const REVIEW_MODEL = process.env.META_MODEL_REVIEW || MODEL;
const SECOND_READ_MODEL = process.env.META_MODEL_SECOND_READ || "muse-wonder-1.0";
const DAILY_CAP = Number(process.env.DAILY_CALL_CAP || 400);
const STAFF_PASSCODE = process.env.STAFF_PASSCODE || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const PUBLIC_DIR = path.join(__dirname, "public");

const MAX_JSON_BYTES = 64 * 1024;
const MAX_SUBMIT_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 6000;
const MAX_CONCURRENT_RUNS = 4;

const town = loadTown();
const code = loadCode(town);
const gis = loadGis(town);
const { tools } = createTools({ code, gis, town });
const store = openStore(null, { refPrefix: town.refPrefix });
const client = createClient({ model: MODEL, onUsage: (u) => store.logUsage(u), canCall: () => store.callsToday().n < DAILY_CAP });
const ctx = { store, client, town, code, gis, tools, model: MODEL };
const REF_RE = new RegExp(`^${town.refPrefix}-\\d{4}-\\d{4}$`);
// A visit code is the reference plus the access key in one string, e.g. HC-2026-0107-xzUHULux. Residents type only that.
const VISIT_CODE_RE = new RegExp(`^(${town.refPrefix}-\\d{4}-\\d{4})-([A-Za-z0-9_-]{6,})$`);
const DEMO = fs.existsSync(path.join(__dirname, "data", "demo.json")) ? JSON.parse(fs.readFileSync(path.join(__dirname, "data", "demo.json"), "utf8")) : { examples: [] };

const submitLimiter = sec.createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });
const messageLimiter = sec.createRateLimiter({ limit: 120, windowMs: 60 * 60 * 1000 });
const voiceLimiter = sec.createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });
const loginLimiter = sec.createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
const readLimiter = sec.createRateLimiter({ limit: 900, windowMs: 60 * 1000 });
let runningTurns = 0;
let citySvgCache = null;

// ---------- helpers ----------
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
const sendError = (res, status, message, extra) => sendJson(res, status, { error: message, ...(extra || {}) });
function errorFrom(e) {
  if (e instanceof MetaError) {
    if (e.code === "daily_cap") return [429, e.message];
    if (e.code === "no_key") return [500, e.message];
    return [502, e.message];
  }
  if (e && e.status === 413) return [413, "That upload is too large."];
  if (e && e.status === 400) return [400, e.message || "Bad request."];
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
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg" };
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
const staffConfigured = () => STAFF_PASSCODE.length >= 8 && COOKIE_SECRET.length >= 16;
function isStaff(req) {
  if (!staffConfigured()) return false;
  return sec.verifyStaffToken(sec.parseCookies(req.headers.cookie).cc_staff, COOKIE_SECRET);
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

// Resident accounts: optional. A signed-in resident's visits are listed under "My visits"; the reference
// code + access key still work on their own, so nothing requires an account.
const RESIDENT_COOKIE = "cc_resident";
function residentFromReq(req) {
  if (COOKIE_SECRET.length < 16) return null;
  const sub = sec.verifyToken(sec.parseCookies(req.headers.cookie)[RESIDENT_COOKIE], COOKIE_SECRET);
  const m = sub && sub.match(/^resident:(\d+)$/);
  if (!m) return null;
  return store.getResident(Number(m[1]));
}
function setResidentCookie(res, id, https) {
  res.setHeader("Set-Cookie", `${RESIDENT_COOKIE}=${sec.signToken(COOKIE_SECRET, "resident:" + id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${https ? "; Secure" : ""}`);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What the return letter was generated from: the point-by-point review plus the two summaries. When this changes,
// an unedited letter is regenerated the next time staff open step 4; an edited letter is frozen until they choose.
function reviewBasisHash(s) {
  const r = s.review || {};
  const basis = {
    states: Object.fromEntries(Object.entries(r.states || {}).map(([k, v]) => [k, [v.state, v.note || ""]])),
    ids: (r.considerations || []).map((c) => c.id),
    summary: r.submission_summary ? r.submission_summary.generated_at : null,
    code: r.code_summary ? r.code_summary.generated_at : null,
    docs: s.packet ? signature.docHash(s.packet) : null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(basis)).digest("hex");
}
function reviewMeta(s) {
  const letter = s.review && s.review.letter;
  const hash = reviewBasisHash(s);
  return { review_basis_hash: hash, letter_stale: !!(letter && letter.basis_hash !== hash), letter_decision_auto: review.deriveDecision(s) };
}
function publicSession(s, { staff }) {
  const out = { ...s };
  delete out.view_key;
  delete out.resident_id;
  if (!staff) {
    delete out.review;
    out.staff_actions = (s.staff_actions || []).filter((a) => a.action === "letter_saved").map((a) => ({ action: a.action, created_at: a.created_at, payload: a.payload }));
    if (out.research) out.research = { ...out.research, tool_log: (out.research.tool_log || []).map((t) => ({ tool: t.tool, summary: t.summary })) };
  } else {
    out.resident_link = `/?ref=${encodeURIComponent(s.ref)}&key=${encodeURIComponent(s.view_key)}`;
  }
  return out;
}

function startTurn(ref) {
  runningTurns++;
  runTurn(ref, ctx)
    .catch((e) => console.error(`[${ref}] turn failed: ${e.message}${e.body ? " | " + JSON.stringify(e.body).slice(0, 400) : ""}`))
    .finally(() => {
      runningTurns--;
    });
}

function parseImage(body, res) {
  if (!body.image || typeof body.image !== "object") return null;
  const mime = String(body.image.mime || "");
  let data;
  try {
    data = Buffer.from(String(body.image.base64 || ""), "base64");
  } catch {
    sendError(res, 400, "The image could not be read.");
    return false;
  }
  const problem = validateImage(mime, data);
  if (problem) {
    sendError(res, 400, problem);
    return false;
  }
  return { mime, data };
}

function townPublic() {
  return {
    name: town.name,
    shortName: town.shortName,
    state: town.state,
    county: town.county,
    refPrefix: town.refPrefix,
    departments: town.departments,
    processTiers: town.processTiers.map((t) => ({ id: t.id, label: t.label, decider: t.decider, resident: t.resident, sections: t.sections })),
    applicationTypes: town.applicationTypes,
    zones: Object.fromEntries(Object.entries(town.zones).map(([k, v]) => [k, { name: v.name, chapter: v.chapter, usesSection: v.usesSection, standardsSection: v.standardsSection, color: gis.zoneColor(k) }])),
    wording: town.wording,
    notes: town.notes,
    office: town.office || {},
    packetTypes: town.packetTypes || {},
    code: { citation: town.code.citation, bookUrl: town.code.bookUrl, sections: code.count, fetchedAt: code.meta.fetchedAt },
    gis: { counts: gis.counts, credits: gis.credits, fetchedAt: gis.fetchedAt },
    models: { desk: MODEL, review: REVIEW_MODEL, second_read: SECOND_READ_MODEL, voice: "muse-voice-transcribe-1.0", image: "muse-image-1.0" },
  };
}

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const ip = sec.clientIp(req);
  const https = sec.isHttps(req);
  sec.securityHeaders(res, https);
  const p = url.pathname;
  let m;

  if (req.method === "GET" && p === "/") return serveStatic(res, "index.html");
  if (req.method === "GET" && p === "/staff") return serveStatic(res, "staff.html");
  if (req.method === "GET" && p === "/favicon.ico") return serveStatic(res, "favicon.svg");
  if (req.method === "GET" && p.startsWith("/public/")) return serveStatic(res, p.slice("/public/".length));

  if (req.method === "GET" && p === "/api/health") {
    const u = store.callsToday();
    return sendJson(res, 200, { ok: true, town: town.name, model: MODEL, review_model: REVIEW_MODEL, calls_today: u.n, daily_cap: DAILY_CAP, staff_portal: staffConfigured(), code_sections: code.count, parcels: gis.counts.parcels });
  }
  if (req.method === "GET" && p === "/api/town") return sendJson(res, 200, townPublic());
  if (req.method === "GET" && p === "/api/demo") return sendJson(res, 200, DEMO);

  // Map and parcels (read-only, from the cached public layers)
  if (req.method === "GET" && p === "/api/map/city.svg") {
    if (!citySvgCache) citySvgCache = gis.renderSvg({ width: 1000, height: 750 });
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
    return res.end(citySvgCache);
  }
  m = p.match(/^\/api\/map\/parcel\/([^/]+)\.svg$/);
  if (req.method === "GET" && m) {
    if (!readLimiter.check(ip)) return sendError(res, 429, "Too many requests.");
    const id = decodeURIComponent(m[1]);
    if (!gis.getParcel(id)) return notFound(res);
    const meters = Math.min(600, Math.max(60, Number(url.searchParams.get("m") || 160)));
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" });
    return res.end(gis.renderSvg({ parcelId: id, meters, width: 1000, height: 750 }));
  }
  if (req.method === "GET" && p === "/api/parcels/lookup") {
    if (!readLimiter.check(ip)) return sendError(res, 429, "Too many requests.");
    const q = String(url.searchParams.get("q") || "").slice(0, 120);
    if (!q) return sendError(res, 400, "Give an address or parcel id in q.");
    const r = gis.locate({ address: q, parcelId: q });
    return sendJson(res, 200, { match: r.match, parcel: r.parcel, candidates: r.candidates });
  }
  m = p.match(/^\/api\/code\/sections\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const s = code.getSection(decodeURIComponent(m[1]));
    if (!s) return notFound(res);
    return sendJson(res, 200, { id: s.id, title: s.title, chapter: s.chapterName, titleName: s.titleName, url: s.url, text: s.text });
  }
  if (req.method === "GET" && p === "/api/code/search") {
    const q = String(url.searchParams.get("q") || "").slice(0, 200);
    if (!q) return sendError(res, 400, "Give a query in q.");
    return sendJson(res, 200, { results: code.search(q, { limit: 10, chapter: url.searchParams.get("chapter") || null }) });
  }

  // Voice: raw WAV body -> transcript (Muse Voice Transcribe)
  if (req.method === "POST" && p === "/api/voice/transcribe") {
    if (!voiceLimiter.check(ip)) return sendError(res, 429, "Too many voice requests. Please type instead for a while.");
    const buf = await sec.readBody(req, MAX_AUDIO_BYTES);
    if (buf.length < 1000 || buf.slice(0, 4).toString() !== "RIFF") return sendError(res, 400, "Expected a WAV recording.");
    try {
      const out = await client.transcribeWav(buf, { keywords: ["Hildale", "zoning", "parcel", "casita", "lot split", "variance", "rooster", "setback"] });
      return sendJson(res, 200, out);
    } catch (e) {
      const [s, msg] = errorFrom(e);
      return sendError(res, s, msg);
    }
  }

  // Resident: start a session
  if (req.method === "POST" && p === "/api/sessions") {
    if (!submitLimiter.check(ip)) return sendError(res, 429, "Too many new conversations from this connection. Please try again in an hour.");
    if (runningTurns >= MAX_CONCURRENT_RUNS) return sendError(res, 503, "The help desk is busy right now. Please try again in a minute.");
    const body = await readJson(req, MAX_SUBMIT_BYTES);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 2) return sendError(res, 400, "Say a few words about what you need.");
    if (text.length > MAX_TEXT_CHARS) return sendError(res, 400, `Please keep each message under ${MAX_TEXT_CHARS} characters.`);
    const sketch = parseImage(body, res);
    if (sketch === false) return;
    const demoId = typeof body.demo_id === "string" ? body.demo_id.slice(0, 60) : null;
    const resident = residentFromReq(req);
    const { ref, viewKey } = store.createSession({ town: town.id, text, sketch, demoId, residentId: resident ? resident.id : null });
    startTurn(ref);
    return sendJson(res, 202, { ref, view_key: viewKey });
  }

  // Resident: read, message, submit, sketch (view key required unless staff)
  m = p.match(/^\/api\/sessions\/([^/]+)(?:\/(messages|submit|sketch|packet|sign|signature))?$/);
  if (m) {
    if (!readLimiter.check(ip)) return sendError(res, 429, "Too many requests.");
    let ref = decodeURIComponent(m[1]).trim();
    const action = m[2];
    let key = url.searchParams.get("key") || "";
    const vc = ref.match(VISIT_CODE_RE);
    if (vc) {
      ref = vc[1];
      key = vc[2];
    }
    if (!REF_RE.test(ref)) return sendError(res, 404, "No visit with that code.");
    const s = store.getSession(ref);
    if (!s) return sendError(res, 404, "No visit with that code.");
    const staff = isStaff(req);
    if (!staff && !(key && sec.constantTimeEqual(key, s.view_key))) return sendError(res, 403, "That visit code is not complete. It looks like HC-2026-0107-xxxxxxxx: the reference plus the part after it.");
    if (req.method === "GET" && !action) {
      if (!staff && !s.resident_id) {
        const resident = residentFromReq(req);
        if (resident && store.claimSession(ref, resident.id)) s.resident_id = resident.id;
      }
      const sigCurrent = !!(s.signature && s.packet && s.signature.doc_hash === signature.docHash(s.packet));
      return sendJson(res, 200, { ...publicSession(s, { staff }), linked_to_account: !!s.resident_id, signature_current: sigCurrent, ...(staff ? {} : { visit_code: `${s.ref}-${s.view_key}` }) });
    }
    if (req.method === "GET" && action === "signature") {
      const img = store.getSignature(ref);
      if (!img) return notFound(res);
      res.writeHead(200, { "Content-Type": img.mime, "Cache-Control": "private, max-age=60", "Content-Length": img.data.length });
      return res.end(img.data);
    }
    if (req.method === "POST" && action === "sign") {
      // Electronic signature, bound to the documents as they stand right now.
      if (!messageLimiter.check(ip)) return sendError(res, 429, "Too many requests. Please slow down.");
      if (s.busy) return sendError(res, 409, "The desk is still working. Wait for the paperwork, then sign.");
      if (!s.packet || !s.packet.documents || !s.packet.documents.length || s.packet.packet_type === "referral") return sendError(res, 400, "There is no application to sign yet.");
      const body = await readJson(req, MAX_SUBMIT_BYTES);
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 120) : "";
      const method = body.method === "drawn" ? "drawn" : body.method === "typed" ? "typed" : "";
      if (name.length < 2) return sendError(res, 400, "Please type your full name.");
      if (!method) return sendError(res, 400, "Choose to draw or type your signature.");
      if (body.agree !== true) return sendError(res, 400, "Please tick the box to agree to sign electronically.");
      let data;
      let mime;
      if (method === "drawn") {
        let png;
        try {
          png = Buffer.from(String(body.png || "").replace(/^data:image\/png;base64,/, ""), "base64");
        } catch {
          return sendError(res, 400, "The drawn signature could not be read.");
        }
        if (!signature.isPng(png) || png.length > 300 * 1024) return sendError(res, 400, "The drawn signature must be a PNG under 300 KB.");
        data = png;
        mime = "image/png";
      } else {
        data = Buffer.from(signature.typedSignatureSvg(name), "utf8");
        mime = "image/svg+xml";
      }
      const meta = { name, method, signed_at: new Date().toISOString(), ip, user_agent: String(req.headers["user-agent"] || "").slice(0, 200), consent: signature.CONSENT_TEXT, doc_hash: signature.docHash(s.packet), documents: s.packet.documents.map((d) => d.name) };
      store.setSignature(ref, { data, mime, meta });
      return sendJson(res, 200, { ok: true, signed_at: meta.signed_at, name, method });
    }
    if (req.method === "GET" && action === "sketch") {
      const img = store.getSketch(ref);
      if (!img) return notFound(res);
      res.writeHead(200, { "Content-Type": img.mime, "Cache-Control": "private, max-age=600", "Content-Length": img.data.length });
      return res.end(img.data);
    }
    if (req.method === "POST" && action === "messages") {
      if (!messageLimiter.check(ip)) return sendError(res, 429, "Too many messages. Please slow down.");
      if (s.busy) return sendError(res, 409, "The desk is still working on your last message.");
      if (runningTurns >= MAX_CONCURRENT_RUNS) return sendError(res, 503, "The help desk is busy right now. Please try again in a minute.");
      const body = await readJson(req, MAX_SUBMIT_BYTES);
      const text = typeof body.text === "string" ? body.text.trim() : "";
      const sketch = parseImage(body, res);
      if (sketch === false) return;
      if (text.length < 1 && !sketch) return sendError(res, 400, "Type a message or attach a drawing.");
      if (text.length > MAX_TEXT_CHARS) return sendError(res, 400, `Please keep each message under ${MAX_TEXT_CHARS} characters.`);
      if (sketch) store.setSketch(ref, sketch);
      store.addMessage(ref, { role: "resident", text: text || "(attached a drawing)", has_sketch: !!sketch });
      startTurn(ref);
      return sendJson(res, 202, { ok: true });
    }
    if (req.method === "POST" && action === "packet") {
      // Resident edits their own packet directly (no model). Only field values and narratives can change.
      if (s.busy) return sendError(res, 409, "The desk is still working. Wait for it to finish, then edit.");
      if (!s.packet || !s.packet.documents) return sendError(res, 400, "There is no packet to edit yet.");
      if (s.packet.packet_type === "referral") return sendError(res, 409, "A referral has nothing to edit.");
      const body = await readJson(req, MAX_JSON_BYTES);
      if (!Array.isArray(body.documents) || body.documents.length !== s.packet.documents.length) return sendError(res, 400, "Send the same documents back with your edits.");
      const documents = s.packet.documents.map((d, i) => {
        const edit = body.documents[i] || {};
        const fields = (d.fields || []).map((f, j) => {
          const ef = (edit.fields || [])[j] || {};
          const value = typeof ef.value === "string" ? ef.value.slice(0, 2000) : f.value;
          return value === f.value ? f : { ...f, value, source: value ? "resident" : "blank" };
        });
        const narrative = typeof edit.narrative === "string" ? edit.narrative.slice(0, 12000) : d.narrative;
        return { ...d, fields, narrative };
      });
      store.updateSession(ref, { packet: { ...s.packet, documents, edited_by_resident_at: new Date().toISOString() }, ...(s.submitted_at ? { changed_since_submit: true } : {}) });
      return sendJson(res, 200, { ok: true, changed_since_submit: !!s.submitted_at });
    }
    if (req.method === "POST" && action === "submit") {
      if (s.busy) return sendError(res, 409, "The desk is still working. Wait for the packet, then submit.");
      if (!s.packet || !s.packet.documents || !s.packet.documents.length) return sendError(res, 400, "There is no prepared packet to submit yet.");
      if (!s.signature || s.signature.doc_hash !== signature.docHash(s.packet)) {
        res.writeHead(409, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ error: s.signature ? "The application changed since you signed it. Please sign the current version, then submit." : "Please sign the application first.", code: "needs_signature" }));
      }
      const ts = new Date().toISOString();
      if (s.submitted_at) {
        // Resubmit: the resident kept working after submitting and is sending the updated application.
        if (!s.changed_since_submit) return sendJson(res, 200, { ok: true, status: s.status, submitted_at: s.submitted_at, unchanged: true });
        const n = (s.resubmit_count || 0) + 1;
        store.updateSession(ref, { status: "submitted", submitted_at: ts, changed_since_submit: false, resubmit_count: n });
        store.addStaffAction(ref, { action: "resubmitted", note: `Resident resubmitted with updates (update ${n}).`, payload: { previous_status: s.status, previous_submitted_at: s.submitted_at } });
        store.addMessage(ref, { role: "desk", department: s.department, character: s.character, text: `Resubmitted with your updates (update ${n}). Your visit code is still ${ref}-${s.view_key}. The planning office will see the updated application and write back here.` });
        return sendJson(res, 200, { ok: true, status: "submitted", submitted_at: ts, resubmit_count: n });
      }
      store.updateSession(ref, { status: "submitted", submitted_at: ts, changed_since_submit: false });
      store.addMessage(ref, { role: "desk", department: s.department, character: s.character, text: `Submitted and signed by ${s.signature.name}. Your visit code is ${ref}-${s.view_key}; keep it to come back to this visit. The planning office will review it and write back here. You can keep talking to me or edit the paperwork; press Resubmit to send any updates.` });
      return sendJson(res, 200, { ok: true, status: "submitted", submitted_at: ts });
    }
    return notFound(res);
  }

  // Resident accounts (email + password). Google/Apple sign-in and password reset are listed in LOGIN-TODO.md.
  if (p.startsWith("/api/resident/")) {
    if (COOKIE_SECRET.length < 16) return sendError(res, 503, "Accounts are not set up on this server (COOKIE_SECRET is needed).");
    if (req.method === "POST" && p === "/api/resident/signup") {
      if (!loginLimiter.check(ip)) return sendError(res, 429, "Too many attempts. Please wait 15 minutes.");
      const body = await readJson(req, MAX_JSON_BYTES);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      const password = typeof body.password === "string" ? body.password : "";
      const password2 = typeof body.password2 === "string" ? body.password2 : "";
      if (!EMAIL_RE.test(email) || email.length > 200) return sendError(res, 400, "Please enter a valid email address.");
      if (password.length < 8) return sendError(res, 400, "Use a password of at least 8 characters.");
      if (password !== password2) return sendError(res, 400, "The two passwords do not match.");
      if (store.getResidentByEmail(email)) return sendError(res, 409, "There is already an account with that email. Sign in instead.");
      const { salt, hash } = sec.hashPassword(password);
      const id = store.createResident({ email, name, passHash: hash, passSalt: salt });
      setResidentCookie(res, id, https);
      return sendJson(res, 201, { ok: true, email, name });
    }
    if (req.method === "POST" && p === "/api/resident/login") {
      if (!loginLimiter.check(ip)) return sendError(res, 429, "Too many sign-in attempts. Please wait 15 minutes.");
      const body = await readJson(req, MAX_JSON_BYTES);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const r = store.getResidentByEmail(email);
      // Same answer whether the email or the password is wrong.
      if (!r || !sec.verifyPassword(password, r.pass_salt, r.pass_hash)) return sendError(res, 401, "That email and password do not match an account.");
      store.touchResident(r.id);
      setResidentCookie(res, r.id, https);
      return sendJson(res, 200, { ok: true, email: r.email, name: r.name });
    }
    if (req.method === "POST" && p === "/api/resident/logout") {
      res.setHeader("Set-Cookie", `${RESIDENT_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "GET" && p === "/api/resident/me") {
      const r = residentFromReq(req);
      if (!r) return sendJson(res, 200, { signed_in: false });
      return sendJson(res, 200, { signed_in: true, email: r.email, name: r.name, visits: store.listResidentSessions(r.id) });
    }
    return notFound(res);
  }

  // Staff: session
  if (req.method === "POST" && p === "/api/staff/login") {
    if (!staffConfigured()) return sendError(res, 503, "The staff portal is not set up on this server yet.");
    if (!loginLimiter.check(ip)) return sendError(res, 429, "Too many sign-in attempts. Please wait 15 minutes.");
    const body = await readJson(req, MAX_JSON_BYTES);
    const pass = typeof body.passcode === "string" ? body.passcode : "";
    if (!pass || !sec.constantTimeEqual(pass, STAFF_PASSCODE)) return sendError(res, 401, "That passcode is not right.");
    res.setHeader("Set-Cookie", `cc_staff=${sec.signStaffToken(COOKIE_SECRET)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${https ? "; Secure" : ""}`);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && p === "/api/staff/logout") {
    res.setHeader("Set-Cookie", "cc_staff=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "GET" && p === "/api/staff/me") {
    if (!staffConfigured()) return sendError(res, 503, "The staff portal is not set up on this server yet.");
    return isStaff(req) ? sendJson(res, 200, { ok: true, review_model: REVIEW_MODEL, second_read_model: SECOND_READ_MODEL }) : sendError(res, 401, "Not signed in.");
  }

  if (p.startsWith("/api/staff/")) {
    if (!requireStaff(req, res)) return;
    if (req.method === "GET" && p === "/api/staff/diag") {
      // What can this host reach? Never echoes the key (prefix and length only).
      return sendJson(res, 200, { ...(await client.diagnose()), env_model: process.env.META_MODEL || null, node: process.version, data_dir: store.dir });
    }
    if (req.method === "POST" && p === "/api/staff/purge-demo") {
      // Removes conversations that were started from the worked examples (demo_id set), so the queue can be re-seeded.
      const victims = store.listSessions().filter((x) => x.demo_id && !x.busy);
      let n = 0;
      for (const v of victims) if (store.deleteSession(v.ref)) n++;
      return sendJson(res, 200, { ok: true, deleted: n });
    }
    if (req.method === "GET" && p === "/api/staff/queue") {
      return sendJson(res, 200, { sessions: store.listSessions(), usage_today: store.callsToday(), daily_cap: DAILY_CAP });
    }
    m = p.match(/^\/api\/staff\/sessions\/([^/]+)(?:\/(considerations|consideration|ask|second-read|summary|code-summary|letter\/generate|letter\/edit|letter\/draft|letter|status|rerun))?$/);
    if (!m) return notFound(res);
    const ref = decodeURIComponent(m[1]);
    const action = m[2];
    if (!REF_RE.test(ref)) return sendError(res, 404, "No conversation with that reference code.");
    const s = store.getSession(ref);
    if (!s) return sendError(res, 404, "No conversation with that reference code.");
    if (req.method === "GET" && !action) return sendJson(res, 200, { ...publicSession(s, { staff: true }), ...reviewMeta(s) });
    try {
      if (req.method === "POST" && action === "summary") {
        if (s.busy) return sendError(res, 409, "The resident-side desk is still working on this one.");
        const out = await review.summarizeSubmission(client, s, { town, model: REVIEW_MODEL });
        store.setReviewPart(ref, "submission_summary", out);
        store.addStaffAction(ref, { action: "summary_built", payload: { model: out.model, bullets: out.bullets.length } });
        return sendJson(res, 200, { submission_summary: out });
      }
      if (req.method === "POST" && action === "code-summary") {
        if (s.busy) return sendError(res, 409, "The resident-side desk is still working on this one.");
        const out = await review.summarizeCode(client, s, { town, code, model: REVIEW_MODEL });
        store.setReviewPart(ref, "code_summary", out);
        store.addStaffAction(ref, { action: "code_summary_built", payload: { model: out.model, sections: out.sections.length } });
        return sendJson(res, 200, { code_summary: out });
      }
      if (req.method === "POST" && action === "letter/generate") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const mode = body.mode === "keep_manual" ? "keep_manual" : "regenerate";
        const derived = review.deriveDecision(s);
        const decision = review.DECISIONS[body.decision] ? String(body.decision) : derived.decision;
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";
        const current = s.review && s.review.letter ? s.review.letter : null;
        const letter = await review.generateLetter(client, s, { decision, staffNote: note, mode, current: mode === "keep_manual" ? current : null, town, code, model: REVIEW_MODEL });
        const stored = { subject: letter.subject, body: letter.body, decision, decision_auto: !review.DECISIONS[body.decision], decision_why: derived.why, note, model: letter.model, generated_at: letter.generated_at, basis_hash: reviewBasisHash(s), edited: false, edited_at: null, sent_at: current && current.sent_at ? current.sent_at : null };
        store.setReviewPart(ref, "letter", stored);
        store.addStaffAction(ref, { action: "letter_generated", payload: { decision, mode, model: letter.model } });
        return sendJson(res, 200, { letter: stored, ...reviewMeta(store.getSession(ref)) });
      }
      if (req.method === "POST" && action === "letter/edit") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) : "";
        const text = typeof body.body === "string" ? body.body.slice(0, 12000) : "";
        const prev = (s.review && s.review.letter) || {};
        const stored = { ...prev, subject, body: text, edited: true, edited_at: new Date().toISOString(), decision: review.DECISIONS[body.decision] ? String(body.decision) : prev.decision || "request_info", decision_auto: review.DECISIONS[body.decision] ? false : prev.decision_auto };
        store.setReviewPart(ref, "letter", stored);
        return sendJson(res, 200, { letter: stored, ...reviewMeta(store.getSession(ref)) });
      }
      if (req.method === "POST" && action === "considerations") {
        if (s.busy) return sendError(res, 409, "The resident-side desk is still working on this one.");
        const out = await review.buildConsiderations(client, s, { town, code, tools, model: REVIEW_MODEL });
        store.saveReview(ref, out, out.model);
        store.addStaffAction(ref, { action: "considerations_built", payload: { model: out.model, count: out.considerations.length } });
        return sendJson(res, 200, { review: store.getSession(ref).review });
      }
      if (req.method === "POST" && action === "consideration") {
        const body = await readJson(req, MAX_JSON_BYTES);
        if (body.add && typeof body.add === "object") {
          const title = String(body.add.title || "").trim().slice(0, 200);
          if (!title) return sendError(res, 400, "A consideration needs a title.");
          const id = "staff-" + Date.now().toString(36);
          store.addConsideration(ref, { id, title, kind: "policy", sections: [], requirement: String(body.add.requirement || "").slice(0, 1000), quote: "", quote_verified: false, evidence_in_packet: "", document_reading: "cannot_verify", how_to_verify: String(body.add.how_to_verify || "").slice(0, 1000), note: "", added_by: "staff", section_links: [] });
          return sendJson(res, 200, { review: store.getSession(ref).review });
        }
        const id = String(body.id || "");
        const state = String(body.state || "");
        if (!["not_started", "met", "not_met", "cannot_verify", "not_applicable", "staff_note"].includes(state)) return sendError(res, 400, "Unknown state.");
        const states = store.setReviewState(ref, id, { state, note: typeof body.note === "string" ? body.note.slice(0, 2000) : "" });
        return sendJson(res, 200, { states });
      }
      if (req.method === "POST" && action === "ask") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const question = String(body.question || "").trim().slice(0, 2000);
        if (!question) return sendError(res, 400, "Ask a question.");
        const out = await review.askStaff(client, s, { question, considerationId: body.consideration_id || null, town, code, tools, model: REVIEW_MODEL });
        store.addStaffAction(ref, { action: "asked", note: question, payload: out });
        return sendJson(res, 200, out);
      }
      if (req.method === "POST" && action === "second-read") {
        if (!s.review) return sendError(res, 400, "Build the considerations first.");
        const out = await review.secondRead(client, s, { town, code, model: SECOND_READ_MODEL });
        store.setSecondRead(ref, out);
        store.addStaffAction(ref, { action: "second_read", payload: { model: out.model, missed: out.missed.length, overstated: out.overstated.length } });
        return sendJson(res, 200, out);
      }
      if (req.method === "POST" && action === "letter/draft") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const decision = String(body.decision || "");
        if (!review.DECISIONS[decision]) return sendError(res, 400, "Choose a kind of letter.");
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";
        if (decision === "answer" && note.length < 10) return sendError(res, 400, "For an answer letter, write the answer in the note; the agent only formats your words.");
        const letter = await review.draftLetter(client, s, { decision, staffNote: note, town, code, model: REVIEW_MODEL });
        store.addStaffAction(ref, { action: "letter_drafted", note, payload: { decision, model: letter.model } });
        return sendJson(res, 200, { letter });
      }
      if (req.method === "POST" && action === "letter") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const stored = (s.review && s.review.letter) || {};
        const subject = (typeof body.subject === "string" ? body.subject : stored.subject || "").trim().slice(0, 300);
        const text = (typeof body.body === "string" ? body.body : stored.body || "").trim().slice(0, 12000);
        const decision = review.DECISIONS[body.decision] ? String(body.decision) : stored.decision || "";
        if (!subject || !text) return sendError(res, 400, "The letter needs a subject and a body.");
        const next = { request_info: "needs_info", accept_complete: "in_review", answer: "answered", refer: "referred" }[decision] || s.status;
        store.addStaffAction(ref, { action: "letter_saved", payload: { subject, body: text, decision } });
        store.updateSession(ref, { status: next });
        store.addMessage(ref, { role: "desk", department: "planning", character: "Planning & Zoning staff", text: `${subject}\n\n${text}`, letter: true });
        if (s.review) store.setReviewPart(ref, "letter", { ...stored, subject, body: text, decision, sent_at: new Date().toISOString() });
        return sendJson(res, 200, { ok: true, status: next });
      }
      if (req.method === "POST" && action === "status") {
        const body = await readJson(req, MAX_JSON_BYTES);
        const status = String(body.status || "");
        if (!["submitted", "needs_info", "in_review", "answered", "referred"].includes(status)) return sendError(res, 400, "Unknown status.");
        store.updateSession(ref, { status });
        store.addStaffAction(ref, { action: "status_set", note: status });
        return sendJson(res, 200, { ok: true, status });
      }
      if (req.method === "POST" && action === "rerun") {
        if (s.busy) return sendError(res, 409, "Already running.");
        if (runningTurns >= MAX_CONCURRENT_RUNS) return sendError(res, 503, "Busy. Try again in a minute.");
        startTurn(ref);
        return sendJson(res, 202, { ok: true });
      }
    } catch (e) {
      const [st, msg] = errorFrom(e);
      if (st === 500) console.error(e);
      return sendError(res, st, msg);
    }
    return notFound(res);
  }

  return notFound(res);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const [status, message] = errorFrom(e);
    if (status === 500) console.error(e);
    if (!res.headersSent) sendError(res, status, message);
    else res.end();
  });
});

server.listen(PORT, () => {
  console.log(`citycenter (${town.name}) running at http://localhost:${PORT}`);
  console.log(`Code: ${code.count} sections from ${code.meta.source} (${code.meta.fetchedAt}); parcels ${gis.counts.parcels}, zoning polygons ${gis.counts.zones}`);
  console.log(`Model: ${MODEL} (review: ${REVIEW_MODEL}, second read: ${SECOND_READ_MODEL}) ${process.env.MODEL_API_KEY ? "key found" : "NO KEY: add MODEL_API_KEY to .env"}`);
  console.log(`Staff portal: ${staffConfigured() ? "enabled at /staff" : "disabled (set STAFF_PASSCODE and COOKIE_SECRET)"}; data in ${store.dir}`);
});
