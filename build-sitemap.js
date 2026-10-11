const fs = require('fs');
const path = require('path');

// Base URL for canonical loc generation (can be overridden via SITE_URL env)
const BASE_URL = (process.env.SITE_URL || 'https://rawgadz.com').replace(/\/+$/, '');

// Target output file paths
const ROOT_OUTPUT_FILE = path.join(__dirname, 'sitemap.xml');
const PUBLIC_OUTPUT_FILE = path.join(__dirname, 'public', 'sitemap.xml');

// Directories to skip during recursive filesystem traversal
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  '.gemini',
  'scratch',
  'api',
  'lib',
  'image',
  'content',
  'public'
]);

// Explicit page/path stems to exclude from indexing (admin, order, inventory, and non-public utility flows)
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

/**
 * Determines whether a file or directory should be excluded from the sitemap.
 * Specifically excludes anything related to admin, order, inventory, plus
 * transactional, login, and explicitly noindexed pages.
 *
 * @param {string} relativePath - Path relative to the workspace root, e.g. "product/shoe.html" or "admin.html"
 * @param {string} fullPath - Absolute file path
 * @returns {{ excluded: boolean, reason?: string }}
 */
function shouldExcludeFile(relativePath, fullPath) {
  const normalizedRel = relativePath.split(path.sep).join('/');
  const pathParts = normalizedRel.split('/');
  const filename = pathParts[pathParts.length - 1];
  const stem = filename.replace(/\.html$/i, '').toLowerCase();

  // Exclude non-HTML files
  if (!filename.toLowerCase().endsWith('.html')) {
    return { excluded: true, reason: 'non-html' };
  }

  // 1. Exclude any directory segment matching admin, order, or inventory
  for (let i = 0; i < pathParts.length - 1; i++) {
    const dir = pathParts[i].toLowerCase();
    if (dir === 'admin' || dir.startsWith('admin')) {
      return { excluded: true, reason: 'admin directory' };
    }
    if (dir === 'order' || dir === 'orders' || dir.startsWith('order')) {
      return { excluded: true, reason: 'order directory' };
    }
    if (dir === 'inventory' || dir.startsWith('inventory')) {
      return { excluded: true, reason: 'inventory directory' };
    }
  }

  // 2. Exclude matching page stems (admin, order, inventory, login, checkout, etc.)
  if (EXCLUDED_PAGE_STEMS.has(stem)) {
    return { excluded: true, reason: `matches excluded stem '${stem}'` };
  }

  // Prefix checks for admin, order, inventory variations (e.g. admin-dashboard, order-status)
  if (stem.startsWith('admin-') || stem.startsWith('admin_')) {
    return { excluded: true, reason: `admin prefixed page` };
  }
  if (stem.startsWith('order-') || stem.startsWith('order_') || stem.startsWith('orders-')) {
    return { excluded: true, reason: `order prefixed page` };
  }
  if (stem.startsWith('inventory-') || stem.startsWith('inventory_')) {
    return { excluded: true, reason: `inventory prefixed page` };
  }

  // 3. Inspect HTML content for <meta name="robots" content="...noindex...">
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const robotsMatch = content.match(/<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i)
      || content.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']robots["']/i);

    if (robotsMatch && /noindex/i.test(robotsMatch[1])) {
      return { excluded: true, reason: `page contains meta robots noindex (${robotsMatch[1]})` };
    }
  } catch (err) {
    console.warn(`[build-sitemap] Warning: Could not read ${relativePath} for noindex check:`, err.message);
  }

  return { excluded: false };
}

/**
 * Computes SEO priority and change frequency based on route pattern.
 *
 * @param {string} urlPath - Forward-slash relative URL path, e.g. "" or "product/lamp.html"
 * @returns {{ priority: string, changefreq: string }}
 */
function getRouteMetadata(urlPath) {
  if (urlPath === '' || urlPath === 'index.html') {
    return { priority: '1.0', changefreq: 'daily' };
  }
  if (urlPath === 'gadgets.html') {
    return { priority: '0.9', changefreq: 'daily' };
  }
  if (urlPath === 'car.html') {
    return { priority: '0.8', changefreq: 'weekly' };
  }
  if (urlPath.startsWith('product/')) {
    return { priority: '0.8', changefreq: 'weekly' };
  }
  if (urlPath.startsWith('cr/')) {
    return { priority: '0.8', changefreq: 'weekly' };
  }
  if (urlPath === 'blog.html') {
    return { priority: '0.7', changefreq: 'weekly' };
  }
  if (urlPath.startsWith('blog/')) {
    return { priority: '0.7', changefreq: 'monthly' };
  }
  if (urlPath === 'contact.html') {
    return { priority: '0.5', changefreq: 'monthly' };
  }

  return { priority: '0.6', changefreq: 'weekly' };
}

/**
 * Formats a Date object as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Recursively scans directory for HTML files and collects indexable pages.
 *
 * @param {string} dir - Directory to scan
 * @param {string} rootDir - Workspace root directory
 * @param {Array} results - Accumulator array for indexable items
 * @param {Array} exclusions - Accumulator array for excluded items
 */
function scanDirectory(dir, rootDir, results = [], exclusions = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      scanDirectory(fullPath, rootDir, results, exclusions);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      const check = shouldExcludeFile(relativePath, fullPath);
      if (check.excluded) {
        exclusions.push({ relativePath, reason: check.reason });
      } else {
        const stats = fs.statSync(fullPath);
        const normalizedRel = relativePath.split(path.sep).join('/');
        
        // Canonical homepage URL is BASE_URL/
        const loc = (normalizedRel === 'index.html')
          ? `${BASE_URL}/`
          : `${BASE_URL}/${normalizedRel}`;

        const meta = getRouteMetadata(normalizedRel);

        results.push({
          loc,
          relativePath: normalizedRel,
          lastmod: formatDate(stats.mtime),
          priority: meta.priority,
          changefreq: meta.changefreq,
          sortPriority: parseFloat(meta.priority)
        });
      }
    }
  }

  return { results, exclusions };
}

/**
 * Builds the XML sitemap string from indexed entries.
 *
 * @param {Array} entries
 * @returns {string} XML string
 */
function generateSitemapXml(entries) {
  // Deterministic sort: highest priority first, then alphabetically by URL
  const sorted = [...entries].sort((a, b) => {
    if (b.sortPriority !== a.sortPriority) {
      return b.sortPriority - a.sortPriority;
    }
    return a.loc.localeCompare(b.loc);
  });

  const urlElements = sorted.map(entry => {
    return `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlElements}
</urlset>
`;
}

/**
 * Main sitemap builder function
 */
function buildSitemap(options = {}) {
  const rootDir = options.rootDir || __dirname;
  const verbose = options.verbose ?? (process.argv.includes('--verbose'));
  const dryRun = options.dryRun ?? (process.argv.includes('--dry-run'));

  console.log(`[build-sitemap] Scanning workspace for public HTML pages...`);
  console.log(`[build-sitemap] Base URL: ${BASE_URL}`);

  const { results, exclusions } = scanDirectory(rootDir, rootDir);

  if (verbose || process.argv.includes('-v')) {
    console.log(`\n[build-sitemap] --- Excluded Pages (${exclusions.length}) ---`);
    exclusions.forEach(ex => {
      console.log(`  - [EXCLUDED] ${ex.relativePath} (${ex.reason})`);
    });
  } else {
    const summary = exclusions.map(e => e.relativePath).join(', ');
    console.log(`[build-sitemap] Excluded ${exclusions.length} non-public/admin files: ${summary}`);
  }

  console.log(`[build-sitemap] Successfully indexed ${results.length} public pages.`);

  const xmlContent = generateSitemapXml(results);

  if (!dryRun) {
    fs.writeFileSync(ROOT_OUTPUT_FILE, xmlContent, 'utf8');
    console.log(`[build-sitemap] Written: ${ROOT_OUTPUT_FILE} (${(Buffer.byteLength(xmlContent) / 1024).toFixed(2)} KB)`);

    // Sync to public/ directory if it exists
    const publicDir = path.dirname(PUBLIC_OUTPUT_FILE);
    if (fs.existsSync(publicDir)) {
      fs.writeFileSync(PUBLIC_OUTPUT_FILE, xmlContent, 'utf8');
      console.log(`[build-sitemap] Synced: ${PUBLIC_OUTPUT_FILE}`);
    }
  } else {
    console.log(`[build-sitemap] Dry run enabled. Skipped writing files.`);
  }

  return {
    count: results.length,
    indexed: results,
    excluded: exclusions
  };
}

if (require.main === module) {
  buildSitemap();
}

module.exports = buildSitemap;
