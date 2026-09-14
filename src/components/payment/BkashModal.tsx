import React, { useEffect, useState } from 'react';
import { Smartphone, X, CheckCircle2, AlertCircle, ExternalLink, Loader2, ClipboardCopy } from 'lucide-react';

interface BkashModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId?: string;
  orderNumber: string;
  amount: number;
  customerPhone: string;
  onSuccess: (trxId: string) => void;
  onFailure: (reason: string) => void;
  /**
   * Called when the shopper submitted a Send-Money TrxID that still has to be
   * verified by a human. The order stays `PENDING` — this is NOT success.
   */
  onPendingManual?: (reference: string) => void;
  /** bKash personal/merchant number offered for Send Money, if configured. */
  manualNumber?: string;
}

type Phase = 'loading' | 'redirect' | 'unavailable' | 'rejected';

/**
 * bKash checkout hand-off.
 *
 * The previous version of this component was a simulation: three fake steps
 * (phone → OTP `123456` → PIN `12345`), invented a transaction id locally and
 * called `onSuccess`, so every order looked paid. There is no way for a browser
 * to authorise a payment, so the component now only ever does two things:
 *   1. ask the server to create a real bKash session and send the shopper to
 *      the gateway URL; or
 *   2. when the gateway is not configured, offer Send-Money + TrxID capture,
 *      which the server records as an *unverified* claim.
 */
export function BkashModal({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  amount,
  onSuccess,
  onFailure,
  onPendingManual,
  manualNumber,
}: BkashModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [message, setMessage] = useState('');
  const [trxId, setTrxId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPhase('loading');
    setGatewayUrl('');
    setPaymentId('');
    setMessage('');

    (async () => {
      try {
        const res = await fetch('/api/payments/bkash/create', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.ok && data?.success && data?.data?.bkashURL) {
          setGatewayUrl(String(data.data.bkashURL));
          setPaymentId(String(data.data.paymentID || ''));
          setPhase('redirect');
          return;
        }

        if (data?.code === 'PROVIDER_UNCONFIGURED' || data?.data?.configured === false) {
          setPhase('unavailable');
          setMessage(data?.error || data?.data?.statusMessage || 'bKash gateway is not connected on this store yet.');
          return;
        }

        setPhase('rejected');
        setMessage(data?.error || 'The payment session could not be started.');
      } catch {
        if (!cancelled) {
          setPhase('rejected');
          setMessage('Could not reach the payment service. Check your connection.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, orderId]);

  if (!isOpen) return null;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = trxId.trim().toUpperCase();
    if (clean.length < 6) {
      setMessage('Enter the full 8–12 character Transaction ID from your bKash receipt.');
      return;
    }
    setSubmitting(true);
    // Recorded for staff verification; the order remains payment-pending.
    onPendingManual?.(clean);
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 text-stone-900 dark:text-slate-100 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 bg-teal-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4" />
            <span className="text-xs font-semibold">bKash payment</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10 transition" aria-label="Close payment dialog">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-stone-500 dark:text-slate-400">Order</span>
            <span className="font-mono font-semibold">{orderNumber}</span>
          </div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-stone-500 dark:text-slate-400">Amount due</span>
            <span className="font-bold text-sm">৳{Number(amount).toLocaleString('en-IN')}</span>
          </div>

          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-xs text-stone-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Opening a secure bKash session…
            </div>
          )}

          {phase === 'redirect' && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-stone-600 dark:text-slate-300">
                Continue on bKash&apos;s own secure page to authorise this payment. Kisholoy never
                sees your PIN or OTP, and the order is only confirmed once bKash notifies us.
              </p>
              <a
                href={gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-teal-900 hover:bg-teal-950 text-white text-sm font-semibold transition"
              >
                <ExternalLink className="w-4 h-4" />
                Continue to bKash
              </a>
              <button
                type="button"
                onClick={() => onSuccess(paymentId || `BK_${orderNumber}`)}
                className="w-full py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition"
              >
                I have completed it — verify my payment
              </button>
              {paymentId && (
                <p className="text-[10px] text-stone-400 font-mono break-all text-center">Session: {paymentId}</p>
              )}
            </div>
          )}

          {phase === 'unavailable' && (
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Automatic bKash checkout is not connected on this store yet, so no payment can be
                  captured here. You can still order: pay by <strong>Send Money</strong> and send us the
                  Transaction ID, or choose <strong>Cash on Delivery</strong>.
                </span>
              </div>

              {manualNumber && (
                <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-stone-500">Send Money to</p>
                    <p className="font-mono text-sm font-bold">{manualNumber}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(manualNumber)}
                    className="p-2 rounded-lg text-stone-500 hover:bg-white hover:text-teal-800 border border-transparent hover:border-stone-200 transition"
                    aria-label="Copy bKash number"
                  >
                    <ClipboardCopy className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div>
                <label htmlFor="bkash-trxid" className="block text-xs font-semibold mb-1.5">
                  Transaction ID (TrxID)
                </label>
                <input
                  id="bkash-trxid"
                  value={trxId}
                  onChange={(e) => setTrxId(e.target.value)}
                  placeholder="e.g. 8F3A91KL"
                  autoComplete="off"
                  className="w-full px-3 py-2.5 rounded-xl border border-stone-300 bg-white text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-teal-600/40"
                />
              </div>

              {message && <p className="text-[11px] text-stone-500 leading-relaxed">{message}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-teal-900 hover:bg-teal-950 disabled:opacity-60 text-white text-sm font-semibold transition"
              >
                Submit for verification
              </button>
              <p className="text-[10px] text-stone-400 leading-relaxed">
                Your order will show <strong>Payment pending</strong> until our team confirms the TrxID.
              </p>
            </form>
          )}

          {phase === 'rejected' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{message}</span>
              </div>
              <button
                type="button"
                onClick={() => onFailure(message || 'bKash session failed')}
                className="w-full py-2.5 rounded-xl border border-stone-300 text-xs font-semibold hover:bg-stone-50 transition"
              >
                Back to payment methods
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-stone-50 dark:bg-slate-950/60 border-t border-stone-200 dark:border-slate-800">
          <p className="text-[10px] text-stone-500 dark:text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-teal-700" />
            Payment status is set only by bKash, never by this page.
          </p>
        </div>
      </div>
    </div>
  );
}

export default BkashModal;
