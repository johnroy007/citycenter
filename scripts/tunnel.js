// Opens a public link to the app running on this laptop, for when the cloud host cannot reach Meta.
// Run: npm start (in one window), then npm run tunnel (in another). Prints the public link.
// Uses Cloudflare's quick tunnel (no account needed). Looks for cloudflared on PATH, then in the
// portable location %LOCALAPPDATA%\cloudflared\cloudflared.exe (download from
// https://github.com/cloudflare/cloudflared/releases). The link changes every time the tunnel starts.
"use strict";
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const port = process.env.PORT || 3000;
function findCloudflared() {
  const which = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["cloudflared"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split(/\r?\n/)[0];
  const local = path.join(process.env.LOCALAPPDATA || "", "cloudflared", "cloudflared.exe");
  if (fs.existsSync(local)) return local;
  return null;
}
const bin = findCloudflared();
if (!bin) {
  console.error("cloudflared is not installed. Download cloudflared-windows-amd64.exe from https://github.com/cloudflare/cloudflared/releases");
  console.error(`and save it as ${path.join(process.env.LOCALAPPDATA || "%LOCALAPPDATA%", "cloudflared", "cloudflared.exe")}, then run npm run tunnel again.`);
  process.exit(1);
}
console.log(`Starting a Cloudflare quick tunnel to http://localhost:${port} ...`);
const child = spawn(bin, ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
let announced = false;
function watch(chunk) {
  const text = chunk.toString();
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !announced) {
    announced = true;
    console.log("\n==============================================================");
    console.log(`  PUBLIC LINK:  ${m[0]}`);
    console.log(`  Staff portal: ${m[0]}/staff`);
    console.log("  Keep this window open. Closing it ends the link.");
    console.log("==============================================================\n");
    try { fs.writeFileSync(path.join(__dirname, "..", "data", "runtime", "tunnel-url.txt"), m[0] + "\n"); } catch {}
  }
  if (/error|fail/i.test(text) && !/no-autoupdate/.test(text)) process.stderr.write(text);
}
child.stdout.on("data", watch);
child.stderr.on("data", watch);
child.on("exit", (code) => { console.log(`Tunnel closed (${code}).`); process.exit(code || 0); });
process.on("SIGINT", () => child.kill());
