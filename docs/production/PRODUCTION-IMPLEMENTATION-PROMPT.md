# Production Implementation Prompt: Rawgadz Platform

> **Instructions for the AI Coding Agent:**  
> You are acting as the Lead Production Engineer assigned to execute the production-hardening of the **Rawgadz Platform**.  
> You must follow every constraint, rule, and phase defined below without deviating or introducing breaking changes.

---

## 1. Project Context & Verified Technology Stack

* **Project Name:** Rawgadz E-Commerce Platform
* **Architecture:** Hybrid Static Site Generation (SSG) + Vercel Serverless Functions (Node.js CommonJS).
* **Database:** MongoDB Atlas (M0 Shared Tier), capped connection pool (`maxPoolSize: 2`).
* **Content Engine:** Git-backed Markdown (`content/product/*.md`, `content/blog/*.md`, `content/cars/*.md`) compiled via `npm run build` using custom Node.js scripts into `data/*.json` and static HTML (`product/*.html`).
* **Frontend:** Alpine.js (`v3.x`), Tailwind CSS, vanilla client-side libraries (`js/stock.js`, `js/bd-locations.js`).
* **Fulfillment:** Pathao Courier Aladdin API (`api/pathao.js`) with manual bKash/Nagad/COD payment workflows.

---

## 2. Core Implementation Rules

1. **Preserve Existing User Journeys:** Do not rewrite the frontend stack, do not migrate to Next.js/Nuxt, and do not alter the established customer checkout experience.
2. **Strict Authority on Pricing & Stocks:** Never trust client-side prices or stock counts. All financial calculations must resolve against server-side `data/price.json`, `content/coupons.json`, and MongoDB transactions.
3. **No Credential Exposure:** Never log, echo, commit, or print credentials or API secrets. Always read from `process.env`.
4. **No Mocking in Production Files:** Never introduce placeholder returns or hardcoded test mocks into `api/` or `build/` files.
5. **Atomic, Phased Execution:** Complete and test one phase at a time. Run tests and verify before proceeding to the next phase.

---

## 3. Verified Codebase Map & Critical Files

* **Database Connection:** [`api/_db.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_db.js) - MongoDB singleton connection pool.
* **Serverless Helpers:** [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js) - CORS, body parsing, JWT sign/verify, sanitization.
* **Admin Authentication:** [`api/auth.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/auth.js) - Admin login, token issuance.
* **Storefront Checkout:** [`api/checkout.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/checkout.js) - Order validation, stock lock, invoice generation.
* **Inventory Service:** [`api/inventory.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/inventory.js) - Merges MongoDB stock with `data/products.json`.
* **Courier Integration:** [`api/pathao.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/pathao.js) - Pathao Aladdin token, dispatch, webhook.
* **Order Management:** [`api/order.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/order.js) - Protected order queries and status mutations.
* **Build Pipeline:** [`build/build-products.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/build/build-products.js) - Compiles products to static pages and price index.
* **Client Stock Cache:** [`js/stock.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/js/stock.js) - Client-side inventory caching and DOM update events.
* **Vercel Routing:** [`vercel.json`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/vercel.json) - Rewrites, function includes, security headers.

---

## 4. Prioritized Execution Tasks

### Phase 1: Security Hardening (Immediate)
1. **Timing-Safe Token & Secret Comparison:**
   - In [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js), replace string equality checks in `verifyToken()` with `crypto.timingSafeEqual()`. Handle differing buffer lengths safely by checking byte lengths before calling `timingSafeEqual`.
   - In [`api/pathao.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/pathao.js), update `handlePathaoWebhook()` to compare `x-pathao-secret` using constant-time comparison.
2. **CORS Tightening:**
   - In [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js) `setCors()`, only allow wildcard `*` for read-only `GET /api/inventory`. For state-mutating requests (`POST`, `PATCH`, `DELETE`) and admin routes, match against `process.env.SITE_URL` and `http://localhost:*` (dev mode). Reject unauthorized origins.

### Phase 2: Anti-Abuse & Rate Limiting
1. **Checkout & Auth Rate Limiting:**
   - Create an in-memory/MongoDB-backed rate limiter utility (`api/_rate_limiter.js`).
   - Wrap `POST /api/checkout` to throttle requests: maximum 5 requests per 15 minutes per IP. Return `429 Too Many Requests` on breach.
   - Wrap `POST /api/auth` login: maximum 5 attempts per 10 minutes per IP with exponential lockout.

### Phase 3: Error Sanitization & Operational Safety
1. **Production Error Masking:**
   - In `serverError()` in [`api/_helpers.js`](file:///C:/Users/victus/Documents/rawgadz_delivery_seo_sec_dev/rawgadz_final/api/_helpers.js), inspect `process.env.NODE_ENV`. If `production`, return `{ success: false, error: "An unexpected error occurred. Please contact support." }` instead of raw database/driver error messages.
2. **Lightweight Uptime Health Check:**
   - Add a lightweight `GET /api/health` handler (or route in `api/inventory.js`) that performs a simple non-aggregating ping suitable for Pingdom / UptimeRobot.

### Phase 4: Verification & Test Suite Execution
1. Execute the comprehensive test harness:
   ```bash
   node --env-file=.env test-suite.js
   ```
2. Verify all 5 core checks pass:
   - Database ping
   - Inventory endpoint catalog merge
   - Static build compilation
   - Stock cache and Alpine store sync
   - Checkout coupon & price tampering validation

---

## 5. Verification Checklist for Production Sign-Off

- [ ] All 46 product markdown files compile cleanly to `data/products.json` and `product/*.html`.
- [ ] Cart checkout calculates pricing strictly from `data/price.json`.
- [ ] Coupons from `content/coupons.json` reject invalid/expired codes with HTTP 400.
- [ ] Admin operations require valid JWT signatures.
- [ ] Pathao webhook enforces constant-time secret validation.
- [ ] Rate limiter blocks spam checkout and brute-force attempts.
- [ ] MongoDB Atlas Network Access permits Vercel runtime connectivity (`0.0.0.0/0`).
- [ ] Production error responses do not leak internal system traces.
