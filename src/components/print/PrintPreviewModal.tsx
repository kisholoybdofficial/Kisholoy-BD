/**
 * @file src/components/print/PrintPreviewModal.tsx
 * @description Standardized Print-Preview Modal for KISHOLOY.
 *   Leverages the existing unified Document & Print Engine to render official
 *   Mushak-6.3 Tax Invoices and Warehouse Packing Slips on an authentic
 *   on-screen paper canvas with zoom, language, and field controls before
 *   triggering the browser's native print dialog or generating a PDF.
 * @license Apache-2.0
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Printer,
  Download,
  X,
  FileText,
  Package,
  Layers,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Copy,
  Check,
  Loader2,
  SlidersHorizontal,
  Info,
  ChevronDown,
} from 'lucide-react';
import {
  Order,
  SiteContent,
  PrintOrderPayload,
  PrintDocumentType,
  PrintSettings,
  DocLanguage,
  DocPageFormat,
} from '../../types';
import { OrderDocumentTemplate } from './PrintTemplates';
import { buildOrderPdf, fetchOrderPrintPayload } from '../../lib/documentEngine';
import {
  PRINT_DOCUMENT_LABELS,
  PRINT_PAGE_FORMATS,
  defaultPrintSettings,
} from '../../lib/printFormats';
import { useApp } from '../../context/AppContext';
import { toBanglaDigits } from '../../utils/invoiceUtils';

export interface PrintPreviewModalProps {
  order: Order;
  siteContent?: SiteContent;
  initialDocType?: 'INVOICE' | 'PACKING_SLIP' | 'BOTH';
  onClose: () => void;
  onPrintSuccess?: () => void;
}

const A4_PX = Math.round(210 * (96 / 25.4)); // 794px

export function PrintPreviewModal({
  order,
  siteContent: propSiteContent,
  initialDocType = 'INVOICE',
  onClose,
  onPrintSuccess,
}: PrintPreviewModalProps) {
  const { siteContent: contextSiteContent, language: appLanguage } = useApp();
  const siteContent = propSiteContent || contextSiteContent;
  const isBn = appLanguage === 'BN';

  // Active document view tab
  const [activeTab, setActiveTab] = useState<'INVOICE' | 'PACKING_SLIP' | 'BOTH'>(initialDocType);

  // Zoom controls: 0.6 to 1.4
  const [zoom, setZoom] = useState<number>(0.95);
  const [fitWidth, setFitWidth] = useState<boolean>(false);

  // Server payload & codes
  const [payload, setPayload] = useState<PrintOrderPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // PDF Generation state
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);
  const [pdfProgress, setPdfProgress] = useState<string>('');

  // Quick action state
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [showOptionsDropdown, setShowOptionsDropdown] = useState<boolean>(false);

  // Document language & field customizer overrides for this print preview
  const [docLanguage, setDocLanguage] = useState<DocLanguage>('BILINGUAL');
  const [showBarcodes, setShowBarcodes] = useState<boolean>(true);
  const [showQRs, setShowQRs] = useState<boolean>(true);
  const [pageFormat, setPageFormat] = useState<DocPageFormat>('A4');

  const previewContainerRef = useRef<HTMLDivElement>(null);

  // Default fallback codes while server payload loads
  const fallbackCodes = useMemo(() => {
    const tracking = order.courier?.trackingId || order.orderNumber;
    return {
      barcodes: {
        order: order.orderNumber,
        tracking,
        invoice: order.orderNumber.replace('ORD-', 'INV-'),
        payment: `PAY-${order.id.slice(-6).toUpperCase()}`,
      },
      qrs: {
        order: `https://kisholoy.com/track-order?ref=${order.orderNumber}`,
        tracking: `https://kisholoy.com/track-order?ref=${tracking}`,
        invoice: `https://kisholoy.com/track-order?ref=${order.orderNumber}&doc=invoice`,
        payment: `https://kisholoy.com/track-order?ref=${order.orderNumber}&doc=payment`,
      },
    };
  }, [order]);

  // Load authoritative server payload (real SVG/PNG barcodes and QR codes)
  const loadPrintPayload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const serverPayload = await fetchOrderPrintPayload(order.orderNumber);
      setPayload(serverPayload);
      if (serverPayload.settings?.documents?.INVOICE?.language) {
        setDocLanguage(serverPayload.settings.documents.INVOICE.language);
      }
    } catch (err: any) {
      // Fallback silently without blocking user
      console.warn('Could not fetch server-rendered codes, using standard client barcodes:', err);
    } finally {
      setLoading(false);
    }
  }, [order.orderNumber]);

  useEffect(() => {
    loadPrintPayload();
  }, [loadPrintPayload]);

  // Merge active settings with real-time UI overrides
  const effectiveSettings: PrintSettings = useMemo(() => {
    const base = payload?.settings || defaultPrintSettings();
    const updatedDocs = { ...base.documents };

    const docTypes: PrintDocumentType[] = ['INVOICE', 'PACKING_SLIP', 'PAYMENT_RECEIPT', 'COURIER_LABEL'];
    for (const dt of docTypes) {
      if (updatedDocs[dt]) {
        updatedDocs[dt] = {
          ...updatedDocs[dt],
          language: docLanguage,
          showBarcode: showBarcodes,
          showQR: showQRs,
          pageFormat,
        };
      }
    }

    return {
      ...base,
      documents: updatedDocs,
    };
  }, [payload?.settings, docLanguage, showBarcodes, showQRs, pageFormat]);

  const activeCodes = payload?.codes || fallbackCodes;

  // Selected document types for current view
  const documentsToRender: PrintDocumentType[] = useMemo(() => {
    if (activeTab === 'INVOICE') return ['INVOICE'];
    if (activeTab === 'PACKING_SLIP') return ['PACKING_SLIP'];
    return ['INVOICE', 'PACKING_SLIP'];
  }, [activeTab]);

  // Keyboard shortcut listener: ESC to close, Ctrl/Cmd+P to trigger native print
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleNativePrint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, documentsToRender, effectiveSettings]);

  // Trigger the browser's native print dialog
  const handleNativePrint = () => {
    const prevTitle = document.title;
    const docLabel =
      activeTab === 'INVOICE'
        ? 'Invoice'
        : activeTab === 'PACKING_SLIP'
        ? 'PackingSlip'
        : 'OrderDocs';
    document.title = `KISHOLOY_${docLabel}_${order.orderNumber}`;

    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.title = prevTitle;
        onPrintSuccess?.();
      }, 600);
    }, 60);
  };

  // Trigger standardized PDF generation
  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    setPdfProgress(isBn ? 'পিডিএফ তৈরি হচ্ছে…' : 'Compiling PDF document…');
    setError(null);
    try {
      const printablePayload: PrintOrderPayload = payload || {
        order,
        documents: documentsToRender.map((t) => ({
          type: t,
          label: PRINT_DOCUMENT_LABELS[t]?.en || t,
          labelBn: PRINT_DOCUMENT_LABELS[t]?.bn || t,
          pageFormat: effectiveSettings.documents[t]?.pageFormat || 'A4',
          enabledByDefault: true,
          active: true,
          reason: 'Print preview request',
        })),
        settings: effectiveSettings,
        codes: activeCodes,
        siteContent,
      };

      const res = await buildOrderPdf(printablePayload, documentsToRender, (msg) => {
        setPdfProgress(msg);
      });

      if (!res.ok) {
        setError(res.error || (isBn ? 'পিডিএফ তৈরি ব্যর্থ হয়েছে' : 'PDF generation failed'));
      }
    } catch (err: any) {
      setError(err?.message || (isBn ? 'পিডিএফ সংরক্ষণ ত্রুটি' : 'PDF save error'));
    } finally {
      setGeneratingPdf(false);
      setPdfProgress('');
    }
  };

  // Copy concise WhatsApp / SMS invoice summary to clipboard
  const handleCopySummary = () => {
    const itemLines = order.items
      .map((it) => `• ${it.title} (${it.quantity}x) - ৳${(it.price * it.quantity).toLocaleString('en-BD')}`)
      .join('\n');
    const summary = `🛒 KISHOLOY ORDER INVOICE
Order No: ${order.orderNumber}
Customer: ${order.customer.name} (${order.customer.phone})
Address: ${order.shippingAddress.address}, ${order.shippingAddress.thana}, ${order.shippingAddress.district}
Items:
${itemLines}
Subtotal: ৳${order.subtotal.toLocaleString('en-BD')}
Delivery: ৳${(order.shippingFee ?? 0).toLocaleString('en-BD')}
${order.discount ? `Discount: -৳${order.discount.toLocaleString('en-BD')}\n` : ''}Total Amount: ৳${order.total.toLocaleString('en-BD')}
Payment: ${order.paymentMethod} (${order.paymentStatus})
Courier Tracking: ${order.courier?.trackingId || 'Pending dispatch'}`;

    navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  // Adjust zoom levels
  const handleZoomIn = () => setZoom((z) => Math.min(1.3, Math.round((z + 0.1) * 10) / 10));
  const handleZoomOut = () => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10));
  const handleResetZoom = () => {
    setZoom(0.95);
    setFitWidth(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-preview-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-stone-950/80 backdrop-blur-xs kisholoy-print-overlay overflow-y-auto"
    >
      {/* Modal Card Window */}
      <div className="bg-white dark:bg-stone-900 rounded-2xl w-full max-w-6xl h-[94vh] flex flex-col overflow-hidden shadow-2xl border border-stone-200 dark:border-stone-800 kisholoy-print-chrome transition-all">
        {/* ========================================================= */}
        {/* 1. TOP HEADER & DOCUMENT SELECTOR BAR (Non-Printable)     */}
        {/* ========================================================= */}
        <header className="px-4 py-3 bg-stone-900 text-white flex flex-wrap items-center justify-between gap-3 border-b border-stone-800 no-print">
          {/* Document Title & Order Info */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-teal-800/80 text-teal-300 rounded-xl flex-shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="print-preview-modal-title" className="text-sm font-bold font-serif tracking-tight truncate">
                  {isBn ? 'প্রিন্ট প্রিভিউ ও চালান ডেক্স' : 'Standardized Print Preview'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-teal-900 text-teal-200 border border-teal-700/50">
                  {order.orderNumber}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    order.paymentStatus === 'PAID'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  {order.paymentMethod} • {order.paymentStatus}
                </span>
              </div>
              <p className="text-[11px] text-stone-400 truncate">
                {order.customer.name} ({order.customer.phone}) • {order.shippingAddress.district}
              </p>
            </div>
          </div>

          {/* Center Tabs: INVOICE vs PACKING SLIP vs BOTH */}
          <nav
            id="print-preview-doc-tabs"
            aria-label="Document Type Selection"
            className="flex items-center bg-stone-800/90 p-1 rounded-xl border border-stone-700/60"
          >
            <button
              id="tab-invoice"
              type="button"
              onClick={() => setActiveTab('INVOICE')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'INVOICE'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-stone-300 hover:text-white hover:bg-stone-700/50'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{isBn ? 'চালান (Invoice)' : 'Invoice'}</span>
            </button>

            <button
              id="tab-packing-slip"
              type="button"
              onClick={() => setActiveTab('PACKING_SLIP')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'PACKING_SLIP'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-stone-300 hover:text-white hover:bg-stone-700/50'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>{isBn ? 'প্যাকিং স্লিপ' : 'Packing Slip'}</span>
            </button>

            <button
              id="tab-both"
              type="button"
              onClick={() => setActiveTab('BOTH')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'BOTH'
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'text-stone-300 hover:text-white hover:bg-stone-700/50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{isBn ? 'উভয় নথি (Both)' : 'Both (2-in-1)'}</span>
            </button>
          </nav>

          {/* Right Action & Close Buttons */}
          <div className="flex items-center gap-2">
            <button
              id="btn-close-print-preview"
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-white hover:bg-stone-800 rounded-lg transition-colors"
              title={isBn ? 'বন্ধ করুন (Esc)' : 'Close preview (Esc)'}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* ========================================================= */}
        {/* 2. SUB-TOOLBAR: ZOOM, LANGUAGE, PRINT & DOWNLOAD ACTIONS  */}
        {/* ========================================================= */}
        <div className="px-4 py-2.5 bg-stone-100 dark:bg-stone-850 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2.5 no-print text-xs">
          {/* Left Toolbar: Language & Display Options */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Language Switcher */}
            <div className="flex items-center bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setDocLanguage('BILINGUAL')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                  docLanguage === 'BILINGUAL'
                    ? 'bg-stone-900 dark:bg-stone-700 text-white'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900'
                }`}
              >
                {isBn ? 'দ্বিভাষিক' : 'Bilingual'}
              </button>
              <button
                type="button"
                onClick={() => setDocLanguage('BN')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                  docLanguage === 'BN'
                    ? 'bg-stone-900 dark:bg-stone-700 text-white'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900'
                }`}
              >
                বাংলা
              </button>
              <button
                type="button"
                onClick={() => setDocLanguage('EN')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                  docLanguage === 'EN'
                    ? 'bg-stone-900 dark:bg-stone-700 text-white'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900'
                }`}
              >
                English
              </button>
            </div>

            {/* Page Format Badge */}
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-stone-700 dark:text-stone-300 text-[11px] font-medium">
              <Info className="w-3.5 h-3.5 text-stone-400" />
              <span>{pageFormat === 'A4' ? 'A4 Portrait (210×297mm)' : pageFormat}</span>
            </span>

            {/* Quick Toggle Dropdown / Panel for Barcodes & QR */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowOptionsDropdown(!showOptionsDropdown)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-700 dark:text-stone-300 text-[11px] font-semibold hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span>{isBn ? 'ফিল্ড সেটিংস' : 'Field Toggles'}</span>
                <ChevronDown className="w-3 h-3 text-stone-400" />
              </button>

              {showOptionsDropdown && (
                <div className="absolute left-0 mt-1 w-56 p-3 bg-white dark:bg-stone-800 rounded-xl shadow-xl border border-stone-200 dark:border-stone-700 z-30 space-y-2">
                  <div className="text-[11px] font-bold text-stone-800 dark:text-stone-200 pb-1 border-b border-stone-100 dark:border-stone-700">
                    {isBn ? 'প্রিন্ট কনফিগারেশন' : 'Print Configuration'}
                  </div>
                  <label className="flex items-center justify-between text-xs text-stone-700 dark:text-stone-300 cursor-pointer">
                    <span>{isBn ? 'বারকোড দেখান' : 'Show Barcode'}</span>
                    <input
                      type="checkbox"
                      checked={showBarcodes}
                      onChange={(e) => setShowBarcodes(e.target.checked)}
                      className="rounded text-teal-600 focus:ring-teal-500"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-stone-700 dark:text-stone-300 cursor-pointer">
                    <span>{isBn ? 'কিউআর কোড দেখান' : 'Show QR Code'}</span>
                    <input
                      type="checkbox"
                      checked={showQRs}
                      onChange={(e) => setShowQRs(e.target.checked)}
                      className="rounded text-teal-600 focus:ring-teal-500"
                    />
                  </label>
                  <div className="pt-1 border-t border-stone-100 dark:border-stone-700 text-[10px] text-stone-500">
                    {isBn
                      ? 'পরিবর্তন সরাসরি প্রিভিউ এবং ব্রাউজার প্রিন্টে কার্যকর হবে'
                      : 'Applies immediately to on-screen preview and print'}
                  </div>
                </div>
              )}
            </div>

            {/* Copy Summary for WhatsApp */}
            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-700 dark:text-stone-300 text-[11px] font-semibold hover:bg-stone-50 dark:hover:bg-stone-750 transition-colors"
              title={isBn ? 'কাস্টমার মেসেজের জন্য কপি করুন' : 'Copy summary for WhatsApp message'}
            >
              {copiedSummary ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                    {isBn ? 'কপি হয়েছে' : 'Copied!'}
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-stone-500" />
                  <span>{isBn ? 'সারাংশ কপি' : 'Copy Text'}</span>
                </>
              )}
            </button>
          </div>

          {/* Center/Right Toolbar: Zoom & Main Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Zoom Controls */}
            <div className="flex items-center bg-white dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg px-1 py-0.5">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.6}
                className="p-1 text-stone-600 dark:text-stone-300 hover:text-stone-900 disabled:opacity-30"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-mono text-[11px] font-bold text-stone-800 dark:text-stone-200 select-none">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 1.3}
                className="p-1 text-stone-600 dark:text-stone-300 hover:text-stone-900 disabled:opacity-30"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="p-1 ml-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 border-l border-stone-200 dark:border-stone-700"
                title="Reset zoom"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>

            {/* Fit Width Toggle */}
            <button
              type="button"
              onClick={() => setFitWidth(!fitWidth)}
              className={`p-1.5 rounded-lg border text-xs transition-colors ${
                fitWidth
                  ? 'bg-stone-900 dark:bg-stone-700 text-white border-stone-900'
                  : 'bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-300 dark:border-stone-700 hover:bg-stone-50'
              }`}
              title={fitWidth ? 'Exit fit width' : 'Fit page to preview width'}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>

            {/* Secondary Action: Download PDF */}
            <button
              id="btn-download-pdf"
              type="button"
              onClick={handleDownloadPdf}
              disabled={generatingPdf}
              className="px-3 py-1.5 bg-stone-200 hover:bg-stone-300 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-900 dark:text-stone-100 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-60"
            >
              {generatingPdf ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 dark:text-teal-400" />
                  <span>{pdfProgress || (isBn ? 'ডাউনলোড হচ্ছে…' : 'Downloading…')}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-stone-700 dark:text-stone-300" />
                  <span>{isBn ? 'পিডিএফ ডাউনলোড' : 'Download PDF'}</span>
                </>
              )}
            </button>

            {/* PRIMARY ACTION: TRIGGER BROWSER NATIVE PRINT DIALOG */}
            <button
              id="btn-trigger-browser-print"
              type="button"
              onClick={handleNativePrint}
              className="px-4 py-1.5 bg-teal-800 hover:bg-teal-900 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Printer className="w-4 h-4 text-teal-200" />
              <span>{isBn ? 'প্রিন্ট করুন (Print)' : 'Print Document'}</span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.2 text-[9px] bg-teal-950/60 rounded text-teal-300 font-mono">
                ⌘P
              </kbd>
            </button>
          </div>
        </div>

        {/* Error notification banner if any */}
        {error && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between no-print">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-bold underline text-[11px]"
            >
              {isBn ? 'বন্ধ করুন' : 'Dismiss'}
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. AUTHENTIC ON-SCREEN PAPER PREVIEW CANVAS              */}
        {/* ========================================================= */}
        <div
          ref={previewContainerRef}
          className="flex-1 overflow-auto bg-stone-200/80 dark:bg-stone-950 p-4 sm:p-8 flex justify-center items-start"
        >
          {/* Printable Surface (Isolated during native window.print()) */}
          <div
            className="kisholoy-print-surface transition-transform duration-150 origin-top mx-auto"
            style={{
              width: fitWidth ? '100%' : `${A4_PX}px`,
              maxWidth: fitWidth ? '100%' : `${A4_PX}px`,
              transform: fitWidth ? 'none' : `scale(${zoom})`,
              transformOrigin: 'top center',
            }}
          >
            {documentsToRender.map((docType, index) => (
              <div
                key={docType}
                className="kisholoy-print-page bg-white text-stone-900 shadow-xl border border-stone-300 dark:border-stone-700 rounded-sm mb-8 last:mb-0 overflow-hidden"
                style={{
                  minHeight: `${Math.round(297 * (96 / 25.4))}px`, // approx 1122px (standard A4)
                  pageBreakAfter: index < documentsToRender.length - 1 ? 'always' : 'auto',
                }}
              >
                {/* Visual watermark / document marker for multi-page */}
                <div className="sr-only">
                  {docType === 'INVOICE' ? 'Mushak-6.3 Commercial Tax Invoice' : 'Warehouse Packaging Slip'}
                </div>

                <OrderDocumentTemplate
                  type={docType}
                  order={order}
                  siteContent={siteContent}
                  settings={effectiveSettings}
                  codes={activeCodes}
                  pageWidthPx={A4_PX}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ========================================================= */}
        {/* 4. BOTTOM STATUS STRIP                                    */}
        {/* ========================================================= */}
        <footer className="px-4 py-2 bg-stone-100 dark:bg-stone-900 border-t border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between text-[11px] text-stone-500 no-print">
          <div className="flex items-center gap-2">
            <span>
              {isBn
                ? `পৃষ্ঠা বিন্যাস: ${documentsToRender.length} টি নথি • এ৪ প্রতিকৃতি (A4 Portrait)`
                : `Ready to print: ${documentsToRender.length} document(s) • A4 Portrait`}
            </span>
            {loading && (
              <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{isBn ? 'বারকোড সিঙ্ক হচ্ছে…' : 'Syncing live codes…'}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              {isBn
                ? 'টিপস: ব্রাউজারের প্রিন্ট ডায়ালগে "Save as PDF" নির্বাচন করতে পারেন'
                : 'Tip: Select "Save as PDF" in the browser print dialog for instant digital archiving'}
            </span>
          </div>
        </footer>
      </div>

      {/* ========================================================= */}
      {/* 5. DEDICATED PRINT STYLESHEET (Native Browser Isolation)   */}
      {/* ========================================================= */}
      <style>{`
        @media print {
          /* Global cleanup for print dialog */
          html, body {
            background: #ffffff !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* Hide entire application and backdrop chrome */
          body * {
            visibility: hidden !important;
          }

          /* Isolate and display only the print surface */
          .kisholoy-print-surface,
          .kisholoy-print-surface * {
            visibility: visible !important;
          }

          .kisholoy-print-surface {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
            max-width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
            transform: none !important;
            background: #ffffff !important;
          }

          /* Reset page styling for physical paper */
          .kisholoy-print-page {
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            page-break-after: always !important;
            break-after: page !important;
          }

          .kisholoy-print-page:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }

          .no-print,
          .kisholoy-print-chrome,
          .kisholoy-print-overlay,
          header,
          footer,
          nav,
          aside {
            display: none !important;
          }

          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }

          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}
