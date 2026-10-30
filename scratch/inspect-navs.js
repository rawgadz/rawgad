const fs = require('fs');

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

files.forEach(f => {
  if (!fs.existsSync(f)) {
    console.log(f, 'NOT FOUND');
    return;
  }
  const content = fs.readFileSync(f, 'utf8');
  console.log('==================== ' + f + ' ====================');
  const dNav = content.match(/<nav class="hidden md:flex[\s\S]*?<\/nav>/i);
  if (dNav) {
    console.log('[Desktop Nav]');
    console.log(dNav[0]);
  } else {
    console.log('[Desktop Nav] NONE');
  }

  const mNav = content.match(/<div[^>]*x-show="mobileMenuOpen"[\s\S]*?<\/div>/i);
  if (mNav) {
    console.log('[Mobile Nav]');
    console.log(mNav[0]);
  } else {
    console.log('[Mobile Nav] NONE');
  }
});
