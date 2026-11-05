// api/_db.js
// MongoDB Atlas connection singleton & pool for Rawgadz Platform
// Free-Tier M0 & Vercel Hobby optimized

const { MongoClient } = require("mongodb");

let clientPromise = null;

function getDbConfig() {
  const URI = process.env.MONGO_URI;
  if (!URI) {
    throw new Error("MONGO_URI environment variable is required.");
  }
  const dbName = process.env.MONGODB_DB;
  if (!dbName) {
    throw new Error("MONGODB_DB environment variable is required.");
  }
  return { URI, dbName };
}

async function getDb() {
  const { URI } = getDbConfig();

  if (global._mongoClient) {
    return global._mongoClient;
  }

  if (clientPromise) return clientPromise;

  const client = new MongoClient(URI, {
    maxPoolSize: 2,
    maxIdleTimeMS: 15000,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 15000,
  });

  client.on("close", () => {
    global._mongoClient = null;
    clientPromise = null;
  });

  clientPromise = client.connect()
    .then(async (connectedClient) => {
      global._mongoClient = connectedClient;
      await connectedClient.db("admin").command({ ping: 1 });
      return connectedClient;
    })
    .catch((err) => {
      global._mongoClient = null;
      clientPromise = null;
      throw err;
    });

  return clientPromise;
}

async function getOrdersCollection() {
  const { dbName } = getDbConfig();
  const client = await getDb();
  return client.db(dbName).collection("orders");
}

async function connectToDatabase() {
  const { dbName } = getDbConfig();
  const client = await getDb();
  return { client, db: client.db(dbName) };
}

module.exports = {
  getDb,
  connectToDatabase,
  getOrdersCollection,
  getDbConfig
};
