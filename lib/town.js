// Loads the invented Town of Sample Creek rules (code + checklist) and exposes lookups and lot arithmetic.
// Everything here is plain code: no model calls.
"use strict";
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const code = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sample-creek-code.json"), "utf8"));
const checklist = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "sample-creek-checklist.json"), "utf8"));

const sectionById = new Map(code.sections.map((s) => [s.id, s]));
const itemById = new Map(checklist.items.map((i) => [i.id, i]));

function getSection(id) {
  return sectionById.get(String(id).trim()) || null;
}
function getChecklistItem(id) {
  return itemById.get(String(id).trim().toUpperCase()) || null;
}
function codeAsText() {
  const lines = [code.title, code.notice, ""];
  lines.push("Zoning districts:");
  for (const [k, d] of Object.entries(code.districts)) {
    lines.push(`- ${k} (${d.name}): minimum lot ${d.min_lot_sqft.toLocaleString()} sq ft, minimum frontage ${d.min_frontage_ft} ft`);
  }
  lines.push("");
  for (const s of code.sections) lines.push(`Section ${s.id} ${s.title}. ${s.text}`);
  return lines.join("\n");
}
function checklistAsText() {
  const lines = [checklist.title, checklist.notice, ""];
  for (const i of checklist.items) lines.push(`${i.id} ${i.label} (code section ${i.section}). ${i.hint}`);
  return lines.join("\n");
}

const SQFT_PER_ACRE = 43560;

/** Parse "10,000 sq ft", "0.5 acre", "1.2 acres", "12000" into square feet. Returns null if unreadable. */
function parseArea(text) {
  if (text == null) return null;
  if (typeof text === "number") return text;
  const s = String(text).toLowerCase().replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(acres?|ac\b|sq\.?\s*ft|square\s*feet|sf\b|ft2|ft²)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = m[2] || "";
  if (/acre|ac/.test(unit)) return Math.round(n * SQFT_PER_ACRE);
  // No unit: small numbers are almost certainly acres, large numbers square feet.
  if (!unit && n < 50) return Math.round(n * SQFT_PER_ACRE);
  return Math.round(n);
}

/** Parse "60 ft", "60'", "60 feet" into feet. */
function parseLength(text) {
  if (text == null) return null;
  if (typeof text === "number") return text;
  const m = String(text).toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * computeLotSplit({ district, currentArea, proposedAreas, frontages })
 * Pure arithmetic against the code's numbers. Describes facts; does not decide anything.
 */
function computeLotSplit({ district, currentArea, proposedAreas = [], frontages = [] }) {
  const d = code.districts[String(district || "").toUpperCase()] || null;
  const currentSqft = parseArea(currentArea);
  const lots = [];
  const count = Math.max(proposedAreas.length, frontages.length);
  let sumSqft = 0;
  for (let i = 0; i < count; i++) {
    const sqft = parseArea(proposedAreas[i]);
    const frontage = parseLength(frontages[i]);
    if (sqft) sumSqft += sqft;
    const lot = { lot: i + 1, sqft, frontage_ft: frontage };
    if (d) {
      lot.min_lot_sqft = d.min_lot_sqft;
      lot.min_frontage_ft = d.min_frontage_ft;
      lot.size_compared_to_minimum = sqft == null ? "unknown" : sqft >= d.min_lot_sqft ? "at or above minimum" : `below minimum by ${(d.min_lot_sqft - sqft).toLocaleString()} sq ft`;
      lot.frontage_compared_to_minimum = frontage == null ? "unknown" : frontage >= d.min_frontage_ft ? "at or above minimum" : `below minimum by ${d.min_frontage_ft - frontage} ft`;
    }
    lots.push(lot);
  }
  return {
    district: d ? String(district).toUpperCase() : null,
    district_known: !!d,
    current_sqft: currentSqft,
    proposed_total_sqft: sumSqft || null,
    totals_match: currentSqft && sumSqft ? Math.abs(currentSqft - sumSqft) <= Math.max(200, currentSqft * 0.02) : null,
    lot_count: count,
    max_lots_allowed_by_12_01: code.max_lots,
    lots,
    sections_used: ["12.01", "12.03", "12.04"],
  };
}

module.exports = {
  code,
  checklist,
  getSection,
  getChecklistItem,
  codeAsText,
  checklistAsText,
  parseArea,
  parseLength,
  computeLotSplit,
  SQFT_PER_ACRE,
};
