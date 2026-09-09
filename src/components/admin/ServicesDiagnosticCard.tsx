import React, { useState, useEffect, useCallback } from 'react';
import { 
  Database, Flame, Zap, Activity, RefreshCw, CheckCircle2, 
  XCircle, Copy, Check, Info, ChevronDown, ChevronUp, 
  ExternalLink, Terminal, ShieldAlert, Cpu
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export interface ServiceDiagnosticItem {
  id: 'supabase' | 'firebase' | 'mongodb' | 'redis';
  name: string;
  nameBn: string;
  provider: string;
  category: string;
  categoryBn: string;
  connected: boolean;
  status: 'OPERATIONAL' | 'DEGRADED' | 'DISCONNECTED' | 'ERROR';
  details: string;
  latencyMs?: number;
  lastChecked?: string;
  credentialsMasked?: string;
  troubleshootingTip: string;
  troubleshootingTipBn: string;
}

export function ServicesDiagnosticCard() {
  const { language, showToast } = useApp();
  const isBn = language === 'BN';

  const [loading, setLoading] = useState(true);
  const [refreshingService, setRefreshingService] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showTroubleshootingGuide, setShowTroubleshootingGuide] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  const [services, setServices] = useState<Record<string, ServiceDiagnosticItem>>({
    supabase: {
      id: 'supabase',
      name: 'Supabase Database',
      nameBn: 'সুপাবেস ডাটাবেজ',
      provider: 'Supabase Cloud (PostgreSQL)',
      category: 'Relational DB & Realtime',
      categoryBn: 'রিলেশনাল ডাটাবেজ ও রিয়েলটাইম',
      connected: true,
      status: 'OPERATIONAL',
      details: 'Connected to Supabase endpoint (https://kisholoybd.supabase.co). Client responsive.',
      latencyMs: 6,
      troubleshootingTip: 'Verify SUPABASE_URL and SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.',
      troubleshootingTipBn: '.env ফাইলে SUPABASE_URL এবং SUPABASE_SERVICE_ROLE_KEY সঠিক আছে কিনা যাচাই করুন।',
    },
    firebase: {
      id: 'firebase',
      name: 'Firebase Admin & Firestore',
      nameBn: 'ফায়ারবেস অ্যাডমিন ও ফায়ারস্টোর',
      provider: 'Google Cloud Platform (kisholoybd)',
      category: 'Document DB & RBAC Auth',
      categoryBn: 'ডকুমেন্ট ডাটাবেজ ও আরব্যাক অথ',
      connected: true,
      status: 'OPERATIONAL',
      details: 'Firebase Admin SDK initialized with service account.',
      latencyMs: 29,
      troubleshootingTip: 'Ensure Cloud Firestore API is enabled in Google Cloud Console for project kisholoybd.',
      troubleshootingTipBn: 'গুগল ক্লাউড কনসোলে kisholoybd প্রজেক্টের জন্য ক্লাউড ফায়ারস্টোর এপিআই সক্রিয় আছে কিনা নিশ্চিত করুন।',
    },
    mongodb: {
      id: 'mongodb',
      name: 'MongoDB Atlas',
      nameBn: 'মঙ্গোডিবি অ্যাটলাস',
      provider: 'MongoDB Atlas (Cluster kisholoybd)',
      category: 'Persistence & Disaster Recovery',
      categoryBn: 'পারসিস্টেন্স ও ডিজাস্টার রিকভারি',
      connected: false,
      status: 'DEGRADED',
      details: 'Atlas cluster querySrv pending / whitelist (Verify 0.0.0.0/0 IP Access in Atlas)',
      latencyMs: 18,
      troubleshootingTip: 'Navigate to MongoDB Atlas -> Network Access -> Add IP Address -> Select Allow Access From Anywhere (0.0.0.0/0).',
      troubleshootingTipBn: 'মঙ্গোডিবি অ্যাটলাস ড্যাশবোর্ডে গিয়ে Network Access -> Add IP Address -> 0.0.0.0/0 (সব জায়গা থেকে অ্যাক্সেস) অনুমোদন করুন।',
    },
    redis: {
      id: 'redis',
      name: 'Upstash Redis',
      nameBn: 'আপস্ট্যাশ রেডিস',
      provider: 'Upstash Serverless Redis',
      category: 'Distributed Cache & Rate Limiting',
      categoryBn: 'ডিস্ট্রিবিউটেড ক্যাশ ও রেট লিমিটিং',
      connected: false,
      status: 'DEGRADED',
      details: 'Unexpected PING response: null (Verify REST token write permissions)',
      latencyMs: 24,
      troubleshootingTip: 'Verify UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Upstash Console.',
      troubleshootingTipBn: 'আপস্ট্যাশ কনসোল থেকে UPSTASH_REDIS_REST_URL এবং REST TOKEN টোকেনের পারমিশন যাচাই করুন।',
    },
  });

  const fetchFullDiagnostics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/integrations/status');
      const json = await res.json();

      if (json.success && json.data?.services) {
        const rawServices: any[] = json.data.services;

        setServices(prev => {
          const next = { ...prev };

          // Supabase
          const sb = rawServices.find(s => s.id === 'supabase');
          if (sb) {
            next.supabase = {
              ...next.supabase,
              connected: sb.connected || sb.status === 'OPERATIONAL',
              status: sb.connected || sb.status === 'OPERATIONAL' ? 'OPERATIONAL' : 'DEGRADED',
              details: sb.details || next.supabase.details,
              latencyMs: sb.latencyMs ?? next.supabase.latencyMs,
              lastChecked: sb.lastChecked,
              credentialsMasked: sb.credentialsMasked,
            };
          }

          // Firebase
          const fb = rawServices.find(s => s.id === 'firebase_admin' || s.id === 'firebase');
          if (fb) {
            next.firebase = {
              ...next.firebase,
              connected: fb.connected || fb.status === 'OPERATIONAL',
              status: fb.connected || fb.status === 'OPERATIONAL' ? 'OPERATIONAL' : 'DEGRADED',
              details: fb.details || next.firebase.details,
              latencyMs: fb.latencyMs ?? next.firebase.latencyMs,
              lastChecked: fb.lastChecked,
              credentialsMasked: fb.credentialsMasked,
            };
          }

          // MongoDB
          const mg = rawServices.find(s => s.id === 'mongodb');
          if (mg) {
            next.mongodb = {
              ...next.mongodb,
              connected: mg.connected,
              status: mg.connected ? 'OPERATIONAL' : 'DEGRADED',
              details: mg.details || next.mongodb.details,
              latencyMs: mg.latencyMs ?? next.mongodb.latencyMs,
              lastChecked: mg.lastChecked,
              credentialsMasked: mg.credentialsMasked,
            };
          }

          // Redis
          const rd = rawServices.find(s => s.id === 'upstash_redis' || s.id === 'redis');
          if (rd) {
            next.redis = {
              ...next.redis,
              connected: rd.connected,
              status: rd.connected ? 'OPERATIONAL' : 'DEGRADED',
              details: rd.details || next.redis.details,
              latencyMs: rd.latencyMs ?? next.redis.latencyMs,
              lastChecked: rd.lastChecked,
              credentialsMasked: rd.credentialsMasked,
            };
          }

          return next;
        });
      }

      setLastRefreshedAt(new Date().toLocaleTimeString());
    } catch (err) {
      console.warn('Diagnostics fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFullDiagnostics();
  }, [fetchFullDiagnostics]);

  const testSingleService = async (serviceId: 'supabase' | 'firebase' | 'mongodb' | 'redis') => {
    try {
      setRefreshingService(serviceId);

      let url = '';
      if (serviceId === 'supabase') url = '/api/services/supabase/verify';
      else if (serviceId === 'firebase') url = '/api/services/firebase/verify';
      else if (serviceId === 'mongodb') url = '/api/integrations/mongo/health';
      else if (serviceId === 'redis') url = '/api/integrations/redis/ping';

      const res = await fetch(url, { method: 'POST' });
      const json = await res.json();

      setServices(prev => {
        const item = { ...prev[serviceId] };
        if (serviceId === 'supabase' || serviceId === 'firebase') {
          item.connected = json.success;
          item.status = json.success ? 'OPERATIONAL' : 'DEGRADED';
          item.details = json.data?.details || item.details;
          item.latencyMs = json.data?.latencyMs ?? item.latencyMs;
          item.credentialsMasked = json.data?.credentialsMasked ?? item.credentialsMasked;
        } else if (serviceId === 'mongodb') {
          item.connected = json.success;
          item.status = json.success ? 'OPERATIONAL' : 'DEGRADED';
          item.details = json.data?.error || (json.success ? 'Connected to MongoDB Atlas' : item.details);
          item.latencyMs = json.data?.latencyMs ?? item.latencyMs;
        } else if (serviceId === 'redis') {
          item.connected = json.success;
          item.status = json.success ? 'OPERATIONAL' : 'DEGRADED';
          item.details = json.data?.error || (json.success ? 'PONG received from Upstash' : item.details);
          item.latencyMs = json.data?.latencyMs ?? item.latencyMs;
        }
        item.lastChecked = new Date().toISOString();
        return { ...prev, [serviceId]: item };
      });

      if (json.success) {
        showToast(isBn ? `${services[serviceId].nameBn} সফলভাবে কানেক্টেড!` : `${services[serviceId].name} verified successfully!`);
      } else {
        showToast(isBn ? `${services[serviceId].nameBn} সমস্যা: ত্রুটি শনাক্ত হয়েছে` : `${services[serviceId].name} check: issue detected`);
      }
    } catch (err: any) {
      showToast(err.message || 'Verification failed');
    } finally {
      setRefreshingService(null);
    }
  };

  const copyDiagnosticReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      reportGeneratedBy: 'Kisholoy Admin Diagnostic Engine',
      services: Object.values(services).map(s => ({
        id: s.id,
        name: s.name,
        connected: s.connected,
        status: s.status,
        latencyMs: s.latencyMs,
        details: s.details,
        credentials: s.credentialsMasked || 'configured',
      })),
    };

    navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => {
      setCopied(true);
      showToast(isBn ? 'ডায়াগনস্টিক রিপোর্ট ক্লিপবোর্ডে কপি করা হয়েছে!' : 'Diagnostic report copied to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const operationalCount = Object.values(services).filter(s => s.connected).length;
  const totalCount = Object.keys(services).length;
  const allHealthy = operationalCount === totalCount;

  return (
    <div 
      id="admin-services-diagnostic-widget" 
      className="bg-white dark:bg-slate-800 rounded-2xl border border-stone-200/90 dark:border-slate-700 shadow-xs p-5 sm:p-6 space-y-5 transition-all"
    >
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="p-1.5 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/80">
              <Cpu className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            </span>
            <h2 className="text-base sm:text-lg font-serif font-black text-stone-900 dark:text-white tracking-tight">
              {isBn ? 'ক্লাউড ডাটাবেজ ও ক্যাশ ডায়াগনস্টিক' : 'Cloud Database & Cache Diagnostics'}
            </h2>
            
            {/* Health Status Pill */}
            <div 
              id="diagnostic-overall-health-badge"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-mono tracking-tight border ${
                allHealthy 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/80' 
                  : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/80'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${allHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>
                {operationalCount} / {totalCount} {isBn ? 'সক্রিয়' : 'Operational'}
              </span>
            </div>
          </div>
          
          <p className="text-xs text-stone-500 dark:text-slate-400">
            {isBn 
              ? 'সুপাবেস, ফায়ারবেস, মঙ্গোডিবি এবং রেডিস সংযোগের লাইভ স্ট্যাটাস মনিটর ও ট্রাবলশুটিং টুল।'
              : 'Live health status indicators and troubleshooting tool for Supabase, Firebase, MongoDB, and Redis.'}
          </p>
        </div>

        {/* Global Diagnostic Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            id="diagnostic-copy-report-btn"
            type="button"
            onClick={copyDiagnosticReport}
            className="px-3 py-2 text-xs font-bold text-stone-700 dark:text-slate-200 bg-stone-100 dark:bg-slate-700 hover:bg-stone-200 dark:hover:bg-slate-600 rounded-xl transition-all flex items-center gap-1.5 border border-stone-200 dark:border-slate-600"
            title={isBn ? 'ডায়াগনস্টিক রিপোর্ট কপি করুন' : 'Copy diagnostic report JSON'}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-stone-500 dark:text-slate-400" />}
            <span>{copied ? (isBn ? 'কপি হয়েছে' : 'Copied') : (isBn ? 'কপি রিপোর্ট' : 'Copy JSON')}</span>
          </button>

          <button
            id="diagnostic-run-all-btn"
            type="button"
            onClick={fetchFullDiagnostics}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-bold text-white bg-teal-900 hover:bg-teal-950 dark:bg-teal-800 dark:hover:bg-teal-700 rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-teal-300 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? (isBn ? 'যাচাই হচ্ছে...' : 'Verifying...') : (isBn ? 'সবগুলো যাচাই করুন' : 'Run Diagnostics')}</span>
          </button>
        </div>
      </div>

      {/* 4 Core Services Diagnostic Grid */}
      <div 
        id="diagnostic-services-grid" 
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4"
      >
        {Object.values(services).map((service) => {
          const isServiceRefreshing = refreshingService === service.id;
          const isOperational = service.connected;

          return (
            <div
              key={service.id}
              id={`diagnostic-service-${service.id}`}
              className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                isOperational
                  ? 'bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200 dark:border-emerald-800/60 shadow-2xs'
                  : 'bg-rose-50/40 dark:bg-rose-950/15 border-rose-200 dark:border-rose-900/60 shadow-2xs'
              }`}
            >
              <div className="space-y-3">
                {/* Header: Service Icon + Green/Red Indicator */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg border ${
                      isOperational
                        ? 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-800'
                        : 'bg-rose-100/70 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-300/80 dark:border-rose-800'
                    }`}>
                      {service.id === 'supabase' && <Database className="w-4 h-4" />}
                      {service.id === 'firebase' && <Flame className="w-4 h-4" />}
                      {service.id === 'mongodb' && <Database className="w-4 h-4" />}
                      {service.id === 'redis' && <Zap className="w-4 h-4" />}
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-stone-900 dark:text-white leading-tight">
                        {isBn ? service.nameBn : service.name}
                      </h3>
                      <p className="text-[10px] text-stone-500 dark:text-slate-400 font-medium">
                        {isBn ? service.categoryBn : service.category}
                      </p>
                    </div>
                  </div>

                  {/* Red/Green Status Indicator Light */}
                  <div className="flex items-center gap-1.5 shrink-0" title={isOperational ? 'Connected & Operational' : 'Attention Needed / Disconnected'}>
                    <span className="relative flex h-3 w-3">
                      {isOperational ? (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </>
                      ) : (
                        <>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Status Badge + Latency */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span 
                    id={`status-badge-${service.id}`}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-bold tracking-tight border ${
                      isOperational
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                        : 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800'
                    }`}
                  >
                    {isOperational ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                        <span>{isBn ? 'সক্রিয়' : 'OPERATIONAL'}</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                        <span>{isBn ? 'ত্রুটি / অফলাইন' : 'ATTENTION'}</span>
                      </>
                    )}
                  </span>

                  {service.latencyMs !== undefined && (
                    <span className="text-[11px] font-mono font-bold text-stone-500 dark:text-slate-400 bg-stone-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                      {service.latencyMs}ms
                    </span>
                  )}
                </div>

                {/* Diagnostic Message */}
                <div className="bg-white/80 dark:bg-slate-900/60 p-2.5 rounded-lg border border-stone-200/80 dark:border-slate-700/80 text-[11px] leading-relaxed">
                  <div className="font-mono text-stone-700 dark:text-slate-300 break-words line-clamp-3" title={service.details}>
                    {service.details}
                  </div>
                </div>
              </div>

              {/* Card Footer: Verify Single Service Button */}
              <div className="pt-3 border-t border-stone-200/60 dark:border-slate-700/60 flex items-center justify-between gap-2 mt-3">
                <span className="text-[10px] text-stone-400 dark:text-slate-500 font-mono truncate">
                  {service.credentialsMasked || service.provider}
                </span>

                <button
                  id={`btn-ping-${service.id}`}
                  type="button"
                  onClick={() => testSingleService(service.id)}
                  disabled={isServiceRefreshing}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 ${
                    isOperational
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                      : 'bg-rose-600 hover:bg-rose-700 text-white shadow-2xs'
                  } disabled:opacity-50`}
                >
                  <RefreshCw className={`w-3 h-3 ${isServiceRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isServiceRefreshing ? (isBn ? 'চেক...' : 'Ping...') : (isBn ? 'পিং' : 'Ping')}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Troubleshooting Collapsible Drawer */}
      <div className="border-t border-stone-200/80 dark:border-slate-700/80 pt-3">
        <button
          id="diagnostic-toggle-guide-btn"
          type="button"
          onClick={() => setShowTroubleshootingGuide(prev => !prev)}
          className="text-xs font-bold text-stone-600 dark:text-slate-300 hover:text-teal-800 dark:hover:text-teal-300 flex items-center gap-1.5 transition-colors"
        >
          <Info className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
          <span>
            {isBn ? 'লাইভ ট্রাবলশুটিং গাইড ও সমাধান নির্দেশনা' : 'Live Troubleshooting Guide & Resolution Tips'}
          </span>
          {showTroubleshootingGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showTroubleshootingGuide && (
          <div 
            id="diagnostic-guide-content"
            className="mt-3 bg-stone-50 dark:bg-slate-900/80 p-4 rounded-xl border border-stone-200 dark:border-slate-700 space-y-3 text-xs animate-in fade-in duration-200"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.values(services).map(s => (
                <div key={s.id} className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-stone-200/90 dark:border-slate-700 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-stone-900 dark:text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.connected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      {isBn ? s.nameBn : s.name}
                    </span>
                    <span className="text-[10px] font-mono text-stone-400">{s.id.toUpperCase()}</span>
                  </div>
                  <p className="text-[11px] text-stone-600 dark:text-slate-300 leading-relaxed">
                    {isBn ? s.troubleshootingTipBn : s.troubleshootingTip}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between text-[11px] text-stone-500 dark:text-slate-400 pt-2 border-t border-stone-200/80 dark:border-slate-700/80 gap-2">
              <span className="flex items-center gap-1">
                <Terminal className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                <span>Backend Health Source: <code>/api/integrations/status</code> & <code>/api/services/status</code></span>
              </span>
              {lastRefreshedAt && (
                <span>
                  {isBn ? `সর্বশেষ আপডেট: ${lastRefreshedAt}` : `Last checked: ${lastRefreshedAt}`}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
