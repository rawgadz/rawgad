// scratch/test-availability-e2e.js
// E2E verification of Markdown-based availability in _catalog.js, inventory.js, and checkout.js

const assert = require("assert");
const {
  validateBooleanField,
  resolveProductAvailability,
  filterAvailableProducts,
  extractPurchasableItems,
} = require("../api/_catalog");

async function run() {
  console.log("=== Testing Markdown-Based Availability E2E ===");

  // 1. Strict boolean validation
  assert.strictEqual(validateBooleanField(true), true);
  assert.strictEqual(validateBooleanField(false), false);
  assert.strictEqual(validateBooleanField(undefined), undefined);
  assert.throws(() => validateBooleanField("false"), /Invalid availability value/);
  assert.throws(() => validateBooleanField("true"), /Invalid availability value/);
  assert.throws(() => validateBooleanField(0), /Invalid availability value/);

  // 2. Inheritance & effective availability
  const mixedProduct = resolveProductAvailability({
    id: "p1",
    title: "Mixed Product",
    price: 500,
    available: true,
    types: [
      { subProductId: "t1", subTitle: "Available Type", price: 500 },
      { subProductId: "t2", subTitle: "Unavailable Type", price: 600, available: false },
    ],
  });
  assert.strictEqual(mixedProduct.available, true);
  assert.strictEqual(mixedProduct.types[0].available, true);
  assert.strictEqual(mixedProduct.types[1].available, false);

  const storefrontList = filterAvailableProducts([
    mixedProduct,
    { id: "p2", title: "Hidden Product", price: 300, available: false },
    {
      id: "p3",
      title: "All Variants Unavailable",
      price: 400,
      available: true,
      types: [{ subProductId: "t3", subTitle: "Off", available: false }],
    },
  ]);

  assert.strictEqual(storefrontList.length, 1);
  assert.strictEqual(storefrontList[0].id, "p1");
  assert.strictEqual(storefrontList[0].types.length, 1);
  assert.strictEqual(storefrontList[0].types[0].subProductId, "t1");

  const purchasable = extractPurchasableItems([mixedProduct]);
  assert.strictEqual(purchasable.length, 2);
  assert.strictEqual(purchasable[0].available, true);
  assert.strictEqual(purchasable[1].available, false);

  console.log("ALL MARKDOWN AVAILABILITY E2E TESTS PASSED!");
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;
