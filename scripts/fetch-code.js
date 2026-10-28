// Pulls a city's published code into data/towns/<town>/code.json so the agent can cite it verbatim.
// Run: node scripts/fetch-code.js [--town hildale] [--from-file saved.html] [--all]
// Keeps every section (complaints about dogs live outside the land use title) and flags the land use ones; --land-use-only drops the rest.
// Public-record text, fetched once and cached. Never hammer the city's site: one request per run.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadTown } = require("../lib/townconfig");
const { parseMunicipalCodeOnline } = require("../lib/codeparse");

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
}

async function main() {
  const town = loadTown(arg("--town", process.env.TOWN || "hildale"));
  const fromFile = arg("--from-file", null);
  const keepAll = !process.argv.includes("--land-use-only");
  let html;
  if (fromFile) {
    html = fs.readFileSync(fromFile, "utf8");
  } else {
    process.stdout.write(`Fetching ${town.code.printUrl} ... `);
    const res = await fetch(town.code.printUrl, { headers: { "User-Agent": "Mozilla/5.0 (citycenter code adapter; one fetch per run)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from the code host`);
    html = await res.text();
    console.log(`${(html.length / 1024 / 1024).toFixed(1)} MB`);
  }
  if (town.code.adapter !== "municipalcodeonline") throw new Error(`No adapter for ${town.code.adapter}`);
  const parsed = parseMunicipalCodeOnline(html, { bookUrl: town.code.bookUrl });
  const landUse = parsed.sections.filter((s) => s.titleName === town.code.landUseTitle);
  for (const s of parsed.sections) s.landUse = s.titleName === town.code.landUseTitle;
  const sections = keepAll ? parsed.sections : landUse;
  const chapters = parsed.chapters.filter((c) => keepAll || c.titleName === town.code.landUseTitle);
  const out = {
    town: town.id,
    cityName: town.name,
    citation: town.code.citation,
    source: fromFile ? `file:${path.basename(fromFile)}` : town.code.printUrl,
    bookUrl: town.code.bookUrl,
    fetchedAt: new Date().toISOString(),
    landUseTitle: town.code.landUseTitle,
    counts: { headings: parsed.headings, sectionsTotal: parsed.sections.length, sectionsKept: sections.length, chaptersKept: chapters.length },
    chapters,
    sections,
  };
  const dir = path.join(__dirname, "..", "data", "towns", town.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "code.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const bytes = fs.statSync(file).size;
  console.log(`Parsed ${parsed.sections.length} sections (${landUse.length} in "${town.code.landUseTitle}"); wrote ${sections.length} to ${path.relative(process.cwd(), file)} (${(bytes / 1024).toFixed(0)} KB)`);
  const empty = sections.filter((s) => !s.text).length;
  if (empty) console.log(`Warning: ${empty} sections have no text.`);
}

main().catch((e) => {
  console.error("fetch-code failed:", e.message);
  process.exit(1);
});
