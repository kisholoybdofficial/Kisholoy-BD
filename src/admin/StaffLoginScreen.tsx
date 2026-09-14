import React, { useEffect, useState } from 'react';
import { Lock, Mail, Eye, EyeOff, ShieldCheck, AlertCircle, Loader2, KeyRound, Smartphone } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BrandLogo } from '../components/brand/BrandLogo';
import { changeStaffPassword, fetchBootstrapState, loginStaff, requestStaffPasswordReset, confirmStaffPasswordReset } from '../lib/auth';
import { Role } from '../types';

interface StaffLoginScreenProps {
  onAuthenticated: (session: { role: Role; name: string; email: string; mustChangePassword?: boolean }) => void;
}

/**
 * Staff sign-in gate for the admin control plane.
 *
 * The previous screen displayed the super-admin email **and password** on the
 * login page, plus one-click "Instant Login" and per-role quick-fill buttons, and
 * it fell back to a client-side Google/Firebase path that the API never
 * verified. All of that is gone: credentials are only ever sent to
 * `POST /api/security/auth/login`, the server answers with an httpOnly session
 * cookie, and this component renders whatever state the server reports
 * (password, 2FA, forced change, reset).
 */
type Stage = 'credentials' | 'twofactor' | 'force-password' | 'reset';

export function StaffLoginScreen({ onAuthenticated }: StaffLoginScreenProps) {
  const { language, showToast } = useApp();
  const isBn = language === 'BN';

  const [stage, setStage] = useState<Stage>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<{ adminReady: boolean; hint: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBootstrapState()
      .then((state) => {
        if (!cancelled) setBootstrap(state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const runLogin = async (targetEmail: string, targetPassword: string, code?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await loginStaff(targetEmail.trim(), targetPassword, code);
      if (!result.success) {
        setError(result.errorBn && isBn ? result.errorBn : result.error || (isBn ? 'লগইন ব্যর্থ হয়েছে।' : 'Sign-in failed.'));
        if (result.code === 'MFA_REQUIRED') setStage('twofactor');
        if (result.retryAfterSeconds) {
          setNotice(
            isBn
              ? `অনেকবার চেষ্টা হয়েছে। ${result.retryAfterSeconds} সেকেন্ড পর আবার চেষ্টা করুন।`
              : `Too many attempts. Try again in ${result.retryAfterSeconds}s.`
          );
        }
        return false;
      }

      if (result.mustChangePassword) {
        setStage('force-password');
        setNotice(
          isBn
            ? 'আপনাকে অবশ্যই নতুন পাসওয়ার্ড সেট করতে হবে।'
            : 'You must set a new password before continuing.'
        );
        return false;
      }

      onAuthenticated({
        role: (result.user?.role || result.role || 'STAFF') as Role,
        name: result.user?.name || targetEmail.trim(),
        email: result.user?.email || targetEmail.trim(),
      });
      return true;
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stage === 'reset') {
      if (!email.trim() || !newPassword) {
        setError(isBn ? 'ইমেইল ও নতুন পাসওয়ার্ড দিন।' : 'Enter your email and a new password.');
        return;
      }
      if (!resetCode) {
        setError(isBn ? 'যাচাই কোডটি দিন।' : 'Enter the verification code.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const done = await confirmStaffPasswordReset(email.trim(), resetCode.trim(), newPassword);
        if (!done.success) {
          setError(done.error || (isBn ? 'কোডটি সঠিক নয়।' : 'That code was not accepted.'));
          return;
        }
        setNotice(isBn ? 'পাসওয়ার্ড বদলে গেছে—এখন লগইন করুন।' : 'Password reset. You can sign in now.');
        setStage('credentials');
        setPassword('');
        setResetCode('');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (stage === 'force-password') {
      if (newPassword !== confirmPassword) {
        setError(isBn ? 'নতুন পাসওয়ার্ড দুটি মিলছে না।' : 'The two passwords do not match.');
        return;
      }
      if (newPassword.length < 10) {
        setError(isBn ? 'পাসওয়ার্ড কমপক্ষে ১০ অক্ষরের হতে হবে।' : 'Use at least 10 characters.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const done = await changeStaffPassword(password, newPassword);
        if (!done.success) {
          setError(done.errorBn && isBn ? done.errorBn : done.error || (isBn ? 'পাসওয়ার্ড বদলানো যায়নি।' : 'Could not change the password.'));
          return;
        }
        // The change revoked other sessions and re-issued this one.
        onAuthenticated({ role: 'SUPER_ADMIN', name: email.trim(), email: email.trim() });
        showToast?.(isBn ? 'পাসওয়ার্ড হালনাগাদ হয়েছে।' : 'Password updated.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setError(isBn ? 'ইমেইল ও পাসওয়ার্ড দুটোই দিন।' : 'Please enter both email and password.');
      return;
    }
    await runLogin(email, password, stage === 'twofactor' ? totp.trim() : undefined);
  };

  const sendResetCode = async () => {
    if (!email.trim()) {
      setError(isBn ? 'আগে ইমেইল লিখুন।' : 'Enter your email first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const sent = await requestStaffPasswordReset(email.trim());
      if (!sent.success) {
        setError(sent.error || (isBn ? 'রিসেট কোড পাঠানো যায়নি।' : 'Could not send a reset code.'));
        return;
      }
      setStage('reset');
      setNotice(
        sent.devCode
          ? `${isBn ? 'ডেভেলপমেন্ট মোডে কোড:' : 'Development code:'} ${sent.devCode}`
          : isBn
            ? 'অ্যাকাউন্ট থাকলে ইমেইলে কোড পাঠানো হয়েছে।'
            : 'If the account exists, a code has been emailed.'
      );
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    'w-full pl-10 pr-3 py-2.5 text-sm rounded-lg border border-stone-300 dark:border-slate-700 ' +
    'bg-white dark:bg-slate-900 text-stone-900 dark:text-slate-100 ' +
    'focus:outline-none focus:ring-2 focus:ring-teal-600/40 focus:border-teal-700 transition';

  const titles: Record<Stage, { title: string; titleBn: string; sub: string; subBn: string }> = {
    credentials: {
      title: 'Staff Sign In',
      titleBn: 'স্টাফ সাইন ইন',
      sub: 'Kisholoy Admin Control Panel — authorised staff only',
      subBn: 'কিশলয় অ্যাডমিন কন্ট্রোল প্যানেল — অনুমোদিত কর্মী মাত্র',
    },
    twofactor: {
      title: 'Two-Factor Code',
      titleBn: 'টু-ফ্যাক্টর কোড',
      sub: 'Enter the 6-digit code from your authenticator app',
      subBn: 'আপনার অথেনটিকেটর অ্যাপের ৬ সংখ্যার কোডটি দিন',
    },
    'force-password': {
      title: 'Set a New Password',
      titleBn: 'নতুন পাসওয়ার্ড সেট করুন',
      sub: 'This account was created from deployment settings, so its password must be replaced',
      subBn: 'এই অ্যাকাউন্টটি ডিপ্লয়মেন্ট সেটিংস থেকে তৈরি, তাই পাসওয়ার্ড বদলাতে হবে',
    },
    reset: {
      title: 'Reset Password',
      titleBn: 'পাসওয়ার্ড রিসেট',
      sub: 'Enter the code we sent you and choose a new password',
      subBn: 'পাঠানো কোডটি দিন এবং নতুন পাসওয়ার্ড বেছে নিন',
    },
  };

  const copy = titles[stage];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-stone-100 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <BrandLogo variant="light" size="md" linkToHome={false} showTagline={false} />
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-stone-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-stone-200 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-900/60">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-teal-900 text-white shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h1 className="font-serif font-bold text-base text-stone-900 dark:text-white leading-tight">
                  {isBn ? copy.titleBn : copy.title}
                </h1>
                <p className="text-[11px] text-stone-500 dark:text-slate-400">{isBn ? copy.subBn : copy.sub}</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{error}</p>
              </div>
            )}

            {notice && (
              <div className="rounded-lg border border-teal-200 dark:border-teal-900/60 bg-teal-50 dark:bg-teal-950/30 px-3 py-2.5 text-xs text-teal-900 dark:text-teal-200 leading-relaxed">
                {notice}
              </div>
            )}

            {bootstrap && !bootstrap.adminReady && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 px-3 py-2.5 text-[11px] text-amber-900 dark:text-amber-200 leading-relaxed">
                {isBn
                  ? 'এই সিস্টেমে কোনো অ্যাডমিন অ্যাকাউন্ট নেই। ডিপ্লয়মেন্টের এনভায়রনমেন্ট ভেরিয়েবল দিয়ে প্রথম অ্যাডমিন তৈরি করুন।'
                  : 'No administrator account exists on this deployment yet. Create the first one through deployment environment variables (see docs/DEPLOYMENT.md).'}
              </div>
            )}

            {(stage === 'credentials' || stage === 'reset') && (
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
                    placeholder={isBn ? 'আপনার অফিসিয়াল ইমেইল' : 'you@kisholoy.com'}
                    className={inputCls}
                    required
                  />
                </div>
              </div>
            )}

            {(stage === 'credentials' || stage === 'force-password') && (
              <div>
                <label htmlFor="staff-password" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                  {isBn ? 'পাসওয়ার্ড' : 'Password'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="staff-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={stage === 'credentials' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputCls} pr-10`}
                    required={stage === 'credentials'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? (isBn ? 'পাসওয়ার্ড লুকান' : 'Hide password') : isBn ? 'পাসওয়ার্ড দেখান' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-600/40"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {stage === 'twofactor' && (
              <div>
                <label htmlFor="staff-totp" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                  {isBn ? '৬ সংখ্যার কোড' : '6-digit code'}
                </label>
                <div className="relative">
                  <Smartphone className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="staff-totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totp}
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className={`${inputCls} font-mono tracking-[0.4em] text-center`}
                    required
                  />
                </div>
              </div>
            )}

            {(stage === 'force-password' || stage === 'reset') && (
              <>
                <div>
                  <label htmlFor="staff-new-password" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                    {isBn ? 'নতুন পাসওয়ার্ড' : 'New password'}
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="staff-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={isBn ? 'কমপক্ষে ১০ অক্ষর, সংখ্যাসহ' : 'At least 10 characters with numbers'}
                      className={inputCls}
                      required
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="staff-confirm-password" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                    {isBn ? 'আবার লিখুন' : 'Confirm password'}
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="staff-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={inputCls}
                      required
                    />
                  </div>
                </div>
              </>
            )}

            {stage === 'reset' && (
              <div>
                <label htmlFor="staff-code" className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1.5">
                  {isBn ? 'যাচাই কোড' : 'Verification code'}
                </label>
                <input
                  id="staff-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                  className={`${inputCls} font-mono tracking-[0.3em]`}
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-900 hover:bg-teal-950 disabled:opacity-60 text-white font-semibold text-sm transition shadow-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {loading
                ? isBn
                  ? 'যাচাই হচ্ছে…'
                  : 'Verifying…'
                : stage === 'credentials'
                  ? isBn
                    ? 'সাইন ইন'
                    : 'Sign In'
                  : stage === 'twofactor'
                    ? isBn
                      ? 'কোড যাচাই করুন'
                      : 'Verify Code'
                    : stage === 'reset'
                      ? isBn
                        ? 'পাসওয়ার্ড রিসেট করুন'
                        : 'Reset Password'
                      : isBn
                        ? 'পাসওয়ার্ড সংরক্ষণ করুন'
                        : 'Save New Password'}
            </button>

            <div className="flex items-center justify-between text-[11px]">
              {stage === 'credentials' ? (
                <button
                  type="button"
                  onClick={sendResetCode}
                  disabled={loading}
                  className="text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer disabled:opacity-50"
                >
                  {isBn ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot password?'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStage('credentials');
                    setError(null);
                    setNotice(null);
                  }}
                  className="text-teal-700 dark:text-teal-400 hover:underline font-medium cursor-pointer"
                >
                  ← {isBn ? 'সাইন ইনে ফিরুন' : 'Back to sign in'}
                </button>
              )}
              <a href="/" className="text-stone-500 dark:text-slate-400 hover:underline">
                {isBn ? 'দোকানে ফিরে যান' : 'Back to storefront'}
              </a>
            </div>

            <p className="text-[10px] text-stone-500 dark:text-slate-500 leading-relaxed pt-1 border-t border-stone-200 dark:border-slate-800">
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

export default StaffLoginScreen;
