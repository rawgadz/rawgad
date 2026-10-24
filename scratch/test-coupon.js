const assert = require('assert');
const checkoutHandler = require('../api/checkout');
const { getOrdersCollection } = require('../api/_db');

async function run() {
  function mockRes() {
    return {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      setHeader() {}
    };
  }

  const itemKey = '3d-dot-grip-leather-carbon-fiber-splicing-universal-steering-cover';

  // Test 5A: Valid coupon (RAWGADZ10)
  const validReq = {
    method: 'POST',
    body: {
      cust_name: 'Test Customer',
      cust_phone: '01712345678',
      cust_email: 'test@example.com',
      cust_address: '123 Test Street, Dhaka',
      payment_method: 'cod',
      coupon_code: 'RAWGADZ10',
      cartItems: [{
        productId: itemKey,
        typeId: null,
        subProductId: null,
        price: 100,
        qty: 1
      }]
    }
  };

  const res1 = mockRes();
  await checkoutHandler(validReq, res1);
  assert.strictEqual(res1.statusCode, 200, 'Expected 200 for valid coupon');
  assert.strictEqual(res1.body.success, true);

  const ordersCol = await getOrdersCollection();
  const createdOrder = await ordersCol.findOne({ invoice_number: res1.body.invoice_number });
  assert.ok(createdOrder, 'Order should be created in DB');
  assert.strictEqual(createdOrder.coupon_code, 'RAWGADZ10');
  assert.strictEqual(createdOrder.discount_amount, 10);
  assert.strictEqual(createdOrder.payment_amount, 90);

  // Test 5B: Invalid coupon
  const invalidReq = {
    method: 'POST',
    body: {
      cust_name: 'Test Customer',
      cust_phone: '01712345678',
      cust_email: 'test@example.com',
      cust_address: '123 Test Street, Dhaka',
      payment_method: 'cod',
      coupon_code: 'INVALID_CODE',
      cartItems: [{
        productId: itemKey,
        typeId: null,
        subProductId: null,
        price: 100,
        qty: 1
      }]
    }
  };

  const res2 = mockRes();
  await checkoutHandler(invalidReq, res2);
  assert.strictEqual(res2.statusCode, 400, 'Expected 400 for invalid coupon');
  assert.strictEqual(res2.body.success, false);

  console.log('PASS: Checkout Coupon Test');
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
