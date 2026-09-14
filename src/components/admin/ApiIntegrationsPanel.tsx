import React, { useState, useEffect } from 'react';
import { 
  Server, RefreshCw, Send, CheckCircle2, AlertTriangle, 
  ExternalLink, Mail, Database, ShieldCheck, GitBranch, 
  Cloud, Activity, Zap
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface ServiceStatus {
  id: string;
  name: string;
  category: 'DATABASE' | 'CACHE' | 'EMAIL' | 'DEPLOYMENT' | 'VCS' | 'MONITORING' | 'AUTH';
  connected: boolean;
  status: 'OPERATIONAL' | 'CONFIGURED' | 'DEGRADED' | 'DISABLED';
  details: string;
  latencyMs?: number;
  lastChecked: string;
  credentialsMasked: string;
}

interface IntegrationsData {
  timestamp: string;
  allHealthy: boolean;
  services: ServiceStatus[];
}

export function ApiIntegrationsPanel() {
  const { language, showToast } = useApp();
  const isBn = language === 'BN';

  const [data, setData] = useState<IntegrationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testingRedis, setTestingRedis] = useState(false);
  const [testingMongo, setTestingMongo] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/integrations/status');
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (err) {
      console.warn('Failed to fetch integrations status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleTestEmail = async () => {
    try {
      setTestingEmail(true);
      const res = await fetch('/api/integrations/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No recipient baked into the bundle: the server mails the configured
        // SYSTEM_ADMIN_EMAIL and answers 422 (bilingual) when that is unset, which
        // the failure branch below already surfaces in a toast.
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        showToast(isBn ? 'টেস্ট ইমেইল সফলভাবে পাঠানো হয়েছে!' : 'Test email dispatched successfully via Resend!');
      } else {
        showToast(isBn ? `ইমেইল ব্যর্থ: ${json.error || 'অজানা সমস্যা'}` : `Email failed: ${json.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestRedis = async () => {
    try {
      setTestingRedis(true);
      const res = await fetch('/api/integrations/redis/ping', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showToast(isBn ? `Upstash Redis PONG! (${json.data?.latencyMs}ms)` : `Upstash Redis PONG! (${json.data?.latencyMs}ms)`);
        fetchStatus();
      } else {
        showToast(isBn ? `Redis পিং ব্যর্থ: ${json.data?.error || json.error}` : `Redis ping failed`);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setTestingRedis(false);
    }
  };

  const handleTestMongo = async () => {
    try {
      setTestingMongo(true);
      const res = await fetch('/api/integrations/mongo/health', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        showToast(isBn ? `MongoDB Atlas সংযুক্ত! (${json.data?.collectionsCount || 0} কালেকশন, ${json.data?.latencyMs}ms)` : `MongoDB Connected (${json.data?.latencyMs}ms)`);
        fetchStatus();
      } else {
        showToast(isBn ? `MongoDB ত্রুটি: ${json.data?.error || json.error}` : `MongoDB error`);
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setTestingMongo(false);
    }
  };

  const getCategoryIcon = (category: ServiceStatus['category']) => {
    switch (category) {
      case 'EMAIL':
        return <Mail className="w-4 h-4 text-emerald-600" />;
      case 'CACHE':
        return <Zap className="w-4 h-4 text-amber-600" />;
      case 'DATABASE':
        return <Database className="w-4 h-4 text-sky-600" />;
      case 'AUTH':
        return <ShieldCheck className="w-4 h-4 text-teal-700" />;
      case 'VCS':
        return <GitBranch className="w-4 h-4 text-purple-600" />;
      case 'DEPLOYMENT':
        return <Cloud className="w-4 h-4 text-blue-600" />;
      case 'MONITORING':
        return <Activity className="w-4 h-4 text-rose-600" />;
      default:
        return <Server className="w-4 h-4 text-stone-600" />;
    }
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-100 dark:border-stone-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              {isBn ? 'লাইভ ক্লাউড সার্ভিস' : 'LIVE PRODUCTION INTEGRATIONS'}
            </span>
            <h3 className="text-base font-serif font-bold text-stone-900 dark:text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-teal-800" />
              {isBn ? 'এপিআই ও বাহ্যিক ক্লাউড সংযোগসমূহ' : 'Cloud Infrastructure & API Integrations'}
            </h3>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-2xl">
            {isBn 
              ? 'কিশলয়ের লাইভ প্রোডাকশন সার্ভিস: Resend ইমেইল গেটওয়ে, Upstash Redis, MongoDB Atlas, Firebase Service Account, GitHub, Render ও Sentry সংযোগ।'
              : 'Live production connections: Resend Email, Upstash Redis, MongoDB Atlas, Firebase Service Account, GitHub, Render, and Sentry.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="refresh-integrations-status"
            onClick={fetchStatus}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-50 dark:hover:bg-stone-800 text-xs font-medium text-stone-700 dark:text-stone-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {isBn ? 'রিফ্রেশ' : 'Refresh'}
          </button>

          <button
            type="button"
            id="dispatch-test-email"
            onClick={handleTestEmail}
            disabled={testingEmail}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-900 hover:bg-teal-800 text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
          >
            <Send className={`w-3.5 h-3.5 ${testingEmail ? 'animate-pulse' : ''}`} />
            {isBn ? 'টেস্ট ইমেইল পাঠান' : 'Send Test Email'}
          </button>
        </div>
      </div>

      {/* Action shortcuts bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-stone-50 dark:bg-stone-850 rounded-lg border border-stone-200 dark:border-stone-800 text-xs">
        <span className="font-bold text-stone-700 dark:text-stone-300 text-[11px] uppercase tracking-wider">
          {isBn ? 'লাইভ টেস্ট টুলস:' : 'Quick Connectivity Checks:'}
        </span>
        <button
          type="button"
          onClick={handleTestRedis}
          disabled={testingRedis}
          className="px-2.5 py-1 rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 font-mono text-[11px] text-stone-800 dark:text-stone-200 hover:border-amber-400 flex items-center gap-1 disabled:opacity-50"
        >
          <Zap className="w-3 h-3 text-amber-500" />
          {isBn ? 'Redis পিং' : 'Ping Upstash Redis'}
        </button>
        <button
          type="button"
          onClick={handleTestMongo}
          disabled={testingMongo}
          className="px-2.5 py-1 rounded bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 font-mono text-[11px] text-stone-800 dark:text-stone-200 hover:border-sky-400 flex items-center gap-1 disabled:opacity-50"
        >
          <Database className="w-3 h-3 text-sky-500" />
          {isBn ? 'MongoDB চেক' : 'Check MongoDB'}
        </button>
        <span className="text-stone-400 text-xs">|</span>
        <span className="text-stone-600 dark:text-stone-400 text-[11px]">
          {isBn ? 'অফিসিয়াল সিস্টেম মেইল:' : 'Official Admin Email:'}{' '}
          <strong className="text-stone-500 dark:text-stone-400 font-mono">
            {isBn ? 'ডিপ্লয়মেন্ট এনভায়রনমেন্টে সংরক্ষিত (SYSTEM_ADMIN_EMAIL)' : 'set in the deployment environment (SYSTEM_ADMIN_EMAIL)'}
          </strong>
        </span>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data?.services?.map((srv) => (
          <div
            key={srv.id}
            className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-850 hover:border-teal-700/50 transition-colors space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-stone-100 dark:bg-stone-800 shrink-0">
                  {getCategoryIcon(srv.category)}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-stone-900 dark:text-white leading-tight">
                    {srv.name}
                  </h4>
                  <span className="text-[10px] text-stone-500 dark:text-stone-400 font-mono">
                    {srv.category} • {srv.credentialsMasked}
                  </span>
                </div>
              </div>

              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase shrink-0 ${
                  srv.status === 'OPERATIONAL'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                    : srv.status === 'CONFIGURED'
                    ? 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800'
                    : srv.status === 'DEGRADED'
                    ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                    : 'bg-stone-100 text-stone-600 border border-stone-200 dark:bg-stone-800 dark:text-stone-400'
                }`}
              >
                {srv.status === 'OPERATIONAL' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                {srv.status === 'DEGRADED' && <AlertTriangle className="w-3 h-3 text-amber-600" />}
                {srv.status}
              </span>
            </div>

            <p className="text-[11px] text-stone-600 dark:text-stone-300 leading-relaxed">
              {srv.details}
            </p>

            {srv.latencyMs !== undefined && srv.latencyMs > 0 && (
              <div className="flex items-center justify-between text-[10px] font-mono text-stone-400 pt-1 border-t border-stone-100 dark:border-stone-800">
                <span>{isBn ? 'লেটেন্সি' : 'Latency'}: {srv.latencyMs}ms</span>
                <span>{new Date(srv.lastChecked).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
