// The city code the agent reads: loads data/towns/<town>/code.json (verbatim sections pulled by scripts/fetch-code.js),
// indexes it, searches it, and verifies quotes against the stored text so a citation can never be invented.
// Plain code, no model calls.
"use strict";
const fs = require("fs");
const path = require("path");

const STOP = new Set("the a an and or of to in on for by with as is are be at from that this shall any such not no which".split(" "));

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\-\.]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^[\.\-]+|[\.\-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Normalize text for quote matching: lower-case, straight quotes, single spaces, no punctuation noise. */
function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[\s]*\|[\s]*/g, " ")
    .replace(/[“”"'`]/g, "")
    .replace(/[\(\)\[\];:,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadCode(town) {
  const file = path.join(town.dataDir, "code.json");
  if (!fs.existsSync(file)) throw new Error(`No cached code for ${town.id}. Run: node scripts/fetch-code.js --town ${town.id}`);
  return createCodeStore(JSON.parse(fs.readFileSync(file, "utf8")));
}

function createCodeStore(data) {
  const sections = data.sections || [];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const chapterOf = new Map();
  for (const s of sections) {
    if (!chapterOf.has(s.chapterName)) chapterOf.set(s.chapterName, []);
    chapterOf.get(s.chapterName).push(s);
  }
  // Inverted index for search.
  const index = new Map();
  const normText = new Map();
  for (const s of sections) {
    const seen = new Map();
    for (const t of tokens(s.title + " " + s.text)) seen.set(t, (seen.get(t) || 0) + 1);
    for (const t of tokens(s.title)) seen.set(t, (seen.get(t) || 0) + 5);
    for (const [t, n] of seen) {
      if (!index.has(t)) index.set(t, []);
      index.get(t).push([s.id, n]);
    }
    normText.set(s.id, norm(s.title + " " + s.text));
  }

  function getSection(id) {
    const key = String(id || "")
      .trim()
      .replace(/^(section|sec\.?)\s*/i, "")
      .replace(/\s+/g, "");
    return byId.get(key) || null;
  }

  function search(query, { limit = 8, chapter = null } = {}) {
    const qs = tokens(query);
    if (!qs.length) return [];
    const scores = new Map();
    for (const q of qs) {
      const posting = index.get(q);
      if (!posting) continue;
      const idf = Math.log(1 + sections.length / posting.length);
      for (const [id, n] of posting) scores.set(id, (scores.get(id) || 0) + idf * Math.log(1 + n));
    }
    // Phrase bonus when the whole query appears verbatim.
    const nq = norm(query);
    for (const [id, sc] of scores) if (nq.length > 6 && normText.get(id).includes(nq)) scores.set(id, sc * 1.5 + 3);
    let ranked = [...scores.entries()].map(([id, score]) => ({ score, section: byId.get(id) }));
    if (chapter) ranked = ranked.filter((r) => r.section.chapterName.toLowerCase().includes(String(chapter).toLowerCase()));
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit).map((r) => ({ id: r.section.id, title: r.section.title, chapter: r.section.chapterName, score: Math.round(r.score * 100) / 100, snippet: snippetFor(r.section, qs) }));
  }

  function snippetFor(s, qs) {
    const text = s.text;
    const low = text.toLowerCase();
    let best = 0;
    for (const q of qs) {
      const i = low.indexOf(q);
      if (i > -1) {
        best = i;
        break;
      }
    }
    const start = Math.max(0, best - 80);
    return (start > 0 ? "…" : "") + text.slice(start, start + 240).replace(/\s+/g, " ") + (start + 240 < text.length ? "…" : "");
  }

  /**
   * verifyQuote(quote, sectionId?) -> { verified, sectionId, title, url, matchedText }
   * A quote is verified when its normalized text appears inside the normalized section text (or any section when no id given).
   * Short quotes (under 4 words) are only verified against the named section.
   */
  function verifyQuote(quote, sectionId) {
    const nq = norm(quote);
    if (!nq) return { verified: false, reason: "empty quote" };
    const words = nq.split(" ").length;
    const candidates = sectionId ? [getSection(sectionId)].filter(Boolean) : words >= 4 ? sections : [];
    for (const s of candidates) {
      if (normText.get(s.id).includes(nq)) return { verified: true, sectionId: s.id, title: s.title, url: s.url };
    }
    // Looser check: allow one missing or changed word for quotes of 8+ words (list markers, stray numbering).
    if (words >= 8) {
      const ws = nq.split(" ");
      for (const s of candidates) {
        const t = normText.get(s.id);
        const head = ws.slice(0, Math.ceil(ws.length / 2)).join(" ");
        const tail = ws.slice(Math.floor(ws.length / 2)).join(" ");
        if (t.includes(head) && t.includes(tail)) return { verified: true, sectionId: s.id, title: s.title, url: s.url, approximate: true };
      }
    }
    return { verified: false, sectionId: sectionId || null, reason: "quote not found in the stored code text" };
  }

  function outline() {
    return [...chapterOf.entries()].map(([name, secs]) => ({ chapter: name, sections: secs.map((s) => ({ id: s.id, title: s.title })) }));
  }

  function sectionsInChapter(chapterName) {
    const key = String(chapterName || "").toLowerCase();
    for (const [name, secs] of chapterOf) if (name.toLowerCase().includes(key)) return secs;
    return [];
  }

  return {
    meta: { town: data.town, cityName: data.cityName, citation: data.citation, source: data.source, bookUrl: data.bookUrl, fetchedAt: data.fetchedAt, landUseTitle: data.landUseTitle },
    sections,
    chapters: data.chapters || [],
    getSection,
    search,
    verifyQuote,
    outline,
    sectionsInChapter,
    count: sections.length,
  };
}

module.exports = { loadCode, createCodeStore, norm, tokens };
