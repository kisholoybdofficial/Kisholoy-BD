import React, { useState, useMemo } from 'react';
import { 
  Warehouse, Package, Boxes, TrendingUp, TrendingDown, 
  AlertTriangle, CheckCircle2, ArrowUpDown, Plus, Minus, 
  Search, Filter, Download, QrCode, Truck, FileText, 
  RefreshCw, ShieldCheck, History, Sparkles, Clock, 
  ArrowRight, Trash2, Layers, Building2, HelpCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Product, InventoryTransaction, BatchRestockItem } from '../types';
import { AdminModalShell } from '../components/admin/AdminModalShell';

export function InventoryAdmin() {
  const { 
    products, 
    categories,
    inventoryTransactions, 
    adjustInventory, 
    batchRestock, 
    refreshProducts,
    language, 
    currentRole 
  } = useApp();

  const isBn = language === 'BN';

  // Active Main View Tab
  const [activeTab, setActiveTab] = useState<'LEDGER' | 'PO_WIZARD' | 'TRANSACTIONS' | 'FORECAST'>('LEDGER');

  // Warehouse filter
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('ALL');

  // Search & Filter for Ledger
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [stockLevelFilter, setStockLevelFilter] = useState<'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'>('ALL');

  // Adjustment Modal State
  const [adjustModalProduct, setAdjustModalProduct] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(10);
  const [adjustType, setAdjustType] = useState<'ADD' | 'DEDUCT'>('ADD');
  const [adjustReason, setAdjustReason] = useState('Supplier Batch Restock');
  const [adjustWarehouse, setAdjustWarehouse] = useState('Tejgaon Central Fulfillment Hub, Dhaka');
  const [adjustBatchNo, setAdjustBatchNo] = useState('');
  const [adjustUnitCost, setAdjustUnitCost] = useState<number>(0);
  const [adjustNote, setAdjustNote] = useState('');
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);

  // Barcode Modal State
  const [barcodeProduct, setBarcodeProduct] = useState<Product | null>(null);

  // Transaction Ledger Filters
  const [txTypeFilter, setTxTypeFilter] = useState<string>('ALL');
  const [txSearchQuery, setTxSearchQuery] = useState('');

  // PO Restock Intake Form State
  const [poSupplier, setPoSupplier] = useState('Sonargaon Heritage Jamdani Artisans');
  const [poInvoiceNo, setPoInvoiceNo] = useState(`PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
  const [poWarehouse, setPoWarehouse] = useState('Tejgaon Central Fulfillment Hub, Dhaka');
  const [poNotes, setPoNotes] = useState('');
  const [poItems, setPoItems] = useState<BatchRestockItem[]>([
    {
      productId: products[0]?.id || 'prod-1',
      sku: products[0]?.sku || 'KSH-JAM-001',
      productTitle: products[0]?.title || 'Handcrafted Jamdani Saree',
      quantity: 10,
      unitCost: products[0]?.costPrice || Math.round((products[0]?.price || 10000) * 0.6),
      batchNumber: `LOT-${new Date().getFullYear()}-01`
    }
  ]);
  const [isSubmittingPO, setIsSubmittingPO] = useState(false);
  const [poSuccessMessage, setPoSuccessMessage] = useState<string | null>(null);

  // Computed Inventory KPIs
  const inventoryStats = useMemo(() => {
    let totalUnitsOnHand = 0;
    let retailValuationBdt = 0;
    let costValuationBdt = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    products.forEach(p => {
      totalUnitsOnHand += p.stock;
      const cost = p.costPrice || (p.price * 0.6);
      retailValuationBdt += (p.price * p.stock);
      costValuationBdt += (cost * p.stock);

      const threshold = p.lowStockThreshold ?? 5;
      if (p.stock === 0) {
        outOfStockCount++;
      } else if (p.stock <= threshold) {
        lowStockCount++;
      }
    });

    const grossMarginBdt = Math.max(0, retailValuationBdt - costValuationBdt);
    const grossMarginPct = retailValuationBdt > 0 ? ((grossMarginBdt / retailValuationBdt) * 100).toFixed(1) : '0';

    return {
      totalSkus: products.length,
      totalUnitsOnHand,
      retailValuationBdt,
      costValuationBdt,
      grossMarginBdt,
      grossMarginPct,
      lowStockCount,
      outOfStockCount
    };
  }, [products]);

  // Filtered Products for Ledger Table
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesSearch = 
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.titleBn && p.titleBn.toLowerCase().includes(searchQuery.toLowerCase())) ||
        p.sku.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = categoryFilter === 'ALL' || p.category === categoryFilter;

      let matchesStock = true;
      const threshold = p.lowStockThreshold ?? 5;
      if (stockLevelFilter === 'IN_STOCK') matchesStock = p.stock > threshold;
      else if (stockLevelFilter === 'LOW_STOCK') matchesStock = p.stock > 0 && p.stock <= threshold;
      else if (stockLevelFilter === 'OUT_OF_STOCK') matchesStock = p.stock === 0;

      return matchesSearch && matchesCategory && matchesStock;
    });
  }, [products, searchQuery, categoryFilter, stockLevelFilter]);

  // Filtered Transactions
  const filteredTransactions = useMemo(() => {
    return inventoryTransactions.filter(tx => {
      const matchesSearch = 
        tx.sku.toLowerCase().includes(txSearchQuery.toLowerCase()) ||
        tx.productTitle.toLowerCase().includes(txSearchQuery.toLowerCase()) ||
        tx.reason.toLowerCase().includes(txSearchQuery.toLowerCase()) ||
        tx.operator.toLowerCase().includes(txSearchQuery.toLowerCase());
      
      const matchesType = txTypeFilter === 'ALL' || tx.type === txTypeFilter;

      return matchesSearch && matchesType;
    });
  }, [inventoryTransactions, txSearchQuery, txTypeFilter]);

  // Open Adjust Modal
  const handleOpenAdjustModal = (product: Product) => {
    setAdjustModalProduct(product);
    setAdjustQty(5);
    setAdjustType('ADD');
    setAdjustReason('Supplier Batch Restock');
    setAdjustWarehouse('Tejgaon Central Fulfillment Hub, Dhaka');
    setAdjustBatchNo(`LOT-${new Date().getFullYear()}-${Math.floor(10 + Math.random() * 90)}`);
    setAdjustUnitCost(product.costPrice || Math.round(product.price * 0.6));
    setAdjustNote('');
  };

  // Submit Single Adjustment
  const handleSubmitAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalProduct) return;

    setIsSubmittingAdjust(true);
    const finalChange = adjustType === 'ADD' ? Math.abs(adjustQty) : -Math.abs(adjustQty);

    await adjustInventory(
      adjustModalProduct.id,
      finalChange,
      `${adjustReason}: ${adjustNote || 'Manual stock reconciliation'}`,
      {
        warehouseLocation: adjustWarehouse,
        batchNumber: adjustBatchNo,
        notes: adjustNote,
        unitCost: adjustUnitCost
      }
    );

    await refreshProducts();
    setIsSubmittingAdjust(false);
    setAdjustModalProduct(null);
  };

  // Add line item to PO
  const handleAddPoItem = () => {
    const defaultProd = products[0];
    if (!defaultProd) return;
    setPoItems(prev => [
      ...prev,
      {
        productId: defaultProd.id,
        sku: defaultProd.sku,
        productTitle: defaultProd.title,
        quantity: 10,
        unitCost: defaultProd.costPrice || Math.round(defaultProd.price * 0.6),
        batchNumber: `LOT-${new Date().getFullYear()}-${prev.length + 1}`
      }
    ]);
  };

  const handleUpdatePoItem = (index: number, updates: Partial<BatchRestockItem>) => {
    setPoItems(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
      const updated = { ...item, ...updates };
      if (updates.productId) {
        const prod = products.find(p => p.id === updates.productId);
        if (prod) {
          updated.sku = prod.sku;
          updated.productTitle = prod.title;
          if (!updates.unitCost) {
            updated.unitCost = prod.costPrice || Math.round(prod.price * 0.6);
          }
        }
      }
      return updated;
    }));
  };

  const handleRemovePoItem = (index: number) => {
    setPoItems(prev => prev.filter((_, idx) => idx !== index));
  };

  // Submit Batch PO
  const handleSubmitPO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (poItems.length === 0) return;

    setIsSubmittingPO(true);
    const success = await batchRestock({
      supplier: poSupplier,
      invoiceNumber: poInvoiceNo,
      warehouseLocation: poWarehouse,
      items: poItems,
      notes: poNotes
    });

    if (success) {
      await refreshProducts();
      setPoSuccessMessage(
        isBn 
          ? `পারচেজ অর্ডার ${poInvoiceNo} সফলভাবে গৃহীত ও লেজারে লিপিবদ্ধ হয়েছে!` 
          : `Purchase Order ${poInvoiceNo} successfully received & logged to ledger!`
      );
      // Reset PO form
      setPoInvoiceNo(`PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
      setPoNotes('');
      setTimeout(() => {
        setPoSuccessMessage(null);
        setActiveTab('LEDGER');
      }, 2000);
    }
    setIsSubmittingPO(false);
  };

  // Export Stock Ledger as CSV
  const handleExportCSV = () => {
    const headers = ['SKU', 'Product Title', 'Category', 'Retail Price (BDT)', 'Unit Cost (BDT)', 'Stock On Hand', 'Stock Valuation (BDT)', 'Status'];
    const rows = products.map(p => [
      `"${p.sku}"`,
      `"${p.title.replace(/"/g, '""')}"`,
      `"${p.category}"`,
      p.price,
      p.costPrice || Math.round(p.price * 0.6),
      p.stock,
      p.price * p.stock,
      p.stock === 0 ? 'OUT_OF_STOCK' : (p.stock <= (p.lowStockThreshold ?? 5) ? 'LOW_STOCK' : 'OPTIMAL')
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `kisholoy_stock_ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header & Global Warehouse Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-teal-900 text-white rounded-xl shadow-xs">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-serif font-bold text-stone-900 dark:text-white">
                {isBn ? 'ইনভেন্টরি ও স্টক লেজার' : 'Inventory & Stock Ledger'}
              </h1>
              <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
                {isBn 
                  ? 'গুদামভিত্তিক মজুদ পর্যবেক্ষণ, পিও ব্যাচ গ্রহণ ও নিরীক্ষাযোগ্য স্টক সমন্বয়।' 
                  : 'Multi-warehouse physical inventory, automated safety stocks, and auditable ledger movements.'}
              </p>
            </div>
          </div>
        </div>

        {/* Global Warehouse Selection & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-stone-100 dark:bg-slate-900 p-1.5 rounded-xl border border-stone-200 dark:border-slate-700 text-xs">
            <Building2 className="w-4 h-4 text-stone-600 dark:text-slate-400 ml-1.5" />
            <select
              value={selectedWarehouse}
              onChange={(e) => setSelectedWarehouse(e.target.value)}
              className="bg-transparent font-medium text-stone-800 dark:text-slate-200 border-none outline-none pr-2 cursor-pointer"
            >
              <option value="ALL" className="dark:bg-slate-800">{isBn ? 'সকল আঞ্চলিক হাব (জাতীয়)' : 'All Regional Hubs (National)'}</option>
              <option value="DAC-01" className="dark:bg-slate-800">Tejgaon Central Hub (Dhaka)</option>
              <option value="CTG-02" className="dark:bg-slate-800">Agrabad Regional Hub (Chittagong)</option>
              <option value="SYL-03" className="dark:bg-slate-800">Zindabazar Hub (Sylhet)</option>
            </select>
          </div>

          <button
            onClick={() => setActiveTab('PO_WIZARD')}
            className="flex items-center gap-2 px-4 py-2 bg-teal-900 hover:bg-teal-950 dark:bg-teal-700 dark:hover:bg-teal-600 text-white rounded-xl font-bold text-xs shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isBn ? 'নতুন পিও স্টক ইন' : 'Batch PO Restock (+)'}</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white dark:bg-slate-800 hover:bg-stone-50 dark:hover:bg-slate-700 border border-stone-300 dark:border-slate-600 text-stone-700 dark:text-slate-200 rounded-xl font-bold text-xs transition-colors"
            title="Download CSV Audit"
          >
            <Download className="w-3.5 h-3.5 text-stone-500 dark:text-slate-400" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Stock on Hand */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-500 dark:text-slate-400 uppercase tracking-wider">
              {isBn ? 'মোট মজুদ ইউনিট' : 'Total Stock on Hand'}
            </span>
            <div className="p-2 bg-amber-50 dark:bg-amber-950/40 rounded-xl text-amber-700 dark:text-amber-400">
              <Package className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-stone-900 dark:text-white">
              {inventoryStats.totalUnitsOnHand.toLocaleString()}
            </span>
            <span className="text-xs text-stone-500 dark:text-slate-400 font-medium">units</span>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-slate-500">
            {isBn ? `মোট ${inventoryStats.totalSkus}টি সক্রিয় পণ্যের মধ্যে` : `Across ${inventoryStats.totalSkus} active artisan SKUs`}
          </p>
        </div>

        {/* Retail Inventory Valuation */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-500 dark:text-slate-400 uppercase tracking-wider">
              {isBn ? 'খুচরা মূল্যায়ন (৳)' : 'Retail Valuation'}
            </span>
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl text-emerald-700 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-mono font-bold text-emerald-950 dark:text-emerald-300">
              ৳{inventoryStats.retailValuationBdt.toLocaleString()}
            </span>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-slate-500">
            {isBn ? `ক্রয়মূল্য: ৳${inventoryStats.costValuationBdt.toLocaleString()}` : `Cost basis: ৳${inventoryStats.costValuationBdt.toLocaleString()}`}
          </p>
        </div>

        {/* Gross Inventory Margin */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-500 dark:text-slate-400 uppercase tracking-wider">
              {isBn ? 'প্রত্যাশিত মোট মার্জিন' : 'Expected Margin'}
            </span>
            <div className="p-2 bg-teal-50 dark:bg-teal-950/40 rounded-xl text-teal-700 dark:text-teal-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-teal-900 dark:text-teal-300">
              {inventoryStats.grossMarginPct}%
            </span>
            <span className="text-xs text-teal-700 dark:text-teal-400 font-mono">
              (৳{inventoryStats.grossMarginBdt.toLocaleString()})
            </span>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-slate-500">
            {isBn ? 'আর্টিসান ফেয়ার ট্রেড প্রাইসিং মার্জিন' : 'Artisan fair trade pricing margin'}
          </p>
        </div>

        {/* Critical & Low Stock */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-500 dark:text-slate-400 uppercase tracking-wider">
              {isBn ? 'পুনঃঅর্ডার প্রয়োজন' : 'Low Stock Alerts'}
            </span>
            <div className="p-2 bg-rose-50 dark:bg-rose-950/40 rounded-xl text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold text-rose-600 dark:text-rose-400">
              {inventoryStats.lowStockCount + inventoryStats.outOfStockCount}
            </span>
            <span className="text-xs text-rose-500 dark:text-rose-400 font-medium">
              ({inventoryStats.outOfStockCount} {isBn ? 'মজুদহীন' : 'out of stock'})
            </span>
          </div>
          <p className="text-[11px] text-stone-400 dark:text-slate-500">
            {isBn ? 'তাৎক্ষণিক পুনর্ভরণ প্রয়োজন' : 'Immediate weaver restock needed'}
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-stone-200 dark:border-slate-700 gap-6 text-xs font-bold overflow-x-auto pb-px">
        <button
          onClick={() => setActiveTab('LEDGER')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'LEDGER'
              ? 'border-teal-900 dark:border-teal-400 text-teal-900 dark:text-teal-400'
              : 'border-transparent text-stone-500 dark:text-slate-400 hover:text-stone-800 dark:hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>{isBn ? 'স্টক লেজার ও ক্যাটালগ' : 'Stock Ledger & Catalog'}</span>
          <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-slate-700 text-stone-600 dark:text-slate-300 text-[10px] font-mono">
            {products.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('PO_WIZARD')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'PO_WIZARD'
              ? 'border-teal-900 dark:border-teal-400 text-teal-900 dark:text-teal-400'
              : 'border-transparent text-stone-500 dark:text-slate-400 hover:text-stone-800 dark:hover:text-slate-200'
          }`}
        >
          <Plus className="w-4 h-4" />
          <span>{isBn ? 'ব্যাচ পিও রিস্টক উইজার্ড' : 'Batch PO Restock Wizard'}</span>
        </button>

        <button
          onClick={() => setActiveTab('TRANSACTIONS')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'TRANSACTIONS'
              ? 'border-teal-900 dark:border-teal-400 text-teal-900 dark:text-teal-400'
              : 'border-transparent text-stone-500 dark:text-slate-400 hover:text-stone-800 dark:hover:text-slate-200'
          }`}
        >
          <History className="w-4 h-4" />
          <span>{isBn ? 'নিরীক্ষাযোগ্য স্টক চলাচল' : 'Movement & Audit Trail'}</span>
          <span className="px-2 py-0.5 rounded-full bg-stone-100 dark:bg-slate-700 text-stone-600 dark:text-slate-300 text-[10px] font-mono">
            {inventoryTransactions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('FORECAST')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'FORECAST'
              ? 'border-teal-900 dark:border-teal-400 text-teal-900 dark:text-teal-400'
              : 'border-transparent text-stone-500 dark:text-slate-400 hover:text-stone-800 dark:hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>{isBn ? 'পুনঃঅর্ডার পূর্বাভাস' : 'Safety Stock & Forecasting'}</span>
        </button>
      </div>

      {/* TAB 1: Stock Ledger & Catalog */}
      {activeTab === 'LEDGER' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex-1 w-full relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder={isBn ? 'নাম বা SKU দিয়ে খুঁজুন...' : 'Search by product title, Bengali name, or SKU...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-900"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              {/* Dynamic Categories Dropdown */}
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-medium text-stone-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="ALL">{isBn ? 'সকল ক্যাটাগরি' : 'All Categories'}</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name} className="dark:bg-slate-800">
                    {isBn ? (c.nameBn || c.name) : c.name}
                  </option>
                ))}
              </select>

              <select
                value={stockLevelFilter}
                onChange={(e) => setStockLevelFilter(e.target.value as any)}
                className="px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-medium text-stone-700 dark:text-slate-200 cursor-pointer"
              >
                <option value="ALL" className="dark:bg-slate-800">{isBn ? 'সকল স্টক মাত্রা' : 'All Stock Levels'}</option>
                <option value="IN_STOCK" className="dark:bg-slate-800">{isBn ? 'পর্যাপ্ত মজুদ (> থ্রেশহোল্ড)' : 'Optimal Stock (> threshold)'}</option>
                <option value="LOW_STOCK" className="dark:bg-slate-800">{isBn ? 'স্বল্প মজুদ (ঘাটতি)' : 'Low Stock (Critical)'}</option>
                <option value="OUT_OF_STOCK" className="dark:bg-slate-800">{isBn ? 'মজুদ শূন্য (০)' : 'Out of Stock (0)'}</option>
              </select>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-100/75 dark:bg-slate-900/80 text-stone-600 dark:text-slate-300 font-bold uppercase tracking-wider border-b border-stone-200 dark:border-slate-700">
                  <tr>
                    <th className="p-4">{isBn ? 'SKU / পণ্য' : 'SKU / Item'}</th>
                    <th className="p-4">{isBn ? 'ক্যাটাগরি' : 'Category'}</th>
                    <th className="p-4">{isBn ? 'খুচরা (৳) / ব্যয়' : 'Retail (৳) / Cost'}</th>
                    <th className="p-4">{isBn ? 'হাতে মজুদ' : 'Stock on Hand'}</th>
                    <th className="p-4">{isBn ? 'উপলব্ধ' : 'Available'}</th>
                    <th className="p-4">{isBn ? 'প্রধান হাব' : 'Primary Hub'}</th>
                    <th className="p-4">{isBn ? 'অবস্থা' : 'Status'}</th>
                    <th className="p-4 text-right">{isBn ? 'অ্যাকশন' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-slate-700">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-stone-400 dark:text-slate-500">
                        {isBn ? 'কোনো পণ্য পাওয়া যায়নি।' : 'No products match the selected filters.'}
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map((product) => {
                      const costPrice = product.costPrice || Math.round(product.price * 0.6);
                      const threshold = product.lowStockThreshold ?? 5;
                      const isLowStock = product.stock > 0 && product.stock <= threshold;
                      const isOutOfStock = product.stock === 0;

                      return (
                        <tr key={product.id} className="hover:bg-stone-50/75 dark:hover:bg-slate-700/40 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={product.images[0] || 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&q=80&w=200'}
                                alt={product.title}
                                className="w-11 h-11 rounded-xl object-cover border border-stone-200 dark:border-slate-700 shrink-0"
                              />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-stone-900 dark:text-white bg-stone-100 dark:bg-slate-900 px-2 py-0.5 rounded text-[11px] border border-stone-200 dark:border-slate-700">
                                    {product.sku}
                                  </span>
                                  {product.featured && (
                                    <span className="text-[10px] bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded font-bold border border-amber-200 dark:border-amber-800">
                                      Featured
                                    </span>
                                  )}
                                </div>
                                <p className="font-bold text-stone-900 dark:text-white mt-1 line-clamp-1">
                                  {product.title}
                                </p>
                                {product.titleBn && (
                                  <p className="text-[11px] text-stone-500 dark:text-slate-400 font-bangla line-clamp-1">
                                    {product.titleBn}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="p-4 text-stone-600 dark:text-slate-300 font-medium">
                            {product.category}
                          </td>

                          <td className="p-4 font-mono">
                            <div className="font-bold text-stone-900 dark:text-white">৳{product.price.toLocaleString()}</div>
                            <div className="text-[10px] text-stone-400 dark:text-slate-500">Cost: ৳{costPrice.toLocaleString()}</div>
                          </td>

                          <td className="p-4 font-mono font-bold text-stone-900 dark:text-white text-sm">
                            {product.stock} <span className="text-xs font-normal text-stone-400 dark:text-slate-500">units</span>
                          </td>

                          <td className="p-4 font-mono text-stone-700 dark:text-slate-300">
                            {Math.max(0, product.stock - 1)} <span className="text-[10px] text-stone-400 dark:text-slate-500">avail</span>
                          </td>

                          <td className="p-4 text-stone-500 dark:text-slate-400 text-[11px]">
                            Tejgaon Hub (WH-DAC-01)
                          </td>

                          <td className="p-4">
                            {isOutOfStock ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 text-[11px] font-bold border border-rose-200 dark:border-rose-800">
                                <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" /> {isBn ? 'মজুদ শূন্য' : 'Out of Stock'}
                              </span>
                            ) : isLowStock ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 text-[11px] font-bold border border-amber-200 dark:border-amber-800">
                                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" /> {isBn ? `স্বল্প মজুদ (${product.stock})` : `Low Stock (${product.stock})`}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold border border-emerald-200 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> {isBn ? 'পর্যাপ্ত মজুদ' : 'Optimal Stock'}
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setBarcodeProduct(product)}
                                className="p-1.5 text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                title="Generate Barcode / SKU Tag"
                              >
                                <QrCode className="w-4 h-4" />
                              </button>

                              <button
                                onClick={() => handleOpenAdjustModal(product)}
                                className="px-3 py-1.5 bg-stone-900 dark:bg-slate-700 hover:bg-black dark:hover:bg-slate-600 text-white rounded-lg font-bold text-xs shadow-2xs transition-colors flex items-center gap-1"
                              >
                                <ArrowUpDown className="w-3 h-3" />
                                <span>{isBn ? 'সমন্বয়' : 'Adjust'}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Batch Purchase Order (PO) Intake Wizard */}
      {activeTab === 'PO_WIZARD' && (
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-6">
          <div className="border-b border-stone-200 dark:border-slate-700 pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-serif font-bold text-stone-900 dark:text-white">
                {isBn ? 'ব্যাচ পারচেজ অর্ডার (PO) স্টক ইনটেক' : 'Batch Purchase Order (PO) Stock Intake'}
              </h2>
              <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
                {isBn 
                  ? 'চালান ট্র্যাকিং ও লেজার আপডেটের সাথে কারিগর গিল্ড থেকে বাল্ক পণ্য গ্রহণ।' 
                  : 'Record multi-item bulk delivery from artisan guilds with invoice tracking and atomic ledger updates.'}
              </p>
            </div>
            <span className="px-3 py-1 bg-teal-50 dark:bg-teal-950/50 text-teal-900 dark:text-teal-300 text-xs font-mono font-bold rounded-lg border border-teal-200 dark:border-teal-800">
              Audit-Enforced
            </span>
          </div>

          {poSuccessMessage && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-3 text-emerald-900 dark:text-emerald-300 text-xs font-bold">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{poSuccessMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmitPO} className="space-y-6">
            {/* Header info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1">
                  {isBn ? 'আর্টিসান গিল্ড / সরবরাহকারী *' : 'Artisan Guild / Supplier *'}
                </label>
                <select
                  value={poSupplier}
                  onChange={(e) => setPoSupplier(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-xs font-medium text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-900"
                >
                  <option value="Sonargaon Heritage Jamdani Artisans" className="dark:bg-slate-800">Sonargaon Heritage Jamdani Artisans (Narayanganj)</option>
                  <option value="Cumilla Terracotta Pottery Collective" className="dark:bg-slate-800">Cumilla Terracotta Pottery Collective</option>
                  <option value="Sundarbans Wild Honey Harvesters Cooperative" className="dark:bg-slate-800">Sundarbans Wild Honey Harvesters Cooperative</option>
                  <option value="Hazaribagh Leather Craftsmen Guild" className="dark:bg-slate-800">Hazaribagh Leather Craftsmen Guild</option>
                  <option value="Tangail Silk Handloom Masters" className="dark:bg-slate-800">Tangail Silk Handloom Masters</option>
                  <option value="Rajshahi Silk Board Certified Weavers" className="dark:bg-slate-800">Rajshahi Silk Board Certified Weavers</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1">
                  {isBn ? 'পিও / ইনভয়েস রেফারেন্স #' : 'PO / Invoice Ref # *'}
                </label>
                <input
                  type="text"
                  required
                  value={poInvoiceNo}
                  onChange={(e) => setPoInvoiceNo(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-stone-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1">
                  {isBn ? 'গ্রহণকারী ফুলফিলমেন্ট হাব *' : 'Receiving Fulfillment Hub *'}
                </label>
                <select
                  value={poWarehouse}
                  onChange={(e) => setPoWarehouse(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-xs font-medium text-stone-900 dark:text-white"
                >
                  <option value="Tejgaon Central Fulfillment Hub, Dhaka" className="dark:bg-slate-800">Tejgaon Central Fulfillment Hub, Dhaka (WH-DAC-01)</option>
                  <option value="Chittagong Agrabad Regional Hub" className="dark:bg-slate-800">Chittagong Agrabad Regional Hub (WH-CTG-02)</option>
                  <option value="Sylhet Zindabazar Hub" className="dark:bg-slate-800">Sylhet Zindabazar Hub (WH-SYL-03)</option>
                </select>
              </div>
            </div>

            {/* Multi-item Line Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-700 dark:text-slate-300 uppercase tracking-wider">
                  {isBn ? `গ্রহণের জন্য লাইন আইটেম (${poItems.length})` : `Line Items for Receiving (${poItems.length})`}
                </span>
                <button
                  type="button"
                  onClick={handleAddPoItem}
                  className="px-3 py-1 bg-stone-100 dark:bg-slate-700 hover:bg-stone-200 dark:hover:bg-slate-600 text-stone-800 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isBn ? 'নতুন লাইন যোগ করুন' : 'Add SKU Line'}</span>
                </button>
              </div>

              <div className="border border-stone-200 dark:border-slate-700 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 dark:bg-slate-900 text-stone-600 dark:text-slate-300 font-bold uppercase tracking-wider border-b border-stone-200 dark:border-slate-700">
                    <tr>
                      <th className="p-3 w-1/3">{isBn ? 'পণ্য / SKU' : 'Target SKU / Product'}</th>
                      <th className="p-3 w-28">{isBn ? 'পরিমাণ (+)' : 'Quantity (+)'}</th>
                      <th className="p-3 w-36">{isBn ? 'একক মূল্য (৳)' : 'Unit Cost (৳)'}</th>
                      <th className="p-3 w-36">{isBn ? 'লট ব্যাচ #' : 'Lot Batch #'}</th>
                      <th className="p-3">{isBn ? 'লাইন মূল্যায়ন' : 'Line Valuation'}</th>
                      <th className="p-3 text-right">{isBn ? 'মুছুন' : 'Remove'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 dark:divide-slate-700">
                    {poItems.map((item, index) => (
                      <tr key={index} className="hover:bg-stone-50 dark:hover:bg-slate-700/40">
                        <td className="p-3">
                          <select
                            value={item.productId}
                            onChange={(e) => handleUpdatePoItem(index, { productId: e.target.value })}
                            className="w-full p-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-xs font-medium text-stone-900 dark:text-white"
                          >
                            {products.map(p => (
                              <option key={p.id} value={p.id} className="dark:bg-slate-800">
                                [{p.sku}] {p.title} (Stock: {p.stock})
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="p-3">
                          <input
                            type="number"
                            min="1"
                            required
                            value={item.quantity}
                            onChange={(e) => handleUpdatePoItem(index, { quantity: Number(e.target.value) })}
                            className="w-full p-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-xs font-mono font-bold text-stone-900 dark:text-white"
                          />
                        </td>

                        <td className="p-3">
                          <input
                            type="number"
                            min="0"
                            required
                            value={item.unitCost}
                            onChange={(e) => handleUpdatePoItem(index, { unitCost: Number(e.target.value) })}
                            className="w-full p-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-xs font-mono text-stone-900 dark:text-white"
                          />
                        </td>

                        <td className="p-3">
                          <input
                            type="text"
                            value={item.batchNumber || ''}
                            onChange={(e) => handleUpdatePoItem(index, { batchNumber: e.target.value })}
                            className="w-full p-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-lg text-xs font-mono text-stone-600 dark:text-slate-300"
                            placeholder="LOT-2026-01"
                          />
                        </td>

                        <td className="p-3 font-mono font-bold text-stone-900 dark:text-white">
                          ৳{(item.quantity * item.unitCost).toLocaleString()}
                        </td>

                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemovePoItem(index)}
                            disabled={poItems.length <= 1}
                            className="p-1.5 text-stone-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes & Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-stone-50 dark:bg-slate-900 p-4 rounded-xl border border-stone-200 dark:border-slate-700">
              <div>
                <label className="block text-xs font-bold text-stone-700 dark:text-slate-300 mb-1">
                  {isBn ? 'আর্টিসান কোয়ালিটি কন্ট্রোল ও যাচাই নোট' : 'Artisan Quality Control Notes & Verification'}
                </label>
                <textarea
                  rows={3}
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  placeholder={isBn ? 'লুম ওয়ার্কশপ থেকে প্রাপ্ত পণ্য মান যাচাইপূর্বক গৃহীত হয়েছে...' : 'e.g. Received directly from Sonargaon loom workshop. Thread count and natural dyes inspected and approved by QC officer.'}
                  className="w-full p-2.5 bg-white dark:bg-slate-800 border border-stone-300 dark:border-slate-700 rounded-xl text-xs text-stone-900 dark:text-white"
                />
              </div>

              <div className="flex flex-col justify-center space-y-2 text-xs">
                <div className="flex justify-between text-stone-600 dark:text-slate-400">
                  <span>{isBn ? 'মোট ইনটেক ইউনিট:' : 'Total Intake Units:'}</span>
                  <span className="font-mono font-bold text-stone-900 dark:text-white">
                    {poItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)} units
                  </span>
                </div>
                <div className="flex justify-between text-stone-600 dark:text-slate-400">
                  <span>{isBn ? 'মোট পিও ব্যয় মূল্যায়ন:' : 'Total PO Cost Valuation:'}</span>
                  <span className="font-mono font-bold text-stone-900 dark:text-white text-sm">
                    ৳{poItems.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitCost) || 0)), 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-teal-800 dark:text-teal-400 font-bold border-t border-stone-200 dark:border-slate-700 pt-2">
                  <span>{isBn ? 'অপারেটর স্বাক্ষর:' : 'Operator Signature:'}</span>
                  <span className="font-mono">{currentRole}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('LEDGER')}
                className="px-5 py-2.5 bg-stone-100 dark:bg-slate-700 text-stone-800 dark:text-slate-200 rounded-xl font-bold text-xs hover:bg-stone-200 dark:hover:bg-slate-600"
              >
                {isBn ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmittingPO}
                className="px-6 py-2.5 bg-teal-900 hover:bg-teal-950 dark:bg-teal-700 dark:hover:bg-teal-600 text-white rounded-xl font-bold text-xs shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmittingPO ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isBn ? 'প্রক্রিয়াধীন...' : 'Processing Intake...'}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isBn ? 'নিশ্চিত করুন ও পিও গ্রহণ করুন' : 'Confirm & Execute PO Intake'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: Immutable Stock Audit & Movement Trail */}
      {activeTab === 'TRANSACTIONS' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex-1 w-full relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder={isBn ? 'SKU, কারণ বা অপারেটর দিয়ে খুঁজুন...' : 'Filter audit trail by SKU, reason, or operator...'}
                value={txSearchQuery}
                onChange={(e) => setTxSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs text-stone-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-900"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={txTypeFilter}
                onChange={(e) => setTxTypeFilter(e.target.value)}
                className="px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs font-medium text-stone-700 dark:text-slate-200"
              >
                <option value="ALL" className="dark:bg-slate-800">{isBn ? 'সকল মুভমেন্ট ধরণ' : 'All Movement Types'}</option>
                <option value="STOCK_IN" className="dark:bg-slate-800">STOCK_IN (Intake / PO)</option>
                <option value="SALE" className="dark:bg-slate-800">SALE (Order Checkout)</option>
                <option value="RETURN" className="dark:bg-slate-800">RETURN (RMA Restock)</option>
                <option value="DAMAGE" className="dark:bg-slate-800">DAMAGE (Scrap / QC)</option>
                <option value="ADJUSTMENT" className="dark:bg-slate-800">ADJUSTMENT (Audit)</option>
                <option value="RESERVATION" className="dark:bg-slate-800">RESERVATION (Locked)</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-stone-100/75 dark:bg-slate-900/80 text-stone-600 dark:text-slate-300 font-bold uppercase tracking-wider border-b border-stone-200 dark:border-slate-700">
                  <tr>
                    <th className="p-4">{isBn ? 'সময়' : 'Timestamp'}</th>
                    <th className="p-4">{isBn ? 'SKU / পণ্য' : 'SKU / Product'}</th>
                    <th className="p-4">{isBn ? 'ধরণ' : 'Type'}</th>
                    <th className="p-4">{isBn ? 'পরিবর্তন ডেল্টা' : 'Change Delta'}</th>
                    <th className="p-4">{isBn ? 'ব্যালেন্স (আগে → পরে)' : 'Balance (Before → After)'}</th>
                    <th className="p-4">{isBn ? 'কারণ ও ব্যাখ্যা' : 'Reason & Justification'}</th>
                    <th className="p-4">{isBn ? 'গুদাম' : 'Warehouse'}</th>
                    <th className="p-4">{isBn ? 'অপারেটর' : 'Operator'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 dark:divide-slate-700">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-stone-400 dark:text-slate-500">
                        {isBn ? 'কোনো লেনদেন পাওয়া যায়নি।' : 'No transactions found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const isPositive = tx.quantityChange > 0;
                      return (
                        <tr key={tx.id} className="hover:bg-stone-50/75 dark:hover:bg-slate-700/40 transition-colors">
                          <td className="p-4 font-mono text-stone-500 dark:text-slate-400 text-[11px]">
                            {new Date(tx.timestamp).toLocaleString('en-US', {
                              month: 'short',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>

                          <td className="p-4">
                            <span className="font-mono font-bold text-stone-900 dark:text-white bg-stone-100 dark:bg-slate-900 px-2 py-0.5 rounded text-[11px] border border-stone-200 dark:border-slate-700">
                              {tx.sku}
                            </span>
                            <p className="text-stone-700 dark:text-slate-300 font-medium mt-0.5 line-clamp-1">{tx.productTitle}</p>
                          </td>

                          <td className="p-4">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              tx.type === 'STOCK_IN' ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' :
                              tx.type === 'SALE' ? 'bg-sky-100 dark:bg-sky-950/60 text-sky-900 dark:text-sky-300 border border-sky-300 dark:border-sky-800' :
                              tx.type === 'RETURN' ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800' :
                              tx.type === 'DAMAGE' ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-900 dark:text-rose-300 border border-rose-300 dark:border-rose-800' :
                              'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                            }`}>
                              {tx.type}
                            </span>
                          </td>

                          <td className="p-4 font-mono font-bold text-sm">
                            <span className={isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {isPositive ? `+${tx.quantityChange}` : tx.quantityChange}
                            </span>
                          </td>

                          <td className="p-4 font-mono text-stone-600 dark:text-slate-400">
                            {tx.quantityBefore} <ArrowRight className="w-3 h-3 inline text-stone-400 mx-0.5" /> <strong className="text-stone-900 dark:text-white">{tx.quantityAfter}</strong>
                          </td>

                          <td className="p-4 text-stone-800 dark:text-slate-200">
                            <p className="font-medium">{tx.reason}</p>
                            {tx.flaggedForReview && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-800 mt-0.5 font-bold">
                                <AlertTriangle className="w-3 h-3" /> High-Volume Review Flagged
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-stone-500 dark:text-slate-400 text-[11px]">
                            {tx.warehouseLocation || 'Tejgaon Central Hub'}
                          </td>

                          <td className="p-4 font-mono text-[11px] text-stone-700 dark:text-slate-300">
                            <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-slate-700 border border-stone-200 dark:border-slate-600">
                              {tx.operator}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Safety Stock & Forecasting */}
      {activeTab === 'FORECAST' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-4">
            <div className="border-b border-stone-200 dark:border-slate-700 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-serif font-bold text-stone-900 dark:text-white">
                  {isBn ? 'আর্টিসান পুনঃঅর্ডার ও লিড টাইম পূর্বাভাস' : 'Artisan Reorder & Lead-Time Forecasting'}
                </h2>
                <p className="text-xs text-stone-500 dark:text-slate-400 mt-0.5">
                  {isBn 
                    ? 'জামদানি বুনন চক্র (১৪-২১ দিন) এবং মৌসুমী সংগ্রহের ভিত্তিতে স্বয়ংক্রিয় বাফার গণনা।' 
                    : 'Automated buffer calculations taking into account Jamdani weaving cycles (14–21 days) and organic harvest seasons.'}
                </p>
              </div>
              <span className="px-3 py-1 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 text-xs font-bold rounded-lg border border-amber-200 dark:border-amber-800">
                Safety Stock Engine
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-900 space-y-2">
                <span className="text-xs font-bold text-stone-600 dark:text-slate-400 uppercase">Jamdani Weaving Hub</span>
                <p className="text-sm font-bold text-stone-900 dark:text-white">Sonargaon & Rupganj Looms</p>
                <div className="text-xs text-stone-500 dark:text-slate-400 space-y-1 pt-1">
                  <div>Avg Production Lead Time: <strong className="text-stone-800 dark:text-slate-200">14 Days</strong></div>
                  <div>Recommended Safety Stock: <strong className="text-stone-800 dark:text-slate-200">15 units</strong></div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-900 space-y-2">
                <span className="text-xs font-bold text-stone-600 dark:text-slate-400 uppercase">Clay & Pottery Cluster</span>
                <p className="text-sm font-bold text-stone-900 dark:text-white">Cumilla Terracotta Artisans</p>
                <div className="text-xs text-stone-500 dark:text-slate-400 space-y-1 pt-1">
                  <div>Avg Production Lead Time: <strong className="text-stone-800 dark:text-slate-200">7 Days</strong></div>
                  <div>Recommended Safety Stock: <strong className="text-stone-800 dark:text-slate-200">20 units</strong></div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-stone-200 dark:border-slate-700 bg-stone-50 dark:bg-slate-900 space-y-2">
                <span className="text-xs font-bold text-stone-600 dark:text-slate-400 uppercase">Sundarbans Forest Reserve</span>
                <p className="text-sm font-bold text-stone-900 dark:text-white">Wild Harvesters Federation</p>
                <div className="text-xs text-stone-500 dark:text-slate-400 space-y-1 pt-1">
                  <div>Avg Extraction & Jarring: <strong className="text-stone-800 dark:text-slate-200">5 Days</strong></div>
                  <div>Recommended Safety Stock: <strong className="text-stone-800 dark:text-slate-200">30 units</strong></div>
                </div>
              </div>
            </div>
          </div>

          {/* Urgent Items List */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-stone-900 dark:text-white uppercase tracking-wider">
              {isBn ? 'জরুরি ওয়ার্ক অর্ডার প্রয়োজন এমন পণ্য' : 'SKUs Requiring Immediate Artisan Work Order'}
            </h3>
            <div className="space-y-3">
              {products.filter(p => p.stock <= (p.lowStockThreshold ?? 5)).map(product => (
                <div key={product.id} className="p-4 rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/50 dark:bg-amber-950/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img src={product.images[0]} alt={product.title} className="w-12 h-12 rounded-xl object-cover border border-stone-200 dark:border-slate-700" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-900 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded text-xs border border-amber-200 dark:border-amber-800">
                          {product.sku}
                        </span>
                        <span className="text-xs text-rose-700 dark:text-rose-400 font-bold">
                          {product.stock === 0 
                            ? (isBn ? 'সতর্কতা: সম্পূর্ণ মজুদশূন্য!' : 'CRITICAL: OUT OF STOCK') 
                            : (isBn ? `মাত্র ${product.stock} ইউনিট অবশিষ্ট রয়েছে` : `Only ${product.stock} units remaining`)}
                        </span>
                      </div>
                      <p className="font-bold text-stone-900 dark:text-white text-sm mt-0.5">{product.title}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setActiveTab('PO_WIZARD');
                        setPoItems([{
                          productId: product.id,
                          sku: product.sku,
                          productTitle: product.title,
                          quantity: 20,
                          unitCost: product.costPrice || Math.round(product.price * 0.6),
                          batchNumber: `LOT-${new Date().getFullYear()}-RESTOCK`
                        }]);
                      }}
                      className="px-4 py-2 bg-teal-900 hover:bg-teal-950 dark:bg-teal-700 dark:hover:bg-teal-600 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isBn ? 'ওয়ার্ক অর্ডার তৈরি করুন (+২০ ইউনিট)' : 'Create Work Order (+20 units)'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Single Product Stock Adjust Modal */}
      <AdminModalShell
        open={!!adjustModalProduct}
        onClose={() => setAdjustModalProduct(null)}
        label="Single Product Stock Adjust Modal"
        closeOnBackdrop={false}
        overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      >
        {adjustModalProduct && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl animate-in fade-in zoom-in duration-150 border border-stone-200 dark:border-slate-700">
            <div className="flex justify-between items-start pb-3 border-b border-stone-200 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-serif font-bold text-stone-900 dark:text-white">
                  {isBn ? 'স্টক সমন্বয় করুন' : 'Adjust Inventory Stock'}
                </h3>
                <span className="text-xs text-stone-500 dark:text-slate-400 font-mono">
                  {adjustModalProduct.sku} • {adjustModalProduct.title}
                </span>
              </div>
              <button 
                onClick={() => setAdjustModalProduct(null)} 
                className="text-stone-400 hover:text-stone-900 dark:hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitAdjust} className="space-y-4 text-xs">
              {/* Current Quantity Card */}
              <div className="p-3.5 bg-stone-50 dark:bg-slate-900 rounded-xl border border-stone-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                  <span className="text-stone-500 dark:text-slate-400 block">{isBn ? 'বর্তমান লেজার স্টক' : 'Current Ledger Stock'}</span>
                  <span className="font-bold text-xl font-mono text-stone-900 dark:text-white">{adjustModalProduct.stock} units</span>
                </div>
                <div className="text-right">
                  <span className="text-stone-500 dark:text-slate-400 block">{isBn ? 'প্রত্যাশিত ব্যালেন্স' : 'Projected Balance'}</span>
                  <span className={`font-bold text-xl font-mono ${
                    adjustType === 'ADD' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {adjustType === 'ADD' 
                      ? adjustModalProduct.stock + Math.abs(adjustQty)
                      : Math.max(0, adjustModalProduct.stock - Math.abs(adjustQty))} units
                  </span>
                </div>
              </div>

              {/* Adjustment Mode (ADD vs DEDUCT) */}
              <div>
                <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1.5">{isBn ? 'সমন্বয়ের ধরণ *' : 'Adjustment Direction *'}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustType('ADD');
                      setAdjustReason('Supplier Batch Restock');
                    }}
                    className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition-all ${
                      adjustType === 'ADD'
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 dark:border-emerald-700 text-emerald-900 dark:text-emerald-300 shadow-xs'
                        : 'bg-stone-50 dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isBn ? 'স্টক ইন (যোগ)' : 'Stock In (Addition)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAdjustType('DEDUCT');
                      setAdjustReason('Damaged / Scrap Write-off');
                    }}
                    className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1.5 border transition-all ${
                      adjustType === 'DEDUCT'
                        ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-500 dark:border-rose-700 text-rose-900 dark:text-rose-300 shadow-xs'
                        : 'bg-stone-50 dark:bg-slate-900 border-stone-200 dark:border-slate-700 text-stone-600 dark:text-slate-400 hover:bg-stone-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <Minus className="w-3.5 h-3.5" />
                    <span>{isBn ? 'স্টক আউট (বিয়োগ)' : 'Stock Out (Deduction)'}</span>
                  </button>
                </div>
              </div>

              {/* Quantity Stepper */}
              <div>
                <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                  {isBn ? `${adjustType === 'ADD' ? 'যোগ' : 'বিয়োগ'} করার পরিমাণ *` : `Quantity to ${adjustType === 'ADD' ? 'Add' : 'Deduct'} *`}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    required
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(Math.abs(Number(e.target.value)))}
                    className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-stone-900 dark:text-white"
                  />
                  <div className="flex gap-1">
                    {[1, 5, 10, 25, 50].map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => setAdjustQty(step)}
                        className="px-2.5 py-2 bg-stone-100 dark:bg-slate-700 hover:bg-stone-200 dark:hover:bg-slate-600 rounded-lg text-xs font-mono font-bold text-stone-700 dark:text-slate-200"
                      >
                        +{step}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* High-Volume Alert Banner */}
              {adjustQty >= 50 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl flex items-start gap-2.5 text-amber-900 dark:text-amber-300 text-[11px] leading-relaxed">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">{isBn ? 'উচ্চ-পরিমাণ সমন্বয় বিজ্ঞপ্তি:' : 'High-Volume Adjustment Notice:'}</strong>
                    {isBn 
                      ? '৫০ ইউনিটের অধিক পরিবর্তন সুপার অ্যাডমিন নিরীক্ষার আওতায় আসবে।' 
                      : 'Changes exceeding 50 units require Super Admin audit trail verification and will be flagged for review.'}
                  </div>
                </div>
              )}

              {/* Reason Selection */}
              <div>
                <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">
                  {isBn ? 'বাধ্যতামূলক নিরীক্ষা কারণ *' : 'Mandatory Audit Reason *'}
                </label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl font-medium text-stone-900 dark:text-white"
                >
                  {adjustType === 'ADD' ? (
                    <>
                      <option value="Supplier Batch Restock" className="dark:bg-slate-800">Supplier Batch Restock (Artisan Intake)</option>
                      <option value="Customer Return Restock" className="dark:bg-slate-800">Customer Return Restock (RMA Inspected)</option>
                      <option value="Physical Inventory Count Gain" className="dark:bg-slate-800">Physical Inventory Count Gain (Audit Reconcile)</option>
                    </>
                  ) : (
                    <>
                      <option value="Damaged / Scrap Write-off" className="dark:bg-slate-800">Damaged / Scrap Write-off</option>
                      <option value="QC Rejection at Warehouse Hub" className="dark:bg-slate-800">QC Rejection at Warehouse Hub</option>
                      <option value="Transit Broken / Destroyed" className="dark:bg-slate-800">Transit Broken / Destroyed</option>
                      <option value="Display / Artisan Sample Dispatch" className="dark:bg-slate-800">Display / Artisan Sample Dispatch</option>
                      <option value="Physical Inventory Shrinkage" className="dark:bg-slate-800">Physical Inventory Shrinkage / Missing Count</option>
                    </>
                  )}
                </select>
              </div>

              {/* Warehouse & Lot Batch */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">{isBn ? 'গুদাম হাব' : 'Warehouse Hub'}</label>
                  <select
                    value={adjustWarehouse}
                    onChange={(e) => setAdjustWarehouse(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white"
                  >
                    <option value="Tejgaon Central Fulfillment Hub, Dhaka" className="dark:bg-slate-800">Tejgaon Hub, Dhaka</option>
                    <option value="Chittagong Agrabad Regional Hub" className="dark:bg-slate-800">Agrabad Hub, CTG</option>
                    <option value="Sylhet Zindabazar Hub" className="dark:bg-slate-800">Zindabazar Hub, Sylhet</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">{isBn ? 'লট / ব্যাচ রেফারেন্স' : 'Lot / Batch Reference'}</label>
                  <input
                    type="text"
                    placeholder="e.g. LOT-2026-08"
                    value={adjustBatchNo}
                    onChange={(e) => setAdjustBatchNo(e.target.value)}
                    className="w-full p-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl font-mono text-stone-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Operator Notes */}
              <div>
                <label className="font-bold text-stone-700 dark:text-slate-300 block mb-1">{isBn ? 'অপারেটর নোট / রেফারেন্স' : 'Operator Notes / PO Reference'}</label>
                <input
                  type="text"
                  placeholder="e.g. Batch inspected by textile QC officer"
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  className="w-full p-2.5 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-700 rounded-xl text-stone-900 dark:text-white"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-3 border-t border-stone-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setAdjustModalProduct(null)}
                  className="px-4 py-2 bg-stone-100 dark:bg-slate-700 text-stone-800 dark:text-slate-200 rounded-xl font-bold hover:bg-stone-200 dark:hover:bg-slate-600"
                >
                  {isBn ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdjust}
                  className="px-5 py-2 bg-teal-900 hover:bg-teal-950 dark:bg-teal-700 dark:hover:bg-teal-600 text-white rounded-xl font-bold shadow-xs transition-colors disabled:opacity-50"
                >
                  {isSubmittingAdjust 
                    ? (isBn ? 'রেকর্ড হচ্ছে...' : 'Recording Audit...') 
                    : (isBn ? 'সমন্বয় সম্পন্ন করুন' : 'Execute Stock Adjustment')}
                </button>
              </div>
            </form>
          </div>
        )}
      </AdminModalShell>

      {/* Barcode & SKU Thermal Tag Generator Modal */}
      <AdminModalShell
        open={!!barcodeProduct}
        onClose={() => setBarcodeProduct(null)}
        label="Barcode & SKU Thermal Tag Generator Modal"
        overlayClassName="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      >
        {barcodeProduct && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-5 shadow-2xl border border-stone-200 dark:border-slate-700">
            <div className="flex justify-between items-center pb-2 border-b border-stone-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-stone-700 dark:text-slate-300" />
                <h3 className="text-base font-serif font-bold text-stone-900 dark:text-white">
                  {isBn ? 'থার্মাল বারকোড ট্যাগ' : 'Thermal SKU Barcode Tag'}
                </h3>
              </div>
              <button onClick={() => setBarcodeProduct(null)} className="text-stone-400 hover:text-stone-900 dark:hover:text-white">✕</button>
            </div>

            {/* Visual Tag Simulation */}
            <div className="p-4 bg-stone-50 dark:bg-slate-900 rounded-xl border border-stone-300 dark:border-slate-700 text-center space-y-3 font-mono">
              <div className="text-[10px] tracking-widest text-stone-500 dark:text-slate-400 uppercase font-bold">
                কিশলয় | KISHOLOY ARTISANAL BD
              </div>
              <div className="text-xs font-bold text-stone-900 dark:text-white line-clamp-1 font-serif">
                {barcodeProduct.title}
              </div>
              {barcodeProduct.titleBn && (
                <div className="text-[11px] text-stone-600 dark:text-slate-300 font-serif font-bangla">
                  {barcodeProduct.titleBn}
                </div>
              )}

              {/* 1D Barcode CSS visual simulation */}
              <div className="py-2 flex items-center justify-center">
                <div className="space-y-1">
                  <div className="flex items-end justify-center h-14 gap-0.5 bg-white dark:bg-slate-100 p-2 border border-stone-300 dark:border-slate-600 rounded">
                    {[3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7, 9, 3, 2, 3, 8, 4, 6, 2, 6, 4, 3, 3, 8, 3, 2, 7].map((h, idx) => (
                      <div
                        key={idx}
                        className="bg-black"
                        style={{
                          width: `${(idx % 3 === 0 ? 2 : 1)}px`,
                          height: `${40 + (h % 5) * 3}px`
                        }}
                      />
                    ))}
                  </div>
                  <div className="text-[11px] font-bold text-stone-900 dark:text-white tracking-wider">
                    {barcodeProduct.sku}
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs font-bold pt-2 border-t border-stone-200 dark:border-slate-700">
                <span className="text-stone-500 dark:text-slate-400">{isBn ? 'খুচরা মূল্য:' : 'Retail Price:'}</span>
                <span className="text-stone-900 dark:text-white text-sm">৳{barcodeProduct.price.toLocaleString()}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setBarcodeProduct(null)}
                className="px-4 py-2 bg-stone-100 dark:bg-slate-700 text-stone-800 dark:text-slate-200 rounded-xl font-bold text-xs"
              >
                {isBn ? 'বন্ধ করুন' : 'Close'}
              </button>
              <button
                onClick={() => {
                  window.print();
                }}
                className="px-4 py-2 bg-stone-900 dark:bg-teal-700 text-white rounded-xl font-bold text-xs hover:bg-black dark:hover:bg-teal-600"
              >
                {isBn ? 'লেবেল প্রিন্ট করুন' : 'Print Thermal Label'}
              </button>
            </div>
          </div>
        )}
      </AdminModalShell>
    </div>
  );
}
