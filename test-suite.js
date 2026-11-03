// test-suite.js
// Comprehensive Verification Suite for Rawgadz Platform & Meta Pixel + CAPI Integration
// Execution: node test-suite.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

// Provide in-memory MongoDB collection adapter if MONGO_URI is not configured in environment
function installInMemoryDbIfNeeded() {
  if (process.env.MONGO_URI && process.env.MONGODB_DB) {
    return false;
  }

  const dbModulePath = require.resolve("./api/_db");
  const stores = {
    inventory: [],
    orders: [],
  };

  function matchesFilter(doc, filter = {}) {
    for (const [k, v] of Object.entries(filter)) {
      if (k === "$or" && Array.isArray(v)) {
        if (!v.some((sub) => matchesFilter(doc, sub))) return false;
        continue;
      }
      const docVal = k.includes(".")
        ? k.split(".").reduce((o, part) => (o ? o[part] : undefined), doc)
        : doc[k];

      if (v && typeof v === "object" && !(v instanceof Date) && !(v instanceof RegExp)) {
        if ("$gte" in v && !(docVal >= v.$gte)) return false;
        if ("$ne" in v && !(docVal !== v.$ne)) return false;
        if ("$in" in v && !v.$in.includes(docVal)) return false;
      } else if (v instanceof RegExp) {
        if (!v.test(String(docVal || ""))) return false;
      } else {
        const normDoc = docVal === undefined ? null : docVal;
        const normFilter = v === undefined ? null : v;
        if (normDoc !== normFilter) return false;
      }
    }
    return true;
  }

  function applyUpdate(doc, update) {
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        if (k.includes(".")) {
          const parts = k.split(".");
          let cur = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          cur[parts[parts.length - 1]] = v;
        } else {
          doc[k] = v;
        }
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        if (k.includes(".")) {
          const parts = k.split(".");
          let cur = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
            cur = cur[parts[i]];
          }
          const last = parts[parts.length - 1];
          cur[last] = (Number(cur[last]) || 0) + v;
        } else {
          doc[k] = (Number(doc[k]) || 0) + v;
        }
      }
    }
  }

  function makeCollection(name) {
    return {
      _FailureMode: false,
      async countDocuments(filter = {}) {
        return stores[name].filter((d) => matchesFilter(d, filter)).length;
      },
      find(filter = {}) {
        const res = stores[name].filter((d) => matchesFilter(d, filter));
        return {
          sort() { return this; },
          limit(n) { return { toArray: async () => res.slice(0, n) }; },
          toArray: async () => [...res],
        };
      },
      async findOne(filter = {}) {
        return stores[name].find((d) => matchesFilter(d, filter)) || null;
      },
      async findOneAndUpdate(filter, update) {
        const doc = stores[name].find((d) => matchesFilter(d, filter));
        if (!doc) return null;
        applyUpdate(doc, update);
        return doc;
      },
      async updateOne(filter, update, opts = {}) {
        let doc = stores[name].find((d) => matchesFilter(d, filter));
        if (!doc && opts.upsert) {
          doc = { _id: "id_" + Date.now() + "_" + Math.random(), ...filter };
          stores[name].push(doc);
        }
        if (doc) {
          applyUpdate(doc, update);
          return { matchedCount: 1, modifiedCount: 1 };
        }
        return { matchedCount: 0, modifiedCount: 0 };
      },
      async insertOne(doc) {
        if (this._FailureMode) {
          throw new Error("Simulated MongoDB insertOne failure");
        }
        const saved = { _id: "id_" + Date.now() + "_" + Math.random(), ...doc };
        stores[name].push(saved);
        return { insertedId: saved._id };
      },
    };
  }

  const invCol = makeCollection("inventory");
  const ordCol = makeCollection("orders");

  // Seed initial inventory from products.json
  const { getPurchasableCatalogMap } = require("./api/_catalog");
  const { items } = getPurchasableCatalogMap();
  for (const item of items) {
    stores.inventory.push({
      _id: "seed_" + item.key,
      productId: item.productId,
      typeId: item.typeId ?? null,
      subProductId: item.subProductId ?? null,
      stockMode: "quantity",
      stock: 20,
      isAvailable: true,
      updatedAt: new Date(),
    });
  }

  const fakeClient = {
    startSession() {
      throw new Error("Transactions disabled in standalone mock to test compensation path & session handling");
    },
    db() {
      return {
        command: async () => ({ ok: 1 }),
        collection: (n) => (n === "inventory" ? invCol : ordCol),
      };
    },
    close: async () => {},
  };

  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: {
      getDb: async () => fakeClient,
      connectToDatabase: async () => ({ client: fakeClient, db: fakeClient.db() }),
      getInventoryCollection: async () => invCol,
      getOrdersCollection: async () => ordCol,
      getDbConfig: () => ({ URI: "mongodb://mock", dbName: "rawgadz_test" }),
      _stores: stores,
    },
  };

  return true;
}

const usingMockDb = installInMemoryDbIfNeeded();

// Helper to create an isolated browser VM sandbox for testing js/meta-pixel.js
function createBrowserEnv({ pathname = "/index.html", search = "", cookie = "" } = {}) {
  const fbqCalls = [];
  const sessionStore = {};
  const localStore = {};

  const windowObj = {
    location: {
      pathname,
      search,
      href: `https://rawgadzfinal.vercel.app${pathname}${search}`,
    },
    sessionStorage: {
      getItem: (k) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k, v) => { sessionStore[k] = String(v); },
      removeItem: (k) => { delete sessionStore[k]; },
    },
    localStorage: {
      getItem: (k) => (k in localStore ? localStore[k] : null),
      setItem: (k, v) => { localStore[k] = String(v); },
      removeItem: (k) => { delete localStore[k]; },
    },
    fbq: function (...args) {
      fbqCalls.push(args);
    },
    addEventListener: () => {},
    dispatchEvent: () => {},
  };

  const documentObj = {
    cookie,
    head: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({}),
    getElementsByTagName: () => [{ parentNode: { insertBefore: () => {} } }],
    addEventListener: () => {},
  };

  windowObj.window = windowObj;
  windowObj.document = documentObj;

  const pixelScript = fs.readFileSync(path.join(__dirname, "js", "meta-pixel.js"), "utf8");
  vm.runInNewContext(pixelScript, {
    window: windowObj,
    document: documentObj,
    globalThis: windowObj,
    URLSearchParams,
    console,
    Math,
    Date,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    encodeURIComponent,
    decodeURIComponent,
  });

  return { window: windowObj, document: documentObj, fbqCalls, sessionStore, localStore };
}

// 1. DB Ping Test
async function testDbPing() {
  const { connectToDatabase } = require("./api/_db");
  const { db } = await connectToDatabase();
  const pingRes = await db.command({ ping: 1 });
  assert.strictEqual(pingRes.ok, 1, "DB ping failed");
  console.log("[PASS] 1. Database ping test");
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
  console.log("[PASS] 2. Inventory endpoint test");
}

// 3. Build Script & HTML Pixel Coverage Test
function testBuildScriptAndHtmlCoverage() {
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

  // Verify customer-facing root HTML pages include /js/meta-pixel.js once
  const customerRootPages = [
    "index.html",
    "gadgets.html",
    "car_accessories.html",
    "car-steering-cover.html",
    "car.html",
    "blog.html",
    "contact.html",
    "checkout.html",
    "thank.html",
    "fail.html"
  ];
  for (const page of customerRootPages) {
    const html = fs.readFileSync(path.join(__dirname, page), "utf8");
    const count = (html.match(/\/js\/meta-pixel\.js/g) || []).length;
    assert.strictEqual(count, 1, `Expected ${page} to include /js/meta-pixel.js exactly once, found ${count}`);
  }

  // Verify admin pages DO NOT include /js/meta-pixel.js
  const adminPages = ["admin.html", "inventory.html", "login.html", "order.html"];
  for (const page of adminPages) {
    const html = fs.readFileSync(path.join(__dirname, page), "utf8");
    assert.ok(!html.includes("meta-pixel.js"), `Admin page ${page} must not include meta-pixel.js`);
  }

  // Verify generated product, blog, and car HTML pages include /js/meta-pixel.js after build
  const sampleProductHtml = fs.readdirSync(path.join(__dirname, "product")).filter((f) => f.endsWith(".html"));
  assert.ok(sampleProductHtml.length > 0, "No generated product HTML files found");
  for (const f of sampleProductHtml) {
    const html = fs.readFileSync(path.join(__dirname, "product", f), "utf8");
    assert.ok(html.includes("/js/meta-pixel.js"), `Generated product/${f} missing /js/meta-pixel.js`);
    assert.ok(html.includes("trackViewContent"), `Generated product/${f} missing trackViewContent`);
    assert.ok(html.includes("trackAddToCart"), `Generated product/${f} missing trackAddToCart`);
  }

  console.log("[PASS] 3. Build scripts & HTML Pixel coverage test");
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
  const origFetch = global.fetch;
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

  try {
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
    console.log("[PASS] 4. Stock JS cache test");
  } finally {
    global.fetch = origFetch;
  }
}

// 5. Phase 8 Frontend Pixel Tests (PageView, ViewContent, ViewCategory, AddToCart, InitiateCheckout)
function testFrontendPixelEvents() {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "products.json"), "utf8"));
  const sampleProduct = products.find((p) => Array.isArray(p.types) && p.types.length > 0) || products[0];

  // Test A: Open homepage -> One PageView
  const homeEnv = createBrowserEnv({ pathname: "/index.html" });
  const initCalls = homeEnv.fbqCalls.filter((c) => c[0] === "init");
  const pvCalls = homeEnv.fbqCalls.filter((c) => c[0] === "track" && c[1] === "PageView");
  assert.strictEqual(initCalls.length, 1, "Pixel should initialize once on homepage");
  assert.strictEqual(initCalls[0][1], "1536032983933873", "Pixel ID must be 1536032983933873");
  assert.strictEqual(pvCalls.length, 1, "Homepage must fire exactly one PageView");
  // Calling trackPageView() again on same page load must not duplicate
  homeEnv.window.RawgadzPixel.trackPageView();
  assert.strictEqual(homeEnv.fbqCalls.filter((c) => c[0] === "track" && c[1] === "PageView").length, 1, "Duplicate PageView must be blocked");

  // Verify admin page does not fire PageView
  const adminEnv = createBrowserEnv({ pathname: "/admin.html" });
  assert.strictEqual(adminEnv.fbqCalls.length, 0, "Admin page must not initialize or fire Pixel events");

  // Test B: Open product page -> One ViewContent
  const prodEnv = createBrowserEnv({ pathname: `/product/${sampleProduct.slug}.html` });
  prodEnv.window.RawgadzPixel.trackViewContent(sampleProduct);
  // Second accidental call on same product page load must be deduplicated
  prodEnv.window.RawgadzPixel.trackViewContent(sampleProduct);
  const vcCalls = prodEnv.fbqCalls.filter((c) => c[0] === "track" && c[1] === "ViewContent");
  assert.strictEqual(vcCalls.length, 1, "Product page must fire exactly one ViewContent");
  assert.strictEqual(vcCalls[0][2].content_type, "product");
  assert.strictEqual(vcCalls[0][2].currency, "BDT");
  assert.ok(Array.isArray(vcCalls[0][2].content_ids) && vcCalls[0][2].content_ids[0].includes(":::"), "ViewContent must use canonical variant ID");
  assert.ok(vcCalls[0][2].value > 0, "ViewContent must include actual positive price");

  // Test C: Open category page -> One ViewCategory
  const catEnv = createBrowserEnv({ pathname: "/gadgets.html" });
  catEnv.window.RawgadzPixel.trackViewCategory({ category_name: "Gadgets", content_category: "Gadgets" });
  catEnv.window.RawgadzPixel.trackViewCategory({ category_name: "Gadgets", content_category: "Gadgets" });
  const vcatCalls = catEnv.fbqCalls.filter((c) => c[0] === "trackCustom" && c[1] === "ViewCategory");
  assert.strictEqual(vcatCalls.length, 1, "Category page must fire exactly one ViewCategory");
  assert.strictEqual(vcatCalls[0][2].category_name, "Gadgets");

  // Test D: Add product to cart -> One AddToCart
  const cartItem = {
    cartKey: "MRA-01:::MRA-0101:::_",
    id: "MRA-01",
    typeId: "MRA-0101",
    subProductId: null,
    title: "3D Dot Grip Steering Cover - White",
    price: 1999,
    quantity: 2,
  };
  prodEnv.window.RawgadzPixel.trackAddToCart(cartItem, 2);
  // Failed/invalid 0-qty addition must not fire AddToCart
  prodEnv.window.RawgadzPixel.trackAddToCart(cartItem, 0);
  prodEnv.window.RawgadzPixel.trackAddToCart(cartItem, -1);
  const atcCalls = prodEnv.fbqCalls.filter((c) => c[0] === "track" && c[1] === "AddToCart");
  assert.strictEqual(atcCalls.length, 1, "Must fire exactly one AddToCart for valid addition");
  assert.deepStrictEqual(Array.from(atcCalls[0][2].content_ids), ["MRA-01:::MRA-0101:::_"]);
  assert.strictEqual(atcCalls[0][2].value, 3998);
  assert.strictEqual(atcCalls[0][2].currency, "BDT");

  // Test E: Start checkout -> One InitiateCheckout (and no duplicate on refresh)
  const chkEnv = createBrowserEnv({ pathname: "/checkout.html" });
  chkEnv.window.RawgadzPixel.trackInitiateCheckout([cartItem]);
  // Simulate page refresh with the same sessionStorage cart state
  chkEnv.window.RawgadzPixel.trackInitiateCheckout([cartItem]);
  const icCalls = chkEnv.fbqCalls.filter((c) => c[0] === "track" && c[1] === "InitiateCheckout");
  assert.strictEqual(icCalls.length, 1, "Must fire InitiateCheckout once and not re-fire on checkout refresh");
  assert.strictEqual(icCalls[0][2].value, 3998);
  assert.strictEqual(icCalls[0][2].num_items, 2);
  assert.strictEqual(icCalls[0][2].currency, "BDT");

  console.log("[PASS] 5. Frontend Pixel events test (PageView, ViewContent, ViewCategory, AddToCart, InitiateCheckout)");
}

// 6. Phase 8 Checkout & CAPI Purchase Integration Tests
async function testCheckoutAndMetaPurchaseScenarios() {
  const checkoutHandler = require("./api/checkout");
  const { getOrdersCollection, getInventoryCollection } = require("./api/_db");
  const priceData = require("./data/price.json");
  const sampleKey = Object.keys(priceData)[0];
  const item = priceData[sampleKey];

  const inventoryCol = await getInventoryCollection();
  const ordersCol = await getOrdersCollection();

  async function resetItemStock(stockCount) {
    await inventoryCol.updateOne(
      {
        productId: item.productId,
        typeId: item.typeId || null,
        subProductId: item.subProductId || null,
      },
      {
        $set: {
          stockMode: "quantity",
          stock: stockCount,
          isAvailable: stockCount > 0,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      setHeader() {},
      end() {},
    };
  }

  const origFetch = global.fetch;
  const origToken = process.env.META_ACCESS_TOKEN;
  process.env.META_ACCESS_TOKEN = "test_meta_capi_token_secret_xyz";

  let capiRequests = [];
  let simulateMetaDown = false;

  global.fetch = async (url, opts) => {
    if (String(url).includes("graph.facebook.com")) {
      const parsedBody = JSON.parse(opts.body);
      capiRequests.push({ url, body: parsedBody });
      if (simulateMetaDown) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: "Service Unavailable" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ events_received: 1 }),
      };
    }
    if (origFetch) return origFetch(url, opts);
    throw new Error("Unexpected fetch URL: " + url);
  };

  try {
    await resetItemStock(15);

    // ------------------------------------------------------------------
    // Scenario 6A: Submit Valid COD Order -> One Server CAPI Purchase + One Browser Purchase with matching event_id
    // Also verify anti-tamper: client submits fake price=1, server uses priceData[sampleKey].price with 10% coupon
    // ------------------------------------------------------------------
    capiRequests = [];
    const validIdemKey = "chk_test_valid_" + Date.now();
    const validRes = mockRes();
    await checkoutHandler(
      {
        method: "POST",
        headers: {
          "x-forwarded-for": "103.108.140.25",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TestBrowser/1.0",
          cookie: "_fbp=fb.1.1700000000000.123456789; _fbc=fb.1.1700000000000.IwAR123",
        },
        body: {
          cust_name: "Rahim Uddin",
          cust_phone: "01712345678",
          cust_email: "rahim@example.com",
          cust_address: "House 12, Road 5, Dhanmondi, Dhaka",
          payment_method: "cod",
          coupon_code: "rawgadz10",
          idempotency_key: validIdemKey,
          event_source_url: "https://rawgadzfinal.vercel.app/checkout.html",
          cartItems: [
            {
              productId: item.productId,
              typeId: item.typeId,
              subProductId: item.subProductId,
              price: 1, // Tampered client price (must be ignored by server)
              qty: 2,
            },
          ],
        },
      },
      validRes
    );

    assert.strictEqual(validRes.statusCode, 200, "Valid COD order should return 200");
    assert.strictEqual(validRes.body.success, true);
    assert.ok(validRes.body.invoice_number, "Response must include invoice_number");
    assert.strictEqual(validRes.body.event_id, validRes.body.invoice_number, "event_id must match invoice_number");
    assert.ok(validRes.body.purchase_data, "Response must include server-verified purchase_data");

    const expectedSubtotal = Math.round(item.price * 2 * 100) / 100;
    const expectedDiscount = Math.round(expectedSubtotal * 0.10 * 100) / 100;
    const expectedFinal = Math.max(0, Math.round((expectedSubtotal - expectedDiscount) * 100) / 100);

    const savedOrder = await ordersCol.findOne({ invoice_number: validRes.body.invoice_number });
    assert.ok(savedOrder, "Order must be saved in MongoDB");
    assert.strictEqual(savedOrder.payment_amount, expectedFinal, "Saved order payment_amount must match server-calculated amount");

    // Verify Server CAPI Event
    assert.strictEqual(capiRequests.length, 1, "Must send exactly ONE CAPI Purchase event");
    const capiEvent = capiRequests[0].body.data[0];
    assert.strictEqual(capiEvent.event_name, "Purchase");
    assert.strictEqual(capiEvent.event_id, validRes.body.event_id, "Server event_id must match browser event_id");
    assert.strictEqual(capiEvent.action_source, "website");
    assert.strictEqual(capiEvent.custom_data.currency, "BDT");
    assert.strictEqual(capiEvent.custom_data.value, savedOrder.payment_amount, "CAPI value must match MongoDB order payment_amount");
    assert.strictEqual(capiEvent.custom_data.num_items, 2);
    assert.deepStrictEqual(capiEvent.custom_data.content_ids, [sampleKey]);
    assert.strictEqual(capiEvent.user_data.client_ip_address, "103.108.140.25", "IP must not be hashed");
    assert.strictEqual(capiEvent.user_data.fbp, "fb.1.1700000000000.123456789", "_fbp must not be hashed");
    assert.strictEqual(capiEvent.user_data.fbc, "fb.1.1700000000000.IwAR123", "_fbc must not be hashed");
    assert.strictEqual(capiEvent.user_data.ph[0].length, 64, "Phone must be SHA-256 hashed");
    assert.strictEqual(capiEvent.user_data.em[0].length, 64, "Email must be SHA-256 hashed");
    assert.strictEqual(capiEvent.user_data.fn[0].length, 64, "First name must be SHA-256 hashed");
    assert.strictEqual(capiEvent.user_data.ln[0].length, 64, "Last name must be SHA-256 hashed");

    // Verify Browser Purchase Event & Deduplication
    const chkEnv = createBrowserEnv({ pathname: "/checkout.html" });
    chkEnv.window.RawgadzPixel.trackPurchase(validRes.body.purchase_data, validRes.body.event_id);
    // Calling trackPurchase a second time with same event_id must be blocked
    chkEnv.window.RawgadzPixel.trackPurchase(validRes.body.purchase_data, validRes.body.event_id);
    const browserPurchases = chkEnv.fbqCalls.filter((c) => c[0] === "track" && c[1] === "Purchase");
    assert.strictEqual(browserPurchases.length, 1, "Browser must fire exactly ONE Purchase event");
    assert.strictEqual(browserPurchases[0][2].value, savedOrder.payment_amount, "Browser Purchase value must match server-verified order");
    assert.strictEqual(browserPurchases[0][2].currency, "BDT");
    assert.strictEqual(browserPurchases[0][3].eventID, capiEvent.event_id, "Browser eventID and Server event_id must match exactly");

    // ------------------------------------------------------------------
    // Scenario 6B: Repeat Successful API Request / Double-Click Checkout -> No duplicate Purchase
    // ------------------------------------------------------------------
    const repeatRes = mockRes();
    await checkoutHandler(
      {
        method: "POST",
        body: {
          cust_name: "Rahim Uddin",
          cust_phone: "01712345678",
          cust_email: "rahim@example.com",
          cust_address: "House 12, Road 5, Dhanmondi, Dhaka",
          payment_method: "cod",
          coupon_code: "rawgadz10",
          idempotency_key: validIdemKey,
          cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 2 }],
        },
      },
      repeatRes
    );
    assert.strictEqual(repeatRes.statusCode, 200);
    assert.strictEqual(repeatRes.body.invoice_number, validRes.body.invoice_number, "Repeated request must return same invoice_number");
    assert.strictEqual(repeatRes.body.duplicate_prevented, true, "Repeated request must flag duplicate_prevented");
    assert.strictEqual(capiRequests.length, 1, "Repeated request must NOT trigger another CAPI Purchase event");

    // ------------------------------------------------------------------
    // Scenario 6C: Submit Invalid Order -> No Purchase
    // ------------------------------------------------------------------
    capiRequests = [];
    const invalidRes = mockRes();
    await checkoutHandler(
      {
        method: "POST",
        body: {
          cust_name: "Test User",
          cust_phone: "12345", // Invalid phone
          cust_address: "123 Test Street, Dhaka",
          payment_method: "cod",
          cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 1 }],
        },
      },
      invalidRes
    );
    assert.strictEqual(invalidRes.statusCode, 400, "Invalid order must return 400");
    assert.strictEqual(capiRequests.length, 0, "Invalid order must NOT trigger CAPI Purchase");

    // ------------------------------------------------------------------
    // Scenario 6D: Insufficient Stock -> No Purchase
    // ------------------------------------------------------------------
    capiRequests = [];
    await resetItemStock(1);
    const noStockRes = mockRes();
    await checkoutHandler(
      {
        method: "POST",
        body: {
          cust_name: "Stock Tester",
          cust_phone: "01812345678",
          cust_address: "House 1, Road 2, Banani, Dhaka",
          payment_method: "cod",
          idempotency_key: "chk_nostock_" + Date.now(),
          cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 5 }],
        },
      },
      noStockRes
    );
    assert.strictEqual(noStockRes.statusCode, 400, "Insufficient stock must return 400");
    assert.strictEqual(capiRequests.length, 0, "Insufficient stock must NOT trigger CAPI Purchase");

    // ------------------------------------------------------------------
    // Scenario 6E: MongoDB Insertion Failure -> No Purchase & Stock Restored
    // ------------------------------------------------------------------
    await resetItemStock(5);
    capiRequests = [];
    const origInsertOne = ordersCol.insertOne.bind(ordersCol);
    ordersCol.insertOne = async () => {
      throw new Error("Simulated MongoDB write failure");
    };
    try {
      const dbFailRes = mockRes();
      await checkoutHandler(
        {
          method: "POST",
          body: {
            cust_name: "DB Fail Tester",
            cust_phone: "01912345678",
            cust_address: "House 9, Uttara, Dhaka",
            payment_method: "cod",
            idempotency_key: "chk_dbfail_" + Date.now(),
            cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 2 }],
          },
        },
        dbFailRes
      );
      assert.strictEqual(dbFailRes.statusCode, 400, "MongoDB insertion failure must return 400");
      assert.strictEqual(capiRequests.length, 0, "MongoDB insertion failure must NOT trigger CAPI Purchase");
    } finally {
      ordersCol.insertOne = origInsertOne;
    }

    // ------------------------------------------------------------------
    // Scenario 6F: Meta API Unavailable -> Order Still Succeeds
    // ------------------------------------------------------------------
    await resetItemStock(10);
    capiRequests = [];
    simulateMetaDown = true;
    const metaDownIdemKey = "chk_metadown_" + Date.now();
    const metaDownRes = mockRes();
    await checkoutHandler(
      {
        method: "POST",
        body: {
          cust_name: "Resilience Tester",
          cust_phone: "01612345678",
          cust_address: "Mirpur 10, Dhaka",
          payment_method: "cod",
          idempotency_key: metaDownIdemKey,
          cartItems: [{ productId: item.productId, typeId: item.typeId, subProductId: item.subProductId, price: item.price, qty: 1 }],
        },
      },
      metaDownRes
    );
    assert.strictEqual(metaDownRes.statusCode, 200, "Order must still succeed when Meta API is unavailable");
    assert.strictEqual(metaDownRes.body.success, true);
    const metaDownOrder = await ordersCol.findOne({ invoice_number: metaDownRes.body.invoice_number });
    assert.ok(metaDownOrder, "Order must be persisted in MongoDB even when Meta API fails");
    assert.strictEqual(metaDownOrder.meta_tracking.purchase_sent, false);
    assert.strictEqual(metaDownOrder.meta_tracking.capi_status, "failed");

    console.log("[PASS] 6. Checkout & CAPI Purchase integration tests (Valid, Invalid, Stock, DB Fail, Idempotency, Meta Down)");
  } finally {
    global.fetch = origFetch;
    if (origToken === undefined) {
      delete process.env.META_ACCESS_TOKEN;
    } else {
      process.env.META_ACCESS_TOKEN = origToken;
    }
  }
}

(async () => {
  try {
    await testDbPing();
    await testInventoryEndpoint();
    testBuildScriptAndHtmlCoverage();
    await testStockJs();
    testFrontendPixelEvents();
    await testCheckoutAndMetaPurchaseScenarios();
    console.log(`ALL TESTS PASSED SUCCESSFULLY (${usingMockDb ? "In-Memory DB" : "Live MongoDB"}).`);
  } finally {
    try {
      const { client } = await require("./api/_db").connectToDatabase();
      if (client && typeof client.close === "function") {
        await client.close();
      }
    } catch (_) {}
  }
})().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
