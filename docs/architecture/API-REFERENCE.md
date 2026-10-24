# API Reference

Base: same origin as the site (Vercel functions in `api/`). All responses JSON. Helper envelope: `{success:true,...}` / `{success:false,error}` (`lib/lib.js:42-71`); `auth`, `checkout`, `coupon`, `order`, `pathao` partly bypass helpers. CORS: `Access-Control-Allow-Origin: *` on every function (`lib/lib.js:8`, `api/checkout.js:148`; **`api/coupon.js` sets no CORS headers**).

Auth legend: **Public** / **Admin** = valid token via `Authorization: Bearer`, `X-Admin-Token`, `X-Auth-Token`, or `?token=` (`lib/lib.js:142-175`); failure → `401 {success:false,error,code:"UNAUTHORIZED"}`.

## Vercel rewrites (`vercel.json:7-21`)
`/admin`→`/admin.html`, `/login`, `/inventory`, `/order` & `/orders`→`/order.html`; `/api/create-order`→`/api/pathao`; `/api/pathao-webhook`→`/api/pathao?action=webhook`; `/api/status`→`/api/inventory?status=true`.

## `/api/auth` – `api/auth.js`
| Method | Auth | Input | Output |
|---|---|---|---|
| GET | token | token | 200 `{authenticated,user{email,name}}`; 401 missing/invalid/expired |
| POST | Public | `{email|username, password, action?}` | login: 200 `{token,user}`; 400 missing; 401 bad credentials. `action:"logout"` → 200 no-op |
| OPTIONS | – | – | 200 |
Other methods → 405. (`?action=verify` used by UI is ignored; GET always verifies.) No rate limiting.

## `/api/checkout` – `api/checkout.js`
POST only (405 otherwise). Public.
Body: `cartItems[]|items[]` (`id|productId,typeId,subProductId,name,price,qty|quantity`), `cust_name` (≤100), `cust_phone` (`^01\d{9}$`), `cust_email`, `cust_address` (≥5), `payment_method` (cod|bkash|nagad), `trx_id` (≥4, required for bkash/nagad), `sender_number`, `coupon_code`.
200: `{success,payment_method,invoice_number,trx_id,message,redirect_url}`.
400: validation, unknown item, `Insufficient stock…`, `…currently unavailable…`, or any transaction error (`:407-418`). 500: DB connection (`:313`).

## `/api/coupon` – `api/coupon.js`
GET `?code=` or POST `{coupon_code|code}`. Public. 200 `{valid:true,coupon_code,discount_percent,message}`; 400 `{valid:false,error}`; 405. Valid codes: env `COUPON_CODE` plus hard-coded `RAWGADZ10`, `RAWGAD10` (`:29`). Percent from `COUPON_DISCOUNT_PERCENT` (default 10).

## `/api/inventory` – `api/inventory.js` (alias `/api/status`)
| Method / mode | Auth | Input | Output |
|---|---|---|---|
| GET `?status=true` (or url contains `/status`) | Public | – | health: db name, counts, `catalogUrl`, timestamp (`:35-52`) |
| GET `?productId&typeId[&subProductId]` | Public | – | single item stock/status (`:56-83`) |
| GET `?productId` | Public | – | variants of product (`:86-113`) |
| GET (no params) | Public | `tab`, `fresh=true` | full merged inventory, `summary`, `nestedProducts`, `orphanedItems` (`:125-228`) |
| GET `?admin=…` | **Admin** | same | same payload, `no-store` (`:116-120`) |
| POST (no `action`) `{productIds[]}` or `{items[]}` | Public | | bulk stock lookup (`:246-295`) |
| POST/PATCH `{action:"sync"…}` | Admin | | `{catalogCount,existingCount,addedCount,orphanedCount,totalInventoryCount,addedItems}` |
| POST/PATCH `{productId,typeId?,subProductId?, action: set|increase|decrease|adjust|set_availability|toggle_availability|update_stock|add_item|upsert, value|stock|adjust|delta, isAvailable}` | Admin | | `{stock,isAvailable,previousStock,action,inventory}`; 400 `INSUFFICIENT_STOCK`, invalid values |
| DELETE `{productId,typeId?,subProductId?}` | Admin | | `{deletedCount}` |
Errors: 500 via `serverError` (message leaked). 405 otherwise.

## `/api/order` – `api/order.js`
All methods require **Admin** (`:27`; OPTIONS answered before).
- GET: query `search,status,payment_method,courier_status,limit(≤500, default 200)` → `{orders,count,metrics{totalOrders,totalRevenue,pendingDispatch,pendingPayment,dispatchedCount,deliveredCount}}`.
- PATCH/PUT: `{invoice_number, status?, verified?, trx_status?, courier_status?, admin_notes?, customer?{name,phone,full_address,email}}` → updated order; `status:"cancelled"` restores stock once. 400 missing id; 404.
- DELETE: `{invoice_number}` (body or query) → 200/404. Hard delete; no stock restoration.

## `/api/pathao` – `api/pathao.js` (aliases `/api/create-order`, `/api/pathao-webhook`)
- GET (**Admin**): `?action=stores` | `?action=test` | `?consignment_id=` (live tracking) | `?invoice_number=` (local courier status) | none → config status. Upstream errors propagate status code; test failure → 502.
- POST dispatch (**Admin**): `{invoice_number, store_id?, recipient_*, item_*, amount_to_collect?, delivery_type?, …}`. 409 if already dispatched; 400 validation (phone, address ≥10 chars, store id); upstream errors forwarded. 200 `{consignment_id,delivery_fee,orderUpdated,…}`.
- POST webhook (**Public – no secret/signature check**): selected when `?action=webhook` or body has `event`+id, or `order_status`+id without `store_id`/`recipient_phone` (`:267-270`). 200 `{matchedCount,modifiedCount}`; 400 missing ids.

## Common error behaviour
No global error middleware; each handler wraps in try/catch. Messages from exceptions (including driver errors) may reach clients (`lib/lib.js:69`, `order.js:42,155`).
