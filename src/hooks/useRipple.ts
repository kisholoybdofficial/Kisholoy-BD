import { useRef, useCallback, useEffect } from 'react';

export interface RippleOptions {
  /** Custom wave background color (defaults to currentColor) */
  color?: string;
  /** Whether ripple feedback is disabled */
  disabled?: boolean;
  /** Animation duration in milliseconds (default: 520ms) */
  duration?: number;
  /** Custom opacity of the ripple wave (default: 0.32) */
  opacity?: number;
}

export type RippleEventOrCoords =
  | MouseEvent
  | TouchEvent
  | PointerEvent
  | React.SyntheticEvent
  | { clientX?: number; clientY?: number; touches?: ArrayLike<{ clientX: number; clientY: number }> }
  | { x: number; y: number }
  | null
  | undefined;

/**
 * Injects a dynamic coordinate-based ripple wave into the .admin-ripple-surface
 * of a targeted interactive element (e.g. button, modal action, link).
 */
export function createRipple(
  targetElement: HTMLElement,
  coordsOrEvent?: RippleEventOrCoords,
  options: RippleOptions = {}
): HTMLSpanElement | null {
  if (!targetElement) return null;

  // Check if reduced motion is preferred
  if (typeof window !== 'undefined') {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || options.disabled) {
      return null;
    }
  }

  // Ensure element is positioned so the ripple surface is contained
  const computedPos = window.getComputedStyle(targetElement).position;
  if (computedPos === 'static') {
    targetElement.classList.add('admin-ripple-host');
  }

  // Find or create the ripple surface container
  let surface = targetElement.querySelector<HTMLElement>(':scope > .admin-ripple-surface');
  if (!surface) {
    surface = document.createElement('div');
    surface.className = 'admin-ripple-surface';
    targetElement.appendChild(surface);
  }

  const rect = targetElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  // Extract tap/click coordinates
  let clientX: number | null = null;
  let clientY: number | null = null;

  if (coordsOrEvent) {
    if ('clientX' in coordsOrEvent && typeof coordsOrEvent.clientX === 'number') {
      clientX = coordsOrEvent.clientX;
      clientY = coordsOrEvent.clientY;
    } else if ('touches' in coordsOrEvent && coordsOrEvent.touches.length > 0) {
      clientX = coordsOrEvent.touches[0].clientX;
      clientY = coordsOrEvent.touches[0].clientY;
    } else if ('x' in coordsOrEvent && typeof coordsOrEvent.x === 'number') {
      clientX = coordsOrEvent.x;
      clientY = coordsOrEvent.y;
    }
  }

  // Calculate local coordinates inside element
  let touchX: number;
  let touchY: number;

  if (
    clientX === null ||
    clientY === null ||
    (clientX === 0 && clientY === 0) ||
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    // Keyboard activation or out-of-bounds: center origin
    touchX = rect.width / 2;
    touchY = rect.height / 2;
  } else {
    touchX = clientX - rect.left;
    touchY = clientY - rect.top;
  }

  // Radius calculation to cover the entire element from the tap point
  const maxDistX = Math.max(touchX, rect.width - touchX);
  const maxDistY = Math.max(touchY, rect.height - touchY);
  const radius = Math.ceil(Math.hypot(maxDistX, maxDistY));

  const wave = document.createElement('span');
  wave.className = 'admin-ripple-wave';
  wave.style.width = `${radius * 2}px`;
  wave.style.height = `${radius * 2}px`;
  wave.style.left = `${touchX - radius}px`;
  wave.style.top = `${touchY - radius}px`;

  if (options.color) {
    wave.style.backgroundColor = options.color;
  }
  if (options.duration) {
    wave.style.animationDuration = `${options.duration}ms`;
  }
  if (options.opacity !== undefined) {
    wave.style.opacity = `${options.opacity}`;
  }

  surface.appendChild(wave);

  // Self-cleanup after animation completes
  const cleanup = () => {
    if (wave.parentElement) {
      wave.remove();
    }
    if (surface && surface.children.length === 0 && surface.parentElement) {
      surface.remove();
    }
  };

  wave.addEventListener('animationend', cleanup, { once: true });
  setTimeout(cleanup, (options.duration || 520) + 100);

  return wave;
}

/**
 * Reusable useRipple hook
 * Allows components (buttons, modal actions, cards) to bind tactile ripple feedback.
 */
export function useRipple<T extends HTMLElement = HTMLElement>(options: RippleOptions = {}) {
  const ref = useRef<T | null>(null);

  const trigger = useCallback(
    (e?: RippleEventOrCoords) => {
      if (ref.current) {
        return createRipple(ref.current, e, options);
      }
      return null;
    },
    [options.color, options.disabled, options.duration, options.opacity]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<T>) => {
      trigger(e);
    },
    [trigger]
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent<T>) => {
      trigger(e);
    },
    [trigger]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || options.disabled) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      createRipple(el, e, options);
    };

    el.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [options.color, options.disabled, options.duration, options.opacity]);

  return {
    ref,
    trigger,
    onMouseDown,
    onTouchStart,
  };
}
