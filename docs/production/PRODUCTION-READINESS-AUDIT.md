# Production Readiness Audit & Vulnerability Assessment

**Assessment Level:** Comprehensive (Codebase, Infrastructure, Security, SRE)  
**Target Environment:** Vercel Serverless Production & MongoDB Atlas  
**Audit Date:** 2026-10-24  

---

## 1. Executive Summary & Readiness Verdict

| Category | Status | Risk Level | Highlights |
| :--- | :--- | :--- | :--- |
| **Database & Connectivity** | ⚠️ Action Required | HIGH | Missing IP Whitelist in Atlas produces TLS error; singleton pool is well designed (`maxPoolSize: 2`). |
| **Authentication & AuthZ** | ⚠️ Action Required | MEDIUM | Custom JWT implementation lacks constant-time signature comparison (`crypto.timingSafeEqual`). |
| **API Rate Limiting & Abuse**| ❌ Critical Blocker | CRITICAL | No rate limiting on `/api/checkout` or `/api/auth` (Vulnerable to SMS spam / Brute-force). |
| **CORS Policy** | ⚠️ Action Required | MEDIUM | Wildcard `Access-Control-Allow-Origin: *` set across sensitive admin APIs. |
| **Pathao Courier Webhook** | ⚠️ Action Required | HIGH | Header check lacks constant-time compare; `PATHAO_WEBHOOK_SECRET` optional in some branches. |
| **Build & Static Pipeline** | ✅ Verified Ready | LOW | Build compiles clean 46 products, static HTML, sitemap, and price dictionaries. |
| **Frontend & Variant Stock** | ✅ Verified Ready | LOW | Image gallery fallback and variant cache verified; error boundaries in place. |
| **SEO & Crawlability** | ✅ Verified Ready | LOW | Clean canonical URLs, sitemap.xml, robots.txt, schema markup present. |

---

## 2. Detailed Findings & Evidence

### Critical Severity (Must Fix Before Launch)

#### FINDING-01: Zero Rate Limiting on Public Order Placement (`api/checkout.js`)
* **File:** [`api/checkout.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/checkout.js#L16-L50)
* **Risk:** Abuse, automated spam order generation, inventory denial-of-service (locking up variant stocks), and database flooding.
* **Evidence:** The handler accepts POST requests from any client without IP-based rate limiting, captcha, or proof-of-work. An attacker can exhaust MongoDB storage and simulate fake orders continuously.
* **Remediation:** Implement an in-memory/KV or MongoDB-backed rate limiter on client IP and recipient phone number (e.g., maximum 5 checkout attempts per 15 minutes per IP).

#### FINDING-02: Zero Rate Limiting on Admin Login (`api/auth.js`)
* **File:** [`api/auth.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/auth.js#L58-L92)
* **Risk:** Credential brute-force attacks against single administrator credentials.
* **Evidence:** Single administrative email/password checked on line 83-84 without exponential backoff, account lockout, or request throttling.
* **Remediation:** Enforce maximum 5 failed attempts per 10 minutes per IP with a 15-minute lockout period.

---

### High Severity (Operational & Stability Risks)

#### FINDING-03: MongoDB Atlas IP Access List Handshake Error (TLS Alert 80)
* **File:** [`.env`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/.env#L13), [`api/_db.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_db.js#L30-L47)
* **Risk:** Total application outage on serverless cold starts.
* **Evidence:** `MongoServerSelectionError: ... SSL routines:ssl3_read_bytes:tlsv1 alert internal error (SSL alert number 80)`. This occurs when the MongoDB Atlas cluster (`cluster0.d1jkb5m.mongodb.net`) does not have `0.0.0.0/0` (allow access from anywhere) configured in Network Access, causing Atlas firewalls to abort the TLS handshake.
* **Remediation:** Configure `0.0.0.0/0` in MongoDB Atlas Network Access for Vercel dynamic IP egress, or route through a MongoDB Atlas Private Link / Static IP proxy.

#### FINDING-04: Non-Constant-Time Signature and Secret Checks (Timing Attacks)
* **File:** [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js#L140-L155), [`api/pathao.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/pathao.js#L67)
* **Risk:** Sub-millisecond timing leakage allowing potential HMAC signature forgery or webhook secret brute forcing.
* **Evidence:**
  ```javascript
  // api/_helpers.js
  if (computedSig !== sig) return null;
  // api/pathao.js
  if (!incomingSecret || incomingSecret !== expectedSecret) ...
  ```
* **Remediation:** Replace string equality (`!==`) with `crypto.timingSafeEqual(Buffer.from(...), Buffer.from(...))`.

---

### Medium Severity (Security & Hardening Deficiencies)

#### FINDING-05: Permissive CORS Configuration Across Sensitive Endpoints
* **File:** [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js#L6-L10)
* **Risk:** CSRF, unauthorized cross-origin triggering of endpoints.
* **Evidence:**
  ```javascript
  res.setHeader("Access-Control-Allow-Origin", "*");
  ```
* **Remediation:** Restrict `Access-Control-Allow-Origin` to `process.env.SITE_URL` (or verified domain) for mutating requests (`POST`, `PATCH`, `DELETE`) and admin routes (`api/order.js`, `api/auth.js`).

#### FINDING-06: Unhandled Promise / Database Error Disclosure in API Responses
* **File:** [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js#L66-L70)
* **Risk:** Information disclosure (internal paths, driver versions, collection schemas) exposed to client browsers.
* **Evidence:**
  ```javascript
  function serverError(res, err) {
    console.error("[API Error]", err);
    const message = err && err.message ? err.message : "Internal Server Error";
    return json(res, 500, { success: false, error: message });
  }
  ```
* **Remediation:** In production (`NODE_ENV === 'production'`), sanitize error messages to generic `"An unexpected error occurred. Please try again later."` while maintaining full logging on server logs.

---

### Low Severity & Technical Debt

#### FINDING-07: Untracked Scratch & Temporary Test Files in Workspace
* **Files:** `scratch/*.js`, `audit.js`
* **Risk:** Confusion during continuous integration / deployments if bundled into lambda assets.
* **Remediation:** Ensure `.vercelignore` excludes `scratch/`, test scripts, and internal notes.

#### FINDING-08: Lack of Health Check Route Mapped in Vercel.json
* **File:** [`vercel.json`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/vercel.json#L70)
* **Evidence:** Route `/api/status` is mapped to `/api/inventory?status=true`, which performs a full DB ping and counts documents.
* **Status:** Verified working, but needs an explicit lightweight ping endpoint without aggregate counting for high-frequency uptime monitoring.
