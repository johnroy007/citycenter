// Tools the agents may call: read the real code, look up parcels and zones, do arithmetic. Every tool returns facts.
// Shared by the resident-side planner and the staff-side reviewer. No tool decides anything.
"use strict";

const SQFT_PER_ACRE = 43560;

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
  if (!unit && n < 50) return Math.round(n * SQFT_PER_ACRE);
  return Math.round(n);
}
function parseLength(text) {
  if (text == null) return null;
  if (typeof text === "number") return text;
  const m = String(text).toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Pull the standards table rows for one zone out of a "Development Standards" section.
 * Works on the text shape produced by codeparse (rows as "label | v1 | v2 ...", header row naming the zones).
 */
function zoneStandardsFromText(text, zone) {
  const lines = String(text || "").split("\n");
  const z = zone.toUpperCase();
  let cols = null;
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const upper = cells.map((c) => c.toUpperCase());
    if (!cols && upper.includes(z)) {
      cols = upper;
      continue;
    }
    if (!cols) continue;
    const idx = cols.indexOf(z);
    if (idx < 0) continue;
    // Row cells may be shifted by one when the label cell is empty; find the label (first non-empty) then align from the right.
    const label = cells.find((c) => c);
    if (!label || cells.length < 2) continue;
    let value = cells[idx];
    if (cells.length !== cols.length) {
      // Align from the right when the row has a different number of cells.
      const fromRight = cols.length - idx;
      value = cells[cells.length - fromRight];
    }
    if (value && value !== label) rows.push({ standard: label.replace(/\s\d$/, ""), value });
  }
  return rows;
}

function createTools({ code, gis, town }) {
  const zoneCfg = (zone) => (town.zones || {})[String(zone || "").toUpperCase()] || null;

  function zoneStandards(zone) {
    const cfg = zoneCfg(zone);
    if (!cfg) return { error: `Unknown zone ${zone}` };
    const sec = code.getSection(cfg.standardsSection);
    const rows = sec ? zoneStandardsFromText(sec.text, zone) : [];
    const find = (re) => (rows.find((r) => re.test(r.standard)) || {}).value || null;
    return {
      zone: String(zone).toUpperCase(),
      name: cfg.name,
      standards_section: cfg.standardsSection,
      uses_section: cfg.usesSection,
      rows,
      minimum_lot_area: find(/^minimum lot area/i),
      average_lot_area: find(/^average lot area/i),
      minimum_lot_width: find(/^minimum lot width/i),
      max_accessory_building_size: find(/^maximum size, accessory/i),
      max_accessory_building_height: find(/^maximum height, accessory/i),
      front_setback: find(/^any building/i),
      note: rows.length ? "Values copied from the standards table; read the section for footnotes." : "No table rows found for this zone; read the section text.",
    };
  }

  const tools = [
    {
      name: "search_code",
      description: `Search the ${town.name} code for sections about a topic. Returns the best matching section ids with snippets. Use chapter to narrow (e.g. 'CHAPTER 37').`,
      parameters: { type: "object", properties: { query: { type: "string" }, chapter: { type: "string", description: "Optional chapter name fragment." } }, required: ["query"], additionalProperties: false },
      handler: ({ query, chapter }) => ({ results: code.search(query, { limit: 8, chapter: chapter || null }) }),
    },
    {
      name: "get_section",
      description: "Read one code section in full by id (e.g. '152-37-9'). Quote only from this text.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      handler: ({ id }) => {
        const s = code.getSection(id);
        if (!s) return { error: `No section ${id}. Use search_code to find the right id.` };
        return { id: s.id, title: s.title, chapter: s.chapterName, url: s.url, text: s.text.length > 9000 ? s.text.slice(0, 9000) + "\n[...section continues; ask for a narrower search if needed]" : s.text };
      },
    },
    {
      name: "zone_info",
      description: "For a zone code (e.g. 'R1-8', 'RA-1', 'GC'): its name, the section with its permitted/conditional use table, and its development standards (lot area, width, setbacks, accessory building limits) copied from the standards table.",
      parameters: { type: "object", properties: { zone: { type: "string" } }, required: ["zone"], additionalProperties: false },
      handler: ({ zone }) => {
        const cfg = zoneCfg(zone);
        if (!cfg) return { error: `Unknown zone ${zone}. Known zones: ${Object.keys(town.zones).join(", ")}` };
        const uses = code.getSection(cfg.usesSection);
        return { ...zoneStandards(zone), chapter: cfg.chapter, uses_table_excerpt: uses ? uses.text.slice(0, 7000) : null };
      },
    },
    {
      name: "lookup_parcel",
      description: "Find a parcel by street address or parcel id in the county parcel layer. Returns zone, area, and tax-roll facts. No owner names exist in this data.",
      parameters: { type: "object", properties: { address: { type: "string" }, parcel_id: { type: "string" } }, required: [], additionalProperties: false },
      handler: ({ address, parcel_id }) => {
        const r = gis.locate({ address: address || null, parcelId: parcel_id || null });
        const strip = (p) => p && { id: p.id, address: p.address, zone: p.zone, zone_name: p.zoneName, zones_touched: p.zonesTouched, straddles_zones: p.straddlesZones, area_sqft: p.areaSqft, area_acres: p.areaAcres, tax_roll_acres: p.taxRollAcres, property_class: p.propertyClass, houses: p.houses, year_built: p.yearBuilt, subdivision: p.subdivision };
        return { match: r.match, parcel: strip(r.parcel), candidates: r.candidates.map(strip) };
      },
    },
    {
      name: "lot_math",
      description: "Arithmetic only. Compares proposed lot areas and widths to the zone's minimum lot area and width from its standards table, and checks the proposed lots add up to the current parcel. Pass values as written ('0.5 acre', '12,000 sq ft', '70 ft').",
      parameters: {
        type: "object",
        properties: { zone: { type: "string" }, current_area: { type: "string" }, proposed_areas: { type: "array", items: { type: "string" } }, proposed_widths: { type: "array", items: { type: "string" } } },
        required: ["zone", "current_area", "proposed_areas", "proposed_widths"],
        additionalProperties: false,
      },
      handler: ({ zone, current_area, proposed_areas = [], proposed_widths = [] }) => {
        const std = zoneStandards(zone);
        if (std.error) return std;
        const minArea = parseArea(std.minimum_lot_area);
        const minWidth = parseLength(std.minimum_lot_width);
        const current = parseArea(current_area);
        const lots = [];
        let sum = 0;
        const n = Math.max(proposed_areas.length, proposed_widths.length);
        for (let i = 0; i < n; i++) {
          const a = parseArea(proposed_areas[i]);
          const w = parseLength(proposed_widths[i]);
          if (a) sum += a;
          lots.push({
            lot: i + 1,
            area_sqft: a,
            width_ft: w,
            area_vs_minimum: a == null || minArea == null ? "cannot compare" : a >= minArea ? `at or above the ${minArea.toLocaleString()} sq ft minimum` : `below the ${minArea.toLocaleString()} sq ft minimum by ${(minArea - a).toLocaleString()} sq ft`,
            width_vs_minimum: w == null || minWidth == null ? "cannot compare" : w >= minWidth ? `at or above the ${minWidth} ft minimum` : `below the ${minWidth} ft minimum by ${minWidth - w} ft`,
          });
        }
        return {
          zone: std.zone,
          standards_section: std.standards_section,
          minimum_lot_area: std.minimum_lot_area,
          minimum_lot_width: std.minimum_lot_width,
          average_lot_area: std.average_lot_area,
          current_sqft: current,
          proposed_total_sqft: sum || null,
          totals_match: current && sum ? Math.abs(current - sum) <= Math.max(200, current * 0.02) : null,
          lots,
          note: "Facts only. Whether a division is approved is decided by staff under the subdivision chapter.",
        };
      },
    },
    {
      name: "animal_points",
      description: "Arithmetic for section 152-37-15: animal points allowed on a lot (500 points per acre, proportionate for smaller lots) versus points used by the animals listed (chickens/rabbits/ducks/pigeons 3, sheep/goats/roosters 25, swine 75, cows/horses 100).",
      parameters: {
        type: "object",
        properties: { acres: { type: "number" }, animals: { type: "array", items: { type: "object", properties: { type: { type: "string" }, count: { type: "integer" } }, required: ["type", "count"], additionalProperties: false } } },
        required: ["acres", "animals"],
        additionalProperties: false,
      },
      handler: ({ acres, animals }) => {
        const pts = (t) => (/chicken|rabbit|duck|pigeon|hen/i.test(t) ? 3 : /sheep|goat|rooster/i.test(t) ? 25 : /swine|pig|hog/i.test(t) ? 75 : /cow|horse|cattle|steer|mule|donkey/i.test(t) ? 100 : null);
        const allowed = Math.round(Number(acres) * 500);
        let used = 0;
        const detail = animals.map((a) => {
          const p = pts(a.type);
          const subtotal = p == null ? null : p * Number(a.count);
          if (subtotal) used += subtotal;
          return { type: a.type, count: a.count, points_each: p, points: subtotal, note: p == null ? "not in the table; staff decide the category" : "" };
        });
        return { section: "152-37-15", acres, points_allowed: allowed, points_used: used, remaining: allowed - used, animals: detail, zones_named_in_section: ["R1-10", "R1-15", "RA-.5"], note: "The section names the zones where this applies and prohibits fighting cocks; read it for enclosure setbacks." };
      },
    },
    {
      name: "process_info",
      description: "The town's process tiers (who decides what) and application types with their code sections.",
      parameters: { type: "object", properties: { tier: { type: "string", description: "Optional tier id to describe; omit for the full list." } }, required: [], additionalProperties: false },
      handler: ({ tier }) => {
        const tiers = town.processTiers.filter((t) => !tier || t.id === tier);
        return { tiers, application_types: town.applicationTypes, fees: town.wording.fee, timing: town.wording.timing };
      },
    },
  ];
  return { tools, zoneStandards };
}

module.exports = { createTools, zoneStandardsFromText, parseArea, parseLength, SQFT_PER_ACRE };
