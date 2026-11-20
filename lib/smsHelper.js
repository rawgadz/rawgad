// lib/smsHelper.js
// Reusable BulkSMSBD Gateway Helper (Single & Many-to-Many SMS APIs)
// Uses native Node 18+ fetch and reads credentials from environment variables.

const BULKSMSBD_SINGLE_URL = "https://bulksmsbd.net/api/smsapi";
const BULKSMSBD_MANY_URL = "https://bulksmsbd.net/api/smsapimany";

/**
 * BulkSMSBD API Response Codes Reference
 */
const BULKSMSBD_ERROR_CODES = {
  202: "SMS Submitted Successfully",
  1002: "Sender ID not correct or disabled",
  1003: "Required fields missing",
  1005: "Internal Error",
  1006: "Balance Validity Not Available",
  1007: "Balance Insufficient",
  1011: "User ID not found",
  1012: "Masking SMS must be sent in Bengali",
  1031: "Account Not Verified",
  1032: "IP Not whitelisted",
};

/**
 * Formats a Bangladeshi phone number (or comma-separated list of numbers)
 * into BulkSMSBD's standard 8801XXXXXXXXX format.
 *
 * @param {string} rawNumber
 * @returns {string}
 */
function formatBdPhone(rawNumber) {
  if (!rawNumber) return "";

  return String(rawNumber)
    .split(",")
    .map((part) => {
      let digits = part.trim().replace(/[^0-9]/g, "");
      if (!digits) return "";

      if (digits.startsWith("00880")) {
        digits = digits.slice(2);
      } else if (digits.startsWith("01") && digits.length === 11) {
        digits = "88" + digits;
      } else if (digits.length === 10 && digits.startsWith("1")) {
        digits = "880" + digits;
      }

      return digits;
    })
    .filter(Boolean)
    .join(",");
}

/**
 * Parses the raw response from BulkSMSBD and maps response codes to structured results.
 *
 * @param {object|string} rawData
 * @returns {{ success: boolean, code: number|null, message?: string, error?: string, raw?: any }}
 */
function parseBulkSmsResponse(rawData) {
  let parsed = rawData;
  if (typeof rawData === "string") {
    try {
      parsed = JSON.parse(rawData);
    } catch (_) {
      const codeMatch = rawData.match(/\b(202|1002|1003|1005|1006|1007|1011|1012|1031|1032)\b/);
      if (codeMatch) {
        parsed = { response_code: Number(codeMatch[1]), success_message: rawData };
      } else {
        return {
          success: false,
          code: null,
          error: rawData || "Unexpected response from BulkSMSBD gateway",
          raw: rawData,
        };
      }
    }
  }

  const rawCode = parsed?.response_code ?? parsed?.code ?? parsed?.status_code ?? null;
  const code = rawCode !== null && rawCode !== undefined ? Number(rawCode) : null;

  if (code === 202) {
    return {
      success: true,
      code: 202,
      message: parsed?.success_message || BULKSMSBD_ERROR_CODES[202],
      raw: parsed,
    };
  }

  if (code && BULKSMSBD_ERROR_CODES[code]) {
    return {
      success: false,
      code,
      error: BULKSMSBD_ERROR_CODES[code],
      details: parsed?.error_message || parsed?.message || null,
      raw: parsed,
    };
  }

  return {
    success: false,
    code,
    error:
      parsed?.error_message ||
      parsed?.message ||
      "Failed to send SMS via BulkSMSBD",
    raw: parsed,
  };
}

/**
 * Sends a single SMS (One-to-One or One-to-Many) via BulkSMSBD Single SMS API.
 *
 * @param {string} number - Recipient phone number(s), e.g. "017XXXXXXXX" or "88017XXXXXXXX,88019XXXXXXXX"
 * @param {string} message - SMS text body
 * @returns {Promise<{ success: boolean, code?: number|null, message?: string, error?: string, skipped?: boolean, raw?: any }>}
 */
async function sendSms(number, message) {
  const apiKey = (process.env.BULKSMSBD_API_KEY || "").trim();
  const senderId = (process.env.BULKSMSBD_SENDER_ID || "").trim();

  if (!apiKey || !senderId) {
    return {
      success: false,
      skipped: true,
      code: null,
      error:
        "BulkSMSBD credentials are not configured (missing BULKSMSBD_API_KEY or BULKSMSBD_SENDER_ID in environment variables).",
    };
  }

  const formattedNumber = formatBdPhone(number);
  const cleanMessage = typeof message === "string" ? message.trim() : "";

  if (!formattedNumber || !cleanMessage) {
    return {
      success: false,
      code: 1003,
      error: BULKSMSBD_ERROR_CODES[1003],
    };
  }

  const payload = {
    api_key: apiKey,
    senderid: senderId,
    number: formattedNumber,
    message: cleanMessage,
  };

  try {
    const response = await fetch(BULKSMSBD_SINGLE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    return parseBulkSmsResponse(text);
  } catch (err) {
    console.error("[smsHelper] Network or fetch error:", err);
    return {
      success: false,
      code: 1005,
      error: err && err.message ? `SMS gateway request failed: ${err.message}` : BULKSMSBD_ERROR_CODES[1005],
    };
  }
}

/**
 * Sends personalized messages to multiple recipients via BulkSMSBD Many-to-Many API.
 *
 * @param {Array<{ to: string, message: string }>} messages
 * @returns {Promise<{ success: boolean, code?: number|null, message?: string, error?: string, skipped?: boolean, raw?: any }>}
 */
async function sendManySms(messages) {
  const apiKey = (process.env.BULKSMSBD_API_KEY || "").trim();
  const senderId = (process.env.BULKSMSBD_SENDER_ID || "").trim();

  if (!apiKey || !senderId) {
    return {
      success: false,
      skipped: true,
      code: null,
      error:
        "BulkSMSBD credentials are not configured (missing BULKSMSBD_API_KEY or BULKSMSBD_SENDER_ID in environment variables).",
    };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      success: false,
      code: 1003,
      error: BULKSMSBD_ERROR_CODES[1003],
    };
  }

  const formattedMessages = messages
    .map((item) => ({
      to: formatBdPhone(item?.to || item?.number || ""),
      message: typeof item?.message === "string" ? item.message.trim() : "",
    }))
    .filter((item) => item.to && item.message);

  if (formattedMessages.length === 0) {
    return {
      success: false,
      code: 1003,
      error: BULKSMSBD_ERROR_CODES[1003],
    };
  }

  const payload = {
    api_key: apiKey,
    senderid: senderId,
    messages: formattedMessages,
  };

  try {
    const response = await fetch(BULKSMSBD_MANY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    return parseBulkSmsResponse(text);
  } catch (err) {
    console.error("[smsHelper] Many-SMS network or fetch error:", err);
    return {
      success: false,
      code: 1005,
      error: err && err.message ? `SMS gateway request failed: ${err.message}` : BULKSMSBD_ERROR_CODES[1005],
    };
  }
}

module.exports = sendSms;
module.exports.sendSms = sendSms;
module.exports.sendManySms = sendManySms;
module.exports.formatBdPhone = formatBdPhone;
module.exports.parseBulkSmsResponse = parseBulkSmsResponse;
module.exports.BULKSMSBD_ERROR_CODES = BULKSMSBD_ERROR_CODES;
