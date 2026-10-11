// Seeds initial inventory in MongoDB Atlas (inventory collection)
// based on products.json purchasable item hierarchy rules.

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

// Fallback to load .env if not loaded
if (!process.env.MONGO_URI && fs.existsSync(path.join(__dirname, '.env'))) {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const MONGO_URI = process.env.MONGO_URI;

async function seedInventory(defaultStock = 0) {
  if (!MONGO_URI) {
    console.error('[seed-inventory] ERROR: MONGO_URI environment variable is missing.');
    process.exit(1);
  }

  const productsPath = path.join(__dirname, 'products.json');
  if (!fs.existsSync(productsPath)) {
    console.error(`[seed-inventory] ERROR: products.json not found at ${productsPath}`);
    process.exit(1);
  }

  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  const client = new MongoClient(MONGO_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
  });

  try {
    await client.connect();
    const dbName = process.env.MONGODB_DB || process.env.MONGO_DB || "paystationdemo";
    const db = client.db(dbName);
    const inventoryCol = db.collection('inventory');

    // Create unique compound index
    await inventoryCol.createIndex(
      { productId: 1, typeId: 1, subProductId: 1 },
      { unique: true }
    );
    console.log('[seed-inventory] Ensured unique index on productId + typeId + subProductId');

    const now = new Date();
    let totalItems = 0;
    let upsertedCount = 0;

    for (const product of products) {
      const productId = String(product.id);
      const types = Array.isArray(product.types) ? product.types : [];

      if (types.length === 0) {
        // Fallback for product without types
        totalItems++;
        const filter = { productId, typeId: null, subProductId: null };
        const update = {
          $setOnInsert: {
            productId,
            typeId: null,
            subProductId: null,
            stock: defaultStock,
            createdAt: now,
          },
          $set: {
            updatedAt: now,
          },
        };
        const res = await inventoryCol.updateOne(filter, update, { upsert: true });
        if (res.upsertedCount > 0) upsertedCount++;
        continue;
      }

      for (const type of types) {
        const typeId = String(type.subProductId || type.id);
        const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];

        if (subProducts.length > 0) {
          // Type contains subProducts: each subProduct is an individual inventory item
          for (const sub of subProducts) {
            totalItems++;
            const subProductId = String(sub.subProductId || sub.id);
            const filter = { productId, typeId, subProductId };
            const update = {
              $setOnInsert: {
                productId,
                typeId,
                subProductId,
                stock: defaultStock,
                createdAt: now,
              },
              $set: {
                updatedAt: now,
              },
            };
            const res = await inventoryCol.updateOne(filter, update, { upsert: true });
            if (res.upsertedCount > 0) upsertedCount++;
          }
        } else {
          // Type has no subProducts: the type itself is the individual inventory item (subProductId: null)
          totalItems++;
          const filter = { productId, typeId, subProductId: null };
          const update = {
            $setOnInsert: {
              productId,
              typeId,
              subProductId: null,
              stock: defaultStock,
              createdAt: now,
            },
            $set: {
              updatedAt: now,
            },
          };
          const res = await inventoryCol.updateOne(filter, update, { upsert: true });
          if (res.upsertedCount > 0) upsertedCount++;
        }
      }
    }

    console.log(`[seed-inventory] Processed ${totalItems} inventory items. Newly upserted: ${upsertedCount}`);
    const count = await inventoryCol.countDocuments();
    console.log(`[seed-inventory] Total documents in inventory collection: ${count}`);

    // Sample checks:
    const sampleProd1 = await inventoryCol.findOne({ productId: 'prod_001' });
    console.log('[seed-inventory] Sample prod_001:', sampleProd1);
    const sampleProduct023 = await inventoryCol.findOne({ productId: 'product_023' });
    console.log('[seed-inventory] Sample product_023:', sampleProduct023);

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
