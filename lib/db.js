// MongoDB Atlas connection singleton & pool for Rawgadz Platform
// Collections: inventory, orders

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const DB_NAME = process.env.MONGODB_DB || process.env.MONGO_DB || "paystationdemo";

function loadEnvFallback() {
  if (process.env.MONGO_URI) return;
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
    path.join(__dirname, ".env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
            const idx = trimmed.indexOf("=");
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim();
            if (!process.env[k]) {
              process.env[k] = v;
            }
          }
        }
        if (process.env.MONGO_URI) break;
      } catch (_) {}
    }
  }
}

let clientPromise = null;
let indexesEnsured = false;

async function ensureIndexes(client) {
  if (indexesEnsured) return;
  try {
    const db = client.db(DB_NAME);
    const invCol = db.collection("inventory");
    const existing = await invCol.indexes().catch(() => []);
    const hasCompound = existing.some(idx => {
      const k = idx.key || {};
      return k.productId === 1 && k.typeId === 1 && k.subProductId === 1;
    });

    if (!hasCompound) {
      await invCol.createIndex(
        { productId: 1, typeId: 1, subProductId: 1 },
        { unique: true }
      );
    }

    const ordersCol = db.collection("orders");
    const orderIndexes = await ordersCol.indexes().catch(() => []);
    const hasInvoiceIdx = orderIndexes.some(idx => (idx.key || {}).invoice_number === 1);
    if (!hasInvoiceIdx) {
      await ordersCol.createIndex({ invoice_number: 1 }, { sparse: true });
    }

    indexesEnsured = true;
  } catch (err) {
    console.warn("[DB] Note: Could not ensure indexes:", err.message);
  }
}

async function getDb() {
  loadEnvFallback();
  const URI = process.env.MONGO_URI;
  if (!URI) {
    throw new Error("MONGO_URI environment variable is not defined");
  }

  if (global._mongoClient) {
    ensureIndexes(global._mongoClient).catch(() => {});
    return global._mongoClient;
  }

  if (clientPromise) return clientPromise;

  const client = new MongoClient(URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 15000,
    connectTimeoutMS: 10000,
  });

  clientPromise = client.connect()
    .then(async (connectedClient) => {
      global._mongoClient = connectedClient;
      await connectedClient.db("admin").command({ ping: 1 });
      await ensureIndexes(connectedClient);
      return connectedClient;
    })
    .catch((err) => {
      clientPromise = null;
      throw err;
    });

  return clientPromise;
}

async function getInventoryCollection() {
  const client = await getDb();
  return client.db(DB_NAME).collection("inventory");
}

async function getOrdersCollection() {
  const client = await getDb();
  return client.db(DB_NAME).collection("orders");
}

module.exports = {
  getDb,
  getInventoryCollection,
  getOrdersCollection,
  loadEnvFallback,
};