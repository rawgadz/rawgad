// Execution: node --env-file=.env test-suite.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 1. DB Ping Test
async function testDbPing() {
  const { connectToDatabase } = require("./api/_db");
  const { db } = await connectToDatabase();
  const pingRes = await db.command({ ping: 1 });
  assert.strictEqual(pingRes.ok, 1, "DB ping failed");
}

// 2. Inventory Endpoint Test
async function testInventoryEndpoint() {
  const inventoryHandler = require("./api/inventory");
  let statusCode = null;
  let responseBody = null;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
    end() {}
  };
  await inventoryHandler({ method: "GET", url: "/api/inventory", query: {} }, res);
  assert.strictEqual(statusCode, 200, "Inventory GET did not return 200");
  assert.strictEqual(responseBody.success, true);
  assert.ok(Array.isArray(responseBody.inventory) && responseBody.inventory.length > 0, "Inventory array missing");
}

// 3. Build Script Test
function testBuildScript() {
  execSync("npm run build", { stdio: "pipe" });
  const required = [
    "index.json",
    "gadgets.json",
    "hero.json",
    "products.json",
    "price.json",
    "blog.json",
    "cars.json"
  ];
  for (const file of required) {
    const fullPath = path.join(__dirname, "data", file);
    assert.ok(fs.existsSync(fullPath), `Missing data file: ${file}`);
    const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    assert.ok(json, `Invalid JSON in ${file}`);
  }
}

// 4. Stock JS Test
async function testStockJs() {
  const stockCode = fs.readFileSync(path.join(__dirname, "js", "stock.js"), "utf8");
  const mockStorage = {};
  const listeners = {};
  const mockWindow = {
    localStorage: {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; }
    },
    dispatchEvent: (evt) => { if (listeners[evt.type]) listeners[evt.type](evt); },
    addEventListener: (t, fn) => { listeners[t] = fn; }
  };
  global.localStorage = mockWindow.localStorage;
  global.CustomEvent = function (type, opts) {
    this.type = type;
    this.detail = opts ? opts.detail : {};
  };
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      inventory: [
        { productId: "prod-1", typeId: null, subProductId: null, stockMode: "quantity", stock: 15, isAvailable: true },
        { productId: "prod-2", typeId: null, subProductId: null, stockMode: "quantity", stock: 0, isAvailable: false }
      ]
    })
  });

  let eventFired = false;
  mockWindow.addEventListener("rawgad-stock-updated", (e) => {
    eventFired = true;
    assert.strictEqual(e.detail.inventory.length, 2);
  });

  eval(`(function(window){ ${stockCode} })(mockWindow);`);
  await mockWindow.RawgadStock.fetchAndStoreAllStock(true);

  assert.strictEqual(mockWindow.RawgadStock.getItemStock("prod-1", null, null), 15);
  assert.strictEqual(mockWindow.RawgadStock.isItemAvailable("prod-1", null, null), true);
  assert.strictEqual(mockWindow.RawgadStock.getItemStock("prod-2", null, null), 0);
  assert.strictEqual(mockWindow.RawgadStock.isItemAvailable("prod-2", null, null), false);
  assert.ok(eventFired, "rawgad-stock-updated event did not fire");
}

// 5. Checkout Coupon Test
async function testCheckoutCoupon() {
  const checkoutHandler = require("./api/checkout");
  const { getOrdersCollection, getInventoryCollection } = require("./api/_db");
  const priceData = require("./data/price.json");
  const sampleKey = Object.keys(priceData)[0];
  const item = priceData[sampleKey];

  // Ensure test item has stock >= 10
  const inventoryCol = await getInventoryCollection();
  await inventoryCol.updateOne(
    {
      productId: item.productId,
      typeId: item.typeId || null,
      subProductId: item.subProductId || null,
    },
    {
      $set: {
        stockMode: "quantity",
        stock: 10,
        isAvailable: true,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      setHeader() {}
    };
  }

  // 5A. Valid Coupon
  const validRes = mockRes();
  await checkoutHandler({
    method: "POST",
    body: {
      cust_name: "Test Customer",
      cust_phone: "01712345678",
      cust_email: "test@example.com",
      cust_address: "123 Test Street, Dhaka",
      payment_method: "cod",
      coupon_code: "rawgadz10",
      cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 1 }]
    }
  }, validRes);

  assert.strictEqual(validRes.statusCode, 200, "Valid coupon checkout failed");
  const ordersCol = await getOrdersCollection();
  const orderDoc = await ordersCol.findOne({ invoice_number: validRes.body.invoice_number });
  assert.strictEqual(orderDoc.coupon_code, "RAWGADZ10");
  assert.strictEqual(orderDoc.discount_amount, Math.round((item.price * 0.10) * 100) / 100);

  // 5B. Invalid / Inactive Coupon
  const invalidRes = mockRes();
  await checkoutHandler({
    method: "POST",
    body: {
      cust_name: "Test Customer",
      cust_phone: "01712345678",
      cust_email: "test@example.com",
      cust_address: "123 Test Street, Dhaka",
      payment_method: "cod",
      coupon_code: "NONEXISTENT_COUPON",
      cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 1 }]
    }
  }, invalidRes);

  assert.strictEqual(invalidRes.statusCode, 400, "Invalid coupon should return 400");
  assert.strictEqual(invalidRes.body.success, false);
}

(async () => {
  try {
    await testDbPing();
    await testInventoryEndpoint();
    testBuildScript();
    await testStockJs();
    await testCheckoutCoupon();
    console.log("ALL TESTS PASSED SUCCESSFULLY.");
  } finally {
    try {
      const { client } = await require("./api/_db").connectToDatabase();
      await client.close();
    } catch (_) {}
  }
})().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});