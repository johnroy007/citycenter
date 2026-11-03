// Records the real site for the demo video: a resident visit (lot split), the staff review, and the reply.
// Usage: node video/capture.js [baseUrl] [--only resident|staff|reply] [--ref HC-2026-0xxx]
// Output: video/out/capture/<clip>/ (JPEG frames, frames.json, markers.json). Node built-ins and Chrome only.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { launch, sleep } = require("./lib/cdp");
const { setup, startClip, waitIdle, watchTv, readEnv, BASE, OUT, ROOT, STATE_FILE, TURN1, TURN2 } = require("./capture-base");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i > -1 ? args[i + 1] : null; };
const ONLY = flag("only");

async function signatureStroke(b) {
  // Draws a cursive-looking signature on the canvas with real mouse drags.
  const box = await b.eval(`const c=document.querySelector("canvas.sigpad"); c.scrollIntoView({block:"center",behavior:"instant"}); window.scrollTo({top:0,left:0,behavior:"instant"}); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};`);
  await sleep(600);
  const P = (u, v) => ({ x: box.x + box.w * u, y: box.y + box.h * v });
  const strokes = [];
  const s1 = [];
  for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + (Math.PI * 2 * i) / 40; s1.push(P(0.12 + 0.07 * Math.cos(a), 0.45 + 0.25 * Math.sin(a))); }
  strokes.push([P(0.12, 0.2), P(0.12, 0.45), P(0.12, 0.7)], s1);
  const s2 = [];
  for (let i = 0; i <= 120; i++) { const u = 0.22 + (0.55 * i) / 120; s2.push(P(u, 0.55 - 0.16 * Math.abs(Math.sin(i / 6.5)) - 0.05 * Math.sin(i / 21))); }
  strokes.push(s2);
  const s3 = [];
  for (let i = 0; i <= 40; i++) { const u = 0.2 + (0.62 * i) / 40; s3.push(P(u, 0.74 + 0.04 * Math.sin(i / 6))); }
  strokes.push(s3);
  for (const st of strokes) {
    await b.eval(`window.__vcur && window.__vcur(${st[0].x}, ${st[0].y})`);
    await sleep(350);
    await b.eval(`document.getElementById("vcur").style.transition="none"`);
    await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: st[0].x, y: st[0].y });
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: st[0].x, y: st[0].y, button: "left", buttons: 1, clickCount: 1 });
    for (const p of st) {
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "left", buttons: 1 });
      await b.eval(`window.__vcur(${p.x}, ${p.y})`);
      await sleep(12);
    }
    const e = st[st.length - 1];
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: e.x, y: e.y, button: "left", buttons: 0, clickCount: 1 });
    await b.eval(`document.getElementById("vcur").style.transition=""`);
    await sleep(200);
  }
}

// Holds the real microphone button while Chrome plays video/turn1.wav into the fake microphone, so Muse Voice Transcribe
// does the real work. Falls back to typing when that recording is missing or nothing comes back.
const VOICE_FILE = path.join(__dirname, "turn1.wav");
async function speakTurn(b) {
  if (!fs.existsSync(VOICE_FILE)) return false;
  const ms = ((fs.statSync(VOICE_FILE).size - 44) / 32000) * 1000 + 900; // 16 kHz, 16-bit, mono
  await b.cursor();
  const bx = await b.box("#micBtn");
  await b.eval(`window.__vcur && window.__vcur(${bx.x}, ${bx.y})`);
  await sleep(800);
  await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: bx.x, y: bx.y });
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: bx.x, y: bx.y, button: "left", buttons: 1, clickCount: 1 });
  b.mark("mic-down");
  await sleep(ms);
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: bx.x, y: bx.y, button: "left", buttons: 0, clickCount: 1 });
  b.mark("mic-up");
  try {
    await b.waitFor(`document.getElementById("text").value.trim().length > 20`, 25000);
  } catch {
    return false;
  }
  console.log("  heard:", await b.eval(`return document.getElementById("text").value`));
  await sleep(1800);
  return true;
}

const hasChip = (b, text) => b.eval(`return [...document.querySelectorAll("button.qchip")].some(e => e.textContent.includes(${JSON.stringify(text)}))`);

async function resident(b) {
  await b.goto(BASE + "/", 3500);
  await b.cursor();
  const stop = await startClip(b, "resident");
  const stopTv = await watchTv(b);
  await sleep(2500);
  b.mark("home");
  if (!(await speakTurn(b))) {
    await b.tap("#text");
    await b.type(TURN1, 40);
  }
  b.mark("typed1");
  await b.tap("#send");
  b.mark("sent1");
  await b.waitFor(`[...document.querySelectorAll("button.qchip")].some(e => /Yes/.test(e.textContent))`, 180000);
  b.mark("consent-offer");
  await sleep(3500);
  await b.tapText("button.qchip", "Yes", { pause: 900 });
  b.mark("consent-yes");
  await waitIdle(b);
  b.mark("juniper-asks");
  await sleep(3500);
  const { root } = await b.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await b.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#image" });
  await b.tap("#attachBtn", { pause: 500 });
  await b.send("DOM.setFileInputFiles", { nodeId, files: [path.join(ROOT, "public", "sketches", "sketch-jessop.png")] });
  await sleep(1800);
  b.mark("attached");
  await b.tap("#text", { pause: 300 });
  await b.type(TURN2, 22);
  b.mark("typed2");
  await b.tap("#send");
  b.mark("sent2");
  await waitIdle(b, 420000);
  for (let round = 0; round < 2 && !(await hasChip(b, "Sign and submit")); round++) {
    // The planner asked something more; answer simply so the paperwork gets drafted.
    b.mark("extra-question");
    await sleep(2500);
    await b.tap("#text", { pause: 300 });
    await b.type("That's everything I know right now. Please prepare the paperwork.", 30);
    await b.tap("#send");
    await waitIdle(b, 420000);
  }
  b.mark("drafted");
  await sleep(4000);
  stopTv();
  // Tour the four channels with the remote.
  for (const ch of ["map", "code", "submissions", "paperwork"]) {
    await b.tap(`.rbtn[data-channel="${ch}"]`, { pause: 500 });
    b.mark("ch:" + ch);
    await sleep(3500);
    await b.scrollIn("#screen", ch === "paperwork" ? 1400 : 500, ch === "paperwork" ? 70 : 30, 45);
    await sleep(2000);
    await b.eval(`document.getElementById("screen").scrollTop = 0`);
  }
  await signAndSubmit(b);
  const visit = await b.eval(`return { code: document.getElementById("refline").textContent.trim(), href: location.href }`);
  await stop();
  return visit;
}

async function signAndSubmit(b) {
  await b.tapText("button.qchip", "Sign and submit", { pause: 800 });
  b.mark("sign-open");
  await sleep(2500);
  await signatureStroke(b);
  b.mark("signed");
  await sleep(800);
  await b.tap("#sigAgree", { pause: 500 });
  await sleep(600);
  await b.tapText(".signpanel button", "Sign and submit", { pause: 700 });
  b.mark("submit-click");
  await b.waitFor(`/submitted/i.test(document.getElementById("statusChip").textContent) || /Submitted /.test(document.getElementById("screen").textContent) || /submitted/i.test(document.getElementById("chat").textContent.slice(-600))`, 120000);
  await sleep(1500);
  b.mark("submitted");
  await sleep(5000);
}

async function staff(b, ref) {
  const pass = readEnv("STAFF_PASSCODE");
  await b.viewport(1280, 720); // larger text for the dense staff screens; 2560x1440 frames
  await b.goto(BASE + "/staff", 2500);
  const loggedIn = await b.eval(`return !document.getElementById("app").classList.contains("hidden")`);
  if (!loggedIn) {
    await b.eval(`document.getElementById("passcode").value = ${JSON.stringify(pass)}; document.getElementById("loginForm").requestSubmit();`);
    await b.waitFor(`!document.getElementById("app").classList.contains("hidden")`, 20000);
  }
  await sleep(2000);
  await b.cursor();
  const stop = await startClip(b, "staff");
  await sleep(2500);
  b.mark("queue");
  const rowSel = `[...document.querySelectorAll("#queue tr")].find(r => r.textContent.includes(${JSON.stringify(ref)}))`;
  await b.waitFor(`!!${rowSel}`, 30000);
  await b.eval(`${rowSel}.setAttribute("data-vt","row")`);
  await b.tap(`[data-vt="row"]`, { pause: 900 });
  b.mark("open");
  await sleep(1500);
  await b.tap("#qToggle", { pause: 600 }); // collapse the queue to give the review the whole screen
  b.mark("collapsed");
  await b.waitFor(`/Generated/.test(document.getElementById("rightPane").textContent)`, 300000);
  b.mark("step1");
  await sleep(4000);
  await b.scrollIn("#rightPane", 700, 50, 50);
  await sleep(1500);
  const tabs = await b.eval(`return document.querySelectorAll("button.doctab").length`);
  for (let i = 1; i < Math.min(tabs, 3); i++) {
    await b.eval(`document.querySelectorAll("button.doctab").forEach((e,j)=>e.toggleAttribute("data-vt", j===${i}))`);
    await b.tap(`button.doctab[data-vt]`, { pause: 500 });
    b.mark("doctab" + i);
    await sleep(3000);
  }
  await b.tap(`.stepbtn[data-step="2"]`);
  b.mark("step2-click");
  await b.waitFor(`/Generated/.test(document.getElementById("leftPane").textContent + document.getElementById("rightPane").textContent)`, 300000);
  b.mark("step2");
  await sleep(3500);
  const det = await b.eval(`const d=[...document.querySelectorAll("#leftPane details, #rightPane details")].find(d=>d.offsetParent); if(!d) return false; d.querySelector("summary").setAttribute("data-vt","sum"); return true;`);
  if (det) { await b.tap(`[data-vt="sum"]`); b.mark("step2-detail"); await sleep(3500); }
  await b.tap(`.stepbtn[data-step="3"]`);
  b.mark("step3-click");
  await b.waitFor(`document.querySelectorAll(".point").length > 0`, 400000);
  b.mark("step3");
  await sleep(3500);
  const n = await b.eval(`return document.querySelectorAll(".point").length`);
  await b.eval(`document.querySelectorAll(".point .ptop")[0].setAttribute("data-vt","p0")`);
  await b.tap(`[data-vt="p0"]`);
  b.mark("point-open");
  await sleep(5000);
  const markBtn = async (i, cls) => {
    await b.eval(`document.querySelectorAll("[data-vt=mk]").forEach(e=>e.removeAttribute("data-vt")); document.querySelectorAll(".point")[${i}].querySelector("button.mark.${cls}").setAttribute("data-vt","mk")`);
    await b.tap(`[data-vt="mk"]`, { pause: 500 });
    await sleep(1800);
  };
  await markBtn(0, "met"); b.mark("approve1");
  if (n > 1) { await markBtn(1, "met"); b.mark("approve2"); }
  if (n > 2) {
    await markBtn(2, "cannot_verify"); b.mark("needsinfo");
    await b.eval(`document.querySelectorAll(".point")[2].querySelector("textarea.pnote").setAttribute("data-vt","note")`);
    await b.tap(`[data-vt="note"]`, { pause: 400 });
    await b.type("Please add the width of the shared driveway to the drawing.", 28);
    await b.eval(`document.activeElement.blur()`);
    await sleep(2000);
    b.mark("comment");
  }
  await b.tapText("button", "Second read (Muse Wonder)", { pause: 700 });
  b.mark("second-click");
  await b.waitFor(`[...document.querySelectorAll(".notice")].some(e => /Second read \\(/.test(e.textContent))`, 300000);
  await sleep(1000);
  b.mark("second");
  await b.eval(`const e=[...document.querySelectorAll(".notice")].find(e => /Second read \\(/.test(e.textContent)); e && e.scrollIntoView({block:"center"})`);
  await sleep(5000);
  await b.tap(`.stepbtn[data-step="4"]`);
  b.mark("step4-click");
  await b.waitFor(`(() => { const t = document.querySelector("#leftPane textarea, #rightPane textarea"); return t && t.value.length > 200; })()`, 300000);
  b.mark("step4");
  await sleep(4000);
  await b.eval(`const t=document.querySelector("#leftPane textarea, #rightPane textarea"); t && t.scrollIntoView({block:"start"})`);
  await sleep(3000);
  await b.tapText("button", "Send to the resident", { pause: 800 });
  b.mark("sent-letter");
  await sleep(4000);
  const residentHref = await b.eval(`const l = document.getElementById("wsResidentLink"); return l ? l.href : null`);
  await stop();
  return residentHref;
}

async function reply(b, href) {
  await b.viewport(1440, 810);
  await b.goto(href, 4000);
  await b.cursor();
  const stop = await startClip(b, "reply");
  await sleep(2000);
  b.mark("letter-in-chat");
  await b.scrollIn(".chat", 2000, 40, 50);
  await sleep(6000);
  await stop();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${VOICE_FILE}%noloop`] });
  await setup(b);
  let visit = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
  try {
    if (!ONLY || ONLY === "resident") {
      const v = await resident(b);
      const m = v.href.match(/ref=([^&]+)/), k = v.href.match(/key=([^&]+)/);
      visit = { code: v.code, ref: m ? decodeURIComponent(m[1]) : v.code.split(" ")[0], key: k ? decodeURIComponent(k[1]) : null, href: v.href };
      fs.writeFileSync(STATE_FILE, JSON.stringify(visit, null, 1));
      console.log("visit", visit.ref);
    }
    if (ONLY === "sign") {
      // Re-record only the signing, on an existing visit that is ready to submit: --only sign --href "<resident link>"
      await b.goto(flag("href"), 4000);
      await b.cursor();
      const stop = await startClip(b, "sign");
      await sleep(1500);
      await signAndSubmit(b);
      await stop();
    }
    if (!ONLY || ONLY === "staff") {
      visit.residentHref = await staff(b, flag("ref") || visit.ref);
      fs.writeFileSync(STATE_FILE, JSON.stringify(visit, null, 1));
    }
    if (!ONLY || ONLY === "reply") await reply(b, visit.residentHref || visit.href);
  } catch (e) {
    console.error("FAILED:", e.message);
    if (b.activeStop) await b.activeStop().catch(() => {});
    await b.screenshot(path.join(OUT, "failure.png")).catch(() => {});
    process.exitCode = 1;
  } finally { await b.close(); }
})();
