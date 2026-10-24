// build/build-blog.js
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'content', 'blog');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data', 'blog.json');

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
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
  }

  const files = fs.readdirSync(CONTENT_DIR).filter(file => file.endsWith('.md'));
  const blogs = [];

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

    blogs.push({
      id: String(data.id),
      title: data.title,
      slug,
      date: data.date ? String(data.date).trim() : '',
      author: data.author || 'Admin',
      image: data.image || '',
      summary: data.summary || '',
      tags: Array.isArray(data.tags) ? data.tags : (typeof data.tags === 'string' ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      content: htmlContent
    });
  }

  blogs.sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(blogs, null, 2));
  console.log(`[build-blog] Success: Compiled ${blogs.length} blog posts into ${OUTPUT_FILE}`);

  return blogs;
}

if (require.main === module) {
  generateBlogJson();
}

module.exports = generateBlogJson;
