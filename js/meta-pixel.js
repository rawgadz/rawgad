// js/meta-pixel.js
// Centralized Meta Pixel tracking module for Rawgadz
// Pixel ID: 1536032983933873

(function (window, document) {
  'use strict';

  const PIXEL_ID = '1536032983933873';
  const CURRENCY = 'BDT';
  const ADMIN_PATH_PATTERNS = [
    /^\/admin(\.html|\/|$)/i,
    /^\/login(\.html|\/|$)/i,
    /^\/inventory(\.html|\/|$)/i,
    /^\/orders?(\.html|\/|$)/i
  ];

  const SESSION_IC_SIG_KEY = 'rawgadz_pixel_ic_sig';
  const SESSION_PURCHASE_IDS_KEY = 'rawgadz_pixel_purchase_ids';
  const SESSION_IDEM_KEY = 'rawgadz_checkout_idem_key';
  const SESSION_FBC_KEY = 'rawgadz_meta_fbc';

  // Per-page-load deduplication state
  const state = {
    initialized: false,
    pageViewTracked: false,
    viewedContentIds: new Set(),
    viewedCategories: new Set(),
    initiateCheckoutSig: null,
    purchasedEventIds: new Set(),
    lastAddToCartSig: null,
    lastAddToCartAt: 0
  };

  function isAdminPage() {
    try {
      const pathname = (window.location && window.location.pathname) ? window.location.pathname : '';
      return ADMIN_PATH_PATTERNS.some((regex) => regex.test(pathname));
    } catch (_) {
      return false;
    }
  }

  function normalizeId(val) {
    if (val === null || val === undefined || val === '' || val === 'null' || val === '_') return '_';
    const s = String(val).trim();
    return (s === '' || s === 'null' || s === '_') ? '_' : s;
  }

  function makeCanonicalKey(productId, typeId, subProductId) {
    return normalizeId(productId) + ':::' + normalizeId(typeId) + ':::' + normalizeId(subProductId);
  }

  function generateEventId(prefix) {
    const rand = Math.random().toString(36).substring(2, 10);
    return (prefix || 'evt') + '_' + Date.now() + '_' + rand;
  }

  function readCookie(name) {
    try {
      if (!document || !document.cookie) return null;
      const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
      const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_) {
      return null;
    }
  }

  function captureFbclidIfPresent() {
    try {
      if (!window.location || !window.location.search) return null;
      const params = new URLSearchParams(window.location.search);
      const fbclid = params.get('fbclid');
      if (fbclid && fbclid.trim()) {
        const fbc = 'fb.1.' + Date.now() + '.' + fbclid.trim();
        try {
          if (window.sessionStorage) {
            window.sessionStorage.setItem(SESSION_FBC_KEY, fbc);
          }
        } catch (_) {}
        return fbc;
      }
    } catch (_) {}
    return null;
  }

  function getFbp() {
    return readCookie('_fbp') || null;
  }

  function getFbc() {
    const cookieFbc = readCookie('_fbc');
    if (cookieFbc) return cookieFbc;
    try {
      if (window.sessionStorage) {
        const stored = window.sessionStorage.getItem(SESSION_FBC_KEY);
        if (stored) return stored;
      }
    } catch (_) {}
    return captureFbclidIfPresent();
  }

  function getBrowserMetadata() {
    const meta = {};
    const fbp = getFbp();
    const fbc = getFbc();
    if (fbp) meta.fbp = fbp;
    if (fbc) meta.fbc = fbc;
    if (window.location && window.location.href) {
      meta.event_source_url = window.location.href;
    }
    return meta;
  }

  function loadPersistedPurchaseIds() {
    try {
      if (window.sessionStorage) {
        const raw = window.sessionStorage.getItem(SESSION_PURCHASE_IDS_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            arr.forEach((id) => state.purchasedEventIds.add(String(id)));
          }
        }
      }
    } catch (_) {}
  }

  function persistPurchaseId(eventId) {
    if (!eventId) return;
    state.purchasedEventIds.add(String(eventId));
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(
          SESSION_PURCHASE_IDS_KEY,
          JSON.stringify(Array.from(state.purchasedEventIds))
        );
      }
    } catch (_) {}
  }

  function ensureFbqStub() {
    if (window.fbq && typeof window.fbq === 'function') {
      return window.fbq;
    }

    const n = (window.fbq = function () {
      if (n.callMethod) {
        n.callMethod.apply(n, arguments);
      } else {
        n.queue.push(arguments);
      }
    });
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = n.queue || [];

    try {
      if (document && document.head) {
        const existingScript = document.querySelector('script[src*="connect.facebook.net"][src*="fbevents.js"]');
        if (!existingScript) {
          const t = document.createElement('script');
          t.async = true;
          t.src = 'https://connect.facebook.net/en_US/fbevents.js';
          const s = document.getElementsByTagName('script')[0];
          if (s && s.parentNode) {
            s.parentNode.insertBefore(t, s);
          } else {
            document.head.appendChild(t);
          }
        }
      }
    } catch (_) {}

    return window.fbq;
  }

  function safeFbq() {
    try {
      const fbqFn = ensureFbqStub();
      if (typeof fbqFn === 'function') {
        fbqFn.apply(window, arguments);
        return true;
      }
    } catch (err) {
      console.warn('[RawgadzPixel] fbq execution warning:', err && err.message ? err.message : err);
    }
    return false;
  }

  function initPixel() {
    if (isAdminPage()) return false;
    loadPersistedPurchaseIds();
    captureFbclidIfPresent();

    if (window._rawgadzPixelInitialized || state.initialized) {
      state.initialized = true;
      return true;
    }

    ensureFbqStub();
    safeFbq('init', PIXEL_ID);
    window._rawgadzPixelInitialized = true;
    state.initialized = true;
    return true;
  }

  function resolveCanonicalVariantId(item) {
    if (!item || typeof item !== 'object') return null;

    if (item.canonicalKey && typeof item.canonicalKey === 'string' && item.canonicalKey.includes(':::')) {
      const parts = item.canonicalKey.split(':::');
      return makeCanonicalKey(parts[0], parts[1], parts[2]);
    }

    if (item.cartKey && typeof item.cartKey === 'string' && item.cartKey.includes(':::')) {
      const parts = item.cartKey.split(':::');
      return makeCanonicalKey(parts[0], parts[1], parts[2]);
    }

    const pId = item.productId || item.id;
    if (!pId) return null;

    if (item.typeId !== undefined || item.subProductId !== undefined) {
      return makeCanonicalKey(pId, item.typeId, item.subProductId);
    }

    if (Array.isArray(item.types) && item.types.length > 0) {
      const firstType = item.types[0];
      const tId = firstType ? (firstType.subProductId || firstType.id || '_') : '_';
      const firstSub = (firstType && Array.isArray(firstType.subProducts) && firstType.subProducts.length > 0)
        ? firstType.subProducts[0]
        : null;
      const sId = firstSub ? (firstSub.subProductId || firstSub.id || '_') : '_';
      return makeCanonicalKey(pId, tId, sId);
    }

    return makeCanonicalKey(pId, '_', '_');
  }

  function resolveItemPrice(item) {
    if (!item || typeof item !== 'object') return 0;
    if (typeof item.price === 'number' && !isNaN(item.price)) return item.price;
    if (typeof item.item_price === 'number' && !isNaN(item.item_price)) return item.item_price;

    if (Array.isArray(item.types) && item.types.length > 0) {
      const firstType = item.types[0];
      const firstSub = (firstType && Array.isArray(firstType.subProducts) && firstType.subProducts.length > 0)
        ? firstType.subProducts[0]
        : null;
      if (firstSub && typeof firstSub.price === 'number') return firstSub.price;
      if (firstType && typeof firstType.price === 'number') return firstType.price;
    }

    const parsed = Number(item.price);
    return !isNaN(parsed) && parsed > 0 ? parsed : 0;
  }

  // 1. PageView
  function trackPageView() {
    if (isAdminPage()) return false;
    initPixel();
    if (state.pageViewTracked || window._rawgadzPageViewFired) {
      return false;
    }
    state.pageViewTracked = true;
    window._rawgadzPageViewFired = true;
    const eventId = generateEventId('pv');
    return safeFbq('track', 'PageView', {}, { eventID: eventId });
  }

  // 2. ViewContent
  function trackViewContent(product, options) {
    if (isAdminPage() || !product || typeof product !== 'object') return false;
    initPixel();

    const canonicalId = (options && options.contentId)
      ? String(options.contentId)
      : resolveCanonicalVariantId(product);
    if (!canonicalId) return false;

    const dedupeKey = canonicalId;
    if (state.viewedContentIds.has(dedupeKey) && !(options && options.force)) {
      return false;
    }
    state.viewedContentIds.add(dedupeKey);

    const price = (options && typeof options.price === 'number')
      ? options.price
      : resolveItemPrice(product);
    const contentName = (options && options.contentName)
      ? String(options.contentName)
      : String(product.title || product.name || canonicalId);

    const payload = {
      content_ids: [canonicalId],
      content_type: 'product',
      content_name: contentName,
      contents: [
        {
          id: canonicalId,
          quantity: 1,
          item_price: Math.round(Number(price || 0) * 100) / 100
        }
      ],
      value: Math.round(Number(price || 0) * 100) / 100,
      currency: CURRENCY
    };

    const eventId = (options && options.eventId) || generateEventId('vc');
    return safeFbq('track', 'ViewContent', payload, { eventID: eventId });
  }

  // 3. ViewCategory
  function trackViewCategory(categoryInput, options) {
    if (isAdminPage() || !categoryInput) return false;
    initPixel();

    const categoryName = typeof categoryInput === 'string'
      ? categoryInput.trim()
      : String(categoryInput.category_name || categoryInput.content_category || categoryInput.name || '').trim();

    if (!categoryName) return false;

    const dedupeKey = categoryName.toLowerCase();
    if (state.viewedCategories.has(dedupeKey) && !(options && options.force)) {
      return false;
    }
    state.viewedCategories.add(dedupeKey);

    const payload = {
      category_name: categoryName,
      content_category: categoryName
    };

    if (typeof categoryInput === 'object') {
      if (categoryInput.category_slug) payload.category_slug = String(categoryInput.category_slug);
      if (Array.isArray(categoryInput.content_ids) && categoryInput.content_ids.length > 0) {
        payload.content_ids = categoryInput.content_ids.slice(0, 50).map(String);
      }
      if (typeof categoryInput.num_items === 'number') {
        payload.num_items = categoryInput.num_items;
      }
    }

    const eventId = (options && options.eventId) || generateEventId('vcat');
    return safeFbq('trackCustom', 'ViewCategory', payload, { eventID: eventId });
  }

  // 4. AddToCart
  function trackAddToCart(productOrCartItem, quantityAdded, options) {
    if (isAdminPage() || !productOrCartItem || typeof productOrCartItem !== 'object') return false;
    initPixel();

    const qty = Number(quantityAdded !== undefined ? quantityAdded : (productOrCartItem.quantity || productOrCartItem.qty || 1));
    if (!qty || isNaN(qty) || qty <= 0) return false;

    const canonicalId = resolveCanonicalVariantId(productOrCartItem);
    if (!canonicalId) return false;

    const unitPrice = resolveItemPrice(productOrCartItem);
    const totalValue = Math.round(unitPrice * qty * 100) / 100;
    const now = Date.now();
    const rapidSig = canonicalId + ':' + qty + ':' + totalValue;

    // Guard against accidental double-listener firing within 150ms
    if (state.lastAddToCartSig === rapidSig && (now - state.lastAddToCartAt) < 150) {
      return false;
    }
    state.lastAddToCartSig = rapidSig;
    state.lastAddToCartAt = now;

    // Reset InitiateCheckout signature when cart changes so next checkout initiation tracks
    try {
      state.initiateCheckoutSig = null;
      if (window.sessionStorage) {
        window.sessionStorage.removeItem(SESSION_IC_SIG_KEY);
        window.sessionStorage.removeItem(SESSION_IDEM_KEY);
      }
    } catch (_) {}

    const payload = {
      content_ids: [canonicalId],
      content_name: String(productOrCartItem.title || productOrCartItem.name || canonicalId),
      content_type: 'product',
      contents: [
        {
          id: canonicalId,
          quantity: qty,
          item_price: Math.round(unitPrice * 100) / 100
        }
      ],
      value: totalValue,
      currency: CURRENCY
    };

    const eventId = (options && options.eventId) || generateEventId('atc');
    return safeFbq('track', 'AddToCart', payload, { eventID: eventId });
  }

  function extractCartItemsArray(cartInput) {
    if (Array.isArray(cartInput)) return cartInput;
    if (cartInput && typeof cartInput === 'object') {
      if (Array.isArray(cartInput.itemsArray)) return cartInput.itemsArray;
      if (Array.isArray(cartInput.items)) return cartInput.items;
      return Object.values(cartInput);
    }
    try {
      const raw = window.localStorage ? window.localStorage.getItem('main_store_cart') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return Object.values(parsed);
        }
      }
    } catch (_) {}
    return [];
  }

  function computeCartSignature(items) {
    if (!Array.isArray(items) || items.length === 0) return '';
    return items
      .map((item) => {
        const id = resolveCanonicalVariantId(item) || '';
        const qty = Number(item.quantity || item.qty || 0);
        return id + ':' + qty;
      })
      .filter((entry) => !entry.endsWith(':0'))
      .sort()
      .join('|');
  }

  function getCheckoutIdempotencyKey(cartInput) {
    const items = extractCartItemsArray(cartInput);
    const sig = computeCartSignature(items);
    if (!sig) return generateEventId('chk');

    try {
      if (window.sessionStorage) {
        const existing = window.sessionStorage.getItem(SESSION_IDEM_KEY);
        if (existing) {
          const parsed = JSON.parse(existing);
          if (parsed && parsed.sig === sig && parsed.key) {
            return parsed.key;
          }
        }
        const newKey = generateEventId('chk');
        window.sessionStorage.setItem(SESSION_IDEM_KEY, JSON.stringify({ sig, key: newKey }));
        return newKey;
      }
    } catch (_) {}

    return generateEventId('chk');
  }

  // 5. InitiateCheckout
  function trackInitiateCheckout(cartInput, options) {
    if (isAdminPage()) return false;
    initPixel();

    const rawItems = extractCartItemsArray(cartInput);
    const validItems = rawItems.filter((item) => {
      const qty = Number(item && (item.quantity || item.qty));
      return item && qty > 0 && resolveCanonicalVariantId(item);
    });

    if (validItems.length === 0) return false;

    const sig = computeCartSignature(validItems);
    if (!sig) return false;

    if (!(options && options.force)) {
      if (state.initiateCheckoutSig === sig) return false;
      try {
        if (window.sessionStorage && window.sessionStorage.getItem(SESSION_IC_SIG_KEY) === sig) {
          state.initiateCheckoutSig = sig;
          return false;
        }
      } catch (_) {}
    }

    state.initiateCheckoutSig = sig;
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(SESSION_IC_SIG_KEY, sig);
      }
    } catch (_) {}

    const contentIds = [];
    const contents = [];
    let totalValue = 0;
    let totalItems = 0;

    for (const item of validItems) {
      const canonicalId = resolveCanonicalVariantId(item);
      const qty = Number(item.quantity || item.qty || 1);
      const unitPrice = resolveItemPrice(item);
      contentIds.push(canonicalId);
      contents.push({
        id: canonicalId,
        quantity: qty,
        item_price: Math.round(unitPrice * 100) / 100
      });
      totalValue += unitPrice * qty;
      totalItems += qty;
    }

    const payload = {
      content_ids: contentIds,
      contents: contents,
      content_type: 'product',
      value: Math.round(totalValue * 100) / 100,
      num_items: totalItems,
      currency: CURRENCY
    };

    const eventId = (options && options.eventId) || generateEventId('ic');
    return safeFbq('track', 'InitiateCheckout', payload, { eventID: eventId });
  }

  // 6. Purchase (Browser side - strictly after successful /api/checkout response)
  function trackPurchase(orderData, explicitEventId) {
    if (isAdminPage() || !orderData || typeof orderData !== 'object') return false;
    initPixel();

    const eventId = String(
      explicitEventId ||
      orderData.event_id ||
      orderData.invoice_number ||
      orderData.order_id ||
      ''
    ).trim();

    if (!eventId) return false;

    loadPersistedPurchaseIds();
    if (state.purchasedEventIds.has(eventId)) {
      return false;
    }

    let contentIds = [];
    let contents = [];
    let numItems = Number(orderData.num_items) || 0;

    if (Array.isArray(orderData.content_ids) && orderData.content_ids.length > 0) {
      contentIds = orderData.content_ids.map(String);
    }

    if (Array.isArray(orderData.contents) && orderData.contents.length > 0) {
      contents = orderData.contents.map((c) => ({
        id: String(c.id),
        quantity: Number(c.quantity || c.qty || 1),
        item_price: Math.round(Number(c.item_price ?? c.price ?? 0) * 100) / 100
      }));
    } else if (Array.isArray(orderData.items) && orderData.items.length > 0) {
      for (const item of orderData.items) {
        const cId = resolveCanonicalVariantId(item);
        const qty = Number(item.qty || item.quantity || 1);
        const price = Math.round(Number(item.price || 0) * 100) / 100;
        if (cId) {
          if (!contentIds.includes(cId)) contentIds.push(cId);
          contents.push({ id: cId, quantity: qty, item_price: price });
        }
      }
    }

    if (!numItems && contents.length > 0) {
      numItems = contents.reduce((sum, c) => sum + (Number(c.quantity) || 1), 0);
    }

    const rawValue = orderData.value !== undefined ? orderData.value : orderData.payment_amount;
    const verifiedValue = Math.round((Number(rawValue) || 0) * 100) / 100;

    const payload = {
      content_ids: contentIds,
      contents: contents,
      content_type: 'product',
      value: verifiedValue,
      currency: CURRENCY,
      num_items: numItems,
      order_id: String(orderData.order_id || orderData.invoice_number || eventId)
    };

    const fired = safeFbq('track', 'Purchase', payload, { eventID: eventId });
    if (fired) {
      persistPurchaseId(eventId);
      try {
        state.initiateCheckoutSig = null;
        if (window.sessionStorage) {
          window.sessionStorage.removeItem(SESSION_IC_SIG_KEY);
          window.sessionStorage.removeItem(SESSION_IDEM_KEY);
        }
      } catch (_) {}
    }
    return fired;
  }

  const RawgadzPixel = {
    PIXEL_ID,
    CURRENCY,
    init: initPixel,
    makeCanonicalKey,
    resolveCanonicalVariantId,
    getBrowserMetadata,
    getCheckoutIdempotencyKey,
    trackPageView,
    trackViewContent,
    trackViewCategory,
    trackAddToCart,
    trackInitiateCheckout,
    trackPurchase
  };

  window.RawgadzPixel = RawgadzPixel;

  // Automatically initialize and fire PageView once on customer-facing pages
  if (!isAdminPage()) {
    initPixel();
    trackPageView();
  }
})(typeof window !== 'undefined' ? window : globalThis, typeof document !== 'undefined' ? document : null);
