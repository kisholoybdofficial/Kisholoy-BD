import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, Store, Lock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { canAccessAdminRoute, isSuperAdmin, isAdminRole, Role } from '../../lib/auth';

interface RBACGuardProps {
  children: React.ReactNode;
  allowedRoles?: Role[];
  routePath?: string;
}

export function RBACGuard({ children, allowedRoles, routePath }: RBACGuardProps) {
  const { currentRole, language } = useApp();
  const location = useLocation();
  const isBn = language === 'BN';

  const path = routePath || location.pathname;

  // Non-admin roles (e.g. CUSTOMER, SUPPLIER) have zero access to admin modules
  if (!isAdminRole(currentRole)) {
    // block access
  } else if (isSuperAdmin(currentRole)) {
    // Super Admin can access everything
    return <>{children}</>;
  }

  let hasAccess = false;
  if (isAdminRole(currentRole)) {
    if (allowedRoles && allowedRoles.length > 0) {
      hasAccess = allowedRoles.includes(currentRole);
    } else {
      hasAccess = canAccessAdminRoute(currentRole, path);
    }
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[65vh] flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-stone-200 dark:border-slate-800 shadow-xl text-center space-y-5">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-sm">
          <ShieldAlert className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[11px] font-mono font-bold tracking-wide uppercase">
            <Lock className="w-3 h-3" />
            {isBn ? 'সীমাবদ্ধ অনুমতি' : 'Restricted Access'}
          </div>
          <h2 className="text-xl font-bold text-stone-900 dark:text-white font-serif">
            {isBn ? 'এই মডিউলে প্রবেশের অনুমতি নেই' : 'Administrative Permission Required'}
          </h2>
          <p className="text-xs text-stone-500 dark:text-slate-400 leading-relaxed">
            {isBn
              ? 'আপনার বর্তমান অ্যাকাউন্টের রোলের জন্য এই প্রশাসনিক বিভাগটি সুরক্ষিত করা হয়েছে।'
              : 'Your current administrative role does not have authorization to view or manage this section.'}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-slate-800/80 border border-stone-200 dark:border-slate-700 text-xs text-left space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-stone-500 dark:text-slate-400 font-medium">
              {isBn ? 'আপনার রোল:' : 'Your Role:'}
            </span>
            <span className="font-mono font-bold px-2 py-0.5 rounded bg-stone-200 dark:bg-slate-700 text-stone-800 dark:text-slate-200 text-[11px]">
              {currentRole}
            </span>
          </div>
          {allowedRoles && (
            <div className="flex items-center justify-between pt-1 border-t border-stone-200 dark:border-slate-700">
              <span className="text-stone-500 dark:text-slate-400 font-medium">
                {isBn ? 'অনুমোদিত রোলসমূহ:' : 'Allowed Roles:'}
              </span>
              <span className="font-mono text-[10px] text-teal-700 dark:text-teal-400 font-semibold">
                {allowedRoles.join(', ')}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Link
            to="/admin"
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-900 hover:bg-teal-800 text-white text-xs font-bold transition shadow-sm"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {isBn ? 'অ্যাডমিন ড্যাশবোর্ডে ফিরুন' : 'Back to Dashboard'}
          </Link>
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-stone-800 dark:text-slate-200 text-xs font-semibold transition"
          >
            <Store className="w-3.5 h-3.5" />
            {isBn ? 'লাইভ স্টোর' : 'Live Store'}
          </Link>
        </div>
      </div>
    </div>
  );
}
