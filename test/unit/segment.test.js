"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSamText, outlineSketch } = require("../../lib/segment");

const LINE = "<0f>0<|box;x1=302;y1=308;x2=426;y2=402;w=1000;h=760;c=0.53|><|mask;x=0;y=0;c=0.5;data=95,124,!abc~def|>,1<|box;x1=138;y1=118;x2=862;y2=518;w=1000;h=760;c=0.64|><|mask;x=0;y=0;data=400,724,~payload,with,commas|>";

test("parseSamText reads frames, ordinals, boxes, confidence and mask headers", () => {
  const recs = parseSamText(LINE);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0].box, { x1: 302, y1: 308, x2: 426, y2: 402, w: 1000, h: 760, c: 0.53 });
  assert.equal(recs[0].mask.enc, "one_bit");
  assert.equal(recs[0].mask.h, 95);
  assert.equal(recs[1].id, 1);
  assert.equal(recs[1].mask.enc, "lossless");
  assert.deepEqual(parseSamText(""), []);
  assert.deepEqual(parseSamText("garbage"), []);
});

test("outlineSketch collects boxes per prompt, drops the whole-sheet box and tolerates failures", async () => {
  const calls = [];
  const client = {
    segmentImage: async ({ prompt }) => {
      calls.push(prompt);
      if (prompt === "road") throw new Error("boom");
      if (prompt === "rectangle") return "<0f>0<|box;x1=0;y1=0;x2=999;y2=759;w=1000;h=760|>,1<|box;x1=100;y1=100;x2=300;y2=250;w=1000;h=760;c=0.7|>";
      return "";
    },
  };
  const out = await outlineSketch(client, { mime: "image/png", data: Buffer.from("x"), prompts: ["rectangle", "road", "house"] });
  assert.deepEqual(calls, ["rectangle", "road", "house"]);
  assert.equal(out.width, 1000);
  assert.equal(out.objects.length, 1, "whole-sheet box dropped");
  assert.equal(out.objects[0].label, "rectangle");
  assert.ok(out.prompts.find((p) => p.prompt === "road").error);
  assert.equal(await outlineSketch(null, { mime: "image/png", data: Buffer.from("x") }), null);
});
