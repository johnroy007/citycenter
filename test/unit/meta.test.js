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

test("a 404 'model not found' from Meta is retried like a transient error", async () => {
  const notFound = { status: 404, body: { error: { message: "The requested model was not found.", code: "model_not_found" } } };
  const ok = { status: 200, body: { choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
  const fetchImpl = fakeFetch([notFound, notFound, ok]);
  const client = createClient({ apiKey: "test", fetchImpl, maxAttempts: 4, retryDelayMs: 0 });
  const out = await client.complete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(fetchImpl.calls.length, 3);
  assert.ok(out);
});

test("a 400 from Meta is not retried", async () => {
  const bad = { status: 400, body: { error: { message: "bad request" } } };
  const fetchImpl = fakeFetch([bad]);
  const client = createClient({ apiKey: "test", fetchImpl, maxAttempts: 4, retryDelayMs: 0 });
  await assert.rejects(client.complete({ messages: [{ role: "user", content: "hi" }] }), /bad request/);
  assert.equal(fetchImpl.calls.length, 1);
});
