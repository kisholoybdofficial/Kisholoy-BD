import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnectedToast, setShowReconnectedToast] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
    } else if (wasOffline) {
      // Just reconnected
      setShowReconnectedToast(true);
      const timer = setTimeout(() => {
        setShowReconnectedToast(false);
        setWasOffline(false);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (!isOnline) {
    return (
      <div
        id="pwa-offline-indicator"
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-xl bg-amber-600/95 dark:bg-amber-700/95 px-3.5 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-xs border border-amber-400/40 animate-in fade-in slide-in-from-bottom-2"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-200 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
        </span>
        <WifiOff className="w-3.5 h-3.5 text-amber-100" />
        <span>অফলাইন মোড — ক্যাশ করা ডেটা প্রদর্শিত হচ্ছে (Offline Mode)</span>
      </div>
    );
  }

  if (showReconnectedToast) {
    return (
      <div
        id="pwa-reconnected-indicator"
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-emerald-600/95 dark:bg-emerald-700/95 px-3.5 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-xs border border-emerald-400/40 animate-in fade-in slide-in-from-bottom-2"
      >
        <Wifi className="w-3.5 h-3.5 text-emerald-100" />
        <span>ইন্টারনেট সংযোগ পুনরুদ্ধার হয়েছে (Back Online)</span>
      </div>
    );
  }

  return null;
};
