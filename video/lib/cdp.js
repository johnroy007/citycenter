// Minimal Chrome DevTools Protocol driver using only Node built-ins (fetch, WebSocket, child_process).
// Used by the video capture scripts to drive a real browser through the live site.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch({ width = 1440, height = 810, scale = 4 / 3, port = 9333, headless = true } = {}) {
  const exe = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("Chrome or Edge not found; set CHROME_PATH");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cc-video-"));
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required", "--force-color-profile=srgb",
    `--window-size=${width},${height}`, "about:blank",
  ];
  if (headless) args.unshift("--headless=new");
  const proc = spawn(exe, args, { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const b = new Browser(ws, proc, profile);
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  b.size = { width, height, scale };
  return b;
}

class Browser {
  constructor(ws, proc, profile) {
    this.ws = ws; this.proc = proc; this.profile = profile; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) for (const l of this.listeners) l(msg);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((l) => l !== fn); }; }
  async goto(url, settle = 1500) {
    const loaded = new Promise((r) => { const off = this.on((m) => { if (m.method === "Page.loadEventFired") { off(); r(); } }); });
    await this.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(30000)]);
    await sleep(settle);
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  // Wait until a JS condition (expression returning truthy) holds.
  async waitFor(cond, timeout = 120000, every = 500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { const v = await this.eval(`return (${cond});`); if (v) return v; } catch {}
      await sleep(every);
    }
    throw new Error("timeout waiting for: " + cond);
  }
  async screenshot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }
  async box(selector) {
    return this.eval(`const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; e.scrollIntoView({block:"nearest",behavior:"instant"}); window.scrollTo({top:0,left:0,behavior:"instant"}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height};`);
  }
  async click(selector) {
    const b = await this.box(selector);
    if (!b) throw new Error("no element " + selector);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await this.send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 });
    await sleep(300);
  }
  // Types like a person: one character at a time.
  async type(text, perChar = 45) {
    for (const ch of text) { await this.send("Input.insertText", { text: ch }); await sleep(perChar + Math.random() * perChar * 0.6); }
  }
  async key(key, code = key, keyCode = 13) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, text: key === "Enter" ? "\r" : undefined });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
  }
  // Screencast: saves JPEG frames with timestamps into dir; returns stop().
  async record(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const frames = [];
    const off = this.on(async (m) => {
      if (m.method !== "Page.screencastFrame") return;
      const { data, metadata, sessionId } = m.params;
      const file = path.join(dir, `f${String(frames.length).padStart(6, "0")}.jpg`);
      frames.push({ file, t: metadata.timestamp });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      this.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    const { width, height, scale } = this.size;
    await this.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: Math.round(width * scale), maxHeight: Math.round(height * scale), everyNthFrame: 1 });
    return async () => {
      await this.send("Page.stopScreencast"); off();
      fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify(frames));
      return frames;
    };
  }
  async close() { try { await this.send("Browser.close"); } catch {} try { this.proc.kill(); } catch {} }
}

module.exports = { launch, sleep };
