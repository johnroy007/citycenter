// The agentic completeness checker. Code decides which checklist items are missing or unclear.
// The model then uses tools (code lookup, checklist lookup, lot arithmetic) to explain each gap with the right citation.
"use strict";
const town = require("./town");
const prompts = require("./prompts");

const TOOLS = [
  {
    name: "get_code_section",
    description: "Look up one section of the Sample Creek code by its number, for example '12.04'. Returns the exact text.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    handler: ({ id }) => {
      const s = town.getSection(id);
      return s ? { id: s.id, title: s.title, text: s.text } : { error: `No section ${id}` };
    },
  },
  {
    name: "get_checklist_item",
    description: "Look up one completeness checklist item by id, for example 'CL-09'. Returns its label, hint and the code section it comes from.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    handler: ({ id }) => town.getChecklistItem(id) || { error: `No checklist item ${id}` },
  },
  {
    name: "compute_lot_split",
    description:
      "Arithmetic only. Compares proposed lot sizes and frontages to the district minimums in sections 12.03 and 12.04 and checks that the proposed lots add up to the current parcel. Pass values as the resident wrote them (e.g. '0.5 acre', '12,000 sq ft', '60 ft').",
    parameters: {
      type: "object",
      properties: {
        district: { type: "string", description: "R-1, R-2 or C-1" },
        currentArea: { type: "string" },
        proposedAreas: { type: "array", items: { type: "string" } },
        frontages: { type: "array", items: { type: "string" } },
      },
      required: ["district", "currentArea", "proposedAreas", "frontages"],
      additionalProperties: false,
    },
    handler: (args) => town.computeLotSplit(args),
  },
];

/** Pure code: which checklist items are not satisfied, from the facts list. */
function findGaps(facts) {
  const byId = new Map((facts.items || []).map((i) => [i.id, i]));
  const missing = [];
  const unclear = [];
  for (const item of town.checklist.items) {
    const f = byId.get(item.id);
    if (!f || f.status === "missing") missing.push(item.id);
    else if (f.status === "unclear") unclear.push(item.id);
  }
  return { missing, unclear, ready_to_file: missing.length === 0 && unclear.length === 0 };
}

function factsAsText(facts) {
  return (facts.items || [])
    .map((f) => {
      const item = town.getChecklistItem(f.id);
      const label = item ? item.label : f.id;
      return `${f.id} ${label}: ${f.status}${f.value ? ` = ${f.value}` : ""}${f.note ? ` (${f.note})` : ""}`;
    })
    .join("\n");
}

async function checkCompleteness(client, { facts, classification, requestText }, { model } = {}) {
  const computed = findGaps(facts);
  const transcriptSeed = [
    { role: "developer", content: prompts.context() },
    {
      role: "user",
      content:
        `Here are the facts extracted from a resident's lot-split request (status per checklist item):\n\n${factsAsText(facts)}\n\n` +
        `Application type from the classify step: ${classification.application_type} (section ${classification.section}).\n\n` +
        `Items with status missing: ${computed.missing.join(", ") || "none"}.\nItems with status unclear: ${computed.unclear.join(", ") || "none"}.\n\n` +
        "Your job: for every missing or unclear item, look up the checklist item and its code section with the tools so you can cite them exactly. " +
        "If the district, current size, proposed sizes or frontages are given, call compute_lot_split once and report the numbers it returns in plain English. " +
        "Do not call any tool more than necessary. When you have what you need, reply with a short summary of what you found.",
    },
  ];
  const run = await client.runTools({
    tag: "check",
    model,
    reasoning: "low",
    maxTokens: 4000,
    maxRounds: 8,
    messages: transcriptSeed,
    tools: TOOLS,
  });
  // Final structured answer, built from the full tool transcript.
  const final = await client.complete({
    tag: "check-final",
    model,
    reasoning: "low",
    maxTokens: 6000,
    schemaName: "gaps",
    schema: prompts.GAPS_SCHEMA,
    messages: [
      ...run.transcript,
      {
        role: "user",
        content:
          `Now produce the final structured result. Include exactly one gap entry for each of these item ids and no others: ${[...computed.missing, ...computed.unclear].join(", ") || "(none)"}. ` +
          "In arithmetic_notes, state numbers against the minimums as facts (for example 'Lot 2 is listed at 9,780 sq ft; the R-1 minimum in section 12.03 is 10,000 sq ft'). " +
          "Never say whether the split is allowed or will be approved.",
      },
    ],
  });
  const out = final.parsed;
  // Code owns the gap list. Keep only the model's wording for ids the code found; add plain fallbacks for any it skipped.
  const wanted = [...computed.missing, ...computed.unclear];
  const byId = new Map((out.gaps || []).map((g) => [g.id, g]));
  const gaps = wanted.map((id) => {
    const item = town.getChecklistItem(id);
    const g = byId.get(id);
    const status = computed.missing.includes(id) ? "missing" : "unclear";
    return {
      id,
      label: item ? item.label : id,
      status,
      section: (g && g.section) || (item ? item.section : ""),
      what_to_add: (g && g.what_to_add) || (item ? `Add: ${item.label}. ${item.hint}` : `Add ${id}.`),
      why: (g && g.why) || (item ? `Checklist item ${id} comes from code section ${item.section}.` : ""),
    };
  });
  return {
    gaps,
    missing_count: computed.missing.length,
    unclear_count: computed.unclear.length,
    ready_to_file: computed.ready_to_file,
    arithmetic_notes: out.arithmetic_notes || [],
    checks_performed: out.checks_performed || [],
    tool_log: run.toolLog,
    tool_rounds: run.rounds,
  };
}

module.exports = { checkCompleteness, findGaps, TOOLS, factsAsText };
