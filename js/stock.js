// js/stock.js
// Storefront availability manager backed by canonical /data/products.json

(function () {
  const STOCK_CACHE_KEY = "rawgadz_availability_cache_v4";
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

  function populateAvailabilityFromProduct(rawProduct, availabilityMap, items) {
    const product = resolveProductAvailability(rawProduct);
    if (!product || !product.id) return;

    const pId = String(product.id).trim();
    const baseKey = makeCompositeKey(pId, "_", "_");
    const prodAvail = Boolean(product.available);
    availabilityMap[baseKey] = prodAvail;

    const types = Array.isArray(product.types) ? product.types : [];
    if (types.length === 0) {
      if (items) {
        items.push({
          key: baseKey,
          productId: pId,
          typeId: null,
          subProductId: null,
          available: prodAvail,
          status: prodAvail ? "in_stock" : "out_of_stock"
        });
      }
      return;
    }

    for (const type of types) {
      const tId = String(type.subProductId || type.id || "").trim();
      const typeAvail = Boolean(product.available && type.available);
      const typeKey = makeCompositeKey(pId, tId, "_");
      availabilityMap[typeKey] = typeAvail;

      const subs = Array.isArray(type.subProducts) ? type.subProducts : [];
      if (subs.length > 0) {
        for (const sub of subs) {
          const sId = String(sub.subProductId || sub.id || "").trim();
          const subAvail = Boolean(typeAvail && sub.available);
          const subKey = makeCompositeKey(pId, tId, sId);
          availabilityMap[subKey] = subAvail;
          if (items) {
            items.push({
              key: subKey,
              productId: pId,
              typeId: tId,
              subProductId: sId,
              available: subAvail,
              status: subAvail ? "in_stock" : "out_of_stock"
            });
          }
        }
      } else if (items) {
        items.push({
          key: typeKey,
          productId: pId,
          typeId: tId,
          subProductId: null,
          available: typeAvail,
          status: typeAvail ? "in_stock" : "out_of_stock"
        });
      }
    }
  }

  function normalizeProductsPayload(products) {
    const list = Array.isArray(products) ? products : [];
    const items = [];
    const availabilityMap = {};

    for (const rawProduct of list) {
      populateAvailabilityFromProduct(rawProduct, availabilityMap, items);
    }

    return {
      timestamp: Date.now(),
      items,
      availabilityMap
    };
  }

  function saveCache(payload) {
    memoryCache = payload;
    try {
      localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }

  function getCachedStock() {
    if (memoryCache && memoryCache.timestamp && Date.now() - memoryCache.timestamp <= CACHE_TTL_MS) {
      return memoryCache;
    }

    try {
      const raw = localStorage.getItem(STOCK_CACHE_KEY);
      if (!raw) return memoryCache || null;

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.timestamp) return memoryCache || null;

      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
        localStorage.removeItem(STOCK_CACHE_KEY);
        return memoryCache || null;
      }

      if (!parsed.availabilityMap || typeof parsed.availabilityMap !== "object") {
        parsed.availabilityMap = {};
      }

      memoryCache = parsed;
      return parsed;
    } catch (e) {
      return memoryCache || null;
    }
  }

  function registerProduct(rawProduct) {
    if (!rawProduct || typeof rawProduct !== "object") return;
    const current = getCachedStock() || {
      timestamp: Date.now(),
      items: [],
      availabilityMap: {}
    };
    populateAvailabilityFromProduct(rawProduct, current.availabilityMap, current.items);
    memoryCache = current;
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
      if (cached && Object.keys(cached.availabilityMap || {}).length > 0) return cached;
    }

    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
      try {
        const res = await fetch("/data/products.json", {
          method: "GET",
          headers: { Accept: "application/json" }
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const payload = normalizeProductsPayload(data);
        saveCache(payload);

        if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
          window.dispatchEvent(
            new CustomEvent("rawgad-stock-updated", {
              detail: {
                availabilityMap: payload.availabilityMap,
                items: payload.items
              }
            })
          );
        }

        return payload;
      } catch (err) {
        const fallback = getCachedStock();
        return fallback || { timestamp: Date.now(), items: [], availabilityMap: {} };
      } finally {
        fetchPromise = null;
      }
    })();

    return fetchPromise;
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

    return true;
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

  function getAvailabilityMap() {
    const cached = getCachedStock();
    return cached && cached.availabilityMap ? cached.availabilityMap : {};
  }

  function init() {
    return fetchAndStoreAllStock(false);
  }

  window.RawgadStock = {
    init,
    normalizeId,
    makeCompositeKey,
    resolveProductAvailability,
    computeAvailablePriceRange,
    registerProduct,
    fetchAndStoreAllStock,
    getCachedStock,
    clearStockCache,
    getAvailabilityMap,
    isItemAvailable,
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
