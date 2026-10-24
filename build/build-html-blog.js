// build/build-html-blog.js
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const BLOG_FILE = path.join(ROOT_DIR, 'data', 'blog.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'blog');

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function generateHTML(blog) {
  const tagsHtml = Array.isArray(blog.tags)
    ? blog.tags.map(tag => `<span class="bg-neutral-100 text-neutral-800 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border border-neutral-200">${escapeHtml(tag)}</span>`).join('\n             ')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${escapeHtml(blog.title)} | Rawgadz Blog</title>
  <meta name="description" content="${escapeHtml(blog.summary || blog.title)}">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="/js/stock.js"></script>

  <style>
    [x-cloak] { display: none !important; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .prose p { margin-bottom: 1.25rem; line-height: 1.75; }
    .prose h2 { font-size: 1.5rem; font-weight: 800; margin-top: 2rem; margin-bottom: 1rem; color: #171717; }
    .prose h3 { font-size: 1.25rem; font-weight: 700; margin-top: 1.5rem; margin-bottom: 0.75rem; color: #262626; }
    .prose ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 1.25rem; }
    .prose li { margin-bottom: 0.5rem; }
    .prose img { border-radius: 0.75rem; margin-top: 1.5rem; margin-bottom: 1.5rem; width: 100%; object-fit: cover; }
    .prose a { color: #000; text-decoration: underline; font-weight: 600; }
  </style>
</head>
<body class="bg-[#FBFBFB] text-neutral-900 font-sans antialiased selection:bg-black selection:text-white pb-20">

  <!-- Sticky Navbar -->
  <header class="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-neutral-200">
    <div class="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="../blog.html" class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-500 hover:text-black transition-colors">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
        Back to Blog
      </a>
      <a href="../index.html" class="font-black text-lg tracking-wider text-black uppercase hover:opacity-80 transition-opacity">Rawgadz</a>
      <div class="w-20"></div>
    </div>
  </header>

  <main class="max-w-4xl mx-auto px-4 pt-10">
    <div class="mb-8">
      <div class="flex flex-wrap gap-2 mb-4">
        ${tagsHtml}
      </div>
      <h1 class="text-3xl md:text-5xl font-black tracking-tight text-neutral-900 leading-tight mb-4">${escapeHtml(blog.title)}</h1>
      <div class="flex items-center gap-4 text-xs font-medium text-neutral-500">
        <span>By ${escapeHtml(blog.author)}</span>
        <span>•</span>
        <time>${escapeHtml(blog.date)}</time>
      </div>
    </div>

    ${blog.image ? `<div class="mb-10 rounded-2xl overflow-hidden border border-neutral-200 shadow-sm aspect-video max-h-[450px]"><img src="${escapeHtml(blog.image)}" alt="${escapeHtml(blog.title)}" class="w-full h-full object-cover"></div>` : ''}

    <article class="prose max-w-none text-neutral-800 text-base md:text-lg leading-relaxed mb-16 bg-white p-6 md:p-10 rounded-2xl border border-neutral-200 shadow-sm">
      ${blog.content}
    </article>
  </main>
</body>
</html>`;
}

function buildHtmlBlog() {
  if (!fs.existsSync(BLOG_FILE)) {
    const generateBlogJson = require('./build-blog');
    generateBlogJson();
  }

  const blogs = JSON.parse(fs.readFileSync(BLOG_FILE, 'utf-8'));
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const blog of blogs) {
    const outPath = path.join(OUTPUT_DIR, `${blog.slug}.html`);
    fs.writeFileSync(outPath, generateHTML(blog), 'utf-8');
  }

  console.log(`[build-html-blog] Success: Generated ${blogs.length} HTML pages in ${OUTPUT_DIR}`);
}

if (require.main === module) {
  buildHtmlBlog();
}

module.exports = buildHtmlBlog;
