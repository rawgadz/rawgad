// api/_helpers.js
// Standardized response helpers, CORS, body parsing, and Admin JWT guard

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
  if (!secret) throw new Error("AUTH_SECRET is required to sign tokens.");
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
  if (!token || typeof token !== "string" || !secret) return null;
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
      return null;
    }
    return payload;
  } catch (_) {
    return null;
  }
}

function getAdminAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is required.");
  }
  return secret;
}

function extractAdminToken(req) {
  if (!req) return null;

  const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (authHeader && typeof authHeader === "string") {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith("bearer ")) {
      return trimmed.slice(7).trim();
    }
    if (trimmed.includes(".")) {
      return trimmed;
    }
  }

  if (req.headers) {
    const customHeader = req.headers["x-admin-token"] || req.headers["x-auth-token"];
    if (customHeader && typeof customHeader === "string") {
      return customHeader.trim();
    }
  }

  if (req.query) {
    const qToken = req.query.token || req.query.auth_token;
    if (qToken && typeof qToken === "string") {
      return qToken.trim();
    }
  }

  return null;
}

function verifyAdminRequest(req) {
  const token = extractAdminToken(req);
  if (!token) return null;
  const secret = getAdminAuthSecret();
  return verifyToken(token, secret);
}

function requireAdminAuth(req, res) {
  try {
    const user = verifyAdminRequest(req);
    if (!user) {
      unauthorized(res, "Unauthorized: Admin authentication required.");
      return null;
    }
    return user;
  } catch (err) {
    serverError(res, err);
    return null;
  }
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
