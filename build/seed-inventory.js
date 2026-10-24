// build/seed-inventory.js
// Seeds initial inventory in MongoDB Atlas based on data/products.json
// Supports 2-mode variant schema: stockMode ("quantity" | "unlimited") and ensures indexes.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT_DIR = process.cwd();
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGODB_DB || process.env.MONGO_DB;

async function seedInventory(defaultStock = 0) {
  if (!MONGO_URI) {
    throw new Error('[seed-inventory] ERROR: MONGO_URI environment variable is required.');
  }
  if (!DB_NAME) {
    throw new Error('[seed-inventory] ERROR: MONGODB_DB environment variable is required.');
  }

  const productsPath = path.join(ROOT_DIR, 'data', 'products.json');
  if (!fs.existsSync(productsPath)) {
    throw new Error(`[seed-inventory] ERROR: data/products.json not found at ${productsPath}`);
  }

  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  const client = new MongoClient(MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const inventoryCol = db.collection('inventory');
    const ordersCol = db.collection('orders');

    // 1. Create unique compound index on inventory
    await inventoryCol.createIndex(
      { productId: 1, typeId: 1, subProductId: 1 },
      { unique: true }
    );
    console.log('[seed-inventory] Ensured unique compound index on inventory: { productId: 1, typeId: 1, subProductId: 1 }');

    // 2. Create unique index on orders invoice_number & compound on status + created_at
    await ordersCol.createIndex({ invoice_number: 1 }, { unique: true });
    await ordersCol.createIndex({ status: 1, created_at: -1 });
    console.log('[seed-inventory] Ensured indexes on orders: { invoice_number: 1 (unique) } & { status: 1, created_at: -1 }');

    const now = new Date();
    let totalItems = 0;
    let upsertedCount = 0;

    for (const product of products) {
      const productId = String(product.id).trim();
      const types = Array.isArray(product.types) ? product.types : [];

      if (types.length === 0) {
        totalItems++;
        const filter = { productId, typeId: null, subProductId: null };
        const update = {
          $setOnInsert: {
            productId,
            typeId: null,
            subProductId: null,
            stockMode: 'quantity',
            stock: defaultStock,
            isAvailable: defaultStock > 0,
            createdAt: now,
          },
          $set: { updatedAt: now },
        };
        const res = await inventoryCol.updateOne(filter, update, { upsert: true });
        if (res.upsertedCount > 0) upsertedCount++;
        continue;
      }

      for (const type of types) {
        const typeId = String(type.subProductId || type.id).trim();
        const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];

        if (subProducts.length > 0) {
          for (const sub of subProducts) {
            totalItems++;
            const subProductId = String(sub.subProductId || sub.id).trim();
            const filter = { productId, typeId, subProductId };
            const update = {
              $setOnInsert: {
                productId,
                typeId,
                subProductId,
                stockMode: 'quantity',
                stock: defaultStock,
                isAvailable: defaultStock > 0,
                createdAt: now,
              },
              $set: { updatedAt: now },
            };
            const res = await inventoryCol.updateOne(filter, update, { upsert: true });
            if (res.upsertedCount > 0) upsertedCount++;
          }
        } else {
          totalItems++;
          const filter = { productId, typeId, subProductId: null };
          const update = {
            $setOnInsert: {
              productId,
              typeId,
              subProductId: null,
              stockMode: 'quantity',
              stock: defaultStock,
              isAvailable: defaultStock > 0,
              createdAt: now,
            },
            $set: { updatedAt: now },
          };
          const res = await inventoryCol.updateOne(filter, update, { upsert: true });
          if (res.upsertedCount > 0) upsertedCount++;
        }
      }
    }

    console.log(`[seed-inventory] Processed ${totalItems} inventory items. Newly upserted: ${upsertedCount}`);
    const count = await inventoryCol.countDocuments();
    console.log(`[seed-inventory] Total documents in inventory collection: ${count}`);

  } finally {
    await client.close();
  }
}

if (require.main === module) {
  seedInventory().catch(err => {
    console.error('[seed-inventory] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { seedInventory };
