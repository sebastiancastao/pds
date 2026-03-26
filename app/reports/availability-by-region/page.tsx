'use client';

import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Region = {
  id: string;
  name: string;
};

type Vendor = {
  id: string;
  email: string;
  division: string | null;
  recently_responded: boolean;
  has_submitted_availability: boolean;
  availability_responded_at: string | null;
  availability_scope_start: string | null;
  availability_scope_end: string | null;
  region_id: string | null;
  daily_availability: Record<string, boolean>;
  profiles: {
    first_name: string;
    last_name: string;
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

type CalendarDayVendor = {
  id: string;
  name: string;
  email: string;
  division: string | null;
  region_id: string | null;
};

type ByDate = Record<string, CalendarDayVendor[]>;

type AvailabilityDataRange = {
  minSubmittedDate: string | null;
  maxSubmittedDate: string | null;
  minAvailableDate: string | null;
  maxAvailableDate: string | null;
};

type RegionReport = {
  id: string;
  name: string;
  totalVendors: number;
  submittedVendors: number;
  notSubmittedVendors: number;
  availableInRange: number;
  totalVendorDays: number;
  coveredDays: number;
  avgAvailablePerCoveredDay: number;
  avgAvailablePerWindowDay: number;
  peakDate: string | null;
  peakAvailable: number;
  submissionRate: number;
  rangeAvailabilityRate: number;
  dailyCounts: Record<string, number>;
};

type CoverageRow = {
  date: string;
  availableCount: number;
  activeRegions: number;
};

type VendorReportRow = {
  id: string;
  name: string;
  email: string;
  division: string;
  regionId: string;
  regionName: string;
  hasSubmittedAvailability: boolean;
  availableInRange: boolean;
  availableDaysInRange: number;
  recentlyResponded: boolean;
  lastResponse: string | null;
  scopeStart: string | null;
  scopeEnd: string | null;
  dailyAvailability: Record<string, boolean>;
};

const UNASSIGNED_REGION_ID = '__unassigned__';
const REPORT_RANGE_DAYS = 42;

const getLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getTodayDateString = () => getLocalDateString(new Date());

const addDaysToDateString = (dateStr: string, days: number) => {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
};

const buildDateRange = (startDate: string, endDate: string) => {
  if (!startDate || !endDate || startDate > endDate) return [] as string[];

  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate}T00:00:00`);

  while (current <= last) {
    dates.push(getLocalDateString(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

const normalizeRegionId = (regionId: string | null | undefined) => regionId || UNASSIGNED_REGION_ID;

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return 'No data';
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateTime = (dateStr: string | null) => {
  if (!dateStr) return 'No data';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatPercent = (value: number) => `${Math.round(value)}%`;

const formatAverage = (value: number) => value.toFixed(1);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'report';

const getVendorName = (vendor: Vendor) => {
  const fullName = `${vendor.profiles.first_name || ''} ${vendor.profiles.last_name || ''}`.trim();
  return fullName || vendor.email;
};

const getDailyAvailabilityBadge = (dailyAvailability: Record<string, boolean>, date: string) => {
  if (!Object.prototype.hasOwnProperty.call(dailyAvailability, date)) {
    return {
      label: '—',
      title: 'No submission',
      className: 'bg-gray-100 text-gray-400 ring-gray-200',
    };
  }

  return dailyAvailability[date]
    ? {
        label: 'A',
        title: 'Available',
        className: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
      }
    : {
        label: 'U',
        title: 'Unavailable',
        className: 'bg-rose-100 text-rose-700 ring-rose-200',
      };
};

function SummaryCard({
  label,
  value,
  subtext,
  accent,
}: {
  label: string;
  value: string | number;
  subtext: string;
  accent: 'blue' | 'emerald' | 'violet' | 'amber' | 'slate';
}) {
  const accentClasses = {
    blue: 'from-blue-600 to-cyan-500',
    emerald: 'from-emerald-600 to-teal-500',
    violet: 'from-violet-600 to-fuchsia-500',
    amber: 'from-amber-500 to-orange-500',
    slate: 'from-slate-700 to-slate-500',
  };

  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</p>
      <p className={`mt-2 bg-gradient-to-r ${accentClasses[accent]} bg-clip-text text-3xl font-semibold text-transparent`}>
        {value}
      </p>
      <p className="mt-1 text-sm text-gray-500">{subtext}</p>
    </div>
  );
}

export default function AvailabilityByRegionReportPage() {
  const defaultStartDate = getTodayDateString();
  const defaultEndDate = addDaysToDateString(defaultStartDate, REPORT_RANGE_DAYS - 1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState('');
  const [inputError, setInputError] = useState('');

  const [regions, setRegions] = useState<Region[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [calendarVendors, setCalendarVendors] = useState<CalendarVendor[]>([]);
  const [byDate, setByDate] = useState<ByDate>({});
  const [dataRange, setDataRange] = useState<AvailabilityDataRange>({
    minSubmittedDate: null,
    maxSubmittedDate: null,
    minAvailableDate: null,
    maxAvailableDate: null,
  });

  const [draftStartDate, setDraftStartDate] = useState(defaultStartDate);
  const [draftEndDate, setDraftEndDate] = useState(defaultEndDate);
  const [reportStartDate, setReportStartDate] = useState(defaultStartDate);
  const [reportEndDate, setReportEndDate] = useState(defaultEndDate);

  const [selectedRegionId, setSelectedRegionId] = useState('all');
  const [regionSearch, setRegionSearch] = useState('');

  const loadReportData = useCallback(async (startDate: string, endDate: string) => {
    if (!startDate || !endDate) return;

    setError('');
    if (hasLoadedOnce) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = '/login';
        return;
      }

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
      };

      const params = new URLSearchParams({
        start: startDate,
        end: endDate,
      });

      const response = await fetch(`/api/reports/availability-by-region?${params.toString()}`, { headers });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load availability data');
      }

      setRegions(payload.regions || []);
      setVendors(payload.vendors || []);
      setCalendarVendors(payload.calendarVendors || []);
      setByDate(payload.byDate || {});
      setDataRange(payload.dataRange || {
        minSubmittedDate: null,
        maxSubmittedDate: null,
        minAvailableDate: null,
        maxAvailableDate: null,
      });
      setHasLoadedOnce(true);
    } catch (err: any) {
      setError(err.message || 'Failed to load the availability report');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasLoadedOnce]);

  useEffect(() => {
    void loadReportData(reportStartDate, reportEndDate);
  }, [loadReportData, reportStartDate, reportEndDate]);

  const dateRange = useMemo(
    () => buildDateRange(reportStartDate, reportEndDate),
    [reportEndDate, reportStartDate]
  );

  const vendorBuckets = useMemo(() => {
    const buckets = new Map<string, Vendor[]>();
    vendors.forEach((vendor) => {
      const regionId = normalizeRegionId(vendor.region_id);
      const list = buckets.get(regionId);
      if (list) {
        list.push(vendor);
      } else {
        buckets.set(regionId, [vendor]);
      }
    });
    return buckets;
  }, [vendors]);

  const calendarVendorBuckets = useMemo(() => {
    const buckets = new Map<string, CalendarVendor[]>();
    calendarVendors.forEach((vendor) => {
      const regionId = normalizeRegionId(vendor.region_id);
      const list = buckets.get(regionId);
      if (list) {
        list.push(vendor);
      } else {
        buckets.set(regionId, [vendor]);
      }
    });
    return buckets;
  }, [calendarVendors]);

  const regionOptions = useMemo(() => {
    const baseOptions = regions.map((region) => ({ id: region.id, name: region.name }));
    const needsUnassigned =
      vendorBuckets.has(UNASSIGNED_REGION_ID) || calendarVendorBuckets.has(UNASSIGNED_REGION_ID);

    return needsUnassigned
      ? [...baseOptions, { id: UNASSIGNED_REGION_ID, name: 'Unassigned' }]
      : baseOptions;
  }, [calendarVendorBuckets, regions, vendorBuckets]);

  const regionNameById = useMemo(
    () => new Map(regionOptions.map((region) => [region.id, region.name])),
    [regionOptions]
  );

  useEffect(() => {
    if (selectedRegionId === 'all') return;
    const exists = regionOptions.some((region) => region.id === selectedRegionId);
    if (!exists) {
      setSelectedRegionId('all');
    }
  }, [regionOptions, selectedRegionId]);

  const dailyRegionCounts = useMemo(() => {
    const counts = new Map<string, Record<string, number>>();

    dateRange.forEach((date) => {
      const dayVendors = byDate[date] || [];
      dayVendors.forEach((vendor) => {
        const regionId = normalizeRegionId(vendor.region_id);
        if (!counts.has(regionId)) {
          counts.set(regionId, {});
        }
        const regionCounts = counts.get(regionId)!;
        regionCounts[date] = (regionCounts[date] || 0) + 1;
      });
    });

    return counts;
  }, [byDate, dateRange]);

  const allRegionIds = useMemo(() => {
    const ids = new Set<string>(regions.map((region) => region.id));
    vendorBuckets.forEach((_, regionId) => ids.add(regionId));
    calendarVendorBuckets.forEach((_, regionId) => ids.add(regionId));
    return Array.from(ids);
  }, [calendarVendorBuckets, regions, vendorBuckets]);

  const regionReports = useMemo(() => {
    return allRegionIds
      .map((regionId) => {
        const regionVendors = vendorBuckets.get(regionId) || [];
        const regionAvailableVendors = calendarVendorBuckets.get(regionId) || [];
        const regionDailyCounts = dailyRegionCounts.get(regionId) || {};

        const coveredDays = dateRange.filter((date) => (regionDailyCounts[date] || 0) > 0).length;
        const totalVendorDays = regionAvailableVendors.reduce(
          (total, vendor) => total + vendor.availableDates.length,
          0
        );

        let peakDate: string | null = null;
        let peakAvailable = 0;

        dateRange.forEach((date) => {
          const availableCount = regionDailyCounts[date] || 0;
          if (availableCount > peakAvailable) {
            peakAvailable = availableCount;
            peakDate = date;
          }
        });

        const submittedVendors = regionVendors.filter((vendor) => vendor.has_submitted_availability).length;
        const totalVendors = regionVendors.length;
        const availableInRange = regionAvailableVendors.length;

        return {
          id: regionId,
          name: regionNameById.get(regionId) || 'Unknown Region',
          totalVendors,
          submittedVendors,
          notSubmittedVendors: Math.max(0, totalVendors - submittedVendors),
          availableInRange,
          totalVendorDays,
          coveredDays,
          avgAvailablePerCoveredDay: coveredDays > 0 ? totalVendorDays / coveredDays : 0,
          avgAvailablePerWindowDay: dateRange.length > 0 ? totalVendorDays / dateRange.length : 0,
          peakDate,
          peakAvailable,
          submissionRate: totalVendors > 0 ? (submittedVendors / totalVendors) * 100 : 0,
          rangeAvailabilityRate: totalVendors > 0 ? (availableInRange / totalVendors) * 100 : 0,
          dailyCounts: regionDailyCounts,
        } as RegionReport;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [allRegionIds, calendarVendorBuckets, dailyRegionCounts, dateRange, regionNameById, vendorBuckets]);

  const filteredRegionReports = useMemo(() => {
    const search = regionSearch.trim().toLowerCase();

    return regionReports.filter((report) => {
      const matchesRegion = selectedRegionId === 'all' || report.id === selectedRegionId;
      const matchesSearch = !search || report.name.toLowerCase().includes(search);
      return matchesRegion && matchesSearch;
    });
  }, [regionReports, regionSearch, selectedRegionId]);

  const selectedVendorPool = useMemo(() => {
    if (selectedRegionId === 'all') return vendors;
    return vendorBuckets.get(selectedRegionId) || [];
  }, [selectedRegionId, vendorBuckets, vendors]);

  const selectedAvailableVendors = useMemo(() => {
    if (selectedRegionId === 'all') return calendarVendors;
    return calendarVendorBuckets.get(selectedRegionId) || [];
  }, [calendarVendorBuckets, calendarVendors, selectedRegionId]);

  const selectedCoverageRows = useMemo(() => {
    return dateRange.map((date) => {
      const dayVendors = (byDate[date] || []).filter((vendor) => {
        if (selectedRegionId === 'all') return true;
        return normalizeRegionId(vendor.region_id) === selectedRegionId;
      });

      return {
        date,
        availableCount: dayVendors.length,
        activeRegions: new Set(dayVendors.map((vendor) => normalizeRegionId(vendor.region_id))).size,
      } satisfies CoverageRow;
    });
  }, [byDate, dateRange, selectedRegionId]);

  const selectedSummary = useMemo(() => {
    const submittedVendors = selectedVendorPool.filter((vendor) => vendor.has_submitted_availability).length;
    const coveredDays = selectedCoverageRows.filter((row) => row.availableCount > 0).length;
    const totalVendorDays = selectedAvailableVendors.reduce(
      (total, vendor) => total + vendor.availableDates.length,
      0
    );

    let peakCoverage = 0;
    let peakDate: string | null = null;
    selectedCoverageRows.forEach((row) => {
      if (row.availableCount > peakCoverage) {
        peakCoverage = row.availableCount;
        peakDate = row.date;
      }
    });

    const activeRegionCount =
      selectedRegionId === 'all'
        ? regionReports.filter((report) => report.totalVendors > 0).length
        : selectedVendorPool.length > 0
          ? 1
          : 0;

    return {
      totalVendors: selectedVendorPool.length,
      submittedVendors,
      availableInRange: selectedAvailableVendors.length,
      coveredDays,
      totalVendorDays,
      peakCoverage,
      peakDate,
      activeRegionCount,
    };
  }, [regionReports, selectedAvailableVendors, selectedCoverageRows, selectedRegionId, selectedVendorPool]);

  const calendarVendorMap = useMemo(
    () => new Map(calendarVendors.map((vendor) => [vendor.id, vendor])),
    [calendarVendors]
  );

  const vendorReportRows = useMemo(() => {
    return selectedVendorPool
      .map((vendor) => {
        const regionId = normalizeRegionId(vendor.region_id);
        const calendarVendor = calendarVendorMap.get(vendor.id);

        return {
          id: vendor.id,
          name: getVendorName(vendor),
          email: vendor.email,
          division: vendor.division || 'No division',
          regionId,
          regionName: regionNameById.get(regionId) || 'Unassigned',
          hasSubmittedAvailability: vendor.has_submitted_availability,
          availableInRange: Boolean(calendarVendor),
          availableDaysInRange: calendarVendor?.availableDates.length || 0,
          recentlyResponded: vendor.recently_responded,
          lastResponse: vendor.availability_responded_at,
          scopeStart: vendor.availability_scope_start,
          scopeEnd: vendor.availability_scope_end,
          dailyAvailability: vendor.daily_availability || {},
        } satisfies VendorReportRow;
      })
      .sort((left, right) => {
        if (right.availableDaysInRange !== left.availableDaysInRange) {
          return right.availableDaysInRange - left.availableDaysInRange;
        }
        return left.name.localeCompare(right.name);
      });
  }, [calendarVendorMap, regionNameById, selectedVendorPool]);

  const filteredRegionIds = useMemo(
    () => new Set(filteredRegionReports.map((report) => report.id)),
    [filteredRegionReports]
  );

  const exportVendorRows = useMemo(
    () => vendorReportRows.filter((vendor) => filteredRegionIds.has(vendor.regionId)),
    [filteredRegionIds, vendorReportRows]
  );

  const maxCoverage = useMemo(
    () => Math.max(0, ...selectedCoverageRows.map((row) => row.availableCount)),
    [selectedCoverageRows]
  );

  const selectedWindowHasNoOverlap = useMemo(() => {
    if (!dataRange.minSubmittedDate || !dataRange.maxSubmittedDate) return false;
    return reportEndDate < dataRange.minSubmittedDate || reportStartDate > dataRange.maxSubmittedDate;
  }, [dataRange.maxSubmittedDate, dataRange.minSubmittedDate, reportEndDate, reportStartDate]);

  const handleGenerateReport = useCallback(() => {
    if (!draftStartDate || !draftEndDate) {
      setInputError('Select both a start and end date.');
      return;
    }

    if (draftStartDate > draftEndDate) {
      setInputError('The start date must be before the end date.');
      return;
    }

    setInputError('');
    setReportStartDate(draftStartDate);
    setReportEndDate(draftEndDate);
  }, [draftEndDate, draftStartDate]);

  const handleRefresh = useCallback(() => {
    void loadReportData(reportStartDate, reportEndDate);
  }, [loadReportData, reportEndDate, reportStartDate]);

  const handleUseAllAvailableDates = useCallback(() => {
    if (!dataRange.minSubmittedDate || !dataRange.maxSubmittedDate) return;
    setInputError('');
    setDraftStartDate(dataRange.minSubmittedDate);
    setDraftEndDate(dataRange.maxSubmittedDate);
    setReportStartDate(dataRange.minSubmittedDate);
    setReportEndDate(dataRange.maxSubmittedDate);
  }, [dataRange.maxSubmittedDate, dataRange.minSubmittedDate]);

  const handleExport = useCallback(() => {
    const workbook = XLSX.utils.book_new();

    const summaryRows = filteredRegionReports.map((report) => ({
      Region: report.name,
      'Total Vendors': report.totalVendors,
      'Submitted Availability': report.submittedVendors,
      'Not Submitted': report.notSubmittedVendors,
      'Available In Range': report.availableInRange,
      'Covered Days': report.coveredDays,
      'Total Vendor Days': report.totalVendorDays,
      'Avg Available / Covered Day': Number(formatAverage(report.avgAvailablePerCoveredDay)),
      'Avg Available / Window Day': Number(formatAverage(report.avgAvailablePerWindowDay)),
      'Submission Rate': formatPercent(report.submissionRate),
      'Range Availability Rate': formatPercent(report.rangeAvailabilityRate),
      'Peak Coverage Date': report.peakDate ? formatDate(report.peakDate) : 'No data',
      'Peak Coverage Count': report.peakAvailable,
    }));

    const coverageRows = filteredRegionReports.flatMap((report) =>
      dateRange.map((date) => ({
        Region: report.name,
        Date: date,
        'Formatted Date': formatDate(date),
        'Available Vendors': report.dailyCounts[date] || 0,
      }))
    );

    const vendorRows = exportVendorRows.map((vendor) => ({
      Name: vendor.name,
      Email: vendor.email,
      Division: vendor.division,
      Region: vendor.regionName,
      'Submitted Availability': vendor.hasSubmittedAvailability ? 'Yes' : 'No',
      'Available In Report Range': vendor.availableInRange ? 'Yes' : 'No',
      'Available Days In Range': vendor.availableDaysInRange,
      'Recently Responded': vendor.recentlyResponded ? 'Yes' : 'No',
      'Last Response': vendor.lastResponse ? formatDateTime(vendor.lastResponse) : 'No data',
      'Availability Scope Start': vendor.scopeStart ? formatDate(vendor.scopeStart) : 'No data',
      'Availability Scope End': vendor.scopeEnd ? formatDate(vendor.scopeEnd) : 'No data',
    }));

    const vendorDailyRows = exportVendorRows.map((vendor) => {
      const row: Record<string, string | number> = {
        Name: vendor.name,
        Email: vendor.email,
        Division: vendor.division,
        Region: vendor.regionName,
      };

      dateRange.forEach((date) => {
        if (Object.prototype.hasOwnProperty.call(vendor.dailyAvailability, date)) {
          row[date] = vendor.dailyAvailability[date] ? 'Available' : 'Unavailable';
        } else {
          row[date] = 'No submission';
        }
      });

      return row;
    });

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(summaryRows.length > 0 ? summaryRows : [{ Region: 'No matching regions' }]),
      'Regions'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(coverageRows.length > 0 ? coverageRows : [{ Region: 'No matching regions' }]),
      'Coverage'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(vendorRows.length > 0 ? vendorRows : [{ Name: 'No matching vendors' }]),
      'Vendors'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(vendorDailyRows.length > 0 ? vendorDailyRows : [{ Name: 'No matching vendors' }]),
      'Vendor Daily'
    );

    const regionLabel =
      selectedRegionId === 'all'
        ? 'all-regions'
        : slugify(regionNameById.get(selectedRegionId) || 'region');

    XLSX.writeFile(
      workbook,
      `availability-by-region_${regionLabel}_${reportStartDate}_to_${reportEndDate}.xlsx`
    );
  }, [dateRange, exportVendorRows, filteredRegionReports, regionNameById, reportEndDate, reportStartDate, selectedRegionId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50 to-white px-4 py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-center py-24">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
            <p className="mt-4 text-sm text-gray-600">Loading availability reports...</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50 to-white px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-sky-700 shadow-sm">
              Regional Reporting
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
              Availability Reports by Region
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-600 sm:text-base">
              Generate a date-based availability report, compare regions, and export the current result.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              onClick={handleRefresh}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={handleExport}
              disabled={filteredRegionReports.length === 0}
              className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Export Excel
            </button>
            <Link
              href="/vendor-availability"
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Vendor Availability
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        <div className="mb-6 rounded-3xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-600">
                Start Date
              </label>
              <input
                type="date"
                value={draftStartDate}
                onChange={(event) => setDraftStartDate(event.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-600">
                End Date
              </label>
              <input
                type="date"
                value={draftEndDate}
                onChange={(event) => setDraftEndDate(event.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-600">
                Region
              </label>
              <select
                value={selectedRegionId}
                onChange={(event) => setSelectedRegionId(event.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              >
                <option value="all">All Regions</option>
                {regionOptions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-600">
                Search Regions
              </label>
              <input
                type="search"
                value={regionSearch}
                onChange={(event) => setRegionSearch(event.target.value)}
                placeholder="Type a region name..."
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={handleGenerateReport}
                className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-700"
              >
                Generate Report
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 text-sm text-gray-500 md:flex-row md:items-center md:justify-between">
            <p>
              Current report window: <span className="font-medium text-gray-700">{formatDate(reportStartDate)}</span> to{' '}
              <span className="font-medium text-gray-700">{formatDate(reportEndDate)}</span> ({dateRange.length} day
              {dateRange.length === 1 ? '' : 's'})
            </p>
            <p>
              Showing {filteredRegionReports.length} of {regionReports.length} region
              {regionReports.length === 1 ? '' : 's'}
            </p>
          </div>

          {dataRange.minSubmittedDate && dataRange.maxSubmittedDate && (
            <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
              Submitted date coverage currently runs from <span className="font-semibold">{formatDate(dataRange.minSubmittedDate)}</span> to{' '}
              <span className="font-semibold">{formatDate(dataRange.maxSubmittedDate)}</span>.
            </div>
          )}

          {selectedWindowHasNoOverlap && dataRange.minSubmittedDate && dataRange.maxSubmittedDate && (
            <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <p>
                The selected window does not overlap the submitted date range. Try {formatDate(dataRange.minSubmittedDate)} to{' '}
                {formatDate(dataRange.maxSubmittedDate)}.
              </p>
              <button
                onClick={handleUseAllAvailableDates}
                className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                Use All Available Dates
              </button>
            </div>
          )}

          {inputError && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {inputError}
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="Total Vendors"
            value={selectedSummary.totalVendors}
            subtext={`${selectedSummary.activeRegionCount} active region${selectedSummary.activeRegionCount === 1 ? '' : 's'}`}
            accent="blue"
          />
          <SummaryCard
            label="Submitted"
            value={selectedSummary.submittedVendors}
            subtext={`${selectedSummary.totalVendors - selectedSummary.submittedVendors} still missing`}
            accent="emerald"
          />
          <SummaryCard
            label="Available In Range"
            value={selectedSummary.availableInRange}
            subtext={`${selectedSummary.totalVendorDays} vendor-days in the window`}
            accent="violet"
          />
          <SummaryCard
            label="Covered Days"
            value={selectedSummary.coveredDays}
            subtext={`${dateRange.length - selectedSummary.coveredDays} with no coverage`}
            accent="amber"
          />
          <SummaryCard
            label="Peak Coverage"
            value={selectedSummary.peakCoverage}
            subtext={selectedSummary.peakDate ? formatDate(selectedSummary.peakDate) : 'No peak day yet'}
            accent="slate"
          />
        </div>

        <div className="mb-6 rounded-3xl border border-white/70 bg-white/90 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-2 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Regional Summary</h2>
              <p className="text-sm text-gray-500">Availability coverage and submission totals for the selected window.</p>
            </div>
          </div>

          {filteredRegionReports.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-gray-500">
              No regions matched the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-slate-50/80 text-left text-xs uppercase tracking-[0.18em] text-gray-500">
                    <th className="px-5 py-3 font-semibold">Region</th>
                    <th className="px-5 py-3 font-semibold">Total Vendors</th>
                    <th className="px-5 py-3 font-semibold">Submitted</th>
                    <th className="px-5 py-3 font-semibold">Available In Range</th>
                    <th className="px-5 py-3 font-semibold">Covered Days</th>
                    <th className="px-5 py-3 font-semibold">Avg / Covered Day</th>
                    <th className="px-5 py-3 font-semibold">Peak Day</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRegionReports.map((report) => (
                    <tr key={report.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">{report.name}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          Submission rate {formatPercent(report.submissionRate)} | Range coverage {formatPercent(report.rangeAvailabilityRate)}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{report.totalVendors}</td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-emerald-700">{report.submittedVendors}</div>
                        <div className="text-xs text-gray-500">{report.notSubmittedVendors} missing</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-violet-700">{report.availableInRange}</div>
                        <div className="text-xs text-gray-500">{report.totalVendorDays} vendor-days</div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">{report.coveredDays}</div>
                        <div className="text-xs text-gray-500">{dateRange.length - report.coveredDays} uncovered</div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{formatAverage(report.avgAvailablePerCoveredDay)}</td>
                      <td className="px-5 py-4">
                        <div className="font-medium text-gray-900">
                          {report.peakDate ? formatDate(report.peakDate) : 'No data'}
                        </div>
                        <div className="text-xs text-gray-500">{report.peakAvailable} available</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-white/70 bg-white/90 shadow-sm backdrop-blur">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Daily Coverage</h2>
              <p className="text-sm text-gray-500">
                {selectedRegionId === 'all'
                  ? 'Daily vendor availability across all selected regions.'
                  : `Daily vendor availability for ${regionNameById.get(selectedRegionId) || 'the selected region'}.`}
              </p>
            </div>

            {selectedCoverageRows.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-gray-500">
                No dates are included in the current report window.
              </div>
            ) : (
              <div className="max-h-[34rem] overflow-y-auto px-5 py-4">
                <div className="mb-3 grid grid-cols-[9rem_1fr_4rem_5rem] gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  <div>Date</div>
                  <div>Coverage</div>
                  <div className="text-right">Count</div>
                  <div className="text-right">Regions</div>
                </div>
                <div className="space-y-3">
                  {selectedCoverageRows.map((row) => (
                    <div key={row.date} className="grid grid-cols-[9rem_1fr_4rem_5rem] items-center gap-3">
                      <div className="text-sm font-medium text-gray-700">{formatDate(row.date)}</div>
                      <div className="h-2 rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-sky-500 to-violet-500"
                          style={{
                            width: `${maxCoverage === 0 ? 0 : (row.availableCount / maxCoverage) * 100}%`,
                          }}
                        />
                      </div>
                      <div className="text-right text-sm font-semibold text-gray-900">{row.availableCount}</div>
                      <div className="text-right text-sm text-gray-500">{row.activeRegions}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/70 bg-white/90 shadow-sm backdrop-blur">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Vendor Coverage Detail</h2>
              <p className="text-sm text-gray-500">
                Top vendors ranked by the number of available days inside the current report window.
              </p>
            </div>

            {vendorReportRows.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-gray-500">
                No vendors are available for the current selection.
              </div>
            ) : (
              <div className="max-h-[34rem] space-y-3 overflow-y-auto px-5 py-4">
                {vendorReportRows.slice(0, 15).map((vendor) => (
                  <div key={vendor.id} className="rounded-2xl border border-gray-100 bg-slate-50/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{vendor.name}</p>
                        <p className="truncate text-sm text-gray-500">{vendor.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-violet-700">{vendor.availableDaysInRange}</p>
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">days</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                        {vendor.regionName}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                        {vendor.division}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          vendor.hasSubmittedAvailability
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {vendor.hasSubmittedAvailability ? 'Submitted' : 'Missing'}
                      </span>
                      {vendor.recentlyResponded && (
                        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                          Recent response
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-500 sm:grid-cols-2">
                      <div>Last response: {formatDateTime(vendor.lastResponse)}</div>
                      <div>
                        Availability scope: {vendor.scopeStart ? formatDate(vendor.scopeStart) : 'No data'} to{' '}
                        {vendor.scopeEnd ? formatDate(vendor.scopeEnd) : 'No data'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-white/70 bg-white/90 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Vendor Daily Availability</h2>
              <p className="text-sm text-gray-500">
                Per-day vendor status for the selected window. `A` = available, `U` = unavailable, `—` = no submission for that date.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">A Available</span>
              <span className="rounded-full bg-rose-100 px-2.5 py-1 font-medium text-rose-700 ring-1 ring-rose-200">U Unavailable</span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-500 ring-1 ring-gray-200">— No submission</span>
            </div>
          </div>

          {vendorReportRows.length === 0 || dateRange.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-gray-500">
              No vendor daily availability is available for the current selection.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="max-h-[38rem] overflow-y-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-20 bg-white">
                    <tr>
                      <th className="sticky left-0 z-30 min-w-[16rem] border-b border-r border-gray-100 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                        Vendor
                      </th>
                      {dateRange.map((date) => (
                        <th
                          key={date}
                          className="border-b border-gray-100 bg-white px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                        >
                          <div>{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {vendorReportRows.map((vendor) => (
                      <tr key={vendor.id} className="hover:bg-slate-50/60">
                        <td className="sticky left-0 z-10 border-b border-r border-gray-100 bg-white px-4 py-3 align-top">
                          <div className="font-medium text-gray-900">{vendor.name}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{vendor.regionName}</div>
                          <div className="mt-1 text-xs text-gray-400">{vendor.availableDaysInRange} available day{vendor.availableDaysInRange === 1 ? '' : 's'}</div>
                        </td>
                        {dateRange.map((date) => {
                          const badge = getDailyAvailabilityBadge(vendor.dailyAvailability, date);
                          return (
                            <td key={`${vendor.id}-${date}`} className="border-b border-gray-100 px-2 py-2 text-center">
                              <span
                                title={`${vendor.name}: ${badge.title} on ${formatDate(date)}`}
                                className={`inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full px-2 text-xs font-semibold ring-1 ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
