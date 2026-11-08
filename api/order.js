// api/order.js
// Order Management Operations (Admin & Customer Order Details)

const { getOrdersCollection } = require("./_db");
const {
  setCors,
  parseBody,
  ok,
  badRequest,
  notFound,
  serverError,
  verifyAdminRequest,
  requireAdminAuth,
} = require("./_helpers");

function isOrderInsideDhaka(order) {
  const district = String(
    order?.customer?.district ||
    order?.customer?.jela ||
    ""
  ).trim().toLowerCase();

  if (district) {
    return district === "dhaka" || district.includes("dhaka") || district.includes("ঢাকা");
  }

  const addr = String(
    order?.customer?.full_address ||
    order?.customer?.address_detail ||
    ""
  ).trim().toLowerCase();

  if (addr) {
    return addr.includes("dhaka") || addr.includes("ঢাকা");
  }

  return false;
}

function computeOrderTotals(order) {
  if (!order) return { rawSubtotal: 0, netBase: 0, combinedTotal: 0 };

  let rawSubtotal = null;
  if (order.subtotal !== undefined && order.subtotal !== null && !isNaN(Number(order.subtotal))) {
    rawSubtotal = Number(order.subtotal);
  } else if (Array.isArray(order.items) && order.items.length > 0) {
    rawSubtotal = order.items.reduce((sum, item) => {
      const lineTotal = (item.subtotal !== undefined && !isNaN(Number(item.subtotal)))
        ? Number(item.subtotal)
        : (Number(item.price) || 0) * (Number(item.qty || item.quantity) || 1);
      return sum + lineTotal;
    }, 0);
  } else {
    rawSubtotal = Number(order.payment_amount) || 0;
  }

  rawSubtotal = Math.round(rawSubtotal * 100) / 100;
  const discount = Number(order.discount_amount) || 0;
  const netBase = Math.max(0, Math.round((rawSubtotal - discount) * 100) / 100);
  const deliveryCharge = isOrderInsideDhaka(order) ? 60 : 90;
  const expectedDeliveryInclusive = Math.round((netBase + deliveryCharge) * 100) / 100;

  const storedPaymentAmount = Number(order.payment_amount);
  const combinedTotal =
    !isNaN(storedPaymentAmount) && storedPaymentAmount > netBase
      ? Math.round(storedPaymentAmount * 100) / 100
      : expectedDeliveryInclusive;

  return { rawSubtotal, netBase, combinedTotal };
}

function normalizeOrderRecord(order, isAdmin = true) {
  if (!order) return null;
  const { rawSubtotal, combinedTotal } = computeOrderTotals(order);

  const normalized = {
    ...order,
    subtotal: rawSubtotal,
    payment_amount: combinedTotal,
  };

  delete normalized.delivery_charge;
  delete normalized.shipping_charge;
  delete normalized.pathao_delivery_fee;
  delete normalized.delivery_fee;
  if (normalized.courier && typeof normalized.courier === "object") {
    normalized.courier = { ...normalized.courier };
    delete normalized.courier.delivery_fee;
    if ((normalized.payment_method || "cod").toLowerCase() === "cod") {
      normalized.courier.amount_to_collect = Math.round(combinedTotal);
    }
  }

  if (!isAdmin) {
    return {
      invoice_number: normalized.invoice_number,
      subtotal: normalized.subtotal,
      discount_amount: normalized.discount_amount || 0,
      coupon_code: normalized.coupon_code || null,
      payment_amount: normalized.payment_amount,
      currency: normalized.currency || "BDT",
      payment_method: normalized.payment_method,
      status: normalized.status,
      courier_status: normalized.courier_status || null,
      customer: normalized.customer ? {
        name: normalized.customer.name,
        phone: normalized.customer.phone,
        email: normalized.customer.email,
        full_address: normalized.customer.full_address,
        ...(normalized.customer.district ? { district: normalized.customer.district, jela: normalized.customer.jela || normalized.customer.district } : {}),
        ...(normalized.customer.upazila ? { upazila: normalized.customer.upazila, upozela: normalized.customer.upozela || normalized.customer.upazila } : {}),
        ...(normalized.customer.address_detail ? { address_detail: normalized.customer.address_detail } : {}),
      } : {},
      items: normalized.items || [],
      created_at: normalized.created_at,
      updated_at: normalized.updated_at,
    };
  }

  return normalized;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const ordersCol = await getOrdersCollection();

    // ==========================================
    // GET: Fetch orders with search and filters
    // ==========================================
    if (req.method === "GET") {
      const { invoice_number, search, status, payment_method, courier_status, limit = 200 } = req.query || {};

      // Single-order lookup by invoice_number (supports both customer-facing and admin order details)
      if (invoice_number && String(invoice_number).trim()) {
        let isAdmin = false;
        try {
          isAdmin = Boolean(verifyAdminRequest(req));
        } catch (_) {
          isAdmin = false;
        }

        const singleOrder = await ordersCol.findOne({ invoice_number: String(invoice_number).trim() });
        if (!singleOrder) return notFound(res, "Order not found");

        const normalizedOrder = normalizeOrderRecord(singleOrder, isAdmin);
        return ok(res, {
          count: 1,
          order: normalizedOrder,
          orders: [normalizedOrder],
        });
      }

      const adminUser = requireAdminAuth(req, res);
      if (!adminUser) return;

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
      const rawOrders = await ordersCol.find(query).sort({ created_at: -1 }).limit(numLimit).toArray();
      const orders = rawOrders.map(o => normalizeOrderRecord(o, true));

      return ok(res, {
        count: orders.length,
        orders
      });
    }

    const adminUser = requireAdminAuth(req, res);
    if (!adminUser) return;

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
        if (customer.district || customer.jela) {
          const dist = String(customer.district || customer.jela).trim();
          updateFields["customer.district"] = dist;
          updateFields["customer.jela"] = dist;
        }
        if (customer.upazila || customer.upozela) {
          const upz = String(customer.upazila || customer.upozela).trim();
          updateFields["customer.upazila"] = upz;
          updateFields["customer.upozela"] = upz;
        }
        if (customer.address_detail) {
          updateFields["customer.address_detail"] = String(customer.address_detail).trim();
        }
      }

      const updated = await ordersCol.findOneAndUpdate(
        { invoice_number },
        { $set: updateFields },
        { returnDocument: "after" }
      );

      return ok(res, {
        message: "Order updated successfully",
        order: normalizeOrderRecord(updated, true)
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
