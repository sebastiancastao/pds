"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type TeamMember = {
  assignment_id: string;
  member_id: string;
  assigned_at: string;
  notes: string | null;
  member: {
    id: string;
    email: string;
    role: string;
    division: string | null;
    first_name: string;
    last_name: string;
  } | null;
};

function roleLabel(role: string) {
  const map: Record<string, string> = {
    manager: "Manager",
    supervisor: "Supervisor",
    supervisor2: "Supervisor 2",
    supervisor3: "Supervisor 3",
    exec: "Exec",
    admin: "Admin",
    vendor: "Vendor",
  };
  return map[role] ?? role;
}

function roleBadgeClass(role: string) {
  if (role === "exec" || role === "admin") return "bg-purple-100 text-purple-800";
  if (role === "manager") return "bg-blue-100 text-blue-800";
  if (role.startsWith("supervisor")) return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-700";
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export default function TeamMembersTimesheetPage() {
  const params = useParams();
  const router = useRouter();
  const userIdParam = params?.userId;
  const userId = Array.isArray(userIdParam) ? userIdParam[0] : String(userIdParam || "");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [managerName, setManagerName] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!userId) return;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.replace("/login");
          return;
        }

        const res = await fetch(`/api/users/${userId}/team-members`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load team members.");
        }

        setTeamMembers(data.teamMembers || []);

        // Load manager name
        const { data: profileData } = await supabase
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", userId)
          .single();

        if (profileData) {
          const first = profileData.first_name ?? "";
          const last = profileData.last_name ?? "";
          setManagerName(`${first} ${last}`.trim());
        }
      } catch (err: any) {
        setError(err?.message || "Failed to load team members.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [userId, router]);

  const filtered = teamMembers.filter((tm) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const fullName = `${tm.member?.first_name ?? ""} ${tm.member?.last_name ?? ""}`.toLowerCase();
    return (
      fullName.includes(q) ||
      (tm.member?.email ?? "").toLowerCase().includes(q) ||
      (tm.member?.role ?? "").toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading team members...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="bg-white rounded-xl shadow border border-red-200 p-8 max-w-md w-full text-center">
          <svg className="w-12 h-12 text-red-400 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-gray-800 font-semibold mb-2">Error</p>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Team Members</h1>
                {managerName && (
                  <p className="text-sm text-gray-500">{managerName}&rsquo;s team</p>
                )}
              </div>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              {teamMembers.length} {teamMembers.length === 1 ? "member" : "members"}
            </span>
          </div>
        </div>

        {/* Search */}
        {teamMembers.length > 0 && (
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, email or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        )}

        {/* Members list */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="text-gray-500 font-medium">
              {search ? "No members match your search." : "No team members assigned."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((tm) => {
              const first = tm.member?.first_name ?? "";
              const last = tm.member?.last_name ?? "";
              const fullName = `${first} ${last}`.trim() || "Unknown";

              return (
                <div
                  key={tm.assignment_id}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4"
                >
                  {/* Avatar */}
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {first || last ? initials(first, last) : "?"}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{fullName}</p>
                    <p className="text-sm text-gray-500 truncate">{tm.member?.email ?? "—"}</p>
                    {tm.member?.division && (
                      <p className="text-xs text-gray-400 truncate">{tm.member.division}</p>
                    )}
                  </div>

                  {/* Role badge */}
                  {tm.member?.role && (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${roleBadgeClass(tm.member.role)}`}>
                      {roleLabel(tm.member.role)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
