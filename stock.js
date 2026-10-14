// stock.js
// Universal Client-Side Stock & Inventory Cache Manager for Rawgadz
// Handles 24-hour localStorage caching and bulk inventory synchronization.

(function(window) {
  'use strict';

  const STORAGE_KEY = 'rawgad_inventory_stock';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours in milliseconds

  let memoryCache = null;
  let fetchPromise = null;

  /**
   * Validates if a cache object is within the 24-hour TTL and has valid structure.
   */
  function isValidCache(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.timestamp || typeof data.timestamp !== 'number') return false;
    if (!Array.isArray(data.inventory)) return false;
    if (!data.stockMap || !data.availabilityMap) return false;
    const age = Date.now() - data.timestamp;
    return age >= 0 && age < CACHE_TTL_MS;
  }

  /**
   * Safely reads and parses the stock cache from localStorage.
   */
  function readLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (isValidCache(parsed)) {
        return parsed;
      }
      return null;
    } catch (e) {
      console.warn('[RawgadStock] Could not read from localStorage:', e);
      return null;
    }
  }

  /**
   * Compiles O(1) multi-key lookup maps for stock and availability from the inventory items array.
   */
  function buildStockMaps(inventory) {
    const stockMap = {};
    const availabilityMap = {};
    if (!Array.isArray(inventory)) return { stockMap, availabilityMap };

    for (const item of inventory) {
      const pId = item.productId != null ? String(item.productId).trim() : '';
      const tId = (item.typeId != null && item.typeId !== 'null') ? String(item.typeId).trim() : 'null';
      const sId = (item.subProductId != null && item.subProductId !== 'null') ? String(item.subProductId).trim() : 'null';
      const isAvail = (typeof item.isAvailable === 'boolean')
        ? item.isAvailable
        : (item.stockType === 'available' || (typeof item.stock === 'number' && item.stock > 0));
      const stock = typeof item.stock === 'number' ? Math.max(0, item.stock) : 0;

      function setEntry(k) {
        stockMap[k] = stock;
        availabilityMap[k] = isAvail;
      }

      // 1. Triple key: productId:::typeId:::subProductId
      setEntry(`${pId}:::${tId}:::${sId}`);

      // 2. Variant pair key: typeId:::subProductId
      setEntry(`${tId}:::${sId}`);

      // 3. Direct subProductId key
      if (sId !== 'null') {
        setEntry(sId);
        setEntry(`${pId}:::${sId}`);
      }

      // 4. Direct typeId key (when variant has no nested subproduct)
      if (tId !== 'null' && sId === 'null') {
        setEntry(tId);
        setEntry(`${pId}:::${tId}`);
      }

      // 5. Product-level summary/max fallback
      if (pId) {
        if (!stockMap[pId] || stockMap[pId] < stock) {
          stockMap[pId] = stock;
        }
        if (availabilityMap[pId] === undefined || isAvail) {
          availabilityMap[pId] = availabilityMap[pId] || isAvail;
        }
      }
    }
    return { stockMap, availabilityMap };
  }

  function buildStockMap(inventory) {
    return buildStockMaps(inventory).stockMap;
  }

  /**
   * Saves inventory items and precomputed lookup maps to localStorage with current timestamp.
   */
  function saveToLocalStorage(inventory) {
    const { stockMap, availabilityMap } = buildStockMaps(inventory);
    const cacheObj = {
      timestamp: Date.now(),
      inventory: inventory,
      stockMap: stockMap,
      availabilityMap: availabilityMap
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
    } catch (e) {
      console.warn('[RawgadStock] Could not write to localStorage:', e);
    }

    memoryCache = cacheObj;
    return cacheObj;
  }

  /**
   * Pulls all stock data at once from /api/inventory and caches in localStorage.
   * Deduplicates concurrent in-flight requests.
   */
  async function fetchAllStock(force = false) {
    if (!force) {
      if (isValidCache(memoryCache)) {
        return memoryCache;
      }
      const cached = readLocalStorage();
      if (cached) {
        memoryCache = cached;
        return cached;
      }
    }

    if (fetchPromise) {
      return fetchPromise;
    }

    fetchPromise = (async () => {
      try {
        const res = await fetch('/api/inventory', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }

        const data = await res.json();
        const invArray = (data && Array.isArray(data.inventory)) ? data.inventory : (data && Array.isArray(data.items) ? data.items : null);
        if (data && data.success && invArray) {
          const cacheObj = saveToLocalStorage(invArray);
          notifyListeners(cacheObj);
          return cacheObj;
        } else {
          throw new Error(data && data.error ? data.error : 'Invalid inventory response payload');
        }
      } catch (err) {
        console.warn('[RawgadStock] Error pulling full inventory from /api/inventory:', err);
        // Fallback: Use stale localStorage cache if available
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const stale = JSON.parse(raw);
            if (stale && Array.isArray(stale.inventory)) {
              memoryCache = stale;
              return stale;
            }
          }
        } catch (_) {}
        return null;
      } finally {
        fetchPromise = null;
      }
    })();

    return fetchPromise;
  }

  /**
   * Emits update events for window listeners and synchronizes Alpine store.
   */
  function notifyListeners(cacheObj) {
    if (!cacheObj) return;

    try {
      window.dispatchEvent(new CustomEvent('rawgad-stock-updated', {
        detail: {
          inventory: cacheObj.inventory,
          stockMap: cacheObj.stockMap,
          availabilityMap: cacheObj.availabilityMap,
          timestamp: cacheObj.timestamp
        }
      }));
    } catch (_) {}

    syncAlpineStore(cacheObj);
  }

  /**
   * Synchronizes data with the Alpine.js $store.inventory reactive store.
   */
  function syncAlpineStore(cacheObj) {
    if (window.Alpine && window.Alpine.store && window.Alpine.store('inventory')) {
      try {
        const store = window.Alpine.store('inventory');
        store.items = cacheObj.inventory;
        store.stockMap = cacheObj.stockMap;
        store.availabilityMap = cacheObj.availabilityMap || {};
        store.timestamp = cacheObj.timestamp;
        store.loading = false;
      } catch (_) {}
    }
  }

  /**
   * Initializes the Alpine store definition if Alpine is loaded.
   */
  function initAlpineIntegration() {
    if (window.Alpine && window.Alpine.store) {
      if (!window.Alpine.store('inventory')) {
        const currentCache = RawgadStock.getCache();
        window.Alpine.store('inventory', {
          items: currentCache ? currentCache.inventory : [],
          stockMap: currentCache ? currentCache.stockMap : {},
          availabilityMap: currentCache ? (currentCache.availabilityMap || {}) : {},
          timestamp: currentCache ? currentCache.timestamp : null,
          loading: !currentCache,
          getItemStock(productId, typeId, subProductId) {
            return RawgadStock.getItemStock(productId, typeId, subProductId);
          },
          isItemAvailable(productId, typeId, subProductId) {
            return RawgadStock.isItemAvailable(productId, typeId, subProductId);
          },
          getProductStockMap(productId) {
            return RawgadStock.getProductStockMap(productId);
          },
          getProductAvailabilityMap(productId) {
            return RawgadStock.getProductAvailabilityMap(productId);
          },
          refresh(force = true) {
            return RawgadStock.fetchAndStoreAllStock(force);
          }
        });
      }
    }
  }

  const RawgadStock = {
    STORAGE_KEY,
    CACHE_TTL_MS,

    /**
     * Returns true if valid cache is present in memory or localStorage (< 24 hours old).
     */
    isCacheValid() {
      if (isValidCache(memoryCache)) return true;
      return !!readLocalStorage();
    },

    /**
     * Returns the cached stock object if valid (< 24h old), else null.
     */
    getCache() {
      if (isValidCache(memoryCache)) return memoryCache;
      const local = readLocalStorage();
      if (local) {
        memoryCache = local;
        return local;
      }
      return null;
    },

    /**
     * Returns the full inventory array.
     */
    getInventory() {
      const cache = this.getCache();
      return cache ? cache.inventory : [];
    },

    /**
     * Returns the precomputed stock lookup dictionary.
     */
    getStockMap() {
      const cache = this.getCache();
      return cache ? cache.stockMap : {};
    },

    /**
     * Returns the precomputed availability lookup dictionary.
     */
    getAvailabilityMap() {
      const cache = this.getCache();
      return cache ? (cache.availabilityMap || {}) : {};
    },

    /**
     * Returns a product-specific map: { 'typeId:::subProductId': stockNumber }
     */
    getProductStockMap(productId) {
      const pId = productId != null ? String(productId).trim() : '';
      const cache = this.getCache();
      const resMap = {};
      if (!cache || !Array.isArray(cache.inventory)) return resMap;

      for (const item of cache.inventory) {
        if (String(item.productId).trim() === pId) {
          const tId = (item.typeId != null && item.typeId !== 'null') ? String(item.typeId).trim() : 'null';
          const sId = (item.subProductId != null && item.subProductId !== 'null') ? String(item.subProductId).trim() : 'null';
          const key = tId + ':::' + sId;
          resMap[key] = typeof item.stock === 'number' ? item.stock : 0;
        }
      }
      return resMap;
    },

    /**
     * Returns a product-specific availability map: { 'typeId:::subProductId': boolean }
     */
    getProductAvailabilityMap(productId) {
      const pId = productId != null ? String(productId).trim() : '';
      const cache = this.getCache();
      const resMap = {};
      if (!cache || !Array.isArray(cache.inventory)) return resMap;

      for (const item of cache.inventory) {
        if (String(item.productId).trim() === pId) {
          const tId = (item.typeId != null && item.typeId !== 'null') ? String(item.typeId).trim() : 'null';
          const sId = (item.subProductId != null && item.subProductId !== 'null') ? String(item.subProductId).trim() : 'null';
          const key = tId + ':::' + sId;
          resMap[key] = (typeof item.isAvailable === 'boolean')
            ? item.isAvailable
            : (item.stockType === 'available' || (typeof item.stock === 'number' && item.stock > 0));
        }
      }
      return resMap;
    },

    /**
     * Retrieves stock count for an item by its identifiers with hierarchical fallbacks.
     */
    getItemStock(productId, typeId, subProductId) {
      const cache = this.getCache();
      if (!cache || !cache.stockMap) return null;
      const map = cache.stockMap;

      const pId = productId != null ? String(productId).trim() : '';
      const tId = (typeId != null && typeId !== 'null') ? String(typeId).trim() : 'null';
      const sId = (subProductId != null && subProductId !== 'null') ? String(subProductId).trim() : 'null';

      // 1. Exact triple match
      const key1 = `${pId}:::${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key1)) return map[key1];

      // 2. Variant pair match
      const key2 = `${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key2)) return map[key2];

      // 3. Subproduct match
      if (sId !== 'null' && Object.prototype.hasOwnProperty.call(map, sId)) return map[sId];

      // 4. Type match
      if (tId !== 'null' && Object.prototype.hasOwnProperty.call(map, tId)) return map[tId];

      // 5. Product match
      if (pId && Object.prototype.hasOwnProperty.call(map, pId)) return map[pId];

      return null;
    },

    /**
     * Retrieves availability boolean for an item by its identifiers with hierarchical fallbacks.
     */
    isItemAvailable(productId, typeId, subProductId) {
      const cache = this.getCache();
      if (!cache || !cache.availabilityMap) return null;
      const map = cache.availabilityMap;

      const pId = productId != null ? String(productId).trim() : '';
      const tId = (typeId != null && typeId !== 'null') ? String(typeId).trim() : 'null';
      const sId = (subProductId != null && subProductId !== 'null') ? String(subProductId).trim() : 'null';

      // 1. Exact triple match
      const key1 = `${pId}:::${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key1)) return map[key1];

      // 2. Variant pair match
      const key2 = `${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key2)) return map[key2];

      // 3. Subproduct match
      if (sId !== 'null' && Object.prototype.hasOwnProperty.call(map, sId)) return map[sId];

      // 4. Type match
      if (tId !== 'null' && Object.prototype.hasOwnProperty.call(map, tId)) return map[tId];

      // 5. Product match
      if (pId && Object.prototype.hasOwnProperty.call(map, pId)) return map[pId];

      return null;
    },

    /**
     * Pulls all stock data at once and stores in localStorage.
     * force: if true, ignores existing 24-hour cache and re-fetches.
     */
    fetchAndStoreAllStock(force = false) {
      return fetchAllStock(force);
    },

    /**
     * Initialization triggered when website opens:
     * - If localStorage has valid cache (< 24h), loads immediately.
     * - If not present or expired (> 24h), pulls all stock at once and stores in localStorage.
     */
    init() {
      const cached = readLocalStorage();
      if (cached) {
        memoryCache = cached;
        notifyListeners(cached);
      } else {
        fetchAllStock(false);
      }
    }
  };

  // Expose globally
  window.RawgadStock = RawgadStock;
  window.RawgadzStock = RawgadStock;

  // Auto-init immediately as the script loads when website opens
  RawgadStock.init();

  // Register with Alpine.js
  if (typeof window !== 'undefined' && window.Alpine) {
    initAlpineIntegration();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('alpine:init', initAlpineIntegration);
  }

})(typeof window !== 'undefined' ? window : this);
