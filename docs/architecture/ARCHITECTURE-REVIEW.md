# Architecture Review

Severity = impact × likelihood as evidenced in code. **[V]** verified in source, **[P]** potential/depends on runtime state, **[R]** recommendation. Terms follow the repo's `improve-codebase-architecture` skill (module, interface, depth, seam, locality); no rewrite is recommended.

## Strengths
- Simple, cheap, cacheable architecture; SEO-friendly pre-rendered pages and sitemap.
- Checkout validates server-side and decrements stock atomically with a `$gte` guard inside a transaction (`api/checkout.js:336-405`); unique compound inventory index (`lib/db.js:53`).
- Admin guard applied to all order operations and inventory mutations; regex input escaped in order search (`api/order.js:78`).
- Reused Mongo client across warm invocations with sane timeouts (`lib/db.js:79-91`).
- Duplicate-dispatch protection for courier bookings (`api/pathao.js:304-312`); idempotency flag for stock restoration (`api/order.js:201`).
- Shared helper modules exist (`lib/*`), and `lib/catalog.js` is a reasonably deep module for catalog/stock-status rules.

## Findings

### Critical
**F1 [V] Secrets committed to git.** `.env` is tracked (`git ls-files .env`), appears in 4 commits, and every variable in it is populated (Mongo URI, Pathao credentials, admin password, signing secret). No `.gitignore` exists. Several `scratch/*.js` files and `update.md` also match a Mongo-URI-with-credentials pattern (contents not inspected/printed). *Action [R]:* rotate all those credentials, add `.gitignore`, remove from tracking and scrub history if the repo is shared.

**F2 [V] Unauthenticated Pathao webhook mutates orders.** `api/pathao.js:267-274` dispatches to `handlePathaoWebhook` before `requireAdminAuth`; no shared secret or signature. A delivered-looking payload sets `status="delivered"` and `verified=true` (`:120-123`), which also feeds revenue metrics (`api/order.js:117-120`). Matching by `merchant_order_id` (invoice number, which is shown to customers on `thank.html`) makes targeting trivial. *[R]:* require a webhook secret/header from Pathao config; ignore `verified` changes from webhooks for non-COD orders.

### High
**F3 [V] Hard-coded fallback credentials/secret.** If `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` are unset, source-visible defaults apply (`lib/lib.js:139`, `api/auth.js:76-77`) – and the repo is where those defaults live. Production env state is **[P]** unknown. *[R]:* fail closed when unset.

**F4 [V] "Admin" inventory view is public.** The auth check only runs when `admin` is in the query (`api/inventory.js:116-119`); omitting it returns the identical full payload (`:125-228`) incl. `_id`s, orphans, pricing. The status endpoint also discloses DB name, counts and catalog URL (`:35-52`). Impact is information disclosure, not mutation.

**F5 [V] Client price trusted for unresolved items.** `resolveInventoryItem` falls back to client-supplied id/price (`api/checkout.js:111-119`) and a price of 0 in the catalog uses `raw.price` (`:243`). Practical exploitability is limited because the stock step needs a matching inventory doc (`:376-400`), but orphaned inventory docs (a case the code explicitly tracks, `inventory.js:166`) or zero-priced catalog entries would be purchasable at an attacker-chosen price. *[R]:* reject unresolved items.

**F6 [V] Admin session design.** 7-day non-revocable token; logout is a no-op (`auth.js:65-67`); token stored in `localStorage` (`login.html:351`) and accepted in the URL query (`lib/lib.js:167-172`, leaks via logs/referrers); plain-text, non-constant-time comparison of password and signature (`auth.js:82`, `lib/lib.js:121`); no login rate limiting. Single shared account, no audit trail of who did what.

### Medium
**F7 [P] Static exposure from `outputDirectory: "."`** (`vercel.json:4`). The whole repo root is the static output: potentially `.env` (tracked), `lib/*.js`, `build-*.js`, `scratch/`, `content/`, `update.md`. Vercel's handling of dotfiles/ignored paths wasn't verifiable offline – **please test** `/.env`, `/lib/db.js`, `/scratch/check-db.js` on production.

**F8 [V] Lost-update race in inventory admin mutations.** Stock is read, recalculated in JS, then written with absolute `$set` (`api/inventory.js:400-515`), so a concurrent checkout decrement between read and write is overwritten. Use `$inc` for increase/decrease/adjust.

**F9 [V] Cancel flow is not atomic or reliable.** Restoration and the status update are separate writes; failures during restoration are swallowed and the order is still cancelled (`api/order.js:232-242`). Restoring to a missing inventory doc silently no-ops while counting quantity (`:218-223`). Order items omit `typeId` (`checkout.js:295-302`), so identity is re-guessed and can map to the *first variant* of a product (`lib/catalog.js:446-451`). `DELETE /api/order` doesn't restore stock, and `returned`/webhook status changes never restore stock.

**F10 [V] Duplicated catalog-resolution logic (low locality).** `api/checkout.js:11-123` re-implements the item flattening/identity resolution that `lib/catalog.js:140-454` already provides, with a different key scheme (`:::`-composites plus bare ids, which can collide: `catalogMap.set(sId, …)`). Deleting the checkout copy would concentrate, not move, complexity – a good candidate to unify behind `lib/catalog.js`. Also repeated: stock-status/availability derivation (≥6 copies in `inventory.js`/`catalog.js`), DB-name default (4 places), CORS (checkout/coupon hand-roll), response shapes.

**F11 [P] Stale-stock windows.** CDN `s-maxage=86400` on `/api/inventory` (`vercel.json:33-47`) plus 24 h browser cache (`stock.js:9`) vs function header `s-maxage=60` (`inventory.js:122`); which `Cache-Control` wins on Vercel is unverified. Checkout is authoritative so overselling is prevented, but UI may show wrong availability; an admin response could be cached if the config header overrides `no-store` (**unverified**).

**F12 [P] Catalog source ambiguity.** `lib/catalog.js` prefers local `products.json`, else remote `CATALOG_URL` pointing at another deployment (`:8`); `checkout.js` only reads local and silently runs with an empty map if missing (`:70-72`). Two sources of truth for price can diverge.

**F13 [V] Manual payment verification weaknesses.** bKash/Nagad TrxIDs are only length-checked (`checkout.js:199-205`), not unique-indexed or verified; `trx_id` isn't indexed. Duplicate/fake TrxID orders reserve stock until an admin acts. Coupon codes `RAWGADZ10`/`RAWGAD10` are hard-coded and always valid (`checkout.js:268`, `coupon.js:29`), unlimited-use, no expiry despite the "expired" message.

**F14 [V] No automated tests or CI.** No test script/runner; `scratch/test-*.js` are ad-hoc and some require live DB. Critical money/stock paths are untested.

### Low / maintainability
- **F15 [V]** Generated artifacts (JSON, `product/*.html`, `gadgets.html`, `public/*` duplicates) and `node_modules` (716 files) are committed; builds rewrite tracked source files (`build-products.js:1115`) → noisy diffs, drift risk. `public/` is a partial mirror whose consumer is unclear (**unverified**).
- **F16 [V]** Dead/duplicate pages: `checkout02.html`, `test.html`; unused `tailwind.config.js` (CDN Tailwind, `./components` missing); unused `APP_URL`; stale file-header comments (`lib/lib.js:1`, `lib/catalog.js:1`).
- **F17 [V]** Production uses `cdn.tailwindcss.com` and unpinned Alpine `3.x.x` (`checkout.html:10,13`); no CSP; deprecated `X-XSS-Protection` (`vercel.json:28`); `serverError` echoes internal messages (`lib/lib.js:69`); `Access-Control-Allow-Origin: *` on admin endpoints (low CSRF risk since bearer tokens, not cookies).
- **F18 [V]** `GET /api/order` metrics scan the entire `orders` collection per request (`order.js:99-136`) – scalability limit as orders grow; the `status`/`trx_status`/`courier_status` fields are free strings without enum validation (`order.js:176-180`).
- **F19 [V]** Non-transaction fallback rollback filter omits `typeId` handling consistent with decrement (`checkout.js:490-495`) – only relevant if sessions fail; `client.startSession()` rarely throws so this branch is likely dead (**P**).
- **F20 [P]** Third-party Google Apps Script endpoint receives data from 7+ pages (`checkout.html:813`, `thank.html:381`…); contents sent not reviewed – check for PII.

## Prioritised improvement order (minimal, no rewrite)
1. Rotate/remove secrets (F1); verify `/.env` etc. not served (F7).
2. Authenticate the Pathao webhook (F2); remove default credentials (F3).
3. Make `admin` gating real or accept public read and strip sensitive fields (F4); reject unresolved cart items (F5).
4. Switch admin stock changes to `$inc` (F8); make cancel+restore transactional (F9).
5. Unify catalog resolution in `lib/catalog.js` (F10); persist `typeId` on order items.
6. Add a test script covering checkout/stock and a CI step (F14); add `.gitignore` and stop tracking `node_modules`/generated files (F15).

## Not verified
Production env vars/Vercel settings, CDN header precedence, actual DB data/shape, Pathao webhook behaviour/signing options, Pages CMS → deploy trigger, contents of `scratch/*` credentials-pattern matches, Apps Script payloads, Node runtime version.
