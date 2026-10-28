// Storage: one SQLite file (Node's built-in node:sqlite). Help-desk sessions, pipeline steps, staff reviews, usage.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  ref TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  busy INTEGER NOT NULL DEFAULT 0,
  view_key TEXT NOT NULL DEFAULT '',
  town TEXT,
  department TEXT,
  character TEXT,
  messages TEXT NOT NULL DEFAULT '[]',
  sketch_mime TEXT,
  sketch_data BLOB,
  understanding TEXT,
  parcel TEXT,
  owner TEXT,
  research TEXT,
  packet TEXT,
  submitted_at TEXT,
  error TEXT,
  demo_id TEXT
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(ref, name)
);
CREATE TABLE IF NOT EXISTS staff_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  ref TEXT PRIMARY KEY,
  model TEXT,
  considerations TEXT NOT NULL,
  states TEXT NOT NULL DEFAULT '{}',
  second_read TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  day TEXT NOT NULL,
  tag TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS usage_day ON usage_log(day);
CREATE TABLE IF NOT EXISTS residents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
`;
// Columns added after the first release; added to existing databases on open.
const SESSION_COLUMNS_ADDED = [
  ["resident_id", "INTEGER"],
  ["changed_since_submit", "INTEGER NOT NULL DEFAULT 0"],
  ["resubmit_count", "INTEGER NOT NULL DEFAULT 0"],
  ["pending_handoff", "TEXT"],
  ["signature_data", "BLOB"],
  ["signature_mime", "TEXT"],
  ["signature_meta", "TEXT"],
];

const STATUSES = ["open", "ready", "referred", "submitted", "needs_info", "in_review", "answered", "error"];

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const j = (v) => (v == null ? null : JSON.stringify(v));
function p(v) {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function openStore(dataDir, { refPrefix = "HC" } = {}) {
  const dir = dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data", "runtime");
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "citycenter.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  const have = new Set(db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name));
  for (const [name, type] of SESSION_COLUMNS_ADDED) if (!have.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);

  const q = {
    insert: db.prepare("INSERT INTO sessions (ref, created_at, updated_at, status, view_key, town, messages, sketch_mime, sketch_data, demo_id, resident_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    get: db.prepare(
      "SELECT ref, created_at, updated_at, status, busy, view_key, town, department, character, messages, sketch_mime, (sketch_data IS NOT NULL) AS has_sketch, understanding, parcel, owner, research, packet, submitted_at, error, demo_id, resident_id, changed_since_submit, resubmit_count, pending_handoff, (signature_data IS NOT NULL) AS has_signature, signature_meta FROM sessions WHERE ref = ?"
    ),
    getSketch: db.prepare("SELECT sketch_mime, sketch_data FROM sessions WHERE ref = ?"),
    list: db.prepare(
      "SELECT ref, created_at, updated_at, status, busy, department, substr(messages, 1, 400) AS messages_head, (sketch_data IS NOT NULL) AS has_sketch, packet, submitted_at, demo_id, resident_id, changed_since_submit, resubmit_count FROM sessions ORDER BY created_at DESC LIMIT 300"
    ),
    listForResident: db.prepare(
      "SELECT ref, view_key, created_at, updated_at, status, substr(messages, 1, 400) AS messages_head, packet, submitted_at, changed_since_submit, resubmit_count FROM sessions WHERE resident_id = ? ORDER BY updated_at DESC LIMIT 100"
    ),
    claim: db.prepare("UPDATE sessions SET resident_id = ? WHERE ref = ? AND resident_id IS NULL"),
    insertResident: db.prepare("INSERT INTO residents (email, name, pass_hash, pass_salt, created_at) VALUES (?, ?, ?, ?, ?)"),
    residentByEmail: db.prepare("SELECT id, email, name, pass_hash, pass_salt, created_at, last_login_at FROM residents WHERE email = ?"),
    residentById: db.prepare("SELECT id, email, name, created_at, last_login_at FROM residents WHERE id = ?"),
    touchResident: db.prepare("UPDATE residents SET last_login_at = ? WHERE id = ?"),
    count: db.prepare("SELECT COUNT(*) AS n FROM sessions"),
    upsertStep: db.prepare(
      `INSERT INTO steps (ref, name, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref, name) DO UPDATE SET status = excluded.status, output = excluded.output, error = excluded.error,
       started_at = CASE WHEN excluded.status = 'running' THEN excluded.started_at ELSE COALESCE(steps.started_at, excluded.started_at) END, finished_at = excluded.finished_at`
    ),
    getSteps: db.prepare("SELECT name, status, output, error, started_at, finished_at FROM steps WHERE ref = ? ORDER BY id"),
    clearSteps: db.prepare("DELETE FROM steps WHERE ref = ?"),
    addAction: db.prepare("INSERT INTO staff_actions (ref, action, note, payload, created_at) VALUES (?, ?, ?, ?, ?)"),
    getActions: db.prepare("SELECT id, action, note, payload, created_at FROM staff_actions WHERE ref = ? ORDER BY id"),
    getReview: db.prepare("SELECT model, considerations, states, second_read, created_at, updated_at FROM reviews WHERE ref = ?"),
    saveReview: db.prepare(
      "INSERT INTO reviews (ref, model, considerations, states, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET model = excluded.model, considerations = excluded.considerations, states = excluded.states, second_read = NULL, updated_at = excluded.updated_at"
    ),
    setStates: db.prepare("UPDATE reviews SET states = ?, updated_at = ? WHERE ref = ?"),
    setSecondRead: db.prepare("UPDATE reviews SET second_read = ?, updated_at = ? WHERE ref = ?"),
    logUsage: db.prepare("INSERT INTO usage_log (created_at, day, tag, model, prompt_tokens, completion_tokens, ms) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    callsToday: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c FROM usage_log WHERE day = ?"),
    usageTotals: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c FROM usage_log"),
  };

  function nextRef() {
    const n = q.count.get().n;
    return `${refPrefix}-${new Date().getFullYear()}-${String(101 + n).padStart(4, "0")}`;
  }

  function createSession({ town = null, text = "", sketch = null, demoId = null, residentId = null } = {}) {
    let ref = nextRef();
    const ts = now();
    const viewKey = crypto.randomBytes(6).toString("base64url");
    const messages = text ? [{ role: "resident", text, at: ts, has_sketch: !!sketch }] : [];
    for (let i = 0; i < 5; i++) {
      try {
        q.insert.run(ref, ts, ts, "open", viewKey, town, JSON.stringify(messages), sketch ? sketch.mime : null, sketch ? sketch.data : null, demoId, residentId);
        if (sketch) setStep(ref, "sketch", { status: "pending" });
        return { ref, viewKey };
      } catch (e) {
        if (!/UNIQUE/.test(String(e.message))) throw e;
        ref = ref.replace(/(\d+)$/, (m) => String(parseInt(m, 10) + 1 + i).padStart(4, "0"));
      }
    }
    throw new Error("Could not allocate a reference code.");
  }

  function getSession(ref) {
    const row = q.get.get(ref);
    if (!row) return null;
    const review = q.getReview.get(ref);
    return {
      ...row,
      busy: !!row.busy,
      has_sketch: !!row.has_sketch,
      changed_since_submit: !!row.changed_since_submit,
      resubmit_count: row.resubmit_count || 0,
      messages: p(row.messages) || [],
      understanding: p(row.understanding),
      parcel: p(row.parcel),
      owner: p(row.owner),
      research: p(row.research),
      packet: p(row.packet),
      pending_handoff: p(row.pending_handoff),
      has_signature: !!row.has_signature,
      signature: p(row.signature_meta),
      steps: q.getSteps.all(ref).map((s) => ({ ...s, output: p(s.output) })),
      staff_actions: q.getActions.all(ref).map((a) => ({ ...a, payload: p(a.payload) })),
      review: review ? { model: review.model, created_at: review.created_at, updated_at: review.updated_at, ...p(review.considerations), states: p(review.states) || {}, second_read: p(review.second_read) } : null,
    };
  }

  function getSketch(ref) {
    const r = q.getSketch.get(ref);
    if (!r || !r.sketch_data) return null;
    return { mime: r.sketch_mime, data: Buffer.from(r.sketch_data) };
  }

  function setSignature(ref, { data, mime, meta }) {
    db.prepare("UPDATE sessions SET signature_data = ?, signature_mime = ?, signature_meta = ?, updated_at = ? WHERE ref = ?").run(data, mime, JSON.stringify(meta), now(), ref);
  }
  function getSignature(ref) {
    const r = db.prepare("SELECT signature_mime, signature_data FROM sessions WHERE ref = ?").get(ref);
    if (!r || !r.signature_data) return null;
    return { mime: r.signature_mime, data: Buffer.from(r.signature_data) };
  }
  function setSketch(ref, sketch) {
    db.prepare("UPDATE sessions SET sketch_mime = ?, sketch_data = ?, updated_at = ? WHERE ref = ?").run(sketch.mime, sketch.data, now(), ref);
    setStep(ref, "sketch", { status: "pending" });
  }

  function addMessage(ref, msg) {
    const s = q.get.get(ref);
    if (!s) throw new Error("Unknown session " + ref);
    const messages = p(s.messages) || [];
    messages.push({ ...msg, at: msg.at || now() });
    db.prepare("UPDATE sessions SET messages = ?, updated_at = ? WHERE ref = ?").run(JSON.stringify(messages), now(), ref);
    return messages;
  }

  function updateSession(ref, patch) {
    const sets = [];
    const vals = [];
    const jsonCols = ["understanding", "parcel", "owner", "research", "packet", "pending_handoff"];
    for (const k of ["status", "department", "character", "submitted_at", "error", "demo_id", "resident_id", "resubmit_count", ...jsonCols]) {
      if (k in patch) {
        sets.push(`${k} = ?`);
        vals.push(jsonCols.includes(k) ? j(patch[k]) : patch[k]);
      }
    }
    if (patch.status && !STATUSES.includes(patch.status)) throw new Error("Unknown status " + patch.status);
    if ("busy" in patch) {
      sets.push("busy = ?");
      vals.push(patch.busy ? 1 : 0);
    }
    if ("changed_since_submit" in patch) {
      sets.push("changed_since_submit = ?");
      vals.push(patch.changed_since_submit ? 1 : 0);
    }
    sets.push("updated_at = ?");
    vals.push(now());
    vals.push(ref);
    db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE ref = ?`).run(...vals);
  }

  function setStep(ref, name, { status, output = null, error = null }) {
    const ts = now();
    q.upsertStep.run(ref, name, status, j(output), error, status === "running" ? ts : null, status === "running" || status === "pending" ? null : ts);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE ref = ?").run(ts, ref);
  }
  function resetSteps(ref, names) {
    q.clearSteps.run(ref);
    for (const n of names) setStep(ref, n, { status: "pending" });
  }

  function listSessions() {
    return q.list.all().map((r) => {
      const head = p(r.messages_head + (r.messages_head.endsWith("]") ? "" : '"}]')) || [];
      const first = Array.isArray(head) && head[0] ? head[0].text : "";
      const packet = p(r.packet);
      return { ref: r.ref, created_at: r.created_at, updated_at: r.updated_at, status: r.status, busy: !!r.busy, department: r.department, has_sketch: !!r.has_sketch, submitted_at: r.submitted_at, demo_id: r.demo_id, has_account: !!r.resident_id, changed_since_submit: !!r.changed_since_submit, resubmit_count: r.resubmit_count || 0, preview: String(first || "").slice(0, 140), title: packet ? packet.title : null, packet_type: packet ? packet.packet_type : null };
    });
  }

  // ----- resident accounts (email + password; see LOGIN-TODO.md for what is deliberately left out) -----
  function createResident({ email, name, passHash, passSalt }) {
    const r = q.insertResident.run(String(email).trim().toLowerCase(), name || null, passHash, passSalt, now());
    return Number(r.lastInsertRowid);
  }
  const getResidentByEmail = (email) => q.residentByEmail.get(String(email).trim().toLowerCase()) || null;
  const getResident = (id) => q.residentById.get(id) || null;
  const touchResident = (id) => q.touchResident.run(now(), id);
  function listResidentSessions(residentId) {
    return q.listForResident.all(residentId).map((r) => {
      const head = p(r.messages_head + (r.messages_head.endsWith("]") ? "" : '"}]')) || [];
      const first = Array.isArray(head) && head[0] ? head[0].text : "";
      const packet = p(r.packet);
      return { ref: r.ref, view_key: r.view_key, created_at: r.created_at, updated_at: r.updated_at, status: r.status, submitted_at: r.submitted_at, changed_since_submit: !!r.changed_since_submit, resubmit_count: r.resubmit_count || 0, preview: String(first || "").slice(0, 140), title: packet ? packet.title : null, packet_type: packet ? packet.packet_type : null };
    });
  }
  /** Remove a session and its steps, staff actions and review. Returns true when something was deleted. */
  function deleteSession(ref) {
    const n = db.prepare("DELETE FROM sessions WHERE ref = ?").run(ref).changes;
    db.prepare("DELETE FROM steps WHERE ref = ?").run(ref);
    db.prepare("DELETE FROM staff_actions WHERE ref = ?").run(ref);
    db.prepare("DELETE FROM reviews WHERE ref = ?").run(ref);
    return n > 0;
  }
  /** Attach a session to an account if it has none yet. Returns true when attached. */
  const claimSession = (ref, residentId) => q.claim.run(residentId, ref).changes > 0;

  function addStaffAction(ref, { action, note = null, payload = null }) {
    q.addAction.run(ref, action, note, j(payload), now());
  }

  function saveReview(ref, output, model) {
    const ts = now();
    const states = {};
    for (const c of output.considerations || []) states[c.id] = { state: "not_started", note: "", at: null };
    q.saveReview.run(ref, model || null, JSON.stringify(output), JSON.stringify(states), ts, ts);
  }
  function setReviewState(ref, id, { state, note }) {
    const r = q.getReview.get(ref);
    if (!r) throw new Error("No review yet");
    const states = p(r.states) || {};
    states[id] = { state, note: note || "", at: now() };
    q.setStates.run(JSON.stringify(states), now(), ref);
    return states;
  }
  function addConsideration(ref, consideration) {
    const r = q.getReview.get(ref);
    if (!r) throw new Error("No review yet");
    const out = p(r.considerations);
    out.considerations.push(consideration);
    const states = p(r.states) || {};
    states[consideration.id] = { state: "not_started", note: "", at: null };
    db.prepare("UPDATE reviews SET considerations = ?, states = ?, updated_at = ? WHERE ref = ?").run(JSON.stringify(out), JSON.stringify(states), now(), ref);
  }
  function setSecondRead(ref, out) {
    q.setSecondRead.run(JSON.stringify(out), now(), ref);
  }

  function logUsage(rec) {
    const ts = now();
    q.logUsage.run(ts, ts.slice(0, 10), rec.tag || null, rec.model || null, rec.prompt_tokens || 0, rec.completion_tokens || 0, rec.ms || 0);
  }
  const callsToday = () => q.callsToday.get(today());
  const usageTotals = () => q.usageTotals.get();

  return { db, dir, createSession, getSession, getSketch, setSketch, setSignature, getSignature, addMessage, updateSession, setStep, resetSteps, listSessions, createResident, getResidentByEmail, getResident, touchResident, listResidentSessions, claimSession, deleteSession, addStaffAction, saveReview, setReviewState, addConsideration, setSecondRead, logUsage, callsToday, usageTotals, close: () => db.close() };
}

module.exports = { openStore, STATUSES };
