// api/_meta.js
// Reusable Meta Conversions API (CAPI) helper for Rawgadz
// Pixel ID: 1536032983933873

const crypto = require("crypto");
const { makeCanonicalKey } = require("./_catalog");

const DEFAULT_PIXEL_ID = "1536032983933873";
const DEFAULT_API_VERSION = "v21.0";
const PLACEHOLDER_EMAILS = new Set(["noemail@gmail.com", "none@example.com"]);

function sha256Hash(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  // Normalize Bangladesh mobile numbers (01XXXXXXXXX -> 8801XXXXXXXXX)
  if (digits.length === 11 && digits.startsWith("01")) {
    digits = "88" + digits;
  } else if (digits.length === 10 && digits.startsWith("1")) {
    digits = "880" + digits;
  } else if (digits.startsWith("00880")) {
    digits = digits.slice(2);
  }

  if (digits.length < 10) return null;
  return digits;
}

function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  const clean = email.trim().toLowerCase();
  if (!clean || PLACEHOLDER_EMAILS.has(clean)) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return null;
  return clean;
}

function normalizeNameParts(fullName) {
  if (!fullName || typeof fullName !== "string") {
    return { firstName: null, lastName: null };
  }
  const cleaned = fullName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return { firstName: null, lastName: null };
  }

  const parts = cleaned.split(" ").filter(Boolean);
  const firstName = parts[0] || null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { firstName, lastName };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return cookies;
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch (_) {
      cookies[key] = val;
    }
  }
  return cookies;
}

function extractClientIp(req) {
  if (!req) return null;
  const headers = req.headers || {};
  const xff = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  if (typeof xff === "string" && xff.trim()) {
    const firstIp = xff.split(",")[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = headers["x-real-ip"] || headers["X-Real-IP"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  const remoteAddr = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (typeof remoteAddr === "string" && remoteAddr.trim()) {
    return remoteAddr.trim();
  }
  return null;
}

function extractUserAgent(req) {
  if (!req || !req.headers) return null;
  const ua = req.headers["user-agent"] || req.headers["User-Agent"];
  return typeof ua === "string" && ua.trim() ? ua.trim() : null;
}

function buildUserData({ customer = {}, req = null, fbp = null, fbc = null } = {}) {
  const userData = {};

  // 1. Phone (SHA-256 hashed)
  const normPhone = normalizePhone(customer.phone);
  if (normPhone) {
    userData.ph = [sha256Hash(normPhone)];
  }

  // 2. Email (SHA-256 hashed, only if real customer email is present)
  const normEmail = normalizeEmail(customer.email);
  if (normEmail) {
    userData.em = [sha256Hash(normEmail)];
  }

  // 3. First & Last Name (SHA-256 hashed)
  const { firstName, lastName } = normalizeNameParts(customer.name);
  if (firstName) {
    userData.fn = [sha256Hash(firstName)];
  }
  if (lastName) {
    userData.ln = [sha256Hash(lastName)];
  }

  // 4. Unhashed browser/request parameters (NEVER hash IP, UA, _fbp, _fbc)
  const clientIp = extractClientIp(req);
  if (clientIp) {
    userData.client_ip_address = clientIp;
  }

  const userAgent = extractUserAgent(req);
  if (userAgent) {
    userData.client_user_agent = userAgent;
  }

  const cookies = parseCookies(req?.headers?.cookie || req?.headers?.Cookie);
  const resolvedFbp = (typeof fbp === "string" && fbp.trim()) ? fbp.trim() : (cookies._fbp || null);
  const resolvedFbc = (typeof fbc === "string" && fbc.trim()) ? fbc.trim() : (cookies._fbc || null);

  if (resolvedFbp) {
    userData.fbp = resolvedFbp;
  }
  if (resolvedFbc) {
    userData.fbc = resolvedFbc;
  }

  return userData;
}

function buildPurchaseCustomData(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const contentIds = [];
  const contents = [];
  let numItems = 0;

  for (const item of items) {
    const canonicalId = item.canonicalKey || makeCanonicalKey(item.productId || item.id, item.typeId, item.subProductId);
    const qty = Number(item.qty || item.quantity || 1);
    const unitPrice = Math.round((Number(item.price) || 0) * 100) / 100;

    contentIds.push(canonicalId);
    contents.push({
      id: canonicalId,
      quantity: qty,
      item_price: unitPrice,
    });
    numItems += qty;
  }

  const value = Math.round((Number(order?.payment_amount) || 0) * 100) / 100;

  return {
    content_ids: contentIds,
    contents,
    content_type: "product",
    value,
    currency: "BDT",
    num_items: numItems,
    order_id: String(order?.invoice_number || ""),
  };
}

function resolveEventSourceUrl(req, explicitUrl) {
  if (typeof explicitUrl === "string" && /^https?:\/\//i.test(explicitUrl.trim())) {
    return explicitUrl.trim();
  }
  const referer = req?.headers?.referer || req?.headers?.Referer;
  if (typeof referer === "string" && /^https?:\/\//i.test(referer.trim())) {
    return referer.trim();
  }
  const siteUrl = (process.env.SITE_URL || "https://rawgadzfinal.vercel.app").replace(/\/+$/, "");
  return `${siteUrl}/checkout.html`;
}

function buildPurchaseEventPayload({ order, eventId, req = null, eventSourceUrl = null, fbp = null, fbc = null } = {}) {
  const resolvedEventId = String(eventId || order?.invoice_number || "").trim();
  const customData = buildPurchaseCustomData(order);
  const userData = buildUserData({
    customer: order?.customer || {},
    req,
    fbp,
    fbc,
  });

  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: resolvedEventId,
    action_source: "website",
    event_source_url: resolveEventSourceUrl(req, eventSourceUrl),
    user_data: userData,
    custom_data: customData,
  };
}

async function sendCapiEvent(eventPayload, options = {}) {
  const eventId = eventPayload?.event_id || "unknown";
  const eventName = eventPayload?.event_name || "UnknownEvent";
  const pixelId = (options.pixelId || process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID).trim();
  const accessToken = (options.accessToken || process.env.META_ACCESS_TOKEN || "").trim();
  const apiVersion = (options.apiVersion || process.env.META_GRAPH_API_VERSION || DEFAULT_API_VERSION).trim();
  const fetchImpl = options.fetchImpl || global.fetch;

  if (!accessToken) {
    console.warn(`[Meta CAPI] META_ACCESS_TOKEN not configured; skipping ${eventName} delivery for event_id=${eventId}.`);
    return {
      success: false,
      sent: false,
      status: "skipped_no_token",
      event_id: eventId,
    };
  }

  if (typeof fetchImpl !== "function") {
    console.warn(`[Meta CAPI] fetch is unavailable in runtime for event_id=${eventId}.`);
    return {
      success: false,
      sent: false,
      status: "failed_no_fetch",
      event_id: eventId,
    };
  }

  const endpoint = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pixelId)}/events`;
  const requestBody = {
    data: [eventPayload],
    access_token: accessToken,
  };

  const testEventCode = (options.testEventCode || process.env.META_TEST_EVENT_CODE || "").trim();
  if (testEventCode) {
    requestBody.test_event_code = testEventCode;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = Number(options.timeoutMs) || 4000;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller ? controller.signal : undefined,
    });

    const respData = await response.json().catch(() => ({}));

    if (!response.ok) {
      const safeErrorMsg = respData?.error?.message || `HTTP ${response.status}`;
      console.error(`[Meta CAPI] Delivery failed for event_id=${eventId}: ${safeErrorMsg}`);
      return {
        success: false,
        sent: false,
        status: "failed",
        event_id: eventId,
        error: safeErrorMsg,
      };
    }

    return {
      success: true,
      sent: true,
      status: "sent",
      event_id: eventId,
      events_received: respData?.events_received || 1,
    };
  } catch (err) {
    const safeMsg = err && err.name === "AbortError"
      ? "Meta CAPI request timed out"
      : (err && err.message ? err.message : "Network error");
    console.error(`[Meta CAPI] Exception sending event_id=${eventId}: ${safeMsg}`);
    return {
      success: false,
      sent: false,
      status: "failed",
      event_id: eventId,
      error: safeMsg,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function trackServerPurchase({ order, eventId, req = null, eventSourceUrl = null, fbp = null, fbc = null, options = {} } = {}) {
  try {
    if (!order || !order.invoice_number) {
      return { success: false, sent: false, status: "invalid_order" };
    }
    const resolvedEventId = String(eventId || order.invoice_number).trim();
    const payload = buildPurchaseEventPayload({
      order,
      eventId: resolvedEventId,
      req,
      eventSourceUrl,
      fbp,
      fbc,
    });
    const result = await sendCapiEvent(payload, options);
    return {
      ...result,
      payload_summary: {
        event_name: payload.event_name,
        event_id: payload.event_id,
        value: payload.custom_data.value,
        currency: payload.custom_data.currency,
        num_items: payload.custom_data.num_items,
        content_ids: payload.custom_data.content_ids,
        contents: payload.custom_data.contents,
        content_type: payload.custom_data.content_type,
        order_id: payload.custom_data.order_id,
      },
    };
  } catch (err) {
    console.error("[Meta CAPI] Unexpected error in trackServerPurchase:", err && err.message ? err.message : err);
    return {
      success: false,
      sent: false,
      status: "failed",
      event_id: String(eventId || order?.invoice_number || ""),
    };
  }
}

module.exports = {
  DEFAULT_PIXEL_ID,
  sha256Hash,
  normalizePhone,
  normalizeEmail,
  normalizeNameParts,
  parseCookies,
  extractClientIp,
  extractUserAgent,
  buildUserData,
  buildPurchaseCustomData,
  buildPurchaseEventPayload,
  sendCapiEvent,
  trackServerPurchase,
};
