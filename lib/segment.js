// Drawing outlines with SAM 3.1: text-prompted boxes around the things a planner looks for on a sketch
// (property lines, buildings, the road, the proposed line). Boxes are in source pixels; the pages draw them as overlays.
// Best effort: any failure returns null and the rest of the pipeline carries on.
"use strict";

// On line drawings SAM answers best to shape words ("rectangle", "dashed line") rather than planning words ("parcel").
const DEFAULT_PROMPTS = ["rectangle", "dashed line", "building", "house", "road"];

/** Parse one SAM output line into records: [{ id, box: {x1,y1,x2,y2,w,h,c}, mask: {h,w,enc,c} }]. */
function parseSamText(text) {
  const out = [];
  if (!text) return out;
  for (const line of String(text).split("\n")) {
    const frameMatch = line.match(/^<(\d+)f>/);
    const frame = frameMatch ? Number(frameMatch[1]) : 0;
    const body = frameMatch ? line.slice(frameMatch[0].length) : line;
    // Records: <ordinal><|box;...|><|mask;...|> separated by commas.
    const re = /(\d+)<\|box;([^|]*)\|>(?:<\|mask;([^|]*)\|>)?/g;
    let m;
    while ((m = re.exec(body))) {
      const kv = (s) => Object.fromEntries(String(s).split(";").filter(Boolean).map((p) => { const i = p.indexOf("="); return i < 0 ? [p, true] : [p.slice(0, i), p.slice(i + 1)]; }));
      const b = kv(m[2]);
      const box = { x1: Number(b.x1), y1: Number(b.y1), x2: Number(b.x2), y2: Number(b.y2), w: Number(b.w), h: Number(b.h), c: b.c != null ? Number(b.c) : null };
      let mask = null;
      if (m[3]) {
        const mk = kv(m[3].replace(/data=.*$/, ""));
        const dm = m[3].match(/data=(\d+),(\d+),(.)/);
        mask = { h: dm ? Number(dm[1]) : null, w: dm ? Number(dm[2]) : null, enc: dm ? (dm[3] === "~" ? "lossless" : "one_bit") : null, c: mk.c != null ? Number(mk.c) : null };
      }
      if ([box.x1, box.y1, box.x2, box.y2].every((n) => Number.isFinite(n))) out.push({ frame, id: Number(m[1]), box, mask });
    }
  }
  return out;
}

/**
 * outlineSketch(client, { mime, data, prompts }) -> { width, height, objects: [{ label, x1, y1, x2, y2, confidence }], prompts }
 * client.segmentImage is the one place that talks to Meta (lib/meta.js).
 */
async function outlineSketch(client, { mime, data, prompts = DEFAULT_PROMPTS }) {
  if (!client || typeof client.segmentImage !== "function") return null;
  const objects = [];
  let width = null;
  let height = null;
  const tried = [];
  for (const prompt of prompts) {
    let text = "";
    try {
      text = await client.segmentImage({ mime, data, prompt });
    } catch (e) {
      tried.push({ prompt, error: e.message });
      continue;
    }
    const recs = parseSamText(text);
    tried.push({ prompt, found: recs.length });
    for (const r of recs) {
      width = width || r.box.w || null;
      height = height || r.box.h || null;
      // Skip boxes that cover nearly the whole image (the sheet itself) and tiny specks.
      const area = (r.box.x2 - r.box.x1) * (r.box.y2 - r.box.y1);
      const full = r.box.w && r.box.h ? r.box.w * r.box.h : null;
      if (full && area > full * 0.92) continue;
      if (area < 40) continue;
      objects.push({ label: prompt, x1: r.box.x1, y1: r.box.y1, x2: r.box.x2, y2: r.box.y2, confidence: r.box.c });
    }
  }
  return { model: "sam-3.1", width, height, objects, prompts: tried };
}

module.exports = { outlineSketch, parseSamText, DEFAULT_PROMPTS };
