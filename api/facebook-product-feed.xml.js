const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const SITE_URL = "https://www.rawgadz.com";

function escapeXml(unsafe = "") {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getProductsFromRepo() {
  const productsDir = path.join(process.cwd(), "content", "product");
  if (!fs.existsSync(productsDir)) return [];

  const filenames = fs.readdirSync(productsDir);

  return filenames
    .filter((file) => file.endsWith(".md") || file.endsWith(".mdx"))
    .map((filename) => {
      const filePath = path.join(productsDir, filename);
      const fileContent = fs.readFileSync(filePath, "utf8");
      const { data, content } = matter(fileContent);

      const cleanSlug =
        data.slug ||
        filename.replace(/\.mdx?$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");

      const rawImage = Array.isArray(data.images)
        ? data.images[0]
        : data.image || data.thumbnail || "";

      const imageUrl = rawImage.startsWith("http")
        ? rawImage
        : `${SITE_URL}${rawImage.startsWith("/") ? "" : "/"}${rawImage}`;

      const cleanDesc = String(data.description || content || data.title || cleanSlug)
        .replace(/[#*_`>\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

      const isAvailable =
        data.inStock !== false &&
        data.status !== "out_of_stock" &&
        (data.stock === undefined || Number(data.stock) > 0);

      return {
        id: data.sku || data.id || cleanSlug,
        title: data.title || cleanSlug,
        description: cleanDesc,
        url: `${SITE_URL}/product/${cleanSlug}`,
        imageUrl,
        inStock: isAvailable,
        price: Number(data.salePrice || data.discountPrice || data.price || 0),
        brand: data.brand || "RawGadz",
      };
    })
    .filter((p) => p.price > 0 && p.imageUrl !== `${SITE_URL}/`);
}

module.exports = (req, res) => {
  try {
    const products = getProductsFromRepo();

    const itemsXml = products
      .map(
        (p) => `
    <item>
      <g:id>${escapeXml(String(p.id))}</g:id>
      <g:title>${escapeXml(p.title)}</g:title>
      <g:description>${escapeXml(p.description)}</g:description>
      <g:link>${escapeXml(p.url)}</g:link>
      <g:image_link>${escapeXml(p.imageUrl)}</g:image_link>
      <g:availability>${p.inStock ? "in stock" : "out of stock"}</g:availability>
      <g:price>${p.price.toFixed(2)} BDT</g:price>
      <g:brand>${escapeXml(p.brand)}</g:brand>
      <g:condition>new</g:condition>
    </item>`
      )
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>RawGadz Product Feed</title>
    <link>${SITE_URL}</link>
    <description>Official Product Feed for RawGadz</description>
    ${itemsXml}
  </channel>
</rss>`;

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(500).send(`<error>${escapeXml(err.message)}</error>`);
  }
};
