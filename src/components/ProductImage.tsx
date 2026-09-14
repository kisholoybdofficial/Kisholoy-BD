/**
 * Catalogue image with a guaranteed, non-broken fallback.
 *
 * Why this exists: the storefront previously rendered `<img src={p.images[0]}>`
 * directly, so a missing file produced a torn-icon box, an unstyled layout
 * shift, and no alt text. This component:
 *   - reserves the box with `aspect-ratio` so images cannot shift layout;
 *   - lazy-loads and async-decodes below-the-fold product art;
 *   - falls back to the local brand placeholder (a file we ship, never a remote
 *     CDN that can 403 or hotlink-block);
 *   - requires `alt`, defaulting to the product title for decorative callers.
 *
 * @license Apache-2.0
 */

import React from 'react';

export const PLACEHOLDER_IMAGE = '/products/placeholder.svg';

export interface ProductImageProps {
  src?: string | null;
  alt: string;
  /** 1 = square (default catalogue ratio). */
  aspectRatio?: number;
  className?: string;
  imgClassName?: string;
  /** `sizes` for responsive sources, e.g. '(max-width: 640px) 50vw, 25vw'. */
  sizes?: string;
  priority?: boolean;
  /** Small blurred preview colour shown while loading. */
  fallbackTone?: string;
  objectFit?: 'cover' | 'contain';
  /**
   * Fill an already-positioned parent (`absolute inset-0`) instead of reserving
   * height from `aspectRatio`. Used by hero/banner/promo images that sit behind a
   * gradient overlay, where the parent already fixes the box.
   */
  fill?: boolean;
  onLoad?: () => void;
}

export function ProductImage({
  src,
  alt,
  aspectRatio = 1,
  className = '',
  imgClassName = '',
  sizes,
  priority = false,
  fallbackTone,
  objectFit = 'cover',
  fill = false,
  onLoad,
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const effectiveSrc = !src || failedSrc === src ? PLACEHOLDER_IMAGE : src;

  React.useEffect(() => {
    // Reset failure state when the product image changes (admin edits, variant
    // switches) so a recovered URL renders again without a remount.
    setFailedSrc(null);
    setLoaded(false);
  }, [src]);

  return (
    <div
      className={
        fill
          ? `absolute inset-0 h-full w-full overflow-hidden ${className}`
          : `relative overflow-hidden bg-stone-100 dark:bg-slate-900 ${className}`
      }
      style={{
        ...(fill ? {} : { aspectRatio: String(aspectRatio) }),
        backgroundColor: !loaded && fallbackTone ? fallbackTone : undefined,
      }}
    >
      <img
        src={effectiveSrc}
        alt={alt || 'Product image'}
        width={800}
        height={Math.round(800 / aspectRatio)}
        loading={priority ? 'eager' : 'lazy'}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ fetchpriority: priority ? 'high' : 'auto', decoding: 'async' } as any)}
        onLoad={() => {
          setLoaded(true);
          onLoad?.();
        }}
        onError={() => {
          if (effectiveSrc !== PLACEHOLDER_IMAGE) setFailedSrc(src || '');
          setLoaded(true);
        }}
        className={`h-full w-full transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
        style={{ objectFit }}
      />
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-gradient-to-br from-stone-200/70 via-stone-100/40 to-stone-200/70 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800"
        />
      )}
    </div>
  );
}

export default ProductImage;
