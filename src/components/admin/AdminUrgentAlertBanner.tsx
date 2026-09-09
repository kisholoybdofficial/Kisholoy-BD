import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ShieldAlert, Landmark, ArrowRight, X, ChevronRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function AdminUrgentAlertBanner() {
  const { orders, settlements, language } = useApp();
  const [dismissed, setDismissed] = useState(false);

  const isBn = language === 'BN';

  // Calculate urgent items
  const highRiskOrders = orders.filter(o => 
    o.fraudRisk && (o.fraudRisk.riskScore >= 60 || o.fraudRisk.riskRating === 'HIGH' || o.fraudRisk.riskRating === 'SUSPICIOUS')
  );
  
  const pendingSettlements = settlements.filter(s => s.status === 'PENDING' || s.status === 'INITIATED');

  if (dismissed || (highRiskOrders.length === 0 && pendingSettlements.length === 0)) {
    return null;
  }

  const hasFraud = highRiskOrders.length > 0;
  const hasSettlement = pendingSettlements.length > 0;

  return (
    <div
      id="admin-urgent-operational-banner"
      className="bg-rose-50/95 dark:bg-slate-900 border-b border-rose-200/90 dark:border-rose-900/50 px-3.5 sm:px-6 py-2 text-xs text-stone-900 dark:text-stone-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-2xs transition-colors animate-in fade-in duration-200"
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="flex h-2 w-2 relative shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        </span>
        
        <span className="font-bold text-rose-800 dark:text-rose-300 flex items-center gap-1.5 uppercase font-mono tracking-wider text-[11px] shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          {isBn ? 'জরুরি সতর্কতা:' : 'Urgent Alert:'}
        </span>

        <div className="text-stone-700 dark:text-stone-300 text-xs flex flex-wrap items-center gap-x-2">
          {hasFraud && (
            <span className="inline-flex items-center gap-1">
              🚨 <strong>{highRiskOrders.length}</strong> {isBn ? 'উচ্চ ঝুঁকিপূর্ণ অর্ডার' : 'High Fraud Risk order(s)'}
            </span>
          )}
          {hasSettlement && (
            <span className="inline-flex items-center gap-1">
              💰 <strong>{pendingSettlements.length}</strong> {isBn ? 'সেটেলমেন্ট অনুমোদন বাকি' : 'Settlement batch(es) pending'}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-end shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-rose-200/60 dark:border-rose-900/40">
        <div className="flex items-center gap-1.5">
          {hasFraud && (
            <Link
              to="/admin/fraud"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-900 border border-rose-300 dark:bg-rose-950/80 dark:hover:bg-rose-900 dark:text-rose-200 dark:border-rose-700/60 font-semibold text-[11px] transition-colors whitespace-nowrap"
            >
              <ShieldAlert className="w-3 h-3 text-rose-600 dark:text-rose-400" />
              <span>{isBn ? 'ফ্রড ড্যাশবোর্ড' : 'Review Fraud'}</span>
              <ChevronRight className="w-3 h-3" />
            </Link>
          )}

          {hasSettlement && (
            <Link
              to="/admin/finance"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:hover:bg-amber-900 dark:text-amber-200 dark:border-amber-700/60 font-semibold text-[11px] transition-colors whitespace-nowrap"
            >
              <Landmark className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              <span>{isBn ? 'সেটেলমেন্ট' : 'Payouts'}</span>
              <ChevronRight className="w-3 h-3" />
            </Link>
          )}
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="p-1 text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-lg hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors ml-auto sm:ml-1"
          title="Dismiss banner"
          aria-label="Dismiss banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
