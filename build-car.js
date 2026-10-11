const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

// Input and Output Directory Paths
const CONTENT_DIR = path.join(__dirname, 'content', 'cars');
const ROOT_OUTPUT_FILE = path.join(__dirname, 'cars.json');
const PUBLIC_OUTPUT_FILE = path.join(__dirname, 'public', 'cars.json');

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

/**
 * Normalizes a car variant/subproduct and recursively parses nested subproducts
 * Extracts and normalizes both singular subImage and multiple images array for galleries
 */
function normalizeSubProduct(sub, parentPrice = null) {
  if (!sub || typeof sub !== 'object') return null;

  const typePrice = (sub.price !== undefined && sub.price !== null && sub.price !== '')
    ? (Number(sub.price) || 0)
    : parentPrice;

  // Check for nested subproducts under subProducts, subproducts, or types
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

/**
 * Compiles content/cars/*.md to cars.json and public/cars.json
 */
function generateCarsJson() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.warn(`[build-car] Creating missing directory: ${CONTENT_DIR}`);
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));
  if (files.length === 0) {
    console.warn(`[build-car] Warning: No .md files found in ${CONTENT_DIR}`);
  }

  const cars = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Parse YAML frontmatter and markdown body
    const { data, content } = matter(fileContent);

    if (!data.id || !data.title) {
      console.warn(`[build-car] Warning: Skipping ${file}. Missing required 'id' or 'title' in frontmatter.`);
      continue;
    }

    const htmlContent = marked.parse(content || '');
    const carPrice = Number(data.price) || 0;

    const rawTypes = Array.isArray(data.types)
      ? data.types
      : (Array.isArray(data.subProducts)
        ? data.subProducts
        : (Array.isArray(data.subproducts) ? data.subproducts : []));

    const types = rawTypes.map(item => normalizeSubProduct(item, carPrice)).filter(Boolean);

    const tags = Array.isArray(data.tags)
      ? data.tags.filter(Boolean).join(', ')
      : (typeof data.tags === 'string' ? data.tags : '');

    const carImages = Array.isArray(data.images)
      ? data.images.map(img => String(img).trim()).filter(Boolean)
      : (data.imageSrc ? [String(data.imageSrc).trim()] : []);

    const youtube = data.youtube || data.youtubeUrl || '';
    const video = data.video || data.videoUrl || data.videoSrc || '';

    // Determine default mediaType:
    // If user explicitly specified, respect it. Otherwise, if both video/yt and image exist, default to 'both'
    let mediaType = data.mediaType || data.type;
    if (!mediaType) {
      const hasVidOrYt = Boolean(youtube || video);
      const hasImg = Boolean(carImages.length > 0 || data.imageSrc);
      if (hasVidOrYt && hasImg) {
        mediaType = 'both';
      } else if (hasVidOrYt) {
        mediaType = youtube ? 'youtube' : 'video';
      } else {
        mediaType = 'image';
      }
    }

    let slug = '';
    if (data.slug !== undefined && data.slug !== null && String(data.slug).trim() !== '') {
      slug = sanitizeSlug(String(data.slug));
      if (!slug) slug = slugify(data.title);
    } else {
      slug = slugify(data.title);
    }
    if (!slug) slug = slugify(String(data.id));

    cars.push({
      id: String(data.id),
      slug: slug,
      imageSrc: carImages[0] || data.imageSrc || '',
      images: carImages.length > 0 ? carImages : (data.imageSrc ? [data.imageSrc] : []),
      youtube: youtube,
      youtubeUrl: youtube,
      video: video,
      videoUrl: video,
      mediaType: mediaType,
      title: data.title,
      description: data.description || '',
      price: carPrice,
      tags: tags,
      types: types,
      content: htmlContent
    });
  }

  // Validate duplicate slugs
  const slugToIds = new Map();
  for (const car of cars) {
    if (!slugToIds.has(car.slug)) slugToIds.set(car.slug, []);
    slugToIds.get(car.slug).push(car.id);
  }
  const duplicateErrors = [];
  for (const [slug, ids] of slugToIds.entries()) {
    if (ids.length > 1) duplicateErrors.push(`Duplicate slug "${slug}" detected in vehicles: ${ids.join(', ')}`);
  }
  if (duplicateErrors.length > 0) {
    throw new Error(`[build-car] Build failed due to duplicate slugs:\n` + duplicateErrors.join('\n'));
  }

  // Deterministic sort by ID
  cars.sort((a, b) => a.id.localeCompare(b.id));

  const jsonPayload = JSON.stringify(cars, null, 2);

  // Write root cars.json
  fs.writeFileSync(ROOT_OUTPUT_FILE, jsonPayload);
  console.log(`[build-car] Success: Compiled ${cars.length} vehicles into ${ROOT_OUTPUT_FILE}`);

  // Sync to public/cars.json if public directory exists
  const publicDir = path.dirname(PUBLIC_OUTPUT_FILE);
  if (fs.existsSync(publicDir)) {
    fs.writeFileSync(PUBLIC_OUTPUT_FILE, jsonPayload);
    console.log(`[build-car] Success: Synced ${cars.length} vehicles into ${PUBLIC_OUTPUT_FILE}`);
  }

  return cars;
}

if (require.main === module) {
  generateCarsJson();
}

module.exports = generateCarsJson;
