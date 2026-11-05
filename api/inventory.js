// api/inventory.js
// Consolidated Serverless Function for Quantity-Based Inventory Operations in Rawgadz.
// Product and variant availability is determined exclusively from Markdown via data/products.json.

const { setCors, parseBody, ok, badRequest, notFound, serverError, requireAdminAuth } = require("./_helpers");
const { getInventoryCollection, getOrdersCollection, getDb } = require("./_db");
const {
  getPurchasableCatalogMap,
  makeCanonicalKey,
  normalizeId,
  buildNestedCatalog,
  getStockStatus,
  isVariantAvailable
} = require("./_catalog");

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
          connected: true,
          inventoryCount: invCount,
          ordersCount: ordCount,
          timestamp: new Date().toISOString(),
        });
      }

      const { productId, typeId, subProductId, admin, tab: queryTab } = req.query || {};
      const { map: catalogMap, items: catalogItems, products: rawCatalogProducts } = getPurchasableCatalogMap();

      // B. Storefront single item lookup: ?productId=...&typeId=...
      if (productId && typeId !== undefined && !admin) {
        const pId = String(productId).trim();
        const tId = normalizeId(typeId);
        const sId = normalizeId(subProductId);
        const key = makeCanonicalKey(pId, tId, sId);
        const catalogInfo = catalogMap.get(key);
        const catalogAvailable = catalogInfo ? Boolean(catalogInfo.available) : false;

        const doc = await inventoryCol.findOne({
          productId: pId,
          typeId: tId === "_" ? null : tId,
          subProductId: sId === "_" ? null : sId,
        });

        const stock = typeof doc?.stock === "number" ? Math.max(0, doc.stock) : 0;
        const available = isVariantAvailable(stock, catalogAvailable);
        const status = getStockStatus(stock, catalogAvailable);

        return ok(res, {
          productId: pId,
          typeId: tId === "_" ? null : tId,
          subProductId: sId === "_" ? null : sId,
          stock,
          catalogAvailable,
          available,
          inStock: available,
          status,
          updatedAt: doc?.updatedAt || null,
        });
      }

      // C. Storefront product lookup: ?productId=...
      if (productId && typeId === undefined && !admin) {
        const docs = await inventoryCol
          .find({ productId: String(productId).trim() })
          .toArray();

        const formatted = docs
          .map((doc) => {
            const key = makeCanonicalKey(doc.productId, doc.typeId, doc.subProductId);
            const catalogInfo = catalogMap.get(key);
            const catalogAvailable = catalogInfo ? Boolean(catalogInfo.available) : false;
            const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
            const available = isVariantAvailable(stock, catalogAvailable);
            return {
              productId: doc.productId,
              typeId: doc.typeId || null,
              subProductId: doc.subProductId || null,
              stock,
              catalogAvailable,
              available,
              inStock: available,
              status: getStockStatus(stock, catalogAvailable),
              updatedAt: doc.updatedAt || null,
            };
          })
          .filter((item) => item.catalogAvailable);

        return ok(res, {
          productId: String(productId).trim(),
          inventory: formatted,
          items: formatted,
        });
      }

      // D. Full Inventory Listing
      let isAdmin = false;
      if (admin) {
        const adminUser = requireAdminAuth(req, res);
        if (!adminUser) return;
        isAdmin = true;
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
      }

      const inventoryDocs = await inventoryCol
        .find({})
        .sort({ productId: 1, typeId: 1, subProductId: 1 })
        .toArray();

      const stockMap = new Map();
      for (const doc of inventoryDocs) {
        const key = makeCanonicalKey(doc.productId, doc.typeId, doc.subProductId);
        stockMap.set(key, doc);
      }

      if (inventoryDocs.length === 0) {
        for (const catItem of catalogItems) {
          stockMap.set(catItem.key, {
            productId: catItem.productId,
            typeId: catItem.typeId,
            subProductId: catItem.subProductId,
            stock: 0,
            isVirtual: true,
          });
        }
      } else if (isAdmin) {
        for (const catItem of catalogItems) {
          if (!stockMap.has(catItem.key)) {
            stockMap.set(catItem.key, {
              productId: catItem.productId,
              typeId: catItem.typeId,
              subProductId: catItem.subProductId,
              stock: 0,
              isVirtual: true,
            });
          }
        }
      }

      let inStockCount = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;
      let orphanedCount = 0;

      const itemsList = (isAdmin || inventoryDocs.length === 0) ? Array.from(stockMap.values()) : inventoryDocs;

      const mergedItems = itemsList.map((doc) => {
        const pId = String(doc.productId ?? "").trim();
        const tId = doc.typeId ? String(doc.typeId).trim() : null;
        const sId = doc.subProductId ? String(doc.subProductId).trim() : null;
        const key = makeCanonicalKey(pId, tId, sId);
        const catalogInfo = catalogMap.get(key);

        const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
        const catalogAvailable = catalogInfo ? Boolean(catalogInfo.available) : false;
        const available = isVariantAvailable(stock, catalogAvailable);
        const status = getStockStatus(stock, catalogAvailable);

        if (status === "in_stock") inStockCount++;
        else if (status === "low_stock") lowStockCount++;
        else outOfStockCount++;

        const isOrphaned = !catalogInfo;
        if (isOrphaned) orphanedCount++;

        const slug = catalogInfo ? catalogInfo.slug : "";
        const tab = catalogInfo ? catalogInfo.tab : "";
        const productUrl = slug && catalogAvailable ? `/product/${slug}` : "";

        const itemObj = {
          key,
          productId: pId,
          typeId: tId,
          subProductId: sId,
          stock,
          catalogAvailable,
          available,
          status,
          productTitle: catalogInfo ? catalogInfo.productTitle : `Item (${pId})`,
          typeTitle: catalogInfo ? catalogInfo.typeTitle : tId,
          subTitle: catalogInfo ? catalogInfo.subTitle : sId,
          displayName: catalogInfo ? catalogInfo.displayName : `Item: ${pId} / ${tId || "default"}`,
          price: catalogInfo ? catalogInfo.price : 0,
          imageSrc: catalogInfo ? catalogInfo.imageSrc : "",
          tags: catalogInfo ? catalogInfo.tags : "",
          slug,
          tab,
          productUrl,
          updatedAt: doc.updatedAt || doc.createdAt || null,
        };

        if (isAdmin) {
          if (doc._id) itemObj._id = String(doc._id);
          itemObj.orphaned = isOrphaned;
          if (doc.isVirtual) itemObj.uninitialized = true;
        }

        return itemObj;
      });

      const nestedProducts = buildNestedCatalog(rawCatalogProducts, stockMap);
      const orphanedItems = isAdmin ? mergedItems.filter((i) => i.orphaned) : [];

      let outputItems = isAdmin ? mergedItems : mergedItems.filter((i) => i.catalogAvailable);
      if (queryTab && queryTab.trim()) {
        const normTab = queryTab.trim().toLowerCase();
        outputItems = outputItems.filter((i) => (i.tab || "").toLowerCase() === normTab);
      }

      return ok(res, {
        connected: true,
        count: outputItems.length,
        totalCatalogItems: catalogItems.length,
        summary: {
          total: mergedItems.length,
          inStock: inStockCount,
          lowStock: lowStockCount,
          outOfStock: outOfStockCount,
          orphaned: orphanedCount,
        },
        items: outputItems,
        inventory: outputItems,
        nestedProducts,
        orphanedItems,
      });
    } catch (err) {
      return serverError(res, err);
    }
  }

  // ==========================================
  // 2. POST / PATCH / PUT: Bulk Query, Sync, or Stock Quantity Mutation
  // ==========================================
  if (req.method === "POST" || req.method === "PATCH" || req.method === "PUT") {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      const body = await parseBody(req);
      const inventoryCol = await getInventoryCollection();
      const { map: catalogMap, items: catalogItems } = getPurchasableCatalogMap();

      const { items: queryItems, productIds, action } = body;

      // A. Storefront bulk lookup by productIds or items
      if (!action && Array.isArray(productIds) && productIds.length > 0) {
        const cleanIds = productIds.map(String).filter(Boolean);
        const docs = await inventoryCol.find({ productId: { $in: cleanIds } }).toArray();
        const formatted = docs.map((doc) => {
          const key = makeCanonicalKey(doc.productId, doc.typeId, doc.subProductId);
          const catalogInfo = catalogMap.get(key);
          const catalogAvailable = catalogInfo ? Boolean(catalogInfo.available) : false;
          const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
          const available = isVariantAvailable(stock, catalogAvailable);
          return {
            productId: doc.productId,
            typeId: doc.typeId || null,
            subProductId: doc.subProductId || null,
            stock,
            catalogAvailable,
            available,
            status: getStockStatus(stock, catalogAvailable),
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
          cond.typeId = tId === "_" ? null : tId;
          cond.subProductId = sId === "_" ? null : sId;
          return cond;
        }).filter((c) => !!c.productId);

        if (orConditions.length === 0) {
          return badRequest(res, "Invalid items specified for bulk lookup.");
        }

        const docs = await inventoryCol.find({ $or: orConditions }).toArray();
        const formatted = docs.map((doc) => {
          const key = makeCanonicalKey(doc.productId, doc.typeId, doc.subProductId);
          const catalogInfo = catalogMap.get(key);
          const catalogAvailable = catalogInfo ? Boolean(catalogInfo.available) : false;
          const stock = typeof doc.stock === "number" ? Math.max(0, doc.stock) : 0;
          const available = isVariantAvailable(stock, catalogAvailable);
          return {
            productId: doc.productId,
            typeId: doc.typeId || null,
            subProductId: doc.subProductId || null,
            stock,
            catalogAvailable,
            available,
            status: getStockStatus(stock, catalogAvailable),
            updatedAt: doc.updatedAt || null,
          };
        });
        return ok(res, { inventory: formatted, items: formatted });
      }

      // CRITICAL SERVER-SIDE SECURITY GUARD
      const adminUser = requireAdminAuth(req, res);
      if (!adminUser) return;

      const isSync = action === "sync" || action === "sync_catalog" || req.query?.action === "sync";

      // ----------------------------------------------------
      // B. Synchronization with Catalog
      // ----------------------------------------------------
      if (isSync) {
        if (!catalogItems || catalogItems.length === 0) {
          return serverError(res, new Error("Unable to retrieve products catalog."));
        }

        // Clean up any obsolete availability fields on existing records
        await inventoryCol.updateMany(
          { $or: [{ isAvailable: { $exists: true } }, { stockMode: { $exists: true } }] },
          { $unset: { isAvailable: "", stockMode: "" } }
        );

        const existingDocs = await inventoryCol
          .find({}, { projection: { _id: 0, productId: 1, typeId: 1, subProductId: 1 } })
          .toArray();

        const existingKeySet = new Set(
          existingDocs.map((doc) => makeCanonicalKey(doc.productId, doc.typeId, doc.subProductId))
        );
        const catalogKeySet = new Set(catalogItems.map((item) => item.key));

        const missingItems = catalogItems.filter((item) => !existingKeySet.has(item.key));
        const orphanedCount = existingDocs.filter(
          (doc) => !catalogKeySet.has(makeCanonicalKey(doc.productId, doc.typeId, doc.subProductId))
        ).length;

        let insertedCount = 0;
        if (missingItems.length > 0) {
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
            insertedCount = insertErr.insertedCount !== undefined ? insertErr.insertedCount : 0;
          }
        }

        const currentTotal = await inventoryCol.countDocuments();
        return ok(res, {
          catalogCount: catalogItems.length,
          existingCount: existingDocs.length,
          addedCount: insertedCount,
          orphanedCount,
          totalInventoryCount: currentTotal,
          message: `Inventory synchronized: ${catalogItems.length} catalog items, ${insertedCount} new added.`,
        });
      }

      // ----------------------------------------------------
      // C. Stock Quantity Mutation Actions Only
      // ----------------------------------------------------
      const { productId, typeId, subProductId } = body;

      if (!productId || typeof productId !== "string" || !productId.trim()) {
        return badRequest(res, "Missing or invalid 'productId' in request body.");
      }

      if (action === "set_mode" || action === "set_availability") {
        return badRequest(
          res,
          `Action '${action}' is no longer supported. Product and variant availability is managed exclusively via Markdown frontmatter.`
        );
      }

      const cleanProductId = String(productId).trim();
      const cleanTypeId = normalizeId(typeId) === "_" ? null : normalizeId(typeId);
      const cleanSubProductId = normalizeId(subProductId) === "_" ? null : normalizeId(subProductId);

      const filter = {
        productId: cleanProductId,
        typeId: cleanTypeId,
        subProductId: cleanSubProductId,
      };

      const now = new Date();

      if (action === "set_stock" || action === "set" || (action === "update_stock" && body.adjust === undefined && body.delta === undefined)) {
        const val = parseInt(body.stock ?? body.value, 10);
        if (isNaN(val) || val < 0) {
          return badRequest(res, "stock must be a non-negative integer");
        }
        const updated = await inventoryCol.findOneAndUpdate(
          filter,
          {
            $set: { stock: val, updatedAt: now },
            $unset: { isAvailable: "", stockMode: "" },
            $setOnInsert: { createdAt: now }
          },
          { upsert: true, returnDocument: "after" }
        );
        return ok(res, { action, stock: val, updatedAt: now, inventory: updated, item: updated });
      }

      if (action === "adjust" || action === "increase" || action === "decrease" || action === "update_stock") {
        let delta;
        if (action === "increase") {
          delta = Math.abs(parseInt(body.delta ?? body.adjust ?? body.value ?? body.stock, 10));
        } else if (action === "decrease") {
          delta = -Math.abs(parseInt(body.delta ?? body.adjust ?? body.value ?? body.stock, 10));
        } else {
          delta = parseInt(body.delta ?? body.adjust ?? body.value, 10);
        }

        if (isNaN(delta) || delta === 0) {
          return badRequest(res, "delta/adjust must be a non-zero integer");
        }

        if (delta < 0) {
          const updateRes = await inventoryCol.findOneAndUpdate(
            { ...filter, stock: { $gte: Math.abs(delta) } },
            {
              $inc: { stock: delta },
              $set: { updatedAt: now },
              $unset: { isAvailable: "", stockMode: "" }
            },
            { returnDocument: "after" }
          );
          if (!updateRes) {
            return badRequest(res, "INSUFFICIENT_STOCK: Stock cannot become negative.");
          }
          return ok(res, { action, stock: updateRes.stock, updatedAt: now, inventory: updateRes, item: updateRes });
        } else {
          const updated = await inventoryCol.findOneAndUpdate(
            filter,
            {
              $inc: { stock: delta },
              $set: { updatedAt: now },
              $unset: { isAvailable: "", stockMode: "" },
              $setOnInsert: { createdAt: now }
            },
            { upsert: true, returnDocument: "after" }
          );
          return ok(res, { action, stock: updated ? updated.stock : delta, updatedAt: now, inventory: updated, item: updated });
        }
      }

      return badRequest(res, `Unsupported action '${action}'. Supported: set_stock, adjust, increase, decrease, sync`);
    } catch (err) {
      return serverError(res, err);
    }
  }

  // ==========================================
  // 3. DELETE: Remove inventory item
  // ==========================================
  if (req.method === "DELETE") {
    const adminUser = requireAdminAuth(req, res);
    if (!adminUser) return;

    try {
      const body = await parseBody(req);
      const pId = String(body.productId || req.query?.productId || "").trim();
      const tId = normalizeId(body.typeId || req.query?.typeId);
      const sId = normalizeId(body.subProductId || req.query?.subProductId);

      if (!pId) return badRequest(res, "productId is required for deletion");

      const inventoryCol = await getInventoryCollection();
      const result = await inventoryCol.deleteOne({
        productId: pId,
        typeId: tId === "_" ? null : tId,
        subProductId: sId === "_" ? null : sId,
      });

      return ok(res, { message: "Item deleted", deletedCount: result.deletedCount });
    } catch (err) {
      return serverError(res, err);
    }
  }

  return res.status(405).json({ success: false, error: "Method not allowed" });
};
