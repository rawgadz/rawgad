// api/_catalog.js
// Product Catalog Authority & Hierarchy Resolution for Rawgadz
// Single source of truth for product information (names, images, prices, types, subProducts)

const fs = require("fs");
const path = require("path");

const CATALOG_URL = process.env.CATALOG_URL || "https://notun-rawgadz.vercel.app/products.json";

function getStoreBaseUrl() {
  try {
    return new URL(CATALOG_URL).origin;
  } catch (_) {
    return "";
  }
}

let cachedCatalog = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15000; // 15 seconds memory cache

/**
 * Creates a normalized composite lookup key for inventory items:
 * productId:::typeId:::subProductId (where null is string 'null')
 */
function makeKey(productId, typeId, subProductId) {
  const p = String(productId ?? "").trim();
  const t = (typeId === null || typeId === undefined || typeId === "null" || typeId === "") ? "null" : String(typeId).trim();
  const s = (subProductId === null || subProductId === undefined || subProductId === "null" || subProductId === "") ? "null" : String(subProductId).trim();
  return `${p}:::${t}:::${s}`;
}

/**
 * Normalizes an ID value to null if empty/null
 */
function normalizeId(val) {
  if (val === null || val === undefined || val === "null" || val === "") return null;
  return String(val).trim();
}

/**
 * Stock status classification per TRD specifications
 * If isAvailable is explicitly false, always "out_of_stock".
 * If isAvailable is explicitly true, always purchasable ("in_stock" or "low_stock" if 1-5).
 */
function getStockStatus(stock, isAvailable) {
  if (isAvailable === false) return "out_of_stock";
  if (isAvailable === true) {
    if (typeof stock === "number" && stock > 0 && stock <= 5) return "low_stock";
    return "in_stock";
  }
  if (typeof stock !== "number" || stock <= 0) return "out_of_stock";
  if (stock <= 5) return "low_stock";
  return "in_stock";
}

/**
 * Fetches or reads the raw products catalog.
 * Prioritizes local products.json if present on disk, with remote fallback if configured.
 * @param {boolean} forceFresh - bypass cache if true
 */
async function fetchRawProducts(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedCatalog && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedCatalog;
  }

  // 1. Try local products.json first (fastest, most authoritative within the codebase)
  const localPaths = [
    path.join(process.cwd(), "products.json"),
    path.join(__dirname, "..", "products.json"),
    path.join(__dirname, "products.json"),
  ];

  for (const p of localPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cachedCatalog = parsed;
          lastFetchTime = now;
          return parsed;
        }
      } catch (err) {
        console.warn(`[catalog] Could not parse local file at ${p}:`, err.message);
      }
    }
  }

  // 2. Fetch from remote CATALOG_URL if local file not found or if forced
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const fetchOptions = {
      signal: controller.signal,
      headers: {
        "User-Agent": "Rawgad-Admin-CMS/1.0",
        "Accept": "application/json",
        ...(forceFresh ? { "Cache-Control": "no-cache, no-store, must-revalidate" } : {})
      },
      ...(forceFresh ? { cache: "no-store" } : {})
    };
    const fetchUrl = forceFresh ? `${CATALOG_URL}?_t=${now}` : CATALOG_URL;
    const res = await fetch(fetchUrl, fetchOptions);

    if (!res.ok) {
      throw new Error(`Failed to fetch catalog from ${CATALOG_URL}: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error(`Invalid catalog data received from ${CATALOG_URL}: expected array`);
    }

    cachedCatalog = data;
    lastFetchTime = now;
    return data;
  } catch (err) {
    if (cachedCatalog) {
      console.warn("[catalog] Live fetch failed, using active in-memory cache:", err.message);
      return cachedCatalog;
    }
    throw new Error(`Unable to load products catalog: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Transforms products array into flattened purchasable items per TRD Rules:
 * Rule 1: Type has subProducts -> Each subProduct is a separate item
 *         productId = product.id, typeId = type.subProductId, subProductId = subProduct.subProductId
 * Rule 2: Type has no subProducts -> The type itself is the purchasable item
 *         productId = product.id, typeId = type.subProductId, subProductId = null
 * Rule 3: Product has no types -> The product itself is the purchasable item
 *         productId = product.id, typeId = null, subProductId = null
 */
function extractPurchasableItems(products) {
  const items = [];
  if (!Array.isArray(products)) return items;
  const storeBaseUrl = getStoreBaseUrl();

  for (const product of products) {
    const productId = String(product.id ?? "").trim();
    if (!productId) continue;

    const slug = String(product.slug || "").trim();
    const tab = String(product.tab || "").trim();
    const productUrl = slug ? (storeBaseUrl ? `${storeBaseUrl}/product/${slug}` : `/product/${slug}`) : "";

    const types = Array.isArray(product.types) ? product.types : [];

    if (types.length === 0) {
      // Rule 3: Product with no types
      items.push({
        productId,
        typeId: null,
        subProductId: null,
        key: makeKey(productId, null, null),
        productTitle: product.title || "Untitled Product",
        typeTitle: null,
        subTitle: null,
        displayName: product.title || "Untitled Product",
        price: Number(product.price) || 0,
        imageSrc: product.imageSrc || "",
        tags: product.tags || "",
        slug,
        tab,
        productUrl,
      });
      continue;
    }

    for (const type of types) {
      const typeId = String(type.subProductId || type.id || "").trim();
      const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];

      if (subProducts.length > 0) {
        // Rule 1: Type has nested subProducts
        for (const sub of subProducts) {
          const subProductId = String(sub.subProductId || sub.id || "").trim();
          const itemPrice = typeof sub.price === "number" ? sub.price : (typeof type.price === "number" ? type.price : Number(product.price) || 0);
          const itemImage = sub.subImage || type.subImage || product.imageSrc || "";

          items.push({
            productId,
            typeId,
            subProductId,
            key: makeKey(productId, typeId, subProductId),
            productTitle: product.title || "Untitled Product",
            typeTitle: type.subTitle || "Default Type",
            subTitle: sub.subTitle || "Default Subproduct",
            displayName: `${product.title} - ${type.subTitle || "Type"} (${sub.subTitle || "Option"})`,
            price: itemPrice,
            imageSrc: itemImage,
            tags: product.tags || "",
            slug,
            tab,
            productUrl,
          });
        }
      } else {
        // Rule 2: Type has NO nested subProducts
        const itemPrice = typeof type.price === "number" ? type.price : Number(product.price) || 0;
        const itemImage = type.subImage || product.imageSrc || "";

        items.push({
          productId,
          typeId,
          subProductId: null,
          key: makeKey(productId, typeId, null),
          productTitle: product.title || "Untitled Product",
          typeTitle: type.subTitle || "Default Type",
          subTitle: null,
          displayName: `${product.title} - ${type.subTitle || "Type"}`,
          price: itemPrice,
          imageSrc: itemImage,
          tags: product.tags || "",
          slug,
          tab,
          productUrl,
        });
      }
    }
  }

  return items;
}

/**
 * Builds a hierarchical nested representation of the products catalog with live stock information.
 */
function buildNestedCatalog(products, stockMap = new Map()) {
  if (!Array.isArray(products)) return [];
  const storeBaseUrl = getStoreBaseUrl();

  return products.map((product) => {
    const productId = String(product.id ?? "").trim();
    const slug = String(product.slug || "").trim();
    const tab = String(product.tab || "").trim();
    const productUrl = slug ? (storeBaseUrl ? `${storeBaseUrl}/product/${slug}` : `/product/${slug}`) : "";
    const types = Array.isArray(product.types) ? product.types : [];

    if (types.length === 0) {
      const key = makeKey(productId, null, null);
      const stockDoc = stockMap.get(key);
      const stock = stockDoc && typeof stockDoc.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
      const isAvailable = stockDoc ? (typeof stockDoc.isAvailable === "boolean" ? stockDoc.isAvailable : stock > 0) : (stock > 0);
      const status = getStockStatus(stock, isAvailable);

      return {
        key,
        productId,
        typeId: null,
        subProductId: null,
        title: product.title || "Untitled Product",
        productTitle: product.title || "Untitled Product",
        slug,
        tab,
        productUrl,
        imageSrc: product.imageSrc || "",
        description: product.description || "",
        price: Number(product.price) || 0,
        tags: product.tags || "",
        hasTypes: false,
        hasSubProducts: false,
        totalVariants: 0,
        stock,
        totalStock: stock,
        isAvailable,
        status,
        updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.updated_at || stockDoc.createdAt) : null,
        types: [],
      };
    }

    let productTotalStock = 0;
    let totalVariants = 0;
    let productAnyAvailable = false;

    const mappedTypes = types.map((type) => {
      const typeId = String(type.subProductId || type.id || "").trim();
      const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];
      let typeTotalStock = 0;
      let typeAnyAvailable = false;

      if (subProducts.length > 0) {
        const mappedSubs = subProducts.map((sub) => {
          totalVariants++;
          const subProductId = String(sub.subProductId || sub.id || "").trim();
          const key = makeKey(productId, typeId, subProductId);
          const stockDoc = stockMap.get(key);
          const stock = stockDoc && typeof stockDoc.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
          const isAvailable = stockDoc ? (typeof stockDoc.isAvailable === "boolean" ? stockDoc.isAvailable : stock > 0) : (stock > 0);
          typeTotalStock += stock;
          if (isAvailable) typeAnyAvailable = true;
          const status = getStockStatus(stock, isAvailable);

          const itemPrice = typeof sub.price === "number" ? sub.price : (typeof type.price === "number" ? type.price : Number(product.price) || 0);
          const itemImage = sub.subImage || type.subImage || product.imageSrc || "";

          return {
            key,
            productId,
            typeId,
            subProductId,
            title: sub.subTitle || "Default Subproduct",
            subTitle: sub.subTitle || "Default Subproduct",
            typeTitle: type.subTitle || "Default Type",
            productTitle: product.title || "Untitled Product",
            displayName: `${product.title} - ${type.subTitle || "Type"} (${sub.subTitle || "Option"})`,
            price: itemPrice,
            imageSrc: itemImage,
            stock,
            isAvailable,
            status,
            slug,
            tab,
            productUrl,
            updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.updated_at || stockDoc.createdAt) : null,
          };
        });

        productTotalStock += typeTotalStock;
        if (typeAnyAvailable) productAnyAvailable = true;

        return {
          typeId,
          title: type.subTitle || "Default Type",
          subTitle: type.subTitle || "Default Type",
          hasSubProducts: true,
          subProductsCount: mappedSubs.length,
          totalStock: typeTotalStock,
          isAvailable: typeAnyAvailable,
          subProducts: mappedSubs,
        };
      } else {
        totalVariants++;
        const key = makeKey(productId, typeId, null);
        const stockDoc = stockMap.get(key);
        const stock = stockDoc && typeof stockDoc.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
        const isAvailable = stockDoc ? (typeof stockDoc.isAvailable === "boolean" ? stockDoc.isAvailable : stock > 0) : (stock > 0);
        productTotalStock += stock;
        if (isAvailable) productAnyAvailable = true;
        const status = getStockStatus(stock, isAvailable);

        const itemPrice = typeof type.price === "number" ? type.price : Number(product.price) || 0;
        const itemImage = type.subImage || product.imageSrc || "";

        return {
          typeId,
          title: type.subTitle || "Default Type",
          subTitle: type.subTitle || "Default Type",
          hasSubProducts: false,
          subProductsCount: 0,
          key,
          productId,
          subProductId: null,
          displayName: `${product.title} - ${type.subTitle || "Type"}`,
          price: itemPrice,
          imageSrc: itemImage,
          stock,
          totalStock: stock,
          isAvailable,
          status,
          slug,
          tab,
          productUrl,
          updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.updated_at || stockDoc.createdAt) : null,
          subProducts: [],
        };
      }
    });

    return {
      productId,
      title: product.title || "Untitled Product",
      productTitle: product.title || "Untitled Product",
      slug,
      tab,
      productUrl,
      imageSrc: product.imageSrc || "",
      description: product.description || "",
      price: Number(product.price) || 0,
      tags: product.tags || "",
      hasTypes: true,
      hasSubProducts: mappedTypes.some(t => t.hasSubProducts),
      totalVariants,
      totalStock: productTotalStock,
      isAvailable: productAnyAvailable,
      status: getStockStatus(productTotalStock, productAnyAvailable),
      types: mappedTypes,
    };
  });
}

/**
 * Returns a map of makeKey(productId, typeId, subProductId) -> Item
 */
async function getPurchasableCatalogMap(forceFresh = false) {
  const products = await fetchRawProducts(forceFresh);
  const items = extractPurchasableItems(products);
  const map = new Map();

  for (const item of items) {
    map.set(item.key, item);
  }

  return { map, items, products };
}

/**
 * Helper to resolve exact inventory identity (productId, typeId, subProductId)
 * for an order item, including backward compatibility with legacy orders.
 */
function resolveOrderItemIdentity(item, catalogMap) {
  const rawId = String(item.id || item.productId || "").trim();
  let pId = item.productId || rawId;
  let tId = normalizeId(item.typeId);
  let sId = normalizeId(item.subProductId);

  // 1. Exact composite match
  if (pId && tId !== undefined && catalogMap.has(makeKey(pId, tId, sId))) {
    const cat = catalogMap.get(makeKey(pId, tId, sId));
    return { productId: cat.productId, typeId: cat.typeId, subProductId: cat.subProductId, cat };
  }

  // 2. Legacy resolution when typeId is missing but subProductId exists
  if (sId) {
    for (const cat of catalogMap.values()) {
      if (cat.subProductId === sId) {
        return { productId: cat.productId, typeId: cat.typeId, subProductId: cat.subProductId, cat };
      }
    }
  }

  // 3. Legacy resolution when rawId was the subProductId or typeId
  for (const cat of catalogMap.values()) {
    if (cat.subProductId === rawId || (cat.subProductId === null && cat.typeId === rawId)) {
      return { productId: cat.productId, typeId: cat.typeId, subProductId: cat.subProductId, cat };
    }
  }

  // 4. Fallback matching product ID only
  for (const cat of catalogMap.values()) {
    if (cat.productId === pId) {
      return { productId: cat.productId, typeId: cat.typeId, subProductId: cat.subProductId, cat };
    }
  }

  return { productId: pId, typeId: tId, subProductId: sId, cat: null };
}

module.exports = {
  CATALOG_URL,
  getStoreBaseUrl,
  makeKey,
  normalizeId,
  getStockStatus,
  fetchRawProducts,
  extractPurchasableItems,
  buildNestedCatalog,
  getPurchasableCatalogMap,
  resolveOrderItemIdentity,
};
