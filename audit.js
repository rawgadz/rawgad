// test-db.js
require('dotenv').config();
const { connectToDatabase } = require('./api/_db');

async function test() {
  try {
    const { db } = await connectToDatabase();
    await db.command({ ping: 1 });
    console.log('[OK] Database connection successful.');
    process.exit(0);
  } catch (err) {
    console.error('[FAIL] Database connection failed:', err.message);
    process.exit(1);
  }
}

test();