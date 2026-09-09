import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { createRipple, RippleOptions, RippleEventOrCoords } from '../hooks/useRipple';

export interface AdminTactileContextType {
  isEnabled: boolean;
  setIsEnabled: (enabled: boolean) => void;
  triggerRipple: (targetElement: HTMLElement, coordsOrEvent?: RippleEventOrCoords, options?: RippleOptions) => void;
  /** Dev-only setting: overlays bounding boxes on all interactive elements with ripple listeners */
  showTouchTargetOverlays: boolean;
  setShowTouchTargetOverlays: (show: boolean) => void;
  toggleTouchTargetOverlays: () => void;
  detectedTargetsCount: number;
}

const AdminTactileContext = createContext<AdminTactileContextType | null>(null);

export interface AdminTactileProviderProps {
  children: React.ReactNode;
  /** Whether tactile feedback is globally enabled (default: true) */
  defaultEnabled?: boolean;
}

/**
 * AdminTactileProvider
 * Top-level provider component that wraps the Admin UI.
 * Automatically attaches the necessary onMouseDown and onMouseUp listeners
 * to all interactive elements (including buttons inside modal and dialog overlays)
 * to trigger the ripple effect and scale animation consistently.
 */
export function AdminTactileProvider({
  children,
  defaultEnabled = true,
}: AdminTactileProviderProps) {
  const [isEnabled, setIsEnabled] = useState(defaultEnabled);
  const [showTouchTargetOverlays, setShowTouchTargetOverlaysState] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('admin_tactile_debug_overlays') === 'true';
      }
    } catch {
      // Ignore localStorage errors
    }
    return false;
  });
  const [detectedTargetsCount, setDetectedTargetsCount] = useState(0);

  const setShowTouchTargetOverlays = useCallback((show: boolean) => {
    setShowTouchTargetOverlaysState(show);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('admin_tactile_debug_overlays', show ? 'true' : 'false');
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const toggleTouchTargetOverlays = useCallback(() => {
    setShowTouchTargetOverlays(!showTouchTargetOverlays);
  }, [showTouchTargetOverlays, setShowTouchTargetOverlays]);

  // Synchronize CSS class on document element and scan interactive targets
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (showTouchTargetOverlays) {
      document.documentElement.classList.add('admin-debug-touch-targets');
    } else {
      document.documentElement.classList.remove('admin-debug-touch-targets');
      setDetectedTargetsCount(0);
      return;
    }

    const scanTargets = () => {
      const selector = [
        '#admin-root-layout button:not(:disabled):not([aria-disabled="true"])',
        '#admin-root-layout a[href]:not([aria-disabled="true"])',
        '#admin-root-layout [role="button"]:not([aria-disabled="true"])',
        '#admin-root-layout select:not(:disabled)',
        '#admin-root-layout summary',
        '#admin-root-layout .admin-tap-target',
        '#admin-root-layout input[type="button"]',
        '#admin-root-layout input[type="submit"]',
        '[role="dialog"] button:not(:disabled):not([aria-disabled="true"])',
        '[role="dialog"] a[href]:not([aria-disabled="true"])',
        '[role="dialog"] [role="button"]:not([aria-disabled="true"])',
        '[role="dialog"] select:not(:disabled)',
        '[role="alertdialog"] button:not(:disabled):not([aria-disabled="true"])',
        '[role="alertdialog"] a[href]:not([aria-disabled="true"])',
        '[role="alertdialog"] [role="button"]:not([aria-disabled="true"])',
        '.admin-modal button:not(:disabled):not([aria-disabled="true"])',
        '.admin-modal a[href]:not([aria-disabled="true"])',
        '.admin-modal [role="button"]:not([aria-disabled="true"])',
        '[data-admin-modal] button:not(:disabled):not([aria-disabled="true"])',
        '[data-admin-modal] a[href]:not([aria-disabled="true"])',
        '[data-admin-modal] [role="button"]:not([aria-disabled="true"])'
      ].join(', ');

      const elements = document.querySelectorAll<HTMLElement>(selector);
      setDetectedTargetsCount(elements.length);

      // Add inspection metadata attributes to elements
      elements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const w = Math.round(rect.width);
          const h = Math.round(rect.height);
          el.setAttribute('data-tactile-target', 'true');
          el.setAttribute('data-tactile-dims', `${w}×${h}`);
          if (w < 44 || h < 44) {
            el.setAttribute('data-tactile-substandard', 'true');
          } else {
            el.removeAttribute('data-tactile-substandard');
          }
        }
      });
    };

    scanTargets();
    const interval = setInterval(scanTargets, 1200);

    return () => {
      clearInterval(interval);
      document.documentElement.classList.remove('admin-debug-touch-targets');
    };
  }, [showTouchTargetOverlays]);

  const activeScaledElementsRef = useRef<Set<HTMLElement>>(new Set());
  const activeWavesRef = useRef<Set<HTMLSpanElement>>(new Set());
  const dragStartCoordsRef = useRef<{ x: number; y: number } | null>(null);

  const triggerRipple = useCallback(
    (targetElement: HTMLElement, coordsOrEvent?: RippleEventOrCoords, options?: RippleOptions) => {
      if (!isEnabled) return;
      const wave = createRipple(targetElement, coordsOrEvent, options);
      if (wave) {
        activeWavesRef.current.add(wave);
      }
    },
    [isEnabled]
  );

  /**
   * Identifies the closest interactive target eligible for tactile feedback
   * across both the main admin layout and any modal / dialog overlays.
   */
  const getInteractiveTarget = useCallback((target: EventTarget | null): HTMLElement | null => {
    if (!target || !(target instanceof HTMLElement)) return null;

    // Ignore text inputs where clicking should place caret or select text
    if (
      target.closest(
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'
      )
    ) {
      return null;
    }

    // Find the interactive element
    const interactiveEl = target.closest<HTMLElement>(
      'button, a[href], [role="button"], select, summary, .admin-tap-target, input[type="button"], input[type="submit"]'
    );

    if (!interactiveEl) return null;

    // Check if within admin workspace OR within any dialog/modal overlay
    const isInScope = interactiveEl.closest(
      '#admin-root-layout, [role="dialog"], [role="alertdialog"], .admin-modal, [data-admin-modal], [aria-modal="true"], .admin-tactile-scope'
    );

    if (!isInScope) return null;

    // Check if disabled or non-interactive
    if (
      interactiveEl.hasAttribute('disabled') ||
      interactiveEl.getAttribute('aria-disabled') === 'true' ||
      interactiveEl.classList.contains('disabled') ||
      interactiveEl.classList.contains('pointer-events-none')
    ) {
      return null;
    }

    return interactiveEl;
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent | MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
      if (!isEnabled) return;
      if ('button' in e && (e as MouseEvent).button !== 0 && (e as any).pointerType === 'mouse') return;

      const interactiveEl = getInteractiveTarget(e.target);
      if (!interactiveEl) return;

      const clientX = 'clientX' in e ? e.clientX : ('touches' in e && e.touches[0] ? e.touches[0].clientX : 0);
      const clientY = 'clientY' in e ? e.clientY : ('touches' in e && e.touches[0] ? e.touches[0].clientY : 0);

      dragStartCoordsRef.current = { x: clientX, y: clientY };

      // Apply tactile active scale state
      interactiveEl.classList.add('admin-active-scale');
      activeScaledElementsRef.current.add(interactiveEl);

      // Trigger ripple wave
      const wave = createRipple(interactiveEl, e);
      if (wave) {
        activeWavesRef.current.add(wave);
      }
    },
    [isEnabled, getInteractiveTarget]
  );

  const handlePointerUp = useCallback(
    (e?: PointerEvent | MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent | React.PointerEvent) => {
      // Remove active scale from all currently pressed elements
      activeScaledElementsRef.current.forEach((el) => {
        el.classList.remove('admin-active-scale');
      });
      activeScaledElementsRef.current.clear();

      // Gracefully fade active waves
      activeWavesRef.current.forEach((wave) => {
        wave.style.opacity = '0';
        wave.style.transition = 'opacity 0.2s ease-out';
      });
      activeWavesRef.current.clear();
      dragStartCoordsRef.current = null;
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragStartCoordsRef.current) return;
      const dx = Math.abs(e.clientX - dragStartCoordsRef.current.x);
      const dy = Math.abs(e.clientY - dragStartCoordsRef.current.y);

      // If user drags more than 10px (e.g. scrolling on mobile), cancel scale & fade ripple
      if (dx > 10 || dy > 10) {
        handlePointerUp();
      }
    },
    [handlePointerUp]
  );

  // Top-level document listeners to guarantee modal overlays and portals are also captured
  useEffect(() => {
    if (!isEnabled) return;

    const onDocPointerDown = (e: PointerEvent) => handlePointerDown(e);
    const onDocPointerUp = (e: PointerEvent) => handlePointerUp(e);
    const onDocPointerMove = (e: PointerEvent) => handlePointerMove(e);
    const onDocPointerCancel = () => handlePointerUp();
    const onDocBlur = () => handlePointerUp();

    // Attach capture-phase or passive listeners
    document.addEventListener('pointerdown', onDocPointerDown, { passive: true, capture: true });
    window.addEventListener('pointermove', onDocPointerMove, { passive: true });
    window.addEventListener('pointerup', onDocPointerUp, { passive: true });
    window.addEventListener('pointercancel', onDocPointerCancel, { passive: true });
    window.addEventListener('blur', onDocBlur);

    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, { capture: true });
      window.removeEventListener('pointermove', onDocPointerMove);
      window.removeEventListener('pointerup', onDocPointerUp);
      window.removeEventListener('pointercancel', onDocPointerCancel);
      window.removeEventListener('blur', onDocBlur);
    };
  }, [isEnabled, handlePointerDown, handlePointerUp, handlePointerMove]);

  return (
    <AdminTactileContext.Provider
      value={{
        isEnabled,
        setIsEnabled,
        triggerRipple,
        showTouchTargetOverlays,
        setShowTouchTargetOverlays,
        toggleTouchTargetOverlays,
        detectedTargetsCount,
      }}
    >
      <div
        className="admin-tactile-scope contents"
        onMouseDown={(e) => handlePointerDown(e)}
        onMouseUp={(e) => handlePointerUp(e)}
        onTouchStart={(e) => handlePointerDown(e)}
        onTouchEnd={(e) => handlePointerUp(e)}
      >
        {children}
      </div>

      {/* Dev-only floating touch target overlay indicator */}
      {showTouchTargetOverlays && (
        <aside
          id="admin-dev-touch-target-hud"
          aria-label="Dev Touch Target Debugger"
          className="fixed bottom-3 right-3 z-[9999] bg-stone-900/95 text-white backdrop-blur-md px-3 py-2 rounded-xl shadow-2xl border border-sky-500/50 flex items-center gap-2.5 text-xs font-mono animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping inline-block shrink-0" />
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 font-bold text-sky-300">
              <span>DEV: Touch Targets</span>
              <span className="bg-sky-950 text-sky-200 text-[10px] px-1.5 py-0.2 rounded border border-sky-600/60 font-mono">
                {detectedTargetsCount} detected
              </span>
            </div>
            <span className="text-[10px] text-stone-300">Cyan: Ripple Target (min 44px)</span>
          </div>

          <button
            type="button"
            id="admin-dev-toggle-overlay-btn"
            onClick={() => setShowTouchTargetOverlays(false)}
            className="ml-1 px-2 py-1 bg-stone-800 hover:bg-rose-900/80 text-stone-200 hover:text-white rounded-md text-[11px] font-sans font-semibold transition-colors"
            title="Turn off touch target overlay"
          >
            Turn off
          </button>
        </aside>
      )}
    </AdminTactileContext.Provider>
  );
}

/**
 * Hook to access the AdminTactile context
 */
export function useAdminTactile() {
  const context = useContext(AdminTactileContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      isEnabled: true,
      setIsEnabled: () => {},
      triggerRipple: createRipple,
      showTouchTargetOverlays: false,
      setShowTouchTargetOverlays: () => {},
      toggleTouchTargetOverlays: () => {},
      detectedTargetsCount: 0,
    };
  }
  return context;
}
