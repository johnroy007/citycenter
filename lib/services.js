// The city services catalog: every report, request and application the department desks handle, read from
// data/towns/<town>/services.json, and the source list behind it (sources.json). Plain code, no model calls.
// Each service's procedure is an original sample written for the example city; real code sections are cited by id
// and the real public pages that informed it are listed by source id. A sample is never quoted as law.
"use strict";
const fs = require("fs");
const path = require("path");

function tokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 2);
}

function loadServices(town) {
  const read = (name) => {
    const file = path.join(town.dataDir, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  };
  const catalog = read("services.json") || { services: [] };
  const sources = read("sources.json") || { sources: [] };
  return createServices(catalog.services, sources.sources);
}

function createServices(services, sources = []) {
  const byId = new Map(services.map((s) => [s.id, s]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const forDepartment = (dept) => services.filter((s) => s.department === dept);
  const indexText = services.map((s) => ({ s, words: new Set(tokens([s.name, s.summary, ...(s.keywords || []), ...(s.procedure || []), s.fees || "", s.timing || ""].join(" "))) }));

  /** Best matching services for a topic, any department. */
  function search(query, limit = 5) {
    const q = tokens(query);
    return indexText
      .map(({ s, words }) => ({ s, hits: q.filter((t) => words.has(t)).length }))
      .filter((x) => x.hits)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit)
      .map(({ s }) => ({ id: s.id, department: s.department, name: s.name, summary: s.summary }));
  }

  /** The part of a service a desk reads. Everything in `sample` is an example-city sample, not law. */
  function read(id) {
    const s = byId.get(id);
    if (!s) return null;
    return {
      id: s.id,
      department: s.department,
      name: s.name,
      kind: s.kind,
      summary: s.summary,
      decider: s.decider,
      real_code_sections: s.sections || [],
      form_fields: (s.fields || []).map((f) => ({ label: f.label, required: !!f.required })),
      sample: { label: "SAMPLE procedure of the example city (not law; never quote it as code)", procedure: s.procedure || [], fees: s.fees || "", timing: s.timing || "" },
    };
  }

  /** The source records behind a service, for the page. */
  const sourcesFor = (s) => (s.sources || []).map((id) => sourceById.get(id)).filter(Boolean);

  /** What the browser needs to draw forms and labels. */
  const publicList = () =>
    services.map((s) => ({ id: s.id, department: s.department, name: s.name, kind: s.kind, summary: s.summary, location: s.location || "none", signature: !!s.signature, decider: s.decider, fees: s.fees || "", timing: s.timing || "", procedure: s.procedure || [], sources: sourcesFor(s).map((x) => ({ government: x.government, title: x.title, url: x.url })) }));

  return { services, sources, byId, get: (id) => byId.get(id) || null, forDepartment, search, read, sourcesFor, publicList };
}

function createServiceTools(services) {
  return [
    {
      name: "read_service",
      description: "Read one city service from the catalog by id: what it is, who decides, the real code sections to read, the form's fields, and the example city's SAMPLE procedure, fees and timing.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      handler: ({ id }) => services.read(id) || { error: `No service ${id}. Use search_services.` },
    },
    {
      name: "search_services",
      description: "Search every department's services by topic. Use it when a question may belong to another department or service.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      handler: ({ query }) => ({ results: services.search(query) }),
    },
  ];
}

module.exports = { loadServices, createServices, createServiceTools };
