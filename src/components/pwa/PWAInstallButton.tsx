import React, { useState } from 'react';
import { Download, Smartphone, X, CheckCircle } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'header' | 'banner' | 'compact';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  // If already running as an installed PWA, hide the button
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    setInstalling(true);
    await install();
    setInstalling(false);
  };

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    if (variant === 'banner') {
      return (
        <div
          id="pwa-install-banner"
          className={`flex items-center justify-between gap-3 p-3 rounded-xl bg-teal-950/80 border border-teal-800/60 text-teal-50 shadow-md ${className}`}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-800/50 rounded-lg text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">
                কিশলয় অ্যাপ ইনস্টল করুন (Install App)
              </p>
              <p className="text-[11px] text-teal-200/80">
                দ্রুত লোডিং ও অফলাইন ব্রাউজিংয়ের সুবিধা পান
              </p>
            </div>
          </div>
          <button
            id="pwa-install-banner-btn"
            onClick={handleInstallClick}
            disabled={installing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-teal-950 text-xs font-bold transition shadow-sm active:scale-95 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{installing ? '...' : 'ইনস্টল'}</span>
          </button>
        </div>
      );
    }

    return (
      <button
        id="pwa-install-btn"
        onClick={handleInstallClick}
        disabled={installing}
        title="Install KISHOLOY as an app"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition border border-teal-700/40 bg-teal-900/40 text-teal-100 hover:bg-teal-800/60 dark:bg-teal-950/60 dark:border-teal-700/50 dark:hover:bg-teal-900/60 shadow-xs ${className}`}
      >
        <Download className="w-3.5 h-3.5 text-emerald-400" />
        <span className="hidden sm:inline">ইনস্টল অ্যাপ</span>
        <span className="sm:hidden">App</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          id="pwa-install-ios-btn"
          onClick={() => setShowIOSGuide(true)}
          title="Install on iPhone / iPad"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 shadow-xs ${className}`}
        >
          <Smartphone className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          <span className="hidden sm:inline">iOS ইনস্টল</span>
          <span className="sm:hidden">iOS</span>
        </button>

        {showIOSGuide && (
          <div
            id="pwa-ios-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
          >
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-stone-900 dark:text-white">
                      iPhone / iPad-এ ইনস্টল করুন
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      KISHOLOY Progressive Web App
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 my-4 text-xs text-stone-600 dark:text-stone-300">
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-700/50">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center text-[10px]">
                    ১
                  </span>
                  <p>
                    সাফারি ব্রাউজারের নিচে থাকা <strong>শেয়ার (Share)</strong> বাটনে ট্যাপ করুন।
                  </p>
                </div>
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-700/50">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center text-[10px]">
                    ২
                  </span>
                  <p>
                    মেনু স্ক্রোল করে <strong>'Add to Home Screen'</strong> (হোম স্ক্রিনে যোগ করুন) সিলেক্ট করুন।
                  </p>
                </div>
                <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-stone-50 dark:bg-stone-800/50 border border-stone-100 dark:border-stone-700/50">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-600 text-white font-bold flex items-center justify-center text-[10px]">
                    ৩
                  </span>
                  <p>
                    উপরে ডানে <strong>'Add'</strong> চাপুন। অ্যাপটি আপনার হোম স্ক্রিনে যুক্ত হয়ে যাবে!
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-2 w-full py-2.5 rounded-xl bg-teal-800 hover:bg-teal-700 text-white text-xs font-semibold transition"
              >
                ঠিক আছে (Got It)
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
