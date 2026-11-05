// api/_catalog.js
// Single source of truth for products, variants, and availability directly from data/products.json

const fs = require("fs");
const path = require("path");

function normalizeId(val) {
  if (val === null || val === undefined || val === "" || val === "null" || val === "_") return "_";
  const s = String(val).trim();
  return (s === "" || s === "null" || s === "_") ? "_" : s;
}

function makeCanonicalKey(productId, typeId, subProductId) {
  return `${normalizeId(productId)}:::${normalizeId(typeId)}:::${normalizeId(subProductId)}`;
}

/**
 * Strictly validates that an availability value is a boolean if provided.
 * Strings like "false" or "true", numbers, or null are rejected.
 */
function validateBooleanField(val, fieldLabel = "available") {
  if (val === undefined) return undefined;
  if (typeof val === "boolean") return val;
  throw new Error(
    `Invalid availability value for ${fieldLabel}: expected boolean (true or false), got ${typeof val} (${JSON.stringify(val)})`
  );
}

/**
 * Resolves effective availability for a product and all of its variants/sub-products.
 * Rules:
 * - Missing product.available defaults to true.
 * - Variant without explicit available inherits parent's availability.
 * - If parent product is unavailable (false), all variants/sub-products are unavailable.
 * - If a variant has sub-products and all sub-products are unavailable, that variant is effectively unavailable.
 * - If a product has variants and all variants are unavailable, the product is effectively unavailable.
 */
function resolveProductAvailability(product, contextPrefix = "") {
  if (!product || typeof product !== "object") return product;
  const prefix = contextPrefix ? `${contextPrefix}:` : (product.id ? `product(${product.id}):` : "");

  const rawProductAvailable = validateBooleanField(product.available, `${prefix}available`);
  const baseProductAvailable = rawProductAvailable !== undefined ? rawProductAvailable : true;

  const rawTypes = Array.isArray(product.types) ? product.types : [];
  if (rawTypes.length === 0) {
    return {
      ...product,
      available: baseProductAvailable,
      types: [],
    };
  }

  const resolvedTypes = rawTypes.map((type, tIdx) => {
    const rawTypeAvailable = validateBooleanField(type.available, `${prefix}types[${tIdx}].available`);
    const inheritedTypeAvailable = rawTypeAvailable !== undefined ? rawTypeAvailable : baseProductAvailable;
    const parentAndTypeAvailable = Boolean(baseProductAvailable && inheritedTypeAvailable);

    const rawSubs = Array.isArray(type.subProducts) ? type.subProducts : [];
    if (rawSubs.length === 0) {
      return {
        ...type,
        available: parentAndTypeAvailable,
      };
    }

    const resolvedSubs = rawSubs.map((sub, sIdx) => {
      const rawSubAvailable = validateBooleanField(
        sub.available,
        `${prefix}types[${tIdx}].subProducts[${sIdx}].available`
      );
      const inheritedSubAvailable = rawSubAvailable !== undefined ? rawSubAvailable : parentAndTypeAvailable;
      return {
        ...sub,
        available: Boolean(parentAndTypeAvailable && inheritedSubAvailable),
      };
    });

    const anySubAvailable = resolvedSubs.some((s) => s.available === true);
    return {
      ...type,
      available: Boolean(parentAndTypeAvailable && anySubAvailable),
      subProducts: resolvedSubs,
    };
  });

  const anyTypeAvailable = resolvedTypes.some((t) => t.available === true);
  return {
    ...product,
    available: Boolean(baseProductAvailable && anyTypeAvailable),
    types: resolvedTypes,
  };
}

/**
 * Computes priceRange { min, max } across available variants (or base price if no variants).
 */
function computeAvailablePriceRange(product) {
  const basePrice = typeof product.price === "number" && !Number.isNaN(product.price) ? product.price : 0;
  const types = Array.isArray(product.types) ? product.types : [];
  if (types.length === 0) {
    return { min: basePrice, max: basePrice };
  }

  const prices = [];
  for (const type of types) {
    if (type.available === false) continue;
    const subs = Array.isArray(type.subProducts) ? type.subProducts : [];
    const availableSubs = subs.filter((s) => s.available !== false);
    if (subs.length > 0) {
      for (const sub of availableSubs) {
        const p = typeof sub.price === "number" ? sub.price : (typeof type.price === "number" ? type.price : basePrice);
        if (typeof p === "number" && !Number.isNaN(p)) prices.push(p);
      }
    } else {
      const p = typeof type.price === "number" ? type.price : basePrice;
      if (typeof p === "number" && !Number.isNaN(p)) prices.push(p);
    }
  }

  if (prices.length === 0) {
    return { min: basePrice, max: basePrice };
  }
  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

/**
 * Filters a single product for customer-facing storefront usage:
 * - Returns null if the product is effectively unavailable.
 * - Filters out unavailable types and unavailable subProducts.
 * - Returns null if a variant product has no available variants left.
 * - Recomputes priceRange from remaining available variants.
 */
function filterProductForStorefront(product) {
  if (!product || typeof product !== "object") return null;
  const resolved = resolveProductAvailability(product);
  if (!resolved.available) return null;

  const rawTypes = Array.isArray(resolved.types) ? resolved.types : [];
  if (rawTypes.length === 0) {
    return resolved;
  }

  const availableTypes = [];
  for (const type of rawTypes) {
    if (!type.available) continue;
    const rawSubs = Array.isArray(type.subProducts) ? type.subProducts : [];
    if (rawSubs.length > 0) {
      const availableSubs = rawSubs.filter((s) => s.available === true);
      if (availableSubs.length === 0) continue;
      availableTypes.push({
        ...type,
        available: true,
        subProducts: availableSubs,
      });
    } else {
      availableTypes.push({
        ...type,
        available: true,
      });
    }
  }

  if (availableTypes.length === 0) return null;

  const filteredProduct = {
    ...resolved,
    available: true,
    types: availableTypes,
  };
  filteredProduct.priceRange = computeAvailablePriceRange(filteredProduct);
  return filteredProduct;
}

/**
 * Centrally filters an array of products for storefront listings, search, and pages.
 */
function filterAvailableProducts(products) {
  if (!Array.isArray(products)) return [];
  const result = [];
  for (const p of products) {
    const filtered = filterProductForStorefront(p);
    if (filtered) result.push(filtered);
  }
  return result;
}

function isVariantAvailable(stock, catalogAvailable = true) {
  return Boolean(catalogAvailable) && Number(stock) > 0;
}

function getStockStatus(stock, catalogAvailable = true) {
  if (!catalogAvailable) return "out_of_stock";
  const s = Number(stock) || 0;
  if (s <= 0) return "out_of_stock";
  if (s <= 5) return "low_stock";
  return "in_stock";
}

function loadProductsJson() {
  const pPath = path.join(process.cwd(), "data", "products.json");
  if (!fs.existsSync(pPath)) {
    throw new Error(`data/products.json not found at ${pPath}`);
  }
  return JSON.parse(fs.readFileSync(pPath, "utf8"));
}

function extractPurchasableItems(products) {
  const items = [];
  if (!Array.isArray(products)) return items;

  for (const rawProduct of products) {
    const product = resolveProductAvailability(rawProduct);
    const productId = String(product.id ?? "").trim();
    if (!productId) continue;

    const slug = String(product.slug || "").trim();
    const tab = String(product.tab || "").trim();
    const productUrl = slug && product.available ? `/product/${slug}` : "";
    const types = Array.isArray(product.types) ? product.types : [];

    if (types.length === 0) {
      items.push({
        productId,
        typeId: null,
        subProductId: null,
        key: makeCanonicalKey(productId, "_", "_"),
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
        available: Boolean(product.available),
      });
      continue;
    }

    for (const type of types) {
      const typeId = String(type.subProductId || type.id || "").trim();
      const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];

      if (subProducts.length > 0) {
        for (const sub of subProducts) {
          const subProductId = String(sub.subProductId || sub.id || "").trim();
          const itemPrice = typeof sub.price === "number" ? sub.price : (typeof type.price === "number" ? type.price : Number(product.price) || 0);
          const itemImage = sub.subImage || type.subImage || product.imageSrc || "";

          items.push({
            productId,
            typeId,
            subProductId,
            key: makeCanonicalKey(productId, typeId, subProductId),
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
            available: Boolean(product.available && type.available && sub.available),
          });
        }
      } else {
        const itemPrice = typeof type.price === "number" ? type.price : Number(product.price) || 0;
        const itemImage = type.subImage || product.imageSrc || "";

        items.push({
          productId,
          typeId,
          subProductId: null,
          key: makeCanonicalKey(productId, typeId, "_"),
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
          available: Boolean(product.available && type.available),
        });
      }
    }
  }

  return items;
}

function buildNestedCatalog(products, stockMap = new Map()) {
  if (!Array.isArray(products)) return [];

  return products.map((rawProduct) => {
    const product = resolveProductAvailability(rawProduct);
    const productId = String(product.id ?? "").trim();
    const slug = String(product.slug || "").trim();
    const tab = String(product.tab || "").trim();
    const productUrl = slug && product.available ? `/product/${slug}` : "";
    const types = Array.isArray(product.types) ? product.types : [];

    if (types.length === 0) {
      const key = makeCanonicalKey(productId, "_", "_");
      const stockDoc = stockMap.get(key);
      const stock = typeof stockDoc?.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
      const catalogAvailable = Boolean(product.available);
      const available = isVariantAvailable(stock, catalogAvailable);
      const status = getStockStatus(stock, catalogAvailable);

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
        catalogAvailable,
        available,
        status,
        updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.createdAt) : null,
        types: [],
      };
    }

    let productTotalStock = 0;
    let totalVariants = 0;
    let productAnyInStock = false;

    const mappedTypes = types.map((type) => {
      const typeId = String(type.subProductId || type.id || "").trim();
      const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];
      let typeTotalStock = 0;
      let typeAnyInStock = false;

      if (subProducts.length > 0) {
        const mappedSubs = subProducts.map((sub) => {
          totalVariants++;
          const subProductId = String(sub.subProductId || sub.id || "").trim();
          const key = makeCanonicalKey(productId, typeId, subProductId);
          const stockDoc = stockMap.get(key);
          const stock = typeof stockDoc?.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
          const catalogAvailable = Boolean(product.available && type.available && sub.available);
          const available = isVariantAvailable(stock, catalogAvailable);

          typeTotalStock += stock;
          if (available) typeAnyInStock = true;
          const status = getStockStatus(stock, catalogAvailable);

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
            displayName: `${product.title} - ${type.subTitle || "Type"} (${sub.subTitle || "Option"})`,
            price: itemPrice,
            imageSrc: itemImage,
            stock,
            catalogAvailable,
            available,
            status,
            slug,
            tab,
            productUrl,
            updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.createdAt) : null,
          };
        });

        productTotalStock += typeTotalStock;
        if (typeAnyInStock) productAnyInStock = true;

        return {
          typeId,
          title: type.subTitle || "Default Type",
          subTitle: type.subTitle || "Default Type",
          hasSubProducts: true,
          subProductsCount: mappedSubs.length,
          totalStock: typeTotalStock,
          catalogAvailable: Boolean(product.available && type.available),
          available: typeAnyInStock,
          subProducts: mappedSubs,
        };
      } else {
        totalVariants++;
        const key = makeCanonicalKey(productId, typeId, "_");
        const stockDoc = stockMap.get(key);
        const stock = typeof stockDoc?.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
        const catalogAvailable = Boolean(product.available && type.available);
        const available = isVariantAvailable(stock, catalogAvailable);

        productTotalStock += stock;
        if (available) productAnyInStock = true;
        const status = getStockStatus(stock, catalogAvailable);

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
          catalogAvailable,
          available,
          status,
          slug,
          tab,
          productUrl,
          updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.createdAt) : null,
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
      hasSubProducts: mappedTypes.some((t) => t.hasSubProducts),
      totalVariants,
      totalStock: productTotalStock,
      catalogAvailable: Boolean(product.available),
      available: productAnyInStock,
      status: productAnyInStock ? "in_stock" : "out_of_stock",
      types: mappedTypes,
    };
  });
}

function getPurchasableCatalogMap() {
  const products = loadProductsJson();
  const items = extractPurchasableItems(products);
  const map = new Map();
  for (const item of items) {
    map.set(item.key, item);
  }
  return { map, items, products };
}

module.exports = {
  normalizeId,
  makeCanonicalKey,
  validateBooleanField,
  resolveProductAvailability,
  computeAvailablePriceRange,
  filterProductForStorefront,
  filterAvailableProducts,
  isVariantAvailable,
  getStockStatus,
  loadProductsJson,
  extractPurchasableItems,
  buildNestedCatalog,
  getPurchasableCatalogMap,
};
