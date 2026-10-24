// api/order.js
// Protected Admin Order Operations
// Uses fast MongoDB aggregate pipeline and reliable variant stock restoration

const { getOrdersCollection, getInventoryCollection } = require("./_db");
const {
  setCors,
  parseBody,
  ok,
  badRequest,
  notFound,
  serverError,
  requireAdminAuth,
} = require("./_helpers");

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const adminUser = requireAdminAuth(req, res);
  if (!adminUser) return;

  try {
    const ordersCol = await getOrdersCollection();
    const inventoryCol = await getInventoryCollection();

    // ==========================================
    // GET: Fetch orders with aggregate metrics
    // ==========================================
    if (req.method === "GET") {
      const { search, status, payment_method, courier_status, limit = 200 } = req.query || {};
      const query = {};

      if (status && status !== "all") query.status = status;
      if (payment_method && payment_method !== "all") query.payment_method = payment_method.toLowerCase();
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

      const [orders, metricsResult] = await Promise.all([
        ordersCol.find(query).sort({ created_at: -1 }).limit(numLimit).toArray(),
        ordersCol.aggregate([
          {
            $facet: {
              total: [{ $count: "count" }],
              revenue: [
                {
                  $match: {
                    $or: [
                      { status: "success" },
                      { status: "delivered" },
                      { payment_method: "cod" },
                      { verified: true }
                    ]
                  }
                },
                { $group: { _id: null, total: { $sum: "$payment_amount" } } }
              ],
              dispatched: [
                { $match: { courier_status: { $in: ["dispatched", "in_transit"] } } },
                { $count: "count" }
              ],
              delivered: [
                { $match: { $or: [{ courier_status: "delivered" }, { status: "delivered" }] } },
                { $count: "count" }
              ],
              pendingDispatch: [
                {
                  $match: {
                    courier_status: { $nin: ["dispatched", "in_transit", "delivered"] },
                    status: { $nin: ["cancelled", "failed", "delivered"] }
                  }
                },
                { $count: "count" }
              ],
              pendingPayment: [
                {
                  $match: {
                    payment_method: { $ne: "cod" },
                    verified: { $ne: true },
                    status: { $nin: ["success", "delivered", "cancelled", "failed"] }
                  }
                },
                { $count: "count" }
              ]
            }
          }
        ]).toArray()
      ]);

      const facet = metricsResult[0] || {};
      const metrics = {
        totalOrders: facet.total?.[0]?.count || 0,
        totalRevenue: Math.round((facet.revenue?.[0]?.total || 0) * 100) / 100,
        pendingDispatch: facet.pendingDispatch?.[0]?.count || 0,
        pendingPayment: facet.pendingPayment?.[0]?.count || 0,
        dispatchedCount: facet.dispatched?.[0]?.count || 0,
        deliveredCount: facet.delivered?.[0]?.count || 0
      };

      return ok(res, {
        count: orders.length,
        orders,
        metrics
      });
    }

    // ==========================================
    // PATCH / PUT: Update Order & Restore Stock
    // ==========================================
    if (req.method === "PATCH" || req.method === "PUT") {
      const body = await parseBody(req);
      const { invoice_number, status, verified, trx_status, courier_status, admin_notes, customer } = body;

      if (!invoice_number) return badRequest(res, "invoice_number is required");

      const existingOrder = await ordersCol.findOne({ invoice_number });
      if (!existingOrder) return notFound(res, "Order not found");

      const updateFields = { updated_at: new Date() };

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

      const normNewStatus = String(status || "").toLowerCase().trim();
      const isCancellingOrReturning = normNewStatus === "cancelled" || normNewStatus === "returned";
      let stockRestored = false;
      let restoredTotalQuantity = 0;

      if (isCancellingOrReturning && !existingOrder.stockRestored && existingOrder.status !== "cancelled" && existingOrder.status !== "returned") {
        const rawItems = Array.isArray(existingOrder.items) ? existingOrder.items : [];

        for (const item of rawItems) {
          const qty = parseInt(item.qty || item.quantity || 1, 10);
          if (qty > 0 && item.productId) {
            const filter = {
              productId: String(item.productId).trim(),
              typeId: item.typeId ? String(item.typeId).trim() : null,
              subProductId: item.subProductId ? String(item.subProductId).trim() : null,
              stockMode: "quantity"
            };

            await inventoryCol.updateOne(
              filter,
              { $inc: { stock: qty }, $set: { updatedAt: new Date() } }
            );
            restoredTotalQuantity += qty;
          }
        }

        updateFields.stockRestored = true;
        updateFields.stockRestoredAt = new Date();
        updateFields.stockRestoredQuantity = restoredTotalQuantity;
        stockRestored = true;
      }

      const updated = await ordersCol.findOneAndUpdate(
        { invoice_number },
        { $set: updateFields },
        { returnDocument: "after" }
      );

      return ok(res, {
        message: stockRestored
          ? `Order updated and ${restoredTotalQuantity} item(s) restored to inventory.`
          : "Order updated successfully",
        order: updated,
        stockRestored
      });
    }

    // ==========================================
    // DELETE: Delete Order
    // ==========================================
    if (req.method === "DELETE") {
      const body = await parseBody(req);
      const invoice_number = body.invoice_number || req.query?.invoice_number;
      if (!invoice_number) return badRequest(res, "invoice_number is required");

      const result = await ordersCol.deleteOne({ invoice_number });
      if (result.deletedCount === 0) return notFound(res, "Order not found");

      return ok(res, { message: `Order ${invoice_number} deleted successfully` });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err) {
    return serverError(res, err);
  }
};
