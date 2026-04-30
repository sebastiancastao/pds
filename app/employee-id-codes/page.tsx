"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type RecipientUser = {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  email_sent: boolean;
  last_sent_at: string | null;
};

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


export default function CheckInCodesPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [codes, setCodes] = useState<CheckinCode[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [recipients, setRecipients] = useState<RecipientUser[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [generatingPersonalUserId, setGeneratingPersonalUserId] = useState<string | null>(null);
  const [sendingUserId, setSendingUserId] = useState<string | null>(null);
  const [rowError, setRowError] = useState("");
  const [rowSuccess, setRowSuccess] = useState("");

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
    const q = searchQuery.toLowerCase().trim();
    if (!q) return recipients;
    return recipients.filter((u) => {
      const name = `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
    });
  }, [recipients, searchQuery]);

  useEffect(() => {
    checkAuth();
  }, []);

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

  const generatePersonalCodeForUser = async (userId: string) => {
    setGeneratingPersonalUserId(userId);
    setRowError("");
    setRowSuccess("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setRowError("Session expired. Please log in again."); return; }
      const res = await fetch("/api/checkin-codes/generate-personal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ audience: "one", recipientUserId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setRowError(data?.error || "Failed to generate code"); return; }
      setRowSuccess("Code generated successfully");
      await fetchCodes();
    } catch {
      setRowError("An unexpected error occurred while generating code");
    } finally {
      setGeneratingPersonalUserId(null);
    }
  };

  const sendToOneUser = async (userId: string) => {
    const userCode = personalCodeByUserId.get(userId);
    if (!userCode) { setRowError("No personal code for this user. Generate one first."); return; }
    setSendingUserId(userId);
    setRowError("");
    setRowSuccess("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setRowError("Session expired. Please log in again."); return; }
      const res = await fetch("/api/checkin-codes/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ codeId: userCode.id, audience: "one", recipientUserId: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setRowError(data?.error || "Failed to send email"); return; }
      setRowSuccess("Email sent successfully");
      await fetchRecipients();
    } catch {
      setRowError("An unexpected error occurred while sending the email");
    } finally {
      setSendingUserId(null);
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
        {/* Users */}
        <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Users ({filteredRecipients.length}{searchQuery ? ` of ${recipients.length}` : ""})
            </h2>
            <button
              onClick={fetchRecipients}
              disabled={recipientsLoading}
              className="text-xs text-primary-700 hover:text-primary-800 disabled:opacity-50"
            >
              {recipientsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="relative mb-4">
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

          {rowError && (
            <div className="mb-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{rowError}</p>
            </div>
          )}
          {rowSuccess && (
            <div className="mb-3 bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-sm text-green-800">{rowSuccess}</p>
            </div>
          )}

          {filteredRecipients.length === 0 ? (
            <p className="text-sm text-gray-500">
              {recipientsLoading ? "Loading users..." : searchQuery ? "No users match your search." : "No users found."}
            </p>
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
                        {(u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.email) || "User"}
                      </div>
                      {u.email_sent && (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                          Sent
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{u.email} | {u.role}</div>
                    {u.last_sent_at && (
                      <div className="text-xs text-emerald-700 mt-0.5">
                        Last sent: {new Date(u.last_sent_at).toLocaleString()}
                      </div>
                    )}
                    <div className="text-xs text-gray-600 mt-0.5">
                      Code:{" "}
                      <span className="font-mono font-semibold tracking-widest text-gray-900">
                        {personalCodeByUserId.get(u.id)?.code || "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => generatePersonalCodeForUser(u.id)}
                      disabled={generatingPersonalUserId === u.id}
                      className="px-3 py-1.5 text-sm bg-white border border-primary-200 text-primary-700 rounded-lg hover:bg-primary-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {generatingPersonalUserId === u.id ? "Generating..." : "Generate Code"}
                    </button>
                    <button
                      onClick={() => sendToOneUser(u.id)}
                      disabled={sendingUserId === u.id || !personalCodeByUserId.has(u.id)}
                      className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                      title={!personalCodeByUserId.has(u.id) ? "Generate a code first" : "Send code to this user"}
                    >
                      {sendingUserId === u.id ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                          For {code.target_user_id.slice(0, 8) + "..."}
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
