'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  role: string;
  division: string;
  is_active: boolean;
  created_at: string;
  first_name: string;
  last_name: string;
  phone: string;
  city: string;
  state: string;
  zip_code: string;
  address: string;
  region_id: string | null;
  has_coordinates: boolean;
  background_check_completed: boolean;
  background_check_date: string | null;
  onboarding_submitted: boolean;
  onboarding_approved: boolean;
  onboarding_submitted_at: string | null;
  onboarding_approved_at: string | null;
}

interface UsersReport {
  total: number;
  active: number;
  inactive: number;
  background_check_completed: number;
  onboarding_approved: number;
  by_role: Record<string, number>;
  by_state: Record<string, number>;
  by_division: Record<string, number>;
  rows: UserRow[];
}

interface EventRow {
  id: string;
  event_name: string;
  artist: string;
  venue: string;
  city: string;
  state: string;
  event_date: string;
  start_time: string;
  end_time: string;
  ticket_sales: number | null;
  ticket_count: number | null;
  commission_pool: number | null;
  tax_rate_percent: number | null;
  required_staff: number | null;
  confirmed_staff: number | null;
  assigned_staff: number;
  is_active: boolean;
  created_at: string;
  artist_share_percent: number;
  venue_share_percent: number;
  pds_share_percent: number;
}

interface EventsReport {
  total: number;
  active: number;
  total_ticket_sales: number;
  total_commission_pool: number;
  rows: EventRow[];
}

interface TimeReport {
  total_shifts: number;
  total_hours: number;
  unique_workers: number;
  hours_by_user: Record<string, number>;
  shifts_by_user: [string, number][];
  hours_by_event: Record<string, number>;
  workers_by_event: Record<string, number>;
}

interface BackgroundReport {
  total: number;
  completed: number;
  pending: number;
  rows: any[];
}

interface LoginRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  last_sign_in_at: string | null;
  created_at: string | null;
}

interface LoginsReport {
  total: number;
  logged_in_recently: number;
  rows: LoginRow[];
}

interface ReportData {
  users?: UsersReport;
  events?: EventsReport;
  time?: TimeReport;
  background?: BackgroundReport;
  logins?: LoginsReport;
  regions?: { id: string; name: string; is_active: boolean }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtHours(h: number): string {
  return `${h.toFixed(1)} hrs`;
}

function exportCSV(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const escape = (v: string | number | boolean | null | undefined) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────────────

type ActiveTab = 'overview' | 'users' | 'events' | 'time' | 'background' | 'login';

export default function ReportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadingLoginExcel, setDownloadingLoginExcel] = useState(false);

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [eventSearch, setEventSearch] = useState('');
  const [loginSearch, setLoginSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const params = new URLSearchParams({ section: 'all' });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (stateFilter && stateFilter !== 'all') params.set('state', stateFilter);

      const res = await fetch(`/api/reports?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 403) { setError('Access denied. This page is for managers, HR, and supervisors only.'); setLoading(false); return; }
        throw new Error(json.error || 'Failed to load report data');
      }
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Unexpected error');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, stateFilter, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filtered user rows ───────────────────────────────────────────────────
  const filteredUsers = (data?.users?.rows || []).filter(u => {
    const term = userSearch.toLowerCase();
    const matchSearch = !term || `${u.first_name} ${u.last_name} ${u.email} ${u.state} ${u.city}`.toLowerCase().includes(term);
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const filteredEvents = (data?.events?.rows || []).filter(e => {
    const term = eventSearch.toLowerCase();
    return !term || `${e.event_name} ${e.venue} ${e.artist} ${e.city} ${e.state}`.toLowerCase().includes(term);
  });

  const filteredLogins = (data?.logins?.rows || []).filter(r => {
    const term = loginSearch.toLowerCase();
    return !term || `${r.first_name} ${r.last_name} ${r.email} ${r.role}`.toLowerCase().includes(term);
  });

  // Build user name lookup for time section
  const userNameById = new Map<string, string>();
  (data?.users?.rows || []).forEach(u => {
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
    userNameById.set(u.id, name);
  });

  // Build event name lookup for time section
  const eventNameById = new Map<string, string>();
  (data?.events?.rows || []).forEach(e => {
    eventNameById.set(e.id, e.event_name || e.venue || e.id);
  });

  // Top workers by hours
  const topWorkers = Object.entries(data?.time?.hours_by_user || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Top events by hours
  const topEventsByHours = Object.entries(data?.time?.hours_by_event || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const regions = data?.regions || [];
  const regionNameById = new Map(regions.map(r => [r.id, r.name]));

  // ── Export handlers ──────────────────────────────────────────────────────
  const exportUsers = () => {
    exportCSV('users-report.csv',
      ['ID', 'First Name', 'Last Name', 'Email', 'Role', 'Division', 'Active', 'State', 'City', 'Zip', 'Phone', 'Address', 'Region', 'Has Coordinates', 'Background Check', 'BG Check Date', 'Onboarding Submitted', 'Onboarding Approved', 'Joined'],
      filteredUsers.map(u => [
        u.id, u.first_name, u.last_name, u.email, u.role, u.division, u.is_active,
        u.state, u.city, u.zip_code, u.phone, u.address,
        u.region_id ? regionNameById.get(u.region_id) || u.region_id : '',
        u.has_coordinates,
        u.background_check_completed, u.background_check_date || '',
        u.onboarding_submitted, u.onboarding_approved,
        fmtDate(u.created_at),
      ])
    );
  };

  const exportEvents = () => {
    exportCSV('events-report.csv',
      ['ID', 'Event Name', 'Artist', 'Venue', 'City', 'State', 'Date', 'Start', 'End', 'Ticket Sales', 'Ticket Count', 'Commission Pool', 'Tips Total', 'Tax Rate %', 'Required Staff', 'Confirmed Staff', 'Assigned Staff', 'Artist Share %', 'Venue Share %', 'PDS Share %', 'Active'],
      filteredEvents.map(e => [
        e.id, e.event_name, e.artist, e.venue, e.city, e.state, e.event_date, e.start_time, e.end_time,
        e.ticket_sales ?? '', e.ticket_count ?? '', e.commission_pool ?? '',
        e.tax_rate_percent ?? '', e.required_staff ?? '', e.confirmed_staff ?? '', e.assigned_staff,
        e.artist_share_percent, e.venue_share_percent, e.pds_share_percent, e.is_active,
      ])
    );
  };

  const downloadUserExcel = async (userId: string) => {
    setDownloading(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/reports/user-export?userId=${userId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || `user_${userId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  const downloadSelectedUsers = async () => {
    for (const uid of Array.from(selectedUsers)) {
      await downloadUserExcel(uid);
    }
  };

  const toggleUser = (id: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllUsers = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const exportHours = () => {
    exportCSV('hours-report.csv',
      ['User ID', 'Name', 'Total Hours', 'Total Shifts'],
      topWorkers.map(([uid, hrs]) => [
        uid,
        userNameById.get(uid) || uid,
        hrs.toFixed(2),
        (data?.time?.shifts_by_user as any)?.[uid] || '',
      ])
    );
  };

  const downloadLoginExcel = async () => {
    setDownloadingLoginExcel(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/reports/login-export', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || 'Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'login-sheet.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingLoginExcel(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="liquid-card-compact p-8 animate-scale-in text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-transparent border-t-ios-blue mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading report data...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="liquid-card p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86A2 2 0 0021 16.93L14.07 5.07a2 2 0 00-3.14 0L3.07 16.93A2 2 0 005.07 19z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Access Error</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button onClick={() => router.back()} className="liquid-btn-glass liquid-btn-sm">Go Back</button>
        </div>
      </main>
    );
  }

  const tabs: { id: ActiveTab; label: string; count?: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users', count: String(data?.users?.total || 0) },
    { id: 'events', label: 'Events', count: String(data?.events?.total || 0) },
    { id: 'time', label: 'Time & Hours', count: fmtHours(data?.time?.total_hours || 0) },
    { id: 'background', label: 'Background Checks', count: String(data?.background?.total || 0) },
    { id: 'login', label: 'Login Sheet', count: String(data?.logins?.total || 0) },
  ];

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="liquid-badge-blue text-xs px-3 py-1 mb-3 inline-block">Reports</div>
            <h1 className="text-4xl font-bold text-gray-900 keeping-apple-tight">Data Reports</h1>
            <p className="text-gray-500 mt-1 text-sm">All user, event, and operational data</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/reports/availability-by-region"
              className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 01.553-.894L9 2m0 18l6-3m-6 3V2m6 15l5.447-2.724A1 1 0 0021 13.382V2.618a1 1 0 00-.553-.894L15 0m0 17V0m0 0L9 2" />
              </svg>
              Region Availability
            </Link>
            <Link
              href="/reports/attestation-rejections"
              className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h3m5 4H7a2 2 0 01-2-2V6a2 2 0 012-2h5l5 5v9a2 2 0 01-2 2z" />
              </svg>
              Attestation Rejections
            </Link>
            <button
              onClick={() => router.back()}
              className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <button
              onClick={fetchData}
              className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Global Filters */}
        <div className="liquid-card p-4 mb-6">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">State</label>
              <select
                value={stateFilter}
                onChange={e => setStateFilter(e.target.value)}
                className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
              >
                <option value="all">All States</option>
                {Object.keys(data?.users?.by_state || {}).sort().map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            {(fromDate || toDate || stateFilter !== 'all') && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); setStateFilter('all'); }}
                className="liquid-btn-glass liquid-btn-sm text-gray-600"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 flex-wrap">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-liquid text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? 'bg-ios-blue text-white shadow-liquid-glow'
                  : 'bg-white/60 text-gray-600 hover:bg-white/90 hover:text-gray-900'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Users" value={data?.users?.total ?? 0} sub={`${data?.users?.active ?? 0} active`} color="blue" />
              <StatCard label="Total Events" value={data?.events?.total ?? 0} sub={`${data?.events?.active ?? 0} active`} color="purple" />
              <StatCard label="Total Hours Worked" value={`${(data?.time?.total_hours ?? 0).toFixed(0)}`} sub={`${data?.time?.total_shifts ?? 0} shifts`} color="teal" />
              <StatCard label="Ticket Revenue" value={fmtCurrency(data?.events?.total_ticket_sales)} sub={`${fmtCurrency(data?.events?.total_commission_pool)} commission`} color="orange" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="BG Checks Complete" value={data?.users?.background_check_completed ?? 0} sub={`of ${data?.users?.total ?? 0} users`} color="green" />
              <StatCard label="Onboarding Approved" value={data?.users?.onboarding_approved ?? 0} sub={`of ${data?.users?.total ?? 0} users`} color="blue" />
              <StatCard label="Unique Workers" value={data?.time?.unique_workers ?? 0} sub="logged hours" color="purple" />
              <StatCard label="Regions" value={regions.filter(r => r.is_active).length} sub={`${regions.length} total`} color="teal" />
            </div>

            {/* Users by Role */}
            <div className="grid md:grid-cols-3 gap-6">
              <div className="liquid-card p-5">
                <h3 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wide">Users by Role</h3>
                <div className="space-y-3">
                  {Object.entries(data?.users?.by_role || {}).sort((a, b) => b[1] - a[1]).map(([role, count]) => (
                    <BarRow key={role} label={role} value={count} total={data?.users?.total || 1} />
                  ))}
                </div>
              </div>

              <div className="liquid-card p-5">
                <h3 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wide">Users by State</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {Object.entries(data?.users?.by_state || {}).sort((a, b) => b[1] - a[1]).map(([state, count]) => (
                    <BarRow key={state} label={state} value={count} total={data?.users?.total || 1} />
                  ))}
                </div>
              </div>

              <div className="liquid-card p-5">
                <h3 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wide">Users by Division</h3>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {Object.entries(data?.users?.by_division || {}).sort((a, b) => b[1] - a[1]).map(([div, count]) => (
                    <BarRow key={div} label={div || 'unset'} value={count} total={data?.users?.total || 1} />
                  ))}
                </div>
              </div>
            </div>

            {/* Top Workers */}
            {topWorkers.length > 0 && (
              <div className="liquid-card p-5">
                <h3 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wide">Top Workers by Hours</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {topWorkers.slice(0, 9).map(([uid, hrs], idx) => (
                    <div key={uid} className="flex items-center gap-3 p-3 bg-white/50 rounded-liquid">
                      <span className="text-xs font-bold text-gray-400 w-5 text-right">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{userNameById.get(uid) || uid.slice(0, 8)}</p>
                      </div>
                      <span className="text-sm font-bold text-ios-blue whitespace-nowrap">{fmtHours(hrs)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── USERS TAB ────────────────────────────────────────────────────── */}
        {activeTab === 'users' && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-3 flex-wrap">
                <input
                  type="text"
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30 w-56"
                />
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30"
                >
                  <option value="all">All Roles</option>
                  {Object.keys(data?.users?.by_role || {}).sort().map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-500">{filteredUsers.length} users</span>
                {selectedUsers.size > 0 && (
                  <button
                    onClick={downloadSelectedUsers}
                    disabled={!!downloading}
                    className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  >
                    {downloading ? (
                      <span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    Download {selectedUsers.size} Excel {selectedUsers.size === 1 ? 'File' : 'Files'}
                  </button>
                )}
                <button onClick={exportUsers} className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>

            <div className="liquid-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={filteredUsers.length > 0 && selectedUsers.size === filteredUsers.length}
                          onChange={toggleAllUsers}
                          className="rounded border-gray-300 text-ios-blue focus:ring-ios-blue/30"
                        />
                      </th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Email</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Role</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Division</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">State</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">City</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Phone</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Region</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Active</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">BG Check</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Onboarding</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Joined</th>
                      <th className="px-4 py-3 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredUsers.map(u => (
                      <tr key={u.id} className={`hover:bg-white/60 transition-colors ${selectedUsers.has(u.id) ? 'bg-blue-50/50' : ''}`}>
                        <td className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={selectedUsers.has(u.id)}
                            onChange={() => toggleUser(u.id)}
                            className="rounded border-gray-300 text-ios-blue focus:ring-ios-blue/30"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.email || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 capitalize">{u.role || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.division || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.state || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.city || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{u.phone || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                          {u.region_id ? (regionNameById.get(u.region_id) || u.region_id.slice(0, 8)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusDot active={u.is_active} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusDot active={u.background_check_completed} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {u.onboarding_approved
                            ? <span className="text-xs font-semibold text-green-600">Approved</span>
                            : u.onboarding_submitted
                            ? <span className="text-xs font-semibold text-yellow-600">Pending</span>
                            : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => downloadUserExcel(u.id)}
                            disabled={downloading === u.id}
                            title="Download Excel"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-liquid hover:bg-green-50 text-gray-400 hover:text-green-600 transition-colors"
                          >
                            {downloading === u.id
                              ? <span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            }
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── EVENTS TAB ───────────────────────────────────────────────────── */}
        {activeTab === 'events' && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <input
                type="text"
                placeholder="Search events..."
                value={eventSearch}
                onChange={e => setEventSearch(e.target.value)}
                className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30 w-56"
              />
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{filteredEvents.length} events</span>
                <button onClick={exportEvents} className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>

            <div className="liquid-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Event Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Artist</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Venue</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">City / State</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Date</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Ticket Sales</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Commission Pool</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Req. Staff</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Assigned</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600 whitespace-nowrap">Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredEvents.map(e => (
                      <tr key={e.id} className="hover:bg-white/60 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap max-w-xs truncate">{e.event_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{e.artist || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap max-w-xs truncate">{e.venue || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{[e.city, e.state].filter(Boolean).join(', ') || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(e.event_date)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtCurrency(e.ticket_sales)}</td>
                        <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{fmtCurrency(e.commission_pool)}</td>
                        <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{e.required_staff ?? '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className={`font-semibold ${e.assigned_staff >= (e.required_staff || 0) ? 'text-green-600' : 'text-yellow-600'}`}>
                            {e.assigned_staff}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center"><StatusDot active={e.is_active} /></td>
                      </tr>
                    ))}
                    {filteredEvents.length === 0 && (
                      <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No events found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TIME & HOURS TAB ─────────────────────────────────────────────── */}
        {activeTab === 'time' && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Shifts" value={data?.time?.total_shifts ?? 0} color="blue" />
              <StatCard label="Total Hours" value={`${(data?.time?.total_hours ?? 0).toFixed(1)}`} color="teal" />
              <StatCard label="Unique Workers" value={data?.time?.unique_workers ?? 0} color="purple" />
              <StatCard label="Avg Hours / Worker" value={data?.time?.unique_workers ? ((data?.time?.total_hours ?? 0) / data.time.unique_workers).toFixed(1) : '—'} color="orange" />
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="liquid-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wide">Hours by Worker</h3>
                  <button onClick={exportHours} className="liquid-btn-glass liquid-btn-sm text-xs inline-flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    CSV
                  </button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {topWorkers.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No time data for this period</p>}
                  {topWorkers.map(([uid, hrs], idx) => (
                    <div key={uid} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-5 text-right shrink-0">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-xs font-medium text-gray-900 truncate">{userNameById.get(uid) || uid.slice(0, 8)}</span>
                          <span className="text-xs font-bold text-ios-blue ml-2 shrink-0">{fmtHours(hrs)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-ios-blue to-ios-indigo rounded-full"
                            style={{ width: `${Math.min(100, (hrs / (topWorkers[0]?.[1] || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="liquid-card p-5">
                <h3 className="font-bold text-gray-900 mb-4 text-sm uppercase tracking-wide">Hours by Event</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {topEventsByHours.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No event time data for this period</p>}
                  {topEventsByHours.map(([eid, hrs], idx) => (
                    <div key={eid} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-5 text-right shrink-0">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-xs font-medium text-gray-900 truncate">{eventNameById.get(eid) || eid.slice(0, 8)}</span>
                          <span className="text-xs font-bold text-ios-teal ml-2 shrink-0">{fmtHours(hrs)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-ios-teal to-ios-blue rounded-full"
                            style={{ width: `${Math.min(100, (hrs / (topEventsByHours[0]?.[1] || 1)) * 100)}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{data?.time?.workers_by_event?.[eid] ?? 0} workers</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── BACKGROUND CHECKS TAB ────────────────────────────────────────── */}
        {activeTab === 'background' && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Total" value={data?.background?.total ?? 0} color="blue" />
              <StatCard label="Completed" value={data?.background?.completed ?? 0} color="green" />
              <StatCard label="Pending" value={data?.background?.pending ?? 0} color="orange" />
            </div>

            {/* Combined user table with BG check status */}
            <div className="liquid-card overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wide">User Background Check Status</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Role</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">BG Check</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Completed Date</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Onboarding</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.users?.rows || [])
                      .filter(u => u.role === 'worker' || u.role === 'vendor')
                      .map(u => (
                        <tr key={u.id} className="hover:bg-white/60 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                            {[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{u.email}</td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 capitalize">{u.role}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusDot active={u.background_check_completed} label={u.background_check_completed ? 'Done' : 'Pending'} />
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(u.background_check_date)}</td>
                          <td className="px-4 py-3 text-center">
                            {u.onboarding_approved
                              ? <span className="text-xs font-semibold text-green-600">Approved</span>
                              : u.onboarding_submitted
                              ? <span className="text-xs font-semibold text-yellow-600">Pending</span>
                              : <span className="text-xs text-gray-400">—</span>}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(u.created_at)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── LOGIN SHEET TAB ──────────────────────────────────────────────── */}
        {activeTab === 'login' && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Total Users" value={data?.logins?.total ?? 0} color="blue" />
              <StatCard label="Active Last 7 Days" value={data?.logins?.logged_in_recently ?? 0} sub="recent logins" color="green" />
            </div>

            <div className="liquid-card overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wide">User Login Sheet</h3>
                <div className="flex gap-3 items-center flex-wrap">
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={loginSearch}
                    onChange={e => setLoginSearch(e.target.value)}
                    className="border border-gray-200 rounded-liquid px-3 py-2 text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-ios-blue/30 w-52"
                  />
                  <span className="text-sm text-gray-500">{filteredLogins.length} users</span>
                  <button
                    onClick={() => exportCSV('login-sheet.csv',
                      ['Name', 'Email', 'Role', 'Active', 'Last Sign-In', 'Joined'],
                      filteredLogins.map(r => [
                        [r.first_name, r.last_name].filter(Boolean).join(' ') || '—',
                        r.email,
                        r.role,
                        r.is_active ? 'Yes' : 'No',
                        r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleString('en-US') : 'Never',
                        r.created_at ? fmtDate(r.created_at) : '—',
                      ])
                    )}
                    className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Export CSV
                  </button>
                  <button
                    onClick={downloadLoginExcel}
                    disabled={downloadingLoginExcel}
                    className="liquid-btn-glass liquid-btn-sm inline-flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100"
                  >
                    {downloadingLoginExcel ? (
                      <span className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    Export Excel
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">#</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Email</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Role</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-600">Active</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Last Sign-In</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredLogins.map((r, idx) => {
                      const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
                      const signedInRecently = r.last_sign_in_at
                        ? (Date.now() - new Date(r.last_sign_in_at).getTime()) < 7 * 24 * 3600 * 1000
                        : false;
                      return (
                        <tr key={r.id} className="hover:bg-white/60 transition-colors">
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono">{idx + 1}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{name}</td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{r.email}</td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 capitalize">{r.role || '—'}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <StatusDot active={r.is_active} label={r.is_active ? 'Yes' : 'No'} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {r.last_sign_in_at ? (
                              <span className={`text-xs font-medium ${signedInRecently ? 'text-green-600' : 'text-gray-500'}`}>
                                {new Date(r.last_sign_in_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Never</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        </tr>
                      );
                    })}
                    {filteredLogins.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">No users found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  const gradients: Record<string, string> = {
    blue: 'from-ios-blue to-ios-indigo',
    purple: 'from-ios-purple to-ios-pink',
    teal: 'from-ios-teal to-ios-blue',
    orange: 'from-ios-orange to-ios-yellow',
    green: 'from-green-400 to-teal-500',
  };
  return (
    <div className="liquid-card p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold bg-gradient-to-r ${gradients[color] || gradients.blue} bg-clip-text text-transparent`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function BarRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = Math.min(100, Math.round((value / total) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-gray-700 capitalize">{label}</span>
        <span className="font-semibold text-gray-900">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-ios-blue to-ios-indigo rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusDot({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${active ? 'text-green-600' : 'text-gray-400'}`}>
      <span className={`w-2 h-2 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
      {label}
    </span>
  );
}
