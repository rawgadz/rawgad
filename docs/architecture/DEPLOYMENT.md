# Deployment & Operations

## Hosting and routing
- **Target: Vercel** (`vercel.json`, `npm run dev` = `npx vercel dev`, serverless `api/` convention). Production domain referenced: `rawgadz.com` (`build-sitemap.js:5`, `robots.txt`); a second deployment `notun-rawgadz.vercel.app` is the default `CATALOG_URL` (`lib/catalog.js:8`).
- `vercel.json`: `version:2`, `buildCommand:"npm run build"`, `outputDirectory:"."`, `cleanUrls:true`, `trailingSlash:false`, rewrites and headers (see [API-REFERENCE](API-REFERENCE.md)). Cache headers for `/api/inventory`: `s-maxage=86400, stale-while-revalidate=86400` (`:33-47`).
- Content editing: Pages CMS (`.pages.yml`) commits to the repo. Whether a Vercel Git integration auto-deploys is **unverified** (no CI files in repo).
- Node version: not pinned (`engines` absent, no `.nvmrc`) – **unverified**; code uses global `fetch`/`AbortController` (needs Node ≥18).

## Environment variables (names only)
Defined in `.env.example`; `.env` has all of them populated locally.
| Variable | Used by | Notes |
|---|---|---|
| `MONGO_URI` | `lib/db.js:74`, `seed-inventory.js` | required; function throws if missing |
| `MONGODB_DB` / `MONGO_DB` | `lib/db.js:8`, `checkout.js:319`, `order.js:34`, `inventory.js:45` | optional, default `paystationdemo` (status endpoint displays default `inventory`, inconsistent) |
| `APP_URL` | none found in source reviewed | **unused** in `api/`, `lib/` |
| `COUPON_CODE`, `COUPON_DISCOUNT_PERCENT` | `coupon.js`, `checkout.js` | defaults RAWGADZ10 / 10 |
| `PATHAO_BASE_URL`, `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `PATHAO_STORE_ID` | `api/pathao.js` | secrets except base URL/store id |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `AUTH_SECRET` | `api/auth.js`, `lib/lib.js:139` | **hard-coded fallbacks exist for all four** (`api/auth.js:76-78`, `lib/lib.js:139`) – see review |
| `CATALOG_URL` | `lib/catalog.js:8` | not in `.env.example` |
| `SITE_URL` | `build-sitemap.js:5` | not in `.env.example` |
Config loading: process env first; otherwise `lib/db.js:10-36` parses `.env` from `cwd`, repo root or `lib/` (only runs if `MONGO_URI` is absent).

## Build
`npm run build` (`package.json:19`) executes sequentially, stopping on first failure (`&&`): index → gadgets → hero → products → blog → html-blog → car → html-cars → sitemap. Individual scripts: `build-*` npm scripts (`:6-16`). Side effects: modifies tracked files (`gadgets.html`, JSON, `product/`, `blog/`, `cr/`, `sitemap.xml`, `public/*`) – a deploy-time build mutates the working tree; committed generated output may drift from sources.

## Run / test / deploy (verified from repo)
```
npm install
# local dev (needs Vercel CLI login; runs predev build first)
npm run dev
# build only
npm run build
# seed inventory in MongoDB (needs MONGO_URI)
npm run seed-inventory
```
- **Tests:** there is no `test` script, runner or CI. `scratch/test-*.js` are manual scripts (13 `test`/`debug` files); not run for this report, and some touch the live database (unverified per script).
- **Deploy:** push to the Git branch connected to Vercel, or `vercel --prod` – the repo contains no deploy instructions; this is standard Vercel behaviour, **not repo-verified**.
- First-time setup: set env vars in Vercel, run `seed-inventory` or `POST /api/inventory {"action":"sync"}` as admin to create inventory docs (`stock:0,isAvailable:false`) – otherwise items cannot be purchased (`checkout.js:376-400` requires a doc with stock).

## Runtime constraints
- Serverless cold starts; in-memory caches are per instance (catalog 15 s, Pathao token).
- Mongo pool 10 per instance; Atlas connection limits apply under scale-out.
- `process.cwd()/products.json` must be in the function bundle; otherwise `lib/catalog.js` calls the remote `CATALOG_URL`, and `checkout.js` silently has an empty catalog (`:70-72`). Bundle contents are **unverified**.
- Transactions require a replica set (Atlas provides it).
- Large `GET /api/inventory`/`/api/order` aggregation loads whole collections in memory.

## Operational failure points
1. `MONGO_URI` missing/invalid → all dynamic features 500.
2. Atlas IP allow-list/cold connection > 8 s (`serverSelectionTimeoutMS`).
3. Catalog fetch failure with no local file → inventory sync/list errors (`lib/catalog.js:125`).
4. Pathao credentials/token failure → dispatch 5xx/502; webhook delivery depends on public URL.
5. Stale CDN caching of stock (up to 24 h per `vercel.json`) vs real stock at checkout.
6. Build failure of any one script aborts the chain and the deploy.
7. Third-party CDNs (Tailwind, Alpine, Google Apps Script) are runtime dependencies of the browser pages.
8. No monitoring/alerting/log shipping in repo.
