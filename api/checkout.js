// api/checkout.js
// POST /api/checkout — Production checkout handler with Markdown-compiled availability & physical stock verification
// Sole origin for COD Order Creation and Meta Conversions API (CAPI) Purchase tracking

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ObjectId } = require("mongodb");
const { getDb, getInventoryCollection, getOrdersCollection } = require("./_db");
const { normalizeId, makeCanonicalKey, getPurchasableCatalogMap } = require("./_catalog");
const { parseBody } = require("./_helpers");
const { buildPurchaseCustomData, trackServerPurchase } = require("./_meta");

const IDEMPOTENCY_WINDOW_MS = 5000;

function loadPriceJson() {
  const pPath = path.join(process.cwd(), "data", "price.json");
  if (!fs.existsSync(pPath)) {
    throw new Error(`data/price.json is missing at ${pPath}`);
  }
  return JSON.parse(fs.readFileSync(pPath, "utf8"));
}

function loadCouponJson() {
  const cPath = path.join(process.cwd(), "content", "coupons.json");
  if (!fs.existsSync(cPath)) {
    throw new Error(`content/coupons.json is missing at ${cPath}`);
  }
  return JSON.parse(fs.readFileSync(cPath, "utf8"));
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

function computePayloadFingerprint({ phone, name, address, method, coupon, validatedLineItems }) {
  const canonicalItems = validatedLineItems
    .map((item) => `${item.canonicalKey}:${item.qty}`)
    .sort()
    .join("|");
  const raw = JSON.stringify({
    phone,
    name: name.toLowerCase(),
    address: address.toLowerCase(),
    method,
    coupon: coupon || "",
    items: canonicalItems,
  });
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function buildCheckoutSuccessResponse(orderDoc, duplicatePrevented = false) {
  const method = orderDoc.payment_method || "cod";
  const invoice_number = orderDoc.invoice_number;
  const orderTrxId = orderDoc.trx_id || `COD-${invoice_number}`;
  const event_id = orderDoc.meta_tracking?.event_id || invoice_number;
  const purchase_data = buildPurchaseCustomData(orderDoc);

  const redirect_url = method === "cod"
    ? `/thank.html?invoice_number=${encodeURIComponent(invoice_number)}&method=cod`
    : `/thank.html?invoice_number=${encodeURIComponent(invoice_number)}&method=${method}&trx_id=${encodeURIComponent(orderTrxId)}`;

  const message = method === "cod"
    ? "Order placed successfully with Cash on Delivery!"
    : `Order placed successfully! Your ${method === "bkash" ? "bKash" : "Nagad"} payment is under verification.`;

  const responsePayload = {
    success: true,
    payment_method: method,
    invoice_number,
    trx_id: orderTrxId,
    message,
    redirect_url,
    event_id,
    purchase_data,
  };

  if (duplicatePrevented) {
    responsePayload.duplicate_prevented = true;
  }

  return responsePayload;
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

  try {
    const body = (req.body && typeof req.body === "object") ? req.body : await parseBody(req);
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
      idempotency_key,
      fbp,
      fbc,
      event_source_url,
    } = body || {};

    const name = sanitise(cust_name, 100);
    const phone = sanitise(cust_phone, 20).replace(/[\s-]/g, "");
    const rawEmail = sanitise(cust_email, 200);
    const email = rawEmail || "noemail@gmail.com";
    const address = sanitise(cust_address, 300);
    const method = (payment_method || "cod").toLowerCase().trim();
    const cleanIdempotencyKey = idempotency_key ? sanitise(String(idempotency_key), 120) : null;

    if (!name) return res.status(400).json({ success: false, error: "Full Name is required" });
    if (!validatePhone(phone)) return res.status(400).json({ success: false, error: "Invalid phone number (must be 11 digits: 01XXXXXXXXX)" });
    if (!validateEmail(email)) return res.status(400).json({ success: false, error: "Invalid email address" });
    if (!address || address.length < 5) return res.status(400).json({ success: false, error: "Complete delivery address is required" });

    if (!["cod", "bkash", "nagad"].includes(method)) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment method. Only Cash on Delivery (cod), bKash (bkash), and Nagad (nagad) are supported."
      });
    }

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

    const rawItems = Array.isArray(cartItems) && cartItems.length > 0
      ? cartItems
      : (Array.isArray(items) ? items : []);

    if (rawItems.length === 0) {
      return res.status(400).json({ success: false, error: "Cart is empty. Please add items to your cart." });
    }

    const priceCatalog = loadPriceJson();
    const { map: catalogMap } = getPurchasableCatalogMap();
    const validatedLineItems = [];
    let calculatedSubtotal = 0;

    for (const raw of rawItems) {
      const qty = parseInt(raw.qty || raw.quantity, 10);
      if (!qty || isNaN(qty) || qty <= 0) {
        return res.status(400).json({ success: false, error: "Invalid item quantity in cart." });
      }

      const pId = String(raw.id || raw.productId || "").trim();
      const tId = normalizeId(raw.typeId);
      const sId = normalizeId(raw.subProductId);
      const canonicalKey = makeCanonicalKey(pId, tId, sId);

      const priceEntry = priceCatalog[canonicalKey];
      const catalogItem = catalogMap.get(canonicalKey);
      if (!priceEntry || !catalogItem) {
        return res.status(400).json({
          success: false,
          error: `Invalid product or variant: ${raw.name || raw.title || canonicalKey}`
        });
      }

      // Enforce Markdown-defined product and variant availability server-side before order creation
      if (catalogItem.available !== true) {
        return res.status(400).json({
          success: false,
          error: `Item "${priceEntry.name}" is currently unavailable.`
        });
      }

      const itemPrice = priceEntry.price;
      const itemSubtotal = Math.round(itemPrice * qty * 100) / 100;
      calculatedSubtotal += itemSubtotal;

      validatedLineItems.push({
        productId: priceEntry.productId,
        typeId: priceEntry.typeId,
        subProductId: priceEntry.subProductId,
        canonicalKey,
        name: priceEntry.name,
        price: itemPrice,
        qty,
        subtotal: itemSubtotal
      });
    }

    calculatedSubtotal = Math.round(calculatedSubtotal * 100) / 100;

    // Strict Coupon Validation from content/coupons.json
    let discountAmount = 0;
    let appliedCoupon = null;

    if (coupon_code && typeof coupon_code === "string" && coupon_code.trim()) {
      const normInput = coupon_code.trim().toUpperCase();
      const coupons = loadCouponJson();
      const matched = coupons.find(c => c && c.code && c.code.trim().toUpperCase() === normInput && c.active === true);
      if (matched) {
        appliedCoupon = matched.code.trim().toUpperCase();
        const percent = Number(matched.discount_percent) || 0;
        discountAmount = Math.round((calculatedSubtotal * (percent / 100)) * 100) / 100;
      } else {
        return res.status(400).json({ success: false, error: "Invalid or expired coupon code" });
      }
    }

    const finalAmount = Math.max(0, Math.round((calculatedSubtotal - discountAmount) * 100) / 100);
    const payloadFingerprint = computePayloadFingerprint({
      phone,
      name,
      address,
      method,
      coupon: appliedCoupon,
      validatedLineItems,
    });

    const client = await getDb();
    const inventoryCol = await getInventoryCollection();
    const ordersCol = await getOrdersCollection();

    // Idempotency Check: Prevent duplicate order creation and duplicate Purchase events
    let existingOrder = null;
    if (cleanIdempotencyKey) {
      existingOrder = await ordersCol.findOne({ idempotency_key: cleanIdempotencyKey });
    } else {
      existingOrder = await ordersCol.findOne({
        idempotency_key: null,
        payload_fingerprint: payloadFingerprint,
        created_at: { $gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
      });
    }

    if (existingOrder) {
      const existingEventId = existingOrder.meta_tracking?.event_id || existingOrder.invoice_number;

      if (
        existingOrder.payment_method === "cod" &&
        existingOrder.meta_tracking?.purchase_sent !== true &&
        existingOrder.meta_tracking?.capi_status !== "skipped_no_token"
      ) {
        try {
          const claimRes = await ordersCol.findOneAndUpdate(
            {
              _id: existingOrder._id,
              "meta_tracking.purchase_sent": { $ne: true },
              "meta_tracking.sending": { $ne: true },
            },
            {
              $set: { "meta_tracking.sending": true, "meta_tracking.updated_at": new Date() },
            }
          );

          if (claimRes) {
            const retryCapi = await trackServerPurchase({
              order: existingOrder,
              eventId: existingEventId,
              req,
              eventSourceUrl: event_source_url,
              fbp,
              fbc,
            });

            await ordersCol.updateOne(
              { _id: existingOrder._id },
              {
                $set: {
                  "meta_tracking.purchase_sent": Boolean(retryCapi.sent),
                  "meta_tracking.capi_status": retryCapi.status || "failed",
                  "meta_tracking.sending": false,
                  "meta_tracking.updated_at": new Date(),
                },
                $inc: { "meta_tracking.attempts": 1 },
              }
            );
          }
        } catch (retryErr) {
          console.error("[checkout] Safe CAPI retry warning:", retryErr && retryErr.message ? retryErr.message : retryErr);
        }
      }

      return res.status(200).json(buildCheckoutSuccessResponse(existingOrder, true));
    }

    const invoice_number = generateInvoice();
    const orderTrxId = method === "cod" ? `COD-${invoice_number}` : cleanTrxId;

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
        productId: item.productId,
        typeId: item.typeId,
        subProductId: item.subProductId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        subtotal: item.subtotal
      })),
      idempotency_key: cleanIdempotencyKey,
      payload_fingerprint: payloadFingerprint,
      meta_tracking: {
        event_id: invoice_number,
        purchase_sent: false,
        capi_status: "pending",
        attempts: 0,
        updated_at: new Date(),
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

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
          for (const item of validatedLineItems) {
            const filter = {
              productId: item.productId,
              typeId: item.typeId ?? null,
              subProductId: item.subProductId ?? null,
            };

            const doc = await inventoryCol.findOne(filter, { session });
            if (!doc) {
              const err = new Error(`Item "${item.name}" is currently out of stock.`);
              err.code = "OUT_OF_STOCK";
              throw err;
            }

            const updateRes = await inventoryCol.findOneAndUpdate(
              {
                productId: item.productId,
                typeId: item.typeId ?? null,
                subProductId: item.subProductId ?? null,
                stock: { $gte: item.qty }
              },
              {
                $inc: { stock: -item.qty },
                $set: { updatedAt: new Date() },
                $unset: { isAvailable: "", stockMode: "" }
              },
              { session, returnDocument: "after" }
            );

            if (!updateRes) {
              const availableStock = typeof doc.stock === "number" ? doc.stock : 0;
              const err = new Error(`Insufficient stock for "${item.name}". Requested ${item.qty}, but only ${availableStock} available.`);
              err.code = "INSUFFICIENT_STOCK";
              throw err;
            }
          }

          await ordersCol.insertOne(orderDoc, { session });
        });
      } catch (txErr) {
        return res.status(400).json({
          success: false,
          error: txErr.message || "Failed to process order stock validation."
        });
      } finally {
        await session.endSession();
      }
    } else {
      // Non-transaction fallback with compensation rollback
      const decrementedItems = [];
      try {
        for (const item of validatedLineItems) {
          const filter = {
            productId: item.productId,
            typeId: item.typeId ?? null,
            subProductId: item.subProductId ?? null,
          };

          const doc = await inventoryCol.findOne(filter);
          if (!doc) {
            throw new Error(`Item "${item.name}" is currently out of stock.`);
          }

          const updateRes = await inventoryCol.findOneAndUpdate(
            {
              productId: item.productId,
              typeId: item.typeId ?? null,
              subProductId: item.subProductId ?? null,
              stock: { $gte: item.qty }
            },
            {
              $inc: { stock: -item.qty },
              $set: { updatedAt: new Date() },
              $unset: { isAvailable: "", stockMode: "" }
            },
            { returnDocument: "after" }
          );

          if (!updateRes) {
            const availableStock = typeof doc.stock === "number" ? doc.stock : 0;
            throw new Error(`Insufficient stock for "${item.name}". Requested ${item.qty}, but only ${availableStock} available.`);
          }

          decrementedItems.push(item);
        }

        await ordersCol.insertOne(orderDoc);
      } catch (err) {
        for (const dec of decrementedItems) {
          try {
            await inventoryCol.updateOne(
              {
                productId: dec.productId,
                typeId: dec.typeId ?? null,
                subProductId: dec.subProductId ?? null,
              },
              {
                $inc: { stock: dec.qty },
                $set: { updatedAt: new Date() }
              }
            );
          } catch (_) {}
        }

        return res.status(400).json({
          success: false,
          error: err.message || "Order rejected due to stock validation failure."
        });
      }
    }

    // Step 8: Only after successful order insertion in MongoDB, trigger Purchase via Meta CAPI
    if (method === "cod") {
      try {
        const capiResult = await trackServerPurchase({
          order: orderDoc,
          eventId: invoice_number,
          req,
          eventSourceUrl: event_source_url,
          fbp,
          fbc,
        });

        await ordersCol.updateOne(
          { invoice_number },
          {
            $set: {
              "meta_tracking.purchase_sent": Boolean(capiResult.sent),
              "meta_tracking.capi_status": capiResult.status || "failed",
              "meta_tracking.updated_at": new Date(),
            },
            $inc: { "meta_tracking.attempts": 1 },
          }
        );
      } catch (trackingErr) {
        console.error("[checkout] Non-blocking Meta CAPI error:", trackingErr && trackingErr.message ? trackingErr.message : trackingErr);
        try {
          await ordersCol.updateOne(
            { invoice_number },
            {
              $set: {
                "meta_tracking.purchase_sent": false,
                "meta_tracking.capi_status": "failed",
                "meta_tracking.updated_at": new Date(),
              },
              $inc: { "meta_tracking.attempts": 1 },
            }
          );
        } catch (_) {}
      }
    }

    return res.status(200).json(buildCheckoutSuccessResponse(orderDoc, false));
  } catch (globalErr) {
    console.error("[checkout] Fatal error:", globalErr);
    return res.status(500).json({ success: false, error: globalErr.message || "Server Error" });
  }
};
