"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../../lib/meta");

function fakeFetch(answers) {
  let i = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    const a = answers[Math.min(i++, answers.length - 1)];
    return { ok: a.status < 400, status: a.status, text: async () => JSON.stringify(a.body), headers: new Map() };
  };
  fn.calls = calls;
  return fn;
}
const notFound = { status: 404, body: { error: { message: "The requested model was not found.", code: "model_not_found" } } };
const ok = { status: 200, body: { choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };

test("a 404 'model not found' is retried, and the retries move to a fresh connection on another Meta address", async () => {
  const fetchImpl = fakeFetch([notFound]);
  const pinnedCalls = [];
  const pinnedPost = async (url, ip, body) => {
    pinnedCalls.push(ip);
    return pinnedCalls.length < 2 ? { status: 404, text: JSON.stringify(notFound.body) } : { status: 200, text: JSON.stringify(ok.body) };
  };
  const client = createClient({ apiKey: "test", fetchImpl, pinnedPost, maxAttempts: 6, retryDelayMs: 0 });
  const out = await client.complete({ messages: [{ role: "user", content: "hi" }] });
  assert.ok(out);
  assert.equal(fetchImpl.calls.length, 1, "the normal path is tried once");
  assert.equal(pinnedCalls.length, 2, "then pinned attempts until one succeeds");
  assert.notEqual(pinnedCalls[0], pinnedCalls[1], "each pinned attempt uses a different address");
});

test("without a pinned sender, a 404 'model not found' is still retried on the normal path", async () => {
  const fetchImpl = fakeFetch([notFound, notFound, ok]);
  const client = createClient({ apiKey: "test", fetchImpl, maxAttempts: 6, retryDelayMs: 0 });
  await client.complete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(fetchImpl.calls.length, 3);
});

test("a 400 from Meta is not retried", async () => {
  const fetchImpl = fakeFetch([{ status: 400, body: { error: { message: "bad request" } } }]);
  const client = createClient({ apiKey: "test", fetchImpl, maxAttempts: 6, retryDelayMs: 0 });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "hi" }] }), /bad request/);
  assert.equal(fetchImpl.calls.length, 1);
});
