// build/build-hero.js
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'hero');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'hero.json');

function normalizePageKey(key) {
  if (!key) return 'index';
  const clean = String(key).toLowerCase().trim();
  if (clean === 'cars' || clean === 'car' || clean.startsWith('car')) return 'car';
  if (clean === 'gadgets' || clean === 'gadget') return 'gadgets';
  if (clean === 'index' || clean === 'home') return 'index';
  return clean;
}

function getMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function generateHeroJson() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const files = getMarkdownFiles(CONTENT_DIR);
  const groupedSlides = { index: [], gadgets: [], car: [] };

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(fileContent);

    let targetPage = data.page;
    if (!targetPage) {
      if (fileName.toLowerCase().includes('gadget')) targetPage = 'gadgets';
      else if (fileName.toLowerCase().includes('car')) targetPage = 'car';
      else targetPage = 'index';
    }
    const pageKey = normalizePageKey(targetPage);

    if (Array.isArray(data.slides)) {
      data.slides.forEach((s, idx) => {
        if (!s || (!s.src && !s.url && !s.image && !s.video)) return;
        groupedSlides[pageKey] = groupedSlides[pageKey] || [];
        groupedSlides[pageKey].push({
          _order: typeof s.order === 'number' ? s.order : idx + 1,
          _file: `${fileName}_${idx}`,
          type: s.type || (s.video ? 'video' : 'image'),
          src: s.src || s.url || s.image || s.video,
          ...(s.poster ? { poster: s.poster } : {}),
          ...(s.alt ? { alt: s.alt } : {})
        });
      });
      continue;
    }

    const src = data.src || data.url || data.image || data.video;
    if (!src) continue;

    const type = data.type || (data.video || /\.(mp4|webm|ogg)$/i.test(src) || src.includes('youtube') ? 'video' : 'image');

    groupedSlides[pageKey] = groupedSlides[pageKey] || [];
    groupedSlides[pageKey].push({
      _order: typeof data.order === 'number' ? data.order : 9999,
      _file: fileName,
      type: type,
      src: src,
      ...(data.poster ? { poster: data.poster } : {}),
      ...(data.alt ? { alt: data.alt } : {})
    });
  }

  const outputData = {};
  for (const page of ['index', 'gadgets', 'car']) {
    const list = groupedSlides[page] || [];
    list.sort((a, b) => {
      if (a._order !== b._order) return a._order - b._order;
      return a._file.localeCompare(b._file);
    });
    outputData[page] = list.map(({ _order, _file, ...slide }) => slide);
  }

  outputData.cars = outputData.car;

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`[build-hero] Success: Compiled hero slides into ${OUTPUT_FILE}`);

  return outputData;
}

if (require.main === module) {
  generateHeroJson();
}

module.exports = generateHeroJson;
