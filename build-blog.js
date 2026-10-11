const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

// Define input and output paths
const CONTENT_DIR = path.join(__dirname, 'content', 'blog');
const ROOT_OUTPUT_FILE = path.join(__dirname, 'blog.json');
const PUBLIC_OUTPUT_FILE = path.join(__dirname, 'public', 'blog.json');

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

function generateBlogJson() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`Error: The directory ${CONTENT_DIR} does not exist.`);
    process.exit(1);
  }

  const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));
  if (files.length === 0) {
    console.warn(`Warning: No .md files found in ${CONTENT_DIR}`);
  }

  const blogs = [];

  for (const file of files) {
    const filePath = path.join(CONTENT_DIR, file);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Parse YAML frontmatter and markdown body
    const { data, content } = matter(fileContent);

    // Skip files that lack core identifiers
    if (!data.id || !data.title) {
      console.warn(`Warning: Skipping ${file}. Missing required 'id' or 'title' in frontmatter.`);
      continue;
    }

    let slug = '';
    if (data.slug !== undefined && data.slug !== null && String(data.slug).trim() !== '') {
      slug = sanitizeSlug(String(data.slug));
      if (!slug) slug = slugify(data.title);
    } else {
      slug = slugify(data.title);
    }
    if (!slug) slug = slugify(String(data.id));

    const htmlContent = marked.parse(content || '');

    const tags = Array.isArray(data.tags)
      ? data.tags.filter(Boolean).join(', ')
      : (typeof data.tags === 'string' ? data.tags : '');

    blogs.push({
      id: String(data.id),
      slug: slug,
      title: data.title,
      date: data.date || '',
      author: data.author || 'Rawgadz Team',
      excerpt: data.excerpt || data.description || '',
      imageSrc: data.imageSrc || '',
      tags: tags,
      content: htmlContent
    });
  }

  // Validate duplicate slugs
  const slugToIds = new Map();
  for (const blog of blogs) {
    if (!slugToIds.has(blog.slug)) slugToIds.set(blog.slug, []);
    slugToIds.get(blog.slug).push(blog.id);
  }
  const duplicateErrors = [];
  for (const [slug, ids] of slugToIds.entries()) {
    if (ids.length > 1) duplicateErrors.push(`Duplicate slug "${slug}" detected in blog posts: ${ids.join(', ')}`);
  }
  if (duplicateErrors.length > 0) {
    throw new Error(`[build-blog] Build failed due to duplicate slugs:\n` + duplicateErrors.join('\n'));
  }

  // Sort blogs deterministically by id
  blogs.sort((a, b) => a.id.localeCompare(b.id));

  const jsonPayload = JSON.stringify(blogs, null, 2);

  // Write to root blog.json
  fs.writeFileSync(ROOT_OUTPUT_FILE, jsonPayload);
  console.log(`[build-blog] Success: Compiled ${blogs.length} blog posts into ${ROOT_OUTPUT_FILE}`);

  // Write to public/blog.json if public directory exists
  const publicDir = path.dirname(PUBLIC_OUTPUT_FILE);
  if (fs.existsSync(publicDir)) {
    fs.writeFileSync(PUBLIC_OUTPUT_FILE, jsonPayload);
    console.log(`[build-blog] Success: Synced ${blogs.length} blog posts into ${PUBLIC_OUTPUT_FILE}`);
  }

  return blogs;
}

if (require.main === module) {
  generateBlogJson();
}

module.exports = generateBlogJson;
