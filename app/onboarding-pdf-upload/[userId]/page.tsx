"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type OnboardingUser = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
};

type ExistingForm = {
  form_name: string;
  display_name: string;
  updated_at: string;
};

const MAX_BYTES = 15 * 1024 * 1024; // 15MB (base64 inflates; keep raw PDF reasonable)

const STATE_OPTIONS = [
  { label: "CA", value: "ca" },
  { label: "NY", value: "ny" },
  { label: "AZ", value: "az" },
  { label: "WI", value: "wi" },
  { label: "NV", value: "nv" },
  { label: "TX", value: "tx" },
];

const COMMON_FORM_IDS = [
  "adp-deposit",
  "marketplace",
  "health-insurance",
  "time-of-hire",
  "employee-information",
  "fw4",
  "i9",
  "notice-to-employee",
  "meal-waiver-6hour",
  "meal-waiver-10-12",
  "state-tax",
  "employee-handbook",
  "az-state-supplements",
  "ny-state-supplements",
  "nv-state-supplements",
  "wi-state-supplements",
];

function toBase64Chunked(uint8: Uint8Array) {
  // Avoid stack overflow from String.fromCharCode(...hugeArray)
  const chunkSize = 32768;
  let binary = "";
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function fileToBase64(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  return toBase64Chunked(new Uint8Array(arrayBuffer));
}

export default function OnboardingPdfUploadPage() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = params?.userId;

  const [authChecking, setAuthChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);

  const [targetUser, setTargetUser] = useState<OnboardingUser | null>(null);
  const [existingForms, setExistingForms] = useState<ExistingForm[]>([]);
  const [loadingTarget, setLoadingTarget] = useState(false);

  const [stateCode, setStateCode] = useState("ca");
  const [formId, setFormId] = useState("fw4");
  const [customFormId, setCustomFormId] = useState("");

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>("");

  const effectiveFormId = (customFormId || formId).trim();
  const computedFormName = useMemo(() => {
    const st = (stateCode || "").trim().toLowerCase();
    const fid = effectiveFormId.replace(/^\s+|\s+$/g, "");
    if (!st || !fid) return "";
    // Users save forms with "${stateCode}-${formId}" (see StatePayrollFormViewer).
    return `${st}-${fid}`;
  }, [effectiveFormId, stateCode]);

  const formAlreadyExists = useMemo(() => {
    if (!computedFormName) return false;
    return existingForms.some((f) => (f.form_name || "").trim().toLowerCase() === computedFormName.toLowerCase());
  }, [computedFormName, existingForms]);

  // Auth / role gate
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push("/login");
          return;
        }

        const { data, error: roleErr } = await (supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single() as any);

        const role = (data?.role ?? "").toString().trim().toLowerCase();
        setMyRole(role || null);

        if (roleErr || !role || !["hr", "exec", "admin"].includes(role)) {
          alert("Unauthorized: HR/Exec/Admin access required");
          router.push("/dashboard");
          return;
        }

        setIsAuthorized(true);
      } catch (e) {
        console.error("[ONBOARDING-PDF-UPLOAD] Auth error:", e);
        router.push("/login");
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  // Load target user display info (from onboarding API, which already returns decrypted full name)
  useEffect(() => {
    const loadTargetUser = async () => {
      if (!isAuthorized || !userId) return;
      setLoadingTarget(true);
      setError("");
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/onboarding", {
          method: "GET",
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load onboarding users");

        const users = Array.isArray(data.users) ? (data.users as OnboardingUser[]) : [];
        const match = users.find((u) => u.user_id === userId) || null;
        setTargetUser(match);
      } catch (e: any) {
        console.error("[ONBOARDING-PDF-UPLOAD] Target user load error:", e);
        setTargetUser(null);
        setError(e?.message || "Failed to load user info");
      } finally {
        setLoadingTarget(false);
      }
    };

    loadTargetUser();
  }, [isAuthorized, userId]);

  // Load existing completed forms for the user (helps avoid overwriting wrong form)
  useEffect(() => {
    const loadExisting = async () => {
      if (!isAuthorized || !userId) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/pdf-form-progress/user-forms/${userId}`, {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setExistingForms([]);
          return;
        }
        setExistingForms(Array.isArray(data.forms) ? data.forms : []);
      } catch (e) {
        console.warn("[ONBOARDING-PDF-UPLOAD] Existing forms load failed:", e);
        setExistingForms([]);
      }
    };

    loadExisting();
  }, [isAuthorized, userId]);

  const onPickFile = (file: File | null) => {
    setError("");
    setPdfFile(null);
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Please select a PDF file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`PDF is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max ${(MAX_BYTES / 1024 / 1024).toFixed(0)}MB.`);
      return;
    }
    setPdfFile(file);
  };

  const handleUpload = async () => {
    if (!userId) {
      setError("Missing userId in the URL.");
      return;
    }
    if (!computedFormName) {
      setError("Pick a state + form ID (or enter a custom form ID).");
      return;
    }
    if (!pdfFile) {
      setError("Select a PDF file to upload.");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("No session found. Please log in again.");
      }

      const base64 = await fileToBase64(pdfFile);

      const res = await fetch("/api/pdf-form-progress/admin-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId,
          formName: computedFormName,
          formData: base64,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      alert(`Uploaded successfully: ${computedFormName}`);

      // Refresh existing forms list
      try {
        const formsRes = await fetch(`/api/pdf-form-progress/user-forms/${userId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const formsData = await formsRes.json().catch(() => ({}));
        if (formsRes.ok && Array.isArray(formsData.forms)) {
          setExistingForms(formsData.forms);
        }
      } catch {}
    } catch (e: any) {
      console.error("[ONBOARDING-PDF-UPLOAD] Upload error:", e);
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-700">Checking authorization...</div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Upload Filled Onboarding PDF</h1>
            <p className="mt-1 text-sm text-gray-600">
              Upload a completed PDF for a specific user and form (stored in <code className="text-xs">pdf_form_progress</code>).
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/onboarding"
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm font-medium"
            >
              Back
            </Link>
            {userId && (
              <Link
                href={`/hr/employees/${userId}`}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm font-medium"
                title="Open the HR employee profile page to verify the form appears under Completed Forms"
              >
                View Employee
              </Link>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-6 border border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-medium text-gray-500">Target User</div>
              <div className="mt-1 text-sm text-gray-900 break-all">{userId}</div>
              <div className="mt-2 text-sm text-gray-700">
                {loadingTarget ? (
                  <span className="text-gray-500">Loading user info...</span>
                ) : targetUser ? (
                  <>
                    <div className="font-semibold">{targetUser.full_name || "N/A"}</div>
                    <div className="text-gray-600">{targetUser.email || ""}</div>
                    <div className="text-xs text-gray-500 mt-1">Role: {targetUser.role || "unknown"} | Your role: {myRole || "unknown"}</div>
                  </>
                ) : (
                  <span className="text-gray-500">User info not found (still OK to upload).</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-500">Form Name (computed)</div>
              <div className="mt-1 text-sm font-mono text-gray-900 break-all">
                {computedFormName || "(select state + form id)"}
              </div>
              {formAlreadyExists && (
                <div className="mt-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
                  A form with this name already exists for this user. Upload will overwrite it.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">State</label>
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {STATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Saved forms use <code>state-formId</code> (example: <code>ca-fw4</code>).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Form ID</label>
              <select
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={customFormId.trim().length > 0}
              >
                {COMMON_FORM_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <div className="mt-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Or custom Form ID</label>
                <input
                  value={customFormId}
                  onChange={(e) => setCustomFormId(e.target.value)}
                  placeholder="e.g., ui-guide"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="mt-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">PDF File</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              className="w-full"
            />
            {pdfFile && (
              <div className="mt-2 text-xs text-gray-600">
                Selected: <span className="font-medium">{pdfFile.name}</span> ({(pdfFile.size / 1024 / 1024).toFixed(2)}MB)
              </div>
            )}
          </div>

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-medium"
            >
              {uploading ? "Uploading..." : "Upload PDF"}
            </button>
          </div>

          <div className="mt-8 border-t border-gray-200 pt-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-900">Existing Completed Forms</h2>
              <span className="text-xs text-gray-500">{existingForms.length} found</span>
            </div>
            {existingForms.length === 0 ? (
              <div className="text-sm text-gray-500">No completed forms found yet for this user.</div>
            ) : (
              <div className="max-h-56 overflow-auto border border-gray-200 rounded-md">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">form_name</th>
                      <th className="text-left px-3 py-2 font-medium">display</th>
                      <th className="text-left px-3 py-2 font-medium">updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {existingForms.map((f) => (
                      <tr key={f.form_name}>
                        <td className="px-3 py-2 font-mono text-xs text-gray-800">{f.form_name}</td>
                        <td className="px-3 py-2 text-gray-800">{f.display_name}</td>
                        <td className="px-3 py-2 text-gray-500">{new Date(f.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
