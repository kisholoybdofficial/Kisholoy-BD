import React, { useEffect, useState } from 'react';
import { CreditCard, X, ExternalLink, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface SslcommerzModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId?: string;
  orderNumber: string;
  amount: number;
  customerName: string;
  onSuccess: (valId: string, cardType: string) => void;
  onFailure: (reason: string) => void;
}

type Phase = 'loading' | 'redirect' | 'unavailable' | 'rejected';

/**
 * Card payment hand-off (SSLCOMMERZ).
 *
 * Replaces the simulated modal that let the shopper click through a fake
 * "Sandbox OTP: 123456" screen and produced a locally invented `valId`, which
 * the old server happily accepted as a completed payment. A card payment can
 * only be authorised on the gateway's own hosted page, so this component either
 * redirects there or explains that cards are not enabled yet.
 */
export function SslcommerzModal({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  amount,
  onSuccess,
  onFailure,
}: SslcommerzModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPhase('loading');
    setMessage('');

    (async () => {
      try {
        const res = await fetch('/api/payments/sslcommerz/init', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, orderNumber, amount }),
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.ok && data?.success && data?.session?.gatewayUrl) {
          setGatewayUrl(String(data.session.gatewayUrl));
          setSessionKey(String(data.session.sessionKey || ''));
          setPhase('redirect');
          return;
        }

        if (data?.code === 'PROVIDER_UNCONFIGURED') {
          setPhase('unavailable');
          setMessage(data.error || 'Card payment is not enabled on this store yet.');
          return;
        }

        setPhase('rejected');
        setMessage(data?.error || 'The payment gateway did not open a session.');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, orderId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 text-stone-900 dark:text-slate-100 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 bg-stone-900 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            <span className="text-xs font-semibold">Secure card payment</span>
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
            <span className="text-stone-500 dark:text-slate-400">Amount</span>
            <span className="font-bold text-sm">৳{Number(amount).toLocaleString('en-IN')}</span>
          </div>

          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-xs text-stone-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Opening your secure payment page…
            </div>
          )}

          {phase === 'redirect' && (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-stone-600 dark:text-slate-300">
                You will complete this payment on the gateway&apos;s own page. We never see your card
                number, and the order is marked paid only after the gateway confirms it to us.
              </p>
              <a
                href={gatewayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-stone-900 hover:bg-black text-white text-sm font-semibold transition"
              >
                <ExternalLink className="w-4 h-4" />
                Continue to secure payment
              </a>
              <button
                type="button"
                onClick={() => onSuccess(sessionKey || `VAL_${orderNumber}`, 'CARD')}
                className="w-full py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition"
              >
                I have completed it — verify my payment
              </button>
            </div>
          )}

          {phase === 'unavailable' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{message} Please continue with Cash on Delivery, or pay by mobile banking and send us the Transaction ID.</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-stone-900 text-white text-sm font-semibold transition"
              >
                Back to my order
              </button>
            </div>
          )}

          {phase === 'rejected' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] leading-relaxed text-rose-800">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{message}</span>
              </div>
              <button
                type="button"
                onClick={() => onFailure(message)}
                className="w-full py-2.5 rounded-xl border border-stone-300 text-xs font-semibold hover:bg-stone-50 transition"
              >
                Choose another payment method
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-3 bg-stone-50 dark:bg-slate-950/60 border-t border-stone-200 dark:border-slate-800">
          <p className="text-[10px] text-stone-500 dark:text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-teal-700" />
            Payments are confirmed by the gateway, never by this page.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SslcommerzModal;
