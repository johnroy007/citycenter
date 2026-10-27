// Storage: one SQLite file (Node's built-in node:sqlite). Applications, pipeline steps, staff actions, usage.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS applications (
  ref TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  view_key TEXT NOT NULL DEFAULT '',
  request_text TEXT NOT NULL,
  sketch_mime TEXT,
  sketch_data BLOB,
  facts TEXT,
  classification TEXT,
  draft TEXT,
  gaps TEXT,
  error TEXT
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
CREATE TABLE IF NOT EXISTS prereviews (
  ref TEXT PRIMARY KEY,
  model TEXT,
  output TEXT NOT NULL,
  created_at TEXT NOT NULL
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
`;

const STATUSES = ["processing", "draft_ready", "needs_info", "in_review", "error"];

function now() {
  return new Date().toISOString();
}
function today() {
  return new Date().toISOString().slice(0, 10);
}
function j(v) {
  return v == null ? null : JSON.stringify(v);
}
function p(v) {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function openStore(dataDir) {
  const dir = dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data", "runtime");
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "citycenter.sqlite"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const q = {
    insertApp: db.prepare(
      "INSERT INTO applications (ref, created_at, updated_at, status, view_key, request_text, sketch_mime, sketch_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    getApp: db.prepare(
      "SELECT ref, created_at, updated_at, status, view_key, request_text, sketch_mime, (sketch_data IS NOT NULL) AS has_sketch, facts, classification, draft, gaps, error FROM applications WHERE ref = ?"
    ),
    getSketch: db.prepare("SELECT sketch_mime, sketch_data FROM applications WHERE ref = ?"),
    listApps: db.prepare(
      "SELECT ref, created_at, updated_at, status, substr(request_text, 1, 160) AS request_preview, (sketch_data IS NOT NULL) AS has_sketch FROM applications ORDER BY created_at DESC LIMIT 200"
    ),
    countApps: db.prepare("SELECT COUNT(*) AS n FROM applications"),
    upsertStep: db.prepare(
      `INSERT INTO steps (ref, name, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref, name) DO UPDATE SET status = excluded.status, output = excluded.output, error = excluded.error,
       started_at = COALESCE(steps.started_at, excluded.started_at), finished_at = excluded.finished_at`
    ),
    getSteps: db.prepare("SELECT name, status, output, error, started_at, finished_at FROM steps WHERE ref = ? ORDER BY id"),
    addAction: db.prepare("INSERT INTO staff_actions (ref, action, note, payload, created_at) VALUES (?, ?, ?, ?, ?)"),
    getActions: db.prepare("SELECT id, action, note, payload, created_at FROM staff_actions WHERE ref = ? ORDER BY id"),
    savePrereview: db.prepare(
      "INSERT INTO prereviews (ref, model, output, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(ref) DO UPDATE SET model = excluded.model, output = excluded.output, created_at = excluded.created_at"
    ),
    getPrereview: db.prepare("SELECT model, output, created_at FROM prereviews WHERE ref = ?"),
    logUsage: db.prepare("INSERT INTO usage_log (created_at, day, tag, model, prompt_tokens, completion_tokens, ms) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    callsToday: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c FROM usage_log WHERE day = ?"),
    usageTotals: db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(prompt_tokens),0) AS p, COALESCE(SUM(completion_tokens),0) AS c FROM usage_log"),
  };

  function nextRef() {
    const n = q.countApps.get().n;
    return `SC-${new Date().getFullYear()}-${String(101 + n).padStart(4, "0")}`;
  }

  function createApplication({ requestText, sketch }) {
    let ref = nextRef();
    const ts = now();
    const viewKey = crypto.randomBytes(6).toString("base64url");
    // Retry a few times in case of a collision (two submissions in the same instant).
    for (let i = 0; i < 5; i++) {
      try {
        q.insertApp.run(ref, ts, ts, "processing", viewKey, requestText, sketch ? sketch.mime : null, sketch ? sketch.data : null);
        return { ref, viewKey };
      } catch (e) {
        if (!/UNIQUE/.test(String(e.message))) throw e;
        ref = ref.replace(/(\d+)$/, (m) => String(parseInt(m, 10) + 1 + i).padStart(4, "0"));
      }
    }
    throw new Error("Could not allocate a reference code.");
  }

  function getApplication(ref) {
    const row = q.getApp.get(ref);
    if (!row) return null;
    return {
      ...row,
      has_sketch: !!row.has_sketch,
      facts: p(row.facts),
      classification: p(row.classification),
      draft: p(row.draft),
      gaps: p(row.gaps),
      steps: q.getSteps.all(ref).map((s) => ({ ...s, output: p(s.output) })),
      staff_actions: q.getActions.all(ref).map((a) => ({ ...a, payload: p(a.payload) })),
      prereview: (() => {
        const r = q.getPrereview.get(ref);
        return r ? { model: r.model, created_at: r.created_at, ...p(r.output) } : null;
      })(),
    };
  }

  function getSketch(ref) {
    const r = q.getSketch.get(ref);
    if (!r || !r.sketch_data) return null;
    return { mime: r.sketch_mime, data: Buffer.from(r.sketch_data) };
  }

  function updateApplication(ref, patch) {
    const sets = [];
    const vals = [];
    for (const k of ["status", "facts", "classification", "draft", "gaps", "error"]) {
      if (k in patch) {
        sets.push(`${k} = ?`);
        vals.push(k === "status" || k === "error" ? patch[k] : j(patch[k]));
      }
    }
    if (patch.status && !STATUSES.includes(patch.status)) throw new Error("Unknown status " + patch.status);
    sets.push("updated_at = ?");
    vals.push(now());
    vals.push(ref);
    db.prepare(`UPDATE applications SET ${sets.join(", ")} WHERE ref = ?`).run(...vals);
  }

  function setStep(ref, name, { status, output = null, error = null }) {
    const ts = now();
    q.upsertStep.run(ref, name, status, j(output), error, status === "running" ? ts : null, status === "running" ? null : ts);
    db.prepare("UPDATE applications SET updated_at = ? WHERE ref = ?").run(ts, ref);
  }

  function listApplications() {
    return q.listApps.all().map((r) => ({ ...r, has_sketch: !!r.has_sketch }));
  }

  function addStaffAction(ref, { action, note = null, payload = null }) {
    q.addAction.run(ref, action, note, j(payload), now());
  }

  function savePrereview(ref, output, model) {
    q.savePrereview.run(ref, model || null, JSON.stringify(output), now());
  }

  function logUsage(rec) {
    const ts = now();
    q.logUsage.run(ts, ts.slice(0, 10), rec.tag || null, rec.model || null, rec.prompt_tokens || 0, rec.completion_tokens || 0, rec.ms || 0);
  }

  function callsToday() {
    return q.callsToday.get(today());
  }
  function usageTotals() {
    return q.usageTotals.get();
  }

  return {
    db,
    dir,
    createApplication,
    getApplication,
    getSketch,
    updateApplication,
    setStep,
    listApplications,
    addStaffAction,
    savePrereview,
    logUsage,
    callsToday,
    usageTotals,
    close: () => db.close(),
  };
}

module.exports = { openStore, STATUSES };
