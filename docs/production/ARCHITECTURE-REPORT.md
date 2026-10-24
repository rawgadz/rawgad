# Architecture & Data Flow Analysis: Rawgadz Platform

**Document Version:** 1.0  
**Target Platform:** Vercel Serverless + MongoDB Atlas M0 + Cloudinary CDN + Pathao Courier Aladdin API  
**Analysis Date:** 2026-10-24  

---

## 1. Executive Summary & Verified Technology Stack

Rawgadz is a production hybrid static/serverless e-commerce platform specifically tailored for the Bangladeshi automobile accessories market, operating with Cash on Delivery (COD), bKash, and Nagad manual verification, integrated with Pathao Courier Aladdin API for automated fulfillment.

### Verified Technology Stack
* **Runtime & Package Engine:** Node.js v22 (Active in workspace), npm, CommonJS modules.
* **Hosting & Compute:** Vercel Serverless Functions (`api/*.js` mapped via `vercel.json`).
* **Database:** MongoDB Atlas (M0 Shared Tier), official Node.js driver (`mongodb: ^6.3.0`).
* **Build Pipeline & SSG:** Custom Node.js compilation scripts (`build/*.js`) converting Markdown source content (`content/**/*.md`) into static JSON data stores (`data/*.json`), standalone HTML detail views (`product/*.html`, `blog/*.html`, `cr/*.html`), and sitemaps (`sitemap.xml`).
* **Frontend Framework & Scripting:** Vanilla HTML5, Tailwind CSS (via CDN/static styles), Alpine.js (`v3.x`) for lightweight reactive UI components, vanilla client scripts (`js/stock.js`, `js/hero-slider.js`, `js/bd-locations.js`).
* **CMS & Content Management:** Pages CMS (`.pages.yml`) parsing and authoring Git-backed Markdown collections.

---

## 2. Verified Directory Structure

```
rawgadz_final/
├── api/                   # Vercel Serverless Functions (Node.js CommonJS)
│   ├── _catalog.js        # Single source of truth for products and pricing (data/products.json)
│   ├── _db.js             # Mongo connection singleton, connection pool limits (maxPoolSize: 2)
│   ├── _helpers.js        # Security headers, CORS, JWT signing/verification, input sanitisation
│   ├── auth.js            # Admin authentication, token exchange, session check
│   ├── checkout.js        # Order creation, server-side price validation, stock lock
│   ├── inventory.js       # Live catalog merge, variant inventory query and mutations
│   ├── order.js           # Admin order management, metrics aggregation, status transitions
│   └── pathao.js          # Courier order creation, consignment tracking, webhook receiver
├── build/                 # Static Site Generation (SSG) & Seeding Pipelines
│   ├── build-blog.js      # Compiles content/blog/*.md -> data/blog.json
│   ├── build-car.js       # Compiles content/cars/*.md -> data/cars.json
│   ├── build-gadgets.js   # Compiles gadget metadata -> data/gadgets.json
│   ├── build-hero.js      # Compiles hero slider slides -> data/hero.json
│   ├── build-html-blog.js # Generates static blog/*.html
│   ├── build-html-cars.js # Generates static cr/*.html
│   ├── build-index.js     # Compiles index showcase -> data/index.json
│   ├── build-products.js  # Compiles content/product/*.md -> data/products.json, data/price.json, product/*.html
│   ├── build-sitemap.js   # Indexes 61+ routes -> sitemap.xml
│   └── seed-inventory.js  # Idempotently establishes unique compound indexes and seeds inventory
├── content/               # Git-backed Markdown Content Collections (Pages CMS)
│   ├── blog/              # Blog posts
│   ├── cars/              # Vehicle guides and accessories
│   ├── hero/              # Hero carousel promotions
│   ├── product/           # 46 product markdown definitions
│   └── coupons.json       # Promotion codes and discount rules
├── data/                  # Compiled JSON Datastores (Read at runtime by APIs)
├── docs/                  # Architectural documentation and production guides
├── js/                    # Client-side libraries
│   ├── bd-locations.js    # Bangladesh District, City, and Thana mappings for Pathao
│   ├── hero-slider.js     # Homepage promo slider logic
│   └── stock.js           # Client-side 20-second stock cache, Alpine.js inventory integration
├── product/               # 46 SSG generated product detail pages
├── admin.html             # Protected Admin Dashboard SPA
├── checkout.html          # Storefront Multi-step Checkout & Cart Review
├── index.html             # Storefront Main Homepage
├── gadgets.html           # Storefront Gadget & Utility Catalog
├── inventory.html         # Admin Live Inventory & Stock Controller
├── login.html             # Admin Secure Access Portal
├── order.html             # Admin Order Management & Courier Dispatch Console
├── sitemap.xml            # Search Engine Crawl Index
└── vercel.json            # Vercel Function routing, rewrites, and security headers
```

---

## 3. Core Architectural Subsystems & Data Flows

### Subsystem A: Content Compilation (MD -> JSON -> HTML)
```
content/product/*.md  ──┐
content/blog/*.md     ──┼──> npm run build (build/*.js) ──> data/*.json & product/*.html
content/coupons.json  ──┘                                  (SSG static generation)
```
1. `build-products.js` processes YAML frontmatter via `gray-matter`, parses Markdown via `marked`.
2. Normalizes variant hierarchies (`types` -> `subProducts`) and computes canonical keys:
   `productId:::typeId:::subProductId`.
3. Compiles `data/products.json` (catalog representation) and `data/price.json` (immutable price lookup table).
4. Generates static standalone HTML pages in `product/` with embedded Alpine.js reactive components.

### Subsystem B: Live Inventory & Variant Stock Synchronization
```
Browser (stock.js) ──> GET /api/inventory ──> MongoDB (inventory) + data/products.json
                              │
                    Caches in localStorage (TTL: 20s)
                    Dispatches 'rawgad-stock-updated'
```
1. `api/inventory.js` reads documents from MongoDB Atlas `inventory` collection.
2. Cross-references documents with `data/products.json` using `api/_catalog.js`.
3. In-memory joins augment catalog data with real-time stock numbers and stock modes (`quantity` vs `unlimited`).
4. Client-side `js/stock.js` fetches stock asynchronously, updating UI badges without delaying page render.

### Subsystem C: Storefront Order Placement & Anti-Tamper Checkout
```
Customer ──> POST /api/checkout ──> Server-Side Validation:
                                      ├── Strict Coupon Check (content/coupons.json)
                                      ├── Price Verification (data/price.json)
                                      ├── MongoDB Transaction Stock Decrement
                                      └── Insertion into MongoDB orders collection
```
1. Customer submits cart and recipient details via `checkout.html`.
2. Server validates name, address, and Bangladeshi mobile number (`01XXXXXXXXX`).
3. Re-calculates cart prices strictly using server-side `data/price.json` (client prices are discarded).
4. Validates coupon against `content/coupons.json` (active status and uppercase match).
5. Begins MongoDB transaction or atomic `findOneAndUpdate` with `{ stock: { $gte: item.qty } }` to prevent negative stock over-selling.
6. Creates order in `orders` collection with status `pending`, returning `invoice_number`.

### Subsystem D: Protected Admin Management & Courier Dispatch
```
Admin ──> POST /api/auth (JWT issue) ──> Stores in localStorage
Admin ──> POST /api/pathao (action=create_order) ──> Signs request with Pathao Aladdin OAuth token
                                                ──> Receives Consignment ID & Tracking Code
                                                ──> Updates Order in MongoDB
```
1. Admin authenticates at `login.html` via `api/auth.js`. Server checks `ADMIN_EMAIL` and `ADMIN_PASSWORD` (HMAC-SHA256 session token issued).
2. Token passed in `Authorization: Bearer <token>` or `X-Admin-Token` header.
3. Protected operations in `api/order.js` and `api/pathao.js` enforce `requireAdminAuth()`.
4. Order dispatch to Pathao calls Aladdin REST API using cached OAuth bearer tokens.

---

## 4. Key Architectural Strengths
1. **Zero-Database SSG Speed:** Storefront catalog browsing (homepage, gadgets, product details) requires zero database queries. TTFB is backed by Vercel Edge CDN.
2. **Strict Server-Side Price Authority:** Client-side cart tampering is prevented because checkout recalculates totals using `data/price.json`.
3. **Optimized M0 Free Tier Footprint:** MongoDB connection pooling strictly throttled (`maxPoolSize: 2`) with short idle timeouts, preventing Atlas connection exhaustion across serverless lambdas.
4. **Resilient Offline Stock Fallback:** Frontend `stock.js` degrades gracefully to stale local storage if the inventory API encounters network drops.
