import React, { useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandLogo } from '../components/brand/BrandLogo';
import { setStaffToken } from '../lib/apiClient';
import { logAuthEvent } from '../utils/telemetryLogger';
import { Role } from '../types';
import { 
  loginAdminWithFirebase, 
  loginAdminWithGoogle, 
  DEFAULT_SUPER_ADMIN 
} from '../lib/auth';

interface StaffLoginScreenProps {
  onAuthenticated: (session: { token: string; role: Role; name: string; email: string }) => void;
}

/**
 * Staff sign-in gate for the admin control plane.
 *
 * Integrates Firebase Auth & server-side RBAC verification.
 */
export function StaffLoginScreen({ onAuthenticated }: StaffLoginScreenProps) {
  const { language } = useApp();
  const isBn = language === 'BN';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeLogin = async (targetEmail: string, targetPass: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loginAdminWithFirebase(targetEmail.trim(), targetPass);

      if (!result.success || !result.token || !result.user) {
        const message = result.error || (isBn ? 'লগইন ব্যর্থ হয়েছে।' : 'Sign-in failed.');
        setError(message);
        logAuthEvent({
          userId: 'unknown',
          userName: targetEmail.trim(),
          userPhone: '-',
          userEmail: targetEmail.trim(),
          role: 'CUSTOMER',
          eventType: 'LOGIN_FAILED',
          district: 'Dhaka',
          device: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile (Browser)' : 'Desktop (Browser)',
          status: 'FAILED',
        });
        return;
      }

      const role = result.user.role;
      logAuthEvent({
        userId: result.user.uid,
        userName: result.user.displayName || targetEmail.trim(),
        userPhone: result.user.phoneNumber || '-',
        userEmail: result.user.email || targetEmail.trim(),
        role,
        eventType: 'LOGIN_SUCCESS',
        district: 'Dhaka',
        device: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile (Browser)' : 'Desktop (Browser)',
        status: 'SUCCESS',
      });

      onAuthenticated({
        token: result.token,
        role,
        name: result.user.displayName || targetEmail.trim(),
        email: result.user.email || targetEmail.trim(),
      });
    } catch (err: any) {
      setError(
        err?.message ||
        (isBn
          ? 'সার্ভারের সাথে সংযোগ করা যায়নি। ইন্টারনেট চেক করুন।'
          : 'Could not reach the server. Please check your connection.')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(isBn ? 'ইমেইল ও পাসওয়ার্ড দুটোই দিন।' : 'Please enter both email and password.');
      return;
    }
    await executeLogin(email, password);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loginAdminWithGoogle();
      if (!result.success || !result.token || !result.user) {
        setError(result.error || (isBn ? 'গুগল সাইন-ইন ব্যর্থ হয়েছে।' : 'Google Sign-In failed.'));
        return;
      }
      onAuthenticated({
        token: result.token,
        role: result.user.role,
        name: result.user.displayName || 'Google Admin',
        email: result.user.email || '',
      });
    } catch (err: any) {
      setError(err?.message || (isBn ? 'গুগল সাইন-ইন ত্রুটি।' : 'Google Sign-In error.'));
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full pl-10 pr-3 py-2.5 text-sm rounded-lg border border-stone-300 dark:border-slate-700 ' +
    'bg-white dark:bg-slate-900 text-stone-900 dark:text-slate-100 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-600/40 focus:border-teal-700 transition';

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-stone-100 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <BrandLogo variant="light" size="md" linkToHome showTagline={false} />
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-900/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-teal-900 text-white shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h1 className="font-serif font-bold text-base text-stone-900 dark:text-white leading-tight">
                  {isBn ? 'স্টাফ সাইন ইন' : 'Staff Sign In'}
                </h1>
                <p className="text-[11px] text-stone-500 dark:text-slate-400">
                  {isBn
                    ? 'কিশলয় অ্যাডমিন কন্ট্রোল প্যানেল — অনুমোদিত কর্মী মাত্র'
                    : 'Kisholoy Admin Control Panel — authorised staff only'}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="staff-email" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                {isBn ? 'অফিসিয়াল ইমেইল' : 'Work email'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="staff-email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@kisholoy.com"
                  className={inputCls}
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="staff-password" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                {isBn ? 'পাসওয়ার্ড' : 'Password'}
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${inputCls} pr-11`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword
                      ? isBn ? 'পাসওয়ার্ড লুকান' : 'Hide password'
                      : isBn ? 'পাসওয়ার্ড দেখান' : 'Show password'
                  }
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-600/40"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Quick-fill default credentials card */}
            <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-slate-800/80 border border-stone-200 dark:border-slate-700/80 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-stone-800 dark:text-slate-200 text-[11px] uppercase tracking-wider">
                  {isBn ? 'ডিফল্ট সুপার অ্যাডমিন একাউন্ট' : 'Default Super Admin Account'}
                </span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300 font-semibold">
                  SUPER_ADMIN
                </span>
              </div>
              <div className="font-mono text-[11px] text-stone-600 dark:text-slate-300 space-y-0.5 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-stone-200/80 dark:border-slate-700/60">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 dark:text-slate-400">Email:</span>
                  <strong className="text-stone-900 dark:text-white select-all">{DEFAULT_SUPER_ADMIN.email}</strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 dark:text-slate-400">Password:</span>
                  <strong className="text-stone-900 dark:text-white select-all">{DEFAULT_SUPER_ADMIN.defaultPassword}</strong>
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setEmail(DEFAULT_SUPER_ADMIN.email);
                    setPassword(DEFAULT_SUPER_ADMIN.defaultPassword);
                    executeLogin(DEFAULT_SUPER_ADMIN.email, DEFAULT_SUPER_ADMIN.defaultPassword);
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-teal-800 hover:bg-teal-750 active:scale-[0.99] text-white font-semibold text-xs transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {isBn ? '⚡ তাৎক্ষণিক লগইন (Super Admin)' : '⚡ Instant Login (Super Admin)'}
                </button>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-stone-500 dark:text-slate-400 font-medium whitespace-nowrap">
                    {isBn ? 'অথবা ফিল করুন:' : 'Or Fill:'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(DEFAULT_SUPER_ADMIN.email);
                      setPassword(DEFAULT_SUPER_ADMIN.defaultPassword);
                      setError(null);
                    }}
                    className="px-2 py-1 rounded bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-stone-800 dark:text-slate-200 font-medium text-[11px] transition cursor-pointer"
                  >
                    Super Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('orders@kisholoy.com');
                      setPassword('Kisholoy@2026!');
                      setError(null);
                    }}
                    className="px-2 py-1 rounded bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-stone-800 dark:text-slate-200 font-medium text-[11px] transition cursor-pointer"
                  >
                    Order Mgr
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('finance@kisholoy.com');
                      setPassword('Kisholoy@2026!');
                      setError(null);
                    }}
                    className="px-2 py-1 rounded bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-stone-800 dark:text-slate-200 font-medium text-[11px] transition cursor-pointer"
                  >
                    Finance
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-900 hover:bg-teal-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold transition focus:outline-none focus:ring-2 focus:ring-teal-600/50 focus:ring-offset-2 dark:focus:ring-offset-slate-900 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading
                ? isBn ? 'যাচাই করা হচ্ছে…' : 'Verifying…'
                : isBn ? 'অ্যাডমিন প্যানেলে সাইন ইন করুন' : 'Sign In to Admin Panel'}
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-stone-200 dark:border-slate-700"></div>
              <span className="flex-shrink mx-3 text-[11px] text-stone-400 font-medium uppercase tracking-wider">
                {isBn ? 'অথবা' : 'Or'}
              </span>
              <div className="flex-grow border-t border-stone-200 dark:border-slate-700"></div>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-stone-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-stone-50 dark:hover:bg-slate-800 text-stone-700 dark:text-slate-200 text-xs font-semibold transition shadow-xs cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              {isBn ? 'গুগল দিয়ে স্টাফ সাইন-ইন' : 'Sign In with Google (Admin)'}
            </button>

            <div className="pt-2 border-t border-stone-200 dark:border-slate-800 flex items-center justify-between text-xs text-stone-500 dark:text-slate-400">
              <a
                href="/"
                className="text-teal-700 dark:text-teal-400 hover:underline flex items-center gap-1 font-medium"
              >
                ← {isBn ? 'মূল ওয়েবসাইটে ফিরে যান' : 'Back to Storefront'}
              </a>
              <span className="text-[10px]">Kisholoy Admin v2.2</span>
            </div>

            <p className="text-[10px] text-stone-500 dark:text-slate-500 leading-relaxed pt-1">
              {isBn
                ? 'প্রতিটি অ্যাডমিন কাজ সার্ভারে যাচাই ও অডিট করা হয়। শেয়ার্ড ডিভাইসে কাজ শেষে সাইন আউট করুন।'
                : 'Every admin action is verified and audited server-side. Sign out when using a shared device.'}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
