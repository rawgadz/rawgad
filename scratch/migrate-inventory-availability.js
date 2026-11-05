// scratch/migrate-inventory-availability.js
// MongoDB Migration: Remove obsolete admin availability fields (`isAvailable`, `stockMode`)
// while preserving physical stock quantities, compound identifiers, and timestamps.

const { getInventoryCollection, getDb } = require("../api/_db");

async function migrate() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.log("[migrate-inventory] MONGO_URI not configured in environment. Skipping live DB migration.");
    return;
  }

  console.log("=== Starting MongoDB Inventory Cleanup Migration ===");
  let client;
  try {
    const col = await getInventoryCollection();
    client = await getDb();

    const totalBefore = await col.countDocuments({});
    console.log(`Total inventory documents found: ${totalBefore}`);

    const res = await col.updateMany(
      {},
      {
        $unset: {
          isAvailable: "",
          stockMode: "",
        },
        $set: {
          updatedAt: new Date(),
        },
      }
    );

    console.log(`Matched ${res.matchedCount} documents, modified ${res.modifiedCount} documents.`);
    console.log("=== Migration Complete ===");
  } finally {
    if (client) {
      await client.close().catch(() => {});
    }
  }
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

module.exports = migrate;
