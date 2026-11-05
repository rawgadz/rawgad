// api/order.js
// Protected Admin Order Operations

const { getOrdersCollection } = require("./_db");
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

    // ==========================================
    // GET: Fetch orders with search and filters
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
      const orders = await ordersCol.find(query).sort({ created_at: -1 }).limit(numLimit).toArray();

      return ok(res, {
        count: orders.length,
        orders
      });
    }

    // ==========================================
    // PATCH / PUT: Update Order Status & Details
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

      const updated = await ordersCol.findOneAndUpdate(
        { invoice_number },
        { $set: updateFields },
        { returnDocument: "after" }
      );

      return ok(res, {
        message: "Order updated successfully",
        order: updated
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
