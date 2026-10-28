// Parses a city code published on Municipal Code Online (the "print whole book" view) into plain sections.
// Pure functions, no network, no model calls. Other code hosts get their own parser later; the output shape is shared:
//   { id, number, title, titleName, chapterName, articleName, text, url }
"use strict";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sect: "§", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", deg: "°", frac12: "½", frac14: "¼", frac34: "¾" };

function unescapeHtml(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z0-9]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

/** HTML fragment -> readable plain text. Keeps list items on their own lines and table rows as "cell | cell". */
function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Tables: one line per row, cells separated by " | ".
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => {
    const rows = [];
    for (const row of inner.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const cells = [];
      for (const cell of row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || []) {
        const t = cell.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
        cells.push(unescapeHtml(t).replace(/\s+/g, " ").trim());
      }
      if (cells.some((c) => c)) rows.push(cells.join(" | "));
    }
    return "\n" + rows.join("\n") + "\n";
  });
  // Ordered/unordered lists: each item on its own line.
  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "\n");
  s = s.replace(/<\/?(ol|ul)\b[^>]*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|blockquote|section)>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|blockquote|section)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = unescapeHtml(s);
  s = s.replace(/\r/g, "");
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

const HEADING_RE = /<div class='phx-name[^']*'><a[^>]*href='([^']*)#name=([^']+)'[^>]*>([^<]*)<\/a><\/div>/g;

/**
 * parseMunicipalCodeOnline(html, { bookUrl })
 * Returns { headings, sections, chapters } where sections follow the shared shape.
 */
function parseMunicipalCodeOnline(html, opts = {}) {
  const heads = [];
  let m;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(html))) {
    heads.push({ pos: m.index, end: m.index + m[0].length, href: m[1], anchor: m[2], label: unescapeHtml(m[3]).replace(/\s+/g, " ").trim() });
  }
  const sections = [];
  const chapters = [];
  let titleName = "";
  let chapterName = "";
  let articleName = "";
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const kind = h.anchor.split("_")[0];
    const bodyHtml = html.slice(h.end, i + 1 < heads.length ? heads[i + 1].pos : html.length);
    if (kind === "TITLE") {
      titleName = h.label;
      chapterName = "";
      articleName = "";
      continue;
    }
    if (kind === "CHAPTER") {
      chapterName = h.label;
      articleName = "";
      chapters.push({ name: h.label, titleName, anchor: h.anchor, url: (opts.bookUrl || h.href) + "#name=" + h.anchor });
      continue;
    }
    if (kind === "ARTICLE") {
      articleName = h.label;
      continue;
    }
    if (kind !== "Sec") continue;
    // Label looks like "Sec 152-13-3 Uses Allowed"; anchor like "Sec_152-13-3_Uses_Allowed".
    const lm = h.label.match(/^Sec\.?\s+([0-9A-Za-z.]+(?:-[0-9A-Za-z.]+)*)\s*(.*)$/);
    if (!lm) continue;
    const id = lm[1];
    const title = lm[2].trim();
    const text = htmlToText(bodyHtml);
    sections.push({
      id,
      number: "Sec " + id,
      title,
      titleName,
      chapterName,
      articleName,
      text,
      url: (opts.bookUrl || h.href) + "#name=" + h.anchor,
    });
  }
  return { headings: heads.length, sections, chapters };
}

module.exports = { parseMunicipalCodeOnline, htmlToText, unescapeHtml };
