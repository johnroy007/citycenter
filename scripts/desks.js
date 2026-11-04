// Plays one resident conversation for every city service against a running server, through to submission, and reports
// what happened. Calls the real models. Run: node scripts/desks.js http://localhost:3000 [service ids...] [--staff]
// --staff also runs the four staff steps on each visit.
"use strict";
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://localhost:3000").replace(/\/$/, "");
const staff = args.includes("--staff");
const only = args.filter((a) => !/^https?:|^--/.test(a));
const { cases, edge, certified, formal } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "desks.json"), "utf8"));
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, opts = {}) {
  for (let tries = 0; ; tries++) {
    const res = await fetch(base + p, { ...opts, headers: { "Content-Type": "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 && tries < 40) { await PAUSE(3000); continue; }
    if (!res.ok) throw new Error(`${res.status} ${data.error || p}`);
    return data;
  }
}
async function settle(ref, key) {
  for (let i = 0; i < 200; i++) {
    const s = await api(`/api/sessions/${ref}?key=${key}`);
    if (!s.busy) return s;
    await PAUSE(1500);
  }
  throw new Error("timed out waiting for the desk");
}
const say = async (v, text) => { await api(`/api/sessions/${v.ref}/messages?key=${v.key}`, { method: "POST", body: JSON.stringify({ text }) }); return settle(v.ref, v.key); };
const lastDesk = (s) => [...s.messages].reverse().find((m) => m.role === "desk") || {};
const blanks = (s) => (s.packet && s.packet.documents ? s.packet.documents[0].fields.filter((f) => f.required && !f.value).map((f) => f.label) : []);

async function play(c) {
  const start = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: c.opening }) });
  const v = { ref: start.ref, key: start.view_key };
  let s = await settle(v.ref, v.key);
  if (lastDesk(s).asks_consent) s = await say(v, "Yes, please.");
  const problems = [];
  if (s.department !== c.department) problems.push(`went to ${s.department}`);
  if (s.status === "error") problems.push("desk error: " + s.error);
  s = await say(v, c.details);
  if (c.pin) {
    const town = await api("/api/town");
    await api(`/api/sessions/${v.ref}/pin?key=${v.key}`, { method: "POST", body: JSON.stringify({ lon: town.mapCenter[0], lat: town.mapCenter[1], note: "By the mailbox." }) });
    s = await settle(v.ref, v.key);
  }
  for (let i = 0; i < 2 && (!s.packet || blanks(s).length); i++) {
    if (!s.packet) s = await say(v, "Yes, please prepare the paperwork with what I've given you.");
    else s = await say(v, `Here's what is left: ${blanks(s).map((b) => b + ": not sure, use 'unknown'").join("; ")}.`);
  }
  const sent = { service: s.packet && s.packet.service_id, quotes: (s.research && s.research.applicable_sections || []).filter((x) => x.quote_verified).length, sections: (s.research && s.research.applicable_sections || []).map((x) => x.section), tools: s.research && s.research.tool_log ? s.research.tool_log.length : 0 };
  if (!s.packet) problems.push("no paperwork");
  else if (s.packet.service_id !== c.service) problems.push(`form was ${s.packet.service_id}`);
  const left = blanks(s);
  if (left.length) problems.push("blank: " + left.join(", "));
  if (s.packet && !left.length) {
    if (s.packet.signature_required !== false) await api(`/api/sessions/${v.ref}/sign?key=${v.key}`, { method: "POST", body: JSON.stringify({ name: "Dana Whitlock", method: "typed", agree: true }) });
    await api(`/api/sessions/${v.ref}/submit?key=${v.key}`, { method: "POST", body: "{}" });
    if (staff) {
      for (const step of ["summary", "code-summary", "considerations"]) await api(`/api/staff/sessions/${v.ref}/${step}`, { method: "POST", body: "{}" });
      const l = await api(`/api/staff/sessions/${v.ref}/letter/generate`, { method: "POST", body: "{}" });
      sent.letter = l.letter.subject;
      if (/Planning & Zoning/.test(l.letter.body) && c.department !== "planning") problems.push("letter signed by Planning");
      const st = await api(`/api/staff/sessions/${v.ref}`);
      sent.points = st.review.considerations.length;
    }
  }
  const all = JSON.stringify(s.messages.filter((m) => m.role === "desk").map((m) => m.text));
  if (/will be approved|you are approved|is legal\b/i.test(all)) problems.push("predictive wording");
  return { ...sent, service: c.service, ref: v.ref, ok: !problems.length, problems, reply: String(lastDesk(s).text || "").slice(0, 200) };
}

// Information first, then a certified question, then the staff's answer back to the resident.
async function certifiedCase(c) {
  const start = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: c.opening }) });
  const v = { ref: start.ref, key: start.view_key };
  let s = await settle(v.ref, v.key);
  if (lastDesk(s).asks_consent) s = await say(v, "Yes, please.");
  const problems = [];
  if (s.department !== c.department) problems.push(`went to ${s.department}`);
  const m = lastDesk(s);
  if (!(m.quick_replies || []).includes("Send a certified question")) problems.push("no certified offer");
  if (s.packet) problems.push("information turned into paperwork: " + s.packet.packet_type);
  const info = String(m.text);
  if (/^\s*(yes|no)\b/i.test(info)) problems.push("the desk said yes or no");
  s = await say(v, "Send a certified question");
  if (blanks(s).length) s = await say(v, c.details);
  if (!s.packet || s.packet.packet_type !== "certified_question") { problems.push("no certified question"); return { service: c.id, ok: false, problems, reply: String(lastDesk(s).text).slice(0, 200) }; }
  if (blanks(s).length) problems.push("blank: " + blanks(s).join(", "));
  const doc = s.packet.documents[0];
  await api(`/api/sessions/${v.ref}/submit?key=${v.key}`, { method: "POST", body: "{}" });
  for (const step of ["summary", "code-summary", "considerations"]) await api(`/api/staff/sessions/${v.ref}/${step}`, { method: "POST", body: "{}" });
  let st = await api(`/api/staff/sessions/${v.ref}`);
  for (const p of st.review.considerations) await api(`/api/staff/sessions/${v.ref}/consideration`, { method: "POST", body: JSON.stringify({ id: p.id, state: "met" }) });
  const l = await api(`/api/staff/sessions/${v.ref}/letter/generate`, { method: "POST", body: "{}" });
  if (l.letter.decision !== "certified_yes") problems.push("letter kind " + l.letter.decision);
  await api(`/api/staff/sessions/${v.ref}/letter`, { method: "POST", body: JSON.stringify({ subject: l.letter.subject, body: l.letter.body, decision: l.letter.decision }) });
  s = await api(`/api/sessions/${v.ref}?key=${v.key}`);
  if (!lastDesk(s).certified) problems.push("resident did not get a certified answer");
  if (s.status !== "answered") problems.push("status " + s.status);
  return { service: c.id, ok: !problems.length, problems, ref: v.ref, quotes: doc.code_basis.filter((x) => x.quote_verified).length, tools: 0, points: st.review.considerations.length, reply: "Q: " + doc.fields.find((x) => x.label === "Your question").value + " | MINE: " + doc.narrative.slice(0, 150) + " | LETTER: " + l.letter.body.slice(0, 170) };
}

async function formalCase(c) {
  const start = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: c.opening }) });
  const v = { ref: start.ref, key: start.view_key };
  let s = await settle(v.ref, v.key);
  if (lastDesk(s).asks_consent) s = await say(v, "Yes, please.");
  const ok = !!s.packet && s.packet.packet_type === c.packet;
  return { service: c.id, ok, problems: ok ? [] : ["packet " + (s.packet && s.packet.packet_type)], reply: String(lastDesk(s).text).slice(0, 120) };
}

async function edgeCase(e) {
  const start = await api("/api/sessions", { method: "POST", body: JSON.stringify({ text: e.text }) });
  const v = { ref: start.ref, key: start.view_key };
  let s = await settle(v.ref, v.key);
  if (e.expect === "emergency") return { service: e.id, ok: !!lastDesk(s).emergency && /911/.test(lastDesk(s).text), problems: lastDesk(s).emergency ? [] : ["no 911 line"], reply: lastDesk(s).text.slice(0, 120) };
  if (lastDesk(s).asks_consent) s = await say(v, "Yes, please.");
  s = await say(v, e.then);
  const m = lastDesk(s);
  return { service: e.id, ok: !!m.asks_consent && m.proposed === "utilities", problems: m.asks_consent ? [] : ["no transfer offer"], reply: String(m.text).slice(0, 160) };
}

(async () => {
  const certifiedOnly = args.includes("--certified");
  const edgeOnly = args.includes("--edge");
  const todo = certifiedOnly || edgeOnly ? [] : cases.filter((c) => !only.length || only.includes(c.service));
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++];
      try {
        const r = await play(c);
        results.push(r);
        console.log(`${r.ok ? "PASS" : "FAIL"} ${r.service} (${r.ref}) quotes ${r.quotes} tools ${r.tools}${r.points ? " points " + r.points : ""}${r.problems.length ? " :: " + r.problems.join("; ") : ""}`);
      } catch (e) {
        results.push({ service: c.service, ok: false, problems: [e.message] });
        console.log(`FAIL ${c.service} :: ${e.message}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (!edgeOnly && (!only.length || certifiedOnly)) for (const [list, run] of [[certified, certifiedCase], [formal, formalCase]]) {
    await Promise.all(list.filter((c) => !only.length || only.includes(c.id)).map(async (c) => {
      try {
        const r = await run(c);
        results.push(r);
        console.log(`${r.ok ? "PASS" : "FAIL"} ${r.service} ${r.ref || ""}${r.problems.length ? " :: " + r.problems.join("; ") : ""}\n     ${r.reply}`);
      } catch (e) { results.push({ service: c.id, ok: false, problems: [e.message] }); console.log(`FAIL ${c.id} :: ${e.message}`); }
    }));
  }
  if (edgeOnly || (!only.length && !certifiedOnly)) for (const e of edge) {
    try {
      const r = await edgeCase(e);
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"} ${r.service} :: ${r.reply}`);
    } catch (err) { results.push({ service: e.id, ok: false, problems: [err.message] }); console.log(`FAIL ${e.id} :: ${err.message}`); }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} passed`);
  fs.writeFileSync(path.join(require("os").tmpdir(), "citycenter-desks.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
