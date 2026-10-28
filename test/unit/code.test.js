"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { parseMunicipalCodeOnline, htmlToText } = require("../../lib/codeparse");
const { createCodeStore, loadCode, norm } = require("../../lib/codestore");
const { loadTown } = require("../../lib/townconfig");

const SAMPLE_HTML = `
<div><div class='phx-name '><a class='k-link' href='https://x.example/book?type=ordinances#name=TITLE_XV_LAND_DEVELOPMENT'>TITLE XV LAND DEVELOPMENT</a></div></div>
<p>intro</p>
<div><div class='phx-name '><a class='k-link' href='https://x.example/book?type=ordinances#name=CHAPTER_37_SUPPLEMENTARY'>CHAPTER 37 SUPPLEMENTARY DEVELOPMENT STANDARDS</a></div></div>
<div class='toc'><span><a href='#name=Sec_152-37-9_Fences'>Sec 152-37-9 Fences And Walls</a></span></div>
<div><div class='phx-name '><a class='k-link' href='https://x.example/book?type=ordinances#name=Sec_152-37-9_Fences_And_Walls'>Sec 152-37-9 Fences &amp; Walls</a></div></div>
<style>body{}</style><ol><li>Height:<br>Fences in a required front yard shall not exceed four (4) feet.</li><li>Side yards: six (6) feet.</li></ol>
<table><tr><td>Zone</td><td>Max</td></tr><tr><td>R1-8</td><td>6 ft</td></tr></table>
<div><div class='phx-name '><a class='k-link' href='https://x.example/book?type=ordinances#name=Sec_152-37-10_Flag_Lots'>Sec 152-37-10 Flag Lots</a></div></div>
<p>A flag lot is a lot with access by a narrow strip.</p>
`;

test("htmlToText keeps list items and table rows readable and strips style blocks", () => {
  const t = htmlToText("<style>x{}</style><ol><li>One<br>two</li><li>Three</li></ol><table><tr><td>a</td><td>b</td></tr></table><p>end &amp; done</p>");
  assert.match(t, /- One\ntwo\n- Three/);
  assert.match(t, /a \| b/);
  assert.match(t, /end & done/);
  assert.doesNotMatch(t, /x\{\}/);
});

test("parseMunicipalCodeOnline splits sections under their title and chapter", () => {
  const out = parseMunicipalCodeOnline(SAMPLE_HTML, { bookUrl: "https://x.example/book?type=ordinances" });
  assert.equal(out.sections.length, 2);
  const fences = out.sections[0];
  assert.equal(fences.id, "152-37-9");
  assert.equal(fences.title, "Fences & Walls");
  assert.equal(fences.titleName, "TITLE XV LAND DEVELOPMENT");
  assert.match(fences.chapterName, /CHAPTER 37/);
  assert.match(fences.text, /front yard shall not exceed four \(4\) feet/);
  assert.match(fences.text, /R1-8 \| 6 ft/);
  assert.doesNotMatch(fences.text, /Flag Lots/);
  assert.equal(fences.url, "https://x.example/book?type=ordinances#name=Sec_152-37-9_Fences_And_Walls");
  assert.equal(out.sections[1].id, "152-37-10");
  assert.equal(out.chapters.length, 1);
});

test("code store: lookup, search and quote verification", () => {
  const out = parseMunicipalCodeOnline(SAMPLE_HTML, { bookUrl: "https://x.example/book" });
  const store = createCodeStore({ town: "t", sections: out.sections, chapters: out.chapters });
  assert.equal(store.getSection("Sec 152-37-9").id, "152-37-9");
  assert.equal(store.getSection("section 152-37-10").id, "152-37-10");
  assert.equal(store.getSection("152-99-1"), null);
  const hits = store.search("fence height front yard");
  assert.equal(hits[0].id, "152-37-9");
  assert.equal(store.verifyQuote("Fences in a required front yard shall not exceed four (4) feet", "152-37-9").verified, true);
  assert.equal(store.verifyQuote("fences in a required front yard shall not exceed four feet", "152-37-9").verified, false, "changed wording is not a verified quote");
  assert.equal(store.verifyQuote("A flag lot is a lot with access by a narrow strip.").verified, true, "finds the section when none is named");
  assert.equal(store.verifyQuote("Fences shall be painted blue", "152-37-9").verified, false);
  assert.equal(store.verifyQuote("narrow strip").verified, false, "short quotes need a section");
  assert.equal(norm("“Smart” quotes — and  spaces"), "smart quotes - and spaces");
});

test("the cached Hildale code loads with the land use chapters the scenarios need", { skip: !fs.existsSync(path.join(__dirname, "..", "..", "data", "towns", "hildale", "code.json")) }, () => {
  const store = loadCode(loadTown("hildale"));
  assert.ok(store.count > 300, "expected a few hundred land use sections");
  for (const id of ["152-7-7", "152-7-9", "152-7-12", "152-13-3", "152-14-3", "152-37-9", "152-37-15", "152-39-4", "152-41-4", "152-42-4", "152-9-5"]) {
    assert.ok(store.getSection(id), `section ${id} present`);
  }
  assert.ok(store.search("accessory dwelling unit").slice(0, 4).some((h) => h.chapter.includes("41")), "chapter 41 is among the top hits");
  const s = store.getSection("152-37-9");
  const firstSentence = s.text.split(/\n/).find((l) => l.split(" ").length > 6);
  assert.equal(store.verifyQuote(firstSentence, "152-37-9").verified, true);
  assert.equal(store.verifyQuote("Roosters are welcome everywhere in the city.", "152-37-15").verified, false);
});
