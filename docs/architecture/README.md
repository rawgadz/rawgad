# Rawgadz – Architecture Report

Evidence-based documentation of the repository **as it exists** (git HEAD `ab08a73`, 245 commits; authors: a human developer and the `pages-cms[bot]`). No application code, config or dependencies were modified. Secret values are never reproduced; only variable names.

## Documents

| File | Contents |
|---|---|
| [SYSTEM-OVERVIEW.md](SYSTEM-OVERVIEW.md) | Architectural style, context + component diagrams, auth, integrations |
| [CODEBASE-MAP.md](CODEBASE-MAP.md) | Directory/file reference, entry points, build scripts |
| [DATA-FLOWS.md](DATA-FLOWS.md) | Sequence diagrams for checkout, admin login, inventory, dispatch, cancel, content build |
| [DATABASE.md](DATABASE.md) | MongoDB collections, inferred schemas, indexes, queries |
| [API-REFERENCE.md](API-REFERENCE.md) | All `/api/*` routes, auth, inputs/outputs, errors |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Vercel runtime, env var names, build/run, failure points |
| [ARCHITECTURE-REVIEW.md](ARCHITECTURE-REVIEW.md) | Prioritised findings (verified vs potential) |

## Executive summary

**What it is.** A Bangladesh-oriented e-commerce site (gadgets, car accessories, cars showcase, blog) built as a **Jamstack / statically pre-rendered site plus six Vercel serverless functions backed by MongoDB Atlas**.

- **Content** lives in Markdown (`content/**`), edited through *Pages CMS* (`.pages.yml`, commits by `pages-cms[bot]`). Node build scripts (`build-*.js`) compile it to JSON (`products.json`, …) and pre-render HTML pages (`product/*.html`, `blog/*.html`, `cr/*.html`) and `sitemap.xml`.
- **Runtime state** (inventory, orders) lives in MongoDB (`inventory`, `orders`). The catalog (what exists, prices) stays in `products.json`; stock is joined at request time (`lib/catalog.js`, `api/inventory.js`).
- **Frontend** is hand-written HTML with Alpine.js + Tailwind (both via CDN), cart in `localStorage`. There is no bundler or framework.
- **Admin** is three static pages (`admin.html`, `inventory.html`, `order.html`) behind `login.html`, calling token-protected APIs. Courier dispatch uses the **Pathao Aladdin API**.
- **Payments**: COD, or manual bKash/Nagad (customer types a TrxID; admin verifies). No payment gateway is integrated.

**Top findings** (details in [ARCHITECTURE-REVIEW.md](ARCHITECTURE-REVIEW.md)):

1. `.env` (with all populated secret variables) and 716 `node_modules` files are **tracked in git**; there is no `.gitignore`. Rotate credentials.
2. `POST /api/pathao` webhook path is **unauthenticated** and can mark any order `delivered` + `verified`.
3. Hard-coded fallback admin credentials and token-signing secret in source if env vars are missing.
4. `/api/inventory?admin=true` guard is bypassed by omitting the parameter – full inventory is public.
5. Checkout falls back to client-supplied price for unresolved items.
6. `vercel.json` `outputDirectory: "."` may expose repo files statically (**unverified**).
7. No automated test runner or CI.

## Evidence conventions
- Citations are `path:line` against the working tree at analysis time.
- **Verified** = read in source. **Unverified** = depends on runtime/hosting state not observable from the repo.

## Verification limits (summary)
Nothing was executed against MongoDB, Pathao, Vercel or Pages CMS; no tests were run; deployed environment variables and Vercel dashboard settings are unknown. The repo skill `improve-codebase-architecture` (`.agents/skills/…`) was consulted; its vocabulary (module, interface, depth, seam, locality) is used in the review, but its HTML/candidate-proposal output was not produced because the requested deliverable is this Markdown set.
