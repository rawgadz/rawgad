// api/pathao.js
// Unified Pathao Courier Aladdin API integration for Rawgadz Platform
// Handles OAuth token issuance with in-memory caching, store listing, live tracking,
// order dispatch, and inbound status webhook listening.

const { ObjectId } = require("mongodb");
const { setCors, parseBody, ok, badRequest, notFound, serverError, requireAdminAuth } = require("../lib/lib");
const { getOrdersCollection, loadEnvFallback } = require("../lib/db");

// In-memory token cache across warm serverless invocations (zero DB overhead)
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

/**
 * Retrieves a valid Pathao Access Token using in-memory caching.
 * Caches token with a 1-hour safety buffer before expiration.
 */
async function getAccessToken() {
  loadEnvFallback();
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const baseUrl = (process.env.PATHAO_BASE_URL || "https://api-hermes.pathao.com").replace(/\/+$/, "");
  const clientId = (process.env.PATHAO_CLIENT_ID || "").trim();
  const clientSecret = (process.env.PATHAO_CLIENT_SECRET || "").trim();
  const username = (process.env.PATHAO_USERNAME || "").trim();
  const password = (process.env.PATHAO_PASSWORD || "").trim();

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error(
      "Missing Pathao API credentials in environment (PATHAO_CLIENT_ID, PATHAO_CLIENT_SECRET, PATHAO_USERNAME, PATHAO_PASSWORD)."
    );
  }

  const response = await fetch(`${baseUrl}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "password",
      username,
      password,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`Pathao token generation failed: ${errData.message || response.statusText}`);
  }

  const data = await response.json();
  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + Math.max((data.expires_in - 3600) * 1000, 60000);

  return tokenCache.accessToken;
}

/**
 * Handles inbound Pathao status webhook events
 */
async function handlePathaoWebhook(req, res, payload) {
  const consignmentId =
    payload.consignment_id ||
    payload.consignment_number ||
    payload.data?.consignment_id ||
    payload.data?.consignment_number;

  const merchantOrderId =
    payload.merchant_order_id ||
    payload.invoice_number ||
    payload.data?.merchant_order_id ||
    payload.data?.invoice_number;

  const eventStatus =
    payload.order_status ||
    payload.event ||
    payload.status ||
    payload.data?.order_status ||
    "updated";

  if (!consignmentId && !merchantOrderId) {
    return badRequest(res, "Missing consignment_id or merchant_order_id in webhook payload");
  }

  try {
    const ordersCol = await getOrdersCollection();
    const query = consignmentId
      ? {
          $or: [
            { consignment_id: consignmentId },
            { pathao_consignment_id: consignmentId },
            { "courier.consignment_id": consignmentId },
            ...(merchantOrderId ? [{ invoice_number: merchantOrderId }] : []),
          ],
        }
      : { invoice_number: merchantOrderId };

    const updateDoc = {
      $set: {
        courier_status: eventStatus,
        pathao_order_status: eventStatus,
        "courier.status": eventStatus,
        "courier.lastWebhookAt": new Date(),
        updated_at: new Date(),
        updatedAt: new Date(),
      },
      $push: {
        courier_events: {
          event: eventStatus,
          payload,
          received_at: new Date(),
        },
      },
    };

    const normalized = eventStatus.toLowerCase();
    if (normalized.includes("deliver") && !normalized.includes("undeliver") && !normalized.includes("failed")) {
      updateDoc.$set.status = "delivered";
      updateDoc.$set.verified = true;
    } else if (normalized.includes("return")) {
      updateDoc.$set.status = "returned";
    }

    const result = await ordersCol.updateOne(query, updateDoc);

    return ok(res, {
      message: "Pathao webhook processed successfully",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    return serverError(res, err);
  }
}

/**
 * Main Pathao API Request Handler
 */
async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  loadEnvFallback();
  const baseUrl = (process.env.PATHAO_BASE_URL || "https://api-hermes.pathao.com").replace(/\/+$/, "");

  // ====================================================
  // GET /api/pathao — Stores, Tracking, Status & Test
  // ====================================================
  if (req.method === "GET") {
    // CRITICAL SERVER-SIDE SECURITY GUARD
    // Querying courier stores, tracking consignments, or testing courier connection requires Admin Authorization
    const adminUser = requireAdminAuth(req, res);
    if (!adminUser) return;

    const action = (req.query && req.query.action) || "";
    const consignmentId = (req.query && req.query.consignment_id) || "";
    const invoiceNumber = (req.query && req.query.invoice_number) || "";

    // 1. Fetch Merchant Stores
    if (action === "stores") {
      try {
        const token = await getAccessToken();
        const storeRes = await fetch(`${baseUrl}/aladdin/api/v1/stores`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        const storeData = await storeRes.json().catch(() => ({}));
        if (!storeRes.ok) {
          return res.status(storeRes.status).json({
            success: false,
            error: storeData.message || "Failed to fetch stores",
          });
        }
        const stores = (storeData.data && storeData.data.data) || storeData.data || [];
        return ok(res, {
          stores,
          defaultStoreId: process.env.PATHAO_STORE_ID
            ? parseInt(process.env.PATHAO_STORE_ID, 10)
            : (stores[0] ? stores[0].store_id : null),
        });
      } catch (err) {
        return serverError(res, err);
      }
    }

    // 2. Test Pathao API Authentication
    if (action === "test") {
      try {
        const token = await getAccessToken();
        return ok(res, {
          message: "Pathao Merchant API authenticated successfully",
          tokenPreview: token.slice(0, 10) + "...",
          baseUrl,
        });
      } catch (err) {
        return res.status(502).json({
          success: false,
          error: "Pathao Authentication Test Failed",
          details: err.message,
        });
      }
    }

    // 3. Live Consignment Tracking
    if (consignmentId) {
      try {
        const token = await getAccessToken();
        const trackRes = await fetch(`${baseUrl}/aladdin/api/v1/orders/${encodeURIComponent(consignmentId)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        const trackData = await trackRes.json().catch(() => ({}));
        if (!trackRes.ok) {
          return res.status(trackRes.status).json({
            success: false,
            error: trackData.message || "Failed to retrieve Pathao tracking info",
            details: trackData,
          });
        }
        return ok(res, { tracking: trackData.data || trackData });
      } catch (err) {
        return serverError(res, err);
      }
    }

    // 4. Order Status Lookup by Invoice Number
    if (invoiceNumber) {
      try {
        const ordersCol = await getOrdersCollection();
        const order = await ordersCol.findOne({ invoice_number: invoiceNumber });
        if (!order) return notFound(res, "Order not found");
        return ok(res, {
          invoice_number: invoiceNumber,
          courier_status: order.courier_status || "not_dispatched",
          consignment_id: order.pathao_consignment_id || order.consignment_id || null,
          courier: order.courier || null,
        });
      } catch (err) {
        return serverError(res, err);
      }
    }

    // Default GET: Return configuration status & default store ID
    return ok(res, {
      configured: !!(process.env.PATHAO_CLIENT_ID && process.env.PATHAO_CLIENT_SECRET),
      baseUrl,
      defaultStoreId: process.env.PATHAO_STORE_ID ? parseInt(process.env.PATHAO_STORE_ID, 10) : null,
    });
  }

  // ====================================================
  // POST /api/pathao — Create Pathao Order OR Inbound Webhook
  // ====================================================
  if (req.method === "POST") {
    try {
      const orderData = await parseBody(req);

      // Check if this is an inbound Pathao Webhook event
      const isWebhook =
        (req.query && req.query.action === "webhook") ||
        (orderData.event && (orderData.consignment_id || orderData.merchant_order_id)) ||
        (orderData.order_status && !orderData.store_id && !orderData.recipient_phone && (orderData.consignment_id || orderData.merchant_order_id));

      if (isWebhook) {
        return handlePathaoWebhook(req, res, orderData);
      }

      // CRITICAL SERVER-SIDE SECURITY GUARD
      // Booking courier parcels and incurring shipping fees strictly requires Admin Authorization
      const adminUser = requireAdminAuth(req, res);
      if (!adminUser) return;

      // Normal Order Dispatch Flow
      const merchantOrderId = String(orderData.invoice_number || orderData.merchant_order_id || "").trim();

      let existingOrder = null;
      let ordersCol = null;
      try {
        ordersCol = await getOrdersCollection();
        if (merchantOrderId) {
          const query = {
            $or: [{ invoice_number: merchantOrderId }, { _id: merchantOrderId }],
          };
          if (ObjectId.isValid(merchantOrderId)) {
            try {
              query.$or.push({ _id: new ObjectId(merchantOrderId) });
            } catch (_) {}
          }
          existingOrder = await ordersCol.findOne(query);
        }
      } catch (dbErr) {
        console.warn("[Pathao DB Lookup Warning]", dbErr.message);
      }

      // Prevent duplicate dispatches
      if (existingOrder && (existingOrder.pathao_consignment_id || existingOrder.courier_status === "dispatched")) {
        const existingConsignment = existingOrder.pathao_consignment_id || existingOrder.consignment_id;
        return res.status(409).json({
          success: false,
          error: "Order is already dispatched to Pathao Courier",
          consignment_id: existingConsignment,
          invoice_number: existingOrder.invoice_number || merchantOrderId,
        });
      }

      // 1. Validate / Resolve store_id
      const rawStoreId = orderData.store_id || process.env.PATHAO_STORE_ID;
      const storeId = parseInt(rawStoreId, 10);
      if (!storeId || isNaN(storeId)) {
        return badRequest(
          res,
          "Missing or invalid store_id. Please configure PATHAO_STORE_ID in .env or provide store_id in payload."
        );
      }

      // 2. Resolve recipient name
      const recipientName = String(
        orderData.recipient_name ||
        orderData.custom_recipient_name ||
        existingOrder?.customer?.name ||
        "Customer"
      ).trim();

      // 3. Resolve & sanitize recipient phone
      const rawPhone = String(
        orderData.recipient_phone ||
        orderData.custom_recipient_phone ||
        existingOrder?.customer?.phone ||
        ""
      ).trim();

      let cleanPhone = rawPhone.replace(/[^0-9]/g, "");
      if (cleanPhone.startsWith("880")) cleanPhone = "0" + cleanPhone.slice(3);
      if (cleanPhone.length > 11 && cleanPhone.startsWith("88")) cleanPhone = cleanPhone.slice(2);
      if (!cleanPhone.startsWith("01") && cleanPhone.length === 10) cleanPhone = "0" + cleanPhone;

      if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith("01")) {
        return badRequest(
          res,
          `Invalid recipient phone number '${rawPhone}'. Must be a valid 11-digit Bangladeshi mobile number (e.g. 01712345678).`
        );
      }

      // 4. Resolve & validate recipient address (Pathao requires min 10 characters)
      let fullAddress = String(
        orderData.recipient_address ||
        orderData.custom_recipient_address ||
        existingOrder?.customer?.full_address ||
        existingOrder?.customer?.address_detail ||
        ""
      ).trim();

      if (fullAddress.length < 10 && existingOrder?.customer) {
        const jelaThana = [existingOrder.customer.thana, existingOrder.customer.jela].filter(Boolean).join(", ");
        if (jelaThana) {
          fullAddress = `${fullAddress}, ${jelaThana}`.trim();
        }
      }
      if (fullAddress.length < 10) {
        return badRequest(res, "Recipient address is too short. Pathao requires at least 10 characters.");
      }

      // 5. Quantity & Weight
      const items = existingOrder?.items || [];
      const itemQuantity = parseInt(
        orderData.item_quantity ||
        (items.length > 0 ? items.reduce((sum, item) => sum + (parseInt(item.qty || item.quantity, 10) || 1), 0) : 1),
        10
      );

      const rawWeight = orderData.item_weight !== undefined ? orderData.item_weight : orderData.custom_weight;
      const itemWeight = rawWeight !== undefined && rawWeight !== null
        ? Math.max(0.5, parseFloat(rawWeight) || 0.5)
        : Math.max(0.5, itemQuantity * 0.5);

      // 6. Amount to collect
      let amountToCollect = 0;
      const rawCollect = orderData.amount_to_collect !== undefined ? orderData.amount_to_collect : orderData.custom_amount_to_collect;
      if (rawCollect !== undefined && rawCollect !== null) {
        amountToCollect = Math.max(0, Math.round(Number(rawCollect)));
      } else if (existingOrder) {
        const pm = (existingOrder.payment_method || "").toLowerCase();
        const isCod = pm === "cod";
        const isPaidOnline = !isCod && (
          existingOrder.status === "success" ||
          existingOrder.trx_status === "success" ||
          existingOrder.verified === true
        );
        amountToCollect = isPaidOnline ? 0 : Math.round(Number(existingOrder.payment_amount) || 0);
      }

      // 7. Description & special instructions
      const itemDescription = String(
        orderData.item_description ||
        existingOrder?.checkout_items ||
        (items.length > 0 ? items.map(i => `${i.name || i.productTitle || "Item"} x${i.qty || 1}`).join(", ") : "Rawgadz Order")
      ).trim().slice(0, 200);

      const specialInstruction = String(orderData.special_instruction || "").trim();

      // 8. Build Aladdin API Payload
      const payload = {
        store_id: storeId,
        merchant_order_id: merchantOrderId || `ORD-${Date.now()}`,
        recipient_name: recipientName,
        recipient_phone: cleanPhone,
        recipient_address: fullAddress,
        delivery_type: parseInt(orderData.delivery_type || 48, 10),
        item_type: parseInt(orderData.item_type || 2, 10),
        special_instruction: specialInstruction,
        item_quantity: itemQuantity,
        item_weight: itemWeight,
        amount_to_collect: amountToCollect,
        item_description: itemDescription,
      };

      if (orderData.recipient_city) payload.recipient_city = parseInt(orderData.recipient_city, 10);
      if (orderData.recipient_zone) payload.recipient_zone = parseInt(orderData.recipient_zone, 10);
      if (orderData.recipient_area) payload.recipient_area = parseInt(orderData.recipient_area, 10);

      // 9. Request Access Token & Dispatch
      const accessToken = await getAccessToken();

      const pathaoResponse = await fetch(`${baseUrl}/aladdin/api/v1/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const responseData = await pathaoResponse.json().catch(() => ({}));

      if (!pathaoResponse.ok) {
        return res.status(pathaoResponse.status).json({
          success: false,
          error:
            responseData.message ||
            (responseData.errors ? JSON.stringify(responseData.errors) : "Failed to create Pathao delivery order"),
          details: responseData,
        });
      }

      const consignmentId =
        responseData.data?.consignment_id ||
        responseData.consignment_id ||
        responseData.data?.consignment_number ||
        responseData.consignment_number ||
        `PTH-${Date.now()}`;

      const deliveryFee = responseData.data?.delivery_fee || null;
      const orderStatus = responseData.data?.order_status || "Pending";

      // 10. Synchronize MongoDB Order Document
      let orderUpdated = false;
      if (existingOrder && ordersCol) {
        try {
          const now = new Date();
          await ordersCol.updateOne(
            { _id: existingOrder._id },
            {
              $set: {
                pathao_consignment_id: consignmentId,
                consignment_id: consignmentId,
                pathao_order_status: orderStatus,
                pathao_delivery_fee: deliveryFee,
                pathao_dispatched_at: now,
                courier_status: "dispatched",
                status:
                  existingOrder.status === "pending" ||
                  existingOrder.status === "confirmed" ||
                  existingOrder.status === "processing"
                    ? "shipped"
                    : existingOrder.status,
                courier: {
                  provider: "pathao",
                  status: "dispatched",
                  consignment_id: consignmentId,
                  store_id: storeId,
                  amount_to_collect: amountToCollect,
                  delivery_fee: deliveryFee,
                  dispatched_at: now,
                },
                updated_at: now,
                updatedAt: now,
              },
            }
          );
          orderUpdated = true;
        } catch (dbUpdErr) {
          console.warn("[Pathao DB Update Warning]", dbUpdErr.message);
        }
      }

      return ok(res, {
        message: "Order dispatched to Pathao successfully",
        orderUpdated,
        consignment_id: consignmentId,
        delivery_fee: deliveryFee,
        invoice_number: merchantOrderId,
        amount_to_collect: amountToCollect,
        data: responseData.data || responseData,
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed. Use GET or POST." });
}

handler.getAccessToken = getAccessToken;
handler.handlePathaoWebhook = handlePathaoWebhook;
module.exports = handler;
