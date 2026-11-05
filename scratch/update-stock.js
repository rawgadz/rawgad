const { getInventoryCollection } = require('../api/_db');

async function update() {
  const col = await getInventoryCollection();
  const res = await col.updateMany({}, { $set: { stock: 25 }, $unset: { isAvailable: "", stockMode: "" } });
  console.log('Updated stock for documents:', res.modifiedCount);
  process.exit(0);
}

update().catch(err => {
  console.error(err);
  process.exit(1);
});
