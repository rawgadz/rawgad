// build/seed-inventory.js
// Automatically seeds missing product/variant records into MongoDB during build.
// Safe: never overwrites existing stock levels; removes obsolete availability fields; skips gracefully if MONGO_URI is not set.

const { getPurchasableCatalogMap, normalizeId } = require("../api/_catalog");

function buildVariantFilter(productId, typeId, subProductId) {
  const pId = String(productId).trim();
  const normT = normalizeId(typeId);
  const normS = normalizeId(subProductId);

  const query = { productId: pId };
  query.typeId = normT === "_" ? { $in: [null, "", "_"] } : normT;
  query.subProductId = normS === "_" ? { $in: [null, "", "_"] } : normS;
  return query;
}

async function seedInventory() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.log("[seed-inventory] MONGO_URI not set in environment — skipping build-time DB seed (runtime auto-sync in /api/inventory will handle it).");
    return;
  }

  let client;
  try {
    const { getInventoryCollection, getDb } = require("../api/_db");
    const { items } = getPurchasableCatalogMap();

    if (!items || items.length === 0) {
      console.log("[seed-inventory] No purchasable items found in data/products.json.");
      return;
    }

    const col = await getInventoryCollection();
    client = await getDb();

    // Clean up obsolete availability fields on existing records without altering stock
    await col.updateMany(
      { $or: [{ isAvailable: { $exists: true } }, { stockMode: { $exists: true } }] },
      { $unset: { isAvailable: "", stockMode: "" } }
    );

    const now = new Date();
    const bulkOps = items.map((item) => ({
      updateOne: {
        filter: buildVariantFilter(item.productId, item.typeId, item.subProductId),
        update: {
          $setOnInsert: {
            productId: item.productId,
            typeId: item.typeId ?? null,
            subProductId: item.subProductId ?? null,
            stock: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    }));

    const result = await col.bulkWrite(bulkOps, { ordered: false });
    console.log(
      `[seed-inventory] Synced ${items.length} catalog items with MongoDB (inserted: ${result.upsertedCount || 0}, existing preserved: ${result.matchedCount || 0}).`
    );
  } catch (err) {
    console.warn(`[seed-inventory] Warning: Could not seed MongoDB at build time (${err.message}). Runtime auto-sync will handle it.`);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (e) {}
    }
  }
}

if (require.main === module) {
  seedInventory().then(() => process.exit(0));
}

module.exports = seedInventory;
