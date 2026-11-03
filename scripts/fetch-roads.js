// Pulls the street centerlines around the town from the state's public roads layer into data/towns/<town>/roads.geojson.
// Run: node scripts/fetch-roads.js [--town trust-city]
// Only the street name and the line are kept. The map uses them so a resident can mark a pothole on a real street.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadTown } = require("../lib/townconfig");
const { loadGis } = require("../lib/gis");

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : dflt; };
const round = (c) => (typeof c[0] === "number" ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(round));

(async () => {
  const town = loadTown(arg("--town"));
  const cfg = town.gis.roads;
  const [x1, y1, x2, y2] = loadGis(town).cityBbox;
  const features = [];
  for (let offset = 0; ; ) {
    const q = new URLSearchParams({ where: "1=1", geometry: [x1, y1, x2, y2].join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: cfg.nameField, returnGeometry: "true", outSR: "4326", f: "geojson", resultOffset: String(offset), resultRecordCount: "1000" });
    const res = await fetch(`${cfg.url}/query?${q}`, { headers: { "User-Agent": "Mozilla/5.0 (citycenter gis adapter)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from the roads layer`);
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error).slice(0, 200));
    const batch = data.features || [];
    features.push(...batch);
    if (batch.length < 1000) break;
    offset += batch.length;
  }
  const out = {
    type: "FeatureCollection",
    credit: cfg.credit,
    fetchedAt: new Date().toISOString(),
    features: features.filter((f) => f.geometry).map((f) => ({ type: "Feature", properties: { name: f.properties[cfg.nameField] || "" }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } })),
  };
  const file = path.join(town.dataDir, "roads.geojson");
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`Wrote ${out.features.length} street lines to ${path.relative(process.cwd(), file)} (${Math.round(fs.statSync(file).size / 1024)} KB)`);
})().catch((e) => { console.error(e.message); process.exit(1); });
