// Shared helpers for the video capture (see capture.js).
// Usage: node video/capture.js [baseUrl] [--only resident|staff|reply] [--ref HC-2026-0xxx --key ...]
// Output: video/out/capture/<clip>/ (JPEG frames + frames.json + markers.json). Uses only Node built-ins + Chrome.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./lib/cdp");

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || "https://citycenter-puh5.onrender.com").replace(/\/$/, "");
const OUT = path.join(__dirname, "out", "capture");
const ROOT = path.join(__dirname, "..");
const STATE_FILE = path.join(OUT, "visit.json");

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  const txt = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const m = txt.match(new RegExp("^" + name + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

const TURN1 = "Hi. I want to split my lot and sell the back half to my son so he can build a house.";
const TURN2 = "I'm Devon Dunmore, 345 E Jessop Ave, 435-555-0104. The lot is just under an acre. The back half would be about 20,000 square feet with 100 feet of width, and the front half keeps my house. Both halves reach the road, and water and sewer are in the street. Here is my sketch.";

// A visible mouse pointer for viewers (headless screenshots have none).
const CURSOR_JS = `
if (!document.getElementById("vcur")) {
  const d = document.createElement("div"); d.id = "vcur";
  Object.assign(d.style, { position: "fixed", left: "960px", top: "600px", width: "26px", height: "26px", zIndex: 2147483647, pointerEvents: "none", transition: "left .6s cubic-bezier(.4,0,.2,1), top .6s cubic-bezier(.4,0,.2,1)" });
  const ns = "http://www.w3.org/2000/svg", s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", "26"); s.setAttribute("height", "26");
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", "M3 2l7 19 2.6-7.4L20 11z"); p.setAttribute("fill", "#111"); p.setAttribute("stroke", "#fff"); p.setAttribute("stroke-width", "1.6"); p.setAttribute("stroke-linejoin", "round");
  s.appendChild(p); d.appendChild(s); document.body.appendChild(d);
  window.__vcur = (x, y) => { d.style.left = (x - 3) + "px"; d.style.top = (y - 2) + "px"; };
  window.__vclick = (x, y) => { const r = document.createElement("div"); Object.assign(r.style, { position: "fixed", left: (x - 18) + "px", top: (y - 18) + "px", width: "36px", height: "36px", borderRadius: "50%", border: "3px solid rgba(31,95,191,.85)", zIndex: 2147483646, pointerEvents: "none", transition: "transform .5s, opacity .5s" }); document.body.appendChild(r); requestAnimationFrame(() => { r.style.transform = "scale(1.8)"; r.style.opacity = "0"; }); setTimeout(() => r.remove(), 700); };
}`;

// Hides internet addresses (the signature record shows where it was signed from) so none appear in a public video.
const MASK_JS = `
if (!window.__ipmask && document.body) {
  window.__ipmask = true;
  const one = /\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b/, all = /\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b/g;
  const fix = (n) => { if (!n) return; if (n.nodeType === 3) { if (one.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(all, "(address hidden)"); return; }
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode())) if (one.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(all, "(address hidden)"); };
  fix(document.body);
  new MutationObserver((ms) => ms.forEach((m) => { fix(m.target); m.addedNodes.forEach(fix); })).observe(document.body, { childList: true, subtree: true, characterData: true });
}`;

async function setup(b) {
  await b.send("Page.setBypassCSP", { enabled: true });
  // John's call (2026-11-03): the video leaves out the Local Government Trust Gap Model page, so hide its top-bar link while recording.
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = 'a[href="/trust-gap"]{display:none!important}'; document.head.appendChild(st); });` });
  b.on((m) => { if (m.method === "Page.javascriptDialogOpening") b.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {}); });
  b.cursor = async () => { try { await b.eval(CURSOR_JS); await b.eval(MASK_JS); } catch {} };
  b.viewport = async (width, height, scale) => { await b.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false }); b.size = { width, height, scale }; };
  // Move the visible pointer, then click for real.
  b.tap = async (selector, { pause = 650 } = {}) => {
    await b.cursor();
    const bx = await b.box(selector);
    if (!bx) throw new Error("no element " + selector);
    await sleep(250);
    await b.eval(`window.__vcur && window.__vcur(${bx.x}, ${bx.y})`);
    await sleep(pause);
    await b.eval(`window.__vclick && window.__vclick(${bx.x}, ${bx.y})`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await b.send("Input.dispatchMouseEvent", { type, x: bx.x, y: bx.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    await sleep(350);
  };
  // Clicks the first element matching selector whose text includes `text`.
  b.tapText = async (selector, text, opts) => {
    const idx = await b.waitFor(`(() => { const l = [...document.querySelectorAll(${JSON.stringify(selector)})]; const i = l.findIndex(e => e.offsetParent && e.textContent.includes(${JSON.stringify(text)})); return i > -1 ? i + 1 : 0; })()`, 180000);
    await b.eval(`document.querySelectorAll("[data-vt]").forEach((e)=>e.removeAttribute("data-vt")); [...document.querySelectorAll(${JSON.stringify(selector)})][${idx - 1}].setAttribute("data-vt","1");`);
    await b.tap(`[data-vt="1"]`, opts);
  };
  b.markers = [];
  b.mark = (name) => { b.markers.push({ name, t: Date.now() / 1000 }); console.log("  mark", name); };
  b.scrollIn = async (selector, dy, steps = 30, ms = 40) => {
    for (let i = 0; i < steps; i++) { await b.eval(`const e=document.querySelector(${JSON.stringify(selector)}); if(e) e.scrollTop += ${dy / steps};`); await sleep(ms); }
  };
}

async function startClip(b, name) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  b.markers = [];
  const stop = await b.record(dir);
  b.mark("start");
  const finish = async () => {
    b.activeStop = null;
    b.mark("end");
    const frames = await stop();
    fs.writeFileSync(path.join(dir, "markers.json"), JSON.stringify(b.markers, null, 1));
    console.log(`clip ${name}: ${frames.length} frames, ${(b.markers.at(-1).t - b.markers[0].t).toFixed(0)} s`);
  };
  b.activeStop = finish; // so a failed run still saves its timing
  return finish;
}

async function waitIdle(b, timeout = 300000) {
  await sleep(1500);
  await b.waitFor(`!document.querySelector("#chat li.working")`, timeout, 700);
}

async function watchTv(b) {
  // Logs a marker whenever the office TV changes channel by itself.
  let last = "", on = true;
  (async () => { while (on) { try { const l = await b.eval(`return document.getElementById("tvLabel").textContent`); if (l && l !== last) { last = l; b.mark("tv:" + l); } } catch {} await sleep(400); } })();
  return () => { on = false; };
}

module.exports = { setup, startClip, waitIdle, watchTv, readEnv, BASE, OUT, ROOT, STATE_FILE, TURN1, TURN2 };
