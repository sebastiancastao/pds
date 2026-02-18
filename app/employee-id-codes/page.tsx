"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type CheckinCode = {
  id: string;
  code: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  is_active: boolean;
  label: string | null;
  target_user_id?: string | null;
  checkins: {
    id: string;
    user_id: string;
    checked_in_at: string;
    profile: { first_name: string; last_name: string } | null;
  }[];
};

type RecipientUser = {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  onboarding_completed: boolean;
  email_sent: boolean;
  last_sent_at: string | null;
};

export default function CheckInCodesPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [codes, setCodes] = useState<CheckinCode[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generatingAllPersonal, setGeneratingAllPersonal] = useState(false);
  const [generatingPersonalUserId, setGeneratingPersonalUserId] = useState<
    string | null
  >(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<RecipientUser[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOnboardedNotSent, setFilterOnboardedNotSent] = useState(false);

  const [selectedCodeId, setSelectedCodeId] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingOnboardingCompleted, setSendingOnboardingCompleted] = useState(false);
  const [sendingOnboardingCompletedNotSent, setSendingOnboardingCompletedNotSent] = useState(false);
  const [sendingOnboardingCompletedTest, setSendingOnboardingCompletedTest] = useState(false);
  const [sendingUserId, setSendingUserId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  const recipientNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of recipients) {
      const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();
      m.set(u.id, name || u.email);
    }
    return m;
  }, [recipients]);

  const activeCodes = useMemo(
    () => codes.filter((c) => c.is_active),
    [codes]
  );
  const expiredCodes = useMemo(
    () => codes.filter((c) => !c.is_active),
    [codes]
  );

  const personalCodeByUserId = useMemo(() => {
    const m = new Map<string, { id: string; code: string; created_at: string }>();
    for (const c of activeCodes) {
      if (!c.target_user_id) continue;
      const existing = m.get(c.target_user_id);
      if (!existing || new Date(c.created_at) > new Date(existing.created_at)) {
        m.set(c.target_user_id, { id: c.id, code: c.code, created_at: c.created_at });
      }
    }
    return m;
  }, [activeCodes]);

  const filteredRecipients = useMemo(() => {
    let result = recipients;

    if (filterOnboardedNotSent) {
      result = result.filter((u) =>
        u.onboarding_completed && !u.email_sent
      );
    }

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter((u) => {
        const name = `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
        return name.includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
      });
    }

    return result;
  }, [recipients, searchQuery, filterOnboardedNotSent]);

  const onboardingCompletedNotSentCount = useMemo(
    () => recipients.filter((u) => u.onboarding_completed && !u.email_sent).length,
    [recipients]
  );

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!selectedCodeId && activeCodes.length > 0) {
      setSelectedCodeId(activeCodes[0].id);
    }
  }, [activeCodes, selectedCodeId]);

  const selectedCode = useMemo(
    () => activeCodes.find((c) => c.id === selectedCodeId) || null,
    [activeCodes, selectedCodeId]
  );
  const selectedBulkCodeId = useMemo(() => {
    if (selectedCode && !selectedCode.target_user_id) return selectedCode.id;
    const nonPersonal = activeCodes.find((c) => !c.target_user_id);
    return nonPersonal?.id || "";
  }, [activeCodes, selectedCode]);

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const mfaVerified = sessionStorage.getItem("mfa_verified");
    if (!mfaVerified) {
      router.push("/verify-mfa");
      return;
    }

    const { data: userData } = await (supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single() as any);

    if (
      !userData ||
      !["manager", "hr", "exec", "admin"].includes(userData.role)
    ) {
      router.push("/");
      return;
    }

    setIsAuthorized(true);
    setLoading(false);
    fetchCodes();
    fetchRecipients();
  };

  const fetchCodes = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/checkin-codes", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setCodes(data);
      }
    } catch (err) {
      console.error("Error fetching codes:", err);
    }
  };

  const fetchRecipients = async () => {
    try {
      setRecipientsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch("/api/checkin-codes/recipients", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const users = Array.isArray(data?.users) ? (data.users as any[]) : [];
      setRecipients(
        users.map((u: any) => ({
          id: String(u.id || ""),
          email: String(u.email || ""),
          role: String(u.role || ""),
          first_name: String(u.first_name || ""),
          last_name: String(u.last_name || ""),
          onboarding_completed: Boolean(u.onboarding_completed),
          email_sent: Boolean(u.email_sent),
          last_sent_at: u.last_sent_at ? String(u.last_sent_at) : null,
        }))
      );
    } catch (err) {
      console.error("Error fetching recipients:", err);
    } finally {
      setRecipientsLoading(false);
    }
  };

  const generateAndSendPersonalCodesAll = async () => {
    setGeneratingAllPersonal(true);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/generate-personal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ audience: "all" }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to generate codes");
        return;
      }

      setEmailSuccess(
        `Generated ${Number(data?.generatedCount || 0)} codes`
      );
      await fetchCodes();
    } catch (err) {
      setEmailError("An unexpected error occurred while generating codes");
    } finally {
      setGeneratingAllPersonal(false);
    }
  };

  const generateAndSendPersonalCodeForUser = async (userId: string) => {
    setGeneratingPersonalUserId(userId);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/generate-personal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ audience: "one", recipientUserId: userId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to generate code");
        return;
      }

      setEmailSuccess("Code generated successfully");
      await fetchCodes();
    } catch (err) {
      setEmailError("An unexpected error occurred while generating code");
    } finally {
      setGeneratingPersonalUserId(null);
    }
  };

  const sendToAllUsers = async (codeId: string) => {
    setSendingAll(true);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          codeId,
          audience: "all",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to send email");
        return;
      }

      const sentTo = Number(data?.sentTo || 0);
      setEmailSuccess(`Email sent to all users (${sentTo} recipients)`);
      await fetchRecipients();
    } catch (err) {
      setEmailError("An unexpected error occurred while sending the email");
    } finally {
      setSendingAll(false);
    }
  };

  const getOrCreateBulkCodeId = async (): Promise<string | null> => {
    if (selectedBulkCodeId) return selectedBulkCodeId;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setEmailError("Session expired. Please log in again.");
      return null;
    }

    const res = await fetch("/api/checkin-codes/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ label: "Bulk Email" }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      setEmailError(data?.error || "Failed to create a bulk code");
      return null;
    }

    const newCodeId = String(data.id);
    setSelectedCodeId(newCodeId);
    await fetchCodes();
    return newCodeId;
  };

  const sendToOnboardingCompletedUsers = async (codeId: string) => {
    setSendingOnboardingCompleted(true);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          codeId,
          audience: "onboarding_completed",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to send email");
        return;
      }

      if (data?.success === false || Number(data?.failedCount || 0) > 0) {
        const failedCount = Number(data?.failedCount || 0);
        const sentTo = Number(data?.sentTo || 0);
        const firstFailure =
          Array.isArray(data?.failures) && data.failures.length > 0
            ? String(data.failures[0]?.error || "").trim()
            : "";
        setEmailError(
          firstFailure
            ? `Sent to ${sentTo}, failed ${failedCount}: ${firstFailure}`
            : `Sent to ${sentTo}, failed ${failedCount}`
        );
        if (sentTo > 0) {
          await fetchRecipients();
        }
        return;
      }

      const sentTo = Number(data?.sentTo || 0);
      if (sentTo === 0) {
        setEmailError("No onboarding-completed recipients were found.");
        return;
      }

      setEmailSuccess(
        `Email sent to onboarding-completed users (${sentTo} recipients)`
      );
      await fetchRecipients();
    } catch (err) {
      setEmailError("An unexpected error occurred while sending the email");
    } finally {
      setSendingOnboardingCompleted(false);
    }
  };

  const sendToOnboardingCompletedNotSentUsers = async (codeId: string) => {
    setSendingOnboardingCompletedNotSent(true);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          codeId,
          audience: "onboarding_completed_not_sent",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to send email");
        return;
      }

      if (data?.success === false || Number(data?.failedCount || 0) > 0) {
        const failedCount = Number(data?.failedCount || 0);
        const sentTo = Number(data?.sentTo || 0);
        const firstFailure =
          Array.isArray(data?.failures) && data.failures.length > 0
            ? String(data.failures[0]?.error || "").trim()
            : "";
        setEmailError(
          firstFailure
            ? `Sent to ${sentTo}, failed ${failedCount}: ${firstFailure}`
            : `Sent to ${sentTo}, failed ${failedCount}`
        );
        if (sentTo > 0) {
          await fetchRecipients();
        }
        return;
      }

      const sentTo = Number(data?.sentTo || 0);
      if (sentTo === 0) {
        setEmailError("No onboarding-completed unsent recipients were found.");
        return;
      }

      setEmailSuccess(
        `Email sent to onboarding-completed unsent users (${sentTo} recipients)`
      );
      await fetchRecipients();
    } catch (err) {
      setEmailError("An unexpected error occurred while sending the email");
    } finally {
      setSendingOnboardingCompletedNotSent(false);
    }
  };

  const sendToOnboardingCompletedTest = async (codeId: string) => {
    setSendingOnboardingCompletedTest(true);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          codeId,
          audience: "onboarding_completed_test",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to send test email");
        return;
      }

      const sentTo = Number(data?.sentTo || 0);
      const failedCount = Number(data?.failedCount || 0);
      if (failedCount > 0) {
        setEmailError(`Test send: sent ${sentTo}, failed ${failedCount}`);
        if (sentTo > 0) {
          await fetchRecipients();
        }
        return;
      }

      setEmailSuccess(`Test emails sent (${sentTo} recipients)`);
      if (sentTo > 0) {
        await fetchRecipients();
      }
    } catch (err) {
      setEmailError("An unexpected error occurred while sending test emails");
    } finally {
      setSendingOnboardingCompletedTest(false);
    }
  };

  const sendToOneUser = async (codeId: string, userId: string) => {
    setSendingUserId(userId);
    setEmailError("");
    setEmailSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setEmailError("Session expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/checkin-codes/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          codeId,
          audience: "one",
          recipientUserId: userId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailError(data?.error || "Failed to send email");
        return;
      }

      setEmailSuccess("Email sent successfully");
      await fetchRecipients();
    } catch (err) {
      setEmailError("An unexpected error occurred while sending the email");
    } finally {
      setSendingUserId(null);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    setSuccess("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError("Session expired. Please log in again.");
        setGenerating(false);
        return;
      }

      const res = await fetch("/api/checkin-codes/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ label: label.trim() || null }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to generate code");
        setGenerating(false);
        return;
      }

      setSuccess(`Code ${data.code} generated successfully`);
      setLabel("");
      if (data?.id) setSelectedCodeId(String(data.id));
      fetchCodes();
    } catch (err) {
      setError("An unexpected error occurred");
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isAuthorized) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Employee ID Codes</h1>
            <p className="text-gray-600 text-sm mt-1">
              Generate codes for workers to check in
            </p>
          </div>
          <button
            onClick={() => router.back()}
            className="text-primary-600 hover:text-primary-700 transition-colors font-medium text-sm"
          >
            &larr; Back
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Generate Code Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Generate New Code
          </h2>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional, e.g. Morning Shift)"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all text-gray-900"
            />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-6 py-3 bg-liquid-blue-200 hover:bg-liquid-blue-300 text-gray-900 rounded-xl font-medium transition-all disabled:opacity-50 shadow-lg whitespace-nowrap"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Generating...
                </span>
              ) : (
                "Generate Code"
              )}
            </button>
          </div>

          {/* Messages */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <svg
                className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {success && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
              <svg
                className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}
        </div>

        {/* Email Code Card (Standardized) */}
        <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Email Check-In Code
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Standard email template. Send to all users, onboarding-completed users, or to a single user.
          </p>

          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Active code</label>
              <select
                value={selectedCodeId}
                onChange={(e) => setSelectedCodeId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-900 bg-white"
                disabled={activeCodes.length === 0}
              >
                {activeCodes.length === 0 ? (
                  <option value="">No active codes</option>
                ) : (
                  activeCodes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}{c.label ? ` — ${c.label}` : ""} (permanent)
                    </option>
                  ))
                )}
              </select>
              {selectedCode?.target_user_id && (
                <p className="text-xs text-amber-700 mt-1">
                  Selected code is personal for{" "}
                  <span className="font-medium">
                    {recipientNameById.get(selectedCode.target_user_id) ||
                      selectedCode.target_user_id.slice(0, 8) + "..."}
                  </span>
                  . Bulk send is disabled.
                </p>
              )}
            </div>

            <div className="flex items-end gap-3">
              <button
                onClick={fetchRecipients}
                disabled={recipientsLoading}
                className="text-xs text-primary-700 hover:text-primary-800 disabled:opacity-50"
              >
                {recipientsLoading ? "Refreshing..." : "Refresh users"}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mb-4">
            <button
              onClick={() => {
                setEmailError("");
                setEmailSuccess("");
              }}
              className="text-sm text-gray-600 hover:text-gray-800"
              type="button"
            >
              Clear status
            </button>
            <button
              onClick={async () => {
                const codeId = await getOrCreateBulkCodeId();
                if (!codeId) return;
                await sendToAllUsers(codeId);
              }}
              disabled={
                sendingAll ||
                activeCodes.length === 0
              }
              className="px-6 py-3 bg-liquid-blue-200 hover:bg-liquid-blue-300 text-gray-900 rounded-xl font-medium transition-all disabled:opacity-50 shadow-lg"
            >
              {sendingAll ? "Sending..." : "Send to All Users"}
            </button>
            <button
              onClick={async () => {
                if (!activeCodes.length) {
                  setEmailError("No active code selected");
                  return;
                }
                const codeId = await getOrCreateBulkCodeId();
                if (!codeId) {
                  return;
                }
                await sendToOnboardingCompletedUsers(codeId);
              }}
              disabled={
                sendingOnboardingCompleted || activeCodes.length === 0
              }
              className="px-6 py-3 bg-emerald-600 border border-emerald-700 text-white rounded-xl font-medium hover:bg-emerald-700 transition-all disabled:opacity-50 shadow-sm"
              title="Sends in batches to users with completed onboarding workflow and uses each user's latest active personal code"
            >
              {sendingOnboardingCompleted
                ? "Sending..."
                : "Send to Onboarding Completed"}
            </button>
            <button
              onClick={async () => {
                if (!activeCodes.length) {
                  setEmailError("No active code selected");
                  return;
                }
                const codeId = await getOrCreateBulkCodeId();
                if (!codeId) {
                  return;
                }
                await sendToOnboardingCompletedNotSentUsers(codeId);
              }}
              disabled={
                sendingOnboardingCompletedNotSent ||
                activeCodes.length === 0 ||
                recipientsLoading
              }
              className="px-6 py-3 bg-teal-600 border border-teal-700 text-white rounded-xl font-medium hover:bg-teal-700 transition-all disabled:opacity-50 shadow-sm"
              title="Sends only to onboarding-completed users who have not been emailed yet"
            >
              {sendingOnboardingCompletedNotSent
                ? "Sending..."
                : `Send Onboarded Not Sent (${onboardingCompletedNotSentCount})`}
            </button>
            <button
              onClick={async () => {
                if (!activeCodes.length) {
                  setEmailError("No active code selected");
                  return;
                }
                const codeId = await getOrCreateBulkCodeId();
                if (!codeId) {
                  return;
                }
                await sendToOnboardingCompletedTest(codeId);
              }}
              disabled={
                sendingOnboardingCompletedTest || activeCodes.length === 0
              }
              className="px-6 py-3 bg-amber-500 border border-amber-600 text-white rounded-xl font-medium hover:bg-amber-600 transition-all disabled:opacity-50 shadow-sm"
              title="Sends only to the fixed onboarding test email list"
            >
              {sendingOnboardingCompletedTest
                ? "Sending..."
                : "Send Onboarding Test"}
            </button>
            <button
              onClick={async () => {
                await generateAndSendPersonalCodesAll();
              }}
              disabled={generatingAllPersonal || recipientsLoading}
              className="px-6 py-3 bg-white border border-primary-200 text-primary-700 rounded-xl font-medium hover:bg-primary-50 transition-all disabled:opacity-50 shadow-sm"
              title="Generates a unique code for each user"
            >
              {generatingAllPersonal
                ? "Generating..."
                : "Generate Codes (All Users)"}
            </button>
          </div>

          {emailError && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{emailError}</p>
            </div>
          )}
          {emailSuccess && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-800">{emailSuccess}</p>
            </div>
          )}

          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Users ({filteredRecipients.length}{searchQuery ? ` of ${recipients.length}` : ""})
              </h3>
            </div>

            <div className="flex items-center gap-3 mb-3">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or role..."
                  className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-all text-gray-900"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    type="button"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                onClick={() => setFilterOnboardedNotSent((v) => !v)}
                className={`px-4 py-2 text-sm rounded-xl font-medium border transition-all whitespace-nowrap ${
                  filterOnboardedNotSent
                    ? "bg-emerald-600 text-white border-emerald-700"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
                type="button"
                title="Show only users who completed onboarding and have not been emailed yet"
              >
                Onboarded &amp; Not Sent
              </button>
            </div>

            {filteredRecipients.length === 0 ? (
              <div className="text-sm text-gray-500">
                {recipientsLoading ? "Loading users..." : searchQuery ? "No users match your search." : "No users found."}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredRecipients.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 border border-gray-100 rounded-xl p-3 bg-white"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {(u.first_name || u.last_name
                            ? `${u.first_name} ${u.last_name}`.trim()
                            : u.email) || "User"}
                        </div>
                        {u.email_sent && (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                            Sent
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {u.email} | {u.role}
                      </div>
                      {u.last_sent_at && (
                        <div className="text-xs text-emerald-700 mt-1">
                          Last sent: {new Date(u.last_sent_at).toLocaleString()}
                        </div>
                      )}
                      <div className="text-xs text-gray-600 mt-1">
                        Code:{" "}
                        <span className="font-mono font-semibold tracking-widest text-gray-900">
                          {personalCodeByUserId.get(u.id)?.code || "-"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          await generateAndSendPersonalCodeForUser(u.id);
                        }}
                        disabled={generatingPersonalUserId === u.id}
                        className="px-4 py-2 text-sm bg-white border border-primary-200 text-primary-700 rounded-lg hover:bg-primary-50 disabled:opacity-50 whitespace-nowrap"
                        title="Generates a unique code for this user"
                      >
                        {generatingPersonalUserId === u.id
                          ? "Generating..."
                          : "Generate Code"}
                      </button>
                      <button
                        onClick={async () => {
                          if (!selectedCodeId) {
                            setEmailError("No active code selected");
                            return;
                          }
                          // If the selected code is personal for a different user,
                          // automatically use this user's own personal code instead
                          let codeIdToSend = selectedCodeId;
                          if (selectedCode?.target_user_id && selectedCode.target_user_id !== u.id) {
                            const userCode = personalCodeByUserId.get(u.id);
                            if (userCode) {
                              codeIdToSend = userCode.id;
                            } else {
                              setEmailError("Selected code is assigned to another user. Generate a personal code for this user first.");
                              return;
                            }
                          }
                          await sendToOneUser(codeIdToSend, u.id);
                        }}
                        disabled={sendingUserId === u.id || activeCodes.length === 0}
                        className="px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        title="Sends the selected active code to this user"
                      >
                        {sendingUserId === u.id ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Active Codes */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Active Codes ({activeCodes.length})
          </h2>

          {activeCodes.length === 0 ? (
            <div className="bg-white rounded-2xl shadow p-8 text-center border border-gray-100">
              <svg
                className="w-12 h-12 text-gray-300 mx-auto mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
              <p className="text-gray-500">No active codes. Generate one above.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeCodes.map((code) => (
                <div
                  key={code.id}
                  className="bg-white rounded-2xl shadow p-6 border border-gray-100"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="text-3xl font-mono font-bold text-primary-600 tracking-widest">
                        {code.code}
                      </div>
                      <button
                        onClick={() => copyCode(code.code, code.id)}
                        className="text-gray-400 hover:text-primary-600 transition-colors"
                        title="Copy code"
                      >
                        {copiedId === code.id ? (
                          <svg
                            className="w-5 h-5 text-green-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                    <div className="text-right">
                      {code.target_user_id && (
                        <span className="inline-block bg-amber-50 text-amber-800 text-xs font-medium px-2.5 py-1 rounded-full mb-1 mr-2">
                          For{" "}
                          {recipientNameById.get(code.target_user_id) ||
                            code.target_user_id.slice(0, 8) + "..."}
                        </span>
                      )}
                      {code.label && (
                        <span className="inline-block bg-primary-50 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-full mb-1">
                          {code.label}
                        </span>
                      )}
                      <p className="text-xs text-gray-500">Permanent</p>
                    </div>
                  </div>

                  {/* Check-ins */}
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Check-ins ({code.checkins.length})
                    </p>
                    {code.checkins.length === 0 ? (
                      <p className="text-sm text-gray-400">
                        No one has checked in yet
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {code.checkins.map((ci) => (
                          <div
                            key={ci.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="text-gray-700">
                              {ci.profile
                                ? `${ci.profile.first_name} ${ci.profile.last_name}`
                                : ci.user_id.slice(0, 8) + "..."}
                            </span>
                            <span className="text-gray-400 text-xs">
                              {new Date(ci.checked_in_at).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expired Codes */}
        {expiredCodes.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-500 mb-4">
              Inactive ({expiredCodes.length})
            </h2>
            <div className="space-y-3 opacity-60">
              {expiredCodes.map((code) => (
                <div
                  key={code.id}
                  className="bg-white rounded-xl shadow-sm p-4 border border-gray-100"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-mono font-bold text-gray-400 tracking-widest">
                        {code.code}
                      </span>
                      {code.label && (
                        <span className="text-xs text-gray-400">
                          {code.label}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {code.checkins.length} check-in
                      {code.checkins.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
