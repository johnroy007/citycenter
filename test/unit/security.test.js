"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough } = require("stream");
const sec = require("../../lib/security");
const { validateImage } = require("../../lib/sketch");

test("staff tokens verify only with the right secret and before expiry", () => {
  const tok = sec.signStaffToken("s3cret-s3cret-s3cret", 1000);
  assert.equal(sec.verifyStaffToken(tok, "s3cret-s3cret-s3cret"), true);
  assert.equal(sec.verifyStaffToken(tok, "other"), false);
  assert.equal(sec.verifyStaffToken("garbage", "s3cret-s3cret-s3cret"), false);
  const expired = sec.signStaffToken("s3cret-s3cret-s3cret", -1);
  assert.equal(sec.verifyStaffToken(expired, "s3cret-s3cret-s3cret"), false);
});

test("constantTimeEqual handles different lengths", () => {
  assert.equal(sec.constantTimeEqual("abc", "abc"), true);
  assert.equal(sec.constantTimeEqual("abc", "abcd"), false);
  assert.equal(sec.constantTimeEqual("", ""), true);
});

test("rate limiter allows `limit` then blocks", () => {
  const rl = sec.createRateLimiter({ limit: 3, windowMs: 60000 });
  assert.deepEqual([rl.check("a"), rl.check("a"), rl.check("a"), rl.check("a"), rl.check("b")], [true, true, true, false, true]);
});

test("parseCookies and clientIp", () => {
  assert.deepEqual(sec.parseCookies("a=1; cc_staff=x.y; z=%20"), { a: "1", cc_staff: "x.y", z: " " });
  assert.equal(sec.clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, socket: {} }), "1.2.3.4");
  assert.equal(sec.clientIp({ headers: {}, socket: { remoteAddress: "::1" } }), "::1");
});

test("readBody rejects oversize bodies with 413", async () => {
  const req = new PassThrough();
  req.headers = {};
  const p = sec.readBody(req, 10);
  req.write(Buffer.alloc(11));
  req.end();
  await assert.rejects(p, (e) => e.status === 413);
  const req2 = new PassThrough();
  req2.headers = { "content-length": "99999" };
  await assert.rejects(sec.readBody(req2, 10), (e) => e.status === 413);
  const req3 = new PassThrough();
  req3.headers = {};
  const p3 = sec.readBody(req3, 10);
  req3.end("hi");
  assert.equal((await p3).toString(), "hi");
});

test("validateImage checks type, size and magic bytes", () => {
  assert.equal(validateImage("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])), null);
  assert.equal(validateImage("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
  assert.match(validateImage("image/png", Buffer.from("not an image at all")), /real image/);
  assert.match(validateImage("text/html", Buffer.from([0x89, 0x50, 0x4e, 0x47])), /JPEG, PNG/);
  assert.match(validateImage("image/png", Buffer.alloc(6 * 1024 * 1024, 0x89)), /5 MB/);
});
