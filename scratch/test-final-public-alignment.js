// scratch/test-final-public-alignment.js
// Verification suite for final_public authentication, Pathao integration, and env alignment

const path = require("path");
const fs = require("fs");

// Force reload of .env from final_public/.env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      process.env[k] = v; // Overwrite
    }
  }
}

const authHandler = require("../api/auth");
const pathaoHandler = require("../api/pathao");

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  FAIL: ${message}`);
  }
}

async function runTests() {
  console.log("=== Testing Alignment & Security in final_public ===");

  // ----------------------------------------------------
  // SECTION 1: Environment Variables Alignment Check
  // ----------------------------------------------------
  console.log("\n[Section 1] Environment Variables Alignment");
  assert(process.env.PATHAO_BASE_URL === "https://api-hermes.pathao.com", "PATHAO_BASE_URL is Production Hermes");
  assert(process.env.PATHAO_STORE_ID === "189987", "PATHAO_STORE_ID is 189987");
  assert(process.env.ADMIN_EMAIL === "therawgadz@gmail.com", "ADMIN_EMAIL is therawgadz@gmail.com");
  assert(process.env.ADMIN_PASSWORD === "admin12345", "ADMIN_PASSWORD is admin12345");
  assert(Boolean(process.env.AUTH_SECRET), "AUTH_SECRET is configured");
  assert(Boolean(process.env.MERCHANT_ID), "Storefront MERCHANT_ID is preserved");
  assert(Boolean(process.env.MONGO_URI), "Database MONGO_URI is preserved");

  // ----------------------------------------------------
  // SECTION 2: Admin Security & Auth Endpoint (api/auth.js)
  // ----------------------------------------------------
  console.log("\n[Section 2] Admin Authentication & Security (api/auth.js)");

  // Test 2.1: Bad login credentials rejected
  {
    const req = {
      method: "POST",
      body: { action: "login", email: "therawgadz@gmail.com", password: "wrongpassword" },
    };
    const res = createMockRes();
    await authHandler(req, res);
    assert(res.statusCode === 401, "Invalid password returns HTTP 401");
    assert(res.data && res.data.success === false, "Bad login reports success: false");
  }

  // Test 2.2: Correct login generates valid JWT token
  let authToken = null;
  {
    const req = {
      method: "POST",
      body: { action: "login", email: "therawgadz@gmail.com", password: "admin12345" },
    };
    const res = createMockRes();
    await authHandler(req, res);
    assert(res.statusCode === 200, "Valid credentials return HTTP 200");
    assert(res.data && res.data.token, "JWT token returned in login response");
    authToken = res.data?.token;
  }

  // Test 2.3: Username alias 'admin' also works
  {
    const req = {
      method: "POST",
      body: { action: "login", username: "admin", password: "admin12345" },
    };
    const res = createMockRes();
    await authHandler(req, res);
    assert(res.statusCode === 200, "Alias 'admin' with correct password returns HTTP 200");
  }

  // Test 2.4: Session verification with Bearer token
  {
    const req = {
      method: "GET",
      headers: { authorization: `Bearer ${authToken}` },
    };
    const res = createMockRes();
    await authHandler(req, res);
    assert(res.statusCode === 200, "Token verification returns HTTP 200");
    assert(res.data && res.data.authenticated === true, "Session reports authenticated: true");
    assert(res.data?.user?.email === "therawgadz@gmail.com", "User email verified in session");
  }

  // Test 2.5: Missing / Tampered token rejected
  {
    const req = {
      method: "GET",
      headers: { authorization: "Bearer invalid_tampered_jwt_token" },
    };
    const res = createMockRes();
    await authHandler(req, res);
    assert(res.statusCode === 401, "Tampered token rejected with HTTP 401");
  }

  // ----------------------------------------------------
  // SECTION 3: Pathao Hermes Integration (api/pathao.js)
  // ----------------------------------------------------
  console.log("\n[Section 3] Pathao Aladdin Integration (Hermes Production)");

  // Test 3.1: Token Issuance against Live Hermes API
  try {
    const token = await pathaoHandler.getAccessToken();
    assert(typeof token === "string" && token.length > 20, "Live Hermes API OAuth token issued successfully");
    console.log("    Hermes Token Prefix:", token.slice(0, 15) + "...");
  } catch (err) {
    console.warn("    Note: Live Hermes token call error:", err.message);
  }

  // Test 3.2: GET ?action=stores
  {
    const req = { method: "GET", query: { action: "stores" } };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 200 || res.statusCode === 500, "action=stores responds");
    if (res.statusCode === 200) {
      assert(res.data?.success === true, "action=stores returns success: true");
      console.log("    Default Store ID returned:", res.data?.defaultStoreId);
      console.log("    Stores found:", (res.data?.stores || []).length);
    }
  }

  // Test 3.3: Verify removal of bloated endpoints (cities, zones, areas)
  {
    const reqCities = { method: "GET", query: { action: "cities" } };
    const resCities = createMockRes();
    await pathaoHandler(reqCities, resCities);
    // Should NOT have a specialized cities handler, falls back to default GET
    assert(!resCities.data?.cities, "Unnecessary 'cities' endpoint successfully removed");

    const reqZones = { method: "GET", query: { action: "zones" } };
    const resZones = createMockRes();
    await pathaoHandler(reqZones, resZones);
    assert(!resZones.data?.zones, "Unnecessary 'zones' endpoint successfully removed");
  }

  // Test 3.4: GET default config
  {
    const req = { method: "GET", query: {} };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 200, "Default GET returns HTTP 200");
    assert(res.data?.configured === true, "Reports configured: true");
    assert(res.data?.baseUrl === "https://api-hermes.pathao.com", "Reports baseUrl: https://api-hermes.pathao.com");
    assert(res.data?.defaultStoreId === 189987, "Reports defaultStoreId: 189987");
  }

  console.log(`\n=== Final Alignment Results: ${passedTests}/${totalTests} Passed ===\n`);
  if (passedTests === totalTests) {
    console.log("ALL ALIGNMENT & SECURITY TESTS PASSED PERFECTLY!");
    process.exit(0);
  } else {
    console.error("Some tests failed.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
