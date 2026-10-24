// api/auth.js
// Admin Authentication endpoint for Rawgadz CMS
// Strict zero-fallback credentials

const {
  setCors,
  parseBody,
  ok,
  badRequest,
  serverError,
  signToken,
  verifyToken,
  extractAdminToken,
  getAdminAuthSecret,
} = require("./_helpers");

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
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

      const adminEmail = process.env.ADMIN_EMAIL;
      if (!adminEmail) {
        throw new Error("ADMIN_EMAIL environment variable is required.");
      }
      const adminPass = process.env.ADMIN_PASSWORD;
      if (!adminPass) {
        throw new Error("ADMIN_PASSWORD environment variable is required.");
      }
      const adminName = process.env.ADMIN_NAME || "Rawgad Admin";

      const isEmailMatch = inputEmail === adminEmail.trim().toLowerCase();
      const isPassMatch = inputPass === adminPass.trim();

      if (!isEmailMatch || !isPassMatch) {
        return res.status(401).json({
          success: false,
          error: "Invalid username, email, or password. Please try again.",
        });
      }

      const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const token = signToken(
        {
          email: adminEmail.trim().toLowerCase(),
          name: adminName,
          exp,
        },
        secret
      );

      return ok(res, {
        message: "Login successful",
        token,
        user: {
          email: adminEmail.trim().toLowerCase(),
          name: adminName,
        },
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
  } catch (err) {
    return serverError(res, err);
  }
};
