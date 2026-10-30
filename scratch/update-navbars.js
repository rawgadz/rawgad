const fs = require('fs');
const path = require('path');

const files = [
  'index.html',
  'car_accessories.html',
  'car-steering-cover.html',
  'gadgets.html',
  'car.html',
  'blog.html',
  'contact.html',
  'checkout.html',
  'thank.html',
  'fail.html'
];

files.forEach(filename => {
  const filePath = path.join(process.cwd(), filename);
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filename);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const isSteeringPage = (filename === 'car-steering-cover.html');

  // Active styling vs standard styling
  const desktopClass = isSteeringPage
    ? 'hover:text-black transition-colors font-bold text-xs tracking-wider uppercase text-black border-b-2 border-black pb-0.5'
    : 'hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600';

  const mobileClass = isSteeringPage
    ? 'hover:text-black transition-colors font-bold text-xs tracking-wider uppercase text-black border-b-2 border-black pb-0.5'
    : 'hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600';

  // If car-steering-cover.html is this file, make sure car_accessories is NOT marked active
  if (isSteeringPage) {
    // replace any active styling on car_accessories in desktop and mobile
    content = content.replace(
      /(<a\s+href="\.\/car_accessories\.html"\s+class=")hover:text-black transition-colors font-bold text-xs tracking-wider uppercase text-black border-b-2 border-black pb-0\.5(")/g,
      '$1hover:text-black transition-colors font-semibold text-xs tracking-wider uppercase text-neutral-600$2'
    );
  }

  // 1. Desktop insertion after car_accessories.html link if not already present
  // Match desktop car accessories link:
  const desktopAccessoriesRegex = /(<nav class="hidden md:flex[^>]*>[\s\S]*?<a\s+href="\.\/car_accessories\.html"[\s\S]*?<\/a>)/i;
  
  // Check if desktop already has car-steering-cover.html
  const desktopNavMatch = content.match(/<nav class="hidden md:flex[^>]*>([\s\S]*?)<\/nav>/i);
  if (desktopNavMatch && !desktopNavMatch[1].includes('car-steering-cover.html')) {
    const desktopLinkSnippet = `\n\n        <a\n          href="./car-steering-cover.html"\n          class="${desktopClass}"\n        >\n          Car steering cover\n        </a>`;
    content = content.replace(desktopAccessoriesRegex, `$1${desktopLinkSnippet}`);
  }

  // 2. Mobile insertion after car_accessories.html link in mobile menu if not already present
  const mobileNavMatch = content.match(/<div[^>]*x-show="mobileMenuOpen"[^>]*>([\s\S]*?)<\/div>/i);
  if (mobileNavMatch && !mobileNavMatch[1].includes('car-steering-cover.html')) {
    // replace within mobileMenuOpen
    const mobileLinkSnippet = `\n\n      <a\n        href="./car-steering-cover.html"\n        class="${mobileClass}"\n      >\n        Car steering cover\n      </a>`;
    
    // Find the mobile car accessories link
    // We can match after the mobile accessories anchor
    content = content.replace(/(<div[^>]*x-show="mobileMenuOpen"[\s\S]*?<a\s+href="\.\/car_accessories\.html"[\s\S]*?<\/a>)/i, `$1${mobileLinkSnippet}`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated:', filename);
});
