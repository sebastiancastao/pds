// app/employees/[id]/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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

type SickLeaveStatus = "pending" | "approved" | "denied";

type SickLeaveEntry = {
  id: string;
  start_date: string | null;
  end_date: string | null;
  duration_hours: number;
  status: string;
  reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string | null;
};

type SickLeaveSummary = {
  total_hours: number;
  total_days: number;
  entries: SickLeaveEntry[];
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  balance_hours: number;
  balance_days: number;
};

type SummaryPayload = {
  employee: Employee;
  summary: {
    total_hours: number;
    total_shifts: number;
    month_hours: number;
    last_30d_hours: number;
    per_event: PerEvent[];
    sick_leave: SickLeaveSummary;
  };
  entries: TimeEntry[];
};

const sickLeaveStatusStyles: Record<SickLeaveStatus, string> = {
  approved: "bg-green-100 text-green-700 border-green-200",
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  denied: "bg-red-100 text-red-700 border-red-200",
};

const fallbackSickLeaveStatusStyle = "bg-gray-100 text-gray-700 border-gray-200";

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

type OnboardingTemplate = {
  id: string;
  form_name: string;
  form_display_name: string;
  form_description: string | null;
  state_code: string | null;
  form_category: string;
  form_order: number;
  pdf_data: string; // base64
  file_size: number | null;
  is_active: boolean;
  is_required: boolean;
  created_at: string;
  updated_at: string;
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

export default function WorkerProfilePage() {
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
  const [formsError, setFormsError] = useState<string>('');
  const [sickRequestHours, setSickRequestHours] = useState<string>("");
  const [sickRequestDate, setSickRequestDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  );
  const [submittingSickRequest, setSubmittingSickRequest] = useState(false);
  const [sickRequestError, setSickRequestError] = useState("");
  const [sickRequestSuccess, setSickRequestSuccess] = useState("");

  useEffect(() => {
    const load = async () => {
      console.log("🔵 [DEBUG] Starting to load worker:", employeeId);
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
          console.log("🔴 [DEBUG] Worker not found (404)");
          setErr("Worker not found");
          setEmployee(null);
          setSummary(null);
          setEntries([]);
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.log("🔴 [DEBUG] Error response:", data);
          throw new Error(data.error || `Failed to load worker (${res.status})`);
        }

        const data: SummaryPayload = await res.json();
        console.log("🟢 [DEBUG] Received data:", data);
        console.log("🟢 [DEBUG] Worker object:", data.employee);
        console.log("🟢 [DEBUG] Summary object:", data.summary);
        console.log("🟢 [DEBUG] Entries count:", data.entries?.length || 0);

        setEmployee(data.employee);
        setSummary(data.summary);
        setEntries(data.entries || []);

        console.log("🟢 [DEBUG] State updated successfully");
      } catch (e: any) {
        console.log("🔴 [DEBUG] Error caught:", e.message);
        setErr(e.message || "Failed to load worker");
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

  // Fetch I-9 documents after worker is loaded
  useEffect(() => {
    const loadI9Documents = async () => {
      if (!employee?.id) return;

      setI9Loading(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();

        const response = await fetch(`/api/i9-documents/${employee.id}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });

        if (response.ok) {
          const result = await response.json();
          setI9Documents(result.document || null);
        } else {
          setI9Documents(null);
        }
      } catch (error) {
        console.error("Error loading I-9 documents:", error);
        setI9Documents(null);
      } finally {
        setI9Loading(false);
      }
    };

    loadI9Documents();
  }, [employee?.id]);

  // Fetch PDF forms after worker is loaded
  useEffect(() => {
    const loadPDFForms = async () => {
      if (!employee?.id) return;

      console.log("🔵 [DEBUG] Fetching PDF forms for user:", employee.id);
      setPdfLoading(true);

      try {
        const { data: { session } } = await supabase.auth.getSession();

        const response = await fetch(`/api/pdf-form-progress/user-list/${employee.id}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });

        if (response.ok) {
          const result = await response.json();
          console.log("🟢 [DEBUG] PDF forms response:", result);
          console.log("🟢 [DEBUG] PDF forms count:", result.forms?.length || 0);
          console.log("🟢 [DEBUG] PDF forms array:", result.forms);
          setPdfForms(result.forms || []);
        } else {
          const errorText = await response.text();
          console.log("⚠️ [DEBUG] PDF forms error response:", response.status, errorText);
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

  const sickLeaveSummary = summary?.sick_leave;
  const sickLeaveEntries = sickLeaveSummary?.entries ?? [];
  const sickLeaveTotalHours = sickLeaveSummary?.total_hours ?? 0;
  const sickLeaveAccruedHours = sickLeaveSummary?.accrued_hours ?? 0;
  const sickLeaveBalanceHours = sickLeaveSummary?.balance_hours ?? 0;
  const sickLeaveRequestCount = sickLeaveEntries.length;

  const toSickLeaveEntry = (record: any): SickLeaveEntry | null => {
    if (!record?.id) return null;
    const duration = Number(record?.duration_hours ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return null;

    return {
      id: String(record.id),
      start_date: record.start_date ? String(record.start_date) : null,
      end_date: record.end_date ? String(record.end_date) : null,
      duration_hours: Number(duration.toFixed(2)),
      status: String(record.status || "pending").toLowerCase(),
      reason: record.reason ? String(record.reason) : null,
      approved_at: record.approved_at ? String(record.approved_at) : null,
      approved_by: record.approved_by ? String(record.approved_by) : null,
      created_at: record.created_at ? String(record.created_at) : null,
    };
  };

  const appendSickLeaveEntry = (entry: SickLeaveEntry) => {
    setSummary((prev) => {
      if (!prev) return prev;

      const nextEntries = [entry, ...(prev.sick_leave?.entries || [])];
      const nextTotalHours = Number(
        ((prev.sick_leave?.total_hours || 0) + entry.duration_hours).toFixed(2)
      );
      const nextTotalDays = Number((nextTotalHours / 8).toFixed(2));
      const nextBalanceHours = Number(
        Math.max(0, (prev.sick_leave?.balance_hours || 0) - entry.duration_hours).toFixed(2)
      );
      const nextBalanceDays = Number((nextBalanceHours / 8).toFixed(2));

      return {
        ...prev,
        sick_leave: {
          ...prev.sick_leave,
          entries: nextEntries,
          total_hours: nextTotalHours,
          total_days: nextTotalDays,
          balance_hours: nextBalanceHours,
          balance_days: nextBalanceDays,
        },
      };
    });
  };

  const submitSickLeaveRequest = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSickRequestError("");
    setSickRequestSuccess("");

    const parsedHours = Number(sickRequestHours);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      setSickRequestError("Please enter a valid number of hours.");
      return;
    }

    if (!sickRequestDate) {
      setSickRequestError("Please choose a date.");
      return;
    }

    setSubmittingSickRequest(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/sick-leaves/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          hours: parsedHours,
          date: sickRequestDate,
        }),
      });

      const data = await res.json().catch(() => ({}));
      const insertedEntry = toSickLeaveEntry(data?.record);

      if (!res.ok) {
        if (insertedEntry) {
          appendSickLeaveEntry(insertedEntry);
          setSickRequestSuccess(
            "Request saved, but notification email failed. Please contact HR if needed."
          );
          setSickRequestHours("");
          return;
        }
        throw new Error(data?.error || "Failed to submit sick leave request");
      }

      if (insertedEntry) {
        appendSickLeaveEntry(insertedEntry);
      }

      setSickRequestSuccess("Sick leave request sent successfully.");
      setSickRequestHours("");
    } catch (error: any) {
      setSickRequestError(error?.message || "Failed to submit sick leave request");
    } finally {
      setSubmittingSickRequest(false);
    }
  };

  const createPdfBlobUrl = (base64Data: string) => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    return window.URL.createObjectURL(blob);
  };

  const openPdfInNewTab = (base64Data: string) => {
    const url = createPdfBlobUrl(base64Data);
    const popup = window.open(url, '_blank');
    if (!popup) {
      window.URL.revokeObjectURL(url);
      throw new Error('Popup blocked');
    }
    popup.opener = null;
    setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  };

  // Download a single PDF form
  const downloadPDFForm = (form: PDFForm) => {
    try {
      // Create download link
      const url = createPdfBlobUrl(form.form_data);
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

  const viewPDFForm = (form: PDFForm) => {
    try {
      openPdfInNewTab(form.form_data);
    } catch (error) {
      console.error('Error viewing PDF:', error);
      alert('Failed to open PDF form');
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

  // Download all documents (PDF forms + I-9 documents)
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

      const totalCount = pdfForms.length + i9Count;
      alert(`Downloaded ${totalCount} documents (${pdfForms.length} onboarding forms, ${i9Count} I-9 documents)`);
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
            <h1 className="text-4xl font-semibold text-gray-900 keeping-tight">
              {employee ? (
                <>
                  {employee.first_name} {employee.last_name}
                </>
              ) : (
                "Worker Profile"
              )}
            </h1>
            <p className="text-gray-600 mt-1">
              Cumulative hours, shifts, and event history
            </p>
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

            {/* Sick Leave Summary */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Sick Leave</h2>
                <span className="text-sm text-gray-500">
                  {sickLeaveRequestCount} request{sickLeaveRequestCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="apple-card p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-xl p-6 border border-pink-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="text-sm font-medium text-pink-700">Used</div>
                    <div className="text-3xl font-bold text-pink-900">{formatHours(sickLeaveTotalHours)} hrs</div>
                  </div>
                  <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-6 border border-indigo-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="text-sm font-medium text-indigo-700">Earned</div>
                    <div className="text-3xl font-bold text-indigo-900">
                      {formatHours(sickLeaveAccruedHours)} hrs
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-6 border border-amber-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="text-sm font-medium text-amber-700">Balance</div>
                    <div className="text-3xl font-bold text-amber-900">{formatHours(sickLeaveBalanceHours)} hrs</div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-6 text-sm text-gray-500">
                  <div>
                    <p className="text-xs uppercase keeping-wide text-gray-400">Earned</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatHours(sickLeaveAccruedHours)} hours
                    </p>
                    <p className="text-xs text-gray-400">
                      Based on {formatHours(summary?.total_hours ?? 0)} total hours worked
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase keeping-wide text-gray-400">Available balance</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {formatHours(sickLeaveBalanceHours)} hours
                    </p>
                    <p className="text-xs text-gray-400">
                      {sickLeaveBalanceHours > 0 ? "Ready to use" : "No balance available yet"}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 self-end">
                    Workers earn 1 hour of sick leave per 30 hours worked.
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-blue-900">
                        Request Sick Leave Hours
                      </h3>
                      <p className="mt-1 text-sm text-blue-800">
                        Submit hours and date. A request email is sent to
                        {" "}
                        sebastiancastao379@gmail.com and jenvillar@1pds.net.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={submitSickLeaveRequest} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label
                        htmlFor="sick-request-hours"
                        className="mb-1 block text-xs font-semibold uppercase keeping-wide text-blue-900"
                      >
                        Sick Leave Hours
                      </label>
                      <input
                        id="sick-request-hours"
                        type="number"
                        inputMode="decimal"
                        min="0.25"
                        max="24"
                        step="0.25"
                        required
                        value={sickRequestHours}
                        onChange={(event) => setSickRequestHours(event.target.value)}
                        placeholder="8"
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="sick-request-date"
                        className="mb-1 block text-xs font-semibold uppercase keeping-wide text-blue-900"
                      >
                        Date
                      </label>
                      <input
                        id="sick-request-date"
                        type="date"
                        required
                        value={sickRequestDate}
                        onChange={(event) => setSickRequestDate(event.target.value)}
                        className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={submittingSickRequest}
                        className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {submittingSickRequest ? "Sending..." : "Send Request"}
                      </button>
                    </div>
                  </form>

                  {sickRequestError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {sickRequestError}
                    </div>
                  )}
                  {sickRequestSuccess && (
                    <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                      {sickRequestSuccess}
                    </div>
                  )}
                </div>

                {sickLeaveEntries.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-500">
                    No sick leave records have been logged for this worker yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sickLeaveEntries.map((entry) => {
                      const normalizedStatus = (entry.status ?? "pending").toLowerCase() as SickLeaveStatus;
                      const statusClasses =
                        sickLeaveStatusStyles[normalizedStatus] ?? fallbackSickLeaveStatusStyle;
                      return (
                        <div
                          key={entry.id}
                          className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-xs text-gray-500">Dates</p>
                              <p className="text-sm font-semibold text-gray-900">
                                {formatDate(entry.start_date)} — {formatDate(entry.end_date)}
                              </p>
                            </div>
                            <span
                              className={`px-3 py-1 text-xs font-semibold capitalize keeping-wide border rounded-full ${statusClasses}`}
                            >
                              {entry.status}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
                            <span>Hours: {formatHours(entry.duration_hours)}</span>
                            {entry.reason && <span>Reason: {entry.reason}</span>}
                            {entry.approved_at && (
                              <span>Approved: {formatDate(entry.approved_at)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* All Vendor Events (Confirmed) */}
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">All Vendor Events</h2>
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
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">I-9 Documentation</h2>
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
                    <p className="text-sm text-gray-400 mt-1">Worker has not completed I-9 verification</p>
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
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Onboarding Forms</h2>
                <div className="flex items-center gap-2">
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
              </div>
              <div className="apple-card p-6">
                {pdfLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="apple-spinner" />
                    <span className="ml-3 text-gray-600">Loading forms…</span>
                  </div>
                ) : (pdfForms.length === 0) ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No onboarding forms submitted yet</p>
                    <p className="text-sm text-gray-400 mt-1">This section shows user rows from `pdf_form_progress`.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Filled Forms Section */}
                    {pdfForms.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                            {pdfForms.length}
                          </span>
                          Completed Forms
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {pdfForms.map((form) => (
                            <div
                              key={form.form_name}
                              className="border border-green-200 bg-green-50 rounded-xl p-4 hover:border-green-300 hover:shadow-md transition-all"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-lg bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </div>
                                  <div>
                                    <h3 className="font-semibold text-gray-900 text-sm">{form.display_name}</h3>
                                    <p className="text-xs text-green-700">Filled & Submitted</p>
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
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => viewPDFForm(form)}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                    View
                                  </button>
                                  <button
                                    onClick={() => downloadPDFForm(form)}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Download
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            </section>

            {/* Raw Time Entries */}
            <section className="mb-16">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Time Entries</h2>
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
