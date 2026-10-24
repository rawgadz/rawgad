// build/build-car.js
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'cars');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'cars.json');

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

function generateCarsJson() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));
  const cars = [];

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

    const htmlContent = marked.parse(content || '');

    cars.push({
      id: String(data.id),
      title: data.title,
      slug,
      subtitle: data.subtitle || '',
      price: Number(data.price) || 0,
      imageSrc: data.imageSrc || '',
      images: Array.isArray(data.images) ? data.images : (data.imageSrc ? [data.imageSrc] : []),
      video: data.video || data.videoUrl || '',
      description: data.description || '',
      tags: Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || ''),
      types: Array.isArray(data.types) ? data.types : [],
      content: htmlContent
    });
  }

  cars.sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cars, null, 2));
  console.log(`[build-car] Success: Compiled ${cars.length} vehicles into ${OUTPUT_FILE}`);

  return cars;
}

if (require.main === module) {
  generateCarsJson();
}

module.exports = generateCarsJson;
