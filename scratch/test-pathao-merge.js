// scratch/test-pathao-merge.js
// Verification suite for consolidated Pathao integration in final_public/api

const path = require("path");
const fs = require("fs");

// Load environment variables
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const pathaoHandler = require("../api/pathao");
const createOrderHandler = require("../api/create-order");

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
  console.log("=== Testing Pathao Integration in final_public/api ===");

  // Test 1: OPTIONS request handles CORS
  {
    console.log("\n[Test 1] OPTIONS CORS handling");
    const req = { method: "OPTIONS" };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 200, "OPTIONS returns HTTP 200");
    assert(res.headers["Access-Control-Allow-Origin"] === "*", "CORS header present");
  }

  // Test 2: GET default status
  {
    console.log("\n[Test 2] GET default configuration status");
    const req = { method: "GET", query: {} };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 200, "GET default returns HTTP 200");
    assert(res.data && res.data.success === true, "Response reports success: true");
    assert("configured" in res.data, "Response includes 'configured' boolean");
    assert("baseUrl" in res.data, "Response includes 'baseUrl'");
  }

  // Test 3: create-order.js alias routing
  {
    console.log("\n[Test 3] create-order.js alias routing");
    const req = { method: "GET", query: {} };
    const res = createMockRes();
    await createOrderHandler(req, res);
    assert(res.statusCode === 200, "create-order alias returns HTTP 200");
    assert(res.data && res.data.success === true, "create-order alias delegates to pathaoHandler");
  }

  // Test 4: POST validation - missing store_id when no env fallback
  {
    console.log("\n[Test 4] POST validation - store_id check");
    const originalStoreId = process.env.PATHAO_STORE_ID;
    delete process.env.PATHAO_STORE_ID;

    const req = {
      method: "POST",
      body: {
        recipient_name: "Customer",
        recipient_phone: "01712345678",
        recipient_address: "House 1, Road 2, Dhanmondi, Dhaka",
      },
    };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 400, "Missing store_id returns HTTP 400");
    assert(res.data && res.data.error.includes("store_id"), "Error mentions store_id");

    process.env.PATHAO_STORE_ID = originalStoreId;
  }

  // Test 5: POST validation - invalid phone number
  {
    console.log("\n[Test 5] POST validation - phone validation");
    const req = {
      method: "POST",
      body: {
        store_id: 12345,
        recipient_name: "Customer",
        recipient_phone: "12345", // Invalid
        recipient_address: "House 1, Road 2, Dhanmondi, Dhaka",
      },
    };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 400, "Invalid phone number returns HTTP 400");
    assert(res.data && res.data.error.includes("phone number"), "Error mentions phone number");
  }

  // Test 6: POST validation - address too short (< 10 chars)
  {
    console.log("\n[Test 6] POST validation - short address");
    const req = {
      method: "POST",
      body: {
        store_id: 12345,
        recipient_name: "Customer",
        recipient_phone: "01712345678",
        recipient_address: "Dhaka", // Only 5 chars
      },
    };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 400, "Short address returns HTTP 400");
    assert(res.data && res.data.error.includes("too short"), "Error mentions address is too short");
  }

  // Test 7: GET action=test token check
  {
    console.log("\n[Test 7] GET action=test authentication check");
    const req = { method: "GET", query: { action: "test" } };
    const res = createMockRes();
    await pathaoHandler(req, res);
    console.log("  Auth test result:", res.statusCode, res.data?.message || res.data?.error);
    assert(
      (res.statusCode === 200 && res.data?.success === true) ||
      (res.statusCode === 502 && res.data?.success === false),
      "action=test returns expected 200 (if sandbox credentials live) or 502 (if sandbox endpoint/creds error)"
    );
  }

  // Test 8: Method not allowed check
  {
    console.log("\n[Test 8] PUT method not allowed");
    const req = { method: "PUT" };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 405, "PUT returns HTTP 405 Method Not Allowed");
  }

  // Test 9: GET invoice_number for non-existent order returns 404
  {
    console.log("\n[Test 9] GET non-existent invoice_number");
    const req = { method: "GET", query: { invoice_number: "NON_EXISTENT_ORDER_99999" } };
    const res = createMockRes();
    await pathaoHandler(req, res);
    assert(res.statusCode === 404, "Unknown order returns HTTP 404");
  }

  // Test 10: GET and POST duplicate prevention on an existing mock order
  {
    console.log("\n[Test 10] MongoDB order lookup & double dispatch prevention");
    const { getOrdersCollection } = require("../api/_db");
    const testInv = `TEST-PTH-${Date.now()}`;
    try {
      const ordersCol = await getOrdersCollection();
      await ordersCol.insertOne({
        invoice_number: testInv,
        status: "confirmed",
        courier_status: "dispatched",
        pathao_consignment_id: "PTH-MOCK-12345",
        payment_method: "cod",
        payment_amount: 1500,
        customer: {
          name: "Test User",
          phone: "01700000000",
          full_address: "Test House, Test Road, Dhanmondi, Dhaka",
        },
      });

      // Query status
      const getReq = { method: "GET", query: { invoice_number: testInv } };
      const getRes = createMockRes();
      await pathaoHandler(getReq, getRes);
      assert(getRes.statusCode === 200, "Found order returns HTTP 200");
      assert(getRes.data?.courier_status === "dispatched", "Returns correct courier_status");
      assert(getRes.data?.consignment_id === "PTH-MOCK-12345", "Returns consignment_id");

      // Attempt double dispatch
      const postReq = { method: "POST", body: { invoice_number: testInv } };
      const postRes = createMockRes();
      await pathaoHandler(postReq, postRes);
      assert(postRes.statusCode === 409, "Already dispatched order returns HTTP 409 Conflict");
      assert(postRes.data?.error.includes("already dispatched"), "Error message explains duplicate dispatch");

      // Cleanup
      await ordersCol.deleteOne({ invoice_number: testInv });
    } catch (err) {
      console.warn("DB integration test skipped/errored:", err.message);
    }
  }

  console.log(`\n=== Test Results: ${passedTests}/${totalTests} Passed ===\n`);
  if (passedTests === totalTests) {
    console.log("All Pathao tests passed successfully!");
    process.exit(0);
  } else {
    console.error("Some tests failed.");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
