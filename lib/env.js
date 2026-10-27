// Tiny .env loader. No packages. Real environment values always win over the file.
"use strict";
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const target = file || path.join(__dirname, "..", ".env");
  if (!fs.existsSync(target)) return;
  for (const line of fs.readFileSync(target, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) && val !== "") process.env[key] = val;
  }
}

module.exports = { loadEnv };
