// Small security helpers: signed staff cookie, constant-time compare, per-IP rate limit, body size cap, headers.
"use strict";
const crypto = require("crypto");

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Still do a comparison so timing does not reveal the length.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

/** Token = expiry-ms.signature. Valid for `ttlMs` (default 12 hours). */
function signStaffToken(secret, ttlMs = 12 * 60 * 60 * 1000) {
  const exp = String(Date.now() + ttlMs);
  return exp + "." + hmac(secret, "staff:" + exp);
}

function verifyStaffToken(token, secret) {
  if (!token || !secret) return false;
  const i = token.indexOf(".");
  if (i < 1) return false;
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return constantTimeEqual(sig, hmac(secret, "staff:" + exp));
}

/** Generic signed token: subject.expiry-ms.signature. Used for the resident cookie. */
function signToken(secret, subject, ttlMs = 30 * 24 * 60 * 60 * 1000) {
  const exp = String(Date.now() + ttlMs);
  const sub = Buffer.from(String(subject)).toString("base64url");
  return sub + "." + exp + "." + hmac(secret, "tok:" + sub + ":" + exp);
}
function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [sub, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  if (!constantTimeEqual(sig, hmac(secret, "tok:" + sub + ":" + exp))) return null;
  try {
    return Buffer.from(sub, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Password hashing with Node's built-in scrypt. Returns { salt, hash } as base64url strings. */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(String(password), s, 64, { N: 16384, r: 8, p: 1 }).toString("base64url");
  return { salt: s, hash };
}
function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  return constantTimeEqual(hashPassword(password, salt).hash, hash);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Sliding-window limiter: at most `limit` events per `windowMs` per key. */
function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  function check(key) {
    const nowMs = Date.now();
    const arr = (hits.get(key) || []).filter((t) => nowMs - t < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return false;
    }
    arr.push(nowMs);
    hits.set(key, arr);
    if (hits.size > 5000) {
      // Keep memory bounded.
      for (const [k, v] of hits) if (!v.length || nowMs - v[v.length - 1] > windowMs) hits.delete(k);
    }
    return true;
  }
  return { check };
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function isHttps(req) {
  return req.headers["x-forwarded-proto"] === "https" || !!(req.socket && req.socket.encrypted);
}

/** Read the whole body, refusing anything over maxBytes (error.status = 413). */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > maxBytes) {
      const e = new Error("Request too large");
      e.status = 413;
      return reject(e);
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        const e = new Error("Request too large");
        e.status = 413;
        req.destroy();
        return reject(e);
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function securityHeaders(res, https) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
  if (https) res.setHeader("Strict-Transport-Security", "max-age=15552000");
}

module.exports = {
  constantTimeEqual,
  signStaffToken,
  verifyStaffToken,
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  parseCookies,
  createRateLimiter,
  clientIp,
  isHttps,
  readBody,
  securityHeaders,
};
