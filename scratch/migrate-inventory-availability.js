// scratch/migrate-inventory-availability.js
// Non-destructive migration to add isAvailable to all inventory documents in MongoDB Atlas

const { getInventoryCollection, getDb } = require('../lib/db');

async function migrate() {
  console.log("=== INVENTORY isAvailable MIGRATION ===");
  try {
    const inventoryCol = await getInventoryCollection();
    const totalCount = await inventoryCol.countDocuments();
    console.log(`Total inventory documents in collection: ${totalCount}`);

    const missingCount = await inventoryCol.countDocuments({ isAvailable: { $exists: false } });
    console.log(`Documents missing 'isAvailable': ${missingCount}`);

    if (missingCount > 0) {
      console.log("Migrating documents missing 'isAvailable'...");

      // Update documents where stock > 0 -> isAvailable: true
      const resTrue = await inventoryCol.updateMany(
        { isAvailable: { $exists: false }, stock: { $gt: 0 } },
        { $set: { isAvailable: true, updatedAt: new Date() } }
      );
      console.log(`Updated with isAvailable: true (stock > 0): ${resTrue.modifiedCount}`);

      // Update documents where stock <= 0 -> isAvailable: false
      const resFalse = await inventoryCol.updateMany(
        { isAvailable: { $exists: false } },
        { $set: { isAvailable: false, updatedAt: new Date() } }
      );
      console.log(`Updated with isAvailable: false (stock <= 0): ${resFalse.modifiedCount}`);
    } else {
      console.log("All documents already have 'isAvailable' defined.");
    }

    const availableCount = await inventoryCol.countDocuments({ isAvailable: true });
    const unavailableCount = await inventoryCol.countDocuments({ isAvailable: false });
    console.log(`Summary: isAvailable: true = ${availableCount}, isAvailable: false = ${unavailableCount}`);

    // Sample document check
    const sample = await inventoryCol.findOne({});
    console.log("Sample migrated document:", sample);

    console.log("Migration complete successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

migrate();
