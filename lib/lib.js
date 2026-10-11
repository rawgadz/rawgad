// api/_lib.js
// Common utilities for Vercel Serverless Functions in Rawgadz
// Includes standardized responses, CORS headers, body parsing, and cryptographic Admin Token Authentication Guards

const crypto = require("crypto");

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, X-Admin-Token, X-Auth-Token");
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }

  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function json(res, statusCode, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(statusCode).json(data);
}

function ok(res, data = {}) {
  return json(res, 200, { success: true, ...data });
}

function badRequest(res, message = "Bad Request") {
  return json(res, 400, { success: false, error: message });
}

function unauthorized(res, message = "Unauthorized: Admin authentication required") {
  return json(res, 401, { success: false, error: message, code: "UNAUTHORIZED" });
}

function forbidden(res, message = "Forbidden: Access denied") {
  return json(res, 403, { success: false, error: message, code: "FORBIDDEN" });
}

function notFound(res, message = "Not Found") {
  return json(res, 404, { success: false, error: message });
}

function serverError(res, err) {
  console.error("[API Error]", err);
  const message = err && err.message ? err.message : "Internal Server Error";
  return json(res, 500, { success: false, error: message });
}

// ====================================================
// Cryptographic Token Signing & Verification (HMAC-SHA256)
// ====================================================

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  return Buffer.from(str, "base64").toString("utf8");
}

function signToken(payload, secret) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${header}.${body}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch (_) {
    return null;
  }
}

function getAdminAuthSecret() {
  try {
    const { loadEnvFallback } = require("./db");
    loadEnvFallback();
  } catch (_) {}
  return process.env.AUTH_SECRET || "rawgad_default_secure_auth_secret_2026";
}

function extractAdminToken(req) {
  if (!req) return null;

  // 1. Authorization: Bearer <token>
  const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (authHeader && typeof authHeader === "string") {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      return trimmed.slice(7).trim();
    }
    // Also accept raw token in Authorization header if not prefixed
    if (trimmed.includes(".")) {
      return trimmed;
    }
  }

  // 2. Custom header x-admin-token or x-auth-token
  if (req.headers) {
    const customHeader = req.headers["x-admin-token"] || req.headers["x-auth-token"];
    if (customHeader && typeof customHeader === "string") {
      return customHeader.trim();
    }
  }

  // 3. Query string token (?token= or ?auth_token=)
  if (req.query) {
    const qToken = req.query.token || req.query.auth_token;
    if (qToken && typeof qToken === "string") {
      return qToken.trim();
    }
  }

  return null;
}

/**
 * Validates request authentication without sending an HTTP response.
 * Returns decoded payload { email, name, exp } on success, or null on failure.
 */
function verifyAdminRequest(req) {
  const token = extractAdminToken(req);
  if (!token) return null;
  const secret = getAdminAuthSecret();
  return verifyToken(token, secret);
}

/**
 * Server-side guard for Administrative Serverless Endpoints.
 * Enforces valid admin JWT token. Automatically responds with 401 Unauthorized if invalid.
 * Returns the decoded admin user payload on success, or null (and terminates response) on failure.
 */
function requireAdminAuth(req, res) {
  const user = verifyAdminRequest(req);
  if (!user) {
    unauthorized(res, "Unauthorized: Admin authentication required. Please provide a valid Bearer token.");
    return null;
  }
  return user;
}

module.exports = {
  setCors,
  parseBody,
  json,
  ok,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
  base64UrlEncode,
  base64UrlDecode,
  signToken,
  verifyToken,
  getAdminAuthSecret,
  extractAdminToken,
  verifyAdminRequest,
  requireAdminAuth,
};
