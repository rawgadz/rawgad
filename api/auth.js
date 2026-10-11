// api/auth.js
// Admin Authentication endpoint for Rawgad Admin CMS in final_public
// Handles login, token signing (HMAC-SHA256), verification, and session management

const {
  setCors,
  parseBody,
  ok,
  badRequest,
  unauthorized,
  serverError,
  signToken,
  verifyToken,
  extractAdminToken,
  getAdminAuthSecret,
} = require("../lib/lib");
const { loadEnvFallback } = require("../lib/db");

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  loadEnvFallback();
  const secret = getAdminAuthSecret();

  // ----------------------------------------------------
  // GET: Verify Authentication Status
  // ----------------------------------------------------
  if (req.method === "GET") {
    const token = extractAdminToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: "Missing authorization token",
      });
    }

    const payload = verifyToken(token, secret);
    if (!payload) {
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: "Session expired or invalid token. Please log in again.",
      });
    }

    return ok(res, {
      authenticated: true,
      user: {
        email: payload.email,
        name: payload.name || "Administrator",
      },
    });
  }

  // ----------------------------------------------------
  // POST: Login / Logout
  // ----------------------------------------------------
  if (req.method === "POST") {
    try {
      const body = await parseBody(req);
      const action = body.action || "login";

      if (action === "logout") {
        return ok(res, { message: "Successfully logged out" });
      }

      const inputEmail = String(body.email || body.username || "").trim().toLowerCase();
      const inputPass = String(body.password || "").trim();

      if (!inputEmail || !inputPass) {
        return badRequest(res, "Username or email and password are required.");
      }

      const adminEmail = (process.env.ADMIN_EMAIL || "therawgadz@gmail.com").trim().toLowerCase();
      const adminPass = (process.env.ADMIN_PASSWORD || "admin12345").trim();
      const adminName = process.env.ADMIN_NAME || "Rawgad Admin";

      // Also allow logging in with 'admin' as username alias if input matches
      const isEmailMatch = inputEmail === adminEmail || inputEmail === "admin";
      const isPassMatch = inputPass === adminPass;

      if (!isEmailMatch || !isPassMatch) {
        return res.status(401).json({
          success: false,
          error: "Invalid username, email, or password. Please try again.",
        });
      }

      // Generate 7-day token
      const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const token = signToken(
        {
          email: adminEmail,
          name: adminName,
          exp,
        },
        secret
      );

      return ok(res, {
        message: "Login successful",
        token,
        user: {
          email: adminEmail,
          name: adminName,
        },
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
};

module.exports.verifyToken = verifyToken;
module.exports.signToken = signToken;
