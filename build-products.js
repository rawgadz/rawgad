const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const CONTENT_DIR = path.join(__dirname, 'content', 'product');
const ROOT_OUTPUT_FILE = path.join(__dirname, 'products.json');
const PUBLIC_OUTPUT_FILE = path.join(__dirname, 'public', 'products.json');
const HTML_OUTPUT_DIR = path.join(__dirname, 'product');
const INDEX_HTML_FILE = path.join(__dirname, 'index.html');
const GADGETS_OUTPUT_FILE = path.join(__dirname, 'gadgets.html');

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

function normalizeSubProduct(sub, parentPrice = null) {
  if (!sub || typeof sub !== 'object') return null;

  const typePrice = (sub.price !== undefined && sub.price !== null && sub.price !== '')
    ? (Number(sub.price) || 0)
    : parentPrice;

  const rawNested = Array.isArray(sub.subProducts)
    ? sub.subProducts
    : (Array.isArray(sub.subproducts)
      ? sub.subproducts
      : (Array.isArray(sub.types) ? sub.types : []));

  const subProducts = rawNested.map(item => {
    if (!item || typeof item !== 'object') return null;
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
      subTitle: item.subTitle || item.title || ''
    };
    if (typeof itemPrice === 'number' && !isNaN(itemPrice)) {
      nestedItem.price = itemPrice;
    }
    return nestedItem;
  }).filter(Boolean);

  const typeImages = Array.isArray(sub.images)
    ? sub.images.map(img => String(img).trim()).filter(Boolean)
    : (sub.subImage || sub.imageSrc || sub.image ? [String(sub.subImage || sub.imageSrc || sub.image).trim()] : []);

  const normalized = {
    subProductId: String(sub.subProductId || sub.id || '').trim(),
    subImage: typeImages[0] || sub.subImage || sub.imageSrc || sub.image || '',
    images: typeImages,
    subTitle: sub.subTitle || sub.title || ''
  };

  if (typeof typePrice === 'number' && !isNaN(typePrice)) {
    normalized.price = typePrice;
  }

  if (subProducts.length > 0) {
    normalized.subProducts = subProducts;
  }

  return normalized;
}

function generateStandaloneProductHTML(product) {
  const types = Array.isArray(product.types) ? product.types : [];
  const firstType = types.length > 0 ? types[0] : null;
  const firstSub = (firstType && firstType.subProducts && firstType.subProducts.length > 0) ? firstType.subProducts[0] : null;

  const initialImage = firstSub?.images?.[0] || firstSub?.subImage || firstType?.images?.[0] || firstType?.subImage || product.images?.[0] || product.imageSrc;
  const initialPrice = firstSub?.price ?? firstType?.price ?? product.price;

  const tagsHtml = product.tags
    ? product.tags.split(',').map(tag => `<span class="bg-neutral-100 text-neutral-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border border-neutral-200">${escapeHtml(tag.trim())}</span>`).join('\n             ')
    : '';

  const sanitizedProductJson = JSON.stringify(product).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(product.title)} | Rawgadz</title>
  <meta name="description" content="${escapeHtml(product.description || product.title)}">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="../stock.js"></script>

  <style>
    [x-cloak] { display: none !important; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .custom-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
    .custom-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 4px; }
    .custom-scroll::-webkit-scrollbar-thumb:hover { background: #a3a3a3; }

    .product-content h1 { font-size: 1.875rem; font-weight: 900; margin-top: 1.5rem; margin-bottom: 1rem; color: #000; line-height: 1.25; letter-spacing: -0.025em; }
    .product-content h2 { font-size: 1.5rem; font-weight: 800; margin-top: 1.25rem; margin-bottom: 0.75rem; color: #171717; letter-spacing: -0.02em; }
    .product-content h3 { font-size: 1.25rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.5rem; color: #262626; }
    .product-content p { font-size: 0.95rem; line-height: 1.7; margin-bottom: 1.25rem; color: #404040; }
    .product-content ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1.25rem; color: #404040; }
    .product-content ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 1.25rem; color: #404040; }
    .product-content li { margin-bottom: 0.5rem; font-size: 0.95rem; line-height: 1.6; }
    .product-content blockquote { border-left: 4px solid #171717; padding-left: 1rem; font-style: italic; margin-top: 1.25rem; margin-bottom: 1.25rem; color: #525252; }
    .product-content pre { background-color: #171717; color: #f5f5f5; padding: 1rem; overflow-x: auto; margin-top: 1.25rem; margin-bottom: 1.25rem; font-size: 0.875rem; border-radius: 0.75rem; }
    .product-content code { background-color: #f5f5f5; color: #171717; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.875rem; font-family: monospace; }
    .product-content pre code { background-color: transparent; color: inherit; padding: 0; }
    .product-content a { color: #000; text-decoration: underline; font-weight: 600; }
    .product-content a:hover { color: #525252; }
  </style>
</head>
<body class="bg-neutral-50 min-h-screen flex flex-col font-sans text-neutral-900 selection:bg-black selection:text-white pb-24 md:pb-0" x-data="{ mobileMenuOpen: false }">

  <!-- Responsive Navbar -->
  <header class="sticky top-0 z-40 bg-white border-b border-neutral-200 shadow-sm w-full">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      <a href="../index.html" class="font-black text-xl tracking-wider text-black uppercase hover:opacity-80 transition-opacity flex-shrink-0">RAWGADZ</a>

      <nav class="hidden md:flex md:flex-row md:items-center md:gap-6 flex-grow">
        <a href="../index.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Home</a>
        <a href="../index.html#shop" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Shop</a>
        <a href="../gadgets.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Gadgets</a>
        <a href="../car.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Cars</a>
        <a href="../blog.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Blog</a>
        <a href="../contact.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Contact</a>
      </nav>

      <div class="flex items-center gap-3 ml-auto flex-shrink-0">
        <button @click="$store.cart.isOpen = true" type="button" aria-label="View Cart" class="relative p-2.5 text-black hover:bg-neutral-100 rounded-full transition-colors border border-neutral-300 focus:outline-none flex items-center justify-center cursor-pointer hidden md:flex">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
          </svg>
          <span x-show="$store.cart.totalCount > 0" x-text="$store.cart.totalCount" class="absolute -top-1 -right-1 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold text-white bg-black rounded-full border-2 border-white" style="display: none;"></span>
        </button>

        <button @click="mobileMenuOpen = !mobileMenuOpen" aria-label="Toggle Navigation Menu" class="md:hidden p-2 rounded-xl text-neutral-700 hover:text-black hover:bg-neutral-100 transition-colors focus:outline-none">
          <svg x-show="!mobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>
          <svg x-show="mobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="display: none;"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>

    <div x-show="mobileMenuOpen" x-transition @click.away="mobileMenuOpen = false" class="md:hidden flex flex-col absolute top-16 left-0 right-0 bg-white border-b border-neutral-200 p-6 shadow-xl z-50 gap-4" style="display: none;">
      <a href="../index.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Home</a>
      <a href="../index.html#shop" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Shop</a>
      <a href="../gadgets.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Gadgets</a>
      <a href="../car.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Cars</a>
      <a href="../blog.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Blog</a>
      <a href="../contact.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Contact</a>
    </div>
  </header>

  <!-- Slide-Over Cart Drawer -->
  <div x-show="$store.cart.isOpen" class="fixed inset-0 bg-black/60 z-50 transition-opacity" @click="$store.cart.isOpen = false" style="display: none;"></div>
  <div x-show="$store.cart.isOpen" x-transition:enter="transform transition ease-in-out duration-300" x-transition:enter-start="translate-x-full" x-transition:enter-end="translate-x-0" x-transition:leave="transform transition ease-in-out duration-300" x-transition:leave-start="translate-x-0" x-transition:leave-end="translate-x-full" class="fixed inset-y-0 right-0 max-w-sm w-full bg-white border-l border-neutral-200 z-50 flex flex-col shadow-2xl" style="display: none;">
    <div class="flex items-center justify-between p-6 border-b border-neutral-200">
      <h2 class="text-base font-black text-black uppercase tracking-wider">Your Cart</h2>
      <button @click="$store.cart.isOpen = false" class="p-1 text-neutral-400 hover:text-black focus:outline-none transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
    <div class="flex-grow overflow-y-auto p-6 space-y-4">
      <template x-if="$store.cart.itemsArray.length === 0">
        <p class="text-neutral-400 text-center mt-12 font-bold text-xs uppercase tracking-wider">Your cart is empty.</p>
      </template>
      <template x-for="item in $store.cart.itemsArray" :key="item.cartKey || item.subProductId || item.id">
        <div class="flex gap-4 items-center bg-neutral-50 p-3 rounded-2xl border border-neutral-200">
          <img :src="item.imageSrc" :alt="item.title" class="w-14 h-14 object-cover rounded-xl bg-white border border-neutral-200">
          <div class="flex flex-col flex-grow">
            <span class="font-bold text-black text-xs leading-tight mb-1" x-text="item.title"></span>
            <span class="text-xs text-neutral-500 font-semibold" x-text="'BDT ' + Number(item.price).toFixed(2)"></span>
          </div>
          <div class="flex flex-col items-center border border-neutral-300 rounded-xl overflow-hidden bg-white">
            <button @click="$store.cart.updateQuantity(item.cartKey || item.subProductId || item.id, item.quantity + 1)" class="px-2.5 py-0.5 bg-neutral-100 hover:bg-black hover:text-white font-bold text-xs transition-colors">+</button>
            <div class="bg-white font-black text-black w-full text-center text-xs py-0.5" x-text="item.quantity"></div>
            <button @click="$store.cart.updateQuantity(item.cartKey || item.subProductId || item.id, item.quantity - 1)" class="px-2.5 py-0.5 bg-neutral-100 hover:bg-black hover:text-white font-bold text-xs transition-colors">-</button>
          </div>
        </div>
      </template>
    </div>
    <div class="p-6 border-t border-neutral-200 bg-neutral-50">
      <div class="flex justify-between items-center mb-6">
        <span class="font-semibold text-neutral-600 text-xs uppercase tracking-wider">Total</span>
        <span class="font-extrabold text-2xl text-black" x-text="'BDT ' + $store.cart.totalPrice.toFixed(2)">BDT 0.00</span>
      </div>
      <a href="../checkout.html" :class="{ 'opacity-40 pointer-events-none': $store.cart.itemsArray.length === 0 }" class="w-full bg-black hover:bg-neutral-800 text-white font-bold text-xs uppercase tracking-wider py-4 rounded-xl transition-all block text-center shadow-sm">Proceed to Checkout</a>
    </div>
  </div>

  <!-- MAIN CONTENT AREA -->
  <main class="p-4 md:p-8 flex flex-col items-center mt-4 w-full max-w-7xl mx-auto flex-grow gap-4" x-data="productPage()" x-cloak>
    
    <!-- ==================== MOBILE LAYOUT ==================== -->
    <div class="w-full md:hidden flex flex-col bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      
      <!-- Main Product Image with Slider Controls & Swipe -->
      <div 
        class="bg-neutral-50 rounded-xl p-3 flex items-center justify-center aspect-square relative overflow-hidden select-none"
        x-data="{ touchStartX: 0, touchEndX: 0 }"
        @touchstart.passive="touchStartX = $event.changedTouches[0].screenX"
        @touchend.passive="touchEndX = $event.changedTouches[0].screenX; if (touchStartX - touchEndX > 40) nextGalleryImage(); if (touchEndX - touchStartX > 40) prevGalleryImage();"
      >
        <img :src="currentImage" :alt="product.title" class="w-full h-full object-contain mix-blend-multiply transition-all duration-300">
        
        <!-- Slider Arrows on Image (Active when multiple images exist) -->
        <template x-if="currentVariantImages && currentVariantImages.length > 1">
          <div class="pointer-events-none absolute inset-0 flex items-center justify-between p-2">
            <button 
              type="button" 
              @click.stop="prevGalleryImage()" 
              class="pointer-events-auto w-8 h-8 rounded-full bg-white/90 hover:bg-white text-black shadow-md flex items-center justify-center transition-all opacity-85 active:scale-90"
              aria-label="Previous Photo"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button 
              type="button" 
              @click.stop="nextGalleryImage()" 
              class="pointer-events-auto w-8 h-8 rounded-full bg-white/90 hover:bg-white text-black shadow-md flex items-center justify-center transition-all opacity-85 active:scale-90"
              aria-label="Next Photo"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </template>
      </div>

      <!-- Small Tiny Thumbnail Gallery Slider (Right Below the Main Image) -->
      <div x-show="currentVariantImages && currentVariantImages.length > 1" class="mt-2.5 mb-3">
        <div class="flex flex-row gap-1.5 overflow-x-auto no-scrollbar py-1 px-0.5 scroll-smooth">
          <template x-for="(imgUrl, i) in currentVariantImages" :key="'mobile-thumb-' + i">
            <button 
              type="button" 
              @click="selectedGalleryImage = imgUrl" 
              class="w-11 h-11 rounded-md border bg-neutral-50 p-0.5 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer overflow-hidden" 
              :class="currentImage === imgUrl ? 'border-black ring-1 ring-black shadow-xs' : 'border-neutral-200 opacity-60 hover:opacity-100'"
              :aria-label="'View photo ' + (i + 1)"
            >
              <img :src="imgUrl" class="w-full h-full object-contain mix-blend-multiply">
            </button>
          </template>
        </div>
      </div>

      <!-- Main Product Info -->
      <div class="flex flex-col mt-1">
        <div class="flex flex-wrap gap-1 mb-2">${tagsHtml}</div>
        <h1 class="text-base font-black text-black mb-2 leading-tight tracking-tight" x-text="product.title">${escapeHtml(product.title)}</h1>

        <div class="flex items-baseline gap-2 mb-2">
          <span class="text-lg font-black text-black tracking-tight" x-text="'BDT ' + currentPrice.toFixed(2)">BDT ${Number(initialPrice).toFixed(2)}</span>
          <template x-if="currentPrice !== product.price">
            <span class="text-[10px] font-bold text-neutral-400 line-through" x-text="'BDT ' + Number(product.price).toFixed(2)"></span>
          </template>
        </div>

        <div class="mb-3">
          <template x-if="stockStatus === 'in_stock'">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold uppercase tracking-wider">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>In Stock (<span x-text="currentStock"></span>)</span>
            </div>
          </template>
          <template x-if="stockStatus === 'low_stock'">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold uppercase tracking-wider">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span>Low Stock (<span x-text="currentStock"></span>)</span>
            </div>
          </template>
          <template x-if="stockStatus === 'out_of_stock'">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-[10px] font-bold uppercase tracking-wider">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              <span>Out of Stock</span>
            </div>
          </template>
          <template x-if="stockStatus === 'loading'">
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-600 text-[10px] font-medium">
              <svg class="animate-spin h-3 w-3 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              <span>Checking...</span>
            </div>
          </template>
        </div>

        <template x-if="product.types && product.types.length > 0">
          <div class="mb-2">
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
              </svg>
              Select Variant
            </label>
            <div class="relative">
              <select x-model.number="selectedTypeIndex" @change="selectType(selectedTypeIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-2 pr-8 text-xs font-bold focus:outline-none focus:border-black">
                <template x-for="(type, idx) in product.types" :key="idx">
                  <option :value="idx" x-text="type.subTitle + (type.price && type.price !== product.price ? ' — BDT ' + Number(type.price).toFixed(2) : '')"></option>
                </template>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-neutral-500">
                <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        </template>

        <template x-if="selectedType && selectedType.subProducts && selectedType.subProducts.length > 0">
          <div class="mb-3">
            <label class="flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
              </svg>
              Select Option
            </label>
            <div class="relative">
              <select x-model.number="selectedSubProductIndex" @change="selectSubProduct(selectedSubProductIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-2 pr-8 text-xs font-bold focus:outline-none focus:border-black">
                <template x-for="(sub, sIdx) in selectedType.subProducts" :key="sIdx">
                  <option :value="sIdx" x-text="sub.subTitle + (sub.price && sub.price !== (selectedType.price || product.price) ? ' — BDT ' + Number(sub.price).toFixed(2) : '')"></option>
                </template>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-neutral-500">
                <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          </div>
        </template>

        <div class="border-t border-neutral-200 pt-2 mt-1">
          <p class="text-neutral-600 text-xs leading-relaxed" x-text="product.description">${escapeHtml(product.description)}</p>
        </div>
      </div>
    </div>


    <!-- ==================== DESKTOP LAYOUT (3-Column: Thumbnails | Image | Info Panel) ==================== -->
    <div class="w-full max-w-6xl mx-auto hidden md:block">
      <div class="w-full bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
        <div class="flex flex-row w-full">
          
          <!-- COLUMN 1: Vertical Thumbnail Gallery -->
          <div x-show="currentVariantImages && currentVariantImages.length > 0" class="w-24 flex-shrink-0 bg-neutral-50 border-r border-neutral-200 p-4 flex flex-col gap-3 overflow-y-auto max-h-[700px]">
            <template x-for="(imgUrl, i) in currentVariantImages" :key="'thumb-' + i">
              <button type="button" @click="selectedGalleryImage = imgUrl" class="w-full aspect-square rounded-xl border-2 bg-white p-1.5 flex items-center justify-center shrink-0 transition-all cursor-pointer overflow-hidden hover:shadow-md" :class="currentImage === imgUrl ? 'border-black ring-2 ring-black ring-offset-1' : 'border-neutral-200 hover:border-neutral-400 opacity-70 hover:opacity-100'" :aria-label="'View photo ' + (i + 1)">
                <img :src="imgUrl" :alt="'Thumbnail ' + (i + 1)" class="w-full h-full object-contain mix-blend-multiply">
              </button>
            </template>
          </div>

          <!-- COLUMN 2: Main Product Image -->
          <div class="flex-1 bg-neutral-50 p-8 flex items-center justify-center min-h-[500px] border-r border-neutral-200">
            <img :src="currentImage" :alt="product.title" class="w-full max-w-lg object-contain mix-blend-multiply transition-all duration-300">
          </div>

          <!-- COLUMN 3: Info Panel (Title, Price, Quantity, 2x2 Buttons, Brand) -->
          <div class="w-[340px] lg:w-[380px] flex-shrink-0 p-6 lg:p-8 flex flex-col">
            
            <!-- Tags -->
            <div class="flex flex-wrap gap-1.5 mb-3">${tagsHtml}</div>

            <!-- Title -->
            <h1 class="text-xl lg:text-2xl font-black text-black mb-3 leading-tight tracking-tight" x-text="product.title">${escapeHtml(product.title)}</h1>

            <!-- Price Row -->
            <div class="flex items-baseline gap-2 mb-4">
              <span class="text-2xl lg:text-3xl font-black text-black tracking-tight" x-text="'BDT ' + currentPrice.toFixed(2)">BDT ${Number(initialPrice).toFixed(2)}</span>
              <template x-if="currentPrice !== product.price">
                <span class="text-sm font-bold text-neutral-400 line-through" x-text="'BDT ' + Number(product.price).toFixed(2)"></span>
              </template>
              <template x-if="currentPrice !== product.price">
                <span class="text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded">Save</span>
              </template>
            </div>

            <!-- Stock Status -->
            <div class="mb-5">
              <template x-if="stockStatus === 'in_stock'">
                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold uppercase tracking-wider">
                  <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>In Stock (<span x-text="currentStock"></span> available)</span>
                </div>
              </template>
              <template x-if="stockStatus === 'low_stock'">
                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold uppercase tracking-wider">
                  <span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  <span>Low Stock — Only <span x-text="currentStock"></span> remaining</span>
                </div>
              </template>
              <template x-if="stockStatus === 'out_of_stock'">
                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold uppercase tracking-wider">
                  <span class="w-2 h-2 rounded-full bg-rose-500"></span>
                  <span>Out of Stock</span>
                </div>
              </template>
              <template x-if="stockStatus === 'loading'">
                <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-600 text-xs font-medium">
                  <svg class="animate-spin h-3.5 w-3.5 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <span>Checking stock...</span>
                </div>
              </template>
            </div>

            <!-- Quantity Stepper -->
            <div class="mb-5">
              <label class="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Quantity</label>
              <div class="inline-flex items-center border border-neutral-300 rounded-lg overflow-hidden bg-white">
                <button type="button" @click="updateCart(Math.max(0, inCartQuantity - 1))" class="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-black font-bold text-sm transition-colors border-r border-neutral-300">−</button>
                <div class="px-5 py-2 font-black text-sm text-black bg-white min-w-[50px] text-center" x-text="inCartQuantity === 0 ? 1 : inCartQuantity">1</div>
                <button type="button" :disabled="isOutOfStock || inCartQuantity >= currentStock" :class="{ 'opacity-40 cursor-not-allowed': isOutOfStock || inCartQuantity >= currentStock }" @click="updateCart(inCartQuantity + 1)" class="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-black font-bold text-sm transition-colors border-l border-neutral-300">+</button>
              </div>
            </div>

            <!-- Variant Dropdown -->
            <template x-if="product.types && product.types.length > 0">
              <div class="mb-4">
                <label class="flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
                  </svg>
                  Select Variant
                </label>
                <div class="relative">
                  <select x-model.number="selectedTypeIndex" @change="selectType(selectedTypeIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-2.5 pr-10 text-sm font-bold focus:outline-none focus:border-black">
                    <template x-for="(type, idx) in product.types" :key="idx">
                      <option :value="idx" x-text="type.subTitle + (type.price && type.price !== product.price ? ' — BDT ' + Number(type.price).toFixed(2) : '')"></option>
                    </template>
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500">
                    <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </div>
              </div>
            </template>

            <!-- Subproduct Dropdown -->
            <template x-if="selectedType && selectedType.subProducts && selectedType.subProducts.length > 0">
              <div class="mb-5">
                <label class="flex items-center gap-1.5 text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
                  </svg>
                  Select Option
                </label>
                <div class="relative">
                  <select x-model.number="selectedSubProductIndex" @change="selectSubProduct(selectedSubProductIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-2.5 pr-10 text-sm font-bold focus:outline-none focus:border-black">
                    <template x-for="(sub, sIdx) in selectedType.subProducts" :key="sIdx">
                      <option :value="sIdx" x-text="sub.subTitle + (sub.price && sub.price !== (selectedType.price || product.price) ? ' — BDT ' + Number(sub.price).toFixed(2) : '')"></option>
                    </template>
                  </select>
                  <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500">
                    <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                    </svg>
                  </div>
                </div>
              </div>
            </template>

            <!-- 2x2 Button Grid -->
            <div class="grid grid-cols-2 gap-2.5 mb-4">
              <!-- Add to Cart -->
              <button type="button" :disabled="isOutOfStock || stockStatus === 'loading'" @click="updateCart(1)" :class="(isOutOfStock || stockStatus === 'loading') ? 'opacity-40 cursor-not-allowed bg-neutral-200 text-neutral-500' : 'bg-black hover:bg-neutral-800 text-white cursor-pointer'" class="h-11 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" /></svg>
                Add to Cart
              </button>

              <!-- Buy Now -->
              <button type="button" :disabled="isOutOfStock || stockStatus === 'loading'" @click="buyNow()" :class="(isOutOfStock || stockStatus === 'loading') ? 'opacity-40 cursor-not-allowed bg-neutral-300 text-neutral-500' : 'bg-neutral-900 hover:bg-black text-white cursor-pointer'" class="h-11 rounded-lg font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center shadow-sm">
                Buy Now
              </button>

              <!-- WhatsApp (full width on row 2) -->
              <a :href="'https://wa.me/?text=' + encodeURIComponent('Hi, I\\'m interested in this product: ' + product.title + ' - ' + (typeof window !== 'undefined' ? window.location.href : ''))" target="_blank" rel="noopener noreferrer" class="col-span-2 h-11 rounded-lg bg-green-500 hover:bg-green-600 text-white font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Order on WhatsApp
              </a>
            </div>

            <!-- Brand Badge -->
            <div class="mt-auto pt-4 border-t border-neutral-200">
              <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-200 bg-white">
                <span class="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Brand:</span>
                <span class="text-sm font-black text-black">Rawgadz</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>


    <!-- Markdown Overview Content Section -->
    ${product.content ? `
    <section class="bg-white rounded-3xl border border-neutral-200 p-6 md:p-10 w-full max-w-6xl shadow-sm">
      <h2 class="text-lg md:text-xl font-black text-black uppercase tracking-wider mb-5 border-b border-neutral-100 pb-3">Product Overview</h2>
      <div class="product-content text-neutral-800">
        ${product.content}
      </div>
    </section>
    ` : ''}


    <!-- ==================== MOBILE: FLOATING CART (Right Side, Black & White) ==================== -->
    <div class="md:hidden fixed right-3 top-1/2 -translate-y-1/2 z-40">
      <button @click="$store.cart.isOpen = true" type="button" aria-label="View Cart" class="relative flex flex-col items-center justify-center bg-black hover:bg-neutral-800 text-white rounded-2xl shadow-lg px-3 py-3 transition-colors min-w-[60px] border border-neutral-800">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
        </svg>
        <span class="text-[9px] font-bold mt-0.5 leading-tight" x-text="$store.cart.totalCount + ' item' + ($store.cart.totalCount !== 1 ? 's' : '')">0 items</span>
        <span class="text-[10px] font-black leading-tight" x-text="'' + $store.cart.totalPrice.toFixed(2)">0.00</span>
      </button>
    </div>

    <!-- ==================== MOBILE: FLOATING BOTTOM ACTION BAR (Add to Cart ↔ Stepper) ==================== -->
    <div class="md:hidden fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/95 backdrop-blur-md border-t border-neutral-200">
      <div class="max-w-lg mx-auto flex items-center gap-2">
        
        <!-- SLOT 1: Add to Cart OR Quantity Stepper (toggles based on inCartQuantity) -->
        <div class="flex-1">
          <!-- Add to Cart Button (shown when quantity is 0) -->
          <button 
            x-show="inCartQuantity === 0"
            type="button"
            @click="updateCart(1)" 
            :disabled="isOutOfStock || stockStatus === 'loading'"
            :class="(isOutOfStock || stockStatus === 'loading') ? 'bg-neutral-200 text-neutral-500 cursor-not-allowed' : 'bg-black hover:bg-neutral-800 text-white'"
            class="w-full h-12 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
            Add to Cart
          </button>

          <!-- Quantity Stepper (shown when quantity > 0, replaces Add to Cart in same slot) -->
          <div 
            x-show="inCartQuantity > 0" 
            class="w-full h-12 rounded-xl overflow-hidden border-2 border-black flex items-center bg-neutral-50"
            style="display: none;"
          >
            <button type="button" @click="updateCart(inCartQuantity - 1)" class="w-10 h-full bg-neutral-100 hover:bg-black hover:text-white text-black font-black text-lg flex items-center justify-center transition-colors flex-shrink-0">−</button>
            <div class="flex-1 h-full bg-white flex items-center justify-center font-black text-sm text-black" x-text="inCartQuantity">1</div>
            <button 
              type="button" 
              :disabled="isOutOfStock || inCartQuantity >= currentStock"
              :class="{ 'opacity-30 cursor-not-allowed': isOutOfStock || inCartQuantity >= currentStock }"
              @click="updateCart(inCartQuantity + 1)" 
              class="w-10 h-full bg-neutral-100 hover:bg-black hover:text-white text-black font-black text-lg flex items-center justify-center transition-colors flex-shrink-0"
            >+</button>
          </div>
        </div>

        <!-- SLOT 2: Buy Now (always visible) -->
        <button 
          type="button"
          @click="buyNow()" 
          :disabled="isOutOfStock || stockStatus === 'loading'"
          :class="(isOutOfStock || stockStatus === 'loading') ? 'bg-neutral-300 text-neutral-500 cursor-not-allowed' : 'bg-neutral-900 text-white hover:bg-black'"
          class="flex-1 h-12 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center shadow-sm"
        >
          Buy Now
        </button>

        <!-- SLOT 3: WhatsApp (always visible) -->
        <a 
          :href="'https://wa.me/?text=' + encodeURIComponent('Hi, I\\'m interested in this product: ' + product.title + ' - ' + (typeof window !== 'undefined' ? window.location.href : ''))"
          target="_blank"
          rel="noopener noreferrer"
          class="flex-1 h-12 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm"
          aria-label="Chat on WhatsApp"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </a>

      </div>
    </div>

  </main>

  <!-- Footer -->
  <footer class="bg-black text-neutral-400 py-16 border-t border-neutral-800 mt-auto">
    <div class="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-12">
      <div class="flex flex-col gap-4">
        <h3 class="text-xs font-bold text-white uppercase tracking-widest">About Rawgadz</h3>
        <p class="text-xs text-neutral-400 leading-relaxed">Premier e-commerce platform for gadgets and car accessories.</p>
      </div>
      <div class="flex flex-col gap-4">
        <h3 class="text-xs font-bold text-white uppercase tracking-widest">Connect</h3>
        <div class="flex flex-col gap-2.5 text-xs">
          <a href="https://twitter.com" target="_blank" rel="noopener" class="text-neutral-400 hover:text-white transition-colors">X (Twitter)</a>
          <a href="https://instagram.com" target="_blank" rel="noopener" class="text-neutral-400 hover:text-white transition-colors">Instagram</a>
          <a href="https://youtube.com" target="_blank" rel="noopener" class="text-neutral-400 hover:text-white transition-colors">YouTube</a>
        </div>
      </div>
      <div class="flex flex-col gap-4" x-data="newsletterForm()">
        <h3 class="text-xs font-bold text-white uppercase tracking-widest">Newsletter</h3>
        <form @submit.prevent="submitNewsletter" class="flex flex-col gap-2">
          <input type="email" x-model="email" placeholder="Enter your email..." required class="border border-neutral-800 bg-neutral-900 text-white px-4 py-2.5 rounded-xl text-xs focus:outline-none focus:border-white w-full">
          <button type="submit" :disabled="submitting" class="bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-bold text-xs uppercase tracking-wider py-2.5 rounded-xl transition-all">
            <span x-text="submitting ? 'Subscribing...' : 'Subscribe'">Subscribe</span>
          </button>
          <div x-show="message" x-text="message" class="text-xs text-center font-bold uppercase tracking-wider py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-white mt-1" style="display: none;"></div>
        </form>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-neutral-900 text-center text-xs text-neutral-500 font-medium">&copy; 2026 Rawgadz. All rights reserved.</div>
  </footer>

  <!-- Alpine.js Global Store & Component Controller -->
  <script>
    document.addEventListener('alpine:init', () => {
      Alpine.store('cart', {
        storageKey: 'main_store_cart',
        items: {},
        isOpen: false,
        init() {
          this.sync();
          window.addEventListener('storage', () => this.sync());
          window.addEventListener('cart-update-' + this.storageKey, () => this.sync());
        },
        sync() {
          try { this.items = JSON.parse(localStorage.getItem(this.storageKey)) || {}; } catch (e) { this.items = {}; }
        },
        get itemsArray() { return Object.values(this.items); },
        get totalCount() { return this.itemsArray.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0); },
        get totalPrice() { return this.itemsArray.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0); },
        updateQuantity(idOrKey, qty) {
          if (qty < 0) return;
          let targetKey = idOrKey;
          if (!this.items[targetKey]) {
            targetKey = Object.keys(this.items).find(k => k === idOrKey || this.items[k]?.cartKey === idOrKey || this.items[k]?.subProductId === idOrKey || this.items[k]?.id === idOrKey);
          }
          if (!targetKey) return;
          if (qty === 0) { delete this.items[targetKey]; } else { this.items[targetKey].quantity = qty; }
          localStorage.setItem(this.storageKey, JSON.stringify(this.items));
          window.dispatchEvent(new Event('cart-update-' + this.storageKey));
        }
      });

      Alpine.data('newsletterForm', () => ({
        email: '', submitting: false, message: '',
        async submitNewsletter() {
          if (!this.email) return;
          this.submitting = true; this.message = '';
          try {
            await fetch('https://script.google.com/macros/s/AKfycbwnstevpnw3FdYnnuMF75_KaZk8Qi_8qqsWX0DsZ-Mr4fWahfmKMZyGHhubMj6ydxiy/exec', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ email: this.email }) });
            this.message = 'Subscribed successfully!'; this.email = '';
          } catch (err) { this.message = 'Subscribed successfully!'; this.email = ''; } 
          finally { this.submitting = false; setTimeout(() => { this.message = ''; }, 4000); }
        }
      }));

      Alpine.data('productPage', () => ({
        product: ${sanitizedProductJson},
        selectedTypeIndex: 0,
        selectedSubProductIndex: 0,
        selectedGalleryImage: null,
        inCartQuantity: 0,
        inventoryMap: {},
        loadingInventory: true,

        init() {
          this.syncCart();
          this.loadInventory();
          window.addEventListener('storage', () => this.syncCart());
          window.addEventListener('cart-update-main_store_cart', () => this.syncCart());
          window.addEventListener('rawgad-stock-updated', () => this.loadInventory());
        },

        loadInventory() {
          if (window.RawgadStock) {
            const cachedMap = window.RawgadStock.getProductStockMap(this.product.id);
            if (cachedMap && Object.keys(cachedMap).length > 0) {
              this.inventoryMap = cachedMap;
              this.loadingInventory = false;
              return;
            }
            this.loadingInventory = true;
            window.RawgadStock.fetchAndStoreAllStock().then(() => {
              this.inventoryMap = window.RawgadStock.getProductStockMap(this.product.id);
              this.loadingInventory = false;
            }).catch(() => { this.loadingInventory = false; });
          } else { this.fetchInventoryFallback(); }
        },

        async fetchInventoryFallback() {
          this.loadingInventory = true;
          try {
            const res = await fetch('/api/inventory?productId=' + encodeURIComponent(this.product.id));
            if (res.ok) {
              const data = await res.json();
              if (data && Array.isArray(data.inventory)) {
                const map = {};
                for (const item of data.inventory) {
                  const key = String(item.typeId) + ':::' + (item.subProductId !== null && item.subProductId !== undefined ? String(item.subProductId) : 'null');
                  map[key] = typeof item.stock === 'number' ? item.stock : 0;
                }
                this.inventoryMap = map;
              }
            }
          } catch (err) { console.warn('[Inventory] Live inventory fetch fallback error:', err); } 
          finally { this.loadingInventory = false; }
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

        get activeItem() { return this.selectedSubProduct || this.selectedType || this.product; },

        get currentVariantImages() {
          if (this.selectedSubProduct && Array.isArray(this.selectedSubProduct.images) && this.selectedSubProduct.images.length > 0) return this.selectedSubProduct.images;
          if (this.selectedType && Array.isArray(this.selectedType.images) && this.selectedType.images.length > 0) return this.selectedType.images;
          if (this.selectedSubProduct && this.selectedSubProduct.subImage) return [this.selectedSubProduct.subImage];
          if (this.selectedType && this.selectedType.subImage) return [this.selectedType.subImage];
          if (Array.isArray(this.product.images) && this.product.images.length > 0) return this.product.images;
          return this.product.imageSrc ? [this.product.imageSrc] : [];
        },

        get activeVariantTitle() {
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          if (type && sub) return type.subTitle + ' - ' + sub.subTitle;
          if (type) return type.subTitle;
          return this.product.title;
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

        get currentStock() {
          if (this.loadingInventory) return null;
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          const typeId = type ? String(type.subProductId || type.id) : 'null';
          const subId = sub ? String(sub.subProductId || sub.id) : 'null';
          const key = typeId + ':::' + subId;
          if (this.inventoryMap && Object.prototype.hasOwnProperty.call(this.inventoryMap, key)) return this.inventoryMap[key];
          if (window.RawgadStock) {
            const direct = window.RawgadStock.getItemStock(this.product.id, typeId, subId);
            if (direct !== null) return direct;
          }
          return 0;
        },

        get stockStatus() {
          if (this.loadingInventory) return 'loading';
          const s = this.currentStock;
          if (typeof s !== 'number' || s <= 0) return 'out_of_stock';
          if (s <= 5) return 'low_stock';
          return 'in_stock';
        },

        get isOutOfStock() { return !this.loadingInventory && (typeof this.currentStock !== 'number' || this.currentStock <= 0); },

        selectType(index) {
          this.selectedTypeIndex = Number(index) || 0;
          this.selectedSubProductIndex = 0;
          this.selectedGalleryImage = null;
          this.syncCart();
        },

        selectSubProduct(index) {
          this.selectedSubProductIndex = Number(index) || 0;
          this.selectedGalleryImage = null;
          this.syncCart();
        },

        prevGalleryImage() {
          const imgs = this.currentVariantImages;
          if (!imgs || imgs.length <= 1) return;
          const current = this.currentImage;
          const idx = imgs.indexOf(current);
          const prevIdx = (idx <= 0 ? imgs.length - 1 : idx - 1);
          this.selectedGalleryImage = imgs[prevIdx];
        },

        nextGalleryImage() {
          const imgs = this.currentVariantImages;
          if (!imgs || imgs.length <= 1) return;
          const current = this.currentImage;
          const idx = imgs.indexOf(current);
          const nextIdx = (idx === -1 || idx >= imgs.length - 1 ? 0 : idx + 1);
          this.selectedGalleryImage = imgs[nextIdx];
        },

        getCartKey() {
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          if (sub) return sub.subProductId || sub.id;
          if (type) return type.subProductId || type.id;
          return this.product.id;
        },

        getCart() { try { return JSON.parse(localStorage.getItem('main_store_cart')) || {}; } catch (e) { return {}; } },

        setCart(cart) {
          try {
            localStorage.setItem('main_store_cart', JSON.stringify(cart));
            window.dispatchEvent(new Event('cart-update-main_store_cart'));
          } catch (e) { console.error('Failed to save cart:', e); }
        },

        syncCart() {
          const key = this.getCartKey();
          const cart = this.getCart();
          const item = cart[key] || Object.values(cart).find(i => i && (i.cartKey === key || i.subProductId === key || (i.typeId === key && !i.subProductId)));
          this.inCartQuantity = (item && item.quantity) ? item.quantity : 0;
        },

        updateCart(newQty) {
          if (newQty < 0) return;
          if (this.isOutOfStock && newQty > 0) return;

          const key = this.getCartKey();
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          const cart = this.getCart();

          if (newQty > 0 && typeof this.currentStock === 'number' && newQty > this.currentStock) {
            alert('Sorry, only ' + this.currentStock + ' items are currently in stock.');
            return;
          }

          if (newQty === 0) {
            delete cart[key];
            for (const k of Object.keys(cart)) {
              if (cart[k]?.cartKey === key || cart[k]?.subProductId === key) delete cart[k];
            }
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
          this.setCart(cart);
          this.syncCart();
        },

        buyNow() {
          if (this.isOutOfStock) return;
          if (this.inCartQuantity === 0) this.updateCart(1);
          if (this.inCartQuantity > 0) window.location.href = '../checkout.html';
        }
      }));
    });
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
  if (files.length === 0) {
    console.warn(`[build-products] Warning: No .md files found in ${CONTENT_DIR}`);
  }

  const products = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(fileContent);

    if (!data.id || !data.title) {
      console.warn(`[build-products] Warning: Skipping ${file}. Missing required 'id' or 'title' in frontmatter.`);
      continue;
    }

    let slug = '';
    if (data.slug !== undefined && data.slug !== null && String(data.slug).trim() !== '') {
      slug = sanitizeSlug(String(data.slug));
      if (!slug) slug = slugify(data.title);
    } else { slug = slugify(data.title); }
    if (!slug) slug = slugify(String(data.id));

    let tab = 'normal';
    if (data.tab !== undefined && data.tab !== null && String(data.tab).trim() !== '') {
      const rawTab = String(data.tab).trim().toLowerCase();
      if (rawTab !== 'normal' && rawTab !== 'gadget') {
        throw new Error(`Invalid product tab "${data.tab}" for product ${data.id}. Allowed values: normal, gadget.`);
      }
      tab = rawTab;
    }

    const htmlContent = marked.parse(content || '');
    const rawTypes = Array.isArray(data.types) ? data.types : (Array.isArray(data.subProducts) ? data.subProducts : (Array.isArray(data.subproducts) ? data.subproducts : []));
    const productPrice = Number(data.price) || 0;
    const types = rawTypes.map(item => normalizeSubProduct(item, productPrice)).filter(Boolean);

    const productImages = Array.isArray(data.images) ? data.images.map(img => String(img).trim()).filter(Boolean) : (data.imageSrc ? [String(data.imageSrc).trim()] : []);
    const imageSrc = productImages[0] || data.imageSrc || '';

    let priceRange = null;
    if (data.priceRange && typeof data.priceRange === 'object' && data.priceRange.min !== undefined && data.priceRange.max !== undefined) {
      priceRange = { min: Number(data.priceRange.min) || 0, max: Number(data.priceRange.max) || 0 };
    } else {
      const allPrices = [productPrice];
      for (const t of types) {
        if (typeof t.price === 'number') allPrices.push(t.price);
        if (Array.isArray(t.subProducts)) {
          for (const s of t.subProducts) { if (typeof s.price === 'number') allPrices.push(s.price); }
        }
      }
      priceRange = { min: Math.min(...allPrices), max: Math.max(...allPrices) };
    }

    const tags = Array.isArray(data.tags) ? data.tags.filter(Boolean).join(', ') : (typeof data.tags === 'string' ? data.tags : '');

    products.push({
      id: String(data.id), slug: slug, tab: tab, imageSrc: imageSrc, images: productImages,
      title: data.title, description: data.description || '', price: productPrice,
      priceRange: priceRange, tags: tags, types: types, content: htmlContent
    });
  }

  const slugToIds = new Map();
  for (const product of products) {
    if (!slugToIds.has(product.slug)) slugToIds.set(product.slug, []);
    slugToIds.get(product.slug).push(product.id);
  }
  const duplicateErrors = [];
  for (const [slug, ids] of slugToIds.entries()) {
    if (ids.length > 1) duplicateErrors.push(`Duplicate slug "${slug}" detected in products: ${ids.join(', ')}`);
  }
  if (duplicateErrors.length > 0) {
    throw new Error(`[build-products] Build failed due to duplicate slugs:\n` + duplicateErrors.join('\n'));
  }

  products.sort((a, b) => a.id.localeCompare(b.id));
  const jsonPayload = JSON.stringify(products, null, 2);

  fs.writeFileSync(ROOT_OUTPUT_FILE, jsonPayload);

  const publicDir = path.dirname(PUBLIC_OUTPUT_FILE);
  if (fs.existsSync(publicDir)) {
    fs.writeFileSync(PUBLIC_OUTPUT_FILE, jsonPayload);
    const rootIndexJson = path.join(__dirname, 'index.json');
    const publicIndexJson = path.join(publicDir, 'index.json');
    if (fs.existsSync(rootIndexJson)) fs.copyFileSync(rootIndexJson, publicIndexJson);

    const rootGadgetsJson = path.join(__dirname, 'gadgets.json');
    const publicGadgetsJson = path.join(publicDir, 'gadgets.json');
    if (fs.existsSync(rootGadgetsJson)) fs.copyFileSync(rootGadgetsJson, publicGadgetsJson);

    const rootHeroJson = path.join(__dirname, 'hero.json');
    const publicHeroJson = path.join(publicDir, 'hero.json');
    if (fs.existsSync(rootHeroJson)) fs.copyFileSync(rootHeroJson, publicHeroJson);

    const rootHeroSliderJs = path.join(__dirname, 'hero-slider.js');
    const publicHeroSliderJs = path.join(publicDir, 'hero-slider.js');
    if (fs.existsSync(rootHeroSliderJs)) fs.copyFileSync(rootHeroSliderJs, publicHeroSliderJs);
  }

  const productPagesCount = buildStandaloneProductPages(products);
  buildGadgetsPage();

  const normalCount = products.filter(p => p.tab === 'normal').length;
  const gadgetCount = products.filter(p => p.tab === 'gadget').length;

  console.log(`Products: ${products.length}`);
  console.log(`Normal products: ${normalCount}`);
  console.log(`Gadget products: ${gadgetCount}`);
  console.log(`Product pages generated: ${productPagesCount}`);
  console.log(`Gadgets page generated: gadgets.html`);

  return products;
}

function buildStandaloneProductPages(products) {
  if (!fs.existsSync(HTML_OUTPUT_DIR)) fs.mkdirSync(HTML_OUTPUT_DIR, { recursive: true });
  const existingFiles = fs.readdirSync(HTML_OUTPUT_DIR).filter(file => file.endsWith('.html'));
  for (const file of existingFiles) fs.unlinkSync(path.join(HTML_OUTPUT_DIR, file));

  let count = 0;
  products.forEach(product => {
    const filePath = path.join(HTML_OUTPUT_DIR, `${product.slug}.html`);
    fs.writeFileSync(filePath, generateStandaloneProductHTML(product));
    count++;
  });
  return count;
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

  html = html.replace(/(<div[^>]*x-show="mobileMenuOpen"[^>]*>[\s\S]*?<a\s+href="\.\/index\.html"\s+class=")[^"]*(")/i, '$1hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600$2');
  html = html.replace(/(<div[^>]*x-show="mobileMenuOpen"[^>]*>[\s\S]*?<a\s+href="\.\/gadgets\.html"\s+class=")[^"]*(")/i, '$1hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-black font-bold border-b-2 border-black pb-0.5$2');

  html = html.replace(/heroSlider\(['"]index['"]\)/g, `heroSlider('gadgets')`);
  html = html.replace(/aria-label="Hero Slider"/g, `aria-label="Gadgets Hero Slider"`);

  html = html.replace(/<h2 class="text-2xl md:text-3xl font-black tracking-tight text-neutral-900">\s*Featured Products\s*<\/h2>/i, `<h2 class="text-2xl md:text-3xl font-black tracking-tight text-neutral-900">\n            Featured Gadgets\n          </h2>`);
  html = html.replace(/<span class="text-xs font-bold uppercase tracking-wider text-neutral-400">\s*All Products Catalog\s*<\/span>/i, `<span class="text-xs font-bold uppercase tracking-wider text-neutral-400">\n          Gadgets Catalog\n        </span>`);

  html = html.replace(/all\.filter\(p\s*=>\s*!p\.tab\s*\Vert{}\Vert{}\s*p\.tab\s*===\s*['"]normal['"]\)/g, `all.filter(p => p.tab === 'gadget')`);
  html = html.replace(/carouselSource:\s*['"]\.\/index\.json['"]/g, `carouselSource: './gadgets.json'`);

  fs.writeFileSync(GADGETS_OUTPUT_FILE, html, 'utf-8');
}

if (require.main === module) {
  generateProductJson();
}

module.exports = {
  generateProductJson,
  buildStandaloneProductPages,
  buildGadgetsPage
};