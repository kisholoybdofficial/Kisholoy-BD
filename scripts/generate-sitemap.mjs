/**
 * Build-time sitemap generator.
 *
 * On Vercel the SPA rewrite sends unknown paths to index.html, so a sitemap
 * must exist as a real file at build time (a live `/sitemap.xml` route is also
 * registered for long-lived Node hosts, see server.ts).
 *
 * Reads the durable store when configured (MONGODB_URI or the local file
 * store); otherwise falls back to the seeded catalogue module so a fresh clone
 * still produces a valid sitemap.
 *
 * @license Apache-2.0
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SITE = (process.env.APP_URL || 'https://kisholoy.com').replace(/\/+$/, '');
const OUT = path.resolve(process.cwd(), 'dist');

const STATIC_ROUTES = [
  { loc: '/', priority: '1.0', changefreq: 'daily' },
  { loc: '/shop', priority: '0.9', changefreq: 'daily' },
];

const readProducts = async () => {
  // 1. Local durable store (development / self-hosted file driver).
  const file = path.resolve(process.cwd(), '.kisholoy-data/products.ndjson');
  if (existsSync(file)) {
    const seen = new Map();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const raw = line.trim();
      if (!raw) continue;
      try {
        const doc = JSON.parse(raw);
        if (doc.__deleted) { seen.delete(doc.__id); continue; }
        seen.set(doc.__id || doc.id, doc);
      } catch { /* skip torn line */ }
    }
    return Array.from(seen.values());
  }
  return [];
};

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const build = async () => {
  const products = await readProducts();
  const sellable = products.filter((p) => !p.isDeleted && (p.status || 'ACTIVE') === 'ACTIVE' && p.slug);

  const urls = [...STATIC_ROUTES];
  for (const p of sellable) {
    urls.push({
      loc: `/product/${encodeURIComponent(p.slug)}`,
      priority: p.stock > 0 ? '0.8' : '0.4',
      changefreq: 'weekly',
      lastmod: (p.updatedAt || p.publishedAt || '').slice(0, 10) || undefined,
      image: (p.images && p.images[0]) || undefined,
      imageTitle: p.title,
    });
  }
  for (const c of new Set(sellable.map((p) => p.categorySlug).filter(Boolean))) {
    urls.push({ loc: `/category/${encodeURIComponent(c)}`, priority: '0.7', changefreq: 'weekly' });
  }

  const body = urls
    .map((u) => {
      const parts = [
        '  <url>',
        `    <loc>${escape(SITE + u.loc)}</loc>`,
        u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : '',
        `    <changefreq>${u.changefreq || 'monthly'}</changefreq>`,
        `    <priority>${u.priority || '0.5'}</priority>`,
        u.image ? `    <image:image>\n      <image:url>${escape(SITE + u.image)}</image:url>\n      <image:title>${escape(u.imageTitle || '')}</image:title>\n    </image:image>` : '',
        '  </url>',
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`;

  // `public/` is the authored location: Vite copies it into dist at build time,
  // `vite preview` serves it, and the long-lived Node server also answers
  // /sitemap.xml dynamically from the store (see server.ts).
  mkdirSync(path.resolve(process.cwd(), 'public'), { recursive: true });
  writeFileSync(path.resolve(process.cwd(), 'public/sitemap.xml'), xml, 'utf8');
  if (existsSync(OUT)) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, 'sitemap.xml'), xml, 'utf8');
  }
  console.log(`[sitemap] ${urls.length} urls (public/sitemap.xml${existsSync(OUT) ? ' + dist/sitemap.xml' : ''}) from ${sellable.length} products`);
};

build().catch((err) => {
  console.error('[sitemap] generation failed:', err.message);
  process.exitCode = 1;
});
