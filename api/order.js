// api/order.js
// GET    /api/order — Fetch orders, stats, and search for Admin (Protected)
// PATCH  /api/order — Update order status, payment verification, admin notes (Protected)
// DELETE /api/order — Delete order by invoice number (Protected)

const { getDb } = require("../lib/db");
const {
  setCors,
  parseBody,
  ok,
  badRequest,
  notFound,
  serverError,
  requireAdminAuth,
} = require("../lib/lib");

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ====================================================
  // CRITICAL SERVER-SIDE SECURITY GUARD
  // Enforce valid Admin JWT Bearer authentication for ALL order operations
  // ====================================================
  const adminUser = requireAdminAuth(req, res);
  if (!adminUser) {
    return; // 401 sent by requireAdminAuth
  }

  let client;
  let ordersCol;
  const dbName = process.env.MONGODB_DB || process.env.MONGO_DB || "paystationdemo";
  try {
    client = await getDb();
    ordersCol = client.db(dbName).collection("orders");
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Database connection failed",
      details: err.message
    });
  }

  // ==========================================
  // GET: Fetch orders with filters & metrics
  // ==========================================
  if (req.method === "GET") {
    try {
      const { search, status, payment_method, courier_status, limit = 200 } = req.query || {};

      const query = {};

      if (status && status !== "all") {
        query.status = status;
      }

      if (payment_method && payment_method !== "all") {
        query.payment_method = payment_method.toLowerCase();
      }

      if (courier_status && courier_status !== "all") {
        if (courier_status === "ready" || courier_status === "not_dispatched") {
          query.$or = [
            { courier_status: { $exists: false } },
            { courier_status: null },
            { courier_status: "not_dispatched" },
            { courier_status: "ready" }
          ];
        } else {
          query.courier_status = courier_status;
        }
      }

      if (search && search.trim()) {
        const s = search.trim();
        const regex = new RegExp(s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"), "i");
        query.$or = [
          { invoice_number: regex },
          { "customer.name": regex },
          { "customer.phone": regex },
          { "customer.email": regex },
          { "customer.full_address": regex },
          { trx_id: regex },
          { consignment_id: regex },
          { coupon_code: regex }
        ];
      }

      const numLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
      const orders = await ordersCol
        .find(query)
        .sort({ created_at: -1 })
        .limit(numLimit)
        .toArray();

      // Compute summary metrics across all store orders
      const allOrders = await ordersCol.find({}).project({
        payment_amount: 1,
        status: 1,
        verified: 1,
        payment_method: 1,
        courier_status: 1,
        created_at: 1
      }).toArray();

      const totalOrders = allOrders.length;
      let totalRevenue = 0;
      let pendingDispatch = 0;
      let pendingPayment = 0;
      let dispatchedCount = 0;
      let deliveredCount = 0;

      for (const o of allOrders) {
        const amt = Number(o.payment_amount) || 0;
        const isPaid = o.status === "success" || o.status === "delivered" || (o.verified && o.payment_method !== "cod");
        if (isPaid || o.payment_method === "cod") {
          totalRevenue += amt;
        }

        const isDispatched = o.courier_status === "dispatched" || o.courier_status === "in_transit";
        if (isDispatched) {
          dispatchedCount++;
        } else if (o.courier_status !== "delivered" && o.status !== "cancelled" && o.status !== "failed") {
          pendingDispatch++;
        }

        if (o.courier_status === "delivered" || o.status === "delivered") {
          deliveredCount++;
        }

        if (o.payment_method !== "cod" && !isPaid) {
          pendingPayment++;
        }
      }

      return res.status(200).json({
        success: true,
        count: orders.length,
        orders: orders,
        metrics: {
          totalOrders,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          pendingDispatch,
          pendingPayment,
          dispatchedCount,
          deliveredCount
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch orders from database",
        details: err.message
      });
    }
  }

  // ==========================================
  // PATCH / PUT: Update order details & status
  // ==========================================
  if (req.method === "PATCH" || req.method === "PUT") {
    try {
      const body = await parseBody(req);
      const { invoice_number, status, verified, trx_status, courier_status, admin_notes, customer } = body;

      if (!invoice_number) {
        return badRequest(res, "invoice_number is required");
      }

      const updateFields = {
        updated_at: new Date()
      };

      if (status !== undefined) updateFields.status = String(status).trim();
      if (verified !== undefined) updateFields.verified = Boolean(verified);
      if (trx_status !== undefined) updateFields.trx_status = String(trx_status).trim();
      if (courier_status !== undefined) updateFields.courier_status = String(courier_status).trim();
      if (admin_notes !== undefined) updateFields.admin_notes = String(admin_notes).trim();

      if (customer && typeof customer === "object") {
        if (customer.name) updateFields["customer.name"] = customer.name;
        if (customer.phone) updateFields["customer.phone"] = customer.phone;
        if (customer.full_address) updateFields["customer.full_address"] = customer.full_address;
        if (customer.email) updateFields["customer.email"] = customer.email;
      }

      const existingOrder = await ordersCol.findOne({ invoice_number });
      if (!existingOrder) {
        return notFound(res, "Order not found");
      }

      const prevStatus = existingOrder.status;
      const isCancelling = status && String(status).toLowerCase().trim() === "cancelled";
      let stockRestored = false;
      let restoredTotalQuantity = 0;

      // Handle stock restoration on cancellation
      if (isCancelling) {
        const alreadyRestored = !!(existingOrder.stockRestored || existingOrder.stock_restored);
        if (!alreadyRestored && prevStatus !== "cancelled") {
          try {
            const { getPurchasableCatalogMap, resolveOrderItemIdentity, normalizeId } = require("../lib/catalog");
            const db = client.db(dbName);
            const inventoryCol = db.collection("inventory");
            const { map: catalogMap } = await getPurchasableCatalogMap();
            const rawItems = Array.isArray(existingOrder.items) ? existingOrder.items : [];

            for (const item of rawItems) {
              const qty = parseInt(item.qty || item.quantity || 1, 10);
              if (qty > 0) {
                const resolved = resolveOrderItemIdentity(item, catalogMap);
                const pId = resolved.productId;
                const tId = normalizeId(resolved.typeId);
                const sId = normalizeId(resolved.subProductId);

                await inventoryCol.updateOne(
                  { productId: pId, typeId: tId, subProductId: sId },
                  { $inc: { stock: qty }, $set: { updatedAt: new Date() } }
                );
                restoredTotalQuantity += qty;
              }
            }

            updateFields.stockRestored = true;
            updateFields.stock_restored = true;
            updateFields.stockRestoredAt = new Date();
            updateFields.stock_restored_at = new Date();
            updateFields.stockRestoredQuantity = restoredTotalQuantity;
            stockRestored = true;
          } catch (restoreErr) {
            console.error("[order.js] Failed to restore stock on cancellation:", restoreErr);
          }
        }
      }

      const result = await ordersCol.findOneAndUpdate(
        { invoice_number },
        { $set: updateFields },
        { returnDocument: "after" }
      );

      const updated = result && (result.value !== undefined ? result.value : result);
      if (!updated) {
        return notFound(res, "Order not found");
      }

      return ok(res, {
        message: stockRestored ? `Order cancelled and ${restoredTotalQuantity} item(s) restored to inventory.` : "Order updated successfully",
        order: updated,
        stockRestored
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  // ==========================================
  // DELETE: Delete order
  // ==========================================
  if (req.method === "DELETE") {
    try {
      const body = await parseBody(req);
      const invoice_number = body.invoice_number || req.query?.invoice_number;
      if (!invoice_number) {
        return badRequest(res, "invoice_number is required");
      }

      const result = await ordersCol.deleteOne({ invoice_number });
      if (result.deletedCount === 0) {
        return notFound(res, "Order not found");
      }

      return ok(res, {
        message: `Order ${invoice_number} deleted successfully`
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
};
