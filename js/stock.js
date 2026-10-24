// js/stock.js
// Universal Client-Side Stock & Inventory Cache Manager for Rawgadz
// Handles 20-second localStorage caching and 2-Mode Variant Stock

(function(window) {
  'use strict';

  const STORAGE_KEY = 'rawgad_inventory_stock';
  const CACHE_TTL_MS = 20 * 1000; // 20 Seconds in milliseconds for instant Pages CMS visibility

  let memoryCache = null;
  let fetchPromise = null;

  function normalizeId(val) {
    if (val === null || val === undefined || val === '' || val === 'null' || val === '_') return '_';
    const s = String(val).trim();
    return (s === '' || s === 'null' || s === '_') ? '_' : s;
  }

  function isVariantAvailable(stockMode, isAvailable, stock) {
    if (stockMode === 'unlimited') {
      return Boolean(isAvailable);
    }
    return Number(stock) > 0;
  }

  function isValidCache(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.timestamp || typeof data.timestamp !== 'number') return false;
    if (!Array.isArray(data.inventory)) return false;
    if (!data.stockMap || !data.availabilityMap) return false;
    const age = Date.now() - data.timestamp;
    return age >= 0 && age < CACHE_TTL_MS;
  }

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

  function buildStockMaps(inventory) {
    const stockMap = {};
    const availabilityMap = {};
    const modeMap = {};
    if (!Array.isArray(inventory)) return { stockMap, availabilityMap, modeMap };

    for (const item of inventory) {
      const pId = normalizeId(item.productId);
      const tId = normalizeId(item.typeId);
      const sId = normalizeId(item.subProductId);
      const stockMode = item.stockMode || 'quantity';
      const stock = typeof item.stock === 'number' ? Math.max(0, item.stock) : 0;
      const isAvailable = Boolean(item.isAvailable);
      const available = isVariantAvailable(stockMode, isAvailable, stock);

      function setEntry(k) {
        stockMap[k] = stock;
        availabilityMap[k] = available;
        modeMap[k] = stockMode;
      }

      setEntry(`${pId}:::${tId}:::${sId}`);
      setEntry(`${tId}:::${sId}`);

      if (sId !== '_') {
        setEntry(sId);
        setEntry(`${pId}:::${sId}`);
      }

      if (tId !== '_' && sId === '_') {
        setEntry(tId);
        setEntry(`${pId}:::${tId}`);
      }

      if (pId && pId !== '_') {
        if (!stockMap[pId] || stockMap[pId] < stock) {
          stockMap[pId] = stock;
        }
        if (availabilityMap[pId] === undefined || available) {
          availabilityMap[pId] = availabilityMap[pId] || available;
        }
      }
    }
    return { stockMap, availabilityMap, modeMap };
  }

  function saveToLocalStorage(inventory) {
    const { stockMap, availabilityMap, modeMap } = buildStockMaps(inventory);
    const cacheObj = {
      timestamp: Date.now(),
      inventory: inventory,
      stockMap: stockMap,
      availabilityMap: availabilityMap,
      modeMap: modeMap
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
    } catch (e) {
      console.warn('[RawgadStock] Could not write to localStorage:', e);
    }

    memoryCache = cacheObj;
    return cacheObj;
  }

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
          headers: { 'Accept': 'application/json' }
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

    isCacheValid() {
      if (isValidCache(memoryCache)) return true;
      return !!readLocalStorage();
    },

    getCache() {
      if (isValidCache(memoryCache)) return memoryCache;
      const local = readLocalStorage();
      if (local) {
        memoryCache = local;
        return local;
      }
      return null;
    },

    getInventory() {
      const cache = this.getCache();
      return cache ? cache.inventory : [];
    },

    getStockMap() {
      const cache = this.getCache();
      return cache ? cache.stockMap : {};
    },

    getAvailabilityMap() {
      const cache = this.getCache();
      return cache ? (cache.availabilityMap || {}) : {};
    },

    getProductStockMap(productId) {
      const pId = normalizeId(productId);
      const cache = this.getCache();
      const resMap = {};
      if (!cache || !Array.isArray(cache.inventory)) return resMap;

      for (const item of cache.inventory) {
        if (normalizeId(item.productId) === pId) {
          const tId = normalizeId(item.typeId);
          const sId = normalizeId(item.subProductId);
          const key = tId + ':::' + sId;
          resMap[key] = typeof item.stock === 'number' ? item.stock : 0;
        }
      }
      return resMap;
    },

    getProductAvailabilityMap(productId) {
      const pId = normalizeId(productId);
      const cache = this.getCache();
      const resMap = {};
      if (!cache || !Array.isArray(cache.inventory)) return resMap;

      for (const item of cache.inventory) {
        if (normalizeId(item.productId) === pId) {
          const tId = normalizeId(item.typeId);
          const sId = normalizeId(item.subProductId);
          const key = tId + ':::' + sId;
          const stockMode = item.stockMode || 'quantity';
          const stock = typeof item.stock === 'number' ? Math.max(0, item.stock) : 0;
          const isAvailable = Boolean(item.isAvailable);
          resMap[key] = isVariantAvailable(stockMode, isAvailable, stock);
        }
      }
      return resMap;
    },

    getItemStock(productId, typeId, subProductId) {
      const cache = this.getCache();
      if (!cache || !cache.stockMap) return null;
      const map = cache.stockMap;

      const pId = normalizeId(productId);
      const tId = normalizeId(typeId);
      const sId = normalizeId(subProductId);

      const key1 = `${pId}:::${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key1)) return map[key1];

      const key2 = `${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key2)) return map[key2];

      if (sId !== '_' && Object.prototype.hasOwnProperty.call(map, sId)) return map[sId];
      if (tId !== '_' && Object.prototype.hasOwnProperty.call(map, tId)) return map[tId];
      if (pId !== '_' && Object.prototype.hasOwnProperty.call(map, pId)) return map[pId];

      return null;
    },

    isItemAvailable(productId, typeId, subProductId) {
      const cache = this.getCache();
      if (!cache || !cache.availabilityMap) return null;
      const map = cache.availabilityMap;

      const pId = normalizeId(productId);
      const tId = normalizeId(typeId);
      const sId = normalizeId(subProductId);

      const key1 = `${pId}:::${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key1)) return map[key1];

      const key2 = `${tId}:::${sId}`;
      if (Object.prototype.hasOwnProperty.call(map, key2)) return map[key2];

      if (sId !== '_' && Object.prototype.hasOwnProperty.call(map, sId)) return map[sId];
      if (tId !== '_' && Object.prototype.hasOwnProperty.call(map, tId)) return map[tId];
      if (pId !== '_' && Object.prototype.hasOwnProperty.call(map, pId)) return map[pId];

      return null;
    },

    fetchAndStoreAllStock(force = false) {
      return fetchAllStock(force);
    },

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

  window.RawgadStock = RawgadStock;
  window.RawgadzStock = RawgadStock;

  RawgadStock.init();

  if (typeof window !== 'undefined' && window.Alpine) {
    initAlpineIntegration();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('alpine:init', initAlpineIntegration);
  }

})(typeof window !== 'undefined' ? window : this);
