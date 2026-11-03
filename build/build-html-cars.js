// build/build-html-cars.js
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const CARS_JSON_FILE = path.join(ROOT_DIR, 'data', 'cars.json');
const HTML_OUTPUT_DIR = path.join(ROOT_DIR, 'cr');

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function generateStandaloneCarHTML(car) {
  const sanitizedCarJson = JSON.stringify(car).replace(/</g, '\\u003c');
  const tagsHtml = car.tags
    ? car.tags.split(',').map(tag => `<span class="bg-neutral-100 text-neutral-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border border-neutral-200">${escapeHtml(tag.trim())}</span>`).join('\n             ')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(car.title)} | Rawgadz Vehicles</title>
  <meta name="description" content="${escapeHtml(car.description || car.title)}">
  
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

  <header class="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-neutral-200">
    <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="../car.html" class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 hover:text-black transition-colors">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        Back to Cars
      </a>
      <a href="../index.html" class="font-black text-lg tracking-wider text-black uppercase hover:opacity-80 transition-opacity">Rawgadz</a>
      <div class="w-20"></div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 pt-10" x-data="carPage">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-10">
      <div class="lg:col-span-7">
        <div class="aspect-video bg-neutral-100 rounded-2xl overflow-hidden border border-neutral-200 mb-4 shadow-sm">
          <img :src="currentImage" :alt="car.title" class="w-full h-full object-cover">
        </div>
        <div class="flex gap-2 overflow-x-auto no-scrollbar py-2" x-show="galleryImages.length > 1">
          <template x-for="(img, idx) in galleryImages" :key="idx">
            <button @click="selectedGalleryImage = img" class="w-20 h-14 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0" :class="currentImage === img ? 'border-black' : 'border-transparent opacity-60 hover:opacity-100'">
              <img :src="img" class="w-full h-full object-cover">
            </button>
          </template>
        </div>
      </div>

      <div class="lg:col-span-5 flex flex-col justify-between">
        <div>
          <div class="flex flex-wrap gap-2 mb-3">${tagsHtml}</div>
          <h1 class="text-3xl md:text-4xl font-black tracking-tight text-neutral-900 mb-2" x-text="car.title"></h1>
          <p class="text-sm text-neutral-500 font-medium mb-4" x-text="car.subtitle"></p>
          <div class="text-2xl font-black text-black mb-6">
            Starting at ৳<span x-text="Number(car.price || 0).toLocaleString()"></span>
          </div>

          <div class="text-neutral-600 text-sm leading-relaxed mb-6" x-text="car.description"></div>

          <div class="border-t border-neutral-200 pt-6 mt-6">
            <a :href="inquiryUrl" class="w-full bg-black hover:bg-neutral-800 text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 text-sm uppercase tracking-wider transition-all">
              Inquire About Vehicle
            </a>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-16 border-t border-neutral-200 pt-10" x-show="car.content">
      <h2 class="text-2xl font-black tracking-tight mb-6">Specifications & Details</h2>
      <div class="prose max-w-none text-neutral-700 bg-white p-6 md:p-8 rounded-2xl border border-neutral-200" x-html="car.content"></div>
    </div>
  </main>

  <script>
    document.addEventListener('alpine:init', () => {
      Alpine.data('carPage', () => ({
        car: ${sanitizedCarJson},
        selectedGalleryImage: null,
        get galleryImages() {
          if (Array.isArray(this.car.images) && this.car.images.length > 0) return this.car.images;
          return this.car.imageSrc ? [this.car.imageSrc] : [];
        },
        get currentImage() {
          return this.selectedGalleryImage || this.galleryImages[0] || '';
        },
        get inquiryUrl() {
          const params = new URLSearchParams();
          if (this.car.id) params.set('car_id', this.car.id);
          if (this.car.title) params.set('vehicle', this.car.title);
          if (this.car.subtitle) params.set('trim', this.car.subtitle);
          if (this.car.price) params.set('est_price', this.car.price);
          return '../contact.html?' + params.toString();
        }
      }));
    });
  </script>
</body>
</html>`;
}

function buildHtmlCars() {
  if (!fs.existsSync(CARS_JSON_FILE)) {
    const generateCarsJson = require('./build-car');
    generateCarsJson();
  }

  const cars = JSON.parse(fs.readFileSync(CARS_JSON_FILE, 'utf-8'));
  if (!fs.existsSync(HTML_OUTPUT_DIR)) fs.mkdirSync(HTML_OUTPUT_DIR, { recursive: true });

  for (const car of cars) {
    const outPath = path.join(HTML_OUTPUT_DIR, `${car.slug}.html`);
    fs.writeFileSync(outPath, generateStandaloneCarHTML(car), 'utf-8');
  }

  console.log(`[build-html-cars] Success: Generated ${cars.length} HTML pages in ${HTML_OUTPUT_DIR}`);
}

if (require.main === module) {
  buildHtmlCars();
}

module.exports = buildHtmlCars;
