import { registerSW } from 'virtual:pwa-register';

export function initPwaServiceWorker(): void {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
          console.log('[PWA] New version detected; caching updated storefront assets.');
          // Automatically update service worker when new assets are published
          updateSW(true);
        },
        onOfflineReady() {
          console.log('[PWA] Critical storefront assets cached. Ready for offline use.');
        },
        onRegisterError(error: unknown) {
          console.warn('[PWA] Service Worker registration failed:', error);
        },
      });
    } catch (e) {
      console.warn('[PWA] Service Worker initialization skipped:', e);
    }
  }
}
