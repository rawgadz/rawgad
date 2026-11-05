// build/build-products.js
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');
const {
  validateBooleanField,
  resolveProductAvailability,
  computeAvailablePriceRange,
} = require('../api/_catalog');

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'product');
const PRODUCTS_OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'products.json');
const PRICE_OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'price.json');
const HTML_OUTPUT_DIR = path.join(ROOT_DIR, 'product');
const INDEX_HTML_FILE = path.join(ROOT_DIR, 'index.html');
const GADGETS_OUTPUT_FILE = path.join(ROOT_DIR, 'gadgets.html');

function slugify(str) {
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sanitizeSlug(rawSlug) {
  if (typeof rawSlug !== 'string') return '';
  let cleaned = rawSlug.trim().toLowerCase();
  cleaned = cleaned.replace(/[/\\]/g, '').replace(/\.\.+/g, '');
  cleaned = cleaned.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function normalizeId(val) {
  if (val === null || val === undefined || val === '' || val === 'null' || val === '_') return '_';
  const s = String(val).trim();
  return (s === '' || s === 'null' || s === '_') ? '_' : s;
}

function normalizeSubProduct(sub, parentPrice = null, parentAvailable = true, contextPrefix = '') {
  if (!sub || typeof sub !== 'object') return null;

  const rawTypeAvailable = validateBooleanField(sub.available, `${contextPrefix}.available`);
  const inheritedTypeAvailable = rawTypeAvailable !== undefined ? rawTypeAvailable : parentAvailable;
  const parentAndTypeAvailable = Boolean(parentAvailable && inheritedTypeAvailable);

  const typePrice = (sub.price !== undefined && sub.price !== null && sub.price !== '')
    ? (Number(sub.price) || 0)
    : parentPrice;

  const rawNested = Array.isArray(sub.subProducts)
    ? sub.subProducts
    : (Array.isArray(sub.subproducts)
      ? sub.subproducts
      : (Array.isArray(sub.types) ? sub.types : []));

  const subProducts = rawNested.map((item, sIdx) => {
    if (!item || typeof item !== 'object') return null;
    const rawSubAvailable = validateBooleanField(
      item.available,
      `${contextPrefix}.subProducts[${sIdx}].available`
    );
    const inheritedSubAvailable = rawSubAvailable !== undefined ? rawSubAvailable : parentAndTypeAvailable;
    const effectiveSubAvailable = Boolean(parentAndTypeAvailable && inheritedSubAvailable);

    const itemPrice = (item.price !== undefined && item.price !== null && item.price !== '')
      ? (Number(item.price) || 0)
      : typePrice;

    const nestedImages = Array.isArray(item.images)
      ? item.images.map(img => String(img).trim()).filter(Boolean)
      : (item.subImage || item.imageSrc || item.image ? [String(item.subImage || item.imageSrc || item.image).trim()] : []);

    const nestedItem = {
      subProductId: String(item.subProductId || item.id || '').trim(),
      subImage: nestedImages[0] || item.subImage || item.imageSrc || item.image || '',
      images: nestedImages,
      subTitle: item.subTitle || item.title || '',
      available: effectiveSubAvailable
    };
    if (typeof itemPrice === 'number' && !isNaN(itemPrice)) {
      nestedItem.price = itemPrice;
    }
    return nestedItem;
  }).filter(Boolean);

  const typeImages = Array.isArray(sub.images)
    ? sub.images.map(img => String(img).trim()).filter(Boolean)
    : (sub.subImage || sub.imageSrc || sub.image ? [String(sub.subImage || sub.imageSrc || sub.image).trim()] : []);

  const effectiveTypeAvailable = subProducts.length > 0
    ? Boolean(parentAndTypeAvailable && subProducts.some(s => s.available === true))
    : parentAndTypeAvailable;

  const normalized = {
    subProductId: String(sub.subProductId || sub.id || '').trim(),
    subImage: typeImages[0] || sub.subImage || sub.imageSrc || sub.image || '',
    images: typeImages,
    subTitle: sub.subTitle || sub.title || '',
    available: effectiveTypeAvailable
  };

  if (typeof typePrice === 'number' && !isNaN(typePrice)) {
    normalized.price = typePrice;
  }

  if (subProducts.length > 0) {
    normalized.subProducts = subProducts;
  }

  return normalized;
}

function buildProductJsonLd(product) {
  const canonicalUrl = `https://www.rawgadz.com/product/${product.slug}.html`;
  const priceRange = product.priceRange || { min: product.price, max: product.price };
  const schemaAvailability = product.available === false
    ? 'https://schema.org/OutOfStock'
    : 'https://schema.org/InStock';

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description || product.title,
    image: Array.isArray(product.images) && product.images.length > 0 ? product.images : (product.imageSrc ? [product.imageSrc] : []),
    sku: String(product.id),
    url: canonicalUrl,
    offers: priceRange.min !== priceRange.max
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: 'BDT',
          lowPrice: priceRange.min,
          highPrice: priceRange.max,
          availability: schemaAvailability,
          url: canonicalUrl
        }
      : {
          '@type': 'Offer',
          priceCurrency: 'BDT',
          price: product.price,
          availability: schemaAvailability,
          url: canonicalUrl
        }
  };
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

function generateStandaloneProductHTML(rawProduct) {
  const product = resolveProductAvailability(rawProduct);
  const types = Array.isArray(product.types) ? product.types : [];

  const initialTypeIdx = types.length > 0
    ? Math.max(0, types.findIndex(t => t.available !== false))
    : 0;
  const firstType = types.length > 0 ? types[initialTypeIdx] : null;

  const firstTypeSubs = (firstType && Array.isArray(firstType.subProducts)) ? firstType.subProducts : [];
  const initialSubIdx = firstTypeSubs.length > 0
    ? Math.max(0, firstTypeSubs.findIndex(s => s.available !== false))
    : 0;
  const firstSub = firstTypeSubs.length > 0 ? firstTypeSubs[initialSubIdx] : null;

  const initialImage = firstSub?.images?.[0] || firstSub?.subImage || firstType?.images?.[0] || firstType?.subImage || product.images?.[0] || product.imageSrc;

  const tagsHtml = product.tags
    ? product.tags.split(',').map(tag => `<span class="bg-neutral-100 text-neutral-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border border-neutral-200">${escapeHtml(tag.trim())}</span>`).join('\n             ')
    : '';

  const isGadget = product.tab === 'gadget';
  const catalogLink = isGadget ? '../gadgets.html' : '../index.html#shop';
  const catalogName = isGadget ? 'Gadgets' : 'Shop';

  const sanitizedProductJson = JSON.stringify(product).replace(/</g, '\\u003c');
  const jsonLd = buildProductJsonLd(product);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(product.title)} | Rawgadz</title>
  <meta name="description" content="${escapeHtml(product.description || product.title)}">
  <link rel="canonical" href="https://www.rawgadz.com/product/${escapeHtml(product.slug)}.html">
  <meta property="og:title" content="${escapeHtml(product.title)} | Rawgadz">
  <meta property="og:description" content="${escapeHtml(product.description || product.title)}">
  <meta property="og:image" content="${escapeHtml(initialImage || '')}">
  <meta property="og:url" content="https://www.rawgadz.com/product/${escapeHtml(product.slug)}.html">
  <meta property="og:type" content="product">
  <script type="application/ld+json">${jsonLd}</script>
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="/js/stock.js"></script>
  <script src="/js/meta-pixel.js"></script>

  <style>
    [x-cloak] { display: none !important; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
  </style>
</head>
<body class="bg-[#FBFBFB] text-neutral-900 font-sans antialiased selection:bg-black selection:text-white pb-20">

  <!-- Sticky Navbar -->
  <header class="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-neutral-200">
    <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="${catalogLink}" class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 hover:text-black transition-colors">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        Back to ${catalogName}
      </a>
      <a href="../index.html" class="font-black text-lg tracking-wider text-black uppercase hover:opacity-80 transition-opacity">Rawgadz</a>
      <a href="../checkout.html" class="relative p-2 text-neutral-700 hover:text-black transition-colors" x-data="{ count: 0 }" x-init="count = Object.values(JSON.parse(localStorage.getItem('main_store_cart') || '{}')).reduce((a, b) => a + (b.quantity || 1), 0); window.addEventListener('cart-update-main_store_cart', () => { count = Object.values(JSON.parse(localStorage.getItem('main_store_cart') || '{}')).reduce((a, b) => a + (b.quantity || 1), 0); });">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
        <span x-show="count > 0" x-text="count" class="absolute top-1 right-1 bg-black text-white text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center"></span>
      </a>
    </div>
  </header>

  <!-- Product Container -->
  <main class="max-w-6xl mx-auto px-4 pt-8" x-data="productPage">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
      
      <!-- Gallery Column -->
      <div class="lg:col-span-7">
        <div class="sticky top-24">
          <div class="aspect-square bg-neutral-100 rounded-3xl overflow-hidden border border-neutral-200 mb-4 shadow-sm relative">
            <img :src="currentImage" :alt="activeVariantTitle" class="w-full h-full object-cover">

            <template x-if="isOutOfStock">
              <span class="absolute top-4 right-4 z-10 bg-rose-600 text-white text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-full shadow-md">
                Out of Stock
              </span>
            </template>
            
            <template x-if="currentVariantImages.length > 1">
              <div class="absolute inset-x-4 top-1/2 -translate-y-1/2 flex justify-between pointer-events-none">
                <button @click="prevGalleryImage" class="pointer-events-auto w-10 h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center text-black hover:bg-white transition-all">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <button @click="nextGalleryImage" class="pointer-events-auto w-10 h-10 rounded-full bg-white/90 shadow-md flex items-center justify-center text-black hover:bg-white transition-all">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
              </div>
            </template>
          </div>

          <!-- Thumbnails -->
          <div class="flex gap-2 overflow-x-auto no-scrollbar py-1" x-show="currentVariantImages.length > 1">
            <template x-for="(img, idx) in currentVariantImages" :key="idx">
              <button @click="selectedGalleryImage = img" class="w-16 h-16 rounded-xl overflow-hidden border-2 transition-all flex-shrink-0" :class="currentImage === img ? 'border-black' : 'border-transparent opacity-60 hover:opacity-100'">
                <img :src="img" class="w-full h-full object-cover">
              </button>
            </template>
          </div>
        </div>
      </div>

      <!-- Info Column -->
      <div class="lg:col-span-5 flex flex-col justify-between">
        <div>
          <div class="flex flex-wrap gap-2 mb-3">${tagsHtml}</div>
          <h1 class="text-2xl md:text-3xl font-black tracking-tight text-neutral-900 mb-2" x-text="product.title"></h1>
          
          <div class="flex items-baseline gap-3 mb-6">
            <span class="text-3xl font-black text-black">৳<span x-text="currentPrice"></span></span>
            <!-- Stock Status Badge -->
            <span class="text-[11px] font-black uppercase px-2.5 py-1 rounded-full border"
              :class="{
                'bg-emerald-50 text-emerald-700 border-emerald-200': stockStatus === 'in_stock',
                'bg-rose-50 text-rose-700 border-rose-200': stockStatus === 'out_of_stock'
              }"
              x-text="stockStatus === 'in_stock' ? 'In Stock' : 'Out of Stock'">
            </span>
          </div>

          <!-- Type Selection -->
          <template x-if="product.types && product.types.length > 0">
            <div class="mb-6">
              <label class="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2.5">
                Type: <span class="text-black font-black" x-text="selectedType?.subTitle"></span>
              </label>
              <div class="flex flex-wrap gap-2.5">
                <template x-for="(type, tIdx) in product.types" :key="tIdx">
                  <button
                    type="button"
                    @click="selectType(tIdx)"
                    :disabled="type.available === false"
                    class="px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2"
                    :class="type.available === false
                      ? 'border-neutral-200 bg-neutral-100 text-neutral-400 cursor-not-allowed opacity-75'
                      : (selectedTypeIndex === tIdx ? 'border-black bg-black text-white' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400')"
                  >
                    <span :class="type.available === false ? 'line-through' : ''" x-text="type.subTitle"></span>
                    <template x-if="type.available === false">
                      <span class="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-black uppercase px-1.5 py-0.5 rounded">Out of Stock</span>
                    </template>
                  </button>
                </template>
              </div>
            </div>
          </template>

          <!-- SubProduct Selection -->
          <template x-if="selectedType && selectedType.subProducts && selectedType.subProducts.length > 0">
            <div class="mb-6">
              <label class="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2.5">
                Option: <span class="text-black font-black" x-text="selectedSubProduct?.subTitle"></span>
              </label>
              <div class="flex flex-wrap gap-2.5">
                <template x-for="(sub, sIdx) in selectedType.subProducts" :key="sIdx">
                  <button
                    type="button"
                    @click="selectSubProduct(sIdx)"
                    :disabled="sub.available === false"
                    class="px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2"
                    :class="sub.available === false
                      ? 'border-neutral-200 bg-neutral-100 text-neutral-400 cursor-not-allowed opacity-75'
                      : (selectedSubProductIndex === sIdx ? 'border-black bg-black text-white' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-400')"
                  >
                    <span :class="sub.available === false ? 'line-through' : ''" x-text="sub.subTitle"></span>
                    <template x-if="sub.available === false">
                      <span class="bg-rose-100 text-rose-700 border border-rose-200 text-[9px] font-black uppercase px-1.5 py-0.5 rounded">Out of Stock</span>
                    </template>
                  </button>
                </template>
              </div>
            </div>
          </template>

          <!-- Action Buttons (Desktop) -->
          <div class="hidden sm:block space-y-3 pt-4 border-t border-neutral-200">
            <div class="flex flex-wrap sm:flex-nowrap gap-3">
              <div class="flex items-center border border-neutral-300 rounded-xl bg-white overflow-hidden" :class="isOutOfStock ? 'opacity-50 pointer-events-none' : ''">
                <button type="button" @click="updateCart(inCartQuantity - 1)" :disabled="isOutOfStock" class="px-3.5 py-3 hover:bg-neutral-100 disabled:cursor-not-allowed transition-colors font-bold text-neutral-600">-</button>
                <span class="w-10 text-center font-black text-sm" x-text="inCartQuantity"></span>
                <button type="button" @click="updateCart(inCartQuantity + 1)" :disabled="isOutOfStock" class="px-3.5 py-3 hover:bg-neutral-100 disabled:cursor-not-allowed transition-colors font-bold text-neutral-600">+</button>
              </div>
              <button
                type="button"
                @click="updateCart(inCartQuantity + 1)"
                :disabled="isOutOfStock"
                class="flex-1 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 text-xs sm:text-sm uppercase tracking-wider transition-all border"
                :class="isOutOfStock ? 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed' : 'bg-white hover:bg-neutral-100 text-black border-black cursor-pointer'"
              >
                <span x-text="isOutOfStock ? 'Out of Stock' : 'Add to Cart'"></span>
              </button>
              <button
                type="button"
                @click="buyNow"
                :disabled="isOutOfStock"
                class="flex-1 font-bold py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 text-xs sm:text-sm uppercase tracking-wider transition-all"
                :class="isOutOfStock ? 'bg-neutral-200 text-neutral-500 cursor-not-allowed' : 'bg-black hover:bg-neutral-800 text-white cursor-pointer'"
              >
                <span x-text="isOutOfStock ? 'Out of Stock' : 'Buy Now'"></span>
              </button>
            </div>
          </div>

          <!-- Action Buttons (Mobile Floating Bottom Bar) -->
          <div class="sm:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-neutral-200 p-4 z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] pb-6">
            <div class="flex gap-3">
              <div class="flex items-center border border-neutral-300 rounded-xl bg-white overflow-hidden shrink-0" :class="isOutOfStock ? 'opacity-50 pointer-events-none' : ''">
                <button type="button" @click="updateCart(inCartQuantity - 1)" :disabled="isOutOfStock" class="px-3.5 py-3 hover:bg-neutral-100 disabled:cursor-not-allowed transition-colors font-bold text-neutral-600">-</button>
                <span class="w-10 text-center font-black text-sm" x-text="inCartQuantity"></span>
                <button type="button" @click="updateCart(inCartQuantity + 1)" :disabled="isOutOfStock" class="px-3.5 py-3 hover:bg-neutral-100 disabled:cursor-not-allowed transition-colors font-bold text-neutral-600">+</button>
              </div>
              <button
                type="button"
                @click="updateCart(inCartQuantity + 1)"
                :disabled="isOutOfStock"
                class="flex-1 font-bold py-3 px-2 rounded-xl flex items-center justify-center gap-2 text-xs uppercase tracking-wider transition-all border"
                :class="isOutOfStock ? 'bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed' : 'bg-white hover:bg-neutral-100 text-black border-black cursor-pointer'"
              >
                <span x-text="isOutOfStock ? 'Out of Stock' : 'Add to Cart'"></span>
              </button>
              <button
                type="button"
                @click="buyNow"
                :disabled="isOutOfStock"
                class="flex-1 font-bold py-3 px-2 rounded-xl flex items-center justify-center gap-2 text-xs uppercase tracking-wider transition-all"
                :class="isOutOfStock ? 'bg-neutral-200 text-neutral-500 cursor-not-allowed' : 'bg-black hover:bg-neutral-800 text-white cursor-pointer'"
              >
                <span x-text="isOutOfStock ? 'Out of Stock' : 'Buy Now'"></span>
              </button>
            </div>
          </div>

          <div class="mt-8 text-neutral-600 text-sm leading-relaxed" x-text="product.description"></div>
        </div>
      </div>
    </div>

    <!-- Long Content Section -->
    <div class="mt-16 border-t border-neutral-200 pt-10" x-show="product.content">
      <h2 class="text-xl font-black tracking-tight mb-6">Product Details</h2>
      <div class="prose max-w-none text-neutral-700 bg-white p-6 md:p-8 rounded-2xl border border-neutral-200" x-html="product.content"></div>
    </div>
  </main>

  <script>
    (function() {
      const pageProduct = ${sanitizedProductJson};
      if (window.RawgadStock && typeof window.RawgadStock.registerProduct === 'function') {
        window.RawgadStock.registerProduct(pageProduct);
      }
      if (window.RawgadzPixel) {
        window.RawgadzPixel.trackViewContent(pageProduct);
      }
      document.addEventListener('alpine:init', () => {
        Alpine.data('productPage', () => ({
          product: pageProduct,
          selectedTypeIndex: ${initialTypeIdx},
          selectedSubProductIndex: ${initialSubIdx},
          selectedGalleryImage: null,
          inCartQuantity: 0,
          availabilityMap: {},

          init() {
            this.ensureValidSelection();
            this.syncCart();
            this.loadAvailability();
            if (window.RawgadzPixel) {
              window.RawgadzPixel.trackViewContent(this.product, {
                contentId: this.getCartKey(),
                price: this.currentPrice,
                contentName: this.product.title
              });
            }
            window.addEventListener('storage', () => this.syncCart());
            window.addEventListener('cart-update-main_store_cart', () => this.syncCart());
            window.addEventListener('rawgad-stock-updated', () => this.loadAvailability());
          },

          ensureValidSelection() {
            if (Array.isArray(this.product.types) && this.product.types.length > 0) {
              const curType = this.product.types[this.selectedTypeIndex];
              if (!curType || curType.available === false) {
                const availIdx = this.product.types.findIndex(t => t.available !== false);
                if (availIdx >= 0) this.selectedTypeIndex = availIdx;
              }
              const activeType = this.product.types[this.selectedTypeIndex];
              if (activeType && Array.isArray(activeType.subProducts) && activeType.subProducts.length > 0) {
                const curSub = activeType.subProducts[this.selectedSubProductIndex];
                if (!curSub || curSub.available === false) {
                  const availSubIdx = activeType.subProducts.findIndex(s => s.available !== false);
                  if (availSubIdx >= 0) this.selectedSubProductIndex = availSubIdx;
                }
              }
            }
          },

          loadAvailability() {
            if (window.RawgadStock) {
              this.availabilityMap = window.RawgadStock.getProductAvailabilityMap(this.product.id) || {};
            }
          },

          get selectedType() {
            if (!this.product.types || this.product.types.length === 0) return null;
            return this.product.types[this.selectedTypeIndex] || this.product.types[0];
          },

          get selectedSubProduct() {
            const type = this.selectedType;
            if (!type || !type.subProducts || type.subProducts.length === 0) return null;
            return type.subProducts[this.selectedSubProductIndex] || type.subProducts[0];
          },

          get activeVariantTitle() {
            const type = this.selectedType;
            const sub = this.selectedSubProduct;
            if (type && sub) return type.subTitle + ' - ' + sub.subTitle;
            if (type) return type.subTitle;
            return this.product.title;
          },

          get currentVariantImages() {
            if (this.selectedSubProduct && Array.isArray(this.selectedSubProduct.images) && this.selectedSubProduct.images.length > 1) {
              return this.selectedSubProduct.images;
            }
            if (this.selectedType && Array.isArray(this.selectedType.images) && this.selectedType.images.length > 1) {
              return this.selectedType.images;
            }

            const variantImg = this.selectedSubProduct?.subImage || this.selectedSubProduct?.images?.[0]
              || this.selectedType?.subImage || this.selectedType?.images?.[0];

            const prodImages = Array.isArray(this.product.images) && this.product.images.length > 0
              ? this.product.images
              : (this.product.imageSrc ? [this.product.imageSrc] : []);

            if (variantImg) {
              const combined = [variantImg];
              for (const img of prodImages) {
                if (!combined.includes(img)) {
                  combined.push(img);
                }
              }
              if (combined.length > 1) return combined;
            }

            if (prodImages.length > 0) return prodImages;
            return variantImg ? [variantImg] : [];
          },

          get currentImage() {
            if (this.selectedGalleryImage && this.currentVariantImages.includes(this.selectedGalleryImage)) return this.selectedGalleryImage;
            return this.currentVariantImages[0] || this.product.imageSrc;
          },

          get currentPrice() {
            if (this.selectedSubProduct && typeof this.selectedSubProduct.price === 'number') return this.selectedSubProduct.price;
            if (this.selectedType && typeof this.selectedType.price === 'number') return this.selectedType.price;
            return Number(this.product.price) || 0;
          },

          get itemInStock() {
            if (this.product.available === false) return false;
            const type = this.selectedType;
            if (type && type.available === false) return false;
            const sub = this.selectedSubProduct;
            if (sub && sub.available === false) return false;
            const typeId = type ? String(type.subProductId || type.id) : '_';
            const subId = sub ? String(sub.subProductId || sub.id) : '_';
            if (window.RawgadStock && typeof window.RawgadStock.isItemAvailable === 'function') {
              return window.RawgadStock.isItemAvailable(this.product.id, typeId, subId);
            }
            return true;
          },

          get stockStatus() {
            return this.itemInStock ? 'in_stock' : 'out_of_stock';
          },

          get isOutOfStock() {
            return !this.itemInStock;
          },

          selectType(index) {
            const idx = Number(index) || 0;
            const targetType = this.product.types && this.product.types[idx];
            if (!targetType || targetType.available === false) return;
            this.selectedTypeIndex = idx;
            if (Array.isArray(targetType.subProducts) && targetType.subProducts.length > 0) {
              const firstAvailSub = targetType.subProducts.findIndex(s => s.available !== false);
              this.selectedSubProductIndex = firstAvailSub >= 0 ? firstAvailSub : 0;
            } else {
              this.selectedSubProductIndex = 0;
            }
            this.selectedGalleryImage = null;
            this.syncCart();
          },

          selectSubProduct(index) {
            const idx = Number(index) || 0;
            const type = this.selectedType;
            const targetSub = type && type.subProducts && type.subProducts[idx];
            if (!targetSub || targetSub.available === false) return;
            this.selectedSubProductIndex = idx;
            this.selectedGalleryImage = null;
            this.syncCart();
          },

          prevGalleryImage() {
            const imgs = this.currentVariantImages;
            if (!imgs || imgs.length <= 1) return;
            const idx = imgs.indexOf(this.currentImage);
            this.selectedGalleryImage = imgs[(idx <= 0 ? imgs.length - 1 : idx - 1)];
          },

          nextGalleryImage() {
            const imgs = this.currentVariantImages;
            if (!imgs || imgs.length <= 1) return;
            const idx = imgs.indexOf(this.currentImage);
            this.selectedGalleryImage = imgs[(idx === -1 || idx >= imgs.length - 1 ? 0 : idx + 1)];
          },

          getCartKey() {
            const type = this.selectedType;
            const sub = this.selectedSubProduct;
            const pId = this.product.id;
            const tId = type ? String(type.subProductId || type.id) : '_';
            const sId = sub ? String(sub.subProductId || sub.id) : '_';
            return pId + ':::' + tId + ':::' + sId;
          },

          getCart() { try { return JSON.parse(localStorage.getItem('main_store_cart')) || {}; } catch (e) { return {}; } },

          setCart(cart) {
            try {
              localStorage.setItem('main_store_cart', JSON.stringify(cart));
              window.dispatchEvent(new Event('cart-update-main_store_cart'));
              return true;
            } catch (e) {
              console.error('Failed to save cart:', e);
              return false;
            }
          },

          syncCart() {
            const key = this.getCartKey();
            const cart = this.getCart();
            const item = cart[key];
            this.inCartQuantity = (item && item.quantity) ? item.quantity : 0;
          },

          updateCart(newQty) {
            if (newQty < 0) return;
            if (this.isOutOfStock && newQty > 0) return;

            const key = this.getCartKey();
            const type = this.selectedType;
            const sub = this.selectedSubProduct;
            const cart = this.getCart();
            const prevQty = (cart[key] && Number(cart[key].quantity)) ? Number(cart[key].quantity) : 0;

            if (newQty === 0) {
              delete cart[key];
            } else {
              let titleSuffix = '';
              if (type && sub) titleSuffix = ' (' + type.subTitle + ' - ' + sub.subTitle + ')';
              else if (type) titleSuffix = ' (' + type.subTitle + ')';

              const typeId = type ? String(type.subProductId || type.id) : null;
              const subProductId = sub ? String(sub.subProductId || sub.id) : null;
              const itemName = sub ? sub.subTitle : (type ? type.subTitle : this.product.title);

              cart[key] = {
                cartKey: key,
                id: this.product.id,
                typeId: typeId,
                subProductId: subProductId,
                name: itemName,
                title: this.product.title + titleSuffix,
                price: this.currentPrice,
                imageSrc: this.currentImage,
                quantity: newQty
              };
            }
            const saved = this.setCart(cart);
            this.syncCart();
            if (saved && newQty > prevQty && cart[key] && window.RawgadzPixel) {
              window.RawgadzPixel.trackAddToCart(cart[key], newQty - prevQty);
            }
          },

          buyNow() {
            if (this.isOutOfStock) return;
            if (this.inCartQuantity === 0) this.updateCart(1);
            if (this.inCartQuantity > 0) window.location.href = '../checkout.html';
          }
        }));
      });
    })();
  </script>
</body>
</html>`;
}

function generateProductJson() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`[build-products] Error: Directory ${CONTENT_DIR} does not exist.`);
    process.exit(1);
  }

  const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));
  const products = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(fileContent);

    if (!data.id || !data.title) continue;

    let slug = '';
    if (data.slug) {
      slug = sanitizeSlug(String(data.slug));
      if (!slug) slug = slugify(data.title);
    } else {
      slug = slugify(data.title);
    }
    if (!slug) slug = slugify(String(data.id));

    let tab = 'normal';
    if (data.tab) {
      const rawTab = String(data.tab).trim().toLowerCase();
      tab = (rawTab === 'gadget' || rawTab === 'gadgets') ? 'gadget' : 'normal';
    }

    const rawProductAvailable = validateBooleanField(data.available, `${file}:available`);
    const baseProductAvailable = rawProductAvailable !== undefined ? rawProductAvailable : true;

    const htmlContent = marked.parse(content || '');
    const rawTypes = Array.isArray(data.types) ? data.types : (Array.isArray(data.subProducts) ? data.subProducts : []);
    const productPrice = Number(data.price) || 0;
    const types = rawTypes
      .map((item, idx) => normalizeSubProduct(item, productPrice, baseProductAvailable, `${file}:types[${idx}]`))
      .filter(Boolean);

    const effectiveProductAvailable = types.length > 0
      ? Boolean(baseProductAvailable && types.some(t => t.available === true))
      : Boolean(baseProductAvailable);

    const rawImages = Array.isArray(data.images) ? data.images.map(img => String(img).trim()).filter(Boolean) : [];
    const mainImg = data.imageSrc ? String(data.imageSrc).trim() : '';
    const productImages = [];
    if (mainImg) productImages.push(mainImg);
    for (const img of rawImages) {
      if (!productImages.includes(img)) productImages.push(img);
    }
    const imageSrc = mainImg || productImages[0] || '';

    let priceRange = null;
    if (data.priceRange && typeof data.priceRange === 'object' && data.priceRange.min !== undefined && data.priceRange.max !== undefined) {
      priceRange = { min: Number(data.priceRange.min) || 0, max: Number(data.priceRange.max) || 0 };
    } else {
      priceRange = computeAvailablePriceRange({ price: productPrice, types });
    }

    const tags = Array.isArray(data.tags) ? data.tags.filter(Boolean).join(', ') : (typeof data.tags === 'string' ? data.tags : '');

    products.push({
      id: String(data.id),
      slug,
      tab,
      available: effectiveProductAvailable,
      imageSrc,
      images: productImages,
      title: data.title,
      description: data.description || '',
      price: productPrice,
      priceRange,
      tags,
      types,
      content: htmlContent
    });
  }

  products.sort((a, b) => a.id.localeCompare(b.id));

  // Write data/products.json
  fs.mkdirSync(path.dirname(PRODUCTS_OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(PRODUCTS_OUTPUT_FILE, JSON.stringify(products, null, 2), 'utf-8');
  console.log(`[build-products] Compiled ${products.length} products into ${PRODUCTS_OUTPUT_FILE}`);

  // Generate data/price.json
  const priceCatalog = {};

  for (const product of products) {
    const pId = String(product.id).trim();
    const types = Array.isArray(product.types) ? product.types : [];

    if (types.length === 0) {
      const price = Number(product.price);
      if (!price || isNaN(price) || price <= 0) {
        throw new Error(`[build-products] Build failed: Invalid price (${product.price}) for base product ${pId}`);
      }
      const key = `${normalizeId(pId)}:::_:::_`;
      priceCatalog[key] = {
        productId: pId,
        typeId: null,
        subProductId: null,
        name: product.title || 'Product',
        price
      };
      continue;
    }

    for (const type of types) {
      const tId = String(type.subProductId || type.id || '').trim();
      const subProducts = Array.isArray(type.subProducts) ? type.subProducts : [];

      if (subProducts.length > 0) {
        for (const sub of subProducts) {
          const sId = String(sub.subProductId || sub.id || '').trim();
          const price = typeof sub.price === 'number' ? sub.price : (typeof type.price === 'number' ? type.price : Number(product.price));
          if (!price || isNaN(price) || price <= 0) {
            throw new Error(`[build-products] Build failed: Invalid price (${price}) for item ${pId}:::${tId}:::${sId}`);
          }
          const key = `${normalizeId(pId)}:::${normalizeId(tId)}:::${normalizeId(sId)}`;
          priceCatalog[key] = {
            productId: pId,
            typeId: tId,
            subProductId: sId,
            name: `${product.title} - ${type.subTitle || 'Type'} (${sub.subTitle || 'Option'})`,
            price
          };
        }
      } else {
        const price = typeof type.price === 'number' ? type.price : Number(product.price);
        if (!price || isNaN(price) || price <= 0) {
          throw new Error(`[build-products] Build failed: Invalid price (${price}) for item ${pId}:::${tId}:::_`);
        }
        const key = `${normalizeId(pId)}:::${normalizeId(tId)}:::_`;
        priceCatalog[key] = {
          productId: pId,
          typeId: tId,
          subProductId: null,
          name: `${product.title} - ${type.subTitle || 'Type'}`,
          price
        };
      }
    }
  }

  fs.writeFileSync(PRICE_OUTPUT_FILE, JSON.stringify(priceCatalog, null, 2), 'utf-8');
  console.log(`[build-products] Compiled ${Object.keys(priceCatalog).length} purchasable items into ${PRICE_OUTPUT_FILE}`);

  buildStandaloneProductPages(products);

  return products;
}

function buildStandaloneProductPages(products) {
  if (!fs.existsSync(HTML_OUTPUT_DIR)) fs.mkdirSync(HTML_OUTPUT_DIR, { recursive: true });
  const existingFiles = fs.readdirSync(HTML_OUTPUT_DIR).filter(file => file.endsWith('.html'));
  for (const file of existingFiles) fs.unlinkSync(path.join(HTML_OUTPUT_DIR, file));

  let count = 0;
  for (const product of products) {
    if (!product || !product.slug) continue;
    const filePath = path.join(HTML_OUTPUT_DIR, `${product.slug}.html`);
    fs.writeFileSync(filePath, generateStandaloneProductHTML(product));
    count++;
  }
  console.log(`[build-products] Generated ${count} standalone product pages in ${HTML_OUTPUT_DIR}`);
}

function buildGadgetsPage() {
  if (!fs.existsSync(INDEX_HTML_FILE)) {
    throw new Error(`[build-products] Cannot generate gadgets.html: ${INDEX_HTML_FILE} does not exist.`);
  }

  let html = fs.readFileSync(INDEX_HTML_FILE, 'utf-8');

  html = html.replace(/<title>.*?<\/title>/i, '<title>Rawgadz - Minimalist Gadgets</title>');
  html = html.replace(/<meta\s+name="description"\s+content=".*?"\s*\/?>/i, '<meta name="description" content="Explore our curated collection of minimalist gadgets and car accessories at Rawgadz.">');

  html = html.replace(/(<nav class="hidden md:flex[^>]*>[\s\S]*?<a\s+href="\.\/index\.html"\s+class=")[^"]*(")/i, '$1hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600$2');
  html = html.replace(/(<nav class="hidden md:flex[^>]*>[\s\S]*?<a\s+href="\.\/gadgets\.html"\s+class=")[^"]*(")/i, '$1hover:text-black transition-colors font-bold text-xs tracking-wider uppercase text-black border-b-2 border-black pb-0.5$2');

  html = html.replace(/heroSlider\(['"]index['"]\)/g, `heroSlider('gadgets')`);
  html = html.replace(/aria-label="Hero Slider"/g, `aria-label="Gadgets Hero Slider"`);

  html = html.replace(/(?:all|resolved)\.filter\(\s*p\s*=>[^)]+\)/g, `resolved.filter(p => p.tab === 'gadget')`);
  html = html.replace(/carouselSource:\s*['"][^'"]+['"]/g, `carouselSource: '/data/gadgets.json'`);

  fs.writeFileSync(GADGETS_OUTPUT_FILE, html, 'utf-8');
  console.log(`[build-products] Generated ${GADGETS_OUTPUT_FILE}`);
}

if (require.main === module) {
  generateProductJson();
}

module.exports = {
  generateProductJson,
  buildStandaloneProductPages,
  buildGadgetsPage,
  normalizeSubProduct
}; 