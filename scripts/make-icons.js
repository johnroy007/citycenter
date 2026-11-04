// Draws the phone app's icons with a headless browser. Run: node scripts/make-icons.js
// The mark is the site's own favicon shape, drawn here; it is not Muse Image art.
"use strict";
const fs = require("fs");
const path = require("path");
const { launch } = require("../video/lib/cdp");

const OUT = path.join(__dirname, "..", "public", "icons");
const mark = (scale) => `<g transform="translate(256 256) scale(${scale}) translate(-256 -270)"><path d="M112 400V208L256 96l144 112v192h-96V288h-96v112z" fill="#fff"/><rect x="232" y="176" width="48" height="48" rx="8" fill="#1f5fbf"/></g>`;
const svg = (round, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f76dd"/><stop offset="1" stop-color="#174a97"/></linearGradient></defs><rect width="512" height="512" rx="${round}" fill="url(#g)"/>${mark(scale)}</svg>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, size, round, scale] of [["icon-192.png", 192, 96, 1], ["icon-512.png", 512, 96, 1], ["icon-maskable-512.png", 512, 0, 0.72], ["apple-touch-icon.png", 180, 0, 0.9]]) {
    const b = await launch({ width: size, height: size, scale: 1, port: 9460 });
    await b.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await b.send("Page.navigate", { url: "data:text/html," + encodeURIComponent(`<!doctype html><body style="margin:0;background:transparent">${svg(round, scale).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`) });
    await new Promise((r) => setTimeout(r, 500));
    const shot = await b.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, "base64"));
    try { b.proc.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 400));
    console.log(name);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
