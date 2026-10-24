// build/build-sitemap.js
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const BASE_URL = (process.env.SITE_URL || 'https://rawgadz.com').replace(/\/+$/, '');
const OUTPUT_FILE = path.join(ROOT_DIR, 'sitemap.xml');

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  '.gemini',
  'scratch',
  'api',
  'build',
  'data',
  'js',
  'image',
  'content'
]);

const EXCLUDED_PAGE_STEMS = new Set([
  'admin',
  'order',
  'orders',
  'inventory',
  'login',
  'checkout',
  'checkout02',
  'thank',
  'fail',
  'test'
]);

function shouldExcludeFile(relativePath) {
  const normalizedRel = relativePath.split(path.sep).join('/');
  const pathParts = normalizedRel.split('/');
  const filename = pathParts[pathParts.length - 1];
  const stem = filename.replace(/\.html$/i, '').toLowerCase();

  if (!filename.toLowerCase().endsWith('.html')) {
    return true;
  }

  for (let i = 0; i < pathParts.length - 1; i++) {
    const segment = pathParts[i].toLowerCase();
    if (EXCLUDED_PAGE_STEMS.has(segment)) return true;
  }

  if (EXCLUDED_PAGE_STEMS.has(stem)) return true;
  return false;
}

function scanDirectory(dir, rootDir, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      scanDirectory(fullPath, rootDir, results);
    } else if (entry.isFile()) {
      if (!shouldExcludeFile(relativePath)) {
        const stats = fs.statSync(fullPath);
        results.push({
          relativePath: relativePath.split(path.sep).join('/'),
          lastModified: stats.mtime
        });
      }
    }
  }

  return results;
}

function generateSitemapXml(entries) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  ];

  for (const entry of entries) {
    const cleanPath = entry.relativePath.replace(/\.html$/i, '');
    const loc = cleanPath === 'index' ? `${BASE_URL}/` : `${BASE_URL}/${cleanPath}`;
    const lastmod = entry.lastModified.toISOString().split('T')[0];

    lines.push('  <url>');
    lines.push(`    <loc>${loc}</loc>`);
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push('    <changefreq>daily</changefreq>');
    lines.push('    <priority>0.8</priority>');
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  return lines.join('\n');
}

function buildSitemap() {
  const pages = scanDirectory(ROOT_DIR, ROOT_DIR);
  const xml = generateSitemapXml(pages);
  fs.writeFileSync(OUTPUT_FILE, xml, 'utf8');
  console.log(`[build-sitemap] Success: Indexed ${pages.length} public pages into ${OUTPUT_FILE}`);
}

if (require.main === module) {
  buildSitemap();
}

module.exports = buildSitemap;
