// Loads the active town's configuration from data/towns/<id>.json. The town id comes from the TOWN env var (default hildale).
// Everything city-specific (name, code host, GIS layers, zones, departments, process tiers, wording) lives in that file,
// so another city is a new config plus cached data, not new code.
"use strict";
const fs = require("fs");
const path = require("path");

const TOWNS_DIR = path.join(__dirname, "..", "data", "towns");

function loadTown(id) {
  const townId = String(id || process.env.TOWN || "hildale").replace(/[^a-z0-9-]/gi, "");
  const file = path.join(TOWNS_DIR, townId + ".json");
  if (!fs.existsSync(file)) throw new Error(`No town config at ${file}`);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  cfg.id = townId;
  cfg.dataDir = path.join(TOWNS_DIR, townId);
  return cfg;
}

module.exports = { loadTown, TOWNS_DIR };
