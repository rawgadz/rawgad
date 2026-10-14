// scratch/test-availability-e2e.js
// End-to-end verification suite for Gadget vs Normal separation and True/False stock availability logic

const fs = require('fs');
const path = require('path');
const inventoryHandler = require('../api/inventory');
const checkoutHandler = require('../api/checkout');
const { getInventoryCollection, getOrdersCollection } = require('../lib/db');
const { getStockStatus, makeKey } = require('../lib/catalog');
const { signToken, getAdminAuthSecret } = require('../lib/lib');

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
  console.log('====================================================');
  console.log('   FULL SYSTEM E2E VERIFICATION: PLAN.MD CHECKLIST  ');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(desc, condition, details = '') {
    total++;
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc} ${details ? '--> ' + details : ''}`);
    }
  }

  try {
    // ----------------------------------------------------
    // Section 1: Gadget vs Normal Product Separation
    // ----------------------------------------------------
    console.log('--- Section 1: Gadget vs Normal Product Separation ---');

    // 1.1 Check products.json
    const productsJsonPath = path.join(__dirname, '..', 'products.json');
    assert('products.json exists on disk', fs.existsSync(productsJsonPath));

    const products = JSON.parse(fs.readFileSync(productsJsonPath, 'utf8'));
    assert('products.json contains exactly 46 products', products.length === 46, `Got ${products.length}`);

    const normalProducts = products.filter(p => p.tab === 'normal' || !p.tab);
    const gadgetProducts = products.filter(p => p.tab === 'gadget');

    assert('Exactly 44 normal products in catalog', normalProducts.length === 44, `Got ${normalProducts.length}`);
    assert('Exactly 2 gadget products in catalog', gadgetProducts.length === 2, `Got ${gadgetProducts.length}`);

    const gadgetIds = gadgetProducts.map(p => p.id || p.productId).sort();
    assert('Gadget IDs are prod_002 and prod_003', 
      gadgetIds.includes('prod_002') && gadgetIds.includes('prod_003'));

    const normalHasGadgets = normalProducts.some(p => p.id === 'prod_002' || p.id === 'prod_003');
    assert('Normal products do NOT contain prod_002 or prod_003', !normalHasGadgets);

    // 1.2 Check gadgets.html and index.html
    const gadgetsHtmlPath = path.join(__dirname, '..', 'gadgets.html');
    assert('gadgets.html exists', fs.existsSync(gadgetsHtmlPath));
    const gadgetsHtml = fs.readFileSync(gadgetsHtmlPath, 'utf8');
    assert('gadgets.html filters for gadget tab', 
      gadgetsHtml.includes("all.filter(p => p.tab === 'gadget')"));
    const indexHtmlPath = path.join(__dirname, '..', 'index.html');
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
    assert('index.html filters for normal tab', 
      indexHtml.includes("all.filter(p => !p.tab || p.tab === 'normal')"));

    // ----------------------------------------------------
    // Section 2: lib/catalog.js Stock Status Logic
    // ----------------------------------------------------
    console.log('\n--- Section 2: lib/catalog.js Availability Logic ---');

    assert('getStockStatus(0, true) returns in_stock', getStockStatus(0, true) === 'in_stock');
    assert('getStockStatus(10, true) returns in_stock', getStockStatus(10, true) === 'in_stock');
    assert('getStockStatus(3, true) returns low_stock', getStockStatus(3, true) === 'low_stock');
    assert('getStockStatus(10, false) returns out_of_stock', getStockStatus(10, false) === 'out_of_stock');
    assert('getStockStatus(0, false) returns out_of_stock', getStockStatus(0, false) === 'out_of_stock');
    assert('getStockStatus(0) backward compatibility defaults to out_of_stock', getStockStatus(0) === 'out_of_stock');
    assert('getStockStatus(10) backward compatibility defaults to in_stock', getStockStatus(10) === 'in_stock');

    // ----------------------------------------------------
    // Section 3: MongoDB Atlas Schema & Data Migration Audit
    // ----------------------------------------------------
    console.log('\n--- Section 3: MongoDB Atlas Database Audit ---');

    const inventoryCol = await getInventoryCollection();

    const totalDocs = await inventoryCol.countDocuments();
    assert('MongoDB inventory collection has documents', totalDocs > 0, `Total: ${totalDocs}`);

    const unmigratedCount = await inventoryCol.countDocuments({
      isAvailable: { $exists: false }
    });
    assert('Zero documents with missing isAvailable field in MongoDB', unmigratedCount === 0, `Missing: ${unmigratedCount}`);

    const invalidTypeCount = await inventoryCol.countDocuments({
      isAvailable: { $not: { $type: 'bool' } }
    });
    assert('All isAvailable values are strict booleans', invalidTypeCount === 0, `Invalid: ${invalidTypeCount}`);

    // ----------------------------------------------------
    // Section 4: api/inventory.js API Verification
    // ----------------------------------------------------
    console.log('\n--- Section 4: api/inventory.js API Verification ---');

    // 4.1 Filter by tab
    {
      const resNormal = createMockRes();
      await inventoryHandler({ method: 'GET', url: '/api/inventory?tab=normal', query: { tab: 'normal' } }, resNormal);
      const dataNormal = resNormal.getData();
      assert('GET /api/inventory?tab=normal returns success', resNormal.getStatusCode() === 200 && dataNormal.success);
      assert('All items returned in tab=normal have tab !== gadget', 
        (dataNormal.items || []).every(i => (i.tab || 'normal') !== 'gadget'));

      const resGadget = createMockRes();
      await inventoryHandler({ method: 'GET', url: '/api/inventory?tab=gadget', query: { tab: 'gadget' } }, resGadget);
      const dataGadget = resGadget.getData();
      assert('GET /api/inventory?tab=gadget returns success', resGadget.getStatusCode() === 200 && dataGadget.success);
      assert('All items returned in tab=gadget have tab === gadget', 
        (dataGadget.items || []).every(i => i.tab === 'gadget'));
    }

    // 4.2 Summary counts
    const adminToken = signToken({ user: 'admin', role: 'admin', exp: Date.now() + 86400000 }, getAdminAuthSecret());
    const adminHeaders = { authorization: `Bearer ${adminToken}` };

    {
      const resAdmin = createMockRes();
      await inventoryHandler({ method: 'GET', url: '/api/inventory?admin=true', query: { admin: 'true' }, headers: adminHeaders }, resAdmin);
      const dataAdmin = resAdmin.getData();
      assert('Summary includes available and unavailable counts', 
        dataAdmin.summary && typeof dataAdmin.summary.available === 'number' && typeof dataAdmin.summary.unavailable === 'number',
        JSON.stringify(dataAdmin.summary));
    }

    // ----------------------------------------------------
    // Section 5: True/False Availability Stock & Checkout Logic
    // ----------------------------------------------------
    console.log('\n--- Section 5: Checkout Strict Availability Gating ---');

    // Pick a test SKU
    const testSku = await inventoryCol.findOne({ productId: 'prod_001' });
    assert('Found test document prod_001 in MongoDB', !!testSku);

    const originalStock = testSku.stock;
    const originalAvailability = testSku.isAvailable;
    const testTypeId = testSku.typeId || null;
    const testSubProductId = testSku.subProductId || null;

    const createdInvoices = [];

    // Helper to generate a test order payload
    function makeOrderPayload(qty = 1) {
      return {
        cust_name: 'Automated Test User',
        cust_phone: '01700000000',
        cust_email: 'test@rawgadz.com',
        cust_address: 'E2E Testing Suite Address, Dhaka, Bangladesh',
        payment_method: 'cod',
        items: [
          {
            id: 'prod_001',
            productId: 'prod_001',
            name: 'Test Product 001',
            price: 100,
            quantity: qty,
            typeId: testTypeId,
            subProductId: testSubProductId
          }
        ]
      };
    }

    // Case 5.1: isAvailable: false with positive stock (10)
    // Core requirement: Must be strictly REJECTED even though stock is 10!
    {
      console.log('Testing Case C: isAvailable: false, stock: 10 (Must reject checkout)');
      // Set to isAvailable: false, stock: 10 via inventory API
      const resSet = createMockRes();
      await inventoryHandler({
        method: 'POST',
        headers: adminHeaders,
        body: {
          productId: 'prod_001',
          typeId: testTypeId,
          subProductId: testSubProductId,
          action: 'set',
          value: 10,
          isAvailable: false
        }
      }, resSet);
      assert('Set test SKU to isAvailable: false, stock: 10', resSet.getStatusCode() === 200 && resSet.getData()?.success);

      // Verify DB
      const docAfterSet = await inventoryCol.findOne({ _id: testSku._id });
      assert('DB reflects isAvailable: false and stock: 10', docAfterSet.isAvailable === false && docAfterSet.stock === 10);

      // Attempt checkout
      const resCheckout = createMockRes();
      await checkoutHandler({
        method: 'POST',
        headers: {},
        body: makeOrderPayload(1)
      }, resCheckout);

      const checkoutData = resCheckout.getData();
      assert('Checkout strictly rejected with HTTP 400 when isAvailable: false', 
        resCheckout.getStatusCode() === 400, `Got HTTP ${resCheckout.getStatusCode()}`);
      assert('Checkout error message specifies item is unavailable', 
        checkoutData && !checkoutData.success && (checkoutData.error || '').toLowerCase().includes('unavailable'),
        `Error: ${checkoutData?.error}`);

      // Verify stock was NOT decremented
      const docAfterReject = await inventoryCol.findOne({ _id: testSku._id });
      assert('Stock remained untouched at 10 after rejected checkout', docAfterReject.stock === 10);
    }

    // Case 5.2: isAvailable: true with stock: 0
    // Core requirement: Must SUCCEED even though stock is 0! Stock stays 0.
    {
      console.log('Testing Case A: isAvailable: true, stock: 0 (Must allow checkout)');
      // Set to isAvailable: true, stock: 0 via inventory API
      const resSet = createMockRes();
      await inventoryHandler({
        method: 'POST',
        headers: adminHeaders,
        body: {
          productId: 'prod_001',
          typeId: testTypeId,
          subProductId: testSubProductId,
          action: 'set',
          value: 0,
          isAvailable: true
        }
      }, resSet);
      assert('Set test SKU to isAvailable: true, stock: 0', resSet.getStatusCode() === 200 && resSet.getData()?.success);

      // Verify DB
      const docAfterSet = await inventoryCol.findOne({ _id: testSku._id });
      assert('DB reflects isAvailable: true and stock: 0', docAfterSet.isAvailable === true && docAfterSet.stock === 0);

      // Attempt checkout
      const resCheckout = createMockRes();
      await checkoutHandler({
        method: 'POST',
        headers: {},
        body: makeOrderPayload(1)
      }, resCheckout);

      const checkoutData = resCheckout.getData();
      assert('Checkout succeeds with HTTP 200 when isAvailable: true with 0 stock', 
        resCheckout.getStatusCode() === 200 && checkoutData && checkoutData.success,
        `HTTP: ${resCheckout.getStatusCode()}, Data: ${JSON.stringify(checkoutData)}`);

      if (checkoutData?.invoice_number) {
        createdInvoices.push(checkoutData.invoice_number);
      }

      // Verify stock stayed at 0 (never negative)
      const docAfterBuy = await inventoryCol.findOne({ _id: testSku._id });
      assert('Stock remained at floor 0 after successful checkout', docAfterBuy.stock === 0);
    }

    // Case 5.3: isAvailable: true with stock: 10
    // Core requirement: Must SUCCEED and decrement stock by qty (10 -> 8).
    {
      console.log('Testing Case B: isAvailable: true, stock: 10 (Must allow checkout and decrement stock)');
      // Set to isAvailable: true, stock: 10
      const resSet = createMockRes();
      await inventoryHandler({
        method: 'POST',
        headers: adminHeaders,
        body: {
          productId: 'prod_001',
          typeId: testTypeId,
          subProductId: testSubProductId,
          action: 'set',
          value: 10,
          isAvailable: true
        }
      }, resSet);
      assert('Set test SKU to isAvailable: true, stock: 10', resSet.getStatusCode() === 200);

      // Attempt checkout of 2 units
      const resCheckout = createMockRes();
      await checkoutHandler({
        method: 'POST',
        headers: {},
        body: makeOrderPayload(2)
      }, resCheckout);

      const checkoutData = resCheckout.getData();
      assert('Checkout of 2 units succeeds with HTTP 200', 
        resCheckout.getStatusCode() === 200 && checkoutData && checkoutData.success);

      if (checkoutData?.invoice_number) {
        createdInvoices.push(checkoutData.invoice_number);
      }

      // Verify stock was decremented from 10 to 8
      const docAfterBuy = await inventoryCol.findOne({ _id: testSku._id });
      assert('Stock was decremented from 10 to 8', docAfterBuy.stock === 8, `Got ${docAfterBuy.stock}`);
    }

    // ----------------------------------------------------
    // Cleanup & Restoration
    // ----------------------------------------------------
    console.log('\n--- Cleanup: Restoring original state ---');

    // Clean up created test orders
    if (createdInvoices.length > 0) {
      const ordersCol = await getOrdersCollection();
      const delRes = await ordersCol.deleteMany({ invoice_number: { $in: createdInvoices } });
      console.log(`Cleaned up ${delRes.deletedCount} test orders (${createdInvoices.join(', ')})`);
    }

    // Restore test SKU original values
    await inventoryCol.updateOne(
      { _id: testSku._id },
      { $set: { stock: originalStock, isAvailable: originalAvailability, updatedAt: new Date() } }
    );
    console.log(`Restored test SKU prod_001 to stock: ${originalStock}, isAvailable: ${originalAvailability}`);

    // Summary
    console.log('\n====================================================');
    console.log(`TEST RESULTS: ${passed} / ${total} assertions passed (${Math.round(passed / total * 100)}%)`);
    console.log('====================================================\n');

    if (passed === total) {
      console.log('>>> ALL VERIFICATION CRITERIA SATISFIED! <<<');
      process.exit(0);
    } else {
      console.error('>>> SOME CRITERIA FAILED! <<<');
      process.exit(1);
    }

  } catch (err) {
    console.error('Error during test execution:', err);
    process.exit(1);
  }
}

runTests();
