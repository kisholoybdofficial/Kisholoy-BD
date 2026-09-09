import React, { useState } from 'react';
import { Settings, Save, CheckCircle2, DollarSign, Truck, Percent, Smartphone, Eye } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PrintSettingsPanel } from '../components/print/PrintSettingsPanel';
import { ApiIntegrationsPanel } from '../components/admin/ApiIntegrationsPanel';
import { useAdminTactile } from '../context/AdminTactileContext';

export function SettingsAdmin() {
  const { siteContent, updateSiteContent, showToast, orders, language } = useApp();
  const { showTouchTargetOverlays, toggleTouchTargetOverlays, detectedTargetsCount } = useAdminTactile();
  const isBn = language === 'BN';
  const [fees, setFees] = useState(siteContent.shippingFees);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSiteContent({
      ...siteContent,
      shippingFees: fees
    });
    showToast(isBn ? 'শিপিং ও মূল্যের কনফিগারেশন সংরক্ষিত হয়েছে!' : 'Store logistics and pricing configurations saved!');
  };

  return (
    <div role="region" aria-label="Store settings" className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-900">{isBn ? 'স্টোর সেটিংস ও ডেলিভারি চার্জ' : 'Store Settings & Logistic Rates'}</h1>
          <p className="text-xs text-stone-500">{isBn ? 'শিপিং জোন, ফ্রি ডেলিভারির সীমা, ভ্যাট শতাংশ ও মুদ্রার ফরম্যাট নির্ধারণ করুন।' : 'Configure shipping zones, free delivery thresholds, VAT percentage, and currency formatting.'}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-stone-200 shadow-xs p-6 space-y-6 text-xs">
        <h3 className="text-sm font-bold text-stone-900 uppercase tracking-wider flex items-center gap-2">
          <Truck className="w-4 h-4 text-teal-900" />
          {isBn ? 'বাংলাদেশের অভ্যন্তরীণ শিপিং রেট' : 'Domestic Bangladesh Shipping Rates'}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="font-bold text-stone-700 block mb-1">{isBn ? 'ঢাকা সিটির ভেতরে ডেলিভারি চার্জ (৳)' : 'Inside Dhaka City Delivery Charge (৳)'}</label>
            <input
              type="number"
              required
              value={fees.insideDhaka}
              onChange={(e) => setFees({ ...fees, insideDhaka: Number(e.target.value) })}
              className="w-full p-2.5 border border-stone-300 rounded-lg"
            />
          </div>

          <div>
            <label className="font-bold text-stone-700 block mb-1">{isBn ? 'ঢাকার উপশহর (গাজীপুর, সাভার, নারায়ণগঞ্জ) (৳)' : 'Dhaka Suburbs (Gazipur, Savar, Narayanganj) (৳)'}</label>
            <input
              type="number"
              required
              value={fees.subDhaka}
              onChange={(e) => setFees({ ...fees, subDhaka: Number(e.target.value) })}
              className="w-full p-2.5 border border-stone-300 rounded-lg"
            />
          </div>

          <div>
            <label className="font-bold text-stone-700 block mb-1">{isBn ? 'ঢাকার বাইরে / সারাদেশ কুরিয়ার (৳)' : 'Outside Dhaka / Nationwide Courier (৳)'}</label>
            <input
              type="number"
              required
              value={fees.outsideDhaka}
              onChange={(e) => setFees({ ...fees, outsideDhaka: Number(e.target.value) })}
              className="w-full p-2.5 border border-stone-300 rounded-lg"
            />
          </div>

          <div>
            <label className="font-bold text-stone-700 block mb-1">{isBn ? 'ফ্রি শিপিং পাওয়ার ন্যূনতম অর্ডার (৳)' : 'Free Shipping Qualification Threshold (৳)'}</label>
            <input
              type="number"
              required
              value={fees.freeShippingThreshold}
              onChange={(e) => setFees({ ...fees, freeShippingThreshold: Number(e.target.value) })}
              className="w-full p-2.5 border border-stone-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-stone-200">
          <button
            type="submit"
            className="px-6 py-2.5 bg-teal-900 text-white rounded-lg font-bold hover:bg-teal-950 flex items-center gap-2 shadow-xs"
          >
            <Save className="w-4 h-4" /> {isBn ? 'কনফিগারেশন সংরক্ষণ করুন' : 'Save Logistics Configuration'}
          </button>
        </div>
      </form>

      {/* Live Production Cloud Infrastructure & API Integrations */}
      <ApiIntegrationsPanel />

      {/* Unified Document & Print Engine Settings */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-xs p-6">
        <PrintSettingsPanel orders={orders} siteContent={siteContent} />
      </div>

      {/* Dev-Only Diagnostic & Accessibility Tooling */}
      <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-stone-100 dark:border-stone-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                {isBn ? 'ডেভেলপার টুল' : 'DEV ONLY'}
              </span>
              <h3 className="text-sm font-bold text-stone-900 dark:text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-sky-600" />
                {isBn ? 'স্পর্শ লক্ষ্য ও রিপল বাউন্ডিং বক্স ওভারলে' : 'Touch Target & Ripple Bounding Box Overlay'}
              </h3>
            </div>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-2xl">
              {isBn 
                ? 'মোবাইল ও ট্যাবলেট স্পর্শযোগ্যতার সুবিধার্থে যেসকল উপাদানগুলিতে স্পর্শ রিপল/স্কেল ইভেন্ট সক্রিয় রয়েছে সেগুলোতে বাউন্ডিং বক্স ও পরিমাপ ওভারলে প্রদর্শন করুন।'
                : 'Overlays visual bounding boxes on all interactive elements (buttons, links, dialog actions) that have tactile ripple-event listeners attached for easier debugging and auditing of touch target areas (recommended min 44×44px).'}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {showTouchTargetOverlays && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                {detectedTargetsCount} {isBn ? 'উপাদান' : 'targets active'}
              </span>
            )}

            <button
              type="button"
              id="toggle-touch-target-overlay"
              role="switch"
              aria-checked={showTouchTargetOverlays}
              onClick={toggleTouchTargetOverlays}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${
                showTouchTargetOverlays ? 'bg-sky-600' : 'bg-stone-300 dark:bg-stone-700'
              }`}
            >
              <span className="sr-only">
                {isBn ? 'স্পর্শ লক্ষ্য ওভারলে টগল করুন' : 'Toggle touch target overlays'}
              </span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  showTouchTargetOverlays ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-xs">
          <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-850 border border-stone-200 dark:border-stone-800 flex items-start gap-2.5">
            <span className="w-3 h-3 mt-0.5 rounded border-2 border-dashed border-sky-600 bg-sky-100/50 shrink-0" />
            <div>
              <p className="font-bold text-stone-800 dark:text-stone-200">{isBn ? 'নীল ড্যাশড বক্স' : 'Cyan Dashed Box'}</p>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">{isBn ? 'রিপল লিসেনার সংযুক্ত সক্রিয় বাটন ও অ্যাকশন' : 'Interactive element with ripple listener attached'}</p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-850 border border-stone-200 dark:border-stone-800 flex items-start gap-2.5">
            <span className="w-3 h-3 mt-0.5 rounded border-2 border-dashed border-amber-500 bg-amber-100/50 shrink-0" />
            <div>
              <p className="font-bold text-stone-800 dark:text-stone-200">{isBn ? 'হলুদ সতর্কবার্তা' : 'Amber Warning'}</p>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">{isBn ? 'লক্ষ্যমাত্রা ৪৪px-এর চেয়ে ছোট (<44px)' : 'Touch target area is below 44px minimum'}</p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-850 border border-stone-200 dark:border-stone-800 flex items-start gap-2.5">
            <Eye className="w-3.5 h-3.5 mt-0.5 text-stone-500 shrink-0" />
            <div>
              <p className="font-bold text-stone-800 dark:text-stone-200">{isBn ? 'মোডাল ও ড্রয়ার সাপোর্ট' : 'Modal & Overlay Support'}</p>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">{isBn ? 'ডায়ালগ ও নিশ্চিতকরণ উইন্ডোতেও রিয়েলটাইম কার্যকর' : 'Includes dialog overlays, filters and quick-view panels'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
