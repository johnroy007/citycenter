// The one place citycenter talks to the Meta Model API (Chat Completions, OpenAI-compatible).
// Handles structured output (JSON schema), tool-calling loops, retries, timeouts, and usage logging.
// The API key never leaves this process.
"use strict";

const API_URL = "https://api.meta.ai/v1/chat/completions";
const DEFAULT_MODEL = "muse-spark-1.3";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

class MetaError extends Error {
  constructor(message, { status = 0, code = "meta_error", body = null } = {}) {
    super(message);
    this.name = "MetaError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJson(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some replies wrap JSON in a code fence. Take the first {...} or [...] block.
    const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i) || trimmed.match(/([\[{][\s\S]*[\]}])/);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * createClient({ apiKey, model, onUsage, canCall, fetchImpl })
 *  - onUsage(record): called after every successful call with token counts (for the usage log / spend cap)
 *  - canCall(): return false to refuse new calls (daily cap reached)
 */
function createClient(options = {}) {
  const apiKey = options.apiKey || process.env.MODEL_API_KEY;
  const defaultModel = options.model || process.env.META_MODEL || DEFAULT_MODEL;
  const onUsage = options.onUsage || (() => {});
  const canCall = options.canCall || (() => true);
  const fetchImpl = options.fetchImpl || fetch;
  const maxAttempts = options.maxAttempts || 4;
  const timeoutMs = options.timeoutMs || 180000;

  async function rawRequest(body, tag) {
    if (!apiKey) {
      throw new MetaError("No Meta API key is set. Add MODEL_API_KEY to .env and restart.", { code: "no_key" });
    }
    if (!canCall()) {
      throw new MetaError("The daily model-call limit for this app has been reached. Please try again tomorrow.", {
        code: "daily_cap",
        status: 429,
      });
    }
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const res = await fetchImpl(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const text = await res.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        if (!res.ok) {
          const msg = (data && data.error && (data.error.message || data.error.code)) || `Meta API returned ${res.status}`;
          const err = new MetaError("Meta API error: " + msg, { status: res.status, code: "http_" + res.status, body: data || text.slice(0, 500) });
          if (RETRY_STATUSES.has(res.status) && attempt < maxAttempts) {
            lastErr = err;
            await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 500);
            continue;
          }
          throw err;
        }
        const usage = (data && data.usage) || {};
        onUsage({
          tag: tag || "",
          model: body.model,
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          ms: Date.now() - started,
        });
        return data;
      } catch (e) {
        if (e instanceof MetaError) throw e;
        // Network failure or timeout
        lastErr = new MetaError(
          e.name === "AbortError" ? "The Meta API took too long to answer." : "Could not reach the Meta API. Check the internet connection.",
          { code: e.name === "AbortError" ? "timeout" : "network" }
        );
        if (attempt < maxAttempts) {
          await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 500);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr || new MetaError("Meta API call failed.");
  }

  /**
   * complete({ messages, schema, schemaName, maxTokens, model, reasoning, tools, toolChoice, tag })
   * Returns { message, content, parsed, toolCalls, finishReason }.
   * When `schema` is given, the reply is forced into that JSON shape and `parsed` holds the object.
   */
  async function complete(opts) {
    const body = {
      model: opts.model || defaultModel,
      messages: opts.messages,
      max_completion_tokens: opts.maxTokens || 6000,
    };
    if (opts.reasoning) body.reasoning_effort = opts.reasoning;
    if (typeof opts.temperature === "number") body.temperature = opts.temperature;
    if (opts.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: opts.schemaName || "result", schema: opts.schema },
      };
    }
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (opts.toolChoice) body.tool_choice = opts.toolChoice;
    }
    const data = await rawRequest(body, opts.tag);
    const choice = (data.choices && data.choices[0]) || {};
    const message = choice.message || {};
    const content = typeof message.content === "string" ? message.content : "";
    const result = {
      message,
      content,
      parsed: null,
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      finishReason: choice.finish_reason || "",
      model: data.model || body.model,
    };
    if (opts.schema) {
      result.parsed = extractJson(content);
      if (!result.parsed) {
        if (result.finishReason === "length") {
          throw new MetaError("The model ran out of room before finishing its answer. Try a shorter request.", { code: "length" });
        }
        throw new MetaError("The model did not return the expected structured answer.", { code: "bad_json", body: content.slice(0, 500) });
      }
    }
    return result;
  }

  /**
   * runTools({ messages, tools: [{name, description, parameters, handler}], maxRounds, model, tag })
   * Lets the model call the given tools until it stops, then returns the transcript.
   * Every tool call is logged so the page can show "what the agent checked".
   */
  async function runTools(opts) {
    const transcript = [...opts.messages];
    const toolLog = [];
    const maxRounds = opts.maxRounds || 8;
    const byName = new Map(opts.tools.map((t) => [t.name, t]));
    let rounds = 0;
    let last = null;
    while (rounds < maxRounds) {
      rounds++;
      last = await complete({
        messages: transcript,
        tools: opts.tools,
        toolChoice: "auto",
        model: opts.model,
        maxTokens: opts.maxTokens,
        reasoning: opts.reasoning,
        tag: (opts.tag || "tools") + "#" + rounds,
      });
      if (!last.toolCalls.length) break;
      // Keep the assistant message (with its tool_calls) then answer every call. The API rejects anything else.
      transcript.push({ role: "assistant", content: last.content || "", tool_calls: last.toolCalls });
      for (const call of last.toolCalls) {
        const fn = call.function || {};
        let args = {};
        try {
          args = fn.arguments ? JSON.parse(fn.arguments) : {};
        } catch {
          args = {};
        }
        const tool = byName.get(fn.name);
        let output;
        try {
          output = tool ? await tool.handler(args) : { error: `Unknown tool ${fn.name}` };
        } catch (e) {
          output = { error: String((e && e.message) || e) };
        }
        toolLog.push({ round: rounds, tool: fn.name, args, output });
        transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
      }
    }
    return { transcript, toolLog, rounds, finalContent: last ? last.content : "", hitLimit: rounds >= maxRounds && !!(last && last.toolCalls.length) };
  }

  return { complete, runTools, model: defaultModel, MetaError };
}

module.exports = { createClient, MetaError, extractJson, API_URL, DEFAULT_MODEL };
