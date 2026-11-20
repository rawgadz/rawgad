// api/admin-send-sms.js
// POST /api/admin-send-sms — Admin Panel Manual SMS Endpoint via BulkSMSBD

const { setCors, parseBody, json, badRequest, serverError, requireAdminAuth } = require("./_helpers");
const { getOrdersCollection } = require("./_db");
const { sendSms, sendManySms } = require("../lib/smsHelper");

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, { success: false, error: "Method not allowed. Use POST." });
  }

  try {
    // Enforce Admin JWT guard when AUTH_SECRET is configured
    if (process.env.AUTH_SECRET) {
      const adminUser = requireAdminAuth(req, res);
      if (!adminUser) return;
    }

    const body = await parseBody(req);
    const { number, phone, message, messages, invoice_number } = body || {};

    // Support Many-to-Many SMS payload if `messages` array is provided
    if (Array.isArray(messages) && messages.length > 0) {
      const manyResult = await sendManySms(messages);
      if (!manyResult.success) {
        return json(res, 400, {
          success: false,
          code: manyResult.code || null,
          error: manyResult.error || "Failed to send bulk SMS",
          details: manyResult.details || null,
        });
      }
      return json(res, 200, {
        success: true,
        code: manyResult.code,
        message: manyResult.message || "Bulk SMS sent successfully",
      });
    }

    const targetNumber = String(number || phone || "").trim();
    const smsText = typeof message === "string" ? message.trim() : "";

    if (!targetNumber) {
      return badRequest(res, "Recipient phone number is required.");
    }

    if (!smsText) {
      return badRequest(res, "SMS message content cannot be empty.");
    }

    const smsResult = await sendSms(targetNumber, smsText);

    if (!smsResult.success) {
      return json(res, 400, {
        success: false,
        code: smsResult.code || null,
        error: smsResult.error || "Failed to send SMS via BulkSMSBD",
        details: smsResult.details || null,
      });
    }

    // Non-blocking audit log on the order document if invoice_number is provided
    if (invoice_number && String(invoice_number).trim()) {
      try {
        const ordersCol = await getOrdersCollection();
        await ordersCol.updateOne(
          { invoice_number: String(invoice_number).trim() },
          {
            $set: {
              last_sms_sent_at: new Date(),
              updated_at: new Date(),
            },
            $push: {
              sms_history: {
                $each: [
                  {
                    to: targetNumber,
                    message: smsText,
                    code: smsResult.code,
                    type: "admin_manual",
                    sent_at: new Date(),
                  },
                ],
                $slice: -20,
              },
            },
          }
        );
      } catch (dbErr) {
        console.warn("[admin-send-sms] Non-blocking order SMS log warning:", dbErr.message || dbErr);
      }
    }

    return json(res, 200, {
      success: true,
      code: smsResult.code,
      message: smsResult.message || "SMS Submitted Successfully",
    });
  } catch (err) {
    return serverError(res, err);
  }
};
