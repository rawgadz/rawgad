// api/_catalog.js
// Single source of truth for products & variants directly from data/products.json

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

function isVariantAvailable(stockMode, isAvailable, stock) {
  if (stockMode === "unlimited") {
    return Boolean(isAvailable);
  }
  return Number(stock) > 0;
}

function getStockStatus(stockMode, isAvailable, stock) {
  const available = isVariantAvailable(stockMode, isAvailable, stock);
  if (!available) return "out_of_stock";
  if (stockMode === "quantity") {
    const s = Number(stock) || 0;
    if (s > 0 && s <= 5) return "low_stock";
  }
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

  for (const product of products) {
    const productId = String(product.id ?? "").trim();
    if (!productId) continue;

    const slug = String(product.slug || "").trim();
    const tab = String(product.tab || "").trim();
    const productUrl = slug ? `/product/${slug}` : "";
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
        });
      }
    }
  }

  return items;
}

function buildNestedCatalog(products, stockMap = new Map()) {
  if (!Array.isArray(products)) return [];

  return products.map((product) => {
    const productId = String(product.id ?? "").trim();
    const slug = String(product.slug || "").trim();
    const tab = String(product.tab || "").trim();
    const productUrl = slug ? `/product/${slug}` : "";
    const types = Array.isArray(product.types) ? product.types : [];

    if (types.length === 0) {
      const key = makeCanonicalKey(productId, "_", "_");
      const stockDoc = stockMap.get(key);
      const stockMode = stockDoc?.stockMode || "quantity";
      const stock = typeof stockDoc?.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
      const isAvailable = stockDoc ? Boolean(stockDoc.isAvailable) : false;
      const available = isVariantAvailable(stockMode, isAvailable, stock);
      const status = getStockStatus(stockMode, isAvailable, stock);

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
        stockMode,
        stock,
        totalStock: stock,
        isAvailable,
        available,
        status,
        updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.createdAt) : null,
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
          const key = makeCanonicalKey(productId, typeId, subProductId);
          const stockDoc = stockMap.get(key);
          const stockMode = stockDoc?.stockMode || "quantity";
          const stock = typeof stockDoc?.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
          const isAvailable = stockDoc ? Boolean(stockDoc.isAvailable) : false;
          const available = isVariantAvailable(stockMode, isAvailable, stock);

          typeTotalStock += stock;
          if (available) typeAnyAvailable = true;
          const status = getStockStatus(stockMode, isAvailable, stock);

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
            stockMode,
            stock,
            isAvailable,
            available,
            status,
            slug,
            tab,
            productUrl,
            updatedAt: stockDoc ? (stockDoc.updatedAt || stockDoc.createdAt) : null,
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
        const key = makeCanonicalKey(productId, typeId, "_");
        const stockDoc = stockMap.get(key);
        const stockMode = stockDoc?.stockMode || "quantity";
        const stock = typeof stockDoc?.stock === "number" ? Math.max(0, stockDoc.stock) : 0;
        const isAvailable = stockDoc ? Boolean(stockDoc.isAvailable) : false;
        const available = isVariantAvailable(stockMode, isAvailable, stock);

        productTotalStock += stock;
        if (available) productAnyAvailable = true;
        const status = getStockStatus(stockMode, isAvailable, stock);

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
          stockMode,
          stock,
          totalStock: stock,
          isAvailable,
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
      isAvailable: productAnyAvailable,
      status: productAnyAvailable ? "in_stock" : "out_of_stock",
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
  isVariantAvailable,
  getStockStatus,
  loadProductsJson,
  extractPurchasableItems,
  buildNestedCatalog,
  getPurchasableCatalogMap,
};
