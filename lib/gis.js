// Zoning map and parcels for the active town, from the cached GeoJSON pulled by scripts/fetch-gis.js.
// Pure geometry and drawing: point-in-polygon, address search, SVG rendering. No model calls.
// Owner names never exist in this data. Zone lookups are facts for staff to confirm, never decisions.
"use strict";
const fs = require("fs");
const path = require("path");

const ZONE_COLORS = {
  A: "#dfe9c8", // agricultural
  RA: "#e6efd0", // residential agriculture
  R1: "#fdf1c7", // single-family residential
  RM: "#f8dcb3", // multi-family
  MH: "#f3d1c8",
  NC: "#f6c9c9",
  GC: "#f1b3b3",
  HC: "#eaa3a3",
  PC: "#f1b3c9",
  POC: "#f1b3c9",
  MU: "#e9c4e3",
  BMP: "#d9c8ef",
  PO: "#d9d0f0",
  M: "#cfd2e8",
  OS: "#cfe8d8",
  PF: "#c9dce9",
  RR: "#e1d8c3",
  OTH: "#e5e5e5",
};
function zoneColor(code) {
  const c = String(code || "").toUpperCase();
  for (const key of ["POC", "BMP", "RA", "RM", "R1", "MH", "NC", "GC", "HC", "PC", "MU", "PO", "OS", "PF", "RR", "OTH", "M", "A"]) if (c.startsWith(key)) return ZONE_COLORS[key];
  return "#e5e5e5";
}

const ABBREV = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", STREET: "ST", AVENUE: "AVE", ROAD: "RD", DRIVE: "DR", LANE: "LN", COURT: "CT", CIRCLE: "CIR", PLACE: "PL", BOULEVARD: "BLVD", HIGHWAY: "HWY", CANYON: "CYN", "N.": "N", "S.": "S", "E.": "E", "W.": "W", "ST.": "ST", "AVE.": "AVE", "RD.": "RD", "DR.": "DR" };
function normAddress(a) {
  return String(a || "")
    .toUpperCase()
    .replace(/[,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ABBREV[w] || w.replace(/\.$/, ""))
    .filter(Boolean);
}
function normParcelId(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ---------- geometry ----------
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
function ringCentroid(ring) {
  let cx = 0,
    cy = 0,
    a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) {
    const sx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const sy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return [sx, sy];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}
function pointInGeometry(pt, geometry) {
  for (const poly of polygons(geometry)) {
    if (!pointInRing(pt, poly[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.length; i++) if (pointInRing(pt, poly[i])) inHole = true;
    if (!inHole) return true;
  }
  return false;
}
function bboxOf(geometry) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const poly of polygons(geometry)) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
function bboxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
/** Area in square meters for a WGS84 polygon (equirectangular approximation; fine for parcel-sized shapes). */
function geometryAreaSqm(geometry) {
  let total = 0;
  for (const poly of polygons(geometry)) {
    for (let i = 0; i < poly.length; i++) {
      const ring = poly[i];
      const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
      const mx = 111320 * Math.cos(lat0);
      const my = 110574;
      const proj = ring.map(([x, y]) => [x * mx, y * my]);
      const a = Math.abs(ringArea(proj));
      total += i === 0 ? a : -a;
    }
  }
  return total;
}
const SQFT_PER_SQM = 10.7639;
const SQFT_PER_ACRE = 43560;

// ---------- store ----------
function loadGis(town) {
  const dir = town.dataDir;
  const zf = path.join(dir, "zoning.geojson");
  const pf = path.join(dir, "parcels.geojson");
  if (!fs.existsSync(zf) || !fs.existsSync(pf)) throw new Error(`No cached GIS data for ${town.id}. Run: node scripts/fetch-gis.js --town ${town.id}`);
  const zoning = JSON.parse(fs.readFileSync(zf, "utf8"));
  const parcels = JSON.parse(fs.readFileSync(pf, "utf8"));
  const lirFile = path.join(dir, "lir.json");
  const lir = fs.existsSync(lirFile) ? JSON.parse(fs.readFileSync(lirFile, "utf8")).byId || {} : {};
  return createGis({ zoning, parcels, lir, town });
}

function createGis({ zoning, parcels, lir = {}, town = {} }) {
  const zones = zoning.features.map((f) => ({ ...f, bbox: bboxOf(f.geometry) }));
  const parcelList = parcels.features.map((f) => {
    const centroid = ringCentroid(polygons(f.geometry)[0][0]);
    return { ...f, bbox: bboxOf(f.geometry), centroid, sqm: geometryAreaSqm(f.geometry) };
  });
  const byId = new Map();
  for (const p of parcelList) if (p.properties.id) byId.set(normParcelId(p.properties.id), p);
  const zoneNames = (town.zones && Object.fromEntries(Object.entries(town.zones).map(([k, v]) => [k, v.name || k]))) || {};
  const cityBbox = zones.reduce((b, z) => [Math.min(b[0], z.bbox[0]), Math.min(b[1], z.bbox[1]), Math.max(b[2], z.bbox[2]), Math.max(b[3], z.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);

  function zonesAt(pt) {
    const out = [];
    for (const z of zones) if (pt[0] >= z.bbox[0] && pt[0] <= z.bbox[2] && pt[1] >= z.bbox[1] && pt[1] <= z.bbox[3] && pointInGeometry(pt, z.geometry)) out.push(z.properties.zone);
    return [...new Set(out)];
  }
  function zoneAt(lon, lat) {
    return zonesAt([lon, lat])[0] || null;
  }

  /** Zone of a parcel: at its centroid, plus a straddle check on its vertices. */
  function parcelZone(parcel) {
    const main = zonesAt(parcel.centroid);
    const seen = new Set(main);
    for (const poly of polygons(parcel.geometry)) {
      const ring = poly[0];
      const step = Math.max(1, Math.floor(ring.length / 12));
      for (let i = 0; i < ring.length; i += step) {
        // Nudge each vertex slightly toward the centroid so a shared boundary line does not count as the neighbor's zone.
        const v = ring[i];
        const pt = [v[0] + (parcel.centroid[0] - v[0]) * 0.05, v[1] + (parcel.centroid[1] - v[1]) * 0.05];
        for (const z of zonesAt(pt)) seen.add(z);
      }
    }
    const all = [...seen];
    return { zone: main[0] || all[0] || null, zones: all, straddles: all.length > 1 };
  }

  function summarize(parcel) {
    const p = parcel.properties;
    const z = parcelZone(parcel);
    const extra = p.id ? lir[p.id] || {} : {};
    const sqft = Math.round(parcel.sqm * SQFT_PER_SQM);
    return {
      id: p.id,
      address: p.address,
      city: p.city,
      zip: p.zip,
      ownerType: p.ownType,
      zone: z.zone,
      zoneName: z.zone ? zoneNames[z.zone] || null : null,
      zonesTouched: z.zones,
      straddlesZones: z.straddles,
      areaSqft: sqft,
      areaAcres: Math.round((sqft / SQFT_PER_ACRE) * 1000) / 1000,
      taxRollAcres: extra.acres ?? null,
      propertyClass: extra.propClass || null,
      yearBuilt: extra.builtYear || null,
      buildingSqft: extra.buildingSqft ?? null,
      houses: extra.houses ?? null,
      subdivision: extra.subdivision || null,
      centroid: parcel.centroid,
      bbox: parcel.bbox,
    };
  }

  function getParcel(id) {
    return byId.get(normParcelId(id)) || null;
  }

  /** Find parcels by a typed address. Requires the house number to match; scores street words. */
  function searchAddress(text, limit = 5) {
    // Drop a trailing city / state / zip ("..., Hildale, UT 84784") so a street named Utah Ave still counts.
    const trimmed = String(text || "").replace(/[,\s]+(hildale(\s+city)?)?[,\s]*(ut|utah)?[,\s]*(\d{5})?\s*$/i, "");
    const q = normAddress(trimmed);
    const num = q.find((w) => /^\d+$/.test(w));
    if (!num) return [];
    const MINOR = /^(N|S|E|W|NE|NW|SE|SW|ST|AVE|RD|DR|LN|CT|CIR|PL|BLVD|HWY|CYN|WAY)$/;
    const rest = q.filter((w) => w !== num);
    // Street words (e.g. JESSOP, 1400, UTAH) must all match; direction and suffix words only break ties.
    const streetWords = rest.filter((w) => !MINOR.test(w));
    const minorWords = rest.filter((w) => MINOR.test(w));
    if (!streetWords.length) return [];
    const hits = [];
    for (const p of parcelList) {
      if (!p.properties.address) continue;
      const a = normAddress(p.properties.address);
      if (a[0] !== num) continue;
      const tail = a.slice(1);
      if (!streetWords.every((w) => tail.includes(w))) continue;
      let score = 10;
      for (const w of minorWords) if (tail.includes(w)) score += 1;
      hits.push({ score, parcel: p });
    }
    hits.sort((a, b) => b.score - a.score);
    const best = hits[0] ? hits[0].score : 0;
    return hits.filter((h) => h.score === best).slice(0, limit).map((h) => summarize(h.parcel));
  }

  /** Try a parcel id first, then an address. */
  function locate({ parcelId, address }) {
    if (parcelId) {
      const p = getParcel(parcelId);
      if (p) return { match: "parcel_id", parcel: summarize(p), candidates: [] };
    }
    if (address) {
      const cands = searchAddress(address);
      if (cands.length === 1) return { match: "address", parcel: cands[0], candidates: [] };
      if (cands.length > 1) return { match: "ambiguous", parcel: null, candidates: cands };
    }
    return { match: "none", parcel: null, candidates: [] };
  }

  function neighbors(parcel, meters = 120) {
    const dLat = meters / 110574;
    const dLon = meters / (111320 * Math.cos((parcel.centroid[1] * Math.PI) / 180));
    const box = [parcel.centroid[0] - dLon, parcel.centroid[1] - dLat, parcel.centroid[0] + dLon, parcel.centroid[1] + dLat];
    return parcelList.filter((p) => p !== parcel && bboxIntersects(p.bbox, box));
  }

  // ---------- drawing ----------
  function projector(bbox, width, height, pad = 0) {
    const lat0 = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
    const kx = Math.cos(lat0);
    const w = (bbox[2] - bbox[0]) * kx;
    const h = bbox[3] - bbox[1];
    const scale = Math.min((width - 2 * pad) / w, (height - 2 * pad) / h);
    const ox = pad + ((width - 2 * pad) - w * scale) / 2;
    const oy = pad + ((height - 2 * pad) - h * scale) / 2;
    return ([x, y]) => [ox + (x - bbox[0]) * kx * scale, oy + (bbox[3] - y) * scale];
  }
  function pathFor(geometry, proj) {
    const parts = [];
    for (const poly of polygons(geometry)) for (const ring of poly) {
      parts.push(ring.map((pt, i) => (i ? "L" : "M") + proj(pt).map((v) => v.toFixed(1)).join(" ")).join("") + "Z");
    }
    return parts.join("");
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }

  /** SVG of the area around a parcel (or the whole city when no parcel is given). */
  function renderSvg({ parcelId = null, meters = 160, width = 800, height = 600, labels = true } = {}) {
    const target = parcelId ? getParcel(parcelId) : null;
    let bbox;
    if (target) {
      const dLat = meters / 110574;
      const dLon = meters / (111320 * Math.cos((target.centroid[1] * Math.PI) / 180));
      bbox = [target.centroid[0] - dLon, target.centroid[1] - dLat, target.centroid[0] + dLon, target.centroid[1] + dLat];
      // Keep the aspect ratio of the viewport.
      const ratio = width / height;
      const kx = Math.cos((target.centroid[1] * Math.PI) / 180);
      const w = (bbox[2] - bbox[0]) * kx;
      const h = bbox[3] - bbox[1];
      if (w / h < ratio) {
        const nw = (h * ratio) / kx;
        bbox[0] = target.centroid[0] - nw / 2;
        bbox[2] = target.centroid[0] + nw / 2;
      } else {
        const nh = w / ratio;
        bbox[1] = target.centroid[1] - nh / 2;
        bbox[3] = target.centroid[1] + nh / 2;
      }
    } else {
      bbox = cityBbox;
    }
    const proj = projector(bbox, width, height, target ? 0 : 12);
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Zoning map">`];
    out.push(`<rect width="${width}" height="${height}" fill="#f4f1ea"/>`);
    out.push('<g class="zones">');
    for (const z of zones) {
      if (!bboxIntersects(z.bbox, bbox)) continue;
      out.push(`<path d="${pathFor(z.geometry, proj)}" fill="${zoneColor(z.properties.zone)}" stroke="#b9b3a6" stroke-width="${target ? 1 : 0.6}" data-zone="${esc(z.properties.zone)}"/>`);
    }
    out.push("</g>");
    out.push(`<g class="parcels" fill="none" stroke="#8a8378" stroke-width="${target ? 0.9 : 0.25}">`);
    for (const p of parcelList) {
      if (!bboxIntersects(p.bbox, bbox)) continue;
      if (p === target) continue;
      out.push(`<path d="${pathFor(p.geometry, proj)}"${p.properties.id ? ` data-parcel="${esc(p.properties.id)}"` : ""}/>`);
    }
    out.push("</g>");
    if (target && labels) {
      out.push('<g class="zone-labels" font-family="system-ui, sans-serif" font-size="13" fill="#5a544a" text-anchor="middle">');
      const placed = [];
      for (const z of zones) {
        if (!bboxIntersects(z.bbox, bbox)) continue;
        const c = ringCentroid(polygons(z.geometry)[0][0]);
        if (c[0] < bbox[0] || c[0] > bbox[2] || c[1] < bbox[1] || c[1] > bbox[3]) continue;
        const [x, y] = proj(c);
        if (placed.some(([px, py]) => Math.abs(px - x) < 40 && Math.abs(py - y) < 16)) continue;
        placed.push([x, y]);
        out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(z.properties.zone)}</text>`);
      }
      out.push("</g>");
    }
    if (target) {
      out.push(`<path class="target" d="${pathFor(target.geometry, proj)}" fill="rgba(31,95,191,0.18)" stroke="#1f5fbf" stroke-width="3" data-parcel="${esc(target.properties.id || "")}"/>`);
      const [tx, ty] = proj(target.centroid);
      out.push(`<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="4" fill="#1f5fbf"/>`);
      // Scale bar: 100 ft.
      const ft100 = 30.48;
      const dLon100 = ft100 / (111320 * Math.cos((target.centroid[1] * Math.PI) / 180));
      const [sx0] = proj([bbox[0], bbox[1]]);
      const [sx1] = proj([bbox[0] + dLon100, bbox[1]]);
      const len = sx1 - sx0;
      out.push(`<g font-family="system-ui, sans-serif" font-size="12" fill="#5a544a"><rect x="16" y="${height - 26}" width="${len.toFixed(1)}" height="4" fill="#5a544a"/><text x="16" y="${height - 32}">100 ft</text></g>`);
    }
    out.push(`<text x="${width - 8}" y="${height - 8}" font-family="system-ui, sans-serif" font-size="10" fill="#7a7368" text-anchor="end">${esc((zoning.credit || "") + (parcels.credit ? " · " + parcels.credit : ""))}</text>`);
    out.push("</svg>");
    return out.join("");
  }

  return {
    zoneAt,
    zonesAt,
    parcelZone,
    getParcel,
    summarize,
    searchAddress,
    locate,
    neighbors,
    renderSvg,
    zoneColor,
    cityBbox,
    parcels: parcelList,
    zones,
    counts: { zones: zones.length, parcels: parcelList.length, parcelsWithAddress: parcelList.filter((p) => p.properties.address).length },
    credits: { zoning: zoning.credit || "", parcels: parcels.credit || "" },
    fetchedAt: { zoning: zoning.fetchedAt || null, parcels: parcels.fetchedAt || null },
  };
}

module.exports = { loadGis, createGis, pointInRing, pointInGeometry, ringCentroid, geometryAreaSqm, normAddress, normParcelId, zoneColor, SQFT_PER_ACRE };
