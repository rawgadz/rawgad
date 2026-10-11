// api/inventory.js
// Consolidated Serverless Function for Inventory Operations in Rawgadz:
// Merges Admin CMS inventory logic with Storefront compatibility:
// 1. GET  /api/inventory           -> Returns live stock merged with catalog metadata & status check
// 2. POST /api/inventory (sync)    -> Synchronizes catalog with MongoDB Atlas, adds missing items with stock: 0
// 3. POST /api/inventory (mutations)-> Set, increase, decrease stock enforcing stock >= 0 & INSUFFICIENT_STOCK rejection
// 4. Storefront queries            -> Backward-compatible single item & bulk stock queries

const { setCors, parseBody, ok, badRequest, notFound, serverError, requireAdminAuth } = require("../lib/lib");
const { getInventoryCollection, getOrdersCollection, getDb } = require("../lib/db");
const {
  getPurchasableCatalogMap,
  makeKey,
  normalizeId,
  CATALOG_URL,
  getStoreBaseUrl,
  buildNestedCatalog,
  getStockStatus
} = require("../lib/catalog");

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const url = (req.url || "").toLowerCase();

  // ==========================================
  // 1. GET: Fetch Inventory & Catalog Metadata
  // ==========================================
  if (req.method === "GET") {
    try {
      const inventoryCol = await getInventoryCollection();

      // A. Health status mode: ?status=true or /api/status
      if (req.query?.status === "true" || url.includes("/status")) {
        const client = await getDb();
        await client.db("admin").command({ ping: 1 });
        const ordersCol = await getOrdersCollection();
        const [invCount, ordCount] = await Promise.all([
          inventoryCol.countDocuments(),
          ordersCol.countDocuments(),
        ]);
        return ok(res, {
          status: "healthy",
          database: process.env.MONGODB_DB || process.env.MONGO_DB || "inventory",
          connected: true,
          inventoryCount: invCount,
          ordersCount: ordCount,
          catalogUrl: CATALOG_URL,
          timestamp: new Date().toISOString(),
        });
      }

      // B. Storefront single item lookup: ?productId=...&typeId=...
      const { productId, typeId, subProductId, admin, fresh } = req.query || {};
      if (productId && typeId !== undefined && !admin) {
        const pId = String(productId).trim();
        const tId = normalizeId(typeId);
        const sId = normalizeId(subProductId);

        const doc = await inventoryCol.findOne({
          productId: pId,
          typeId: tId,
          subProductId: sId,
        });

        const stock = doc && typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
        const status = getStockStatus(stock);

        return ok(res, {
          productId: pId,
          typeId: tId,
          subProductId: sId,
          stock,
          rawStock: stock,
          isAvailable: stock > 0,
          inStock: stock > 0,
          status,
          updatedAt: doc?.updatedAt || null,
          createdAt: doc?.createdAt || null,
        });
      }

      // C. Storefront product lookup: ?productId=...
      if (productId && typeId === undefined && !admin) {
        const docs = await inventoryCol
          .find({ productId: String(productId).trim() })
          .toArray();

        const formatted = docs.map((doc) => {
          const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
          return {
            productId: doc.productId,
            typeId: normalizeId(doc.typeId),
            subProductId: normalizeId(doc.subProductId),
            stock,
            rawStock: stock,
            isAvailable: stock > 0,
            inStock: stock > 0,
            status: getStockStatus(stock),
            updatedAt: doc.updatedAt || null,
            createdAt: doc.createdAt || null,
          };
        });

        return ok(res, {
          productId: String(productId).trim(),
          inventory: formatted,
          items: formatted,
        });
      }

      // D. Full Inventory Listing (Admin & Storefront bulk)
      if (admin) {
        // Enforce Admin Authorization for detailed administrative inventory view
        const adminUser = requireAdminAuth(req, res);
        if (!adminUser) return;
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=120");
      }

      const inventoryDocs = await inventoryCol
        .find({})
        .sort({ productId: 1, typeId: 1, subProductId: 1 })
        .toArray();

      const { map: catalogMap, items: catalogItems, products: rawCatalogProducts } = await getPurchasableCatalogMap(fresh === "true");

      const stockMap = new Map();
      for (const doc of inventoryDocs) {
        const pId = String(doc.productId ?? "").trim();
        const tId = normalizeId(doc.typeId);
        const sId = normalizeId(doc.subProductId);
        stockMap.set(makeKey(pId, tId, sId), doc);
      }

      let inStockCount = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;
      let orphanedCount = 0;

      const mergedItems = inventoryDocs.map((doc) => {
        const pId = String(doc.productId ?? "").trim();
        const tId = normalizeId(doc.typeId);
        const sId = normalizeId(doc.subProductId);

        const key = makeKey(pId, tId, sId);
        const catalogInfo = catalogMap.get(key);

        const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
        const status = getStockStatus(stock);

        if (status === "in_stock") inStockCount++;
        else if (status === "low_stock") lowStockCount++;
        else outOfStockCount++;

        const isOrphaned = !catalogInfo;
        if (isOrphaned) orphanedCount++;

        const slug = catalogInfo ? catalogInfo.slug : (doc.slug || "");
        const tab = catalogInfo ? catalogInfo.tab : (doc.tab || "");
        const storeBaseUrl = getStoreBaseUrl();
        const productUrl = slug ? (storeBaseUrl ? `${storeBaseUrl}/product/${slug}` : `/product/${slug}`) : "";

        return {
          _id: String(doc._id),
          key,
          productId: pId,
          typeId: tId,
          subProductId: sId,
          stock,
          rawStock: stock,
          isAvailable: stock > 0,
          status,
          orphaned: isOrphaned,
          unmatched: isOrphaned,
          productTitle: catalogInfo ? catalogInfo.productTitle : `Item (${pId})`,
          typeTitle: catalogInfo ? catalogInfo.typeTitle : (tId || null),
          subTitle: catalogInfo ? catalogInfo.subTitle : (sId || null),
          displayName: catalogInfo ? catalogInfo.displayName : `Item: ${pId} / ${tId || "default"}`,
          price: catalogInfo ? catalogInfo.price : 0,
          imageSrc: catalogInfo ? catalogInfo.imageSrc : "",
          tags: catalogInfo ? catalogInfo.tags : "",
          slug,
          tab,
          productUrl,
          createdAt: doc.createdAt || null,
          updatedAt: doc.updatedAt || doc.updated_at || doc.createdAt || null,
        };
      });

      const nestedProducts = buildNestedCatalog(rawCatalogProducts, stockMap);
      const orphanedItems = mergedItems.filter((i) => i.orphaned);

      return ok(res, {
        connected: true,
        database: process.env.MONGODB_DB || process.env.MONGO_DB || "inventory",
        count: mergedItems.length,
        totalCatalogItems: catalogItems.length,
        summary: {
          total: mergedItems.length,
          inStock: inStockCount,
          lowStock: lowStockCount,
          outOfStock: outOfStockCount,
          orphaned: orphanedCount,
        },
        items: mergedItems,
        inventory: mergedItems, // Dual output for storefront / stock.js compatibility
        nestedProducts,
        orphanedItems,
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  // ==========================================
  // 2. POST / PATCH: Sync OR Update Stock
  // ==========================================
  if (req.method === "POST" || req.method === "PATCH") {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const body = await parseBody(req);
      const inventoryCol = await getInventoryCollection();

      // A. Storefront bulk lookup by productIds or items
      const { items: queryItems, productIds, action } = body;

      if (!action && Array.isArray(productIds) && productIds.length > 0) {
        const cleanIds = productIds.map(String).filter(Boolean);
        const docs = await inventoryCol.find({ productId: { $in: cleanIds } }).toArray();
        const formatted = docs.map((doc) => {
          const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
          return {
            productId: doc.productId,
            typeId: normalizeId(doc.typeId),
            subProductId: normalizeId(doc.subProductId),
            stock,
            isAvailable: stock > 0,
            status: getStockStatus(stock),
            updatedAt: doc.updatedAt || null,
          };
        });
        return ok(res, { inventory: formatted, items: formatted });
      }

      if (!action && Array.isArray(queryItems) && queryItems.length > 0) {
        const orConditions = queryItems.map((item) => {
          const pId = String(item.productId || item.id || "").trim();
          const tId = normalizeId(item.typeId);
          const sId = normalizeId(item.subProductId);
          const cond = { productId: pId };
          if (tId !== null) cond.typeId = tId;
          cond.subProductId = sId;
          return cond;
        }).filter((c) => !!c.productId);

        if (orConditions.length === 0) {
          return badRequest(res, "Invalid items specified for bulk lookup.");
        }

        const docs = await inventoryCol.find({ $or: orConditions }).toArray();
        const formatted = docs.map((doc) => {
          const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
          return {
            productId: doc.productId,
            typeId: normalizeId(doc.typeId),
            subProductId: normalizeId(doc.subProductId),
            stock,
            isAvailable: stock > 0,
            status: getStockStatus(stock),
            updatedAt: doc.updatedAt || null,
          };
        });
        return ok(res, { inventory: formatted, items: formatted });
      }

      // CRITICAL SERVER-SIDE SECURITY GUARD
      // All inventory mutations (sync, set, increase, decrease, adjust) require Admin Authorization
      const adminUser = requireAdminAuth(req, res);
      if (!adminUser) return;

      // Check if this request is a synchronization request
      const isSync = action === "sync" || action === "sync_catalog" || req.query?.action === "sync" || url.includes("/sync") || body.sync === true;

      // ----------------------------------------------------
      // B. "Update Inventory" Synchronization Specification
      // ----------------------------------------------------
      if (isSync) {
        // 1. Force fresh catalog fetch
        const { items: catalogItems } = await getPurchasableCatalogMap(true);

        if (!catalogItems || catalogItems.length === 0) {
          return serverError(res, new Error("Unable to retrieve products catalog."));
        }

        // 2. Query existing inventory keys from MongoDB
        const existingDocs = await inventoryCol
          .find({}, { projection: { _id: 0, productId: 1, typeId: 1, subProductId: 1 } })
          .toArray();

        const existingKeySet = new Set(
          existingDocs.map((doc) => makeKey(doc.productId, doc.typeId, doc.subProductId))
        );

        const catalogKeySet = new Set(catalogItems.map((item) => item.key));

        // Missing items: in catalog but not yet in MongoDB
        const missingItems = catalogItems.filter((item) => !existingKeySet.has(item.key));

        // Orphaned items: in MongoDB but no longer in catalog
        const orphanedCount = existingDocs.filter(
          (doc) => !catalogKeySet.has(makeKey(doc.productId, doc.typeId, doc.subProductId))
        ).length;

        let insertedCount = 0;

        if (missingItems.length > 0) {
          // Initialize missing records with stock: 0 per TRD specification
          const now = new Date();
          const docsToInsert = missingItems.map((item) => ({
            productId: item.productId,
            typeId: item.typeId,
            subProductId: item.subProductId,
            stock: 0,
            createdAt: now,
            updatedAt: now,
          }));

          try {
            const insertResult = await inventoryCol.insertMany(docsToInsert, { ordered: false });
            insertedCount = insertResult.insertedCount;
          } catch (insertErr) {
            if (insertErr.insertedCount !== undefined) {
              insertedCount = insertErr.insertedCount;
            } else {
              throw insertErr;
            }
          }
        }

        const currentTotal = await inventoryCol.countDocuments();

        // Exact response contract per TRD specification: 5 canonical metrics
        return ok(res, {
          catalogCount: catalogItems.length,
          existingCount: existingDocs.length,
          addedCount: insertedCount,
          orphanedCount,
          totalInventoryCount: currentTotal,
          message: `Inventory synchronized: ${catalogItems.length} catalog items found, ${existingDocs.length} existing records, ${insertedCount} new record(s) added, ${orphanedCount} orphaned records.`,
          addedItems: missingItems.slice(0, 10).map((i) => ({
            productId: i.productId,
            typeId: i.typeId,
            subProductId: i.subProductId,
            displayName: i.displayName,
          })),
        });
      }

      // ----------------------------------------------------
      // C. Stock Mutation Rules (set, increase, decrease)
      // ----------------------------------------------------
      const { productId, typeId, subProductId, adjust, stockType, isAvailable, value, stock } = body;

      if (!productId || typeof productId !== "string" || !productId.trim()) {
        return badRequest(res, "Missing or invalid 'productId' in request body.");
      }

      const cleanProductId = String(productId).trim();
      const cleanTypeId = normalizeId(typeId);
      const cleanSubProductId = normalizeId(subProductId);

      const filter = {
        productId: cleanProductId,
        typeId: cleanTypeId,
        subProductId: cleanSubProductId,
      };

      const existingDoc = await inventoryCol.findOne(filter);
      const currentStock = existingDoc && typeof existingDoc.stock === "number" ? Math.max(0, existingDoc.stock) : 0;
      let newStock = currentStock;
      const mutationAction = action || (adjust !== undefined ? "adjust" : "set");

      if (mutationAction === "set") {
        const rawTarget = value !== undefined ? value : stock;
        const target = parseInt(rawTarget, 10);
        if (isNaN(target) || target < 0) {
          return badRequest(res, "Invalid 'value' provided for action 'set'. Must be a non-negative integer (>= 0).");
        }
        newStock = target;
      } else if (mutationAction === "increase") {
        const rawDelta = value !== undefined ? value : (body.delta || 1);
        const delta = parseInt(rawDelta, 10);
        if (isNaN(delta) || delta <= 0) {
          return badRequest(res, "Invalid increase delta. Must be a positive integer.");
        }
        newStock = currentStock + delta;
      } else if (mutationAction === "decrease") {
        const rawDelta = value !== undefined ? value : (body.delta || 1);
        const delta = parseInt(rawDelta, 10);
        if (isNaN(delta) || delta <= 0) {
          return badRequest(res, "Invalid decrease delta. Must be a positive integer.");
        }
        if (currentStock - delta < 0) {
          return res.status(400).json({
            success: false,
            error: "INSUFFICIENT_STOCK",
            message: "Requested decrease exceeds current stock. Stock cannot become negative."
          });
        }
        newStock = currentStock - delta;
      } else if (mutationAction === "adjust" || adjust !== undefined) {
        const delta = parseInt(adjust, 10);
        if (isNaN(delta)) {
          return badRequest(res, "Invalid 'adjust' value.");
        }
        if (currentStock + delta < 0) {
          return res.status(400).json({
            success: false,
            error: "INSUFFICIENT_STOCK",
            message: "Requested decrease exceeds current stock. Stock cannot become negative."
          });
        }
        newStock = currentStock + delta;
      } else if (mutationAction === "update_stock" || mutationAction === "add_item" || mutationAction === "upsert") {
        // Compatibility handler for legacy update_stock callers
        if (adjust !== undefined && adjust !== null) {
          const delta = parseInt(adjust, 10) || 0;
          if (currentStock + delta < 0) {
            return res.status(400).json({
              success: false,
              error: "INSUFFICIENT_STOCK",
              message: "Requested decrease exceeds current stock. Stock cannot become negative."
            });
          }
          newStock = currentStock + delta;
        } else if (isAvailable === true || stockType === "available") {
          const target = (stock !== undefined && stock !== null && Number(stock) > 0) ? parseInt(stock, 10) : 100;
          newStock = Math.max(1, target);
        } else {
          const parsed = parseInt(stock !== undefined && stock !== null ? stock : (value !== undefined ? value : 0), 10);
          if (isNaN(parsed) || parsed < 0) {
            return badRequest(res, "Stock must be a non-negative integer (>= 0).");
          }
          newStock = parsed;
        }
      } else {
        return badRequest(res, `Invalid or unsupported action '${mutationAction}'. Supported: 'set', 'increase', 'decrease', 'sync'.`);
      }

      // Enforce floor invariant: stock >= 0
      if (newStock < 0) newStock = 0;

      const now = new Date();
      const updateResult = await inventoryCol.findOneAndUpdate(
        filter,
        {
          $set: {
            stock: newStock,
            updatedAt: now,
          },
          $setOnInsert: {
            productId: cleanProductId,
            typeId: cleanTypeId,
            subProductId: cleanSubProductId,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: "after" }
      );

      const updatedDoc = updateResult && (updateResult.value !== undefined ? updateResult.value : updateResult);

      return ok(res, {
        productId: cleanProductId,
        typeId: cleanTypeId,
        subProductId: cleanSubProductId,
        stock: newStock,
        previousStock: currentStock,
        action: mutationAction,
        updatedAt: now,
        inventory: updatedDoc,
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  // ==========================================
  // 3. DELETE: Remove an inventory item
  // ==========================================
  if (req.method === "DELETE") {
    // CRITICAL SERVER-SIDE SECURITY GUARD
    // Deleting inventory items requires Admin Authorization
    const adminUser = requireAdminAuth(req, res);
    if (!adminUser) return;

    try {
      const body = await parseBody(req);
      const pId = String(body.productId || req.query?.productId || "").trim();
      const tId = normalizeId(body.typeId || req.query?.typeId);
      const sId = normalizeId(body.subProductId || req.query?.subProductId);

      if (!pId) {
        return badRequest(res, "'productId' is required for deletion.");
      }

      const inventoryCol = await getInventoryCollection();
      const result = await inventoryCol.deleteOne({
        productId: pId,
        typeId: tId,
        subProductId: sId,
      });

      return ok(res, {
        message: `Inventory item deleted (removed ${result.deletedCount} record).`,
        deletedCount: result.deletedCount,
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed. Use GET, POST, or PATCH." });
};
