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
  event_id: string | null;
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

type I9Documents = {
  id?: string;
  user_id?: string;
  drivers_license_url?: string;
  drivers_license_filename?: string;
  drivers_license_uploaded_at?: string;
  ssn_document_url?: string;
  ssn_document_filename?: string;
  ssn_document_uploaded_at?: string;
  additional_doc_url?: string;
  additional_doc_filename?: string;
  additional_doc_uploaded_at?: string;
  created_at?: string;
  updated_at?: string;
};

type PDFForm = {
  form_name: string;
  display_name: string;
  form_data: string; // base64
  updated_at: string;
  created_at: string;
};

function hoursBetween(clock_in: string | null, clock_out: string | null) {
  if (!clock_in || !clock_out) return 0;
  const a = new Date(clock_in).getTime();
  const b = new Date(clock_out).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return 0;
  return (b - a) / (1000 * 60 * 60);
}

function formatHours(h: number) {
  // Show 2 decimals for small numbers (< 1), 1 decimal for larger numbers
  if (h < 1) {
    return h.toFixed(2);
  }
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
  const [i9Documents, setI9Documents] = useState<I9Documents | null>(null);
  const [i9Loading, setI9Loading] = useState(false);
  const [pdfForms, setPdfForms] = useState<PDFForm[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);

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

  // Fetch I-9 documents after employee is loaded
  useEffect(() => {
    const loadI9Documents = async () => {
      if (!employee?.id) return;

      console.log("🔵 [DEBUG] Fetching I-9 documents for user:", employee.id);
      setI9Loading(true);

      try {
        // Query i9_documents table directly - returns single record per user
        const { data, error } = await supabase
          .from('i9_documents')
          .select('*')
          .eq('user_id', employee.id)
          .maybeSingle();

        if (error) {
          console.error("🔴 [DEBUG] Error querying i9_documents:", error);
          setI9Documents(null);
          return;
        }

        console.log("🟢 [DEBUG] I-9 documents loaded:", data);

        // Set the documents directly (already in correct format)
        if (data) {
          setI9Documents(data);
        } else {
          console.log("⚠️ [DEBUG] No I-9 documents found for user");
          setI9Documents(null);
        }
      } catch (error) {
        console.error("🔴 [DEBUG] Error loading I-9 documents:", error);
        setI9Documents(null);
      } finally {
        setI9Loading(false);
      }
    };

    loadI9Documents();
  }, [employee?.id]);

  // Fetch PDF forms after employee is loaded
  useEffect(() => {
    const loadPDFForms = async () => {
      if (!employee?.id) return;

      console.log("🔵 [DEBUG] Fetching PDF forms for user:", employee.id);
      setPdfLoading(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();

        const response = await fetch(`/api/pdf-form-progress/user/${employee.id}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });

        if (response.ok) {
          const result = await response.json();
          console.log("🟢 [DEBUG] PDF forms loaded:", result.forms?.length || 0);
          setPdfForms(result.forms || []);
        } else {
          console.log("⚠️ [DEBUG] No PDF forms found or error:", response.status);
          setPdfForms([]);
        }
      } catch (error) {
        console.error("🔴 [DEBUG] Error loading PDF forms:", error);
        setPdfForms([]);
      } finally {
        setPdfLoading(false);
      }
    };

    loadPDFForms();
  }, [employee?.id]);

  const computed = useMemo(() => {
    if (!entries) return { totalHoursLocal: 0 };
    // Re-compute locally as a guard (API already provides total_hours)
    const total = entries.reduce((acc, e) => acc + hoursBetween(e.clock_in, e.clock_out), 0);
    return { totalHoursLocal: total };
  }, [entries]);

  // Create event name lookup from per_event data
  const eventNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (summary?.per_event) {
      summary.per_event.forEach((event) => {
        if (event.event_id && event.event_name) {
          map.set(event.event_id, event.event_name);
        }
      });
    }
    return map;
  }, [summary?.per_event]);

  // Download a single PDF form
  const downloadPDFForm = (form: PDFForm) => {
    try {
      // Convert base64 to blob
      const byteCharacters = atob(form.form_data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${form.display_name}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Failed to download PDF form');
    }
  };

  // Download an I-9 document from storage
  const downloadI9Document = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading I-9 document:', error);
      alert('Failed to download document');
    }
  };

  // Download all documents (PDFs + I-9 documents)
  const downloadAllDocuments = async () => {
    try {
      // Download all PDF forms
      for (const form of pdfForms) {
        downloadPDFForm(form);
        // Small delay between downloads to avoid browser blocking
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Count and download I-9 documents if they exist
      let i9Count = 0;
      if (i9Documents) {
        if (i9Documents.drivers_license_url) {
          await downloadI9Document(i9Documents.drivers_license_url, i9Documents.drivers_license_filename || 'drivers_license');
          i9Count++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (i9Documents.ssn_document_url) {
          await downloadI9Document(i9Documents.ssn_document_url, i9Documents.ssn_document_filename || 'ssn_card');
          i9Count++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (i9Documents.additional_doc_url) {
          await downloadI9Document(i9Documents.additional_doc_url, i9Documents.additional_doc_filename || 'additional_document');
          i9Count++;
        }
      }

      alert(`Downloaded ${pdfForms.length} onboarding forms and ${i9Count} I-9 documents`);
    } catch (error) {
      console.error('Error downloading all documents:', error);
      alert('Some documents may have failed to download');
    }
  };

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
            <Link href="/hr-dashboard">
              <button className="apple-button apple-button-secondary">
                ← Back to Dashboard
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
              <div className="apple-card p-8 bg-gradient-to-br from-white to-gray-50 border-2 border-gray-100">
                <div className="flex flex-col items-center text-center">
                  {employee.profile_photo_url ? (
                    <img
                      src={employee.profile_photo_url}
                      alt={`${employee.first_name} ${employee.last_name}`}
                      className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg mb-4"
                      onError={(e) => {
                        const t = e.target as HTMLImageElement;
                        t.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg border-4 border-white mb-4">
                      {employee.first_name?.[0]}
                      {employee.last_name?.[0]}
                    </div>
                  )}

                  <h2 className="text-2xl font-bold text-gray-900 mb-1">
                    {employee.first_name} {employee.last_name}
                  </h2>

                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg mb-4">
                    <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                    </svg>
                    <span className="text-sm font-semibold text-blue-900">{employee.position}</span>
                    <span className="text-sm text-blue-600">•</span>
                    <span className="text-sm font-medium text-blue-700">{employee.department}</span>
                  </div>

                  <div className="w-full space-y-3 mb-4">
                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M16 2v4M8 2v4M3 10h18M5 22h14a2 2 0 002-2v-8H3v8a2 2 0 002 2z"/>
                      </svg>
                      <span className="font-medium">Hired:</span>
                      <span>{formatDate(employee.hire_date)}</span>
                    </div>

                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2z"/>
                      </svg>
                      <span className="truncate">{employee.email}</span>
                    </div>

                    {employee.phone && (
                      <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.69l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11.04 11.04 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.69.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z"/>
                        </svg>
                        <span>{employee.phone}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg py-2 px-4">
                      <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0L6.343 16.657a8 8 0 1111.314 0z"/>
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                      </svg>
                      <span>{(employee.city && employee.state) ? `${employee.city}, ${employee.state}` : (employee.state || "—")}</span>
                    </div>
                  </div>

                  <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${
                    employee.status === "active"
                      ? "bg-green-100 text-green-700 border-2 border-green-200"
                      : employee.status === "on_leave"
                      ? "bg-yellow-100 text-yellow-700 border-2 border-yellow-200"
                      : "bg-gray-100 text-gray-700 border-2 border-gray-200"
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${
                      employee.status === "active" ? "bg-green-500" : employee.status === "on_leave" ? "bg-yellow-500" : "bg-gray-500"
                    }`}></span>
                    {employee.status === "active" ? "Active" : employee.status === "on_leave" ? "On Leave" : "Inactive"}
                  </span>
                </div>
              </div>

              {/* Stats cards */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 border-2 border-blue-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-blue-700">Total Hours</div>
                      <div className="text-xs text-blue-600">all time</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-blue-900">
                    {formatHours(summary?.total_hours ?? computed.totalHoursLocal)}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border-2 border-green-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-green-700">Total Shifts</div>
                      <div className="text-xs text-green-600">clock-ins</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-green-900">
                    {summary?.total_shifts ?? entries.length}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-6 border-2 border-purple-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center shadow-lg">
                      <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
                      </svg>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-purple-700">Avg Hours / Shift</div>
                      <div className="text-xs text-purple-600">average</div>
                    </div>
                  </div>
                  <div className="text-3xl font-bold text-purple-900">
                    {(() => {
                      const h = summary?.total_hours ?? computed.totalHoursLocal;
                      const s = (summary?.total_shifts ?? entries.length) || 1;
                      return formatHours(h / s);
                    })()}
                  </div>
                </div>
              </div>
            </section>

            {/* All Vendor Events (Confirmed) */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">All Vendor Events</h2>
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
                        </tr>
                      ))}
                      {(!summary?.per_event || summary.per_event.length === 0) && (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-gray-500">
                            No shifts recorded for events yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* I-9 Documents */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">I-9 Documentation</h2>
              </div>
              <div className="apple-card p-6">
                {i9Loading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading documents…</span>
                  </div>
                ) : !i9Documents ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No I-9 documents uploaded yet</p>
                    <p className="text-sm text-gray-400 mt-1">Employee has not completed I-9 verification</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Driver's License */}
                    <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                            i9Documents.drivers_license_url
                              ? 'bg-green-100 text-green-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">Driver's License</h3>
                            <p className="text-sm text-gray-500">Identity verification</p>
                          </div>
                        </div>
                        {i9Documents.drivers_license_url && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Uploaded
                          </span>
                        )}
                      </div>
                      {i9Documents.drivers_license_url ? (
                        <div className="space-y-2">
                          <div className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate">{i9Documents.drivers_license_filename || 'document'}</span>
                          </div>
                          {i9Documents.drivers_license_uploaded_at && (
                            <div className="flex items-center text-sm text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatDate(i9Documents.drivers_license_uploaded_at)}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <a
                              href={i9Documents.drivers_license_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View
                            </a>
                            <button
                              onClick={() => downloadI9Document(i9Documents.drivers_license_url!, i9Documents.drivers_license_filename || 'drivers_license')}
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Not uploaded</p>
                      )}
                    </div>

                    {/* SSN Document */}
                    <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                            i9Documents.ssn_document_url
                              ? 'bg-green-100 text-green-600'
                              : 'bg-gray-100 text-gray-400'
                          }`}>
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div>
                            <h3 className="font-semibold text-gray-900">Social Security Card</h3>
                            <p className="text-sm text-gray-500">Employment eligibility</p>
                          </div>
                        </div>
                        {i9Documents.ssn_document_url && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Uploaded
                          </span>
                        )}
                      </div>
                      {i9Documents.ssn_document_url ? (
                        <div className="space-y-2">
                          <div className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate">{i9Documents.ssn_document_filename || 'document'}</span>
                          </div>
                          {i9Documents.ssn_document_uploaded_at && (
                            <div className="flex items-center text-sm text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatDate(i9Documents.ssn_document_uploaded_at)}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <a
                              href={i9Documents.ssn_document_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View
                            </a>
                            <button
                              onClick={() => downloadI9Document(i9Documents.ssn_document_url!, i9Documents.ssn_document_filename || 'ssn_card')}
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">Not uploaded</p>
                      )}
                    </div>

                    {/* Additional Document (if exists) */}
                    {i9Documents.additional_doc_url && (
                      <div className="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all md:col-span-2">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-900">Additional Document</h3>
                              <p className="text-sm text-gray-500">Supplementary verification</p>
                            </div>
                          </div>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Uploaded
                          </span>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center text-sm text-gray-600">
                            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="truncate">{i9Documents.additional_doc_filename || 'document'}</span>
                          </div>
                          {i9Documents.additional_doc_uploaded_at && (
                            <div className="flex items-center text-sm text-gray-500">
                              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {formatDate(i9Documents.additional_doc_uploaded_at)}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <a
                              href={i9Documents.additional_doc_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              View
                            </a>
                            <button
                              onClick={() => downloadI9Document(i9Documents.additional_doc_url!, i9Documents.additional_doc_filename || 'additional_document')}
                              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Onboarding PDF Forms */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Onboarding Forms</h2>
                {(pdfForms.length > 0 || i9Documents) && (
                  <button
                    onClick={downloadAllDocuments}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download All Documents
                  </button>
                )}
              </div>
              <div className="apple-card p-6">
                {pdfLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading forms…</span>
                  </div>
                ) : pdfForms.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No onboarding forms submitted yet</p>
                    <p className="text-sm text-gray-400 mt-1">Employee has not completed the onboarding packet</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {pdfForms.map((form) => (
                      <div
                        key={form.form_name}
                        className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-md transition-all"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div>
                              <h3 className="font-semibold text-gray-900 text-sm">{form.display_name}</h3>
                              <p className="text-xs text-gray-500">PDF Document</p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center text-xs text-gray-500">
                            <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {formatDate(form.updated_at)}
                          </div>
                          <button
                            onClick={() => downloadPDFForm(form)}
                            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download PDF
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                                  {eventNameMap.get(e.event_id) || e.event_id}
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
