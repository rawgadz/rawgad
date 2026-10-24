// build/build-gadgets.js
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'gadgets');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'gadgets.json');

function generateGadgetsJson() {
  if (!fs.existsSync(CONTENT_DIR)) {
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));
  const items = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(fileContent);

    if (!data.image && !data.imageSrc && !data.tag && !data.label) {
      continue;
    }

    items.push({
      _order: typeof data.order === 'number' ? data.order : 9999,
      _file: file,
      image: data.image || data.imageSrc || '',
      tag: String(data.tag || '').trim(),
      label: String(data.label || data.title || '').trim()
    });
  }

  items.sort((a, b) => {
    if (a._order !== b._order) return a._order - b._order;
    return a._file.localeCompare(b._file);
  });

  const outputData = items.map(({ _order, _file, ...item }) => item);
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(outputData, null, 2), 'utf-8');
  console.log(`[build-gadgets] Success: Compiled ${outputData.length} items into ${OUTPUT_FILE}`);

  return outputData;
}

if (require.main === module) {
  generateGadgetsJson();
}

module.exports = generateGadgetsJson;
