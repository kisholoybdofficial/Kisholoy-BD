import React, { useRef, useEffect } from 'react';
import { createRipple, RippleOptions } from '../../hooks/useRipple';

export interface AdminRippleProps extends React.HTMLAttributes<HTMLDivElement>, RippleOptions {
  /** Whether to listen to pointer/click events on the immediate parent element (default: true) */
  triggerOnParent?: boolean;
}

/**
 * AdminRipple
 * A reusable tactile component that renders an isolated ripple container (.admin-ripple-surface)
 * and detects click/tap coordinates to inject the ripple wave into the surface.
 */
export function AdminRipple({
  triggerOnParent = true,
  color,
  disabled = false,
  duration = 520,
  opacity = 0.32,
  className = '',
  ...restProps
}: AdminRippleProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!triggerOnParent || disabled) return;

    const surfaceEl = surfaceRef.current;
    if (!surfaceEl) return;

    const parentEl = surfaceEl.parentElement;
    if (!parentEl) return;

    // Ensure parent has relative/absolute positioning
    const computedPos = window.getComputedStyle(parentEl).position;
    if (computedPos === 'static') {
      parentEl.classList.add('admin-ripple-host');
    }

    const handlePointerDown = (e: PointerEvent) => {
      // Primary mouse button only
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      // Ignore if parent is disabled
      if (
        parentEl.hasAttribute('disabled') ||
        parentEl.getAttribute('aria-disabled') === 'true' ||
        parentEl.classList.contains('disabled')
      ) {
        return;
      }

      createRipple(parentEl, e, { color, disabled, duration, opacity });
    };

    parentEl.addEventListener('pointerdown', handlePointerDown, { passive: true });

    return () => {
      parentEl.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [triggerOnParent, color, disabled, duration, opacity]);

  return (
    <div
      ref={surfaceRef}
      className={`admin-ripple-surface pointer-events-none ${className}`.trim()}
      aria-hidden="true"
      {...restProps}
    />
  );
}
