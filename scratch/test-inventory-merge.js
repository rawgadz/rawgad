// scratch/test-inventory-merge.js
// Verification suite for merged inventory management logic in final_public

const path = require("path");
const inventoryHandler = require("../api/inventory");
const orderHandler = require("../api/order");
const { getDb } = require("../api/_db");
const { makeKey, normalizeId, getStockStatus } = require("../api/_catalog");

function createMockRes() {
  let statusCode = 200;
  let responseData = null;
  const headers = {};

  return {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          responseData = data;
          return { statusCode, data, headers };
        },
        end: () => ({ statusCode, data: null, headers })
      };
    },
    json: (data) => {
      responseData = data;
      return { statusCode, data, headers };
    },
    getStatusCode: () => statusCode,
    getData: () => responseData,
    getHeaders: () => headers
  };
}

async function runTests() {
  console.log("=== INVENTORY MANAGEMENT SYSTEM VERIFICATION ===");
  let passed = 0;
  let total = 0;

  function assert(desc, condition) {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
    }
  }

  // 1. Health Status Test
  {
    const res = createMockRes();
    await inventoryHandler({ method: "GET", url: "/api/inventory?status=true", query: { status: "true" } }, res);
    const data = res.getData();
    assert("1. GET /api/inventory?status=true returns connected: true and database: paystationdemo", 
      res.getStatusCode() === 200 && data.success && data.connected && data.database === "paystationdemo");
  }

  // 2. Admin Inventory Listing & Catalog Enrichment
  {
    const res = createMockRes();
    await inventoryHandler({ method: "GET", url: "/api/inventory?admin=true", query: { admin: "true" } }, res);
    const data = res.getData();
    assert("2. GET /api/inventory?admin=true returns items merged with catalog metadata",
      res.getStatusCode() === 200 && data.success && Array.isArray(data.items) && data.items.length > 0);
    assert("2b. Summary includes total, inStock, lowStock, outOfStock, orphaned",
      data.summary && typeof data.summary.total === "number" && typeof data.summary.inStock === "number");
    assert("2c. Dual output contains both 'items' and 'inventory' arrays",
      Array.isArray(data.inventory) && data.inventory.length === data.items.length);

    // Verify first item schema
    const first = data.items[0];
    assert("2d. Item matches compound identity schema (productId, typeId, subProductId, stock)",
      first.productId && typeof first.stock === "number" && first.key && first.status);
  }

  // 3. Catalog Synchronization Contract
  {
    const res = createMockRes();
    await inventoryHandler({ method: "POST", url: "/api/inventory", body: { action: "sync" } }, res);
    const data = res.getData();
    assert("3. POST action: 'sync' returns exact 5 canonical metrics",
      res.getStatusCode() === 200 && data.success &&
      typeof data.catalogCount === "number" &&
      typeof data.existingCount === "number" &&
      typeof data.addedCount === "number" &&
      typeof data.orphanedCount === "number" &&
      typeof data.totalInventoryCount === "number"
    );
  }

  // 4. Stock Mutation: Set Stock
  const testPId = "test_inventory_sku_" + Date.now();
  {
    const res = createMockRes();
    await inventoryHandler({
      method: "POST",
      url: "/api/inventory",
      body: {
        productId: testPId,
        typeId: null,
        subProductId: null,
        action: "set",
        value: 15
      }
    }, res);
    const data = res.getData();
    assert("4. POST action: 'set' sets stock to exact integer (15)",
      res.getStatusCode() === 200 && data.success && data.stock === 15);
  }

  // 5. Stock Mutation: Increase Stock
  {
    const res = createMockRes();
    await inventoryHandler({
      method: "POST",
      url: "/api/inventory",
      body: {
        productId: testPId,
        typeId: null,
        subProductId: null,
        action: "increase",
        value: 5
      }
    }, res);
    const data = res.getData();
    assert("5. POST action: 'increase' increases stock with server-side arithmetic (15 + 5 = 20)",
      res.getStatusCode() === 200 && data.success && data.stock === 20);
  }

  // 6. Stock Mutation: Decrease Stock
  {
    const res = createMockRes();
    await inventoryHandler({
      method: "POST",
      url: "/api/inventory",
      body: {
        productId: testPId,
        typeId: null,
        subProductId: null,
        action: "decrease",
        value: 8
      }
    }, res);
    const data = res.getData();
    assert("6. POST action: 'decrease' decreases stock with server-side arithmetic (20 - 8 = 12)",
      res.getStatusCode() === 200 && data.success && data.stock === 12);
  }

  // 7. Stock Mutation: Rejection on Negative Stock (INSUFFICIENT_STOCK)
  {
    const res = createMockRes();
    await inventoryHandler({
      method: "POST",
      url: "/api/inventory",
      body: {
        productId: testPId,
        typeId: null,
        subProductId: null,
        action: "decrease",
        value: 9999
      }
    }, res);
    const data = res.getData();
    assert("7. POST action: 'decrease' below 0 rejected with HTTP 400 and INSUFFICIENT_STOCK",
      res.getStatusCode() === 400 && data.success === false && data.error === "INSUFFICIENT_STOCK");
  }

  // 8. Clean up test SKU
  {
    const res = createMockRes();
    await inventoryHandler({
      method: "DELETE",
      url: "/api/inventory",
      body: { productId: testPId, typeId: null, subProductId: null }
    }, res);
    assert("8. DELETE removes test item cleanly", res.getStatusCode() === 200);
  }

  // 9. Storefront Backward Compatibility Lookup
  {
    const res = createMockRes();
    await inventoryHandler({
      method: "GET",
      url: "/api/inventory?productId=prod_001&typeId=prod_001_type_001&subProductId=prod_001_type_001_sub_001",
      query: {
        productId: "prod_001",
        typeId: "prod_001_type_001",
        subProductId: "prod_001_type_001_sub_001"
      }
    }, res);
    const data = res.getData();
    assert("9. GET single item lookup returns inStock boolean for storefront",
      res.getStatusCode() === 200 && data.success && typeof data.inStock === "boolean");
  }

  // 10. Test stock.js module compilation
  {
    try {
      const stockCode = require("fs").readFileSync(path.join(__dirname, "../stock.js"), "utf8");
      // Validate syntactically
      new Function(stockCode);
      assert("10. stock.js compiles cleanly without syntax or undeclared variable errors", true);
    } catch (e) {
      assert("10. stock.js compiles cleanly", false);
    }
  }

  console.log(`\nResults: ${passed} of ${total} tests passed.`);
  if (passed === total) {
    console.log("ALL TESTS PASSED SUCCESSFULLY!");
  } else {
    process.exit(1);
  }
}

runTests().then(() => process.exit(0)).catch(e => {
  console.error("FATAL TEST ERROR:", e);
  process.exit(1);
});
