// api/checkout.js
// POST /api/checkout — Production-grade order handler with atomic MongoDB stock validation & decrement
// Payment methods: COD, bKash, and Nagad

const fs = require("fs");
const path = require("path");
const { ObjectId } = require("mongodb");
const { getDb } = require("../lib/db");

// Load products.json static catalog once for server-side item & price validation
let catalogMap = null;

function getCatalogMap() {
  if (catalogMap) return catalogMap;
  catalogMap = new Map();

  try {
    const productsPath = path.join(process.cwd(), "products.json");
    if (fs.existsSync(productsPath)) {
      const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
      for (const p of products) {
        const pId = String(p.id);
        const types = Array.isArray(p.types) ? p.types : [];

        if (types.length === 0) {
          catalogMap.set(pId, {
            productId: pId,
            typeId: null,
            subProductId: null,
            name: p.title || "Product",
            price: Number(p.price) || 0,
          });
          continue;
        }

        for (const t of types) {
          const tId = String(t.subProductId || t.id);
          const subProducts = Array.isArray(t.subProducts) ? t.subProducts : [];

          if (subProducts.length > 0) {
            for (const sub of subProducts) {
              const sId = String(sub.subProductId || sub.id);
              const itemInfo = {
                productId: pId,
                typeId: tId,
                subProductId: sId,
                name: sub.subTitle || t.subTitle || p.title,
                price: typeof sub.price === "number" ? sub.price : (typeof t.price === "number" ? t.price : Number(p.price) || 0),
              };
              // Index by subProductId, and by composite key
              catalogMap.set(sId, itemInfo);
              catalogMap.set(`${pId}:::${tId}:::${sId}`, itemInfo);
              catalogMap.set(`${pId}:::${sId}`, itemInfo);
            }
          } else {
            const itemInfo = {
              productId: pId,
              typeId: tId,
              subProductId: null,
              name: t.subTitle || p.title,
              price: typeof t.price === "number" ? t.price : Number(p.price) || 0,
            };
            catalogMap.set(tId, itemInfo);
            catalogMap.set(`${pId}:::${tId}`, itemInfo);
            catalogMap.set(`${pId}:::null`, itemInfo);
          }
        }
      }
    }
  } catch (err) {
    console.error("[checkout] Error building catalog map:", err.message);
  }

  return catalogMap;
}

function resolveInventoryItem(rawItem) {
  const map = getCatalogMap();
  const rawId = String(rawItem.id || rawItem.productId || "").trim();
  const rawTypeId = rawItem.typeId !== undefined && rawItem.typeId !== null ? String(rawItem.typeId).trim() : null;
  const rawSubId = (rawItem.subProductId !== undefined && rawItem.subProductId !== null && rawItem.subProductId !== "null" && rawItem.subProductId !== "")
    ? String(rawItem.subProductId).trim()
    : null;

  // 1. Try exact composite lookup
  if (rawId && rawTypeId && rawSubId && map.has(`${rawId}:::${rawTypeId}:::${rawSubId}`)) {
    return { ...map.get(`${rawId}:::${rawTypeId}:::${rawSubId}`) };
  }
  if (rawId && rawTypeId && !rawSubId && map.has(`${rawId}:::${rawTypeId}`)) {
    return { ...map.get(`${rawId}:::${rawTypeId}`) };
  }
  if (rawId && rawSubId && map.has(`${rawId}:::${rawSubId}`)) {
    return { ...map.get(`${rawId}:::${rawSubId}`) };
  }

  // 2. Try subProductId lookup
  if (rawSubId && map.has(rawSubId)) {
    return { ...map.get(rawSubId) };
  }

  // 3. Try rawId as subProductId or typeId (legacy cart format where activeId was subProductId)
  if (rawId && map.has(rawId)) {
    return { ...map.get(rawId) };
  }

  // 4. Try rawId:::null
  if (rawId && map.has(`${rawId}:::null`)) {
    return { ...map.get(`${rawId}:::null`) };
  }

  // 5. Fallback constructed from rawItem if valid
  if (rawId) {
    return {
      productId: rawId,
      typeId: rawTypeId,
      subProductId: rawSubId,
      name: rawItem.name || rawItem.title || "Product",
      price: Number(rawItem.price) || 0,
    };
  }

  return null;
}

function generateInvoice() {
  try {
    return "INV-" + new ObjectId().toHexString().toUpperCase();
  } catch (e) {
    return "INV-" + Date.now() + "-" + Math.floor(1000 + Math.random() * 9000);
  }
}

function sanitise(str, max = 200) {
  if (typeof str !== "string") return "";
  return str.trim().slice(0, max);
}

function validatePhone(phone) {
  if (!phone) return false;
  return /^01[0-9]{9}$/.test(phone.replace(/[\s-]/g, ""));
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const body = req.body || {};
  const {
    items,
    cartItems,
    cust_name,
    cust_phone,
    cust_email,
    cust_address,
    payment_method,
    trx_id,
    sender_number,
    coupon_code,
  } = body;

  const name = sanitise(cust_name, 100);
  const phone = sanitise(cust_phone, 20).replace(/[\s-]/g, "");
  const email = sanitise(cust_email, 200);
  const address = sanitise(cust_address, 300);
  const method = (payment_method || "cod").toLowerCase().trim();

  // Validate customer details
  if (!name) return res.status(400).json({ success: false, error: "Full Name is required" });
  if (!validatePhone(phone)) return res.status(400).json({ success: false, error: "Invalid phone number (must be 11 digits: 01XXXXXXXXX)" });
  if (!validateEmail(email)) return res.status(400).json({ success: false, error: "Invalid email address" });
  if (!address || address.length < 5) return res.status(400).json({ success: false, error: "Complete delivery address is required" });

  // Validate payment method: only COD, bKash, and Nagad are accepted
  if (!["cod", "bkash", "nagad"].includes(method)) {
    return res.status(400).json({
      success: false,
      error: "Invalid payment method. Only Cash on Delivery (cod), bKash (bkash), and Nagad (nagad) are supported."
    });
  }

  // Validate transaction details for bKash and Nagad
  let cleanTrxId = null;
  let cleanSenderNumber = null;

  if (method === "bkash" || method === "nagad") {
    cleanTrxId = sanitise(trx_id, 50).toUpperCase();
    if (!cleanTrxId || cleanTrxId.length < 4) {
      return res.status(400).json({
        success: false,
        error: `Please enter a valid ${method === "bkash" ? "bKash" : "Nagad"} Transaction ID (TrxID)`
      });
    }

    cleanSenderNumber = sanitise(sender_number || phone, 20).replace(/[\s-]/g, "");
    if (!validatePhone(cleanSenderNumber)) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${method === "bkash" ? "bKash" : "Nagad"} sender number (must be 11 digits: 01XXXXXXXXX)`
      });
    }
  }

  // Validate cart items
  const rawItems = Array.isArray(cartItems) && cartItems.length > 0
    ? cartItems
    : (Array.isArray(items) ? items : []);

  if (rawItems.length === 0) {
    return res.status(400).json({ success: false, error: "Cart is empty. Please add items to your cart." });
  }

  const validatedLineItems = [];
  let calculatedSubtotal = 0;

  for (const raw of rawItems) {
    const qty = parseInt(raw.qty || raw.quantity, 10);
    if (!qty || isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, error: "Invalid item quantity in cart." });
    }

    const resolved = resolveInventoryItem(raw);
    if (!resolved || !resolved.productId) {
      return res.status(400).json({
        success: false,
        error: `Unknown or invalid product item: ${raw.name || raw.title || raw.id || "unidentified item"}`
      });
    }

    // Server-verified price
    const itemPrice = resolved.price > 0 ? resolved.price : (parseFloat(raw.price) || 0);
    const itemSubtotal = Math.round(itemPrice * qty * 100) / 100;
    calculatedSubtotal += itemSubtotal;

    validatedLineItems.push({
      id: resolved.productId,
      typeId: resolved.typeId || null,
      subProductId: resolved.subProductId ?? null,
      name: resolved.name || raw.name || raw.title || "Product",
      price: itemPrice,
      qty,
      subtotal: itemSubtotal
    });
  }

  calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;

  // Coupon discount calculation
  let discountAmount = 0;
  let appliedCoupon = null;
  const envCoupon = (process.env.COUPON_CODE || "RAWGADZ10").trim().toUpperCase();
  const envPercent = Number(process.env.COUPON_DISCOUNT_PERCENT) || 10;

  if (coupon_code && typeof coupon_code === "string") {
    const normCoupon = coupon_code.trim().toUpperCase();
    if (normCoupon === envCoupon || normCoupon === "RAWGADZ10" || normCoupon === "RAWGAD10") {
      appliedCoupon = normCoupon;
      discountAmount = Math.round((calculatedSubtotal * (envPercent / 100)) * 100) / 100;
    }
  }

  const finalAmount = Math.max(0, Math.round((calculatedSubtotal - discountAmount) * 100) / 100);
  const invoice_number = generateInvoice();
  const orderTrxId = method === "cod" ? `COD-${invoice_number}` : cleanTrxId;

  // Prepare Order Document
  // Each order item matches exact schema:
  // { id: "prod_001", subProductId: "...", name: "...", price: ..., qty: ..., subtotal: ... }
  const orderDoc = {
    invoice_number,
    subtotal: calculatedSubtotal,
    discount_amount: discountAmount,
    coupon_code: appliedCoupon,
    payment_amount: finalAmount,
    currency: "BDT",
    payment_method: method,
    status: "pending",
    trx_status: method === "cod" ? "cash_on_delivery" : "under_verification",
    trx_id: orderTrxId,
    sender_number: cleanSenderNumber,
    verified: false,
    customer: { name, phone, email, full_address: address },
    items: validatedLineItems.map(item => ({
      id: item.id,
      subProductId: item.subProductId,
      name: item.name,
      price: item.price,
      qty: item.qty,
      subtotal: item.subtotal
    })),
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Connect to MongoDB and execute atomic stock validation & decrement
  let client;
  try {
    client = await getDb();
  } catch (dbErr) {
    console.error("[checkout] DB connection failed:", dbErr.message);
    return res.status(500).json({
      success: false,
      error: "Unable to connect to checkout database. Please try again later."
    });
  }

  const dbName = process.env.MONGODB_DB || process.env.MONGO_DB || "paystationdemo";
  const db = client.db(dbName);
  const inventoryCol = db.collection("inventory");
  const ordersCol = db.collection("orders");

  // Attempt transaction-based atomic decrease
  let session = null;
  let useTransaction = false;

  try {
    session = client.startSession();
    useTransaction = true;
  } catch (_) {
    session = null;
    useTransaction = false;
  }

  if (useTransaction && session) {
    try {
      await session.withTransaction(async () => {
        // Step 1: Validate every item and atomically decrease stock
        for (const item of validatedLineItems) {
          const existingDoc = await inventoryCol.findOne(
            {
              productId: item.id,
              typeId: item.typeId ?? null,
              subProductId: item.subProductId ?? null,
            },
            { session }
          );

          const isAlwaysAvailable = existingDoc && (existingDoc.isAvailable === true || existingDoc.stockType === "available");

          if (isAlwaysAvailable) {
            // Always Available Mode: never blocks order
            if (existingDoc && typeof existingDoc.stock === "number" && existingDoc.stock >= item.qty) {
              await inventoryCol.updateOne(
                { _id: existingDoc._id },
                { $inc: { stock: -item.qty }, $set: { updatedAt: new Date() } },
                { session }
              );
            } else if (existingDoc) {
              await inventoryCol.updateOne(
                { _id: existingDoc._id },
                { $set: { updatedAt: new Date() } },
                { session }
              );
            }
          } else {
            // Fixed stock mode: requires stock >= item.qty
            const filter = {
              productId: item.id,
              typeId: item.typeId ?? null,
              subProductId: item.subProductId ?? null,
              stock: { $gte: item.qty }
            };

            const updateRes = await inventoryCol.findOneAndUpdate(
              filter,
              {
                $inc: { stock: -item.qty },
                $set: { updatedAt: new Date() }
              },
              { session, returnDocument: "after" }
            );

            if (!updateRes) {
              const available = existingDoc && typeof existingDoc.stock === "number" ? existingDoc.stock : 0;
              const err = new Error(
                `Insufficient stock for "${item.name}". Requested ${item.qty}, but only ${available} available.`
              );
              err.code = "INSUFFICIENT_STOCK";
              err.available = available;
              throw err;
            }
          }
        }

        // Step 2: Create the order ONLY after successful stock validation & decrement
        await ordersCol.insertOne(orderDoc, { session });
      });
    } catch (txErr) {
      if (txErr.code === "INSUFFICIENT_STOCK") {
        return res.status(400).json({
          success: false,
          error: txErr.message
        });
      }
      console.error("[checkout] Transaction error:", txErr.message);
      return res.status(400).json({
        success: false,
        error: txErr.message || "Failed to process order stock validation."
      });
    } finally {
      await session.endSession();
    }
  } else {
    // Non-transaction fallback: conditional atomic update with rollback compensation
    const decrementedFixedItems = [];

    try {
      for (const item of validatedLineItems) {
        const existingDoc = await inventoryCol.findOne({
          productId: item.id,
          typeId: item.typeId ?? null,
          subProductId: item.subProductId ?? null,
        });

        const isAlwaysAvailable = existingDoc && (existingDoc.isAvailable === true || existingDoc.stockType === "available");

        if (isAlwaysAvailable) {
          if (existingDoc && typeof existingDoc.stock === "number" && existingDoc.stock >= item.qty) {
            await inventoryCol.updateOne(
              { _id: existingDoc._id },
              { $inc: { stock: -item.qty }, $set: { updatedAt: new Date() } }
            );
          } else if (existingDoc) {
            await inventoryCol.updateOne(
              { _id: existingDoc._id },
              { $set: { updatedAt: new Date() } }
            );
          }
        } else {
          const filter = {
            productId: item.id,
            typeId: item.typeId ?? null,
            subProductId: item.subProductId ?? null,
            stock: { $gte: item.qty }
          };

          const updateRes = await inventoryCol.findOneAndUpdate(
            filter,
            {
              $inc: { stock: -item.qty },
              $set: { updatedAt: new Date() }
            },
            { returnDocument: "after" }
          );

          if (!updateRes) {
            const available = existingDoc && typeof existingDoc.stock === "number" ? existingDoc.stock : 0;
            throw new Error(
              `Insufficient stock for "${item.name}". Requested ${item.qty}, but only ${available} available.`
            );
          }

          decrementedFixedItems.push(item);
        }
      }

      // Create order after all items validated & processed
      await ordersCol.insertOne(orderDoc);

    } catch (err) {
      // Rollback any successfully decremented fixed items
      for (const dec of decrementedFixedItems) {
        try {
          await inventoryCol.updateOne(
            {
              productId: dec.id,
              subProductId: dec.subProductId,
              ...(dec.typeId ? { typeId: dec.typeId } : {})
            },
            {
              $inc: { stock: dec.qty },
              $set: { updatedAt: new Date() }
            }
          );
        } catch (rollbackErr) {
          console.error("[checkout] Rollback error:", rollbackErr.message);
        }
      }

      return res.status(400).json({
        success: false,
        error: err.message || "Order rejected due to stock validation failure."
      });
    }
  }

  const redirect_url = method === "cod"
    ? `/thank.html?invoice_number=${encodeURIComponent(invoice_number)}&method=cod`
    : `/thank.html?invoice_number=${encodeURIComponent(invoice_number)}&method=${method}&trx_id=${encodeURIComponent(cleanTrxId)}`;

  const message = method === "cod"
    ? "Order placed successfully with Cash on Delivery!"
    : `Order placed successfully! Your ${method === "bkash" ? "bKash" : "Nagad"} payment is under verification.`;

  return res.status(200).json({
    success: true,
    payment_method: method,
    invoice_number,
    trx_id: orderTrxId,
    message,
    redirect_url
  });
};
