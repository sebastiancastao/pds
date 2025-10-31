// app/hr/employees/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  department: string;
  position: string;
  hire_date: string;
  status: "active" | "on_leave" | "inactive";
  salary: number | null;
  profile_photo_url?: string | null;
  state: string | null;
  city: string | null;
  performance_score?: number | null;
  projects_completed?: number | null;
  attendance_rate?: number | null;
  customer_satisfaction?: number | null;
};

type TimeEntry = {
  id: string;
  event_id: string | null;
  clock_in: string | null;  // ISO
  clock_out: string | null; // ISO
};

type PerEvent = {
  event_id: string;
  shifts: number;
  hours: number;
  event_name: string | null;
  event_date: string | null; // YYYY-MM-DD
};

type SummaryPayload = {
  employee: Employee;
  summary: {
    total_hours: number;
    total_shifts: number;
    per_event: PerEvent[];
  };
  entries: TimeEntry[];
};

function hoursBetween(clock_in: string | null, clock_out: string | null) {
  if (!clock_in || !clock_out) return 0;
  const a = new Date(clock_in).getTime();
  const b = new Date(clock_out).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / (1000 * 60 * 60);
}

function formatHours(h: number) {
  // Show 1 decimal but keep trailing .0
  return (Math.round(h * 10) / 10).toFixed(1);
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const employeeId = params?.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [summary, setSummary] = useState<SummaryPayload["summary"] | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  useEffect(() => {
    const load = async () => {
      console.log("🔵 [DEBUG] Starting to load employee:", employeeId);
      setLoading(true);
      setErr(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log("🔵 [DEBUG] Session:", session ? "exists" : "none");

        const url = `/api/employees/${employeeId}/summary`;
        console.log("🔵 [DEBUG] Fetching URL:", url);

        const res = await fetch(url, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });

        console.log("🔵 [DEBUG] Response status:", res.status);

        if (res.status === 404) {
          console.log("🔴 [DEBUG] Employee not found (404)");
          setErr("Employee not found");
          setEmployee(null);
          setSummary(null);
          setEntries([]);
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.log("🔴 [DEBUG] Error response:", data);
          throw new Error(data.error || `Failed to load employee (${res.status})`);
        }

        const data: SummaryPayload = await res.json();
        console.log("🟢 [DEBUG] Received data:", data);
        console.log("🟢 [DEBUG] Employee object:", data.employee);
        console.log("🟢 [DEBUG] Summary object:", data.summary);
        console.log("🟢 [DEBUG] Entries count:", data.entries?.length || 0);

        setEmployee(data.employee);
        setSummary(data.summary);
        setEntries(data.entries || []);

        console.log("🟢 [DEBUG] State updated successfully");
      } catch (e: any) {
        console.log("🔴 [DEBUG] Error caught:", e.message);
        setErr(e.message || "Failed to load employee");
      } finally {
        setLoading(false);
        console.log("🔵 [DEBUG] Loading complete");
      }
    };

    if (employeeId) {
      load();
    } else {
      console.log("🔴 [DEBUG] No employeeId provided");
    }
  }, [employeeId]);

  const computed = useMemo(() => {
    if (!entries) return { totalHoursLocal: 0 };
    // Re-compute locally as a guard (API already provides total_hours)
    const total = entries.reduce((acc, e) => acc + hoursBetween(e.clock_in, e.clock_out), 0);
    return { totalHoursLocal: total };
  }, [entries]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-6xl py-10 px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-gray-900 tracking-tight">
              {employee ? (
                <>
                  {employee.first_name} {employee.last_name}
                </>
              ) : (
                "Employee Profile"
              )}
            </h1>
            <p className="text-gray-600 mt-1">
              Cumulative hours, shifts, and event history
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/hr">
              <button className="apple-button apple-button-secondary">
                ← Back to HR
              </button>
            </Link>
            <Link href="/hr/employees">
              <button className="apple-button apple-button-secondary">
                All Employees
              </button>
            </Link>
          </div>
        </div>

        {/* Loading & Error */}
        {loading && (
          <div className="apple-card">
            <div className="flex items-center justify-center py-16">
              <div className="apple-spinner" />
              <span className="ml-3 text-gray-600">Loading profile…</span>
            </div>
          </div>
        )}

        {err && !loading && (
          <div className="apple-alert apple-alert-error mb-6">
            {err}
          </div>
        )}

        {/* Profile + Stats */}
        {!loading && !err && employee && (
          <>
            {/* Top section */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Profile card */}
              <div className="apple-card p-6">
                <div className="flex items-start gap-4">
                  {employee.profile_photo_url ? (
                    <img
                      src={employee.profile_photo_url}
                      alt={`${employee.first_name} ${employee.last_name}`}
                      className="w-16 h-16 rounded-full object-cover"
                      onError={(e) => {
                        const t = e.target as HTMLImageElement;
                        t.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold text-xl">
                      {employee.first_name?.[0]}
                      {employee.last_name?.[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-gray-900">
                      {employee.first_name} {employee.last_name}
                    </h2>
                    <p className="text-sm text-gray-600">{employee.position} • {employee.department}</p>
                    <div className="mt-3 space-y-1 text-sm text-gray-600">
                      <div className="flex items-center">
                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M5 22h14a2 2 0 002-2v-8H3v8a2 2 0 002 2z"/>
                        </svg>
                        Hired: {formatDate(employee.hire_date)}
                      </div>
                      <div className="flex items-center">
                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z"/>
                        </svg>
                        {employee.email}
                      </div>
                      {employee.phone && (
                        <div className="flex items-center">
                          <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.69l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11.04 11.04 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.69.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z"/>
                          </svg>
                          {employee.phone}
                        </div>
                      )}
                      <div className="flex items-center">
                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0L6.343 16.657a8 8 0 1111.314 0z"/>
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                        {(employee.city && employee.state) ? `${employee.city}, ${employee.state}` : (employee.state || "—")}
                      </div>
                    </div>
                    <div className="mt-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        employee.status === "active"
                          ? "bg-green-100 text-green-700"
                          : employee.status === "on_leave"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-gray-100 text-gray-700"
                      }`}>
                        {employee.status === "active" ? "Active" : employee.status === "on_leave" ? "On Leave" : "Inactive"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats cards */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="apple-stat-card apple-stat-card-blue">
                  <div className="apple-stat-icon apple-stat-icon-blue">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                  </div>
                  <div className="apple-stat-content">
                    <div className="apple-stat-label">Total Hours</div>
                    <div className="apple-stat-value">
                      {formatHours(summary?.total_hours ?? computed.totalHoursLocal)}
                    </div>
                    <div className="apple-stat-sublabel">all time</div>
                  </div>
                </div>

                <div className="apple-stat-card apple-stat-card-green">
                  <div className="apple-stat-icon apple-stat-icon-green">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M16 17l-4 4m0 0l-4-4m4 4V3"/>
                    </svg>
                  </div>
                  <div className="apple-stat-content">
                    <div className="apple-stat-label">Total Shifts</div>
                    <div className="apple-stat-value">
                      {summary?.total_shifts ?? entries.length}
                    </div>
                    <div className="apple-stat-sublabel">clock-ins</div>
                  </div>
                </div>

                <div className="apple-stat-card apple-stat-card-purple">
                  <div className="apple-stat-icon apple-stat-icon-purple">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M8 17l4-4 4 4M12 12V3"/>
                    </svg>
                  </div>
                  <div className="apple-stat-content">
                    <div className="apple-stat-label">Avg Hours / Shift</div>
                    <div className="apple-stat-value">
                      {(() => {
                        const h = summary?.total_hours ?? computed.totalHoursLocal;
                        const s = (summary?.total_shifts ?? entries.length) || 1;
                        return formatHours(h / s);
                      })()}
                    </div>
                    <div className="apple-stat-sublabel">derived</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Per-event Breakdown */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Per-Event Breakdown</h2>
              </div>
              <div className="apple-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left p-4 font-semibold text-gray-700">Event</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Date</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Shifts</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Hours</th>
                        <th className="text-right p-4 font-semibold text-gray-700">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {(summary?.per_event || []).map((row) => (
                        <tr key={row.event_id} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4">
                            <div className="font-medium text-gray-900">
                              {row.event_name || row.event_id}
                            </div>
                          </td>
                          <td className="p-4 text-gray-600 text-sm">
                            {row.event_date || "—"}
                          </td>
                          <td className="p-4 text-gray-900 font-medium">
                            {row.shifts}
                          </td>
                          <td className="p-4 text-gray-900 font-medium">
                            {formatHours(row.hours)}
                          </td>
                          <td className="p-4 text-right">
                            {row.event_id && (
                              <Link href={`/event-dashboard/${row.event_id}`}>
                                <button className="apple-icon-button" title="Open event">
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </button>
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                      {(!summary?.per_event || summary.per_event.length === 0) && (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-gray-500">
                            No shifts recorded for events yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Raw Time Entries */}
            <section className="mb-16">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Time Entries</h2>
              </div>
              <div className="apple-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left p-4 font-semibold text-gray-700">Clock In</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Clock Out</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Hours</th>
                        <th className="text-left p-4 font-semibold text-gray-700">Event</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {entries.map((e) => {
                        const h = hoursBetween(e.clock_in, e.clock_out);
                        return (
                          <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                            <td className="p-4 text-gray-900">{formatDate(e.clock_in)}</td>
                            <td className="p-4 text-gray-900">{formatDate(e.clock_out)}</td>
                            <td className="p-4 text-gray-900 font-medium">{formatHours(h)}</td>
                            <td className="p-4 text-gray-600 text-sm">
                              {e.event_id ? (
                                <Link href={`/event-dashboard/${e.event_id}`} className="text-blue-600 hover:text-blue-700">
                                  {e.event_id}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {entries.length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-gray-500">
                            No time entries yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
