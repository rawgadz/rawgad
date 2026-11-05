// js/stock.js
// Storefront helper for product availability filtering and physical stock caching.

(function () {
  const STOCK_CACHE_KEY = "rawgadz_stock_cache_v3";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  let fetchPromise = null;
  let memoryCache = null;

  function normalizeId(val) {
    if (val === null || val === undefined || val === "" || val === "null" || val === "_") return "_";
    const s = String(val).trim();
    return s === "" || s === "null" || s === "_" ? "_" : s;
  }

  function makeCompositeKey(productId, typeId, subProductId) {
    return `${normalizeId(productId)}:::${normalizeId(typeId)}:::${normalizeId(subProductId)}`;
  }

  /**
   * Resolves effective availability for a product and its nested variants/sub-products
   * based on Markdown-compiled `available` booleans in products.json.
   */
  function resolveProductAvailability(product) {
    if (!product || typeof product !== "object") return null;
    const baseProductAvailable = typeof product.available === "boolean" ? product.available : true;
    const rawTypes = Array.isArray(product.types) ? product.types : [];

    if (rawTypes.length === 0) {
      return {
        ...product,
        available: baseProductAvailable,
        types: []
      };
    }

    const resolvedTypes = rawTypes.map((type) => {
      const inheritedTypeAvailable = typeof type.available === "boolean" ? type.available : baseProductAvailable;
      const parentAndTypeAvailable = Boolean(baseProductAvailable && inheritedTypeAvailable);
      const rawSubs = Array.isArray(type.subProducts) ? type.subProducts : [];

      if (rawSubs.length === 0) {
        return {
          ...type,
          available: parentAndTypeAvailable
        };
      }

      const resolvedSubs = rawSubs.map((sub) => {
        const inheritedSubAvailable = typeof sub.available === "boolean" ? sub.available : parentAndTypeAvailable;
        return {
          ...sub,
          available: Boolean(parentAndTypeAvailable && inheritedSubAvailable)
        };
      });

      const anySubAvailable = resolvedSubs.some((s) => s.available === true);
      return {
        ...type,
        available: Boolean(parentAndTypeAvailable && anySubAvailable),
        subProducts: resolvedSubs
      };
    });

    const anyTypeAvailable = resolvedTypes.some((t) => t.available === true);
    return {
      ...product,
      available: Boolean(baseProductAvailable && anyTypeAvailable),
      types: resolvedTypes
    };
  }

  /**
   * Computes priceRange { min, max } across available variants (or base price if no variants).
   */
  function computeAvailablePriceRange(product) {
    const basePrice = typeof product.price === "number" && !isNaN(product.price) ? product.price : 0;
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
          if (typeof p === "number" && !isNaN(p)) prices.push(p);
        }
      } else {
        const p = typeof type.price === "number" ? type.price : basePrice;
        if (typeof p === "number" && !isNaN(p)) prices.push(p);
      }
    }

    if (prices.length === 0) {
      return { min: basePrice, max: basePrice };
    }
    return {
      min: Math.min(...prices),
      max: Math.max(...prices)
    };
  }

  /**
   * Filters a single product for customer-facing storefront usage:
   * - Excludes unavailable products (returns null).
   * - Filters out unavailable types and unavailable subProducts.
   * - Excludes products whose variants are all unavailable (returns null).
   * - Recomputes priceRange from remaining available variants.
   */
  function filterProductForStorefront(product) {
    const resolved = resolveProductAvailability(product);
    if (!resolved || !resolved.available) return null;

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
          subProducts: availableSubs
        });
      } else {
        availableTypes.push({
          ...type,
          available: true
        });
      }
    }

    if (availableTypes.length === 0) return null;

    const filtered = {
      ...resolved,
      available: true,
      types: availableTypes
    };
    filtered.priceRange = computeAvailablePriceRange(filtered);
    return filtered;
  }

  /**
   * Centrally filters an array of products for storefront listings, search, and categories.
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

  function extractInventoryRows(data) {
    if (!data) return [];
    if (Array.isArray(data.inventory)) return data.inventory;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    return [];
  }

  function normalizeInventoryPayload(data) {
    const rows = extractInventoryRows(data);
    const items = [];
    const stockMap = {};
    const availabilityMap = {};

    for (const item of rows) {
      if (!item || item.productId === undefined || item.productId === null) continue;

      const productId = String(item.productId);
      const typeId = normalizeId(item.typeId) === "_" ? null : String(item.typeId);
      const subProductId = normalizeId(item.subProductId) === "_" ? null : String(item.subProductId);

      const rawStock = typeof item.stock === "number" ? item.stock : Number(item.stock) || 0;
      const stock = Math.max(0, rawStock);
      const catalogAvailable = typeof item.available === "boolean" ? item.available : true;
      const available = Boolean(catalogAvailable && stock > 0);
      const status = !available ? "out_of_stock" : (stock <= 5 ? "low_stock" : "in_stock");

      const key = makeCompositeKey(productId, typeId, subProductId);

      const normalizedItem = {
        key,
        productId,
        typeId,
        subProductId,
        stock,
        available,
        status,
        updatedAt: item.updatedAt || null
      };

      items.push(normalizedItem);
      stockMap[key] = stock;
      availabilityMap[key] = available;
    }

    return {
      timestamp: Date.now(),
      items,
      stockMap,
      availabilityMap
    };
  }

  function saveCache(payload) {
    memoryCache = payload;
    try {
      localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn("Could not write stock cache to localStorage:", e);
    }
  }

  function getCachedStock() {
    if (memoryCache && memoryCache.timestamp && Date.now() - memoryCache.timestamp <= CACHE_TTL_MS) {
      return memoryCache;
    }

    try {
      const raw = localStorage.getItem(STOCK_CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.timestamp) return null;

      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
        localStorage.removeItem(STOCK_CACHE_KEY);
        return null;
      }

      if (!parsed.stockMap || typeof parsed.stockMap !== "object") {
        parsed.stockMap = {};
      }
      if (!parsed.availabilityMap || typeof parsed.availabilityMap !== "object") {
        parsed.availabilityMap = {};
      }

      memoryCache = parsed;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function clearStockCache() {
    memoryCache = null;
    try {
      localStorage.removeItem(STOCK_CACHE_KEY);
    } catch (e) {}
  }

  async function fetchAndStoreAllStock(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = getCachedStock();
      if (cached) return cached;
    }

    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
      try {
        const res = await fetch("/api/inventory", {
          method: "GET",
          headers: { Accept: "application/json" }
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data && data.success === false) {
          throw new Error(data.error || "Failed to load inventory");
        }

        const payload = normalizeInventoryPayload(data);
        saveCache(payload);

        window.dispatchEvent(
          new CustomEvent("rawgad-stock-updated", {
            detail: {
              stockMap: payload.stockMap,
              availabilityMap: payload.availabilityMap,
              inventory: payload.items
            }
          })
        );

        return payload;
      } catch (err) {
        console.warn("Error fetching inventory:", err);
        const fallback = getCachedStock();
        return fallback || { timestamp: Date.now(), items: [], stockMap: {}, availabilityMap: {} };
      } finally {
        fetchPromise = null;
      }
    })();

    return fetchPromise;
  }

  function getItemStock(productId, typeId = null, subProductId = null) {
    const cached = getCachedStock();
    if (!cached || !cached.stockMap) return 0;

    const exactKey = makeCompositeKey(productId, typeId, subProductId);
    if (Object.prototype.hasOwnProperty.call(cached.stockMap, exactKey)) {
      return cached.stockMap[exactKey];
    }

    if (normalizeId(subProductId) !== "_") {
      const typeKey = makeCompositeKey(productId, typeId, "_");
      if (Object.prototype.hasOwnProperty.call(cached.stockMap, typeKey)) {
        return cached.stockMap[typeKey];
      }
    }

    if (normalizeId(typeId) !== "_" || normalizeId(subProductId) !== "_") {
      const baseKey = makeCompositeKey(productId, "_", "_");
      if (Object.prototype.hasOwnProperty.call(cached.stockMap, baseKey)) {
        return cached.stockMap[baseKey];
      }
    }

    return 0;
  }

  function isItemAvailable(productId, typeId = null, subProductId = null) {
    const cached = getCachedStock();
    if (!cached || !cached.availabilityMap) return true;

    const exactKey = makeCompositeKey(productId, typeId, subProductId);
    if (Object.prototype.hasOwnProperty.call(cached.availabilityMap, exactKey)) {
      return Boolean(cached.availabilityMap[exactKey]);
    }

    const pPrefix = `${normalizeId(productId)}:::`;

    if (normalizeId(typeId) === "_" && normalizeId(subProductId) === "_") {
      const keys = Object.keys(cached.availabilityMap).filter((k) => k.startsWith(pPrefix));
      if (keys.length > 0) {
        return keys.some((k) => Boolean(cached.availabilityMap[k]));
      }
    }

    if (normalizeId(typeId) !== "_" && normalizeId(subProductId) === "_") {
      const tPrefix = `${normalizeId(productId)}:::${normalizeId(typeId)}:::`;
      const keys = Object.keys(cached.availabilityMap).filter((k) => k.startsWith(tPrefix));
      if (keys.length > 0) {
        return keys.some((k) => Boolean(cached.availabilityMap[k]));
      }
    }

    return false;
  }

  function getProductStockMap(productId) {
    const cached = getCachedStock();
    const map = {};
    if (!cached || !cached.stockMap) return map;

    const pId = normalizeId(productId);
    const prefix = `${pId}:::`;

    for (const [key, stockVal] of Object.entries(cached.stockMap)) {
      if (key.startsWith(prefix)) {
        const parts = key.split(":::");
        const tId = parts[1] || "_";
        const sId = parts[2] || "_";

        map[key] = stockVal;
        map[`${tId}:::${sId}`] = stockVal;

        if (sId === "_") {
          map[tId] = stockVal;
        }
        if (tId === "_" && sId === "_") {
          map["_"] = stockVal;
          map["base"] = stockVal;
        }
      }
    }

    return map;
  }

  function getProductAvailabilityMap(productId) {
    const cached = getCachedStock();
    const map = {};
    if (!cached || !cached.availabilityMap) return map;

    const pId = normalizeId(productId);
    const prefix = `${pId}:::`;

    for (const [key, availVal] of Object.entries(cached.availabilityMap)) {
      if (key.startsWith(prefix)) {
        const parts = key.split(":::");
        const tId = parts[1] || "_";
        const sId = parts[2] || "_";

        map[key] = availVal;
        map[`${tId}:::${sId}`] = availVal;

        if (sId === "_") {
          map[tId] = availVal;
        }
        if (tId === "_" && sId === "_") {
          map["_"] = availVal;
          map["base"] = availVal;
        }
      }
    }

    return map;
  }

  function getStockMap() {
    const cached = getCachedStock();
    return cached && cached.stockMap ? cached.stockMap : {};
  }

  function getAvailabilityMap() {
    const cached = getCachedStock();
    return cached && cached.availabilityMap ? cached.availabilityMap : {};
  }

  window.RawgadStock = {
    normalizeId,
    makeCompositeKey,
    resolveProductAvailability,
    computeAvailablePriceRange,
    filterProductForStorefront,
    filterAvailableProducts,
    fetchAndStoreAllStock,
    getCachedStock,
    clearStockCache,
    getStockMap,
    getAvailabilityMap,
    getItemStock,
    isItemAvailable,
    getProductStockMap,
    getProductAvailabilityMap
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => fetchAndStoreAllStock(false));
    } else {
      fetchAndStoreAllStock(false);
    }
  }
})();
