import { useEffect } from 'react';
import { createRipple } from './useRipple';

/**
 * useAdminTactileFeedback
 * Provides high-performance tactile feedback (dynamic coordinate-based ripple + scale)
 * for interactive elements across the Admin operations dashboard and all modal/dialog components.
 */
export function useAdminTactileFeedback(containerId = 'admin-root-layout') {
  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersReducedMotion.matches) {
      return;
    }

    let activePressedEl: HTMLElement | null = null;
    let activeWave: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      // Only respond to primary touches / clicks (button === 0)
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Scope to elements inside admin dashboard or any open admin dialogs/modal overlays
      const inAdminScope = target.closest(
        '#admin-root-layout, [role="dialog"], [role="alertdialog"], .admin-modal, [data-admin-modal], [aria-modal="true"], .admin-tactile-scope'
      );
      if (!inAdminScope) return;

      // Ignore form inputs where user is trying to type or select text
      if (
        target.closest(
          'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'
        )
      ) {
        return;
      }

      // Find the closest interactive element
      const interactiveEl = target.closest<HTMLElement>(
        'button, a[href], [role="button"], select, summary, .admin-tap-target, input[type="button"], input[type="submit"]'
      );

      if (!interactiveEl) return;

      // Check if disabled
      if (
        interactiveEl.hasAttribute('disabled') ||
        interactiveEl.getAttribute('aria-disabled') === 'true' ||
        interactiveEl.classList.contains('disabled') ||
        interactiveEl.classList.contains('pointer-events-none')
      ) {
        return;
      }

      startX = e.clientX;
      startY = e.clientY;

      // Add active scale class for immediate tactile animation
      interactiveEl.classList.add('admin-active-scale');
      activePressedEl = interactiveEl;

      // Create and inject the ripple wave into the .admin-ripple-surface
      activeWave = createRipple(interactiveEl, e);
    };

    const handlePointerMove = (e: PointerEvent) => {
      // If user moved significantly (scrolling a list/table on mobile), fade out the ripple & cancel scale
      if (activeWave || activePressedEl) {
        const deltaX = Math.abs(e.clientX - startX);
        const deltaY = Math.abs(e.clientY - startY);
        if (deltaX > 10 || deltaY > 10) {
          if (activePressedEl) {
            activePressedEl.classList.remove('admin-active-scale');
            activePressedEl = null;
          }
          if (activeWave) {
            activeWave.style.opacity = '0';
            activeWave.style.transition = 'opacity 0.15s ease-out';
            activeWave = null;
          }
        }
      }
    };

    const handlePointerUpOrCancel = () => {
      if (activePressedEl) {
        activePressedEl.classList.remove('admin-active-scale');
        activePressedEl = null;
      }
      if (activeWave) {
        activeWave.style.opacity = '0';
        activeWave.style.transition = 'opacity 0.2s ease-out';
        activeWave = null;
      }
    };

    // Attach listeners with passive flag for high-performance touch scrolling
    document.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerup', handlePointerUpOrCancel, { passive: true });
    window.addEventListener('pointercancel', handlePointerUpOrCancel, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUpOrCancel);
      window.removeEventListener('pointercancel', handlePointerUpOrCancel);
    };
  }, [containerId]);
}
