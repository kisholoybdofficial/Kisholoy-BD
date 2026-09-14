import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { 
  Menu, X, ExternalLink, UserCheck, 
  BookOpen, ArrowUpRight, Layers, ShieldCheck,
  Lock, LogOut, KeyRound, Building2, ScanLine,
  ChevronDown, ChevronRight, ShoppingCart, Package, Users, Cpu, Search
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role } from '../types';
import { ADMIN_SECTIONS_DATA, getSectionBadgeCount } from './adminModulesData';
import { AdminModulesGuideModal } from './AdminModulesGuideModal';
import { AccessDenied } from '../components/admin/AccessDenied';
import { IdentityAccessModal } from '../components/admin/IdentityAccessModal';
import { SupplierPortalModal } from '../components/admin/SupplierPortalModal';
import { AdminNotificationAlerts } from '../components/admin/AdminNotificationAlerts';
import { AdminUrgentAlertBanner } from '../components/admin/AdminUrgentAlertBanner';
import { ScannerModal } from '../components/scan/ScannerModal';
import { LanguageButton } from '../components/layout/LanguageButton';
import { ThemeButton } from '../components/layout/ThemeButton';
import { AdminErrorBoundary } from '../components/admin/AdminErrorBoundary';
import { useAdminTactileFeedback } from '../hooks/useAdminTactileFeedback';
import { AdminTactileProvider } from '../context/AdminTactileContext';
import { StaffLoginScreen } from './StaffLoginScreen';
import { AUTH_EXPIRED_EVENT } from '../lib/apiClient';
import { isAdminRole, canAccessAdminRoute, fetchStaffSession, logoutStaff } from '../lib/auth';
import { useSeo } from '../lib/seo';

/**
 * Unified route monitoring hook that logs and validates active admin sub-menu navigation
 */
export function useAdminRouteMonitoring(currentRole: Role, isBn: boolean) {
  const location = useLocation();
  const [navigationHistory, setNavigationHistory] = useState<Array<{
    path: string;
    timestamp: string;
    valid: boolean;
    moduleName: string;
  }>>([]);

  const activeModule = useMemo(() => {
    const routeAliases: Record<string, string> = {
      '/admin/traffic': '/admin/analytics',
      '/admin/traffic-analysis': '/admin/analytics',
      '/admin/traffic-analytics': '/admin/analytics',
      '/admin/marketing/command': '/admin/marketing',
      '/admin/marketing-command': '/admin/marketing',
      '/admin/marketing-command-center': '/admin/marketing',
      '/admin/report': '/admin/reports',
      '/admin/reports-analytics': '/admin/reports',
      '/admin/rbac': '/admin/users',
      '/admin/user-management': '/admin/users',
      '/admin/roles': '/admin/users',
      '/admin/audits': '/admin/audit',
      '/admin/audit-trail': '/admin/audit',
      '/admin/audit-logs': '/admin/audit',
      '/admin/backups': '/admin/backup',
      '/admin/database-backup': '/admin/backup',
      '/admin/disaster-recovery': '/admin/backup',
    };

    const targetPath = routeAliases[location.pathname] || location.pathname;

    for (const section of ADMIN_SECTIONS_DATA) {
      const foundItem = section.items.find((item) => 
        item.path === targetPath || 
        item.path === location.pathname || 
        (item.path !== '/admin' && (targetPath.startsWith(item.path) || location.pathname.startsWith(item.path)))
      );
      if (foundItem) {
        return {
          section,
          item: foundItem,
          isValid: true,
          label: isBn ? foundItem.labelBn : foundItem.label,
          path: foundItem.path,
        };
      }
    }
    return {
      section: null,
      item: null,
      isValid: location.pathname === '/admin' || location.pathname.startsWith('/admin/'),
      label: isBn ? 'অ্যাডমিন মডিউল' : 'Admin Module',
      path: location.pathname,
    };
  }, [location.pathname, isBn]);

  useEffect(() => {
    const timestamp = new Date().toISOString();
    const isKnownRoute = Boolean(activeModule.item);
    
    // Log active sub-menu transition for operational telemetry & audit trails
    console.info(`[Admin Navigation Audit] Route: ${location.pathname} | Sub-menu: ${activeModule.label} | Valid: ${isKnownRoute} | Role: ${currentRole} | Time: ${timestamp}`);

    setNavigationHistory((prev) => [
      {
        path: location.pathname,
        timestamp,
        valid: isKnownRoute,
        moduleName: activeModule.label,
      },
      ...prev.slice(0, 19),
    ]);
  }, [location.pathname, activeModule, currentRole]);

  return {
    currentPath: location.pathname,
    activeSection: activeModule.section,
    activeItem: activeModule.item,
    activeModuleLabel: activeModule.label,
    isValidRoute: activeModule.isValid,
    navigationHistory,
  };
}

const ROLE_LABELS_BN: Record<Role, string> = {
  SUPER_ADMIN: 'সুপার অ্যাডমিন',
  ADMIN: 'অ্যাডমিন',
  ORDER_MANAGER: 'অর্ডার ম্যানেজার',
  INVENTORY_MANAGER: 'ইনভেন্টরি ম্যানেজার',
  FINANCE: 'ফাইন্যান্স ম্যানেজার',
  SUPPORT: 'কাস্টমার সাপোর্ট',
  STAFF: 'স্টাফ (রিড-অনলি)',
  SUPPLIER: 'সাপ্লায়ার',
  MERCHANT: 'মার্চেন্ট',
  CUSTOMER: 'সাধারণ গ্রাহক',
};

// Route Access Control Matrix (All staff roles have accessible preview & operations across management suites)
const ALL_STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'FINANCE', 'SUPPORT'];

const ROUTE_PERMISSIONS: Record<string, { requiredPermission: string; allowedRoles: Role[] }> = {
  '/admin': { requiredPermission: 'DASHBOARD_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/orders': { requiredPermission: 'ORDER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/fraud': { requiredPermission: 'ORDER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/fulfillment': { requiredPermission: 'ORDER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/shipments': { requiredPermission: 'ORDER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/returns': { requiredPermission: 'ORDER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/products': { requiredPermission: 'PRODUCT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/categories': { requiredPermission: 'PRODUCT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/inventory': { requiredPermission: 'INVENTORY_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/suppliers': { requiredPermission: 'SUPPLIER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/customers': { requiredPermission: 'CUSTOMER_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/reports': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/report': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/reports-analytics': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/analytics': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/traffic': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/traffic-analysis': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/traffic-analytics': { requiredPermission: 'REPORT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/promotions': { requiredPermission: 'CONTENT_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/marketing': { requiredPermission: 'CONTENT_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/marketing/command': { requiredPermission: 'CONTENT_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/marketing-command': { requiredPermission: 'CONTENT_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/marketing-command-center': { requiredPermission: 'CONTENT_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/payments': { requiredPermission: 'PAYMENT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/refunds': { requiredPermission: 'REFUND_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/finance': { requiredPermission: 'EXPENSE_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/content': { requiredPermission: 'CONTENT_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/operations': { requiredPermission: 'SETTINGS_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/settings': { requiredPermission: 'SETTINGS_VIEW', allowedRoles: ALL_STAFF_ROLES },
  '/admin/users': { requiredPermission: 'USER_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/rbac': { requiredPermission: 'USER_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/user-management': { requiredPermission: 'USER_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/roles': { requiredPermission: 'USER_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/audit': { requiredPermission: 'SECURITY_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/audits': { requiredPermission: 'SECURITY_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/audit-trail': { requiredPermission: 'SECURITY_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/audit-logs': { requiredPermission: 'SECURITY_MANAGE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/backup': { requiredPermission: 'BACKUP_CREATE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/backups': { requiredPermission: 'BACKUP_CREATE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/database-backup': { requiredPermission: 'BACKUP_CREATE', allowedRoles: ALL_STAFF_ROLES },
  '/admin/disaster-recovery': { requiredPermission: 'BACKUP_CREATE', allowedRoles: ALL_STAFF_ROLES },
};

export function AdminLayout() {
  return (
    <AdminTactileProvider>
      <AdminLayoutContent />
    </AdminTactileProvider>
  );
}

function AdminLayoutContent() {
  // Activate mobile touch ripple & tactile scale feedback for all interactive elements in admin
  useAdminTactileFeedback('admin-root-layout');

  const { currentRole, setCurrentRole, orders, products, returnRequests, language, setLanguage, siteContent, showToast } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [guideModalOpen, setGuideModalOpen] = useState(false);
  const [guideInitialSection, setGuideInitialSection] = useState<string>('all');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [supplierPortalOpen, setSupplierPortalOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  // ── Server-authoritative staff session ───────────────────────────────────
  // The old version decided "am I an admin?" from `localStorage` and, if the
  // verify call *threw*, fell back to `Boolean(getStaffToken()) &&
  // isAdminRole(currentRole)` — with `currentRole` defaulting to SUPER_ADMIN.
  // A network blip therefore meant "authenticated super admin". Now the only
  // source of truth is GET /api/security/auth/session, resolved from an httpOnly
  // signed cookie, and any failure means signed out (fail closed).
  const [isStaffAuthenticated, setIsStaffAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [sessionUser, setSessionUser] = useState<{ name: string; email: string; role: Role } | null>(null);

  const applySession = useCallback(
    (session: Awaited<ReturnType<typeof fetchStaffSession>>) => {
      if (session.valid && session.role && isAdminRole(session.role)) {
        setIsStaffAuthenticated(true);
        setMustChangePassword(session.mustChangePassword);
        const resolvedRole = session.role as Role;
        setSessionUser({
          name: session.user?.name || 'Staff',
          email: session.user?.email || '',
          role: resolvedRole,
        });
        setCurrentRole(resolvedRole);
      } else {
        setIsStaffAuthenticated(false);
        setSessionUser(null);
        setMustChangePassword(false);
        setCurrentRole('CUSTOMER');
      }
    },
    [setCurrentRole]
  );

  useEffect(() => {
    let isMounted = true;
    fetchStaffSession()
      .then((session) => {
        if (isMounted) applySession(session);
      })
      .catch(() => {
        if (isMounted) applySession({ valid: false, user: null, role: null, permissions: [], mustChangePassword: false, twoFactorEnabled: false });
      })
      .finally(() => {
        if (isMounted) setAuthChecking(false);
      });

    // A 401 from any staff-guarded endpoint means the session died: drop the
    // shell back to the sign-in gate instead of leaving a live-looking panel.
    const onExpired = (e: Event) => {
      if (!isMounted) return;
      const detail = (e as CustomEvent)?.detail;
      // Only expire staff session if the event is specifically for the STAFF scope
      if (detail?.scope && detail.scope !== 'STAFF') {
        return;
      }
      applySession({ valid: false, user: null, role: null, permissions: [], mustChangePassword: false, twoFactorEnabled: false });
      setAuthChecking(false);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => {
      isMounted = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    };
  }, [applySession]);

  const handleAdminLogout = async () => {
    await logoutStaff();
    setIsStaffAuthenticated(false);
    setSessionUser(null);
    setCurrentRole('CUSTOMER');
    showToast(isBn ? 'সফলভাবে অ্যাডমিন লগআউট সম্পন্ন হয়েছে।' : 'Admin session logged out successfully.');
  };

  // Sidebar accordion: default all sections expanded for full visibility of all submenus
  const ALL_SECTION_IDS = ['sales-operations', 'catalog-inventory', 'customer-management', 'system-administration'];
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(ALL_SECTION_IDS));

  // Keep active section expanded when route changes
  useEffect(() => {
    setExpandedSections((prev) => {
      const active = ADMIN_SECTIONS_DATA.find((s) => s.items.some((i) => i.path === location.pathname || (i.path !== '/admin' && location.pathname.startsWith(i.path))));
      if (!active || prev.has(active.id)) return prev;
      const next = new Set(prev);
      next.add(active.id);
      return next;
    });
  }, [location.pathname]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExpandAll = () => {
    setExpandedSections(new Set(ALL_SECTION_IDS));
  };

  const handleCollapseAll = () => {
    setExpandedSections(new Set());
  };

  const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    'sales-operations': ShoppingCart,
    'catalog-inventory': Package,
    'customer-management': Users,
    'system-administration': Cpu,
  };

  const pendingOrdersCount = orders.filter(o => o.orderStatus === 'PENDING').length;
  const lowStockCount = products.filter(p => p.stock <= (p.lowStockThreshold ?? 5)).length;
  const highRiskCount = orders.filter(o => o.fraudRisk && (o.fraudRisk.riskScore >= 60 || o.fraudRisk.riskRating === 'HIGH' || o.fraudRisk.riskRating === 'SUSPICIOUS')).length;
  const pendingReturnsCount = (returnRequests || []).filter(r => r.status === 'UNDER_REVIEW').length;

  const counts = {
    pendingOrders: pendingOrdersCount,
    lowStock: lowStockCount,
    fraudAlerts: highRiskCount,
    pendingReturns: pendingReturnsCount
  };

  const isBn = language === 'BN';
  // Active role: if staff is authenticated, fallback to sessionUser role or SUPER_ADMIN
  // to guarantee RBAC checks never prematurely treat an authenticated staff member as 'CUSTOMER'.
  const activeRole: Role = isStaffAuthenticated
    ? (isAdminRole(currentRole) ? currentRole : (sessionUser?.role && isAdminRole(sessionUser.role) ? sessionUser.role : 'SUPER_ADMIN'))
    : currentRole;

  // Synchronize AppContext's currentRole if it was lagging behind the authenticated staff role
  useEffect(() => {
    if (isStaffAuthenticated && currentRole === 'CUSTOMER') {
      setCurrentRole(activeRole);
    }
  }, [isStaffAuthenticated, currentRole, activeRole, setCurrentRole]);

  const routeMonitoring = useAdminRouteMonitoring(activeRole, isBn);

  const roles: Role[] = [
    'SUPER_ADMIN',
    'ADMIN',
    'ORDER_MANAGER',
    'INVENTORY_MANAGER',
    'FINANCE',
    'SUPPORT',
    'SUPPLIER',
    'MERCHANT',
    'CUSTOMER'
  ];

  const handleOpenGuide = (sectionId: string = 'all') => {
    setGuideInitialSection(sectionId);
    setGuideModalOpen(true);
  };

  // Check route access permission using isAdminRole and canAccessAdminRoute
  const normalizedPath = location.pathname.replace(/\/+$/, '') || '/admin';
  const currentRouteRule = ROUTE_PERMISSIONS[normalizedPath] || ROUTE_PERMISSIONS[location.pathname];
  const isAllowedOnCurrentRoute =
    isAdminRole(activeRole) &&
    (activeRole === 'SUPER_ADMIN' || canAccessAdminRoute(activeRole, normalizedPath) || (
      !currentRouteRule || currentRouteRule.allowedRoles.includes(activeRole)
    ));

  // Check if role is allowed to view a specific item
  const isItemAllowed = (itemPath: string) => {
    if (!isAdminRole(activeRole)) return false;
    if (activeRole === 'SUPER_ADMIN') return true;
    return canAccessAdminRoute(activeRole, itemPath.replace(/\/+$/, '') || '/admin');
  };

  /**
   * The control panel — including the sign-in, 2FA and forced-password-change
   * screens rendered below — must never reach a search index: robots.txt
   * disallows /admin and every one of these routes emits noindex,nofollow.
   */
  useSeo(
    {
      title: isStaffAuthenticated ? 'Control panel | Kisholoy' : 'Staff sign-in | Kisholoy',
      titleBn: isStaffAuthenticated ? 'কন্ট্রোল প্যানেল | কিশলয়' : 'স্টাফ সাইন-ইন | কিশলয়',
      description: 'Authenticated staff area.',
      path: '/admin',
      private: true,
      locale: isBn ? 'bn' : 'en',
    },
    [isBn, isStaffAuthenticated, authChecking, location.pathname]
  );

  if (authChecking) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-stone-100 dark:bg-slate-950 text-stone-900 dark:text-slate-100">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-700 to-teal-950 flex items-center justify-center font-serif font-black text-white text-xl shadow-md mb-4 animate-pulse">
          K
        </div>
        <p className="text-xs font-mono text-stone-500 dark:text-slate-400">
          {isBn ? 'সিকিউরিটি সেশন যাচাই করা হচ্ছে…' : 'Verifying staff credentials…'}
        </p>
      </div>
    );
  }

  if (!isStaffAuthenticated) {
    return (
      <StaffLoginScreen
        onAuthenticated={({ role, name, email }) => {
          const effectiveRole = (role && isAdminRole(role)) ? role : 'SUPER_ADMIN';
          setIsStaffAuthenticated(true);
          setCurrentRole(effectiveRole);
          setSessionUser({
            name: name || 'Admin',
            email: email || '',
            role: effectiveRole,
          });
          showToast(isBn ? 'স্বাগতম! অ্যাডমিন প্যানেল আনলক করা হয়েছে।' : 'Welcome! Admin panel unlocked.');
          fetchStaffSession().then((session) => {
            if (session.valid) applySession(session);
          }).catch(() => {/* ignore transient network check */});
        }}
      />
    );
  }

  return (
    <div id="admin-root-layout" className="h-screen overflow-hidden flex flex-col bg-stone-100/90 dark:bg-slate-950 text-stone-900 dark:text-slate-100 font-sans selection:bg-teal-900 selection:text-white transition-colors duration-200 w-full max-w-full min-w-0">
      {/* Top Operational Header */}
      <header id="admin-top-header" className="sticky top-0 z-30 bg-white/95 text-stone-900 border-b border-stone-200/90 dark:bg-stone-950/95 dark:text-white dark:border-stone-800/80 h-16 flex items-center justify-between px-4 sm:px-6 shadow-xs backdrop-blur-md transition-colors">
        <div className="flex items-center gap-3">
          <button
            id="admin-sidebar-toggle-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center p-2.5 text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-white rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800/80 transition-colors"
            aria-label="Toggle navigation menu"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <Link to="/admin" className="flex items-center gap-2 sm:gap-2.5 shrink-0 min-h-[44px]">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-700 to-teal-950 flex items-center justify-center font-serif font-black text-white text-base shadow-xs border border-teal-600/40 shrink-0">
              K
            </div>
            <span className="font-serif font-black text-base sm:text-xl tracking-tight text-stone-900 dark:text-white whitespace-nowrap">
              {siteContent.brandName}
            </span>
            <span className="text-teal-800 dark:text-teal-300 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800/80 uppercase tracking-wider hidden md:inline-block">
              {isBn ? 'অপারেশনস কন্ট্রোল' : 'OPS CENTER'}
            </span>
          </Link>
        </div>

        {/* Topbar Actions */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          
          {/* Who Am I? Identity Inspector Trigger */}
          <button
            onClick={() => setInspectorOpen(true)}
            className="flex min-h-[44px] items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-900 dark:hover:bg-stone-850 text-stone-800 dark:text-stone-200 hover:text-stone-900 dark:hover:text-white border border-stone-200 dark:border-stone-800 text-xs font-semibold shadow-2xs transition-all max-w-[120px] sm:max-w-none"
            title="Inspect your operational access and role permissions"
          >
            <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
            <span className="font-mono text-teal-800 dark:text-teal-300 font-bold truncate">
              {isBn ? (ROLE_LABELS_BN[activeRole] || activeRole) : activeRole}
            </span>
            <span className="hidden xl:inline text-stone-500 dark:text-stone-400 font-normal">| {isBn ? 'অ্যাক্সেস রুলস' : 'Permissions'}</span>
          </button>

          {/* Real-time Notification Alert Center (Fraud Risks, Pending Settlements, RMA) */}
          <AdminNotificationAlerts />

          {/* Global Code Scanner (Order / Tracking / SKU) */}
          <button
            id="admin-open-scanner-btn"
            onClick={() => setScannerOpen(true)}
            className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-850 text-stone-200 border border-stone-800 text-xs font-semibold shadow-2xs hover:text-white transition-all"
            title={isBn ? 'অর্ডার/ট্র্যাকিং/SKU স্ক্যান করুন' : 'Scan an order, tracking ID or SKU'}
          >
            <ScanLine className="w-4 h-4 text-teal-400" />
            <span>{isBn ? 'স্ক্যান' : 'Scan'}</span>
          </button>

          {/* Work Guide Button */}
          <button
            id="admin-open-work-guide-btn"
            onClick={() => handleOpenGuide('all')}
            className="hidden md:inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-900 dark:hover:bg-stone-850 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-800 text-xs font-semibold shadow-2xs hover:text-stone-900 dark:hover:text-white transition-all"
            title={isBn ? 'সকল সেকশন ও কাজের বিবরণী দেখুন' : 'View all sections and work details'}
          >
            <BookOpen className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>{isBn ? 'কাজের গাইড' : 'Work Guide'}</span>
          </button>

          {/* Quick Language Toggle (icon-only) */}
          <LanguageButton />

          {/* Theme Mode Switcher (Light / Dark / System) */}
          <span id="admin-theme-toggle-btn">
            <ThemeButton />
          </span>

          {/* Live Storefront Link */}
          <Link
            id="admin-live-store-link"
            to="/"
            target="_blank"
            className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-800 hover:bg-teal-750 text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <span>{isBn ? 'লাইভ ওয়েবসাইট' : 'Live Store'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>

          {/* Admin Sign Out Button */}
          <button
            id="admin-logout-btn"
            onClick={handleAdminLogout}
            className="inline-flex min-h-[44px] items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/50 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
            title={isBn ? 'অ্যাডমিন থেকে লগআউট করুন' : 'Sign out of Admin'}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden md:inline">{isBn ? 'লগআউট' : 'Sign Out'}</span>
          </button>
        </div>
      </header>

      {/* Real-time Urgent Operational Marquee/Banner (High Fraud Risk / Pending Settlements) */}
      <AdminUrgentAlertBanner />

      <div className="flex-1 flex min-h-0 overflow-hidden relative w-full min-w-0">
        {/* Mobile / Tablet Backdrop Overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-15 bg-black/50 backdrop-blur-xs lg:hidden transition-opacity"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar Navigation */}
        <aside
          id="admin-sidebar"
          className={`fixed inset-y-0 left-0 z-20 w-72 bg-white dark:bg-stone-950 text-stone-800 dark:text-stone-300 border-r border-stone-200/90 dark:border-stone-800/80 transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0 pt-16 lg:pt-0 min-h-0 flex flex-col ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {/* Identity & Scope Indicator */}
          <div className="p-3 bg-stone-50/80 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-850">
            <button
              onClick={() => setInspectorOpen(true)}
              className="flex items-center gap-2.5 text-left w-full p-2.5 rounded-2xl bg-white dark:bg-stone-900/90 hover:bg-stone-100 dark:hover:bg-stone-850 border border-stone-200 dark:border-stone-800/90 text-stone-800 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white transition-all group shadow-2xs"
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-800 to-teal-950 text-teal-100 flex items-center justify-center font-bold text-xs shadow-xs border border-teal-700/40">
                {activeRole.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-bold text-stone-900 dark:text-white block truncate">
                  {isBn ? (ROLE_LABELS_BN[activeRole] || activeRole.replace('_', ' ')) : activeRole.replace('_', ' ')}
                </span>
                <span className="text-[10px] text-teal-700 dark:text-teal-400 font-mono block truncate">
                  {isBn ? 'আরবিএসি সক্রিয়' : 'RBAC Active'} • {isBn ? 'রুলস দেখুন' : 'Click to view rules'}
                </span>
              </div>
              <KeyRound className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors" />
            </button>
          </div>

          {/* Quick Search & Expand/Collapse Toolbar */}
          <div className="p-3 border-b border-stone-200 dark:border-stone-850 space-y-2 bg-white dark:bg-stone-950">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder={isBn ? 'সাব-মেনু খুঁজুন...' : 'Search menu modules...'}
                className="w-full min-h-[44px] pl-9 pr-9 py-2 bg-stone-100 dark:bg-stone-900 rounded-xl text-xs text-stone-800 dark:text-stone-200 placeholder:text-stone-400 border border-stone-200 dark:border-stone-800 focus:outline-none focus:border-teal-500 transition-all font-medium"
              />
              {menuSearch && (
                <button
                  onClick={() => setMenuSearch('')}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-stone-400 px-0.5">
              <span className="font-semibold uppercase tracking-wider text-[10px] text-stone-400 dark:text-stone-500">
                {isBn ? 'মেনু বিভাগ' : 'Sections'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleExpandAll}
                  className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors font-semibold cursor-pointer text-[11px] min-h-[36px] px-2 py-1 inline-flex items-center"
                >
                  {isBn ? 'সব খুলুন' : 'Expand All'}
                </button>
                <span>•</span>
                <button
                  onClick={handleCollapseAll}
                  className="hover:text-teal-700 dark:hover:text-teal-400 transition-colors font-semibold cursor-pointer text-[11px] min-h-[36px] px-2 py-1 inline-flex items-center"
                >
                  {isBn ? 'সব বন্ধ' : 'Collapse All'}
                </button>
              </div>
            </div>
          </div>

          <nav id="admin-sidebar-nav" className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
            {ADMIN_SECTIONS_DATA.map((section) => {
              // Filter section items based on current role permissions
              let allowedItems = section.items.filter(item => isItemAllowed(item.path));
              
              // Apply search query filter if user is searching
              if (menuSearch.trim()) {
                const q = menuSearch.toLowerCase().trim();
                allowedItems = allowedItems.filter(item => 
                  item.label.toLowerCase().includes(q) ||
                  item.labelBn.toLowerCase().includes(q) ||
                  item.path.toLowerCase().includes(q) ||
                  (item.tagline && item.tagline.toLowerCase().includes(q)) ||
                  (item.taglineBn && item.taglineBn.toLowerCase().includes(q)) ||
                  section.title.toLowerCase().includes(q) ||
                  section.titleBn.toLowerCase().includes(q)
                );
              }

              if (allowedItems.length === 0) return null;

              // Auto-expand if currently searching or if in expandedSections set
              const isOpen = menuSearch.trim().length > 0 || expandedSections.has(section.id);
              const SectionIcon = SECTION_ICONS[section.id] || Layers;

              return (
                <div key={section.id} id={`section-${section.id}`} className="rounded-xl">
                  {/* Group Header (accordion) */}
                  <button
                    onClick={() => toggleSection(section.id)}
                    className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all text-left group ${
                      isOpen
                        ? 'bg-stone-100/90 dark:bg-stone-900/90 text-stone-900 dark:text-white font-bold'
                        : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100/70 dark:hover:bg-stone-900/70 hover:text-stone-900 dark:hover:text-stone-200'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center border transition-colors ${
                      isOpen
                        ? 'bg-teal-50 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                        : 'bg-stone-100 dark:bg-stone-850 text-stone-500 dark:text-stone-400 border-stone-200 dark:border-stone-800 group-hover:border-stone-300'
                    }`}>
                      <SectionIcon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate leading-tight tracking-tight text-stone-900 dark:text-stone-100">
                        {isBn ? section.titleBn : section.title}
                      </div>
                      <div className="text-[10px] text-stone-400 dark:text-stone-500 truncate">
                        {allowedItems.length} {isBn ? 'টি মডিউল' : 'modules'}
                      </div>
                    </div>
                    <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Section Items (Nested tree styling) */}
                  {isOpen && (
                    <div className="mt-1 ml-3.5 pl-2.5 border-l-2 border-stone-200 dark:border-stone-800/90 space-y-0.5 py-0.5">
                      {allowedItems.map((item) => {
                        const Icon = item.icon;
                        const currentPath = location.pathname.replace(/\/$/, '') || '/';
                        const itemPath = item.path.replace(/\/$/, '') || '/';
                        const isActive = currentPath === itemPath || (itemPath !== '/admin' && currentPath.startsWith(itemPath));
                        const badge = getSectionBadgeCount(item.badgeKey, counts);

                        return (
                          <Link
                            key={item.path}
                            id={item.id}
                            to={item.path}
                            title={isBn ? item.labelBn : item.label}
                            onClick={() => setSidebarOpen(false)}
                            className={`relative min-h-[44px] flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition-all group ${
                              isActive
                                ? 'bg-teal-50/90 dark:bg-teal-950/70 text-teal-950 dark:text-teal-100 font-bold shadow-2xs border border-teal-200/80 dark:border-teal-800/80'
                                : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100/90 dark:hover:bg-stone-900/90 hover:text-stone-900 dark:hover:text-stone-100 font-medium'
                            }`}
                          >
                            {isActive && (
                              <span className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-r-full bg-teal-600" />
                            )}
                            <div className="flex items-center gap-2.5 min-w-0 pr-1">
                              <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                                isActive 
                                  ? 'bg-teal-600 text-white shadow-2xs' 
                                  : 'bg-stone-100 dark:bg-stone-850 text-stone-500 dark:text-stone-400 group-hover:bg-teal-100 dark:group-hover:bg-teal-900/40 group-hover:text-teal-700 dark:group-hover:text-teal-300'
                              }`}>
                                <Icon className="w-3.5 h-3.5 shrink-0" />
                              </div>
                              <div className="min-w-0 truncate">
                                <span className="truncate block font-semibold text-xs text-stone-800 dark:text-stone-200 group-hover:text-stone-900 dark:group-hover:text-white">
                                  {isBn ? item.labelBn : item.label}
                                </span>
                                <span className="text-[10px] text-stone-400 dark:text-stone-500 block truncate font-normal">
                                  {isBn ? (item.taglineBn || item.labelBn) : (item.tagline || item.label)}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {badge && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.color}`}>
                                  {isBn ? badge.labelBn : badge.label}
                                </span>
                              )}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="p-3.5 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 text-[11px] text-stone-500 dark:text-stone-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold text-stone-700 dark:text-stone-300">{isBn ? 'আরবিএসি সক্রিয়' : 'RBAC Active'}</span>
            </div>
            <button
              onClick={() => setInspectorOpen(true)}
              className="text-[11px] text-teal-700 dark:text-teal-400 hover:text-teal-900 dark:hover:text-teal-300 font-semibold underline underline-offset-2"
            >
              {isBn ? 'অ্যাক্সেস পরীক্ষা' : 'Inspect Access'}
            </button>
          </div>
        </aside>

        {/* Main Operational Workspace */}
        <main id="admin-main-viewport" className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden w-full max-w-full min-w-0 p-3 sm:p-5 lg:p-8">
          {/* Customer / Supplier Access Boundary Check */}
          {activeRole === 'CUSTOMER' ? (
            <AccessDenied
              requiredPermission="STAFF_INTERNAL_ACCESS"
              allowedRoles={['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'FINANCE', 'SUPPORT']}
              onOpenInspector={() => setInspectorOpen(true)}
            />
          ) : activeRole === 'SUPPLIER' ? (
            <div className="min-h-[60vh] flex items-center justify-center p-6">
              <div className="max-w-md w-full bg-white rounded-2xl border border-stone-200 p-8 shadow-xs text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center justify-center mx-auto shadow-xs">
                  <Building2 className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-stone-900">
                  {isBn ? 'সাপ্লায়ার আইসোলেটেড পোর্টাল' : 'Supplier Portal Scoped Access'}
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {isBn
                    ? 'সাপ্লায়ার অ্যাকাউন্ট শুধুমাত্র তাদের নিজস্ব সরবরাহকৃত পণ্য, ক্রয়াদেশ ও পেমেন্ট হিস্ট্রি দেখতে পারে।'
                    : 'As an authorized supplier, your access is strictly isolated from internal customer data, sales revenue, and system settings.'}
                </p>
                <button
                  onClick={() => setSupplierPortalOpen(true)}
                  className="w-full py-2.5 px-4 rounded-xl bg-teal-900 hover:bg-teal-950 text-white text-xs font-semibold shadow-xs"
                >
                  {isBn ? 'আইসোলেটেড পোর্টাল ওপেন করুন' : 'Open Supplier Isolated Portal'}
                </button>
              </div>
            </div>
          ) : !isAllowedOnCurrentRoute ? (
            <AccessDenied
              requiredPermission={currentRouteRule?.requiredPermission || 'RESTRICTED_ACCESS'}
              allowedRoles={currentRouteRule?.allowedRoles}
              onOpenInspector={() => setInspectorOpen(true)}
            />
          ) : (
            <AdminErrorBoundary 
              key={location.pathname}
              currentPath={location.pathname}
              moduleName={routeMonitoring.activeModuleLabel}
              fallbackTitle={isBn ? `${routeMonitoring.activeModuleLabel} লোড ব্যর্থ হয়েছে` : `Failed to load ${routeMonitoring.activeModuleLabel}`}
              isBn={isBn}
            >
              <Outlet />
            </AdminErrorBoundary>
          )}
        </main>
      </div>

      {/* Global Interactive Work Guide Modal */}
      <AdminModulesGuideModal
        isOpen={guideModalOpen}
        onClose={() => setGuideModalOpen(false)}
        initialSectionId={guideInitialSection}
      />

      {/* Identity & Access Inspector Modal ("Who Am I?") */}
      <IdentityAccessModal
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        onLogout={() => {
          showToast('Session terminated. Switched to Guest.');
          setCurrentRole('CUSTOMER');
          setInspectorOpen(false);
          navigate('/');
        }}
      />

      {/* Supplier Portal Preview Modal */}
      <SupplierPortalModal
        isOpen={supplierPortalOpen}
        onClose={() => setSupplierPortalOpen(false)}
        supplier={{
          id: 'sup-001',
          name: 'Silk Paradise Ltd.',
          code: 'SPL-DHK',
          contactPerson: 'Kamal Hossain',
          email: 'silkparadise@supplier.kisholoy.com',
          phone: '+880 1711-223344',
          address: 'Mirpur-10, Dhaka',
          district: 'Dhaka',
          division: 'Dhaka',
          status: 'ACTIVE',
          createdAt: '2025-01-10',
          updatedAt: '2026-03-01',
          totalPurchased: 450000,
          totalPaid: 380000,
          outstandingDue: 70000,
          paymentTermsDays: 15,
          suppliedProducts: [
            { productId: 'prod-001', productName: 'Handloom Jamdani Saree', sku: 'JAM-DHK-001', supplyPrice: 8500, leadTimeDays: 3, isPrimarySupplier: true },
            { productId: 'prod-002', productName: 'Pure Rajshahi Silk Dupatta', sku: 'SLK-RAJ-002', supplyPrice: 2200, leadTimeDays: 2, isPrimarySupplier: true }
          ],
          portalAccess: {
            enabled: true,
            email: 'silkparadise@supplier.kisholoy.com',
            role: 'SUPPLIER',
            lastLoginAt: '2026-03-02T10:15:00Z'
          }
        }}
      />

      {/* Global Code Scanner Modal (Barcode / QR / Manual) */}
      <ScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}


