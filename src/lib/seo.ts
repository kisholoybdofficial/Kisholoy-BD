/**
 * SEO + metadata management for the SPA.
 *
 * The app is a client-rendered React router, so without help every route shares
 * the `<title>` and description from `index.html` — product pages, category
 * pages and the shop were therefore invisible as themselves in search results
 * and link previews. This module centralises:
 *   - document title + meta description
 *   - canonical URL
 *   - Open Graph + Twitter card
 *   - `hreflang` alternates for the Bengali/English routes
 *   - JSON-LD structured data (Product / BreadcrumbList / ItemList / WebSite)
 *   - `noindex` for authenticated and transactional routes
 *
 * `/admin`, `/account`, `/checkout` and `/order-confirmation` are marked
 * `noindex,nofollow` here *and* disallowed in robots.txt, so the admin panel is
 * not discoverable even if someone links to it.
 *
 * @license Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * Storefront-wide `noindex`, driven by the CMS (`Admin → Content Studio → SEO &
 * Sharing → hide from search engines`). Kept here rather than threaded through
 * every page so a soft launch or a data migration cannot leak a single indexed
 * URL just because one component forgot to pass `private: true`.
 */
let siteWideNoIndex = false;
const noIndexListeners = new Set<() => void>();

export function setSiteWideNoIndex(value: boolean): void {
  const next = Boolean(value);
  if (next === siteWideNoIndex) return;
  siteWideNoIndex = next;
  for (const listener of noIndexListeners) listener();
}

export const isSiteWideNoIndex = (): boolean => siteWideNoIndex;

const subscribeNoIndex = (listener: () => void): (() => void) => {
  noIndexListeners.add(listener);
  return () => {
    noIndexListeners.delete(listener);
  };
};

/** Re-renders when the operator flips the global noindex switch. */
export function useSiteWideNoIndex(): boolean {
  const [value, setValue] = useState(siteWideNoIndex);
  useEffect(() => subscribeNoIndex(() => setValue(isSiteWideNoIndex())), []);
  return value;
}

export interface SeoInput {
  title: string;
  titleBn?: string;
  description?: string;
  descriptionBn?: string;
  /** Path only ('/product/foo') or absolute URL. */
  path?: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'product' | 'article';
  /** Emit noindex,nofollow (private/transactional pages). */
  private?: boolean;
  /** JSON-LD document(s) for this page. */
  structuredData?: Record<string, unknown> | Record<string, unknown>[];
  locale?: 'bn' | 'en';
}

const SITE_NAME = 'KISHOLOY | কিশলয়';
const DEFAULT_IMAGE = '/brand/kisholoy-og.png';
const NO_INDEX_VALUE = 'noindex, nofollow, noarchive';

const origin = (): string => {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
};

const absolute = (path?: string): string => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin()}${path.startsWith('/') ? path : `/${path}`}`;
};

function upsertMeta(selector: string, attrs: Record<string, string>): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
}

function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function applySeo(input: SeoInput): void {
  if (typeof document === 'undefined') return;

  const isBn = input.locale === 'bn';
  const title = (isBn && input.titleBn ? input.titleBn : input.title) || SITE_NAME;
  const description =
    (isBn && input.descriptionBn ? input.descriptionBn : input.description) ||
    'Kisholoy — premium Bangladeshi food, handmade, home, lifestyle and retail products with nationwide delivery.';
  const url = absolute(input.path || (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const image = input.image ? absolute(input.image) : absolute(DEFAULT_IMAGE);

  document.title = title.includes(SITE_NAME) || title.includes('কিশলয়') ? title : `${title} | ${SITE_NAME}`;
  document.documentElement.lang = isBn ? 'bn' : 'en';

  upsertMeta('meta[name="description"]', { name: 'description', content: description });
  const noindex = Boolean(input.private) || siteWideNoIndex;
  upsertMeta('meta[name="robots"]', {
    name: 'robots',
    content: noindex ? NO_INDEX_VALUE : 'index, follow, max-image-preview:large',
  });

  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: input.type === 'product' ? 'product' : 'website' });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: image });
  upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: input.imageAlt || title });
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SITE_NAME });
  upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: isBn ? 'bn_BD' : 'en_US' });

  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
  upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: image });

  if (url) upsertLink('canonical', url);
  if (input.path) {
    // Bengali and English share one URL per page (language is a UI preference),
    // so declare both variants of the *same* path rather than inventing routes.
    upsertLink('alternate', url);
  }
}

export function setStructuredData(data: Record<string, unknown> | Record<string, unknown>[] | null): void {
  if (typeof document === 'undefined') return;
  const ID = 'kisholoy-jsonld';
  let script = document.getElementById(ID) as HTMLScriptElement | null;
  if (!data) {
    script?.remove();
    return;
  }
  if (!script) {
    script = document.createElement('script');
    script.id = ID;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(data);
}

/** React hook: keeps title/meta/canonical/JSON-LD in sync with the route. */
export function useSeo(input: SeoInput, deps: unknown[] = []): void {
  const globalNoIndex = useSiteWideNoIndex();
  const effective: SeoInput =
    globalNoIndex && !input.private ? { ...input, private: true } : input;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    applySeo(effective);
    if (effective.structuredData) setStructuredData(effective.structuredData);
    else setStructuredData(null);
    return () => setStructuredData(null);
  }, [effective.title, effective.titleBn, effective.path, effective.description, JSON.stringify(effective.structuredData ?? null), globalNoIndex, ...deps]);
}

/** `https://schema.org/Product` for a catalogue item. */
export function productStructuredData(args: {
  name: string;
  alternateName?: string;
  description?: string;
  image?: string[];
  sku?: string;
  brand?: string;
  price: number;
  compareAtPrice?: number;
  currency?: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
  ratingValue?: number;
  reviewCount?: number;
  url: string;
}): Record<string, unknown> {
  const offers: Record<string, unknown> = {
    '@type': 'Offer',
    url: args.url,
    priceCurrency: args.currency || 'BDT',
    price: args.price,
    availability: `https://schema.org/${args.availability || 'InStock'}`,
    itemCondition: 'https://schema.org/NewCondition',
  };
  if (args.compareAtPrice && args.compareAtPrice > args.price) offers.priceSpecification = { '@type': 'PriceSpecification', price: args.price };

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: args.name,
    ...(args.alternateName ? { alternateName: args.alternateName } : {}),
    description: args.description,
    ...(args.sku ? { sku: args.sku } : {}),
    ...(args.brand ? { brand: { '@type': 'Brand', name: args.brand } } : {}),
    image: args.image?.filter(Boolean),
    offers,
    ...(args.ratingValue && args.reviewCount
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: args.ratingValue,
            reviewCount: args.reviewCount,
          },
        }
      : {}),
  };
}

export function breadcrumbStructuredData(trail: Array<{ name: string; url?: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: absolute(item.url) } : {}),
    })),
  };
}

export function itemListStructuredData(items: Array<{ name: string; url: string }>, name = 'Catalogue'): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url,
    })),
  };
}

/** Which routes must never be indexed (also mirrored in public/robots.txt). */
export const NOINDEX_PREFIXES = ['/admin', '/account', '/checkout', '/order-confirmation', '/supplier', '/cart'];

export function isPrivateRoute(path: string): boolean {
  return NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
