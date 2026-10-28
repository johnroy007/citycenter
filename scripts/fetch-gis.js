// Pulls the town's zoning polygons and parcel boundaries from public ArcGIS services into data/towns/<town>/.
// Run: node scripts/fetch-gis.js [--town hildale]
// Only the fields named in the town config are requested. Owner names are never requested, stored or displayed.
// Fetched once and cached (a few hundred KB). Re-run to refresh.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadTown } = require("../lib/townconfig");

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
}

function round(coords) {
  if (typeof coords[0] === "number") return [Math.round(coords[0] * 1e6) / 1e6, Math.round(coords[1] * 1e6) / 1e6];
  return coords.map(round);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (citycenter gis adapter)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.split("?")[0]}`);
  const data = await res.json();
  if (data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data;
}

/** Query every feature of a layer as GeoJSON (WGS84), paging by resultOffset. */
async function queryAll(layerUrl, { where, outFields, geometry = true, pageSize = 1000 }) {
  const features = [];
  let offset = 0;
  for (;;) {
    const q = new URLSearchParams({
      where: where || "1=1",
      outFields: outFields.join(","),
      returnGeometry: geometry ? "true" : "false",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const data = await getJson(`${layerUrl}/query?${q}`);
    const batch = data.features || [];
    features.push(...batch);
    if (batch.length < pageSize && !(data.properties && data.properties.exceededTransferLimit)) break;
    if (!batch.length) break;
    offset += batch.length;
    if (offset > 50000) throw new Error("too many features; refusing to continue");
  }
  return features;
}

async function main() {
  const town = loadTown(arg("--town", process.env.TOWN || "hildale"));
  const dir = path.join(__dirname, "..", "data", "towns", town.id);
  fs.mkdirSync(dir, { recursive: true });
  const g = town.gis;

  process.stdout.write("Zoning... ");
  const zoning = await queryAll(g.zoning.url, { where: g.zoning.where, outFields: ["OBJECTID", g.zoning.zoneField, "GEN_ZONE", "UPDATED"] });
  const zoningOut = {
    type: "FeatureCollection",
    source: g.zoning.url,
    credit: g.zoning.credit,
    fetchedAt: new Date().toISOString(),
    features: zoning.map((f) => ({ type: "Feature", properties: { id: f.properties.OBJECTID, zone: f.properties[g.zoning.zoneField], general: f.properties.GEN_ZONE || null, updated: f.properties.UPDATED || null }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } })),
  };
  fs.writeFileSync(path.join(dir, "zoning.geojson"), JSON.stringify(zoningOut));
  console.log(`${zoning.length} polygons`);

  process.stdout.write("Parcels... ");
  const pf = g.parcels;
  const parcels = await queryAll(pf.url, { where: pf.where, outFields: [pf.idField, pf.addressField, "PARCEL_CITY", "PARCEL_ZIP", "OWN_TYPE", "ParcelsCur"] });
  const parcelsOut = {
    type: "FeatureCollection",
    source: pf.url,
    credit: pf.credit,
    fetchedAt: new Date().toISOString(),
    note: "Owner names are not part of this dataset and are never requested.",
    features: parcels
      .filter((f) => f.geometry)
      .map((f) => ({
        type: "Feature",
        properties: {
          id: f.properties[pf.idField] || null,
          address: f.properties[pf.addressField] || null,
          city: f.properties.PARCEL_CITY || null,
          zip: f.properties.PARCEL_ZIP || null,
          ownType: f.properties.OWN_TYPE || null,
          current: f.properties.ParcelsCur || null,
        },
        geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
      })),
  };
  fs.writeFileSync(path.join(dir, "parcels.geojson"), JSON.stringify(parcelsOut));
  console.log(`${parcelsOut.features.length} parcels (${parcelsOut.features.filter((f) => f.properties.id).length} with ids, ${parcelsOut.features.filter((f) => f.properties.address).length} with addresses)`);

  if (g.lir) {
    process.stdout.write("Tax-roll attributes... ");
    const lir = await queryAll(g.lir.url, { where: g.lir.where, outFields: g.lir.fields, geometry: false });
    const byId = {};
    for (const f of lir) {
      const p = f.properties;
      if (!p.PARCEL_ID) continue;
      byId[p.PARCEL_ID] = { acres: p.PARCEL_ACRES ?? null, propClass: p.PROP_CLASS || null, builtYear: p.BUILT_YR || null, buildingSqft: p.BLDG_SQFT ?? null, houses: p.HOUSE_CNT ?? null, subdivision: p.SUBDIV_NAME || null };
    }
    fs.writeFileSync(path.join(dir, "lir.json"), JSON.stringify({ source: g.lir.url, fetchedAt: new Date().toISOString(), note: "Market values are not stored.", byId }));
    console.log(`${Object.keys(byId).length} records`);
  }
  for (const f of ["zoning.geojson", "parcels.geojson", "lir.json"]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) console.log(`  ${f}: ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
  }
}

main().catch((e) => {
  console.error("fetch-gis failed:", e.message);
  process.exit(1);
});
