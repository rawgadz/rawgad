// scratch/test-security-and-count.js
// Verification suite:
// 1. Strict Serverless Function count check (<= 7)
// 2. Comprehensive Admin API Server-Side Security Verification (401 on unauthenticated, 200 on authorized)
// 3. Preservation of public storefront capabilities

const fs = require("fs");
const path = require("path");
const assert = require("assert");

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    data: null,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log("=================================================");
  console.log(" Running Security & Function Count Test Suite");
  console.log("=================================================\n");

  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${desc}`);
      console.error(`        Error: ${err.message}`);
    }
  }

  // -----------------------------------------------------------------
  // 1. SERVERLESS FUNCTION COUNT CHECK (Must be <= 7)
  // -----------------------------------------------------------------
  console.log("[Test 1] Verifying Total Serverless Function Count in api/ ...");
  const apiDir = path.join(__dirname, "..", "api");
  const allApiFiles = fs.readdirSync(apiDir).filter(f => f.endsWith(".js"));

  test("Total files in api/ directory must be <= 7 (exactly 6)", () => {
    console.log(`         Discovered serverless API files (${allApiFiles.length}): ${allApiFiles.join(", ")}`);
    assert(allApiFiles.length <= 7, `Expected <= 7 serverless functions, found ${allApiFiles.length}`);
    assert.strictEqual(allApiFiles.length, 6, "Expected exactly 6 serverless functions");
  });

  // -----------------------------------------------------------------
  // 2. TOKEN GENERATION FOR TESTING
  // -----------------------------------------------------------------
  const { signToken, getAdminAuthSecret } = require("../lib/lib");
  const authSecret = getAdminAuthSecret();
  const validToken = signToken(
    { email: "therawgadz@gmail.com", name: "Admin Test", exp: Date.now() + 3600000 },
    authSecret
  );
  const authHeader = { authorization: `Bearer ${validToken}` };

  // -----------------------------------------------------------------
  // 3. ORDER.JS SECURITY AUDIT
  // -----------------------------------------------------------------
  console.log("\n[Test 2] Auditing api/order.js Server-Side Security ...");
  const orderHandler = require("../api/order");

  // Unauthenticated GET
  {
    const res = createMockRes();
    await orderHandler({ method: "GET", headers: {}, query: {} }, res);
    test("Unauthenticated GET /api/order returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated PATCH
  {
    const res = createMockRes();
    await orderHandler({ method: "PATCH", headers: {}, body: { invoice_number: "INV-9999", status: "cancelled" } }, res);
    test("Unauthenticated PATCH /api/order returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated DELETE
  {
    const res = createMockRes();
    await orderHandler({ method: "DELETE", headers: {}, body: { invoice_number: "INV-9999" } }, res);
    test("Unauthenticated DELETE /api/order returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Authorized GET /api/order
  {
    const res = createMockRes();
    await orderHandler({ method: "GET", headers: authHeader, query: {} }, res);
    test("Authorized GET /api/order with Bearer token returns 200 OK with orders and metrics", () => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert(Array.isArray(res.data.orders));
      assert(typeof res.data.metrics === "object");
    });
  }

  // -----------------------------------------------------------------
  // 4. INVENTORY.JS SECURITY AUDIT
  // -----------------------------------------------------------------
  console.log("\n[Test 3] Auditing api/inventory.js Server-Side Security ...");
  const inventoryHandler = require("../api/inventory");

  // Unauthenticated GET ?admin=true
  {
    const res = createMockRes();
    await inventoryHandler({ method: "GET", headers: {}, query: { admin: "true" } }, res);
    test("Unauthenticated GET /api/inventory?admin=true returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated POST mutation (set)
  {
    const res = createMockRes();
    await inventoryHandler({ method: "POST", headers: {}, body: { action: "set", productId: "prod_001", value: 10 } }, res);
    test("Unauthenticated POST /api/inventory (action: 'set') returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated POST mutation (sync)
  {
    const res = createMockRes();
    await inventoryHandler({ method: "POST", headers: {}, body: { action: "sync" } }, res);
    test("Unauthenticated POST /api/inventory (action: 'sync') returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated DELETE
  {
    const res = createMockRes();
    await inventoryHandler({ method: "DELETE", headers: {}, body: { productId: "prod_001" } }, res);
    test("Unauthenticated DELETE /api/inventory returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Public Storefront Single Product Lookup
  {
    const res = createMockRes();
    await inventoryHandler({ method: "GET", headers: {}, query: { productId: "prod_001" } }, res);
    test("Public storefront query GET /api/inventory?productId=... succeeds without auth (200 OK)", () => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert(Array.isArray(res.data.inventory));
    });
  }

  // Public Storefront Bulk Lookup
  {
    const res = createMockRes();
    await inventoryHandler({ method: "POST", headers: {}, body: { productIds: ["prod_001", "prod_002"] } }, res);
    test("Public storefront checkout bulk query POST /api/inventory succeeds without auth (200 OK)", () => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert(Array.isArray(res.data.inventory));
    });
  }

  // Authorized GET ?admin=true
  {
    const res = createMockRes();
    await inventoryHandler({ method: "GET", headers: authHeader, query: { admin: "true" } }, res);
    test("Authorized GET /api/inventory?admin=true with Bearer token returns 200 OK with admin summary", () => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert(res.data.summary !== undefined);
      assert(Array.isArray(res.data.items));
    });
  }

  // -----------------------------------------------------------------
  // 5. PATHAO.JS SECURITY AUDIT
  // -----------------------------------------------------------------
  console.log("\n[Test 4] Auditing api/pathao.js Server-Side Security ...");
  const pathaoHandler = require("../api/pathao");

  // Unauthenticated GET ?action=stores
  {
    const res = createMockRes();
    await pathaoHandler({ method: "GET", headers: {}, query: { action: "stores" } }, res);
    test("Unauthenticated GET /api/pathao?action=stores returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated GET ?action=test
  {
    const res = createMockRes();
    await pathaoHandler({ method: "GET", headers: {}, query: { action: "test" } }, res);
    test("Unauthenticated GET /api/pathao?action=test returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Unauthenticated POST parcel dispatch
  {
    const res = createMockRes();
    await pathaoHandler({ method: "POST", headers: {}, body: { invoice_number: "RG-1001", recipient_phone: "01711111111" } }, res);
    test("Unauthenticated POST /api/pathao parcel booking returns 401 Unauthorized", () => {
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.code, "UNAUTHORIZED");
    });
  }

  // Authorized GET ?action=stores
  {
    const res = createMockRes();
    await pathaoHandler({ method: "GET", headers: authHeader, query: { action: "stores" } }, res);
    test("Authorized GET /api/pathao?action=stores with Bearer token succeeds with store listing (200 OK)", () => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert(Array.isArray(res.data.stores));
      assert.strictEqual(res.data.defaultStoreId, 189987);
    });
  }

  console.log(`\n=================================================`);
  console.log(` Results: ${passed} / ${total} Tests Passed`);
  console.log(`=================================================`);

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
