'use client';

import Link from 'next/link';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ---------- Types ----------

type Region = { id: string; name: string };

type Vendor = {
  id: string;
  email: string;
  role: string | null;
  division: string | null;
  is_active: boolean;
  recently_responded: boolean;
  has_submitted_availability: boolean;
  availability_responded_at: string | null;
  availability_scope_start: string | null;
  availability_scope_end: string | null;
  region_id: string | null;
  profiles: {
    first_name: string;
    last_name: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
  };
};

type CalendarVendor = {
  id: string;
  name: string;
  email: string;
  division: string | null;
  region_id: string | null;
  availableDates: string[];
};

type ByDate = Record<string, CalendarVendor[]>;

type AvailabilityFilter = 'all' | 'submitted' | 'not_submitted' | 'recent';
type ViewTab = 'list' | 'calendar';

// ---------- Helpers ----------

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDateTime = (isoStr: string | null): string => {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

// Distinct muted colours cycling for vendor chips on the calendar
const CHIP_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-cyan-100 text-cyan-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
];

// ---------- Component ----------

export default function VendorAvailabilityPage() {
  const [activeTab, setActiveTab] = useState<ViewTab>('list');

  // List view state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRegionId, setSelectedRegionId] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>('all');

  // Calendar view state
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [byDate, setByDate] = useState<ByDate>({});
  const [calendarVendors, setCalendarVendors] = useState<CalendarVendor[]>([]);
  const [calendarRegionId, setCalendarRegionId] = useState('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const calendarFetchedRef = useRef(false);

  // Stable vendor-color map so colours don't shift on re-render
  const vendorColorMap = useMemo(() => {
    const map = new Map<string, string>();
    calendarVendors.forEach((v, i) => {
      map.set(v.id, CHIP_COLORS[i % CHIP_COLORS.length]);
    });
    return map;
  }, [calendarVendors]);

  // ---------- Data loading ----------

  const loadListData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/login'; return; }

      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [vendorsRes, regionsRes] = await Promise.all([
        fetch('/api/all-vendors', { headers }),
        fetch('/api/regions', { headers }),
      ]);

      const vendorsPayload = await vendorsRes.json();
      const regionsPayload = await regionsRes.json();

      if (!vendorsRes.ok) throw new Error(vendorsPayload.error || 'Failed to load vendors');

      setVendors(vendorsPayload.vendors || []);
      setRegions(regionsPayload.regions || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalendarData = useCallback(async (regionId: string) => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { window.location.href = '/login'; return; }

      const params = new URLSearchParams();
      if (regionId !== 'all') params.set('region_id', regionId);

      const res = await fetch(`/api/vendor-availability-calendar?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to load calendar data');

      setByDate(payload.byDate || {});
      setCalendarVendors(payload.vendors || []);
    } catch (err: any) {
      setCalendarError(err.message || 'Failed to load calendar data');
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => { loadListData(); }, [loadListData]);

  useEffect(() => {
    if (activeTab === 'calendar' && !calendarFetchedRef.current) {
      calendarFetchedRef.current = true;
      loadCalendarData(calendarRegionId);
    }
  }, [activeTab, calendarRegionId, loadCalendarData]);

  const handleCalendarRegionChange = useCallback((regionId: string) => {
    setCalendarRegionId(regionId);
    setSelectedDate(null);
    loadCalendarData(regionId);
  }, [loadCalendarData]);

  // ---------- List view computed values ----------

  const filteredVendors = useMemo(() => {
    return vendors.filter((vendor) => {
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const name = `${vendor.profiles.first_name} ${vendor.profiles.last_name}`.toLowerCase();
        if (
          !name.includes(q) &&
          !vendor.email.toLowerCase().includes(q) &&
          !(vendor.profiles.city || '').toLowerCase().includes(q) &&
          !(vendor.profiles.state || '').toLowerCase().includes(q)
        ) return false;
      }
      if (selectedRegionId !== 'all' && vendor.region_id !== selectedRegionId) return false;
      if (availabilityFilter === 'submitted' && !vendor.has_submitted_availability) return false;
      if (availabilityFilter === 'not_submitted' && vendor.has_submitted_availability) return false;
      if (availabilityFilter === 'recent' && !vendor.recently_responded) return false;
      return true;
    });
  }, [vendors, searchQuery, selectedRegionId, availabilityFilter]);

  const stats = useMemo(() => {
    const total = vendors.length;
    const submitted = vendors.filter((v) => v.has_submitted_availability).length;
    return {
      total,
      submitted,
      notSubmitted: total - submitted,
      recentlyResponded: vendors.filter((v) => v.recently_responded).length,
    };
  }, [vendors]);

  const regionMap = useMemo(() => {
    const map = new Map<string, string>();
    regions.forEach((r) => map.set(r.id, r.name));
    return map;
  }, [regions]);

  // ---------- Calendar view computed values ----------

  // FullCalendar events: one event per date that has vendors, content rendered via eventContent
  const calendarEvents = useMemo(() => {
    return Object.entries(byDate)
      .filter(([, list]) => list.length > 0)
      .map(([date, list]) => ({
        id: date,
        start: date,
        allDay: true,
        extendedProps: { vendors: list, count: list.length },
      }));
  }, [byDate]);

  const selectedDayVendors = useMemo(
    () => (selectedDate ? (byDate[selectedDate] || []) : []),
    [byDate, selectedDate]
  );

  // ---------- Loading / error screens ----------

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
          <p className="mt-3 text-sm text-gray-600">Loading vendor availability...</p>
        </div>
      </div>
    );
  }

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">

        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900 tracking-tight">
              Vendor Availability
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mt-1">
              See which vendors are available and on which days.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={() => { loadListData(); if (activeTab === 'calendar') loadCalendarData(calendarRegionId); }}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Refresh
            </button>
            <Link
              href="/dashboard"
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors text-center"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-gray-200 rounded-xl w-fit mb-6">
          {(['list', 'calendar'] as ViewTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab === 'list' ? 'List' : 'Calendar'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* ========================= LIST VIEW ========================= */}
        {activeTab === 'list' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {([
                { label: 'Total Vendors', value: stats.total, filter: 'all', color: 'blue' },
                { label: 'Submitted', value: stats.submitted, filter: 'submitted', color: 'emerald' },
                { label: 'Not Submitted', value: stats.notSubmitted, filter: 'not_submitted', color: 'red' },
                { label: 'Responded (7d)', value: stats.recentlyResponded, filter: 'recent', color: 'violet' },
              ] as const).map(({ label, value, filter, color }) => (
                <button
                  key={filter}
                  onClick={() => setAvailabilityFilter(filter)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                    availabilityFilter === filter
                      ? `border-${color}-300 bg-${color}-50`
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
                  <p className={`text-2xl font-semibold mt-0.5 ${
                    availabilityFilter === filter
                      ? color === 'emerald' ? 'text-emerald-700'
                        : color === 'red' ? 'text-red-600'
                        : color === 'violet' ? 'text-violet-700'
                        : 'text-blue-700'
                      : 'text-gray-900'
                  }`}>{value}</p>
                </button>
              ))}
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 mb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Search</label>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name, email, or city..."
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Region</label>
                  <select
                    value={selectedRegionId}
                    onChange={(e) => setSelectedRegionId(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Regions</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Availability Status</label>
                  <select
                    value={availabilityFilter}
                    onChange={(e) => setAvailabilityFilter(e.target.value as AvailabilityFilter)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Vendors</option>
                    <option value="submitted">Submitted Availability</option>
                    <option value="not_submitted">Not Submitted</option>
                    <option value="recent">Responded in Last 7 Days</option>
                  </select>
                </div>
              </div>
              {(searchQuery || selectedRegionId !== 'all' || availabilityFilter !== 'all') && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-gray-500">Showing {filteredVendors.length} of {vendors.length} vendors</span>
                  <button
                    onClick={() => { setSearchQuery(''); setSelectedRegionId('all'); setAvailabilityFilter('all'); }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>

            {/* Table */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              {filteredVendors.length === 0 ? (
                <div className="p-10 text-center">
                  <p className="text-base text-gray-500">No vendors match the current filters.</p>
                </div>
              ) : (
                <>
                  {/* Desktop */}
                  <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          {['Vendor', 'Location', 'Region', 'Status', 'Availability Window', 'Last Response'].map((h) => (
                            <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredVendors.map((vendor) => (
                          <tr key={vendor.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-4">
                              <p className="font-medium text-gray-900">
                                {`${vendor.profiles.first_name} ${vendor.profiles.last_name}`.trim() || '—'}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">{vendor.email}</p>
                              <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                {vendor.division && (
                                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">{vendor.division}</span>
                                )}
                                {vendor.role && (
                                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">{vendor.role}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-4 text-gray-600">
                              {vendor.profiles.city || vendor.profiles.state
                                ? `${vendor.profiles.city || ''}${vendor.profiles.city && vendor.profiles.state ? ', ' : ''}${vendor.profiles.state || ''}`
                                : '—'}
                            </td>
                            <td className="px-5 py-4 text-gray-600">
                              {vendor.region_id ? regionMap.get(vendor.region_id) || '—' : '—'}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col gap-1">
                                {vendor.has_submitted_availability ? (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-100 text-emerald-800">Submitted</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700">Not submitted</span>
                                )}
                                {vendor.recently_responded && (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-violet-100 text-violet-800">Recent</span>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-4 text-gray-600">
                              {vendor.availability_scope_start || vendor.availability_scope_end
                                ? `${formatDate(vendor.availability_scope_start)} — ${formatDate(vendor.availability_scope_end)}`
                                : '—'}
                            </td>
                            <td className="px-5 py-4 text-gray-600">
                              {formatDateTime(vendor.availability_responded_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="lg:hidden divide-y divide-gray-100">
                    {filteredVendors.map((vendor) => (
                      <div key={vendor.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {`${vendor.profiles.first_name} ${vendor.profiles.last_name}`.trim() || '—'}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{vendor.email}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {vendor.has_submitted_availability ? (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-100 text-emerald-800">Submitted</span>
                            ) : (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700">Not submitted</span>
                            )}
                            {vendor.recently_responded && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-violet-100 text-violet-800">Recent</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-500">
                          <div>
                            <span className="font-medium text-gray-700">Location: </span>
                            {vendor.profiles.city || vendor.profiles.state
                              ? `${vendor.profiles.city || ''}${vendor.profiles.city && vendor.profiles.state ? ', ' : ''}${vendor.profiles.state || ''}`
                              : '—'}
                          </div>
                          <div>
                            <span className="font-medium text-gray-700">Region: </span>
                            {vendor.region_id ? regionMap.get(vendor.region_id) || '—' : '—'}
                          </div>
                          {(vendor.availability_scope_start || vendor.availability_scope_end) && (
                            <div className="col-span-2">
                              <span className="font-medium text-gray-700">Window: </span>
                              {formatDate(vendor.availability_scope_start)} — {formatDate(vendor.availability_scope_end)}
                            </div>
                          )}
                          {vendor.availability_responded_at && (
                            <div className="col-span-2">
                              <span className="font-medium text-gray-700">Last response: </span>
                              {formatDateTime(vendor.availability_responded_at)}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 flex gap-1.5 flex-wrap">
                          {vendor.division && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">{vendor.division}</span>
                          )}
                          {vendor.role && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">{vendor.role}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ========================= CALENDAR VIEW ========================= */}
        {activeTab === 'calendar' && (
          <div>
            {/* Calendar controls */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 mb-5">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                <div className="w-full sm:w-56">
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                    Filter by Region
                  </label>
                  <select
                    value={calendarRegionId}
                    onChange={(e) => handleCalendarRegionChange(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Regions</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                {calendarVendors.length > 0 && (
                  <p className="text-sm text-gray-500 sm:pb-2.5">
                    {calendarVendors.length} vendor{calendarVendors.length !== 1 ? 's' : ''} with availability data
                  </p>
                )}
              </div>
            </div>

            {calendarError && (
              <div className="mb-5 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
                {calendarError}
              </div>
            )}

            {calendarLoading ? (
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-16 flex items-center justify-center gap-3">
                <div className="h-7 w-7 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                <span className="text-sm text-gray-600">Loading availability calendar...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
                {/* Calendar */}
                <div className="xl:col-span-2 bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5">
                  <style>{`
                    .vendor-cal .fc-daygrid-day { cursor: pointer; }
                    .vendor-cal .fc-daygrid-day:hover { background: #f0f9ff; }
                    .vendor-cal .fc-daygrid-day.selected-day { background: #dbeafe !important; }
                    .vendor-cal .fc-event { background: transparent !important; border: none !important; padding: 0 !important; }
                    .vendor-cal .fc-event-main { padding: 0 !important; }
                    .vendor-cal .fc-daygrid-event-harness { margin: 1px 2px !important; }
                    .vendor-cal .fc-toolbar-title { font-size: 1.1rem !important; font-weight: 600; }
                    .vendor-cal .fc-button { background: #3b82f6 !important; border-color: #3b82f6 !important; font-size: 0.8rem !important; }
                    .vendor-cal .fc-button:hover { background: #2563eb !important; border-color: #2563eb !important; }
                  `}</style>
                  <div className="vendor-cal">
                    <FullCalendar
                      plugins={[dayGridPlugin]}
                      initialView="dayGridMonth"
                      height="auto"
                      events={calendarEvents}
                      dayCellClassNames={(arg) => {
                        const dateStr = arg.date.toISOString().slice(0, 10);
                        return dateStr === selectedDate ? ['selected-day'] : [];
                      }}
                      dayCellDidMount={(arg) => {
                        const dateStr = arg.date.toISOString().slice(0, 10);
                        const vendorsOnDay = byDate[dateStr];
                        if (vendorsOnDay && vendorsOnDay.length > 0) {
                          arg.el.style.cursor = 'pointer';
                        }
                      }}
                      eventContent={(eventInfo) => {
                        const count: number = eventInfo.event.extendedProps.count;
                        const vendorList: CalendarVendor[] = eventInfo.event.extendedProps.vendors;
                        const MAX_CHIPS = 3;
                        return (
                          <div className="px-1 pb-0.5">
                            <div className="flex flex-wrap gap-0.5">
                              {vendorList.slice(0, MAX_CHIPS).map((v) => (
                                <span
                                  key={v.id}
                                  className={`inline-block rounded px-1 py-0.5 text-[10px] font-medium leading-tight truncate max-w-[80px] ${vendorColorMap.get(v.id) || CHIP_COLORS[0]}`}
                                  title={v.name}
                                >
                                  {v.name.split(' ')[0]}
                                </span>
                              ))}
                              {count > MAX_CHIPS && (
                                <span className="inline-block rounded px-1 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-700 leading-tight">
                                  +{count - MAX_CHIPS}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }}
                      dateClick={(info) => {
                        const dateStr = info.dateStr;
                        setSelectedDate((prev) => (prev === dateStr ? null : dateStr));
                      }}
                    />
                  </div>
                </div>

                {/* Side panel */}
                <div className="xl:col-span-1">
                  {selectedDate ? (
                    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 sticky top-6">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-base font-semibold text-gray-900">
                            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </h2>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {selectedDayVendors.length} vendor{selectedDayVendors.length !== 1 ? 's' : ''} available
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedDate(null)}
                          className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                          aria-label="Close"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {selectedDayVendors.length === 0 ? (
                        <p className="text-sm text-gray-400 italic">No vendors available on this day.</p>
                      ) : (
                        <div className="space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                          {selectedDayVendors.map((v) => (
                            <div
                              key={v.id}
                              className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
                            >
                              <div
                                className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                                  (vendorColorMap.get(v.id) || '').split(' ')[0].replace('bg-', 'bg-').replace('-100', '-400') || 'bg-blue-400'
                                }`}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{v.name}</p>
                                <p className="text-xs text-gray-500 truncate">{v.email}</p>
                                {v.division && (
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mt-1 ${vendorColorMap.get(v.id) || CHIP_COLORS[0]}`}>
                                    {v.division}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white border border-dashed border-gray-300 rounded-2xl p-6 text-center">
                      <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p className="text-sm text-gray-400">Click a day on the calendar to see which vendors are available.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
