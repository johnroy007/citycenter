// Loads the active town's configuration from data/towns/<id>.json. The town id comes from the TOWN env var (default trust-city).
// Everything city-specific (name, code host, GIS layers, zones, departments, process tiers, wording) lives in that file,
// so another city is a new config plus cached data, not new code.
// A config may set "sourceName": the town's name as it appears in the cached public data. The loaders swap it for the
// display name ("shortName") in every text value (never in web addresses), so the real code and map layers can be shown
// under a stand-in town name.
"use strict";
const fs = require("fs");
const path = require("path");

const TOWNS_DIR = path.join(__dirname, "..", "data", "towns");

function loadTown(id) {
  const townId = String(id || process.env.TOWN || "trust-city").replace(/[^a-z0-9-]/gi, "");
  const file = path.join(TOWNS_DIR, townId + ".json");
  if (!fs.existsSync(file)) throw new Error(`No town config at ${file}`);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  cfg.id = townId;
  cfg.dataDir = path.join(TOWNS_DIR, townId);
  return cfg;
}

/** renameText(town, text): the source name -> the display name ("<Source> City" -> "Trust City", "<SOURCE>" -> "TRUST CITY"). */
function renameText(town, text) {
  const from = town && town.sourceName, to = town && town.shortName;
  if (!from || !to || from === to || typeof text !== "string" || /^https?:\/\//i.test(text)) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // When the display name already ends in "City", "<Source> City" becomes "Trust City", not "Trust City City".
  const endsInCity = /\bcity$/i.test(to);
  return text
    .replace(new RegExp("\\b" + esc + (endsInCity ? "(?:\\s+City)?" : "") + "\\b", "g"), to)
    .replace(new RegExp("\\b" + esc.toUpperCase() + (endsInCity ? "(?:\\s+CITY)?" : "") + "\\b", "g"), to.toUpperCase());
}

/** renameDeep(town, value): renameText over every string inside a parsed JSON value (arrays and objects changed in place). */
function renameDeep(town, value) {
  if (!town || !town.sourceName) return value;
  if (typeof value === "string") return renameText(town, value);
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) if (value[i] && typeof value[i] !== "number") value[i] = renameDeep(town, value[i]); return value; }
  if (value && typeof value === "object") { for (const k of Object.keys(value)) if (k !== "coordinates") value[k] = renameDeep(town, value[k]); }
  return value;
}

module.exports = { loadTown, renameText, renameDeep, TOWNS_DIR };
