const fs = require('fs');
const path = require('path');
const generateCarsJson = require('./build-car');

const CARS_JSON_FILE = path.join(__dirname, 'cars.json');
const HTML_OUTPUT_DIR = path.join(__dirname, 'cr');

/**
 * Escapes HTML characters for safe injection into markup attributes/text
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Extracts YouTube embed URL from any watch or short link
 */
function getYoutubeEmbedUrl(url) {
  if (!url) return '';
  if (url.includes('/embed/')) return url;
  const matchWatch = url.match(/[?&]v=([^&]+)/);
  if (matchWatch) return 'https://www.youtube.com/embed/' + matchWatch[1];
  const matchShort = url.match(/youtu\.be\/([^?&]+)/);
  if (matchShort) return 'https://www.youtube.com/embed/' + matchShort[1];
  return url;
}

/**
 * Generates standalone static HTML pages for each vehicle in cr/ folder using Alpine.js CDN.
 */
function generateStandaloneCarHTML(car) {
  const types = Array.isArray(car.types) ? car.types : [];
  const firstType = types.length > 0 ? types[0] : null;
  const firstSub = (firstType && firstType.subProducts && firstType.subProducts.length > 0) ? firstType.subProducts[0] : null;

  const initialImage = firstSub?.images?.[0] || firstSub?.subImage || firstType?.images?.[0] || firstType?.subImage || car.images?.[0] || car.imageSrc;
  const initialPrice = firstSub?.price ?? firstType?.price ?? car.price;

  const tagsHtml = car.tags
    ? car.tags.split(',').slice(0, 4).map(tag => `<span class="bg-neutral-100 text-neutral-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border border-neutral-200">${escapeHtml(tag.trim())}</span>`).join('\n              ')
    : '';

  const sanitizedCarJson = JSON.stringify(car).replace(/</g, '\\u003c');
  const embedYoutubeUrl = getYoutubeEmbedUrl(car.youtube || car.youtubeUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(car.title)} - Rawgadz Automotive</title>
  <meta name="description" content="${escapeHtml(car.description || car.title)}">
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  
  <!-- Alpine.js CDN -->
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>

  <!-- Stock & Inventory 24-Hour Cache Manager -->
  <script src="../stock.js"></script>

  <style>
    [x-cloak] { display: none !important; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .custom-scroll::-webkit-scrollbar { width: 4px; height: 4px; }
    .custom-scroll::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 4px; }
    .custom-scroll::-webkit-scrollbar-thumb:hover { background: #a3a3a3; }

    .car-content h1 { font-size: 1.75rem; font-weight: 900; margin-top: 1.5rem; margin-bottom: 1rem; color: #000; line-height: 1.25; letter-spacing: -0.025em; }
    .car-content h2 { font-size: 1.4rem; font-weight: 800; margin-top: 1.25rem; margin-bottom: 0.75rem; color: #171717; letter-spacing: -0.02em; }
    .car-content h3 { font-size: 1.15rem; font-weight: 700; margin-top: 1rem; margin-bottom: 0.5rem; color: #262626; }
    .car-content p { font-size: 0.95rem; line-height: 1.7; margin-bottom: 1.25rem; color: #404040; }
    .car-content ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1.25rem; color: #404040; }
    .car-content ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 1.25rem; color: #404040; }
    .car-content li { margin-bottom: 0.5rem; font-size: 0.95rem; line-height: 1.6; }
    .car-content blockquote { border-left: 4px solid #171717; padding-left: 1rem; font-style: italic; margin-top: 1.25rem; margin-bottom: 1.25rem; color: #525252; }
    .car-content pre { background-color: #171717; color: #f5f5f5; padding: 1rem; overflow-x: auto; margin-top: 1.25rem; margin-bottom: 1.25rem; font-size: 0.875rem; border-radius: 0.75rem; }
    .car-content code { background-color: #f5f5f5; color: #171717; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-size: 0.875rem; font-family: monospace; }
    .car-content pre code { background-color: transparent; color: inherit; padding: 0; }
    .car-content a { color: #000; text-decoration: underline; font-weight: 600; }
    .car-content a:hover { color: #525252; }
  </style>
</head>
<body class="bg-neutral-50 min-h-screen flex flex-col font-sans text-neutral-900 selection:bg-black selection:text-white pb-24 md:pb-0" x-data="{ mobileMenuOpen: false }">

  <!-- Responsive Navbar (NO CART) -->
  <header class="sticky top-0 z-40 bg-white border-b border-neutral-200 shadow-sm w-full">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
      
      <!-- Brand Logo -->
      <a href="../index.html" class="font-black text-xl tracking-wider text-black uppercase hover:opacity-80 transition-opacity flex-shrink-0">
        RAWGADZ
      </a>

      <!-- Desktop Links -->
      <nav class="hidden md:flex md:flex-row md:items-center md:gap-6 flex-grow">
        <a href="../index.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Home</a>
        <a href="../index.html#shop" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Shop</a>
        <a href="../gadgets.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Gadgets</a>
        <a href="../car.html" class="hover:text-black transition-colors font-bold text-xs tracking-wider uppercase text-black border-b-2 border-black pb-0.5">Cars</a>
        <a href="../blog.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Blog</a>
        <a href="../contact.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Contact</a>
      </nav>

      <!-- Mobile Hamburger Toggle -->
      <div class="flex items-center gap-3 ml-auto flex-shrink-0">
        <button
          @click="mobileMenuOpen = !mobileMenuOpen"
          aria-label="Toggle Navigation Menu"
          class="md:hidden p-2 rounded-xl text-neutral-700 hover:text-black hover:bg-neutral-100 transition-colors focus:outline-none"
        >
          <svg x-show="!mobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <svg x-show="mobileMenuOpen" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="display: none;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Mobile Navigation Drawer -->
    <div 
      x-show="mobileMenuOpen" 
      x-transition 
      @click.away="mobileMenuOpen = false" 
      class="md:hidden flex flex-col absolute top-16 left-0 right-0 bg-white border-b border-neutral-200 p-6 shadow-xl z-50 gap-4" 
      style="display: none;"
    >
      <a href="../index.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Home</a>
      <a href="../index.html#shop" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Shop</a>
      <a href="../gadgets.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Gadgets</a>
      <a href="../car.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-black font-bold">Cars</a>
      <a href="../blog.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Blog</a>
      <a href="../contact.html" class="hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600">Contact</a>
    </div>
  </header>

  <!-- Main Standalone Vehicle Container with Alpine.js State -->
  <main class="p-4 md:p-8 flex flex-col items-center mt-4 w-full max-w-7xl mx-auto flex-grow gap-4" x-data="carPage()" x-cloak>
    
    <!-- ==================== MOBILE LAYOUT (Side-by-Side Cards) ==================== -->
    <div class="w-full md:hidden flex flex-row gap-3">
      
      <!-- LEFT SIDE: Gallery Card -->
      <div class="w-28 bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm flex flex-col flex-shrink-0">
        <div x-show="currentVariantImages && currentVariantImages.length > 0" class="flex flex-col gap-2 p-2 max-h-64 overflow-y-auto custom-scroll bg-neutral-50">
          <template x-for="(imgUrl, i) in currentVariantImages" :key="'mobile-thumb-' + i">
            <button @click="selectedGalleryImage = imgUrl" class="w-full aspect-square rounded-lg border-2 overflow-hidden transition-all flex-shrink-0" :class="currentImage === imgUrl ? 'border-black ring-1 ring-black' : 'border-neutral-200 opacity-60'">
              <img :src="imgUrl" class="w-full h-full object-cover">
            </button>
          </template>
        </div>
      </div>

      <!-- RIGHT SIDE: Main Info Card -->
      <div class="flex-1 bg-white rounded-2xl border border-neutral-200 p-3 shadow-sm flex flex-col">
        <div class="bg-neutral-50 rounded-xl p-3 mb-3 flex items-center justify-center aspect-square">
          <img :src="currentImage" :alt="car.title" class="w-full h-full object-contain mix-blend-multiply">
        </div>

        <div class="flex flex-wrap gap-1 mb-2">${tagsHtml}</div>
        <h1 class="text-base font-black text-black mb-2 leading-tight tracking-tight" x-text="car.title">${escapeHtml(car.title)}</h1>
        
        <div class="flex items-baseline gap-2 mb-3">
          <span class="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Est. MSRP:</span>
          <span class="text-lg font-black text-black tracking-tight" x-text="'BDT ' + Number(currentPrice).toLocaleString('en-US')">BDT ${Number(initialPrice).toLocaleString('en-US')}</span>
        </div>

        <template x-if="car.types && car.types.length > 0">
          <div class="mb-2">
            <select x-model.number="selectedTypeIndex" @change="selectType(selectedTypeIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-2 text-xs font-bold focus:outline-none focus:border-black">
              <template x-for="(type, idx) in car.types" :key="idx">
                <option :value="idx" x-text="type.subTitle + (type.price && type.price !== car.price ? ' — BDT ' + Number(type.price).toLocaleString('en-US') : '')"></option>
              </template>
            </select>
          </div>
        </template>

        <template x-if="selectedType && selectedType.subProducts && selectedType.subProducts.length > 0">
          <div class="mb-3">
            <select x-model.number="selectedSubProductIndex" @change="selectSubProduct(selectedSubProductIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-2 text-xs font-bold focus:outline-none focus:border-black">
              <template x-for="(sub, sIdx) in selectedType.subProducts" :key="sIdx">
                <option :value="sIdx" x-text="sub.subTitle + (sub.price && sub.price !== (selectedType.price || car.price) ? ' — BDT ' + Number(sub.price).toLocaleString('en-US') : '')"></option>
              </template>
            </select>
          </div>
        </template>

        <div class="border-t border-neutral-200 pt-2 mt-1">
          <p class="text-neutral-600 text-xs leading-relaxed" x-text="car.description">${escapeHtml(car.description)}</p>
        </div>
      </div>
    </div>


    <!-- ==================== DESKTOP LAYOUT (3-Column) ==================== -->
    <div class="w-full max-w-6xl mx-auto hidden md:block">
      <div class="w-full bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
        <div class="flex flex-row w-full">
          
          <!-- COLUMN 1: Vertical Thumbnail Gallery -->
          <div x-show="currentVariantImages && currentVariantImages.length > 0" class="w-24 flex-shrink-0 bg-neutral-50 border-r border-neutral-200 p-4 flex flex-col gap-3 overflow-y-auto max-h-[700px]">
            <template x-for="(imgUrl, i) in currentVariantImages" :key="'thumb-' + i">
              <button type="button" @click="selectedGalleryImage = imgUrl" class="w-full aspect-square rounded-xl border-2 bg-white p-1.5 flex items-center justify-center shrink-0 transition-all cursor-pointer overflow-hidden hover:shadow-md" :class="currentImage === imgUrl ? 'border-black ring-2 ring-black ring-offset-1' : 'border-neutral-200 hover:border-neutral-400 opacity-70 hover:opacity-100'">
                <img :src="imgUrl" :alt="'Thumbnail ' + (i + 1)" class="w-full h-full object-contain mix-blend-multiply">
              </button>
            </template>
          </div>

          <!-- COLUMN 2: Main Image -->
          <div class="flex-1 bg-neutral-50 p-8 flex items-center justify-center min-h-[500px] border-r border-neutral-200">
            <img :src="currentImage" :alt="car.title" class="w-full max-w-lg object-contain mix-blend-multiply transition-all duration-300">
          </div>

          <!-- COLUMN 3: Info Panel -->
          <div class="w-[340px] lg:w-[380px] flex-shrink-0 p-6 lg:p-8 flex flex-col">
            
            <!-- Tags -->
            <div class="flex flex-wrap gap-1.5 mb-3">${tagsHtml}</div>

            <!-- Title -->
            <h1 class="text-xl lg:text-2xl font-black text-black mb-3 leading-tight tracking-tight" x-text="car.title">${escapeHtml(car.title)}</h1>

            <!-- Price -->
            <div class="flex items-baseline gap-2 mb-5">
              <span class="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Est. MSRP:</span>
              <span class="text-2xl lg:text-3xl font-black text-black tracking-tight" x-text="'BDT ' + Number(currentPrice).toLocaleString('en-US')">BDT ${Number(initialPrice).toLocaleString('en-US')}</span>
            </div>

            <!-- Dropdown: Edition / Trim -->
            <template x-if="car.types && car.types.length > 0">
              <div class="mb-4">
                <label class="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Select Edition / Trim</label>
                <select x-model.number="selectedTypeIndex" @change="selectType(selectedTypeIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-black">
                  <template x-for="(type, idx) in car.types" :key="idx">
                    <option :value="idx" x-text="type.subTitle + (type.price && type.price !== car.price ? ' — BDT ' + Number(type.price).toLocaleString('en-US') : '')"></option>
                  </template>
                </select>
              </div>
            </template>

            <!-- Dropdown: Package / Options -->
            <template x-if="selectedType && selectedType.subProducts && selectedType.subProducts.length > 0">
              <div class="mb-5">
                <label class="block text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-2">Select Package / Options</label>
                <select x-model.number="selectedSubProductIndex" @change="selectSubProduct(selectedSubProductIndex)" class="w-full appearance-none bg-neutral-50 border border-neutral-300 rounded-lg px-3 py-2.5 text-sm font-bold focus:outline-none focus:border-black">
                  <template x-for="(sub, sIdx) in selectedType.subProducts" :key="sIdx">
                    <option :value="sIdx" x-text="sub.subTitle + (sub.price && sub.price !== (selectedType.price || car.price) ? ' — BDT ' + Number(sub.price).toLocaleString('en-US') : '')"></option>
                  </template>
                </select>
              </div>
            </template>

            <!-- Action Buttons (Black Primary with White Text) -->
            <div class="flex flex-col gap-3 mt-auto">
              <button 
                type="button"
                @click="contactNow()" 
                class="w-full h-12 rounded-xl bg-black hover:bg-neutral-800 text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Contact Now
              </button>
              
              <button 
                type="button"
                @click="whatsappNow()" 
                class="w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.506-.669-.514-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.084 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                </svg>
                WhatsApp
              </button>
            </div>
            <p class="text-[10px] text-center text-neutral-400 font-medium mt-4">Inquire for allocations, bespoke build sheet, or test drive.</p>

          </div>
        </div>
      </div>
    </div>


    <!-- Vehicle Video / Media Section -->
    ${(car.video || car.videoUrl || car.youtube || car.youtubeUrl) ? `
    <section class="bg-white rounded-3xl border border-neutral-200 p-6 md:p-10 w-full max-w-6xl shadow-sm">
      <div class="flex items-center justify-between mb-5 border-b border-neutral-100 pb-3">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">Cinematic Showcase</span>
          <h2 class="text-lg md:text-xl font-black text-black uppercase tracking-wider">Vehicle Video &amp; Sound</h2>
        </div>
        <span class="text-xs font-bold text-neutral-500 bg-neutral-100 px-3 py-1 rounded-full uppercase tracking-wider border border-neutral-200">
          ${car.video ? 'HD Video' : 'YouTube'}
        </span>
      </div>
      <div class="w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-md border border-neutral-200 flex items-center justify-center">
        ${car.video ? `
          <video 
            src="${escapeHtml(car.video || car.videoUrl)}" 
            poster="${escapeHtml(car.imageSrc || '')}" 
            controls 
            playsinline 
            preload="metadata" 
            class="w-full h-full object-cover"
          ></video>
        ` : `
          <iframe 
            src="${escapeHtml(embedYoutubeUrl)}" 
            title="${escapeHtml(car.title)} Video" 
            class="w-full h-full border-0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
            allowfullscreen 
            loading="lazy"
          ></iframe>
        `}
      </div>
    </section>
    ` : ''}

    <!-- Vehicle Overview Rich Content Section -->
    ${car.content ? `
    <section class="bg-white rounded-3xl border border-neutral-200 p-6 md:p-10 w-full max-w-6xl shadow-sm">
      <h2 class="text-lg md:text-xl font-black text-black uppercase tracking-wider mb-5 border-b border-neutral-100 pb-3">Technical Specifications</h2>
      <div class="car-content text-neutral-800">
        ${car.content}
      </div>
    </section>
    ` : ''}


    <!-- ==================== MOBILE FLOATING BOTTOM ACTION BAR ==================== -->
    <div class="md:hidden fixed bottom-0 left-0 right-0 z-40 p-3 bg-white/95 backdrop-blur-md border-t border-neutral-200">
      <div class="max-w-lg mx-auto flex items-center gap-2">
        
        <!-- Contact Now Button -->
        <button 
          type="button"
          @click="contactNow()" 
          class="flex-1 h-12 rounded-xl bg-black hover:bg-neutral-800 text-white font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Contact
        </button>

        <!-- WhatsApp Button -->
        <button 
          type="button"
          @click="whatsappNow()" 
          class="flex-1 h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.506-.669-.514-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.084 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
          </svg>
          WhatsApp
        </button>

      </div>
    </div>

  </main>

  <!-- Footer -->
  <footer class="bg-black text-neutral-400 py-16 border-t border-neutral-800 mt-auto">
    <div class="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-12">
      
      <div class="flex flex-col gap-4">
        <h3 class="text-xs font-bold text-white uppercase tracking-widest">About Rawgadz Automotive</h3>
        <p class="text-xs text-neutral-400 leading-relaxed">
          Premier e-commerce platform for gadgets and car accessories.
        </p>
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
          <input 
            type="email" 
            x-model="email" 
            placeholder="Enter your email..." 
            required 
            class="border border-neutral-800 bg-neutral-900 text-white px-4 py-2.5 rounded-xl text-xs focus:outline-none focus:border-white w-full"
          >
          <button 
            type="submit" 
            :disabled="submitting" 
            class="bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-bold text-xs uppercase tracking-wider py-2.5 rounded-xl transition-all"
          >
            <span x-text="submitting ? 'Subscribing...' : 'Subscribe'">Subscribe</span>
          </button>
          <div 
            x-show="message" 
            x-text="message" 
            class="text-xs text-center font-bold uppercase tracking-wider py-1.5 rounded-lg border border-neutral-700 bg-neutral-900 text-white mt-1"
            style="display: none;"
          ></div>
        </form>
      </div>

    </div>
    
    <div class="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-neutral-900 text-center text-xs text-neutral-500 font-medium">
      &copy; 2026 Rawgadz. All rights reserved.
    </div>
  </footer>

  <!-- Alpine.js Component Controller -->
  <script>
    document.addEventListener('alpine:init', () => {

      // Newsletter Form Component
      Alpine.data('newsletterForm', () => ({
        email: '',
        submitting: false,
        message: '',
        async submitNewsletter() {
          if (!this.email) return;
          this.submitting = true;
          this.message = '';
          try {
            await fetch('https://script.google.com/macros/s/AKfycbwnstevpnw3FdYnnuMF75_KaZk8Qi_8qqsWX0DsZ-Mr4fWahfmKMZyGHhubMj6ydxiy/exec', {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({ email: this.email })
            });
            this.message = 'Subscribed successfully!';
            this.email = '';
          } catch (err) {
            this.message = 'Subscribed successfully!';
            this.email = '';
          } finally {
            this.submitting = false;
            setTimeout(() => { this.message = ''; }, 4000);
          }
        }
      }));

      // Car Page Component
      Alpine.data('carPage', () => ({
        car: ${sanitizedCarJson},
        selectedTypeIndex: 0,
        selectedSubProductIndex: 0,
        selectedGalleryImage: null,

        get selectedType() {
          if (!this.car.types || this.car.types.length === 0) return null;
          return this.car.types[this.selectedTypeIndex] || this.car.types[0];
        },

        get selectedSubProduct() {
          const type = this.selectedType;
          if (!type || !type.subProducts || type.subProducts.length === 0) return null;
          return type.subProducts[this.selectedSubProductIndex] || type.subProducts[0];
        },

        get activeItem() {
          return this.selectedSubProduct || this.selectedType || this.car;
        },

        get currentVariantImages() {
          if (this.selectedSubProduct && Array.isArray(this.selectedSubProduct.images) && this.selectedSubProduct.images.length > 0) {
            return this.selectedSubProduct.images;
          }
          if (this.selectedType && Array.isArray(this.selectedType.images) && this.selectedType.images.length > 0) {
            return this.selectedType.images;
          }
          if (this.selectedSubProduct && this.selectedSubProduct.subImage) {
            return [this.selectedSubProduct.subImage];
          }
          if (this.selectedType && this.selectedType.subImage) {
            return [this.selectedType.subImage];
          }
          if (Array.isArray(this.car.images) && this.car.images.length > 0) {
            return this.car.images;
          }
          return this.car.imageSrc ? [this.car.imageSrc] : [];
        },

        get activeVariantTitle() {
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          if (type && sub) return type.subTitle + ' - ' + sub.subTitle;
          if (type) return type.subTitle;
          return this.car.title;
        },

        get currentImage() {
          if (this.selectedGalleryImage && this.currentVariantImages.includes(this.selectedGalleryImage)) {
            return this.selectedGalleryImage;
          }
          return this.currentVariantImages[0] || this.car.imageSrc;
        },

        get currentPrice() {
          if (this.selectedSubProduct && typeof this.selectedSubProduct.price === 'number') {
            return this.selectedSubProduct.price;
          }
          if (this.selectedType && typeof this.selectedType.price === 'number') {
            return this.selectedType.price;
          }
          return Number(this.car.price) || 0;
        },

        selectType(idx) {
          this.selectedTypeIndex = idx;
          this.selectedSubProductIndex = 0;
          this.selectedGalleryImage = null;
        },

        selectSubProduct(idx) {
          this.selectedSubProductIndex = idx;
          this.selectedGalleryImage = null;
        },

        contactNow() {
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          const params = new URLSearchParams({
            car_id: this.car.id,
            vehicle: this.car.title,
            trim: type ? type.subTitle : '',
            package: sub ? sub.subTitle : '',
            est_price: String(this.currentPrice)
          });
          window.location.href = '../contact.html?' + params.toString();
        },

        whatsappNow() {
          const type = this.selectedType;
          const sub = this.selectedSubProduct;
          const phoneNumber = "8801XXXXXXXXX"; 
          
          // FIXED: Escaped backticks and dollar signs so Node.js doesn't evaluate them
          const message = encodeURIComponent(\`Hi, I am interested in the \${this.car.title}\${type ? ' (' + type.subTitle + ')' : ''}\${sub ? ' - ' + sub.subTitle : ''}. Estimated Price: BDT \${this.currentPrice}. Please provide more details.\`);
          
          window.open(\`https://wa.me/\${phoneNumber}?text=\${message}\`, '_blank');
        }
      }));
    });
  </script>

</body>
</html>`;
}

/**
 * Builds standalone HTML pages inside cr/ directory
 */
function buildHtmlCars() {
  if (!fs.existsSync(CARS_JSON_FILE)) {
    console.log(`[build-html-cars] cars.json not found. Triggering build-car.js...`);
    generateCarsJson();
  }

  if (!fs.existsSync(HTML_OUTPUT_DIR)) {
    fs.mkdirSync(HTML_OUTPUT_DIR, { recursive: true });
  }

  const rawData = fs.readFileSync(CARS_JSON_FILE, 'utf8');
  const cars = JSON.parse(rawData);

  const activeFileNames = new Set(cars.map(c => `${c.slug || c.id}.html`));
  if (fs.existsSync(HTML_OUTPUT_DIR)) {
    const existingFiles = fs.readdirSync(HTML_OUTPUT_DIR).filter(f => f.endsWith('.html'));
    for (const f of existingFiles) {
      if (!activeFileNames.has(f)) {
        try { fs.unlinkSync(path.join(HTML_OUTPUT_DIR, f)); } catch (_) {}
      }
    }
  }

  let count = 0;
  cars.forEach(car => {
    const carSlug = car.slug || car.id;
    const filePath = path.join(HTML_OUTPUT_DIR, `${carSlug}.html`);
    fs.writeFileSync(filePath, generateStandaloneCarHTML(car));
    count++;
  });

  console.log(`[build-html-cars] Successfully built ${count} standalone vehicle pages with variant image galleries in ${HTML_OUTPUT_DIR}`);
  return cars;
}

if (require.main === module) {
  buildHtmlCars();
}

module.exports = buildHtmlCars;